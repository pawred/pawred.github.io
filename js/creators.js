import { PROXY_URL, state } from "./state.js";
import { getServiceColor, startProgress, stopProgress, escapeHtml, fetchWithRetry } from "./utils.js";
import { updateNavTabs, showView, navBack, feedView } from "./nav.js";
import { resetFeed, fetchPosts } from "./feed.js";

export const creatorsList = document.getElementById("creators-list");
export const creatorsLoading = document.getElementById("creators-loading");

export function updateCreatorsLoading(text) {
  if (!creatorsLoading) return;
  creatorsLoading.innerHTML = `<span class="loading-spinner"></span><span>${escapeHtml(text)}</span>`;
}

export const searchInput = document.getElementById("creator-search");
export const searchClearBtn = document.getElementById("creator-search-clear");

export function clearSearch() {
  if (searchInput) {
    searchInput.value = "";
  }
  if (searchClearBtn) {
    searchClearBtn.style.display = "none";
  }
}

export const sortSelect = document.getElementById("creator-sort");
export const sortDirBtn = document.getElementById("creator-sort-dir");
export const serviceFilterSelect = document.getElementById("creator-service-filter");
export const contentFilterSelect = document.getElementById("creator-content-filter");
export const genderFilterSelect = document.getElementById("creator-gender-filter");
export const paginationContainer = document.getElementById("creator-pagination");
export const paginationTopContainer = document.getElementById("creator-pagination-top");

export const SITE_SERVICES = {
  kemono: ["boosty", "dlsite", "fanbox", "fantia", "gumroad", "patreon", "subscribestar"],
  pawchive: ["fanbox", "patreon"],
  cum: ["fansly", "onlyfans", "patreon"],
  e621: ["e621"],
};

export const SERVICE_LABELS = {
  boosty: "Boosty",
  dlsite: "DLsite",
  fanbox: "Fanbox",
  fantia: "Fantia",
  gumroad: "Gumroad",
  patreon: "Patreon",
  subscribestar: "SubscribeStar",
  onlyfans: "OnlyFans",
  fansly: "Fansly",
  e621: "e621",
};

let currentRenderedFilterSite = null;

export function formatServiceName(service) {
  return SERVICE_LABELS[service] || (service.charAt(0).toUpperCase() + service.slice(1));
}

export function renderServiceFilters(site = state.currentSite, force = false) {
  if (!serviceFilterSelect) return;
  if (!force && currentRenderedFilterSite === site && serviceFilterSelect.children.length > 0) {
    return;
  }

  currentRenderedFilterSite = site;
  const services = SITE_SERVICES[site] || [];
  const checkedBoxes = Array.from(serviceFilterSelect.querySelectorAll("input:checked")).map((cb) => cb.value);
  if (site === "cum" && checkedBoxes.length > 1) {
    checkedBoxes.length = 1;
  }

  serviceFilterSelect.innerHTML = "";
  services.forEach((service) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = service;
    if (checkedBoxes.includes(service)) {
      cb.checked = true;
    }

    if (site === "cum") {
      cb.addEventListener("click", () => {
        if (cb.checked) {
          serviceFilterSelect.querySelectorAll("input[type='checkbox']").forEach((other) => {
            if (other !== cb) other.checked = false;
          });
        }
      });
    }

    const text = document.createTextNode(" " + formatServiceName(service));
    label.appendChild(cb);
    label.appendChild(text);
    serviceFilterSelect.appendChild(label);
  });
}

export function syncDiscoveredServices(discoveredServices, site = state.currentSite) {
  if (!serviceFilterSelect || currentRenderedFilterSite !== site) return;
  const existingValues = new Set(
    Array.from(serviceFilterSelect.querySelectorAll("input")).map((cb) => cb.value)
  );

  discoveredServices.forEach((service) => {
    if (!service || service === "discord" || existingValues.has(service)) return;
    existingValues.add(service);

    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = service;

    if (site === "cum") {
      cb.addEventListener("click", () => {
        if (cb.checked) {
          serviceFilterSelect.querySelectorAll("input[type='checkbox']").forEach((other) => {
            if (other !== cb) other.checked = false;
          });
        }
      });
    }

    const text = document.createTextNode(" " + formatServiceName(service));
    label.appendChild(cb);
    label.appendChild(text);
    serviceFilterSelect.appendChild(label);
  });
}

export function getPaginationContainers() {
  const containers = [];
  if (paginationTopContainer) containers.push(paginationTopContainer);
  if (paginationContainer) containers.push(paginationContainer);
  return containers;
}

let coomerFetchSeq = 0;
let creatorsLoadSeq = 0;

async function fetchAndRenderCoomerCreators() {
  const seq = ++coomerFetchSeq;
  const query = searchInput ? searchInput.value.trim() : "";
  if (creatorsLoading) {
    const site = state.currentSite ? (state.currentSite.charAt(0).toUpperCase() + state.currentSite.slice(1)) : "Creators";
    const text = query ? `Searching ${site} creators for "${query}"...` : `Loading ${site} creators...`;
    updateCreatorsLoading(text);
    creatorsLoading.classList.add("active");
  }
  startProgress();

  const sortVal = sortSelect ? sortSelect.value : "popularity";
  const contentFilter = contentFilterSelect ? contentFilterSelect.value : "content";
  const genderFilter = genderFilterSelect ? genderFilterSelect.value : "all";

  const checkedServices = serviceFilterSelect
    ? Array.from(serviceFilterSelect.querySelectorAll("input:checked")).map((cb) => cb.value)
    : [];

  const sortMap = {
    popularity: "bookmarked",
    "followers-desc": "bookmarked",
    "followers-asc": "bookmarked",
    indexed: "indexed",
    updated: "updated",
    alphabetical: "name",
    "name-asc": "name",
    "name-desc": "name",
    service: "service",
    dms: "dm_count",
    posts: "post_count"
  };
  const apiSort = sortMap[sortVal] || "bookmarked";

  const params = new URLSearchParams();
  const limit = state.creatorsPerPage || 50;
  params.set("limit", limit.toString());

  const page = Math.max(1, state.creatorPage || 1);
  const offset = (page - 1) * limit;
  params.set("o", offset.toString());
  params.set("sort", apiSort);

  if (query) {
    params.set("q", query);
  }

  if (contentFilter === "content") {
    params.set("content", "imported");
  } else if (contentFilter === "empty") {
    params.set("content", "empty");
  }

  if (genderFilter && genderFilter !== "all") {
    params.set("gender", genderFilter);
  }

  if (checkedServices.length === 1) {
    params.set("service", checkedServices[0]);
  }

  try {
    const url = `${PROXY_URL}/cum/api/v1/creators?${params.toString()}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`Failed to fetch creators: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (seq !== coomerFetchSeq) return;

    const total = typeof data.total === "number" ? data.total : (data.creators ? data.creators.length : 0);
    const rawCreators = data.creators || [];

    const displayedCreators = (checkedServices.length > 1 && checkedServices.length < 3)
      ? rawCreators.filter((c) => checkedServices.includes(c.service))
      : rawCreators;

    const creators = displayedCreators.map((c) => ({
      ...c,
      allPlatforms: [c]
    }));

    const existingIds = new Set(state.allCreators.map((c) => `${c.service}:${c.id}`));
    creators.forEach((c) => {
      if (!existingIds.has(`${c.service}:${c.id}`)) {
        state.allCreators.push(c);
      }
    });

    state.filteredCreators = creators;

    if (creatorsList) {
      creatorsList.innerHTML = "";
      if (creators.length === 0) {
        creatorsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #888; padding: 40px;">No creators found.</div>';
      } else {
        creators.forEach((creator) => {
          creatorsList.appendChild(buildCreatorCard(creator, checkedServices));
        });
      }
    }

    getPaginationContainers().forEach((c) => {
      c.innerHTML = "";
    });
    const totalPages = Math.ceil(total / limit);
    renderPagination(totalPages);
  } catch (err) {
    if (seq !== coomerFetchSeq) return;
    console.error("Error fetching creators:", err);
    if (creatorsList) {
      creatorsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #ff6b6b; padding: 40px;">Failed to load creators. Please try again.</div>';
    }
    getPaginationContainers().forEach((c) => {
      c.innerHTML = "";
    });
  } finally {
    if (seq === coomerFetchSeq) {
      if (creatorsLoading) creatorsLoading.classList.remove("active");
      stopProgress();
    }
  }
}

export async function loadCreators() {
  renderServiceFilters(state.currentSite);

  if (state.currentSite === "cum") {
    state.loadedCreatorsSite = "cum";
    await filterAndSortCreators();
    return;
  }

  if (state.allCreators.length > 0 && state.loadedCreatorsSite === state.currentSite) {
    if (creatorsList && creatorsList.children.length === 0) {
      renderCreatorsPage();
    }
    return;
  }

  const loadSeq = ++creatorsLoadSeq;
  const currentSiteAtCall = state.currentSite;

  state.loadedCreatorsSite = currentSiteAtCall;
  state.allCreators = [];
  if (creatorsList) creatorsList.innerHTML = "";
  if (creatorsLoading) {
    const site = currentSiteAtCall ? (currentSiteAtCall.charAt(0).toUpperCase() + currentSiteAtCall.slice(1)) : "Creators";
    updateCreatorsLoading(`Loading ${site} creators...`);
    creatorsLoading.classList.add("active");
  }
  startProgress();

  try {
    let res;
    if (currentSiteAtCall === "e621") {
      try {
        const query = searchInput ? searchInput.value.trim() : "";
        let directUrl = "https://e621.net/tags.json?search[category]=1&search[order]=count&limit=100";
        if (query) {
          directUrl += `&search[name_matches]=*${encodeURIComponent(query.toLowerCase())}*`;
        }
        res = await fetch(directUrl);
      } catch (_) {}

      if (!res || !res.ok) {
        try {
          res = await fetchWithRetry(`${PROXY_URL}/${currentSiteAtCall}/api/v1/creators`);
        } catch (fetchErr) {
          res = null;
        }
      }
    } else {
      res = await fetchWithRetry(`${PROXY_URL}/${currentSiteAtCall}/api/v1/creators`);
    }

    if (loadSeq !== creatorsLoadSeq || state.currentSite !== currentSiteAtCall) return;
    if (!res || !res.ok) throw new Error("Failed to fetch creators: " + (res ? `${res.status} ${res.statusText}` : "timeout"));
    let rawCreators = await res.json();
    if (currentSiteAtCall === "e621" && Array.isArray(rawCreators) && rawCreators.length > 0 && rawCreators[0].post_count !== undefined && !rawCreators[0].service) {
      rawCreators = rawCreators.map((t) => ({
        id: t.name,
        name: t.name.replace(/_/g, " "),
        service: "e621",
        favorited: t.post_count || 0,
        postCount: t.post_count || 0,
        updated: "2026-01-01"
      }));
    }
    const uniqueCreators = new Map();
    const nameToRelationId = new Map();

    // Pass 1: Build name -> relation_id mapping so order doesn't matter
    rawCreators.forEach((c) => {
      if (c.service === "discord") return;
      const lowerName = (c.name || "").toLowerCase().trim();
      if (c.relation_id !== undefined && c.relation_id !== null && lowerName) {
        nameToRelationId.set(lowerName, c.relation_id);
      }
    });

    // Pass 2: Group creators
    rawCreators.forEach((c) => {
      if (c.service === "discord") return;
      const lowerName = (c.name || "").toLowerCase().trim();
      const heuristicName = lowerName.replace(/[\s_\-]/g, "");
      let key = "";

      if (c.relation_id !== undefined && c.relation_id !== null) {
        key = "rel_" + c.relation_id;
      } else if (nameToRelationId.has(lowerName)) {
        key = "rel_" + nameToRelationId.get(lowerName);
      } else {
        key = "name_" + heuristicName;
      }

      if (!uniqueCreators.has(key)) {
        uniqueCreators.set(key, { platforms: [c] });
      } else {
        uniqueCreators.get(key).platforms.push(c);
      }
    });

    state.allCreators = Array.from(uniqueCreators.values()).map((uc) => {
      uc.platforms.sort((a, b) => (b.favorited || 0) - (a.favorited || 0));
      return {
        ...uc.platforms[0],
        allPlatforms: uc.platforms,
      };
    });

    if (serviceFilterSelect) {
      const services = new Set();
      state.allCreators.forEach((c) => {
        services.add(c.service);
        if (c.allPlatforms) c.allPlatforms.forEach((p) => services.add(p.service));
      });
      syncDiscoveredServices(Array.from(services).sort(), currentSiteAtCall);
    }

    filterAndSortCreators();
  } catch (error) {
    if (loadSeq !== creatorsLoadSeq) return;
    console.error("Error fetching creators:", error);
    if (creatorsLoading) creatorsLoading.innerHTML = `<span>Failed to load creators.</span>`;
  } finally {
    if (loadSeq === creatorsLoadSeq) {
      if (creatorsLoading) creatorsLoading.classList.remove("active");
      stopProgress();
    }
  }
}

export function filterAndSortCreators() {
  if (state.currentSite === "cum") {
    fetchAndRenderCoomerCreators();
    return;
  }
  const query = searchInput ? searchInput.value.toLowerCase() : "";
  const sort = sortSelect ? sortSelect.value : "popularity";
  const contentFilter = contentFilterSelect ? contentFilterSelect.value : "content";
  const genderFilter = genderFilterSelect ? genderFilterSelect.value : "all";

  const checkedServices = serviceFilterSelect
    ? Array.from(serviceFilterSelect.querySelectorAll("input:checked")).map((cb) => cb.value)
    : [];

  state.filteredCreators = state.allCreators.filter((c) => {
    const matchesQuery = (c.name || "").toLowerCase().includes(query);

    const matchesService =
      checkedServices.length === 0 ||
      checkedServices.includes(c.service) ||
      (c.allPlatforms && c.allPlatforms.some((p) => checkedServices.includes(p.service)));

    let hasContent = false;
    if (state.currentSite === "cum") {
      hasContent = c.postCount > 0 || c.imageCount > 0 || c.videoCount > 0 || c.dmCount > 0;
    } else {
      hasContent = c.updated !== 0;
    }

    let matchesContent = true;
    if (contentFilter === "content") matchesContent = hasContent;
    else if (contentFilter === "empty") matchesContent = !hasContent;

    let matchesGender = true;
    if (state.currentSite === "cum" && genderFilter && genderFilter !== "all") {
      const g = (c.gender || "").toLowerCase().replace(/[- ]/g, "_");
      matchesGender = g === genderFilter;
    }

    return matchesQuery && matchesService && matchesContent && matchesGender;
  });

  const isAsc = state.creatorSortDir === "asc";
  const getTime = (v) => {
    if (!v) return 0;
    if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
    const t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  };

  state.filteredCreators.sort((a, b) => {
    let diff = 0;
    if (sort === "popularity" || sort === "followers-desc" || sort === "followers-asc") {
      diff = (b.favorited || b.bookmarked || 0) - (a.favorited || a.bookmarked || 0);
    } else if (sort === "indexed") {
      diff = getTime(b.indexed) - getTime(a.indexed);
    } else if (sort === "updated") {
      diff = getTime(b.updated) - getTime(a.updated);
    } else if (sort === "alphabetical" || sort === "name-asc" || sort === "name-desc") {
      diff = (a.name || "").localeCompare(b.name || "");
      return isAsc ? -diff : diff;
    } else if (sort === "service") {
      diff = (a.service || "").localeCompare(b.service || "") || (a.name || "").localeCompare(b.name || "");
      return isAsc ? -diff : diff;
    } else if (sort === "dms") {
      diff = (b.dmCount || 0) - (a.dmCount || 0);
    } else if (sort === "posts") {
      diff = (b.postCount || 0) - (a.postCount || 0);
    }
    return isAsc ? -diff : diff;
  });

  renderCreatorsPage();
}

export function buildCreatorCard(creator, checkedServices = []) {
  const card = document.createElement("div");
  card.className = "creator-card";

  let currentPlatformIndex = 0;
  if (checkedServices.length > 0 && creator.allPlatforms) {
    const idx = creator.allPlatforms.findIndex((p) => checkedServices.includes(p.service));
    if (idx !== -1) currentPlatformIndex = idx;
  }

  const initialPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
  card.style.background = getServiceColor(initialPlatform.service);

  const img = document.createElement("img");
  img.className = "creator-image";

  function setAvatar(p) {
    if (state.currentSite === "e621") {
      img.style.display = "none";
      img.src = "";
    } else if (state.currentSite === "cum") {
      if (p.avatarThumbhash === null || p.avatarThumbhash === false) {
        img.style.display = "none";
        img.src = "";
      } else {
        img.src = `${PROXY_URL}/cum/creator-avatar/${p.service}/${p.id}/avatar.webp`;
        img.style.display = "";
      }
    } else {
      img.src = `${PROXY_URL}/${state.currentSite}/icons/${p.service}/${p.id}`;
      img.style.display = "";
    }
  }

  img.loading = "lazy";
  img.onload = () => {
    if (img.naturalWidth <= 1 && img.naturalHeight <= 1) {
      img.style.display = "none";
    }
  };
  img.onerror = () => {
    img.style.display = "none";
  };

  setAvatar(initialPlatform);

  const name = document.createElement("div");
  name.className = "creator-name";
  name.textContent = initialPlatform.name;

  const getFavCount = (p) =>
    (p.favorited !== undefined
      ? p.favorited
      : p.bookmarked !== undefined
        ? p.bookmarked
        : creator.favorited || creator.bookmarked || 0) || 0;

  const service = document.createElement("div");
  service.className = "creator-service";
  service.textContent = initialPlatform.service;

  const favorites = document.createElement("div");
  favorites.className = "creator-favorites";
  favorites.textContent = `⭐ ${getFavCount(initialPlatform).toLocaleString()}`;

  card.appendChild(img);
  card.appendChild(name);
  card.appendChild(service);
  card.appendChild(favorites);

  if (creator.allPlatforms && creator.allPlatforms.length > 1) {
    const switchBtn = document.createElement("div");
    switchBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
    switchBtn.style.position = "absolute";
    switchBtn.style.top = "10px";
    switchBtn.style.right = "10px";
    switchBtn.style.cursor = "pointer";
    switchBtn.style.background = "rgba(0,0,0,0.5)";
    switchBtn.style.borderRadius = "50%";
    switchBtn.style.width = "32px";
    switchBtn.style.height = "32px";
    switchBtn.style.display = "flex";
    switchBtn.style.alignItems = "center";
    switchBtn.style.justifyContent = "center";
    switchBtn.title = "Switch Service";

    switchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      currentPlatformIndex = (currentPlatformIndex + 1) % creator.allPlatforms.length;
      const newPlatform = creator.allPlatforms[currentPlatformIndex];
      setAvatar(newPlatform);
      name.textContent = newPlatform.name;
      service.textContent = newPlatform.service;
      favorites.textContent = `⭐ ${getFavCount(newPlatform).toLocaleString()}`;
      card.style.background = getServiceColor(newPlatform.service);
    });
    card.appendChild(switchBtn);
  }

  card.addEventListener("click", () => {
    resetFeed();
    const selectedPlatform = creator.allPlatforms ? creator.allPlatforms[currentPlatformIndex] : creator;
    state.currentFeedEndpoint = `${PROXY_URL}/${state.currentSite}/api/v1/${selectedPlatform.service}/user/${selectedPlatform.id}/posts`;
    state.currentFeedCreatorName = creator.name;
    updateNavTabs({ ...selectedPlatform, allPlatforms: creator.allPlatforms });
    if (navBack) navBack.classList.remove("hidden");
    showView(feedView, true);
    fetchPosts();
  });

  return card;
}

export function renderCreatorsPage() {
  const containers = getPaginationContainers();
  if (!creatorsList) return;
  creatorsList.innerHTML = "";
  containers.forEach((c) => {
    c.innerHTML = "";
  });

  const totalPages = Math.ceil(state.filteredCreators.length / state.creatorsPerPage);
  if (state.creatorPage > totalPages) state.creatorPage = Math.max(1, totalPages);
  if (state.creatorPage < 1) state.creatorPage = 1;

  const start = (state.creatorPage - 1) * state.creatorsPerPage;
  const end = start + state.creatorsPerPage;
  const pageCreators = state.filteredCreators.slice(start, end);

  const checkedServices = serviceFilterSelect
    ? Array.from(serviceFilterSelect.querySelectorAll("input:checked")).map((cb) => cb.value)
    : [];

  pageCreators.forEach((creator) => {
    creatorsList.appendChild(buildCreatorCard(creator, checkedServices));
  });

  renderPagination(totalPages);
}

export function renderPagination(totalPages) {
  const containers = getPaginationContainers();
  containers.forEach((c) => {
    c.innerHTML = "";
  });
  if (totalPages <= 1 || containers.length === 0) return;

  const maxButtons = 7;
  let startPage = Math.max(1, state.creatorPage - Math.floor(maxButtons / 2));
  let endPage = startPage + maxButtons - 1;

  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  containers.forEach((container) => {
    if (startPage > 1) {
      container.appendChild(createPageBtn(1));
      if (startPage > 2) {
        const dots = document.createElement("span");
        dots.textContent = "...";
        dots.style.padding = "5px";
        container.appendChild(dots);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      container.appendChild(createPageBtn(i));
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const dots = document.createElement("span");
        dots.textContent = "...";
        dots.style.padding = "5px";
        container.appendChild(dots);
      }
      container.appendChild(createPageBtn(totalPages));
    }
  });
}

export function createPageBtn(pageNum) {
  const btn = document.createElement("button");
  btn.className = "page-btn";
  btn.textContent = pageNum;
  if (pageNum === state.creatorPage) {
    btn.classList.add("active");
  }
  btn.addEventListener("click", () => {
    state.creatorPage = pageNum;
    if (state.currentSite === "cum") {
      filterAndSortCreators();
    } else {
      renderCreatorsPage();
    }
    const cv = document.getElementById("creators-view");
    if (cv) cv.scrollTop = 0;
  });
  return btn;
}