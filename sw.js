/* MEDPUR Tracker — offline service worker.
   Serve from the same folder as the app (a-Shell: python3 -m http.server 8080).
   On every app update: change CACHE and APP below; old caches are deleted on activate
   (Google Fonts are copied across, so an update never loses them). */
const CACHE = 'medpur-web-v1';
const APP = 'index.html';
const PRECACHE = [APP, 'medpur-icon-180.png'];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const isFont = (u) => FONT_HOSTS.includes(new URL(u).hostname);

// Fonts at install time, so the very first online open already keeps them. Best effort: never blocks install.
function precacheFonts(c) {
  return fetch(FONT_CSS, { mode: 'cors' }).then((res) => {
    if (!res.ok) return;
    return res.clone().text().then((css) => {
      const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
      return c.put(FONT_CSS, res).then(() => Promise.all(urls.map((u) =>
        fetch(u, { mode: 'cors' }).then((r) => r.ok && c.put(u, r)).catch(() => {}))));
    });
  }).catch(() => {});
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(PRECACHE).then(() => precacheFonts(c)))
    .then(() => self.skipWaiting()));
});

// Activate: copy font entries from old caches (if the new one lacks them), then delete old caches.
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.open(CACHE).then((cur) => caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('medpur-') && k !== CACHE).map((k) => caches.open(k)
      .then((old) => old.keys().then((reqs) => Promise.all(reqs.filter((r) => isFont(r.url)).map((r) =>
        cur.match(r, { ignoreVary: true }).then((have) => have || old.match(r).then((res) => res && cur.put(r, res)))))))
      .then(() => caches.delete(k))))))
    .then(() => self.clients.claim()));
});

// Cache-first; on a miss go to the network and keep a copy only when store is true.
function cacheFirst(req, store, opts) {
  return caches.open(CACHE).then((c) =>
    c.match(req, opts).then((hit) => hit || fetch(req).then((res) => {
      if (store && res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    }))
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: served from the cache, saved if missing.
  if (FONT_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req, true, { ignoreVary: true })); return; }

  // Other sites (exchange-rate / gold ticker, WhatsApp): never cached, the app handles their failure.
  if (url.origin !== self.location.origin) return;

  // Only the app file and the icon are kept; any other file on the phone's server is just passed through.
  const name = url.pathname.split('/').pop();
  const keep = PRECACHE.includes(name);

  if (req.mode === 'navigate') {
    e.respondWith(
      cacheFirst(req, keep, { ignoreSearch: true })
        .catch(() => caches.match(APP, { ignoreSearch: true }))
        .then((res) => res || caches.match(APP, { ignoreSearch: true }))
    );
    return;
  }
  e.respondWith(cacheFirst(req, keep));
});
