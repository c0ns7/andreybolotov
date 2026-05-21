/* Service Worker: кэш просмотренных фото и видео (блог, акции, uploads). */
var CACHE = "ab_media_v1";
var MEDIA_PATH_RE = /^\/(uploads\/|img\/)/;
var MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|svg|ico|mp4|webm|mov|m4v)(\?|#|$)/i;
var MAX_ENTRIES = 220;

function isMediaUrl(url) {
  try {
    var u = new URL(url);
    return MEDIA_PATH_RE.test(u.pathname) || MEDIA_EXT_RE.test(u.pathname);
  } catch (e) {
    return false;
  }
}

function trimCache(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= MAX_ENTRIES) return;
    var drop = keys.length - MAX_ENTRIES;
    var chain = Promise.resolve();
    for (var i = 0; i < drop; i++) {
      (function (req) {
        chain = chain.then(function () {
          return cache.delete(req);
        });
      })(keys[i]);
    }
    return chain;
  });
}

self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n.indexOf("ab_media") === 0 && n !== CACHE;
            })
            .map(function (n) {
              return caches.delete(n);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== "ab_prefetch_media" || !data.url) return;
  var url = String(data.url);
  if (!isMediaUrl(url)) return;
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.match(url).then(function (hit) {
        if (hit) return hit;
        return fetch(url, { credentials: "same-origin" }).then(function (res) {
          if (res && res.ok) {
            return cache.put(url, res.clone()).then(function () {
              return trimCache(cache);
            });
          }
        });
      });
    }),
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  if (!isMediaUrl(event.request.url)) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        var network = fetch(event.request)
          .then(function (res) {
            if (res && res.ok) {
              cache.put(event.request, res.clone()).then(function () {
                return trimCache(cache);
              });
            }
            return res;
          })
          .catch(function () {
            if (cached) return cached;
            throw new Error("offline");
          });

        if (cached) {
          network.catch(function () {});
          return cached;
        }
        return network;
      });
    }),
  );
});
