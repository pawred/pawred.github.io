import { PROXY_URL, state } from "./state.js";
import {
  formatBytes,
  getServiceColor,
  getMediaUrl,
  showMediaUnavailableWarning,
  renderMediaProgress,
  startProgress,
  stopProgress,
  getServiceCreatorUrl,
  getServicePostUrl,
} from "./utils.js";
import { updateNavTabs, updateNavVisibility, closeAllPostInfo, wrapCarousel } from "./nav.js";
import { openZipGallery } from "./zip.js";
import { detectExternalGalleries, renderExternalFileCard, isDropboxFolderUrl, escapeHtml } from "./externalGalleries.js";
import { attachCustomVideoPlayer } from "./player.js";
import { loadGifPlayer } from "./gifPlayer.js";

export const feed = document.getElementById("feed");
export const feedLoading = document.getElementById("feed-loading");

export const playbackObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const el = entry.target;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      const isGif = el.dataset?.isGif === "true";
      if (tag === "video" || tag === "audio" || isGif) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.25) {
          el.pause();
        } else if (isGif && entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!el._userPaused && el.paused) {
            el.play().catch(() => {});
          }
        }
      }
    });
  },
  { threshold: [0, 0.25, 0.5] }
);

const flagObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      const card = entry.target;
      const { site, service, user, id } = card.dataset;
      observer.unobserve(card);
      if (site !== "pawchive" || !service || !user || !id || id.includes("-dm-")) return;
      fetch(`${PROXY_URL}/${site}/api/v1/${service}/user/${user}/post/${id}/flag`)
        .then((res) => res.json())
        .then((data) => {
          if (data.flagged) {
            const titleArea = card.querySelector(".post-title");
            const badge = document.createElement("span");
            badge.style.cssText = `
              display: inline-flex; align-items: center; gap: 6px; 
              background: rgba(255, 60, 60, 0.15); color: #ff5555; 
              padding: 2px 8px; border-radius: 8px; font-size: 0.8rem; 
              font-weight: bold; border: 1px solid rgba(255, 60, 60, 0.3); 
              flex-shrink: 0; width: fit-content;
            `;
            badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Not Yet Imported`;
            if (titleArea) {
              titleArea.appendChild(badge);
            } else {
              card.appendChild(badge);
            }
          }
        })
        .catch(() => {});
    }
  });
}, { rootMargin: "150px" });

export function syncCarouselClones(item) {
  if (!item || !item.parentElement) return;
  const carousel = item.parentElement;
  if (!carousel.classList.contains("media-carousel")) return;
  if (item.dataset.isClone === "true") return;

  const children = Array.from(carousel.children);
  if (children.length <= 2) return;

  const cloneLast = children[0];
  const cloneFirst = children[children.length - 1];
  if (cloneLast?.dataset?.isClone !== "true" || cloneFirst?.dataset?.isClone !== "true") return;

  const firstOriginal = children[1];
  const lastOriginal = children[children.length - 2];

  let targetClone = null;
  if (item === firstOriginal) {
    targetClone = cloneFirst;
  } else if (item === lastOriginal) {
    targetClone = cloneLast;
  }

  if (!targetClone) return;

  const cloneProgress = targetClone.querySelector(".media-progress");
  const oldClones = Array.from(targetClone.children).filter((c) => c !== cloneProgress);
  oldClones.forEach((c) => c.remove());

  const img = item.querySelector("img.post-media");
  const video = item.querySelector("video.post-media, audio.post-media");
  const gifCanvas = item.querySelector("canvas.post-media[data-is-gif]");
  const archiveCard = item.querySelector(".ext-archive-card");

  if (img) {
    const cloneImg = img.cloneNode(true);
    targetClone.appendChild(cloneImg);
    if (cloneProgress) cloneProgress.style.display = "none";
    targetClone.dataset.loaded = "true";
  } else if (video || gifCanvas) {
    const path = item.dataset.path;
    const isImagePath = path && /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
    if (isImagePath && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
      const cloneImg = document.createElement("img");
      cloneImg.className = "post-media";
      cloneImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${path}`;
      targetClone.appendChild(cloneImg);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "post-media";
      placeholder.style.cssText = "display: flex; align-items: center; justify-content: center; background: #000;";
      placeholder.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="rgba(255,255,255,0.35)"><path d="M8 5v14l11-7z"/></svg>';
      targetClone.appendChild(placeholder);
    }
    if (cloneProgress) cloneProgress.style.display = "none";
    targetClone.dataset.loaded = "true";
  } else if (archiveCard) {
    if (targetClone.dataset.loaded === "true" && targetClone.querySelector(".ext-archive-card")) return;
    const cloneCard = archiveCard.cloneNode(true);
    const viewBtn = cloneCard.querySelector(".zip-action-btn");
    const origViewBtn = archiveCard.querySelector(".zip-action-btn");
    if (viewBtn && origViewBtn && origViewBtn._onGalleryClick) {
      viewBtn.addEventListener("click", origViewBtn._onGalleryClick);
    }
    const extLink = cloneCard.querySelector("a.zip-action-btn");
    if (extLink) {
      extLink.addEventListener("click", (e) => e.stopPropagation());
    }
    targetClone.appendChild(cloneCard);
    if (cloneProgress) cloneProgress.style.display = "none";
    targetClone.dataset.loaded = "true";
  }
}

export const mediaObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const item = entry.target;
        if (item.dataset.isClone === "true") {
          const carousel = item.parentElement;
          if (carousel) {
            const children = Array.from(carousel.children);
            if (children.length > 2) {
              const firstOriginal = children[1];
              const lastOriginal = children[children.length - 2];
              const source = item === children[0] ? lastOriginal : firstOriginal;
              if (source && source.dataset.loaded === "true") {
                syncCarouselClones(source);
              }
            }
          }
          return;
        }

        if (!item.dataset.loaded) {
          item.dataset.loaded = "true";
          loadMediaWithProgress(item);
        }

        const carousel = item.closest(".media-carousel");
        if (carousel) {
          const count = parseInt(carousel.dataset.mediaCount || "0", 10);
          if (count > 1 && carousel.scrollLeft === 0) {
            const { firstOffset } = getCarouselMetrics(carousel);
            carousel.scrollLeft = firstOffset;
            carousel._restingScrollLeft = firstOffset;
          }
          preloadUpcomingMedia(carousel);
        }
      }
    });
  },
  { rootMargin: "100px" }
);

export function preloadUpcomingMedia(carousel) {
  const preloadCount = window.pawPreloadCount || 0;
  if (preloadCount <= 0) return;
  const count = parseInt(carousel.dataset.mediaCount || "0", 10);
  if (count <= 1) return;

  const { firstOffset, step } = getCarouselMetrics(carousel);
  if (!step) return;

  const rawIndex = Math.round((carousel.scrollLeft - firstOffset) / step) + 1;
  for (let i = 1; i <= preloadCount; i++) {
    let targetIndex = rawIndex + i;
    if (targetIndex >= carousel.children.length) {
      targetIndex = 1 + ((targetIndex - carousel.children.length) % count);
    }
    const item = carousel.children[targetIndex];
    if (item && !item.dataset.loaded) {
      if (
        item.dataset.isClone === "true" ||
        item.dataset.type === "video" ||
        item.dataset.type === "audio" ||
        item.dataset.type === "mega" ||
        item.dataset.type === "dropbox" ||
        item.dataset.type === "zip" ||
        item.dataset.type === "gif"
      ) {
        continue;
      }
      item.dataset.loaded = "true";
      setTimeout(() => loadMediaWithProgress(item), (i - 1) * 120);
    }
  }
}

export const feedObserver = new IntersectionObserver(
  (entries) => {
    const lastEntry = entries[entries.length - 1];
    if (lastEntry.isIntersecting && !state.isFetching && state.hasMore) {
      fetchPosts();
    }
  },
  { root: feed, rootMargin: "0px", threshold: 0.1 }
);

export function detachMedia(item, force = false) {
  if (!item || (!force && !item.dataset.loaded)) return;

  if (item._upgradeTimer) {
    clearTimeout(item._upgradeTimer);
    item._upgradeTimer = null;
  }
  if (item._fullImg) {
    item._fullImg.onload = null;
    item._fullImg.onerror = null;
    item._fullImg.src = "";
    item._fullImg = null;
  }
  if (item._abortController) {
    try {
      item._abortController.abort();
    } catch (_) {}
    item._abortController = null;
  }
  if (item._resetDownload) {
    try {
      item._resetDownload();
    } catch (_) {}
    item._resetDownload = null;
  }
  if (item._cleanupGif) {
    try {
      item._cleanupGif();
    } catch (_) {}
    item._cleanupGif = null;
  }
  if (item._blobUrl) {
    URL.revokeObjectURL(item._blobUrl);
    item._blobUrl = null;
  }
  if (item._videoTimeout) {
    clearTimeout(item._videoTimeout);
    item._videoTimeout = null;
  }

  const mediaEls = item.querySelectorAll("video, audio, img.post-media, canvas.post-media, .ext-archive-card, .video-player-wrapper");
  mediaEls.forEach((el) => {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "video" || tag === "audio" || el.dataset?.isGif === "true") {
      playbackObserver.unobserve(el);
      if (typeof el.pause === "function") el.pause();
      if (typeof el._cleanupCustomPlayer === "function") {
        try { el._cleanupCustomPlayer(); } catch (_) {}
        el._cleanupCustomPlayer = null;
      }
      if (tag !== "canvas") {
        el.removeAttribute("src");
        while (el.firstChild) el.removeChild(el.firstChild);
        if (typeof el.load === "function") el.load();
      }
    } else if (tag === "img") {
      el.src = "";
    }
    el.remove();
  });

  const progressOverlay = item.querySelector(".media-progress");
  if (progressOverlay) {
    progressOverlay.style.display = "flex";
    const filename = item.dataset.originalName || (item.dataset.path || "").split("/").pop() || "media";
    renderMediaProgress(progressOverlay, "Loading...", null, filename, "", "");
  }

  delete item.dataset.loaded;
}

export function recycleOffscreenCards() {
  if (!feed) return;
  const cards = feed.querySelectorAll(".post-card");
  if (cards.length === 0) return;

  const h = (feed && feed.clientHeight) || window.innerHeight || 1;
  const currentCardIndex = Math.round(feed.scrollTop / h);
  const KEEP_WINDOW_IMG = 5;
  const KEEP_WINDOW_VIDEO = 2;

  cards.forEach((card, idx) => {
    const isOutOfImgWindow = idx < currentCardIndex - KEEP_WINDOW_IMG || idx > currentCardIndex + KEEP_WINDOW_IMG;
    const isOutOfVideoWindow = idx < currentCardIndex - KEEP_WINDOW_VIDEO || idx > currentCardIndex + KEEP_WINDOW_VIDEO;

    if (isOutOfImgWindow) {
      const items = card.querySelectorAll(".media-item");
      items.forEach((item) => detachMedia(item));
    } else if (isOutOfVideoWindow) {
      const videoEls = card.querySelectorAll(
        '.media-item[data-type="video"], .media-item[data-type="audio"], .media-item[data-type="gif"], .media-item video, .media-item audio, .media-item canvas[data-is-gif]'
      );
      videoEls.forEach((el) => {
        const item = el.classList.contains("media-item") ? el : el.closest(".media-item");
        if (item) detachMedia(item);
      });
    }
  });
}

export function resetFeed() {
  if (!feed) return;
  const items = feed.querySelectorAll(".media-item");
  items.forEach((item) => detachMedia(item));
  feed.innerHTML = "";
  state.offset = 0;
  state.hasMore = true;
  state.isFetching = false;
  feedObserver.disconnect();
  mediaObserver.disconnect();
  flagObserver.disconnect();
  playbackObserver.disconnect();
}

export async function loadMediaWithProgress(item) {
  if (item.dataset.isClone === "true") {
    const carousel = item.parentElement;
    if (carousel) {
      const children = Array.from(carousel.children);
      if (children.length > 2) {
        const firstOriginal = children[1];
        const lastOriginal = children[children.length - 2];
        const source = item === children[0] ? lastOriginal : firstOriginal;
        if (source && source.dataset.loaded === "true") {
          syncCarouselClones(source);
        }
      }
    }
    return;
  }

  const url = item.dataset.url;
  const type = item.dataset.type;
  const progressOverlay = item.querySelector(".media-progress");
  const filename = item.dataset.originalName || (item.dataset.path || url).split("/").pop() || "media";

  const triggerRetry = () => {
    detachMedia(item, true);
    item.dataset.loaded = "true";
    loadMediaWithProgress(item);
  };

  if (!url || item.dataset.isUnimported === "true" || url.includes("/unimported.")) {
    if (item.dataset.isUnimported === "true" || (url && url.includes("/unimported."))) {
      showMediaUnavailableWarning(progressOverlay, { type, filename, errorStatus: "404", onRetry: triggerRetry });
    } else if (progressOverlay) {
      progressOverlay.textContent = "No Media";
    }
    return;
  }

  if (type === "mega" || type === "dropbox") {
    if (progressOverlay) progressOverlay.style.display = "none";
    renderExternalFileCard(item, type);
    return;
  }

  if (type === "zip") {
    if (progressOverlay) progressOverlay.style.display = "none";
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.background = "#000";
    container.style.padding = "20px";
    container.style.boxSizing = "border-box";

    const zipFilename = item.dataset.originalName || (item.dataset.path || url).split("/").pop() || "Archive.zip";

    const infoText = document.createElement("div");
    infoText.className = "zip-info-text";
    infoText.style.color = "#fff";
    infoText.style.fontFamily = "monospace";
    infoText.style.background = "rgba(0,0,0,0.5)";
    infoText.style.padding = "15px";
    infoText.style.borderRadius = "10px";
    infoText.style.marginBottom = "20px";
    infoText.style.width = "fit-content";
    infoText.style.maxWidth = "100%";
    infoText.style.overflowX = "auto";
    infoText.style.overflowY = "auto";
    infoText.style.maxHeight = "40%";
    infoText.style.fontSize = "0.9rem";
    infoText.style.textAlign = "left";
    infoText.style.boxSizing = "border-box";
    infoText.addEventListener("click", (e) => e.stopPropagation());
    infoText.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    infoText.innerHTML = `<div class="zip-info-header" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;position:sticky;left:0;width:100%;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"></path></svg> <span>${escapeHtml(zipFilename)}</span></div><div style="text-align:center;color:#aaa;margin-top:6px;">Scanning contents...</div>`;
    container.appendChild(infoText);

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "10px";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.justifyContent = "center";

    const btnDownload = document.createElement("button");
    btnDownload.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download';
    btnDownload.className = "zip-action-btn";

    const btnPause = document.createElement("button");
    btnPause.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause';
    btnPause.className = "zip-action-btn";
    btnPause.style.display = "none";

    const btnAbort = document.createElement("button");
    btnAbort.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg> Abort';
    btnAbort.className = "zip-action-btn";
    btnAbort.style.display = "none";

    const btnSave = document.createElement("button");
    btnSave.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save to Device';
    btnSave.className = "zip-action-btn";
    btnSave.style.display = "none";

    const btnView = document.createElement("button");
    btnView.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> View Gallery';
    btnView.className = "zip-action-btn";
    btnView.style.display = "none";

    btnRow.appendChild(btnDownload);
    btnRow.appendChild(btnPause);
    btnRow.appendChild(btnAbort);
    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnView);
    container.appendChild(btnRow);

    const progressContainer = document.createElement("div");
    progressContainer.style.width = "80%";
    progressContainer.style.marginTop = "15px";
    progressContainer.style.display = "none";

    const progressText = document.createElement("div");
    progressText.style.color = "#fff";
    progressText.style.fontSize = "0.8rem";
    progressText.style.marginBottom = "5px";
    progressText.style.textAlign = "center";
    progressContainer.appendChild(progressText);

    const progressBar = document.createElement("div");
    progressBar.style.width = "100%";
    progressBar.style.height = "10px";
    progressBar.style.background = "#444";
    progressBar.style.borderRadius = "5px";

    const progressFill = document.createElement("div");
    progressFill.style.width = "0%";
    progressFill.style.height = "100%";
    progressFill.style.background = "#00AEEF";
    progressFill.style.borderRadius = "5px";
    progressFill.style.transition = "width 0.1s linear";
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);
    container.appendChild(progressContainer);
    item.appendChild(container);

    let isPaused = false;
    let abortController = null;
    let activeReader = null;
    let zipBlob = null;
    let totalSize = 0;
    let filenames = [];
    let sizeStr = "";
    let downloadChunks = [];
    let downloadedBytes = 0;

    function resetDownloadState() {
      if (activeReader) {
        try { activeReader.cancel("Aborted"); } catch (_) {}
        activeReader = null;
      }
      if (abortController) {
        try { abortController.abort(); } catch (_) {}
        abortController = null;
      }
      isPaused = false;
      downloadChunks = [];
      downloadedBytes = 0;
      zipBlob = null;
      progressFill.style.width = "0%";
      progressText.textContent = "";
      progressContainer.style.display = "none";
      btnDownload.style.display = "inline-block";
      btnPause.style.display = "none";
      btnPause.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause`;
      btnAbort.style.display = "none";
      btnSave.style.display = "none";
      btnView.style.display = "none";
    }

    item._resetDownload = resetDownloadState;

    function renderTree() {
      const headerInfo = sizeStr ? `${sizeStr}, ${filenames.length} files` : `${filenames.length} files`;
      let treeLines = "";
      if (filenames.length > 0) {
        for (let i = 0; i < filenames.length; i++) {
          const isLast = i === filenames.length - 1;
          const connector = isLast ? "└─ " : "├─ ";
          treeLines += `${connector}${filenames[i]}\n`;
        }
      } else {
        treeLines += "  (Empty or unreadable archive)\n";
      }
      const fullTree = `${zipFilename}\n${treeLines.trimEnd()}`;
      infoText.innerHTML = `<div class="zip-info-header" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;position:sticky;left:0;width:100%;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"></path></svg> <span>${headerInfo}</span></div><div class="zip-info-tree" style="white-space:pre;font-family:monospace;margin:0;padding:0;line-height:1.35;">${escapeHtml(fullTree)}</div>`;
    }

    async function scanZip() {
      try {
        if (!window.unzipit) throw new Error("unzipit not loaded");
        let entries = null;
        if (typeof window.unzipit.HTTPRangeReader === "function") {
          try {
            const rangeReader = new window.unzipit.HTTPRangeReader(url);
            const res = await window.unzipit.unzip(rangeReader);
            entries = res.entries;
          } catch (rangeErr) {
            console.warn("unzipit HTTPRangeReader failed, range requests might not be supported", rangeErr);
          }
        }
        if (!sizeStr) {
          try {
            const headRes = await fetch(url, { method: "HEAD" });
            if (headRes.ok) {
              const cl = headRes.headers.get("content-length");
              if (cl) sizeStr = formatBytes(parseInt(cl, 10));
            }
          } catch (_) {}
        }
        if (entries) {
          if (!sizeStr) {
            const compressedTotal = Object.values(entries).reduce((sum, e) => sum + (e.compressedSize || e.size || 0), 0);
            if (compressedTotal > 0) sizeStr = formatBytes(compressedTotal);
          }
          filenames = Object.keys(entries)
            .filter((p) => !p.endsWith("/") && !p.startsWith("__MACOSX/"))
            .map((p) => p.split("/").pop());
          filenames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
          renderTree();
        } else {
          infoText.innerHTML = `<div class="zip-info-header" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;position:sticky;left:0;width:100%;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"></path></svg> <span>${escapeHtml(sizeStr ? sizeStr + " Archive" : zipFilename)}</span></div><div style="text-align:center;color:#aaa;margin-top:6px;">(Click Download to fetch and view files)</div>`;
        }
        if (window.pawAutoDownloadZip) {
          startDownload();
        }
      } catch (err) {
        console.warn("scanZip error", err);
        infoText.innerHTML = `<div class="zip-info-header" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:8px;position:sticky;left:0;width:100%;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"></path></svg> <span>${escapeHtml(zipFilename)}</span></div><div style="text-align:center;color:#aaa;margin-top:6px;">(Click Download to fetch)</div>`;
        if (window.pawAutoDownloadZip) {
          startDownload();
        }
      }
    }

    async function startDownload() {
      resetDownloadState();
      btnDownload.style.display = "none";
      btnPause.style.display = "inline-block";
      btnAbort.style.display = "inline-block";
      btnSave.style.display = "none";
      btnView.style.display = "none";
      progressContainer.style.display = "block";
      progressFill.style.width = "0%";
      progressText.textContent = "Starting download...";
      isPaused = false;
      btnPause.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause`;
      abortController = new AbortController();
      const signal = abortController.signal;
      downloadChunks = [];
      downloadedBytes = 0;
      const startTime = Date.now();

      try {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`Network error: ${response.status}`);
        totalSize = parseInt(response.headers.get("content-length") || "0", 10);
        if (totalSize > 0 && !sizeStr) {
          sizeStr = formatBytes(totalSize);
          renderTree();
        }
        activeReader = response.body.getReader();
        while (true) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (isPaused) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            continue;
          }
          const { done, value } = await activeReader.read();
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (done) break;
          downloadChunks.push(value);
          downloadedBytes += value.length;
          if (totalSize) {
            progressFill.style.width = Math.min(100, (downloadedBytes / totalSize) * 100) + "%";
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;
            const remaining = speed > 0 ? (totalSize - downloadedBytes) / speed : 0;
            progressText.textContent = `${formatBytes(downloadedBytes)} / ${formatBytes(totalSize)} - ${formatBytes(speed)}/s - ${Math.round(remaining)}s left`;
          } else {
            progressText.textContent = `${formatBytes(downloadedBytes)} downloaded`;
          }
        }
        activeReader = null;
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (totalSize > 0 && downloadedBytes < totalSize) {
          throw new Error(`Incomplete download: received ${downloadedBytes} of ${totalSize} bytes`);
        }
        zipBlob = new Blob(downloadChunks);
        downloadChunks = [];
        if (!sizeStr) {
          sizeStr = formatBytes(downloadedBytes);
        }
        if (filenames.length === 0 && window.unzipit) {
          try {
            const { entries } = await window.unzipit.unzip(zipBlob);
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            filenames = Object.keys(entries)
              .filter((p) => !p.endsWith("/") && !p.startsWith("__MACOSX/"))
              .map((p) => p.split("/").pop());
            filenames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
          } catch (e) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          }
        }
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        renderTree();
        btnPause.style.display = "none";
        btnAbort.style.display = "none";
        btnSave.style.display = "inline-block";
        btnView.style.display = "inline-block";
        progressContainer.style.display = "none";
      } catch (err) {
        if (err.name === "AbortError" || signal.aborted) {
          resetDownloadState();
          return;
        }
        progressText.textContent = "Error downloading.";
        btnDownload.style.display = "inline-block";
        btnPause.style.display = "none";
        btnAbort.style.display = "none";
        btnSave.style.display = "none";
        btnView.style.display = "none";
      }
    }

    btnDownload.addEventListener("click", (e) => {
      e.stopPropagation();
      startDownload();
    });
    btnPause.addEventListener("click", (e) => {
      e.stopPropagation();
      isPaused = !isPaused;
      btnPause.innerHTML = isPaused
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Resume`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause`;
    });
    btnAbort.addEventListener("click", (e) => {
      e.stopPropagation();
      resetDownloadState();
    });
    btnSave.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!zipBlob) return;
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(zipBlob);
      a.href = objUrl;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    });
    btnView.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!zipBlob) return;
      openZipGallery(url, zipFilename, zipBlob, item._post || (item.closest('.post-card') && item.closest('.post-card')._post) || null);
    });
    scanZip();
    return;
  }

  if (type === "gif") {
    loadGifPlayer({
      item,
      url,
      filename,
      progressOverlay,
      onRetry: triggerRetry,
      syncCarouselClones,
      playbackObserver,
    });
    return;
  }

  if (type === "video" || type === "audio") {
    if (item.dataset.isClone === "true") {
      if (progressOverlay) progressOverlay.style.display = "none";
      return;
    }
    let totalSize = 0;
    const updateVideoProgress = (statusText = "Buffering...") => {
      if (!video.duration || video.buffered.length === 0) return;
      let totalBufferedSeconds = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        totalBufferedSeconds += (video.buffered.end(i) - video.buffered.start(i));
      }
      const percent = Math.min(100, Math.round((totalBufferedSeconds / video.duration) * 100));
      const loadedBytes = totalSize ? Math.round((percent / 100) * totalSize) : 0;
      const loadedStr = totalSize ? formatBytes(loadedBytes) : `${Math.round(totalBufferedSeconds)}s`;
      const totalStr = totalSize ? formatBytes(totalSize) : `${Math.round(video.duration)}s`;
      renderMediaProgress(progressOverlay, statusText, percent, filename, loadedStr, totalStr);
    };

    renderMediaProgress(progressOverlay, "Loading...", null, filename, "", "");
    const video = document.createElement(type === "video" ? "video" : "audio");
    video.className = "post-media";
    
    if (type === "video") {
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.disableRemotePlayback = true;
      video.preload = "metadata";
      video.controls = false;
    } else {
      video.controls = true;
    }

    const hideOverlay = () => {
      if (progressOverlay) progressOverlay.style.display = "none";
    };

    video.addEventListener("timeupdate", () => {
      if (video.currentTime > 0) {
        hideOverlay();
      }
    });
    video.addEventListener("playing", hideOverlay);
    video.addEventListener("canplay", () => {
      hideOverlay();
      syncCarouselClones(item);
    });
    video.addEventListener("loadedmetadata", () => {
      updateVideoProgress("Buffering...");
    });
    video.addEventListener("progress", () => {
      if (progressOverlay && progressOverlay.style.display !== "none") {
        updateVideoProgress("Buffering...");
      }
    });
    video.addEventListener("waiting", () => {
      if (!video.paused && progressOverlay) {
        if (video.buffered.length > 0) {
          const firstStart = video.buffered.start(0);
          if (firstStart > video.currentTime && firstStart < 1.0) {
            video.currentTime = firstStart;
          }
        }
        progressOverlay.style.display = "flex";
        updateVideoProgress("Buffering...");
      }
    });

    let videoTimeout = null;
    const p = item.dataset.path;
    const isImagePath = p && /\.(jpe?g|png|webp|gif|avif)$/i.test(p);
    if (isImagePath && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
      videoTimeout = setTimeout(() => {
        item._videoTimeout = null;
        if (video.readyState < 2) {
          video.style.display = "none";
          const thumbImg = document.createElement("img");
          thumbImg.className = "post-media";
          thumbImg.loading = "eager";
          thumbImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${p}`;
          thumbImg.onload = () => {
            if (progressOverlay) progressOverlay.style.display = "none";
            syncCarouselClones(item);
          };
          thumbImg.onerror = () => {
            if (progressOverlay) progressOverlay.style.display = "flex";
            showMediaUnavailableWarning(progressOverlay, { type, filename, errorStatus: "404", onRetry: triggerRetry });
          };
          item.appendChild(thumbImg);
        }
      }, 12000);
      item._videoTimeout = videoTimeout;
    }

    video.addEventListener("loadedmetadata", () => {
      if (videoTimeout) {
        clearTimeout(videoTimeout);
        item._videoTimeout = null;
      }
      updateVideoProgress("Buffering...");
    });
    video.addEventListener("canplay", () => {
      if (videoTimeout) {
        clearTimeout(videoTimeout);
        item._videoTimeout = null;
      }
      hideOverlay();
      syncCarouselClones(item);
    });
    video.addEventListener("error", () => {
      if (videoTimeout) clearTimeout(videoTimeout);
      video.style.display = "none";
      const path = item.dataset.path;
      const isImg = path && /\.(jpe?g|png|webp|gif)$/i.test(path);
      if (isImg && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
        const thumbImg = document.createElement("img");
        thumbImg.className = "post-media";
        thumbImg.loading = "eager";
        thumbImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${path}`;
        thumbImg.onload = () => {
          if (progressOverlay) progressOverlay.style.display = "none";
          syncCarouselClones(item);
        };
        thumbImg.onerror = () => {
          if (progressOverlay) progressOverlay.style.display = "flex";
          showMediaUnavailableWarning(progressOverlay, { type, filename, errorStatus: "404", onRetry: triggerRetry });
        };
        item.appendChild(thumbImg);
        return;
      }
      if (progressOverlay) progressOverlay.style.display = "flex";
      showMediaUnavailableWarning(progressOverlay, { type, filename, errorStatus: "404", onRetry: triggerRetry });
    });

    video.src = url;
    item.appendChild(video);
    if (type === "video") {
      attachCustomVideoPlayer(video, item);
    }
    playbackObserver.observe(video);
    return;
  }

  const img = document.createElement("img");
  img.className = "post-media";
  const isFirstCard = item.closest('.post-card') === feed.firstElementChild;
  if (isFirstCard) {
    img.loading = "eager";
    img.fetchPriority = "high";
  } else {
    img.loading = "lazy";
    img.decoding = "async";
  }

  const path = item.dataset.path;
  const isImageSite = state.currentSite === "kemono" || state.currentSite === "pawchive";
  const isImageFile = path && /\.(jpe?g|png|webp|gif)$/i.test(path);
  // Progressive loading (thumbnail first, full-res upgrade later) is opt-in;
  // by default the full-resolution image is fetched directly.
  if (isImageSite && isImageFile && !path.startsWith("http://") && !path.startsWith("https://") && window.pawProgressiveImages) {
    const thumbUrl = `${PROXY_URL}/${state.currentSite}/thumbnail/data${path}`;
    img.src = thumbUrl;
    img.onload = () => {
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
      if (url && url !== thumbUrl) {
        if (item._upgradeTimer) clearTimeout(item._upgradeTimer);
        item._upgradeTimer = setTimeout(() => {
          if (!item.isConnected) return;
          const fullImg = new Image();
          item._fullImg = fullImg;
          fullImg.onload = () => {
            if (item.isConnected && item._fullImg === fullImg) {
              img.src = url;
              item._fullImg = null;
            }
          };
          fullImg.onerror = () => {
            if (item._fullImg === fullImg) item._fullImg = null;
          };
          fullImg.src = url;
        }, 1200);
      }
    };
    img.onerror = () => {
      if (url && img.src !== url) {
        img.src = url;
        return;
      }
      img.style.display = "none";
      showMediaUnavailableWarning(progressOverlay, {
        type,
        filename,
        errorStatus: "404",
        onRetry: triggerRetry,
      });
    };
  } else {
    img.src = url;
    img.onload = () => {
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
    };
    img.onerror = () => {
      const p = item.dataset.path;
      if (p && /\.(jpe?g|png|webp|gif)$/i.test(p) && !img.dataset.triedThumb && !p.startsWith("http") && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
        img.dataset.triedThumb = "true";
        img.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${p}`;
        return;
      }
      img.style.display = "none";
      showMediaUnavailableWarning(progressOverlay, {
        type,
        filename,
        errorStatus: "404",
        onRetry: triggerRetry,
      });
    };
  }
  item.appendChild(img);
}

export function attachMedia(item, blob, type) {
  if (!item || !item.parentElement) return;
  if (item._blobUrl) {
    URL.revokeObjectURL(item._blobUrl);
    item._blobUrl = null;
  }
  const objUrl = URL.createObjectURL(blob);
  item._blobUrl = objUrl;
  if (type === "video" || type === "audio") {
    const video = document.createElement(type === "video" ? "video" : "audio");
    video.className = "post-media";
    video.src = objUrl;
    if (type === "video") {
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("muted", "");
      video.controls = false;
      item.appendChild(video);
      attachCustomVideoPlayer(video, item);
    } else {
      video.controls = true;
      item.appendChild(video);
    }
    playbackObserver.observe(video);
  } else {
    const img = document.createElement("img");
    img.className = "post-media";
    img.src = objUrl;
    item.appendChild(img);
  }
  syncCarouselClones(item);
}

export function smoothScroll(element, targetLeft, duration = 140, onComplete = null) {
  if (window.pawAnimationsDisabled || duration <= 0) {
    element.scrollLeft = targetLeft;
    element.style.scrollSnapType = "";
    if (onComplete) onComplete();
    return;
  }
  if (element._animId) {
    cancelAnimationFrame(element._animId);
    element._animId = null;
  }
  element.style.scrollSnapType = "none";
  const startLeft = element.scrollLeft;
  const distance = targetLeft - startLeft;
  if (Math.abs(distance) < 1) {
    element.scrollLeft = targetLeft;
    element.style.scrollSnapType = "";
    if (onComplete) onComplete();
    return;
  }
  const startTime = performance.now();
  const easeOut = (t) => t * (2 - t);

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easeOut(progress);
    element.scrollLeft = startLeft + distance * easedProgress;
    if (progress < 1) {
      element._animId = requestAnimationFrame(step);
    } else {
      element._animId = null;
      if (onComplete) {
        onComplete();
      } else {
        element.scrollLeft = targetLeft;
      }
      requestAnimationFrame(() => {
        element.style.scrollSnapType = "";
      });
    }
  }
  element._animId = requestAnimationFrame(step);
}

export function getCarouselMetrics(container) {
  if (!container || !container.children) {
    const w = (container && container.clientWidth) || window.innerWidth || 1;
    return { firstOffset: 0, step: w, itemWidth: w };
  }
  const children = container.children;
  if (children.length <= 1) {
    const w = container.clientWidth || window.innerWidth || 1;
    return { firstOffset: 0, step: w, itemWidth: w };
  }
  const firstItem = children[1] || children[0];
  const firstOffset = firstItem.offsetLeft || 0;
  const itemWidth = firstItem.offsetWidth || container.clientWidth || window.innerWidth || 1;
  const secondItem = children[2];
  const step = (secondItem ? secondItem.offsetLeft - firstOffset : itemWidth) || itemWidth;
  return { firstOffset, step, itemWidth };
}

export function handleCarouselScrollSettled(container, count) {
  if (!container || count <= 1 || container._animId || container._isTouching) return;
  const { firstOffset, step } = getCarouselMetrics(container);
  if (!step) return;

  const curIdx = Math.round((container.scrollLeft - firstOffset) / step) + 1;
  if (curIdx <= 0) {
    container.style.scrollSnapType = "none";
    const target = container.children[count] ? container.children[count].offsetLeft : firstOffset + (count - 1) * step;
    container.scrollLeft = target;
    container._restingScrollLeft = target;
    requestAnimationFrame(() => {
      container.style.scrollSnapType = "";
    });
  } else if (curIdx >= count + 1) {
    container.style.scrollSnapType = "none";
    const target = container.children[1] ? container.children[1].offsetLeft : firstOffset;
    container.scrollLeft = target;
    container._restingScrollLeft = target;
    requestAnimationFrame(() => {
      container.style.scrollSnapType = "";
    });
  } else {
    container._restingScrollLeft = container.scrollLeft;
  }

  const finalIdx = curIdx <= 0 ? count : (curIdx >= count + 1 ? 1 : curIdx);
  const activeChild = container.children[finalIdx];
  if (activeChild) {
    Array.from(container.children).forEach((child) => {
      const gif = child.querySelector("canvas[data-is-gif]");
      if (gif) {
        if (child === activeChild) {
          if (!gif._userPaused && gif.paused) gif.play().catch(() => {});
        } else {
          gif.pause();
        }
      }
    });
  }
}

export function navigateCarousel(carousel, direction, totalCount, isKey = false) {
  const count = carousel.dataset.mediaCount
    ? parseInt(carousel.dataset.mediaCount, 10)
    : totalCount || (carousel.children.length > 2 ? carousel.children.length - 2 : carousel.children.length);
  if (!carousel || count <= 1) return;

  const now = performance.now();
  if (!isKey && carousel._lastNavTime && now - carousel._lastNavTime < 60) {
    return;
  }
  carousel._lastNavTime = now;

  const { firstOffset, step } = getCarouselMetrics(carousel);
  if (!step) return;

  const getChildOffset = (idx) => {
    if (carousel.children[idx]) return carousel.children[idx].offsetLeft;
    return firstOffset + (idx - 1) * step;
  };

  let baseIndex;
  if (carousel._targetIndex !== undefined) {
    baseIndex = carousel._targetIndex;
    if (carousel._animId) {
      cancelAnimationFrame(carousel._animId);
      carousel._animId = null;
    }
    if (baseIndex <= 0) {
      carousel.scrollLeft = getChildOffset(count);
      baseIndex = count;
    } else if (baseIndex >= count + 1) {
      carousel.scrollLeft = getChildOffset(1);
      baseIndex = 1;
    }
  } else {
    baseIndex = Math.round((carousel.scrollLeft - firstOffset) / step) + 1;
    if (baseIndex <= 0) {
      carousel.scrollLeft = getChildOffset(count);
      baseIndex = count;
    } else if (baseIndex >= count + 1) {
      carousel.scrollLeft = getChildOffset(1);
      baseIndex = 1;
    }
  }

  let nextIndex;
  if (direction === "right") {
    nextIndex = baseIndex + 1;
  } else if (direction === "left") {
    nextIndex = baseIndex - 1;
  } else {
    return;
  }

  carousel._targetIndex = nextIndex;
  const targetX = getChildOffset(nextIndex);

  smoothScroll(carousel, targetX, window.pawAnimationsDisabled ? 0 : 140, () => {
    carousel._targetIndex = undefined;
    if (nextIndex <= 0) {
      carousel.scrollLeft = getChildOffset(count);
    } else if (nextIndex >= count + 1) {
      carousel.scrollLeft = getChildOffset(1);
    } else {
      carousel.scrollLeft = targetX;
    }
    carousel._restingScrollLeft = carousel.scrollLeft;
  });
}

export function cleanEmptyParagraphs(container) {
  if (!container) return;
  const paragraphs = container.querySelectorAll("p");
  paragraphs.forEach((p) => {
    if (p.querySelector("img, video, audio, iframe, embed, object, svg, canvas, input, button, select, textarea")) {
      return;
    }
    const links = p.querySelectorAll("a");
    for (const a of links) {
      if (a.querySelector("img, video, audio, svg, canvas")) return;
      if (a.textContent.replace(/[\s\u200B-\u200D\uFEFF]+/g, "")) return;
    }
    const text = p.textContent.replace(/[\s\u200B-\u200D\uFEFF]+/g, "");
    if (!text) {
      p.remove();
    }
  });
}

export function renderPostInfoSection(post, authorEl, titleEl, contentEl) {
  if (!post) {
    if (authorEl) {
      authorEl.innerHTML = "";
      authorEl.style.display = "none";
    }
    if (titleEl) {
      titleEl.innerHTML = "";
      titleEl.style.display = "none";
    }
    if (contentEl) {
      contentEl.innerHTML = "";
      contentEl.style.display = "none";
    }
    return;
  }

  if (!post.service) {
    const match = state.currentFeedEndpoint && state.currentFeedEndpoint.match(/\/api\/v1\/([^\/]+)\/user\/([^\/]+)/);
    if (match) {
      post.service = match[1];
      if (!post.user) post.user = match[2];
    }
  }

  if (authorEl) {
    authorEl.innerHTML = "";
    authorEl.style.display = "flex";
    authorEl.style.alignItems = "center";
    authorEl.style.gap = "8px";

    const creator = state.allCreators.find((c) => c.id === post.user && c.service === post.service);
    const displayName = post.authorName || (creator ? creator.name : state.currentFeedCreatorName) || post.user || "Unknown";
    const creatorUrl = getServiceCreatorUrl(post.service, post.user, displayName);

    const authorLink = document.createElement("a");
    authorLink.className = "post-author-link";
    authorLink.href = creatorUrl;
    authorLink.target = "_blank";
    authorLink.rel = "noopener noreferrer";
    authorLink.textContent = `Creator: ${displayName}`;
    authorEl.appendChild(authorLink);

    if (post.service) {
      const serviceIcon = document.createElement("img");
      serviceIcon.src = `icons/${post.service}.svg`;
      serviceIcon.style.objectFit = "contain";
      serviceIcon.style.flexShrink = "0";

      const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/.test(
        displayName || ""
      );
      let iconMarginBottom = "4px";
      if (post.service === "fantia" || hasCJK) {
        iconMarginBottom = "0px";
      }

      if (post.service === "fantia" || post.service === "dlsite") {
        serviceIcon.style.width = "50px";
        serviceIcon.style.height = "24px";
        serviceIcon.style.marginBottom = iconMarginBottom;
      } else if (post.service === "onlyfans") {
        serviceIcon.style.width = "24px";
        serviceIcon.style.height = "24px";
        serviceIcon.style.marginBottom = iconMarginBottom;
      } else {
        serviceIcon.style.width = "18px";
        serviceIcon.style.height = "18px";
        serviceIcon.style.marginBottom = iconMarginBottom;
      }

      serviceIcon.title = post.service;
      serviceIcon.onerror = () => {
        serviceIcon.style.display = "none";
        const fallbackText = document.createElement("span");
        fallbackText.textContent = `(${post.service})`;
        fallbackText.style.opacity = "0.7";
        fallbackText.style.fontSize = "0.9em";
        authorEl.appendChild(fallbackText);
      };

      const serviceLink = document.createElement("a");
      serviceLink.href = creatorUrl;
      serviceLink.target = "_blank";
      serviceLink.rel = "noopener noreferrer";
      serviceLink.style.display = "flex";
      serviceLink.style.alignItems = "center";
      serviceLink.appendChild(serviceIcon);
      authorEl.appendChild(serviceLink);
    }
  }

  if (titleEl) {
    titleEl.innerHTML = "";
    titleEl.style.display = "flex";
    const postUrl = getServicePostUrl(post.service, post.user, post.id);
    const titleLink = document.createElement("a");
    titleLink.className = "post-title-link";
    titleLink.href = postUrl;
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    titleLink.textContent = post.title || "Untitled";
    titleEl.appendChild(titleLink);
  }

  if (contentEl) {
    contentEl.innerHTML = "";
    if (window.matchMedia("(max-width: 768px)").matches) {
      contentEl.style.paddingBottom = "120px";
    }

    let cleanContent = post._cleanContent || post.content || post.substring || "";
    if (cleanContent) {
      cleanContent = cleanContent.replace(/(href|src)=["']file:[^"']*["']/gi, '$1="#"');
      cleanContent = cleanContent.replace(/<a /gi, '<a target="_blank" rel="noopener noreferrer" ');
      cleanContent = cleanContent.replace(/(<br\s*\/?>[\s\u200B-\u200D\uFEFF]*){3,}/gi, '<br><br>');
      cleanContent = cleanContent.replace(/^(\s*<br\s*\/?>)+/gi, '').replace(/(<br\s*\/?>\s*)+$/gi, '');

      const tmpl = document.createElement("template");
      tmpl.innerHTML = cleanContent;

      tmpl.content.querySelectorAll("[src]").forEach((el) => {
        const src = el.getAttribute("src");
        if (src && !src.startsWith("data:") && !src.startsWith("blob:") && !src.startsWith("#")) {
          el.setAttribute("src", getMediaUrl(src));
        }
      });

      cleanEmptyParagraphs(tmpl.content);
      contentEl.innerHTML = tmpl.innerHTML;

      const hasText = !!contentEl.textContent.replace(/[\s\u200B-\u200D\uFEFF]+/g, "");
      const hasMedia = !!contentEl.querySelector("img, video, audio, iframe, embed, object, svg, canvas");
      let hasLink = false;
      const links = contentEl.querySelectorAll("a");
      for (const a of links) {
        if (a.textContent.replace(/[\s\u200B-\u200D\uFEFF]+/g, "") || a.querySelector("img, video, audio, svg, canvas")) {
          hasLink = true;
          break;
        }
      }

      if (hasText || hasMedia || hasLink) {
        contentEl.style.display = "block";
      } else {
        contentEl.innerHTML = "";
        contentEl.style.display = "none";
      }
    } else {
      contentEl.style.display = "none";
    }
  }
}

export function getCurrentGalleryPost() {
  if (state.currentGalleryPost) return state.currentGalleryPost;
  const feedEl = document.getElementById("feed");
  if (feedEl) {
    const h = window.innerHeight || 1;
    const currentIndex = Math.round(feedEl.scrollTop / h);
    const card = feedEl.children[currentIndex];
    if (card && card._post) return card._post;
  }
  return null;
}

export function createPostCard(post) {
  const card = document.createElement("div");
  card.className = "post-card";
  card._post = post;

  let allMedia = [];
  const supportedExts = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "avif",
    "svg",
    "mp4",
    "webm",
    "mov",
    "zip",
    "mp3",
    "ogg",
    "wav",
    "m4a",
  ];

  function categorizeFile(fileObj) {
    if (!fileObj || !fileObj.path) return;
    if (fileObj.path.toLowerCase().startsWith("file:")) return;
    if (window.pawHideCovers) {
      const fileName = (fileObj.name || fileObj.path.split("/").pop()).toLowerCase();
      if (/(^|[\?&]f=)cover\.(jpe?g|png|webp|gif|bmp)/i.test(fileName)) return;
    }
    const ext = fileObj.path.split(".").pop().toLowerCase();
    if (supportedExts.includes(ext) && !allMedia.some((m) => m.path === fileObj.path)) {
      allMedia.push({
        path: fileObj.path,
        name: fileObj.name || fileObj.path.split("/").pop(),
        isUnimported: !!fileObj.isUnimported || fileObj.path.includes("/unimported."),
      });
    }
  }

  if (post.file) categorizeFile(post.file);
  if (post.attachments && post.attachments.length > 0) {
    post.attachments.forEach((att) => categorizeFile(att));
  }

  let cleanContent = post.content || post.substring || "";
  if (cleanContent) {
    cleanContent = cleanContent.replace(/(href|src)=["']file:[^"']*["']/gi, '$1="#"');

    const tmpl = document.createElement("template");
    tmpl.innerHTML = cleanContent;

    const inlineImgs = tmpl.content.querySelectorAll("img");
    inlineImgs.forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !src.toLowerCase().startsWith("file:") && !allMedia.some((m) => m.path === src)) {
        let skip = false;
        if (window.pawHideCovers) {
          const fileName = src.split("/").pop().toLowerCase();
          if (/(^|[\?&]f=)cover\.(jpe?g|png|webp|gif|bmp)/i.test(fileName)) {
            skip = true;
          }
        }
        if (!skip) {
          allMedia.push({ path: src, name: src.split("/").pop() });
        }
      }
      img.remove();
    });

    tmpl.content.querySelectorAll("[src]").forEach((el) => {
      const src = el.getAttribute("src");
      if (src && !src.startsWith("data:") && !src.startsWith("blob:") && !src.startsWith("#")) {
        el.setAttribute("src", getMediaUrl(src));
      }
    });

    cleanEmptyParagraphs(tmpl.content);
    cleanContent = tmpl.innerHTML;
  }
  post._cleanContent = cleanContent;

  const extGalleries = detectExternalGalleries(cleanContent || post.substring || "");
  if (extGalleries.mega.length > 0 || extGalleries.dropbox.length > 0) {
    extGalleries.mega.forEach((url, i) => {
      const label = extGalleries.mega.length > 1 ? `Mega Archive ${i + 1}` : "Mega Archive";
      allMedia.push({
        path: url,
        name: label,
        isExternal: true,
        externalType: "mega",
        url: url,
        postTitle: post.title || label,
      });
    });
    extGalleries.dropbox.forEach((url, i) => {
      let label;
      if (isDropboxFolderUrl(url)) {
        label = extGalleries.dropbox.length > 1 ? `Dropbox Archive ${i + 1}` : "Dropbox Archive";
      } else {
        const pathOnly = url.split("?")[0].split("#")[0];
        const lastSeg = pathOnly.split("/").filter(Boolean).pop() || "";
        label = decodeURIComponent(lastSeg) || (extGalleries.dropbox.length > 1 ? `Dropbox File ${i + 1}` : "Dropbox File");
      }
      allMedia.push({
        path: url,
        name: label,
        isExternal: true,
        externalType: "dropbox",
        url: url,
        postTitle: post.title || label,
      });
    });
  }

  const hasAvailableMedia = allMedia.some((m) => !m.isUnimported);
  const settingHideNoMedia = document.getElementById("setting-hide-no-media");
  if (!hasAvailableMedia && settingHideNoMedia && settingHideNoMedia.checked) {
    if (
      !state.currentFeedEndpoint.includes("/announcements") &&
      !state.currentFeedEndpoint.includes("/dms") &&
      !state.currentFeedEndpoint.includes("/fancards")
    ) {
      return null;
    }
  }

  if (
    state.currentSite === "cum" &&
    state.cumSelectedTypes &&
    state.cumSelectedTypes.length > 0 &&
    state.cumSelectedTypes.length < 4
  ) {
    const isTextPost = allMedia.length === 0;
    if (isTextPost) {
      if (
        !state.cumSelectedTypes.includes("text") &&
        !state.currentFeedEndpoint.includes("/announcements") &&
        !state.currentFeedEndpoint.includes("/dms") &&
        !state.currentFeedEndpoint.includes("/fancards")
      ) {
        return null;
      }
    } else {
      const hasVideo = allMedia.some((m) => ["mp4", "webm", "mov"].includes(m.path.split(".").pop().toLowerCase()));
      const hasAudio = allMedia.some((m) =>
        ["mp3", "ogg", "wav", "m4a"].includes(m.path.split(".").pop().toLowerCase())
      );
      const hasImage = allMedia.some((m) =>
        ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(m.path.split(".").pop().toLowerCase())
      );
      const hasZip = allMedia.some((m) => m.path.split(".").pop().toLowerCase() === "zip");

      const matchesVideo = hasVideo && state.cumSelectedTypes.includes("videos");
      const matchesAudio = hasAudio && state.cumSelectedTypes.includes("audio");
      const matchesImage = (hasImage || hasZip) && state.cumSelectedTypes.includes("photos");

      if (!matchesVideo && !matchesAudio && !matchesImage) {
        return null;
      }
    }
  }

  const author = document.createElement("div");
  author.className = "post-author";
  const title = document.createElement("div");
  title.className = "post-title";
  const content = document.createElement("div");
  content.className = "post-content";
  renderPostInfoSection(post, author, title, content);

  if (allMedia.length === 0) {
    const textCard = document.createElement("div");
    textCard.className = "post-text-card";
    const inner = document.createElement("div");
    inner.className = "post-text-inner";
    inner.appendChild(author);
    inner.appendChild(title);
    inner.appendChild(content);
    textCard.appendChild(inner);
    card.appendChild(textCard);
  } else {
    const carousel = document.createElement("div");
    carousel.className = "media-carousel";
    carousel.addEventListener(
      "wheel",
      (e) => {
        if (allMedia.length <= 1) return;
        if (e.deltaX < 0 && carousel.scrollLeft <= 1) {
          e.preventDefault();
          wrapCarousel(carousel, "end");
        } else if (e.deltaX > 0 && carousel.scrollLeft >= carousel.scrollWidth - carousel.clientWidth - 2) {
          e.preventDefault();
          wrapCarousel(carousel, "start");
        }
      },
      { passive: false }
    );

    allMedia.forEach((mediaObj) => {
      const mediaPath = mediaObj.path;
      const item = document.createElement("div");
      item.className = "media-item";
      item.dataset.originalName = mediaObj.name;
      item._post = post;

      if (mediaObj.isExternal) {
        item.dataset.url = mediaObj.url;
        item.dataset.path = mediaObj.url;
        item.dataset.type = mediaObj.externalType;
        item.dataset.postTitle = mediaObj.postTitle || "";
        item.dataset.isExternal = "true";
      } else {
        const ext = mediaPath.split(".").pop().toLowerCase();
        const isVideo = ["mp4", "webm", "mov"].includes(ext);
        const isAudio = ["mp3", "ogg", "wav", "m4a"].includes(ext);
        const isGif = ext === "gif";

        item.dataset.url = getMediaUrl(mediaPath);
        item.dataset.path = mediaPath;
        item.dataset.isUnimported = mediaObj.isUnimported ? "true" : "false";
        item.dataset.type = ext === "zip" ? "zip" : isVideo ? "video" : isAudio ? "audio" : isGif ? "gif" : "image";
      }

      const progressOverlay = document.createElement("div");
      progressOverlay.className = "media-progress media-loading";
      item.appendChild(progressOverlay);

      const mediaName = mediaObj.name || mediaPath.split("/").pop() || "media";
      const sizeLabel = mediaObj.bytes ? formatBytes(mediaObj.bytes) : (mediaObj.size ? formatBytes(mediaObj.size) : "");
      renderMediaProgress(progressOverlay, "Loading...", null, mediaName, sizeLabel, "");

      carousel.appendChild(item);
      mediaObserver.observe(item);
    });

    carousel.dataset.mediaCount = allMedia.length;

    if (allMedia.length > 1 && carousel.children.length > 1) {
      const firstChild = carousel.children[0];
      const lastChild = carousel.children[carousel.children.length - 1];
      const cloneFirst = firstChild.cloneNode(true);
      const cloneLast = lastChild.cloneNode(true);
      cloneFirst.dataset.isClone = "true";
      cloneLast.dataset.isClone = "true";
      carousel.insertBefore(cloneLast, firstChild);
      carousel.appendChild(cloneFirst);
      mediaObserver.observe(cloneLast);
      mediaObserver.observe(cloneFirst);
    }

    const indicator = document.createElement("div");
    indicator.className = "carousel-indicator";
    indicator.textContent = `1 / ${allMedia.length}`;
    indicator.style.cursor = "pointer";

    if (allMedia.length > 1) {
      indicator.style.pointerEvents = "auto";
    } else {
      indicator.style.display = "none";
      indicator.style.pointerEvents = "none";
    }

    indicator.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = allMedia.length > 1
        ? (carousel.children[1] ? carousel.children[1].offsetLeft : (carousel.clientWidth || window.innerWidth))
        : 0;
      smoothScroll(carousel, target, window.pawAnimationsDisabled ? 0 : 140);
    });

    requestAnimationFrame(() => {
      if (allMedia.length > 1) {
        carousel.scrollLeft = carousel.children[1] ? carousel.children[1].offsetLeft : (carousel.clientWidth || window.innerWidth);
      } else {
        carousel.scrollLeft = 0;
      }
      carousel._restingScrollLeft = carousel.scrollLeft;
    });

    card.appendChild(indicator);

    let scrollSettleTimer;
    carousel.addEventListener("touchstart", () => {
      carousel._isTouching = true;
      if (carousel._animId) {
        cancelAnimationFrame(carousel._animId);
        carousel._animId = null;
      }
      carousel._restingScrollLeft = carousel.scrollLeft;
      clearTimeout(scrollSettleTimer);
    }, { passive: true });

    carousel.addEventListener("touchend", () => {
      carousel._isTouching = false;
      if (allMedia.length > 1 && !carousel._animId) {
        clearTimeout(scrollSettleTimer);
        scrollSettleTimer = setTimeout(() => {
          handleCarouselScrollSettled(carousel, allMedia.length);
          carousel._restingScrollLeft = carousel.scrollLeft;
        }, 150);
      }
    }, { passive: true });

    carousel.addEventListener("touchcancel", () => {
      carousel._isTouching = false;
    }, { passive: true });

    carousel.addEventListener("scroll", () => {
      if (carousel._isVerticalScrolling && carousel._restingScrollLeft !== undefined) {
        carousel.scrollLeft = carousel._restingScrollLeft;
        return;
      }
      const count = allMedia.length;
      if (count > 1) {
        const { firstOffset, step } = getCarouselMetrics(carousel);
        if (!step) return;
        const rawIndex = Math.round((carousel.scrollLeft - firstOffset) / step) + 1;
        const realIndex = ((rawIndex - 1) % count + count) % count;
        indicator.textContent = `${realIndex + 1} / ${count}`;
        if (!carousel._animId && !carousel._isTouching) {
          clearTimeout(scrollSettleTimer);
          scrollSettleTimer = setTimeout(() => {
            handleCarouselScrollSettled(carousel, count);
            carousel._restingScrollLeft = carousel.scrollLeft;
          }, 150);
        }
      } else {
        indicator.textContent = "1 / 1";
      }
    });

    carousel.addEventListener("scrollend", () => {
      if (!carousel._animId && !carousel._isTouching) {
        handleCarouselScrollSettled(carousel, allMedia.length);
        carousel._restingScrollLeft = carousel.scrollLeft;
      }
    });

    card.appendChild(carousel);

    const info = document.createElement("div");
    info.className = "post-info";
    info.appendChild(author);
    info.appendChild(title);
    info.appendChild(content);
    card.appendChild(info);
  }

  let cardTouchStartX = 0;
  let cardTouchStartY = 0;

  card.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      cardTouchStartX = e.touches[0].clientX;
      cardTouchStartY = e.touches[0].clientY;
      card.dataset.isDragging = "false";
    }
  }, { passive: true });

  card.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - cardTouchStartX;
      const dy = e.touches[0].clientY - cardTouchStartY;
      if (Math.hypot(dx, dy) > 18) {
        card.dataset.isDragging = "true";
      }
    }
  }, { passive: true });

  card.addEventListener("click", (e) => {
    if (e.target.tagName.toLowerCase() === "a" || e.target.closest("a")) return;
    if (e.target.tagName.toLowerCase() === "button" || e.target.closest("button")) return;
    if (e.target.closest(".zip-info-text")) return;

    const edgeCfg = window.pawEdgeConfig || { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 };
    const x = e.clientX;
    const y = e.clientY;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const isEdgeClick =
      y < h * (edgeCfg.top ?? 0.05) ||
      y > h * (1 - (edgeCfg.bottom ?? 0.05)) ||
      x < w * (edgeCfg.left ?? 0.05) ||
      x > w * (1 - (edgeCfg.right ?? 0.05));

    if (!isEdgeClick) {
      if (e.target.closest(".custom-player-overlay")) return;
      const isVideo = e.target.tagName.toLowerCase() === "video";
      const isAudio = e.target.tagName.toLowerCase() === "audio";
      if (isAudio) return;
      if (isVideo && e.target.closest(".media-item")?.querySelector(".custom-player-overlay")) {
        return;
      }
    }

    const navEl = document.getElementById("nav");
    const isNavCurrentlyVisible = navEl && navEl.classList.contains("visible");

    if (isNavCurrentlyVisible) {
      state.navManualVisible = false;
      window.lastMouseY = -1;
      updateNavVisibility();
      return;
    }

    const infoEl = card.querySelector(".post-info");
    if (infoEl && infoEl.classList.contains("expanded") && e.target.closest(".post-info")) {
      return;
    }

    const leftThreshold = w * (edgeCfg.left ?? 0.05);
    const rightThreshold = w * (1 - (edgeCfg.right ?? 0.05));
    const topThreshold = h * (edgeCfg.top ?? 0.05);
    const bottomThreshold = h * (1 - (edgeCfg.bottom ?? 0.05));

    const carousel = card.querySelector(".media-carousel");
    if (carousel && allMedia.length > 1) {
      if (x < leftThreshold) {
        navigateCarousel(carousel, "left", allMedia.length);
        return;
      }
      if (x > rightThreshold) {
        navigateCarousel(carousel, "right", allMedia.length);
        return;
      }
    }

    if (y < topThreshold) {
      let target =
        feed.dataset.targetScroll !== undefined
          ? parseFloat(feed.dataset.targetScroll)
          : Math.round(feed.scrollTop / h) * h;
      target = Math.max(0, target - h);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = "up";
      feed.style.scrollSnapType = "none";
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
      return;
    }

    if (y > bottomThreshold) {
      let target =
        feed.dataset.targetScroll !== undefined
          ? parseFloat(feed.dataset.targetScroll)
          : Math.round(feed.scrollTop / h) * h;
      target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = "down";
      feed.style.scrollSnapType = "none";
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
      return;
    }

    state.navManualVisible = true;
    window.lastMouseY = -1;
    updateNavVisibility();
  });

  return card;
}

export function getFeedLoadingDescription() {
  const endpoint = state.currentFeedEndpoint || "";
  const isAnnouncements = endpoint.includes("/announcements");
  const isFancards = endpoint.includes("/fancards") || endpoint.includes("type=fancards");
  const isDms = endpoint.includes("/dms");

  let tag = null;
  const tagMatch = endpoint.match(/[?&]tag=([^&]+)/);
  if (tagMatch) {
    try {
      tag = decodeURIComponent(tagMatch[1]);
    } catch (e) {
      tag = tagMatch[1];
    }
  }

  let typeLabel = null;
  const typeMatch = endpoint.match(/[?&]type=([^&]+)/);
  if (typeMatch && !isFancards) {
    const rawType = decodeURIComponent(typeMatch[1]).toLowerCase();
    const typeNames = {
      photos: "Photos",
      videos: "Videos",
      audio: "Audio",
      text: "Text posts",
    };
    typeLabel = typeNames[rawType] || rawType;
  }

  let category = "posts";
  if (isAnnouncements) category = "announcements";
  else if (isFancards) category = "fancards";
  else if (isDms) category = "direct messages";
  else if (tag) category = `posts tagged #${tag}`;
  else if (typeLabel) category = typeLabel.toLowerCase();

  let target = "";
  const match = endpoint.match(/\/api\/v1\/([^\/]+)\/user\/([^\/]+)/);
  if (match) {
    const service = match[1];
    const userId = match[2];
    const serviceNames = {
      patreon: "Patreon",
      fanbox: "Fanbox",
      fantia: "Fantia",
      subscribestar: "SubscribeStar",
      boosty: "Boosty",
      gumroad: "Gumroad",
      discord: "Discord",
      dlsite: "DLsite",
      onlyfans: "OnlyFans",
      candfans: "CandFans",
      fansly: "Fansly",
    };
    const formattedService = serviceNames[service.toLowerCase()] || (service.charAt(0).toUpperCase() + service.slice(1));
    let creatorName = state.currentFeedCreatorName;
    if (!creatorName && state.allCreators && state.allCreators.length > 0) {
      const found = state.allCreators.find((c) => c.id === userId && (c.service === service || !c.service));
      if (found && found.name) creatorName = found.name;
    }
    if (!creatorName) creatorName = userId;
    target = ` by ${creatorName} (${formattedService})`;
  } else {
    const site = state.currentSite ? (state.currentSite.charAt(0).toUpperCase() + state.currentSite.slice(1)) : "Feed";
    target = ` from ${site}`;
  }

  const isSinglePage = isAnnouncements || isFancards;
  let batch = "";
  if (!isSinglePage && state.offset > 0) {
    const limit = state.limit || 50;
    const pageNum = Math.floor(state.offset / limit) + 1;
    const startRange = state.offset + 1;
    const endRange = state.offset + limit;
    batch = ` • Page ${pageNum} (${startRange}–${endRange})`;
  }

  return `Loading ${category}${target}${batch}...`;
}

export function updateFeedLoading(customText = null) {
  if (!feedLoading) return;
  const text = customText || getFeedLoadingDescription();
  feedLoading.innerHTML = `<span class="loading-spinner"></span><span>${escapeHtml(text)}</span>`;
}

export async function fetchPosts() {
  if (state.isFetching || !state.hasMore) return;
  state.isFetching = true;
  updateFeedLoading();
  if (feedLoading) feedLoading.classList.add("active");
  startProgress();

  try {
    const isAnnouncements = state.currentFeedEndpoint.includes("/announcements");
    const isFancards = state.currentFeedEndpoint.includes("/fancards");
    const isSinglePageFeed = isAnnouncements || isFancards;
    const separator = state.currentFeedEndpoint.includes("?") ? "&" : "?";
    const url = isSinglePageFeed
      ? state.currentFeedEndpoint
      : `${state.currentFeedEndpoint}${separator}o=${state.offset}`;

    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.status === 429 && attempt === 0) {
          updateFeedLoading("Rate limited (429), retrying in 1.5s...");
          await new Promise((r) => setTimeout(r, 1500));
          updateFeedLoading();
          continue;
        }
        break;
      } catch (e) {
        clearTimeout(timeoutId);
        if (attempt === 0) {
          updateFeedLoading("Connection failed, retrying...");
          await new Promise((r) => setTimeout(r, 1000));
          updateFeedLoading();
          continue;
        }
        throw e;
      }
    }

    if (!res || !res.ok) throw new Error("Failed to fetch: " + (res ? `${res.status} ${res.statusText}` : "timeout"));

    let posts = await res.json();
    if (!Array.isArray(posts)) {
      posts = posts.posts || posts.announcements || posts.dms || posts.fancards || [];
    }

    if (isSinglePageFeed) state.hasMore = false;
    if (!Array.isArray(posts) || posts.length === 0) {
      state.hasMore = false;
    } else {
      const catName = isAnnouncements ? "announcements" : isFancards ? "fancards" : "posts";
      updateFeedLoading(`Rendering ${posts.length} ${catName}...`);
      const currentCards = feed.querySelectorAll(".post-card");
      if (currentCards.length > 0) {
        feedObserver.unobserve(currentCards[currentCards.length - 1]);
      }

      let addedCount = 0;
      posts.forEach((post) => {
        if (!post.service) {
          const match = state.currentFeedEndpoint.match(/\/api\/v1\/([^\/]+)\/user\/([^\/]+)/);
          if (match) {
            post.service = match[1];
            if (!post.user && !post.user_id) post.user = match[2];
          }
        }
        if (!post.user && post.user_id) post.user = post.user_id;
        if (post.hash && post.ext && !post.file && !post.attachments) {
          post.file = {
            name: `${post.hash}.${post.ext}`,
            path: `/${post.hash.substring(0, 2)}/${post.hash.substring(2, 4)}/${post.hash}.${post.ext}`
          };
        }
        const card = createPostCard(post);
        if (card) {
          feed.appendChild(card);
          addedCount++;
        }
      });

      state.offset += posts.length;
      const cards = feed.querySelectorAll(".post-card");
      if (cards.length > 0) {
        feedObserver.observe(cards[cards.length - 1]);
      }
      if (addedCount === 0 && posts.length > 0) {
        fetchPosts();
      }
    }
  } catch (err) {
    console.error("fetchPosts failure:", err);
    updateFeedLoading("Failed to load posts.");
  } finally {
    state.isFetching = false;
    if (feedLoading) feedLoading.classList.remove("active");
    stopProgress();
  }
}