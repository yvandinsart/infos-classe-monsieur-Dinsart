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
const setupPanel = document.getElementById("setupPanel");
const setupStep = document.getElementById("setupStep");
const setupTitle = document.getElementById("setupTitle");
const setupText = document.getElementById("setupText");
const mainContent = document.getElementById("mainContent");

const HISTORY_DB = "infos-classe-history";
const HISTORY_STORE = "notifications";
const WELCOME_SENT_KEY = "infos-classe-welcome-sent-v1";

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

function showSetupStage(stage) {
  if (stage === "install") {
    setupPanel.classList.remove("hidden");
    mainContent.classList.add("hidden");
    setupStep.textContent = "Étape 1 sur 2";
    setupTitle.textContent = "Installer Infos classe";
    setupText.textContent = "Appuyez simplement sur le bouton ci-dessous pour installer l’application sur votre téléphone.";
    installBtn.classList.remove("hidden");
    notifyBtn.classList.add("hidden");
    if (isIOS()) {
      installBtn.textContent = "Installer Infos classe sur iPhone / iPad";
      iosHelpBtn.classList.remove("hidden");
    } else if (isAndroid()) {
      installBtn.textContent = "Installer Infos classe";
      iosHelpBtn.classList.add("hidden");
    } else {
      installBtn.textContent = "Installer Infos classe";
      iosHelpBtn.classList.add("hidden");
    }
    return;
  }

  if (stage === "notifications") {
    setupPanel.classList.remove("hidden");
    mainContent.classList.add("hidden");
    setupStep.textContent = "Étape 2 sur 2";
    setupTitle.textContent = "Activer les notifications";
    setupText.textContent = "Dernière étape : appuyez sur le bouton puis autorisez les notifications lorsque votre téléphone le demande.";
    installBtn.classList.add("hidden");
    notifyBtn.classList.remove("hidden");
    iosHelpBtn.classList.add("hidden");
    return;
  }

  setupPanel.classList.add("hidden");
  mainContent.classList.remove("hidden");
  installBtn.classList.add("hidden");
  notifyBtn.classList.add("hidden");
  iosHelpBtn.classList.add("hidden");
}

function describeError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "Erreur inconnue");
  if (code === "42501" || message.toLowerCase().includes("row-level security")) return "Supabase refuse l’enregistrement (RLS).";
  if (message.includes("applicationServerKey") || message.includes("InvalidCharacterError")) return "Clé VAPID publique invalide.";
  if (message.includes("permission") || message.includes("Permission")) return "Autorisation de notification refusée par le téléphone ou le navigateur.";
  if (message.includes("push service") || message.includes("PushManager") || message.includes("InvalidStateError")) return `Abonnement push impossible : ${message}`;
  return `Activation impossible : ${message}`;
}

function updateOffline() { offline.classList.toggle("show", !navigator.onLine); }
window.addEventListener("online", updateOffline);
window.addEventListener("offline", updateOffline);
updateOffline();

iosHelpBtn.addEventListener("click", () => { if (!iosDialog.open) iosDialog.showModal(); });
document.getElementById("closeIosDialog").addEventListener("click", () => iosDialog.close());

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone()) {
    showSetupStage("install");
    setStatus("Prêt à installer", "ok");
  }
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installBtn.classList.add("hidden");
  setupStep.textContent = "Installation terminée";
  setupTitle.textContent = "Infos classe est installée";
  setupText.textContent = "Ouvrez maintenant Infos classe depuis l’icône ajoutée sur votre écran d’accueil.";
  setStatus("Installation réussie", "ok");
});

installBtn.addEventListener("click", async () => {
  if (isStandalone()) {
    showSetupStage("notifications");
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
      installBtn.classList.add("hidden");
      setupStep.textContent = "Installation en cours";
      setupTitle.textContent = "Presque terminé";
      setupText.textContent = "Une fois l’installation terminée, ouvrez Infos classe depuis l’icône sur votre écran d’accueil.";
      setStatus("Installation lancée", "ok");
    } else {
      setStatus("Installation non terminée. Appuyez à nouveau sur Installer Infos classe.", "warn");
    }
    return;
  }

  if (isAndroid()) {
    setStatus("Si la fenêtre d’installation ne s’ouvre pas, utilisez le menu du navigateur puis choisissez Installer l’application ou Ajouter à l’écran d’accueil.", "warn");
  } else {
    setStatus("Utilisez le menu de votre navigateur puis choisissez l’option permettant d’installer ou d’ajouter l’application à l’écran d’accueil.", "warn");
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
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("INVALID_PUSH_SUBSCRIPTION");
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
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expectedKey });
  }
  return subscription;
}

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

async function saveNotificationToHistory(item) {
  const db = await openHistoryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function deleteNotificationFromHistory(id) {
  const db = await openHistoryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function sendWelcomeNotificationOnce(registration) {
  if (localStorage.getItem(WELCOME_SENT_KEY) === "1") return;
  const title = "Bienvenue sur Infos classe de Monsieur Dinsart";
  const body = "Les notifications sont activées. Vous recevrez ici, lorsque cela est nécessaire, les rappels et informations utiles concernant la classe.";
  const receivedAt = Date.now();
  await saveNotificationToHistory({ id: `welcome-${receivedAt}`, title, body, receivedAt });
  await registration.showNotification(title, {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "infos-classe-welcome",
    data: { url: `${location.pathname}#notifications` }
  });
  localStorage.setItem(WELCOME_SENT_KEY, "1");
}

async function refreshState() {
  try {
    const registration = await registerServiceWorker();

    if (!isStandalone()) {
      showSetupStage("install");
      setStatus(deferredInstallPrompt ? "Prêt à installer" : "Appuyez sur Installer Infos classe", deferredInstallPrompt ? "ok" : "");
      return;
    }

    if (!("Notification" in window) || !("PushManager" in window)) {
      showSetupStage("notifications");
      setStatus("Notifications non prises en charge sur cet appareil", "warn");
      notifyBtn.disabled = true;
      return;
    }
    if (!configured()) {
      showSetupStage("notifications");
      setStatus("Application à configurer avant l’activation des notifications", "warn");
      notifyBtn.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      showSetupStage("notifications");
      setStatus("Notifications bloquées dans les réglages du téléphone ou du navigateur", "error");
      notifyBtn.disabled = true;
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === "granted") {
      subscription = await ensureCurrentSubscription(registration);
      setStatus("Synchronisation de l’abonnement…");
      await syncSubscriptionToSupabase(subscription);
      setStatus("Notifications activées", "ok");
      notifyBtn.disabled = true;
      showSetupStage("ready");
    } else {
      showSetupStage("notifications");
      setStatus("Dernière étape : activez les notifications");
      notifyBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    if (isStandalone()) showSetupStage("notifications"); else showSetupStage("install");
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
    setStatus(permission === "denied" ? "Notifications refusées. Vous pouvez les autoriser dans les réglages du téléphone." : "Notifications non activées", permission === "denied" ? "error" : "");
    notifyBtn.disabled = false;
    return;
  }
  const registration = await registerServiceWorker();
  const subscription = await ensureCurrentSubscription(registration);
  await syncSubscriptionToSupabase(subscription);
  await sendWelcomeNotificationOnce(registration);
  setStatus("Notifications activées", "ok");
  notifyBtn.disabled = true;
  showSetupStage("ready");
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
  return new Intl.DateTimeFormat("fr-BE", { dateStyle: "long", timeStyle: "short" }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
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
        <div class="history-item-top">
          <h3 class="history-item-title">${escapeHtml(item.title || "Information")}</h3>
          <button class="history-delete" type="button" data-notification-id="${escapeHtml(item.id)}" aria-label="Supprimer cette notification">Supprimer</button>
        </div>
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
  if (notificationHistory.classList.contains("hidden")) openHistory(); else closeHistory();
});
closeHistoryBtn.addEventListener("click", closeHistory);

historyList.addEventListener("click", async event => {
  const button = event.target.closest(".history-delete");
  if (!button) return;
  const id = button.dataset.notificationId;
  if (!id) return;
  const confirmed = window.confirm("Supprimer cette notification de l’historique ?");
  if (!confirmed) return;
  button.disabled = true;
  try {
    await deleteNotificationFromHistory(id);
    await renderHistory();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    window.alert("Impossible de supprimer cette notification.");
  }
});

window.addEventListener("hashchange", () => { if (location.hash === "#notifications") openHistory(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshState();
    if (!notificationHistory.classList.contains("hidden")) renderHistory();
  }
});
if (location.hash === "#notifications") setTimeout(openHistory, 250);

refreshState();