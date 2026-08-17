// Sandbox emulation for the MyLLMos web view, injected before every app script.
//
// Two jobs, and they pull in opposite directions on purpose:
//
//   1. STUB the `window.myllm*` bridges faithfully enough that an app can run
//      end-to-end without a device — same call signatures, same async-ness,
//      same return shapes as HTMLArtifactView.swift.
//   2. BOOBY-TRAP everything the sandbox does NOT provide (alert/confirm/prompt,
//      localStorage, raw fetch/XHR) so an app that reaches for them is caught
//      here instead of dying silently on a user's phone.
//
// Violations are pushed onto window.__violations and drained by the harness.
// Where reality and strictness disagree we match REALITY and record a finding,
// so one rule break doesn't cascade into ten bogus runtime errors.
//
// Deliberately NOT stubbed: window.myllmSpeak. GALLERY_HANDOVER.md §7 lists it
// as "NOT IMPLEMENTED — listed here in error historically". Apps must
// feature-detect it and fall back to speechSynthesis; stubbing it would hide
// exactly the bug we want to find.

(() => {
  const V = (window.__violations = []);
  const flag = (rule, detail) => V.push({ rule, detail: String(detail).slice(0, 300) });

  // Some apps stash state on a bridge between calls; keep it per-page.
  const mem = new Map();
  const files = new Map();
  const later = (v, ms = 12) => new Promise((r) => setTimeout(() => r(v), ms));

  // --- things the sandbox does not have -------------------------------------

  // On device these are no-ops that swallow the call and leave the app wedged
  // mid-flow. Here they throw, because a wedged app is the bug.
  for (const name of ['alert', 'confirm', 'prompt']) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        value: (...a) => {
          flag('js-dialog', `${name}(${a[0] ?? ''})`);
          throw new Error(`${name}() does not exist in the MyLLMos sandbox`);
        },
      });
    } catch (e) { /* locked down by the engine — the route/console checks still apply */ }
  }

  // localStorage/sessionStorage are DELIBERATELY left alone. Because the page
  // is set at a null origin — the same footing loadHTMLString(baseURL: nil)
  // gives the real web view — WebKit already throws SecurityError ("The
  // operation is insecure") on them, natively and for free.
  //
  // That makes the rule self-enforcing and, more importantly, correct in both
  // directions. An app that reaches for localStorage naked takes an uncaught
  // SecurityError and fails here exactly as it would on a phone. An app using
  // the documented pattern —
  //     try { if (window.myllmStorage) { ... } } catch (e) {}
  //     try { localStorage.setItem(k, v); } catch (e) {}
  // — passes, because that fallback exists for "Try in browser" on the web and
  // is correct. An earlier version of this file shimmed the API in memory; it
  // made every guarded app look guilty AND stopped apps like draw.html from
  // ever exercising their real on-device path. Don't reintroduce it.

  // The web view runs at a null origin, so fetch()/XHR are CORS-dead. Reject
  // the way the device does rather than letting the request escape.
  const realFetch = window.fetch?.bind(window);
  window.fetch = (input, init) => {
    const url = String(input?.url ?? input ?? '');
    if (/^(data|blob):/i.test(url)) return realFetch(input, init);  // legitimate, same-document
    flag('raw-fetch', url);
    return Promise.reject(new TypeError('Load failed'));
  };
  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const x = new RealXHR();
    const open = x.open.bind(x);
    x.open = (m, u, ...rest) => {
      if (!/^(data|blob):/i.test(String(u))) flag('raw-xhr', `${m} ${u}`);
      return open(m, u, ...rest);
    };
    return x;
  };
  window.open = (u) => { flag('window-open', u ?? ''); return null; };

  // --- the bridges ----------------------------------------------------------

  window.myllmHaptic = (style) => later(null).then(() => null);

  window.myllmStorage = {
    getItem: (k) => later(mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => later(void mem.set(String(k), String(v))),
    removeItem: (k) => later(void mem.delete(String(k))),
    clear: () => later(void mem.clear()),
    keys: () => later([...mem.keys()]),
  };

  // Apps are told to ask for strict JSON and parse defensively. Returning prose
  // where JSON was wanted is the single most common way a gallery app breaks,
  // so __askMode lets the harness run the mean version of this on purpose.
  window.myllmAsk = (prompt, options) => {
    const p = String(prompt ?? '');
    if (!p.trim()) return Promise.reject(new Error('myllmAsk needs a prompt.'));
    if (window.__askMode === 'reject') {
      return later(null, 30).then(() => {
        throw new Error('AI access for apps is turned off in MyLLM Settings.');
      });
    }
    if (window.__askMode === 'prose') {
      return later("Sure! Here's what I came up with — hope it helps.", 30);
    }
    // Default: satisfy the usual "reply with JSON" ask, wrapped in the chatty
    // preamble a small on-device model really does emit.
    const wantsArray = /\[|\barray\b|\blist\b/i.test(p);
    const body = wantsArray
      ? '[{"title":"Example","text":"Sample item","value":1},{"title":"Second","text":"Another","value":2}]'
      : '{"title":"Example","text":"Sample response","value":1,"items":["one","two"]}';
    return later('Here you go:\n```json\n' + body + '\n```', 30);
  };

  window.myllmFetch = (url, options) => {
    flag('bridge-network', String(url));  // recorded, not failed — legitimate for network apps
    return later(null, 20).then(() => {
      throw new Error('Network unavailable in verification harness');
    });
  };

  window.myllmShare = (text) => later(null);
  window.myllmSaveImage = (data) => later({ saved: true });
  window.myllmShareFile = (data, opts) => later({ saved: true });
  window.myllmPickImage = (opts) => later(null).then(() => { throw new Error('Cancelled'); });
  window.myllmGenerateImage = (prompt, opts) =>
    later('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 40);
  window.myllmVision = (prompt) => later('A sample photo.', 40);
  window.myllmScan = () => later('Scanned text.', 40);
  window.myllmTranscribe = (opts) => later('sample transcription', 40);
  window.myllmTranscribeFile = (opts) => later('sample transcription', 40);

  window.myllmLocation = {
    // timestamp is Date.now(), not 0: apps are told to judge freshness by the
    // fix's own clock, and a stub that always looks 56 years stale would make
    // every well-behaved app render a "no signal" screen here.
    current: (opts) => later({ latitude: 51.5074, longitude: -0.1278, accuracy: 12,
                               speed: 0, course: -1, timestamp: Date.now(),
                               address: (opts?.address !== false) ? 'London, United Kingdom' : null }),
    // A watch that resolved but never delivered would leave every tracker app
    // stuck on its "searching" screen, so the stub actually streams — slowly
    // drifting north, which is enough for a speed/distance readout to move.
    watch: (cb, opts) => {
      clearInterval(window.__myllmWatchT);
      let n = 0;
      const emit = () => typeof cb === 'function' && cb({
        latitude: 51.5074 + (n++ * 0.0002), longitude: -0.1278,
        accuracy: 8, speed: 12.5, course: 0, timestamp: Date.now() });
      emit();
      window.__myllmWatchT = setInterval(emit, 1000);
      return later({ watching: true });
    },
    stop: () => { clearInterval(window.__myllmWatchT); return later({ watching: false }); },
    search: (q, opts) => later([{ name: String(q || 'Place'), address: '1 Example St, London',
                                  latitude: 51.5074, longitude: -0.1278, distance: 420 }]),
    reverse: (lat, lon) => later({ address: 'London, United Kingdom' }),
  };

  window.myllmSteps = {
    available: () => later(true),
    today: () => later({ steps: 6421, distance: 4800, floors: 3 }),
    history: (days) => later(Array.from({ length: Number(days) || 7 }, (_, i) => ({
      date: `2026-08-0${(i % 7) + 1}`, steps: 5000 + i * 137, distance: 3900 + i * 90 }))),
    watch: () => later(true),
    stop: () => later(true),
  };

  window.myllmVideo = {
    start: (o) => later({ started: true }),
    frame: (d) => later({ accepted: true }),
    finish: (o) => later({ saved: true, shared: false }),
    cancel: () => later(true),
  };

  window.myllmFiles = {
    read: (p) => later(files.has(String(p)) ? files.get(String(p)) : null),
    write: (p, c) => later(void files.set(String(p), String(c ?? ''))),
    remove: (p) => later(void files.delete(String(p))),
    exists: (p) => later(files.has(String(p))),
    list: () => later([...files.keys()]),
  };

  // Only remember/forget exist — see the myllmMemory block in HTMLArtifactView.swift.
  window.myllmMemory = {
    remember: (fact, category) => later(null, 20),
    forget: (fact) => later(null, 20),
  };

  window.myllmIntent = {
    send: (action, data) => later({ routed: true, handlers: 1 }),
    receive: (cb) => {
      if (typeof cb !== 'function') return;
      window.__myllmIntentHandler = cb;
      if (window.__myllmInitialIntent) { try { cb(window.__myllmInitialIntent); } catch (e) {} }
    },
  };

  window.myllmTheme = {
    accent: '#4f7cff', scheme: 'light', largeText: false,
    dyslexiaFont: false, highContrast: false, reduceMotion: false,
  };

  // --no-bridges: prove every app degrades gracefully on an older build that
  // lacks the newer bridges. Traps and stubs above stay in place.
  if (window.__stripBridges) {
    for (const k of Object.keys(window).filter((k) => /^myllm[A-Z]/.test(k))) {
      try { delete window[k]; } catch (e) { window[k] = undefined; }
    }
  }
})();
