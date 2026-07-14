async function checkRegisterServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();

      if (registration) {
        console.log('Existing Service Worker found.');
        return registration;
      }

      const newRegistration = await navigator.serviceWorker.register('/notifworker.js');
      console.log('New Service Worker registered.');

      return newRegistration;

    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }
}

async function setSubscribeStatus(callback, state=null) {
  const register = await checkRegisterServiceWorker();
  const serviceWorkerReady = await navigator.serviceWorker.ready;

  const existingSubscription = await serviceWorkerReady.pushManager.getSubscription();

  if (isSubscribed && state !== true) {
    if (existingSubscription) {
      await fetch(' /api/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify(existingSubscription),
        headers: { 'Content-Type': 'application/json' },
      });

      existingSubscription.unsubscribe();
      isSubscribed = false;
    }
  } else if (state !== false) {
    if (!('serviceWorker' in navigator && 'PushManager' in window && Notification.permission !== "denied")) return;

    try {
      console.log(existingSubscription ? 'Resubmitting old subscription...' : 'Creating new subscription...')

      const subscription = existingSubscription || await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const response = await fetch(' /api/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.status === 200) {
        isSubscribed = true;
      }

      console.log('User subscribed!');
    } catch (err) {
      console.error(err);
    }
  }

  if (callback) callback(isSubscribed);
}

// Convert base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
}

async function checkSubscribed(callback) {
  if (isSubscribed === null) {
    const serviceWorkerReady = await navigator.serviceWorker.ready;
    const existingSubscription = await serviceWorkerReady.pushManager.getSubscription();

    if (existingSubscription) {
      isSubscribed = await (await fetch(' /api/is-subscribed', {
        method: 'POST',
        body: JSON.stringify(existingSubscription),
        headers: { 'Content-Type': 'application/json' },
      })).json();
    } else {
      isSubscribed = false;
    }
  }

  if (callback) return callback(isSubscribed);
}

let isSubscribed = null;
