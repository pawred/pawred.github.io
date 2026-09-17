import { PROXY_URL, state } from "./state.js";
import { buildCreatorCard } from "./creators.js";
import { resetFeed, fetchPosts, updateAllE621TagChips } from "./feed.js";
import { escapeHtml } from "./utils.js";
import { getE621Auth } from "./e621Auth.js";

export const welcomeScreen = document.getElementById("welcome-screen");
export const creatorsView = document.getElementById("creators-view");
export const feedView = document.getElementById("feed-view");
export const nav = document.getElementById("nav");
export const navHome = document.getElementById("nav-home");
export const navBack = document.getElementById("nav-back");
export const navInfo = document.getElementById("nav-info");
export const navBlacklist = document.getElementById("nav-blacklist");
export const navSettings = document.getElementById("nav-settings");
export const settingsMenu = document.getElementById("settings-menu");
export const blacklistMenu = document.getElementById("blacklist-menu");
export const siteSelector = document.getElementById("site-selector");

let navLastVisibleTime = 0;
let navTabsSeq = 0;

export function isNavInteractive() {
  if (!nav) return false;
  if (nav.classList.contains("hidden")) return false;
  if (nav.classList.contains("auto-hide") && !nav.classList.contains("visible")) return false;
  if (nav.classList.contains("auto-hide") && Date.now() - navLastVisibleTime < 200) return false;
  return true;
}

export function closeAllPostInfo() {
  const expanded = document.querySelectorAll(".post-info.expanded");
  if (expanded.length > 0) {
    expanded.forEach((el) => el.classList.remove("expanded"));
    updateNavVisibility();
  }
}

document.addEventListener(
  "click",
  (e) => {
    const expandedInfo = document.querySelector(".post-info.expanded");
    if (!expandedInfo) return;
    if (e.target.closest(".post-info") || e.target.closest("#nav-info")) return;
    closeAllPostInfo();
    if (!e.target.closest("#nav")) {
      e.stopPropagation();
    }
  },
  true
);

window.lastMouseY = -1;

export function updateNavVisibility(mouseY = window.lastMouseY) {
  if (!nav || !nav.classList.contains("auto-hide")) return;
  const anyInfoExpanded = !!document.querySelector(".post-info.expanded");
  const dropdownOpen =
    !!document.getElementById("linked-accounts-dropdown") || !!document.getElementById("cum-posts-dropdown");
  const settingsOpen = settingsMenu && settingsMenu.classList.contains("active");
  const blacklistOpen = blacklistMenu && blacklistMenu.classList.contains("active");
  const isMobile = window.innerWidth <= 768 || window.innerHeight <= 500;
  const inNavZone = !isMobile && mouseY >= 0 && mouseY < 80;
  const isSearchInputFocused =
    !!document.activeElement &&
    (document.activeElement.id === "e621-nav-search-input" || !!document.activeElement.closest("#nav-tabs"));
  const isVisible =
    anyInfoExpanded ||
    dropdownOpen ||
    settingsOpen ||
    blacklistOpen ||
    inNavZone ||
    state.navManualVisible ||
    isSearchInputFocused;

  if (isVisible) {
    if (!nav.classList.contains("visible")) {
      navLastVisibleTime = Date.now();
    }
    nav.classList.add("visible");
    document.body.classList.add("nav-visible");
  } else {
    if (nav.classList.contains("visible")) {
      document.dispatchEvent(new CustomEvent("paw:navhidden"));
    }
    nav.classList.remove("visible");
    document.body.classList.remove("nav-visible");
  }
}

export function updateSiteSpecificUI() {
  const contentFilter = document.getElementById("creator-content-filter");
  if (contentFilter) {
    if (state.currentSite === "cum") {
      contentFilter.style.display = "";
      contentFilter.value = "content";
    } else {
      contentFilter.style.display = "none";
      contentFilter.value = "all";
    }
  }

  const genderFilter = document.getElementById("creator-gender-filter");
  if (genderFilter) {
    if (state.currentSite === "cum") {
      genderFilter.style.display = "";
      genderFilter.value = "all";
    } else {
      genderFilter.style.display = "none";
      genderFilter.value = "all";
    }
  }

  const sortSelect = document.getElementById("creator-sort");
  if (sortSelect) {
    const prevVal = sortSelect.value;
    if (state.currentSite === "cum") {
      sortSelect.innerHTML = `
        <option value="popularity">Popularity</option>
        <option value="indexed">Date indexed</option>
        <option value="updated">Date updated</option>
        <option value="alphabetical">Alphabetical</option>
        <option value="service">By service</option>
        <option value="dms">DM count</option>
        <option value="posts">Post count</option>
      `;
      sortSelect.value = ["popularity", "indexed", "updated", "alphabetical", "service", "dms", "posts"].includes(
        prevVal
      )
        ? prevVal
        : "popularity";
    } else {
      sortSelect.innerHTML = `
        <option value="popularity">Popularity</option>
        <option value="indexed">Date Indexed</option>
        <option value="updated">Date Updated</option>
        <option value="alphabetical">Alphabetical Order</option>
        <option value="service">Service</option>
      `;
      sortSelect.value = ["popularity", "indexed", "updated", "alphabetical", "service"].includes(prevVal)
        ? prevVal
        : "popularity";
    }
  }

  const sortDirBtn = document.getElementById("creator-sort-dir");
  if (sortDirBtn) {
    if (state.currentSite === "cum") {
      sortDirBtn.style.display = "none";
    } else {
      sortDirBtn.style.display = "";
      sortDirBtn.innerHTML =
        state.creatorSortDir === "asc"
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>';
    }
  }

  const creatorsTitle = document.getElementById("creators-title");
  if (creatorsTitle) {
    const displayNames = {
      pawchive: "Pawchive",
      kemono: "Kemono",
      cum: "Coomer",
      e621: "e621",
    };
    creatorsTitle.textContent = state.currentSite === "e621" ? "e621 Artists" : `${displayNames[state.currentSite] || "Selected"} creators`;
  }

  const e621SearchContainer = document.getElementById("e621-search-container");
  const btnCreators = document.getElementById("btn-creators");
  const btnE621Favorites = document.getElementById("btn-e621-favorites");
  const e621AccountPanel = document.getElementById("e621-account-panel");
  const auth = getE621Auth();
  const hasAccount = Boolean(auth && auth.username);

  if (state.currentSite === "e621") {
    if (e621SearchContainer) e621SearchContainer.style.display = "flex";
    if (btnCreators) btnCreators.textContent = "Popular Posts";
    if (btnE621Favorites) btnE621Favorites.style.display = hasAccount ? "" : "none";
    if (e621AccountPanel) e621AccountPanel.style.display = "block";
  } else {
    if (e621SearchContainer) e621SearchContainer.style.display = "none";
    if (btnCreators) btnCreators.textContent = "Creator List";
    if (btnE621Favorites) btnE621Favorites.style.display = "none";
    if (e621AccountPanel) e621AccountPanel.style.display = "none";
  }
}

export function updateNavTabs(creator) {
  const currentSeq = ++navTabsSeq;
  const navTabs = document.getElementById("nav-tabs");
  if (!navTabs) return;
  navTabs.innerHTML = "";

  if (state.currentSite === "e621") {
    navTabs.classList.add("e621-search-mode");

    const ep = state.currentFeedEndpoint || "";
    let activeTag = "";
    if (ep.includes("?")) {
      try {
        const u = new URL(ep, window.location.href);
        activeTag = u.searchParams.get("tags") || u.searchParams.get("q") || "";
      } catch (_) {}
    } else if (ep.includes("/popular")) {
      activeTag = "order:rank";
    }

    const form = document.createElement("form");
    form.className = "e621-nav-search-form";
    form.id = "e621-nav-search-form";
    form.autocomplete = "off";

    const iconSpan = document.createElement("span");
    iconSpan.className = "e621-nav-search-icon";
    iconSpan.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

    const input = document.createElement("input");
    input.type = "text";
    input.id = "e621-nav-search-input";
    input.className = "e621-nav-search-input";
    input.placeholder = "Search tags (e.g. canine, rating:s)...";
    input.value = activeTag;
    input.autocomplete = "off";
    input.spellcheck = false;

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "e621-nav-search-clear";
    clearBtn.id = "e621-nav-search-clear";
    clearBtn.title = "Clear search";
    clearBtn.setAttribute("aria-label", "Clear search");
    clearBtn.innerHTML = "&times;";
    clearBtn.style.display = activeTag ? "flex" : "none";

    input.addEventListener("input", () => {
      clearBtn.style.display = input.value.trim() ? "flex" : "none";
      if (typeof updateAllE621TagChips === "function") {
        updateAllE621TagChips();
      }
    });

    input.addEventListener("focus", () => {
      updateNavVisibility();
    });

    input.addEventListener("blur", () => {
      setTimeout(() => updateNavVisibility(), 150);
    });

    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.value = "";
      clearBtn.style.display = "none";
      input.focus();
      if (typeof updateAllE621TagChips === "function") {
        updateAllE621TagChips();
      }
    });

    const auth = getE621Auth();
    let favBtn = null;
    if (auth && auth.username) {
      favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = "e621-nav-fav-btn";
      favBtn.id = "e621-nav-fav-btn";
      favBtn.title = "View your e621 Favorites";
      favBtn.innerHTML = `★ Favs`;

      if (activeTag.includes(`fav:${auth.username}`)) {
        favBtn.classList.add("active");
      }

      favBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const favTag = `fav:${auth.username}`;
        input.value = favTag;
        clearBtn.style.display = "flex";
        state.currentFeedEndpoint = `${PROXY_URL}/e621/api/v1/posts?tags=${encodeURIComponent(favTag)}`;
        state.currentFeedCreatorName = null;
        resetFeed();
        fetchPosts();
        updateNavTabs(null);
        closeAllPostInfo();
      });
    }

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "e621-nav-search-btn";
    submitBtn.id = "e621-nav-search-btn";
    submitBtn.textContent = "Search";

    form.appendChild(iconSpan);
    form.appendChild(input);
    form.appendChild(clearBtn);
    if (favBtn) form.appendChild(favBtn);
    form.appendChild(submitBtn);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const q = input.value.trim();
      state.currentFeedEndpoint = q
        ? `${PROXY_URL}/e621/api/v1/posts?tags=${encodeURIComponent(q)}`
        : `${PROXY_URL}/e621/api/v1/posts`;
      state.currentFeedCreatorName = null;
      resetFeed();
      fetchPosts();
      updateNavTabs(null);
      closeAllPostInfo();
    });

    navTabs.appendChild(form);
    return;
  } else {
    navTabs.classList.remove("e621-search-mode");
  }

  if (!creator) return;

  let tabs = [];
  if (state.currentSite === "kemono" || state.currentSite === "pawchive") {
    tabs = ["Posts", "Announcements", "Fancards", "Tags", "DMs", "Linked Accounts", "Similar Artists"];
  } else if (state.currentSite === "cum") {
    const isFansly =
      (creator.service || "").toLowerCase() === "fansly" ||
      (creator.allPlatforms && creator.allPlatforms.some((p) => (p.service || "").toLowerCase() === "fansly"));
    if (isFansly) {
      tabs = ["Posts", "Fancards", "DMs", "Linked Accounts", "Similar Creators"];
    } else {
      tabs = ["Posts", "DMs", "Linked Accounts", "Similar Creators"];
    }
  }

  tabs = tabs.filter((tab) => {
    if (tab === "DMs" && (creator.dmCount === 0 || creator.dmCount === null)) return false;
    if (tab === "Posts" && (creator.postCount === 0 || creator.postCount === null)) return false;
    if (tab === "Linked Accounts" && state.currentSite === "cum" && (!creator.allPlatforms || creator.allPlatforms.length <= 1)) return false;
    return true;
  });

  const feed = document.getElementById("feed");

  tabs.forEach((tab, index) => {
    const btn = document.createElement("button");
    btn.style.flexShrink = "0";

    let postCategories = [];
    if (state.currentSite === "cum" && tab === "Posts") {
      if (creator.imageCount > 0) {
        postCategories.push({
          key: "photos",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Photos',
        });
      }
      if (creator.videoCount > 0) {
        postCategories.push({
          key: "videos",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg> Videos',
        });
      }
      if (creator.audioCount > 0) {
        postCategories.push({
          key: "audio",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg> Audio',
        });
      }
      if (creator.postCount > 0) {
        postCategories.push({
          key: "text",
          label:
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Text',
        });
      }
    }

    if (tab === "Linked Accounts") {
      const srv = (creator.service || "").toLowerCase();
      btn.innerHTML = `<img src="icons/${srv}.svg" style="width: 14px; height: 14px; object-fit: contain;" onerror="this.style.display='none'"> &middot; Linked Accounts`;
      
      if ((state.currentSite === "kemono" || state.currentSite === "pawchive") && (!creator.allPlatforms || creator.allPlatforms.length <= 1)) {
        btn.style.display = "none";
      } else {
        btn.style.display = "flex";
      }
      
      btn.style.alignItems = "center";
      btn.style.gap = "6px";
    } else {
      btn.textContent = state.currentSite === "cum" && tab === "Posts" && postCategories.length > 0 ? "Posts ▾" : tab;
    }
    if (index === 0) btn.style.background = "rgba(0, 123, 255, 0.6)";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!isNavInteractive()) return;

      if (state.currentSite === "cum" && tab === "Posts" && postCategories.length > 0) {
        const existingDropdown = document.getElementById("cum-posts-dropdown");
        if (existingDropdown) {
          if (existingDropdown._cleanup) existingDropdown._cleanup();
          existingDropdown.remove();
          return;
        }

        const dropdown = document.createElement("div");
        dropdown.id = "cum-posts-dropdown";

        const btnRect = btn.getBoundingClientRect();
        dropdown.style.cssText = `
          position: fixed;
          top: ${btnRect.bottom + 6}px;
          left: ${btnRect.left + btnRect.width / 2}px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          padding: 8px;
          display: flex; flex-direction: column; gap: 6px;
          min-width: 170px;
          z-index: 1100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        postCategories.forEach((cat) => {
          const row = document.createElement("label");
          row.style.cssText = `
            display: flex; align-items: center; gap: 10px;
            padding: 8px 12px; border-radius: 10px;
            background: rgba(255,255,255,0.08);
            color: #fff; font-size: 0.9rem;
            cursor: pointer; user-select: none;
            transition: background 0.15s;
          `;
          row.onmouseenter = () => (row.style.background = "rgba(255,255,255,0.18)");
          row.onmouseleave = () => (row.style.background = "rgba(255,255,255,0.08)");

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = cat.key;
          cb.checked = state.cumSelectedTypes.includes(cat.key);
          cb.style.cssText = "width: 16px; height: 16px; cursor: pointer; accent-color: #007bff;";

          const nameSpan = document.createElement("span");
          nameSpan.innerHTML = cat.label;

          row.appendChild(cb);
          row.appendChild(nameSpan);

          cb.addEventListener("change", () => {
            const checked = Array.from(dropdown.querySelectorAll("input:checked")).map((i) => i.value);
            if (checked.length === 0) {
              cb.checked = true;
              return;
            }
            state.cumSelectedTypes = checked;

            Array.from(navTabs.children).forEach((c) => (c.style.background = ""));
            btn.style.background = "rgba(0, 123, 255, 0.6)";

            resetFeed();
            if (state.cumSelectedTypes.length === 1) {
              state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts?type=${state.cumSelectedTypes[0]}`;
            } else {
              state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts`;
            }
            fetchPosts();
          });

          dropdown.appendChild(row);
        });

        document.body.appendChild(dropdown);

        const navEl = document.getElementById("nav");
        if (navEl) navEl.classList.add("visible");

        function cleanup() {
          document.removeEventListener("mousedown", outsideClose);
          document.removeEventListener("touchstart", outsideClose);
        }
        dropdown._cleanup = cleanup;

        function outsideClose(ev) {
          if (!dropdown.contains(ev.target) && ev.target !== btn) {
            cleanup();
            dropdown.remove();
            if (navEl) updateNavVisibility();
          }
        }
        setTimeout(() => {
          document.addEventListener("mousedown", outsideClose);
          document.addEventListener("touchstart", outsideClose);
        }, 0);
        return;
      }

      if (tab === "Linked Accounts") {
        const existingDropdown = document.getElementById("linked-accounts-dropdown");
        if (existingDropdown) {
          if (existingDropdown._cleanup) existingDropdown._cleanup();
          existingDropdown.remove();
          return;
        }

        const dropdown = document.createElement("div");
        dropdown.id = "linked-accounts-dropdown";

        const btnRect = btn.getBoundingClientRect();
        dropdown.style.cssText = `
          position: fixed;
          top: ${btnRect.bottom + 6}px;
          left: ${btnRect.left + btnRect.width / 2}px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 14px;
          padding: 8px;
          display: flex; flex-direction: column; gap: 6px;
          min-width: 180px;
          z-index: 1100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        if (creator.allPlatforms && creator.allPlatforms.length > 1) {
          creator.allPlatforms.forEach((p) => {
            const isActive = p.service === creator.service && p.id === creator.id;
            const row = document.createElement("button");
            row.style.cssText = `
              display:flex; align-items:center; gap:10px;
              padding: 8px 12px; border-radius: 10px; border: none;
              background: ${isActive ? "rgba(0,123,255,0.6)" : "rgba(255,255,255,0.08)"};
              color: #fff; font-size: 0.9rem; font-weight: ${isActive ? "bold" : "normal"};
              cursor: pointer; text-align: left; width: 100%;
              transition: background 0.15s;
            `;
            row.onmouseenter = () => {
              if (!isActive) row.style.background = "rgba(255,255,255,0.18)";
            };
            row.onmouseleave = () => {
              if (!isActive) row.style.background = "rgba(255,255,255,0.08)";
            };

            const icon = document.createElement("img");
            icon.src = `icons/${p.service}.svg`;
            icon.style.cssText = "width:20px; height:20px; object-fit:contain; flex-shrink:0;";
            icon.onerror = () => (icon.style.display = "none");

            const labelWrap = document.createElement("span");
            labelWrap.style.cssText = "display:flex; flex-direction:column; line-height:1.3;";
            labelWrap.innerHTML = `<span>${p.service.charAt(0).toUpperCase() + p.service.slice(1)}</span><span style="opacity:0.6;font-size:0.78rem;">${p.name}</span>`;

            row.appendChild(icon);
            row.appendChild(labelWrap);
            if (isActive) {
              const check = document.createElement("span");
              check.textContent = "✓";
              check.style.marginLeft = "auto";
              row.appendChild(check);
            }

            row.addEventListener("click", (ev) => {
              ev.stopPropagation();
              dropdown.remove();
              document.removeEventListener("mousedown", outsideClose);
              updateNavVisibility();
              resetFeed();
              state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${p.service}/user/${p.id}/posts`;
              state.currentFeedCreatorName = p.name;
              updateNavTabs({ ...p, allPlatforms: creator.allPlatforms });
              fetchPosts();
            });

            dropdown.appendChild(row);
          });
        }

        document.body.appendChild(dropdown);

        const navEl = document.getElementById("nav");
        if (navEl) navEl.classList.add("visible");

        function cleanup() {
          document.removeEventListener("mousedown", outsideClose);
          document.removeEventListener("touchstart", outsideClose);
        }
        dropdown._cleanup = cleanup;

        function outsideClose(ev) {
          if (!dropdown.contains(ev.target) && ev.target !== btn) {
            cleanup();
            dropdown.remove();
            if (navEl) updateNavVisibility();
          }
        }
        setTimeout(() => {
          document.addEventListener("mousedown", outsideClose);
          document.addEventListener("touchstart", outsideClose);
        }, 0);
        return;
      }

      Array.from(navTabs.children).forEach((c) => (c.style.background = ""));
      btn.style.background = "rgba(0, 123, 255, 0.6)";

      resetFeed();
      if (tab === "Fancards" && state.currentSite === "cum") {
        feed.style.scrollSnapType = "";
        feed.classList.remove("continuous-scroll");
        state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts?type=fancards`;
        fetchPosts();
      } else if (tab === "Posts" || tab === "DMs" || tab === "Announcements" || tab === "Fancards") {
        feed.style.scrollSnapType = "";
        feed.classList.remove("continuous-scroll");
        state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/${tab.toLowerCase()}`;
        fetchPosts();
      } else if (tab === "Similar Creators" || tab === "Similar Artists") {
        feed.style.scrollSnapType = "none";
        feed.classList.add("continuous-scroll");
        const isMobile = window.innerWidth <= 600 || window.innerHeight <= 500;
        const placeholderPadding = isMobile ? "120px 20px 40px 20px" : "80px 20px 40px 20px";

        feed.innerHTML = `<div style="text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;">Loading similar creators...</div>`;

        const renderCreators = (similarCreators) => {
          feed.innerHTML = "";
          if (similarCreators && similarCreators.length > 0) {
            const grid = document.createElement("div");
            grid.className = "creators-grid";
            const isMob = window.innerWidth <= 600 || window.innerHeight <= 500;
            const pad = isMob ? "120px 20px 60px 20px" : "80px 20px 60px 20px";
            grid.style.cssText = `padding: ${pad}; width: 100%; box-sizing: border-box;`;
            similarCreators.forEach((c) => {
              c.allPlatforms = [c];
              const card = buildCreatorCard(c);
              grid.appendChild(card);
            });
            feed.appendChild(grid);
          } else {
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
            placeholder.textContent = `No similar creators found for this profile.`;
            feed.appendChild(placeholder);
          }
        };

        if (state.currentSite === "kemono") {
          const endpoint = `${PROXY_URL}/kemono/api/v1/${creator.service}/user/${creator.id}/recommended`;
          fetch(endpoint, { headers: { Accept: "text/css" } })
            .then((res) => {
              if (!res.ok) throw new Error("Not found");
              return res.json();
            })
            .then((data) => {
              const list = Array.isArray(data) ? data : (data.creators || []);
              renderCreators(list);
            })
            .catch(() => {
              feed.innerHTML = "";
              const placeholder = document.createElement("div");
              placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
              placeholder.textContent = `No similar creators found for this profile.`;
              feed.appendChild(placeholder);
            });
          return;
        }

        if (state.currentSite === "pawchive") {
          const endpoint = `${PROXY_URL}/pawchive/${creator.service}/user/${creator.id}/recommended`;
          fetch(endpoint)
            .then((res) => {
              if (!res.ok) throw new Error("Proxy error or not found");
              return res.text();
            })
            .then((html) => {
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, "text/html");
              const cards = doc.querySelectorAll(".user-card");
              const scrapedCreators = [];

              const creatorFavMap = new Map();
              if (state.allCreators) {
                for (const cObj of state.allCreators) {
                  if (cObj.allPlatforms) {
                    for (const p of cObj.allPlatforms) {
                      creatorFavMap.set(`${p.service}:${p.id}`, p.favorited || p.bookmarked || 0);
                    }
                  }
                }
              }

              cards.forEach((card) => {
                const nameEl = card.querySelector(".user-card__name");
                const serviceId = card.getAttribute("data-service");
                const userId = card.getAttribute("data-id");
                if (serviceId && userId && nameEl) {
                  const favoritedCount = creatorFavMap.get(`${serviceId}:${userId}`) || 0;

                  scrapedCreators.push({
                    id: userId,
                    name: nameEl.textContent.trim(),
                    service: serviceId,
                    favorited: favoritedCount,
                  });
                }
              });
              renderCreators(scrapedCreators);
            })
            .catch(() => {
              feed.innerHTML = "";
              const placeholder = document.createElement("div");
              placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
              placeholder.textContent = `Similar artists fetch failed. Ensure your paw-worker proxy supports routing HTML pages.`;
              feed.appendChild(placeholder);
            });
          return;
        }

        const endpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/similar`;
        fetch(endpoint)
          .then((res) => {
            if (!res.ok) throw new Error("Not found");
            return res.json();
          })
          .then((data) => {
            const similarCreators = data.creators || (Array.isArray(data) ? data : null);
            renderCreators(similarCreators);
          })
          .catch(() => {
            feed.innerHTML = "";
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
            placeholder.textContent = `Similar artists are not yet supported for this source.`;
            feed.appendChild(placeholder);
          });
      } else if (tab === "Tags") {
        feed.style.scrollSnapType = "none";
        feed.classList.add("continuous-scroll");
        const isMobile = window.innerWidth <= 600 || window.innerHeight <= 500;
        const placeholderPadding = isMobile ? "120px 20px 40px 20px" : "80px 20px 40px 20px";

        feed.innerHTML = `<div style="text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;">Loading tags...</div>`;

        const endpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/tags`;
        fetch(endpoint, { headers: { Accept: "text/css" } })
          .then((res) => {
            if (!res.ok) throw new Error("Failed to fetch tags");
            return res.json();
          })
          .then((data) => {
            const rawTags = Array.isArray(data) ? data : (data.tags || []);
            feed.innerHTML = "";
            if (rawTags.length === 0) {
              const placeholder = document.createElement("div");
              placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
              placeholder.textContent = `No tags found for this creator.`;
              feed.appendChild(placeholder);
              return;
            }

            const container = document.createElement("div");
            container.className = "tags-container";
            const pad = isMobile ? "120px 20px 60px 20px" : "80px 20px 60px 20px";
            container.style.cssText = `padding: ${pad}; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; max-width: 900px; margin: 0 auto; box-sizing: border-box;`;

            rawTags.forEach((item) => {
              const tagText = typeof item === "string" ? item : (item.tag || item.name || "");
              const postCount = typeof item === "object" && item.post_count !== undefined ? item.post_count : null;
              if (!tagText) return;

              const tagBtn = document.createElement("button");
              tagBtn.style.cssText = `
                display: inline-flex; align-items: center; gap: 8px;
                padding: 8px 16px; border-radius: 20px;
                background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15);
                color: #fff; font-size: 0.95rem; cursor: pointer; transition: all 0.2s;
              `;
              tagBtn.innerHTML = `<span>#${escapeHtml(tagText)}</span>${postCount !== null ? `<span style="font-size:0.8rem; opacity:0.6; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:10px;">${postCount}</span>` : ""}`;

              tagBtn.onmouseenter = () => {
                tagBtn.style.background = "rgba(0, 123, 255, 0.5)";
                tagBtn.style.borderColor = "rgba(0, 123, 255, 0.8)";
              };
              tagBtn.onmouseleave = () => {
                tagBtn.style.background = "rgba(255, 255, 255, 0.08)";
                tagBtn.style.borderColor = "rgba(255, 255, 255, 0.15)";
              };

              tagBtn.addEventListener("click", () => {
                resetFeed();
                feed.style.scrollSnapType = "";
                feed.classList.remove("continuous-scroll");
                state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/posts?tag=${encodeURIComponent(tagText)}`;
                Array.from(navTabs.children).forEach((c) => (c.style.background = ""));
                fetchPosts();
              });

              container.appendChild(tagBtn);
            });

            feed.appendChild(container);
          })
          .catch(() => {
            feed.innerHTML = "";
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
            placeholder.textContent = `Failed to load tags for this creator.`;
            feed.appendChild(placeholder);
          });
      } else {
        feed.style.scrollSnapType = "none";
        feed.classList.add("continuous-scroll");
        const isMobile = window.innerWidth <= 600 || window.innerHeight <= 500;
        const placeholderPadding = isMobile ? "120px 20px 40px 20px" : "80px 20px 40px 20px";
        const placeholder = document.createElement("div");
        placeholder.style.cssText = `text-align:center; padding: ${placeholderPadding}; color: #aaa; font-size: 1.2rem; width: 100%; box-sizing: border-box;`;
        placeholder.textContent = `${tab} are not yet supported by Paw Reader.`;
        feed.appendChild(placeholder);
      }
    });

    if (
      (state.currentSite === "kemono" || state.currentSite === "pawchive") &&
      (tab === "DMs" || tab === "Announcements" || tab === "Fancards" || tab === "Linked Accounts" || tab === "Tags")
    ) {
      const srv = (creator.service || "").toLowerCase();

      setTimeout(() => {
        if (currentSeq !== navTabsSeq) return;

        if (tab === "Linked Accounts") {
          const cacheKey = `_linksFetched`;
          if (creator[cacheKey] !== undefined) {
            btn.style.display = creator.allPlatforms && creator.allPlatforms.length > 1 ? "flex" : "none";
          } else {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            fetch(`${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/links`, {
              signal: controller.signal,
              headers: { Accept: "text/css" }
            })
              .then((res) => (res.ok ? res.json() : []))
              .then((arr) => {
                clearTimeout(timeoutId);
                if (currentSeq !== navTabsSeq) return;
                if (Array.isArray(arr) && arr.length > 0) {
                  creator.allPlatforms = creator.allPlatforms || [{ id: creator.id, service: creator.service, name: creator.name }];
                  
                  arr.forEach((link) => {
                    const exists = creator.allPlatforms.find((p) => p.id === link.id && p.service === link.service);
                    if (!exists) {
                      creator.allPlatforms.push({
                        id: link.id,
                        service: link.service,
                        name: link.name || link.id
                      });
                    }
                  });
                }
                creator[cacheKey] = true;
                btn.style.display = creator.allPlatforms && creator.allPlatforms.length > 1 ? "flex" : "none";
              })
              .catch(() => {
                clearTimeout(timeoutId);
                if (currentSeq !== navTabsSeq) return;
                creator[cacheKey] = true;
                btn.style.display = creator.allPlatforms && creator.allPlatforms.length > 1 ? "flex" : "none";
              });
          }
        } else {
          if (tab === "DMs" && srv !== "patreon") {
            btn.style.display = "none";
            return;
          }
          if (tab === "Announcements" && srv !== "patreon") {
            btn.style.display = "none";
            return;
          }
          if (tab === "Fancards" && srv !== "fanbox") {
            btn.style.display = "none";
            return;
          }

          const cacheKey = `_has${tab}`;

          if (creator[cacheKey] !== undefined) {
            btn.style.display = creator[cacheKey] ? "" : "none";
          } else {
            btn.style.display = "none";
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            fetch(`${PROXY_URL}/${state.currentSite}/api/v1/${creator.service}/user/${creator.id}/${tab.toLowerCase()}?limit=1`, {
              signal: controller.signal,
              headers: { Accept: "text/css" }
            })
              .then(async (res) => {
                if (!res.ok) throw new Error("Check failed");
                const contentType = res.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                  return res.json();
                }
                const text = await res.text();
                return text.includes("<article") || text.includes("post-card") || text.includes("dm-card") ? [1] : [];
              })
              .then((data) => {
                clearTimeout(timeoutId);
                if (currentSeq !== navTabsSeq) return;
                const arr = Array.isArray(data)
                  ? data
                  : (data.posts || data.announcements || data.dms || data.fancards || data.tags || []);
                if (arr.length > 0) {
                  btn.style.display = "";
                  creator[cacheKey] = true;
                } else {
                  creator[cacheKey] = false;
                }
              })
              .catch(() => {
                clearTimeout(timeoutId);
                if (currentSeq !== navTabsSeq) return;
                creator[cacheKey] = false;
              });
          }
        }
      }, 350);
    }

    navTabs.appendChild(btn);
  });
}

export function wrapCarousel(carousel, direction) {
  if (!carousel) return;
  let target = 0;
  if (direction === "end") {
    target = carousel.scrollWidth - carousel.clientWidth;
  }
  carousel.dataset.targetScroll = target;
  carousel.dataset.scrollDir = direction === "end" ? "left" : "right";
  carousel.style.scrollSnapType = "none";
  carousel.scrollTo({ left: target, behavior: "auto" });
  requestAnimationFrame(() => {
    carousel.style.scrollSnapType = "";
  });
}

export function showView(viewElement, showNav = true) {
  [welcomeScreen, creatorsView, feedView].forEach((v) => {
    if (v) v.classList.remove("active");
  });
  if (viewElement) viewElement.classList.add("active");

  if (showNav && nav) nav.classList.remove("hidden");
  else if (nav) nav.classList.add("hidden");

  const navTabs = document.getElementById("nav-tabs");

  if (viewElement === feedView) {
    if (nav) nav.classList.add("auto-hide");
    state.navManualVisible = false;
    if (navInfo) navInfo.classList.remove("hidden");
    if (navTabs) {
      if (state.currentFeedCreatorName || state.currentSite === "e621") {
        navTabs.classList.remove("hidden");
      } else {
        navTabs.classList.add("hidden");
      }
    }
    updateNavVisibility();
  } else {
    state.navManualVisible = false;
    if (nav) {
      nav.classList.remove("auto-hide");
      nav.classList.remove("visible");
    }
    if (navTabs) navTabs.classList.add("hidden");
    if (navInfo) navInfo.classList.add("hidden");
  }
}