const CACHE = 'streamlink-v7';
const STATIC = ['/style.css', '/manifest.json', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 외부 오디오 스트림은 SW가 절대 가로채지 않음
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // HTML, JS: 네트워크 우선 → 실패 시 캐시
  if (path === '/' || path.endsWith('.html') || path.endsWith('.js')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone(); // body 소비 전에 즉시 clone
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // CSS, 이미지, 기타 정적 자산: 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
