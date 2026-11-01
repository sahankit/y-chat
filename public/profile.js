"use strict";

(() => {
  const STORE_KEY = "ychat-profiles";
  const ACTIVE_KEY = "ychat-active";
  const MIN_PASSWORD = 8;

  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!parsed || typeof parsed.users !== "object" || !parsed.users) return { users: {} };
      return parsed;
    } catch {
      return { users: {} };
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  function bytesToHex(bytes) {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  async function hashPassword(password, saltHex) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 120000, hash: "SHA-256" },
      key,
      256,
    );
    return bytesToHex(new Uint8Array(bits));
  }

  function activeKey() {
    try {
      return localStorage.getItem(ACTIVE_KEY) || "";
    } catch {
      return "";
    }
  }

  function setActive(key) {
    try {
      if (key) localStorage.setItem(ACTIVE_KEY, key);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* private mode */ }
  }

  function profileForNick(nick) {
    const key = String(nick || "").toLowerCase();
    const store = readStore();
    return store.users[key] || null;
  }

  function isSignedInNick(nick) {
    const key = String(nick || "").toLowerCase();
    return activeKey() === key && !!readStore().users[key];
  }

  async function register(username, password) {
    const nick = String(username || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{1,15}$/.test(nick)) {
      return "Use 2–16 letters, numbers, or underscores, starting with a letter.";
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > 72) {
      return `Use a password of ${MIN_PASSWORD}–72 characters.`;
    }
    const key = nick.toLowerCase();
    if (key === "lobbybot") return "That name is reserved.";
    const store = readStore();
    if (store.users[key]) return "That name is already saved on this device. Sign in instead.";
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(password, salt);
    store.users[key] = { nick, salt, hash, buddies: [], statusMessage: "" };
    writeStore(store);
    setActive(key);
    return "";
  }

  async function login(username, password) {
    const nick = String(username || "").trim();
    const key = nick.toLowerCase();
    const store = readStore();
    const account = store.users[key];
    if (!account) return "No saved profile with that name on this device.";
    const hash = await hashPassword(password || "", account.salt);
    if (hash !== account.hash) return "That name and password don't match.";
    setActive(key);
    return "";
  }

  function signOutLocal() {
    setActive("");
  }

  function getBuddies() {
    const key = activeKey();
    if (!key) return [];
    const account = readStore().users[key];
    return account && Array.isArray(account.buddies) ? [...account.buddies] : [];
  }

  function setBuddies(list) {
    const key = activeKey();
    if (!key) return;
    const store = readStore();
    if (!store.users[key]) return;
    store.users[key].buddies = list;
    writeStore(store);
  }

  function addBuddy(nick) {
    const key = activeKey();
    if (!key) return "Sign in to save buddies on this device.";
    const buddyKey = String(nick || "").toLowerCase();
    if (buddyKey === key) return "That's you. Pick someone else.";
    if (buddyKey === "lobbybot") return "LobbyBot can't be added.";
    const store = readStore();
    const account = store.users[key];
    if (!account) return "Sign in again.";
    if (!account.buddies.includes(buddyKey)) account.buddies.push(buddyKey);
    writeStore(store);
    return "";
  }

  function removeBuddy(nick) {
    const key = activeKey();
    if (!key) return;
    const buddyKey = String(nick || "").toLowerCase();
    const store = readStore();
    const account = store.users[key];
    if (!account) return;
    account.buddies = account.buddies.filter((item) => item !== buddyKey);
    writeStore(store);
  }

  function saveStatusMessage(text) {
    const key = activeKey();
    if (!key) return;
    const store = readStore();
    if (!store.users[key]) return;
    store.users[key].statusMessage = String(text ?? "").slice(0, 60);
    writeStore(store);
  }

  function statusMessageForActive() {
    const key = activeKey();
    if (!key) return "";
    const account = readStore().users[key];
    return account ? account.statusMessage || "" : "";
  }

  window.YchatProfile = {
    register,
    login,
    signOutLocal,
    profileForNick,
    isSignedInNick,
    getBuddies,
    addBuddy,
    removeBuddy,
    saveStatusMessage,
    statusMessageForActive,
  };
})();
