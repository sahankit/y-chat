// Y-Chat — local chat rooms and a private messenger.
// Start with: npm start
// Then open the printed URL.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 4317;
const PUBLIC = path.join(__dirname, "public");
const ACCOUNTS = path.join(__dirname, "data", "accounts.json");
const CATEGORIES = ["Friends", "Music", "Sports", "Tech", "Random"];
const NICK_RE = /^[A-Za-z][A-Za-z0-9_]{1,15}$/;
const STATUSES = new Set(["available", "away", "busy"]);
const MAX_ROOMS = 40;
const MAX_MESSAGE = 500;
const MIN_PASSWORD = 8;
const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_MAX_IP = 30;
const AUTH_FAIL_MAX_USER = 8;

const rooms = new Map();
const clients = new Map();
const authFails = new Map();
let accounts = loadAccounts();
let accountsWriteChain = Promise.resolve();

seedRooms();

function loadAccounts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS, "utf8"));
    if (!parsed || typeof parsed.users !== "object" || !parsed.users) return { users: {} };
    return parsed;
  } catch {
    return { users: {} };
  }
}

function saveAccounts() {
  accountsWriteChain = accountsWriteChain.then(() => {
    fs.mkdirSync(path.dirname(ACCOUNTS), { recursive: true });
    const tmp = `${ACCOUNTS}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2));
    fs.renameSync(tmp, ACCOUNTS);
  }).catch((err) => {
    console.error("accounts save failed:", err);
  });
  return accountsWriteChain;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

function pruneAuthFails() {
  const now = Date.now();
  for (const [key, entry] of authFails) {
    if (now - entry.firstAt > AUTH_FAIL_WINDOW_MS) authFails.delete(key);
  }
}

function recordAuthFail(ip, userKey) {
  pruneAuthFails();
  const bump = (scope, id) => {
    const key = `${scope}:${id}`;
    let entry = authFails.get(key);
    if (!entry || Date.now() - entry.firstAt > AUTH_FAIL_WINDOW_MS) {
      entry = { count: 0, firstAt: Date.now() };
    }
    entry.count += 1;
    authFails.set(key, entry);
  };
  bump("ip", ip);
  if (userKey) bump("user", userKey);
}

function authBlocked(ip, userKey) {
  pruneAuthFails();
  const over = (scope, id, max) => {
    const entry = authFails.get(`${scope}:${id}`);
    if (!entry) return false;
    if (Date.now() - entry.firstAt > AUTH_FAIL_WINDOW_MS) return false;
    return entry.count >= max;
  };
  return over("ip", ip, AUTH_FAIL_MAX_IP) || (userKey ? over("user", userKey, AUTH_FAIL_MAX_USER) : false);
}

function allowWebSocketOrigin(req) {
  const host = String(req.headers.host || "").trim().toLowerCase();
  if (!host) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const next = crypto.scryptSync(password, salt, 32).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(next, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function seedRooms() {
  const seeds = [
    ["welcome", "Welcome Lobby", "Friends", "Say hi. LobbyBot is around."],
    ["20s", "20s Lounge", "Friends", "Too old for homework, too young for back pain."],
    ["late", "Late Night", "Friends", "Still awake?"],
    ["now", "Now Playing", "Music", "What is on?"],
    ["throw", "Throwbacks", "Music", "Songs that still hit."],
    ["gameday", "Game Day", "Sports", "Scores, gripes, glory."],
    ["fantasy", "Fantasy Desk", "Sports", "Questionable lineup advice."],
    ["gadgets", "Gadgets", "Tech", "Hardware and new toys."],
    ["code", "Code & Coffee", "Tech", "What are you building?"],
    ["random", "Anything Goes", "Random", "No topic. Try to behave."],
    ["wyr", "Would You Rather", "Random", "Ask one. Answer one."],
  ];
  for (const [id, name, category, topic] of seeds) {
    rooms.set(id, { id, name, category, topic, members: new Set() });
  }
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function error(ws, message) {
  send(ws, { type: "error", message });
}

function notice(ws, message) {
  send(ws, { type: "notice", message });
}

const resumes = new Map();
const RESUME_MS = 2 * 60 * 1000;

function makeUser({ nick, key, guest, statusMessage = "", buddies = [], resume = "", status = "available" }) {
  return {
    nick,
    key,
    guest,
    status: STATUSES.has(status) ? status : "available",
    statusMessage,
    buddies,
    ignored: new Set(),
    roomId: null,
    msgTimes: [],
    resume,
    forget: false,
  };
}

function holdResume(user) {
  if (!user.resume || user.forget) return;
  resumes.set(user.resume, {
    nick: user.nick,
    key: user.key,
    guest: user.guest,
    status: user.status,
    statusMessage: user.statusMessage || "",
    buddies: [...(user.buddies || [])],
    at: Date.now(),
  });
}

function findResume(token) {
  for (const [ws, user] of clients) {
    if (user.resume === token) return { ws, user };
  }
  return null;
}

function findOnline(key) {
  for (const [ws, user] of clients) {
    if (user.key === key) return { ws, user };
  }
  return null;
}

function presenceOf(user) {
  const room = user.roomId ? rooms.get(user.roomId) : null;
  return {
    nick: user.nick,
    status: user.status,
    statusMessage: user.statusMessage,
    guest: user.guest,
    bot: false,
    roomId: user.roomId,
    roomName: room ? room.name : null,
  };
}

function botPresence() {
  const room = rooms.get("welcome");
  return {
    nick: "LobbyBot",
    status: "available",
    statusMessage: "Keeping the lights on",
    guest: false,
    bot: true,
    roomId: "welcome",
    roomName: room ? room.name : "Welcome Lobby",
  };
}

function onlineSnapshot() {
  const list = [...clients.values()].map(presenceOf);
  list.push(botPresence());
  list.sort((a, b) => a.nick.localeCompare(b.nick));
  return list;
}

function publicRooms() {
  return [...rooms.values()].map((room) => ({
    id: room.id,
    name: room.name,
    category: room.category,
    topic: room.topic,
    count: room.members.size + (room.id === "welcome" ? 1 : 0),
  }));
}

function buddyPayload(user) {
  return user.buddies.map((key) => {
    const account = accounts.users[key];
    const online = findOnline(key);
    if (online) return presenceOf(online.user);
    return {
      nick: account ? account.nick : key,
      status: "offline",
      statusMessage: account ? account.statusMessage || "" : "",
      guest: false,
      bot: false,
      roomId: null,
      roomName: null,
    };
  });
}

function publicUser(user) {
  return {
    nick: user.nick,
    guest: user.guest,
    status: user.status,
    statusMessage: user.statusMessage,
  };
}

function broadcastPresence() {
  const users = onlineSnapshot();
  for (const [ws, user] of clients) {
    send(ws, { type: "online", users });
    if (!user.guest) send(ws, { type: "buddies", buddies: buddyPayload(user) });
  }
}

function broadcastRooms() {
  const list = publicRooms();
  for (const ws of clients.keys()) send(ws, { type: "rooms", rooms: list });
}

function roomMembers(room) {
  const list = [];
  for (const member of room.members) {
    const user = clients.get(member);
    if (user) list.push(presenceOf(user));
  }
  if (room.id === "welcome") list.push(botPresence());
  list.sort((a, b) => a.nick.localeCompare(b.nick));
  return list;
}

function broadcastSaid(room, message) {
  const packet = { type: "said", roomId: room.id, message };
  for (const member of room.members) {
    const user = clients.get(member);
    if (!user) continue;
    if (!message.system && message.nick && user.ignored.has(message.nick.toLowerCase())) continue;
    send(member, packet);
  }
}

function pushMessage(room, message) {
  broadcastSaid(room, message);
}

function system(room, text) {
  broadcastSaid(room, { id: uid(), system: true, text, at: Date.now() });
}

function sayAsBot(room, text) {
  if (!room) return;
  pushMessage(room, { id: uid(), nick: "LobbyBot", text, at: Date.now() });
}

function greeting(nick) {
  const lines = [
    `Hey ${nick}. Pull up a chair.`,
    `Hi ${nick}. The lobby's open.`,
    `Welcome in, ${nick}. Say the thing.`,
  ];
  return lines[nick.length % lines.length];
}

function botReply(text, nick) {
  const t = text.trim().toLowerCase();
  if (/^(hi|hey|hello|yo|howdy|hiya)\b/.test(t)) {
    return `Hey ${nick}. I'm here. Click a name if you want a private chat.`;
  }
  if (t === "ping") return "pong";
  if (t === "?" || t.includes("help")) {
    return "Click Rooms to leave, click a person to message them privately. Guests can do both. An account only saves a buddy list on this computer.";
  }
  if (/how are you|how's it going|whats up|what's up/.test(t)) return "Awake and full of rooms. You?";
  return null;
}

function rateOk(user) {
  const now = Date.now();
  user.msgTimes = user.msgTimes.filter((t) => now - t < 4000);
  if (user.msgTimes.length >= 8) return false;
  user.msgTimes.push(now);
  return true;
}

function cleanPlain(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001F]/g, "").trim().slice(0, max);
}

function messageText(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001F]/g, "").trim();
  if (!text) return { text: "" };
  if (text.length > MAX_MESSAGE) return { error: "That message is too long." };
  return { text };
}

function welcome(ws) {
  const user = clients.get(ws);
  if (!user.resume) user.resume = crypto.randomBytes(16).toString("hex");
  resumes.delete(user.resume);
  send(ws, {
    type: "hello",
    user: publicUser(user),
    resume: user.resume,
    categories: CATEGORIES,
    rooms: publicRooms(),
    users: onlineSnapshot(),
    buddies: user.guest ? [] : buddyPayload(user),
  });
  broadcastPresence();
  broadcastRooms();
}

function drop(ws, reason) {
  if (!clients.has(ws)) {
    if (ws.readyState === ws.OPEN) ws.close();
    return;
  }
  leaveRoom(ws);
  clients.delete(ws);
  broadcastPresence();
  broadcastRooms();
  if (reason) send(ws, { type: reason });
  setTimeout(() => {
    try { ws.close(); } catch { /* already gone */ }
  }, 30);
}

function authResume(ws, token) {
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/.test(token)) {
    return error(ws, "Sign in again.");
  }
  const live = findResume(token);
  if (live) {
    const previous = live.user;
    previous.forget = true;
    drop(live.ws);
    clients.set(ws, makeUser({
      nick: previous.nick,
      key: previous.key,
      guest: previous.guest,
      status: previous.status,
      statusMessage: previous.statusMessage,
      buddies: [...(previous.buddies || [])],
      resume: token,
    }));
    welcome(ws);
    return;
  }
  const held = resumes.get(token);
  if (!held || Date.now() - held.at > RESUME_MS) {
    resumes.delete(token);
    return error(ws, "Sign in again.");
  }
  if (findOnline(held.key)) return error(ws, "That name is taken right now. Try another.");
  resumes.delete(token);
  clients.set(ws, makeUser({
    nick: held.nick,
    key: held.key,
    guest: held.guest,
    status: held.status,
    statusMessage: held.statusMessage,
    buddies: [...(held.buddies || [])],
    resume: token,
  }));
  welcome(ws);
}

function authGuest(ws, nick) {
  if (!NICK_RE.test(nick || "")) {
    return error(ws, "Use 2–16 letters, numbers, or underscores, starting with a letter.");
  }
  const key = nick.toLowerCase();
  if (key === "lobbybot") return error(ws, "That name is reserved.");
  if (accounts.users[key]) return error(ws, "That name has an account. Sign in, or pick another nickname.");
  if (findOnline(key)) return error(ws, "That name is taken right now. Try another.");
  clients.set(ws, makeUser({ nick, key, guest: true }));
  welcome(ws);
}

function authRegister(ws, username, password) {
  if (!NICK_RE.test(username || "")) {
    return error(ws, "Use 2–16 letters, numbers, or underscores, starting with a letter.");
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > 72) {
    return error(ws, `Use a password of ${MIN_PASSWORD}–72 characters.`);
  }
  if (authBlocked(ws.clientIp)) {
    return error(ws, "Too many tries. Wait a few minutes.");
  }
  const key = username.toLowerCase();
  if (key === "lobbybot") return error(ws, "That name is reserved.");
  if (accounts.users[key] || findOnline(key)) return error(ws, "That name is taken.");
  const { salt, hash } = hashPassword(password);
  accounts.users[key] = { nick: username, salt, hash, buddies: [], statusMessage: "" };
  saveAccounts();
  clients.set(ws, makeUser({ nick: username, key, guest: false }));
  welcome(ws);
}

function authLogin(ws, username, password) {
  if (!NICK_RE.test(username || "")) return error(ws, "Check the name and try again.");
  const key = username.toLowerCase();
  if (authBlocked(ws.clientIp, key)) {
    return error(ws, "Too many tries. Wait a few minutes.");
  }
  const account = accounts.users[key];
  if (!account || !verifyPassword(password || "", account.salt, account.hash)) {
    recordAuthFail(ws.clientIp, key);
    return error(ws, "That name and password don't match.");
  }
  const existing = findOnline(key);
  if (existing) drop(existing.ws, "replaced");
  clients.set(ws, makeUser({
    nick: account.nick,
    key,
    guest: false,
    statusMessage: account.statusMessage || "",
    buddies: [...(account.buddies || [])],
  }));
  welcome(ws);
}

function leaveRoom(ws, { announce = true } = {}) {
  const user = clients.get(ws);
  if (!user || !user.roomId) return;
  const room = rooms.get(user.roomId);
  const nick = user.nick;
  user.roomId = null;
  if (!room) return;
  room.members.delete(ws);
  if (announce) system(room, `${nick} has left the room.`);
}

function sendRoom(ws) {
  const user = clients.get(ws);
  const room = rooms.get(user.roomId);
  send(ws, {
    type: "room",
    room: publicRooms().find((item) => item.id === room.id),
    members: roomMembers(room),
    messages: [],
  });
}

function joinRoom(ws, roomId, resume) {
  const user = clients.get(ws);
  const room = rooms.get(roomId);
  if (!room) return error(ws, "That room is gone.");
  if (user.roomId === room.id) return sendRoom(ws);
  leaveRoom(ws);
  room.members.add(ws);
  user.roomId = room.id;
  sendRoom(ws);
  system(room, `${user.nick} has entered the room.`);
  if (room.id === "welcome" && !resume) {
    const nick = user.nick;
    setTimeout(() => {
      if (clients.get(ws)?.roomId === room.id) sayAsBot(room, greeting(nick));
    }, 700);
  }
  broadcastPresence();
  broadcastRooms();
}

function exitToLobby(ws) {
  if (!clients.get(ws).roomId) {
    send(ws, { type: "left" });
    return;
  }
  leaveRoom(ws);
  send(ws, { type: "left" });
  broadcastPresence();
  broadcastRooms();
}

function createRoom(ws, name, category, topic) {
  const cleaned = cleanPlain(name, 32);
  if (cleaned.length < 2 || !/[A-Za-z0-9]/.test(cleaned)) {
    return error(ws, "Give the room a name, at least 2 characters.");
  }
  if (!CATEGORIES.includes(category)) return error(ws, "Pick a category.");
  if (rooms.size >= MAX_ROOMS) return error(ws, "The directory is full.");
  if ([...rooms.values()].some((room) => room.name.toLowerCase() === cleaned.toLowerCase())) {
    return error(ws, "A room with that name already exists.");
  }
  let base = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  if (!base) base = "room";
  let id = base;
  let n = 2;
  while (rooms.has(id)) id = `${base}-${n++}`;
  const room = {
    id,
    name: cleaned,
    category,
    topic: cleanPlain(topic, 80) || "Come say hi.",
    members: new Set(),
  };
  rooms.set(id, room);
  joinRoom(ws, id);
}

function say(ws, text) {
  const user = clients.get(ws);
  if (!user.roomId) return error(ws, "Join a room first.");
  const parsed = messageText(text);
  if (parsed.error) return error(ws, parsed.error);
  if (!parsed.text) return;
  if (!rateOk(user)) return error(ws, "Slow down a little.");
  const room = rooms.get(user.roomId);
  pushMessage(room, { id: uid(), nick: user.nick, text: parsed.text, at: Date.now() });
  if (room.id === "welcome") {
    const reply = botReply(parsed.text, user.nick);
    if (reply) {
      setTimeout(() => {
        if (clients.get(ws)?.roomId === "welcome") sayAsBot(rooms.get("welcome"), reply);
      }, 500);
    }
  }
}

function privateMessage(ws, to, text) {
  const user = clients.get(ws);
  const parsed = messageText(text);
  if (parsed.error) return error(ws, parsed.error);
  if (!parsed.text) return;
  if (!NICK_RE.test(to || "")) return error(ws, "Check the name and try again.");
  const key = to.toLowerCase();
  if (key === user.key) return error(ws, "That's you. Pick someone else.");
  if (!rateOk(user)) return error(ws, "Slow down a little.");
  const at = Date.now();
  if (key === "lobbybot") {
    send(ws, { type: "pm", from: user.nick, to: "LobbyBot", text: parsed.text, at });
    const reply = botReply(parsed.text, user.nick) || "I mostly hang out in Welcome Lobby. I'm not much of a pen pal.";
    setTimeout(() => {
      if (clients.get(ws)) {
        send(ws, { type: "pm", from: "LobbyBot", to: user.nick, text: reply, at: Date.now() });
      }
    }, 500);
    return;
  }
  const target = findOnline(key);
  if (!target) {
    const account = accounts.users[key];
    return error(ws, account ? `${account.nick} is offline.` : "No one with that name is online.");
  }
  if (target.user.ignored.has(user.key)) return error(ws, "You can't message them right now.");
  const packet = { type: "pm", from: user.nick, to: target.user.nick, text: parsed.text, at };
  send(target.ws, packet);
  send(ws, packet);
}

function setStatus(ws, status, statusMessage) {
  const user = clients.get(ws);
  if (!STATUSES.has(status)) return error(ws, "Unknown status.");
  user.status = status;
  user.statusMessage = cleanPlain(statusMessage, 60);
  if (!user.guest) {
    accounts.users[user.key].statusMessage = user.statusMessage;
    saveAccounts();
  }
  send(ws, { type: "me", user: publicUser(user) });
  broadcastPresence();
}

function addBuddy(ws, nick) {
  const user = clients.get(ws);
  if (user.guest) {
    return error(ws, "Guests don't have a saved buddy list. Create an account, or just message them while you're both here.");
  }
  if (!NICK_RE.test(nick || "")) return error(ws, "Check the name and try again.");
  const key = nick.toLowerCase();
  if (key === user.key) return error(ws, "That's you. Pick someone else.");
  if (key === "lobbybot") return error(ws, "LobbyBot can't be added. It's always in Welcome Lobby.");
  const account = accounts.users[key];
  if (!account) {
    return error(ws, "Buddies have to be accounts. Guests can still be messaged while they're online.");
  }
  if (!user.buddies.includes(key)) user.buddies.push(key);
  accounts.users[user.key].buddies = user.buddies;
  saveAccounts();
  send(ws, { type: "buddies", buddies: buddyPayload(user) });
  notice(ws, `${account.nick} is on your buddy list.`);
}

function removeBuddy(ws, nick) {
  const user = clients.get(ws);
  if (user.guest) return;
  const key = String(nick || "").toLowerCase();
  user.buddies = user.buddies.filter((item) => item !== key);
  if (accounts.users[user.key]) {
    accounts.users[user.key].buddies = user.buddies;
    saveAccounts();
  }
  const account = accounts.users[key];
  send(ws, { type: "buddies", buddies: buddyPayload(user) });
  notice(ws, `Removed ${account ? account.nick : nick}.`);
}

function setIgnore(ws, nick, on) {
  const user = clients.get(ws);
  if (!NICK_RE.test(nick || "")) return;
  const key = nick.toLowerCase();
  if (key === user.key) return error(ws, "You can't ignore yourself.");
  if (on) user.ignored.add(key);
  else user.ignored.delete(key);
}

function handle(ws, msg) {
  if (!msg || typeof msg !== "object") return;
  const type = msg.type;
  const authed = clients.has(ws);
  if (type === "guest" || type === "login" || type === "register" || type === "resume") {
    if (authed) return error(ws, "You're already in.");
    if (type === "resume") return authResume(ws, msg.token);
    if (type === "guest") return authGuest(ws, msg.nick);
    if (type === "login") return authLogin(ws, msg.username, msg.password);
    return authRegister(ws, msg.username, msg.password);
  }
  if (!authed) return error(ws, "Join first.");
  switch (type) {
    case "joinRoom": return joinRoom(ws, msg.roomId, msg.resume === true);
    case "leaveRoom": return exitToLobby(ws);
    case "createRoom": return createRoom(ws, msg.name, msg.category, msg.topic);
    case "say": return say(ws, msg.text);
    case "pm": return privateMessage(ws, msg.to, msg.text);
    case "setStatus": return setStatus(ws, msg.status, msg.statusMessage);
    case "addBuddy": return addBuddy(ws, msg.nick);
    case "removeBuddy": return removeBuddy(ws, msg.nick);
    case "ignore": return setIgnore(ws, msg.nick, true);
    case "unignore": return setIgnore(ws, msg.nick, false);
    case "signOut": {
      const user = clients.get(ws);
      if (user) user.forget = true;
      drop(ws);
      return;
    }
    default: return error(ws, "Unknown request.");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const ORIGIN_TOKEN = "https://example.invalid";

function siteOrigin(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim().toLowerCase();
  const proto = forwarded === "https" ? "https" : "http";
  const host = String(req.headers.host || `localhost:${PORT}`).trim();
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return `http://localhost:${PORT}`;
  return `${proto}://${host}`;
}

function adsensePublisher() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(PUBLIC, "ads.json"), "utf8"));
    const match = String(cfg.client || "").match(/^ca-pub-(\d+)$/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const origin = siteOrigin(req);
  if (url.pathname === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(`User-agent: *\nAllow: /\nDisallow: /health\n\nSitemap: ${origin}/sitemap.xml\n`);
    return;
  }
  if (url.pathname === "/sitemap.xml") {
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${origin}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n  <url>\n    <loc>${origin}/chat-rooms</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n  <url>\n    <loc>${origin}/messenger</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n  <url>\n    <loc>${origin}/terms</loc>\n    <changefreq>yearly</changefreq>\n    <priority>0.3</priority>\n  </url>\n  <url>\n    <loc>${origin}/privacy</loc>\n    <changefreq>yearly</changefreq>\n    <priority>0.3</priority>\n  </url>\n</urlset>\n`);
    return;
  }
  if (url.pathname === "/ads.txt") {
    const publisher = adsensePublisher();
    if (!publisher) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(`google.com, pub-${publisher}, DIRECT, f08c47fec0942fa0\n`);
    return;
  }
  let requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (requested === "privacy" || requested === "terms" || requested === "chat-rooms" || requested === "messenger") {
    requested = `${requested}.html`;
  }
  const file = path.resolve(PUBLIC, requested);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    const body = path.extname(file) === ".html"
      ? Buffer.from(data.toString("utf8").replaceAll(ORIGIN_TOKEN, origin))
      : data;
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
    });
    res.end(body);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  if (!allowWebSocketOrigin(req)) {
    ws.close(1008, "origin");
    return;
  }
  ws.clientIp = clientIp(req);
  if (wss.clients.size > 200) {
    ws.close(1013, "full");
    return;
  }
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (data, isBinary) => {
    if (isBinary || data.length > 8192) return;
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return error(ws, "Bad message.");
    }
    try {
      handle(ws, msg);
    } catch (err) {
      console.error(err);
      error(ws, "Something broke on the server. Try that again.");
    }
  });
  ws.on("close", () => {
    const user = clients.get(ws);
    if (!user) return;
    leaveRoom(ws);
    clients.delete(ws);
    holdResume(user);
    broadcastPresence();
    broadcastRooms();
  });
});

const pulse = setInterval(() => {
  const now = Date.now();
  for (const [token, held] of resumes) {
    if (now - held.at > RESUME_MS) resumes.delete(token);
  }
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on("close", () => clearInterval(pulse));

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if ((net.family === "IPv4" || net.family === 4) && !net.internal) ips.add(net.address);
    }
  }
  console.log(`Y-Chat is up: http://localhost:${PORT}`);
  for (const ip of ips) console.log(`On your network: http://${ip}:${PORT}`);
});
