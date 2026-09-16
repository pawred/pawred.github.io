import { PROXY_URL, state } from "./state.js";

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function showMediaUnavailableWarning(container, optionsOrType = "media", filename = "", errorStatus = "404", onRetry = null) {
  if (!container) return;
  container.style.display = "flex";
  let type = "media";
  let file = "";
  let status = "404";
  let retryFn = null;
  let externalUrl = "";

  if (typeof optionsOrType === "object" && optionsOrType !== null) {
    type = optionsOrType.type || "media";
    file = optionsOrType.filename || "";
    retryFn = optionsOrType.onRetry || null;
    externalUrl = optionsOrType.externalUrl || "";
    const rawMsg = optionsOrType.message || (optionsOrType.error && optionsOrType.error.message) || "";
    const msgMatch = String(rawMsg).match(/HTTP\s+(\d{3})/i) || String(rawMsg).match(/status\s+(\d{3})/i);
    if (optionsOrType.error && optionsOrType.error.status) {
      status = String(optionsOrType.error.status);
    } else if (msgMatch) {
      status = msgMatch[1];
    } else if (optionsOrType.errorStatus && optionsOrType.errorStatus !== "404") {
      status = String(optionsOrType.errorStatus);
    } else if (optionsOrType.status) {
      status = String(optionsOrType.status);
    } else {
      status = optionsOrType.errorStatus || "404";
    }
  } else {
    type = optionsOrType || "media";
    file = filename || "";
    status = errorStatus || "404";
    retryFn = onRetry || null;
  }

  const displayNames = { pawchive: "Pawchive", kemono: "Kemono", cum: "Coomer" };
  const siteName = displayNames[state.currentSite] || state.currentSite;
  const isRateLimited = String(status) === "429";
  const isServerError = ["500", "502", "503", "504"].includes(String(status));
  const customMessage = (typeof optionsOrType === "object" && optionsOrType !== null) ? optionsOrType.message : "";
  const subText = customMessage || (isRateLimited
    ? `Rate limited by ${siteName} (DDoS-Guard / Too Many Requests). Please wait a moment before retrying.`
    : (isServerError
      ? `The remote server encountered an error (${status}). Please try again or open the link directly.`
      : `This file has not yet been imported to ${siteName}, or the server is busy/unavailable.`));

  container.classList.remove("media-loading");
  container.classList.add("media-error");
  container.style.pointerEvents = "auto";
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; gap: 8px; padding: 20px; text-align: center; background: rgba(0,0,0,0.6); border-radius: 12px; box-sizing: border-box; pointer-events: auto;">
      <span style="color: #ff5555; font-size: 2.2rem; font-weight: 800; font-family: monospace; letter-spacing: 1px; line-height: 1;">${escapeHtml(String(status))}</span>
      <span style="color: #ffb86c; font-size: 1.2rem; font-weight: bold;">${isRateLimited ? "Too Many Requests" : (isServerError ? "Server Error" : (type === "zip" ? "Archive" : "Media") + " Unavailable")}</span>
      ${file ? `<span style="color: #ddd; font-size: 0.9rem; max-width: 85vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; font-family: monospace;">${escapeHtml(file)}</span>` : ""}
      <span style="color: #ccc; font-size: 0.95rem; font-weight: normal; max-width: 280px; line-height: 1.4;">
        ${subText}
      </span>
      ${(retryFn || externalUrl) ? `
        <div style="display: inline-flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
          ${retryFn ? `
            <button class="retry-media-btn" type="button" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, 0.15); color: #fff; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 8px; padding: 7px 16px; font-size: 0.95rem; font-weight: bold; cursor: pointer; transition: background 0.2s, transform 0.1s; pointer-events: auto !important; position: relative; z-index: 2; user-select: none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Retry
            </button>
          ` : ""}
          ${externalUrl ? `
            <a class="external-media-btn" href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, 0.15); color: #fff; text-decoration: none; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 8px; padding: 7px 16px; font-size: 0.95rem; font-weight: bold; cursor: pointer; transition: background 0.2s, transform 0.1s; pointer-events: auto !important; position: relative; z-index: 2; user-select: none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> Open Link
            </a>
          ` : ""}
        </div>
      ` : ""}
    </div>
  `;

  if (retryFn) {
    const btn = container.querySelector(".retry-media-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        retryFn();
      });
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      btn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    }
  }

  if (externalUrl) {
    const extBtn = container.querySelector(".external-media-btn");
    if (extBtn) {
      extBtn.addEventListener("click", (e) => e.stopPropagation());
      extBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      extBtn.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    }
  }
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function getServiceColor(service) {
  const s = (service || "").toLowerCase();
  if (s === "fanbox") return "#0096FA";
  if (s === "patreon") return "#F96854";
  if (s === "discord") return "#5865F2";
  if (s === "onlyfans") return "#00AEEF";
  if (s === "fansly") return "#2699F7";
  if (s === "subscribestar") return "#009688";
  if (s === "dlsite") return "#052A83";
  if (s === "gumroad") return "#FF90E8";
  if (s === "boosty") return "linear-gradient(to bottom, #EF7829, #EC5B2B)";
  if (s === "fantia") return "linear-gradient(to right, #8CC13F, #E1097F, #8D2680, #00A098, #383877, #F05B26)";
  return "#222";
}

export function getSiteDomain() {
  if (state.currentSite === "kemono") return "kemono.cr";
  if (state.currentSite === "cum") return "cum.st";
  return "pawchive.pw";
}

export function getServiceCreatorUrl(service, userId) {
  const domain = getSiteDomain();
  const s = encodeURIComponent((service || "").toLowerCase());
  const id = encodeURIComponent(userId || "");
  if (state.currentSite === "cum") {
    return `https://${domain}/creators/${s}/${id}`;
  }
  return `https://${domain}/${s}/user/${id}`;
}

export function getServicePostUrl(service, userId, postId) {
  const domain = getSiteDomain();
  const s = encodeURIComponent((service || "").toLowerCase());
  const uid = encodeURIComponent(userId || "");
  const pid = encodeURIComponent(postId || "");

  if (state.currentFeedEndpoint && state.currentFeedEndpoint.includes("fancards")) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}?type=fancards`;
    }
    return `https://${domain}/${s}/user/${uid}/fancards`;
  }
  if (state.currentFeedEndpoint && state.currentFeedEndpoint.includes("/announcements")) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}/announcements`;
    }
    return `https://${domain}/${s}/user/${uid}/announcements`;
  }
  const isDmFeed = state.currentFeedEndpoint && state.currentFeedEndpoint.includes("/dms");
  const isCumDm = state.currentSite === "cum" && (isDmFeed || (postId && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(postId)));
  if (isDmFeed || isCumDm) {
    if (state.currentSite === "cum") {
      if (postId) {
        return `https://${domain}/creators/${s}/${uid}/dm/${pid}`;
      }
      return `https://${domain}/creators/${s}/${uid}/dms`;
    }
    return `https://${domain}/${s}/user/${uid}/dms`;
  }
  if (postId) {
    if (state.currentSite === "cum") {
      return `https://${domain}/creators/${s}/${uid}/post/${pid}`;
    }
    return `https://${domain}/${s}/user/${uid}/post/${pid}`;
  }
  if (state.currentSite === "cum") {
    return `https://${domain}/creators/${s}/${uid}`;
  }
  return `https://${domain}/${s}/user/${uid}`;
}

export function getMediaUrl(path) {
  if (!path) return null;
  if (path.startsWith(PROXY_URL)) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return `${PROXY_URL}/proxy?url=${encodeURIComponent(path)}`;
  }
  return `${PROXY_URL}/${state.currentSite}/file/data${path}`;
}

const topProgress = document.getElementById("top-progress");

export function startProgress() {
  if (topProgress) {
    topProgress.classList.remove("done");
    topProgress.classList.add("loading");
  }
}

export function stopProgress() {
  if (topProgress) {
    topProgress.classList.remove("loading");
    topProgress.classList.add("done");
  }
}

export function renderMediaProgress(container, status = "Loading...", percent = null, filename = "", loadedStr = "", totalStr = "") {
  if (!container) return;
  container.classList.remove("media-error");
  container.classList.add("media-loading");
  container.style.pointerEvents = "none";

  if (!totalStr || totalStr === "...") {
    const rawSize = container.dataset?.size || container.closest?.(".media-item")?.dataset?.size;
    if (rawSize && !isNaN(Number(rawSize)) && Number(rawSize) > 0) {
      totalStr = formatBytes(Number(rawSize));
    }
  }

  const showPct = percent !== null && percent !== undefined && !isNaN(percent) && (percent > 0 || (loadedStr && loadedStr !== "0 B" && loadedStr !== "Waiting"));
  const pctText = showPct ? ` ${percent}%` : "";
  let sizeText = "";
  if (totalStr && totalStr !== "...") {
    if (loadedStr && loadedStr !== "Waiting" && loadedStr !== "0 B") {
      sizeText = `${loadedStr} / ${totalStr}`;
    } else {
      sizeText = totalStr;
    }
  } else if (loadedStr && loadedStr !== "0 B" && loadedStr !== "Waiting") {
    sizeText = loadedStr;
  }

  const filenameHtml = filename
    ? `<span style="font-size: 1rem; font-weight: normal; color: #ddd; max-width: 85vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; margin: 4px 0;">${escapeHtml(filename)}</span>`
    : "";
  const sizeHtml = sizeText
    ? `<span style="font-size: 1rem; font-weight: normal; color: #aaa; display: block;">${sizeText}</span>`
    : "";

  container.innerHTML = `
    <div>${escapeHtml(status)}${pctText}</div>
    ${filenameHtml}
    ${sizeHtml}
  `;
}

export function renderArchiveProgress(container, status = "Loading...", percent = null, title = "", loadedStr = "", totalStr = "", extraDetail = "") {
  if (!container) return;
  container.style.pointerEvents = "none";

  const showPct = percent !== null && percent !== undefined && !isNaN(percent) && (percent > 0 || (loadedStr && loadedStr !== "0 B"));
  const pctText = showPct ? ` ${percent}%` : "";
  let sizeText = "";
  if (totalStr && totalStr !== "...") {
    if (loadedStr && loadedStr !== "Waiting" && loadedStr !== "0 B") {
      sizeText = `${loadedStr} / ${totalStr}`;
    } else {
      sizeText = totalStr;
    }
  } else if (loadedStr && loadedStr !== "0 B") {
    sizeText = loadedStr;
  }

  const titleHtml = title
    ? `<div style="font-size: 1.05rem; font-weight: normal; color: #ddd; max-width: 85vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(title)}</div>`
    : "";
  const sizeDetail = sizeText && extraDetail ? `${sizeText} • ${escapeHtml(extraDetail)}` : (sizeText || (extraDetail ? escapeHtml(extraDetail) : ""));
  const sizeHtml = sizeDetail
    ? `<div style="font-size: 0.95rem; font-weight: normal; color: #aaa;">${sizeDetail}</div>`
    : "";

  container.innerHTML = `
    <div style="font-size: 1.6rem; font-weight: bold; font-family: monospace; letter-spacing: 0.5px;">${escapeHtml(status)}${pctText}</div>
    ${titleHtml}
    ${sizeHtml}
  `;
}