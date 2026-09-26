import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cfg = window.INFOS_CLASSE_CONFIG || {};
const loginCard = document.getElementById("loginCard");
const adminCard = document.getElementById("adminCard");
const loginForm = document.getElementById("loginForm");
const sendForm = document.getElementById("sendForm");
const loginResult = document.getElementById("loginResult");
const sendResult = document.getElementById("sendResult");
const countEl = document.getElementById("subscriberCount");

function show(element, text, cssClass = "") {
  element.textContent = text;
  element.className = `result ${cssClass}`.trim();
}

const configured = () => Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabase = configured() ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

if (!configured()) {
  show(loginResult, "Configuration Supabase manquante dans config.js.", "error");
  loginResult.classList.remove("hidden");
  loginForm.querySelector("button").disabled = true;
}

async function invoke(action, payload = {}) {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) throw new Error("SESSION_EXPIRED");

  const response = await fetch(`${cfg.SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": cfg.SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ action, ...payload })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function friendlyError(error) {
  const code = String(error?.message || "");
  if (code === "SESSION_EXPIRED" || code === "UNAUTHORIZED") return "Session expirée. Reconnectez-vous.";
  if (code === "FORBIDDEN") return "Ce compte n’est pas autorisé comme administrateur.";
  if (code === "SERVER_NOT_CONFIGURED") return "La fonction Supabase n’est pas encore complètement configurée (secrets VAPID/ADMIN_EMAIL).";
  if (code === "DATABASE_ERROR") return "Erreur d’accès à la table des abonnements.";
  if (code.startsWith("HTTP_404")) return "La fonction Supabase send-push n’est pas déployée.";
  return "Envoi impossible. Vérifiez la configuration Supabase et votre connexion.";
}

async function count() {
  try {
    const data = await invoke("stats");
    countEl.textContent = String(data.activeSubscriptions ?? 0);
  } catch (error) {
    console.error(error);
    countEl.textContent = "—";
    show(sendResult, friendlyError(error), "error");
    sendResult.classList.remove("hidden");
  }
}

function render(session) {
  const connected = Boolean(session);
  loginCard.classList.toggle("hidden", connected);
  adminCard.classList.toggle("hidden", !connected);
  if (connected) count();
}

if (supabase) {
  const { data: { session } } = await supabase.auth.getSession();
  render(session);
  supabase.auth.onAuthStateChange((_event, session) => render(session));
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;

  loginResult.classList.add("hidden");
  const button = loginForm.querySelector("button");
  button.disabled = true;

  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (error) {
    console.error(error);
    show(loginResult, "Connexion refusée. Vérifiez l’e-mail et le mot de passe.", "error");
    loginResult.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

sendForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("sendBtn");
  button.disabled = true;
  sendResult.classList.add("hidden");

  try {
    const title = document.getElementById("title").value.trim();
    const body = document.getElementById("message").value.trim();
    const data = await invoke("send", { title, body });

    const suffix = data.failed ? ` Échec : ${data.failed}.` : "";
    show(sendResult, `Notification transmise : ${data.accepted ?? 0} appareil(s).${suffix}`, data.failed ? "error" : "ok");
    sendResult.classList.remove("hidden");

    if (!data.failed) sendForm.reset();
    await count();
  } catch (error) {
    console.error(error);
    show(sendResult, friendlyError(error), "error");
    sendResult.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
});
