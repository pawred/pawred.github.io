// js/gelbooruAuth.js
// Handles Gelbooru user ID and API key storage and headers

const KEY_USER_ID = "paw_gelbooru_user_id";
const KEY_API_KEY = "paw_gelbooru_api_key";

export function getGelbooruAuth() {
  const userId = (localStorage.getItem(KEY_USER_ID) || "").trim();
  const apiKey = (localStorage.getItem(KEY_API_KEY) || "").trim();
  return { userId, apiKey, hasAuth: Boolean(userId && apiKey) };
}

export function saveGelbooruAuth(userId, apiKey) {
  const cleanUser = (userId || "").trim();
  const cleanKey = (apiKey || "").trim();
  if (cleanUser) {
    localStorage.setItem(KEY_USER_ID, cleanUser);
  } else {
    localStorage.removeItem(KEY_USER_ID);
  }
  if (cleanKey) {
    localStorage.setItem(KEY_API_KEY, cleanKey);
  } else {
    localStorage.removeItem(KEY_API_KEY);
  }
}

export function getGelbooruHeaders() {
  const { userId, apiKey } = getGelbooruAuth();
  const headers = {};
  if (userId) {
    headers["x-gelbooru-user-id"] = userId;
  }
  if (apiKey) {
    headers["x-gelbooru-api-key"] = apiKey;
  }
  return headers;
}
