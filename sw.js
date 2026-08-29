app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(`
    const CACHE_NAME = 'maksab-cache-v2'; // قم بتغيير رقم الإصدار مع كل تحديث رئيسي ترفعه
    
    self.addEventListener('install', e => {
      self.skipWaiting(); // اجعل Service Worker الجديد يتثبت فوراً
      e.waitUntil(
        caches.open(CACHE_NAME).then(c => c.addAll(['/app']))
      );
    });

    self.addEventListener('activate', e => {
      e.waitUntil(
        caches.keys().then(keys => {
          return Promise.all(
            keys.map(key => {
              if (key !== CACHE_NAME) {
                return caches.delete(key); // مسح الكاش القديم فوراً
              }
            })
          );
        }).then(() => self.clients.claim()) // السيطرة الفورية على الصفحات المفتوحة
      );
    });

    self.addEventListener('fetch', e => {
      e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
      );
    });
  `);
});