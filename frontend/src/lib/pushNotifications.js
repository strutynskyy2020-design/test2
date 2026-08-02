import api from "@/lib/api";

export const pushIsSupported = () => (
  typeof window !== "undefined"
  && "serviceWorker" in navigator
  && "PushManager" in window
  && "Notification" in window
);

const urlBase64ToUint8Array = (value) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
};

export const getPushRegistration = async () => {
  if (!pushIsSupported()) return null;
  return navigator.serviceWorker.ready;
};

export const getCurrentPushSubscription = async () => {
  const registration = await getPushRegistration();
  return registration?.pushManager?.getSubscription?.() || null;
};

export const subscribeToPush = async () => {
  if (!pushIsSupported()) throw new Error("Цей браузер не підтримує PWA Push");
  const { data: config } = await api.get("/push/config");
  if (!config?.supported || !config?.public_key) {
    throw new Error("Web Push ще не налаштовано на сервері");
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Дозвіл на сповіщення не надано");
  }

  const registration = await getPushRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.public_key),
    });
  }

  const json = subscription.toJSON();
  await api.post("/push/subscribe", {
    ...json,
    user_agent: navigator.userAgent,
  });
  return subscription;
};

export const unsubscribeFromPush = async () => {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) {
    await api.delete("/push/unsubscribe");
    return false;
  }
  await api.delete("/push/unsubscribe", { params: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
  return true;
};

export const syncExistingPushSubscription = async () => {
  if (!pushIsSupported() || Notification.permission !== "granted") return null;
  const subscription = await getCurrentPushSubscription();
  if (!subscription) return null;
  const json = subscription.toJSON();
  await api.post("/push/subscribe", {
    ...json,
    user_agent: navigator.userAgent,
  });
  return subscription;
};
