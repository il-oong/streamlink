const CACHE = 'streamlink-v4';
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
  const path = url.pathname;

  // HTML, JS: 네트워크 우선 → 실패 시 캐시 (항상 최신 코드 반영)
  if (path.endsWith('.html') || path === '/' || path.endsWith('.js')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // CSS, 이미지 등: 캐시 우선
  if (STATIC.some(s => path.endsWith(s.replace('/', '')))) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // 오디오 스트림 등 외부 요청: 네트워크 직접
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
});
