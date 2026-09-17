import { PROXY_URL, state } from "./state.js";
import { zipViewer, zipTitle, zipContent, zipIndicator, setZipNavVisible, closeZipGallery, render2DMatrixGallery, appendFolderGroupTo2DMatrix, updateZipScanProgress, updateZipIndicatorsAndHUD, getActiveMediaItem } from "./zip.js";
import { formatBytes, showMediaUnavailableWarning, renderMediaProgress, renderArchiveProgress, markMediaLoaded } from "./utils.js";
import { syncCarouselClones, playbackObserver, getCurrentGalleryPost } from "./feed.js";
import { createExternalAbortSignal, renderArchiveCardUI, escapeHtml, isImageOrVideo } from "./externalGalleries.js";
import { attachCustomVideoPlayer } from "./player.js";
import { loadGifPlayer } from "./gifPlayer.js";

export const dropboxFolderCache = new Map();
const dropboxInFlight = new Map();
export const dropboxGalleryCache = new Map();

export function getCleanDropboxUrl(url) {
  if (!url) return "";
  let target = url;
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    target = `https://www.dropbox.com${target.startsWith("/") ? "" : "/"}${target}`;
  }
  try {
    const u = new URL(target);
    u.searchParams.delete("raw");
    u.searchParams.set("dl", "0");
    return u.toString();
  } catch (_) {
    return target;
  }
}

function cleanupContainerMedia(target) {
  if (!target) return;
  if (typeof target._cleanupGif === "function") {
    try { target._cleanupGif(); } catch (_) {}
    target._cleanupGif = null;
  }
  target.querySelectorAll(".media-item").forEach((slide) => {
    if (typeof slide._cleanupGif === "function") {
      try { slide._cleanupGif(); } catch (_) {}
      slide._cleanupGif = null;
    }
  });
  target.querySelectorAll("video, audio, canvas").forEach((v) => {
    if (typeof v._cleanupCustomPlayer === "function") {
      try { v._cleanupCustomPlayer(); } catch (_) {}
    }
    if (typeof v._cleanupGif === "function") {
      try { v._cleanupGif(); } catch (_) {}
    }
    try {
      if (typeof v.pause === "function") v.pause();
      if (playbackObserver) playbackObserver.unobserve(v);
      if (typeof v.removeAttribute === "function") v.removeAttribute("src");
      if (typeof v.load === "function") v.load();
    } catch (_) {}
  });
  target.querySelectorAll("video, audio, img, canvas, .video-player-wrapper").forEach((el) => {
    if (el.tagName === "IMG" && el.src && el.src.startsWith("blob:")) {
      try { URL.revokeObjectURL(el.src); } catch (_) {}
    }
    el.remove();
  });
}

/**
 * Checks if a URL points to a Dropbox file or folder share link.
 */
export function isDropboxUrl(url) {
  return /https?:\/\/(?:www\.)?dropbox\.com\/(?:s|scl|sh)\/[^\s<>"']+/i.test(url);
}

/**
 * Accurately determines if a Dropbox URL is a folder link vs a direct file link.
 * Handles /scl/fo/ links that point to files inside folders (e.g. .../photo.png).
 */
export function isDropboxFolderUrl(url) {
  if (!url) return false;
  const pathOnly = url.split("?")[0].split("#")[0];
  if (pathOnly.includes("/scl/fi/")) return false;
  const lastSegment = pathOnly.split("/").filter(Boolean).pop() || "";
  if (isImageOrVideo(lastSegment)) return false;
  const ext = lastSegment.includes(".") ? lastSegment.split(".").pop().toLowerCase() : "";
  if (["zip", "rar", "7z", "tar", "gz", "pdf", "txt", "cbz", "cbr"].includes(ext)) return false;
  return pathOnly.includes("/sh/") || pathOnly.includes("/scl/fo/");
}

/**
 * Formats Dropbox entries into a standard hierarchical file tree string with file sizes.
 * Supports arbitrary folder-inside-folder depth.
 */
export function formatDropboxFileTree(entries, folderName) {
  const root = { name: folderName, isFolder: true, children: new Map(), size: 0 };

  for (const item of entries) {
    const rawPath = item.path || item.filename;
    const parts = rawPath.split("/").filter(Boolean);
    let curr = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const isDir = isLast ? item.is_dir : true;

      if (!curr.children.has(part)) {
        curr.children.set(part, {
          name: part,
          isFolder: isDir,
          size: isLast ? (item.bytes || 0) : 0,
          children: new Map()
        });
      }
      curr = curr.children.get(part);
      if (isLast) {
        curr.size = item.bytes || 0;
        curr.isFolder = item.is_dir;
      }
    }
  }

  let output = "";
  function printNode(node, prefix, isLast) {
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    if (node.isFolder) {
      output += prefix + connector + node.name + "/\n";
      const children = Array.from(node.children.values());
      children.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
      for (let i = 0; i < children.length; i++) {
        printNode(children[i], childPrefix, i === children.length - 1);
      }
    } else {
      const sizeStr = node.size > 0 ? ` (${formatBytes(node.size)})` : "";
      output += prefix + connector + node.name + sizeStr + "\n";
    }
  }

  const topChildren = Array.from(root.children.values());
  topChildren.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  for (let i = 0; i < topChildren.length; i++) {
    printNode(topChildren[i], "", i === topChildren.length - 1);
  }

  return { headerName: folderName, tree: output };
}

/**
 * Fetches Dropbox folder entries via the worker proxy endpoint with caching and in-flight deduplication.
 */
export async function fetchDropboxFolderEntries(url, signal) {
  let cleanUrl = url;
  try {
    const u = new URL(url);
    u.searchParams.delete("raw");
    u.searchParams.set("dl", "0");
    cleanUrl = u.toString();
  } catch (_) {}

  if (dropboxFolderCache.has(cleanUrl)) {
    return dropboxFolderCache.get(cleanUrl);
  }
  if (dropboxInFlight.has(cleanUrl)) {
    return dropboxInFlight.get(cleanUrl);
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("timeout"), 15000);

  let combinedSignal = timeoutController.signal;
  let abortHandler = null;
  if (signal) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      abortHandler = () => timeoutController.abort();
      signal.addEventListener("abort", abortHandler, { once: true });
      combinedSignal = timeoutController.signal;
    }
  }

  const fetchPromise = (async () => {
    try {
      const listEndpoint = `${PROXY_URL}/dropbox/list?url=${encodeURIComponent(cleanUrl)}`;
      const res = await fetch(listEndpoint, { signal: combinedSignal });

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/zip") || !contentType.includes("application/json")) {
        if (res.body) {
          try { res.body.cancel(); } catch (_) {}
        }
        throw new Error("Worker update required: Please paste and deploy the latest paw-worker.js into your Cloudflare Worker dashboard to enable on-demand streaming without downloading full 5GB archives.");
      }

      if (!res.ok) {
        let errMsg = `Failed to fetch Dropbox folder (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch (_) {}
        const error = new Error(errMsg);
        error.status = res.status;
        throw error;
      }

      const data = await res.json();

      let parentRlkey = "";
      let parentSt = "";
      try {
        const pUrl = cleanUrl.startsWith("http") ? cleanUrl : `https://www.dropbox.com${cleanUrl.startsWith("/") ? "" : "/"}${cleanUrl}`;
        const parentParsed = new URL(pUrl);
        parentRlkey = parentParsed.searchParams.get("rlkey") || "";
        parentSt = parentParsed.searchParams.get("st") || "";
      } catch (_) {}

      if (Array.isArray(data.entries)) {
        data.entries.forEach((item) => {
          let href = item.href || "";
          if (href) {
            if (!href.startsWith("http://") && !href.startsWith("https://")) {
              href = `https://www.dropbox.com${href.startsWith("/") ? "" : "/"}${href}`;
            }
            try {
              const u = new URL(href);
              if (parentRlkey && !u.searchParams.has("rlkey")) {
                u.searchParams.set("rlkey", parentRlkey);
              }
              if (parentSt && !u.searchParams.has("st")) {
                u.searchParams.set("st", parentSt);
              }
              href = u.toString();
            } catch (_) {}
            item.href = href;
          }

          let rawUrl = item.rawUrl || item.href || "";
          if (rawUrl) {
            if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
              rawUrl = `https://www.dropbox.com${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
            }
            try {
              const u = new URL(rawUrl);
              if (!item.is_dir) {
                u.searchParams.set("raw", "1");
                u.searchParams.delete("dl");
              }
              if (parentRlkey && !u.searchParams.has("rlkey")) {
                u.searchParams.set("rlkey", parentRlkey);
              }
              if (parentSt && !u.searchParams.has("st")) {
                u.searchParams.set("st", parentSt);
              }
              rawUrl = u.toString();
            } catch (_) {}
            item.rawUrl = rawUrl;
          }
        });
      }

      if (dropboxFolderCache.size >= 50) {
        const oldestKey = dropboxFolderCache.keys().next().value;
        if (oldestKey) dropboxFolderCache.delete(oldestKey);
      }
      dropboxFolderCache.set(cleanUrl, data);
      return data;
    } catch (fetchErr) {
      if (signal && signal.aborted) throw fetchErr;
      if (timeoutController.signal.aborted) {
        throw new Error("Dropbox connection timed out. Please verify your Cloudflare Worker deployment.");
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
      if (signal && abortHandler) {
        try { signal.removeEventListener("abort", abortHandler); } catch (_) {}
      }
      dropboxInFlight.delete(cleanUrl);
    }
  })();

  dropboxInFlight.set(cleanUrl, fetchPromise);
  return fetchPromise;
}

/**
 * Handles embedding a Dropbox link inside a post card.
 */
export function handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal) {
  const isFolder = isDropboxFolderUrl(url);

  if (isFolder) {
    handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, filename, signal);
    return;
  }

  const ext = url.split("?")[0].split(".").pop().toLowerCase();
  const isGif = ext === "gif";
  const isImage = ["jpg", "jpeg", "png", "webp", "avif"].includes(ext);
  const isVideo = ["mp4", "webm", "mov"].includes(ext);

  if (isGif || isImage || isVideo) {
    let targetUrl = url;
    if (targetUrl && !targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://www.dropbox.com${targetUrl.startsWith("/") ? "" : "/"}${targetUrl}`;
    }
    try {
      const u = new URL(targetUrl);
      u.searchParams.set("raw", "1");
      u.searchParams.delete("dl");
      targetUrl = u.toString();
    } catch (_) {}
    const directUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(targetUrl)}`;
    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      const totalSize = parseInt(item.dataset.size || "0", 10);
      const totalStr = totalSize > 0 ? formatBytes(totalSize) : "";
      renderMediaProgress(progressOverlay, "Loading...", null, filename, "", totalStr);
    }
    const triggerRetry = () => {
      cleanupContainerMedia(item);
      delete item.dataset.loaded;
      handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
    };
    if (isGif) {
      loadGifPlayer({
        item,
        url: directUrl,
        filename,
        progressOverlay,
        onRetry: triggerRetry,
        syncCarouselClones,
        playbackObserver,
      });
      return;
    }
    if (isVideo) {
      const video = document.createElement("video");
      video.className = "post-media";
      video.src = directUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("muted", "");
      video.preload = "metadata";
      video.controls = false;
      video.addEventListener("canplay", () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        syncCarouselClones(item);
      });
      video.onerror = async () => {
        cleanupContainerMedia(item);
        let errorStatus = "500";
        try {
          const probeRes = await fetch(directUrl, { method: "HEAD", signal });
          if (!probeRes.ok) errorStatus = String(probeRes.status);
        } catch (_) {}
        if (progressOverlay) showMediaUnavailableWarning(progressOverlay, { type: "video", filename, errorStatus, externalUrl: url, onRetry: triggerRetry });
      };
      item.appendChild(video);
      attachCustomVideoPlayer(video, item);
      playbackObserver.observe(video);
    } else {
      const img = new Image();
      img.className = "post-media";
      img.onload = () => {
        if (progressOverlay) progressOverlay.style.display = "none";
        cleanupContainerMedia(item);
        item.appendChild(img);
        syncCarouselClones(item);
      };
      const triggerRetry = () => {
        cleanupContainerMedia(item);
        delete item.dataset.loaded;
        handleDropboxFileCard(item, url, postTitle, filename, progressOverlay, signal);
      };
      img.onerror = async () => {
        cleanupContainerMedia(item);
        let errorStatus = "500";
        try {
          const probeRes = await fetch(directUrl, { method: "HEAD", signal });
          if (!probeRes.ok) errorStatus = String(probeRes.status);
        } catch (_) {}
        if (progressOverlay) showMediaUnavailableWarning(progressOverlay, { type: "image", filename, errorStatus, externalUrl: url, onRetry: triggerRetry });
      };
      img.src = directUrl;
    }
    return;
  }

  if (progressOverlay) progressOverlay.style.display = "none";
  renderArchiveCardUI(item, url, "dropbox", postTitle, filename, signal);
}

/**
 * Inspects a Dropbox shared folder and embeds either the single media item directly,
 * or displays an archive preview card with file counts, sizes, and file tree.
 */
export async function handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal) {
  try {
    const cleanUrl = getCleanDropboxUrl(url);
    if (dropboxGalleryCache.has(cleanUrl)) {
      const cached = dropboxGalleryCache.get(cleanUrl);
      if (cached && cached.details) {
        if (progressOverlay) progressOverlay.style.display = "none";
        renderArchiveCardUI(item, url, "dropbox", postTitle, cached.archiveName || fallbackName || "Dropbox Archive", signal, cached.details);
        return;
      }
    }

    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(progressOverlay, "Loading...", null, fallbackName || "Dropbox Folder", "Connecting...", "");
    }

    const data = await fetchDropboxFolderEntries(url, signal);
    const rawEntries = data.entries || [];
    const seen = new Set();
    const entries = [];
    for (const entry of rawEntries) {
      const key = entry.href || entry.rawUrl || (entry.path || entry.filename);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    }

    const mediaFiles = entries.filter((f) => !f.is_dir && isImageOrVideo(f.filename));
    const subfolders = entries.filter((f) => f.is_dir);

    let totalSize = 0;
    if (typeof data.total_size === "number" && data.total_size > 0) {
      totalSize = data.total_size;
    } else {
      for (const e of entries) {
        if (!e.is_dir) totalSize += (e.bytes || 0);
      }
    }

    const folderName = data.folder_name || fallbackName || "Dropbox Archive";
    const { headerName, tree } = formatDropboxFileTree(entries, folderName);
    const archiveName = headerName || fallbackName || "Dropbox Archive";

    if (mediaFiles.length === 1 && subfolders.length === 0) {
      const single = mediaFiles[0];
      const isVideo = ["mp4", "webm", "mov"].includes(single.filename.split(".").pop().toLowerCase());
      let targetUrl = single.rawUrl || single.href || "";
      if (targetUrl) {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = `https://www.dropbox.com${targetUrl.startsWith("/") ? "" : "/"}${targetUrl}`;
        }
        try {
          const u = new URL(targetUrl);
          u.searchParams.set("raw", "1");
          u.searchParams.delete("dl");
          targetUrl = u.toString();
        } catch (_) {}
      }
      const streamUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(targetUrl)}`;

      if (progressOverlay) progressOverlay.style.display = "none";

      if (isVideo) {
        const video = document.createElement("video");
        video.className = "post-media";
        video.src = streamUrl;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("muted", "");
        video.preload = "metadata";
        video.controls = false;
        video.addEventListener("canplay", () => {
          syncCarouselClones(item);
        });
        const triggerRetry = () => {
          cleanupContainerMedia(item);
          delete item.dataset.loaded;
          handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal);
        };
        video.onerror = async () => {
          cleanupContainerMedia(item);
          let errorStatus = "500";
          try {
            const probeRes = await fetch(streamUrl, { method: "HEAD", signal });
            if (!probeRes.ok) errorStatus = String(probeRes.status);
          } catch (_) {}
          if (progressOverlay) {
            showMediaUnavailableWarning(progressOverlay, {
              type: "video",
              filename: single.filename,
              errorStatus,
              externalUrl: url,
              onRetry: triggerRetry
            });
          }
        };
        item.appendChild(video);
        attachCustomVideoPlayer(video, item);
        playbackObserver.observe(video);
      } else {
        const img = new Image();
        img.className = "post-media";
        img.onload = () => {
          if (progressOverlay) progressOverlay.style.display = "none";
          cleanupContainerMedia(item);
          item.appendChild(img);
          syncCarouselClones(item);
        };
        const triggerRetry = () => {
          cleanupContainerMedia(item);
          delete item.dataset.loaded;
          handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal);
        };
        img.onerror = async () => {
          cleanupContainerMedia(item);
          let errorStatus = "500";
          try {
            const probeRes = await fetch(streamUrl, { method: "HEAD", signal });
            if (!probeRes.ok) errorStatus = String(probeRes.status);
          } catch (_) {}
          if (progressOverlay) {
            showMediaUnavailableWarning(progressOverlay, {
              type: "image",
              filename: single.filename,
              errorStatus,
              externalUrl: url,
              onRetry: triggerRetry
            });
          }
        };
        img.src = streamUrl;
      }
      syncCarouselClones(item);
      return;
    }

    if (progressOverlay) progressOverlay.style.display = "none";

    let countLabel = "";
    if (mediaFiles.length === 0 && subfolders.length > 0) {
      countLabel = `${subfolders.length} folder${subfolders.length > 1 ? "s" : ""}`;
    } else if (mediaFiles.length > 0 && subfolders.length > 0) {
      countLabel = `${mediaFiles.length} file${mediaFiles.length > 1 ? "s" : ""}, ${subfolders.length} folder${subfolders.length > 1 ? "s" : ""}`;
    } else {
      const count = mediaFiles.length || entries.length;
      countLabel = `${count} file${count > 1 ? "s" : ""}`;
    }

    renderArchiveCardUI(item, url, "dropbox", postTitle, archiveName, signal, {
      totalSize,
      fileCount: mediaFiles.length || entries.length,
      countLabel,
      tree
    });

    if (subfolders.length > 0) {
      progressivelyExpandDropboxTree(item, url, entries, folderName, totalSize, archiveName, signal);
    }

  } catch (err) {
    if (signal && signal.aborted) return;
    console.warn("[Dropbox] handleDropboxFolderEmbed warning for", url, err.message || err);
    if (progressOverlay) {
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || "500");
      showMediaUnavailableWarning(progressOverlay, {
        type: "zip",
        filename: fallbackName || "Dropbox Folder",
        errorStatus: detectedStatus,
        error: err,
        message: err.message || "Failed to load Dropbox folder",
        externalUrl: url,
        onRetry: () => handleDropboxFolderEmbed(item, url, progressOverlay, postTitle, fallbackName, signal)
      });
    }
  }
}

export function entriesToFolderGroups(allEntries, rootName) {
  const naturalCompare = (a, b) => {
    const strA = (typeof a === "string" ? a : (a.path || a.name || a.filename || "")).toLowerCase();
    const strB = (typeof b === "string" ? b : (b.path || b.name || b.filename || "")).toLowerCase();
    return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
  };

  const folderMap = new Map();
  const mediaFiles = (allEntries || []).filter((e) => !e.is_dir && isImageOrVideo(e.filename));

  for (const file of mediaFiles) {
    const rawPath = file.path || file.filename;
    const parts = rawPath.split("/").filter(Boolean);
    const folderPath = parts.length > 1 ? parts.slice(0, -1).join("/") : rootName;
    const folderName = parts.length > 1 ? parts[parts.length - 2] : rootName;

    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, {
        folderName,
        folderPath,
        files: []
      });
    }
    folderMap.get(folderPath).files.push(file);
  }

  const sortedPaths = Array.from(folderMap.keys()).sort(naturalCompare);
  return sortedPaths.map((p) => {
    const group = folderMap.get(p);
    group.files.sort((a, b) => naturalCompare(a.filename, b.filename));
    return group;
  });
}

/**
 * Progressively crawls Dropbox subfolders in the background.
 */
async function progressivelyExpandDropboxTree(cardItem, rootUrl, initialEntries, folderName, initialTotalSize, archiveName, signal) {
  if (!cardItem || !initialEntries || initialEntries.length === 0) return;

  const allEntries = [...initialEntries];
  const seenPaths = new Set();
  const seenFolders = new Set();

  for (const entry of initialEntries) {
    const p = entry.path || entry.filename;
    seenPaths.add(p);
    if (entry.is_dir && entry.href) {
      seenFolders.add(entry.href);
    }
  }

  const naturalCompare = (a, b) => {
    const strA = (typeof a === "string" ? a : (a.path || a.name || a.filename || "")).toLowerCase();
    const strB = (typeof b === "string" ? b : (b.path || b.name || b.filename || "")).toLowerCase();
    return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
  };

  const queue = initialEntries
    .filter((e) => e.is_dir && e.href)
    .map((e) => ({ ...e, path: e.path || e.filename }));

  queue.sort(naturalCompare);

  if (queue.length === 0) return;

  let discoveredBytes = 0;
  let running = true;
  let updateTimer = null;
  let lastUpdateTime = 0;

  function updateUI() {
    if (!cardItem.isConnected || (signal && signal.aborted)) return;

    const { tree } = formatDropboxFileTree(allEntries, folderName);
    let fullTree = "";
    if (archiveName && !tree.startsWith("└── " + archiveName)) {
      fullTree = `${archiveName}\n${tree}`;
    } else {
      fullTree = tree;
    }

    const files = allEntries.filter((e) => !e.is_dir);
    const dirs = allEntries.filter((e) => e.is_dir);

    const effectiveTotal = (initialTotalSize && initialTotalSize > 0) ? initialTotalSize : discoveredBytes;
    const sizeStr = effectiveTotal > 0 ? `${formatBytes(effectiveTotal)}, ` : "";

    let countText = "";
    if (files.length > 0 && dirs.length > 0) {
      countText = `${files.length} file${files.length > 1 ? "s" : ""}, ${dirs.length} folder${dirs.length > 1 ? "s" : ""}`;
    } else if (files.length > 0) {
      countText = `${files.length} file${files.length > 1 ? "s" : ""}`;
    } else {
      countText = `${dirs.length} folder${dirs.length > 1 ? "s" : ""}`;
    }

    const headerText = `${sizeStr}${countText}`;

    const treeEl = cardItem.querySelector(".zip-info-tree");
    if (treeEl) treeEl.textContent = fullTree;

    const headerSpan = cardItem.querySelector(".zip-info-header span");
    if (headerSpan) headerSpan.textContent = headerText;

    if (cardItem.parentElement && cardItem.parentElement.classList.contains("media-carousel")) {
      const carousel = cardItem.parentElement;
      const children = Array.from(carousel.children);
      if (children.length > 2) {
        const firstOrig = children[1];
        const lastOrig = children[children.length - 2];
        let clone = null;
        if (cardItem === firstOrig) clone = children[children.length - 1];
        else if (cardItem === lastOrig) clone = children[0];
        if (clone && clone.dataset.isClone === "true") {
          const cTree = clone.querySelector(".zip-info-tree");
          if (cTree) cTree.textContent = fullTree;
          const cHeader = clone.querySelector(".zip-info-header span");
          if (cHeader) cHeader.textContent = headerText;
        }
      }
    }
  }

  function scheduleUpdate(immediate = false) {
    if (immediate) {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = null;
      updateUI();
      lastUpdateTime = Date.now();
      return;
    }
    const now = Date.now();
    if (now - lastUpdateTime >= 250) {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = null;
      updateUI();
      lastUpdateTime = now;
    } else if (!updateTimer) {
      updateTimer = setTimeout(() => {
        updateTimer = null;
        updateUI();
        lastUpdateTime = Date.now();
      }, 250 - (now - lastUpdateTime));
    }
  }

  const MAX_TOTAL_FOLDERS = 400;
  let crawledCount = 0;

  async function expandWorker() {
    while (queue.length > 0 && running) {
      if (signal && signal.aborted) break;
      if (!cardItem.isConnected) break;
      if (crawledCount >= MAX_TOTAL_FOLDERS) break;

      const current = queue.shift();
      if (!current || !current.href) continue;

      // Prefetch upcoming folders in queue
      for (let i = 0; i < 3 && i < queue.length; i++) {
        if (queue[i] && queue[i].href) {
          fetchDropboxFolderEntries(queue[i].href, signal).catch(() => {});
        }
      }

      crawledCount++;
      try {
        const data = await fetchDropboxFolderEntries(current.href, signal);
        if (signal && signal.aborted) break;
        if (!cardItem.isConnected) break;

        const subEntries = data.entries || [];
        const newDirs = [];

        for (const child of subEntries) {
          const childPath = `${current.path}/${child.filename}`;
          if (seenPaths.has(childPath)) continue;
          seenPaths.add(childPath);

          const childEntry = { ...child, path: childPath };
          allEntries.push(childEntry);

          if (child.is_dir) {
            if (child.href && !seenFolders.has(child.href)) {
              seenFolders.add(child.href);
              newDirs.push(childEntry);
            }
          } else {
            discoveredBytes += (child.bytes || 0);
          }
        }

        if (newDirs.length > 0) {
          newDirs.sort(naturalCompare);
          queue.unshift(...newDirs);
        }

        scheduleUpdate(false);
      } catch (err) {
        if (signal && signal.aborted) break;
      }
    }
  }

  try {
    await expandWorker();
  } finally {
    running = false;
    if (updateTimer) clearTimeout(updateTimer);
    scheduleUpdate(true);

    const cleanUrl = getCleanDropboxUrl(rootUrl);
    const groups = entriesToFolderGroups(allEntries, folderName);
    if (groups.length > 0) {
      if (dropboxGalleryCache.size >= 50) {
        const oldestKey = dropboxGalleryCache.keys().next().value;
        if (oldestKey) dropboxGalleryCache.delete(oldestKey);
      }
      const files = allEntries.filter((e) => !e.is_dir);
      const dirs = allEntries.filter((e) => e.is_dir);
      const effectiveTotal = (initialTotalSize && initialTotalSize > 0) ? initialTotalSize : discoveredBytes;
      const sizeStr = effectiveTotal > 0 ? `${formatBytes(effectiveTotal)}, ` : "";
      let countText = "";
      if (files.length > 0 && dirs.length > 0) {
        countText = `${files.length} file${files.length > 1 ? "s" : ""}, ${dirs.length} folder${dirs.length > 1 ? "s" : ""}`;
      } else if (files.length > 0) {
        countText = `${files.length} file${files.length > 1 ? "s" : ""}`;
      } else {
        countText = `${dirs.length} folder${dirs.length > 1 ? "s" : ""}`;
      }
      const { tree } = formatDropboxFileTree(allEntries, folderName);
      let fullTree = "";
      if (archiveName && !tree.startsWith("└── " + archiveName)) {
        fullTree = `${archiveName}\n${tree}`;
      } else {
        fullTree = tree;
      }

      dropboxGalleryCache.set(cleanUrl, {
        folderName,
        archiveName,
        groups,
        details: {
          totalSize: effectiveTotal,
          fileCount: files.length,
          countLabel: countText,
          tree: fullTree
        }
      });
    }
  }
}

/**
 * Recursively discovers all subfolders and media files inside a Dropbox shared directory,
 * traversing and discovering folders sequentially from first to last using natural alphanumeric sorting.
 */
export async function crawlAllDropboxFolders(rootUrl, rootName, initialEntries, signal, onProgress, onFolderDiscovered) {
  const folderGroupsMap = new Map();
  const seenUrls = new Set();
  seenUrls.add(rootUrl);

  const naturalCompare = (a, b) => {
    const strA = (typeof a === "string" ? a : (a.path || a.name || a.filename || "")).toLowerCase();
    const strB = (typeof b === "string" ? b : (b.path || b.name || b.filename || "")).toLowerCase();
    return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
  };

  const rootFiles = (initialEntries || []).filter((e) => !e.is_dir && isImageOrVideo(e.filename));
  if (rootFiles.length > 0) {
    rootFiles.sort((a, b) => naturalCompare(a.path || a.filename, b.path || b.filename));
    const rootGroup = {
      folderName: rootName,
      folderPath: rootName,
      files: rootFiles
    };
    folderGroupsMap.set(rootName, rootGroup);
  }

  const initialSubfolders = (initialEntries || [])
    .filter((e) => e.is_dir && e.href)
    .map((e) => ({
      name: e.filename,
      path: e.filename,
      url: e.href
    }));

  initialSubfolders.sort(naturalCompare);

  for (const item of initialSubfolders) {
    seenUrls.add(item.url);
  }

  const MAX_FOLDERS = 200;
  let crawled = 0;

  async function crawlFolder(folder, siblingList = [], siblingIndex = -1) {
    if (signal && signal.aborted) return;
    if (crawled >= MAX_FOLDERS) return;

    crawled++;
    if (onProgress) onProgress(crawled);

    // Opportunistically prefetch upcoming siblings in the background so the next
    // HTTP roundtrip is already in-flight or completed in cache when we need it.
    if (siblingList.length > 0 && siblingIndex >= 0) {
      const prefetchCount = 3;
      for (let i = 1; i <= prefetchCount; i++) {
        const nextSibling = siblingList[siblingIndex + i];
        if (nextSibling && nextSibling.url && !seenUrls.has(nextSibling.url)) {
          fetchDropboxFolderEntries(nextSibling.url, signal).catch(() => {});
        }
      }
    }

    try {
      const subData = await fetchDropboxFolderEntries(folder.url, signal);
      if (signal && signal.aborted) return;

      const subEntries = subData.entries || [];
      const files = subEntries.filter((e) => !e.is_dir && isImageOrVideo(e.filename));
      files.sort((a, b) => naturalCompare(a.filename, b.filename));

      if (files.length > 0) {
        const group = {
          folderName: folder.name,
          folderPath: folder.path,
          files: files
        };
        folderGroupsMap.set(folder.path, group);
        if (onFolderDiscovered) {
          onFolderDiscovered(group);
        }
      }

      // Collect any nested child directories
      const childDirs = subEntries
        .filter((c) => c.is_dir && c.href && !seenUrls.has(c.href))
        .map((c) => ({
          name: c.filename,
          path: `${folder.path}/${c.filename}`,
          url: c.href
        }));

      // Sort child directories naturally from first to last
      childDirs.sort(naturalCompare);
      for (const child of childDirs) {
        seenUrls.add(child.url);
      }

      // Recursively crawl children sequentially from first to last
      for (let i = 0; i < childDirs.length; i++) {
        if (signal && signal.aborted) break;
        await crawlFolder(childDirs[i], childDirs, i);
      }
    } catch (_) {}
  }

  // Sequentially crawl top-level subfolders from first to last
  for (let i = 0; i < initialSubfolders.length; i++) {
    if (signal && signal.aborted) break;
    await crawlFolder(initialSubfolders[i], initialSubfolders, i);
  }

  const paths = Array.from(folderGroupsMap.keys()).sort(naturalCompare);
  const result = paths.map((p) => folderGroupsMap.get(p));

  const cleanUrl = getCleanDropboxUrl(rootUrl);
  if (result.length > 0) {
    if (dropboxGalleryCache.size >= 50) {
      const oldestKey = dropboxGalleryCache.keys().next().value;
      if (oldestKey) dropboxGalleryCache.delete(oldestKey);
    }
    dropboxGalleryCache.set(cleanUrl, {
      folderName: rootName,
      groups: result,
    });
  }

  return result;
}

/**
 * Opens a Dropbox share link in the fullscreen gallery viewer.
 */
export async function openDropboxGallery(dropboxUrl, galleryTitle, folderStack = [], post = null) {
  if (post) {
    state.currentGalleryPost = post;
  } else if (!state.currentGalleryPost) {
    state.currentGalleryPost = getCurrentGalleryPost();
  }

  const signal = createExternalAbortSignal();
  clearDropboxMediaQueue();

  const existingBackBtn = document.getElementById("dropbox-carousel-back-btn");
  if (existingBackBtn) existingBackBtn.remove();

  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }

  const isFolder = isDropboxFolderUrl(dropboxUrl);
  const cleanUrl = getCleanDropboxUrl(dropboxUrl);

  if (isFolder && dropboxGalleryCache.has(cleanUrl)) {
    const cached = dropboxGalleryCache.get(cleanUrl);
    if (cached && cached.groups && cached.groups.length > 0) {
      if (signal && signal.aborted) return;
      const title = cached.archiveName || cached.folderName || galleryTitle || "Dropbox Gallery";
      setZipNavVisible(false, true);
      if (zipViewer) zipViewer.classList.remove("hidden");
      if (zipTitle) zipTitle.textContent = title;
      if (zipIndicator) {
        zipIndicator.textContent = "";
        zipIndicator.style.display = "";
      }
      const convertToMatrixGroup = (group) => ({
        folderName: group.folderName,
        folderPath: group.folderPath,
        files: group.files.map((f, idx) => ({
          filename: f.filename,
          folder: group.folderPath,
          size: f.bytes || f.size || 0,
          link: f.href || f.rawUrl || f.link || "",
          loadMedia: (container, sig) => {
            container.dataset.fileIdx = String(idx);
            loadAndDisplayDropboxItem(container, f, sig);
          }
        }))
      });

      const folderGroups = cached.groups.map(convertToMatrixGroup);
      render2DMatrixGallery(folderGroups, { galleryTitle: title, signal });
      return;
    }
  }

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = galleryTitle || "Dropbox Gallery";
  if (zipIndicator) {
    zipIndicator.textContent = "";
    zipIndicator.style.display = "";
  }
  if (zipContent) {
    zipContent.classList.remove("folder-browser-mode");
    zipContent.innerHTML = '<div id="zip-progress-text"></div>';
    const pt = document.getElementById("zip-progress-text");
    renderArchiveProgress(pt, "Connecting...", null, galleryTitle || "Dropbox Gallery");
  }

  if (!isFolder) {
    if (signal && signal.aborted) return;
    if (zipContent) {
      zipContent.classList.remove("folder-browser-mode");
      zipContent.classList.remove("gallery-2d-mode");
      zipContent.innerHTML = "";
    }
    if (zipIndicator) zipIndicator.textContent = "1 / 1";
    if (zipContent) zipContent.dataset.mediaCount = "1";

    const container = document.createElement("div");
    container.className = "media-item";
    container.dataset.fileIdx = "0";
    const filename = dropboxUrl.split("/").pop().split("?")[0] || "file";
    container.dataset.filename = filename;
    container.dataset.folder = "/";
    container.dataset.link = dropboxUrl;
    container.dataset.size = "0";
    container.style.flex = "0 0 100vw";
    container.style.height = "100%";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";

    const directUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(dropboxUrl)}`;
    const ext = dropboxUrl.split("?")[0].split(".").pop().toLowerCase();
    const isVideo = ["mp4", "webm", "mov"].includes(ext);
    const isGif = ext === "gif";

    if (isVideo) {
      const video = document.createElement("video");
      video.src = directUrl;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.loop = true;
      video.muted = true;
      video.style.maxWidth = "100%";
      video.style.maxHeight = "100%";
      video.style.objectFit = "contain";
      video.onerror = () => {
        if (zipContent) {
          cleanupContainerMedia(zipContent);
          showMediaUnavailableWarning(zipContent, {
            type: "video",
            filename,
            errorStatus: "404",
            externalUrl: dropboxUrl
          });
        }
      };
      container.appendChild(video);
      attachCustomVideoPlayer(video, container);
    } else if (isGif) {
      loadGifPlayer({
        item: container,
        url: directUrl,
        filename,
        playbackObserver,
        onRetry: () => {
          if (zipContent) {
            cleanupContainerMedia(zipContent);
            openDropboxGallery(dropboxUrl, galleryTitle, folderStack, post);
          }
        },
      });
    } else {
      const img = document.createElement("img");
      img.src = directUrl;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      img.onerror = () => {
        if (zipContent) {
          cleanupContainerMedia(zipContent);
          showMediaUnavailableWarning(zipContent, {
            type: "image",
            filename,
            errorStatus: "404",
            externalUrl: dropboxUrl
          });
        }
      };
      container.appendChild(img);
    }
    if (zipContent) zipContent.appendChild(container);
    updateZipIndicatorsAndHUD();
    return;
  }

  try {
    const pt = document.getElementById("zip-progress-text");
    if (pt) renderArchiveProgress(pt, "Fetching folder index...", null, galleryTitle || "Dropbox Gallery");

    const data = await fetchDropboxFolderEntries(dropboxUrl, signal);
    if (signal.aborted) return;

    const rawEntries = data.entries || [];
    const seen = new Set();
    const entries = [];
    for (const item of rawEntries) {
      const key = item.href || item.rawUrl || (item.path || item.filename);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(item);
      }
    }

    const currentFolderName = data.folder_name || galleryTitle || "Dropbox Folder";
    const naturalCompare = (a, b) => {
      const strA = (typeof a === "string" ? a : (a.path || a.filename || "")).toLowerCase();
      const strB = (typeof b === "string" ? b : (b.path || b.filename || "")).toLowerCase();
      return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
    };

    const rootFiles = entries.filter((e) => !e.is_dir && isImageOrVideo(e.filename));
    rootFiles.sort(naturalCompare);
    const subfolderEntries = entries.filter((e) => e.is_dir && e.href);
    subfolderEntries.sort(naturalCompare);

    const convertToMatrixGroup = (group) => ({
      folderName: group.folderName,
      folderPath: group.folderPath,
      files: group.files.map((f, idx) => {
        const fileSize = f.bytes || f.size || 0;
        return {
          filename: f.filename,
          folder: group.folderPath,
          size: fileSize,
          bytes: fileSize,
          link: f.href || f.rawUrl || "",
          loadMedia: (container, sig) => {
            container.dataset.fileIdx = String(idx);
            loadAndDisplayDropboxItem(container, { ...f, size: fileSize, bytes: fileSize }, sig);
          }
        };
      })
    });

    let galleryMounted = false;
    let totalFoldersFound = 0;

    if (rootFiles.length > 0) {
      const rootGroup = {
        folderName: currentFolderName,
        folderPath: currentFolderName,
        files: rootFiles
      };
      totalFoldersFound++;
      render2DMatrixGallery([convertToMatrixGroup(rootGroup)], { galleryTitle: currentFolderName, signal });
      galleryMounted = true;
    }

    if (subfolderEntries.length > 0) {
      if (galleryMounted) {
        updateZipScanProgress("Scanning subfolders...");
      } else {
        const p = document.getElementById("zip-progress-text");
        if (p) renderArchiveProgress(p, "Scanning folders...", null, galleryTitle || "Dropbox Gallery");
      }

      await crawlAllDropboxFolders(
        dropboxUrl,
        currentFolderName,
        entries,
        signal,
        (scannedCount) => {
          if (galleryMounted) {
            updateZipScanProgress(`Scanning subfolders... (${totalFoldersFound} found)`);
          } else {
            const p = document.getElementById("zip-progress-text");
            if (p) renderArchiveProgress(p, `Scanning folders (${scannedCount} scanned)...`, null, galleryTitle || "Dropbox Gallery");
          }
        },
        (discoveredGroup) => {
          if (signal.aborted) return;
          totalFoldersFound++;
          const matrixGroup = convertToMatrixGroup(discoveredGroup);
          if (!galleryMounted) {
            render2DMatrixGallery([matrixGroup], { galleryTitle: currentFolderName, signal });
            galleryMounted = true;
          } else {
            appendFolderGroupTo2DMatrix(matrixGroup, { signal });
          }
          updateZipScanProgress(`Scanning subfolders... (${totalFoldersFound} found)`);
        }
      );

      if (signal.aborted) return;
      updateZipScanProgress("");
    }

    if (galleryMounted) {
      return;
    }

    const subfolders = entries.filter((f) => f.is_dir);
    if (subfolders.length > 0) {
      renderDropboxFolderBrowser(data, dropboxUrl, currentFolderName, folderStack, signal);
      return;
    }

    if (zipContent) {
      zipContent.classList.add("folder-browser-mode");
      zipContent.innerHTML = `
        <div class="dropbox-browser-root" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; gap: 14px;">
          <span style="color: #ffb86c; font-size: 1.3rem; font-weight: bold;">No Media Found</span>
          <span style="color: #ccc; font-size: 0.95rem; max-width: 340px; line-height: 1.4;">No supported images or videos found in this folder.</span>
          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;">
            ${folderStack.length > 0 ? `
              <button id="dropbox-empty-back-btn" class="dropbox-nav-back-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span>Back to ${escapeHtml(folderStack[folderStack.length - 1].name || "Previous")}</span>
              </button>
            ` : ""}
            <a href="${escapeHtml(dropboxUrl)}" target="_blank" rel="noopener noreferrer" class="dropbox-nav-back-btn" style="text-decoration: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Open Link</span>
            </a>
          </div>
        </div>
      `;
      if (folderStack.length > 0) {
        const emptyBackBtn = document.getElementById("dropbox-empty-back-btn");
        if (emptyBackBtn) {
          emptyBackBtn.addEventListener("click", () => {
            const parent = folderStack[folderStack.length - 1];
            openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
          });
        }
      }
    }

  } catch (err) {
    if (signal && signal.aborted) return;
    console.warn("[Dropbox] Gallery Warning:", err.message || err);
    if (zipTitle) zipTitle.textContent = "Dropbox — Error";
    if (zipIndicator) zipIndicator.textContent = "";
    if (zipContent) {
      zipContent.classList.add("folder-browser-mode");
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || "500");
      const isServerError = ["500", "502", "503", "504"].includes(detectedStatus);
      const errorTitle = isServerError ? "Server Error" : "Dropbox Folder Unavailable";
      zipContent.innerHTML = `
        <div class="dropbox-browser-root" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; gap: 12px;">
          <span style="color: #ff5555; font-size: 2.2rem; font-weight: 800; font-family: monospace; letter-spacing: 1px; line-height: 1;">${escapeHtml(detectedStatus)}</span>
          <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">${escapeHtml(errorTitle)}</span>
          <span style="color: #ccc; font-size: 0.95rem; max-width: 340px; line-height: 1.4;">${escapeHtml(err.message || "Unknown error")}</span>
          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; justify-content: center;">
            ${folderStack.length > 0 ? `
              <button id="dropbox-err-back-btn" class="dropbox-nav-back-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span>Back to ${escapeHtml(folderStack[folderStack.length - 1].name || "Previous")}</span>
              </button>
            ` : ""}
            <a href="${escapeHtml(dropboxUrl)}" target="_blank" rel="noopener noreferrer" class="dropbox-nav-back-btn" style="text-decoration: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Open Link</span>
            </a>
          </div>
        </div>
      `;
      if (folderStack.length > 0) {
        const errBackBtn = document.getElementById("dropbox-err-back-btn");
        if (errBackBtn) {
          errBackBtn.addEventListener("click", () => {
            const parent = folderStack[folderStack.length - 1];
            openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
          });
        }
      }
    }
  }
}

/**
 * Renders an interactive Dropbox folder explorer inside zipContent.
 */
function renderDropboxFolderBrowser(data, folderUrl, currentFolderName, folderStack, signal) {
  if (!zipContent) return;

  const existingBackBtn = document.getElementById("dropbox-carousel-back-btn");
  if (existingBackBtn) existingBackBtn.remove();

  if (window.zipMediaObserver) window.zipMediaObserver.disconnect();

  zipContent.classList.add("folder-browser-mode");
  if (zipIndicator) {
    zipIndicator.textContent = "";
    zipIndicator.style.display = "none";
  }
  if (zipTitle) zipTitle.textContent = currentFolderName || "Dropbox";

  const entries = data.entries || [];
  const subfolders = entries.filter((f) => f.is_dir);
  const mediaFiles = entries.filter((f) => !f.is_dir && isImageOrVideo(f.filename));

  subfolders.sort((a, b) => (a.path || a.filename).localeCompare((b.path || b.filename), undefined, { numeric: true, sensitivity: "base" }));
  mediaFiles.sort((a, b) => (a.path || a.filename).localeCompare((b.path || b.filename), undefined, { numeric: true, sensitivity: "base" }));

  const root = document.createElement("div");
  root.className = "dropbox-browser-root";

  const header = document.createElement("div");
  header.className = "dropbox-browser-header";

  const backBtn = document.createElement("button");
  backBtn.className = "dropbox-nav-back-btn";

  if (folderStack.length > 0) {
    const parent = folderStack[folderStack.length - 1];
    backBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      <span>${escapeHtml(parent.name || "Back")}</span>
    `;
    backBtn.addEventListener("click", () => {
      openDropboxGallery(parent.url, parent.name, folderStack.slice(0, -1));
    });
  } else {
    backBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      <span>Close</span>
    `;
    backBtn.addEventListener("click", () => {
      closeZipGallery();
    });
  }
  header.appendChild(backBtn);

  const crumbs = document.createElement("div");
  crumbs.className = "dropbox-breadcrumbs-container";

  folderStack.forEach((item, index) => {
    const crumbLink = document.createElement("span");
    crumbLink.className = "dropbox-breadcrumb-link";
    crumbLink.textContent = item.name || "Folder";
    crumbLink.addEventListener("click", () => {
      openDropboxGallery(item.url, item.name, folderStack.slice(0, index));
    });
    crumbs.appendChild(crumbLink);

    const sep = document.createElement("span");
    sep.style.color = "#6e7681";
    sep.textContent = "/";
    crumbs.appendChild(sep);
  });

  const currentCrumb = document.createElement("span");
  currentCrumb.className = "dropbox-breadcrumb-current";
  currentCrumb.textContent = currentFolderName;
  crumbs.appendChild(currentCrumb);

  header.appendChild(crumbs);
  root.appendChild(header);

  if (subfolders.length > 0) {
    const matrixBtn = document.createElement("button");
    matrixBtn.className = "dropbox-play-all-bar";
    matrixBtn.style.background = "linear-gradient(135deg, rgba(88, 166, 255, 0.25), rgba(188, 140, 255, 0.25))";
    matrixBtn.style.border = "1px solid rgba(88, 166, 255, 0.4)";
    matrixBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      <span>Browse All Folders in 2D Gallery</span>
    `;
    matrixBtn.addEventListener("click", () => {
      openDropboxGallery(folderUrl, currentFolderName, folderStack);
    });
    root.appendChild(matrixBtn);
  }

  if (mediaFiles.length > 0) {
    const playBtn = document.createElement("button");
    playBtn.className = "dropbox-play-all-bar";
    playBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      <span>View Media Files (${mediaFiles.length})</span>
    `;
    playBtn.addEventListener("click", () => {
      const singleGroup = [{
        folderName: currentFolderName,
        folderPath: currentFolderName,
        files: mediaFiles.map((f, fIdx) => ({
          filename: f.filename,
          folder: currentFolderName,
          size: f.bytes || 0,
          link: f.href || f.rawUrl || "",
          loadMedia: (cont, sig) => {
            cont.dataset.fileIdx = String(fIdx);
            loadAndDisplayDropboxItem(cont, f, sig);
          }
        }))
      }];
      render2DMatrixGallery(singleGroup, { galleryTitle: currentFolderName, signal });
    });
    root.appendChild(playBtn);
  }

  if (subfolders.length > 0) {
    const sectionTitle = document.createElement("div");
    sectionTitle.className = "dropbox-section-header";
    sectionTitle.innerHTML = `<span>Folders (${subfolders.length})</span>`;
    root.appendChild(sectionTitle);

    const grid = document.createElement("div");
    grid.className = "dropbox-grid";

    subfolders.forEach((sub) => {
      const card = document.createElement("div");
      card.className = "dropbox-folder-card";
      card.innerHTML = `
        <svg class="dropbox-folder-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <div class="dropbox-card-name" title="${escapeHtml(sub.filename)}">${escapeHtml(sub.filename)}</div>
        <svg class="dropbox-card-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;

      card.addEventListener("click", () => {
        card.style.opacity = "0.6";
        const nextStack = [...folderStack, { name: currentFolderName, url: folderUrl }];
        openDropboxGallery(sub.href, sub.filename, nextStack);
      });

      grid.appendChild(card);
    });

    root.appendChild(grid);
  }

  if (mediaFiles.length > 0) {
    const mediaSectionTitle = document.createElement("div");
    mediaSectionTitle.className = "dropbox-section-header";
    mediaSectionTitle.innerHTML = `<span>Files (${mediaFiles.length})</span>`;
    root.appendChild(mediaSectionTitle);

    const fileList = document.createElement("div");
    fileList.className = "dropbox-files-list";

    mediaFiles.forEach((file, idx) => {
      const row = document.createElement("div");
      row.className = "dropbox-file-row";

      const ext = file.filename.split(".").pop().toLowerCase();
      const isVideo = ["mp4", "webm", "mov"].includes(ext);
      const iconSvg = isVideo
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="17" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

      const sizeText = file.bytes ? formatBytes(file.bytes) : "";

      row.innerHTML = `
        <span style="flex-shrink:0;">${iconSvg}</span>
        <span class="dropbox-card-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</span>
        ${sizeText ? `<span style="color:#8b949e;font-size:0.85rem;margin-left:auto;padding-left:10px;white-space:nowrap;">${sizeText}</span>` : ""}
      `;

      row.addEventListener("click", () => {
        const singleGroup = [{
          folderName: currentFolderName,
          folderPath: currentFolderName,
          files: mediaFiles.map((f, fIdx) => ({
            filename: f.filename,
            folder: currentFolderName,
            size: f.bytes || 0,
            link: f.href || f.rawUrl || "",
            loadMedia: (cont, sig) => {
              cont.dataset.fileIdx = String(fIdx);
              loadAndDisplayDropboxItem(cont, f, sig);
            }
          }))
        }];
        render2DMatrixGallery(singleGroup, { galleryTitle: currentFolderName, signal });
        const rowEl = zipContent?.querySelector(".zip-folder-row");
        if (rowEl && idx > 0) {
          const itemWidth = rowEl.clientWidth || window.innerWidth;
          rowEl.scrollLeft = idx * itemWidth;
        }
      });

      fileList.appendChild(row);
    });

    root.appendChild(fileList);
  }

  zipContent.innerHTML = "";
  zipContent.appendChild(root);
}

const DROPBOX_MEDIA_CONCURRENCY = 3;
let activeDropboxMediaLoads = 0;
const dropboxMediaQueue = [];

export function clearDropboxMediaQueue() {
  dropboxMediaQueue.forEach((item) => {
    try { item.resolve(); } catch (_) {}
  });
  dropboxMediaQueue.length = 0;
  activeDropboxMediaLoads = 0;
}

export function cancelDropboxQueuedTask(container) {
  if (!container) return;
  const fileIdx = container.dataset.fileIdx;
  const folder = container.dataset.folder || "";
  for (let i = 0; i < dropboxMediaQueue.length; i++) {
    const c = dropboxMediaQueue[i].container;
    if (c === container || (c && fileIdx && c.dataset.fileIdx === fileIdx && (c.dataset.folder || "") === folder)) {
      const task = dropboxMediaQueue.splice(i, 1)[0];
      try { task.resolve(); } catch (_) {}
      i--;
    }
  }
}

function queueDropboxMediaLoad(container, taskFn) {
  return new Promise((resolve, reject) => {
    const fileIdx = container?.dataset?.fileIdx;
    const folder = container?.dataset?.folder || "";
    const existingIdx = dropboxMediaQueue.findIndex((t) => {
      const c = t.container;
      return c === container || (c && fileIdx && c.dataset.fileIdx === fileIdx && (c.dataset.folder || "") === folder);
    });
    if (existingIdx !== -1) {
      const old = dropboxMediaQueue.splice(existingIdx, 1)[0];
      try { old.resolve(); } catch (_) {}
    }

    const active = typeof getActiveMediaItem === "function" ? getActiveMediaItem() : null;
    const isActive = active && (active.item === container || (
      active.item?.dataset?.fileIdx === container?.dataset?.fileIdx &&
      (active.item?.dataset?.folder || "") === (container?.dataset?.folder || "")
    ));

    if (isActive) {
      dropboxMediaQueue.unshift({ container, taskFn, resolve, reject });
    } else {
      dropboxMediaQueue.push({ container, taskFn, resolve, reject });
    }
    processDropboxMediaQueue();
  });
}

function processDropboxMediaQueue() {
  while (activeDropboxMediaLoads < DROPBOX_MEDIA_CONCURRENCY && dropboxMediaQueue.length > 0) {
    const active = typeof getActiveMediaItem === "function" ? getActiveMediaItem() : null;
    let bestIndex = 0;

    if (active && active.item) {
      const activeFileIdx = parseInt(active.item.dataset.fileIdx || "0", 10) || 0;
      const activeFolder = active.item.dataset.folder || "";
      let minDistance = Infinity;

      for (let i = 0; i < dropboxMediaQueue.length; i++) {
        const item = dropboxMediaQueue[i].container;
        if (!item || !item.isConnected) {
          dropboxMediaQueue.splice(i, 1)[0].resolve();
          i--;
          continue;
        }
        if (item.dataset.loaded === "true") {
          dropboxMediaQueue.splice(i, 1)[0].resolve();
          i--;
          continue;
        }

        const itemFileIdx = parseInt(item.dataset.fileIdx || "0", 10) || 0;
        const itemFolder = item.dataset.folder || "";
        const sameFolder = itemFolder === activeFolder;

        let dist = sameFolder ? Math.abs(itemFileIdx - activeFileIdx) : 1000 + Math.abs(itemFileIdx);
        if (item === active.item || (sameFolder && itemFileIdx === activeFileIdx)) {
          dist = -1;
        }

        if (dist < minDistance) {
          minDistance = dist;
          bestIndex = i;
          if (dist === -1) break;
        }
      }
    }

    if (dropboxMediaQueue.length === 0) break;
    const nextTask = dropboxMediaQueue.splice(bestIndex, 1)[0];
    if (!nextTask) break;

    activeDropboxMediaLoads++;
    Promise.resolve()
      .then(() => nextTask.taskFn())
      .then(
        (val) => {
          activeDropboxMediaLoads--;
          nextTask.resolve(val);
          processDropboxMediaQueue();
        },
        (err) => {
          activeDropboxMediaLoads--;
          nextTask.reject(err);
          processDropboxMediaQueue();
        }
      );
  }
}

function markDropboxItemFailed(allMatchingContainers, file, streamUrl, targetUrl, type, initialStatus, signal, retryAction) {
  allMatchingContainers.forEach((target) => {
    delete target.dataset.loading;
    target.dataset.failed = "true";
    delete target.dataset.loaded;
    cleanupContainerMedia(target);

    const overlay = target.querySelector(".media-progress");
    if (overlay) {
      overlay.style.display = "flex";
      showMediaUnavailableWarning(overlay, {
        type,
        filename: file.filename,
        errorStatus: initialStatus || "404",
        message: initialStatus === "429" ? "Too Many Requests (Rate Limited)" : (initialStatus === "503" ? "Service Unavailable" : "Media Unavailable"),
        externalUrl: targetUrl,
        onRetry: retryAction
      });
    }
  });

  // Non-blocking background HEAD probe to refine error status (e.g. 429 vs 404)
  if (streamUrl) {
    fetch(streamUrl, { method: "HEAD", signal })
      .then((probeRes) => {
        if (!probeRes.ok) {
          const refinedStatus = String(probeRes.status);
          const refinedMsg = refinedStatus === "429"
            ? "Too Many Requests (Rate Limited)"
            : (refinedStatus === "404" ? "File Not Found" : `Server Error (HTTP ${refinedStatus})`);

          allMatchingContainers.forEach((target) => {
            if (target.dataset.failed === "true") {
              const overlay = target.querySelector(".media-progress");
              if (overlay) {
                showMediaUnavailableWarning(overlay, {
                  type,
                  filename: file.filename,
                  errorStatus: refinedStatus,
                  message: refinedMsg,
                  externalUrl: targetUrl,
                  onRetry: retryAction
                });
              }
            }
          });
        }
      })
      .catch(() => {});
  }
}

/**
 * Loads an individual media item (streaming video or lazy loading image) into its slide.
 */
function loadAndDisplayDropboxItem(container, file, signal) {
  if (!file) return;

  if (container.dataset.loaded === "true") return;
  if (container.dataset.loading === "true") return;
  if (container.dataset.failed === "true") return;

  const fileIdxStr = container.dataset.fileIdx;
  const parentRow = container.closest(".zip-folder-row");
  const allMatchingContainers = parentRow
    ? Array.from(parentRow.querySelectorAll(`[data-file-idx="${fileIdxStr}"]`))
    : (zipContent ? Array.from(zipContent.querySelectorAll(`[data-file-idx="${fileIdxStr}"]`)) : [container]);

  const alreadyLoadedContainer = allMatchingContainers.find((c) => c.dataset.loaded === "true");
  if (alreadyLoadedContainer) {
    container.dataset.loaded = "true";
    delete container.dataset.loading;
    delete container.dataset.failed;
    const existingMedia = alreadyLoadedContainer.querySelector("img, video, canvas");
    if (existingMedia) {
      cleanupContainerMedia(container);
      if (container.dataset.isClone === "true" && (existingMedia.tagName.toLowerCase() === "video" || existingMedia.tagName.toLowerCase() === "canvas")) {
        const placeholder = document.createElement("div");
        placeholder.className = "post-media";
        placeholder.style.cssText = "display: flex; align-items: center; justify-content: center; background: #000; width: 100%; height: 100%;";
        placeholder.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="rgba(255,255,255,0.35)"><path d="M8 5v14l11-7z"/></svg>';
        container.appendChild(placeholder);
      } else if (existingMedia.tagName.toLowerCase() === "img") {
        container.appendChild(existingMedia.cloneNode(true));
      }
    }
    const o = container.querySelector(".media-progress");
    if (o) o.style.display = "none";
    return;
  }

  let targetUrl = file.rawUrl || file.href || "";
  if (targetUrl) {
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://www.dropbox.com${targetUrl.startsWith("/") ? "" : "/"}${targetUrl}`;
    }
    try {
      const u = new URL(targetUrl);
      u.searchParams.set("raw", "1");
      u.searchParams.delete("dl");
      targetUrl = u.toString();
    } catch (_) {}
  }
  const streamUrl = `${PROXY_URL}/dropbox?url=${encodeURIComponent(targetUrl)}`;

  const ext = file.filename.split(".").pop().toLowerCase();
  const isVideo = ["mp4", "webm", "mov"].includes(ext);
  const isGif = ext === "gif";
  const mediaType = isVideo ? "video" : (isGif ? "image" : "image");

  const retryAction = () => {
    allMatchingContainers.forEach((t) => {
      cleanupContainerMedia(t);
      delete t.dataset.loading;
      delete t.dataset.loaded;
      delete t.dataset.failed;
    });
    loadAndDisplayDropboxItem(container, file, signal);
  };

  const alreadyFailedContainer = allMatchingContainers.find((c) => c.dataset.failed === "true");
  if (alreadyFailedContainer) {
    container.dataset.failed = "true";
    delete container.dataset.loading;
    const overlay = container.querySelector(".media-progress");
    if (overlay) {
      overlay.style.display = "flex";
      showMediaUnavailableWarning(overlay, {
        type: mediaType,
        filename: file.filename,
        errorStatus: "404",
        message: "Media Unavailable",
        externalUrl: targetUrl,
        onRetry: retryAction
      });
    }
    return;
  }

  allMatchingContainers.forEach((c) => {
    c.dataset.loading = "true";
    delete c.dataset.loaded;
    delete c.dataset.failed;
    const overlay = c.querySelector(".media-progress");
    if (overlay) {
      overlay.style.display = "flex";
      const displayName = file.path || file.filename;
      const totalSize = file.bytes || file.size || (c.dataset.size ? parseInt(c.dataset.size, 10) : 0);
      const totalStr = totalSize > 0 ? formatBytes(totalSize) : "";
      renderMediaProgress(overlay, "Loading...", null, displayName, "", totalStr);
    }
  });

  queueDropboxMediaLoad(container, () => {
    return new Promise((resolve) => {
      if (container.dataset.loaded === "true" || (signal && signal.aborted)) {
        return resolve();
      }

      let timeoutId = setTimeout(() => {
        resolve();
      }, 20000);

      const done = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve();
      };

      if (isVideo) {
        allMatchingContainers.forEach((c) => {
          cleanupContainerMedia(c);
          if (c.dataset.isClone === "true") {
            const placeholder = document.createElement("div");
            placeholder.className = "post-media";
            placeholder.style.cssText = "display: flex; align-items: center; justify-content: center; background: #000; width: 100%; height: 100%;";
            placeholder.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="rgba(255,255,255,0.35)"><path d="M8 5v14l11-7z"/></svg>';
            c.appendChild(placeholder);
            return;
          }

          const video = document.createElement("video");
          video.playsInline = true;
          video.setAttribute("playsinline", "");
          video.setAttribute("webkit-playsinline", "");
          video.loop = true;
          video.muted = true;
          video.style.maxWidth = "100%";
          video.style.maxHeight = "100%";
          video.style.objectFit = "contain";
          video.preload = "metadata";
          c.appendChild(video);
          attachCustomVideoPlayer(video, c);

          const onReady = () => {
            allMatchingContainers.forEach((target) => {
              markMediaLoaded(target, file.filename, totalStr);
            });
            done();
          };

          video.addEventListener("canplay", onReady, { once: true });
          video.addEventListener("loadedmetadata", onReady, { once: true });

          video.onerror = () => {
            markDropboxItemFailed(allMatchingContainers, file, streamUrl, targetUrl, "video", "500", signal, retryAction);
            done();
          };

          video.src = streamUrl;
        });
      } else if (isGif) {
        let loadedOrFailed = false;
        allMatchingContainers.forEach((c) => {
          cleanupContainerMedia(c);
          if (c.dataset.isClone === "true") {
            const placeholder = document.createElement("div");
            placeholder.className = "post-media";
            placeholder.style.cssText = "display: flex; align-items: center; justify-content: center; background: #000; width: 100%; height: 100%;";
            placeholder.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="rgba(255,255,255,0.35)"><path d="M8 5v14l11-7z"/></svg>';
            c.appendChild(placeholder);
            markMediaLoaded(c, file.filename, totalStr);
            return;
          }

          const overlay = c.querySelector(".media-progress");
          loadGifPlayer({
            item: c,
            url: streamUrl,
            filename: file.filename,
            progressOverlay: overlay,
            onRetry: retryAction,
            playbackObserver,
            signal,
          }).then(() => {
            if (!loadedOrFailed) {
              loadedOrFailed = true;
              allMatchingContainers.forEach((target) => {
                markMediaLoaded(target, file.filename, totalStr);
              });
              done();
            }
          }).catch((err) => {
            if (!loadedOrFailed) {
              loadedOrFailed = true;
              console.warn(`[Dropbox] Failed to load GIF ${file.filename}:`, err);
              markDropboxItemFailed(allMatchingContainers, file, streamUrl, targetUrl, "image", "404", signal, retryAction);
              done();
            }
          });
        });
      } else {
        const totalSize = file.bytes || file.size || (container.dataset.size ? parseInt(container.dataset.size, 10) : 0);
        const displayName = file.path || file.filename;

        fetch(streamUrl, { signal })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const cl = parseInt(res.headers.get("content-length") || "0", 10);
            const knownTotal = cl > 0 ? cl : totalSize;
            const totalStr = knownTotal > 0 ? formatBytes(knownTotal) : "";

            const reader = res.body?.getReader();
            if (!reader) {
              const blob = await res.blob();
              return blob;
            }

            const chunks = [];
            let loaded = 0;
            let lastUpdate = 0;

            while (true) {
              if (signal && signal.aborted) throw new Error("Aborted");
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              loaded += value.length;

              const now = Date.now();
              if (now - lastUpdate > 150) {
                lastUpdate = now;
                const pct = knownTotal > 0 ? Math.min(100, Math.round((loaded / knownTotal) * 100)) : null;
                const loadedStr = formatBytes(loaded);
                allMatchingContainers.forEach((c) => {
                  const o = c.querySelector(".media-progress");
                  if (o) renderMediaProgress(o, "Loading...", pct, displayName, loadedStr, totalStr);
                });
              }
            }

            return new Blob(chunks, { type: res.headers.get("content-type") || "image/jpeg" });
          })
          .then((blob) => {
            if (signal && signal.aborted) {
              done();
              return;
            }
            const blobUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.className = "post-media";
            img.style.maxWidth = "100%";
            img.style.maxHeight = "100%";
            img.style.objectFit = "contain";
            img.decoding = "async";

            img.onload = () => {
              allMatchingContainers.forEach((target) => {
                cleanupContainerMedia(target);
                target.appendChild(img.cloneNode(true));
                markMediaLoaded(target, displayName, totalStr);
              });
              done();
            };
            img.onerror = () => {
              markDropboxItemFailed(allMatchingContainers, file, streamUrl, targetUrl, "image", "404", signal, retryAction);
              done();
            };
            img.src = blobUrl;
          })
          .catch((err) => {
            if (signal && signal.aborted) {
              done();
              return;
            }
            console.warn(`[Dropbox] Image fetch failed for ${displayName}:`, err);
            markDropboxItemFailed(allMatchingContainers, file, streamUrl, targetUrl, "image", "404", signal, retryAction);
            done();
          });
      }
    });
  });
}