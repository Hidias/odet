// Alertes sur le téléphone (0411) : affiche les alertes envoyées par l'application et ouvre la bonne page au clic.
// Ce fichier ne met rien en cache : l'application reste chargée comme avant.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: 'Nouvelle alerte', body: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(d.title || 'Nouvelle alerte', {
    body: d.body || '',
    tag: d.tag || undefined,
    data: { url: d.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const chemin = (event.notification.data && event.notification.data.url) || '/'
  const cible = new URL(`/#${chemin.startsWith('/') ? chemin : `/${chemin}`}`, self.location.origin).href
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const f of fenetres) {
      if (new URL(f.url).origin === self.location.origin) { await f.focus(); return f.navigate(cible) }
    }
    return self.clients.openWindow(cible)
  })())
})
