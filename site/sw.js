// Offline shell for the installed app. Code and styles: show the cached copy at once and refresh it in
// the background. Market data: always try the network first, fall back to the last copy when offline.
const CACHE = 'yl-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/app.js', 'js/auth.js', 'js/charts.js', 'js/data.js', 'js/engine.js', 'js/fr.js', 'js/i18n.js', 'js/importer.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || Response.error())));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
