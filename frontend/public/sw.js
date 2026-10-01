const CACHE='sp-shell-v1'; const SHELL=['/','/manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))return; if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);

  if (u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/legacy/')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        const c = r.clone();
        caches.open(CACHE).then(x => x.put(e.request, c));
        return r;
      })
      .catch(() =>
        caches.match(e.request).then(r => r || caches.match('/'))
      )
  );
});