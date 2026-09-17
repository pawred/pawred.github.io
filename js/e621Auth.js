// js/e621Auth.js
// Handles e621 user authentication, profile sync, blacklist parsing, and post filtering.

import { PROXY_URL, state } from "./state.js";

const KEY_USERNAME = "paw_e621_username";
const KEY_API_KEY = "paw_e621_api_key";
const KEY_BLACKLIST = "paw_e621_blacklist";
const KEY_BLACKLIST_ENABLED = "paw_e621_blacklist_enabled";

export function getE621Auth() {
  const username = (localStorage.getItem(KEY_USERNAME) || "").trim();
  const apiKey = (localStorage.getItem(KEY_API_KEY) || "").trim();
  return { username, apiKey, hasAuth: Boolean(username && apiKey) };
}

export function saveE621Auth(username, apiKey) {
  const cleanUser = (username || "").trim();
  const cleanKey = (apiKey || "").trim();
  if (cleanUser) {
    localStorage.setItem(KEY_USERNAME, cleanUser);
  } else {
    localStorage.removeItem(KEY_USERNAME);
  }
  if (cleanKey) {
    localStorage.setItem(KEY_API_KEY, cleanKey);
  } else {
    localStorage.removeItem(KEY_API_KEY);
  }
}

export function getE621Blacklist() {
  return localStorage.getItem(KEY_BLACKLIST) || "";
}

export function saveE621Blacklist(text) {
  localStorage.setItem(KEY_BLACKLIST, text || "");
}

export function isE621BlacklistEnabled() {
  const val = localStorage.getItem(KEY_BLACKLIST_ENABLED);
  return val === null ? true : val === "true";
}

export function setE621BlacklistEnabled(enabled) {
  localStorage.setItem(KEY_BLACKLIST_ENABLED, enabled ? "true" : "false");
}

export function getE621Headers() {
  const { username, apiKey } = getE621Auth();
  const headers = {};
  const userStr = username || "pawred";
  headers["User-Agent"] = `paw-reader/2.17 (by ${userStr} on e621)`;

  if (username && apiKey) {
    headers["Authorization"] = "Basic " + btoa(`${username}:${apiKey}`);
    headers["X-E621-Username"] = username;
    headers["X-E621-Api-Key"] = apiKey;
  }
  return headers;
}

/**
 * Parses e621 blacklist rules (one rule per line).
 * Rules can contain:
 * - Simple tags: e.g. "scat", "gore"
 * - Negated tags: e.g. "-male"
 * - Ratings: e.g. "rating:e", "-rating:s"
 * - Compound rules: e.g. "young -rating:s" (ALL conditions in a line must match)
 */
export function parseBlacklist(rawText) {
  if (!rawText || typeof rawText !== "string") return [];
  const lines = rawText.split("\n");
  const rules = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const parsedTokens = tokens.map((token) => {
      const lower = token.toLowerCase();
      const isNegated = lower.startsWith("-");
      const cleanToken = isNegated ? lower.slice(1) : lower;

      if (cleanToken.startsWith("rating:")) {
        const ratingVal = cleanToken.slice(7).charAt(0);
        return { type: "rating", value: ratingVal, negated: isNegated };
      }
      if (cleanToken.startsWith("user:") || cleanToken.startsWith("uploader:")) {
        const userVal = cleanToken.split(":")[1];
        return { type: "user", value: userVal, negated: isNegated };
      }
      if (cleanToken.startsWith("type:") || cleanToken.startsWith("ext:")) {
        const typeVal = cleanToken.split(":")[1];
        return { type: "ext", value: typeVal, negated: isNegated };
      }
      return { type: "tag", value: cleanToken, negated: isNegated };
    });

    rules.push(parsedTokens);
  }

  return rules;
}

/**
 * Checks if a post matches any blacklist rule.
 * A rule matches a post if EVERY token in the line matches.
 */
export function isPostBlacklisted(post, parsedRules) {
  if (!post || !parsedRules || parsedRules.length === 0) return false;

  const postTags = new Set(
    (Array.isArray(post.tags) ? post.tags : []).map((t) => String(t).toLowerCase())
  );
  const postRating = (post.rating || "").toLowerCase().charAt(0);
  const postUser = (post.user || "").toLowerCase();
  const postExt = ((post.file?.name || post.file?.path || "").split(".").pop() || "").toLowerCase();

  for (const rule of parsedRules) {
    let ruleMatches = true;

    for (const token of rule) {
      let tokenMatched = false;

      if (token.type === "tag") {
        tokenMatched = postTags.has(token.value);
      } else if (token.type === "rating") {
        tokenMatched = postRating === token.value;
      } else if (token.type === "user") {
        tokenMatched = postUser === token.value;
      } else if (token.type === "ext") {
        tokenMatched = postExt === token.value;
      }

      if (token.negated) {
        tokenMatched = !tokenMatched;
      }

      if (!tokenMatched) {
        ruleMatches = false;
        break;
      }
    }

    if (ruleMatches) {
      return true;
    }
  }

  return false;
}

/**
 * Fetches user profile from e621 to retrieve blacklisted_tags.
 */
export async function fetchE621UserProfile(username, apiKey) {
  if (!username) throw new Error("Username is required");

  const headers = {};
  headers["User-Agent"] = `paw-reader/2.17 (by ${username} on e621)`;
  if (apiKey) {
    headers["Authorization"] = "Basic " + btoa(`${username}:${apiKey}`);
  }

  // 1. Direct fetch to e621
  const directUrl = `https://e621.net/users.json?search[name]=${encodeURIComponent(username)}`;
  try {
    const res = await fetch(directUrl, { headers });
    if (res.ok) {
      const users = await res.json();
      if (Array.isArray(users) && users.length > 0) {
        return users[0];
      }
    }
  } catch (_) {}

  // 2. Fallback via proxy worker
  const proxyUrl = `${PROXY_URL}/e621/users.json?search[name]=${encodeURIComponent(username)}`;
  const proxyHeaders = { ...headers };
  if (apiKey) {
    proxyHeaders["X-E621-Username"] = username;
    proxyHeaders["X-E621-Api-Key"] = apiKey;
  }

  const proxyRes = await fetch(proxyUrl, { headers: proxyHeaders });
  if (!proxyRes.ok) {
    throw new Error(`Failed to fetch user profile: HTTP ${proxyRes.status}`);
  }
  const users = await proxyRes.json();
  if (Array.isArray(users) && users.length > 0) {
    return users[0];
  }
  throw new Error(`User "${username}" not found on e621`);
}
