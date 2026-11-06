// js/twitter.js
// Handles Twitter / Nitter instance management, feed fetching, RSS/HTML parsing, FxTwitter lazy resolution, and Following Feed generation.

import { state, PROXY_URL } from "./state.js";

export function cleanTwitterHandle(handle) {
  if (!handle || typeof handle !== "string") return "";
  let clean = handle.trim().replace(/^@+/, "");
  clean = clean.replace(/^\/+/, "").replace(/\/+$/, "");
  return clean;
}

export function isValidTwitterHandle(handle) {
  if (!handle || typeof handle !== "string") return false;
  const clean = cleanTwitterHandle(handle);
  return /^[a-zA-Z0-9_]{1,15}$/.test(clean);
}

export function formatTwitterHandle(handle) {
  const clean = cleanTwitterHandle(handle);
  return clean ? `@${clean}` : "";
}

// Cleans up any Nitter /pic/ URLs to direct original-quality pbs.twimg.com CDN URLs
export function cleanTwitterMediaUrl(src, host) {
  if (!src || typeof src !== "string") return "";
  let clean = src.trim();

  if (clean.includes("/pic/")) {
    const afterPic = clean.slice(clean.indexOf("/pic/") + 5);
    try {
      if (afterPic.startsWith("enc/")) {
        const b64 = afterPic.slice(4);
        const decoded = atob(b64);
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          clean = decoded;
        }
      } else {
        const decoded = decodeURIComponent(afterPic);
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          clean = decoded;
        } else {
          const sub = decoded.replace(/^orig\//i, "").replace(/^\/+/, "");
          clean = "https://pbs.twimg.com/" + sub;
        }
      }
    } catch (_) {
      clean = host ? `https://${host}${clean}` : clean;
    }
  } else if (clean.startsWith("/")) {
    clean = host ? `https://${host}${clean}` : clean;
  }

  // Request original resolution from Twitter CDN & strip invalid formats
  if (clean.includes("pbs.twimg.com/")) {
    try {
      clean = clean.replace("pbs.twimg.com/orig/", "pbs.twimg.com/");
      clean = clean.replace(/:(?:thumb|small|medium|large|orig)(\?|$)/i, "$1");
      const u = new URL(clean);
      const hasExt = /\.(jpe?g|png|gif)$/i.test(u.pathname);

      // Twitter CDN does not serve format=webp and returns 404. Always remove format if extension is present.
      if (hasExt) {
        u.searchParams.delete("format");
      } else if (u.searchParams.get("format") === "webp") {
        u.searchParams.set("format", "jpg");
      }

      if (clean.includes("pbs.twimg.com/media/")) {
        u.searchParams.set("name", "orig");
      } else {
        // profile_images and profile_banners return 404 if ?name=orig is appended
        u.searchParams.delete("name");
      }
      clean = u.toString();
    } catch (_) {}
  }

  return clean;
}

export const NITTER_INSTANCES = [
  { name: "teapaw.org", label: "(Default)", host: "teapaw.org", supportsHtml: true, supportsRss: true },
  { name: "teapawt.org", label: "(Mirror)", host: "teapawt.org", supportsHtml: true, supportsRss: true },
  { name: "teapawt.net", label: "(Mirror)", host: "teapawt.net", supportsHtml: true, supportsRss: true },
  { name: "xitter.gq", label: "(Backup)", host: "xitter.gq", supportsHtml: true, supportsRss: true },
  { name: "nitter.gq", label: "(Backup)", host: "nitter.gq", supportsHtml: true, supportsRss: true }
];

export async function pingInstance(host) {
  const start = performance.now();
  const ts = Date.now();
  const targetUrl = `https://${host}/?_cb=${ts}`;
  const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(targetUrl)}&_t=${ts}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    let res = null;
    try {
      res = await fetch(proxyUrl, {
        method: "HEAD",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
        signal: controller.signal
      });
      if (res.status === 405) {
        res = await fetch(proxyUrl, {
          method: "GET",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
          signal: controller.signal
        });
      }
    } catch (e) {
      if (controller.signal.aborted) throw e;
      res = await fetch(proxyUrl, {
        method: "GET",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
        signal: controller.signal
      });
    }
    clearTimeout(timeout);
    const ms = Math.round(performance.now() - start);
    const ok = res.status >= 200 && res.status < 400;
    return {
      host,
      status: res.status,
      ms,
      ok
    };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    return {
      host,
      status: 0,
      ms,
      ok: false,
      error: err.name === "AbortError" ? "Timeout" : "Offline"
    };
  }
}

export function getPreferredNitterHost() {
  try {
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem("paw_teapawt_v1") !== "true") {
        localStorage.removeItem("paw_nitter_instance");
        localStorage.setItem("paw_teapawt_v1", "true");
      }
      const saved = localStorage.getItem("paw_nitter_instance");
      if (saved && NITTER_INSTANCES.some((i) => i.host === saved)) {
        return saved;
      }
    }
  } catch (_) {}
  return "teapaw.org";
}

export function setPreferredNitterHost(host) {
  try {
    if (host && typeof localStorage !== "undefined") {
      localStorage.setItem("paw_nitter_instance", host);
    }
  } catch (_) {}
}

let teapawtPingMap = new Map();
let isPingingTeapawt = false;
let lastPingTime = 0;

export function getFastestHealthyHost() {
  let minMs = Infinity;
  let fastestHost = null;
  for (const [host, ping] of teapawtPingMap.entries()) {
    if (ping && ping.ok && typeof ping.ms === "number" && ping.ms > 0) {
      if (ping.ms < minMs) {
        minMs = ping.ms;
        fastestHost = host;
      }
    }
  }
  return fastestHost;
}

export function renderTeapawtInstancesUi() {
  const container = document.getElementById("teapawt-instances-list");
  if (!container) return;
  const preferred = getPreferredNitterHost();
  const fastestHost = getFastestHealthyHost();
  const frag = document.createDocumentFragment();

  NITTER_INSTANCES.forEach((inst) => {
    const isSelected = inst.host === preferred;
    const isFastest = inst.host === fastestHost;
    const card = document.createElement("div");
    card.className = `teapawt-instance-card ${isSelected ? "selected" : ""}`;
    card.dataset.host = inst.host;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", isSelected ? "true" : "false");

    const ping = teapawtPingMap.get(inst.host);
    let pillClass = "checking";
    let pillText = isPingingTeapawt ? "Checking..." : "Click Ping All";

    if (ping) {
      if (!ping.ok) {
        pillClass = "offline";
        pillText = ping.error || "Down";
      } else if (ping.ms >= 1500) {
        pillClass = "degraded";
        pillText = `${ping.ms} ms`;
      } else {
        pillClass = "online";
        pillText = `${ping.ms} ms`;
      }
    }

    if (isFastest && ping && ping.ok) {
      pillClass += " fastest";
      pillText = `✨ ${pillText}`;
    }

    card.innerHTML = `
      <div class="teapawt-instance-info">
        <div class="teapawt-instance-radio">
          <div class="teapawt-radio-circle"></div>
        </div>
        <div class="teapawt-instance-names">
          <span class="teapawt-instance-host">${inst.host}</span>
          <span class="teapawt-instance-label">${inst.label}</span>
        </div>
      </div>
      <div class="teapawt-instance-status">
        <span class="instance-ping-pill ${pillClass}" ${isFastest ? 'title="Lowest latency"' : ''}>
          <span class="ping-dot"></span>
          <span class="ping-text">${pillText}</span>
        </span>
      </div>
    `;

    card.addEventListener("click", () => {
      setPreferredNitterHost(inst.host);
      container.querySelectorAll(".teapawt-instance-card").forEach((c) => {
        const sel = c.dataset.host === inst.host;
        c.classList.toggle("selected", sel);
        c.setAttribute("aria-checked", sel ? "true" : "false");
      });
    });

    frag.appendChild(card);
  });

  container.innerHTML = "";
  container.appendChild(frag);
}

export async function pingAllTeapawtInstances(force = false) {
  if (isPingingTeapawt) return;
  if (!force && Date.now() - lastPingTime < 30000 && teapawtPingMap.size > 0) {
    renderTeapawtInstancesUi();
    return;
  }
  isPingingTeapawt = true;
  lastPingTime = Date.now();

  const btn = document.getElementById("btn-ping-instances");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("spinning");
  }

  const container = document.getElementById("teapawt-instances-list");
  if (container) {
    if (container.children.length === 0) {
      renderTeapawtInstancesUi();
    } else {
      container.querySelectorAll(".instance-ping-pill").forEach((pill) => {
        pill.className = "instance-ping-pill checking";
        const text = pill.querySelector(".ping-text");
        if (text) text.textContent = "Checking...";
      });
    }
  }

  try {
    await Promise.all(
      NITTER_INSTANCES.map(async (inst) => {
        const res = await pingInstance(inst.host);
        teapawtPingMap.set(inst.host, res);
      })
    );
    renderTeapawtInstancesUi();
  } finally {
    isPingingTeapawt = false;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  }
}

// Transform an RSS <item> DOM element into Paw Reader post format
export function transformTwitterRssItem(itemEl, host, itemIndex = 0) {
  if (!itemEl) return null;
  const guid = itemEl.querySelector("guid")?.textContent?.trim() || "";
  const link = itemEl.querySelector("link")?.textContent?.trim() || "";
  const title = itemEl.querySelector("title")?.textContent?.trim() || "";
  const pubDate = itemEl.querySelector("pubDate")?.textContent?.trim() || "";
  const creator = itemEl.getElementsByTagName("dc:creator")[0]?.textContent?.trim() || "";
  const desc = itemEl.querySelector("description")?.textContent || "";

  let id = "";
  const mId = (guid + " " + link).match(/status\/(\d+)/);
  if (mId) {
    id = mId[1];
  } else if (guid && !isNaN(Number(guid))) {
    id = guid;
  }
  if (!id) return null;

  let user = cleanTwitterHandle(creator);
  if (!user && link) {
    const m = link.match(/https?:\/\/[^\/]+\/([^\/]+)\/status/);
    if (m) user = cleanTwitterHandle(m[1]);
  }
  if (!user || !isValidTwitterHandle(user)) return null;

  const isRetweet = title.startsWith("RT ") || title.includes("RT by @") || desc.includes("RT by @");
  let retweetedBy = "";
  let retweetedUser = "";
  if (isRetweet) {
    const m = title.match(/RT by @([a-zA-Z0-9_]+)/i) || desc.match(/RT by @([a-zA-Z0-9_]+)/i);
    if (m) {
      retweetedUser = m[1];
      retweetedBy = `@${m[1]} retweeted`;
    } else {
      retweetedBy = "Retweeted";
    }
  }

  const isReplyMatch = title.match(/^R to @([a-zA-Z0-9_]{1,15}):/i);
  const isReply = Boolean(isReplyMatch);
  const isSelfReply = isReplyMatch ? (isReplyMatch[1].toLowerCase() === user.toLowerCase()) : false;

  const isVideo = desc.includes("<br>Video<br>") || desc.includes(">Video<") || desc.includes("/amplify_video_thumb/") || desc.includes("/ext_tw_video_thumb/");
  
  const imgMatches = Array.from(desc.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map((m) => m[1]);
  const images = Array.from(new Set(imgMatches.map((src) => cleanTwitterMediaUrl(src, host)).filter(Boolean)));

  const cleanDescText = desc.replace(/<[^>]*>/g, "").trim();
  if (!isVideo && images.length === 0 && !cleanDescText) {
    return null;
  }

  const attachments = [];
  let file = null;

  if (isVideo) {
    const poster = images[0] || "";
    file = {
      path: `twitter_video_${id}.mp4`,
      name: `twitter_video_${id}.mp4`,
      isVideo: true,
      poster: poster,
      needsFxFetch: true,
      tweetId: id,
      user: user
    };
    for (let i = 1; i < images.length; i++) {
      const ext = images[i].split("?")[0].split(".").pop() || "jpg";
      attachments.push({
        path: images[i],
        name: `image_${i}.${ext}`
      });
    }
  } else if (images.length > 0) {
    const ext = images[0].split("?")[0].split(".").pop() || "jpg";
    file = {
      path: images[0],
      name: `image_0.${ext}`
    };
    for (let i = 1; i < images.length; i++) {
      const aExt = images[i].split("?")[0].split(".").pop() || "jpg";
      attachments.push({
        path: images[i],
        name: `image_${i}.${aExt}`
      });
    }
  }

  let publishedIso = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
  let effectivePublished = publishedIso;
  if (isRetweet) {
    effectivePublished = new Date(Date.now() - (itemIndex * 30000)).toISOString();
  }

  return {
    id: id || String(Date.now()),
    user: user,
    authorName: formatTwitterHandle(user),
    title: title,
    content: desc,
    published: effectivePublished,
    originalPublished: publishedIso,
    service: "twitter",
    file: file,
    attachments: attachments,
    isVideo: isVideo,
    tweetId: id,
    link: link,
    nitterHost: host,
    likes: 0,
    retweets: 0,
    replies: 0,
    views: 0,
    isRetweet: isRetweet,
    retweetedBy: retweetedBy,
    retweetedUser: retweetedUser,
    isQuote: false,
    quote: null,
    isReply: isReply,
    isSelfReply: isSelfReply
  };
}

// Transform an HTML .timeline-item DOM element into Paw Reader post format
export function transformTwitterHtmlItem(el, host, itemIndex = 0) {
  if (
    !el ||
    el.classList.contains("more-wrapper") ||
    el.classList.contains("more-replies-thread") ||
    el.classList.contains("thread-line") ||
    el.classList.contains("show-more") ||
    el.querySelector(".more-replies") ||
    el.querySelector(".show-more") ||
    el.querySelector(".unavailable-box")
  ) {
    return null;
  }

  const linkEl = el.querySelector(".tweet-link");
  const link = linkEl ? linkEl.getAttribute("href") : "";
  const idMatch = link ? link.match(/status\/(\d+)/) : null;
  const id = idMatch ? idMatch[1] : "";
  if (!id) return null;

  const retweetHeaderEl = el.querySelector(".retweet-header");
  const isRetweet = Boolean(retweetHeaderEl);
  let retweetedBy = "";
  let retweetedUser = "";
  if (isRetweet) {
    retweetedBy = retweetHeaderEl.textContent?.trim() || "Retweeted";
    const mRtClass = el.className ? el.className.match(/\breweet-([a-zA-Z0-9_]{1,15})\b|\bretweet-([a-zA-Z0-9_]{1,15})\b/) : null;
    if (mRtClass) {
      retweetedUser = mRtClass[1] || mRtClass[2];
    } else {
      const matchWord = retweetedBy.match(/^([a-zA-Z0-9_]{1,15})\s+retweeted/i);
      if (matchWord) {
        retweetedUser = matchWord[1];
      }
    }
  }

  const fullname = el.querySelector(".fullname")?.textContent?.trim() || "";
  let username = cleanTwitterHandle(el.querySelector(".username")?.textContent || "");
  if (!username) {
    const du = el.getAttribute("data-username");
    if (du) username = cleanTwitterHandle(du);
  }
  if (!username) {
    const avatarLink = el.querySelector("a.tweet-avatar, a.fullname");
    if (avatarLink) {
      const href = avatarLink.getAttribute("href") || "";
      const m = href.match(/^\/([a-zA-Z0-9_]{1,15})$/);
      if (m) username = m[1];
    }
  }
  if (!username || !isValidTwitterHandle(username)) return null;

  const isSelfRetweet = Boolean(isRetweet && retweetedUser && cleanTwitterHandle(retweetedUser) === cleanTwitterHandle(username));

  // Extract Replying To / Thread information
  const replyingToEl = el.querySelector(".replying-to");
  let isReply = Boolean(replyingToEl);
  let isSelfReply = false;
  let replyingToUsers = [];

  if (replyingToEl) {
    const rawReplyingText = replyingToEl.textContent || "";
    const matches = Array.from(rawReplyingText.matchAll(/@([a-zA-Z0-9_]{1,15})/g));
    replyingToUsers = matches.map((m) => cleanTwitterHandle(m[1])).filter(Boolean);
    if (replyingToUsers.length === 0) {
      const links = Array.from(replyingToEl.querySelectorAll("a"));
      replyingToUsers = links
        .map((a) => cleanTwitterHandle(a.textContent || a.getAttribute("href") || ""))
        .filter(Boolean);
    }
    const cleanAuthor = cleanTwitterHandle(username).toLowerCase();
    // If every replied-to user is the author themselves, it's a self-thread continuation
    if (replyingToUsers.length > 0 && replyingToUsers.every((u) => u.toLowerCase() === cleanAuthor)) {
      isSelfReply = true;
    }
  } else if (el.classList.contains("thread-line") || el.querySelector(".thread-line")) {
    isReply = true;
  }

  const text = el.querySelector(".tweet-content")?.innerHTML || "";
  const textRaw = el.querySelector(".tweet-content")?.textContent?.trim() || "";
  const dateStr = el.querySelector(".tweet-date a")?.getAttribute("title") || "";
  
  // Extract Quoted Tweet block if present
  const quoteEl = el.querySelector(".quote");
  let quote = null;
  if (quoteEl) {
    if (quoteEl.classList.contains("unavailable") || quoteEl.querySelector(".unavailable-quote")) {
      const qLink = quoteEl.querySelector("a[href*='/status/']")?.getAttribute("href") || "";
      const mId = qLink.match(/status\/(\d+)/);
      quote = {
        isUnavailable: true,
        id: mId ? mId[1] : "",
        link: qLink ? (qLink.startsWith("/") ? `https://${host}${qLink}` : qLink) : "",
        text: ""
      };
    } else {
      const qLink = quoteEl.querySelector("a.quote-link")?.getAttribute("href") || "";
      const qFullname = quoteEl.querySelector(".fullname")?.textContent?.trim() || "";
      let qUsername = cleanTwitterHandle(quoteEl.querySelector(".username")?.textContent || "");
      if (!qUsername && qLink) {
        const mq = qLink.match(/^\/([a-zA-Z0-9_]{1,15})\/status/);
        if (mq) qUsername = mq[1];
      }
      const qAvatar = cleanTwitterMediaUrl(quoteEl.querySelector(".avatar")?.getAttribute("src") || "", host);
      const qText = quoteEl.querySelector(".quote-text")?.innerHTML || quoteEl.querySelector(".quote-text")?.textContent?.trim() || "";
      const qDate = quoteEl.querySelector(".tweet-date a")?.getAttribute("title") || quoteEl.querySelector(".tweet-date a")?.textContent?.trim() || "";

      const qImgEls = Array.from(quoteEl.querySelectorAll(".attachment.image img, .attachment img, .gallery-row img, a.still-image img")).map((img) => {
        const parentLink = img.closest("a.still-image");
        const href = parentLink ? parentLink.getAttribute("href") : null;
        return href || img.getAttribute("src") || "";
      });
      const qImages = Array.from(new Set(qImgEls.map((src) => cleanTwitterMediaUrl(src, host)).filter(Boolean)));
      const qVideoEl = quoteEl.querySelector(".attachment video, .gallery-video video");
      const qIsVideo = Boolean(qVideoEl);
      const qVideoSrc = qVideoEl?.querySelector("source")?.getAttribute("src") || qVideoEl?.getAttribute("src") || "";
      const qPoster = cleanTwitterMediaUrl(qVideoEl?.getAttribute("poster") || (qImages.length > 0 ? qImages[0] : ""), host);

      quote = {
        link: qLink ? (qLink.startsWith("/") ? `https://${host}${qLink}` : qLink) : "",
        id: (qLink.match(/status\/(\d+)/) || [])[1] || "",
        authorName: qFullname || formatTwitterHandle(qUsername),
        user: qUsername,
        avatar: qAvatar,
        text: qText,
        date: qDate,
        images: qImages,
        isVideo: qIsVideo,
        videoSrc: qVideoSrc,
        poster: qPoster,
        mediaUrl: qImages[0] || qPoster || ""
      };
    }
  }

  // Extract Stats (Replies, Retweets, Likes, Views) accurately from .tweet-stats container
  const statsContainer = el.querySelector(".tweet-stats");
  const parseStatFromContainer = (selector, fallbackRegex) => {
    if (statsContainer) {
      const icon = statsContainer.querySelector(selector);
      if (icon) {
        const statEl = icon.closest(".tweet-stat") || icon.closest(".icon-container") || icon.parentElement;
        const txt = statEl?.textContent?.replace(/,/g, "")?.trim() || "";
        const m = txt.match(/\d+/);
        if (m) return parseInt(m[0], 10);
      }
    }
    try {
      const html = el.innerHTML || "";
      const m = html.match(fallbackRegex);
      if (m && m[1]) return parseInt(m[1].replace(/,/g, ""), 10);
    } catch (_) {}
    return 0;
  };

  const replies = parseStatFromContainer(".icon-comment", /icon-comment[^>]*><\/span>\s*([0-9,]+)/i);
  const retweets = parseStatFromContainer(".icon-retweet", /icon-retweet[^>]*><\/span>\s*([0-9,]+)/i);
  const likes = parseStatFromContainer(".icon-heart", /icon-heart[^>]*><\/span>\s*([0-9,]+)/i);
  const views = parseStatFromContainer(".icon-views", /icon-views[^>]*><\/span>\s*([0-9,]+)/i);

  const rawImages = Array.from(el.querySelectorAll(".attachment.image img, .attachment img, .gallery-row img, a.still-image img"))
    .filter((img) => !img.closest(".quote"))
    .map((img) => {
      const parentLink = img.closest("a.still-image");
      const href = parentLink ? parentLink.getAttribute("href") : null;
      return href || img.getAttribute("src") || "";
    });
  let images = Array.from(new Set(rawImages.map((src) => cleanTwitterMediaUrl(src, host)).filter(Boolean)));

  const videoEl = Array.from(el.querySelectorAll(".attachment video, .gallery-video video")).find((v) => !v.closest(".quote")) || null;
  let isVideo = Boolean(videoEl || Array.from(el.querySelectorAll(".gallery-video, .video-overlay")).some((v) => !v.closest(".quote")));
  let directVideoSrc = videoEl?.querySelector("source")?.getAttribute("src") || videoEl?.getAttribute("src") || "";
  const rawPoster = videoEl ? (videoEl.getAttribute("poster") || "") : "";
  let poster = cleanTwitterMediaUrl(rawPoster, host);

  // If the tweet itself doesn't have media, but it quotes a tweet with media:
  // Adopt the quote's media so this post appears as a media post (just like a repost!)
  let quoteMediaAdopted = false;
  if (!isVideo && images.length === 0 && quote) {
    if (quote.isVideo) {
      isVideo = true;
      directVideoSrc = quote.videoSrc || "";
      poster = quote.poster || "";
      images = quote.images || [];
      quoteMediaAdopted = true;
    } else if (quote.images && quote.images.length > 0) {
      images = quote.images;
      quoteMediaAdopted = true;
    }
  }

  // A genuine tweet MUST have either media OR non-empty text content OR a quote
  if (!isVideo && images.length === 0 && !textRaw && !quote) {
    return null;
  }
  if (!poster && isVideo && images.length > 0) {
    poster = images[0];
  }

  let file = null;
  const attachments = [];

  if (isVideo) {
    let videoUrl = "";
    let needsFxFetch = true;
    if (directVideoSrc && (directVideoSrc.startsWith("http://") || directVideoSrc.startsWith("https://"))) {
      videoUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(directVideoSrc)}`;
      needsFxFetch = false;
    }

    file = {
      path: directVideoSrc || `twitter_video_${id}.mp4`,
      name: `twitter_video_${id}.mp4`,
      isVideo: true,
      poster: poster,
      needsFxFetch: needsFxFetch,
      tweetId: id,
      user: username,
      directUrl: directVideoSrc || "",
      url: videoUrl
    };
    for (let i = 0; i < images.length; i++) {
      attachments.push({
        path: images[i],
        name: `image_${i}.jpg`
      });
    }
  } else if (images.length > 0) {
    file = {
      path: images[0],
      name: `image_0.jpg`
    };
    for (let i = 1; i < images.length; i++) {
      attachments.push({
        path: images[i],
        name: `image_${i}.jpg`
      });
    }
  }

  let publishedIso = new Date().toISOString();
  if (dateStr) {
    try {
      const cleanDate = dateStr.replace(/[·•]/g, " ").replace(/\s+/g, " ").trim();
      const parsedDate = new Date(cleanDate);
      if (!isNaN(parsedDate.getTime())) {
        publishedIso = parsedDate.toISOString();
      }
    } catch (_) {}
  }

  // For following feed timeline sorting, published is initially the post's publishedIso date.
  // When fetchTwitterFeed processes the timeline, it interpolates retweet timeline dates accurately.
  let effectivePublished = publishedIso;

  const authorDisplay = fullname || formatTwitterHandle(username);

  return {
    id: id || String(Date.now()),
    user: username,
    authorName: authorDisplay,
    title: el.querySelector(".tweet-content")?.textContent?.slice(0, 90) || (id ? `Post #${id}` : "Tweet"),
    content: text,
    published: effectivePublished,
    originalPublished: publishedIso,
    service: "twitter",
    file: file,
    attachments: attachments,
    isVideo: isVideo,
    tweetId: id,
    link: link ? (link.startsWith("/") ? `https://${host}${link}` : link) : "",
    nitterHost: host,
    replies: replies,
    retweets: retweets,
    likes: likes,
    views: views,
    stats: {
      replies: replies,
      retweets: retweets,
      likes: likes,
      views: views
    },
    isReply: isReply,
    isSelfReply: isSelfReply,
    replyingTo: replyingToUsers,
    isRetweet: isSelfRetweet ? false : isRetweet,
    isSelfRetweet: isSelfRetweet,
    retweetedBy: retweetedBy,
    retweetedUser: retweetedUser,
    isQuote: Boolean(quote),
    _quoteMediaAdopted: quoteMediaAdopted,
    quote: quote
  };
}

// Fetch user timeline with automatic instance failover
export async function fetchTwitterFeed(username, cursor = null, signal = null, feedType = "tweets") {
  const cleanUser = cleanTwitterHandle(username || "elonmusk");
  if (!cleanUser || !isValidTwitterHandle(cleanUser)) {
    throw new Error(`Invalid Twitter handle: "${username}"`);
  }
  const preferred = getPreferredNitterHost();
  
  // Order instances so preferred is attempted first
  const orderedInstances = [
    ...NITTER_INSTANCES.filter((i) => i.host === preferred),
    ...NITTER_INSTANCES.filter((i) => i.host !== preferred)
  ];

  let lastError = null;

  for (const inst of orderedInstances) {
    try {
      // Determine path based on feedType: "tweets" (main), "with_replies", "media", "articles"
      let htmlSub = "";
      if (feedType === "media") htmlSub = "/media";
      else if (feedType === "with_replies") htmlSub = "/with_replies";
      else if (feedType === "articles") htmlSub = "/articles";
      else htmlSub = "";

      // Prefer HTML mode if instance supports it, otherwise RSS
      if (inst.supportsHtml) {
        const url = `https://${inst.host}/${cleanUser}${htmlSub}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
        const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl, { signal });
        if (!res.ok) continue;

        const html = await res.text();
        const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1].toLowerCase() : "";
        const isChallenge =
          pageTitle.includes("not a bot") ||
          pageTitle.includes("just a moment") ||
          pageTitle.includes("robot or human") ||
          pageTitle.includes("security check") ||
          html.includes("Prove You're Human") ||
          html.includes("Gandalf - You shall not pass") ||
          html.includes("challenge-running") ||
          html.includes("cf-challenge");
        if (isChallenge) {
          continue;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Parse user profile stats if on first page
        let profile = null;
        if (!cursor) {
          const mFollowers = html.match(/<li class="followers"[^>]*>[\s\S]*?<span class="profile-stat-num">([0-9,]+)<\/span>/i);
          const mFollowing = html.match(/<li class="following"[^>]*>[\s\S]*?<span class="profile-stat-num">([0-9,]+)<\/span>/i);
          const mTweets = html.match(/<li class="posts"[^>]*>[\s\S]*?<span class="profile-stat-num">([0-9,]+)<\/span>/i);
          profile = {
            followers: mFollowers ? parseInt(mFollowers[1].replace(/,/g, ""), 10) : 0,
            following: mFollowing ? parseInt(mFollowing[1].replace(/,/g, ""), 10) : 0,
            tweets: mTweets ? parseInt(mTweets[1].replace(/,/g, ""), 10) : 0
          };
        }

        const items = doc.querySelectorAll(".timeline-item");
        const posts = [];
        items.forEach((itemEl, idx) => {
          try {
            const p = transformTwitterHtmlItem(itemEl, inst.host, idx);
            if (p && p.id) posts.push(p);
          } catch (err) {
            console.warn("Skipping Twitter item:", err);
          }
        });

        // Hydrate quote tweets that don't have media yet so they appear as full media posts
        if (posts.length > 0) {
          await hydrateQuotePostsMedia(posts, inst.host);
        }

        // Two-pass timeline date interpolation for retweets:
        // Teapawt timelines are rendered in reverse-chronological order of appearance.
        // For retweets, originalPublished is the date of the original tweet (which could be years old).
        // Interpolate effective published dates so retweets retain their authentic position
        // in the stream without jumping to Date.now() or hiding newer original posts.
        for (let i = 0; i < posts.length; i++) {
          if (posts[i].isRetweet) {
            let prevDateMs = i > 0 ? new Date(posts[i - 1].published).getTime() : Date.now();
            if (isNaN(prevDateMs)) prevDateMs = Date.now();

            let nextDateMs = null;
            for (let j = i + 1; j < posts.length; j++) {
              if (!posts[j].isRetweet) {
                const cand = new Date(posts[j].published).getTime();
                if (!isNaN(cand)) {
                  nextDateMs = cand;
                  break;
                }
              }
            }

            if (nextDateMs !== null && prevDateMs > nextDateMs) {
              const interpolated = Math.max(nextDateMs + 1000, Math.min(prevDateMs - 1000, Math.floor((prevDateMs + nextDateMs) / 2)));
              posts[i].published = new Date(interpolated).toISOString();
            } else {
              posts[i].published = new Date(prevDateMs - 1000).toISOString();
            }
          }
        }

        // If HTML returned posts, return them
        if (posts.length > 0) {
          let nextCursor = null;
          const showMore = doc.querySelector(".show-more a");
          if (showMore) {
            const href = showMore.getAttribute("href") || "";
            const m = href.match(/[?&]cursor=([^&]+)/);
            if (m) nextCursor = decodeURIComponent(m[1]);
          }

          const hasMedia = posts.some((p) => p.isVideo || (p.attachments && p.attachments.length > 0) || (p.file && !p.file.isVideo)) || !!doc.querySelector(".tab-item a[href*='media']");
          const detectedTabs = ["tweets", "with_replies"];
          if (hasMedia) detectedTabs.push("media");

          return {
            posts,
            nextCursor,
            hostUsed: inst.host,
            profile,
            detectedTabs
          };
        }

        // If HTML returned 0 posts but instance supports RSS, try RSS on this instance immediately
        if (inst.supportsRss) {
          const rssSub = (feedType === "media") ? "/media/rss" : "/rss";
          const rssUrl = `https://${inst.host}/${cleanUser}${rssSub}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
          try {
            const rRes = await fetch(`${PROXY_URL}/proxy?url=${encodeURIComponent(rssUrl)}`, { signal });
            if (rRes.ok) {
              const rText = await rRes.text();
              if (rText.includes("<rss") || rText.includes("<channel")) {
                const xmlDoc = parser.parseFromString(rText, "text/xml");
                const itemEls = xmlDoc.querySelectorAll("item");
                const rssPosts = [];
                itemEls.forEach((el, idx) => {
                  const p = transformTwitterRssItem(el, inst.host, idx);
                  if (p && p.id) rssPosts.push(p);
                });
                if (rssPosts.length > 0) {
                  await hydrateQuotePostsMedia(rssPosts, inst.host);
                  return {
                    posts: rssPosts,
                    nextCursor: rRes.headers.get("min-id") || null,
                    hostUsed: inst.host,
                    profile,
                    detectedTabs: ["tweets", "with_replies", "media"]
                  };
                }
              }
            }
          } catch (_) {}
        }

        // If profile was parsed or profile-card is present, user is valid but this tab has no items
        if (doc.querySelector(".profile-card")) {
          const detectedTabs = ["tweets", "with_replies"];
          if (doc.querySelector(".tab-item a[href*='media']")) detectedTabs.push("media");
          return {
            posts: [],
            nextCursor: null,
            hostUsed: inst.host,
            profile,
            detectedTabs
          };
        }
      }

      if (inst.supportsRss) {
        const rssSub = (feedType === "media") ? "/media/rss" : "/rss";
        const url = `https://${inst.host}/${cleanUser}${rssSub}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
        const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl, { signal });
        if (!res.ok) continue;

        const xmlText = await res.text();
        if (!xmlText.includes("<rss") && !xmlText.includes("<channel")) {
          continue;
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        const itemEls = xmlDoc.querySelectorAll("item");
        const posts = [];
        itemEls.forEach((el, idx) => {
          const p = transformTwitterRssItem(el, inst.host, idx);
          if (p && p.id) posts.push(p);
        });

        if (posts.length > 0) {
          await hydrateQuotePostsMedia(posts, inst.host);
          const nextCursor = res.headers.get("min-id") || null;
          return {
            posts,
            nextCursor,
            hostUsed: inst.host,
            profile: null,
            detectedTabs: ["tweets", "with_replies", "media"]
          };
        }
      }
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastError = e;
    }
  }

  throw new Error(`Failed to fetch Twitter feed for ${formatTwitterHandle(cleanUser)}: ${lastError ? lastError.message : "All Teapawt instances busy"}`);
}



// Fetch tweet stats (comments, retweets, likes, views) via FixTweet API
export async function fetchTwitterPostStats(author, tweetId) {
  if (!tweetId) return null;
  const cleanUser = cleanTwitterHandle(author) || "i";
  try {
    const fxUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(`https://api.fxtwitter.com/${cleanUser}/status/${tweetId}`)}`;
    const res = await fetch(fxUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const stats = {
      replies: data?.tweet?.replies ?? 0,
      retweets: data?.tweet?.retweets ?? 0,
      likes: data?.tweet?.likes ?? 0,
      views: data?.tweet?.views ?? 0
    };
    return stats;
  } catch (_) {}
  return null;
}

// Lazy-resolve 1080p video URL and formats via FixTweet
export async function resolveTwitterVideo(author, tweetId) {
  if (!tweetId) return null;
  const cleanUser = cleanTwitterHandle(author) || "i";
  try {
    const fxUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(`https://api.fxtwitter.com/${cleanUser}/status/${tweetId}`)}`;
    const res = await fetch(fxUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const vid = data?.tweet?.media?.videos?.[0] || data?.tweet?.quote?.media?.videos?.[0];
    const stats = {
      replies: data?.tweet?.replies || 0,
      retweets: data?.tweet?.retweets || 0,
      likes: data?.tweet?.likes || 0,
      views: data?.tweet?.views || 0
    };
    if (vid && vid.url) {
      const proxyVideoUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(vid.url)}`;
      return {
        url: proxyVideoUrl, // Proxied through worker for Range byte scrubbing and CORS
        directUrl: vid.url,
        proxyUrl: proxyVideoUrl,
        thumbnail: cleanTwitterMediaUrl(vid.thumbnail_url || ""),
        duration: vid.duration || 0,
        formats: vid.formats || [],
        stats: stats
      };
    }
  } catch (err) {
    console.warn("Failed to resolve Twitter video via FixTweet:", err);
  }
  return null;
}

// Cache for resolved quoted tweets
const twitterQuoteCache = new Map();

// Lazy-resolve quote tweet contents via FixTweet API with Teapawt status fallback
export async function resolveTwitterQuote(quoteId, host = null) {
  if (!quoteId) return null;
  if (twitterQuoteCache.has(quoteId)) {
    return twitterQuoteCache.get(quoteId);
  }
  const cleanHost = host || getPreferredNitterHost();

  // 1. Try FixTweet API first (fast and structured)
  try {
    const fxUrl = `https://api.fxtwitter.com/i/status/${quoteId}`;
    const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(fxUrl)}`;
    let res = null;
    try {
      res = await fetch(proxyUrl, { signal: AbortSignal.timeout(3500) });
    } catch (_) {}
    if (!res || !res.ok) {
      try {
        res = await fetch(fxUrl, { signal: AbortSignal.timeout(3500) });
      } catch (_) {}
    }
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.code === 200 && data.tweet) {
        const t = data.tweet;
        let mediaUrl = "";
        let isVideo = false;
        let videoSrc = "";
        let poster = "";
        const images = [];

        if (t.media) {
          if (Array.isArray(t.media.videos) && t.media.videos.length > 0) {
            isVideo = true;
            videoSrc = t.media.videos[0].url || "";
            poster = cleanTwitterMediaUrl(t.media.videos[0].thumbnail_url || "", cleanHost);
            mediaUrl = poster;
          }
          if (Array.isArray(t.media.photos) && t.media.photos.length > 0) {
            t.media.photos.forEach((p) => {
              const u = cleanTwitterMediaUrl(p.url || "", cleanHost);
              if (u && !images.includes(u)) images.push(u);
            });
            if (!mediaUrl && images.length > 0) mediaUrl = images[0];
          }
          if (Array.isArray(t.media.all) && !isVideo && images.length === 0) {
            t.media.all.forEach((item) => {
              if (item.type === "video" || item.type === "gif") {
                isVideo = true;
                if (!videoSrc) videoSrc = item.url || "";
                if (!poster) poster = cleanTwitterMediaUrl(item.thumbnail_url || "", cleanHost);
              } else if (item.type === "photo") {
                const u = cleanTwitterMediaUrl(item.url || "", cleanHost);
                if (u && !images.includes(u)) images.push(u);
              }
            });
            if (!mediaUrl) mediaUrl = poster || images[0] || "";
          }
        }
        const resolved = {
          id: quoteId,
          link: `https://${cleanHost}/${t.author?.screen_name || "i"}/status/${quoteId}`,
          authorName: t.author?.name || t.author?.screen_name || "Twitter User",
          user: t.author?.screen_name || "",
          avatar: cleanTwitterMediaUrl(t.author?.avatar_url || "", cleanHost),
          text: t.text || "",
          date: t.created_at || "",
          mediaUrl: mediaUrl,
          images: images,
          isVideo: isVideo,
          videoSrc: videoSrc,
          poster: poster,
          isUnavailable: false
        };
        twitterQuoteCache.set(quoteId, resolved);
        return resolved;
      }
    }
  } catch (_) {}

  // 2. Fallback to direct Teapawt status page HTML parsing
  try {
    const teapawUrl = `https://${cleanHost}/i/status/${quoteId}`;
    const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(teapawUrl)}`;
    let res = null;
    try {
      res = await fetch(proxyUrl, { signal: AbortSignal.timeout(3500) });
    } catch (_) {}
    if (!res || !res.ok) {
      try {
        res = await fetch(teapawUrl, { signal: AbortSignal.timeout(3500) });
      } catch (_) {}
    }
    if (res && res.ok) {
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const mainTweet = doc.querySelector(".main-tweet, .timeline-item");
      if (mainTweet) {
        const fullname = mainTweet.querySelector(".fullname")?.textContent?.trim() || "";
        let username = cleanTwitterHandle(mainTweet.querySelector(".username")?.textContent || "");
        if (!username) {
          const lk = mainTweet.querySelector("a.tweet-link, a.fullname")?.getAttribute("href") || "";
          const m = lk.match(/^\/([a-zA-Z0-9_]{1,15})/);
          if (m) username = m[1];
        }
        const avatar = cleanTwitterMediaUrl(mainTweet.querySelector(".avatar, .tweet-avatar img")?.getAttribute("src") || "", cleanHost);
        const text = mainTweet.querySelector(".tweet-content")?.innerHTML || mainTweet.querySelector(".tweet-content")?.textContent?.trim() || "";
        const date = mainTweet.querySelector(".tweet-date a")?.getAttribute("title") || mainTweet.querySelector(".tweet-date a")?.textContent?.trim() || "";
        
        const qImgEls = Array.from(mainTweet.querySelectorAll(".attachment.image img, .attachment img, .gallery-row img, a.still-image img")).map((img) => {
          const parentLink = img.closest("a.still-image");
          const href = parentLink ? parentLink.getAttribute("href") : null;
          return href || img.getAttribute("src") || "";
        });
        const images = Array.from(new Set(qImgEls.map((src) => cleanTwitterMediaUrl(src, cleanHost)).filter(Boolean)));
        const qVideoEl = mainTweet.querySelector(".attachment video, .gallery-video video");
        const isVideo = Boolean(qVideoEl);
        const videoSrc = qVideoEl?.querySelector("source")?.getAttribute("src") || qVideoEl?.getAttribute("src") || "";
        const poster = cleanTwitterMediaUrl(qVideoEl?.getAttribute("poster") || (images.length > 0 ? images[0] : ""), cleanHost);
        const mediaUrl = poster || images[0] || "";

        const resolved = {
          id: quoteId,
          link: `https://${cleanHost}/${username || "i"}/status/${quoteId}`,
          authorName: fullname || formatTwitterHandle(username),
          user: username,
          avatar: avatar,
          text: text,
          date: date,
          mediaUrl: mediaUrl,
          images: images,
          isVideo: isVideo,
          videoSrc: videoSrc,
          poster: poster,
          isUnavailable: false
        };
        twitterQuoteCache.set(quoteId, resolved);
        return resolved;
      }
    }
  } catch (_) {}

  return null;
}

// Hydrate quote tweets that don't have media yet so they appear as full media posts (batched in chunks of 4)
export async function hydrateQuotePostsMedia(posts, host = null) {
  if (!Array.isArray(posts) || posts.length === 0) return;
  const targetPosts = posts.filter(
    (p) => p.quote && p.quote.id && !p.file && (!p.attachments || p.attachments.length === 0)
  );
  if (targetPosts.length === 0) return;

  const resolveOne = async (p) => {
    try {
      const resolved = await resolveTwitterQuote(p.quote.id, host);
      if (resolved) {
        p.quote = resolved;
        p.isQuote = true;
        if (resolved.isVideo) {
          p.isVideo = true;
          p.file = {
            path: resolved.videoSrc || `twitter_video_${resolved.id}.mp4`,
            name: `twitter_video_${resolved.id}.mp4`,
            isVideo: true,
            poster: resolved.poster,
            needsFxFetch: !resolved.videoSrc,
            tweetId: resolved.id,
            user: resolved.user,
            directUrl: resolved.videoSrc || "",
            url: resolved.videoSrc ? `${PROXY_URL}/proxy?url=${encodeURIComponent(resolved.videoSrc)}` : ""
          };
          p.attachments = [];
          if (resolved.images && resolved.images.length > 0) {
            resolved.images.forEach((img, i) => {
              p.attachments.push({ path: img, name: `quote_image_${i}.jpg` });
            });
          }
          p._quoteMediaAdopted = true;
        } else if (resolved.images && resolved.images.length > 0) {
          p.file = { path: resolved.images[0], name: `quote_image_0.jpg` };
          p.attachments = [];
          for (let i = 1; i < resolved.images.length; i++) {
            p.attachments.push({ path: resolved.images[i], name: `quote_image_${i}.jpg` });
          }
          p._quoteMediaAdopted = true;
        }
      }
    } catch (_) {}
  };

  for (let i = 0; i < targetPosts.length; i += 4) {
    const chunk = targetPosts.slice(i, i + 4);
    await Promise.allSettled(chunk.map(resolveOne));
  }
}

// Scrape following accounts list with verified Nitter instance, rate-limit cooldown auto-recovery, and deep pagination
export async function fetchTwitterFollowing(username, maxPages = 150, signal = null, onProgress = null) {
  const cleanUser = cleanTwitterHandle(username);
  if (!cleanUser) return [];

  // Scraper hosts supporting /following pagination with automatic multi-host fallback
  const SCRAPER_HOSTS = ["nitter.mie.foundation", "nitter.privacydev.net", "nitter.net"];
  let hostIndex = 0;
  let host = SCRAPER_HOSTS[hostIndex];

  const allAccounts = [];
  const seenHandles = new Set();
  let currentCursor = null;
  let page = 0;
  let consecutiveErrors = 0;

  while (page < maxPages) {
    if (signal && signal.aborted) throw new Error("Import aborted");

    const url = `https://${host}/${cleanUser}/following${currentCursor ? `?cursor=${encodeURIComponent(currentCursor)}` : ""}`;
    const proxyUrl = `${PROXY_URL}/proxy?url=${encodeURIComponent(url)}`;

    let pageHtml = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      if (signal && signal.aborted) throw new Error("Import aborted");
      try {
        const res = await fetch(proxyUrl, { signal });
        if (res.ok) {
          const text = await res.text();
          if (text.includes("not a bot") || text.includes("Making sure you're not a bot") || text.includes("cf-challenge") || text.includes("Just a moment")) {
            if (typeof onProgress === "function") {
              onProgress(allAccounts.length, `Bot challenge cooldown (15s)... (${allAccounts.length})`);
            }
            await new Promise((r) => setTimeout(r, 15000));
            continue;
          }
          if (text.includes("Rate limit exceeded") || text.includes("rate-limited") || text.includes("error-panel")) {
            if (typeof onProgress === "function") {
              onProgress(allAccounts.length, `Rate limit pause (resuming in 16s)... (${allAccounts.length})`);
            }
            await new Promise((r) => setTimeout(r, 16000));
            continue;
          }
          if (text.includes("timeline-item") || text.includes("profile-result")) {
            pageHtml = text;
            break;
          }
          // Response was 200 OK but page didn't have timeline items: wait before retrying
          await new Promise((r) => setTimeout(r, 3000));
        } else if (res.status === 429) {
          // Rate limit reached: pause 16s for the rolling window to reset and auto-resume
          if (typeof onProgress === "function") {
            onProgress(allAccounts.length, `Rate limit pause (resuming in 16s)... (${allAccounts.length})`);
          }
          await new Promise((r) => setTimeout(r, 16000));
          continue;
        } else if (res.status === 403 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
          continue;
        } else {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        if (signal && signal.aborted) throw err;
        await new Promise((r) => setTimeout(r, 2500));
      }
    }

    if (!pageHtml) {
      consecutiveErrors++;
      hostIndex = (hostIndex + 1) % SCRAPER_HOSTS.length;
      host = SCRAPER_HOSTS[hostIndex];
      if (consecutiveErrors < 4) {
        if (typeof onProgress === "function") {
          onProgress(allAccounts.length, `Retrying with ${host} in 8s... (${allAccounts.length})`);
        }
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      break;
    }
    consecutiveErrors = 0;

    const parser = new DOMParser();
    const doc = parser.parseFromString(pageHtml, "text/html");
    const items = doc.querySelectorAll(".timeline-item");
    if (items.length === 0) break;

    let newOnPage = 0;
    items.forEach((item) => {
      let rawHandle = item.getAttribute("data-username") || "";
      if (!rawHandle) {
        const link = item.querySelector("a.tweet-link, a.tweet-avatar, a.fullname");
        if (link) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/^\/([a-zA-Z0-9_]{1,15})$/);
          if (match) rawHandle = match[1];
        }
      }
      if (!rawHandle) {
        const userEl = item.querySelector(".username");
        if (userEl) {
          rawHandle = userEl.textContent || "";
        }
      }
      const handle = cleanTwitterHandle(rawHandle);
      if (!handle || !isValidTwitterHandle(handle) || seenHandles.has(handle)) return;
      seenHandles.add(handle);
      newOnPage++;

      const fullname = item.querySelector(".fullname")?.textContent?.trim() || handle;
      const rawAvatar = item.querySelector(".tweet-avatar img, .avatar")?.getAttribute("src") || "";
      const avatar = cleanTwitterMediaUrl(rawAvatar, host);
      const bio = item.querySelector(".tweet-content")?.textContent?.trim() || "";

      allAccounts.push({
        id: handle,
        handle: handle,
        name: fullname || formatTwitterHandle(handle),
        username: formatTwitterHandle(handle),
        avatar: avatar,
        bio: bio,
        service: "twitter",
        followedAt: Date.now() - (allAccounts.length * 1000)
      });
    });

    // Progressively save after each page with clean account isolation (do not merge with previous user)
    if (allAccounts.length > 0) {
      saveTwitterFollowing(allAccounts, { merge: false });
    }

    if (typeof onProgress === "function") {
      onProgress(allAccounts.length, `Imported ${allAccounts.length} accounts (page ${page + 1})...`);
    }

    // Extract next cursor using DOMParser with raw HTML regex fallback
    let nextCursor = null;
    const showMore = doc.querySelector(".show-more a, .show-more-tweets a, a[href*='cursor=']");
    if (showMore) {
      const href = showMore.getAttribute("href") || "";
      const m = href.match(/[?&]cursor=([^&"'>\s]+)/);
      nextCursor = m ? decodeURIComponent(m[1]) : null;
    }
    if (!nextCursor) {
      const rawCursorMatch = pageHtml.match(/href=[\"']\?[^\"']*cursor=([^\"'>\s&]+)[\"']/i) || pageHtml.match(/[?&]cursor=([^\"'>\s&]+)/i);
      if (rawCursorMatch) {
        nextCursor = decodeURIComponent(rawCursorMatch[1]);
      }
    }

    if (!nextCursor || nextCursor === currentCursor) {
      break;
    }
    currentCursor = nextCursor;
    page++;

    // Polite delay between pages (2.6s) to stay within rate limits
    await new Promise((r) => setTimeout(r, 2600));
  }

  return allAccounts;
}

// Saved Following accounts in localStorage
export function getSavedTwitterFollowing() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("paw_twitter_following") : null;
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const validList = [];
    const seen = new Set();
    list.forEach((acc, idx) => {
      if (!acc) return;
      const h = cleanTwitterHandle(acc.handle || acc.id);
      if (isValidTwitterHandle(h)) {
        const lower = h.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          const displayHandle = formatTwitterHandle(h);
          validList.push({
            id: h,
            handle: h,
            name: acc.name || displayHandle,
            username: displayHandle,
            avatar: acc.avatar || "",
            service: "twitter",
            followedAt: acc.followedAt || (Date.now() - idx * 1000)
          });
        }
      }
    });
    return validList;
  } catch (_) {
    return [];
  }
}

// Parse any raw input (JSON, CSV, Plain Text, Twitter Archive following.js) into followed accounts
export function parseTwitterFollowingInput(raw) {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  const handles = [];
  const seen = new Set();
  const ignoredWords = new Set([
    "home", "explore", "notifications", "messages", "settings", "i", "search",
    "intent", "user", "following", "followers", "status", "about", "help",
    "login", "signup", "and", "or", "the", "to", "for", "with", "from", "by"
  ]);

  function add(h, name = "") {
    if (!h) return;
    let clean = String(h).trim().replace(/^@+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (/^[a-zA-Z0-9_]{1,15}$/.test(clean)) {
      const lower = clean.toLowerCase();
      if (!seen.has(lower) && !ignoredWords.has(lower)) {
        seen.add(lower);
        handles.push({
          id: clean,
          handle: clean,
          name: name ? name.trim() : formatTwitterHandle(clean),
          username: formatTwitterHandle(clean),
          service: "twitter",
          avatar: "",
          bio: "",
          followedAt: Date.now() - (handles.length * 1000)
        });
      }
    }
  }

  let jsonStr = trimmed;
  if (jsonStr.startsWith("window.YTD.following.part0 = ")) {
    jsonStr = jsonStr.replace(/^window\.YTD\.following\.part0\s*=\s*/, "").replace(/;\s*$/, "");
  }
  if (jsonStr.startsWith("[") || jsonStr.startsWith("{")) {
    try {
      const parsed = JSON.parse(jsonStr);
      const arr = Array.isArray(parsed) ? parsed : (parsed.following || parsed.users || Object.values(parsed));
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "string") {
            add(item);
          } else if (item && typeof item === "object") {
            const h = item.handle || item.username || item.screen_name || item.user || item.id;
            const n = item.name || item.displayName || "";
            if (h && typeof h === "string") {
              add(h, n);
            } else if (item.following && item.following.userUrl) {
              const url = item.following.userUrl;
              if (!url.includes("/intent/")) {
                const m = url.match(/(?:twitter\.com\/|x\.com\/)([a-zA-Z0-9_]{1,15})/);
                if (m) add(m[1]);
              }
            }
          }
        }
        if (handles.length > 0) return handles;
      }
    } catch (_) {}
  }

  const lines = trimmed.split(/[\r\n]+/);
  const hasAt = trimmed.includes("@");
  for (const line of lines) {
    if (!line.trim()) continue;
    if (hasAt) {
      const matches = Array.from(line.matchAll(/@([a-zA-Z0-9_]{1,15})/g));
      for (const m of matches) {
        add(m[1]);
      }
    } else {
      const parts = line.split(/[,;\t\s]+/).filter(Boolean);
      for (const part of parts) {
        add(part);
      }
    }
  }
  return handles;
}

export function saveTwitterFollowing(list, options = {}) {
  const { merge = false } = typeof options === "boolean" ? { merge: options } : (options || {});
  try {
    if (Array.isArray(list) && typeof localStorage !== "undefined") {
      const existing = merge ? getSavedTwitterFollowing() : [];
      const seen = new Set();
      const compactList = [];

      function addAccount(acc) {
        if (!acc) return;
        const h = cleanTwitterHandle(acc.handle || acc.id);
        if (h && isValidTwitterHandle(h)) {
          const lower = h.toLowerCase();
          if (!seen.has(lower)) {
            seen.add(lower);
            const name = (acc.name || "").trim();
            const avatar = acc.avatar ? cleanTwitterMediaUrl(acc.avatar) : "";
            const followedAt = typeof acc.followedAt === "number" ? acc.followedAt : Date.now();
            const item = { handle: h };
            if (name && name !== h && name !== `@${h}`) item.name = name;
            if (avatar) item.avatar = avatar;
            if (followedAt) item.followedAt = followedAt;
            compactList.push(item);
          }
        }
      }

      list.forEach(addAccount);
      if (merge && existing.length > 0) {
        existing.forEach(addAccount);
      }

      localStorage.setItem("paw_twitter_following", JSON.stringify(compactList));
      return getSavedTwitterFollowing();
    }
  } catch (err) {
    console.error("saveTwitterFollowing error:", err);
  }
  return [];
}

export function clearTwitterFollowing() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("paw_twitter_following");
      localStorage.removeItem("paw_twitter_my_handle");
    }
  } catch (_) {}
}



// State for Following Feed chronological pooling and cursor management
let followingFeedPool = [];
let followingAccountOffset = 0;
let followingFeedSeenIds = new Set();

export function resetTwitterFollowingFeedState() {
  followingFeedPool = [];
  followingAccountOffset = 0;
  followingFeedSeenIds.clear();
}

export function getTwitterFollowingFeedState() {
  return {
    pool: [...followingFeedPool],
    offset: followingAccountOffset,
    seenIds: new Set(followingFeedSeenIds)
  };
}

export function restoreTwitterFollowingFeedState(saved) {
  if (!saved) return;
  followingFeedPool = Array.isArray(saved.pool) ? [...saved.pool] : [];
  followingAccountOffset = typeof saved.offset === "number" ? saved.offset : 0;
  followingFeedSeenIds = saved.seenIds instanceof Set ? new Set(saved.seenIds) : new Set();
}

// Following Feed algorithm: fetches recent tweets from followed accounts into a unified chronological pool,
// deduplicates, sorts by date descending, and yields 25 posts per page.
export async function fetchTwitterFollowingFeed(cursor = 0, signal = null, feedType = "tweets") {
  const following = getSavedTwitterFollowing();
  if (!following || following.length === 0) {
    throw new Error("No followed accounts saved yet. Enter a Twitter handle on the home page and click 'Import Following' to save accounts.");
  }

  const validFollowing = following.filter((acc) => isValidTwitterHandle(acc.handle || acc.id));
  if (validFollowing.length === 0) {
    throw new Error("No valid followed accounts found. Please re-sync your followed accounts.");
  }

  const isFirstPage = cursor === 0 || cursor === "0" || !cursor;
  if (isFirstPage) {
    resetTwitterFollowingFeedState();
  }

  const targetPageSize = 25;
  const accountsPerFetch = isFirstPage ? 10 : 6;

  // If pool has fewer posts than desired page size, fetch tweets from the next batch of accounts
  while (followingFeedPool.length < targetPageSize && followingAccountOffset < validFollowing.length) {
    if (signal && signal.aborted) throw new Error("Feed fetch aborted");

    const batch = validFollowing.slice(followingAccountOffset, followingAccountOffset + accountsPerFetch);
    followingAccountOffset += batch.length;

    const fetchPromises = batch.map(async (acc) => {
      try {
        const h = cleanTwitterHandle(acc.handle || acc.id);
        if (!isValidTwitterHandle(h)) return [];
        const res = await fetchTwitterFeed(h, null, signal, feedType);
        return res.posts || [];
      } catch (_) {
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    results.forEach((r) => {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        r.value.forEach((post) => {
          const pId = post.tweetId || post.id;
          if (pId) {
            const existingIdx = followingFeedPool.findIndex((p) => (p.tweetId || p.id) === pId);
            if (existingIdx !== -1) {
              if (followingFeedPool[existingIdx].isRetweet && !post.isRetweet) {
                // If previous item was a retweet, replace it with authentic original post
                followingFeedPool[existingIdx] = post;
              }
              return;
            }
            if (!followingFeedSeenIds.has(pId)) {
              const hideReplies = typeof window !== "undefined" && window.pawTwitterHideReplies !== undefined
                ? window.pawTwitterHideReplies
                : (typeof localStorage !== "undefined" && localStorage.getItem("paw_twitter_hide_replies") === "true");

              if (hideReplies && post.isReply && !post.isSelfReply) {
                return;
              }

              // Also ensure it is not an empty dummy post
              const textContent = (post.content || post.title || "").replace(/<[^>]*>/g, "").trim();
              const hasMedia = Boolean(post.file || (post.attachments && post.attachments.length > 0) || post.isVideo);
              const hasQuote = Boolean(post.quote);
              if (hasMedia || textContent || hasQuote) {
                followingFeedSeenIds.add(pId);
                followingFeedPool.push(post);
              }
            }
          }
        });
      }
    });

    // Sort the pool strictly chronologically (newest first)
    followingFeedPool.sort((a, b) => {
      const timeA = a.published ? new Date(a.published).getTime() : 0;
      const timeB = b.published ? new Date(b.published).getTime() : 0;
      return timeB - timeA;
    });

    if (batch.length === 0) break;
  }

  // Yield up to targetPageSize posts from the sorted pool
  const postsToYield = followingFeedPool.splice(0, targetPageSize);

  // If there are still posts in pool OR more accounts to check, provide next cursor
  const hasMore = followingFeedPool.length > 0 || followingAccountOffset < validFollowing.length;
  const nextCursor = (postsToYield.length > 0 && hasMore) ? String(followingAccountOffset) : null;

  return {
    posts: postsToYield,
    nextCursor: nextCursor
  };
}
