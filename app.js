import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cfg = window.INFOS_CLASSE_CONFIG || {};
const statusBox = document.getElementById("status");
const notifyBtn = document.getElementById("notifyBtn");
const installBtn = document.getElementById("installBtn");
const iosHelpBtn = document.getElementById("iosHelpBtn");
const iosDialog = document.getElementById("iosDialog");
const offline = document.getElementById("offline");
const historyBtn = document.getElementById("historyBtn");
const notificationHistory = document.getElementById("notificationHistory");
const historyList = document.getElementById("historyList");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");

const HISTORY_DB = "infos-classe-history";
const HISTORY_STORE = "notifications";

let deferredInstallPrompt = null;
let supabase = null;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const configured = () => Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.VAPID_PUBLIC_KEY);

function setStatus(text, cssClass = "") {
  statusBox.textContent = text;
  statusBox.className = `status modern-status ${cssClass}`.trim();
}

function describeError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "Erreur inconnue");
  if (code === "42501" || message.toLowerCase().includes("row-level security")) {
    return "Supabase refuse l’enregistrement (RLS).";
  }
  if (message.includes("applicationServerKey") || message.includes("InvalidCharacterError")) {
    return "Clé VAPID publique invalide.";
  }
  if (message.includes("permission") || message.includes("Permission")) {
    return "Autorisation de notification refusée par Android/Chrome.";
  }
  if (message.includes("push service") || message.includes("PushManager") || message.includes("InvalidStateError")) {
    return `Abonnement push impossible : ${message}`;
  }
  return `Activation impossible : ${message}`;
}

function updateOffline() {
  offline.classList.toggle("show", !navigator.onLine);
}

window.addEventListener("online", updateOffline);
window.addEventListener("offline", updateOffline);
updateOffline();

function updateInstallUi() {
  if (isStandalone()) {
    installBtn.classList.add("hidden");
    iosHelpBtn.classList.add("hidden");
    return;
  }

  installBtn.classList.remove("hidden");

  if (isIOS()) {
    installBtn.textContent = "Installer l’application sur iPhone / iPad";
    iosHelpBtn.classList.remove("hidden");
  } else if (isAndroid()) {
    installBtn.textContent = "Installer l’application sur Android";
    iosHelpBtn.classList.add("hidden");
  } else {
    installBtn.textContent = "Installer l’application sur cet appareil";
    iosHelpBtn.classList.add("hidden");
  }
}

updateInstallUi();

iosHelpBtn.addEventListener("click", () => {
  if (!iosDialog.open) iosDialog.showModal();
});
document.getElementById("closeIosDialog").addEventListener("click", () => iosDialog.close());

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallUi();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallUi();
});

installBtn.addEventListener("click", async () => {
  if (isStandalone()) {
    installBtn.classList.add("hidden");
    return;
  }

  if (isIOS()) {
    if (!iosDialog.open) iosDialog.showModal();
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice?.outcome === "accepted") {
      deferredInstallPrompt = null;
      setStatus("Installation lancée. Ouvrez ensuite Infos classe depuis votre écran d’accueil.", "ok");
    }
    return;
  }

  if (isAndroid()) {
    setStatus("Pour installer l’application, ouvrez cette page dans Chrome puis utilisez le menu ⋮ et choisissez Installer l’application ou Ajouter à l’écran d’accueil.", "warn");
  } else {
    setStatus("Utilisez le menu de votre navigateur pour installer ou ajouter cette application à l’écran d’accueil.", "warn");
  }
});

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

function sameBytes(a, b) {
  const aa = a ? new Uint8Array(a) : null;
  const bb = b ? new Uint8Array(b) : null;
  if (!aa || !bb || aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("NO_SW");
  const registration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  return registration;
}

async function endpointIdFor(subscription) {
  const endpoint = subscription?.endpoint || subscription?.toJSON?.().endpoint;
  if (!endpoint) throw new Error("INVALID_PUSH_SUBSCRIPTION");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function syncSubscriptionToSupabase(subscription) {
  if (!subscription) throw new Error("NO_PUSH_SUBSCRIPTION");
  if (!supabase) supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("INVALID_PUSH_SUBSCRIPTION");
  }

  const endpointId = await endpointIdFor(subscription);
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

async function deactivateSubscriptionInSupabase(subscription) {
  if (!subscription) return;
  if (!supabase) supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const endpointId = await endpointIdFor(subscription);
  const { error } = await supabase.from("push_subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("endpoint_id", endpointId);
  if (error) console.warn("Impossible de désactiver l'ancien abonnement", error);
}

async function ensureCurrentSubscription(registration) {
  const expectedKey = urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    const currentKey = subscription.options?.applicationServerKey;
    if (!sameBytes(currentKey, expectedKey)) {
      setStatus("Mise à jour de l’abonnement aux notifications…");
      await deactivateSubscriptionInSupabase(subscription);
      await subscription.unsubscribe();
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: expectedKey
    });
  }

  return subscription;
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
    let subscription = await registration.pushManager.getSubscription();

    if (subscription && Notification.permission === "granted") {
      subscription = await ensureCurrentSubscription(registration);
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
    setStatus(describeError(error), "error");
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
  const subscription = await ensureCurrentSubscription(registration);
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
    setStatus(describeError(error), "error");
  });
});

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
        store.createIndex("receivedAt", "receivedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readNotificationHistory() {
  const db = await openHistoryDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readonly");
    const request = tx.objectStore(HISTORY_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items.sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
}

function formatNotificationDate(timestamp) {
  if (!timestamp) return "Date inconnue";
  return new Intl.DateTimeFormat("fr-BE", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function renderHistory() {
  try {
    const items = await readNotificationHistory();
    if (!items.length) {
      historyList.innerHTML = '<div class="history-empty">Aucune notification reçue sur ce téléphone pour le moment.</div>';
      return;
    }

    historyList.innerHTML = items.map(item => `
      <article class="history-item">
        <h3 class="history-item-title">${escapeHtml(item.title || "Information")}</h3>
        <p class="history-item-body">${escapeHtml(item.body || "")}</p>
        <p class="history-item-date">${escapeHtml(formatNotificationDate(item.receivedAt))}</p>
      </article>
    `).join("");
  } catch (error) {
    console.error(error);
    historyList.innerHTML = '<div class="history-empty">Impossible de charger l’historique sur cet appareil.</div>';
  }
}

async function openHistory() {
  notificationHistory.classList.remove("hidden");
  historyBtn.setAttribute("aria-expanded", "true");
  await renderHistory();
  notificationHistory.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeHistory() {
  notificationHistory.classList.add("hidden");
  historyBtn.setAttribute("aria-expanded", "false");
  if (location.hash === "#notifications") history.replaceState(null, "", location.pathname + location.search);
}

historyBtn.setAttribute("aria-expanded", "false");
historyBtn.addEventListener("click", () => {
  if (notificationHistory.classList.contains("hidden")) {
    openHistory();
  } else {
    closeHistory();
  }
});
closeHistoryBtn.addEventListener("click", closeHistory);

window.addEventListener("hashchange", () => {
  if (location.hash === "#notifications") openHistory();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !notificationHistory.classList.contains("hidden")) renderHistory();
});

if (location.hash === "#notifications") {
  setTimeout(openHistory, 250);
}

refreshState();
