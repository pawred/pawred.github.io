import { PROXY_URL, state } from "./state.js";
import { zipViewer, zipTitle, zipContent, zipIndicator, setZipNavVisible, render2DMatrixGallery } from "./zip.js";
import { formatBytes, showMediaUnavailableWarning, renderArchiveProgress, renderMediaProgress } from "./utils.js";
import { attachMedia, syncCarouselClones, getCurrentGalleryPost, playbackObserver } from "./feed.js";
import { createExternalAbortSignal, renderArchiveCardUI, escapeHtml, getMimeType, isImageOrVideo } from "./externalGalleries.js";
import { attachCustomVideoPlayer } from "./player.js";
import { loadGifPlayer } from "./gifPlayer.js";

export const megaFolderCache = new Map();
export const megaBlobCache = new Map();
const MAX_BLOB_CACHE_ITEMS = 25;
const MAX_BLOB_CACHE_BYTES = 200 * 1024 * 1024; // 200MB budget
let currentBlobCacheBytes = 0;

export function cacheMegaBlob(key, blob) {
  const blobSize = blob.size || 0;
  while (megaBlobCache.size >= MAX_BLOB_CACHE_ITEMS || (currentBlobCacheBytes + blobSize > MAX_BLOB_CACHE_BYTES && megaBlobCache.size > 0)) {
    const oldestKey = megaBlobCache.keys().next().value;
    if (!oldestKey) break;
    const oldBlob = megaBlobCache.get(oldestKey);
    if (oldBlob && oldBlob.size) currentBlobCacheBytes -= oldBlob.size;
    megaBlobCache.delete(oldestKey);
  }
  megaBlobCache.set(key, blob);
  currentBlobCacheBytes += blobSize;
}

export function base64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function unmergeKeyMac(key) {
  const k = new Uint8Array(32);
  k.set(key);
  for (let i = 0; i < 16; i++) {
    k[i] = key[i] ^ key[16 + i];
  }
  return k;
}

const ZERO_IV = new Uint8Array(16);

export function decryptAttributes(encAttrBase64, rawNodeKey) {
  try {
    if (!window.aesjs) return null;
    const encBytes = base64urlToBytes(encAttrBase64);
    const padLen = (16 - (encBytes.length % 16)) % 16;
    let paddedBytes = encBytes;
    if (padLen > 0) {
      paddedBytes = new Uint8Array(encBytes.length + padLen);
      paddedBytes.set(encBytes);
    }

    const fileKey = unmergeKeyMac(rawNodeKey).subarray(0, 16);
    const aesCbc = new window.aesjs.ModeOfOperation.cbc(fileKey, ZERO_IV);
    const decBytes = aesCbc.decrypt(paddedBytes);
    let end = 0;
    while (end < decBytes.length && decBytes[end] !== 0) end++;
    const str = new TextDecoder().decode(new Uint8Array(decBytes.slice(0, end)));
    if (str.startsWith('MEGA{"')) {
      return JSON.parse(str.slice(4));
    }
  } catch (e) {}
  return null;
}

export function decryptNodeKey(kStr, folderKeyBytes, encAttr, cipherInstance = null) {
  if (!window.aesjs) return null;
  const aes = cipherInstance || (
    folderKeyBytes.length === 32
      ? new window.aesjs.ModeOfOperation.ecb(unmergeKeyMac(folderKeyBytes).subarray(0, 16))
      : new window.aesjs.ModeOfOperation.ecb(folderKeyBytes.subarray(0, 16))
  );

  const parts = kStr.split("/").map((p) => p.split(":"));
  for (const part of parts) {
    const rawEncKeyStr = part[part.length - 1];
    try {
      const encKeyBytes = base64urlToBytes(rawEncKeyStr);
      let rawKey = null;
      if (encKeyBytes.length === 32 || encKeyBytes.length === 16) {
        rawKey = new Uint8Array(aes.decrypt(encKeyBytes));
      } else {
        continue;
      }
      if (rawKey && encAttr) {
        const attrs = decryptAttributes(encAttr, rawKey);
        if (attrs && attrs.n) {
          return { rawKey, attrs };
        }
      } else if (rawKey) {
        return { rawKey, attrs: null };
      }
    } catch (e) {}
  }
  return null;
}

export async function decryptAllMegaNodes(nodes, rootFolderKeyBytes) {
  const nodeKeyMap = new Map();
  const decryptedNodes = new Map();

  const initialKey = rootFolderKeyBytes.length === 32
    ? unmergeKeyMac(rootFolderKeyBytes).subarray(0, 16)
    : rootFolderKeyBytes.subarray(0, 16);

  const availableKeys = [initialKey];
  const cipherMap = new Map();
  function getCipher(keyBytes) {
    let c = cipherMap.get(keyBytes);
    if (!c) {
      const aesKey = keyBytes.length === 32 ? unmergeKeyMac(keyBytes).subarray(0, 16) : keyBytes.subarray(0, 16);
      c = new window.aesjs.ModeOfOperation.ecb(Array.from(aesKey));
      cipherMap.set(keyBytes, c);
    }
    return c;
  }

  const childrenByParent = new Map();
  const allNodesByHandle = new Map();

  for (const node of nodes) {
    if (!node.h || !node.k || !node.a) continue;
    allNodesByHandle.set(node.h, node);
    const p = node.p || "";
    if (!childrenByParent.has(p)) {
      childrenByParent.set(p, []);
    }
    childrenByParent.get(p).push(node);
  }

  let lastYield = performance.now();
  const bfsQueue = [];

  for (const [parentHandle] of childrenByParent.entries()) {
    if (!parentHandle || !allNodesByHandle.has(parentHandle)) {
      bfsQueue.push({ parentHandle, key: initialKey, cipher: getCipher(initialKey) });
    }
  }

  while (bfsQueue.length > 0) {
    const { parentHandle, key, cipher } = bfsQueue.shift();
    const children = childrenByParent.get(parentHandle) || [];

    for (const node of children) {
      if (decryptedNodes.has(node.h)) continue;

      if (performance.now() - lastYield > 16) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }

      const res = decryptNodeKey(node.k, key, node.a, cipher);
      if (res && res.attrs && res.attrs.n) {
        const name = res.attrs.n;
        const isFolder = node.t === 1;
        const folderAesKey = res.rawKey.length === 32
          ? unmergeKeyMac(res.rawKey).subarray(0, 16)
          : res.rawKey.subarray(0, 16);

        if (isFolder) {
          nodeKeyMap.set(node.h, folderAesKey);
          if (!availableKeys.includes(folderAesKey)) availableKeys.push(folderAesKey);
          if (childrenByParent.has(node.h)) {
            bfsQueue.push({ parentHandle: node.h, key: folderAesKey, cipher: getCipher(folderAesKey) });
          }
        }

        decryptedNodes.set(node.h, {
          node,
          h: node.h,
          p: node.p,
          name,
          rawKey: res.rawKey,
          isFolder,
          size: node.s || 0
        });
      }
    }
  }

  if (decryptedNodes.size < allNodesByHandle.size) {
    let changed = true;
    let passes = 0;
    while (changed && passes < 3) {
      changed = false;
      passes++;
      for (const node of nodes) {
        if (decryptedNodes.has(node.h) || !node.k || !node.a) continue;

        if (performance.now() - lastYield > 16) {
          await new Promise((r) => setTimeout(r, 0));
          lastYield = performance.now();
        }

        const keysToTry = [];
        if (node.p && nodeKeyMap.has(node.p)) keysToTry.push(nodeKeyMap.get(node.p));
        for (const k of availableKeys) {
          if (!keysToTry.includes(k)) keysToTry.push(k);
        }

        for (const k of keysToTry) {
          const res = decryptNodeKey(node.k, k, node.a, getCipher(k));
          if (res && res.attrs && res.attrs.n) {
            const name = res.attrs.n;
            const isFolder = node.t === 1;
            const folderAesKey = res.rawKey.length === 32
              ? unmergeKeyMac(res.rawKey).subarray(0, 16)
              : res.rawKey.subarray(0, 16);

            if (isFolder) {
              nodeKeyMap.set(node.h, folderAesKey);
              if (!availableKeys.includes(folderAesKey)) availableKeys.push(folderAesKey);
            }

            decryptedNodes.set(node.h, {
              node,
              h: node.h,
              p: node.p,
              name,
              rawKey: res.rawKey,
              isFolder,
              size: node.s || 0
            });
            changed = true;
            break;
          }
        }
      }
    }
  }

  return decryptedNodes;
}

export function formatMegaFileTree(decryptedNodes) {
  const childrenMap = new Map();
  const rootNodes = [];

  for (const node of decryptedNodes.values()) {
    const parentId = node.p;
    if (!parentId || !decryptedNodes.has(parentId)) {
      rootNodes.push(node);
    } else {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId).push(node);
    }
  }

  let output = "";

  function printNode(nodeObj, prefix, isLast) {
    const isFolder = nodeObj.isFolder;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    if (isFolder) {
      output += prefix + connector + nodeObj.name + "/\n";
      const children = childrenMap.get(nodeObj.h) || [];
      children.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
      for (let i = 0; i < children.length; i++) {
        printNode(children[i], childPrefix, i === children.length - 1);
      }
    } else {
      const sizeStr = nodeObj.size > 0 ? ` (${formatBytes(nodeObj.size)})` : "";
      output += prefix + connector + nodeObj.name + sizeStr + "\n";
    }
  }

  let headerName = "";
  let startNodes = rootNodes;
  if (rootNodes.length === 1 && rootNodes[0].isFolder) {
    headerName = rootNodes[0].name;
    startNodes = childrenMap.get(rootNodes[0].h) || [];
  }

  startNodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  for (let i = 0; i < startNodes.length; i++) {
    printNode(startNodes[i], "", i === startNodes.length - 1);
  }

  return { headerName, tree: output };
}

export async function megaApiRequest(queryStr, bodyJson, signal, maxRetries = 3) {
  const directUrl = `https://g.api.mega.co.nz/cs?${queryStr}`;
  const proxyUrl = `${PROXY_URL}/mega/api?${queryStr}`;
  let lastData = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal && signal.aborted) throw new Error("Aborted");
    const targetUrl = attempt === 0 ? proxyUrl : attempt === 1 ? directUrl : proxyUrl;

    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyJson),
        signal
      });

      if (res.ok) {
        const data = await res.json();
        const errCode = Array.isArray(data) ? data[0] : data;

        if (errCode === -3) {
          lastData = data;
          if (attempt < maxRetries) {
            const delay = Math.min(2000, 350 * Math.pow(2, attempt));
            console.warn(`[Mega] Received -3 (EAGAIN), retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        } else {
          return data;
        }
      }
    } catch (e) {
      if (signal && signal.aborted) throw e;
      console.warn(`[Mega] API attempt ${attempt + 1} to ${targetUrl} failed:`, e.message);
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  if (lastData) return lastData;
  throw new Error("Mega API request failed after retries");
}

export async function fetchMegaStorageStream(dlUrl, signal) {
  const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(dlUrl)}`;
  const res = await fetch(proxyUrl, { signal });
  if (!res.ok) throw new Error(`Failed to download Mega file (HTTP ${res.status})`);
  return res;
}

function decryptMegaInWorker(dlUrl, proxyUrl, rawNodeKey, totalBytes, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const workerScript = `
      self.importScripts('https://cdn.jsdelivr.net/npm/aes-js@3.1.2/index.min.js');

      function unmergeKeyMac(key) {
        const k = new Uint8Array(32);
        k.set(key);
        for (let i = 0; i < 16; i++) {
          k[i] = key[i] ^ key[16 + i];
        }
        return k;
      }

      self.onmessage = async function(e) {
        const { proxyUrl, rawKeyBytes, totalBytes } = e.data;
        try {
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error("Download failed: HTTP " + res.status);

          const rawNodeKey = new Uint8Array(rawKeyBytes);
          const fileKey = unmergeKeyMac(rawNodeKey).subarray(0, 16);
          const counterBytes = new Uint8Array(16);
          counterBytes.set(rawNodeKey.subarray(16, 24), 0);

          const counter = new self.aesjs.Counter(counterBytes);
          const aesCtr = new self.aesjs.ModeOfOperation.ctr(Array.from(fileKey), counter);

          const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
          const finalTotal = totalBytes || contentLength || 0;

          const reader = res.body.getReader();
          const decChunks = [];
          let received = 0;
          let lastProgress = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const decChunk = aesCtr.decrypt(value);
            decChunks.push(decChunk);
            received += value.length;

            const now = performance.now();
            if (now - lastProgress > 80 || (finalTotal > 0 && received === finalTotal)) {
              lastProgress = now;
              self.postMessage({ type: 'progress', loaded: received, total: finalTotal });
            }
          }

          const fullDec = new Uint8Array(received);
          let offset = 0;
          for (const c of decChunks) {
            fullDec.set(c, offset);
            offset += c.length;
          }

          self.postMessage({ type: 'done', buffer: fullDec.buffer }, [fullDec.buffer]);
        } catch (err) {
          self.postMessage({ type: 'error', message: err.message });
        }
      };
    `;

    const blob = new Blob([workerScript], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        return reject(new DOMException("Aborted", "AbortError"));
      }
      signal.addEventListener("abort", () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }

    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === "progress") {
        if (onProgress) onProgress(data.loaded, data.total);
      } else if (data.type === "done") {
        cleanup();
        resolve(data.buffer);
      } else if (data.type === "error") {
        cleanup();
        reject(new Error(data.message || "Decryption failed"));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(err);
    };

    worker.postMessage({
      dlUrl,
      proxyUrl,
      rawKeyBytes: Array.from(rawNodeKey),
      totalBytes
    });
  });
}

export async function downloadAndDecryptMegaPayload(dlUrl, rawNodeKey, filename, onProgress, signal, knownSize = 0) {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const fileRes = await fetchMegaStorageStream(dlUrl, signal);
    const totalBytes = knownSize || parseInt(fileRes.headers.get("content-length") || "0", 10);
    const fileKey = unmergeKeyMac(rawNodeKey).subarray(0, 16);
    const counterBytes = new Uint8Array(16);
    counterBytes.set(rawNodeKey.subarray(16, 24), 0);

    const reader = fileRes.body.getReader();
    const chunks = [];
    let received = 0;
    let lastProgressTime = 0;

    const onAbort = () => {
      try { reader.cancel(); } catch (_) {}
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        throw new Error("Aborted");
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      while (true) {
        if (signal && signal.aborted) throw new Error("Aborted");
        const { done, value } = await reader.read();
        if (signal && signal.aborted) throw new Error("Aborted");
        if (done) break;
        chunks.push(value);
        received += value.length;

        const now = performance.now();
        if (onProgress && (now - lastProgressTime > 80 || (totalBytes > 0 && received === totalBytes))) {
          lastProgressTime = now;
          onProgress(received, totalBytes);
        }
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }

    if (signal && signal.aborted) throw new Error("Aborted");
    if (totalBytes > 0 && received < totalBytes) {
      throw new Error(`Incomplete download: received ${received} of ${totalBytes} bytes`);
    }

    const fullEnc = new Uint8Array(received);
    let offset = 0;
    while (chunks.length > 0) {
      const c = chunks.shift();
      fullEnc.set(c, offset);
      offset += c.length;
    }

    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      fileKey,
      { name: "AES-CTR" },
      false,
      ["decrypt"]
    );
    const decBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-CTR", counter: counterBytes, length: 64 },
      cryptoKey,
      fullEnc
    );
    return new Blob([decBuffer], { type: getMimeType(filename) });
  }

  const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(dlUrl)}`;
  const decBuffer = await decryptMegaInWorker(dlUrl, proxyUrl, rawNodeKey, knownSize, onProgress, signal);
  return new Blob([decBuffer], { type: getMimeType(filename) });
}

export function isMegaUrl(url) {
  return /https?:\/\/(?:www\.)?mega\.(?:nz|co\.nz|io)\/(?:(?:embed\/)?folder\/[a-zA-Z0-9_-]+[^#]*#[a-zA-Z0-9_-]+|(?:embed\/)?file\/[a-zA-Z0-9_-]+[^#]*#[a-zA-Z0-9_-]+|#F![a-zA-Z0-9_-]+![a-zA-Z0-9_-]+|#![a-zA-Z0-9_-]+![a-zA-Z0-9_-]+)/i.test(url);
}

export function parseMegaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const folderMatch = url.pathname.match(/\/(?:embed\/)?folder\/([a-zA-Z0-9_-]+)/);
    if (folderMatch && url.hash) {
      const key = url.hash.substring(1).split("/")[0].split("?")[0];
      return { type: "folder", id: folderMatch[1], key };
    }
    const fileMatch = url.pathname.match(/\/(?:embed\/)?file\/([a-zA-Z0-9_-]+)/);
    if (fileMatch && url.hash) {
      const key = url.hash.substring(1).split("/")[0].split("?")[0];
      return { type: "file", id: fileMatch[1], key };
    }
    if (url.hash.startsWith("#F!")) {
      const parts = url.hash.split("!");
      return { type: "folder", id: parts[1], key: parts[2] ? parts[2].split("/")[0].split("?")[0] : "" };
    }
    if (url.hash.startsWith("#!")) {
      const parts = url.hash.split("!");
      return { type: "file", id: parts[1], key: parts[2] ? parts[2].split("/")[0].split("?")[0] : "" };
    }
  } catch (e) {}
  return null;
}

export async function handleMegaSingleFileEmbed(item, parsed, progressOverlay, postTitle, fallbackName, signal) {
  try {
    const blobKey = parsed.id + "#" + parsed.key;
    if (megaBlobCache.has(blobKey)) {
      const blob = megaBlobCache.get(blobKey);
      const isVideo = blob.type.startsWith("video/");
      const isGif = blob.type === "image/gif" || (fallbackName || "").split(".").pop().toLowerCase() === "gif";
      attachMedia(item, blob, isVideo ? "video" : isGif ? "gif" : "image");
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
      return;
    }

    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(progressOverlay, "Loading...", null, fallbackName || "Mega File", "Connecting...", "");
    }

    const data = await megaApiRequest(`id=${Date.now()}`, [{ a: "g", g: 1, ssl: 2, p: parsed.id }], signal);
    const megaErrCode = Array.isArray(data) ? data[0] : data;
    if (typeof megaErrCode === "number" && megaErrCode < 0) {
      throw new Error(`Mega error ${megaErrCode}`);
    }
    if (!Array.isArray(data) || !data[0] || !data[0].g) {
      throw new Error("Mega file unavailable");
    }

    const downloadUrl = data[0].g;
    const rawKey = base64urlToBytes(parsed.key);
    let filename = fallbackName;
    if (data[0].at) {
      const attrs = decryptAttributes(data[0].at, rawKey);
      if (attrs && attrs.n) filename = attrs.n;
    }

    const totalSize = data[0].s || 0;
    const ext = filename.split(".").pop().toLowerCase();
    const isVideo = ["mp4", "webm"].includes(ext);
    const isGif = ext === "gif";
    const isImage = (isImageOrVideo(filename) && !isVideo) || isGif;

    if (isImage || isVideo) {
      if (progressOverlay) {
        renderMediaProgress(
          progressOverlay,
          "Loading...",
          null,
          filename,
          totalSize > 0 ? formatBytes(totalSize) : "Connecting...",
          ""
        );
      }
      const blob = await downloadAndDecryptMegaPayload(
        downloadUrl,
        rawKey,
        filename,
        (loaded, total) => {
          if (progressOverlay) {
            const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
            renderMediaProgress(
              progressOverlay,
              "Loading...",
              pct,
              filename,
              formatBytes(loaded),
              total > 0 ? formatBytes(total) : ""
            );
          }
        },
        signal,
        totalSize
      );
      if (signal.aborted) return;
      cacheMegaBlob(blobKey, blob);
      attachMedia(item, blob, isVideo ? "video" : isGif ? "gif" : "image");
      if (progressOverlay) progressOverlay.style.display = "none";
      syncCarouselClones(item);
    } else {
      if (progressOverlay) progressOverlay.style.display = "none";
      const sizeStr = data[0].s ? formatBytes(data[0].s) : "";
      renderArchiveCardUI(item, item.dataset.url, "mega", postTitle, filename, signal, {
        totalSize: data[0].s || 0,
        fileCount: 1,
        tree: `└── ${filename} (${sizeStr})`
      });
    }
  } catch (err) {
    if (signal.aborted) return;
    console.warn("[Mega] handleMegaSingleFileEmbed warning:", err.message || err);
    if (progressOverlay) {
      const originalUrl = (item && item.dataset && item.dataset.url) || `https://mega.nz/file/${parsed.id}#${parsed.key}`;
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || (err.message && err.message.match(/Mega error\s+(-\d+)/i)?.[1]) || "404");
      showMediaUnavailableWarning(progressOverlay, {
        type: "media",
        filename: fallbackName || "Mega File",
        errorStatus: detectedStatus,
        message: err.message || "Failed to load Mega file",
        externalUrl: originalUrl,
        onRetry: () => handleMegaSingleFileEmbed(item, parsed, progressOverlay, postTitle, fallbackName, signal)
      });
    }
  }
}

export async function downloadAndAttachSingleMegaFile(item, folderId, singleFile, isVideo, progressOverlay, signal) {
  try {
    const blobKey = folderId + "/" + singleFile.node.h;
    const totalSize = singleFile.size || singleFile.node?.s || 0;
    const ext = (singleFile.name || "").split(".").pop().toLowerCase();
    const isVid = typeof isVideo === "boolean" ? isVideo : ["mp4", "webm"].includes(ext);
    const isGif = ext === "gif";
    const mediaType = isVid ? "video" : isGif ? "gif" : "image";

    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(
        progressOverlay,
        "Loading...",
        null,
        singleFile.name,
        totalSize > 0 ? formatBytes(totalSize) : "Connecting...",
        ""
      );
    }

    const dlRes = await megaApiRequest(`id=${Date.now()}&n=${folderId}`, [{ a: "g", g: 1, ssl: 2, n: singleFile.node.h }], signal);
    const dlUrl = dlRes[0]?.g;
    if (!dlUrl) throw new Error("Failed to get download URL from Mega");

    const blob = await downloadAndDecryptMegaPayload(
      dlUrl,
      singleFile.rawKey,
      singleFile.name,
      (loaded, total) => {
        if (progressOverlay) {
          const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
          renderMediaProgress(
            progressOverlay,
            "Loading...",
            pct,
            singleFile.name,
            formatBytes(loaded),
            total > 0 ? formatBytes(total) : ""
          );
        }
      },
      signal,
      totalSize
    );

    if (signal.aborted) return;
    cacheMegaBlob(blobKey, blob);
    attachMedia(item, blob, mediaType);
    if (progressOverlay) progressOverlay.style.display = "none";
    syncCarouselClones(item);
  } catch (err) {
    if (signal.aborted) return;
    console.warn("[Mega] downloadAndAttachSingleMegaFile warning:", err.message || err);
    if (progressOverlay) {
      const originalUrl = (item && item.dataset && item.dataset.url) || "";
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || (err.message && err.message.match(/Mega error\s+(-\d+)/i)?.[1]) || "404");
      const ext = (singleFile.name || "").split(".").pop().toLowerCase();
      const isVid = typeof isVideo === "boolean" ? isVideo : ["mp4", "webm"].includes(ext);
      const isGif = ext === "gif";
      showMediaUnavailableWarning(progressOverlay, {
        type: isVid ? "video" : isGif ? "gif" : "image",
        filename: singleFile.name,
        errorStatus: detectedStatus,
        message: err.message || "Failed to load Mega file",
        externalUrl: originalUrl,
        onRetry: () => downloadAndAttachSingleMegaFile(item, folderId, singleFile, isVideo, progressOverlay, signal)
      });
    }
  }
}

export async function handleMegaFolderEmbed(item, parsed, progressOverlay, postTitle, fallbackName, signal) {
  try {
    const cacheKey = parsed.id + "#" + parsed.key;

    if (megaFolderCache.has(cacheKey)) {
      const cached = megaFolderCache.get(cacheKey);
      if (progressOverlay) progressOverlay.style.display = "none";
      if (cached.singleFile) {
        const singleFile = cached.singleFile;
        const ext = singleFile.name.split(".").pop().toLowerCase();
        const isGif = ext === "gif";
        const isVideo = ["mp4", "webm"].includes(ext);
        const mediaType = isVideo ? "video" : isGif ? "gif" : "image";
        const blobKey = parsed.id + "/" + singleFile.node.h;
        if (megaBlobCache.has(blobKey)) {
          attachMedia(item, megaBlobCache.get(blobKey), mediaType);
          syncCarouselClones(item);
          return;
        }
        await downloadAndAttachSingleMegaFile(item, parsed.id, singleFile, isVideo, progressOverlay, signal);
        return;
      } else {
        renderArchiveCardUI(item, item.dataset.url, "mega", postTitle, cached.archiveName, signal, cached.details);
        return;
      }
    }

    if (progressOverlay) {
      progressOverlay.style.display = "flex";
      renderMediaProgress(progressOverlay, "Loading...", null, fallbackName || "Mega Folder", "Connecting...", "");
    }

    const folderKeyBytes = base64urlToBytes(parsed.key);
    const data = await megaApiRequest(`id=${Date.now()}&n=${parsed.id}`, [{ a: "f", c: 1, r: 1 }], signal);

    const megaErrCode = Array.isArray(data) ? data[0] : data;
    if (typeof megaErrCode === "number" && megaErrCode < 0) {
      const MEGA_ERRORS = {
        "-2": "Invalid folder ID / arguments",
        "-3": "Mega server temporarily congested — please try again",
        "-9": "Folder not found or link has expired",
        "-11": "Access denied",
        "-16": "Decryption key mismatch",
        "-18": "Blocked by Mega",
        "-509": "Bandwidth quota exceeded — try again later"
      };
      throw new Error(`Mega error ${megaErrCode}: ${MEGA_ERRORS[String(megaErrCode)] || "Temporary Mega issue"}`);
    }
    if (!Array.isArray(data) || !data[0] || !data[0].f) {
      throw new Error("Invalid Mega folder response");
    }

    const decryptedNodes = await decryptAllMegaNodes(data[0].f, folderKeyBytes);

    const mediaFiles = [];
    for (const n of decryptedNodes.values()) {
      if (!n.isFolder && isImageOrVideo(n.name)) {
        mediaFiles.push(n);
      }
    }

    const { headerName, tree } = formatMegaFileTree(decryptedNodes);
    let totalSize = 0;
    for (const n of decryptedNodes.values()) {
      if (!n.isFolder) totalSize += (n.size || 0);
    }
    const archiveName = headerName || fallbackName || "Mega Archive";

    megaFolderCache.set(cacheKey, {
      decryptedNodes,
      archiveName,
      details: {
        totalSize,
        fileCount: mediaFiles.length || decryptedNodes.size,
        tree
      },
      mediaFiles,
      singleFile: mediaFiles.length === 1 ? mediaFiles[0] : null
    });

    if (mediaFiles.length === 1) {
      const singleFile = mediaFiles[0];
      const ext = singleFile.name.split(".").pop().toLowerCase();
      const isGif = ext === "gif";
      const isVideo = ["mp4", "webm"].includes(ext);
      const mediaType = isVideo ? "video" : isGif ? "gif" : "image";
      const blobKey = parsed.id + "/" + singleFile.node.h;

      if (megaBlobCache.has(blobKey)) {
        attachMedia(item, megaBlobCache.get(blobKey), mediaType);
        if (progressOverlay) progressOverlay.style.display = "none";
        syncCarouselClones(item);
        return;
      }

      await downloadAndAttachSingleMegaFile(item, parsed.id, singleFile, isVideo, progressOverlay, signal);
      return;
    }

    if (progressOverlay) progressOverlay.style.display = "none";

    renderArchiveCardUI(item, item.dataset.url, "mega", postTitle, archiveName, signal, {
      totalSize,
      fileCount: mediaFiles.length || decryptedNodes.size,
      tree
    });

  } catch (err) {
    if (signal.aborted) return;
    console.warn("[Mega] handleMegaFolderEmbed warning:", err.message || err);
    if (progressOverlay) {
      const originalUrl = (item && item.dataset && item.dataset.url) || `https://mega.nz/folder/${parsed.id}#${parsed.key}`;
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || (err.message && err.message.match(/Mega error\s+(-\d+)/i)?.[1]) || "404");
      showMediaUnavailableWarning(progressOverlay, {
        type: "zip",
        filename: fallbackName || "Mega Folder",
        errorStatus: detectedStatus,
        message: err.message || "Failed to load Mega folder",
        externalUrl: originalUrl,
        onRetry: () => handleMegaFolderEmbed(item, parsed, progressOverlay, postTitle, fallbackName, signal)
      });
    }
  }
}

export function handleMegaFileCard(item, url, postTitle, filename, progressOverlay, signal) {
  const parsed = parseMegaUrl(url);
  if (!parsed) {
    if (progressOverlay) {
      showMediaUnavailableWarning(progressOverlay, {
        type: "zip",
        filename: filename || "Mega Archive",
        errorStatus: "404",
        message: "Invalid or unsupported Mega link format",
        externalUrl: url
      });
    }
    return;
  }

  if (parsed.type === "file") {
    handleMegaSingleFileEmbed(item, parsed, progressOverlay, postTitle, filename, signal);
    return;
  }

  handleMegaFolderEmbed(item, parsed, progressOverlay, postTitle, filename, signal);
}

async function batchPrefetchMegaDlUrls(files, folderId, signal) {
  const needsDl = files.filter((f) => !f.cachedDlUrl && f.node && f.node.h);
  if (needsDl.length === 0) return;

  const chunks = [];
  for (let i = 0; i < needsDl.length; i += 25) {
    chunks.push(needsDl.slice(i, i + 25));
  }

  await Promise.all(chunks.map(async (chunk) => {
    if (signal && signal.aborted) return;
    try {
      const body = chunk.map((f) => ({ a: "g", g: 1, ssl: 2, n: f.node.h }));
      const data = await megaApiRequest(`id=${Date.now()}&n=${folderId}`, body, signal);
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          if (item && item.g && chunk[idx]) {
            chunk[idx].cachedDlUrl = item.g;
          }
        });
      }
    } catch (e) {
      console.warn("[Mega] Batch prefetch error:", e.message);
    }
  }));
}

export async function openMegaGallery(megaUrl, galleryTitle, post = null) {
  if (post) {
    state.currentGalleryPost = post;
  } else if (!state.currentGalleryPost) {
    state.currentGalleryPost = getCurrentGalleryPost();
  }

  const signal = createExternalAbortSignal();

  if (state.currentZipObjectUrls && state.currentZipObjectUrls.length > 0) {
    state.currentZipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.currentZipObjectUrls = [];
  }

  setZipNavVisible(false, true);
  if (zipViewer) zipViewer.classList.remove("hidden");
  if (zipTitle) zipTitle.textContent = galleryTitle || "Mega Gallery";
  if (zipIndicator) zipIndicator.textContent = "";
  if (zipContent) {
    zipContent.innerHTML = '<div id="zip-progress-text"></div>';
    const pt = document.getElementById("zip-progress-text");
    renderArchiveProgress(pt, "Connecting...", null, galleryTitle || "Mega Gallery");
  }

  try {
    const parsed = parseMegaUrl(megaUrl);
    if (!parsed) throw new Error("Invalid Mega URL format");

    if (parsed.type === "file") {
      await handleSingleMegaFile(parsed, galleryTitle, signal);
      return;
    }

    const cacheKey = parsed.id + "#" + parsed.key;
    let decryptedNodes = null;
    let headerName = null;

    if (megaFolderCache.has(cacheKey)) {
      const cached = megaFolderCache.get(cacheKey);
      decryptedNodes = cached.decryptedNodes;
      headerName = cached.archiveName;
    } else {
      const folderKeyBytes = base64urlToBytes(parsed.key);
      const progressText = document.getElementById("zip-progress-text");
      if (progressText) renderArchiveProgress(progressText, "Fetching folder index...", null, galleryTitle || "Mega Gallery");

      const data = await megaApiRequest(`id=${Date.now()}&n=${parsed.id}`, [{ a: "f", c: 1, r: 1 }], signal);

      const megaErrCode = Array.isArray(data) ? data[0] : data;
      if (typeof megaErrCode === "number" && megaErrCode < 0) {
        const MEGA_ERRORS = {
          "-2": "Bad arguments / invalid folder ID",
          "-3": "Mega server temporarily congested — please try again",
          "-9": "Folder not found or link has expired",
          "-16": "Decryption key mismatch",
          "-18": "Mega blocked this request",
          "-509": "Mega bandwidth quota exceeded — try again later"
        };
        throw new Error(`Mega error ${megaErrCode}: ${MEGA_ERRORS[String(megaErrCode)] || "Unknown Mega error"}`);
      }

      if (!Array.isArray(data) || !data[0] || !data[0].f) {
        throw new Error("Unexpected Mega folder response");
      }

      if (progressText) renderArchiveProgress(progressText, "Decrypting folder index...", null, galleryTitle || "Mega Gallery");

      decryptedNodes = await decryptAllMegaNodes(data[0].f, folderKeyBytes);
      const treeRes = formatMegaFileTree(decryptedNodes);
      headerName = treeRes.headerName;
    }

    const validFiles = [];
    for (const n of decryptedNodes.values()) {
      if (!n.isFolder && isImageOrVideo(n.name)) {
        validFiles.push({
          node: n.node,
          name: n.name,
          rawKey: n.rawKey,
          size: n.size || 0,
          cachedDlUrl: null
        });
      }
    }

    validFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (validFiles.length === 0) {
      if (zipContent) {
        zipContent.innerHTML = '<div style="color:white; margin: auto; text-align: center; padding: 1rem;">No supported images or videos found in this Mega folder.</div>';
      }
      return;
    }

    if (!headerName) {
      const treeRes = formatMegaFileTree(decryptedNodes);
      headerName = treeRes.headerName;
    }

    const pathMap = new Map();
    function getNodePath(nodeHandle) {
      if (pathMap.has(nodeHandle)) return pathMap.get(nodeHandle);
      const n = decryptedNodes.get(nodeHandle);
      if (!n || !n.node.p || !decryptedNodes.has(n.node.p)) {
        const p = n ? n.name : "";
        pathMap.set(nodeHandle, p);
        return p;
      }
      const parentPath = getNodePath(n.node.p);
      const full = parentPath ? `${parentPath}/${n.name}` : n.name;
      pathMap.set(nodeHandle, full);
      return full;
    }

    const folderMap = new Map();
    const cachedBlobs = new Map();

    for (const n of decryptedNodes.values()) {
      if (!n.isFolder && isImageOrVideo(n.name)) {
        const parentPath = n.node.p ? getNodePath(n.node.p) : (headerName || "Mega Archive");
        const folderName = parentPath || headerName || "Mega Archive";

        if (!folderMap.has(folderName)) {
          folderMap.set(folderName, []);
        }

        const directLink = `https://mega.nz/folder/${parsed.id}#${parsed.key}/file/${n.node.h}`;

        folderMap.get(folderName).push({
          node: n.node,
          name: n.name,
          rawKey: n.rawKey,
          size: n.size || 0,
          cachedDlUrl: null,
          directLink
        });
      }
    }

    const folderNames = Array.from(folderMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );

    const folderGroups = folderNames.map((folderName) => {
      const files = folderMap.get(folderName);
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

      return {
        folderName: folderName.split("/").pop() || folderName,
        folderPath: folderName,
        files: files.map((f) => ({
          filename: f.name,
          folder: folderName,
          size: f.size,
          link: f.directLink,
          fileId: f.node.h,
          node: f.node,
          rawKey: f.rawKey,
          cachedDlUrl: f.cachedDlUrl,
          loadMedia: (container, sig) => {
            container.dataset.fileId = f.node.h;
            loadAndDisplayMegaItem(container, f, parsed.id, cachedBlobs, sig);
          }
        }))
      };
    });

    render2DMatrixGallery(folderGroups, { galleryTitle: headerName || galleryTitle, signal });

    if (folderNames.length > 0) {
      const firstFiles = folderMap.get(folderNames[0]);
      if (firstFiles && firstFiles.length > 0) {
        batchPrefetchMegaDlUrls(firstFiles.slice(0, 50), parsed.id, signal).catch(() => {});
      }
      if (folderNames.length > 1) {
        const secondFiles = folderMap.get(folderNames[1]);
        if (secondFiles && secondFiles.length > 0) {
          batchPrefetchMegaDlUrls(secondFiles.slice(0, 25), parsed.id, signal).catch(() => {});
        }
      }
    }

    if (zipContent && folderNames.length > 1) {
      let lastPrefetchedRowIdx = 0;
      let rowPrefetchTimer = null;
      const onScrollPrefetch = () => {
        if (signal.aborted || !zipContent) return;
        clearTimeout(rowPrefetchTimer);
        rowPrefetchTimer = setTimeout(() => {
          const rows = Array.from(zipContent.querySelectorAll(".zip-folder-row"));
          if (rows.length === 0) return;
          const currentScrollY = zipContent.scrollTop;
          const vh = zipContent.clientHeight || window.innerHeight;
          const activeIdx = Math.max(0, Math.min(rows.length - 1, Math.round(currentScrollY / vh)));
          if (activeIdx !== lastPrefetchedRowIdx) {
            lastPrefetchedRowIdx = activeIdx;
            const activeFolder = folderNames[activeIdx];
            if (activeFolder) {
              const files = folderMap.get(activeFolder);
              if (files && files.length > 0) {
                batchPrefetchMegaDlUrls(files.slice(0, 50), parsed.id, signal).catch(() => {});
              }
            }
            const nextFolder = folderNames[activeIdx + 1];
            if (nextFolder) {
              const nextFiles = folderMap.get(nextFolder);
              if (nextFiles && nextFiles.length > 0) {
                batchPrefetchMegaDlUrls(nextFiles.slice(0, 25), parsed.id, signal).catch(() => {});
              }
            }
          }
        }, 120);
      };

      zipContent.addEventListener("scroll", onScrollPrefetch, { passive: true });
    }

  } catch (err) {
    if (signal.aborted) return;
    console.warn("Mega Gallery Warning:", err.message || err);
    if (zipTitle) zipTitle.textContent = "Mega — Error";
    if (zipIndicator) zipIndicator.textContent = "";
    if (zipContent) {
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || "404");
      const isServerError = ["500", "502", "503", "504"].includes(detectedStatus);
      const errorTitle = isServerError ? "Server Error" : "Mega Gallery Unavailable";
      zipContent.innerHTML = `<div style="color:white; margin: auto; text-align: center; padding: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 10px;">
        <span style="color: #ff5555; font-size: 2.2rem; font-weight: 800; font-family: monospace; letter-spacing: 1px; line-height: 1;">${escapeHtml(detectedStatus)}</span>
        <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">${escapeHtml(errorTitle)}</span>
        <span style="color: #ccc; font-size: 0.95rem; max-width: 320px; line-height: 1.4;">${escapeHtml(err.message || "Unknown error")}</span>
        ${megaUrl ? `
          <a href="${escapeHtml(megaUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, 0.15); color: #fff; text-decoration: none; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 8px; padding: 7px 16px; font-size: 0.95rem; font-weight: bold; cursor: pointer; margin-top: 6px; transition: background 0.2s;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> Open Link
          </a>
        ` : ""}
      </div>`;
    }
  }
}

async function handleSingleMegaFile(parsed, title, signal) {
  const progressText = document.getElementById("zip-progress-text");
  if (progressText) renderArchiveProgress(progressText, "Fetching file info...", null, title || "Mega File");

  const rawKey = base64urlToBytes(parsed.key);
  const data = await megaApiRequest(`id=${Date.now()}`, [{ a: "g", g: 1, ssl: 2, p: parsed.id }], signal);

  const megaErrCode = Array.isArray(data) ? data[0] : data;
  if (typeof megaErrCode === "number" && megaErrCode < 0) {
    const MEGA_ERRORS = {
      "-2": "Invalid file ID",
      "-9": "File not found or link has expired",
      "-16": "Decryption key mismatch",
      "-18": "Mega blocked this request",
      "-509": "Mega bandwidth quota exceeded — try again later"
    };
    throw new Error(`Mega error ${megaErrCode}: ${MEGA_ERRORS[String(megaErrCode)] || "Unknown Mega error"}`);
  }

  if (!Array.isArray(data) || !data[0] || !data[0].g) {
    throw new Error("Mega file unavailable or rate limited");
  }

  const downloadUrl = data[0].g;
  let filename = "mega_file";
  if (data[0].at) {
    const attrs = decryptAttributes(data[0].at, rawKey);
    if (attrs && attrs.n) filename = attrs.n;
  }

  const totalSize = data[0].s || 0;
  if (zipTitle) zipTitle.textContent = filename;
  if (zipIndicator) zipIndicator.textContent = "1 / 1";
  if (zipContent) zipContent.dataset.mediaCount = "1";

  if (progressText) {
    renderArchiveProgress(
      progressText,
      "Downloading...",
      null,
      filename,
      totalSize > 0 ? formatBytes(totalSize) : "Connecting...",
      ""
    );
  }

  const blob = await downloadAndDecryptMegaPayload(
    downloadUrl,
    rawKey,
    filename,
    (loaded, total) => {
      if (progressText) {
        const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
        renderArchiveProgress(
          progressText,
          "Downloading...",
          pct,
          filename,
          formatBytes(loaded),
          total > 0 ? formatBytes(total) : ""
        );
      }
    },
    signal,
    totalSize
  );

  const blobUrl = URL.createObjectURL(blob);
  state.currentZipObjectUrls.push(blobUrl);

  if (zipContent) zipContent.innerHTML = "";
  const container = document.createElement("div");
  container.style.flex = "0 0 100vw";
  container.style.height = "100%";
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";

  const ext = filename.split(".").pop().toLowerCase();
  if (["mp4", "webm"].includes(ext)) {
    const video = document.createElement("video");
    video.src = blobUrl;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.loop = true;
    video.muted = true;
    video.style.maxWidth = "100%";
    video.style.maxHeight = "100%";
    video.style.objectFit = "contain";
    container.appendChild(video);
    attachCustomVideoPlayer(video, container);
  } else if (ext === "gif") {
    container.className = "media-item";
    loadGifPlayer({
      item: container,
      url: blobUrl,
      blob,
      filename,
      signal,
      playbackObserver,
    });
  } else {
    const img = document.createElement("img");
    img.src = blobUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    container.appendChild(img);
  }
  if (zipContent) zipContent.appendChild(container);
}

async function loadAndDisplayMegaItem(container, file, folderId, cachedBlobs, signal) {
  if (!file || container.dataset.loaded === "true" || container.dataset.loading === "true") return;

  const ext = (file.name || "").split(".").pop().toLowerCase();
  const isVideo = ["mp4", "webm"].includes(ext);
  const isGif = ext === "gif";

  container.dataset.fileId = file.node.h;
  container.dataset.loading = "true";

  const overlay = container.querySelector(".media-progress");

  try {
    let blobUrl = cachedBlobs.get(file.node.h);
    const globalBlobKey = folderId + "/" + file.node.h;

    if (!blobUrl && megaBlobCache.has(globalBlobKey)) {
      const b = megaBlobCache.get(globalBlobKey);
      blobUrl = URL.createObjectURL(b);
      state.currentZipObjectUrls.push(blobUrl);
      cachedBlobs.set(file.node.h, blobUrl);
    }

    if (!blobUrl) {
      if (overlay) renderMediaProgress(overlay, "Loading...", 0, file.name, "Connecting...", file.size ? formatBytes(file.size) : "");

      let dlUrl = file.cachedDlUrl;
      if (!dlUrl) {
        const data = await megaApiRequest(`id=${Date.now()}&n=${folderId}`, [{ a: "g", g: 1, ssl: 2, n: file.node.h }], signal);
        const megaErr = Array.isArray(data) ? data[0] : data;
        if (typeof megaErr === "number" && megaErr < 0) {
          throw new Error(`Mega error ${megaErr}`);
        }
        dlUrl = data[0]?.g;
      }

      if (!dlUrl) throw new Error("Mega did not return a download URL");

      const totalSize = file.size || file.node?.s || 0;
      if (overlay) {
        renderMediaProgress(
          overlay,
          "Loading...",
          0,
          file.name,
          "0 B",
          totalSize > 0 ? formatBytes(totalSize) : "..."
        );
      }

      const blob = await downloadAndDecryptMegaPayload(
        dlUrl,
        file.rawKey,
        file.name,
        (loaded, total) => {
          if (overlay) {
            const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
            renderMediaProgress(
              overlay,
              "Loading...",
              pct,
              file.name,
              formatBytes(loaded),
              total > 0 ? formatBytes(total) : ""
            );
          }
        },
        signal,
        totalSize
      );

      cacheMegaBlob(globalBlobKey, blob);
      blobUrl = URL.createObjectURL(blob);
      state.currentZipObjectUrls.push(blobUrl);
      cachedBlobs.set(file.node.h, blobUrl);
    }

    container.dataset.loaded = "true";
    container.dataset.loading = "false";
    if (overlay) overlay.style.display = "none";

    const matched = zipContent ? Array.from(zipContent.querySelectorAll(`[data-file-id="${file.node.h}"]`)) : [];
    if (!matched.includes(container)) matched.push(container);

    matched.forEach((c) => {
      c.dataset.loaded = "true";
      c.dataset.loading = "false";
      const o = c.querySelector(".media-progress");
      if (o) o.style.display = "none";

      if (isVideo) {
        if (c.dataset.isClone === "true") {
          if (!c.querySelector(".post-media")) {
            const placeholder = document.createElement("div");
            placeholder.className = "post-media";
            placeholder.style.cssText = "display: flex; align-items: center; justify-content: center; background: #000; width: 100%; height: 100%;";
            placeholder.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="rgba(255,255,255,0.35)"><path d="M8 5v14l11-7z"/></svg>';
            c.appendChild(placeholder);
          }
          return;
        }

        let vid = c.querySelector("video");
        if (!vid) {
          vid = document.createElement("video");
          vid.playsInline = true;
          vid.setAttribute("playsinline", "");
          vid.setAttribute("webkit-playsinline", "");
          vid.loop = true;
          vid.muted = true;
          vid.style.maxWidth = "100%";
          vid.style.maxHeight = "100%";
          vid.style.objectFit = "contain";
          c.appendChild(vid);
          attachCustomVideoPlayer(vid, c);
        }
        vid.src = blobUrl;
      } else if (isGif) {
        if (c.dataset.isClone === "true") {
          if (!c.querySelector(".post-media")) {
            const placeholder = document.createElement("div");
            placeholder.className = "post-media";
            placeholder.style.cssText = "display: flex; align-items: center; justify-content: center; background: #000; width: 100%; height: 100%;";
            placeholder.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="rgba(255,255,255,0.35)"><path d="M8 5v14l11-7z"/></svg>';
            c.appendChild(placeholder);
          }
          return;
        }

        let canvas = c.querySelector("canvas");
        if (!canvas) {
          const cachedBlob = megaBlobCache.get(globalBlobKey);
          const progressEl = c.querySelector(".media-progress");
          loadGifPlayer({
            item: c,
            url: blobUrl,
            blob: cachedBlob,
            filename: file.name,
            progressOverlay: progressEl,
            playbackObserver,
            signal,
            onRetry: () => {
              c.dataset.loading = "false";
              delete c.dataset.loaded;
              loadAndDisplayMegaItem(container, file, folderId, cachedBlobs, signal);
            },
          }).then(() => {
            if (signal && signal.aborted) return;
            c.dataset.loaded = "true";
            c.dataset.loading = "false";
            const prog = c.querySelector(".media-progress");
            if (prog) prog.style.display = "none";
          }).catch((err) => {
            if (signal && signal.aborted) return;
            console.warn(`[Mega] Failed to load GIF ${file.name}:`, err);
          });
        }
      } else {
        let image = c.querySelector("img");
        if (!image) {
          image = document.createElement("img");
          image.style.maxWidth = "100%";
          image.style.maxHeight = "100%";
          image.style.objectFit = "contain";
          image.decoding = "async";
          c.appendChild(image);
        }
        image.src = blobUrl;
        image.style.display = "block";
        if (image.decode) image.decode().catch(() => {});
      }
    });

  } catch (err) {
    if (signal.aborted) return;
    console.warn(`[Mega] Failed to load Mega file ${file.name}:`, err.message || err);
    container.dataset.loading = "false";
    file.cachedDlUrl = null;
    if (overlay) {
      const detectedStatus = String(err.status || (err.message && err.message.match(/HTTP\s+(\d{3})/i)?.[1]) || (err.message && err.message.match(/Mega error\s+(-\d+)/i)?.[1]) || "404");
      showMediaUnavailableWarning(overlay, {
        type: isVideo ? "video" : isGif ? "gif" : "image",
        filename: file.name,
        errorStatus: detectedStatus,
        message: err.message || "Failed to load Mega file",
        onRetry: () => {
          file.cachedDlUrl = null;
          loadAndDisplayMegaItem(container, file, folderId, cachedBlobs, signal);
        }
      });
    }
  }
}