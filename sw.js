
const CACHE_NAME = 'isaac-terminal-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/vite.svg',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Opened cache and caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: Network-only. Do not cache.
  if (url.hostname.includes('generativelanguage.googleapis.com')) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell & static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        // Check for a valid response before caching
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, networkResponse.clone());
          });
        }
        return networkResponse;
      });

      // Return cached response immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

// --- IndexedDB Logic ---
const DB_NAME = 'isaac-db';
const STORE_NAME = 'user-activity';
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(DB_NAME, VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

function getTimestamp(key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

// --- Periodic Sync for Notifications ---
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-inactivity') {
    event.waitUntil(checkInactivityAndNotify());
  }
});

async function checkInactivityAndNotify() {
  if (self.Notification.permission !== 'granted') {
    return;
  }

  const lastInteraction = await getTimestamp('lastInteraction');
  if (!lastInteraction) {
    return;
  }

  const INACTIVITY_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();

  if (now - lastInteraction > INACTIVITY_THRESHOLD) {
    self.registration.showNotification('ISAAC', {
      body: "It's been a while. Let's talk.",
      icon: '/vite.svg',
      badge: '/vite.svg',
      tag: 'isaac-reminder'
    });
  }
}

// --- Notification Click Handler ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
          }
        }
        return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
