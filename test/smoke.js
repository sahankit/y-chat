"use strict";

const { WebSocket } = require("ws");

const RELAY = process.env.YCHAT_URL || "http://127.0.0.1:4317";
const STATIC = process.env.YCHAT_STATIC_URL || "http://127.0.0.1:4318";
const WS = RELAY.replace(/^http/, "ws");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function client() {
  const ws = new WebSocket(WS);
  const queue = [];
  const waiters = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  return {
    ws,
    send(obj) { ws.send(JSON.stringify(obj)); },
    next(timeout = 4000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeout);
        waiters.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });
    },
    async until(predicate, timeout = 4000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const msg = await this.next(timeout - (Date.now() - start));
        if (predicate(msg)) return msg;
      }
      throw new Error("timed out waiting for a matching message");
    },
  };
}

async function open() {
  const c = client();
  await new Promise((resolve, reject) => {
    c.ws.once("open", resolve);
    c.ws.once("error", reject);
  });
  return c;
}

async function main() {
  const health = await fetch(`${RELAY}/health`);
  assert(health.ok, "health check failed");
  const healthBody = await health.json();
  assert(healthBody.ok && healthBody.mode === "websocket", "relay should be websocket-only");

  const root = await fetch(`${RELAY}/`);
  assert(root.status === 404, "relay should not serve the UI");

  const privacy = await fetch(`${STATIC}/privacy`);
  const terms = await fetch(`${STATIC}/terms`);
  const sitemap = await fetch(`${STATIC}/sitemap.xml`);
  assert(privacy.ok && terms.ok, "legal pages should load from static hosting");
  const privacyText = await privacy.text();
  const termsText = await terms.text();
  const map = await sitemap.text();
  assert(privacyText.includes("Privacy") && privacyText.includes("terms.html"), "privacy page incomplete");
  assert(termsText.includes("Terms") && termsText.includes("18") && termsText.includes("privacy.html"), "terms page incomplete");
  assert(map.includes("terms.html") && map.includes("privacy.html"), "sitemap should list legal pages");
  assert(map.includes("chat-rooms.html") && map.includes("messenger.html"), "sitemap should list the guides");
  assert(map.includes("sahankit.github.io/y-chat"), "sitemap should use GitHub Pages base URL");
  const roomsPage = await fetch(`${STATIC}/chat-rooms`);
  const messengerPage = await fetch(`${STATIC}/messenger`);
  assert(roomsPage.ok && messengerPage.ok, "guide pages should load");
  const roomsHtml = await roomsPage.text();
  const messengerHtml = await messengerPage.text();
  assert(roomsHtml.includes("chat room") && roomsHtml.includes("Welcome Lobby"), "chat rooms guide is thin");
  assert(messengerHtml.includes("private messenger") && messengerHtml.includes("buddy"), "messenger guide is thin");

  const stamp = Date.now().toString(36);
  const alpha = await open();
  const beta = await open();
  alpha.send({ type: "guest", nick: `SmokeA${stamp.slice(-4)}` });
  beta.send({ type: "guest", nick: `SmokeB${stamp.slice(-4)}` });
  const aHello = await alpha.until((msg) => msg.type === "hello");
  const bHello = await beta.until((msg) => msg.type === "hello");
  assert(aHello.user.guest && bHello.user.guest, "guests should be marked guest");
  assert(aHello.rooms.some((room) => room.id === "welcome"), "welcome room missing");
  assert(aHello.buddies === undefined, "server should not send buddy lists");

  alpha.send({ type: "joinRoom", roomId: "welcome" });
  const joined = await alpha.until((msg) => msg.type === "room");
  assert(joined.room.id === "welcome", "did not join welcome");
  const greeted = await alpha.until((msg) => msg.type === "said" && msg.message.nick === "LobbyBot", 2500);
  assert(greeted.message.text.includes(aHello.user.nick), "bot did not greet by name");

  beta.send({ type: "joinRoom", roomId: "welcome" });
  await beta.until((msg) => msg.type === "room");
  alpha.send({ type: "say", text: "ping-from-a" });
  const heard = await beta.until((msg) => msg.type === "said" && msg.message.text === "ping-from-a");
  assert(heard.message.nick === aHello.user.nick, "room message lost its sender");

  const late = await open();
  late.send({ type: "guest", nick: `SmokeC${stamp.slice(-4)}` });
  await late.until((msg) => msg.type === "hello");
  late.send({ type: "joinRoom", roomId: "welcome" });
  const lateRoom = await late.until((msg) => msg.type === "room");
  assert(Array.isArray(lateRoom.messages) && lateRoom.messages.length === 0, "room history should not be replayed");

  alpha.send({ type: "pm", to: bHello.user.nick, text: "secret-hi" });
  const priv = await beta.until((msg) => msg.type === "pm" && msg.text === "secret-hi");
  assert(priv.from === aHello.user.nick, "private message sender mismatch");

  beta.send({ type: "ignore", nick: aHello.user.nick });
  await delay(80);
  alpha.send({ type: "say", text: "should-be-hidden" });
  assert(!(await bufferedHas(beta, "should-be-hidden")), "ignored message was delivered");

  const member = await open();
  member.send({ type: "guest", nick: `SmokeM${stamp.slice(-4)}` });
  await member.until((msg) => msg.type === "hello");
  member.send({ type: "createRoom", name: `Smoke ${stamp.slice(-4)}`, category: "Random", topic: "test" });
  const created = await member.until((msg) => msg.type === "room");
  assert(created.room.category === "Random", "created room did not open");

  assert(/^[a-f0-9]{32}$/.test(aHello.resume || ""), "resume token missing");
  const again = await open();
  again.send({ type: "resume", token: aHello.resume });
  const back = await again.until((msg) => msg.type === "hello");
  assert(back.user.nick === aHello.user.nick, "refresh did not restore the same user");

  const nope = await open();
  nope.send({ type: "resume", token: "a".repeat(32) });
  const nopeErr = await nope.until((msg) => msg.type === "error");
  assert(/sign in again/i.test(nopeErr.message), "bad resume token should fail");

  for (const c of [alpha, beta, late, member, again, nope]) c.ws.close();
  console.log("smoke ok");
}

async function bufferedHas(c, text) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    let msg;
    try {
      msg = await c.next(Math.max(30, deadline - Date.now()));
    } catch {
      return false;
    }
    if (msg.type === "said" && msg.message && msg.message.text === text) return true;
  }
  return false;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
