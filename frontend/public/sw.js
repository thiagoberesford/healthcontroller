/* Service worker mínimo: satisfaz o critério de instalável (PWA);
   fetch é pass-through — a app é sempre atual (dados vivos no Supabase). */
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // pass-through; sem cache para evitar versões desatualizadas
});
