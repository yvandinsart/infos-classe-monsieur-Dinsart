const CACHE_NAME = "infos-classe-v4";
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

const HISTORY_DB = "infos-classe-history";
const HISTORY_STORE = "notifications";

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
  const isStyles = sameOrigin && url.pathname.endsWith("/styles.css");
  const isNavigation = event.request.mode === "navigate";

  if (isConfig || isAppJs || isStyles || isNavigation) {
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

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
        store.createIndex("receivedAt", "receivedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveNotification(record) {
  const db = await openHistoryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}

  const title = data.title || "La classe de Monsieur Dinsart";
  const body = data.body || "Nouvelle information.";
  const tag = data.tag || `infos-classe-${Date.now()}`;
  const receivedAt = Date.now();

  const options = {
    body,
    icon: new URL("icons/icon-192.png", self.registration.scope).href,
    badge: new URL("icons/icon-192.png", self.registration.scope).href,
    tag,
    renotify: true,
    data: { url: `${self.registration.scope}#notifications` }
  };

  const record = {
    id: tag,
    title,
    body,
    receivedAt
  };

  event.waitUntil(Promise.all([
    saveNotification(record).catch(error => console.error("Historique notification", error)),
    self.registration.showNotification(title, options)
  ]));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || `${self.registration.scope}#notifications`;
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
