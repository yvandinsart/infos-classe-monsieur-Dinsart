const CACHE_NAME = "infos-classe-v3";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isConfig = sameOrigin && url.pathname.endsWith("/config.js");
  const isAppJs = sameOrigin && url.pathname.endsWith("/app.js");
  const isNavigation = event.request.mode === "navigate";

  // Les fichiers critiques de configuration et de logique doivent toujours
  // récupérer la version la plus récente après un déploiement.
  if (isConfig || isAppJs || isNavigation) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (sameOrigin && response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  const title = data.title || "La classe de Monsieur Dinsart";
  const options = {
    body: data.body || "Nouvelle information.",
    icon: new URL("icons/icon-192.png", self.registration.scope).href,
    badge: new URL("icons/icon-192.png", self.registration.scope).href,
    tag: data.tag || "infos-classe",
    renotify: true,
    data: { url: self.registration.scope }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
