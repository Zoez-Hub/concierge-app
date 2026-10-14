// 通知用的 service worker（hub#152，docs/NOTIFY.md）。普通脚本（不是模块），作用范围就是页面所在的目录。
// 只做两件事：收到推送就显示一条系统通知；点通知就打开（或切到）页面上对应的任务。
// 不缓存任何东西、不拦请求、不做离线：页面照旧每次都从网络读，签名校验都在页面里。
// 推送正文只有 { title, url }：title 是 Mac 拼好的「任务名 · 一句固定的状态话」，url 是 #/t/<仓库>/<号>。都当不可信输入处理。

const SAFE_URL = /^#\/(t\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[1-9][0-9]{0,8})?$/;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.slice(0, 200) : 'Concierge 有新的状态';
  const url = typeof data.url === 'string' && SAFE_URL.test(data.url) ? data.url : '#/';
  // 每次推送都必须显示一条通知（userVisibleOnly）；同一个任务的新通知替换旧的
  event.waitUntil(self.registration.showNotification(title, { tag: url === '#/' ? 'concierge' : url, data: { url }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = event.notification.data && SAFE_URL.test(event.notification.data.url) ? event.notification.data.url : '#/';
  const target = new URL(hash, self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try { await c.focus(); } catch { /* 有的浏览器不让 focus，照样换地址 */ }
      try { await c.navigate(target); return; } catch { /* 页面不受这个 worker 控制时 navigate 会失败：开一个新的 */ }
    }
    await self.clients.openWindow(target);
  })());
});
