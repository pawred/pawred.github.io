// js/gifPlayer.js
// Custom video player engine for animated GIF files in Paw Reader.
// Features:
// 1. Hardware-accelerated native WebCodecs ImageDecoder with on-demand streaming.
// 2. Non-blocking Asynchronous Web Worker fallback for browsers without ImageDecoder (e.g. Firefox).
// 3. Instant frame 0 presentation (<10ms) eliminating initial blank / freeze times.
// 4. Duck-typed HTMLVideoElement for seamless connection with attachCustomVideoPlayer.

import { attachCustomVideoPlayer } from "./player.js";
import { formatBytes, renderMediaProgress, showMediaUnavailableWarning, markMediaLoaded } from "./utils.js";
import { PROXY_URL, state } from "./state.js";

// ============================================================================
// GIF89a Parser & Decoder (omggif by Dean McNamee, MIT License)
// ============================================================================

function GifReader(buf) {
  let p = 0;

  if (
    buf[p++] !== 0x47 ||
    buf[p++] !== 0x49 ||
    buf[p++] !== 0x46 ||
    buf[p++] !== 0x38 ||
    ((buf[p++] + 1) & 0xfd) !== 0x38 ||
    buf[p++] !== 0x61
  ) {
    throw new Error("Invalid GIF 87a/89a header.");
  }

  const width = buf[p++] | (buf[p++] << 8);
  const height = buf[p++] | (buf[p++] << 8);
  const pf0 = buf[p++];
  const global_palette_flag = pf0 >> 7;
  const num_global_colors_pow2 = pf0 & 0x7;
  const num_global_colors = 1 << (num_global_colors_pow2 + 1);
  const background = buf[p++];
  buf[p++]; // Pixel aspect ratio

  let global_palette_offset = null;
  let global_palette_size = null;

  if (global_palette_flag) {
    global_palette_offset = p;
    global_palette_size = num_global_colors;
    p += num_global_colors * 3;
  }

  let no_eof = true;
  const frames = [];
  let delay = 0;
  let transparent_index = null;
  let disposal = 0;
  let loop_count = null;

  this.width = width;
  this.height = height;

  while (no_eof && p < buf.length) {
    switch (buf[p++]) {
      case 0x21: // Extension Block
        switch (buf[p++]) {
          case 0xff: // Application extension
            if (
              buf[p] !== 0x0b ||
              (buf[p + 1] === 0x4e &&
                buf[p + 2] === 0x45 &&
                buf[p + 3] === 0x54 &&
                buf[p + 4] === 0x53 &&
                buf[p + 5] === 0x43 &&
                buf[p + 6] === 0x41 &&
                buf[p + 7] === 0x50 &&
                buf[p + 8] === 0x45 &&
                buf[p + 9] === 0x32 &&
                buf[p + 10] === 0x2e &&
                buf[p + 11] === 0x30 &&
                buf[p + 12] === 0x03 &&
                buf[p + 13] === 0x01 &&
                buf[p + 16] === 0)
            ) {
              p += 14;
              loop_count = buf[p++] | (buf[p++] << 8);
              p++;
            } else {
              p += 12;
              while (true) {
                const block_size = buf[p++];
                if (!(block_size >= 0)) throw new Error("Invalid block size");
                if (block_size === 0) break;
                p += block_size;
              }
            }
            break;

          case 0xf9: // Graphics Control Extension
            if (buf[p++] !== 0x4 || buf[p + 4] !== 0) {
              throw new Error("Invalid graphics extension block.");
            }
            const pf1 = buf[p++];
            delay = buf[p++] | (buf[p++] << 8);
            transparent_index = buf[p++];
            if ((pf1 & 1) === 0) transparent_index = null;
            disposal = (pf1 >> 2) & 0x7;
            p++;
            break;

          case 0xfe: // Comment Extension
            while (true) {
              const block_size = buf[p++];
              if (!(block_size >= 0)) throw new Error("Invalid block size");
              if (block_size === 0) break;
              p += block_size;
            }
            break;

          default:
            while (p < buf.length) {
              const block_size = buf[p++];
              if (!block_size || block_size <= 0) break;
              p += block_size;
            }
            break;
        }
        break;

      case 0x2c: // Image Descriptor
        const x = buf[p++] | (buf[p++] << 8);
        const y = buf[p++] | (buf[p++] << 8);
        const w = buf[p++] | (buf[p++] << 8);
        const h = buf[p++] | (buf[p++] << 8);
        const pf2 = buf[p++];
        const local_palette_flag = pf2 >> 7;
        const interlace_flag = (pf2 >> 6) & 1;
        const num_local_colors_pow2 = pf2 & 0x7;
        const num_local_colors = 1 << (num_local_colors_pow2 + 1);
        let palette_offset = global_palette_offset;
        let palette_size = global_palette_size;
        let has_local_palette = false;
        if (local_palette_flag) {
          has_local_palette = true;
          palette_offset = p;
          palette_size = num_local_colors;
          p += num_local_colors * 3;
        }

        const data_offset = p;
        p++; // codesize
        while (true) {
          const block_size = buf[p++];
          if (!(block_size >= 0)) throw new Error("Invalid block size");
          if (block_size === 0) break;
          p += block_size;
        }

        frames.push({
          x,
          y,
          width: w,
          height: h,
          has_local_palette,
          palette_offset,
          palette_size,
          data_offset,
          data_length: p - data_offset,
          transparent_index,
          interlaced: !!interlace_flag,
          delay,
          disposal,
        });
        break;

      case 0x3b: // Trailer Marker (EOF)
        no_eof = false;
        break;

      case 0x00: // Null padding byte between blocks
        break;

      default:
        break;
    }
  }

  this.numFrames = () => frames.length;
  this.loopCount = () => loop_count;
  this.frameInfo = (frame_num) => {
    if (frame_num < 0 || frame_num >= frames.length) {
      throw new Error("Frame index out of range.");
    }
    return frames[frame_num];
  };

  this.decodeAndBlitFrameRGBA = (frame_num, pixels, shared_index_stream) => {
    const frame = this.frameInfo(frame_num);
    const num_pixels = frame.width * frame.height;
    const index_stream = shared_index_stream || new Uint8Array(num_pixels);
    GifReaderLZWOutputIndexStream(buf, frame.data_offset, index_stream, num_pixels);
    const palette_offset = frame.palette_offset;
    const trans = frame.transparent_index === null ? 256 : frame.transparent_index;

    const framewidth = frame.width;
    const framestride = width - framewidth;
    let xleft = framewidth;

    let opbeg = (frame.y * width + frame.x) * 4;
    const opend = ((frame.y + frame.height) * width + frame.x) * 4;
    let op = opbeg;

    let scanstride = framestride * 4;
    if (frame.interlaced === true) {
      scanstride += width * 4 * 7;
    }

    let interlaceskip = 8;

    for (let i = 0, il = num_pixels; i < il; ++i) {
      const index = index_stream[i];

      if (xleft === 0) {
        op += scanstride;
        xleft = framewidth;
        if (op >= opend) {
          scanstride = framestride * 4 + width * 4 * (interlaceskip - 1);
          op = opbeg + (framewidth + framestride) * (interlaceskip << 1);
          interlaceskip >>= 1;
        }
      }

      if (index === trans) {
        op += 4;
      } else {
        const r = buf[palette_offset + index * 3];
        const g = buf[palette_offset + index * 3 + 1];
        const b = buf[palette_offset + index * 3 + 2];
        pixels[op++] = r;
        pixels[op++] = g;
        pixels[op++] = b;
        pixels[op++] = 255;
      }
      --xleft;
    }
  };
}

function GifReaderLZWOutputIndexStream(code_stream, p, output, output_length) {
  const min_code_size = code_stream[p++];
  const clear_code = 1 << min_code_size;
  const eoi_code = clear_code + 1;
  let next_code = eoi_code + 1;

  let cur_code_size = min_code_size + 1;
  let code_mask = (1 << cur_code_size) - 1;
  let cur_shift = 0;
  let cur = 0;
  let op = 0;

  let subblock_size = code_stream[p++];
  const code_table = new Int32Array(4096);
  let prev_code = null;

  while (true) {
    while (cur_shift < 16) {
      if (subblock_size === 0) break;
      cur |= code_stream[p++] << cur_shift;
      cur_shift += 8;
      if (subblock_size === 1) {
        subblock_size = code_stream[p++];
      } else {
        --subblock_size;
      }
    }

    if (cur_shift < cur_code_size) break;

    const code = cur & code_mask;
    cur >>= cur_code_size;
    cur_shift -= cur_code_size;

    if (code === clear_code) {
      next_code = eoi_code + 1;
      cur_code_size = min_code_size + 1;
      code_mask = (1 << cur_code_size) - 1;
      prev_code = null;
      continue;
    } else if (code === eoi_code) {
      break;
    }

    const chase_code = code < next_code ? code : prev_code;
    let chase_length = 0;
    let chase = chase_code;
    while (chase > clear_code) {
      chase = code_table[chase] >> 8;
      ++chase_length;
    }

    const k = chase;
    const op_end = op + chase_length + (chase_code !== code ? 1 : 0);
    if (op_end > output_length) {
      return;
    }

    output[op++] = k;
    op += chase_length;
    let b = op;

    if (chase_code !== code) output[op++] = k;

    chase = chase_code;
    while (chase_length--) {
      chase = code_table[chase];
      output[--b] = chase & 0xff;
      chase >>= 8;
    }

    if (prev_code !== null && next_code < 4096) {
      code_table[next_code++] = (prev_code << 8) | k;
      if (next_code >= code_mask + 1 && cur_code_size < 12) {
        ++cur_code_size;
        code_mask = (code_mask << 1) | 1;
      }
    }

    prev_code = code;
  }

  return output;
}

// ============================================================================
// Helper: Fast frame index lookup
// ============================================================================

function createFrameLookup(frames, totalDuration) {
  return function findFrameIndex(t, currentIdx = 0) {
    if (!frames || frames.length === 0) return 0;
    const boundedTime = Math.max(0, Math.min(totalDuration, t));
    const targetCentis = Math.round(boundedTime * 100);

    if (currentIdx >= 0 && currentIdx < frames.length) {
      const cur = frames[currentIdx];
      if (targetCentis >= cur.startCentis && targetCentis < cur.endCentis) {
        return currentIdx;
      }
      const nextIdx = (currentIdx + 1) % frames.length;
      const next = frames[nextIdx];
      if (targetCentis >= next.startCentis && (targetCentis < next.endCentis || nextIdx === frames.length - 1)) {
        return nextIdx;
      }
    }

    let low = 0;
    let high = frames.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const f = frames[mid];
      if (targetCentis < f.startCentis) {
        high = mid - 1;
      } else if (targetCentis >= f.endCentis && mid < frames.length - 1) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return Math.max(0, Math.min(frames.length - 1, low));
  };
}

// ============================================================================
// Engine 1: Native WebCodecs ImageDecoder (Hardware-Accelerated, Chrome & Safari)
// ============================================================================

async function createImageDecoderVideoElement({ decoder, width, height, numFrames, totalDuration, frames }) {
  let displayWidth = width;
  let displayHeight = height;

  const canvas = document.createElement("canvas");
  canvas.className = "post-media";
  canvas.width = displayWidth;
  canvas.height = displayHeight;
  canvas.dataset.isGif = "true";

  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  try {
    const res0 = await decoder.decode({ frameIndex: 0 });
    displayWidth = res0.image.displayWidth || width;
    displayHeight = res0.image.displayHeight || height;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    ctx.drawImage(res0.image, 0, 0, displayWidth, displayHeight);
    res0.image.close();
  } catch (_) {}

  const findFrameIndex = createFrameLookup(frames, totalDuration);

  let isPaused = true;
  let playbackTime = 0;
  let currentFrameIndex = 0;
  let rafId = null;
  let lastRafTime = 0;
  let isLooping = true;
  let isCleanedUp = false;
  let lastTimeupdateDispatch = 0;
  canvas._userPaused = false;

  let prefetchIdx = -1;
  let prefetchedFrame = null;
  let prefetchPromise = null;

  function startPrefetch(idx) {
    if (idx < 0 || idx >= numFrames || isCleanedUp) return;
    if (prefetchIdx === idx && (prefetchedFrame || prefetchPromise)) return;

    if (prefetchedFrame) {
      try { prefetchedFrame.close(); } catch (_) {}
      prefetchedFrame = null;
    }

    prefetchIdx = idx;
    prefetchPromise = decoder.decode({ frameIndex: idx }).then((res) => {
      if (isCleanedUp || prefetchIdx !== idx) {
        try { res.image.close(); } catch (_) {}
      } else {
        prefetchedFrame = res.image;
      }
      prefetchPromise = null;
    }).catch(() => {
      prefetchPromise = null;
    });
  }

  function drawVideoFrame(vf) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(vf, 0, 0, canvas.width, canvas.height);
  }

  function renderFrameAtTime(t) {
    const idx = findFrameIndex(t, currentFrameIndex);
    if (idx === currentFrameIndex || isCleanedUp) return;
    currentFrameIndex = idx;

    if (prefetchIdx === idx && prefetchedFrame) {
      const vf = prefetchedFrame;
      prefetchedFrame = null;
      prefetchIdx = -1;
      drawVideoFrame(vf);
      try { vf.close(); } catch (_) {}
      startPrefetch((idx + 1) % numFrames);
      return;
    }

    if (prefetchIdx === idx && prefetchPromise) {
      prefetchPromise.then(() => {
        if (currentFrameIndex === idx && prefetchedFrame && !isCleanedUp) {
          const vf = prefetchedFrame;
          prefetchedFrame = null;
          prefetchIdx = -1;
          drawVideoFrame(vf);
          try { vf.close(); } catch (_) {}
          startPrefetch((idx + 1) % numFrames);
        }
      });
      return;
    }

    if (prefetchedFrame) {
      try { prefetchedFrame.close(); } catch (_) {}
      prefetchedFrame = null;
      prefetchIdx = -1;
    }

    decoder.decode({ frameIndex: idx }).then((res) => {
      if (isCleanedUp) {
        try { res.image.close(); } catch (_) {}
        return;
      }
      if (currentFrameIndex === idx) {
        drawVideoFrame(res.image);
      }
      try { res.image.close(); } catch (_) {}
      startPrefetch((idx + 1) % numFrames);
    }).catch(() => {});
  }

  function tick(now) {
    if (isPaused || isCleanedUp) return;

    if (!lastRafTime) lastRafTime = now;
    const dt = (now - lastRafTime) / 1000;
    lastRafTime = now;

    playbackTime += dt;

    if (playbackTime >= totalDuration) {
      if (isLooping) {
        playbackTime = playbackTime % totalDuration;
      } else {
        playbackTime = totalDuration;
        canvas.pause();
        canvas.dispatchEvent(new Event("ended"));
        return;
      }
    }

    renderFrameAtTime(playbackTime);

    if (!lastTimeupdateDispatch || now - lastTimeupdateDispatch >= 250) {
      lastTimeupdateDispatch = now;
      canvas.dispatchEvent(new Event("timeupdate"));
    }

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastRafTime = performance.now();
    startPrefetch((currentFrameIndex + 1) % numFrames);
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  canvas.load = () => {};
  canvas.playbackRate = 1.0;
  canvas.seeking = false;
  canvas.currentSrc = "";

  Object.defineProperty(canvas, "videoWidth", { get: () => canvas.width, configurable: true });
  Object.defineProperty(canvas, "videoHeight", { get: () => canvas.height, configurable: true });
  Object.defineProperty(canvas, "duration", { get: () => totalDuration, configurable: true });

  Object.defineProperty(canvas, "currentTime", {
    get: () => playbackTime,
    set: (val) => {
      const target = Math.max(0, Math.min(totalDuration, Number(val) || 0));
      playbackTime = target;
      lastRafTime = performance.now();
      renderFrameAtTime(playbackTime);
      canvas.dispatchEvent(new Event("timeupdate"));
    },
    configurable: true,
  });

  Object.defineProperty(canvas, "paused", { get: () => isPaused, configurable: true });
  Object.defineProperty(canvas, "loop", {
    get: () => isLooping,
    set: (v) => { isLooping = !!v; },
    configurable: true,
  });

  Object.defineProperty(canvas, "muted", { get: () => true, set: () => {}, configurable: true });
  Object.defineProperty(canvas, "volume", { get: () => 0, set: () => {}, configurable: true });
  Object.defineProperty(canvas, "readyState", { get: () => 4, configurable: true });
  Object.defineProperty(canvas, "buffered", {
    get: () => ({ length: 1, start: () => 0, end: () => totalDuration }),
    configurable: true,
  });

  canvas.play = function (fromUser = false) {
    if (fromUser) canvas._userPaused = false;
    if (!isPaused || isCleanedUp) return Promise.resolve();
    isPaused = false;
    startLoop();
    canvas.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };

  canvas.pause = function (fromUser = false) {
    if (fromUser) canvas._userPaused = true;
    if (isPaused) return;
    isPaused = true;
    stopLoop();
    canvas.dispatchEvent(new Event("pause"));
  };

  canvas._cleanupGif = function () {
    isCleanedUp = true;
    stopLoop();
    if (prefetchedFrame) {
      try { prefetchedFrame.close(); } catch (_) {}
      prefetchedFrame = null;
    }
    try { decoder.close(); } catch (_) {}
    canvas.width = 0;
    canvas.height = 0;
  };

  return canvas;
}

// ============================================================================
// Engine 2: Asynchronous Web Worker Fallback (Firefox & Older Browsers)
// ============================================================================

const WORKER_CODE = `
${GifReader.toString()}
${GifReaderLZWOutputIndexStream.toString()}

self.onmessage = async function(e) {
  const { action, buffer } = e.data;
  if (action === "init") {
    try {
      const reader = new GifReader(buffer);
      const width = reader.width;
      const height = reader.height;
      const numFrames = reader.numFrames();

      const frames = [];
      let cumulativeCentis = 0;
      for (let i = 0; i < numFrames; i++) {
        const f = reader.frameInfo(i);
        const delayCentis = f.delay <= 1 ? 10 : f.delay;
        const startCentis = cumulativeCentis;
        cumulativeCentis += delayCentis;
        frames.push({
          index: i,
          startCentis,
          endCentis: cumulativeCentis,
          startTime: startCentis / 100,
          endTime: cumulativeCentis / 100,
          duration: delayCentis / 100,
        });
      }
      const totalDuration = cumulativeCentis / 100 || 0.1;

      const compBuffer = new Uint8ClampedArray(width * height * 4);
      const sharedIndexStream = new Uint8Array(width * height);
      let savedBuffer = null;

      if (reader.frameInfo(0).disposal === 3) {
        savedBuffer = new Uint8ClampedArray(width * height * 4);
      }

      reader.decodeAndBlitFrameRGBA(0, compBuffer, sharedIndexStream);
      const imgData0 = new ImageData(new Uint8ClampedArray(compBuffer), width, height);
      const bmp0 = await createImageBitmap(imgData0);

      self.postMessage({
        action: "initReady",
        width,
        height,
        numFrames,
        totalDuration,
        frames,
        frame0: bmp0,
      }, [bmp0]);

      let batch = [];
      let transferList = [];

      for (let i = 1; i < numFrames; i++) {
        const prevFrame = reader.frameInfo(i - 1);
        if (prevFrame.disposal === 2) {
          for (let y = prevFrame.y; y < prevFrame.y + prevFrame.height; y++) {
            for (let x = prevFrame.x; x < prevFrame.x + prevFrame.width; x++) {
              const idx = (y * width + x) * 4;
              compBuffer[idx] = 0;
              compBuffer[idx + 1] = 0;
              compBuffer[idx + 2] = 0;
              compBuffer[idx + 3] = 0;
            }
          }
        } else if (prevFrame.disposal === 3 && savedBuffer) {
          compBuffer.set(savedBuffer);
          savedBuffer = null;
        }

        const curFrame = reader.frameInfo(i);
        if (curFrame.disposal === 3) {
          savedBuffer = new Uint8ClampedArray(compBuffer);
        }

        reader.decodeAndBlitFrameRGBA(i, compBuffer, sharedIndexStream);
        const imgData = new ImageData(new Uint8ClampedArray(compBuffer), width, height);
        const bmp = await createImageBitmap(imgData);

        batch.push({ index: i, bitmap: bmp });
        transferList.push(bmp);

        if (batch.length >= 10 || i === numFrames - 1) {
          self.postMessage({ action: "framesChunk", frames: batch }, transferList);
          batch = [];
          transferList = [];
        }
      }

      self.postMessage({ action: "complete" });
    } catch (err) {
      self.postMessage({ action: "error", message: err.message || "Worker decode error" });
    }
  }
};
`;

function createWorkerGifVideoElement(worker, initData) {
  const { width, height, numFrames, totalDuration, frames, frame0 } = initData;

  const canvas = document.createElement("canvas");
  canvas.className = "post-media";
  canvas.width = width;
  canvas.height = height;
  canvas.dataset.isGif = "true";

  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const frameBitmaps = new Array(numFrames);
  frameBitmaps[0] = frame0;

  ctx.drawImage(frame0, 0, 0, width, height);

  const findFrameIndex = createFrameLookup(frames, totalDuration);

  let isPaused = true;
  let playbackTime = 0;
  let currentFrameIndex = 0;
  let rafId = null;
  let lastRafTime = 0;
  let isLooping = true;
  let isCleanedUp = false;
  let lastTimeupdateDispatch = 0;
  canvas._userPaused = false;

  worker.onmessage = (e) => {
    if (isCleanedUp) return;
    const { action, frames: chunk } = e.data;
    if (action === "framesChunk" && Array.isArray(chunk)) {
      for (const item of chunk) {
        frameBitmaps[item.index] = item.bitmap;
      }
    } else if (action === "complete") {
      worker.terminate();
    }
  };

  function drawFrame(idx) {
    if (idx < 0 || idx >= numFrames || isCleanedUp) return;
    const bmp = frameBitmaps[idx];
    if (bmp) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bmp, 0, 0, width, height);
      currentFrameIndex = idx;
    }
  }

  function renderFrameAtTime(t) {
    const idx = findFrameIndex(t, currentFrameIndex);
    if (idx !== currentFrameIndex) {
      drawFrame(idx);
    }
  }

  function tick(now) {
    if (isPaused || isCleanedUp) return;

    if (!lastRafTime) lastRafTime = now;
    const dt = (now - lastRafTime) / 1000;
    lastRafTime = now;

    playbackTime += dt;

    if (playbackTime >= totalDuration) {
      if (isLooping) {
        playbackTime = playbackTime % totalDuration;
      } else {
        playbackTime = totalDuration;
        canvas.pause();
        canvas.dispatchEvent(new Event("ended"));
        return;
      }
    }

    renderFrameAtTime(playbackTime);

    if (!lastTimeupdateDispatch || now - lastTimeupdateDispatch >= 250) {
      lastTimeupdateDispatch = now;
      canvas.dispatchEvent(new Event("timeupdate"));
    }

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastRafTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  canvas.load = () => {};
  canvas.playbackRate = 1.0;
  canvas.seeking = false;
  canvas.currentSrc = "";

  Object.defineProperty(canvas, "videoWidth", { get: () => width, configurable: true });
  Object.defineProperty(canvas, "videoHeight", { get: () => height, configurable: true });
  Object.defineProperty(canvas, "duration", { get: () => totalDuration, configurable: true });

  Object.defineProperty(canvas, "currentTime", {
    get: () => playbackTime,
    set: (val) => {
      const target = Math.max(0, Math.min(totalDuration, Number(val) || 0));
      playbackTime = target;
      lastRafTime = performance.now();
      renderFrameAtTime(playbackTime);
      canvas.dispatchEvent(new Event("timeupdate"));
    },
    configurable: true,
  });

  Object.defineProperty(canvas, "paused", { get: () => isPaused, configurable: true });
  Object.defineProperty(canvas, "loop", {
    get: () => isLooping,
    set: (v) => { isLooping = !!v; },
    configurable: true,
  });

  Object.defineProperty(canvas, "muted", { get: () => true, set: () => {}, configurable: true });
  Object.defineProperty(canvas, "volume", { get: () => 0, set: () => {}, configurable: true });
  Object.defineProperty(canvas, "readyState", { get: () => 4, configurable: true });
  Object.defineProperty(canvas, "buffered", {
    get: () => ({ length: 1, start: () => 0, end: () => totalDuration }),
    configurable: true,
  });

  canvas.play = function (fromUser = false) {
    if (fromUser) canvas._userPaused = false;
    if (!isPaused || isCleanedUp) return Promise.resolve();
    isPaused = false;
    startLoop();
    canvas.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };

  canvas.pause = function (fromUser = false) {
    if (fromUser) canvas._userPaused = true;
    if (isPaused) return;
    isPaused = true;
    stopLoop();
    canvas.dispatchEvent(new Event("pause"));
  };

  canvas._cleanupGif = function () {
    isCleanedUp = true;
    stopLoop();
    try { worker.terminate(); } catch (_) {}
    for (const bmp of frameBitmaps) {
      if (bmp && typeof bmp.close === "function") {
        try { bmp.close(); } catch (_) {}
      }
    }
    frameBitmaps.length = 0;
    canvas.width = 0;
    canvas.height = 0;
  };

  return canvas;
}

// ============================================================================
// Public GIF Player Loader
// ============================================================================

export async function loadGifPlayer({
  item,
  url,
  buffer = null,
  blob = null,
  filename,
  progressOverlay,
  onRetry,
  syncCarouselClones,
  playbackObserver,
  signal: externalSignal = null,
}) {
  if (item.dataset.isClone === "true") {
    if (progressOverlay) progressOverlay.style.display = "none";
    return;
  }

  if (window.pawCustomGifPlayer === false) {
    const img = document.createElement("img");
    img.className = "post-media";
    img.loading = "eager";
    img.src = url;

    img.onload = () => {
      markMediaLoaded(item, filename);
      if (typeof syncCarouselClones === "function") syncCarouselClones(item);
    };
    img.onerror = () => {
      delete item.dataset.loading;
      delete item.dataset.loaded;
      item.classList.remove("media-loaded");
      item.classList.remove("media-has-preview");
      if (progressOverlay) progressOverlay.style.display = "flex";
      showMediaUnavailableWarning(progressOverlay, {
        type: "image",
        filename,
        errorStatus: "404",
        onRetry,
      });
    };

    item.appendChild(img);
    return;
  }

  const abortController = new AbortController();
  item._abortController = abortController;
  const signal = abortController.signal;

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortController.abort();
      return;
    }
    externalSignal.addEventListener("abort", () => {
      try { abortController.abort(); } catch (_) {}
    }, { once: true });
  }

  const path = item.dataset.path;
  const isImagePath = path && /\.(jpe?g|png|webp|gif|avif)$/i.test(path);
  let posterImg = null;
  if (isImagePath && !path.startsWith("http://") && !path.startsWith("https://") && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
    posterImg = document.createElement("img");
    posterImg.className = "post-media";
    posterImg.loading = "eager";
    posterImg.onload = () => {
      item.classList.add("media-has-preview");
    };
    posterImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${path}`;
    item.appendChild(posterImg);
  }

  let knownSize = 0;
  if (buffer) {
    knownSize = buffer.byteLength || (buffer.buffer ? buffer.buffer.byteLength : 0) || 0;
  } else if (blob) {
    knownSize = blob.size || 0;
  } else if (item.dataset.size) {
    knownSize = parseInt(item.dataset.size, 10) || 0;
  }

  const initialTotalStr = knownSize > 0 ? formatBytes(knownSize) : "";
  const initialLoadedStr = (buffer || blob) && knownSize > 0 ? initialTotalStr : "";
  const initialStatus = (buffer || blob) ? "Decoding..." : "Loading...";

  renderMediaProgress(progressOverlay, initialStatus, null, filename, initialLoadedStr, initialTotalStr);

  try {
    let fullBuffer;

    if (!buffer && blob) {
      buffer = await blob.arrayBuffer();
    }

    if (buffer) {
      const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      fullBuffer = u8.slice();
      const sizeStr = formatBytes(fullBuffer.byteLength);
      renderMediaProgress(progressOverlay, "Decoding...", 100, filename, sizeStr, sizeStr);
    } else {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/zip") || (contentType.includes("text/html") && !url.includes("data:"))) {
        throw new Error(`Invalid GIF response content-type (${contentType}). Cannot decode non-image as GIF.`);
      }

      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
      const totalSize = contentLength > 0 ? contentLength : knownSize;
      if (totalSize > 80 * 1024 * 1024) {
        throw new Error(`GIF exceeds 80MB size limit (${formatBytes(totalSize)})`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const ab = await response.arrayBuffer();
        if (signal.aborted) return;
        fullBuffer = new Uint8Array(ab);
      } else {
        const chunks = [];
        let downloadedBytes = 0;
        let lastUiUpdate = 0;

        while (true) {
          if (signal.aborted) return;
          const { done, value } = await reader.read();
          if (signal.aborted) return;
          if (done) break;

          chunks.push(value);
          downloadedBytes += value.length;
          if (downloadedBytes > 80 * 1024 * 1024) {
            try { reader.cancel(); } catch (_) {}
            throw new Error("GIF exceeded 80MB download limit");
          }

          const now = Date.now();
          if (now - lastUiUpdate > 100) {
            lastUiUpdate = now;
            if (totalSize > 0) {
              const percent = Math.min(100, Math.round((downloadedBytes / totalSize) * 100));
              const loadedStr = formatBytes(downloadedBytes);
              const totalStr = formatBytes(totalSize);
              renderMediaProgress(progressOverlay, "Loading...", percent, filename, loadedStr, totalStr);
            } else {
              renderMediaProgress(progressOverlay, "Loading...", null, filename, formatBytes(downloadedBytes), "");
            }
          }
        }

        if (signal.aborted) return;

        fullBuffer = new Uint8Array(downloadedBytes);
        let offset = 0;
        for (const chunk of chunks) {
          fullBuffer.set(chunk, offset);
          offset += chunk.length;
        }
      }

      const finalSizeStr = formatBytes(fullBuffer.byteLength);
      renderMediaProgress(progressOverlay, "Decoding...", 100, filename, finalSizeStr, totalSize > 0 ? formatBytes(totalSize) : finalSizeStr);
    }

    const gifReader = new GifReader(fullBuffer);
    const numFrames = gifReader.numFrames();

    if (numFrames <= 1) {
      if (posterImg) posterImg.remove();

      const blob = new Blob([fullBuffer], { type: "image/gif" });
      const blobUrl = URL.createObjectURL(blob);
      item._blobUrl = blobUrl;

      const img = document.createElement("img");
      img.className = "post-media";
      img.src = blobUrl;

      img.onload = () => {
        markMediaLoaded(item, filename);
        if (typeof syncCarouselClones === "function") syncCarouselClones(item);
      };
      img.onerror = () => {
        delete item.dataset.loading;
        delete item.dataset.loaded;
        if (progressOverlay) progressOverlay.style.display = "flex";
        showMediaUnavailableWarning(progressOverlay, {
          type: "image",
          filename,
          errorStatus: "404",
          onRetry,
        });
      };

      item.appendChild(img);
      return;
    }

    const width = gifReader.width;
    const height = gifReader.height;
    const frames = [];
    let cumulativeCentis = 0;
    for (let i = 0; i < numFrames; i++) {
      const f = gifReader.frameInfo(i);
      const delayCentis = f.delay <= 1 ? 10 : f.delay;
      const startCentis = cumulativeCentis;
      cumulativeCentis += delayCentis;
      frames.push({
        index: i,
        startCentis,
        endCentis: cumulativeCentis,
        startTime: startCentis / 100,
        endTime: cumulativeCentis / 100,
        duration: delayCentis / 100,
      });
    }
    const totalDuration = cumulativeCentis / 100 || 0.1;

    let canvas = null;

    let useImageDecoder = false;
    if (typeof ImageDecoder !== "undefined") {
      try {
        useImageDecoder = await ImageDecoder.isTypeSupported({ type: "image/gif" });
      } catch (_) {
        useImageDecoder = false;
      }
    }

    if (signal.aborted) return;

    const estimatedUncompressedBytes = width * height * 4 * numFrames;
    const isTooHeavyForWorker = !useImageDecoder && (estimatedUncompressedBytes > 50 * 1024 * 1024 || numFrames > 80);

    if (isTooHeavyForWorker) {
      if (posterImg) {
        posterImg.remove();
        posterImg = null;
      }
      const gifBlob = new Blob([fullBuffer], { type: "image/gif" });
      const blobUrl = URL.createObjectURL(gifBlob);
      item._blobUrl = blobUrl;

      const img = document.createElement("img");
      img.className = "post-media";
      img.loading = "eager";
      img.src = blobUrl;
      item._cleanupGif = () => {
        if (item._blobUrl) {
          URL.revokeObjectURL(item._blobUrl);
          item._blobUrl = null;
        }
      };

      img.onload = () => {
        markMediaLoaded(item, filename);
        if (typeof syncCarouselClones === "function") syncCarouselClones(item);
      };
      img.onerror = () => {
        delete item.dataset.loading;
        delete item.dataset.loaded;
        if (progressOverlay) progressOverlay.style.display = "flex";
        showMediaUnavailableWarning(progressOverlay, {
          type: "image",
          filename,
          errorStatus: "404",
          onRetry,
        });
      };

      item.appendChild(img);
      return;
    }

    if (useImageDecoder) {
      const decoder = new ImageDecoder({
        data: fullBuffer,
        type: "image/gif",
      });
      await decoder.tracks.ready;

      if (signal.aborted) {
        try { decoder.close(); } catch (_) {}
        return;
      }

      canvas = await createImageDecoderVideoElement({
        decoder,
        width,
        height,
        numFrames,
        totalDuration,
        frames,
      });
    } else {
      const workerBlob = new Blob([WORKER_CODE], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerUrl);
      URL.revokeObjectURL(workerUrl);

      const initData = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          if (e.data.action === "initReady") {
            resolve(e.data);
          } else if (e.data.action === "error") {
            reject(new Error(e.data.message));
          }
        };
        worker.onerror = (err) => reject(err);

        worker.postMessage({ action: "init", buffer: fullBuffer }, [fullBuffer.buffer]);
      });

      if (signal.aborted) {
        try { worker.terminate(); } catch (_) {}
        if (initData.frame0) {
          try { initData.frame0.close(); } catch (_) {}
        }
        return;
      }

      canvas = createWorkerGifVideoElement(worker, initData);
    }

    if (signal.aborted) {
      if (canvas && typeof canvas._cleanupGif === "function") {
        canvas._cleanupGif();
      }
      return;
    }

    if (posterImg) {
      posterImg.remove();
      posterImg = null;
    }

    item.appendChild(canvas);
    attachCustomVideoPlayer(canvas, item);

    markMediaLoaded(item, filename);
    if (typeof syncCarouselClones === "function") syncCarouselClones(item);
    if (playbackObserver) playbackObserver.observe(canvas);

    item._cleanupGif = () => {
      if (playbackObserver) playbackObserver.unobserve(canvas);
      if (typeof canvas._cleanupCustomPlayer === "function") {
        try { canvas._cleanupCustomPlayer(); } catch (_) {}
        canvas._cleanupCustomPlayer = null;
      }
      if (typeof canvas._cleanupGif === "function") {
        canvas._cleanupGif();
      }
    };
  } catch (err) {
    if (signal.aborted) return;
    if (posterImg) {
      posterImg.remove();
      posterImg = null;
    }

    const fallbackImg = document.createElement("img");
    fallbackImg.className = "post-media";
    fallbackImg.loading = "eager";
    fallbackImg.src = url;

    fallbackImg.onload = () => {
      markMediaLoaded(item, filename);
      if (typeof syncCarouselClones === "function") syncCarouselClones(item);
    };
    fallbackImg.onerror = () => {
      delete item.dataset.loading;
      delete item.dataset.loaded;
      const p = item.dataset.path;
      const isImg = p && /\.(jpe?g|png|webp|gif)$/i.test(p);
      if (isImg && !p.startsWith("http://") && !p.startsWith("https://") && (state.currentSite === "pawchive" || state.currentSite === "kemono")) {
        const thumbImg = document.createElement("img");
        thumbImg.className = "post-media";
        thumbImg.loading = "eager";
        thumbImg.src = `${PROXY_URL}/${state.currentSite}/thumbnail/data${p}`;

        thumbImg.onload = () => {
          markMediaLoaded(item, filename);
          if (typeof syncCarouselClones === "function") syncCarouselClones(item);
        };
        thumbImg.onerror = () => {
          delete item.dataset.loading;
          delete item.dataset.loaded;
          if (progressOverlay) progressOverlay.style.display = "flex";
          showMediaUnavailableWarning(progressOverlay, {
            type: "gif",
            filename,
            errorStatus: "404",
            onRetry,
          });
        };

        item.appendChild(thumbImg);
        return;
      }

      if (progressOverlay) progressOverlay.style.display = "flex";
      showMediaUnavailableWarning(progressOverlay, {
        type: "gif",
        filename,
        errorStatus: err.message || "404",
        onRetry,
      });
    };

    item.appendChild(fallbackImg);
  }
}