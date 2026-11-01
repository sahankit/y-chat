// Y-Chat realtime relay — WebSocket only. Serve `public/` from static hosting (GitHub Pages, CDN).
// Start: npm start  ·  Local UI: npm run static (separate terminal)

"use strict";

const crypto = require("crypto");
const http = require("http");
const os = require("os");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 4317;
const CATEGORIES = ["Friends", "Music", "Sports", "Tech", "Random"];
const NICK_RE = /^[A-Za-z][A-Za-z0-9_]{1,15}$/;
const STATUSES = new Set(["available", "away", "busy"]);
const MAX_ROOMS = 40;
const MAX_MESSAGE = 500;

const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const rooms = new Map();
const clients = new Map();

seedRooms();

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

const resumes = new Map();
const RESUME_MS = 2 * 60 * 1000;

function makeUser({ nick, key, guest, statusMessage = "", resume = "", status = "available" }) {
  return {
    nick,
    key,
    guest,
    status: STATUSES.has(status) ? status : "available",
    statusMessage,
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
  for (const ws of clients.keys()) send(ws, { type: "online", users });
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

function system(room, text) {
  broadcastSaid(room, { id: uid(), system: true, text, at: Date.now() });
}

function sayAsBot(room, text) {
  if (!room) return;
  broadcastSaid(room, { id: uid(), nick: "LobbyBot", text, at: Date.now() });
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
    return "Click Rooms to leave, click a person to message them privately. Guests can do both. A saved profile only keeps buddies in this browser.";
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
    resume: token,
  }));
  welcome(ws);
}

function authGuest(ws, nick, guest = true) {
  if (!NICK_RE.test(nick || "")) {
    return error(ws, "Use 2–16 letters, numbers, or underscores, starting with a letter.");
  }
  const key = nick.toLowerCase();
  if (key === "lobbybot") return error(ws, "That name is reserved.");
  if (findOnline(key)) return error(ws, "That name is taken right now. Try another.");
  clients.set(ws, makeUser({ nick, key, guest: guest !== false }));
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
  broadcastSaid(room, { id: uid(), nick: user.nick, text: parsed.text, at: Date.now() });
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
  if (!target) return error(ws, `${to} is offline.`);
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
  send(ws, { type: "me", user: publicUser(user) });
  broadcastPresence();
}

function handle(ws, msg) {
  if (!msg || typeof msg !== "object") return;
  const type = msg.type;
  const authed = clients.has(ws);
  if (type === "guest" || type === "resume") {
    if (authed) return error(ws, "You're already in.");
    if (type === "resume") return authResume(ws, msg.token);
    return authGuest(ws, msg.nick, msg.guest !== false);
  }
  if (!authed) return error(ws, "Join first.");
  switch (type) {
    case "joinRoom": return joinRoom(ws, msg.roomId, msg.resume === true);
    case "leaveRoom": return exitToLobby(ws);
    case "createRoom": return createRoom(ws, msg.name, msg.category, msg.topic);
    case "say": return say(ws, msg.text);
    case "pm": return privateMessage(ws, msg.to, msg.text);
    case "setStatus": return setStatus(ws, msg.status, msg.statusMessage);
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

function setIgnore(ws, nick, on) {
  const user = clients.get(ws);
  if (!NICK_RE.test(nick || "")) return;
  const key = nick.toLowerCase();
  if (key === user.key) return error(ws, "You can't ignore yourself.");
  if (on) user.ignored.add(key);
  else user.ignored.delete(key);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isAllowedClientOrigin(origin, relayHost) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const originKey = origin.toLowerCase();
    const hostKey = parsed.host.toLowerCase();
    if (ALLOWED_ORIGINS.length) {
      if (ALLOWED_ORIGINS.includes(originKey) || ALLOWED_ORIGINS.includes(hostKey)) return true;
    }
    const host = String(relayHost || "").trim().toLowerCase();
    if (hostKey === host) return true;
    const relayHostname = host.split(":")[0];
    if (isLoopbackHost(parsed.hostname) && isLoopbackHost(relayHostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function allowWebSocketOrigin(req) {
  return isAllowedClientOrigin(req.headers.origin, req.headers.host);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !isAllowedClientOrigin(origin, req.headers.host)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

const server = http.createServer((req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === "/health" || req.url === "/health/") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(JSON.stringify({ ok: true, mode: "websocket" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found. Serve the Y-Chat UI from static hosting.");
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
  console.log(`Y-Chat relay (WebSocket): ws://localhost:${PORT}`);
  for (const ip of ips) console.log(`On your network: ws://${ip}:${PORT}`);
  if (ALLOWED_ORIGINS.length) console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log("Serve public/ from static hosting, or run: npm run static");
});
