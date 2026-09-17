import { PROXY_URL, state } from './js/state.js';
import {
  welcomeScreen,
  creatorsView,
  feedView,
  nav,
  navHome,
  navBack,
  navInfo,
  navSettings,
  settingsMenu,
  siteSelector,
  isNavInteractive,
  updateNavVisibility,
  updateSiteSpecificUI,
  updateNavTabs,
  showView
} from './js/nav.js';
import {
  creatorsList,
  searchInput,
  searchClearBtn,
  clearSearch,
  sortSelect,
  sortDirBtn,
  serviceFilterSelect,
  contentFilterSelect,
  genderFilterSelect,
  paginationContainer,
  paginationTopContainer,
  loadCreators,
  filterAndSortCreators,
  renderServiceFilters
} from './js/creators.js';
import { resetFeed, fetchPosts, navigateCarousel, handleCarouselScrollSettled, smoothScroll, getCarouselMetrics } from './js/feed.js';
import {
  zipViewer,
  zipNav,
  zipContent,
  zipIndicator,
  closeZipViewer,
  zipHomeViewer,
  zipSettingsViewer,
  zipInfoViewer,
  zipFileInfoModal,
  closeZipFileInfo,
  isZipNavInteractive,
  setZipNavVisible,
  updateZipNavVisibility,
  closeZipGallery,
  toggleZipFileInfoModal,
  navigateFolder,
  jumpToFolder,
  updateZipIndicatorsAndHUD,
  getActiveMediaItem
} from './js/zip.js';
import { initGestures } from './js/gestures.js';
import { initEdgeVisualizer, toggleEdgeVisualizer } from './js/edgeVisualizer.js';

window.pawAnimationsDisabled = localStorage.getItem('paw_animations_disabled') === 'true';
window.pawAutoDownloadZip = localStorage.getItem('paw_auto_download_zip') === 'true';
window.pawHideCovers = localStorage.getItem('paw_hide_covers') === 'true';
window.pawHideNoMedia = localStorage.getItem('paw_hideNoMedia') === 'true';
window.pawHideText = localStorage.getItem('paw_hide_text') === 'true';
window.pawHideWip = localStorage.getItem('paw_hide_wip') === 'true';
const savedPreload = localStorage.getItem('paw_preload_count');
window.pawPreloadCount = savedPreload !== null ? parseInt(savedPreload, 10) : 1;
window.pawCustomGifPlayer = localStorage.getItem('paw_custom_gif_player') !== 'false';
window.pawProgressiveImages = localStorage.getItem('paw_progressive_images') === 'true';
if (window.pawAnimationsDisabled) document.body.classList.add('no-animations');

function formatWorkerVersion(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  const uuidMatch = trimmed.match(/^([0-9a-f]{8})-[0-9a-f]{4}/i);
  if (uuidMatch) {
    return uuidMatch[1].toLowerCase();
  }
  const hexMatch = trimmed.match(/^[0-9a-f]{8}$/i);
  if (hexMatch) {
    return hexMatch[0].toLowerCase();
  }
  return trimmed;
}

(async function checkWorkerVersion() {
  try {
    const res = await fetch(`${PROXY_URL}/version`);
    if (res.ok) {
      const data = await res.json();
      const rawVersion = (data && data.version) ? data.version : (data && data.id ? data.id : data);
      const version = formatWorkerVersion(rawVersion);
      window.pawWorkerVersion = version;
      console.log(`Worker deployed version: ${version}`);
    } else {
      const headerVersion = res.headers.get('X-Worker-Version');
      if (headerVersion) {
        const version = formatWorkerVersion(headerVersion);
        window.pawWorkerVersion = version;
        console.log(`Worker deployed version: ${version}`);
      } else {
        console.warn(`Worker deployed version: Unknown (HTTP ${res.status})`);
      }
    }
  } catch (err) {
    console.warn('Worker deployed version: Unable to connect to worker', err);
  }
})();

const settingHideNoMedia = document.getElementById('setting-hide-no-media');
if (settingHideNoMedia) {
  settingHideNoMedia.checked = window.pawHideNoMedia;
  settingHideNoMedia.addEventListener('change', () => {
    window.pawHideNoMedia = settingHideNoMedia.checked;
    localStorage.setItem('paw_hideNoMedia', window.pawHideNoMedia);
    if (feedView && feedView.classList.contains('active')) {
      resetFeed();
      fetchPosts();
    }
  });
}

const settingHideText = document.getElementById('setting-hide-text');
if (settingHideText) {
  settingHideText.checked = window.pawHideText;
  settingHideText.addEventListener('change', (e) => {
    window.pawHideText = e.target.checked;
    localStorage.setItem('paw_hide_text', window.pawHideText);
    if (feedView && feedView.classList.contains('active')) {
      resetFeed();
      fetchPosts();
    }
  });
}

const settingHideWip = document.getElementById('setting-hide-wip');
if (settingHideWip) {
  settingHideWip.checked = window.pawHideWip;
  settingHideWip.addEventListener('change', (e) => {
    window.pawHideWip = e.target.checked;
    localStorage.setItem('paw_hide_wip', window.pawHideWip);
    if (feedView && feedView.classList.contains('active')) {
      resetFeed();
      fetchPosts();
    }
  });
}

const settingDisableAnimations = document.getElementById('setting-disable-animations');
if (settingDisableAnimations) {
  settingDisableAnimations.checked = window.pawAnimationsDisabled;
  settingDisableAnimations.addEventListener('change', (e) => {
    window.pawAnimationsDisabled = e.target.checked;
    localStorage.setItem('paw_animations_disabled', window.pawAnimationsDisabled);
    if (window.pawAnimationsDisabled) {
      document.body.classList.add('no-animations');
    } else {
      document.body.classList.remove('no-animations');
    }
  });
}

const settingProgressiveImages = document.getElementById('setting-progressive-images');
if (settingProgressiveImages) {
  settingProgressiveImages.checked = window.pawProgressiveImages;
  settingProgressiveImages.addEventListener('change', (e) => {
    window.pawProgressiveImages = e.target.checked;
    localStorage.setItem('paw_progressive_images', window.pawProgressiveImages);
  });
}

const settingAutoDownloadZip = document.getElementById('setting-auto-download-zip');
if (settingAutoDownloadZip) {
  settingAutoDownloadZip.checked = window.pawAutoDownloadZip;
  settingAutoDownloadZip.addEventListener('change', (e) => {
    window.pawAutoDownloadZip = e.target.checked;
    localStorage.setItem('paw_auto_download_zip', window.pawAutoDownloadZip);
  });
}

const settingHideCovers = document.getElementById('setting-hide-covers');
if (settingHideCovers) {
  settingHideCovers.checked = window.pawHideCovers;
  settingHideCovers.addEventListener('change', (e) => {
    window.pawHideCovers = e.target.checked;
    localStorage.setItem('paw_hide_covers', window.pawHideCovers);
    if (feedView && feedView.classList.contains('active')) {
      resetFeed();
      fetchPosts();
    }
  });
}

const settingPreloadCount = document.getElementById('setting-preload-count');
if (settingPreloadCount) {
  settingPreloadCount.value = String(window.pawPreloadCount);
  settingPreloadCount.addEventListener('change', (e) => {
    window.pawPreloadCount = parseInt(e.target.value, 10);
    localStorage.setItem('paw_preload_count', window.pawPreloadCount);
  });
}

const settingCustomGifPlayer = document.getElementById('setting-custom-gif-player');
if (settingCustomGifPlayer) {
  settingCustomGifPlayer.checked = window.pawCustomGifPlayer;
  settingCustomGifPlayer.addEventListener('change', (e) => {
    window.pawCustomGifPlayer = e.target.checked;
    localStorage.setItem('paw_custom_gif_player', window.pawCustomGifPlayer);
  });
}

const settingVisualizeEdges = document.getElementById('setting-visualize-edges');
if (settingVisualizeEdges) {
  settingVisualizeEdges.checked = localStorage.getItem('paw_show_edges') === 'true';
  settingVisualizeEdges.addEventListener('change', (e) => {
    toggleEdgeVisualizer(e.target.checked);
  });
}

document.addEventListener('mousemove', (e) => {
  window.lastMouseY = e.clientY;
  updateNavVisibility();
});

if (navInfo) {
  navInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (el) {
      const card = el.closest('.post-card');
      if (card) {
        const info = card.querySelector('.post-info');
        if (info) {
          info.classList.toggle('expanded');
          updateNavVisibility();
        }
      }
    }
  });
}

if (navSettings && settingsMenu) {
  navSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    settingsMenu.classList.toggle('active');
  });
  
  document.addEventListener('click', (e) => {
    const isZipSettings = document.getElementById('zip-settings-viewer') && e.target === document.getElementById('zip-settings-viewer');
    if (!settingsMenu.contains(e.target) && e.target !== navSettings && !isZipSettings) {
      settingsMenu.classList.remove('active');
    }
  });
}

export function resetHomeState() {
  state.creatorPage = 1;
  state.creatorSortDir = 'desc';
  if (sortDirBtn) {
    sortDirBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>';
  }
  clearSearch();
  if (creatorsList) creatorsList.innerHTML = '';
  if (paginationTopContainer) paginationTopContainer.innerHTML = '';
  if (paginationContainer) paginationContainer.innerHTML = '';
  if (sortSelect) sortSelect.value = 'popularity';
  if (contentFilterSelect) contentFilterSelect.value = state.currentSite === 'cum' ? 'content' : 'all';
  if (genderFilterSelect) genderFilterSelect.value = 'all';
  if (serviceFilterSelect) {
    const checkboxes = serviceFilterSelect.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => (cb.checked = false));
  }
}

if (siteSelector) {
  state.currentSite = siteSelector.value;
  resetHomeState();
  updateSiteSpecificUI();
  renderServiceFilters(state.currentSite);
  siteSelector.addEventListener('change', (e) => { 
    state.currentSite = e.target.value; 
    resetHomeState();
    updateSiteSpecificUI();
    renderServiceFilters(state.currentSite);
  });
} else {
  resetHomeState();
  renderServiceFilters(state.currentSite);
}

window.addEventListener('pageshow', () => {
  resetHomeState();
});

const navTabsEl = document.getElementById('nav-tabs');
if (navTabsEl) {
  navTabsEl.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0 && e.deltaX === 0) {
      let multiplier = 1;
      if (e.deltaMode === 1) multiplier = 35;
      else if (e.deltaMode === 2) multiplier = 600;
      navTabsEl.scrollLeft += e.deltaY * multiplier;
      e.preventDefault();
    }
  }, { passive: false });
}

if (navHome) {
  navHome.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    state.navManualVisible = false;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
    
    resetFeed();
    resetHomeState();
  });
}

if (navBack) {
  navBack.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    
    if (feedView && feedView.classList.contains('active')) {
      const wasCreatorFeed = !!state.currentFeedCreatorName;
      
      state.currentFeedCreatorName = null;
      updateNavTabs(null);
      resetFeed();
      
      if (wasCreatorFeed) {
        showView(creatorsView, true);
      } else {
        showView(welcomeScreen, false);
        navBack.classList.add('hidden');
        resetHomeState();
      }
    } 
    else if (creatorsView && creatorsView.classList.contains('active')) {
      showView(welcomeScreen, false);
      navBack.classList.add('hidden');
      resetHomeState();
    }
  });
}

const btnLatest = document.getElementById('btn-latest');
if (btnLatest) {
  btnLatest.addEventListener('click', () => {
    resetFeed();
    state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/posts`;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    if (navBack) navBack.classList.remove('hidden'); 
    showView(feedView, true);
    loadCreators();
    fetchPosts();
  });
}

const btnCreators = document.getElementById('btn-creators');
if (btnCreators) {
  btnCreators.addEventListener('click', () => {
    state.creatorPage = 1;
    showView(creatorsView, true);
    if (navBack) navBack.classList.remove('hidden'); 
    loadCreators();
  });
}

let searchTimeout;
if (searchInput) {
  searchInput.addEventListener('input', () => {
    if (searchClearBtn) {
      searchClearBtn.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
    }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.creatorPage = 1;
      filterAndSortCreators();
    }, 400);
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    clearSearch();
    state.creatorPage = 1;
    if (searchInput) searchInput.focus();
    filterAndSortCreators();
  });
}

if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (sortDirBtn) {
  sortDirBtn.addEventListener('click', () => {
    state.creatorSortDir = (state.creatorSortDir === 'asc' ? 'desc' : 'asc');
    sortDirBtn.innerHTML = (state.creatorSortDir === 'asc' 
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>' 
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>');
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (serviceFilterSelect) {
  serviceFilterSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (contentFilterSelect) {
  contentFilterSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (genderFilterSelect) {
  genderFilterSelect.addEventListener('change', () => {
    state.creatorPage = 1;
    filterAndSortCreators();
  });
}

if (closeZipViewer) {
  closeZipViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    closeZipGallery();
  });
}

if (zipSettingsViewer && settingsMenu) {
  zipSettingsViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    settingsMenu.classList.toggle('active');
  });
}

if (zipHomeViewer) {
  zipHomeViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    closeZipGallery();
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
    
    resetFeed();
  });
}

if (zipInfoViewer) {
  zipInfoViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    toggleZipFileInfoModal();
  });
}

if (closeZipFileInfo) {
  closeZipFileInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleZipFileInfoModal(false);
  });
}

if (zipIndicator && zipContent) {
  zipIndicator.addEventListener('click', (e) => {
    e.stopPropagation();
    if (zipContent.classList.contains('gallery-2d-mode')) {
      const active = getActiveMediaItem();
      if (active && active.folderRow) {
        if (active.fileIdx > 0) {
          const count = active.totalFiles;
          const itemWidth = active.folderRow.clientWidth || window.innerWidth;
          const targetX = count > 1 ? 1 * itemWidth : 0;
          active.folderRow._targetIndex = 1;
          smoothScroll(active.folderRow, targetX, window.pawAnimationsDisabled ? 0 : 140, () => {
            active.folderRow._targetIndex = undefined;
            active.folderRow.scrollLeft = targetX;
            updateZipIndicatorsAndHUD();
          });
          return;
        } else if (active.folderIdx > 0) {
          jumpToFolder(0);
          return;
        }
      }
    } else {
      const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
      const itemWidth = zipContent.clientWidth || window.innerWidth;
      const targetX = count > 1 ? 1 * itemWidth : 0;
      smoothScroll(zipContent, targetX, window.pawAnimationsDisabled ? 0 : 140, () => {
        zipContent._targetIndex = undefined;
        zipContent.scrollLeft = targetX;
        updateZipIndicatorsAndHUD();
      });
      return;
    }
  });
}

if (zipViewer) {
  zipViewer.addEventListener('mousemove', updateZipNavVisibility);

  let zipTouchStartX = 0;
  let zipTouchStartY = 0;
  let zipIsDragging = false;

  zipViewer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      zipTouchStartX = e.touches[0].clientX;
      zipTouchStartY = e.touches[0].clientY;
      zipIsDragging = false;
    }
  }, { passive: true });

  zipViewer.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - zipTouchStartX;
      const dy = e.touches[0].clientY - zipTouchStartY;
      if (Math.hypot(dx, dy) > 18) {
        zipIsDragging = true;
      }
    }
  }, { passive: true });

  zipViewer.addEventListener('click', (e) => {
    if (zipIsDragging) {
      zipIsDragging = false;
      return;
    }

    if (
      e.target.tagName.toLowerCase() === 'button' ||
      e.target.closest('#zip-nav') ||
      e.target.closest('#zip-indicator') ||
      e.target.closest('#settings-menu') ||
      e.target.closest('.dropbox-browser-root') ||
      e.target.closest('#zip-file-info-modal') ||
      e.target.closest('#zip-nav-dropdown')
    ) {
      return;
    }

    if (e.target.tagName.toLowerCase() === 'video') {
      const r = e.target.getBoundingClientRect();
      if (e.clientY >= r.bottom - 60 && e.clientY <= r.bottom + 10) {
        return;
      }
    }

    const dropdown = document.getElementById("zip-nav-dropdown");
    if (dropdown) {
      if (typeof dropdown._cleanup === 'function') dropdown._cleanup();
      dropdown.remove();
      const openBtns = document.querySelectorAll(".zip-nav-tab-btn.open");
      openBtns.forEach((b) => {
        b.classList.remove("open");
        b.classList.remove("active");
      });
      return;
    }

    const modal = document.getElementById("zip-file-info-modal");
    if (modal && modal.classList.contains("expanded")) {
      modal.classList.remove("expanded");
      return;
    }

    const isZipNavVisible = zipNav && zipNav.classList.contains("visible");
    // If nav buttons are currently visible, tapping anywhere on the screen hides them!
    if (isZipNavVisible) {
      setZipNavVisible(false, true);
      return;
    }

    const edgeCfg = window.pawEdgeConfig || { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 };
    const x = e.clientX;
    const y = e.clientY;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const leftThreshold = w * (edgeCfg.left ?? 0.05);
    const rightThreshold = w * (1 - (edgeCfg.right ?? 0.05));
    const topThreshold = h * (edgeCfg.top ?? 0.05);
    const bottomThreshold = h * (1 - (edgeCfg.bottom ?? 0.05));

    // In 2D Matrix mode: tap edges
    if (zipContent && zipContent.classList.contains('gallery-2d-mode')) {
      const active = getActiveMediaItem();
      if (active && active.folderRow) {
        const hasMultipleFiles = active.totalFiles > 1;
        const isLeft = x < leftThreshold;
        const isRight = x > rightThreshold;
        const isTop = y < topThreshold;
        const isBottom = y > bottomThreshold;

        // When there are 2 or more files, left and right edges have priority on the corners
        if (hasMultipleFiles && (isLeft || isRight)) {
          if (isLeft) {
            navigateCarousel(active.folderRow, 'left', active.totalFiles);
            return;
          }
          if (isRight) {
            navigateCarousel(active.folderRow, 'right', active.totalFiles);
            return;
          }
        }

        if (isTop) {
          navigateFolder('up');
          return;
        }
        if (isBottom) {
          navigateFolder('down');
          return;
        }

        if (isLeft) {
          if (hasMultipleFiles) {
            navigateCarousel(active.folderRow, 'left', active.totalFiles);
          } else if (active.totalFolders > 1) {
            navigateFolder('up');
          }
          return;
        }
        if (isRight) {
          if (hasMultipleFiles) {
            navigateCarousel(active.folderRow, 'right', active.totalFiles);
          } else if (active.totalFolders > 1) {
            navigateFolder('down');
          }
          return;
        }
      }
      setZipNavVisible(true, true);
      return;
    }

    const count = parseInt(zipContent?.dataset?.mediaCount || "0", 10) || state.currentZipObjectUrls.length;

    if (count > 1) {
      if (x < leftThreshold) {
        navigateCarousel(zipContent, 'left', count);
        return;
      } else if (x > rightThreshold) {
        navigateCarousel(zipContent, 'right', count);
        return;
      }
    }

    setZipNavVisible(true, true);
  });
}

if (zipContent) {
  let zipScrollSettleTimer;

  zipContent.addEventListener('touchstart', () => {
    zipContent._isTouching = true;
    clearTimeout(zipScrollSettleTimer);
  }, { passive: true });

  zipContent.addEventListener('touchend', () => {
    zipContent._isTouching = false;
    const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
    if (count > 1 && !zipContent._animId && !zipContent.classList.contains('gallery-2d-mode')) {
      clearTimeout(zipScrollSettleTimer);
      zipScrollSettleTimer = setTimeout(() => {
        handleCarouselScrollSettled(zipContent, count);
      }, 150);
    }
  }, { passive: true });

  zipContent.addEventListener('touchcancel', () => {
    zipContent._isTouching = false;
  }, { passive: true });

  zipContent.addEventListener('scroll', () => {
    if (zipContent.classList.contains('gallery-2d-mode')) return;
    const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
    if (count <= 1) return;
    const { firstOffset, step } = getCarouselMetrics(zipContent);
    if (!step) return;
    const rawIndex = Math.round((zipContent.scrollLeft - firstOffset) / step) + 1;
    const realIndex = ((rawIndex - 1) % count + count) % count;
    if (zipIndicator) zipIndicator.textContent = `${realIndex + 1} / ${count}`;

    if (!zipContent._animId && !zipContent._isTouching) {
      clearTimeout(zipScrollSettleTimer);
      zipScrollSettleTimer = setTimeout(() => {
        handleCarouselScrollSettled(zipContent, count);
      }, 150);
    }
  });

  zipContent.addEventListener('scrollend', () => {
    if (zipContent.classList.contains('gallery-2d-mode')) return;
    const count = parseInt(zipContent.dataset.mediaCount || "0", 10) || state.currentZipObjectUrls.length;
    if (count > 1 && !zipContent._animId && !zipContent._isTouching) {
      handleCarouselScrollSettled(zipContent, count);
    }
  });
}

initGestures();
initEdgeVisualizer();