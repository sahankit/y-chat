"use strict";

const { WebSocket } = require("ws");

const BASE = process.env.YCHAT_URL || "http://127.0.0.1:4317";
const WS = BASE.replace(/^http/, "ws");

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
  const health = await fetch(`${BASE}/health`);
  assert(health.ok, "health check failed");

  const privacy = await fetch(`${BASE}/privacy`);
  const terms = await fetch(`${BASE}/terms`);
  const sitemap = await fetch(`${BASE}/sitemap.xml`);
  assert(privacy.ok && terms.ok, "legal pages should load");
  const privacyText = await privacy.text();
  const termsText = await terms.text();
  const map = await sitemap.text();
  assert(privacyText.includes("Privacy") && privacyText.includes("/terms"), "privacy page incomplete");
  assert(termsText.includes("Terms") && termsText.includes("/privacy"), "terms page incomplete");
  assert(map.includes("/terms") && map.includes("/privacy"), "sitemap should list legal pages");
  assert(map.includes("/chat-rooms") && map.includes("/messenger"), "sitemap should list the guides");
  const roomsPage = await fetch(`${BASE}/chat-rooms`);
  const messengerPage = await fetch(`${BASE}/messenger`);
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

  const account = `Acct${stamp.slice(-5)}`;
  const member = await open();
  member.send({ type: "register", username: account, password: "secretpass" });
  const registered = await member.until((msg) => msg.type === "hello");
  assert(registered.user.guest === false, "account should not be a guest");
  member.send({ type: "addBuddy", nick: aHello.user.nick });
  const buddyErr = await member.until((msg) => msg.type === "error");
  assert(/account/i.test(buddyErr.message), "guest buddy add should fail");

  const taken = await open();
  taken.send({ type: "guest", nick: account });
  const takenErr = await taken.until((msg) => msg.type === "error");
  assert(/account/i.test(takenErr.message), "guest should not take a registered name");

  member.send({ type: "createRoom", name: `Smoke ${stamp.slice(-4)}`, category: "Random", topic: "test" });
  const created = await member.until((msg) => msg.type === "room");
  assert(created.room.category === "Random", "created room did not open");

  const wrong = await open();
  wrong.send({ type: "login", username: account, password: "nope" });
  const wrongErr = await wrong.until((msg) => msg.type === "error");
  assert(/don't match|do not match/i.test(wrongErr.message), "bad password should fail");

  assert(/^[a-f0-9]{32}$/.test(aHello.resume || ""), "resume token missing");
  const again = await open();
  again.send({ type: "resume", token: aHello.resume });
  const back = await again.until((msg) => msg.type === "hello");
  assert(back.user.nick === aHello.user.nick, "refresh did not restore the same user");

  const nope = await open();
  nope.send({ type: "resume", token: "a".repeat(32) });
  const nopeErr = await nope.until((msg) => msg.type === "error");
  assert(/sign in again/i.test(nopeErr.message), "bad resume token should fail");

  for (const c of [alpha, beta, late, member, taken, wrong, again, nope]) c.ws.close();
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
