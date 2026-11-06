// js/postNormalizer.js
// Handles normalization of raw post objects across platforms (Kemono, Pawchive, Coomer, e621, Gelbooru).

import { state } from "./state.js";
export { transformTwitterRssItem, transformTwitterHtmlItem } from "./twitter.js";

export function normalizePost(post) {
  if (!post) return post;

  // 1. Service resolution
  if (!post.service) {
    const match = state.currentFeedEndpoint && state.currentFeedEndpoint.match(/\/api\/v1\/([^\/]+)\/user\/([^\/]+)/);
    if (match) {
      post.service = match[1];
      if (!post.user && !post.user_id && !post.creatorId) post.user = match[2];
    }
  }

  // 2. User / Creator ID resolution (especially Coomer format where it's creatorId)
  if (!post.user) {
    post.user = post.creatorId || post.creator_id || post.user_id || (post.creator && (post.creator.id || post.creator.name)) || "";
  }

  // 3. Author display name resolution
  if (!post.authorName) {
    post.authorName = post.creatorName || (post.creator && (post.creator.displayName || post.creator.name)) || "";
    if (!post.authorName && state.currentFeedCreatorName) {
      post.authorName = state.currentFeedCreatorName;
    }
    if (!post.authorName && post.user && Array.isArray(state.allCreators) && state.allCreators.length > 0) {
      const found = state.allCreators.find((c) => String(c.id) === String(post.user) && (!post.service || c.service === post.service));
      if (found) post.authorName = found.name || found.displayName;
    }
    if (!post.authorName && post.user) {
      post.authorName = post.user;
    }
  }

  // 4. Content / Caption resolution
  if (!post.content) {
    post.content = post.captionHtml || post.captionText || post.caption || post.substring || "";
  }

  // 5. Title resolution: if title is missing/null/empty or "Untitled", fall back to caption snippet or Post #id
  const hasRawTitle = typeof post.title === "string" && post.title.trim().length > 0 && post.title.trim().toLowerCase() !== "untitled";
  if (!hasRawTitle) {
    const textFallback = (post.captionText || post.caption || (typeof post.content === "string" ? post.content.replace(/<[^>]+>/g, " ") : "")).trim();
    if (textFallback) {
      const firstLine = textFallback.split(/[\r\n]+/)[0].trim();
      post.title = firstLine.length > 90 ? firstLine.slice(0, 87) + "..." : firstLine;
    } else if (post.id) {
      post.title = `Post #${post.id}`;
    } else {
      post.title = "";
    }
  }

  // 6. Media attachments normalization (for Coomer new format with storageKey/sha256)
  if (state.currentSite === "cum" || post.service === "onlyfans" || post.service === "fansly") {
    if (Array.isArray(post.attachments)) {
      post.attachments.forEach((att) => {
        if (!att) return;
        if (!att.path) {
          const sha = att.storageKey || att.sha256 || att.id;
          if (sha) {
            let variantName = "original.jpg";
            if (Array.isArray(att.variants) && att.variants.length > 0 && att.variants[0].name) {
              variantName = att.variants[0].name;
            } else if (att.originalFilename) {
              const ext = att.originalFilename.split(".").pop();
              if (ext) variantName = `original.${ext}`;
            } else if (att.kind === "video" || (att.mimeType && att.mimeType.startsWith("video/"))) {
              variantName = "original.mp4";
            }
            att.path = `/media/${sha}/${variantName}`;
            if (!att.name) att.name = att.originalFilename || variantName;
          }
        }
      });
    }
  }

  // Legacy hash+ext fallback
  if (post.hash && post.ext && !post.file && !post.attachments) {
    post.file = {
      name: `${post.hash}.${post.ext}`,
      path: `/${post.hash.substring(0, 2)}/${post.hash.substring(2, 4)}/${post.hash}.${post.ext}`
    };
  }

  return post;
}

export function transformE621PostClient(p) {
  const artistTags = (p.tags && Array.isArray(p.tags.artist)) ? p.tags.artist : [];
  const contributorTags = (p.tags && Array.isArray(p.tags.contributor)) ? p.tags.contributor : [];
  const characterTags = (p.tags && Array.isArray(p.tags.character)) ? p.tags.character : [];
  const speciesTags = (p.tags && Array.isArray(p.tags.species)) ? p.tags.species : [];
  const generalTags = (p.tags && Array.isArray(p.tags.general)) ? p.tags.general : [];
  const copyrightTags = (p.tags && Array.isArray(p.tags.copyright)) ? p.tags.copyright : [];
  const loreTags = (p.tags && Array.isArray(p.tags.lore)) ? p.tags.lore : [];
  const metaTags = (p.tags && Array.isArray(p.tags.meta)) ? p.tags.meta : [];
  const invalidTags = (p.tags && Array.isArray(p.tags.invalid)) ? p.tags.invalid : [];

  const artistName = artistTags.length > 0 ? artistTags[0] : (p.uploader_name || "Unknown");

  const fileObj = p.file || {};
  const ext = (fileObj.ext || "jpg").toLowerCase();
  const md5 = fileObj.md5 || "";
  let mainUrl = fileObj.url || "";
  if (!mainUrl && md5) {
    mainUrl = `https://static1.e621.net/data/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`;
  }
  const sampleObj = p.sample || {};
  const sampleUrl = sampleObj.has && sampleObj.url ? sampleObj.url : (md5 ? `https://static1.e621.net/data/sample/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg` : "");
  const previewObj = p.preview || {};
  const previewUrl = previewObj.url || (md5 ? `https://static1.e621.net/data/preview/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.jpg` : "");

  const cleanPath = (u) => {
    if (!u) return "";
    const idx = u.indexOf("/data/");
    if (idx !== -1) {
      const sub = u.slice(idx + 5);
      return sub.startsWith("/") ? sub : `/${sub}`;
    }
    return u.startsWith("/") ? u : `/${u}`;
  };

  const primaryPath = md5
    ? `/${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5}.${ext}`
    : cleanPath(mainUrl || sampleUrl);
  const cleanSample = cleanPath(sampleUrl);
  const cleanPreview = cleanPath(previewUrl);

  const allTags = [
    ...artistTags,
    ...contributorTags,
    ...characterTags,
    ...speciesTags,
    ...generalTags,
    ...copyrightTags,
    ...loreTags,
    ...metaTags,
    ...invalidTags
  ];

  const tagsCategorized = {
    artist: artistTags,
    contributor: contributorTags,
    character: characterTags,
    species: speciesTags,
    general: generalTags,
    copyright: copyrightTags,
    lore: loreTags,
    meta: metaTags,
    invalid: invalidTags
  };

  return {
    id: String(p.id),
    user: artistName,
    artists: artistTags,
    service: "e621",
    title: "",
    published: p.created_at || new Date().toISOString(),
    added: p.created_at || new Date().toISOString(),
    edited: p.updated_at || null,
    content: p.description || "",
    description: p.description || "",
    file: {
      name: `${p.id}.${ext}`,
      path: primaryPath,
      size: fileObj.size || 0,
      width: fileObj.width || 0,
      height: fileObj.height || 0
    },
    attachments: [],
    preview_url: cleanPreview,
    sample_url: cleanSample,
    tags: allTags,
    tags_categorized: tagsCategorized,
    relationships: p.relationships || {
      parent_id: null,
      has_children: false,
      children: []
    },
    rating: p.rating || "s",
    score: p.score && typeof p.score.total === "number" ? p.score.total : (typeof p.score === "number" ? p.score : 0),
    fav_count: p.fav_count || 0
  };
}
