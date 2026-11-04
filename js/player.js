import { state } from "./state.js";
import { updateNavVisibility, closeAllPostInfo } from "./nav.js";

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h > 0) {
    return `${h}:${remM < 10 ? "0" : ""}${remM}:${remS < 10 ? "0" : ""}${remS}`;
  }
  return `${remM}:${remS < 10 ? "0" : ""}${remS}`;
}

export function getGlobalVolume() {
  const saved = localStorage.getItem("paw_video_volume");
  if (saved !== null) {
    const v = parseFloat(saved);
    if (!isNaN(v) && isFinite(v)) return Math.max(0, Math.min(1, v));
  }
  return 1.0;
}

export function isGlobalUnmuted() {
  return localStorage.getItem("paw_video_unmuted") === "true";
}

let lastNonZeroGlobalVolume = (() => {
  const v = getGlobalVolume();
  return v > 0 ? v : 1.0;
})();

export function getGlobalLastNonZeroVolume() {
  if (lastNonZeroGlobalVolume > 0) return lastNonZeroGlobalVolume;
  const v = getGlobalVolume();
  if (v > 0) {
    lastNonZeroGlobalVolume = v;
    return v;
  }
  return 1.0;
}

export function setGlobalVolume(volume, unmuted = null) {
  const clamped = Math.max(0, Math.min(1, volume));
  if (clamped > 0) {
    lastNonZeroGlobalVolume = clamped;
  }
  localStorage.setItem("paw_video_volume", String(clamped));

  let finalUnmuted;
  if (unmuted !== null) {
    finalUnmuted = Boolean(unmuted);
  } else {
    finalUnmuted = clamped > 0 ? isGlobalUnmuted() : false;
  }
  localStorage.setItem("paw_video_unmuted", finalUnmuted ? "true" : "false");

  document.dispatchEvent(new CustomEvent("paw:syncvolume", {
    detail: {
      volume: clamped,
      unmuted: finalUnmuted,
      lastNonZeroVolume: lastNonZeroGlobalVolume
    }
  }));
}

export function setGlobalMute(muted) {
  const isMuted = Boolean(muted);
  localStorage.setItem("paw_video_unmuted", isMuted ? "false" : "true");

  let targetVol = getGlobalVolume();
  if (!isMuted && targetVol === 0) {
    targetVol = getGlobalLastNonZeroVolume();
    localStorage.setItem("paw_video_volume", String(targetVol));
  }

  document.dispatchEvent(new CustomEvent("paw:syncvolume", {
    detail: {
      volume: targetVol,
      unmuted: !isMuted,
      lastNonZeroVolume: lastNonZeroGlobalVolume
    }
  }));
}

window.addEventListener("storage", (e) => {
  if (e.key === "paw_video_volume" || e.key === "paw_video_unmuted") {
    const vol = getGlobalVolume();
    const unmuted = isGlobalUnmuted();
    if (vol > 0) lastNonZeroGlobalVolume = vol;
    document.dispatchEvent(new CustomEvent("paw:syncvolume", {
      detail: {
        volume: vol,
        unmuted: unmuted,
        lastNonZeroVolume: lastNonZeroGlobalVolume
      }
    }));
  }
});

export function attachCustomVideoPlayer(video, container) {
  if (!video || !container) return;
  if (video._customPlayerAttached) return;

  const existingOverlay = (video.closest(".video-player-wrapper") || container).querySelector(".custom-player-overlay");
  if (existingOverlay) return;

  video._customPlayerAttached = true;
  video.controls = false;
  video.removeAttribute("controls");
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("controlsList", "nodownload nofullscreen noremoteplayback noplaybackrate");
  video.setAttribute("disablePictureInPicture", "true");
  video.setAttribute("disableRemotePlayback", "true");
  if (video.removeAttribute) {
    video.removeAttribute("crossorigin");
  }
  if (video.crossOrigin) {
    video.crossOrigin = null;
  }

  let wrapper = video.closest(".video-player-wrapper");
  let createdWrapper = false;
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.className = "video-player-wrapper";
    if (video.parentNode) {
      video.parentNode.insertBefore(wrapper, video);
    } else {
      container.appendChild(wrapper);
    }
    wrapper.appendChild(video);
    createdWrapper = true;
  }

  // Ensure no duplicate overlays exist in this wrapper
  wrapper.querySelectorAll(".custom-player-overlay").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "custom-player-overlay";

  overlay.innerHTML = `
    <div class="player-scrim-top"></div>
    <div class="player-scrim-bottom"></div>

    <div class="player-skip-indicator skip-left">
      <div class="player-skip-pill">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" fill="#ffffff"/></svg>
        <span class="player-skip-text">-10s</span>
      </div>
    </div>

    <div class="player-skip-indicator skip-right">
      <div class="player-skip-pill">
        <span class="player-skip-text">+10s</span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="#ffffff"/></svg>
      </div>
    </div>

    <button class="player-center-btn" type="button" aria-label="Toggle Play">
      <svg class="player-icon-play" viewBox="0 0 24 24" width="32" height="32" fill="#ffffff"><path d="M8 5v14l11-7z" fill="#ffffff"/></svg>
      <svg class="player-icon-pause" viewBox="0 0 24 24" width="32" height="32" fill="#ffffff" style="display: none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#ffffff"/></svg>
    </button>

    <div class="player-bottom-bar">
      <div class="player-timeline" role="slider" aria-label="Seek timeline" tabindex="0">
        <div class="player-timeline-track">
          <div class="player-timeline-buffered"></div>
          <div class="player-timeline-progress"></div>
        </div>
        <div class="player-timeline-thumb"></div>
      </div>

      <div class="player-controls-row">
        <button class="player-btn player-btn-play" type="button" aria-label="Play / Pause">
          <svg class="player-icon-play" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M8 5v14l11-7z" fill="#ffffff"/></svg>
          <svg class="player-icon-pause" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff" style="display: none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="#ffffff"/></svg>
        </button>

        <button class="player-btn player-btn-skip-back" type="button" aria-label="Rewind 5s" title="Rewind 5 seconds">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M12.5 4c-4.4 0-8 3.6-8 8H1.5l4 4.5 4-4.5H6.5c0-3.3 2.7-6 6-6 3.3 0 6 2.7 6 6s-2.7 6-6 6c-1.6 0-3.1-.7-4.2-1.8l-1.4 1.4C8.4 19 10.4 20 12.5 20c4.4 0 8-3.6 8-8s-3.6-8-8-8z" fill="#ffffff"/>
            <text x="12.5" y="15.5" font-size="8.5" font-weight="800" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif">5</text>
          </svg>
        </button>

        <button class="player-btn player-btn-skip-fwd" type="button" aria-label="Forward 5s" title="Forward 5 seconds">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <g transform="scale(-1, 1) translate(-24, 0)">
              <path d="M12.5 4c-4.4 0-8 3.6-8 8H1.5l4 4.5 4-4.5H6.5c0-3.3 2.7-6 6-6 3.3 0 6 2.7 6 6s-2.7 6-6 6c-1.6 0-3.1-.7-4.2-1.8l-1.4 1.4C8.4 19 10.4 20 12.5 20c4.4 0 8-3.6 8-8s-3.6-8-8-8z" fill="#ffffff"/>
            </g>
            <text x="11.5" y="15.5" font-size="8.5" font-weight="800" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif">5</text>
          </svg>
        </button>

        <div class="player-time-display">
          <span class="player-current-time">0:00</span>
          <span class="player-time-sep">/</span>
          <span class="player-duration-time">0:00</span>
        </div>

        <div class="player-spacer"></div>

        <div class="player-volume-group">
          <div class="player-volume-slider-wrap">
            <div class="player-volume-slider" role="slider" aria-label="Volume" tabindex="0">
              <div class="player-volume-track">
                <div class="player-volume-fill"></div>
              </div>
              <div class="player-volume-thumb"></div>
            </div>
          </div>

          <button class="player-btn player-btn-mute" type="button" aria-label="Mute / Unmute">
            <svg class="player-icon-vol-high" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff" style="display: none;">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="#ffffff"/>
            </svg>
            <svg class="player-icon-vol-low" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff" style="display: none;">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#ffffff"/>
            </svg>
            <svg class="player-icon-muted" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="#ffffff"/>
            </svg>
          </button>
        </div>

        <button class="player-btn player-btn-preload" type="button" aria-label="Preload Full Video" title="Preload entire video into memory">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" fill="#ffffff"/>
          </svg>
          <span class="player-preload-text" style="display: none; font-size: 11px; margin-left: 3px; font-weight: bold;"></span>
        </button>

        <button class="player-btn player-btn-fs" type="button" aria-label="Fullscreen">
          <svg class="player-icon-fs-enter" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" fill="#ffffff"/></svg>
          <svg class="player-icon-fs-exit" viewBox="0 0 24 24" width="22" height="22" fill="#ffffff" style="display: none;"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h-2z" fill="#ffffff"/></svg>
        </button>
      </div>
    </div>
  `;

  wrapper.appendChild(overlay);

  const centerBtn = overlay.querySelector(".player-center-btn");
  const skipLeft = overlay.querySelector(".skip-left");
  const skipRight = overlay.querySelector(".skip-right");
  const skipLeftText = skipLeft.querySelector(".player-skip-text");
  const skipRightText = skipRight.querySelector(".player-skip-text");

  const timeline = overlay.querySelector(".player-timeline");
  const timelineBuffered = overlay.querySelector(".player-timeline-buffered");
  const timelineProgress = overlay.querySelector(".player-timeline-progress");
  const timelineThumb = overlay.querySelector(".player-timeline-thumb");

  const btnPlay = overlay.querySelector(".player-btn-play");
  const btnSkipBack = overlay.querySelector(".player-btn-skip-back");
  const btnSkipFwd = overlay.querySelector(".player-btn-skip-fwd");
  const currentTimeEl = overlay.querySelector(".player-current-time");
  const durationTimeEl = overlay.querySelector(".player-duration-time");
  const btnMute = overlay.querySelector(".player-btn-mute");
  const btnFs = overlay.querySelector(".player-btn-fs");
  const btnPreload = overlay.querySelector(".player-btn-preload");
  const preloadText = overlay.querySelector(".player-preload-text");

  const iconPlay = btnPlay.querySelector(".player-icon-play");
  const iconPause = btnPlay.querySelector(".player-icon-pause");
  const centerPlayIcon = centerBtn.querySelector(".player-icon-play");
  const centerPauseIcon = centerBtn.querySelector(".player-icon-pause");

  const volumeGroup = overlay.querySelector(".player-volume-group");
  const volumeSliderWrap = overlay.querySelector(".player-volume-slider-wrap");
  const volumeSlider = overlay.querySelector(".player-volume-slider");
  const volumeFill = overlay.querySelector(".player-volume-fill");
  const volumeThumb = overlay.querySelector(".player-volume-thumb");
  const volHighIcon = btnMute.querySelector(".player-icon-vol-high");
  const volLowIcon = btnMute.querySelector(".player-icon-vol-low");
  const volMutedIcon = btnMute.querySelector(".player-icon-muted");

  const iconFsEnter = btnFs.querySelector(".player-icon-fs-enter");
  const iconFsExit = btnFs.querySelector(".player-icon-fs-exit");

  const isGif = video.dataset && video.dataset.isGif === "true";
  if (isGif && volumeGroup) {
    volumeGroup.style.display = "none";
  }

  let autoHideTimer = null;
  let singleTapTimer = null;
  let lastTapTime = 0;
  let lastTapSide = null;
  let accumulatedSkip = 0;
  let skipResetTimer = null;
  let isScrubbing = false;
  let isVolumeScrubbing = false;

  if (!isGif) {
    const currentGlobalVol = getGlobalVolume();
    const currentGlobalUnmuted = isGlobalUnmuted();
    video.volume = currentGlobalVol;
    video.muted = !currentGlobalUnmuted;
    video.defaultMuted = !currentGlobalUnmuted;
    if (currentGlobalUnmuted) {
      video.removeAttribute("muted");
    } else {
      video.setAttribute("muted", "");
    }
  }

  function updateVideoDimensions() {
    if (!video.videoWidth || !video.videoHeight) {
      wrapper.style.width = "100%";
      wrapper.style.height = "100%";
      return;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cW = container.clientWidth || window.innerWidth;
    const cH = container.clientHeight || window.innerHeight;

    if (cW > 0 && cH > 0) {
      const scale = Math.min(cW / vw, cH / vh);
      const targetW = Math.round(vw * scale);
      const targetH = Math.round(vh * scale);
      wrapper.style.width = `${targetW}px`;
      wrapper.style.height = `${targetH}px`;
    }
    wrapper.style.aspectRatio = `${vw} / ${vh}`;
  }

  function resetAutoHide() {
    clearTimeout(autoHideTimer);
    if (!video.paused && overlay.classList.contains("controls-visible")) {
      autoHideTimer = setTimeout(() => {
        hideControls();
      }, 3500);
    }
  }

  function showControls() {
    overlay.classList.add("controls-visible");
    resetAutoHide();
  }

  function hideControls() {
    overlay.classList.remove("controls-visible");
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  function toggleControls() {
    const isVisible = overlay.classList.contains("controls-visible");
    if (isVisible) {
      hideControls();
      state.navManualVisible = false;
      window.lastMouseY = -1;
      updateNavVisibility();
      const zipNav = document.getElementById("zip-nav");
      if (zipNav) {
        state.zipNavManualVisible = false;
        zipNav.classList.remove("visible");
      }
    } else {
      showControls();
      state.navManualVisible = true;
      window.lastMouseY = -1;
      updateNavVisibility();
      const zipNav = document.getElementById("zip-nav");
      const zipViewerEl = document.getElementById("zip-viewer");
      if (zipNav && zipViewerEl && !zipViewerEl.classList.contains("hidden")) {
        state.zipNavManualVisible = true;
        zipNav.classList.add("visible");
      }
    }
  }

  let isCushionBuffering = false;
  let userWantsPlayback = !video.paused;
  const TARGET_CUSHION = 3.5;

  function updatePlayState() {
    const isPaused = video.paused && !isCushionBuffering;
    overlay.classList.toggle("is-paused", isPaused);
    iconPlay.style.display = isPaused ? "" : "none";
    iconPause.style.display = isPaused ? "none" : "";
    centerPlayIcon.style.display = isPaused ? "" : "none";
    centerPauseIcon.style.display = isPaused ? "none" : "";

    if (video.paused) {
      clearTimeout(autoHideTimer);
    } else {
      resetAutoHide();
    }
  }

  function getBufferAhead() {
    const cur = video.currentTime;
    if (!video.buffered || video.buffered.length === 0) return 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= cur + 0.4 && video.buffered.end(i) >= cur) {
        return video.buffered.end(i) - cur;
      }
    }
    return 0;
  }

  function showBuffering() {
    overlay.classList.add("is-buffering");
    if (timeline) timeline.classList.add("buffering");
    updatePlayState();
  }

  function hideBuffering() {
    overlay.classList.remove("is-buffering");
    if (timeline) timeline.classList.remove("buffering");
    updatePlayState();
  }

  function triggerBufferPause() {
    if (isCushionBuffering) return;
    isCushionBuffering = true;
    showBuffering();
    video.pause();
  }

  function togglePlay() {
    if (video.paused) {
      userWantsPlayback = true;
      if (video.dataset?.isGif === "true") video._userPaused = false;
      const ahead = getBufferAhead();
      const remaining = (video.duration || 0) - video.currentTime;
      if (ahead < 1.0 && remaining > 1.0) {
        triggerBufferPause();
      } else {
        const p = video.play();
        if (p !== undefined && typeof p.catch === "function") p.catch(() => {});
      }
    } else {
      userWantsPlayback = false;
      isCushionBuffering = false;
      hideBuffering();
      if (video.dataset?.isGif === "true") video._userPaused = true;
      video.pause();
    }
  }

  function updateMuteState() {
    if (isGif) return;
    const isMuted = video.muted || video.volume === 0;
    const currentVol = video.volume;

    if (isMuted) {
      volHighIcon.style.display = "none";
      volLowIcon.style.display = "none";
      volMutedIcon.style.display = "";
      volumeGroup.classList.add("is-muted");
    } else {
      volMutedIcon.style.display = "none";
      volumeGroup.classList.remove("is-muted");
      if (currentVol >= 0.5) {
        volHighIcon.style.display = "";
        volLowIcon.style.display = "none";
      } else {
        volHighIcon.style.display = "none";
        volLowIcon.style.display = "";
      }
    }

    const displayVol = currentVol > 0 ? currentVol : getGlobalLastNonZeroVolume();
    const pct = Math.round(displayVol * 100);
    volumeFill.style.width = `${pct}%`;
    volumeThumb.style.left = `${pct}%`;
  }

  let volumeCollapseTimer = null;

  function toggleMute() {
    if (isGif) return;
    const isMuted = video.muted || video.volume === 0;
    if (isMuted) {
      setGlobalMute(false);
      volumeGroup.classList.add("expanded");
      clearTimeout(volumeCollapseTimer);
      volumeCollapseTimer = setTimeout(() => {
        if (!isVolumeScrubbing && !volumeGroup.matches(":hover")) {
          volumeGroup.classList.remove("expanded");
        }
      }, 2500);
    } else {
      setGlobalMute(true);
      volumeGroup.classList.remove("expanded");
      clearTimeout(volumeCollapseTimer);
    }
  }

  function setVolumeFromEvent(e) {
    if (isGif) return;
    clearTimeout(volumeCollapseTimer);
    const rect = volumeSlider.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setGlobalVolume(pct, pct > 0);
    resetAutoHide();
  }

  let volumeHoverTimer = null;

  volumeGroup.addEventListener("mouseenter", () => {
    clearTimeout(volumeHoverTimer);
    clearTimeout(volumeCollapseTimer);
    volumeGroup.classList.add("expanded");
  });

  volumeGroup.addEventListener("mouseleave", () => {
    if (isVolumeScrubbing) return;
    clearTimeout(volumeHoverTimer);
    volumeHoverTimer = setTimeout(() => {
      if (!isVolumeScrubbing) {
        volumeGroup.classList.remove("expanded");
      }
    }, 350);
  });

  volumeSliderWrap.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    isVolumeScrubbing = true;
    volumeSliderWrap.classList.add("scrubbing");
    setVolumeFromEvent(e);

    const onVolMove = (moveEv) => {
      moveEv.preventDefault();
      setVolumeFromEvent(moveEv);
    };

    const onVolUp = () => {
      isVolumeScrubbing = false;
      volumeSliderWrap.classList.remove("scrubbing");
      window.removeEventListener("mousemove", onVolMove);
      window.removeEventListener("mouseup", onVolUp);
      clearTimeout(volumeHoverTimer);
      volumeHoverTimer = setTimeout(() => {
        if (!volumeGroup.matches(":hover")) {
          volumeGroup.classList.remove("expanded");
        }
      }, 500);
      resetAutoHide();
    };

    window.addEventListener("mousemove", onVolMove);
    window.addEventListener("mouseup", onVolUp);
  });

  volumeSliderWrap.addEventListener("touchstart", (e) => {
    e.stopPropagation();
    isVolumeScrubbing = true;
    volumeSliderWrap.classList.add("scrubbing");
    setVolumeFromEvent(e);
  }, { passive: false });

  volumeSliderWrap.addEventListener("touchmove", (e) => {
    if (isVolumeScrubbing) {
      e.preventDefault();
      e.stopPropagation();
      setVolumeFromEvent(e);
    }
  }, { passive: false });

  const endVolumeScrub = (e) => {
    e.stopPropagation();
    isVolumeScrubbing = false;
    volumeSliderWrap.classList.remove("scrubbing");
    clearTimeout(volumeCollapseTimer);
    volumeCollapseTimer = setTimeout(() => {
      volumeGroup.classList.remove("expanded");
    }, 2000);
    resetAutoHide();
  };
  volumeSliderWrap.addEventListener("touchend", endVolumeScrub);
  volumeSliderWrap.addEventListener("touchcancel", endVolumeScrub);

  let isSeekingTarget = null;

  function updateTimeline() {
    if (isScrubbing || isSeekingTarget !== null || video.seeking) return;
    const duration = video.duration || 0;
    const current = video.currentTime || 0;
    const pct = duration > 0 ? (current / duration) * 100 : 0;

    timelineProgress.style.width = `${pct}%`;
    timelineThumb.style.left = `${pct}%`;
    currentTimeEl.textContent = formatTime(current);

    if (video.buffered && video.buffered.length > 0 && duration > 0) {
      let maxBuffered = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= current + 0.5 && video.buffered.end(i) >= maxBuffered) {
          maxBuffered = video.buffered.end(i);
        }
      }
      const bufPct = Math.min(100, (maxBuffered / duration) * 100);
      timelineBuffered.style.width = `${bufPct}%`;
    }
  }

  let lastSeekTime = 0;
  let pendingSeekTarget = null;
  let seekThrottleTimer = null;

  function applySeek(targetTime) {
    if (!isFinite(targetTime) || isNaN(targetTime)) return;
    isSeekingTarget = targetTime;
    video.currentTime = targetTime;
  }

  function getClientX(e) {
    if (e.clientX !== undefined && e.clientX !== null && !isNaN(e.clientX) && e.clientX > 0) {
      return e.clientX;
    }
    if (e.changedTouches && e.changedTouches[0]) {
      return e.changedTouches[0].clientX;
    }
    if (e.touches && e.touches[0]) {
      return e.touches[0].clientX;
    }
    return 0;
  }

  function seekFromEvent(e, isCommit = false) {
    const rect = timeline.getBoundingClientRect();
    const clientX = getClientX(e);
    if (!clientX && isCommit && isSeekingTarget !== null) {
      applySeek(isSeekingTarget);
      return;
    }
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = isFinite(video.duration) ? video.duration : 0;
    const targetTime = pct * duration;

    timelineProgress.style.width = `${pct * 100}%`;
    timelineThumb.style.left = `${pct * 100}%`;
    currentTimeEl.textContent = formatTime(targetTime);

    if (isCommit) {
      if (seekThrottleTimer) {
        clearTimeout(seekThrottleTimer);
        seekThrottleTimer = null;
      }
      pendingSeekTarget = null;
      applySeek(targetTime);
      return;
    }

    pendingSeekTarget = targetTime;
    const now = Date.now();
    if (now - lastSeekTime > 100) {
      lastSeekTime = now;
      applySeek(targetTime);
    } else if (!seekThrottleTimer) {
      seekThrottleTimer = setTimeout(() => {
        seekThrottleTimer = null;
        if (pendingSeekTarget !== null) {
          lastSeekTime = Date.now();
          applySeek(pendingSeekTarget);
          pendingSeekTarget = null;
        }
      }, 100);
    }
  }

  timeline.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    isScrubbing = true;
    timeline.classList.add("scrubbing");
    seekFromEvent(e);

    const onMouseMove = (moveEv) => {
      moveEv.preventDefault();
      seekFromEvent(moveEv);
    };

    const onMouseUp = (upEv) => {
      isScrubbing = false;
      timeline.classList.remove("scrubbing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      seekFromEvent(upEv, true);
      resetAutoHide();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });

  timeline.addEventListener("touchstart", (e) => {
    e.stopPropagation();
    isScrubbing = true;
    timeline.classList.add("scrubbing");
    seekFromEvent(e);
  }, { passive: false });

  timeline.addEventListener("touchmove", (e) => {
    if (isScrubbing) {
      e.preventDefault();
      e.stopPropagation();
      seekFromEvent(e);
    }
  }, { passive: false });

  const endTimelineScrub = (e) => {
    e.stopPropagation();
    isScrubbing = false;
    timeline.classList.remove("scrubbing");
    seekFromEvent(e, true);
    resetAutoHide();
  };
  timeline.addEventListener("touchend", endTimelineScrub);
  timeline.addEventListener("touchcancel", endTimelineScrub);

  let skipFeedbackTimer = null;

  function showSkipFeedback(side, seconds) {
    const indicator = side === "left" ? skipLeft : skipRight;
    const otherIndicator = side === "left" ? skipRight : skipLeft;
    const textEl = side === "left" ? skipLeftText : skipRightText;
    if (textEl) {
      textEl.textContent = side === "left" ? `-${seconds}s` : `+${seconds}s`;
    }

    otherIndicator.classList.remove("active");
    clearTimeout(skipFeedbackTimer);

    indicator.classList.remove("active");
    void indicator.offsetWidth;
    indicator.classList.add("active");

    skipFeedbackTimer = setTimeout(() => {
      indicator.classList.remove("active");
    }, 800);
  }

  function skipTime(seconds) {
    const duration = isFinite(video.duration) ? video.duration : 0;
    if (seconds < 0) {
      video.currentTime = Math.max(0, video.currentTime + seconds);
    } else {
      video.currentTime = Math.min(duration, video.currentTime + seconds);
    }
    updateTimeline();
  }

  let touchStartX = 0;
  let touchStartY = 0;
  let isDragMove = false;

  overlay.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isDragMove = false;
    }
  }, { passive: true });

  overlay.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (Math.hypot(dx, dy) > 18) {
        isDragMove = true;
      }
    }
  }, { passive: true });

  overlay.addEventListener("click", (e) => {
    e.stopPropagation();

    if (container.querySelector(".media-progress.media-error, .media-progress:has(.retry-media-btn)")) {
      return;
    }

    const expandedInfo = document.querySelector(".post-info.expanded");
    if (expandedInfo) {
      if (e.target.closest(".post-info")) {
        return;
      }
      closeAllPostInfo();
      return;
    }

    if (e.target.closest("button, .player-timeline, .player-volume-slider, a")) {
      return;
    }

    if (isDragMove) {
      isDragMove = false;
      return;
    }

    const y = e.clientY;
    const h = window.innerHeight;
    const edgeCfg = window.pawEdgeConfig || { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 };
    const isVerticalEdge = y < h * (edgeCfg.top ?? 0.05) || y > h * (1 - (edgeCfg.bottom ?? 0.05));

    if (isVerticalEdge) {
      return;
    }

    const rect = overlay.getBoundingClientRect();
    const clickX = e.clientX;
    const relX = (clickX - rect.left) / rect.width;

    const isLeft = relX < 0.38;
    const isRight = relX > 0.62;
    const side = isLeft ? "left" : isRight ? "right" : "center";
    const now = Date.now();

    const isDoubleTap = (now - lastTapTime < 280) && (side === lastTapSide) && (side === "left" || side === "right");

    if (isDoubleTap) {
      if (singleTapTimer) {
        clearTimeout(singleTapTimer);
        singleTapTimer = null;
      }

      accumulatedSkip += 10;
      clearTimeout(skipResetTimer);
      skipResetTimer = setTimeout(() => {
        accumulatedSkip = 0;
      }, 800);

      const skipDelta = side === "left" ? -10 : 10;
      skipTime(skipDelta);
      showSkipFeedback(side, accumulatedSkip);

      lastTapTime = now;
      return;
    }

    if (side === "center") {
      lastTapTime = now;
      lastTapSide = side;
      if (video.paused) {
        togglePlay();
        showControls();
      } else {
        toggleControls();
      }
      return;
    }

    lastTapTime = now;
    lastTapSide = side;
    accumulatedSkip = 0;

    clearTimeout(singleTapTimer);
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null;
      toggleControls();
    }, 260);
  });

  const onContainerClick = (e) => {
    if (e.target.closest(".video-player-wrapper")) return;
    const card = container.closest(".post-card");
    if (card?.dataset.isDragging === "true") return;

    const navEl = document.getElementById("nav");
    const isNavVisible = navEl && navEl.classList.contains("visible");
    const isControlsVisible = overlay.classList.contains("controls-visible");

    if (isNavVisible || isControlsVisible) {
      hideControls();
      state.navManualVisible = false;
      window.lastMouseY = -1;
      updateNavVisibility();
      const zipNav = document.getElementById("zip-nav");
      if (zipNav) {
        state.zipNavManualVisible = false;
        zipNav.classList.remove("visible");
      }
      e.stopPropagation();
      return;
    }

    const x = e.clientX;
    const y = e.clientY;
    const w = window.innerWidth;
    const h = window.innerHeight;

    const edgeCfg = window.pawEdgeConfig || { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 };
    const isVerticalEdge = y < h * (edgeCfg.top ?? 0.05) || y > h * (1 - (edgeCfg.bottom ?? 0.05));

    const carousel = container.closest(".media-carousel") || container.closest(".zip-folder-row");
    const hasMultiple = carousel && (
      parseInt(carousel.dataset.mediaCount || "1", 10) > 1 ||
      carousel.querySelectorAll(".media-item:not([data-is-clone='true'])").length > 1
    );
    const isZipGallery = !!container.closest("#zip-viewer");
    const isHorizontalEdge = (hasMultiple || isZipGallery) && (x < w * (edgeCfg.left ?? 0.05) || x > w * (1 - (edgeCfg.right ?? 0.05)));

    if (isVerticalEdge || isHorizontalEdge) {
      return;
    }

    if (!card) {
      toggleControls();
      e.stopPropagation();
      return;
    }

    toggleControls();
    e.stopPropagation();
  };
  container.addEventListener("click", onContainerClick);

  centerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
    showControls();
  });

  btnPlay.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
    resetAutoHide();
  });

  btnSkipBack.addEventListener("click", (e) => {
    e.stopPropagation();
    skipTime(-5);
    showSkipFeedback("left", 5);
    resetAutoHide();
  });

  btnSkipFwd.addEventListener("click", (e) => {
    e.stopPropagation();
    skipTime(5);
    showSkipFeedback("right", 5);
    resetAutoHide();
  });

  btnMute.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMute();
    resetAutoHide();
  });

  btnFs.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
    resetAutoHide();
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (video.webkitDisplayingFullscreen) {
      try { video.webkitExitFullscreen(); } catch (_) {}
    } else if (wrapper.requestFullscreen) {
      wrapper.requestFullscreen().catch(() => {});
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    } else if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {});
    } else if (video.webkitEnterFullscreen) {
      try { video.webkitEnterFullscreen(); } catch (_) {}
    }
  }

  function updateFsIcon() {
    const isFs = !!document.fullscreenElement || !!video.webkitDisplayingFullscreen;
    iconFsEnter.style.display = isFs ? "none" : "";
    iconFsExit.style.display = isFs ? "" : "none";
  }

  document.addEventListener("fullscreenchange", updateFsIcon);
  video.addEventListener("webkitbeginfullscreen", updateFsIcon);
  video.addEventListener("webkitendfullscreen", updateFsIcon);

  const updateDuration = () => {
    if (isFinite(video.duration) && video.duration > 0) {
      durationTimeEl.textContent = formatTime(video.duration);
    }
  };

  video.addEventListener("durationchange", updateDuration);
  video.addEventListener("loadedmetadata", () => {
    updateDuration();
    updateVideoDimensions();
    updateTimeline();
    updateMuteState();
    updatePlayState();
  });

  video.addEventListener("timeupdate", () => {
    updateTimeline();
    if (durationTimeEl.textContent === "0:00" && isFinite(video.duration) && video.duration > 0) {
      updateDuration();
    }
    // Prevent choppy frame dropping when buffer runs dry while playing
    if (!video.paused && !isCushionBuffering) {
      const ahead = getBufferAhead();
      const remaining = (video.duration || 0) - video.currentTime;
      if (ahead < 0.45 && remaining > 1.0) {
        userWantsPlayback = true;
        triggerBufferPause();
      }
    }
  });

  const checkBufferRecovery = () => {
    updateTimeline();
    const ahead = getBufferAhead();
    const remaining = (video.duration || 0) - video.currentTime;

    if (!isCushionBuffering) {
      if (!video.paused && ahead < 0.45 && remaining > 1.0) {
        userWantsPlayback = true;
        triggerBufferPause();
      } else if (ahead > 0.8) {
        hideBuffering();
      }
      return;
    }

    // Wait until at least TARGET_CUSHION seconds of buffer ahead (or end of file) before resuming
    if (ahead >= TARGET_CUSHION || ahead >= remaining - 0.2 || (video.duration && ahead >= remaining)) {
      isCushionBuffering = false;
      hideBuffering();
      if (userWantsPlayback) {
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    }
  };

  video.addEventListener("progress", () => {
    checkBufferRecovery();
  });
  video.addEventListener("suspend", updateTimeline);
  video.addEventListener("play", updatePlayState);
  video.addEventListener("pause", updatePlayState);
  video.addEventListener("ended", () => {
    isCushionBuffering = false;
    userWantsPlayback = false;
    hideBuffering();
    updatePlayState();
  });
  video.addEventListener("error", () => {
    isCushionBuffering = false;
    userWantsPlayback = false;
    hideBuffering();
    updatePlayState();
  });
  let isInternalVolumeChange = false;

  const onSyncVolume = (e) => {
    if (isGif) return;
    const { volume, unmuted } = e.detail;
    isInternalVolumeChange = true;
    try {
      video.volume = volume;
      video.muted = !unmuted;
      video.defaultMuted = !unmuted;
      if (unmuted) {
        video.removeAttribute("muted");
      } else {
        video.setAttribute("muted", "");
      }
    } finally {
      isInternalVolumeChange = false;
    }
    updateMuteState();
  };
  document.addEventListener("paw:syncvolume", onSyncVolume);

  video.addEventListener("volumechange", () => {
    if (!isInternalVolumeChange && !isGif) {
      const currentVol = video.volume;
      const isMuted = video.muted;
      const savedVol = getGlobalVolume();
      const savedMuted = !isGlobalUnmuted();
      if (Math.abs(currentVol - savedVol) > 0.01 || isMuted !== savedMuted) {
        setGlobalVolume(currentVol, !isMuted);
      }
    }
    updateMuteState();
  });

  video.addEventListener("waiting", () => {
    userWantsPlayback = true;
    triggerBufferPause();
  });

  // Watchdog: In Firefox on Linux, media decoders can stall video frames while audio clock ticks.
  // Detecting when currentTime advances without new video frames recovers the rendering pipeline automatically.
  let lastPresentedFrameTime = -1;
  let lastPresentWallTime = Date.now();
  if (typeof video.requestVideoFrameCallback === "function") {
    const onFrame = (now, metadata) => {
      lastPresentedFrameTime = metadata.mediaTime;
      lastPresentWallTime = Date.now();
      if (video._cleanupCustomPlayer) {
        video.requestVideoFrameCallback(onFrame);
      }
    };
    video.requestVideoFrameCallback(onFrame);

    video.addEventListener("timeupdate", () => {
      if (!video.paused && video.currentTime > 1.5 && lastPresentedFrameTime >= 0) {
        const timeDiff = video.currentTime - lastPresentedFrameTime;
        const wallDiff = Date.now() - lastPresentWallTime;
        if (timeDiff > 1.8 && wallDiff > 1800) {
          // Video frames are frozen while audio advances: nudge decoder to resync
          lastPresentWallTime = Date.now();
          lastPresentedFrameTime = video.currentTime;
          const target = video.currentTime;
          video.currentTime = target;
        }
      }
    });
  }

  video.addEventListener("canplay", () => {
    updateVideoDimensions();
    updateDuration();
    checkBufferRecovery();
  });
  video.addEventListener("canplaythrough", () => {
    updateDuration();
    if (isCushionBuffering) {
      isCushionBuffering = false;
      hideBuffering();
      if (userWantsPlayback) video.play().catch(() => {});
    } else {
      hideBuffering();
    }
  });
  video.addEventListener("seeked", () => {
    isSeekingTarget = null;
    updateTimeline();
  });

  video.addEventListener("playing", () => {
    updateVideoDimensions();
    if (!isCushionBuffering) {
      hideBuffering();
    }
  });

  let preloadAbortController = null;
  let isPreloading = false;
  if (btnPreload) {
    btnPreload.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isPreloading) {
        if (preloadAbortController) {
          try { preloadAbortController.abort(); } catch (_) {}
          preloadAbortController = null;
        }
        isPreloading = false;
        btnPreload.classList.remove("player-preload-active");
        if (preloadText) preloadText.style.display = "none";
        return;
      }

      const mediaUrl = video.src;
      if (!mediaUrl || mediaUrl.startsWith("blob:")) return;

      isPreloading = true;
      btnPreload.classList.add("player-preload-active");
      if (preloadText) {
        preloadText.style.display = "inline";
        preloadText.textContent = "0%";
      }

      preloadAbortController = new AbortController();
      try {
        const res = await fetch(mediaUrl, { signal: preloadAbortController.signal });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const contentLength = +(res.headers.get("content-length") || 0);
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (contentLength > 0 && preloadText) {
            const pct = Math.round((received / contentLength) * 100);
            preloadText.textContent = `${pct}%`;
            timelineBuffered.style.width = `${pct}%`;
          }
        }

        const blob = new Blob(chunks, { type: res.headers.get("content-type") || "video/mp4" });
        const blobUrl = URL.createObjectURL(blob);
        container._preloadedBlobUrl = blobUrl;

        const cur = video.currentTime;
        const paused = video.paused;
        video.src = blobUrl;
        video.currentTime = cur;
        if (!paused) video.play().catch(() => {});

        timelineBuffered.style.width = "100%";
        if (preloadText) {
          preloadText.textContent = "Done";
          setTimeout(() => {
            if (preloadText) preloadText.style.display = "none";
          }, 2000);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Video preload error:", err);
          if (preloadText) preloadText.textContent = "Err";
        }
      } finally {
        isPreloading = false;
      }
    });
  }

  if (video.readyState >= 1) {
    durationTimeEl.textContent = formatTime(video.duration);
    updateVideoDimensions();
    updateTimeline();
  }
  updateMuteState();
  updatePlayState();

  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      updateVideoDimensions();
    });
    resizeObserver.observe(container);
  }
  window.addEventListener("resize", updateVideoDimensions);

  const onGlobalNavHidden = () => {
    hideControls();
  };
  document.addEventListener("paw:navhidden", onGlobalNavHidden);

  video._cleanupCustomPlayer = () => {
    if (preloadAbortController) {
      try { preloadAbortController.abort(); } catch (_) {}
      preloadAbortController = null;
    }
    if (container._preloadedBlobUrl) {
      try { URL.revokeObjectURL(container._preloadedBlobUrl); } catch (_) {}
      container._preloadedBlobUrl = null;
    }
    document.removeEventListener("fullscreenchange", updateFsIcon);
    video.removeEventListener("webkitbeginfullscreen", updateFsIcon);
    video.removeEventListener("webkitendfullscreen", updateFsIcon);
    document.removeEventListener("paw:navhidden", onGlobalNavHidden);
    document.removeEventListener("paw:syncvolume", onSyncVolume);
    window.removeEventListener("resize", updateVideoDimensions);
    if (resizeObserver) resizeObserver.disconnect();
    container.removeEventListener("click", onContainerClick);
    clearTimeout(autoHideTimer);
    clearTimeout(singleTapTimer);
    clearTimeout(skipResetTimer);
    clearTimeout(skipFeedbackTimer);
    clearTimeout(volumeCollapseTimer);
    clearTimeout(volumeHoverTimer);
    overlay.remove();

    if (createdWrapper && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(video, wrapper);
      wrapper.remove();
    }
  };

  return overlay;
}