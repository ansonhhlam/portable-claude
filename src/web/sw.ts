// Service worker: shows push notifications and focuses the app when one is
// tapped. It deliberately has no fetch handler, so nothing (in particular no
// API response or session content) is ever cached by the worker.
export {};

const sw = self as unknown as ServiceWorkerGlobalScope;

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

function sameOriginUrl(url: string | undefined): string {
  try {
    const u = new URL(url ?? '/', sw.location.origin);
    return u.origin === sw.location.origin ? u.href : sw.location.origin + '/';
  } catch {
    return sw.location.origin + '/';
  }
}

sw.addEventListener('push', (event) => {
  let payload: PushPayload;
  try {
    payload = (event.data?.json() as PushPayload | undefined) ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const title = payload.title || 'longcord';
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: sameOriginUrl(payload.url) },
  };
  if (payload.tag) options.tag = payload.tag;
  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | null;
  const target = sameOriginUrl(data?.url);
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === sw.location.origin) {
          await client.focus();
          if (client.url !== target) {
            try {
              await client.navigate(target);
            } catch {
              /* navigation of uncontrolled clients can fail; focusing is enough */
            }
          }
          return;
        }
      }
      await sw.clients.openWindow(target);
    })(),
  );
});
