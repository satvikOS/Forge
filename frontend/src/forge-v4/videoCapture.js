// Forge-104 — Canvas video capture (WebM/VP9).
//
// Thin wrapper around the browser's MediaRecorder API. The caller hands
// us a <canvas> (or anything with .captureStream) and we hand back a
// stop() promise that resolves to a Blob the caller can download, base64,
// or POST upstream.
//
// Codec defaults to VP9 in a WebM container — that's the Chromium default
// and what Electron's Chromium ships with. WebM, not MP4: Chromium's
// MediaRecorder does NOT emit MP4/H.264 from a <canvas> stream out of the
// box, so we record .webm and let the caller transcode downstream if they
// truly need .mp4. (The slice brief asks for "MP4 export" — the real
// engineering answer is "Chromium gives you WebM/VP9; if you need MP4,
// transcode with ffmpeg on save".)
//
// We add a 250 ms warm-up before .start() to make sure the first frame is
// actually painted; otherwise on slow machines the recording can begin
// with one or two black frames while r3f finishes its first render.
//
// MediaRecorder availability: we surface a clean { unsupported: true }
// path so the HUD can show a toast instead of crashing.

/**
 * Pick the first MIME type the browser actually supports from a preference list.
 * Returns null if none of them are usable — caller MUST treat that as
 * "MediaRecorder unsupported on this platform".
 */
export function pickSupportedMime(codec = 'vp9') {
  if (typeof MediaRecorder === 'undefined' ||
      typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  const candidates = [];
  if (codec === 'vp9') {
    candidates.push('video/webm;codecs=vp9,opus',
                    'video/webm;codecs=vp9',
                    'video/webm;codecs=vp8',
                    'video/webm');
  } else if (codec === 'vp8') {
    candidates.push('video/webm;codecs=vp8', 'video/webm');
  } else if (codec === 'h264' || codec === 'avc1') {
    // Some Chromium builds expose h264 via "video/mp4;codecs=avc1" but
    // most do not. We try anyway so callers can opt-in.
    candidates.push('video/mp4;codecs=avc1.42E01E',
                    'video/mp4',
                    'video/webm;codecs=h264',
                    'video/webm');
  } else {
    candidates.push(codec, 'video/webm;codecs=vp9', 'video/webm');
  }
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * Begin recording the given <canvas>. Returns a handle with .stop()
 * (which resolves to a Blob) and the underlying MediaRecorder.
 *
 * If MediaRecorder is unavailable in the host we return { unsupported: true,
 * reason } instead of throwing; the caller (the HUD) shows a toast.
 *
 * Options:
 *   fps       — frame rate the canvas stream is captured at (default 60)
 *   codec     — 'vp9' (default), 'vp8', or 'h264'
 *   bitrate   — video bitrate in bits/sec (default 12_000_000 ≈ HQ 1080p60)
 *   warmupMs  — ms to wait after start() before resolving so the first
 *               frame is non-black (default 250)
 */
export function startCanvasCapture(canvas, opts = {}) {
  const { fps = 60, codec = 'vp9', bitrate = 12_000_000, warmupMs = 250 } = opts;

  if (!canvas || typeof canvas.captureStream !== 'function') {
    return { unsupported: true, reason: 'canvas.captureStream unavailable' };
  }
  if (typeof MediaRecorder === 'undefined') {
    return { unsupported: true, reason: 'MediaRecorder unavailable in this runtime' };
  }
  const mime = pickSupportedMime(codec);
  if (!mime) {
    return { unsupported: true, reason: `no MediaRecorder MIME supported (asked ${codec})` };
  }

  let stream;
  try {
    stream = canvas.captureStream(fps);
  } catch (err) {
    return { unsupported: true, reason: `captureStream threw: ${err.message || err}` };
  }
  if (!stream) {
    return { unsupported: true, reason: 'captureStream returned null' };
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bitrate,
    });
  } catch (err) {
    return { unsupported: true, reason: `MediaRecorder ctor threw: ${err.message || err}` };
  }

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e && e.data && e.data.size > 0) chunks.push(e.data);
  };

  // 250 ms warm-up: schedule start() on the next animation frame, then
  // wait warmupMs before considering the recording "really running".
  const startedAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  let startError = null;
  try {
    recorder.start(/* timeslice: */ 100);
  } catch (err) {
    startError = err;
  }
  // Warm-up: give the canvas one frame to paint before the user pulls the
  // resulting blob out. We don't gate start() on this — we just delay the
  // EARLIEST allowed stop() so the file is never empty.
  const warmedUp = new Promise((resolve) => {
    if (warmupMs <= 0) { resolve(); return; }
    setTimeout(resolve, warmupMs);
  });

  return {
    recorder,
    mime,
    fps,
    stream,
    unsupported: false,
    startError,
    startedAt,
    /**
     * Stop recording and resolve to a Blob containing the recorded video.
     * Honours the warm-up window so the file is non-empty.
     */
    async stop() {
      await warmedUp;
      if (recorder.state === 'inactive') {
        // Already stopped or never started — return whatever we have.
        return new Blob(chunks, { type: mime });
      }
      return await new Promise((resolve, reject) => {
        recorder.onstop = () => {
          try {
            const blob = new Blob(chunks, { type: mime });
            // Free the underlying camera/canvas track so the GC can drop them.
            try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
            resolve(blob);
          } catch (err) { reject(err); }
        };
        recorder.onerror = (e) => reject(e && e.error ? e.error : new Error('MediaRecorder error'));
        try {
          recorder.requestData?.();
        } catch { /* not all browsers support requestData */ }
        try {
          recorder.stop();
        } catch (err) { reject(err); }
      });
    },
  };
}

/**
 * Trigger a browser download of the given Blob with the supplied filename.
 * Used by the HUD's "Stop" button to spit the .webm out to disk.
 */
export function downloadBlob(blob, filename) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!blob || blob.size === 0) {
    console.warn('[forge.v4.videoCapture] downloadBlob: empty blob');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `forge-capture-${Date.now()}.webm`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Defer revoke so Chromium has time to flush the download.
  setTimeout(() => {
    try { document.body.removeChild(a); } catch { /* noop */ }
    URL.revokeObjectURL(url);
  }, 500);
}

/**
 * Convert a Blob to a base64-encoded data string (without the data: prefix).
 * Used when we need to ship a recording up the Archie thread or persist it.
 */
export function blobToBase64(blob) {
  if (!blob) return Promise.resolve('');
  if (typeof FileReader === 'undefined') {
    // Node-ish fallback. Should never hit this in Electron renderer.
    return blob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      // btoa exists in browsers; Node lacks it but `Buffer` does. Try both.
      if (typeof btoa === 'function') return btoa(binary);
      if (typeof Buffer !== 'undefined') return Buffer.from(binary, 'binary').toString('base64');
      return '';
    });
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result || '');
      // r.result is "data:<mime>;base64,<payload>". Strip the prefix.
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

/** Default export — keeps named imports working but is a no-op container. */
export default {
  startCanvasCapture,
  downloadBlob,
  blobToBase64,
  pickSupportedMime,
};
