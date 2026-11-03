// js/autocomplete.js
// Provides tag autocomplete for booru search inputs (e621 and Gelbooru)

import { PROXY_URL, state } from "./state.js";
import { getE621Headers } from "./e621Auth.js";
import { getGelbooruHeaders } from "./gelbooruAuth.js";

const CATEGORY_NAMES_E621 = {
  0: "general",
  1: "artist",
  3: "copyright",
  4: "character",
  5: "species",
  6: "invalid",
  7: "meta",
  8: "lore",
};

const CATEGORY_COLORS = {
  general: "#8cc0de",
  artist: "#ffcb6b",
  copyright: "#f07178",
  character: "#c3e88d",
  species: "#f78c6c",
  meta: "#c792ea",
  lore: "#89ddff",
  invalid: "#7f8c8d",
};

function formatCount(num) {
  if (!num || isNaN(num)) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return String(num);
}

function extractCurrentToken(inputValue, cursorIndex) {
  const beforeCursor = inputValue.slice(0, cursorIndex);
  const match = beforeCursor.match(/([^\s]+)$/);
  if (!match) return { token: "", start: cursorIndex, end: cursorIndex, isNegated: false };

  const rawToken = match[1];
  const start = cursorIndex - rawToken.length;
  const isNegated = rawToken.startsWith("-");
  const token = isNegated ? rawToken.slice(1) : rawToken;
  return { token, start, end: cursorIndex, isNegated, rawToken };
}

export function attachTagAutocomplete(inputEl) {
  if (!inputEl || inputEl._hasAutocomplete) return;
  inputEl._hasAutocomplete = true;

  const dropdown = document.createElement("div");
  dropdown.className = "paw-autocomplete-dropdown";
  dropdown.style.display = "none";
  document.body.appendChild(dropdown);

  let activeIndex = -1;
  let currentSuggestions = [];
  let currentTokenInfo = null;
  let abortCtrl = null;
  let debounceTimer = null;

  function updatePosition() {
    if (!inputEl.isConnected) {
      closeDropdown();
      return;
    }
    const rect = inputEl.getBoundingClientRect();
    dropdown.style.position = "fixed";
    dropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
    dropdown.style.left = `${rect.left + window.scrollX}px`;
    dropdown.style.width = `${Math.max(rect.width, 280)}px`;
    dropdown.style.zIndex = "99999";
  }

  function closeDropdown() {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    activeIndex = -1;
    currentSuggestions = [];
    currentTokenInfo = null;
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
  }

  function renderSuggestions(suggestions, query) {
    dropdown.innerHTML = "";
    currentSuggestions = suggestions;
    activeIndex = -1;

    if (!suggestions || suggestions.length === 0) {
      closeDropdown();
      return;
    }

    suggestions.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "paw-autocomplete-item";
      row.dataset.index = idx;

      const catColor = CATEGORY_COLORS[item.category] || "#f0f0f0";

      const nameSpan = document.createElement("span");
      nameSpan.className = "paw-autocomplete-name";
      nameSpan.textContent = item.name;
      nameSpan.style.color = catColor;

      const countSpan = document.createElement("span");
      countSpan.className = "paw-autocomplete-count";
      countSpan.textContent = formatCount(item.count);

      row.appendChild(nameSpan);
      row.appendChild(countSpan);

      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectSuggestion(idx);
      });

      row.addEventListener("mouseenter", () => {
        highlightItem(idx);
      });

      dropdown.appendChild(row);
    });

    updatePosition();
    dropdown.style.display = "flex";
  }

  function highlightItem(index) {
    const items = dropdown.querySelectorAll(".paw-autocomplete-item");
    items.forEach((el, i) => {
      el.classList.toggle("active", i === index);
    });
    activeIndex = index;
    if (index >= 0 && items[index]) {
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  function selectSuggestion(index) {
    if (index < 0 || index >= currentSuggestions.length) return;
    const selected = currentSuggestions[index];
    const val = inputEl.value;
    const cursor = inputEl.selectionStart || val.length;
    const tokenInfo = extractCurrentToken(val, cursor);

    const prefix = tokenInfo.isNegated ? "-" : "";
    const replacement = `${prefix}${selected.name} `;
    const newVal = val.slice(0, tokenInfo.start) + replacement + val.slice(tokenInfo.end);

    inputEl.value = newVal;
    const newCursor = tokenInfo.start + replacement.length;
    inputEl.setSelectionRange(newCursor, newCursor);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.focus();

    closeDropdown();
  }

  async function fetchSuggestions(term) {
    const minLen = state.currentSite === "e621" ? 3 : 2;
    if (!term || term.length < minLen) {
      closeDropdown();
      return;
    }

    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;

    try {
      let results = [];
      if (state.currentSite === "e621") {
        let data = null;

        // 1. Direct e621 autocomplete without custom headers (avoids browser OPTIONS preflight 404)
        try {
          const res = await fetch(
            `https://e621.net/tags/autocomplete.json?search[name_matches]=${encodeURIComponent(term.toLowerCase())}&expiry=7`,
            { signal }
          );
          if (res.ok) {
            data = await res.json();
          }
        } catch (_) {}

        // 2. Direct REST tags.json endpoint with e621 headers (plural endpoint handles CORS natively)
        if (!data || !Array.isArray(data) || data.length === 0) {
          try {
            const headers = getE621Headers();
            const res = await fetch(
              `https://e621.net/tags.json?search[name_matches]=*${encodeURIComponent(term.toLowerCase())}*&search[order]=count&limit=10`,
              { headers, signal }
            );
            if (res.ok) {
              data = await res.json();
            }
          } catch (_) {}
        }

        // 3. Fallback: Creators endpoint on worker
        if (!data || !Array.isArray(data) || data.length === 0) {
          try {
            const ep = `${PROXY_URL}/e621/api/v1/creators?q=${encodeURIComponent(term)}`;
            const res = await fetch(ep, { signal });
            if (res.ok) {
              const creators = await res.json();
              if (Array.isArray(creators)) {
                data = creators.map((c) => ({
                  name: c.id || c.name,
                  post_count: c.postCount || c.favorited || 0,
                  category: 1,
                }));
              }
            }
          } catch (_) {}
        }

        if (Array.isArray(data)) {
          results = data.slice(0, 10).map((t) => ({
            name: t.name,
            count: t.post_count || 0,
            category: CATEGORY_NAMES_E621[t.category] || "general",
          }));
        }
      } else if (state.currentSite === "gelbooru") {
        const url = `${PROXY_URL}/gelbooru/api/v1/creators?q=${encodeURIComponent(term)}`;
        const gelHeaders = getGelbooruHeaders();
        const res = await fetch(url, { headers: gelHeaders, signal });
        if (res.ok) {
          const data = await res.json();
          results = (Array.isArray(data) ? data : []).slice(0, 10).map((t) => ({
            name: (t.id || t.name).replace(/\s+/g, "_"),
            count: t.postCount || t.favorited || 0,
            category: "general",
          }));
        }
      }

      if (!signal.aborted) {
        renderSuggestions(results, term);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        closeDropdown();
      }
    }
  }

  inputEl.addEventListener("input", () => {
    const isBooru = state.currentSite === "e621" || state.currentSite === "gelbooru";
    if (!isBooru) {
      closeDropdown();
      return;
    }

    const cursor = inputEl.selectionStart || inputEl.value.length;
    const tokenInfo = extractCurrentToken(inputEl.value, cursor);
    currentTokenInfo = tokenInfo;

    clearTimeout(debounceTimer);
    const minLen = state.currentSite === "e621" ? 3 : 2;
    if (!tokenInfo.token || tokenInfo.token.length < minLen) {
      closeDropdown();
      return;
    }

    debounceTimer = setTimeout(() => {
      fetchSuggestions(tokenInfo.token);
    }, 240);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (dropdown.style.display !== "none" && currentSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = activeIndex + 1 >= currentSuggestions.length ? 0 : activeIndex + 1;
        highlightItem(next);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = activeIndex - 1 < 0 ? currentSuggestions.length - 1 : activeIndex - 1;
        highlightItem(prev);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (activeIndex >= 0) {
          e.preventDefault();
          selectSuggestion(activeIndex);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        return;
      }
    }
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(closeDropdown, 200);
  });

  window.addEventListener("resize", updatePosition);
  window.addEventListener("scroll", updatePosition, true);
}
