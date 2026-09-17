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

export function attachCustomVideoPlayer(video, container) {
  if (!video || !container) return;
  if (container.querySelector(".custom-player-overlay")) return;

  video.controls = false;
  video.removeAttribute("controls");
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

  const overlay = document.createElement("div");
  overlay.className = "custom-player-overlay";

  overlay.innerHTML = `
    <div class="player-scrim-top"></div>
    <div class="player-scrim-bottom"></div>

    <div class="player-skip-indicator skip-left">
      <div class="player-skip-pill">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" fill="#ffffff"/></svg>
        <span class="player-skip-text">-5s</span>
      </div>
    </div>

    <div class="player-skip-indicator skip-right">
      <div class="player-skip-pill">
        <span class="player-skip-text">+5s</span>
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

          <div class="player-volume-slider-wrap">
            <div class="player-volume-slider" role="slider" aria-label="Volume" tabindex="0">
              <div class="player-volume-track">
                <div class="player-volume-fill"></div>
              </div>
              <div class="player-volume-thumb"></div>
            </div>
          </div>
        </div>

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
  let lastNonZeroVolume = 1;

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

  function updatePlayState() {
    const isPaused = video.paused;
    overlay.classList.toggle("is-paused", isPaused);
    iconPlay.style.display = isPaused ? "" : "none";
    iconPause.style.display = isPaused ? "none" : "";
    centerPlayIcon.style.display = isPaused ? "" : "none";
    centerPauseIcon.style.display = isPaused ? "none" : "";

    if (isPaused) {
      clearTimeout(autoHideTimer);
    } else {
      resetAutoHide();
    }
  }

  function togglePlay() {
    if (video.paused) {
      if (video.dataset?.isGif === "true") video._userPaused = false;
      const p = video.play();
      if (p !== undefined && typeof p.catch === "function") p.catch(() => {});
    } else {
      if (video.dataset?.isGif === "true") video._userPaused = true;
      video.pause();
    }
  }

  function updateMuteState() {
    if (isGif) return;
    const isMuted = video.muted || video.volume === 0;
    const currentVol = isMuted ? 0 : video.volume;

    if (isMuted) {
      volHighIcon.style.display = "none";
      volLowIcon.style.display = "none";
      volMutedIcon.style.display = "";
      volumeGroup.classList.remove("expanded");
    } else {
      volMutedIcon.style.display = "none";
      if (currentVol >= 0.5) {
        volHighIcon.style.display = "";
        volLowIcon.style.display = "none";
      } else {
        volHighIcon.style.display = "none";
        volLowIcon.style.display = "";
      }
      volumeGroup.classList.add("expanded");
    }

    const pct = Math.round(currentVol * 100);
    volumeFill.style.width = `${pct}%`;
    volumeThumb.style.left = `${pct}%`;
  }

  function toggleMute() {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      video.volume = lastNonZeroVolume > 0 ? lastNonZeroVolume : 1;
      volumeGroup.classList.add("expanded");
    } else {
      lastNonZeroVolume = video.volume > 0 ? video.volume : 1;
      video.muted = true;
      volumeGroup.classList.remove("expanded");
    }
    updateMuteState();
  }

  function setVolumeFromEvent(e) {
    const rect = volumeSlider.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    video.volume = pct;
    if (pct === 0) {
      video.muted = true;
    } else {
      video.muted = false;
      lastNonZeroVolume = pct;
    }
    updateMuteState();
    resetAutoHide();
  }

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
    resetAutoHide();
  };
  volumeSliderWrap.addEventListener("touchend", endVolumeScrub);
  volumeSliderWrap.addEventListener("touchcancel", endVolumeScrub);

  function updateTimeline() {
    if (isScrubbing) return;
    const duration = video.duration || 0;
    const current = video.currentTime || 0;
    const pct = duration > 0 ? (current / duration) * 100 : 0;

    timelineProgress.style.width = `${pct}%`;
    timelineThumb.style.left = `${pct}%`;
    currentTimeEl.textContent = formatTime(current);

    if (video.buffered && video.buffered.length > 0 && duration > 0) {
      let maxBuffered = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= current && video.buffered.end(i) >= maxBuffered) {
          maxBuffered = video.buffered.end(i);
        }
      }
      const bufPct = Math.min(100, (maxBuffered / duration) * 100);
      timelineBuffered.style.width = `${bufPct}%`;
    }
  }

  function seekFromEvent(e) {
    const rect = timeline.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = video.duration || 0;

    timelineProgress.style.width = `${pct * 100}%`;
    timelineThumb.style.left = `${pct * 100}%`;
    currentTimeEl.textContent = formatTime(pct * duration);

    video.currentTime = pct * duration;
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

    const onMouseUp = () => {
      isScrubbing = false;
      timeline.classList.remove("scrubbing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
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
    resetAutoHide();
  };
  timeline.addEventListener("touchend", endTimelineScrub);
  timeline.addEventListener("touchcancel", endTimelineScrub);

  function showSkipFeedback(side, seconds) {
    const indicator = side === "left" ? skipLeft : skipRight;
    const textEl = side === "left" ? skipLeftText : skipRightText;
    textEl.textContent = side === "left" ? `-${seconds}s` : `+${seconds}s`;

    indicator.classList.remove("active");
    void indicator.offsetWidth;
    indicator.classList.add("active");
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
    const expandedInfo = document.querySelector(".post-info.expanded");
    if (expandedInfo) {
      if (e.target.closest(".post-info")) {
        return;
      }
      e.stopPropagation();
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

    e.stopPropagation();

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

      accumulatedSkip += 5;
      clearTimeout(skipResetTimer);
      skipResetTimer = setTimeout(() => {
        accumulatedSkip = 0;
      }, 800);

      if (side === "left") {
        skipTime(-5);
        showSkipFeedback("left", accumulatedSkip);
      } else {
        skipTime(5);
        showSkipFeedback("right", accumulatedSkip);
      }

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
    accumulatedSkip = 5;

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

  video.addEventListener("timeupdate", updateTimeline);
  video.addEventListener("play", updatePlayState);
  video.addEventListener("pause", updatePlayState);
  video.addEventListener("ended", updatePlayState);
  video.addEventListener("volumechange", updateMuteState);

  video.addEventListener("loadedmetadata", () => {
    durationTimeEl.textContent = formatTime(video.duration);
    updateVideoDimensions();
    updateTimeline();
    updateMuteState();
    updatePlayState();
  });

  video.addEventListener("canplay", updateVideoDimensions);
  video.addEventListener("playing", updateVideoDimensions);

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
    document.removeEventListener("fullscreenchange", updateFsIcon);
    video.removeEventListener("webkitbeginfullscreen", updateFsIcon);
    video.removeEventListener("webkitendfullscreen", updateFsIcon);
    document.removeEventListener("paw:navhidden", onGlobalNavHidden);
    window.removeEventListener("resize", updateVideoDimensions);
    if (resizeObserver) resizeObserver.disconnect();
    container.removeEventListener("click", onContainerClick);
    clearTimeout(autoHideTimer);
    clearTimeout(singleTapTimer);
    clearTimeout(skipResetTimer);
    overlay.remove();

    if (createdWrapper && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(video, wrapper);
      wrapper.remove();
    }
  };

  return overlay;
}