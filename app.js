import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cfg = window.INFOS_CLASSE_CONFIG || {};
const statusBox = document.getElementById("status");
const notifyBtn = document.getElementById("notifyBtn");
const installBtn = document.getElementById("installBtn");
const iosHelpBtn = document.getElementById("iosHelpBtn");
const iosDialog = document.getElementById("iosDialog");
const offline = document.getElementById("offline");

let deferredInstallPrompt = null;
let supabase = null;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const configured = () => Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.VAPID_PUBLIC_KEY);

function setStatus(text, cssClass = "") {
  statusBox.textContent = text;
  statusBox.className = `status modern-status ${cssClass}`.trim();
}

function updateOffline() {
  offline.classList.toggle("show", !navigator.onLine);
}

window.addEventListener("online", updateOffline);
window.addEventListener("offline", updateOffline);
updateOffline();

if (isIOS() && !isStandalone()) {
  iosHelpBtn.classList.remove("hidden");
  if (!sessionStorage.getItem("ios-install-help-shown")) {
    setTimeout(() => {
      if (!iosDialog.open) iosDialog.showModal();
      sessionStorage.setItem("ios-install-help-shown", "1");
    }, 650);
  }
}

iosHelpBtn.addEventListener("click", () => {
  if (!iosDialog.open) iosDialog.showModal();
});
document.getElementById("closeIosDialog").addEventListener("click", () => iosDialog.close());

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  installBtn.classList.add("hidden");
  deferredInstallPrompt = null;
});

installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add("hidden");
});

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("NO_SW");
  const registration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  return registration;
}

async function syncSubscriptionToSupabase(subscription) {
  if (!subscription) throw new Error("NO_PUSH_SUBSCRIPTION");
  if (!supabase) supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("INVALID_PUSH_SUBSCRIPTION");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json.endpoint));
  const endpointId = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");

  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint_id: endpointId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
    active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "endpoint_id" });

  if (error) throw error;
}

async function refreshState() {
  if (!("Notification" in window) || !("PushManager" in window)) {
    setStatus("Notifications non prises en charge sur cet appareil", "warn");
    notifyBtn.disabled = true;
    return;
  }

  if (!configured()) {
    setStatus("Application à configurer avant l’activation des notifications", "warn");
    notifyBtn.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    setStatus("Notifications bloquées dans les réglages du navigateur", "error");
    notifyBtn.disabled = true;
    return;
  }

  try {
    const registration = await registerServiceWorker();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      setStatus("Synchronisation de l’abonnement…");
      await syncSubscriptionToSupabase(subscription);
      setStatus("Notifications activées", "ok");
      notifyBtn.textContent = "Notifications activées";
      notifyBtn.disabled = true;
    } else {
      setStatus("Notifications non activées");
      notifyBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    setStatus("Le service de notifications n’a pas pu démarrer", "error");
    notifyBtn.disabled = false;
  }
}

async function activateNotifications() {
  if (!configured()) {
    setStatus("Configuration Supabase/VAPID manquante", "error");
    return;
  }

  if (isIOS() && !isStandalone()) {
    if (!iosDialog.open) iosDialog.showModal();
    setStatus("Installez d’abord l’application sur l’écran d’accueil", "warn");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setStatus(
      permission === "denied" ? "Notifications refusées dans le navigateur" : "Notifications non activées",
      permission === "denied" ? "error" : ""
    );
    return;
  }

  const registration = await registerServiceWorker();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY)
    });
  }

  await syncSubscriptionToSupabase(subscription);

  setStatus("Notifications activées", "ok");
  notifyBtn.textContent = "Notifications activées";
  notifyBtn.disabled = true;
}

notifyBtn.addEventListener("click", () => {
  notifyBtn.disabled = true;
  setStatus("Activation en cours…");
  activateNotifications().catch(error => {
    console.error(error);
    notifyBtn.disabled = false;
    if (String(error?.message || "").includes("applicationServerKey")) {
      setStatus("Clé VAPID publique invalide", "error");
    } else {
      setStatus("Activation impossible. Vérifiez la configuration et réessayez.", "error");
    }
  });
});

refreshState();
