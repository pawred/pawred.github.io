import { state } from "./state.js";
import { closeAllPostInfo, feedView, creatorsView, welcomeScreen, showView, updateNavTabs } from "./nav.js";
import { feed, navigateCarousel, recycleOffscreenCards, resetFeed, getCarouselMetrics } from "./feed.js";
import { zipViewer, zipContent, setZipNavVisible, closeZipGallery, getActiveMediaItem, toggleZipFileInfoModal, navigateFolder } from "./zip.js";

export function initGestures() {
  if (window._gesturesInitialized) return;
  window._gesturesInitialized = true;

  let feedScrollTimeout;
  let recycleTimeout;
  
  let activeCardIndex = 0;
  let isResizing = false;
  let resizeTimer = null;

  window.addEventListener("resize", () => {
    // Handle ZIP 2D Matrix Carousel resize realignment
    if (zipViewer && !zipViewer.classList.contains("hidden") && zipContent) {
      const rows = zipContent.querySelectorAll(".zip-folder-row");
      const winW = window.innerWidth;
      rows.forEach((row) => {
        const count = parseInt(row.dataset.mediaCount || "0", 10);
        if (count > 1) {
          const itemWidth = row.clientWidth || winW;
          const targetIndex = row._targetIndex !== undefined ? row._targetIndex : 1;
          row.scrollTo({ left: targetIndex * itemWidth, behavior: "auto" });
        }
      });
    }

    if (!feed || !feedView || !feedView.classList.contains("active") || !feed.querySelector(".post-card")) return;
    
    isResizing = true;
    feed.style.scrollSnapType = "none"; 
    
    const h = window.innerHeight;
    feed.scrollTo({ top: activeCardIndex * h, behavior: "auto" });

    const carousels = feed.querySelectorAll(".media-carousel");
    carousels.forEach((c) => {
      c.style.scrollSnapType = "none";
      if (!c.dataset.rawIndex) {
        c.dataset.rawIndex = c.children.length > 2 ? "1" : "0";
      }
    });

    const winW = window.innerWidth;
    const offsets = [];
    carousels.forEach((c) => {
      const targetIndex = parseInt(c.dataset.rawIndex, 10) || 0;
      const targetX = c.children[targetIndex] ? c.children[targetIndex].offsetLeft : targetIndex * (c.clientWidth || winW);
      offsets.push(targetX);
    });

    carousels.forEach((c, i) => {
      c.scrollTo({ left: offsets[i], behavior: "auto" });
    });
    
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const finalH = window.innerHeight;
      feed.scrollTo({ top: activeCardIndex * finalH, behavior: "auto" });
      
      const finalWinW = window.innerWidth;
      const finalOffsets = [];
      carousels.forEach((c) => {
        const targetIndex = parseInt(c.dataset.rawIndex, 10) || 0;
        const targetX = c.children[targetIndex] ? c.children[targetIndex].offsetLeft : targetIndex * (c.clientWidth || finalWinW);
        finalOffsets.push(targetX);
      });

      carousels.forEach((c, i) => {
        c.scrollTo({ left: finalOffsets[i], behavior: "auto" });
        c.style.scrollSnapType = "";
      });
      
      feed.style.scrollSnapType = "";
      isResizing = false;
    }, 150); 
  });

  if (feed) {
    feed.addEventListener("scroll", (e) => {
      if (feed._isHorizontalScrolling && feed._restingScrollTop !== undefined) {
        feed.scrollTop = feed._restingScrollTop;
        return;
      }
      if (!isResizing) {
        const h = (feed && feed.clientHeight) || window.innerHeight || 1;
        activeCardIndex = Math.round(feed.scrollTop / h);
      }

      closeAllPostInfo();
      const el = e.target;
      clearTimeout(feedScrollTimeout);
      feedScrollTimeout = setTimeout(() => {
        delete el.dataset.targetScroll;
        delete el.dataset.scrollDir;
        if (!el.classList.contains("continuous-scroll") && feed.querySelector(".post-card")) {
          el.style.scrollSnapType = "";
        }
      }, 150);

      clearTimeout(recycleTimeout);
      recycleTimeout = setTimeout(recycleOffscreenCards, 200);
    });
  }

  document.addEventListener(
    "scroll",
    (e) => {
      if (!e.target || !e.target.classList) return;
      if (e.target.classList.contains("media-carousel")) {
        closeAllPostInfo();
        if (!isResizing) {
          const { firstOffset, step } = getCarouselMetrics(e.target);
          if (step) {
            const hasClones = e.target.children.length > 2;
            e.target.dataset.rawIndex = Math.round((e.target.scrollLeft - firstOffset) / step) + (hasClones ? 1 : 0);
          }
        }
      }
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;

    if (e.key === "Escape") {
      e.preventDefault();

      const settingsMenu = document.getElementById("settings-menu");
      if (settingsMenu && settingsMenu.classList.contains("active")) {
        settingsMenu.classList.remove("active");
        return;
      }

      if (zipViewer && !zipViewer.classList.contains("hidden")) {
        const modal = document.getElementById("zip-file-info-modal");
        if (modal && modal.classList.contains("expanded")) {
          modal.classList.remove("expanded");
          return;
        }
        closeZipGallery();
        return;
      }

      const expandedInfo = document.querySelector(".post-info.expanded");
      if (expandedInfo) {
        closeAllPostInfo();
        return;
      }

      if (feedView && feedView.classList.contains("active")) {
        const navBackBtn = document.getElementById("nav-back");
        const wasCreatorFeed = !!state.currentFeedCreatorName;
        
        state.currentFeedCreatorName = null;
        updateNavTabs(null);
        resetFeed();

        if (wasCreatorFeed) {
          showView(creatorsView, true);
        } else {
          showView(welcomeScreen, false);
          if (navBackBtn) navBackBtn.classList.add("hidden");
        }
        return;
      }

      if (creatorsView && creatorsView.classList.contains("active")) {
        state.currentFeedCreatorName = null;
        updateNavTabs(null);
        resetFeed();
        showView(welcomeScreen, false);
        const navBackBtn = document.getElementById("nav-back");
        if (navBackBtn) navBackBtn.classList.add("hidden");
        return;
      }
    }

    const h = window.innerHeight;

    if (zipViewer && !zipViewer.classList.contains("hidden")) {
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleZipFileInfoModal();
        return;
      }

      if (zipContent && zipContent.classList.contains("gallery-2d-mode")) {
        if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
          e.preventDefault();
          navigateFolder("up");
          return;
        }
        if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
          e.preventDefault();
          navigateFolder("down");
          return;
        }
        if (
          e.key === "ArrowLeft" ||
          e.key.toLowerCase() === "a" ||
          e.key === "ArrowRight" ||
          e.key.toLowerCase() === "d"
        ) {
          e.preventDefault();
          const active = getActiveMediaItem();
          if (active && active.folderRow) {
            const dir = (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") ? "left" : "right";
            navigateCarousel(active.folderRow, dir, active.totalFiles, true);
          }
          return;
        }
        return;
      }

      const count = parseInt(zipContent?.dataset?.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
      if (!zipContent || count <= 1) return;

      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        navigateCarousel(zipContent, "left", count, true);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        navigateCarousel(zipContent, "right", count, true);
      }
      return;
    }

    if (!feedView || !feedView.classList.contains("active") || !feed || !feed.querySelector(".post-card")) return;

    if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
      e.preventDefault();
      let target =
        feed.dataset.targetScroll !== undefined
          ? parseFloat(feed.dataset.targetScroll)
          : Math.round(feed.scrollTop / h) * h;
      target = Math.max(0, target - h);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = "up";
      feed.style.scrollSnapType = "none";
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
    } else if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
      e.preventDefault();
      let target =
        feed.dataset.targetScroll !== undefined
          ? parseFloat(feed.dataset.targetScroll)
          : Math.round(feed.scrollTop / h) * h;
      target = Math.min(target + h, feed.scrollHeight - feed.clientHeight);
      feed.dataset.targetScroll = target;
      feed.dataset.scrollDir = "down";
      feed.style.scrollSnapType = "none";
      feed.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
    } else if (
      e.key === "ArrowLeft" ||
      e.key.toLowerCase() === "a" ||
      e.key === "ArrowRight" ||
      e.key.toLowerCase() === "d"
    ) {
      const currentIndex = Math.round(feed.scrollTop / h);
      const currentCard = feed.children[currentIndex];
      if (!currentCard) return;
      const carousel = currentCard.querySelector(".media-carousel");
      if (!carousel || carousel.children.length <= 1) return;

      e.preventDefault();
      navigateCarousel(
        carousel,
        e.key === "ArrowLeft" || e.key.toLowerCase() === "a" ? "left" : "right",
        undefined,
        true
      );
    }
  });

  function shouldIgnoreFeedGestures(e) {
    if (
      e.target.closest("#nav") ||
      e.target.closest("#zip-nav") ||
      e.target.closest("#zip-indicator") ||
      e.target.closest("#settings-menu") ||
      e.target.closest(".media-progress") ||
      e.target.closest("#creators-view") ||
      e.target.closest(".creators-grid") ||
      e.target.closest(".tags-container") ||
      e.target.closest(".zip-info-text") ||
      e.target.closest(".post-info") ||
      e.target.closest("#nav-tabs") ||
      e.target.closest("#zip-nav-dropdown")
    ) {
      return true;
    }

    if (e.target.closest("#feed")) {
      if (!feed || !feed.querySelector(".post-card") || !e.target.closest(".post-card")) {
        return true;
      }
    }

    return false;
  }

  let wheelAccumX = 0;
  let wheelAccumY = 0;
  let wheelAccumTimer = null;
  const SCROLL_THRESHOLD = 50;

  document.addEventListener(
    "wheel",
    (e) => {
      if (shouldIgnoreFeedGestures(e)) return;

      const textCard = e.target.closest(".post-text-card");
      if (textCard) {
        const atTop = textCard.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = textCard.scrollHeight - textCard.scrollTop <= textCard.clientHeight + 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return;
      }

      const carousel = e.target.closest(".media-carousel");
      const zipC = e.target.closest("#zip-content");
      const feedEl = e.target.closest("#feed");

      const inZip = zipC && zipViewer && !zipViewer.classList.contains("hidden");
      const feedActive = feedEl && feedView && feedView.classList.contains("active") &&
        feed && feed.querySelector(".post-card");
      const continuous = !!(feedEl && feedEl.classList.contains("continuous-scroll"));

      // Only hijack the wheel where we actually navigate; everything else
      // (continuous-scroll feeds, other views) scrolls natively.
      let hijack = false;
      if (inZip) {
        hijack = true;
      } else if (carousel) {
        hijack = !continuous || Math.abs(e.deltaX) >= Math.abs(e.deltaY);
      } else if (feedActive) {
        hijack = !continuous;
      }
      if (!hijack) return;

      if (e.cancelable) e.preventDefault();

      let multiplier = 1;
      if (e.deltaMode === 1) multiplier = 50; 
      else if (e.deltaMode === 2) multiplier = 800; 

      wheelAccumX += e.deltaX * multiplier;
      wheelAccumY += e.deltaY * multiplier;

      clearTimeout(wheelAccumTimer);
      wheelAccumTimer = setTimeout(() => {
        wheelAccumX = 0;
        wheelAccumY = 0;
      }, 150);

      let stepsX = Math.trunc(wheelAccumX / SCROLL_THRESHOLD);
      let stepsY = Math.trunc(wheelAccumY / SCROLL_THRESHOLD);

      if (stepsX === 0 && stepsY === 0) return;

      if (inZip) {
        if (zipC.classList.contains("gallery-2d-mode")) {
          const active = getActiveMediaItem();
          if (Math.abs(stepsY) >= Math.abs(stepsX)) {
            wheelAccumY = 0;
            if (stepsY > 0) navigateFolder("down");
            else if (stepsY < 0) navigateFolder("up");
          } else if (active && active.folderRow) {
            wheelAccumX = 0;
            navigateCarousel(active.folderRow, stepsX > 0 ? "right" : "left", active.totalFiles);
          }
          return;
        }

        wheelAccumX -= stepsX * SCROLL_THRESHOLD;
        wheelAccumY -= stepsY * SCROLL_THRESHOLD;
        
        let steps = Math.abs(stepsX) >= Math.abs(stepsY) ? stepsX : stepsY;
        const count = parseInt(zipC.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
        if (count > 1) {
          navigateCarousel(zipC, steps > 0 ? "right" : "left", count);
        }
        return;
      } else if (carousel && !inZip && Math.abs(wheelAccumX) > Math.abs(wheelAccumY)) {
        wheelAccumX -= stepsX * SCROLL_THRESHOLD;
        wheelAccumY = 0;
        navigateCarousel(carousel, stepsX > 0 ? "right" : "left");
      } else if (feedActive && !continuous) {
        wheelAccumY -= stepsY * SCROLL_THRESHOLD;

        const h = window.innerHeight;
        // One notch of a standard mouse wheel is ~100px, so stepsY can exceed 1;
        // a single wheel event must never move more than one post.
        const step = Math.max(-1, Math.min(1, stepsY));
        // Chain onto the in-flight target (same scheme as keyboard/edge taps)
        // so quick successive notches accumulate instead of chasing the tween.
        let target = feedEl.dataset.targetScroll !== undefined
          ? parseFloat(feedEl.dataset.targetScroll)
          : Math.round(feedEl.scrollTop / h) * h;
        target = Math.max(0, Math.min(target + step * h, feedEl.scrollHeight - feedEl.clientHeight));
        feedEl.dataset.targetScroll = String(target);
        feedEl.style.scrollSnapType = "none";
        feedEl.scrollTo({ top: target, behavior: window.pawAnimationsDisabled ? "auto" : "smooth" });
        wheelAccumX = 0;
      }
    },
    { passive: false }
  );

  let globalTouchStartX = 0;
  let globalTouchStartY = 0;
  let touchHijackHandled = false;
  let gestureLocked = null;
  let activeGestureCarousel = null;
  let activeGestureFolderRow = null;

  const cleanupGestureLock = () => {
    if (activeGestureCarousel) {
      activeGestureCarousel._isVerticalScrolling = false;
      activeGestureCarousel = null;
    }
    if (activeGestureFolderRow) {
      activeGestureFolderRow._isVerticalScrolling = false;
      activeGestureFolderRow = null;
    }
    if (feed) {
      feed._isHorizontalScrolling = false;
    }
    if (zipContent) {
      zipContent._isHorizontalScrolling = false;
    }
    gestureLocked = null;
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      if (shouldIgnoreFeedGestures(e)) return;
      globalTouchStartX = e.touches[0].clientX;
      globalTouchStartY = e.touches[0].clientY;
      touchHijackHandled = false;
      gestureLocked = null;

      activeGestureCarousel = e.target.closest(".media-carousel");
      activeGestureFolderRow = e.target.closest(".zip-folder-row");

      if (activeGestureCarousel) {
        activeGestureCarousel._restingScrollLeft = activeGestureCarousel.scrollLeft;
        activeGestureCarousel._isVerticalScrolling = false;
      }
      if (activeGestureFolderRow) {
        activeGestureFolderRow._restingScrollLeft = activeGestureFolderRow.scrollLeft;
        activeGestureFolderRow._isVerticalScrolling = false;
      }
      if (feed) {
        feed._restingScrollTop = feed.scrollTop;
        feed._isHorizontalScrolling = false;
      }
      if (zipContent) {
        zipContent._restingScrollTop = zipContent.scrollTop;
        zipContent._isHorizontalScrolling = false;
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 1) return;
      if (shouldIgnoreFeedGestures(e)) return;

      const dx = Math.abs(e.touches[0].clientX - globalTouchStartX);
      const dy = Math.abs(e.touches[0].clientY - globalTouchStartY);

      if (gestureLocked === null && (dx > 8 || dy > 8)) {
        if (dy >= dx) {
          gestureLocked = "vertical";
          if (activeGestureCarousel) {
            activeGestureCarousel._isVerticalScrolling = true;
          }
          if (activeGestureFolderRow) {
            activeGestureFolderRow._isVerticalScrolling = true;
          }
        } else {
          gestureLocked = "horizontal";
          if (feed) {
            feed._isHorizontalScrolling = true;
          }
          if (zipContent) {
            zipContent._isHorizontalScrolling = true;
          }
        }
      }

      if (activeGestureCarousel && activeGestureCarousel._isVerticalScrolling && activeGestureCarousel._restingScrollLeft !== undefined) {
        if (activeGestureCarousel.scrollLeft !== activeGestureCarousel._restingScrollLeft) {
          activeGestureCarousel.scrollLeft = activeGestureCarousel._restingScrollLeft;
        }
      }
      if (activeGestureFolderRow && activeGestureFolderRow._isVerticalScrolling && activeGestureFolderRow._restingScrollLeft !== undefined) {
        if (activeGestureFolderRow.scrollLeft !== activeGestureFolderRow._restingScrollLeft) {
          activeGestureFolderRow.scrollLeft = activeGestureFolderRow._restingScrollLeft;
        }
      }

      if (!window.pawAnimationsDisabled) return;

      const textCard = e.target.closest(".post-text-card");
      if (textCard) {
        const textDy = globalTouchStartY - e.touches[0].clientY;
        const atTop = textCard.scrollTop <= 0 && textDy < 0;
        const atBottom = textCard.scrollHeight - textCard.scrollTop <= textCard.clientHeight + 1 && textDy > 0;
        if (!atTop && !atBottom) return;
      }

      if (e.cancelable) e.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("touchcancel", cleanupGestureLock, { passive: true });

  document.addEventListener("touchend", (e) => {
    cleanupGestureLock();

    if (!window.pawAnimationsDisabled) return;
    if (shouldIgnoreFeedGestures(e)) return;

    const textCard = e.target.closest(".post-text-card");
    if (textCard) {
      const dy = globalTouchStartY - e.changedTouches[0].clientY;
      const atTop = textCard.scrollTop <= 0 && dy < 0;
      const atBottom = textCard.scrollHeight - textCard.scrollTop <= textCard.clientHeight + 1 && dy > 0;
      if (!atTop && !atBottom) return;
    }

    if (touchHijackHandled) return;

    const dx = globalTouchStartX - e.changedTouches[0].clientX;
    const dy = globalTouchStartY - e.changedTouches[0].clientY;

    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    touchHijackHandled = true;

    const carousel = e.target.closest(".media-carousel");
    const zipC = e.target.closest("#zip-content");
    const feedEl = e.target.closest("#feed");

    if (zipC && zipViewer && !zipViewer.classList.contains("hidden")) {
      if (zipC.classList.contains("gallery-2d-mode")) {
        const active = getActiveMediaItem();
        if (Math.abs(dy) > Math.abs(dx)) {
          if (dy > 30) navigateFolder("down");
          else if (dy < -30) navigateFolder("up");
        } else if (active && active.folderRow) {
          navigateCarousel(active.folderRow, dx > 30 ? "right" : "left", active.totalFiles);
        }
        return;
      }

      if (Math.abs(dx) > Math.abs(dy)) {
        const count = parseInt(zipC.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
        if (count > 1) {
          navigateCarousel(zipC, dx > 30 ? "right" : "left", count);
        }
      }
      return;
    } else if (carousel && Math.abs(dx) > Math.abs(dy)) {
      navigateCarousel(carousel, dx > 30 ? "right" : "left");
    } else if (feedEl && feedView && feedView.classList.contains("active")) {
      if (!feed || !feed.querySelector(".post-card")) return;
      const h = window.innerHeight;
      let target = Math.round(feedEl.scrollTop / h) * h;
      if (dy > 30) target += h;
      else if (dy < -30) target -= h;
      target = Math.max(0, Math.min(target, feedEl.scrollHeight - feedEl.clientHeight));
      feedEl.scrollTo({ top: target, behavior: "auto" });
    }
  });
}