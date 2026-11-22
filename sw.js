/* ==========================================================
   造景 · Service Worker
   把这几个文件缓存下来，让工坊离线可用。
   · 路径全是相对的，放在任何子目录都能工作
   · 单个文件缺失不会让整次安装失败
   · 改了代码记得把 VERSION 加一，旧缓存会自动清掉
   ========================================================== */
const VERSION = 'zaojing-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/presets.js',
  './js/engine.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  // 页面导航：先网络，断网时回退到缓存里的首页
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, net.clone()).catch(() => {});
        return net;
      } catch (err) {
        const cache = await caches.open(VERSION);
        return (await cache.match(req)) || (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 静态资源：缓存优先，后台顺手更新
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      fetch(req).then((net) => { if (net && net.ok) cache.put(req, net.clone()).catch(() => {}); }).catch(() => {});
      return hit;
    }
    try {
      const net = await fetch(req);
      if (net && net.ok) cache.put(req, net.clone()).catch(() => {});
      return net;
    } catch (err) {
      return Response.error();
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
