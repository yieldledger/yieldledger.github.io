// Offline copy for the installed app. Everything is fetched fresh from the network first, so a new
// release shows on the next visit; the saved copy is only used when offline.
const CACHE = 'yl-v3';
const SHELL = ['./', 'index.html', 'css/app.css', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/app.js', 'js/auth.js', 'js/charts.js', 'js/data.js', 'js/engine.js', 'js/fr.js', 'js/i18n.js', 'js/importer.js', 'js/help.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || Response.error())));
});
