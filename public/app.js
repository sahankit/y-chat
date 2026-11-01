"use strict";

const EMOTE_LIST = [":)", ":D", ";)", ":P", ":O", ":(", "<3"];
const EMOTE_MAP = {
  ":'(": "😢",
  ":')": "😂",
  ":-d": "😃",
  ":d": "😃",
  ":-)": "🙂",
  ":)": "🙂",
  ":-(": "🙁",
  ":(": "🙁",
  ";-)": "😉",
  ";)": "😉",
  ":-p": "😛",
  ":p": "😛",
  ":-o": "😮",
  ":o": "😮",
  "b)": "😎",
  "<3": "❤️",
};
const EMOTE_RE = /:'\(|:'\)|:-d|:d|:-\)|:\)|:-\(|:\(|;-\)|;\)|:-p|:p|:-o|:o|b\)|<3/gi;
const NICK_COLORS = ["#f07167", "#7c6cf0", "#2a9d8f", "#e9a23b", "#e36ba8", "#4c8dff", "#8b6cff"];
const CAT_MARK = { All: "✦", Friends: "♡", Music: "♪", Sports: "⚑", Tech: "✎", Random: "✿" };
const MAX_OPEN_IMS = 3;

const LIVE_KEY = "ychat-live";

let ychatConfig = { wsUrl: "", healthUrl: "" };
let relayConfigLoaded = false;
let configReady = Promise.resolve();

function ensureRelayConfig() {
  return configReady;
}

function relayWsConfigured() {
  const raw = String(ychatConfig.wsUrl || "").trim();
  if (raw) return true;
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

function setGateFormsWaiting(on) {
  for (const button of document.querySelectorAll("#gate-entry button[type=submit]")) {
    button.disabled = on || $("gate-card").classList.contains("busy");
  }
}

const state = {
  ws: null,
  me: null,
  auth: null,
  view: "lobby",
  category: "All",
  categories: ["Friends", "Music", "Sports", "Tech", "Random"],
  rooms: [],
  online: [],
  buddies: [],
  room: null,
  roomLog: [],
  resumeRoomId: null,
  reconnecting: false,
  reconnectTimer: null,
  peopleTab: "online",
  ignored: new Set(),
  ims: {},
  sound: true,
  audio: null,
  manualClose: false,
  seenOnline: false,
  connError: false,
  ads: null,
  resumeToken: "",
  pendingPlace: null,
  restorePane: "",
  leaving: false,
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = value;
    else if (value != null) node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function nickColor(nick) {
  let hash = 0;
  for (const char of nick) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return NICK_COLORS[hash % NICK_COLORS.length];
}

function hereLabel(count) {
  if (!count) return "Nobody here yet";
  if (count === 1) return "1 person here";
  return `${count} people here`;
}

function face(person, { status = true } = {}) {
  const nick = person.nick || "?";
  return el("span", { class: "face" },
    el("span", {
      class: "avatar",
      style: `background:${nickColor(nick)}`,
      "aria-hidden": "true",
    }, nick.slice(0, 1).toUpperCase()),
    status ? el("span", { class: `dot ${person.status || "offline"}`, title: person.status || "offline" }) : null);
}

function formatTime(at) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fillEmote(node, text) {
  const source = String(text);
  let last = 0;
  for (const match of source.matchAll(EMOTE_RE)) {
    if (match.index > last) node.append(document.createTextNode(source.slice(last, match.index)));
    const token = match[0];
    node.append(el("span", { class: "emote", title: token }, EMOTE_MAP[token.toLowerCase()] || token));
    last = match.index + token.length;
  }
  if (last < source.length) node.append(document.createTextNode(source.slice(last)));
}

function wsUrl() {
  const raw = String(ychatConfig.wsUrl || "").trim();
  if (raw) return raw.replace(/^http/i, "ws");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

function healthUrl() {
  const raw = String(ychatConfig.healthUrl || "").trim();
  if (raw) return raw;
  const base = wsUrl().replace(/^wss/i, "https").replace(/^ws/i, "http");
  return `${base.replace(/\/$/, "")}/health`;
}

function normalizeRelayConfig() {
  const h = location.hostname;
  const loopback = h === "localhost" || h === "127.0.0.1";
  if (loopback) {
    if (!String(ychatConfig.wsUrl || "").trim()) {
      ychatConfig.wsUrl = `ws://${h}:4317`;
    }
    if (!String(ychatConfig.healthUrl || "").trim()) {
      ychatConfig.healthUrl = `http://${h}:4317/health`;
    }
    for (const key of ["wsUrl", "healthUrl"]) {
      const value = String(ychatConfig[key] || "");
      if (!value) continue;
      ychatConfig[key] = value
        .replace(/\/\/127\.0\.0\.1(?=:\d+|\/|$)/i, `//${h}`)
        .replace(/\/\/localhost(?=:\d+|\/|$)/i, `//${h}`);
    }
  }
}

function buildBuddiesFromLocal() {
  if (!window.YchatProfile || !state.me || !YchatProfile.isSignedInNick(state.me.nick)) return [];
  return YchatProfile.getBuddies().map((key) => {
    const online = state.online.find((user) => user.nick.toLowerCase() === key);
    if (online) return online;
    const saved = YchatProfile.profileForNick(key);
    return {
      nick: saved ? saved.nick : key,
      status: "offline",
      statusMessage: saved ? saved.statusMessage || "" : "",
      guest: false,
      bot: false,
      roomId: null,
      roomName: null,
    };
  });
}

function syncLocalProfile() {
  if (!window.YchatProfile || !state.me) return;
  if (!YchatProfile.isSignedInNick(state.me.nick)) {
    state.me.guest = true;
    state.buddies = [];
    return;
  }
  state.me.guest = false;
  state.buddies = buildBuddiesFromLocal();
  const savedStatus = YchatProfile.statusMessageForActive();
  if (savedStatus) {
    state.me.statusMessage = savedStatus;
    $("status-message").value = savedStatus;
  }
}

function send(obj) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    toast(state.reconnecting ? "Reconnecting… this chat stays in the tab." : "You're disconnected.");
    return;
  }
  state.ws.send(JSON.stringify(obj));
}

function showReconnect(on) {
  const node = $("reconnect");
  if (node) node.hidden = !on;
}

function stopReconnect() {
  state.reconnecting = false;
  if (state.reconnectTimer) clearInterval(state.reconnectTimer);
  state.reconnectTimer = null;
  showReconnect(false);
}

function savePlace() {
  if (!state.me || !state.resumeToken) return;
  const talks = Object.values(state.ims)
    .filter((im) => im.open)
    .map((im) => ({
      nick: im.nick,
      minimized: !!im.minimized,
      openedAt: im.openedAt || 0,
    }));
  const payload = {
    token: state.resumeToken,
    nick: state.me.nick,
    guest: !!state.me.guest,
    roomId: (state.room && state.room.id) || null,
    talks,
    category: state.category,
    pane: state.pane || (state.room ? "chat" : "rooms"),
    ignored: [...state.ignored],
  };
  try { sessionStorage.setItem(LIVE_KEY, JSON.stringify(payload)); } catch { /* private mode */ }
}

function rememberLive() {
  savePlace();
}

function clearLive() {
  state.resumeToken = "";
  state.pendingPlace = null;
  try { sessionStorage.removeItem(LIVE_KEY); } catch { /* ignore */ }
}

function readPlace() {
  try {
    const data = JSON.parse(sessionStorage.getItem(LIVE_KEY) || "null");
    if (!data || typeof data.nick !== "string" || !/^[a-f0-9]{32}$/.test(data.token || "")) return null;
    return data;
  } catch {
    return null;
  }
}

function toast(message) {
  const node = el("div", { class: "toast" }, message);
  $("toasts").append(node);
  setTimeout(() => node.remove(), 3400);
}

function setGateError(message) {
  const node = $("gate-error");
  if (!message) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = message;
}

function setBusy(on) {
  $("gate-card").classList.toggle("busy", on);
  for (const button of document.querySelectorAll("#gate button[type=submit]")) {
    if (button.id === "legal-accept") {
      button.disabled = on || !$("legal-check").checked;
      continue;
    }
    button.disabled = on;
  }
  if (!on && relayConfigLoaded && legalAccepted()) setGateFormsWaiting(false);
}

function setIndexed(on) {
  const node = document.querySelector('meta[name="robots"]');
  if (!node) return;
  node.setAttribute("content", on ? "index, follow, max-image-preview:large" : "noindex");
}

function setChatUi(inChat) {
  document.body.classList.toggle("in-chat", inChat);
}

function showGate(mode, message) {
  stopReconnect();
  setIndexed(true);
  state.me = null;
  state.auth = null;
  state.view = "lobby";
  state.room = null;
  state.roomLog = [];
  state.resumeRoomId = null;
  state.ims = {};
  state.ignored = new Set();
  state.seenOnline = false;
  state.resumeToken = "";
  clearLive();
  $("dock").replaceChildren();
  $("shell").hidden = true;
  $("gate").hidden = false;
  setChatUi(false);
  setGateMode(mode || "guest");
  setGateError(message || "");
  setBusy(false);
  document.title = "Free Yahoo-Style Chat Rooms & Messenger — Y-Chat";
}

function setGateMode(mode) {
  for (const button of document.querySelectorAll("[data-gate]")) {
    const on = button.dataset.gate === mode;
    button.classList.toggle("on", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  }
  $("form-guest").hidden = mode !== "guest";
  $("form-login").hidden = mode !== "login";
  $("form-register").hidden = mode !== "register";
  const field = document.querySelector(`#form-${mode} input`);
  if (field && !$("gate-entry").hidden) field.focus();
}

const LEGAL_KEY = "ychat-legal";
const LEGAL_VERSION = "3";
let legalThisVisit = false;

function legalAccepted() {
  if (legalThisVisit) return true;
  try {
    return localStorage.getItem(LEGAL_KEY) === LEGAL_VERSION;
  } catch {
    return false;
  }
}

function applyLegalGate() {
  const pending = !legalAccepted();
  document.documentElement.classList.toggle("legal-ok", !pending);
  $("legal-gate").hidden = !pending;
  $("gate-entry").hidden = pending;
  if (pending) return;
  if (window.startYchatAds) window.startYchatAds();
  setupAds();
  if (window.startYchatAnalytics) window.startYchatAnalytics();
  if (!relayConfigLoaded) setGateFormsWaiting(true);
  else maybeAutoResume();
}

function maybeAutoResume() {
  if (!legalAccepted() || state.me || state.pendingPlace) return;
  const place = readPlace();
  if (place) {
    state.pendingPlace = place;
    connect({ type: "resume", token: place.token });
    return;
  }
  const field = document.querySelector("#gate-entry form:not([hidden]) input");
  if (field && !$("gate").hidden) field.focus();
}

function acceptLegal() {
  if (!$("legal-check").checked) return;
  legalThisVisit = true;
  try {
    localStorage.setItem(LEGAL_KEY, LEGAL_VERSION);
  } catch {
    /* Private mode still gets this visit. The next visit asks again. */
  }
  applyLegalGate();
}

function connect(payload, { resume = false } = {}) {
  if (!legalAccepted()) {
    applyLegalGate();
    setBusy(false);
    setGateError("Confirm you are 18+ and accept the Terms (including Open Chat Policy) and Privacy Policy to come in.");
    return;
  }
  ensureRelayConfig().then(() => {
    if (!relayWsConfigured()) {
      setGateError("Chat relay URL is missing — check public/config.json (wsUrl and healthUrl).");
      setBusy(false);
      markRelayPill(false, "missing-config");
      return;
    }
    openWebSocket(payload, { resume });
  });
}

function gateConnectError(event, connError) {
  const reason = String(event && event.reason ? event.reason : "").toLowerCase();
  if (reason.includes("origin") || (event && event.code === 1008)) {
    return "This website is not allowed to use the chat relay. The operator must add this site to ALLOWED_ORIGINS.";
  }
  if (event && event.code === 1013) return "The chat server is full. Try again in a minute.";
  if (connError) return "Can't reach the chat server — check config.json wsUrl or your network.";
  return "Disconnected before you got in.";
}

function openWebSocket(payload, { resume = false } = {}) {
  if (!resume) {
    setBusy(true);
    setGateError("");
  }
  state.manualClose = false;
  state.connError = false;
  state.auth = payload;
  const previous = state.ws;
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  if (previous && previous !== ws && previous.readyState !== WebSocket.CLOSED) previous.close();
  ws.addEventListener("open", () => {
    if (state.ws === ws) ws.send(JSON.stringify(payload));
  });
  ws.addEventListener("message", (event) => {
    if (state.ws !== ws) return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    onMessage(msg);
  });
  ws.addEventListener("error", () => {
    if (state.ws === ws) state.connError = true;
  });
  ws.addEventListener("close", (event) => {
    if (state.ws !== ws) return;
    const manual = state.manualClose;
    state.manualClose = false;
    if (manual || state.leaving) return;
    if (!state.me || !state.auth) {
      setGateError(gateConnectError(event, state.connError));
      setBusy(false);
      markRelayPill(false, "ws-failed");
      return;
    }
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (state.reconnecting || !state.me || !state.auth) return;
  state.reconnecting = true;
  if (state.room) state.resumeRoomId = state.room.id;
  rememberLive();
  showReconnect(true);
  let tries = 0;
  const kick = () => {
    if (!state.reconnecting) return;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    tries += 1;
    if (tries > 30) {
      const mode = state.me && state.me.guest ? "guest" : "login";
      const nick = state.me && state.me.nick;
      showGate(mode, "Disconnected. Join again to hop back in.");
      const input = mode === "guest" ? $("guest-nick") : $("login-name");
      if (input && nick) input.value = nick;
      return;
    }
    connect(state.auth, { resume: true });
  };
  kick();
  state.reconnectTimer = setInterval(kick, 1500);
}

function onMessage(msg) {
  switch (msg.type) {
    case "hello": return state.reconnecting ? resumeHello(msg) : applyHello(msg);
    case "error": return onError(msg.message);
    case "notice": return toast(msg.message);
    case "online": return applyOnline(msg.users || []);
    case "rooms": return applyRooms(msg.rooms || []);
    case "buddies":
      syncLocalProfile();
      renderPeople();
      return;
    case "me":
      state.me = { ...state.me, ...msg.user };
      $("me-name").textContent = meLabel();
      return;
    case "room": return enterRoom(msg);
    case "said": return onSaid(msg);
    case "left": return showLobby();
    case "pm": return onPm(msg);
    default: break;
  }
}

function onError(message) {
  if (state.reconnecting && state.me) {
    const mode = state.me.guest ? "guest" : "login";
    const nick = state.me.nick;
    state.manualClose = true;
    if (state.ws) state.ws.close();
    showGate(mode, message);
    const input = mode === "guest" ? $("guest-nick") : $("login-name");
    if (input && nick) input.value = nick;
    return;
  }
  if (!state.me) {
    const nick = state.pendingPlace && state.pendingPlace.nick;
    setGateError(message);
    setBusy(false);
    state.manualClose = true;
    if (state.ws) state.ws.close();
    if (nick) {
      $("guest-nick").value = nick;
      $("login-name").value = nick;
    }
    return;
  }
  toast(message);
}

function meLabel() {
  return state.me.guest ? `${state.me.nick} · guest` : state.me.nick;
}

function setReconnectAuth() {
  if (!state.resumeToken) return;
  state.auth = { type: "resume", token: state.resumeToken };
}

function restoreIgnored(keys) {
  if (!Array.isArray(keys)) return;
  state.ignored = new Set(
    keys.filter((item) => typeof item === "string").map((item) => item.toLowerCase()),
  );
  for (const key of state.ignored) send({ type: "ignore", nick: key });
}

function restoreIgnoredFromPlace(place) {
  if (!place || !Array.isArray(place.ignored)) return;
  restoreIgnored(place.ignored);
}

function restoreTalks(talks) {
  const list = Array.isArray(talks) ? talks : [];
  let newest = null;
  for (const talk of list) {
    if (!talk || typeof talk.nick !== "string" || !/^[A-Za-z][A-Za-z0-9_]{1,15}$/.test(talk.nick)) continue;
    if (talk.nick.toLowerCase() === state.me.nick.toLowerCase()) continue;
    const im = ensureIm(talk.nick);
    im.open = true;
    im.minimized = !!talk.minimized;
    im.lines = [];
    im.unread = 0;
    im.openedAt = Number(talk.openedAt) || Date.now();
    if (!newest || im.openedAt >= newest.openedAt) newest = im;
  }
  if (newest) constrainOpen(newest.key);
  renderDock();
  updateTitle();
}

function applyHello(msg) {
  const place = state.pendingPlace;
  const same = !!(place && place.nick && place.nick.toLowerCase() === msg.user.nick.toLowerCase());
  stopReconnect();
  state.me = msg.user;
  state.resumeToken = typeof msg.resume === "string" ? msg.resume : "";
  setReconnectAuth();
  state.categories = msg.categories || state.categories;
  state.rooms = msg.rooms || [];
  state.online = msg.users || [];
  state.seenOnline = true;
  syncLocalProfile();
  state.view = "lobby";
  state.room = null;
  state.roomLog = [];
  state.resumeRoomId = null;
  state.peopleTab = state.me.guest ? "online" : "buddies";
  state.ignored = new Set();
  state.ims = {};
  state.pendingPlace = null;
  $("gate").hidden = true;
  $("shell").hidden = false;
  setChatUi(true);
  setIndexed(false);
  $("me-name").textContent = meLabel();
  $("status").value = msg.user.status || "available";
  $("status-message").value = msg.user.statusMessage || "";
  $("place").textContent = "Lobby";
  $("dock").replaceChildren();
  setBusy(false);
  localStorage.setItem("ychat-nick", msg.user.nick);
  renderCats();
  renderPeople();
  if (same && place.category) state.category = place.category;
  if (same) restoreTalks(place.talks);
  if (same) restoreIgnoredFromPlace(place);
  if (same && place.roomId && state.rooms.some((room) => room.id === place.roomId)) {
    state.restorePane = place.pane === "people" ? "people" : "chat";
    send({ type: "joinRoom", roomId: place.roomId, resume: true });
    savePlace();
    return;
  }
  applyPane(same && place.pane === "people" ? "people" : "rooms");
  renderLobby(true);
  savePlace();
  const roomInput = $("stage").querySelector(".composer input");
  if (roomInput && !isPhone()) roomInput.focus();
}

function resumeHello(msg) {
  const roomId = state.resumeRoomId;
  stopReconnect();
  state.me = { ...state.me, ...msg.user };
  if (typeof msg.resume === "string" && msg.resume) {
    state.resumeToken = msg.resume;
    setReconnectAuth();
  }
  state.categories = msg.categories || state.categories;
  state.rooms = msg.rooms || [];
  state.online = msg.users || [];
  state.seenOnline = true;
  syncLocalProfile();
  $("gate").hidden = true;
  $("shell").hidden = false;
  setChatUi(true);
  setIndexed(false);
  $("me-name").textContent = meLabel();
  setBusy(false);
  renderCats();
  renderPeople();
  renderDock();
  for (const key of state.ignored) send({ type: "ignore", nick: key });
  send({
    type: "setStatus",
    status: $("status").value,
    statusMessage: $("status-message").value,
  });
  if (roomId && state.rooms.some((room) => room.id === roomId)) {
    state.resumeRoomId = roomId;
    send({ type: "joinRoom", roomId, resume: true });
  } else {
    state.resumeRoomId = null;
    state.roomLog = [];
    showLobby();
  }
  rememberLive();
}

function applyOnline(users) {
  const previous = new Set(state.online.map((user) => user.nick.toLowerCase()));
  state.online = users;
  if (state.seenOnline && state.me && !state.me.guest) {
    for (const user of users) {
      const key = user.nick.toLowerCase();
      if (previous.has(key) || key === state.me.nick.toLowerCase()) continue;
      if (state.buddies.some((buddy) => buddy.nick.toLowerCase() === key)) toast(`${user.nick} is online`);
    }
  }
  state.seenOnline = true;
  if (state.me && window.YchatProfile && YchatProfile.isSignedInNick(state.me.nick)) {
    state.buddies = buildBuddiesFromLocal();
  }
  renderPeople();
  if (state.view === "room") renderRoster();
  refreshImHeaders();
}

function applyRooms(rooms) {
  state.rooms = rooms;
  renderCats();
  if (state.view === "lobby") renderRoomList();
  const count = $("room-count");
  if (count && state.room) {
    const fresh = rooms.find((room) => room.id === state.room.id);
    if (fresh) {
      state.room.count = fresh.count;
      count.textContent = hereLabel(fresh.count);
    }
  }
}

function renderCats() {
  const nav = $("cats");
  const cats = ["All", ...state.categories];
  nav.replaceChildren(el("div", { class: "panel-h" }, "Pick a category"));
  for (const cat of cats) {
    const count = cat === "All"
      ? state.rooms.length
      : state.rooms.filter((room) => room.category === cat).length;
    nav.append(el("button", {
      type: "button",
      class: state.category === cat ? "cat on" : "cat",
      "data-action": "category",
      "data-cat": cat,
    },
    el("span", { class: "cat-mark", "aria-hidden": "true" }, CAT_MARK[cat] || "•"),
    el("span", { class: "cat-label" }, cat),
    el("span", { class: "cat-count" }, String(count))));
  }
}

let adsScript = null;

function adSlotId(name) {
  const id = state.ads && state.ads.slots && state.ads.slots[name];
  return typeof id === "string" && /^\d+$/.test(id) ? id : "";
}

function ensureAdsScript(client) {
  const existing = document.querySelector(
    `script[src*="adsbygoogle.js"][src*="${encodeURIComponent(client)}"]`,
  );
  if (existing) return Promise.resolve();
  if (adsScript) return adsScript;
  adsScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.dataset.adsense = client;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("adsense")));
    document.head.appendChild(script);
  });
  return adsScript;
}

function fillAd(host, name) {
  const slot = adSlotId(name);
  if (!host || !state.ads || !slot) return false;
  const ins = el("ins", {
    class: "adsbygoogle",
    style: "display:block",
    "data-ad-client": state.ads.client,
    "data-ad-slot": slot,
    "data-ad-format": "auto",
    "data-full-width-responsive": "true",
  });
  host.replaceChildren(el("p", { class: "ad-label" }, "Advertisement"), ins);
  host.hidden = false;
  ensureAdsScript(state.ads.client).then(() => {
    if (!ins.isConnected || ins.dataset.adsbygoogleStatus) return;
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* already filled */ }
  }).catch(() => { host.hidden = true; });
  return true;
}

function adBox(name) {
  if (!adSlotId(name)) return null;
  const host = el("aside", { class: "ad-slot", "aria-label": "Advertisement" });
  fillAd(host, name);
  return host;
}

function setupAds() {
  fetch(new URL("ads.json", location.href).href)
    .then((res) => (res.ok ? res.json() : null))
    .then((cfg) => {
      if (!cfg || !/^ca-pub-\d+$/.test(String(cfg.client || ""))) return;
      state.ads = { client: cfg.client, slots: cfg.slots || {} };
      fillAd($("ad-welcome"), "welcome");
    })
    .catch(() => {});
}

function renderLobby(force) {
  const stage = $("stage");
  if (!force && stage.dataset.mode === "lobby" && $("room-list")) {
    renderRoomList();
    return;
  }
  state.view = "lobby";
  stage.dataset.mode = "lobby";
  stage.replaceChildren(...[
    adBox("rooms"),
    el("div", { class: "lobby-intro" },
      el("h2", {}, `Welcome, ${state.me.nick}!`),
      el("p", {}, "Tap a room to join the conversation. Want a private chat? Open someone from Who's here."),
      el("p", { class: "fine" }, "Rooms you create stay until the server restarts — the built-in rooms always come back.")),
    el("div", { class: "lobby-tools" },
      el("button", { type: "button", class: "primary", "data-action": "toggle-create" }, "+ New room")),
    el("form", { id: "create-form", hidden: "" },
      el("label", { for: "room-name" }, "Room name"),
      el("input", { id: "room-name", maxlength: "32", placeholder: "Night owls" }),
      el("label", { for: "room-cat" }, "Category"),
      el("select", { id: "room-cat" }, ...state.categories.map((cat) => el("option", { value: cat }, cat))),
      el("label", { for: "room-topic" }, "Topic"),
      el("input", { id: "room-topic", maxlength: "80", placeholder: "What is this room about?" }),
      el("div", { class: "row" },
        el("button", { type: "submit", class: "primary" }, "Create & join"))),
    el("div", { id: "room-list", class: "room-list" }),
  ].filter(Boolean));
  $("create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = $("room-name").value.trim();
    if (name.length < 2) {
      toast("Give the room a name, at least 2 characters.");
      return;
    }
    send({
      type: "createRoom",
      name,
      category: $("room-cat").value,
      topic: $("room-topic").value.trim(),
    });
  });
  renderRoomList();
}

function renderRoomList() {
  const host = $("room-list");
  if (!host) return;
  host.replaceChildren();
  const rooms = state.rooms.filter((room) => state.category === "All" || room.category === state.category);
  if (!rooms.length) {
    host.append(el("p", { class: "empty" }, "Nothing here yet — be the first to start a room!"));
    return;
  }
  const groups = state.category === "All" ? state.categories : [state.category];
  for (const cat of groups) {
    const group = rooms
      .filter((room) => room.category === cat)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    if (!group.length) continue;
    if (state.category === "All") host.append(el("h3", { class: "group" }, cat));
    for (const room of group) host.append(roomButton(room));
  }
}

function roomButton(room) {
  return el("button", {
    type: "button",
    class: `room cat-${room.category.toLowerCase()}`,
    "data-action": "join",
    "data-id": room.id,
  },
  el("span", { class: "room-mark", "aria-hidden": "true" }, CAT_MARK[room.category] || "•"),
  el("span", { class: "room-copy" },
    el("span", { class: "room-top" },
      el("span", { class: "room-name" }, room.name),
      el("span", { class: room.count ? "count hot" : "count" }, room.count ? `${room.count} chatting` : "be first")),
    el("span", { class: "topic" }, room.topic)));
}

function showLobby() {
  state.view = "lobby";
  state.room = null;
  state.roomLog = [];
  state.resumeRoomId = null;
  $("place").textContent = "Lobby";
  const me = state.online.find((user) => user.nick.toLowerCase() === state.me.nick.toLowerCase());
  if (me) {
    me.roomId = null;
    me.roomName = null;
  }
  renderCats();
  renderLobby(false);
  renderPeople();
  applyPane("rooms");
  rememberLive();
}

function goLobby(category) {
  if (category) state.category = category;
  const inRoom = state.view === "room";
  showLobby();
  if (inRoom) send({ type: "leaveRoom" });
}

function enterRoom(msg) {
  const keepLog = state.resumeRoomId && state.resumeRoomId === msg.room.id;
  state.resumeRoomId = null;
  if (!keepLog) state.roomLog = [];
  state.view = "room";
  state.room = msg.room;
  for (const member of msg.members || []) {
    const found = state.online.find((user) => user.nick.toLowerCase() === member.nick.toLowerCase());
    if (found) {
      found.roomId = member.roomId;
      found.roomName = member.roomName;
      found.status = member.status;
      found.statusMessage = member.statusMessage;
    } else {
      state.online.push(member);
    }
  }
  $("place").textContent = msg.room.name;
  if (keepLog && $("transcript")) {
    const count = $("room-count");
    if (count) count.textContent = hereLabel(msg.room.count);
    renderRoster();
    renderPeople();
    applyPane(state.pane || "chat");
    rememberLive();
    return;
  }
  const stage = $("stage");
  stage.dataset.mode = "room";
  stage.replaceChildren(el("div", { class: "room-layout" },
    el("div", { class: "room-head" },
      el("div", {},
        el("h2", {}, msg.room.name),
        el("p", {}, msg.room.topic || ""),
        el("p", { id: "room-count" }, hereLabel(msg.room.count))),
      el("button", { type: "button", class: "ghost back", "data-action": "home" }, "All rooms")),
    el("div", { id: "transcript", class: "transcript" }),
    el("aside", { class: "roster" },
      el("h3", {}, "Here with you"),
      el("div", { id: "roster-list" })),
    el("form", { id: "composer", class: "composer" },
      el("div", { class: "emotes" }, ...EMOTE_LIST.map((token) => el("button", {
        type: "button",
        "data-action": "emote",
        "data-token": token,
        title: token,
      }, EMOTE_MAP[token.toLowerCase()] || token))),
      el("div", { class: "composer-row" },
        el("input", { id: "say", maxlength: "500", placeholder: "Type a message…", autocomplete: "off" }),
        el("button", { class: "primary", type: "submit" }, "Send")))));
  const log = $("transcript");
  for (const message of state.roomLog) log.append(lineEl(message));
  log.scrollTop = log.scrollHeight;
  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("say");
    const text = input.value.trim();
    if (!text) return;
    send({ type: "say", text });
    input.value = "";
    resumeAudio();
  });
  renderRoster();
  renderPeople();
  applyPane(state.restorePane === "people" ? "people" : "chat");
  state.restorePane = "";
  rememberLive();
  if (!isPhone() && state.pane !== "people") $("say").focus();
}

function isPhone() {
  return window.matchMedia("(max-width: 860px)").matches;
}

function applyPane(pane) {
  state.pane = pane;
  const shell = $("shell");
  if (shell) shell.dataset.pane = pane;
  for (const button of document.querySelectorAll(".mobile-nav [data-pane]")) {
    const on = button.dataset.pane === pane;
    button.classList.toggle("on", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function setPane(pane) {
  if (pane === "rooms" && state.view === "room") {
    goLobby();
    return;
  }
  if (pane === "chat" && state.view !== "room") {
    toast("Choose a room first — then open the Chat tab.");
    pane = "rooms";
  }
  applyPane(pane);
}

function lineEl(message) {
  if (message.system) return el("div", { class: "line system" }, message.text);
  const mine = state.me && message.nick.toLowerCase() === state.me.nick.toLowerCase();
  const bubble = el("div", { class: "bubble" },
    mine ? null : el("button", {
      type: "button",
      class: "who",
      style: `color:${nickColor(message.nick)}`,
      "data-action": "open-im",
      "data-nick": message.nick,
    }, message.nick),
    el("span", { class: "msg" }),
    el("time", { datetime: new Date(message.at).toISOString() }, formatTime(message.at)));
  fillEmote(bubble.querySelector(".msg"), message.text);
  return el("div", {
    class: mine ? "line me" : "line",
    "data-from": message.nick.toLowerCase(),
  }, mine ? null : face({ nick: message.nick }, { status: false }), bubble);
}

function onSaid(msg) {
  if (!state.room || msg.roomId !== state.room.id) return;
  const message = msg.message;
  if (!message.system && message.nick && state.ignored.has(message.nick.toLowerCase())) return;
  state.roomLog.push(message);
  if (state.roomLog.length > 80) state.roomLog.shift();
  rememberLive();
  const log = $("transcript");
  if (!log) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  log.append(lineEl(message));
  if (stick) log.scrollTop = log.scrollHeight;
  if (!message.system && state.me && message.nick.toLowerCase() !== state.me.nick.toLowerCase()) {
    if (message.text.toLowerCase().includes(state.me.nick.toLowerCase())) chime();
  }
}

function renderRoster() {
  const host = $("roster-list");
  if (!host || !state.room) return;
  let members = state.online.filter((user) => user.roomId === state.room.id);
  if (state.me && !members.some((user) => user.nick.toLowerCase() === state.me.nick.toLowerCase())) {
    members = [{
      nick: state.me.nick,
      status: state.me.status,
      statusMessage: state.me.statusMessage,
      guest: state.me.guest,
      roomId: state.room.id,
      roomName: state.room.name,
    }, ...members];
  }
  host.replaceChildren();
  for (const member of sortPeople(members)) host.append(rosterRow(member));
}

function rosterRow(person) {
  const self = person.nick.toLowerCase() === state.me.nick.toLowerCase();
  return el("div", { class: "roster-row" },
    el("button", {
      type: "button",
      class: "who-row",
      "data-action": self ? "self" : "open-im",
      "data-nick": person.nick,
    },
    face(person),
    el("span", { class: "who-text" },
      el("span", { class: "person-name" },
        person.nick,
        self ? " (you)" : "",
        person.guest ? el("span", { class: "tag" }, "guest") : null,
        person.bot ? el("span", { class: "tag" }, "bot") : null),
      el("span", { class: "meta" }, person.statusMessage || person.status))));
}

function sortPeople(list) {
  const rank = { available: 0, away: 1, busy: 2, offline: 3 };
  return [...list].sort((a, b) => {
    if (!!a.bot !== !!b.bot) return a.bot ? -1 : 1;
    const selfA = a.nick.toLowerCase() === state.me.nick.toLowerCase();
    const selfB = b.nick.toLowerCase() === state.me.nick.toLowerCase();
    if (selfA !== selfB) return selfA ? -1 : 1;
    const byStatus = (rank[a.status] ?? 4) - (rank[b.status] ?? 4);
    if (byStatus) return byStatus;
    return a.nick.localeCompare(b.nick);
  });
}

function renderPeople() {
  const onlineBtn = document.querySelector('[data-tab="online"]');
  const buddyBtn = document.querySelector('[data-tab="buddies"]');
  if (onlineBtn) onlineBtn.textContent = `Online (${state.online.length})`;
  if (onlineBtn) onlineBtn.classList.toggle("on", state.peopleTab === "online");
  if (buddyBtn) buddyBtn.classList.toggle("on", state.peopleTab === "buddies");
  const host = $("people");
  const note = $("people-note");
  const form = $("add-buddy");
  host.replaceChildren();
  if (state.peopleTab === "buddies") {
    form.hidden = !state.me || state.me.guest;
    if (!state.me || state.me.guest) {
      note.textContent = "Buddies stay in this browser once you sign in to a saved profile. As a guest, anyone online is one tap away.";
      return;
    }
    note.textContent = state.buddies.length
      ? "Tap a buddy for a private chat. Offline names wait here."
      : "No buddies yet. Add someone by nickname.";
    for (const buddy of sortPeople(state.buddies)) {
      host.append(personRow(buddy, { removable: true }));
    }
    return;
  }
  form.hidden = true;
  note.textContent = state.me && state.me.guest
    ? "You're visiting. People can message you until you head out."
    : "Everyone hanging out right now.";
  const list = state.online.filter((user) => user.nick.toLowerCase() !== state.me.nick.toLowerCase());
  if (!list.length) {
    host.append(el("p", { class: "empty" }, "It's just you and the quiet. Open another window and wander in as a guest."));
    return;
  }
  for (const person of sortPeople(list)) host.append(personRow(person));
}

function personRow(person, { removable = false } = {}) {
  const offline = person.status === "offline";
  return el("div", { class: offline ? "person offline" : "person" },
    el("button", {
      type: "button",
      class: "person-main",
      "data-action": "open-im",
      "data-nick": person.nick,
    },
    face(person),
    el("span", { class: "person-text" },
      el("span", { class: "person-name" },
        person.nick,
        person.guest ? el("span", { class: "tag" }, "guest") : null,
        person.bot ? el("span", { class: "tag" }, "bot") : null),
      el("span", { class: "meta" }, personMeta(person)))),
    removable ? el("button", {
      type: "button",
      class: "texty",
      "data-action": "remove-buddy",
      "data-nick": person.nick,
    }, "Remove") : null);
}

function personMeta(person) {
  if (person.status === "offline") return person.statusMessage || "Offline";
  return [person.roomName || "In the lobby", person.statusMessage].filter(Boolean).join(" · ");
}

function ensureIm(nick) {
  const key = nick.toLowerCase();
  if (!state.ims[key]) {
    state.ims[key] = {
      key,
      nick,
      open: false,
      minimized: false,
      unread: 0,
      lines: [],
      openedAt: 0,
    };
  } else {
    state.ims[key].nick = nick;
  }
  return state.ims[key];
}

function openIm(nick, { focus = true } = {}) {
  if (!nick || nick.toLowerCase() === state.me.nick.toLowerCase()) return;
  const person = personByNick(nick);
  if (person.status === "offline" && !state.ims[nick.toLowerCase()]) {
    toast(`${person.nick} is offline.`);
    return;
  }
  const im = ensureIm(person.nick || nick);
  im.open = true;
  im.minimized = false;
  im.unread = 0;
  im.openedAt = Date.now();
  constrainOpen(im.key);
  renderDock();
  updateTitle();
  rememberLive();
  if (focus) {
    requestAnimationFrame(() => {
      const input = document.querySelector(`.im-window[data-key="${CSS.escape(im.key)}"] .im-input`);
      if (input) input.focus();
    });
  }
}

function constrainOpen(keepKey) {
  const limit = isPhone() ? 1 : MAX_OPEN_IMS;
  const open = Object.values(state.ims).filter((im) => im.open && !im.minimized);
  if (open.length <= limit) return;
  open
    .filter((im) => im.key !== keepKey)
    .sort((a, b) => a.openedAt - b.openedAt)
    .slice(0, open.length - limit)
    .forEach((im) => { im.minimized = true; });
}

function closeIm(key) {
  const im = state.ims[key];
  if (!im) return;
  im.open = false;
  im.minimized = false;
  im.unread = 0;
  renderDock();
  updateTitle();
  rememberLive();
}

function minimizeIm(key) {
  const im = state.ims[key];
  if (!im) return;
  im.minimized = true;
  renderDock();
  rememberLive();
}

function personByNick(nick) {
  const key = nick.toLowerCase();
  return state.online.find((user) => user.nick.toLowerCase() === key)
    || state.buddies.find((user) => user.nick.toLowerCase() === key)
    || { nick, status: "offline", statusMessage: "", guest: false };
}

function renderDock() {
  const dock = $("dock");
  const active = document.activeElement;
  const focusKey = active?.closest?.(".im-window")?.dataset.key;
  const keepValue = active?.classList?.contains("im-input") ? active.value : null;
  const selection = active?.classList?.contains("im-input") ? [active.selectionStart, active.selectionEnd] : null;
  dock.replaceChildren();
  const ims = Object.values(state.ims).filter((im) => im.open);
  for (const im of ims.filter((item) => item.minimized)) dock.append(imTab(im));
  for (const im of ims.filter((item) => !item.minimized).sort((a, b) => a.openedAt - b.openedAt)) {
    dock.append(imWindow(im));
  }
  if (focusKey && keepValue != null) {
    const input = dock.querySelector(`.im-window[data-key="${CSS.escape(focusKey)}"] .im-input`);
    if (input) {
      input.value = keepValue;
      input.focus();
      if (selection) input.setSelectionRange(selection[0], selection[1]);
    }
  }
}

function imTab(im) {
  return el("button", {
    type: "button",
    class: im.unread ? "im-tab unread" : "im-tab",
    "data-action": "restore-im",
    "data-key": im.key,
  }, im.nick, im.unread ? el("span", { class: "badge" }, String(im.unread)) : null);
}

function imWindow(im) {
  const person = personByNick(im.nick);
  const isBuddy = state.buddies.some((buddy) => buddy.nick.toLowerCase() === im.key);
  const ignored = state.ignored.has(im.key);
  const win = el("section", { class: "im-window", "data-key": im.key },
    el("div", { class: "im-h" },
      face(person),
      el("div", { class: "im-title" }, el("span", {}, im.nick)),
      el("button", { type: "button", class: "iconbtn", "data-action": "min-im", "data-key": im.key, "aria-label": "Minimize" }, "–"),
      el("button", { type: "button", class: "iconbtn", "data-action": "close-im", "data-key": im.key, "aria-label": "Close" }, "×")),
    el("div", { class: "im-sub", "data-key": im.key }, headerStatus(person)),
    el("div", { class: "im-tools" },
      el("button", { type: "button", class: "texty", "data-action": "ignore", "data-nick": im.nick }, ignored ? "Unignore" : "Ignore"),
      state.me && window.YchatProfile && YchatProfile.isSignedInNick(state.me.nick) && !person.bot && !isBuddy
        ? el("button", { type: "button", class: "texty", "data-action": "add-buddy", "data-nick": im.nick }, "Add buddy")
        : null),
    el("div", { class: "im-log", "data-key": im.key }),
    el("form", { class: "im-form", "data-key": im.key },
      el("input", { class: "im-input", maxlength: "500", placeholder: `Message ${im.nick}`, autocomplete: "off" }),
      el("button", { class: "primary", type: "submit" }, "Send")));
  const log = win.querySelector(".im-log");
  for (const line of im.lines) log.append(imLine(line));
  log.scrollTop = log.scrollHeight;
  win.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = win.querySelector(".im-input");
    const text = input.value.trim();
    if (!text) return;
    send({ type: "pm", to: im.nick, text });
    input.value = "";
    resumeAudio();
  });
  return win;
}

function imLine(line) {
  const bubble = el("div", { class: "im-bubble" });
  fillEmote(bubble, line.text);
  return el("div", { class: line.mine ? "im-line mine" : "im-line" }, bubble);
}

function headerStatus(person) {
  if (person.bot) return "Lobby greeter";
  if (person.status === "offline") return "Offline";
  const where = person.roomName || "In the lobby";
  return person.statusMessage ? `${person.status} · ${where} · ${person.statusMessage}` : `${person.status} · ${where}`;
}

function refreshImHeaders() {
  for (const node of document.querySelectorAll(".im-sub")) {
    node.textContent = headerStatus(personByNick(node.dataset.key));
  }
}

function onPm(msg) {
  const mine = msg.from.toLowerCase() === state.me.nick.toLowerCase();
  const other = mine ? msg.to : msg.from;
  if (!mine && state.ignored.has(other.toLowerCase())) return;
  const im = ensureIm(other);
  im.lines.push({ from: msg.from, text: msg.text, at: msg.at, mine });
  if (im.lines.length > 80) im.lines.shift();
  rememberLive();
  if (!im.open) {
    im.open = true;
    im.minimized = false;
    im.unread = 0;
    im.openedAt = Date.now();
    constrainOpen(im.key);
    renderDock();
  } else if (im.minimized) {
    im.unread += 1;
    renderDock();
  } else {
    const log = document.querySelector(`.im-log[data-key="${CSS.escape(im.key)}"]`);
    if (!log) renderDock();
    else {
      log.append(imLine(im.lines[im.lines.length - 1]));
      log.scrollTop = log.scrollHeight;
    }
  }
  if (!mine) chime();
  updateTitle();
}

function updateTitle() {
  const unread = Object.values(state.ims).reduce((sum, im) => sum + (im.open && im.minimized ? im.unread : 0), 0);
  document.title = unread ? `(${unread}) Y-Chat` : "Free Yahoo-Style Chat Rooms & Messenger — Y-Chat";
}

function toggleIgnore(nick) {
  const key = nick.toLowerCase();
  if (key === state.me.nick.toLowerCase()) return;
  if (state.ignored.has(key)) {
    state.ignored.delete(key);
    send({ type: "unignore", nick });
    toast(`You'll see ${nick} again.`);
  } else {
    state.ignored.add(key);
    send({ type: "ignore", nick });
    state.roomLog = state.roomLog.filter((message) => message.system || !message.nick || message.nick.toLowerCase() !== key);
    document.querySelectorAll(`.line[data-from="${CSS.escape(key)}"]`).forEach((node) => node.remove());
    toast(`Ignoring ${nick}.`);
  }
  rememberLive();
  renderDock();
}

function saveStatus() {
  if (window.YchatProfile && state.me && YchatProfile.isSignedInNick(state.me.nick)) {
    YchatProfile.saveStatusMessage($("status-message").value);
  }
  send({
    type: "setStatus",
    status: $("status").value,
    statusMessage: $("status-message").value,
  });
}

function insertAtCursor(input, token) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const glue = start > 0 && input.value[start - 1] !== " " ? " " : "";
  const chunk = glue + token;
  input.value = input.value.slice(0, start) + chunk + input.value.slice(end);
  const pos = start + chunk.length;
  input.focus();
  input.setSelectionRange(pos, pos);
}

function chime() {
  if (!state.sound) return;
  try {
    const ctx = state.audio || (state.audio = new AudioContext());
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    /* Autoplay rules vary. The message still shows. */
  }
}

function resumeAudio() {
  if (state.audio && state.audio.state === "suspended") state.audio.resume();
}

function signOut() {
  state.manualClose = true;
  state.pendingPlace = null;
  if (window.YchatProfile) YchatProfile.signOutLocal();
  send({ type: "signOut" });
  clearLive();
  if (state.ws) state.ws.close();
  showGate("guest");
}

window.addEventListener("pagehide", () => {
  state.leaving = true;
  savePlace();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !state.me || !state.auth) return;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
  scheduleReconnect();
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-gate]");
  if (!target) return;
  if (target.dataset.gate) {
    setGateMode(target.dataset.gate);
    setGateError("");
    return;
  }
  const action = target.dataset.action;
  if (action === "mobile-pane") return setPane(target.dataset.pane);
  if (action === "category") return goLobby(target.dataset.cat);
  if (action === "home") return goLobby();
  if (action === "join") return send({ type: "joinRoom", roomId: target.dataset.id });
  if (action === "toggle-create") {
    const form = $("create-form");
    form.hidden = !form.hidden;
    if (!form.hidden) $("room-name").focus();
    return;
  }
  if (action === "open-im") return openIm(target.dataset.nick, { focus: true });
  if (action === "people-tab") {
    state.peopleTab = target.dataset.tab;
    renderPeople();
    return;
  }
  if (action === "remove-buddy") {
    if (window.YchatProfile) YchatProfile.removeBuddy(target.dataset.nick);
    syncLocalProfile();
    renderPeople();
    toast(`Removed ${target.dataset.nick}.`);
    return;
  }
  if (action === "add-buddy") {
    if (!window.YchatProfile || !state.me || !YchatProfile.isSignedInNick(state.me.nick)) {
      toast("Sign in to save buddies on this device.");
      return;
    }
    const err = YchatProfile.addBuddy(target.dataset.nick);
    if (err) { toast(err); return; }
    syncLocalProfile();
    renderPeople();
    toast(`${target.dataset.nick} is on your buddy list.`);
    return;
  }
  if (action === "ignore") return toggleIgnore(target.dataset.nick);
  if (action === "close-im") return closeIm(target.dataset.key);
  if (action === "min-im") return minimizeIm(target.dataset.key);
  if (action === "restore-im") {
    const im = state.ims[target.dataset.key];
    if (!im) return;
    im.minimized = false;
    im.unread = 0;
    im.openedAt = Date.now();
    constrainOpen(im.key);
    renderDock();
    updateTitle();
    return;
  }
  if (action === "emote") {
    const input = $("say");
    if (input) insertAtCursor(input, target.dataset.token);
  }
});

$("form-legal").addEventListener("submit", (event) => {
  event.preventDefault();
  acceptLegal();
});

$("legal-check").addEventListener("change", () => {
  $("legal-accept").disabled = !$("legal-check").checked;
});

$("form-guest").addEventListener("submit", (event) => {
  event.preventDefault();
  const nick = $("guest-nick").value.trim();
  connect({ type: "guest", nick });
});

$("form-login").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.YchatProfile) return;
  setBusy(true);
  setGateError("");
  const username = $("login-name").value.trim();
  const err = await YchatProfile.login(username, $("login-pass").value);
  if (err) {
    setGateError(err);
    setBusy(false);
    return;
  }
  connect({ type: "guest", nick: username, guest: false });
});

$("form-register").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.YchatProfile) return;
  if ($("reg-pass").value !== $("reg-confirm").value) {
    setGateError("Those passwords don't match.");
    return;
  }
  setBusy(true);
  setGateError("");
  const username = $("reg-name").value.trim();
  const err = await YchatProfile.register(username, $("reg-pass").value);
  if (err) {
    setGateError(err);
    setBusy(false);
    return;
  }
  connect({ type: "guest", nick: username, guest: false });
});

$("add-buddy").addEventListener("submit", (event) => {
  event.preventDefault();
  const nick = $("buddy-nick").value.trim();
  if (!nick) return;
  if (!window.YchatProfile || !state.me || !YchatProfile.isSignedInNick(state.me.nick)) {
    toast("Sign in to save buddies on this device.");
    return;
  }
  const err = YchatProfile.addBuddy(nick);
  if (err) { toast(err); return; }
  syncLocalProfile();
  renderPeople();
  toast(`${nick} is on your buddy list.`);
  $("buddy-nick").value = "";
});

$("status").addEventListener("change", saveStatus);
$("status-message").addEventListener("change", saveStatus);
$("status-message").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveStatus();
    event.currentTarget.blur();
  }
});

$("sound").addEventListener("change", (event) => {
  state.sound = event.target.checked;
  localStorage.setItem("ychat-sound", state.sound ? "1" : "0");
});

$("sign-out").addEventListener("click", signOut);

const savedNick = localStorage.getItem("ychat-nick");
if (savedNick) {
  $("guest-nick").value = savedNick;
  $("login-name").value = savedNick;
}
if (localStorage.getItem("ychat-sound") === "0") {
  state.sound = false;
  $("sound").checked = false;
}

function markRelayPill(ok, mode) {
  const pill = $("server-pill");
  if (!pill) return;
  pill.classList.toggle("ok", ok);
  pill.classList.toggle("bad", !ok);
  if (ok) {
    pill.textContent = "You're good to go — server is ready";
    return;
  }
  const loopback = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (mode === "missing-config") {
    pill.textContent = loopback
      ? "Chat relay is not configured — run npm start or set config.json"
      : "Chat relay URL missing in config.json";
    return;
  }
  if (mode === "ws-failed") {
    pill.textContent = "Relay health OK but chat connection failed";
    return;
  }
    pill.textContent = loopback
      ? "Server offline — run npm start in the project folder"
      : "Can't reach chat server — check config.json";
}

function probeRelaySocket(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!relayWsConfigured()) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    let ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    ws.addEventListener("open", () => finish(true));
    ws.addEventListener("error", () => finish(false));
  });
}

function pingRelay() {
  if (!relayWsConfigured()) {
    markRelayPill(false, "missing-config");
    return Promise.resolve(false);
  }
  const url = healthUrl();
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error("down");
      return probeRelaySocket();
    })
    .then((socketOk) => {
      markRelayPill(socketOk, socketOk ? "ok" : "ws-failed");
      return socketOk;
    })
    .catch(() => {
      markRelayPill(false, "health-failed");
      return false;
    });
}

setGateFormsWaiting(true);

configReady = fetch(new URL("config.json", location.href).href)
  .then((res) => (res.ok ? res.json() : null))
  .then((cfg) => {
    if (cfg && typeof cfg === "object") ychatConfig = { ...ychatConfig, ...cfg };
    normalizeRelayConfig();
  })
  .catch(() => {
    normalizeRelayConfig();
  })
  .finally(() => {
    relayConfigLoaded = true;
    return pingRelay().finally(() => {
      if (legalAccepted()) {
        setGateFormsWaiting(false);
        maybeAutoResume();
      }
    });
  });

applyLegalGate();
