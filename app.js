import { PROXY_URL, state } from './js/state.js';
import { fetchWithRetry } from './js/utils.js';
import {
  welcomeScreen,
  creatorsView,
  feedView,
  nav,
  navHome,
  navBack,
  navInfo,
  navBlacklist,
  navSettings,
  settingsMenu,
  blacklistMenu,
  siteSelector,
  isNavInteractive,
  updateNavVisibility,
  updateSiteSpecificUI,
  updateNavTabs,
  updateSourceSwitcher,
  showView,
  triggerAppBack,
  ensureHistoryCushion,
  releaseHistoryCushion,
  isAtRootView,
  setResetHomeCallback,
  setCloseZipCallback,
  initNavigationHistory
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
import { resetFeed, fetchPosts, navigateCarousel, handleCarouselScrollSettled, smoothScroll, getCarouselMetrics, applyBlacklistToCurrentFeed } from './js/feed.js';
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
import {
  getE621Auth,
  saveE621Auth,
  getE621Blacklist,
  saveE621Blacklist,
  isE621BlacklistEnabled,
  setE621BlacklistEnabled,
  fetchE621UserProfile,
  initBlacklistStorage
} from './js/e621Auth.js';
import { getGelbooruAuth, saveGelbooruAuth } from './js/gelbooruAuth.js';
import { attachTagAutocomplete } from './js/autocomplete.js';
import {
  getPreferredNitterHost,
  setPreferredNitterHost,
  fetchTwitterFollowing,
  saveTwitterFollowing,
  clearTwitterFollowing,
  getSavedTwitterFollowing,
  parseTwitterFollowingInput,
  cleanTwitterHandle,
  formatTwitterHandle,
  isValidTwitterHandle,
  getTwitterFollowingFeedState
} from './js/twitter.js';

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
    const res = await fetchWithRetry(`${PROXY_URL}/version`, {}, 2);
    if (res && res.ok) {
      const data = await res.json();
      const rawVersion = (data && data.version) ? data.version : (data && data.id ? data.id : data);
      const version = formatWorkerVersion(rawVersion);
      window.pawWorkerVersion = version;
      console.log(`Worker deployed version: ${version}`);
    } else if (res) {
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

// e621 Account (Home page)
const settingE621Username = document.getElementById('setting-e621-username');
const settingE621ApiKey = document.getElementById('setting-e621-api-key');
const btnE621SaveAuth = document.getElementById('btn-e621-save-auth');
const e621AuthStatus = document.getElementById('e621-auth-status');

const initialE621Auth = getE621Auth();
if (settingE621Username) settingE621Username.value = initialE621Auth.username || '';
if (settingE621ApiKey) settingE621ApiKey.value = initialE621Auth.apiKey || '';

// Gelbooru Account (Home page)
const settingGelbooruUserId = document.getElementById('setting-gelbooru-user-id');
const settingGelbooruApiKey = document.getElementById('setting-gelbooru-api-key');
const btnGelbooruSaveAuth = document.getElementById('btn-gelbooru-save-auth');
const gelbooruAuthStatus = document.getElementById('gelbooru-auth-status');

const initialGelbooruAuth = getGelbooruAuth();
if (settingGelbooruUserId) settingGelbooruUserId.value = initialGelbooruAuth.userId || '';
if (settingGelbooruApiKey) settingGelbooruApiKey.value = initialGelbooruAuth.apiKey || '';

// Blacklist Menu (Drawer)
const blacklistMenuEnable = document.getElementById('blacklist-menu-enable');
const blacklistMenuTags = document.getElementById('blacklist-menu-tags');
const btnBlacklistMenuSync = document.getElementById('btn-blacklist-menu-sync');
const btnBlacklistMenuClear = document.getElementById('btn-blacklist-menu-clear');
const btnBlacklistMenuSave = document.getElementById('btn-blacklist-menu-save');
const blacklistMenuStatus = document.getElementById('blacklist-menu-status');
const closeBlacklistMenu = document.getElementById('close-blacklist-menu');

const initialBlacklistEnabled = isE621BlacklistEnabled();
if (blacklistMenuEnable) blacklistMenuEnable.checked = initialBlacklistEnabled;

const initialBlacklistText = getE621Blacklist();
if (blacklistMenuTags) blacklistMenuTags.value = initialBlacklistText;
initBlacklistStorage().then(() => {
  if (blacklistMenuTags && !blacklistMenuTags.value) {
    blacklistMenuTags.value = getE621Blacklist();
  }
});

if (blacklistMenuEnable) {
  blacklistMenuEnable.addEventListener('change', (e) => {
    setE621BlacklistEnabled(e.target.checked);
    applyBlacklistToCurrentFeed();
  });
}

if (blacklistMenuTags) {
  blacklistMenuTags.addEventListener('input', (e) => {
    saveE621Blacklist(e.target.value);
  });
}

if (btnBlacklistMenuSave) {
  btnBlacklistMenuSave.addEventListener('click', () => {
    const tags = blacklistMenuTags ? blacklistMenuTags.value : '';
    saveE621Blacklist(tags);
    applyBlacklistToCurrentFeed();
    if (blacklistMenuStatus) {
      blacklistMenuStatus.textContent = 'Blacklist saved!';
      blacklistMenuStatus.style.color = '#3fb950';
      setTimeout(() => {
        if (blacklistMenuStatus.textContent === 'Blacklist saved!') {
          blacklistMenuStatus.textContent = '';
        }
      }, 2500);
    }
  });
}

if (btnBlacklistMenuClear) {
  btnBlacklistMenuClear.addEventListener('click', () => {
    if (blacklistMenuTags) blacklistMenuTags.value = '';
    saveE621Blacklist('');
    applyBlacklistToCurrentFeed();
    if (blacklistMenuStatus) {
      blacklistMenuStatus.textContent = 'Blacklist cleared.';
      blacklistMenuStatus.style.color = '#bbb';
      setTimeout(() => {
        if (blacklistMenuStatus.textContent === 'Blacklist cleared.') {
          blacklistMenuStatus.textContent = '';
        }
      }, 2500);
    }
  });
}

if (btnBlacklistMenuSync) {
  btnBlacklistMenuSync.addEventListener('click', async () => {
    const auth = getE621Auth();
    if (!auth.username) {
      if (blacklistMenuStatus) {
        blacklistMenuStatus.textContent = 'Enter username on Home page first.';
        blacklistMenuStatus.style.color = '#f85149';
      }
      return;
    }
    if (blacklistMenuStatus) {
      blacklistMenuStatus.textContent = 'Syncing blacklist...';
      blacklistMenuStatus.style.color = '#58a6ff';
    }
    btnBlacklistMenuSync.disabled = true;
    try {
      const user = await fetchE621UserProfile(auth.username, auth.apiKey);
      const tags = user.blacklisted_tags || '';
      saveE621Blacklist(tags);
      if (blacklistMenuTags) blacklistMenuTags.value = tags;
      const count = tags.split('\n').map(s => s.trim()).filter(Boolean).length;
      applyBlacklistToCurrentFeed();
      if (blacklistMenuStatus) {
        blacklistMenuStatus.textContent = `Synced ${count} blacklist rules!`;
        blacklistMenuStatus.style.color = '#3fb950';
      }
    } catch (err) {
      if (blacklistMenuStatus) {
        blacklistMenuStatus.textContent = `Sync failed: ${err.message || err}`;
        blacklistMenuStatus.style.color = '#f85149';
      }
    } finally {
      btnBlacklistMenuSync.disabled = false;
    }
  });
}

if (closeBlacklistMenu && blacklistMenu) {
  closeBlacklistMenu.addEventListener('click', () => {
    blacklistMenu.classList.remove('active');
    updateNavVisibility();
  });
}

if (btnE621SaveAuth) {
  btnE621SaveAuth.addEventListener('click', () => {
    const userVal = settingE621Username ? settingE621Username.value.trim() : '';
    const keyVal = settingE621ApiKey ? settingE621ApiKey.value.trim() : '';
    saveE621Auth(userVal, keyVal);
    updateSiteSpecificUI();
    if (e621AuthStatus) {
      e621AuthStatus.textContent = 'Account saved!';
      e621AuthStatus.style.color = '#3fb950';
      setTimeout(() => {
        if (e621AuthStatus.textContent === 'Account saved!') {
          e621AuthStatus.textContent = '';
        }
      }, 3000);
    }
  });
}

if (btnGelbooruSaveAuth) {
  btnGelbooruSaveAuth.addEventListener('click', () => {
    const userVal = settingGelbooruUserId ? settingGelbooruUserId.value.trim() : '';
    const keyVal = settingGelbooruApiKey ? settingGelbooruApiKey.value.trim() : '';
    saveGelbooruAuth(userVal, keyVal);
    updateSiteSpecificUI();
    if (gelbooruAuthStatus) {
      gelbooruAuthStatus.textContent = 'Account saved!';
      gelbooruAuthStatus.style.color = '#3fb950';
      setTimeout(() => {
        if (gelbooruAuthStatus.textContent === 'Account saved!') {
          gelbooruAuthStatus.textContent = '';
        }
      }, 3000);
    }
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
          const willOpen = !info.classList.contains('expanded');
          info.classList.toggle('expanded');
          updateNavVisibility();
          if (willOpen) ensureHistoryCushion();
          else if (isAtRootView()) releaseHistoryCushion();
        }
      }
    }
  });
}

if (navBlacklist && blacklistMenu) {
  navBlacklist.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    if (settingsMenu) settingsMenu.classList.remove('active');
    if (blacklistMenuTags) blacklistMenuTags.value = getE621Blacklist();
    if (blacklistMenuEnable) blacklistMenuEnable.checked = isE621BlacklistEnabled();
    if (btnBlacklistMenuSync) btnBlacklistMenuSync.style.display = state.currentSite === 'e621' ? '' : 'none';
    const willOpen = !blacklistMenu.classList.contains('active');
    blacklistMenu.classList.toggle('active');
    updateNavVisibility();
    if (willOpen) ensureHistoryCushion();
    else if (isAtRootView()) releaseHistoryCushion();
  });
}

if (navSettings && settingsMenu) {
  navSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isNavInteractive()) return;
    if (blacklistMenu) blacklistMenu.classList.remove('active');
    const willOpen = !settingsMenu.classList.contains('active');
    settingsMenu.classList.toggle('active');
    updateNavVisibility();
    if (willOpen) ensureHistoryCushion();
    else if (isAtRootView()) releaseHistoryCushion();
  });
  
  document.addEventListener('click', (e) => {
    const isZipSettings = document.getElementById('zip-settings-viewer') && e.target === document.getElementById('zip-settings-viewer');
    let closedAny = false;
    if (!settingsMenu.contains(e.target) && e.target !== navSettings && !isZipSettings) {
      if (settingsMenu.classList.contains('active')) {
        settingsMenu.classList.remove('active');
        closedAny = true;
      }
    }
    if (blacklistMenu && !blacklistMenu.contains(e.target) && (!navBlacklist || !navBlacklist.contains(e.target))) {
      if (blacklistMenu.classList.contains('active')) {
        blacklistMenu.classList.remove('active');
        closedAny = true;
      }
    }
    if (closedAny && isAtRootView()) {
      releaseHistoryCushion();
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
  const inputE621Tag = document.getElementById('e621-tag-input');
  if (inputE621Tag) inputE621Tag.value = '';
}

if (siteSelector) {
  state.currentSite = siteSelector.value;
  resetHomeState();
  updateSiteSpecificUI();
  renderServiceFilters(state.currentSite);
  siteSelector.addEventListener('change', (e) => { 
    state.currentSite = e.target.value; 
    updateSourceSwitcher(state.currentSite);
    resetHomeState();
    updateSiteSpecificUI();
    renderServiceFilters(state.currentSite);
  });
} else {
  resetHomeState();
  renderServiceFilters(state.currentSite);
}

const sourceSwitcher = document.getElementById('source-switcher');
if (sourceSwitcher) {
  const btns = sourceSwitcher.querySelectorAll('.source-btn');
  btns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSite = btn.dataset.site;
      if (!targetSite || targetSite === state.currentSite) return;
      state.currentSite = targetSite;
      if (siteSelector) siteSelector.value = targetSite;
      updateSourceSwitcher(targetSite);
      resetHomeState();
      updateSiteSpecificUI();
      renderServiceFilters(state.currentSite);
    });
  });
}

window.addEventListener('resize', () => {
  updateSourceSwitcher(state.currentSite);
});

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
    releaseHistoryCushion();
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
    triggerAppBack();
  });
}

const btnLatest = document.getElementById('btn-latest');
if (btnLatest) {
  btnLatest.addEventListener('click', () => {
    resetFeed();
    if (state.currentSite === 'twitter') {
      const inputEl = document.getElementById('twitter-handle-input');
      const raw = inputEl ? inputEl.value : '';
      const handle = cleanTwitterHandle(raw) || 'elonmusk';
      state._feedOriginView = 'welcome';
      state._twitterFeedMode = 'creator';
      state._twitterFeedType = 'tweets';
      state.currentFeedEndpoint = `https://twitter.com/${handle}`;
      state.currentFeedCreatorName = formatTwitterHandle(handle);
      updateNavTabs({ name: formatTwitterHandle(handle), id: handle, service: 'twitter' });
      if (navBack) navBack.classList.remove('hidden');
      showView(feedView, true);
      fetchPosts();
      return;
    }
    state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/posts`;
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    if (navBack) navBack.classList.remove('hidden'); 
    showView(feedView, true);
    if (state.currentSite !== 'e621' && state.currentSite !== 'gelbooru') loadCreators();
    fetchPosts();
  });
}

const btnFollowingFeed = document.getElementById('btn-following-feed');
if (btnFollowingFeed) {
  btnFollowingFeed.addEventListener('click', () => {
    const following = getSavedTwitterFollowing();
    if (!following || following.length === 0) {
      alert("No followed accounts saved yet. Enter a Twitter handle in the search bar above and click 'Import Following' to import accounts!");
      if (twitterHandleInput) twitterHandleInput.focus();
      return;
    }
    resetFeed();
    state._twitterFeedMode = 'following';
    state._feedOriginView = 'welcome';
    state.currentFeedCreatorName = null;
    updateNavTabs({ name: 'Following Feed', id: 'following', service: 'twitter' });
    if (navBack) navBack.classList.remove('hidden');
    showView(feedView, true);
    fetchPosts();
  });
}

const btnCreators = document.getElementById('btn-creators');
if (btnCreators) {
  btnCreators.addEventListener('click', () => {
    if (state.currentSite === 'e621' || state.currentSite === 'gelbooru') {
      resetFeed();
      state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/popular`;
      state.currentFeedCreatorName = null;
      updateNavTabs(null);
      if (navBack) navBack.classList.remove('hidden');
      showView(feedView, true);
      fetchPosts();
    } else {
      state.creatorPage = 1;
      state._feedOriginView = 'welcome';
      showView(creatorsView, true);
      if (navBack) navBack.classList.remove('hidden'); 
      loadCreators();
    }
  });
}

const btnE621Favorites = document.getElementById('btn-e621-favorites');
if (btnE621Favorites) {
  btnE621Favorites.addEventListener('click', () => {
    if (state.currentSite === 'e621') {
      const auth = getE621Auth();
      if (!auth || !auth.username) {
        alert("Please enter your e621 Username below to access your favorites.");
        if (settingE621Username) {
          settingE621Username.focus();
          settingE621Username.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      resetFeed();
      const favTag = `fav:${auth.username}`;
      if (inputE621Tag) inputE621Tag.value = favTag;
      state.currentFeedEndpoint = `${PROXY_URL}/e621/api/v1/posts?tags=${encodeURIComponent(favTag)}`;
      state.currentFeedCreatorName = null;
      updateNavTabs(null);
      if (navBack) navBack.classList.remove('hidden');
      showView(feedView, true);
      fetchPosts();
    } else if (state.currentSite === 'gelbooru') {
      const gelAuth = getGelbooruAuth();
      if (!gelAuth || !gelAuth.userId) {
        alert("Please enter your Gelbooru User ID in the account panel below to access your favorites.");
        if (settingGelbooruUserId) {
          settingGelbooruUserId.focus();
          settingGelbooruUserId.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      resetFeed();
      const favTag = `fav:${gelAuth.userId}`;
      if (inputE621Tag) inputE621Tag.value = favTag;
      state.currentFeedEndpoint = `${PROXY_URL}/gelbooru/api/v1/posts?tags=${encodeURIComponent(favTag)}`;
      state.currentFeedCreatorName = null;
      updateNavTabs(null);
      if (navBack) navBack.classList.remove('hidden');
      showView(feedView, true);
      fetchPosts();
    }
  });
}

const btnE621Search = document.getElementById('btn-e621-search');
const inputE621Tag = document.getElementById('e621-tag-input');
if (inputE621Tag) {
  attachTagAutocomplete(inputE621Tag);
}

function triggerUniversalSearch() {
  const queryVal = inputE621Tag ? inputE621Tag.value.trim() : '';
  if (!queryVal) return;
  resetFeed();
  const currentSite = state.currentSite;
  const isBooru = currentSite === 'e621' || currentSite === 'gelbooru';
  const param = isBooru ? 'tags' : 'q';
  state.currentFeedEndpoint = `${PROXY_URL}/${currentSite}/api/v1/posts?${param}=${encodeURIComponent(queryVal)}`;
  state.currentFeedCreatorName = null;
  updateNavTabs(null);
  if (navBack) navBack.classList.remove('hidden');
  showView(feedView, true);
  fetchPosts();
}

if (btnE621Search) {
  btnE621Search.addEventListener('click', triggerUniversalSearch);
}
if (inputE621Tag) {
  inputE621Tag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerUniversalSearch();
    }
  });
}

// Twitter Search & Following Controls
const twitterHandleInput = document.getElementById('twitter-handle-input');
const twitterImportHandleInput = document.getElementById('twitter-import-handle-input');
const btnTwitterSearch = document.getElementById('btn-twitter-search');
const btnTwitterFollowing = document.getElementById('btn-twitter-following');
const btnSyncTwitterFollowing = document.getElementById('btn-sync-twitter-following');
const settingNitterInstance = document.getElementById('setting-nitter-instance');

if (twitterImportHandleInput) {
  const savedHandle = typeof localStorage !== 'undefined' ? localStorage.getItem('paw_twitter_my_handle') : null;
  if (savedHandle) {
    twitterImportHandleInput.value = formatTwitterHandle(savedHandle);
  }
}

if (settingNitterInstance) {
  settingNitterInstance.value = getPreferredNitterHost();
  settingNitterInstance.addEventListener('change', (e) => {
    setPreferredNitterHost(e.target.value);
  });
}

export function loadTwitterCreator(handle, isBackNavigation = false) {
  const clean = cleanTwitterHandle(handle);
  if (!clean) return;

  if (state.currentSite === 'twitter' && !isBackNavigation) {
    if (!state._twitterHistory) state._twitterHistory = [];
    if (feedView && feedView.classList.contains('active')) {
      const feedEl = document.getElementById('feed');
      if (feedEl && feedEl.children.length > 0) {
        const currentHandle = state.currentFeedCreatorName ? cleanTwitterHandle(state.currentFeedCreatorName) : null;
        if (state._twitterFeedMode !== 'creator' || (currentHandle && currentHandle !== clean)) {
          const savedCards = Array.from(feedEl.children);
          const savedScrollTop = feedEl.scrollTop;
          const savedFollowingState = (state._twitterFeedMode === 'following') ? getTwitterFollowingFeedState() : null;

          state._twitterHistory.push({
            feedMode: state._twitterFeedMode,
            creatorHandle: currentHandle,
            cards: savedCards,
            scrollTop: savedScrollTop,
            followingState: savedFollowingState,
            offset: state.offset,
            cursor: state._twitterCursor,
            hasMore: state.hasMore,
            seenPostIds: new Set(state.seenPostIds),
            originView: state._feedOriginView,
            creatorName: state.currentFeedCreatorName,
            feedType: state._twitterFeedType
          });

          // Detach current cards without destroying their media/listeners before resetFeed
          feedEl.innerHTML = '';
        }
      }
    }
  }

  if (twitterHandleInput) twitterHandleInput.value = formatTwitterHandle(clean);
  resetFeed();
  if (!isBackNavigation && (!state._feedOriginView || state._feedOriginView === 'welcome')) {
    state._feedOriginView = state.currentView === creatorsView ? 'creators' : 'welcome';
  }
  state._twitterFeedMode = 'creator';
  state._twitterFeedType = 'tweets';
  state.currentFeedEndpoint = `https://twitter.com/${clean}`;
  state.currentFeedCreatorName = formatTwitterHandle(clean);
  updateNavTabs({ name: formatTwitterHandle(clean), id: clean, service: 'twitter' });
  if (navBack) navBack.classList.remove('hidden');
  showView(feedView, true);
  fetchPosts();
}
window.loadTwitterCreator = loadTwitterCreator;

function triggerTwitterSearch() {
  const raw = twitterHandleInput ? twitterHandleInput.value : '';
  const handle = cleanTwitterHandle(raw);
  if (!handle) {
    if (twitterHandleInput) twitterHandleInput.focus();
    return;
  }
  loadTwitterCreator(handle);
}

if (btnTwitterSearch) {
  btnTwitterSearch.addEventListener('click', triggerTwitterSearch);
}

if (twitterHandleInput) {
  twitterHandleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerTwitterSearch();
    }
  });
}

if (twitterImportHandleInput) {
  twitterImportHandleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (btnTwitterFollowing) btnTwitterFollowing.click();
    }
  });
}

if (btnTwitterFollowing) {
  btnTwitterFollowing.addEventListener('click', async () => {
    const raw = twitterImportHandleInput ? twitterImportHandleInput.value : (twitterHandleInput ? twitterHandleInput.value : '');
    const handle = cleanTwitterHandle(raw);
    if (!handle || !isValidTwitterHandle(handle)) {
      alert('Please enter a valid Twitter handle (e.g. @username) without spaces in the Following Import field.');
      if (twitterImportHandleInput) twitterImportHandleInput.focus();
      return;
    }

    const origHtml = btnTwitterFollowing.innerHTML;
    btnTwitterFollowing.disabled = true;
    btnTwitterFollowing.innerHTML = '<span>Importing...</span>';
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('paw_twitter_my_handle', handle);
      }
      const onProgress = (count, statusMsg) => {
        btnTwitterFollowing.innerHTML = `<span>${statusMsg || `Importing (${count})...`}</span>`;
      };
      const accounts = await fetchTwitterFollowing(handle, 150, null, onProgress);
      if (accounts && accounts.length > 0) {
        saveTwitterFollowing(accounts, { merge: false });
        state.creatorPage = 1;
        state._feedOriginView = 'welcome';
        showView(creatorsView, true);
        if (navBack) navBack.classList.remove('hidden');
        loadCreators();
      } else {
        alert(`No following accounts could be found for @${handle}. The account might follow 0 users or the instance challenged the request. You can try selecting another instance in settings below.`);
      }
    } catch (err) {
      console.error('Following import error:', err);
      alert(`Failed to import following accounts: ${err.message}`);
    } finally {
      btnTwitterFollowing.disabled = false;
      btnTwitterFollowing.innerHTML = origHtml;
    }
  });
}

if (btnSyncTwitterFollowing) {
  btnSyncTwitterFollowing.addEventListener('click', async () => {
    let handle = typeof localStorage !== 'undefined' ? localStorage.getItem('paw_twitter_my_handle') : '';
    if (!handle && twitterImportHandleInput && twitterImportHandleInput.value) {
      handle = cleanTwitterHandle(twitterImportHandleInput.value);
    }
    if (!handle && twitterHandleInput && twitterHandleInput.value) {
      handle = cleanTwitterHandle(twitterHandleInput.value);
    }
    if (!handle) {
      const prompted = prompt('Enter your Twitter handle to sync followed accounts (e.g. @username):');
      handle = cleanTwitterHandle(prompted);
    }
    if (!handle || !isValidTwitterHandle(handle)) {
      if (handle) alert('Please enter a valid Twitter handle (e.g. @username) without spaces.');
      return;
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('paw_twitter_my_handle', handle);
    }
    if (twitterImportHandleInput) {
      twitterImportHandleInput.value = formatTwitterHandle(handle);
    }

    const origHtml = btnSyncTwitterFollowing.innerHTML;
    btnSyncTwitterFollowing.disabled = true;
    btnSyncTwitterFollowing.innerHTML = '<span>Syncing...</span>';

    try {
      const onProgress = (count, statusMsg) => {
        btnSyncTwitterFollowing.innerHTML = `<span>${statusMsg || `Syncing (${count})...`}</span>`;
      };
      const accounts = await fetchTwitterFollowing(handle, 150, null, onProgress);
      if (accounts && accounts.length > 0) {
        saveTwitterFollowing(accounts, { merge: false });
        state.creatorPage = 1;
        loadCreators();
      } else {
        alert(`No followed accounts could be retrieved for @${handle}. The Nitter instance may be temporarily busy, please try again in a few moments.`);
      }
    } catch (err) {
      console.error('Sync error:', err);
      alert(`Sync error: ${err.message}`);
    } finally {
      btnSyncTwitterFollowing.disabled = false;
      btnSyncTwitterFollowing.innerHTML = origHtml;
    }
  });
}

// Twitter File & Paste Import Controls
const btnTwitterFileImport = document.getElementById('btn-twitter-file-import');
const btnSyncTwitterFile = document.getElementById('btn-sync-twitter-file');
const btnTwitterPasteImport = document.getElementById('btn-twitter-paste-import');
const btnSyncTwitterPaste = document.getElementById('btn-sync-twitter-paste');
const twitterFileInput = document.getElementById('twitter-file-input');
const twitterImportModal = document.getElementById('twitter-import-modal');
const btnCloseTwitterImportModal = document.getElementById('btn-close-twitter-import-modal');
const btnCancelTwitterPaste = document.getElementById('btn-cancel-twitter-paste');
const btnSubmitTwitterPaste = document.getElementById('btn-submit-twitter-paste');
const twitterPasteTextarea = document.getElementById('twitter-paste-textarea');
const twitterPasteDetectedCount = document.getElementById('twitter-paste-detected-count');

function triggerTwitterFileUpload() {
  if (twitterFileInput) {
    twitterFileInput.value = '';
    twitterFileInput.click();
  }
}

if (btnTwitterFileImport) btnTwitterFileImport.addEventListener('click', triggerTwitterFileUpload);
if (btnSyncTwitterFile) btnSyncTwitterFile.addEventListener('click', triggerTwitterFileUpload);

if (twitterFileInput) {
  twitterFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const accounts = parseTwitterFollowingInput(text);
      if (accounts && accounts.length > 0) {
        let shouldMerge = false;
        const existingCount = getSavedTwitterFollowing().length;
        if (existingCount > 0) {
          shouldMerge = confirm(`You already have ${existingCount} followed accounts saved.\n\nClick OK to Add to your existing accounts (Merge).\nClick Cancel to Replace them.`);
        }
        saveTwitterFollowing(accounts, { merge: shouldMerge });
        alert(`Successfully imported ${accounts.length} accounts from "${file.name}"!`);
        state.creatorPage = 1;
        state._feedOriginView = 'welcome';
        showView(creatorsView, true);
        if (navBack) navBack.classList.remove('hidden');
        loadCreators();
      } else {
        alert(`No valid Twitter handles could be parsed from "${file.name}". Ensure the file contains Twitter handles or following.js.`);
      }
    } catch (err) {
      alert(`Failed to read file: ${err.message}`);
    }
  });
}

function openTwitterPasteModal() {
  if (twitterImportModal) {
    twitterImportModal.style.display = 'flex';
    if (twitterPasteTextarea) {
      twitterPasteTextarea.value = '';
      twitterPasteTextarea.focus();
    }
    if (twitterPasteDetectedCount) {
      twitterPasteDetectedCount.textContent = '0 handles detected';
    }
  }
}

function closeTwitterPasteModal() {
  if (twitterImportModal) twitterImportModal.style.display = 'none';
}

if (btnTwitterPasteImport) btnTwitterPasteImport.addEventListener('click', openTwitterPasteModal);
if (btnSyncTwitterPaste) btnSyncTwitterPaste.addEventListener('click', openTwitterPasteModal);
if (btnCloseTwitterImportModal) btnCloseTwitterImportModal.addEventListener('click', closeTwitterPasteModal);
if (btnCancelTwitterPaste) btnCancelTwitterPaste.addEventListener('click', closeTwitterPasteModal);

if (twitterImportModal) {
  twitterImportModal.addEventListener('click', (e) => {
    if (e.target === twitterImportModal) closeTwitterPasteModal();
  });
}

if (twitterPasteTextarea && twitterPasteDetectedCount) {
  twitterPasteTextarea.addEventListener('input', () => {
    const parsed = parseTwitterFollowingInput(twitterPasteTextarea.value);
    twitterPasteDetectedCount.textContent = `${parsed.length} handles detected`;
  });
}

if (btnSubmitTwitterPaste) {
  btnSubmitTwitterPaste.addEventListener('click', () => {
    const raw = twitterPasteTextarea ? twitterPasteTextarea.value : '';
    const accounts = parseTwitterFollowingInput(raw);
    if (accounts && accounts.length > 0) {
      let shouldMerge = false;
      const existingCount = getSavedTwitterFollowing().length;
      if (existingCount > 0) {
        shouldMerge = confirm(`You already have ${existingCount} followed accounts saved.\n\nClick OK to Add to your existing accounts (Merge).\nClick Cancel to Replace them.`);
      }
      saveTwitterFollowing(accounts, { merge: shouldMerge });
      alert(`Successfully imported ${accounts.length} accounts!`);
      closeTwitterPasteModal();
      state.creatorPage = 1;
      state._feedOriginView = 'welcome';
      showView(creatorsView, true);
      if (navBack) navBack.classList.remove('hidden');
      loadCreators();
    } else {
      alert('No valid Twitter handles found. Please enter handles (e.g. @ceno02, @Slimeanor).');
    }
  });
}

// Export / Backup Following Accounts List
function exportTwitterFollowing() {
  const accounts = getSavedTwitterFollowing();
  if (!accounts || accounts.length === 0) {
    alert("No saved Twitter following accounts to export. Import your following accounts first.");
    return;
  }
  const jsonStr = JSON.stringify(accounts, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paw-twitter-following-${accounts.length}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const btnTwitterExport = document.getElementById("btn-twitter-export");
const btnSyncTwitterExport = document.getElementById("btn-sync-twitter-export");
if (btnTwitterExport) btnTwitterExport.addEventListener("click", exportTwitterFollowing);
if (btnSyncTwitterExport) btnSyncTwitterExport.addEventListener("click", exportTwitterFollowing);

// Clear Following Accounts List
function handleClearTwitterFollowing() {
  const existing = getSavedTwitterFollowing();
  if (!existing || existing.length === 0) {
    alert('There are no saved Twitter following accounts to clear.');
    return;
  }
  const confirmed = confirm(`Are you sure you want to clear all ${existing.length} imported Twitter accounts?`);
  if (!confirmed) return;
  clearTwitterFollowing();
  if (twitterImportHandleInput) twitterImportHandleInput.value = '';
  if (state.currentSite === 'twitter') {
    state.creatorPage = 1;
    loadCreators();
  }
  alert('Successfully cleared all imported Twitter accounts.');
}

const btnTwitterClear = document.getElementById("btn-twitter-clear");
const btnSyncTwitterClear = document.getElementById("btn-sync-twitter-clear");
if (btnTwitterClear) btnTwitterClear.addEventListener("click", handleClearTwitterFollowing);
if (btnSyncTwitterClear) btnSyncTwitterClear.addEventListener("click", handleClearTwitterFollowing);

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
    }, 220);
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
    triggerAppBack();
  });
}

if (zipSettingsViewer && settingsMenu) {
  zipSettingsViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    const willOpen = !settingsMenu.classList.contains('active');
    settingsMenu.classList.toggle('active');
    if (willOpen) ensureHistoryCushion();
  });
}

if (zipHomeViewer) {
  zipHomeViewer.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isZipNavInteractive()) return;
    releaseHistoryCushion();
    closeZipGallery();
    state.currentFeedCreatorName = null;
    updateNavTabs(null);
    showView(welcomeScreen, false);
    if (navBack) navBack.classList.add('hidden');
    
    resetFeed();
    resetHomeState();
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
    triggerAppBack();
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

setResetHomeCallback(resetHomeState);
setCloseZipCallback(closeZipGallery);
initNavigationHistory();
