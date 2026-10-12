// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCbTBBXuB-5GwyZt3vlraksSaZNxU4plF8",
  authDomain: "jcompass-mobile.firebaseapp.com",
  projectId: "jcompass-mobile",
  storageBucket: "jcompass-mobile.firebasestorage.app",
  messagingSenderId: "637041633042",
  appId: "1:637041633042:web:46e9e4d641b278fca175cb"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background push:', payload);
  const title = (payload.notification && payload.notification.title) || 'JCompass';
  const body  = (payload.notification && payload.notification.body)  || '';
  const link  = (payload.fcmOptions && payload.fcmOptions.link)
             || (payload.data && payload.data.url)
             || '/';

  self.registration.showNotification(title, {
    body: body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    tag: 'jcompass-' + Date.now(),
    renotify: true,
    data: { link: link }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.host) && 'focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});