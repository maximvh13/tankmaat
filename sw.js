/*
 * Service worker van Tankmaat.
 *
 * Twee redenen dat hij bestaat:
 * 1. Zonder service worker biedt Chrome de app niet aan om te installeren. Voor een app die
 *    uitsluitend als PWA geleverd wordt, is dat het verschil tussen een website en een app.
 * 2. Fase 11 maakte de gegevens offline bruikbaar (wachtrij + bewaarde query-cache), maar alleen
 *    zolang het tabblad open bleef. Herlaadde je zonder verbinding, dan kwam de offline-pagina van
 *    de browser. Nu komt de app zelf nog terug.
 *
 * Strategie: netwerk eerst, cache als terugval. Dus nooit verouderde code zolang er verbinding is.
 * Verhoog CACHE bij een wijziging hier; dat gooit bij activatie alle oudere caches weg.
 */

const CACHE = 'tankmaat-v1';

/*
 * De schil is de map waar deze service worker zelf staat, niet de domeinwortel: op een statische
 * host kan de app in een submap staan (bijv. /tankmaat/). Hardcoded '/' zou daar de verkeerde
 * pagina cachen en de terugval bij een herlaadbeurt zonder verbinding stukmaken.
 */
const SHELL = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Alleen onze eigen bestanden. Verzoeken aan Supabase horen hier niet in de cache: die moeten
  // falen als er geen verbinding is, zodat de wachtrij uit Fase 11 ze oppakt.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(networkFirst(event));
});

async function networkFirst(event) {
  const request = event.request;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Een route die nog nooit bezocht is, valt terug op de schil: die bepaalt zelf waar je hoort.
    if (request.mode === 'navigate') {
      const shell = await caches.match(SHELL);
      if (shell) return shell;
    }
    throw error;
  }
}
