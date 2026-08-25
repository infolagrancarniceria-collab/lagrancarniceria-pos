// Service worker mínimo — solo existe para que el navegador considere el
// sistema "instalable" como app (ícono en pantalla de inicio) y para que la
// pantalla no quede en blanco si se abre con la señal justo cortada.
//
// No cachea nada de /api/ (siempre va directo a la red — son datos en vivo,
// y el modo sin conexión de Cámara ya tiene su propia cola en localStorage,
// ver web/src/lib/colaOffline.ts). Para el resto (HTML/JS/CSS/íconos):
// intenta la red primero y guarda una copia; si la red falla, usa la
// última copia guardada.
const CACHE_NAME = "lgc-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request).then((cacheada) => cacheada || caches.match("/")))
  );
});
