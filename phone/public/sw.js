// Keeps the phone app opening without a connection: the page and its files are cached as they
// load. Google's servers (sign-in, Drive) are never cached; the app keeps its own locked copy of
// the data in IndexedDB.
const CACHE = 'fp-phone-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  // Built files have content hashes in their names: the cached copy is always right.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          })
      )
    )
    return
  }
  // The page and other files: the network first, so updates arrive; the cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? './' : req, copy))
        return res
      })
      .catch(() => caches.match(req.mode === 'navigate' ? './' : req).then((hit) => hit || caches.match('./')))
  )
})
