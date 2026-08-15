self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('maksab-store').then((cache) => cache.addAll(['/app'])));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});