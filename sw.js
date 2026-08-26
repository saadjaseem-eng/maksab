const CACHE_NAME = 'maksab-cache-v2'; // قم بتغيير الرقم (v2, v3...) مع كل تحديث رئيسي ترفعه

self.addEventListener('install', event => {
  self.skipWaiting(); // اجبار الخدمة الجديدة على التثبيت فوراً دون انتظار إغلاق المتصفح
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['/app']);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ مسح الذاكرة المؤقتة القديمة:', cacheName);
            return caches.delete(cacheName); // حذف الكاش القديم تلقائياً
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // تحديث الكاش بالنسخة الجديدة من السيرفر مباشرة
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // إذا كان المستخدم غير متصل بالإنترنت، اعرض النسخة المخزنة
        return caches.match(event.request);
      })
  );
});