import {
  generateWorld, applyRoads, plotIdAtPixel, worldClock, darkness,
  TILE, MAP_W, MAP_H, PLAYER_SPEED, RUN_MULT, WORLD_VERSION, DAY_MS,
} from '@shared/world.js';
import {
  canStand, inInterior, key, placementError, objAt, footprint, canRotate, levelView, wallSideAt,
  LEVELS, wallError, lineEdges, rectEdges, roofError, roofAt, edgeKey,
  indexPlots, landError, contentFits, mergedRect, splitRects, hasContent, LAND_PRICE,
  stepLevel, heightAt, roadEditError, roadIn, plotEntrance, occChanged,
} from '@shared/plot.js';
import { ITEMS, GOODS, CATEGORIES, cropStage, itemName } from '@shared/catalog.js';
import { NPCS } from '@shared/npcs.js';
import { itemIcon } from './sprites.js';
import { View, LEVEL_H } from './gfx/view.js';
import { Ghost, Outline } from './gfx/ghost.js';
import { Minimap } from './minimap.js';
import { roomTiles, roomRegion, extract, rotateTimes, fragmentValue, removeAt, stockFragment, placeError as fragError } from '@shared/blueprint.js';
import { STYLED_ROOMS } from '@shared/rooms.js';
import { NEEDS, HEALTH, ACTIVITIES, FOODS, PLATES, usesOf, mood } from '@shared/needs.js';
import { NPC_ACTS } from '@shared/village.js';
import { questProgress } from '@shared/quests.js';
import { RECIPES, STAFF, OPEN_HOURS, recipesFor, sellable, valueOf, slotsOf, isMachine, shopOpen } from '@shared/business.js';
import { drawFloor, drawObject } from './sprites.js';
import { openCreator, closeCreator } from './creator.js';
import { renderCity } from './cityui.js';
import { drawLook } from './people.js';
import { sanitizeLook, randomLook, PETS } from '@shared/look.js';
import { httpBase, signInGuest, signIn, signUp, getSession, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('tycoon.' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('tycoon.' + k) : localStorage.setItem('tycoon.' + k, v); } catch { /* private mode */ } },
};

// ---------- World & 3D view ----------
const world = generateWorld(undefined, { date: new Date() });
const view = new View($('game'), world);
const ghost = new Ghost(view.scene);
const outline = new Outline(view.scene);
const minimap = new Minimap($('minimap'), $('bigmap-canvas'));
const U = (px) => px / TILE; // world pixels -> 3D units

const S = {
  me: null,            // { id, name, color, x, y, dir, moving } (x, y in world pixels)
  players: new Map(),
  npcs: new Map(),
  plots: {},           // live plots by id, each with its own x, y, w, h
  coins: 0,
  inv: {},
  myPlot: null,
  username: null,
  guest: true,
  timeOffset: 0,
  epoch: 0,
  mode: 'walk',        // 'walk' | 'build'
  tool: { kind: 'wall', id: 'wall_white' },
  wallTool: 'line',    // 'line' | 'room'
  cat: 'build',
  rot: 0,
  level: 0,            // build level
  wallMode: 'cut',     // 'up' | 'cut' | 'down'
  connected: false,
  talk: null,
  freeBuild: false,    // bb.enablefreebuild
  freeLand: false,     // freerealestate on
};
const afford = (cost) => S.freeBuild || cost <= S.coins;
const serverNow = () => Date.now() + S.timeOffset;

// ---------- Networking ----------
let ws = null;
// The last character made in the creator on this device, and the one to send with the
// next hello (only straight after the creator, so other devices' edits aren't undone).
const look = (() => { try { return JSON.parse(store.get('creator')) || {}; } catch { return {}; } })();
look.name ||= store.get('name') || '';
let pendingLook = null;
let reconnectTimer = null;
let failures = 0;

function defaultServer() {
  const saved = store.get('server');
  if (saved) return saved;
  // Inside the Android app the page is served locally, so it needs the real address.
  if (window.Capacitor?.isNativePlatform?.()) return import.meta.env.VITE_SERVER_URL || 'ws://10.0.2.2:8787/ws';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}
let serverUrl = defaultServer();
const api = () => httpBase(serverUrl);

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function connect() {
  clearTimeout(reconnectTimer);
  const token = store.get('token');
  if (!token) return showJoin();
  let sock;
  try { sock = new WebSocket(`${serverUrl}?auth=${encodeURIComponent(token)}`); } catch { joinError('Bad server address'); return; }
  if (ws) { ws.onclose = null; ws.close(); }
  ws = sock;
  let opened = false;
  sock.onopen = () => { opened = true; failures = 0; send({ type: 'hello', ...(pendingLook || {}) }); };
  sock.onmessage = (ev) => { lastMsgAt = Date.now(); try { onMessage(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
  sock.onclose = async () => {
    if (ws !== sock) return;
    const wasConnected = S.connected;
    S.connected = false;
    if (!opened) {
      try {
        if (!(await getSession(api(), token))) { store.set('token', null); toast('Please sign in again'); return showJoin(); }
      } catch { /* offline: keep retrying */ }
    }
    if (wasConnected) toast('Connection lost — reconnecting…');
    if (!S.me) { joinError("Can't reach the server. Check the address and try again."); return; }
    failures++;
    // Back off (0.5 s, 2 s, 4 s, 8 s...) with some randomness, so after a server update
    // everyone doesn't reconnect in the same instant.
    const wait = failures === 1 ? 500 : Math.min(10000, 1000 * 2 ** Math.min(failures - 1, 3));
    reconnectTimer = setTimeout(connect, wait * (0.7 + Math.random() * 0.6));
  };
}

// The server sends something at least once a second. If it goes quiet (a dead Wi-Fi,
// the phone slept), drop the connection and reconnect instead of waiting minutes for
// the operating system to notice.
let lastMsgAt = Date.now();
function checkAlive(limit = 5000) {
  if (!S.connected || !ws || Date.now() - lastMsgAt < limit) return;
  lastMsgAt = Date.now();
  const sock = ws, lost = sock.onclose;
  sock.onclose = null; // run the reconnect once, now
  lost?.();
  try { sock.close(); } catch { /* already gone */ }
}
setInterval(() => { checkAlive(); if (S.connected) send({ type: 'ping' }); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAlive(4000); });
addEventListener('online', () => { if (!S.connected && S.me) { failures = 0; connect(); } });

function onMessage(m) {
  switch (m.type) {
    case 'welcome': {
      if (m.worldVersion !== WORLD_VERSION) toast('A new version of the game is available — please reload');
      S.timeOffset = m.serverTime - Date.now();
      S.epoch = m.epoch;
      const first = $('hud').hidden;
      S.me = { ...m.you, dir: 0, moving: false, level: m.you.level || 0 };
      S.coins = m.you.coins;
      S.inv = m.you.inv || {};
      S.myPlot = S.homePlot = m.you.plotId;
      S.username = m.you.username;
      S.library = m.you.library || [];
      S.needs = m.you.needs || null; S.act = null; S.stopSent = false;
      renderNeeds();
      S.guest = m.you.guest;
      store.set('guest', S.guest ? '1' : '0');
      store.set('name', m.you.name);
      look.name = m.you.name;
      pendingLook = null;
      S.players.clear();
      for (const p of m.players) S.players.set(p.id, { ...p, tx: p.x, ty: p.y });
      S.npcs.clear();
      for (const n of m.npcs) S.npcs.set(n.id, { ...n, tx: n.x, ty: n.y, moving: false, name: NPCS[n.id].name });
      applyRoads(world, m.roads);
      view.refreshTerrain();
      S.city = m.city;
      S.plots = {};
      for (const p of m.plots) S.plots[p.id] = p;
      indexPlots(world, S.plots);
      for (const id of [...view.plots.keys()]) if (!S.plots[id]) view.removePlot(id);
      plotsDirty = true;
      S.connected = true;
      $('join').hidden = true;
      $('hud').hidden = false;
      view.setTarget(U(S.me.x), U(S.me.y), true);
      view.zoomBy(1);
      updateHud();
      requestAnimationFrame(placeMinimap);
      if (first) {
        sysMsg(`Welcome, ${S.me.name}!`);
        if (S.myPlot == null) sysMsg('Find a plot with a FOR SALE sign to claim it. Rosa, Otto and Juniper are in the town square.');
        sysMsg('Tip: ⟲ ⟳ (or Q / E) turn the camera.');
      }
      break;
    }
    case 'look': {
      const p = m.id === S.me?.id ? S.me : S.players.get(m.id);
      if (p) Object.assign(p, { name: m.name, color: m.color, look: m.look });
      break;
    }
    case 'profile':
      Object.assign(S.me, { name: m.name, look: m.look, farm: m.farm, fav: m.fav });
      store.set('name', m.name);
      if (modalKind === 'settings' && settingsTab === 'me') showSettings('me');
      updateHud();
      break;
    case 'join':
      S.players.set(m.player.id, { ...m.player, tx: m.player.x, ty: m.player.y });
      sysMsg(`${m.player.name} arrived in the village`);
      break;
    case 'leave': {
      const p = S.players.get(m.id);
      if (p) sysMsg(`${p.name} went home`);
      S.players.delete(m.id);
      break;
    }
    case 'state':
      for (const [id, x, y, dir, moving, level, act, carry] of m.p) {
        const p = S.players.get(id);
        if (!p) continue;
        p.tx = x; p.ty = y; p.dir = dir; p.moving = !!moving; p.running = moving === 2; p.level = level || 0;
        p.act = act || 0;
        p.carry = carry || 0;
        // Keep a short history of where they were when, to play it back smoothly.
        const buf = (p.buf ||= []);
        const last = buf[buf.length - 1];
        if (last && m.t - last.t > 300) buf.push({ t: m.t - 100, x: last.x, y: last.y }); // was standing still
        buf.push({ t: m.t, x, y });
        if (buf.length > 12) buf.splice(0, buf.length - 12);
        if (Math.hypot(p.x - x, p.y - y) > 96) { p.x = x; p.y = y; }
      }
      for (const [id, x, y, dir, moving, act] of m.n || []) {
        const n = S.npcs.get(id);
        if (!n) continue;
        n.tx = x; n.ty = y; n.dir = dir; n.moving = !!moving; n.act = act || 0;
      }
      break;
    case 'pos':
      S.me.x = m.x; S.me.y = m.y; S.me.level = m.level || 0;
      break;
    case 'needs':
      S.needs = m.needs;
      S.carry = m.carry || null;
      S.me.carry = S.carry?.food || 0;
      if (S.act !== m.act) { S.act = m.act; S.stopSent = false; closeUseMenu(); }
      renderNeeds();
      break;
    case 'chat': {
      const who = m.id === S.me?.id ? S.me : S.players.get(m.id);
      if (who) { who.bubble = m.text; who.bubbleUntil = performance.now() + 6000; }
      chatMsg(m.to ? `${m.name} → ${m.to}` : m.name, m.text);
      break;
    }
    case 'npcBubble': {
      const n = S.npcs.get(m.id);
      if (n) { n.bubble = m.text; n.bubbleUntil = performance.now() + Math.min(9000, 2500 + m.text.length * 60); }
      break;
    }
    case 'npc': openTalk(m); break;
    case 'npcSay': npcSaid(m); break;
    case 'business':
      S.biz = m.biz;
      $('btn-shop').hidden = !S.biz;
      $('btn-editplot').hidden = !(S.biz?.plotId != null && S.homePlot != null);
      updateHud();
      if (modalKind === 'shop') showShop();
      if (modalKind === 'city') showCity();
      break;
    case 'sale': saleFx(m); break;
    case 'questOffer':
      if (S.talk && S.talk.npc === m.quest.npc) { S.talk.offer = m.quest; renderQuestCard(); }
      break;
    case 'quests':
      S.quests = m.quests; S.stats = m.stats || {};
      $('btn-quests').dataset.n = S.quests.length || '';
      if (S.talk) renderQuestCard();
      if (modalKind === 'quests') showQuests();
      break;
    case 'plot':
      S.plots[m.plot.id] = m.plot;
      indexPlots(world, S.plots);
      plotsDirty = true;
      if (m.plot.id === S.myPlot) S.dropped = null;
      if (S.stockRedraw && (modalKind === 'stock' || modalKind === 'browse')) S.stockRedraw();
      if (S.mode === 'build') refreshPreview();
      break;
    case 'city':
      S.city = m.city;
      if (modalKind === 'city') showCity();
      toolInfo();
      break;
    case 'roads':
      applyRoads(world, m.roads);
      view.refreshTerrain();
      plotsDirty = true;
      if (S.mode === 'build') refreshPreview();
      break;
    case 'plotRemoved':
      delete S.plots[m.id];
      indexPlots(world, S.plots);
      view.removePlot(m.id);
      break;
    case 'console':
      consoleLine(m.text);
      break;
    case 'freebuild':
      S.freeBuild = m.on;
      toolInfo();
      refreshTrayAffordability();
      break;
    case 'coins':
      S.coins = m.coins;
      updateHud();
      if (S.talk?.extra) renderExtra();
      break;
    case 'inv':
      S.inv = m.inv;
      updateHud();
      if (S.stockRedraw && modalKind === 'stock') S.stockRedraw();
      if (S.mode === 'build' && S.cat === 'special') renderItems();
      if (S.talk?.extra) renderExtra();
      if (modalKind === 'bag') showBag();
      break;
    case 'claimed':
      S.myPlot = S.homePlot = m.plotId;
      updateHud();
      toast('🏡 This plot is yours! Tap Build to start your home.');
      break;
    case 'harvested': {
      const parts = Object.entries(m.items).map(([k, n]) => `${n} ${GOODS[k].icon}`);
      toast(`🌾 Harvested ${parts.join(' ')} — sell them at Rosa’s Market`);
      break;
    }
    case 'toast':
      toast(m.text);
      break;
    case 'library':
      S.library = m.library;
      if (S.mode === 'build' && S.cat === 'library') renderItems();
      break;
    case 'error':
      toast(m.msg);
      if (S.dropped) { S.dropped = null; plotsDirty = true; }
      if (S.talk?.waiting) { S.talk.waiting = false; renderLog(); }
      break;
  }
}

// ---------- Join screen & accounts ----------
let joinMode = 'guest';
$('server').value = serverUrl;

const HINTS = {
  guest: 'Jump straight in. You can save your progress to an account any time from the 👤 menu.',
  login: 'Log in to get your plot back on this device.',
  register: 'Create an account so your plot follows you to any device.',
};
function setJoinMode(mode) {
  joinMode = mode;
  for (const b of $('modes').children) b.classList.toggle('sel', b.dataset.mode === mode);
  $('cred').hidden = mode === 'guest';
  for (const l of $('cred').querySelectorAll('[data-for]')) l.hidden = l.dataset.for !== mode;
  $('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  let hint = HINTS[mode];
  if (mode === 'login' && store.get('token') && store.get('guest') === '1') hint += ' The guest village on this device will be released.';
  $('modehint').textContent = hint;
  $('enter').textContent = mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Enter the world';
  joinError('');
}
for (const b of $('modes').children) b.onclick = () => setJoinMode(b.dataset.mode);

function showJoin() {
  S.me = null;
  S.connected = false;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  closeTalk(); closeModal(); setMode('walk');
  $('hud').hidden = true;
  $('join').hidden = false;
  const token = store.get('token');
  $('saved').hidden = !token;
  $('fresh').hidden = !!token;
  $('savedname').textContent = store.get('name') || 'Villager';
  setJoinMode(joinMode);
}
function joinError(t) { $('joinerr').textContent = t; }

$('continue').onclick = () => { readServerField(); joinError('Connecting…'); connect(); };
$('switch').onclick = () => { $('saved').hidden = true; $('fresh').hidden = false; setJoinMode('login'); };

function readServerField() {
  const v = $('server').value.trim();
  if (v && v !== serverUrl) { serverUrl = v; store.set('server', v); }
}

// Guests and new accounts make their character first; logging in keeps the saved one.
$('enter').onclick = () => {
  readServerField();
  if (joinMode === 'login') return join(null);
  joinError('');
  openCreator({
    ...look, mode: 'new',
    onDone: (c) => {
      Object.assign(look, c);
      store.set('creator', JSON.stringify(look));
      join(c);
    },
  });
};

async function join(created) {
  const btn = $('enter');
  if (btn.disabled) return;
  btn.disabled = true;
  joinError(joinMode === 'guest' ? 'Connecting…' : 'Checking…');
  try {
    const guestToken = store.get('guest') === '1' ? store.get('token') : null;
    let res;
    if (joinMode === 'guest') {
      res = guestToken ? { token: guestToken } : await signInGuest(api());
    } else if (joinMode === 'login') {
      res = await signIn(api(), $('login').value.trim(), $('password').value, guestToken);
    } else {
      res = await signUp(api(), { email: $('email').value.trim(), username: $('username').value.trim(), password: $('password').value, name: created.name }, guestToken);
    }
    if (!res.token) throw new Error('The server did not return a session');
    store.set('token', res.token);
    store.set('guest', joinMode === 'guest' ? '1' : '0');
    $('password').value = '';
    pendingLook = created;
    connect();
  } catch (e) {
    joinError(e.message);
  } finally {
    btn.disabled = false;
  }
}
for (const id of ['login', 'password', 'email', 'username']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('enter').click(); });

// ---------- HUD ----------
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function addLog(html, cls) {
  const d = document.createElement('div');
  d.innerHTML = html;
  if (cls) d.className = cls;
  const log = $('chatlog');
  log.appendChild(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => d.classList.add('old'), 15000);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chatMsg = (name, text) => addLog(`<b>${esc(name)}:</b> ${esc(text)}`);
const sysMsg = (text) => addLog(esc(text), 'sys');

function updateHud() {
  $('coins').textContent = `🪙 ${S.coins}`;
  syncBuildBtn();
  refreshTrayAffordability();
}

function fmtClock() {
  const { dayOfYear: day, year, shownHours: h, minutes: mi } = worldClock(serverNow(), S.epoch);
  const h12 = ((h + 11) % 12) + 1;
  return `Y${year} Day ${day} · ${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function nearestNpc(range = TILE * 2.6) {
  let best = null, bd = range;
  for (const n of S.npcs.values()) {
    if (NPC_ACTS[n.act]?.hidden) continue; // asleep indoors
    const d = Math.hypot(n.x - S.me.x, n.y - S.me.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

let lastAction = '';
function updateContext() {
  if (!S.me) return;
  $('clock').textContent = fmtClock();
  syncBuildBtn();
  const here = plotIdAtPixel(world, S.me.x, S.me.y);
  const plot = here >= 0 ? S.plots[here] : null;
  let action = '';
  const npc = nearestNpc();
  const usable = S.mode === 'walk' && !S.talk && !S.act ? nearestUsable() : null;
  if (S.mode !== 'walk' || S.talk) action = '';
  else if (S.act) action = `stop:${S.act}`;
  else if (npc) action = `talk:${npc.id}`;
  else if (usable) action = `use:${usable.plot.id}:${usable.level}:${usable.key}`;
  else if (S.carry) action = `eatHere:${S.carry.food}`;
  else if (nearMyPet()) action = 'pet';
  else if (plot && !plot.owner && S.homePlot == null) action = 'claim';
  else if (plot && !plot.owner && S.biz && S.biz.plotId == null) action = 'claimShop';
  else if (here === S.myPlot && here >= 0) {
    const ripe = Object.values(plot.obj).filter((o) => ITEMS[o.t]?.crop && cropStage(o, serverNow()) === 3).length;
    if (ripe) action = `harvest:${ripe}`;
  }
  if (action !== lastAction) {
    lastAction = action;
    const btn = $('action');
    btn.hidden = !action;
    if (action === 'claim') btn.textContent = '🏡 Claim this plot';
    else if (action === 'claimShop') btn.textContent = `🏪 Open my shop here (🪙${plot.w * plot.h * landPrice()})`;
    else if (action.startsWith('harvest')) btn.textContent = `🌾 Harvest (${action.split(':')[1]})`;
    else if (action.startsWith('talk')) btn.textContent = `💬 Talk to ${NPCS[action.split(':')[1]].name}`;
    else if (action === 'pet') btn.textContent = `🐾 Pet your ${PETS[petOf(S.me)].kind}`;
    else if (action.startsWith('eatHere')) { const pl = PLATES[S.carry.food]; btn.textContent = `${pl.icon} Eat ${pl.name.toLowerCase()} here`; }
    else if (action.startsWith('stop')) { const a = ACTIVITIES[S.act]; btn.textContent = `${a.icon} ${a.verb}… ✋ Stop`; }
    else if (action.startsWith('use')) {
      const u = usable, a = actInfo(u.uses[0]);
      btn.textContent = u.uses.length > 1 ? `${a.icon} ${ITEMS[u.t].name}…` : `${a.icon} ${a.label}${a.cost ? ` · 🪙${a.cost}` : ''}`;
    }
    btn.classList.toggle('busy', action.startsWith('stop'));
  }
  syncPlots();
}
$('action').onclick = () => {
  if (lastAction.startsWith('stop')) { send({ type: 'stop' }); return; }
  if (lastAction.startsWith('eatHere')) { send({ type: 'use', act: 'eatHere' }); return; }
  if (lastAction.startsWith('use')) {
    const u = nearestUsable();
    if (!u) return;
    if (u.uses.length === 1) useThing(u, u.uses[0]);
    else { const r = $('action').getBoundingClientRect(); openUseMenu(u, r.left + r.width / 2, r.top - 8); }
    return;
  }
  if (lastAction === 'claim') send({ type: 'claim', plotId: plotIdAtPixel(world, S.me.x, S.me.y) });
  else if (lastAction === 'claimShop') send({ type: 'claim', plotId: plotIdAtPixel(world, S.me.x, S.me.y), business: true });
  else if (lastAction.startsWith('harvest')) send({ type: 'harvest', plotId: S.myPlot });
  else if (lastAction.startsWith('talk')) send({ type: 'npcOpen', npc: lastAction.split(':')[1] });
  else if (lastAction === 'pet') { const p = nearMyPet(); if (p) { p.heartUntil = performance.now() + 2200; p.idle = 2; } }
};

$('btn-build').onclick = () => setMode(S.mode === 'build' ? 'walk' : 'build');
// Your own plot under your feet (home or shop), or null.
function ownPlotHere() {
  if (!S.me) return null;
  const id = plotIdAtPixel(world, S.me.x, S.me.y);
  return id >= 0 && S.plots[id]?.owner === S.me.id ? id : null;
}
// Build only shows while you're on land you can build on (and while building, to leave).
function syncBuildBtn() {
  const show = S.mode === 'build' || ownPlotHere() != null;
  if ($('btn-build').hidden === show) $('btn-build').hidden = !show;
}
$('btn-done').onclick = () => setMode('walk');
$('btn-chat').onclick = () => openChat();
$('btn-bag').onclick = () => (modalKind === 'bag' ? closeModal() : showBag());
$('btn-settings').onclick = () => (modalKind === 'settings' ? closeModal() : showSettings());
$('cam-left').onclick = () => turnCamera(-1);
$('cam-right').onclick = () => turnCamera(1);
$('zoom-in').onclick = () => view.zoomBy(1 / 1.25);
$('zoom-out').onclick = () => view.zoomBy(1.25);
function turnCamera(d) { view.rotate(d); }

function openChat() {
  $('chatform').hidden = false;
  $('chatinput').focus();
}
$('chatform').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatinput').value.trim();
  if (text) send({ type: 'chat', text });
  $('chatinput').value = '';
  $('chatform').hidden = true;
  $('chatinput').blur();
};
$('chatinput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('chatform').hidden = true; $('chatinput').blur(); }
  e.stopPropagation();
});

// ---------- NPC conversations & shops ----------
function openTalk(v) {
  closeModal();
  setMode('walk');
  const def = NPCS[v.npc];
  if (!S.talk || S.talk.npc !== v.npc) {
    S.talk = { npc: v.npc, view: v, extra: null, waiting: false, lines: [] };
    $('npc-name').textContent = `${def.icon} ${def.name}`;
    $('npc-role').textContent = def.role;
    drawLook($('npc-portrait'), def.look, { crop: 'bust' });
  }
  S.talk.view = v;
  S.talk.offer = null;
  $('npc-role').textContent = v.doing ? `${def.role} · ${v.doing}` : def.role;
  if (v.say) S.talk.lines.push({ who: 'them', text: v.say });
  $('npcpanel').hidden = false;
  $('npc-shop').hidden = !(v.sells.length || v.buys.length);
  $('npc-city').hidden = !def.clerk;
  renderStatus(); renderLog(); renderExtra(); renderQuestCard();
}

// Requests in the talk panel: a new one they're asking for, or yours in progress.
function renderQuestCard() {
  const box = $('npc-quest');
  if (!S.talk) return;
  const npc = S.talk.npc;
  const mine = (S.quests || []).filter((q) => q.npc === npc);
  const offer = S.talk.offer;
  box.innerHTML = '';
  box.hidden = !offer && !mine.length;
  if (offer) {
    const c = document.createElement('div');
    c.className = 'qcard offer';
    c.innerHTML = `<b>📜 ${esc(NPCS[npc].name)} asks a favour</b><p>“${esc(offer.text)}”</p><small>${esc(offer.goal)} · reward 🪙${offer.reward}</small>`;
    const row = document.createElement('div'); row.className = 'row';
    const yes = document.createElement('button'); yes.className = 'chip'; yes.textContent = '👍 Sure!';
    yes.onclick = () => { send({ type: 'questAccept', id: offer.id }); S.talk.offer = null; renderQuestCard(); };
    const no = document.createElement('button'); no.className = 'chip'; no.textContent = 'Not today';
    no.onclick = () => { send({ type: 'questDecline', id: offer.id }); S.talk.offer = null; renderQuestCard(); };
    row.append(yes, no); c.appendChild(row); box.appendChild(c);
  }
  for (const q of mine) {
    const pr = localProgress(q);
    const c = document.createElement('div');
    c.className = 'qcard';
    c.innerHTML = `<b>📜 ${esc(q.goal)}</b><small>${pr.have}/${pr.need} · 🪙${q.reward}</small>`;
    if (q.kind !== 'visit') {
      const b = document.createElement('button'); b.className = 'chip'; b.disabled = !pr.ready;
      b.textContent = pr.ready ? (q.kind === 'deliver' ? '🎁 Hand it over' : '✅ Tell them it’s done') : '⏳ Not done yet';
      b.onclick = () => send({ type: 'questTurnIn', id: q.id });
      c.appendChild(b);
    }
    box.appendChild(c);
  }
}
// Progress worked out from what this client knows (bag, house, activity counts).
function localProgress(q) {
  return questProgress(q, { inv: S.inv, stats: S.stats || {}, plot: S.plots[S.myPlot] });
}

// The quest log: everything villagers have asked of you.
function showQuests() {
  const body = openModal('quests', '📜 Requests');
  const qs = S.quests || [];
  if (!qs.length) body.insertAdjacentHTML('beforeend', '<p class="muted">No requests right now. Chat with villagers: they’ll often ask for a favour (once a day each).</p>');
  for (const q of qs) {
    const pr = localProgress(q);
    const c = document.createElement('div');
    c.className = 'qcard';
    c.innerHTML = `<b>${NPCS[q.npc].icon} ${esc(NPCS[q.npc].name)}: ${esc(q.goal)}</b><p>“${esc(q.text)}”</p><small>${pr.ready ? '✅ Ready to hand in' : `${pr.have}/${pr.need}`} · reward 🪙${q.reward}</small>`;
    const drop = document.createElement('button'); drop.className = 'chip'; drop.textContent = 'Give up';
    drop.onclick = () => { if (confirm('Give up on this request?')) send({ type: 'questAbandon', id: q.id }); };
    c.appendChild(drop);
    body.appendChild(c);
  }
}
$('btn-quests').onclick = () => (modalKind === 'quests' ? closeModal() : showQuests());

function npcSaid(m) {
  if (!S.talk || S.talk.npc !== m.npc) return;
  S.talk.waiting = false;
  S.talk.view = { ...S.talk.view, ...m };
  S.talk.lines.push({ who: 'them', text: m.text });
  for (const c of m.changes || []) S.talk.lines.push({ who: 'note', text: `✨ ${c}` });
  renderStatus(); renderLog(); renderExtra();
}

function closeTalk() {
  if (S.talk) send({ type: 'npcClose', npc: S.talk.npc });
  S.talk = null;
  $('npcpanel').hidden = true;
  $('npc-input').blur();
}
$('npc-close').onclick = closeTalk;

function renderStatus() {
  const v = S.talk.view;
  const hearts = Math.max(0, Math.min(5, Math.round((v.affinity + 100) / 40)));
  const parts = [
    `<span>${v.mood.emoji} ${esc(v.mood.label)}</span>`,
    `<span title="Friendship">${'❤️'.repeat(hearts)}${'🤍'.repeat(5 - hearts)} ${esc(v.friendship)}</span>`,
    ...v.personality.map((w) => `<span class="trait">${esc(w)}</span>`),
  ];
  if (v.likes) parts.push(`<span>💝 loves ${esc(v.likes.join(', '))}</span>`);
  $('npc-status').innerHTML = parts.join('');
}

function renderLog() {
  const log = $('npc-log');
  log.innerHTML = '';
  for (const l of S.talk.lines.slice(-30)) {
    const d = document.createElement('div');
    d.className = `line ${l.who}`;
    d.textContent = l.text;
    log.appendChild(d);
  }
  if (S.talk.waiting) {
    const d = document.createElement('div');
    d.className = 'thinking';
    d.textContent = `${NPCS[S.talk.npc].name} is thinking…`;
    log.appendChild(d);
  }
  log.scrollTop = log.scrollHeight;
}

const iconCache = {};
function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
function iconFor(id) {
  if (!iconCache[id]) {
    const d = ITEMS[id];
    iconCache[id] = d && ['wall', 'feature', 'roof'].includes(d.layer) ? swatchIcon(id) : itemIcon(id);
  }
  return cloneCanvas(iconCache[id]);
}
// Icons for wall materials, doors/windows and roofs.
function swatchIcon(id) {
  const d = ITEMS[id];
  const c = document.createElement('canvas');
  c.width = c.height = 44;
  const g = c.getContext('2d');
  if (d.layer === 'wall') { g.fillStyle = d.color; g.fillRect(6, 4, 32, 36); g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 8; y < 40; y += 6) g.fillRect(6, y, 32, 1); g.strokeStyle = '#3a2716'; g.lineWidth = 2; g.strokeRect(6, 4, 32, 36); }
  else if (d.layer === 'roof') { g.fillStyle = d.color; g.beginPath(); g.moveTo(4, 36); g.lineTo(22, 8); g.lineTo(40, 36); g.fill(); g.strokeStyle = '#3a2716'; g.lineWidth = 2; g.stroke(); }
  else {
    g.fillStyle = '#ece4d2'; g.fillRect(4, 4, 36, 36); g.strokeStyle = '#3a2716'; g.lineWidth = 2; g.strokeRect(4, 4, 36, 36);
    if (id === 'window_shop') { g.fillStyle = '#3a4048'; g.fillRect(6, 6, 32, 32); g.fillStyle = '#8fd0f0'; g.fillRect(8, 8, 28, 24); g.fillStyle = '#c7ecfa'; g.fillRect(10, 10, 6, 14); g.fillStyle = '#3a4048'; g.fillRect(8, 14, 28, 2); }
    else if (id === 'door_shop' || id === 'door_shopdouble') {
      const two = id === 'door_shopdouble';
      g.fillStyle = '#3a4048'; g.fillRect(two ? 6 : 12, 6, two ? 32 : 20, 34);
      g.fillStyle = '#8fd0f0'; if (two) { g.fillRect(9, 12, 12, 25); g.fillRect(23, 12, 12, 25); } else g.fillRect(15, 12, 14, 25);
      g.fillStyle = '#f5c542'; g.fillRect(two ? 17 : 16, 24, two ? 10 : 12, 2);
    } else if (id === 'door_double') {
      g.fillStyle = '#9b6436'; g.fillRect(6, 8, 15, 32); g.fillRect(23, 8, 15, 32);
      g.fillStyle = '#8fd0f0'; g.fillRect(9, 11, 9, 13); g.fillRect(26, 11, 9, 13);
      g.fillStyle = '#4a2e18'; g.fillRect(21, 8, 2, 32); g.fillStyle = '#f5c542'; g.fillRect(18, 26, 2, 3); g.fillRect(24, 26, 2, 3);
    } else if (id.startsWith('window')) { g.fillStyle = '#8fd0f0'; g.fillRect(12, id === 'window' ? 10 : 6, 20, id === 'window' ? 16 : 28); g.fillStyle = '#4a2e18'; g.fillRect(21, 8, 2, 30); }
    else if (id === 'arch') { g.fillStyle = '#5a3a1e'; g.fillRect(12, 10, 20, 30); }
    else { g.fillStyle = '#9b6436'; g.fillRect(12, 8, 20, 32); if (id === 'door_glass') { g.fillStyle = '#8fd0f0'; g.fillRect(15, 12, 14, 16); } g.fillStyle = '#f5c542'; g.fillRect(27, 24, 3, 3); }
  }
  return c;
}
function itemThumb(id) {
  if (GOODS[id]) { const s = document.createElement('span'); s.className = 'emo'; s.textContent = GOODS[id].icon; return s; }
  return iconFor(id);
}
function itemRow(id, sub, buttons) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.appendChild(itemThumb(id));
  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.innerHTML = `${esc(itemName(id))}<small>${esc(sub)}</small>`;
  row.appendChild(nm);
  for (const [label, fn, disabled] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = !!disabled;
    b.onclick = fn;
    row.appendChild(b);
  }
  return row;
}

function renderExtra() {
  const box = $('npc-extra');
  const t = S.talk;
  $('npc-shop').classList.toggle('sel', t?.extra === 'shop');
  $('npc-gift').classList.toggle('sel', t?.extra === 'gift');
  if (!t?.extra) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'list';
  if (t.extra === 'shop') {
    if (t.view.sells.length) {
      list.insertAdjacentHTML('beforeend', '<h4>For sale</h4>');
      for (const s of t.view.sells) {
        const owned = S.inv[s.item] || 0;
        const sub = `${ITEMS[s.item] ? 'Furniture' : 'Gift'}${owned ? ` · you have ${owned}` : ''}`;
        list.appendChild(itemRow(s.item, sub, [[`Buy 🪙${s.price}`, () => send({ type: 'buy', npc: t.npc, item: s.item }), s.price > S.coins]]));
      }
    }
    if (t.view.buys.length) {
      list.insertAdjacentHTML('beforeend', '<h4>Buying</h4>');
      for (const b of t.view.buys) {
        const have = S.inv[b.item] || 0;
        list.appendChild(itemRow(b.item, `🪙${b.price} each · you have ${have}`, [
          ['Sell 1', () => send({ type: 'sell', npc: t.npc, item: b.item, qty: 1 }), !have],
          ['Sell all', () => send({ type: 'sell', npc: t.npc, item: b.item, qty: have }), !have],
        ]));
      }
    }
    list.insertAdjacentHTML('beforeend', '<p class="muted">Prices depend on how generous they feel — and how much they like you.</p>');
  } else {
    const gifts = Object.entries(S.inv).filter(([k]) => GOODS[k]);
    if (!gifts.length) list.insertAdjacentHTML('beforeend', '<p class="muted">Your bag has nothing to give. Rosa sells gifts, and crops make nice presents too.</p>');
    for (const [k, n] of gifts) {
      list.appendChild(itemRow(k, `you have ${n}`, [['Give', () => {
        if (t.waiting) return;
        t.waiting = true;
        t.lines.push({ who: 'me', text: `🎁 gives ${GOODS[k].name}` });
        t.extra = null;
        renderLog(); renderExtra();
        send({ type: 'gift', npc: t.npc, item: k });
      }]]));
    }
  }
  box.appendChild(list);
}
$('npc-city').onclick = () => showCity();
$('npc-shop').onclick = () => { S.talk.extra = S.talk.extra === 'shop' ? null : 'shop'; renderExtra(); };
$('npc-gift').onclick = () => { S.talk.extra = S.talk.extra === 'gift' ? null : 'gift'; renderExtra(); };
$('npc-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('npc-input').value.trim();
  if (!text || !S.talk || S.talk.waiting) return;
  S.talk.lines.push({ who: 'me', text });
  S.talk.waiting = true;
  $('npc-input').value = '';
  renderLog();
  send({ type: 'npcTalk', npc: S.talk.npc, text });
};
$('npc-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTalk(); e.stopPropagation(); });

// ---------- Modal: bag and account ----------
let modalKind = null;
function openModal(kind, title) {
  modalKind = kind;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = '';
  $('modal').hidden = false;
  return $('modal-body');
}
function closeModal() { modalKind = null; $('modal').hidden = true; }
$('modal-close').onclick = closeModal;

function showCity() {
  const keep = modalKind === 'city' ? $('modal-body').scrollTop : 0;
  const body = openModal('city', '🏛️ City Hall');
  renderCity(body, { city: S.city, me: S.me, myPlot: S.homePlot ?? S.myPlot, plots: S.plots, biz: S.biz, send, rerender: showCity });
  body.scrollTop = keep;
}

function showBag() {
  const body = openModal('bag', '🎒 Your bag');
  const entries = Object.entries(S.inv);
  if (!entries.length) body.insertAdjacentHTML('beforeend', '<p class="muted">Empty. Harvest crops, or buy gifts and furniture in the town square.</p>');
  const list = document.createElement('div');
  list.className = 'list';
  for (const [k, n] of entries) {
    const sub = ITEMS[k] ? 'Furniture · place it from the Bag tab in Build mode' : GOODS[k].kind === 'produce' ? 'Crop · Rosa buys these, or sell them in your shop' : GOODS[k].kind === 'product' ? 'Homemade · sell it in your shop or to Rosa' : 'Gift · give it to a villager';
    const food = FOODS[k];
    const gives = food ? Object.entries(food).map(([nd, v]) => `+${v} ${(NEEDS.find((x) => x.id === nd) || HEALTH).icon}`).join(' ') : '';
    list.appendChild(itemRow(k, `×${n} · ${sub}${gives ? ` · eat: ${gives}` : ''}`, food ? [['😋 Eat', () => { send({ type: 'eat', item: k }); closeModal(); }]] : []));
  }
  body.appendChild(list);
}

function showMe() { showSettings('me'); }
function renderMe(body) {
  const card = document.createElement('div');
  card.className = 'me-card';
  const pic = document.createElement('canvas');
  pic.className = 'portrait'; pic.width = 64; pic.height = 64;
  drawLook(pic, S.me.look, { crop: 'bust' });
  const info = document.createElement('div');
  info.className = 'grow';
  info.innerHTML = `<b>${esc(S.me.name)}</b>${S.me.farm ? `<div class="muted">${esc(S.me.farm)} Farm</div>` : ''}${S.me.fav ? `<div class="muted">Favorite thing: ${esc(S.me.fav)}</div>` : ''}`;
  const edit = document.createElement('button');
  edit.className = 'chip';
  edit.textContent = '✂️ Change look';
  edit.onclick = () => {
    closeModal();
    openCreator({
      name: S.me.name, look: S.me.look, farm: S.me.farm, fav: S.me.fav, mode: 'edit',
      onDone: (c) => { Object.assign(look, c); store.set('creator', JSON.stringify(look)); send({ type: 'setLook', ...c }); },
    });
  };
  card.append(pic, info, edit);
  body.appendChild(card);
  if (!S.guest) {
    body.insertAdjacentHTML('beforeend', `<p>Signed in as <b>@${esc(S.username || '')}</b>. Your plot, bag and friendships are saved to your account. Log in on any device to pick up where you left off.</p>`);
    const out = document.createElement('button');
    out.className = 'primary';
    out.textContent = 'Log out';
    out.onclick = async () => {
      const token = store.get('token');
      store.set('token', null);
      closeModal();
      await signOut(api(), token);
      showJoin();
    };
    body.appendChild(out);
    return;
  }
  body.insertAdjacentHTML('beforeend', '<p>You’re playing as a <b>guest</b>. Create an account to keep your plot, coins and friendships and play on any device.</p>');
  const form = document.createElement('form');
  form.innerHTML = `
    <input name="email" type="email" placeholder="Email" autocomplete="email" autocapitalize="off" required>
    <input name="username" placeholder="Username" maxlength="16" autocomplete="username" autocapitalize="off" required>
    <input name="password" type="password" placeholder="Password (6+ characters)" autocomplete="new-password" required>
    <div class="err"></div>
    <button class="primary">Save my village</button>`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const err = form.querySelector('.err');
    err.textContent = 'Saving…';
    try {
      const res = await signUp(api(), { email: f.get('email').trim(), username: f.get('username').trim(), password: f.get('password'), name: S.me.name }, store.get('token'));
      store.set('token', res.token);
      store.set('guest', '0');
      closeModal();
      toast('🎉 Account created — your village is saved!');
      connect();
    } catch (ex) { err.textContent = ex.message; }
  };
  body.appendChild(form);
  const other = document.createElement('button');
  other.className = 'link';
  other.textContent = 'I already have an account';
  other.onclick = () => { closeModal(); showJoin(); $('saved').hidden = true; $('fresh').hidden = false; setJoinMode('login'); };
  body.appendChild(other);
}

// ---------- Build mode (Sims-style) ----------
const LAYER_KIND = { wall: 'wall', feature: 'feature', floor: 'floor', roof: 'roof', obj: 'obj' };
const toolOf = (id) => ({ kind: LAYER_KIND[ITEMS[id].layer], id });

function renderTabs() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  const all = [{ id: 'land', name: '🗺️ Land' }, ...CATEGORIES, { id: 'library', name: '📚 Rooms & Library' }, { id: 'special', name: '🎒 Bag' }];
  for (const c of all) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.className = S.cat === c.id && !STRIP_TOOLS.includes(S.tool.kind) ? 'sel' : '';
    b.onclick = () => {
      if (c.id === 'library') { S.cat = 'library'; S.tool = { kind: 'none' }; }
      else if (c.id === 'land') {
        S.cat = 'land'; S.tool = { kind: 'resize' };
        const p = myDef();
        view.zoom = Math.max(view.zoom, Math.min(70, p.w + 10)); view.zoomBy(1);
      } else {
        S.cat = c.id;
        const first = Object.keys(ITEMS).find((k) => ITEMS[k].cat === c.id && (c.id !== 'special' || S.inv[k]));
        S.tool = first ? toolOf(first) : { kind: 'none' };
      }
      renderTabs();
      renderItems();
    };
    tabs.appendChild(b);
  }
}

function renderItems() {
  const box = $('items');
  box.innerHTML = '';
  updateRotateBtn();
  toolInfo();
  if (STRIP_TOOLS.includes(S.tool.kind)) {
    box.insertAdjacentHTML('beforeend', `<div style="padding:12px 8px;font-size:14px;max-width:640px">${STRIP_HELP[S.tool.kind]}</div>`);
    return;
  }
  if (S.cat === 'library') { renderLibrary(box); return; }
  if (S.cat === 'land') {
    for (const [k, icon, label] of [['resize', '↔️', 'Resize'], ['merge', '🔗', 'Merge'], ['split', '✂️', 'Split'], ['pave', '🛣️', 'Pave road'], ['dig', '⛏️', 'Dig up road']]) {
      const b = document.createElement('button');
      b.dataset.tool = k;
      b.className = S.tool.kind === k ? 'sel' : '';
      b.innerHTML = `<span style="font-size:26px;line-height:44px">${icon}</span><span>${label}</span>`;
      b.onclick = () => { S.tool = { kind: k }; renderItems(); };
      box.appendChild(b);
    }
    return;
  }
  if (S.cat === 'build') {
    const seg = document.createElement('div');
    seg.className = 'seg2';
    for (const [k, label] of [['line', '▬ Wall'], ['room', '▢ Room'], ['chain', '⌁ Custom'], ['paint', '🖌 Paint']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = S.wallTool === k ? 'sel' : '';
      b.onclick = () => { S.wallTool = k; S.chain = null; renderItems(); };
      seg.appendChild(b);
    }
    box.appendChild(seg);
  }
  let any = false;
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.cat !== S.cat) continue;
    if (def.shop && !S.inv[id]) continue;
    any = true;
    const b = document.createElement('button');
    b.dataset.id = id;
    b.className = id === S.tool.id ? 'sel' : '';
    b.appendChild(iconFor(id));
    const [w, h] = footprint(id, 0);
    b.title = `${def.name} · ${def.shop ? `×${S.inv[id]} in your bag` : `🪙${def.price}`}${w * h > 1 ? ` · ${w}×${h}` : ''}${canRotate(id) ? ' · rotatable' : ''}${def.light ? ' · glows at night' : ''}${def.solid ? '' : ' · walk-through'}`;
    const size = def.layer === 'obj' && w * h > 1 ? ` · ${w}×${h}` : '';
    const unit = def.layer === 'wall' ? '/wall' : def.layer === 'roof' || def.layer === 'floor' ? '/tile' : '';
    b.insertAdjacentHTML('beforeend', def.shop
      ? `<span>${esc(def.name)}</span><span class="count">×${S.inv[id]}${size}</span>`
      : `<span>${esc(def.name)}</span><span class="price">🪙${def.price}${unit}${size}</span>`);
    b.onclick = () => {
      S.tool = toolOf(id);
      if (!canRotate(id)) S.rot = 0;
      for (const o of box.querySelectorAll('button[data-id]')) o.classList.toggle('sel', o === b);
      updateRotateBtn();
      toolInfo();
    };
    box.appendChild(b);
  }
  if (S.cat === 'roof') {
    const b = document.createElement('button');
    b.dataset.id = 'roof_remove';
    b.className = S.tool.kind === 'roofRemove' ? 'sel' : '';
    b.innerHTML = '<span style="font-size:28px;line-height:44px">🧹</span><span>Remove roof</span>';
    b.onclick = () => { S.tool = { kind: 'roofRemove' }; renderItems(); };
    box.appendChild(b);
  }
  if (!any && S.cat === 'special') box.insertAdjacentHTML('beforeend', '<div style="padding:14px 8px;font-size:14px">No furniture in your bag. Otto sells pianos, fireplaces and more in the town square.</div>');
  refreshTrayAffordability();
}

function refreshTrayAffordability() {
  for (const b of $('items').querySelectorAll('button[data-id]')) {
    const d = ITEMS[b.dataset.id];
    if (d && !d.shop) b.classList.toggle('poor', d.price > S.coins);
  }
}
function updateRotateBtn() {
  const ok = S.tool.kind === 'obj' && canRotate(S.tool.id);
  $('btn-rotate').disabled = !ok;
  $('btn-rotate').textContent = ok ? `↻ Rotate (${['front', 'left', 'back', 'right'][S.rot]})` : '↻ Rotate';
}
function rotateItem() {
  if (S.held && S.held.kind !== 'obj') { S.held.rot = (S.held.rot + 1) % 4; refreshPreview(); return; }
  if (S.held?.kind === 'obj') { if (canRotate(S.held.t)) { S.rot = (S.rot + 1) % 4; refreshPreview(); } return; }
  if (S.tool.kind !== 'obj' || !canRotate(S.tool.id)) return;
  S.rot = (S.rot + 1) % 4;
  updateRotateBtn();
  refreshPreview();
}
$('btn-rotate').onclick = rotateItem;
$('btn-undo').onclick = undo;

function setLevel(l) {
  S.level = Math.max(0, Math.min(LEVELS - 1, l));
  $('btn-level').textContent = S.level ? '⬆ Upstairs' : 'Ground floor';
  plotsDirty = true;
  toolInfo();
  refreshPreview();
}
$('btn-level').onclick = () => setLevel(S.level ? 0 : 1);
const WALL_MODES = { cut: 'Walls: cutaway', up: 'Walls: up', down: 'Walls: down' };
function cycleWalls() {
  S.wallMode = { cut: 'up', up: 'down', down: 'cut' }[S.wallMode];
  $('btn-walls').textContent = WALL_MODES[S.wallMode];
  plotsDirty = true;
}
$('btn-walls').onclick = cycleWalls;

function toolInfo(extra) {
  const t = S.tool, d = ITEMS[t.id];
  const msgs = {
    wall: S.wallTool === 'paint' ? 'Paint: click one side of a wall to paint just that side (inside and outside can differ). Shift+click paints the whole room, or the whole outside of that building.' : S.wallTool === 'room' ? 'Drag from corner to corner to build a room (walls + wood floor).' : S.wallTool === 'chain' ? 'Custom room: click corner after corner; close the shape for a room with a floor, or double-click / Enter to stop.' : 'Drag along the grid lines to build a wall.',
    blueprint: 'Move it into place, R or right-click to turn, click to buy. Shop furniture isn’t included.',
    saveRoom: 'Click a room’s floor to save it to your library.',
    feature: 'Tap a wall to set the door or window into it.',
    floor: 'Tap or drag a rectangle to lay floor.',
    roof: 'Drag a rectangle over your rooms to add a roof. Roofs show with walls up.',
    roofRemove: 'Tap a roofed tile to remove that roof.',
    obj: d?.crop ? 'Plant on tilled soil.' : 'Drag to position, release to place. R or right-click rotates · Alt+click picks up what’s there · Ctrl/Cmd+Z undoes.',
    remove: 'Tap something to remove it.',
    resize: `Drag any side of your plot. Growing costs 🪙${landPrice()} per tile. Plots can cover roads, but roads stay public.`,
    pave: 'Drag to lay road on your land. Roads are public: anyone may walk them and nothing can be built on them.',
    dig: 'Drag to dig up road on your land. You can move a road, but every end must stay connected. To close one, ask at City Hall.',
    merge: 'Tap the empty plot next door to join it to yours.',
    split: 'Drag across your plot to choose a cut line; the empty side goes up for sale.',
    none: '',
  };
  $('toolinfo').textContent = (S.freeBuild ? '🆓 Free build · ' : '') + (extra ? extra + ' · ' : '') + (S.level && !['resize', 'merge', 'split', 'pave', 'dig'].includes(t.kind) ? 'Upstairs · ' : '') + (msgs[t.kind] || '');
}

function setMode(mode) {
  if (mode === 'build') {
    // Build the plot you're standing on (your home or your shop).
    const here = ownPlotHere();
    if (here == null) { toast(S.homePlot == null && S.biz?.plotId == null ? 'Claim a plot first!' : 'Walk onto your plot to build'); return; }
    S.myPlot = here;
  } else S.myPlot = S.homePlot;
  if (mode !== 'build') { S.held = null; S.chain = null; S.previewHour = null; }
  if (mode === 'build') closeTalk();
  S.mode = mode;
  document.body.classList.toggle('building', mode === 'build');
  $('tray').hidden = mode !== 'build';
  $('btn-build').classList.toggle('on', mode === 'build');
  syncBuildBtn();
  $('action').style.display = mode === 'build' ? 'none' : '';
  $('chatlog').style.display = mode === 'build' ? 'none' : '';
  drag = null;
  ghost.clear();
  if (mode === 'build') {
    syncEditPlotBtn();
    renderTabs(); renderItems();
    const p = S.plots[S.myPlot];
    view.setTarget(p.x + p.w / 2, p.y + p.h / 2 + 1);
    view.maxZoom = 80;
    view.zoom = Math.max(18, Math.min(30, p.w * 0.9)); view.zoomBy(1);
  } else if (S.me) {
    view.maxZoom = 40;
    view.zoom = 15; view.zoomBy(1);
  }
  plotsDirty = true;
}

const landPrice = () => S.city?.landPrice ?? LAND_PRICE;

// In build mode: hop between building your home and your shop.
$('btn-editplot').onclick = () => {
  if (S.mode !== 'build' || S.biz?.plotId == null || S.homePlot == null) return;
  S.myPlot = S.myPlot === S.biz.plotId ? S.homePlot : S.biz.plotId;
  S.held = null; S.chain = null; undoStack.length = 0; redoStack.length = 0; syncUndoBtns?.();
  const p = S.plots[S.myPlot];
  view.setTarget(p.x + p.w / 2, p.y + p.h / 2 + 1);
  syncEditPlotBtn(); renderTabs(); renderItems(); refreshPreview(); plotsDirty = true;
};
function syncEditPlotBtn() {
  $('btn-editplot').textContent = S.myPlot === S.biz?.plotId ? '🏪 Shop ⇄ 🏠' : '🏠 Home ⇄ 🏪';
}

// --- picking helpers (plot-local) ---
function myDef() { return S.plots[S.myPlot]; }
function pickWorld(cx, cy) { const p = view.pick(cx, cy, 0); return p ? { x: p.x, z: p.z } : null; }
function pickLocal(cx, cy, height = 0) {
  const def = myDef();
  const p = view.pick(cx, cy, S.level * LEVEL_H + height);
  return p ? { fx: p.x - def.x, fz: p.z - def.y } : null;
}
const tileOf = (q) => [Math.floor(q.fx), Math.floor(q.fz)];
const cornerOf = (q) => [Math.round(q.fx), Math.round(q.fz)];
function edgeOf(q) {
  const lx = Math.floor(q.fx), ly = Math.floor(q.fz), ux = q.fx - lx, uz = q.fz - ly;
  const c = [[uz, ['h', lx, ly]], [1 - uz, ['h', lx, ly + 1]], [ux, ['v', lx, ly]], [1 - ux, ['v', lx + 1, ly]]];
  c.sort((a, b) => a[0] - b[0]);
  return { edge: c[0][1], dist: c[0][0] };
}
const rectOf = (a, b) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 });
const clampRect = (r) => {
  const plot = myDef();
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(plot.w - 1, r.x + r.w - 1), y1 = Math.min(plot.h - 1, r.y + r.h - 1);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

// --- previews & commits ---
let drag = null;        // { start, cur } in plot-local corner/tile coordinates
let hover = null;       // last pointer position { cx, cy }

function wallPlan() {
  if (!drag) return null;
  const [x0, y0] = drag.start, [x1, y1] = drag.cur;
  if (S.wallTool === 'room') {
    const r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    if (r.w < 1 || r.h < 1) return { edges: [], room: null };
    return { edges: rectEdges(r.x, r.y, r.w, r.h), room: r };
  }
  return { edges: lineEdges(x0, y0, x1, y1) };
}

// Floating label next to the cursor in build mode: what you're placing, its cost,
// and why it can't go there.
let tipState = null;
function tip(text, err) { tipState = { text, err }; }
function drawTip() {
  const el = $('cursortip');
  if (!tipState || !hover || S.mode !== 'build') { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `${esc(tipState.text)}${tipState.err ? `<b>${esc(tipState.err)}</b>` : ''}`;
  el.classList.toggle('bad', !!tipState.err);
  const x = Math.min(innerWidth - el.offsetWidth - 8, hover.cx + 16), y = Math.max(8, hover.cy - el.offsetHeight - 14);
  el.style.transform = `translate(${x}px, ${y}px)`;
}
const coinsErr = (cost) => (afford(cost) ? null : 'Not enough coins');

function refreshPreview() {
  ghost.clear();
  tipState = null;
  try { previewInner(); } finally { drawTip(); }
}

function previewInner() {
  if (S.mode !== 'build' || !hover) return;
  const plot = S.plots[S.myPlot], def = myDef(), t = S.tool;
  const d = ITEMS[t.id];
  // Something picked up (furniture, a room, the house or a blueprint) follows the cursor.
  if (S.held?.kind === 'obj') {
    const H = S.held, q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const [w, h] = footprint(H.t, S.rot);
    const lx = Math.round(q.fx - w / 2), ly = Math.round(q.fz - h / 2);
    const bad = placementError(liftedPlot(plot, H), lx, ly, H.t, S.rot, S.level, world);
    ghost.marker(def, H.from[0], H.from[1], S.level, 0.05);
    ghost.item(H.t, S.rot, def, lx, ly, S.level, !bad, H.c);
    tip(`Move ${ITEMS[H.t].name} · free${canRotate(H.t) ? ' · R / right-click ↻' : ''} · Esc cancels`, bad);
    return;
  }
  if (S.held) {
    const spot = heldSpot(hover);
    if (!spot) return;
    let bad;
    if (S.held.kind === 'blueprint') {
      // Shop furniture comes from your bag: pieces you don't have are left out.
      const stock = stockFragment(spot.frag, S.inv, S.freeBuild);
      spot.frag = stock.frag;
      const cost = S.freeBuild ? 0 : fragmentValue(spot.frag);
      const nMissing = Object.values(stock.missing).reduce((a, b) => a + b, 0);
      bad = fragError(plot, spot.frag, spot.ox, spot.oy, world) || coinsErr(cost);
      tip(`${S.tool.name} · 🪙${cost}${nMissing ? ` · ${nMissing} shop piece${nMissing > 1 ? 's' : ''} not in your bag` : ''} · R / right-click ↻ · click to buy`, bad);
    } else {
      bad = heldMoveError(spot);
      tip(`Move ${S.held.kind === 'house' ? 'house' : 'room'} · free · R / right-click ↻ · Esc cancels`, bad);
    }
    ghost.fragment(spot.frag, def, spot.ox, spot.oy, !bad);
    return;
  }
  if (t.kind === 'design') {
    const qw = pickLocal(hover.cx, hover.cy, 1.0);
    const ew = qw && edgeOf(qw);
    const w = ew && plot.walls?.[edgeKey(S.level, ...ew.edge)];
    if (w?.f && ew.dist < 0.3) {
      ghost.walls([ew.edge], def, S.level, true, true);
      tip(`🎨 ${ITEMS[w.f].name} · colour ${(w.fc || 0) + 1}/6 · click for the next (free)`);
      return;
    }
  }
  if (t.kind === 'select' || t.kind === 'saveRoom' || t.kind === 'design' || t.kind === 'eyedrop') {
    const q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const [lx, ly] = tileOf(q);
    const v = levelView(plot, S.level);
    const hit = objAt(v, lx, ly);
    if (hit && t.kind !== 'saveRoom') {
      const [ax, ay] = hit.key.split(',').map(Number);
      const [w, h] = footprint(hit.obj.t, hit.obj.r || 0);
      ghost.box(def.x + ax, def.y + ay, w, h, S.level * LEVEL_H, 1.2);
      const name = ITEMS[hit.obj.t].name;
      tip(t.kind === 'design' ? `🎨 ${name} · colour ${(hit.obj.c || 0) + 1}/6 · click for the next (free)` : t.kind === 'eyedrop' ? `💧 Copy ${name}` : `👆 ${name} · click to pick up`);
      return;
    }
    const tiles = roomTiles(plot, S.level, lx, ly);
    if (tiles && t.kind !== 'eyedrop') {
      const xs = [...tiles].map((k) => +k.split(',')[0]), ys = [...tiles].map((k) => +k.split(',')[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      // From the ground floor, a room takes its upstairs along: the box shows both storeys.
      const up = !S.level && plot.l1 && [...tiles].some((k) => plot.l1.floor[k]);
      ghost.box(def.x + x0, def.y + y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1, S.level * LEVEL_H, up ? 5.3 : 2.6);
      if (t.kind === 'design') { tip(roofAt(plot, lx, ly, S.level) >= 0 ? '🎨 Click to change this roof’s colour' : '🎨 Point at furniture, a door, a window or a roof'); return; }
      tip(t.kind === 'saveRoom' ? `📚 Save this room (${tiles.size} tiles)` : `👆 Room · ${tiles.size} tiles · click to pick it up`);
      return;
    }
    if (t.kind === 'eyedrop' && v.floor[key(lx, ly)]) { tip(`💧 Copy ${ITEMS[v.floor[key(lx, ly)]].name}`); return; }
    tip(t.kind === 'saveRoom' ? 'Point at a room’s floor' : t.kind === 'design' ? '🎨 Point at furniture or a roof' : t.kind === 'eyedrop' ? '💧 Point at something to copy' : '👆 Point at furniture or a room');
    return;
  }
  if (t.kind === 'wall' && S.wallTool === 'paint') {
    const pt = paintTarget(hover);
    if (!pt) { tip('🖌 Point at a wall'); return; }
    ghost.walls([pt.edge], def, S.level, true, false, t.id);
    const where = pt.fill === 'room' ? 'the whole room' : pt.fill === 'outside' ? 'the outside of this building' : `this side (${pt.indoor ? 'inside' : 'outside'})`;
    tip(`🖌 ${d.name} · ${where} · 🪙${Math.ceil(d.price / 2)} a side${pt.fill ? '' : ' · Shift: whole room / outside'}`);
    return;
  }
  if (t.kind === 'wall' && S.wallTool === 'chain') {
    const q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const p = chainSnap(q);
    const edges = S.chain ? chainEdges(S.chain, p) : [];
    ghost.tiles([[p[0] - 0.2, p[1] - 0.2]], def, S.level, true, 0.5);
    if (S.chain) ghost.tiles(S.chain.map(([x, y]) => [x - 0.2, y - 0.2]), def, S.level, true, 0.5);
    const fresh = edges.filter((e) => !plot.walls?.[edgeKey(S.level, ...e)]);
    const cost = S.freeBuild ? 0 : fresh.length * d.price;
    const bad = edges.map((e) => wallError(plot, S.level, ...e, world)).find(Boolean) || coinsErr(cost);
    ghost.walls(edges, def, S.level, !bad, false, t.id);
    const closes = S.chain && S.chain.length > 2 && p[0] === S.chain[0][0] && p[1] === S.chain[0][1];
    tip(`⌁ Custom room · ${fresh.length} walls · −🪙${cost}${S.chain ? (closes ? ' · click to close the room' : ' · double-click or Enter to finish') : ' · click to start'}`, bad);
    return;
  }
  if (t.kind === 'remove' && drag?.start && (drag.start[0] !== drag.cur[0] || drag.start[1] !== drag.cur[1])) {
    const r = clampRect(rectOf(drag.start, drag.cur));
    const tiles = [];
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) tiles.push([r.x + i, r.y + j]);
    ghost.tiles(tiles, def, S.level, false, 0.3);
    tip(`🔨 Clear ${r.w}×${r.h} · release to demolish`);
    return;
  }
  if (t.kind === 'wall') {
    if (!drag) {
      const q = pickLocal(hover.cx, hover.cy);
      if (q) { const [cx, cz] = cornerOf(q); ghost.tiles([[cx - 0.5, cz - 0.5]].map(([a, b]) => [a + 0.3, b + 0.3]), def, S.level, true, 0.6); }
      tip(`${d.name} · 🪙${d.price}/wall · ${S.wallTool === 'room' ? 'drag a room' : 'drag along the grid'}`);
      return;
    }
    const plan = wallPlan();
    const news = plan.edges.filter((e) => plot.walls?.[edgeKey(S.level, ...e)]?.m !== t.id);
    const cost = S.freeBuild ? 0 : news.length * d.price + (plan.room ? plan.room.w * plan.room.h * ITEMS.floor_wood.price : 0);
    const bad = plan.edges.map((e) => wallError(plot, S.level, ...e, world)).find(Boolean) || coinsErr(cost);
    ghost.walls(plan.edges, def, S.level, !bad, false, t.id);
    if (plan.room) ghost.texturedTiles(Array.from({ length: plan.room.w * plan.room.h }, (_, i) => [plan.room.x + (i % plan.room.w), plan.room.y + Math.floor(i / plan.room.w)]), def, S.level, !bad, 'floor', 'floor_wood', 0.02);
    const label = plan.room ? `Room ${plan.room.w}×${plan.room.h} · 🪙${cost}` : `${news.length} wall${news.length === 1 ? '' : 's'} · 🪙${cost}`;
    tip(label, bad);
    toolInfo(label);
  } else if (t.kind === 'floor' || t.kind === 'roof') {
    const q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const r = clampRect(drag ? rectOf(drag.start, drag.cur) : rectOf(tileOf(q), tileOf(q)));
    if (r.w < 1 || r.h < 1) return;
    const tiles = [];
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) tiles.push([r.x + i, r.y + j]);
    if (t.kind === 'floor') {
      const errs = tiles.map(([x, y]) => placementError(plot, x, y, t.id, 0, S.level, world));
      const ok = tiles.filter((_, i) => !errs[i]);
      const cost = S.freeBuild ? 0 : ok.length * d.price;
      const bad = ok.length ? coinsErr(cost) : errs.find((e) => e && e !== 'Already there') || 'Already there';
      ghost.texturedTiles(ok, def, S.level, !bad, 'floor', t.id);
      ghost.tiles(tiles.filter((_, i) => errs[i] && errs[i] !== 'Already there'), def, S.level, false);
      tip(`${d.name} · ${ok.length} tile${ok.length === 1 ? '' : 's'} · 🪙${cost}`, bad);
      if (drag) toolInfo(`${ok.length} tiles · 🪙${cost}`);
    } else {
      const cost = S.freeBuild ? 0 : r.w * r.h * d.price;
      const bad = roofError(plot, r.x, r.y, r.w, r.h, S.level, world) || coinsErr(cost);
      ghost.texturedTiles(tiles, def, S.level + 1, !bad, 'roof', t.id, 0.06);
      tip(`${d.name} · ${r.w}×${r.h} · 🪙${cost}`, bad);
      if (drag) toolInfo(`Roof ${r.w}×${r.h} · 🪙${cost}${bad ? ' · ' + bad : ''}`);
    }
  } else if (t.kind === 'feature') {
    const q = pickLocal(hover.cx, hover.cy, 1.0);
    if (!q) return;
    const { edge } = edgeOf(q);
    const wall = plot.walls?.[edgeKey(S.level, ...edge)];
    // Double doors take this segment and the next one along the wall.
    const edges = d.width === 2 ? [edge, edge[0] === 'h' ? ['h', edge[1] + 1, edge[2]] : ['v', edge[1], edge[2] + 1]] : [edge];
    const bad = !wall ? 'Point at a wall' : edges.some((e) => !plot.walls?.[edgeKey(S.level, ...e)]) ? 'Needs two wall segments side by side' : coinsErr(S.freeBuild ? 0 : d.price);
    ghost.walls(edges, def, S.level, !bad, false, wall?.m);
    tip(`${d.name} · 🪙${d.price}${wall?.f ? ` · replaces ${ITEMS[wall.f].name}` : ''}`, bad);
  } else if (t.kind === 'obj') {
    const q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const r = canRotate(t.id) ? S.rot : 0;
    const [w, h] = footprint(t.id, r);
    const lx = Math.round(q.fx - w / 2), ly = Math.round(q.fz - h / 2);
    const bad = placementError(plot, lx, ly, t.id, r, S.level, world)
      || (S.freeBuild ? null : d.shop ? (S.inv[t.id] > 0 ? null : `None left: buy more from ${NPCS[d.shop].name}`) : coinsErr(d.price));
    ghost.item(t.id, r, def, lx, ly, S.level, !bad);
    tip(`${d.name} · ${d.shop ? `×${S.inv[t.id] || 0}` : `🪙${d.price}`}${w * h > 1 ? ` · ${w}×${h}` : ''}${canRotate(t.id) ? ' · R / right-click ↻' : ''}`, bad);
  } else if (t.kind === 'remove' || t.kind === 'roofRemove') {
    const target = removeTarget(hover);
    if (!target) { tip('Sledgehammer · point at something'); return; }
    if (target.edge) ghost.walls([target.edge], def, S.level, false);
    else if (target.tiles) ghost.tiles(target.tiles, def, target.level ?? S.level, false, 0.3);
    tip(`Remove ${removeLabel(plot, target)}`);
  } else if (t.kind === 'pave' || t.kind === 'dig') {
    const plan = roadPlan(hover);
    if (!plan) return;
    ghost.tiles(plan.tiles, def, 0, !plan.err, 0.06);
    tip(`${t.kind === 'pave' ? 'Pave' : 'Dig up'} ${plan.tiles.length} tile${plan.tiles.length === 1 ? '' : 's'}`, plan.err);
    toolInfo(`${plan.tiles.length} tile${plan.tiles.length === 1 ? '' : 's'}${plan.err ? ' · ' + plan.err : ''}`);
  } else if (t.kind === 'resize' || t.kind === 'merge' || t.kind === 'split') {
    const plan = landPlan(hover);
    if (!plan) { ghost.rect(def.x, def.y, def.w, def.h, true); return; }
    if (plan.rect) ghost.rect(plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h, plan.ok);
    if (plan.sold) { ghost.rect(plan.sold.x, plan.sold.y, plan.sold.w, plan.sold.h, false); ghost.cut(plan.at, def.y, def.h); }
    const parts = plan.info.split(' · ');
    tip(plan.ok ? plan.info : parts.slice(0, -1).join(' · ') || plan.info, plan.ok ? null : parts.at(-1));
    toolInfo(plan.info);
  }
}

// ---- Undo (Ctrl/Cmd+Z): each build action records the messages that reverse it ----
// Each entry keeps the messages that undo it and the ones that redo it.
const undoStack = [], redoStack = [];
let actionSent = null; // messages commit() sent for the current action (become its redo)
function pushUndo(label, ops, redo = actionSent) {
  if (!ops?.length) return;
  undoStack.push({ label, ops, redo: redo ? [...redo] : null, plotId: S.myPlot });
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  syncUndoBtns();
}
function syncUndoBtns() { $('btn-undo').disabled = !undoStack.length; $('btn-redo').disabled = !redoStack.length; }
function undo() {
  const u = undoStack.pop();
  if (!u) { syncUndoBtns(); return toast('Nothing to undo'); }
  if (u.plotId !== S.myPlot) { syncUndoBtns(); return toast('That was on another plot'); }
  for (const m of u.ops) send(m);
  if (u.redo?.length) redoStack.push(u);
  syncUndoBtns();
  toast(`↶ Undid ${u.label}`);
}
function redo() {
  const u = redoStack.pop();
  if (!u) { syncUndoBtns(); return toast('Nothing to redo'); }
  for (const m of u.redo) send(m);
  undoStack.push(u);
  syncUndoBtns();
  toast(`↷ Redid ${u.label}`);
}
// Floor tiles a rectangle would newly lay (and that undo can safely take up again).
function newFloorUndo(plot, r, item, base) {
  const v = levelView(plot, S.level), out = [];
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const x = r.x + i, y = r.y + j;
    if (!v.floor[key(x, y)] && !objAt(v, x, y) && !placementError(plot, x, y, item, 0, S.level, world)) out.push({ type: 'remove', ...base, lx: x, ly: y });
  }
  return out;
}
// Messages that put back what the sledgehammer is about to take.
function removeUndo(plot, target, base) {
  if (target.edge) {
    const w = plot.walls?.[edgeKey(S.level, ...target.edge)];
    if (!w) return [];
    const [dd, x, y] = target.edge;
    if (target.featureOnly) return [{ type: 'feature', ...base, d: dd, x, y, f: w.f }];
    const ops = [{ type: 'walls', ...base, m: w.m, segs: [target.edge] }];
    if (w.f) ops.push({ type: 'feature', ...base, d: dd, x, y, f: w.f });
    return ops;
  }
  if (target.roof) {
    const rf = plot.roofs[roofAt(plot, target.lx, target.ly, S.level)];
    return rf ? [{ type: 'roof', ...base, x: rf.x, y: rf.y, w: rf.w, h: rf.h, m: rf.m }] : [];
  }
  const v = levelView(plot, S.level);
  const hit = objAt(v, target.lx, target.ly);
  if (hit) {
    if (ITEMS[hit.obj.t].crop) return [];
    const [ax, ay] = hit.key.split(',').map(Number);
    return [{ type: 'place', ...base, lx: ax, ly: ay, item: hit.obj.t, r: hit.obj.r || 0 }];
  }
  const f = v.floor[key(target.lx, target.ly)];
  return f ? [{ type: 'floorRect', ...base, x: target.lx, y: target.ly, w: 1, h: 1, item: f }] : [];
}

// ---- Sims build tools: select (move furniture / rooms), design, move house, ----
// ---- sledgehammer area, custom room, styled rooms and the library.          ----
const STRIP_TOOLS = ['select', 'eyedrop', 'remove', 'design', 'movehouse'];
const STRIP_HELP = {
  select: '👆 <b>Select</b>: click furniture to pick it up, then click to put it down (R or right-click turns it; Delete sells it). Click a room\'s floor to pick up the <b>whole room</b> with its walls and furniture, then move and turn it. Moving is free.',
  eyedrop: '💧 <b>Eyedropper</b>: click any furniture, floor or wall to copy it as your current tool (also Alt+click with any tool).',
  remove: '🔨 <b>Sledgehammer</b>: click something to remove it, or <b>drag a box</b> to clear everything inside. Everything is refunded (shop furniture goes back to your bag; crops are lost).',
  design: '🎨 <b>Design</b>: click furniture to cycle through its 6 colourways, or click under a roof to change its colour. Free.',
  movehouse: '🏠 <b>Move house</b>: your whole house follows the cursor; R or right-click turns it; click to set it down. Free.',
};
function setStripTool(kind) {
  S.held = null; S.chain = null;
  S.tool = S.tool.kind === kind && kind !== 'remove' ? { kind: 'none' } : { kind };
  if (S.tool.kind === 'movehouse') {
    const frag = extract(S.plots[S.myPlot]);
    if (!frag) { S.tool = { kind: 'none' }; toast('Build something first'); }
    else S.held = { kind: 'house', frag, rot: 0, grab: [frag.w / 2, frag.h / 2], ox: frag.ox, oy: frag.oy };
  }
  syncStrip(); renderTabs(); renderItems(); refreshPreview();
}
function syncStrip() {
  for (const b of document.querySelectorAll('#buildtools [data-tool]')) b.classList.toggle('sel', S.tool.kind === b.dataset.tool);
  $('btn-time').classList.toggle('sel', S.previewHour != null);
}
for (const b of document.querySelectorAll('#buildtools [data-tool]')) b.onclick = () => setStripTool(b.dataset.tool);

// Select: pick up furniture, or a whole room.
function pickUp(h) {
  const plot = S.plots[S.myPlot];
  const q = pickLocal(h.cx, h.cy);
  if (!q) return;
  const [lx, ly] = tileOf(q);
  const v = levelView(plot, S.level);
  const hit = objAt(v, lx, ly);
  if (hit) {
    if (ITEMS[hit.obj.t].stairs) return toast('Stairs can’t be moved: sledgehammer them and build new ones');
    if (ITEMS[hit.obj.t].crop) return toast('Crops can’t be moved');
    const [ax, ay] = hit.key.split(',').map(Number);
    S.held = { kind: 'obj', from: [ax, ay], level: S.level, t: hit.obj.t, r: hit.obj.r || 0, c: hit.obj.c || 0 };
    S.rot = S.held.r;
    toast(`👆 ${ITEMS[hit.obj.t].name}: click to put it down`);
  } else {
    const region = roomRegion(plot, S.level, lx, ly);
    if (!region) return toast('Click furniture or a room’s floor');
    const frag = extract(plot, region);
    S.held = { kind: 'room', at: [lx, ly], level: S.level, frag, rot: 0, grab: [lx - frag.ox + 0.5, ly - frag.oy + 0.5], ox: frag.ox, oy: frag.oy };
    const upper = Object.keys(frag.levels[1]?.floor || {}).length && !S.level;
    toast(`👆 Room picked up${upper ? ' with its upstairs' : ''}: click to set it down · R turns it`);
  }
  refreshPreview();
}

// Where a held room/house would go for the pointer at h (top-left, plot-local).
function heldSpot(h) {
  const q = pickLocal(h.cx, h.cy, 0);
  if (!q) return null;
  const H = S.held, f = rotateTimes(H.frag, H.rot);
  const [gx, gy] = H.rot % 2 ? [H.grab[1], H.grab[0]] : H.grab;
  return { frag: f, ox: Math.round(q.fx - gx), oy: Math.round(q.fz - gy) };
}

// A copy of the plot with what you're carrying lifted out: the house draws like this
// while you carry something, and moves are checked against it.
function liftedPlot(plot, H) {
  const copy = structuredClone(plot);
  copy.l1 ||= { floor: {}, obj: {} };
  if (H.kind === 'obj') { delete levelView(copy, H.level).obj[key(...H.from)]; occChanged(copy); }
  else if (H.frag && H.ox != null) removeAt(copy, H.frag, H.ox, H.oy);
  return copy;
}

// Would a held room/house fit at this spot (ignoring where it is now)?
function heldMoveError(spot) {
  return fragError(liftedPlot(S.plots[S.myPlot], S.held), spot.frag, spot.ox, spot.oy, world);
}

function dropHeld(h, base, send) {
  const H = S.held;
  if (H.kind === 'obj') {
    const q = pickLocal(h.cx, h.cy);
    if (!q) return;
    const [w, hh] = footprint(H.t, S.rot);
    const lx = Math.round(q.fx - w / 2), ly = Math.round(q.fz - hh / 2);
    send({ type: 'moveObj', ...base, from: H.from, to: [lx, ly], r: S.rot });
    S.dropped = H; S.droppedAt = performance.now();
    pushUndo(ITEMS[H.t].name, [{ type: 'moveObj', ...base, from: [lx, ly], to: H.from, r: H.r }]);
    S.held = null;
    return;
  }
  const spot = heldSpot(h);
  if (!spot) return;
  // The server turns rooms about their centre, then shifts by (dx, dy).
  const cx = H.ox + Math.round((H.frag.w - spot.frag.w) / 2), cy = H.oy + Math.round((H.frag.h - spot.frag.h) / 2);
  const dx = spot.ox - cx, dy = spot.oy - cy;
  const msg = H.kind === 'house' ? { type: 'moveRegion', ...base, all: true, dx, dy, rot: H.rot } : { type: 'moveRegion', ...base, room: H.at, dx, dy, rot: H.rot };
  send(msg);
  S.dropped = H; S.droppedAt = performance.now();
  if (!H.rot) pushUndo(H.kind === 'house' ? 'moving the house' : 'moving the room', [{ ...msg, room: H.at && [H.at[0] + dx, H.at[1] + dy], dx: -dx, dy: -dy }]);
  S.held = null;
  if (S.tool.kind === 'movehouse') { S.tool = { kind: 'none' }; syncStrip(); renderItems(); }
}

// The wall face under the pointer, for painting: which edge, which side (0 = north/west,
// 1 = south/east), whether that side is indoors, and Shift's fill (room or outside).
function paintTarget(h) {
  const plot = S.plots[S.myPlot];
  const q = pickLocal(h.cx, h.cy, 1.0);
  if (!q) return null;
  const { edge, dist } = edgeOf(q);
  if (dist > 0.45 || !plot.walls?.[edgeKey(S.level, ...edge)]) return null;
  const [d, x, y] = edge;
  const side = wallSideAt(d, x, y, q.fx, q.fz);
  const [tx, ty] = d === 'h' ? [x, y - 1 + side] : [x - 1 + side, y];
  const indoor = !!levelView(plot, S.level).floor[key(tx, ty)];
  return { edge, side, indoor, fill: keys.has('shift') ? (indoor ? 'room' : 'outside') : null };
}

function designAt(h, base, send) {
  const plot = S.plots[S.myPlot];
  // Doors and windows first: cycle their paint.
  const qw = pickLocal(h.cx, h.cy, 1.0);
  if (qw) {
    const { edge, dist } = edgeOf(qw);
    const w = plot.walls?.[edgeKey(S.level, ...edge)];
    if (w?.f && dist < 0.3) {
      send({ type: 'design', ...base, edge });
      pushUndo(`repainting the ${ITEMS[w.f].name.toLowerCase()}`, [{ type: 'design', ...base, edge, c: w.fc || 0 }]);
      return;
    }
  }
  const q = pickLocal(h.cx, h.cy);
  if (!q) return;
  const [lx, ly] = tileOf(q);
  const hit = objAt(levelView(plot, S.level), lx, ly);
  if (hit && !ITEMS[hit.obj.t].crop) {
    const [ax, ay] = hit.key.split(',').map(Number);
    send({ type: 'design', ...base, lx: ax, ly: ay });
    pushUndo(`recolouring ${ITEMS[hit.obj.t].name}`, [{ type: 'design', ...base, lx: ax, ly: ay, c: hit.obj.c || 0 }]);
  } else if (roofAt(plot, lx, ly, S.level) >= 0) send({ type: 'design', ...base, lx, ly, roof: true });
  else toast('Click furniture or a roofed tile');
}

function moveHouseAt(h, base, send) { if (S.held) dropHeld(h, base, send); }

// Sledgehammer a whole box: furniture, floors and walls inside it.
function sledgeArea(plot, base, send) {
  const r = clampRect(rectOf(drag.start, drag.cur));
  const v = levelView(plot, S.level);
  const ops = [], undoOps = [];
  const seen = new Set();
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const x = r.x + i, y = r.y + j;
    const hit = objAt(v, x, y);
    if (hit && !seen.has(hit.key)) { seen.add(hit.key); undoOps.push(...removeUndo(plot, { lx: x, ly: y }, base)); ops.push({ type: 'remove', ...base, lx: x, ly: y }); }
  }
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const x = r.x + i, y = r.y + j;
    if (v.floor[key(x, y)]) { undoOps.push({ type: 'floorRect', ...base, x, y, w: 1, h: 1, item: v.floor[key(x, y)] }); ops.push({ type: 'remove', ...base, lx: x, ly: y }); }
  }
  for (const [d, x, y] of rectEdges(r.x, r.y, r.w, r.h).concat(innerEdges(r))) {
    const w = plot.walls?.[edgeKey(S.level, d, x, y)];
    if (w) { undoOps.unshift(...removeUndo(plot, { edge: [d, x, y] }, base)); ops.push({ type: 'remove', ...base, edge: [d, x, y] }); }
  }
  if (!ops.length) return toast('Nothing there');
  for (const m of ops) send(m);
  pushUndo(`clearing ${r.w}×${r.h}`, undoOps.reverse());
}
function innerEdges(r) {
  const out = [];
  for (let y = r.y + 1; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(['h', x, y]);
  for (let x = r.x + 1; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) out.push(['v', x, y]);
  return out;
}

// ---- Custom room tool: click corners, double-click (or Enter) to finish ----
function chainEdges(points, extra) {
  const pts = extra ? [...points, extra] : points;
  const out = [];
  for (let i = 1; i < pts.length; i++) out.push(...lineEdges(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return out;
}
// The next corner snaps straight across or straight down from the last one.
function chainSnap(q) {
  const c = cornerOf(q);
  const last = S.chain?.[S.chain.length - 1];
  if (!last) return c;
  return Math.abs(c[0] - last[0]) >= Math.abs(c[1] - last[1]) ? [c[0], last[1]] : [last[0], c[1]];
}
function chainClick(h) {
  const q = pickLocal(h.cx, h.cy);
  if (!q) return;
  const p = chainSnap(q);
  S.chain ||= [];
  const first = S.chain[0], last = S.chain[S.chain.length - 1];
  if (last && p[0] === last[0] && p[1] === last[1]) return;
  S.chain.push(p);
  if (first && S.chain.length > 3 && p[0] === first[0] && p[1] === first[1]) finishChain(true);
  refreshPreview();
}
function finishChain(closed = false) {
  const pts = S.chain;
  S.chain = null;
  if (!pts || pts.length < 2) return refreshPreview();
  const plot = S.plots[S.myPlot], base = { plotId: S.myPlot, level: S.level };
  actionSent = [];
  const edges = chainEdges(pts).filter((e) => !plot.walls?.[edgeKey(S.level, ...e)]);
  const msgs = [{ type: 'walls', ...base, m: S.tool.id, segs: chainEdges(pts) }];
  const undoOps = edges.map((e) => ({ type: 'remove', ...base, edge: e }));
  // A closed shape gets a wood floor inside, like the room tool.
  if (closed) {
    const inside = polygonTiles(pts);
    const v = levelView(plot, S.level);
    for (const [x, y] of inside) {
      if (v.floor[key(x, y)] || placementError(plot, x, y, 'floor_wood', 0, S.level, world)) continue;
      msgs.push({ type: 'floorRect', ...base, x, y, w: 1, h: 1, item: 'floor_wood' });
      undoOps.push({ type: 'remove', ...base, lx: x, ly: y });
    }
  }
  for (const m of msgs) { actionSent.push(m); send(m); }
  pushUndo(closed ? 'custom room' : `${edges.length} walls`, undoOps);
  refreshPreview();
}
// Tiles whose centres lie inside the closed corner polygon.
function polygonTiles(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const out = [];
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) for (let x = Math.min(...xs); x < Math.max(...xs); x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) out.push([x, y]);
  }
  return out;
}

// ---- Styled rooms & My Library ----
// Top-down thumbnail of a blueprint.
function blueprintThumb(frag) {
  const cv = document.createElement('canvas');
  const s = 16;
  cv.width = Math.max(frag.w, 1) * s + 8; cv.height = Math.max(frag.h, 1) * s + 8;
  const c = cv.getContext('2d');
  c.translate(4, 4);
  const v = frag.levels[0];
  for (const [k, f] of Object.entries(v.floor)) { const [x, y] = k.split(',').map(Number); drawFloor(c, f, x * s, y * s, x, y); }
  for (const [k, o] of Object.entries(v.obj)) { if (!ITEMS[o.t]) continue; const [x, y] = k.split(',').map(Number); drawObject(c, o, x * s, y * s, 0); }
  c.fillStyle = '#4a2e18';
  for (const k of Object.keys(frag.walls)) {
    const [l, d, x, y] = k.split(':');
    if (l !== '0') continue;
    if (d === 'h') c.fillRect(+x * s, +y * s - 1.5, s, 3); else c.fillRect(+x * s - 1.5, +y * s, 3, s);
  }
  return cv;
}
function renderLibrary(box) {
  const sec = (t) => box.insertAdjacentHTML('beforeend', `<div class="libsec">${t}</div>`);
  const card = (name, frag, price, onPick, onDel) => {
    const b = document.createElement('button');
    b.className = 'libcard' + (S.tool.kind === 'blueprint' && S.tool.name === name ? ' sel' : '');
    b.appendChild(blueprintThumb(frag));
    b.insertAdjacentHTML('beforeend', `<span>${esc(name)}</span><span class="price">🪙${price} · ${frag.w}×${frag.h}</span>`);
    b.onclick = onPick;
    if (onDel) {
      const x = document.createElement('span');
      x.className = 'del'; x.textContent = '✕'; x.title = 'Delete from library';
      x.onclick = (e) => { e.stopPropagation(); if (confirm(`Delete “${name}” from your library?`)) send({ type: 'deleteBlueprint', idx: onDel }); };
      b.appendChild(x);
    }
    box.appendChild(b);
  };
  sec('Styled rooms · ready to buy');
  for (const [id, r] of Object.entries(STYLED_ROOMS)) card(`${r.icon} ${r.name}`, r.frag, r.price, () => pickBlueprint('styled', id, r.frag, `${r.icon} ${r.name}`));
  sec(`My library (${S.library.length}/12)`);
  S.library.forEach((b, i) => card(b.name, b.frag, b.value, () => pickBlueprint('library', i, b.frag, b.name), i === 0 ? 0.5 : i));
  for (const [label, fn] of [['＋ Save my house', () => saveHouse()], ['＋ Save a room…', () => { S.tool = { kind: 'saveRoom' }; renderItems(); toast('Click a room’s floor to save it'); }]]) {
    const b = document.createElement('button');
    b.className = 'libcard';
    b.innerHTML = `<span style="font-size:24px;line-height:60px">📚</span><span>${label}</span>`;
    b.onclick = fn;
    box.appendChild(b);
  }
}
function pickBlueprint(src, id, frag, name) {
  S.tool = { kind: 'blueprint', src, id: src === 'library' ? Math.floor(id) : id, name };
  S.held = { kind: 'blueprint', frag, rot: 0, grab: [frag.w / 2, frag.h / 2] };
  renderItems(); refreshPreview();
}
function placeBlueprintAt(h, send) {
  const spot = heldSpot(h);
  if (!spot) return;
  const t = S.tool;
  send({ type: 'placeBlueprint', plotId: S.myPlot, src: t.src, id: t.id, x: spot.ox, y: spot.oy, rot: S.held.rot });
}
function saveHouse() {
  const name = prompt('Name this house blueprint', S.me.farm ? `${S.me.farm} house` : 'My house');
  if (name != null) send({ type: 'saveBlueprint', plotId: S.myPlot, name });
}
function saveRoomAt(h) {
  const q = pickLocal(h.cx, h.cy);
  if (!q) return;
  const [lx, ly] = tileOf(q);
  if (!roomTiles(S.plots[S.myPlot], S.level, lx, ly)) return toast('Click a room’s floor');
  const name = prompt('Name this room', 'My room');
  if (name != null) send({ type: 'saveBlueprint', plotId: S.myPlot, level: S.level, room: [lx, ly], name });
  S.cat = 'library'; S.tool = { kind: 'none' }; renderItems();
}

// ---- Lot info (and the bulldozer) ----
function showLot() {
  const plot = S.plots[S.myPlot];
  if (!plot) return;
  const body = openModal('lot', `ℹ️ ${plot.farm ? `${plot.farm} Farm` : `${S.me.name}'s lot`}`);
  const all = [...Object.values(plot.obj), ...Object.values(plot.l1?.obj || {})];
  const count = (...ts) => all.filter((o) => ts.includes(o.t)).length;
  const frag = extract(plot);
  const rooms = new Set();
  let nRooms = 0;
  for (let l = 0; l < 2; l++) for (const k of Object.keys(levelView(plot, l).floor)) {
    if (rooms.has(`${l}|${k}`)) continue;
    const [x, y] = k.split(',').map(Number);
    const t = roomTiles(plot, l, x, y);
    for (const tk of t) rooms.add(`${l}|${tk}`);
    if (t.size > 1) nRooms++;
  }
  const landValue = plot.w * plot.h * landPrice();
  const buildValue = frag ? fragmentValue(frag) : 0;
  body.insertAdjacentHTML('beforeend', `<div class="lotgrid">
    <span>Lot</span><span>Plot ${plot.id + 1} · ${plot.w}×${plot.h} tiles (${plot.w * plot.h})</span>
    <span>Lot value</span><span>🪙${(landValue + buildValue).toLocaleString()} (land 🪙${landValue.toLocaleString()} + build 🪙${buildValue.toLocaleString()})</span>
    <span>Bedrooms</span><span>${count('bed')}</span>
    <span>Bathrooms</span><span>${Math.max(count('toilet'), count('bathtub'))}</span>
    <span>Rooms</span><span>${nRooms}${Object.keys(plot.l1?.floor || {}).length ? ' · two storeys' : ''}</span>
    <span>Furniture</span><span>${all.filter((o) => !ITEMS[o.t]?.crop).length} pieces · ${count(...Object.keys(ITEMS).filter((k) => ITEMS[k].crop))} crops</span>
  </div>`);
  const row = document.createElement('div');
  row.className = 'row';
  for (const [label, fn] of [
    ['📚 Save house to library', () => { closeModal(); saveHouse(); }],
    ['🚜 Bulldoze terrain', () => { if (confirm('Clear all tilled soil, stone paths and crops? Your house stays.')) { send({ type: 'bulldoze', plotId: plot.id, terrain: true }); closeModal(); } }],
    ['💥 Bulldoze lot', () => { if (confirm('Bulldoze EVERYTHING on your lot? You get refunded, but this can’t be undone.')) { send({ type: 'bulldoze', plotId: plot.id }); undoStack.length = 0; redoStack.length = 0; syncUndoBtns(); closeModal(); } }],
  ]) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = label; b.onclick = fn;
    row.appendChild(b);
  }
  body.appendChild(row);
  body.insertAdjacentHTML('beforeend', '<p class="muted small">Change your farm name from ⚙️ Settings → 👤 Me → Change look.</p>');
}
$('btn-lot').onclick = () => (modalKind === 'lot' ? closeModal() : showLot());

// ---- Time of day preview (build mode only) ----
const PREVIEW_HOURS = [9, 14, 18.6, 23];
function cycleTime() {
  const i = S.previewHour == null ? 0 : PREVIEW_HOURS.indexOf(S.previewHour) + 1;
  S.previewHour = i >= PREVIEW_HOURS.length ? null : PREVIEW_HOURS[i];
  toast(S.previewHour == null ? '🕒 Back to the real time' : `🌗 Previewing ${['morning', 'afternoon', 'evening', 'night'][i]}`);
  syncStrip();
}
$('btn-time').onclick = cycleTime;
$('btn-redo').onclick = redo;

// Eyedropper (Alt+click): pick up whatever is under the cursor as your tool.
function eyedrop(h) {
  const plot = S.plots[S.myPlot];
  const q = pickLocal(h.cx, h.cy), qm = pickLocal(h.cx, h.cy, 1.0);
  if (!q) return;
  const v = levelView(plot, S.level);
  const [lx, ly] = tileOf(q);
  let id = null, rot = 0;
  const hit = objAt(v, lx, ly);
  if (hit) { id = hit.obj.t; rot = hit.obj.r || 0; }
  else if (qm && plot.walls?.[edgeKey(S.level, ...edgeOf(qm).edge)] && edgeOf(qm).dist < 0.25) { const w = plot.walls[edgeKey(S.level, ...edgeOf(qm).edge)]; id = w.f || w.m; }
  else if (v.floor[key(lx, ly)]) id = v.floor[key(lx, ly)];
  if (!id || !ITEMS[id] || ITEMS[id].crop) return toast('Nothing to pick up there');
  if (ITEMS[id].shop && !S.inv[id]) return toast(`No ${ITEMS[id].name} left in your bag`);
  S.cat = ITEMS[id].cat === 'special' || ITEMS[id].shop ? 'special' : ITEMS[id].cat;
  S.tool = toolOf(id);
  S.rot = canRotate(id) ? rot : 0;
  renderTabs(); renderItems();
  toast(`🎯 ${ITEMS[id].name}`);
  refreshPreview();
}

// What the sledgehammer would take (for its label and the undo stack).
function removeLabel(plot, target) {
  if (target.edge) { const w = plot.walls?.[edgeKey(S.level, ...target.edge)]; return w ? (target.featureOnly ? ITEMS[w.f].name : ITEMS[w.m].name) : 'wall'; }
  if (target.roof) return 'roof';
  const v = levelView(plot, S.level);
  const hit = objAt(v, target.lx, target.ly);
  return hit ? ITEMS[hit.obj.t].name : ITEMS[v.floor[key(target.lx, target.ly)]]?.name || 'floor';
}

// The road tools: the tiles under the drag that would change, and why not if refused.
function roadPlan(h) {
  const plot = S.plots[S.myPlot];
  const q = pickLocal(h.cx, h.cy);
  if (!q) return null;
  const on = S.tool.kind === 'pave';
  const r = clampRect(drag ? rectOf(drag.start, drag.cur) : rectOf(tileOf(q), tileOf(q)));
  const tiles = [];
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) if (roadIn(world, plot, r.x + i, r.y + j) !== on) tiles.push([r.x + i, r.y + j]);
  if (!tiles.length) return { tiles: [[r.x, r.y]], err: on ? 'already road' : 'no road there' };
  return { tiles, on, err: roadEditError(world, plot, tiles, on) };
}

// What the land tools would do at the pointer: { rect, ok, info, ...message fields }.
const LAND_SIDES = ['west', 'east', 'north', 'south'];
function landPlan(h) {
  const plot = myDef(), t = S.tool;
  const q = pickWorld(h.cx, h.cy);
  if (!q) return null;
  const landCost = (n) => (S.freeLand ? 0 : Math.max(0, n) * landPrice());
  if (t.kind === 'resize') {
    // Which side are we dragging? Picked on pointer-down, else the nearest one.
    const dist = { west: Math.abs(q.x - plot.x), east: Math.abs(q.x - plot.x - plot.w), north: Math.abs(q.z - plot.y), south: Math.abs(q.z - plot.y - plot.h) };
    const side = drag?.side || LAND_SIDES.reduce((a, b) => (dist[a] <= dist[b] ? a : b));
    if (!drag) return { rect: { ...plot }, ok: true, info: `Drag the ${side} edge` };
    let { x, y, w, h: hh } = plot;
    if (side === 'west') { x = Math.round(q.x); w = plot.x + plot.w - x; }
    else if (side === 'east') w = Math.round(q.x) - plot.x;
    else if (side === 'north') { y = Math.round(q.z); hh = plot.y + plot.h - y; }
    else hh = Math.round(q.z) - plot.y;
    const rect = { x, y, w, h: hh };
    const ix = Math.max(0, Math.min(x + w, plot.x + plot.w) - Math.max(x, plot.x)), iy = Math.max(0, Math.min(y + hh, plot.y + plot.h) - Math.max(y, plot.y));
    const cost = landCost(w * hh - ix * iy);
    const err = landError(S.plots, plot.id, rect, world) || (contentFits(plot, rect) ? null : 'your house wouldn’t fit');
    return { rect, ok: !err && afford(cost), info: `${w}×${hh} · 🪙${cost}${err ? ' · ' + err : ''}`, msg: { type: 'resizePlot', plotId: plot.id, ...rect } };
  }
  if (t.kind === 'merge') {
    const id = world.plotAt[Math.floor(q.z) * MAP_W + Math.floor(q.x)];
    const o = id >= 0 && id !== plot.id ? S.plots[id] : null;
    if (!o) return { rect: { ...plot }, ok: true, info: 'Point at the plot next door' };
    const rect = mergedRect(plot, o);
    const rest = Object.fromEntries(Object.entries(S.plots).filter(([k]) => +k !== o.id));
    const err = o.owner ? 'that plot is owned' : hasContent(o) ? 'that plot isn’t empty' : !rect ? 'plots must line up' : landError(rest, plot.id, rect, world);
    const cost = landCost(o.w * o.h);
    return { rect: rect || o, ok: !err && afford(cost), info: `${rect ? `${rect.w}×${rect.h}` : ''} · 🪙${cost}${err ? ' · ' + err : ''}`, msg: { type: 'mergePlot', plotId: plot.id, other: o.id } };
  }
  const at = Math.round(q.x);
  const parts = splitRects(plot, at);
  if (!parts) return { rect: { ...plot }, ok: false, info: 'Both halves must be at least 8 wide' };
  const fits = parts.map((r) => contentFits(plot, r));
  const keep = fits[0] && fits[1] ? (parts[0].w >= parts[1].w ? 0 : 1) : fits[0] ? 0 : fits[1] ? 1 : -1;
  if (keep < 0) return { rect: { ...plot }, ok: false, info: 'Your house is on both sides of that line' };
  return { rect: parts[keep], sold: parts[1 - keep], at, ok: true, info: `Keep ${parts[keep].w}×${plot.h} · the other ${parts[1 - keep].w}×${plot.h} goes up for sale`, msg: { type: 'splitPlot', plotId: plot.id, at } };
}

function removeTarget(h) {
  const plot = S.plots[S.myPlot];
  const q = pickLocal(h.cx, h.cy), qm = pickLocal(h.cx, h.cy, 1.0);
  if (!q) return null;
  const [lx, ly] = tileOf(q);
  if (S.tool.kind === 'roofRemove') {
    const i = roofAt(plot, lx, ly, S.level);
    if (i < 0) return null;
    const rf = plot.roofs[i];
    const tiles = [];
    for (let j = 0; j < rf.h; j++) for (let k = 0; k < rf.w; k++) tiles.push([rf.x + k, rf.y + j]);
    return { roof: true, lx, ly, tiles, level: S.level + 1 };
  }
  const view_ = levelView(plot, S.level);
  if (qm) {
    const { edge, dist } = edgeOf(qm);
    const w = plot.walls?.[edgeKey(S.level, ...edge)];
    if (w && dist < 0.22) return { edge, featureOnly: !!w.f };
  }
  const hit = objAt(view_, lx, ly);
  if (hit) {
    const [ax, ay] = hit.key.split(',').map(Number);
    const [w, hh] = footprint(hit.obj.t, hit.obj.r || 0);
    const tiles = [];
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) tiles.push([ax + i, ay + j]);
    return { lx, ly, tiles };
  }
  if (view_.floor[key(lx, ly)]) return { lx, ly, tiles: [[lx, ly]] };
  return null;
}

function commit(h) {
  actionSent = [];
  const out = (m) => { actionSent.push(m); send(m); };
  const plot = S.plots[S.myPlot], t = S.tool, d = ITEMS[t.id];
  const base = { plotId: S.myPlot, level: S.level };
  if (t.kind === 'blueprint') return placeBlueprintAt(h, out);
  if (S.held) return dropHeld(h, base, out);
  if (t.kind === 'select') return pickUp(h);
  if (t.kind === 'eyedrop') return eyedrop(h);
  if (t.kind === 'design') return designAt(h, base, out);
  if (t.kind === 'movehouse') return moveHouseAt(h, base, out);
  if (t.kind === 'saveRoom') return saveRoomAt(h);
  if (t.kind === 'wall' && S.wallTool === 'chain') return;
  if (t.kind === 'wall' && S.wallTool === 'paint') {
    const pt = paintTarget(h);
    if (!pt) return toast('Click a wall to paint it');
    const [dd, x, y] = pt.edge;
    const w = plot.walls[edgeKey(S.level, dd, x, y)];
    pushUndo(`painting with ${d.name}`, pt.fill ? [] : [{ type: 'wallPaint', ...base, d: dd, x, y, side: pt.side, m: pt.side ? w.o || w.m : w.m }]);
    return out({ type: 'wallPaint', ...base, d: dd, x, y, side: pt.side, m: t.id, fill: pt.fill });
  }
  if (t.kind === 'remove' && drag?.start && (drag.start[0] !== drag.cur[0] || drag.start[1] !== drag.cur[1])) return sledgeArea(plot, base, out);
  if (t.kind === 'wall') {
    const plan = wallPlan();
    if (!plan || !plan.edges.length) return;
    const fresh = plan.edges.filter((e) => !plot.walls?.[edgeKey(S.level, ...e)] && !wallError(plot, S.level, ...e, world));
    const undo = fresh.map((e) => ({ type: 'remove', ...base, edge: e }));
    out({ type: 'walls', ...base, m: t.id, segs: plan.edges });
    if (plan.room) {
      undo.push(...newFloorUndo(plot, plan.room, 'floor_wood', base));
      out({ type: 'floorRect', ...base, x: plan.room.x, y: plan.room.y, w: plan.room.w, h: plan.room.h, item: 'floor_wood' });
    }
    pushUndo(plan.room ? 'room' : `${fresh.length} wall${fresh.length === 1 ? '' : 's'}`, undo);
  } else if (t.kind === 'floor' || t.kind === 'roof') {
    const q = pickLocal(h.cx, h.cy);
    const end = q ? tileOf(q) : drag?.cur;
    const r = clampRect(rectOf(drag?.start || end, end));
    if (r.w < 1 || r.h < 1) return;
    if (t.kind === 'floor') {
      pushUndo(d.name, newFloorUndo(plot, r, t.id, base));
      out({ type: 'floorRect', ...base, x: r.x, y: r.y, w: r.w, h: r.h, item: t.id });
    } else {
      if (!roofError(plot, r.x, r.y, r.w, r.h, S.level, world)) pushUndo(d.name, [{ type: 'remove', ...base, lx: r.x, ly: r.y, roof: true }]);
      out({ type: 'roof', ...base, x: r.x, y: r.y, w: r.w, h: r.h, m: t.id });
    }
  } else if (t.kind === 'feature') {
    const q = pickLocal(h.cx, h.cy, 1.0);
    if (!q) return;
    const { edge } = edgeOf(q);
    if (!plot.walls?.[edgeKey(S.level, ...edge)]) return toast('Doors and windows go into a wall');
    const had = plot.walls[edgeKey(S.level, ...edge)].f;
    pushUndo(d.name, had ? [{ type: 'feature', ...base, d: edge[0], x: edge[1], y: edge[2], f: had }] : [{ type: 'remove', ...base, edge, featureOnly: true }]);
    out({ type: 'feature', ...base, d: edge[0], x: edge[1], y: edge[2], f: t.id });
  } else if (t.kind === 'obj') {
    const q = pickLocal(h.cx, h.cy);
    if (!q) return;
    const r = canRotate(t.id) ? S.rot : 0;
    const [w, hh] = footprint(t.id, r);
    const lx = Math.round(q.fx - w / 2), ly = Math.round(q.fz - hh / 2);
    const err = placementError(plot, lx, ly, t.id, r, S.level, world);
    if (err) { if (err !== 'Already there') toast(err); return; }
    if (!S.freeBuild && (d.shop ? !S.inv[t.id] : d.price > S.coins)) return toast(d.shop ? `None left — buy more from ${NPCS[d.shop].name}` : 'Not enough coins — sell some crops!');
    pushUndo(d.name, [{ type: 'remove', ...base, lx, ly }]);
    out({ type: 'place', ...base, lx, ly, item: t.id, r });
  } else if (t.kind === 'remove' || t.kind === 'roofRemove') {
    const target = removeTarget(h);
    if (!target) return;
    pushUndo(`removing ${removeLabel(plot, target)}`, removeUndo(plot, target, base));
    if (target.edge) out({ type: 'remove', ...base, edge: target.edge, featureOnly: target.featureOnly });
    else out({ type: 'remove', ...base, lx: target.lx, ly: target.ly, roof: !!target.roof });
  } else if (t.kind === 'pave' || t.kind === 'dig') {
    const plan = roadPlan(h);
    if (!plan) return;
    if (plan.err) return toast(plan.err);
    out({ type: 'road', plotId: S.myPlot, tiles: plan.tiles, on: plan.on });
  } else if (t.kind === 'resize' || t.kind === 'merge' || t.kind === 'split') {
    const plan = landPlan(h);
    if (plan?.msg && plan.ok) out(plan.msg);
    else if (plan?.info && drag) toast(plan.info.split(' · ').pop());
  }
}

// ---------- Settings (cheat console + controls) ----------
// The console form lives in index.html and is moved into the settings sheet when it opens.
const consoleForm = $('console');
const consoleLog = $('console-log');
const consoleInput = $('console-input');
consoleForm.remove();
const CHEAT_CHIPS = ['testingcheats true', 'motherlode', 'kaching', 'freerealestate on', 'bb.enablefreebuild', 'tp cityhall', 'help'];

// Settings has two tabs: 👤 Me (your character and account) and ⚙️ Game (cheats, controls).
let settingsTab = 'me';
function showSettings(tab = settingsTab) {
  settingsTab = tab;
  const root = openModal('settings', '⚙️ Settings');
  const tabs = document.createElement('div');
  tabs.className = 'seg';
  for (const [k, label] of [['me', `👤 ${S.me?.name || 'Me'}`], ['game', '⚙️ Game']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = k === tab ? 'sel' : '';
    b.onclick = () => showSettings(k);
    tabs.appendChild(b);
  }
  root.appendChild(tabs);
  const body = document.createElement('div');
  root.appendChild(body);
  if (tab === 'me') return renderMe(body);
  body.insertAdjacentHTML('beforeend', `
    <h3>🧪 Cheats</h3>
    <p class="muted">Type <b>testingcheats true</b> first, then <b>money 5000</b>, <b>motherlode</b> (+50,000), <b>kaching</b> or <b>rosebud</b> (+1,000), <b>freerealestate on</b> or <b>bb.enablefreebuild</b>.</p>`);
  body.appendChild(consoleForm);
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const cmd of CHEAT_CHIPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = cmd;
    b.onclick = () => runCheat(cmd);
    chips.appendChild(b);
  }
  body.appendChild(chips);
  body.insertAdjacentHTML('beforeend', `
    <h3>🎮 Controls</h3>
    <div class="keys">
      <span>Walk</span><span>WASD / arrows · drag on a phone</span>
      <span>Run</span><span>hold Shift · drag the joystick far out</span>
      <span>Rotate camera</span><span>hold the scroll wheel and drag · Q / E · two-finger twist</span>
      <span>Move camera</span><span>right-drag · two-finger drag</span>
      <span>Zoom</span><span>mouse wheel · pinch</span>
      <span>Talk</span><span>Enter, or click a villager</span>
      <span>Village map</span><span>M, or tap the minimap</span>
      <span>Build mode</span><span>B · H select/move · C copy (or Alt+click) · K sledgehammer · T design · L time of day · R or right-click rotate · V walls · PgUp/PgDn floors · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo · Delete sells what you're holding · Enter or double-click finishes a custom room · Esc cancels</span>
    </div>`);
  consoleLog.scrollTop = consoleLog.scrollHeight;
  if (matchMedia('(pointer: fine)').matches) consoleInput.focus();
}

function consoleLine(text, mine = false) {
  const d = document.createElement('div');
  d.textContent = text;
  if (mine) d.className = 'mine';
  consoleLog.appendChild(d);
  while (consoleLog.children.length > 40) consoleLog.firstChild.remove();
  consoleLog.scrollTop = consoleLog.scrollHeight;
  if (!mine && !(modalKind === 'settings' && settingsTab === 'game')) toast(text);
}
function runCheat(cmd) {
  cmd = cmd.trim();
  if (!cmd) return;
  consoleLine('> ' + cmd, true);
  const c = cmd.toLowerCase();
  if (c.startsWith('freerealestate')) S.freeLand = /\b(on|true)\b/.test(c);
  send({ type: 'cheat', cmd });
}
consoleForm.onsubmit = (e) => {
  e.preventDefault();
  runCheat(consoleInput.value);
  consoleInput.value = '';
};
consoleInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); e.stopPropagation(); });

// ---------- Input ----------
const cv = $('game');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 3);
  overlay.width = Math.round(innerWidth * dpr);
  overlay.height = Math.round(innerHeight * dpr);
  view.resize();
}
addEventListener('resize', resize);
resize();

const keys = new Set();
addEventListener('keydown', (e) => {
  if (!S.me || document.activeElement?.tagName === 'INPUT') return;
  if (e.key === 'Enter' && S.mode === 'build' && S.chain) { e.preventDefault(); finishChain(false); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (S.talk) $('npc-input').focus();
    else if (lastAction.startsWith('talk')) $('action').click();
    else openChat();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'escape' && (S.held || S.chain)) { S.held = null; S.chain = null; if (S.tool.kind === 'movehouse' || S.tool.kind === 'blueprint') S.tool = { kind: 'none' }; syncStrip(); renderItems(); refreshPreview(); return; }
  if (k === 'escape' && !$('usemenu').hidden) { closeUseMenu(); return; }
  if (k === 'escape') { if (drag) { drag = null; refreshPreview(); } else { setMode('walk'); closeTalk(); closeModal(); toggleMap(false); } }
  if (k === 'b') $('btn-build').click();
  if (k === 'q') turnCamera(-1);
  if (k === 'e') turnCamera(1);
  if (k === 'i') $('btn-bag').click();
  if (k === 'm') toggleMap();
  if (S.mode === 'build') {
    if (k === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); redo(); return; }
    if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); return; }
    if (k === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); return; }
    if ((k === 'delete' || k === 'backspace') && S.held?.kind === 'obj') {
      const H = S.held; S.held = null;
      send({ type: 'remove', plotId: S.myPlot, level: S.level, lx: H.from[0], ly: H.from[1] });
      refreshPreview(); keys.add(k); return;
    }
    if (k === 'delete' || k === 'backspace' || k === 'x' || k === 'k') setStripTool('remove');
    if (k === 'h') setStripTool('select');
    if (k === 'c' && !e.ctrlKey && !e.metaKey) setStripTool('eyedrop');
    if (k === 't') setStripTool('design');
    if (k === 'l') cycleTime();
    if (k === 'enter' && S.chain) finishChain(false);
    if (k === 'r') rotateItem();
    if (k === 'v') cycleWalls();
    if (e.key === 'PageUp') setLevel(1);
    if (e.key === 'PageDown') setLevel(0);
  }
  keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
cv.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll

const pointers = new Map();
const stick = { id: null, sx: 0, sy: 0, x: 0, y: 0, active: false, moved: false, t: 0 };
let gesture = null; // two-finger pan/pinch, or right-mouse pan

// Drag the view: in build mode the camera itself moves; while walking it looks away
// from your villager and drifts back once you start moving.
function panBy(dx, dy) {
  const k = (view.camera.top - view.camera.bottom) / cv.clientHeight;
  const g = view.ground();
  const target = S.mode === 'build' ? view.goal : view.offset;
  target.x += (-g.rx * dx + g.fx * dy / Math.sin(view.pitch)) * k;
  target.z += (-g.rz * dx + g.fz * dy / Math.sin(view.pitch)) * k;
}

cv.addEventListener('pointerdown', (e) => {
  if (!S.me) return;
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 || e.button === 1 || e.button === 2) {
    // Middle mouse orbits, right mouse pans, two fingers pan / pinch-zoom / twist-rotate.
    e.preventDefault();
    const pts = [...pointers.values()];
    gesture = {
      kind: e.button === 1 ? 'orbit' : 'pan', cx: e.clientX, cy: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button,
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      ang: pts.length === 2 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0,
    };
    drag = null; stick.id = null; stick.active = false;
    refreshPreview();
    return;
  }
  hover = { cx: e.clientX, cy: e.clientY };
  if (S.mode === 'build' && e.altKey) { eyedrop(hover); pointers.delete(e.pointerId); return; }
  if (S.mode === 'build') {
    const q = pickLocal(e.clientX, e.clientY);
    if (q && S.tool.kind === 'remove' && !S.held) drag = { start: tileOf(q), cur: tileOf(q) };
    else if (q && S.tool.kind === 'wall' && (S.wallTool === 'chain' || S.wallTool === 'paint')) drag = null;
    else if (q && ['wall', 'floor', 'roof', 'pave', 'dig'].includes(S.tool.kind)) drag = { start: S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q), cur: S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q) };
    else if (['resize', 'merge', 'split'].includes(S.tool.kind)) {
      const plot = myDef(), w = pickWorld(e.clientX, e.clientY);
      const dist = w ? { west: Math.abs(w.x - plot.x), east: Math.abs(w.x - plot.x - plot.w), north: Math.abs(w.z - plot.y), south: Math.abs(w.z - plot.y - plot.h) } : null;
      drag = { side: dist ? LAND_SIDES.reduce((a, b) => (dist[a] <= dist[b] ? a : b)) : 'east' };
    }
    refreshPreview();
    return;
  }
  stick.id = e.pointerId;
  stick.sx = stick.x = e.clientX; stick.sy = stick.y = e.clientY;
  stick.moved = false; stick.t = performance.now();
});

cv.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && prev) {
    const pts = [...pointers.values()];
    if (pts.length === 2) {
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2, dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      panBy(cx - gesture.cx, cy - gesture.cy);
      if (gesture.dist > 0 && dist > 0) view.zoomBy(gesture.dist / dist);
      let da = ang - gesture.ang;
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) < 0.5) view.orbit(-da, 0);
      Object.assign(gesture, { cx, cy, dist, ang });
    } else if (gesture.kind === 'orbit') {
      view.orbit(-(e.clientX - gesture.cx) * 0.008, (e.clientY - gesture.cy) * 0.004);
      Object.assign(gesture, { cx: e.clientX, cy: e.clientY });
    } else {
      panBy(e.clientX - gesture.cx, e.clientY - gesture.cy);
      Object.assign(gesture, { cx: e.clientX, cy: e.clientY });
    }
    return;
  }
  if (S.mode === 'build') {
    hover = { cx: e.clientX, cy: e.clientY };
    if (drag && drag.start) {
      const q = pickLocal(e.clientX, e.clientY);
      if (q) drag.cur = S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q);
      if (q && S.tool.kind === 'remove') drag.cur = tileOf(q);
    }
    refreshPreview();
    return;
  }
  if (e.pointerId !== stick.id) return;
  stick.x = e.clientX; stick.y = e.clientY;
  if (Math.hypot(stick.x - stick.sx, stick.y - stick.sy) > 10) { stick.moved = true; stick.active = true; }
});

const endPointer = (e) => {
  const had = pointers.delete(e.pointerId);
  if (gesture) {
    // A quick right-click (no drag) rotates the item you're placing.
    const g = gesture;
    if (g.button === 2 && S.mode === 'build' && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6 && performance.now() - g.t < 450) {
      if (S.held || (S.tool.kind === 'obj' && canRotate(S.tool.id))) rotateItem(); else if (S.tool.kind === 'obj') toast('That item can’t be rotated');
    }
    if (!pointers.size) gesture = null;
    return;
  }
  if (!had) return;
  if (S.mode === 'build') {
    if (e.type === 'pointerup') {
      if (S.tool.kind === 'wall' && S.wallTool === 'chain' && !S.held) chainClick({ cx: e.clientX, cy: e.clientY });
      else commit({ cx: e.clientX, cy: e.clientY });
    }
    drag = null;
    if (e.pointerType !== 'mouse') hover = null;
    refreshPreview();
    toolInfo();
    return;
  }
  if (e.pointerId !== stick.id) return;
  if (!stick.moved && performance.now() - stick.t < 350) onTap(e.clientX, e.clientY);
  stick.id = null; stick.active = false;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('dblclick', () => { if (S.mode === 'build' && S.chain) finishChain(false); });
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && S.mode === 'build' && !drag) { hover = null; refreshPreview(); } });

function onTap(cx, cy) {
  closeUseMenu();
  // Tap furniture to use it (Sims-style menu).
  const u = usableAt(cx, cy);
  if (u) {
    if (S.act) { toast(`You’re busy: ${ACTIVITIES[S.act].verb.toLowerCase()}`); return; }
    if (!u.uses.length) { toast('You can only use things in someone’s home while they’re in'); return; }
    if (u.d > TILE * 1.5) { toast(`Walk up to the ${ITEMS[u.t].name.toLowerCase()} first`); return; }
    openUseMenu(u, cx, cy - 10);
    return;
  }
  // Tap an NPC to talk.
  for (const n of S.npcs.values()) {
    if (NPC_ACTS[n.act]?.hidden) continue;
    const p = view.toScreen(U(n.x), 0.8, U(n.y));
    if (Math.hypot(p.x - cx, p.y - cy) < 34) {
      if (Math.hypot(n.x - S.me.x, n.y - S.me.y) < TILE * 3.4) send({ type: 'npcOpen', npc: n.id });
      else toast(`Walk closer to ${n.name}`);
      return;
    }
  }
  if (S.myPlot == null) return;
  const def = myDef();
  const p = view.pick(cx, cy, 0);
  if (!p) return;
  const lx = Math.floor(p.x - def.x), ly = Math.floor(p.z - def.y);
  const hit = objAt(S.plots[S.myPlot], lx, ly);
  if (hit && ITEMS[hit.obj.t]?.crop && cropStage(hit.obj, serverNow()) === 3 && Math.hypot(p.x * TILE - S.me.x, p.z * TILE - S.me.y) < TILE * 3) {
    send({ type: 'harvest', plotId: S.myPlot, lx, ly });
  }
}

// Input in screen terms: x = right, y = down (towards the camera).
function inputVector() {
  let x = 0, y = 0;
  if (keys.has('arrowleft') || keys.has('a')) x -= 1;
  if (keys.has('arrowright') || keys.has('d')) x += 1;
  if (keys.has('arrowup') || keys.has('w')) y -= 1;
  if (keys.has('arrowdown') || keys.has('s')) y += 1;
  let run = keys.has('shift');
  if (stick.active) {
    const dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy);
    if (d > 8) { const k = Math.min(1, d / 40) / d; x = dx * k; y = dy * k; }
    run = d > 75; // drag the joystick far out to run
  }
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len, run } : { x, y, run };
}

// ---------- Plots in 3D ----------
let plotsDirty = true;
let lastHeld = null;
let lastPlotSync = 0;
function plotOpts(id) {
  const base = { cut: 'up', maxLevel: LEVELS - 1, roofs: true, now: serverNow() };
  if (S.mode === 'build' && id === S.myPlot) return { ...base, cut: S.wallMode, maxLevel: S.level, roofs: S.wallMode === 'up' };
  // Walking inside a house: cut the walls away and hide what's above, Sims-style.
  if (S.me && plotIdAtPixel(world, S.me.x, S.me.y) === id) {
    // Upstairs (or climbing): show both floors, cut away, no roof.
    if (heightAt(world, S.plots, S.me.x, S.me.y, S.me.level) > 0.4) return { ...base, cut: 'cut', maxLevel: 1, roofs: false };
    const def = S.plots[id];
    const lx = Math.floor(U(S.me.x)) - def.x, ly = Math.floor(U(S.me.y)) - def.y;
    const f = S.plots[id].floor[key(lx, ly)];
    if (f && f !== 'soil' && f !== 'floor_stone') return { ...base, cut: 'cut', maxLevel: 0, roofs: false };
  }
  return base;
}
function syncPlots(force) {
  const now = performance.now();
  if (!force && !plotsDirty && now - lastPlotSync < 1500) return;
  plotsDirty = false;
  lastPlotSync = now;
  const sNow = serverNow();
  // Until the server answers a move, keep the old spot empty (but never for long).
  if (S.dropped && now - S.droppedAt > 4000) S.dropped = null;
  const carried = S.held?.kind !== 'blueprint' && S.held || S.dropped;
  // Nearest plots first, and at most two rebuilds a frame so building never freezes the
  // game (the rest catch up over the next frames).
  const plots = Object.values(S.plots).sort((a, b) => plotDist(a) - plotDist(b));
  let rebuilt = 0;
  for (let st of plots) {
    let variant = '';
    if (carried && st.id === S.myPlot) { st = liftedPlot(st, carried); variant = `lift:${carried.kind}:${carried.from || ''}:${carried.ox},${carried.oy}`; }
    const crops = Object.values(st.obj).filter((o) => ITEMS[o.t]?.crop).map((o) => cropStage(o, sNow)).join('');
    const e = st.owner ? null : plotEntrance(world, st);
    if (view.setPlot(st, { ...plotOpts(st.id), crops, variant, entrance: e && { x: e.x / TILE, z: e.y / TILE } }) && ++rebuilt >= 2 && !force) {
      plotsDirty = true;
      return;
    }
  }
}
const plotDist = (p) => (S.me ? Math.hypot((p.x + p.w / 2) * TILE - S.me.x, (p.y + p.h / 2) * TILE - S.me.y) : 0);

// ---------- Update ----------
let sendAcc = 0, lastSent = '', lastQuadrant = -1;
function update(dt) {
  const me = S.me;
  let v = S.mode === 'walk' ? inputVector() : { x: 0, y: 0 };
  if (S.act) {
    // Busy (in the shower, asleep...): moving gets you up instead.
    if (Math.hypot(v.x, v.y) > 0.1 && !S.stopSent) { S.stopSent = true; send({ type: 'stop' }); }
    v = { x: 0, y: 0 };
  }
  me.act = S.act || 0;
  me.moving = Math.hypot(v.x, v.y) > 0.1;
  me.running = me.moving && !!v.run;
  if (me.moving) view.offset.multiplyScalar(Math.max(0, 1 - dt * 3));
  if (view.quadrant !== lastQuadrant) { lastQuadrant = view.quadrant; plotsDirty = true; }
  if (me.moving) {
    const g = view.ground();
    const wx = g.rx * v.x - g.fx * v.y, wz = g.rz * v.x - g.fz * v.y;
    const tired = S.needs && (S.needs.energy < 8 || S.needs.health < 20) ? 0.7 : 1; // exhausted or unwell: slower
    const sp = PLAYER_SPEED * (me.running ? RUN_MULT : 1) * tired * dt;
    const nx = me.x + wx * sp, ny = me.y + wz * sp;
    // Each axis separately, so you slide along walls; stairs change your level.
    let l = stepLevel(world, S.plots, nx, me.y, me.level);
    if (l >= 0) { me.x = nx; me.level = l; }
    l = stepLevel(world, S.plots, me.x, ny, me.level);
    if (l >= 0) { me.y = ny; me.level = l; }
    me.dir = Math.abs(wx) > Math.abs(wz) ? (wx < 0 ? 2 : 3) : (wz < 0 ? 1 : 0);
    if (S.talk) { const n = S.npcs.get(S.talk.npc); if (n && Math.hypot(n.x - me.x, n.y - me.y) > TILE * 4) closeTalk(); }
  }
  if (S.mode === 'build') {
    // WASD pans in build mode.
    let px = 0, py = 0;
    if (keys.has('a') || keys.has('arrowleft')) px += 1;
    if (keys.has('d') || keys.has('arrowright')) px -= 1;
    if (keys.has('w') || keys.has('arrowup')) py += 1;
    if (keys.has('s') || keys.has('arrowdown')) py -= 1;
    if (px || py) panBy(px * 500 * dt, py * 500 * dt);
  }
  sendAcc += dt;
  if (sendAcc >= 0.1) {
    sendAcc = 0;
    const msg = { type: 'move', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, d: me.dir, m: me.running ? 2 : me.moving ? 1 : 0 };
    const sig = `${msg.x},${msg.y},${msg.d},${msg.m}`;
    if (sig !== lastSent) { lastSent = sig; send(msg); }
  }
  const k = Math.min(1, dt * 10);
  // Other players are drawn ~120 ms in the past, interpolating between the positions
  // the server sent: smooth, even motion whatever the network timing.
  const at = serverNow() - 120;
  for (const p of S.players.values()) {
    const buf = p.buf;
    if (!buf?.length || Math.hypot(p.tx - p.x, p.ty - p.y) > 96) { p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; continue; }
    let i = buf.length - 1;
    while (i > 0 && buf[i - 1].t > at) i--;
    const b = buf[i], a = buf[i - 1];
    if (!a || at >= b.t) { p.x += (b.x - p.x) * k; p.y += (b.y - p.y) * k; continue; }
    const f = Math.max(0, Math.min(1, (at - a.t) / Math.max(1, b.t - a.t)));
    p.x = a.x + (b.x - a.x) * f; p.y = a.y + (b.y - a.y) * f;
  }
  for (const n of S.npcs.values()) { n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k; }
  updatePets(dt);
  if (S.held !== lastHeld) { lastHeld = S.held; plotsDirty = true; }
  if (plotsDirty) syncPlots();
}

// ---------- Needs & using furniture ----------
const needCol = (v) => (v >= 60 ? '#5fc44a' : v >= 30 ? '#e8c23a' : v >= 15 ? '#ec8a2c' : '#e0453a');
let needsOpen = store.get('needsOpen') !== '0';
function renderNeeds() {
  const el = $('needs');
  if (!S.needs) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.toggle('open', needsOpen);
  const m = mood(S.needs);
  // The plumbob: green when you're happy, yellow, then red.
  $('plumbob').style.background = `hsl(${Math.round(60 + m * 60)}, 75%, 50%)`;
  $('needs-mood').textContent = m > 0.5 ? 'Happy' : m > 0 ? 'Fine' : m > -0.5 ? 'Uncomfortable' : 'Miserable';
  const fill = S.act && ACTIVITIES[S.act]?.gain || {};
  $('needs-bars').innerHTML = [...NEEDS, HEALTH].map((n) => {
    const v = Math.round(S.needs[n.id] ?? 0);
    return `<div class="need${v < 15 ? ' low' : ''}${fill[n.id] ? ' up' : ''}" title="${n.name} ${v}%"><span>${n.icon}</span><i><b style="width:${v}%;background:${needCol(v)}"></b></i><small>${n.name}</small></div>`;
  }).join('');
}
$('needs-head').onclick = () => { needsOpen = !needsOpen; store.set('needsOpen', needsOpen ? '1' : '0'); renderNeeds(); };

// What you can do with an item right now: eating needs a plate in your hands, and
// you can't fetch more food while you're holding some.
const usesNow = (t) => usesOf(t).filter((id) => (ACTIVITIES[id].carry ? !!S.carry : !(ACTIVITIES[id].makes && S.carry)));

// Everything you can do with a placed item right now: its activities, plus shop
// actions (stock or browse a shelf, run a machine).
const SHOP_ACTS = {
  'shop:stock': { icon: '📦', label: 'Stock & set prices' },
  'shop:browse': { icon: '🛍️', label: 'Browse & buy' },
  'shop:make': { icon: '⚙️', label: 'Make something' },
  'shop:collect': { icon: '✅', label: 'Collect' },
  'shop:wait': { icon: '⏳', label: 'Working…' },
};
const actInfo = (id) => ACTIVITIES[id] || SHOP_ACTS[id];
function actionsFor(plot, o) {
  const mine = plot.owner === S.me.id;
  const out = canUseOn(plot) ? usesNow(o.t).filter((id) => !ACTIVITIES[id].shop || (mine && plot.biz)) : [];
  if (slotsOf(o.t)) { if (mine) out.push('shop:stock'); else if (plot.biz) out.push('shop:browse'); }
  if (isMachine(o.t) && mine) out.push(o.job ? (serverNow() >= o.job.ready ? 'shop:collect' : 'shop:wait') : 'shop:make');
  return out;
}

// You can use things at home, or in someone's home while they're in.
function canUseOn(plot) {
  if (!plot?.owner) return false;
  if (plot.owner === S.me.id) return true;
  const host = S.players.get(plot.owner);
  return !!host && plotIdAtPixel(world, host.x, host.y) === plot.id;
}
// Distance (px) from you to an item's footprint.
function distTo(plot, ax, ay, t, r) {
  const [w, h] = footprint(t, r || 0);
  const x0 = (plot.x + ax) * TILE, y0 = (plot.y + ay) * TILE, x1 = x0 + w * TILE, y1 = y0 + h * TILE;
  return Math.hypot(Math.max(x0 - S.me.x, 0, S.me.x - x1), Math.max(y0 - S.me.y, 0, S.me.y - y1));
}
function nearestUsable(range = TILE * 1.5) {
  const here = plotIdAtPixel(world, S.me.x, S.me.y);
  const plot = here >= 0 ? S.plots[here] : null;
  if (!plot || !(canUseOn(plot) || plot.biz)) return null;
  const level = S.me.level || 0, view = level ? plot.l1 : plot;
  if (!view) return null;
  let best = null;
  for (const [k, o] of Object.entries(view.obj)) {
    const uses = actionsFor(plot, o);
    if (!uses.length) continue;
    const [ax, ay] = k.split(',').map(Number);
    const d = distTo(plot, ax, ay, o.t, o.r);
    if (d <= range && (!best || d < best.d)) best = { plot, level, key: k, lx: ax, ly: ay, t: o.t, uses, d };
  }
  return best;
}
// The usable item under a screen point (on your floor): the one whose middle shows up
// closest to the tap, like tapping a villager.
function usableAt(cx, cy) {
  const level = S.me.level || 0;
  let best = null, bd = 40;
  for (const plot of Object.values(S.plots)) {
    if (!plot.owner) continue;
    const v = level ? plot.l1 : plot;
    if (!v) continue;
    for (const [k, o] of Object.entries(v.obj)) {
      const uses = actionsFor(plot, o);
      if (!uses.length) continue;
      const [ax, ay] = k.split(',').map(Number);
      const [w, h] = footprint(o.t, o.r || 0);
      const p = view.toScreen(plot.x + ax + w / 2, level * LEVEL_H + 0.5, plot.y + ay + h / 2);
      const d = Math.hypot(p.x - cx, p.y - cy) / Math.max(1, Math.sqrt(w * h) * 0.8);
      if (d < bd) { bd = d; best = { plot, level, key: k, lx: ax, ly: ay, t: o.t, uses, d: distTo(plot, ax, ay, o.t, o.r) }; }
    }
  }
  return best;
}
function useThing(u, act) {
  closeUseMenu();
  if (act.startsWith('shop:')) return shopAction(u, act);
  const a = ACTIVITIES[act];
  if (a.cost && S.coins < a.cost) return toast('Not enough coins');
  send({ type: 'use', plotId: u.plot.id, level: u.level, lx: u.lx, ly: u.ly, act });
}
// A little Sims-style pie of choices next to the item.
function openUseMenu(u, x, y) {
  const el = $('usemenu');
  el.innerHTML = `<div class="um-title">${esc(ITEMS[u.t].name)}</div>`;
  const hasStove = [u.plot, u.plot.l1].some((v) => v && Object.values(v.obj).some((o) => o.t === 'stove'));
  const o = (u.level ? u.plot.l1 : u.plot).obj[u.key];
  for (const id of u.uses) {
    const a = actInfo(id);
    const b = document.createElement('button');
    const off = (a.stove && !hasStove) || id === 'shop:wait';
    let label = a.label;
    if (id === 'shop:collect') label = `Collect ${GOODS[RECIPES[o.job.r].out].name}`;
    if (id === 'shop:wait') label = `${RECIPES[o.job.r].label}: ready in ${Math.max(1, Math.ceil((o.job.ready - serverNow()) / (DAY_MS / 24 / 6))) * 10} min`;
    b.innerHTML = `<span>${a.icon}</span>${esc(label)}${a.cost ? ` <small>🪙${a.cost}</small>` : ''}${a.stove && !hasStove ? ' <small>(needs a stove)</small>' : ''}`;
    b.disabled = off;
    b.onclick = (e) => { e.stopPropagation(); useThing(u, id); };
    el.appendChild(b);
  }
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2))}px`;
  el.style.top = `${Math.max(8, Math.min(innerHeight - r.height - 8, y - r.height))}px`;
}
function closeUseMenu() { const el = $('usemenu'); if (el) el.hidden = true; }

// ---------- Shops ----------
function shopAction(u, act) {
  const o = (u.level ? u.plot.l1 : u.plot).obj[u.key];
  const at = { plotId: u.plot.id, level: u.level, lx: u.lx, ly: u.ly };
  if (act === 'shop:collect') return send({ type: 'collect', ...at });
  if (act === 'shop:make') return showMake(u, at);
  if (act === 'shop:stock') return showStock(u, at);
  if (act === 'shop:browse') return showBrowse(u, at, o);
}
const shelfOf = (u) => (u.level ? u.plot.l1 : u.plot).obj[u.key];

// Owner: what's on this shelf, prices, and adding goods from the bag.
function showStock(u, at) {
  const body = openModal('stock', `📦 ${ITEMS[u.t].name}`);
  const draw = () => {
    body.innerHTML = '';
    const o = shelfOf(u);
    const stock = o?.stock || [];
    body.insertAdjacentHTML('beforeend', `<p class="muted">${stock.length}/${slotsOf(u.t)} kinds of goods. Customers buy more when prices are fair (around the value shown).</p>`);
    stock.forEach((sl, i) => {
      const row = itemRow(sl.item, `×${sl.n} on the shelf · worth about 🪙${valueOf(sl.item)}`, []);
      const price = document.createElement('input');
      price.type = 'number'; price.min = 1; price.value = sl.price; price.className = 'price';
      price.addEventListener('keydown', (e) => e.stopPropagation());
      price.onchange = () => send({ type: 'restock', ...at, slot: i, price: +price.value });
      const take = document.createElement('button'); take.textContent = 'Take back';
      take.onclick = () => send({ type: 'restock', ...at, slot: i, take: true });
      row.append(document.createTextNode('🪙'), price, take);
      body.appendChild(row);
    });
    const goods = Object.entries(S.inv).filter(([k, n]) => n > 0 && sellable(k));
    body.insertAdjacentHTML('beforeend', '<h3>Add from your bag</h3>');
    if (!goods.length) body.insertAdjacentHTML('beforeend', '<p class="muted">Nothing to sell yet: harvest crops, or make products in machines (Build → Shop & Machines).</p>');
    for (const [k, n] of goods) {
      const row = itemRow(k, `×${n} in your bag · worth about 🪙${valueOf(k)}`, []);
      const qty = document.createElement('input'); qty.type = 'number'; qty.min = 1; qty.max = n; qty.value = n; qty.className = 'qty';
      const price = document.createElement('input'); price.type = 'number'; price.min = 1; price.value = stock.find((x) => x.item === k)?.price || valueOf(k); price.className = 'price';
      for (const i of [qty, price]) i.addEventListener('keydown', (e) => e.stopPropagation());
      const add = document.createElement('button'); add.textContent = 'Put out';
      add.onclick = () => send({ type: 'stock', ...at, item: k, n: +qty.value, price: +price.value });
      row.append(qty, document.createTextNode(' × 🪙'), price, add);
      body.appendChild(row);
    }
  };
  draw();
  S.stockRedraw = draw;
}

// Customers: buy off someone's shelf.
function showBrowse(u, at, o) {
  const owner = u.plot.biz;
  const body = openModal('browse', `🛍️ ${owner?.name || 'Shop'}`);
  const draw = () => {
    body.innerHTML = '';
    const stock = shelfOf(u)?.stock || [];
    const { hours } = worldClock(serverNow(), S.epoch);
    const tillManned = [...S.players.values()].some((p) => p.id === u.plot.owner && p.act === 'cashier');
    if (!shopOpen(owner, hours, tillManned)) body.insertAdjacentHTML('beforeend', `<p class="warn">Closed right now${owner?.staff ? ` (${STAFF[owner.staff].name} works ${OPEN_HOURS[0]} AM – ${OPEN_HOURS[1] - 12} PM)` : ''}.</p>`);
    if (!stock.length) body.insertAdjacentHTML('beforeend', '<p class="muted">This shelf is empty.</p>');
    stock.forEach((sl, i) => {
      body.appendChild(itemRow(sl.item, `×${sl.n} · 🪙${sl.price} each`, [[`Buy 1 · 🪙${sl.price}`, () => send({ type: 'buyStock', ...at, slot: i, n: 1 }), S.coins < sl.price]]));
    });
  };
  draw();
  S.stockRedraw = draw;
}

// Owner: start a machine on a recipe.
function showMake(u, at) {
  const body = openModal('make', `⚙️ ${ITEMS[u.t].name}`);
  for (const r of recipesFor(u.t)) {
    const has = Object.entries(r.needs).every(([k, n]) => (S.inv[k] || 0) >= n);
    const needs = Object.entries(r.needs).map(([k, n]) => `${n} × ${GOODS[k].name} (have ${S.inv[k] || 0})`).join(' + ');
    body.appendChild(itemRow(r.out, `${needs} → ${r.n} in ${r.hours} h · worth 🪙${valueOf(r.out)} each`, [[has ? 'Make' : 'Need more', () => { send({ type: 'craft', ...at, recipe: r.id }); closeModal(); }, !has]]));
  }
}

// Owner's business panel: open/closed, staff, takings.
function showShop() {
  const b = S.biz;
  const body = openModal('shop', `🏪 ${b ? b.name : 'Business'}`);
  if (!b) { body.innerHTML = '<p class="muted">Start a business at City Hall (🪙500).</p>'; return; }
  const plot = b.plotId != null ? S.plots[b.plotId] : null;
  body.innerHTML = `
    <div class="city-card"><div>${plot ? `Shop on plot ${plot.id + 1}` : '<b>No shop plot yet</b>: stand on a plot that’s for sale and tap “Open my shop here”.'}</div>
    <div>Status: <b>${b.open ? '🟢 Open' : '🔴 Closed'}</b>${b.closed ? ' (you closed it)' : ''} · ${b.stockCount} items on shelves · street traffic ${'🚶'.repeat(Math.max(1, Math.round(b.traffic + 1)))}</div>
    <div>Today: <b>🪙${b.sales.day === worldClock(serverNow(), S.epoch).day ? b.sales.today : 0}</b> · All time: <b>🪙${b.sales.total}</b> (${b.sales.items || 0} sold)</div></div>
    <p class="muted small">Open while you work the cash register, or while a clerk is in (${OPEN_HOURS[0]} AM – ${OPEN_HOURS[1] - 12} PM). Busy roads bring more customers; fair prices sell faster.</p>`;
  const row = document.createElement('div'); row.className = 'row';
  const name = document.createElement('input'); name.value = b.name; name.maxLength = 24;
  name.addEventListener('keydown', (e) => e.stopPropagation());
  const rn = document.createElement('button'); rn.className = 'chip'; rn.textContent = 'Rename';
  rn.onclick = () => send({ type: 'bizRename', name: name.value });
  const oc = document.createElement('button'); oc.className = 'chip'; oc.textContent = b.closed ? '🟢 Reopen' : '🔴 Close shop';
  oc.onclick = () => send({ type: 'bizClosed', closed: !b.closed });
  row.append(name, rn, oc);
  body.appendChild(row);
  body.insertAdjacentHTML('beforeend', '<h3>Staff</h3>');
  for (const [id, st] of Object.entries(STAFF)) {
    const hired = b.staff === id;
    const r = document.createElement('div'); r.className = 'item-row';
    const pic = document.createElement('canvas'); pic.className = 'portrait'; pic.width = 44; pic.height = 44;
    drawLook(pic, st.look, { crop: 'bust' });
    const nm = document.createElement('div'); nm.className = 'nm';
    nm.innerHTML = `${esc(st.name)}${hired ? ' <span class="tag">working for you</span>' : ''}<small>${esc(st.line)} · 🪙${st.wage}/day</small>`;
    const btn = document.createElement('button');
    btn.textContent = hired ? 'Let go' : b.staff ? 'Hire instead' : 'Hire';
    btn.onclick = () => send(hired ? { type: 'bizFire' } : { type: 'bizHire', staff: id });
    r.append(pic, nm, btn);
    body.appendChild(r);
  }
  if (b.log?.length) {
    body.insertAdjacentHTML('beforeend', `<h3>Recent sales</h3><div class="list">${b.log.map((l) => `<div class="news"><span class="muted">Day ${l.day}</span> ${esc(l.who)} bought ${l.n > 1 ? `${l.n} × ` : ''}${esc(GOODS[l.item]?.name || l.item)} · 🪙${l.coins}</div>`).join('')}</div>`);
  }
}
$('btn-shop').onclick = () => (modalKind === 'shop' ? closeModal() : showShop());

// Something sold: coins float up over the till, and a shopper pops in for a moment.
const saleFxs = [];
function saleFx(m) {
  const plot = S.plots[m.plotId];
  if (!plot) return;
  const reg = Object.entries(plot.obj).find(([, o]) => o.t === 'register');
  const [lx, ly] = reg ? reg[0].split(',').map(Number) : [plot.w / 2, plot.h / 2];
  saleFxs.push({ x: plot.x + lx + 0.5, z: plot.y + ly + 1.6, coins: m.coins, icon: GOODS[m.item]?.icon || '🛍️', t: performance.now(), who: m.who, look: shopperLook(m.who) });
  if (S.stockRedraw && (modalKind === 'stock' || modalKind === 'browse')) S.stockRedraw();
}
const shopperLooks = new Map();
function shopperLook(who) {
  if (!shopperLooks.has(who)) {
    let h = 0; for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    let x = h || 1; const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    shopperLooks.set(who, sanitizeLook(randomLook(rnd)));
  }
  return shopperLooks.get(who);
}

// How someone doing an activity is drawn: sitting on a seat, lying in bed, or hidden
// behind the shower glass / in the tub (steam shows instead).
// Seated people are lifted to the seat (the sitting sprite's feet hang just above it).
const SEAT_Y = { toilet: 0.18, bench: 0.12, barstool: 0.3, pouf: 0.05, beanbag: 0.02, picnic: 0.12, hammock: 0.25 };
const BEDS = new Set(['bed', 'bunkbed']);
// The item someone is using, found under where they're sitting or lying.
function itemUnder(p) {
  const id = plotIdAtPixel(world, p.x, p.y);
  const plot = id >= 0 ? S.plots[id] : null;
  const v = plot && ((p.level || 0) ? plot.l1 : plot);
  const hit = v && objAt(v, Math.floor(p.x / TILE - plot.x), Math.floor(p.y / TILE - plot.y));
  return hit ? { t: hit.obj.t, r: hit.obj.r || 0, c: hit.obj.c || 0 } : null;
}
function actPose(p) {
  const a = p.act;
  if (!a || !ACTIVITIES[a]?.seat) return null;
  if (a === 'shower' || a === 'bath') return { vis: false };
  const it = itemUnder(p);
  if ((a === 'sleep' || a === 'nap') && it && BEDS.has(it.t)) {
    // Under the covers: a flat picture of them asleep, laid on the mattress.
    const [w, h] = footprint(it.t, it.r);
    return { y: 0.56, pose: { kind: 'sleep', r: it.r, w, h } };
  }
  return { y: SEAT_Y[it?.t] ?? 0.08, pose: { kind: 'sit' } };
}

// ---------- Pets ----------
// Every villager's pet follows them around. Pets are cosmetic, so each client runs
// them locally: a pet walks the path its owner actually took (through doors and up
// the stairs), staying a couple of steps behind.
const pets = new Map(); // owner id -> { x, y, level, dir, moving, idle, path: [{x, y, level}], heartUntil }
const PET_SPEED = PLAYER_SPEED * 1.3;
const PET_GAP = 18;    // px of path to stay behind the owner
function petOf(owner) {
  const idx = sanitizeLook(owner.look).pet;
  return idx >= 0 ? idx : null;
}
// Where a pet sleeps at home: its pet bed, else the coziest indoor floor tile
// (the one with the most floor around it), else the middle of the plot. World px.
const spotCache = new WeakMap();
function petSpot(plot) {
  let spot = spotCache.get(plot);
  if (spot) return spot;
  let best = null, score = -1;
  for (const [k, o] of Object.entries(plot.obj)) if (o.t === 'petbed') { const [x, y] = k.split(',').map(Number); best = [x, y]; score = 99; break; }
  if (!best) {
    const indoor = (x, y) => { const f = plot.floor[key(x, y)]; return f && f !== 'soil' && f !== 'floor_stone'; };
    for (const k of Object.keys(plot.floor)) {
      const [x, y] = k.split(',').map(Number);
      if (!indoor(x, y) || objAt(plot, x, y) || roadIn(world, plot, x, y)) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (indoor(x + dx, y + dy)) n++;
      if (n > score) { score = n; best = [x, y]; }
    }
  }
  const [lx, ly] = best || [Math.floor(plot.w / 2), Math.floor(plot.h / 2)];
  spot = { x: (plot.x + lx + 0.5) * TILE, y: (plot.y + ly + 0.6) * TILE };
  spotCache.set(plot, spot);
  return spot;
}
// ---- pet path finding: breadth-first search over tiles near the pet ----
const petTileOK = (tx, ty, lvl) => canStand(world, S.plots, (tx + 0.5) * TILE, (ty + 0.5) * TILE + 3, lvl);
const petStepOK = (ax, ay, bx, by, lvl) => canStand(world, S.plots, ((ax + bx) / 2 + 0.5) * TILE, ((ay + by) / 2 + 0.5) * TILE + 3, lvl);
// Tiles reachable from (sx, sy) inside `box`: Map key -> previous key.
function petReach(sx, sy, lvl, box) {
  const prev = new Map([[key(sx, sy), null]]);
  const queue = [[sx, sy]];
  while (queue.length && prev.size < 1500) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k) || nx < box.x || ny < box.y || nx >= box.x + box.w || ny >= box.y + box.h) continue;
      if (!petTileOK(nx, ny, lvl) || !petStepOK(x, y, nx, ny, lvl)) continue;
      prev.set(k, key(x, y));
      queue.push([nx, ny]);
    }
  }
  return prev;
}
// World-pixel waypoints from the start of a search to tile k.
function petRoute(prev, k) {
  const out = [];
  for (let c = k; c; c = prev.get(c)) { const [x, y] = c.split(',').map(Number); out.unshift({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE + 3 }); }
  return out.slice(1);
}
// Walk a pet along its route; returns true while it's still going.
function petStroll(p, dt, speed) {
  let budget = speed * dt;
  p.moving = false;
  while (budget > 0.01 && p.route?.length) {
    const q = p.route[0];
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d > 0.01) p.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
    if (d <= budget) { p.x = q.x; p.y = q.y; p.route.shift(); budget -= d; } else { p.x += (dx / d) * budget; p.y += (dy / d) * budget; budget = 0; }
    p.moving = true;
  }
  return !!p.route?.length;
}
// While you're home, your pet potters around: it strolls to a spot it can reach on your
// plot (indoors if you are), sits a while, then picks somewhere else.
function petWander(p, o, home, dt, now) {
  p.path = [];
  if (petStroll(p, dt, PET_SPEED * 0.55)) return;
  p.idle += dt;
  if (now < (p.restUntil || 0) || p.heartUntil > now) return;
  const tx = Math.floor(p.x / TILE), ty = Math.floor((p.y - 3) / TILE);
  const reach = petReach(tx, ty, p.level, { x: home.x - 1, y: home.y - 1, w: home.w + 2, h: home.h + 2 });
  const ownerIn = levelView(home, o.level || 0).floor[key(Math.floor(o.x / TILE) - home.x, Math.floor(o.y / TILE) - home.y)];
  const picks = [...reach.keys()].filter((k) => {
    const [x, y] = k.split(',').map(Number);
    const d = Math.abs(x - tx) + Math.abs(y - ty);
    if (d < 2 || d > 9) return false;
    // Stay indoors while the owner is indoors.
    return !ownerIn || levelView(home, p.level).floor[key(x - home.x, y - home.y)];
  });
  // Now and then, come and sit by the owner.
  const byOwner = Math.random() < 0.3 && reach.has(key(Math.floor(o.x / TILE), Math.floor(o.y / TILE)));
  const k = byOwner ? key(Math.floor(o.x / TILE), Math.floor(o.y / TILE)) : picks[Math.floor(Math.random() * picks.length)];
  if (k) p.route = petRoute(reach, k);
  if (byOwner && p.route?.length) p.route.pop();
  p.restUntil = now + 2500 + Math.random() * 5000;
  p.idle = 0;
}

const isPetBedtime = () => { const h = worldClock(serverNow(), S.epoch).hours; return h >= 22 || h < 6; };

function updatePets(dt) {
  const seen = new Set();
  const night = isPetBedtime();
  const now = performance.now();
  const homes = new Map();
  for (const pl of Object.values(S.plots)) if (pl.owner) homes.set(pl.owner, pl);
  for (const o of [S.me, ...S.players.values()]) {
    if (!o || petOf(o) == null) continue;
    seen.add(o.id);
    const lvl = o.level || 0;
    let p = pets.get(o.id);
    if (!p) { p = { x: o.x, y: o.y + 4, level: lvl, dir: 0, moving: false, idle: 0, path: [], heartUntil: 0 }; pets.set(o.id, p); }
    // Bedtime: the pet heads home and curls up. If you're home it trots over to bed;
    // otherwise it's already asleep there when you get back.
    const home = night ? homes.get(o.id) : null;
    const myHome = homes.get(o.id);
    const ownerHome = myHome && plotIdAtPixel(world, o.x, o.y) === myHome.id;
    if (home) {
      p.route = null; p.wandering = false;
      const spot = petSpot(home);
      const d = Math.hypot(spot.x - p.x, spot.y - p.y);
      p.path = []; p.level = 0;
      if (!p.sleeping && plotIdAtPixel(world, o.x, o.y) === home.id && d > 2) {
        const sp = Math.min(d, PET_SPEED * 0.8 * dt);
        p.dir = Math.abs(spot.x - p.x) > Math.abs(spot.y - p.y) ? (spot.x < p.x ? 2 : 3) : (spot.y < p.y ? 1 : 0);
        p.x += ((spot.x - p.x) / d) * sp; p.y += ((spot.y - p.y) / d) * sp;
        p.moving = true; p.idle = 0;
      } else { p.x = spot.x; p.y = spot.y; p.moving = false; p.sleeping = true; }
      continue;
    }
    if (p.sleeping) { Object.assign(p, { sleeping: false, x: o.x, y: o.y + 4, level: lvl, path: [], idle: 0 }); }
    // At home (and on the same floor, and close enough to be in the house): wander.
    if (ownerHome && p.level === lvl && Math.hypot(p.x - o.x, p.y - o.y) < TILE * 14) {
      p.wandering = true;
      petWander(p, o, myHome, dt, now);
      continue;
    }
    // Leaving home: find a way back to the owner first, then follow the trail again.
    if (p.wandering) {
      p.wandering = false;
      const tx = Math.floor(p.x / TILE), ty = Math.floor((p.y - 3) / TILE);
      const ox = Math.floor(o.x / TILE), oy = Math.floor(o.y / TILE);
      const box = { x: Math.min(tx, ox) - 6, y: Math.min(ty, oy) - 6, w: Math.abs(tx - ox) + 13, h: Math.abs(ty - oy) + 13 };
      const reach = p.level === lvl ? petReach(tx, ty, p.level, box) : null;
      p.route = reach?.has(key(ox, oy)) ? petRoute(reach, key(ox, oy)) : null;
      p.path = [];
      if (!p.route) Object.assign(p, { x: o.x, y: o.y + 4, level: lvl });
    }
    if (p.route?.length) {
      petStroll(p, dt, PET_SPEED * 1.5);
      if (Math.hypot(p.x - o.x, p.y - o.y) < PET_GAP + 6) p.route = null;
      p.path = [{ x: o.x, y: o.y, level: lvl }];
      p.idle = 0;
      continue;
    }
    // Record the owner's trail; a big jump (home, teleport) means start over beside them.
    const last = p.path[p.path.length - 1] || p;
    const jump = Math.hypot(o.x - last.x, o.y - last.y);
    if (jump > 64) { Object.assign(p, { x: o.x, y: o.y + 4, level: lvl, path: [] }); continue; }
    if (jump > 3 || last.level !== lvl) p.path.push({ x: o.x, y: o.y, level: lvl });
    if (p.path.length > 240) Object.assign(p, p.path[p.path.length - 40], { path: p.path.slice(-40) });
    // How much trail is left between pet and owner?
    let left = 0, px0 = p.x, py0 = p.y;
    for (const q of p.path) { left += Math.hypot(q.x - px0, q.y - py0); px0 = q.x; py0 = q.y; }
    p.moving = false;
    let budget = left > PET_GAP ? Math.min(left - PET_GAP, PET_SPEED * (o.running ? RUN_MULT : 1) * (left > 80 ? 1.6 : 1) * dt) : 0;
    while (budget > 0.01 && p.path.length) {
      const q = p.path[0];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d > 0.01) p.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0);
      if (d <= budget) { p.x = q.x; p.y = q.y; p.level = q.level; p.path.shift(); budget -= d; }
      else { p.x += (dx / d) * budget; p.y += (dy / d) * budget; budget = 0; }
      p.moving = true;
    }
    p.idle = p.moving ? 0 : p.idle + dt;
  }
  for (const id of pets.keys()) if (!seen.has(id)) pets.delete(id);
}
function nearMyPet() {
  const p = pets.get(S.me?.id);
  return p && Math.hypot(p.x - S.me.x, p.y - S.me.y) < TILE * 1.8 ? p : null;
}

// ---------- Village map ----------
let lastMap = 0;
function updateMap(now) {
  if (now - lastMap < 150) return;
  lastMap = now;
  minimap.update(world, S.plots, S.myPlot);
  const people = [{ x: S.me.x, y: S.me.y, dir: S.me.dir, kind: 'me', name: S.me.name }];
  for (const p of S.players.values()) people.push({ x: p.x, y: p.y, kind: 'player', name: p.name });
  for (const n of S.npcs.values()) people.push({ x: n.x, y: n.y, kind: 'npc', name: NPCS[n.id].name });
  for (const p of pets.values()) people.push({ x: p.x, y: p.y, kind: 'pet' });
  const labels = Object.values(S.plots).filter((p) => p.owner).map((p) => ({
    text: p.farm ? `${p.farm} Farm` : `${p.ownerName}'s`, x: p.x + p.w / 2, y: p.y + 1.6, mine: p.id === S.myPlot,
  }));
  minimap.draw(people, labels);
}
function placeMinimap() {
  const tb = $('topbar').getBoundingClientRect();
  document.documentElement.style.setProperty('--mm-top', `${Math.round(tb.bottom + 6)}px`);
}
function toggleMap(open = $('bigmap').hidden) {
  $('bigmap').hidden = !open;
  if (open) { lastMap = 0; updateMap(performance.now()); }
}
$('minimap').onclick = () => toggleMap(true);
$('bigmap-close').onclick = () => toggleMap(false);
$('bigmap').onclick = (e) => { if (e.target === $('bigmap')) toggleMap(false); };
addEventListener('resize', placeMinimap);

// Build mode shows where your land ends, the plots around it and the public roads on it.
function updateOutline() {
  const plot = S.mode === 'build' ? S.plots[S.myPlot] : null;
  if (!plot) { if (outline.sig) outline.clear(); return; }
  const near = (o) => o.id !== plot.id && o.x < plot.x + plot.w + 30 && o.x + o.w > plot.x - 30 && o.y < plot.y + plot.h + 24 && o.y + o.h > plot.y - 24;
  const roads = [];
  for (let ly = 0; ly < plot.h; ly++) for (let lx = 0; lx < plot.w; lx++) if (roadIn(world, plot, lx, ly)) roads.push([plot.x + lx, plot.y + ly]);
  outline.show(plot, Object.values(S.plots).filter(near), roads, S.level);
}

// ---------- Render ----------
function render(now) {
  const hOf = (p) => heightAt(world, S.plots, p.x, p.y, p.level || 0);
  const myH = hOf(S.me);
  if (S.mode !== 'build' || !S.me) view.setTarget(U(S.me.x), U(S.me.y), false, myH);
  const sNow = serverNow();
  const drawPerson = (p, h) => {
    const pose = actPose(p);
    view.actor(p.id, U(p.x), U(p.y), p.dir, p.running ? 'run' : p.moving, p.look, now, pose?.vis ?? true, h + (pose?.y || 0), null, pose?.pose || null);
  };
  for (const p of S.players.values()) drawPerson(p, hOf(p));
  for (const n of S.npcs.values()) {
    const d = NPCS[n.id];
    const a = NPC_ACTS[n.act];
    view.actor(`npc:${n.id}`, U(n.x), U(n.y), n.dir, n.moving, d.look, now, !a?.hidden, a?.pose === 'sit' ? 0.12 : 0, null, a?.pose === 'sit' ? { kind: 'sit' } : null);
  }
  drawPerson(S.me, myH);
  drawShopPeople(now);
  for (const [id, p] of pets) {
    const owner = id === S.me.id ? S.me : S.players.get(id);
    if (!owner) continue;
    const pose = p.sleeping ? 'sleep' : !p.moving && (p.idle > 1.2 || p.heartUntil > now) ? 'sit' : false;
    view.actor(`pet:${id}`, U(p.x), U(p.y), p.dir, p.moving, null, now, true, heightAt(world, S.plots, p.x, p.y, p.level), { idx: petOf(owner), sit: pose });
  }
  view.pruneActors();
  updateOutline();
  updateMap(now);
  const hour = S.mode === 'build' && S.previewHour != null ? S.previewHour : worldClock(sNow, S.epoch).hours;
  view.render(now, darkness(hour), S.mode !== 'build');
  drawOverlay(now);
}

// Clerks behind the till while the shop's open, and shoppers dropping in.
function drawShopPeople(now) {
  const { hours } = worldClock(serverNow(), S.epoch);
  for (const plot of Object.values(S.plots)) {
    const st = plot.biz?.staff && STAFF[plot.biz.staff];
    if (!st || plot.biz.closed || hours < OPEN_HOURS[0] || hours >= OPEN_HOURS[1]) continue;
    const reg = Object.entries(plot.obj).find(([, o]) => o.t === 'register');
    if (!reg) continue;
    const [lx, ly] = reg[0].split(',').map(Number);
    const r = reg[1].r || 0;
    const [bx, bz] = [[0.5, -0.35], [1.35, 0.5], [0.5, 1.35], [-0.35, 0.5]][r]; // stands behind the counter
    view.actor(`staff:${plot.id}`, plot.x + lx + bx, plot.y + ly + bz, [0, 2, 1, 3][r], false, st.look, now);
  }
  for (let i = saleFxs.length - 1; i >= 0; i--) {
    const f = saleFxs[i];
    if (now - f.t > 4000) { saleFxs.splice(i, 1); continue; }
    view.actor(`shopper:${f.t}`, f.x, f.z + 0.4, 1, false, f.look, now);
  }
}

function drawOverlay(now) {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.textAlign = 'center';
  octx.textBaseline = 'bottom';
  const W = innerWidth, H = innerHeight;
  const onScreen = (p) => p.x > -60 && p.y > -60 && p.x < W + 60 && p.y < H + 60;
  for (const st of Object.values(S.plots)) {
    if (!st.owner || st.biz) continue;
    const p = view.toScreen(st.x + st.w / 2, 0.9, st.y + 0.5);
    if (onScreen(p)) tag(`🏡 ${st.farm ? st.farm + ' Farm' : st.ownerName}`, p.x, p.y, 11, st.owner === S.me.id ? '#ffe08a' : '#fff');
  }
  // Goods on shelves (with price tags up close), machines at work, coins from sales.
  const cam = view.target;
  octx.textAlign = 'center';
  for (const plot of Object.values(S.plots)) {
    if (Math.abs(plot.x + plot.w / 2 - cam.x) > 30 || Math.abs(plot.y + plot.h / 2 - cam.z) > 30) continue;
    for (const [lvl, v] of [[0, plot], [1, plot.l1]]) {
      if (!v || (lvl && !(S.mode === 'build' ? S.level : S.me.level))) continue;
      for (const [k, o] of Object.entries(v.obj)) {
        const [lx, ly] = k.split(',').map(Number);
        const [w, h] = footprint(o.t, o.r || 0);
        if (o.stock?.length) {
          const p = view.toScreen(plot.x + lx + w / 2, lvl * LEVEL_H + 1.25, plot.y + ly + h / 2);
          if (!onScreen(p)) continue;
          o.stock.forEach((sl, i) => {
            const x = p.x + (i - (o.stock.length - 1) / 2) * 18;
            octx.font = '15px sans-serif';
            octx.fillText(GOODS[sl.item]?.icon || '📦', x, p.y);
            if (view.zoom < 22) { octx.font = 'bold 9px sans-serif'; octx.fillStyle = '#fff8e0'; octx.fillText(`🪙${sl.price}`, x, p.y + 11); octx.fillStyle = '#000'; }
          });
        }
        if (o.job) {
          const p = view.toScreen(plot.x + lx + w / 2, lvl * LEVEL_H + 1.6, plot.y + ly + h / 2);
          if (!onScreen(p)) continue;
          const ready = serverNow() >= o.job.ready;
          octx.font = '15px sans-serif';
          octx.fillText(ready ? `✅${GOODS[RECIPES[o.job.r].out].icon}` : `⏳`, p.x, p.y + (ready ? Math.sin(now / 300) * 2 : 0));
        }
      }
    }
    if (plot.biz) {
      const p = view.toScreen(plot.x + plot.w / 2, 1.4, plot.y + 0.5);
      if (onScreen(p)) tag(`🏪 ${plot.biz.name}`, p.x, p.y, 12, '#ffd27a');
    }
  }
  for (const f of saleFxs) {
    const t = (now - f.t) / 4000;
    const p = view.toScreen(f.x, 1.6 + t * 1.2, f.z);
    octx.globalAlpha = Math.max(0, 1 - t);
    octx.font = 'bold 13px sans-serif';
    octx.fillStyle = '#ffe36e';
    octx.fillText(`${f.icon} +🪙${f.coins}`, p.x, p.y);
    octx.globalAlpha = 1;
  }
  const heads = [];
  for (const p of [...S.players.values(), S.me]) heads.push([p, p.name, p === S.me ? '#ffe08a' : '#fff']);
  for (const n of S.npcs.values()) { if (NPC_ACTS[n.act]?.hidden) continue; const d = NPCS[n.id]; heads.push([n, `${d.icon} ${d.name}`, '#bdf0a8']); }
  for (const [p, label, col] of heads) {
    const s = view.toScreen(U(p.x), 1.95 + heightAt(world, S.plots, p.x, p.y, p.level || 0), U(p.y));
    if (!onScreen(s)) continue;
    tag(label, s.x, s.y, 11, col);
    if (p.bubble && performance.now() < p.bubbleUntil) bubble(p.bubble, s.x, s.y - 20, 13);
    else if (p.act && ACTIVITIES[p.act] && S.npcs.get(p.id) !== p) actIcon(p, s, now);
    else if (p.act && S.npcs.get(p.id) === p && NPC_ACTS[p.act]?.icon) npcIcon(NPC_ACTS[p.act].icon, s, now);
    if (p.carry && PLATES[p.carry] && !p.act) {
      // Carrying a plate: it sits in their hands.
      const hnd = view.toScreen(U(p.x), 0.72 + heightAt(world, S.plots, p.x, p.y, p.level || 0), U(p.y) + 0.12);
      octx.font = '13px sans-serif';
      octx.fillText(PLATES[p.carry].icon, hnd.x, hnd.y + 6);
    }
  }
  // Zzz over sleeping pets.
  octx.font = 'bold 11px sans-serif';
  octx.fillStyle = '#e8f0ff';
  for (const p of pets.values()) {
    if (!p.sleeping) continue;
    const s = view.toScreen(U(p.x), 0.7, U(p.y));
    if (!onScreen(s)) continue;
    for (let i = 0; i < 3; i++) {
      const t = ((now / 1600) + i / 3) % 1;
      octx.globalAlpha = Math.sin(t * Math.PI) * 0.9;
      octx.font = `bold ${11 + i * 3}px sans-serif`;
      octx.fillText('z', s.x + 6 + t * 10, s.y - t * 18);
    }
    octx.globalAlpha = 1;
  }
  // Hearts over a pet that was just petted.
  for (const p of pets.values()) {
    if (p.heartUntil < now) continue;
    const t = 1 - (p.heartUntil - now) / 2200;
    const s = view.toScreen(U(p.x), 1.1 + t * 0.5 + heightAt(world, S.plots, p.x, p.y, p.level), U(p.y));
    octx.globalAlpha = Math.min(1, (1 - t) * 3);
    octx.font = '16px sans-serif';
    octx.fillText('❤️', s.x - 6, s.y); octx.fillText('❤️', s.x + 8, s.y - 8 - t * 6);
    octx.globalAlpha = 1;
  }
  if (stick.active && S.mode === 'walk') {
    octx.globalAlpha = 0.35;
    octx.fillStyle = '#fff';
    octx.beginPath(); octx.arc(stick.sx, stick.sy, 40, 0, Math.PI * 2); octx.fill();
    const dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, 40 / d);
    octx.globalAlpha = 0.7;
    octx.beginPath(); octx.arc(stick.sx + dx * k, stick.sy + dy * k, 18, 0, Math.PI * 2); octx.fill();
    octx.globalAlpha = 1;
  }
}

// A villager's activity (gardening, lunch, reading...) as a small floating icon.
function npcIcon(icon, s, now) {
  octx.font = '14px sans-serif';
  octx.globalAlpha = 0.9;
  octx.fillText(icon, s.x + 18, s.y - 4 + Math.sin(now / 500) * 2);
  octx.globalAlpha = 1;
}

// What someone's doing, over their head: a thought bubble with the activity's icon,
// drifting Zzz for sleepers and steam over showers and baths.
function actIcon(p, s, now) {
  const a = p.act;
  if (a === 'sleep' || a === 'nap') {
    octx.fillStyle = '#e8f0ff';
    for (let i = 0; i < 3; i++) {
      const t = ((now / 1600) + i / 3) % 1;
      octx.globalAlpha = Math.sin(t * Math.PI) * 0.95;
      octx.font = `bold ${12 + i * 4}px sans-serif`;
      octx.fillText('Z', s.x + 8 + t * 14, s.y - 4 - t * 22);
    }
    octx.globalAlpha = 1;
    return;
  }
  if (a === 'shower' || a === 'bath') {
    const b = view.toScreen(U(p.x), 0.9 + heightAt(world, S.plots, p.x, p.y, p.level || 0), U(p.y));
    for (let i = 0; i < 6; i++) {
      const t = ((now / 1400) + i / 6) % 1;
      octx.globalAlpha = Math.sin(t * Math.PI) * 0.55;
      octx.fillStyle = '#ffffff';
      octx.beginPath(); octx.arc(b.x + Math.sin(i * 2.1 + now / 500) * 10, b.y - t * 34, 4 + t * 7, 0, Math.PI * 2); octx.fill();
    }
    octx.globalAlpha = 1;
  }
  const y = s.y - 22 + Math.sin(now / 400) * 2;
  octx.fillStyle = '#fffaf0'; octx.strokeStyle = '#6b4a2b'; octx.lineWidth = 2;
  octx.beginPath(); octx.arc(s.x, y - 12, 13, 0, Math.PI * 2); octx.fill(); octx.stroke();
  octx.beginPath(); octx.arc(s.x - 9, y + 4, 3, 0, Math.PI * 2); octx.fill(); octx.stroke();
  octx.font = '15px sans-serif';
  octx.textBaseline = 'middle';
  octx.fillText(ACTIVITIES[a].icon, s.x, y - 11);
  octx.textBaseline = 'bottom';
}

function tag(text, x, y, fs, color) {
  octx.font = `bold ${fs}px ui-rounded, 'Trebuchet MS', sans-serif`;
  const w = octx.measureText(text).width + fs * 0.8;
  octx.fillStyle = 'rgba(30,22,12,0.55)';
  roundRect(x - w / 2, y - fs * 1.35, w, fs * 1.35, fs * 0.4);
  octx.fillStyle = color;
  octx.fillText(text, x, y - fs * 0.15);
}

function bubble(text, x, y, fs) {
  octx.font = `${fs}px ui-rounded, 'Trebuchet MS', sans-serif`;
  const words = text.split(' ');
  const maxW = fs * 14;
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (octx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  lines.push(line);
  const lh = fs * 1.25;
  const w = Math.min(maxW, Math.max(...lines.map((l) => octx.measureText(l).width))) + fs;
  const h = lines.length * lh + fs * 0.5;
  octx.fillStyle = '#fffaf0';
  octx.strokeStyle = '#6b4a2b';
  octx.lineWidth = 2;
  roundRect(x - w / 2, y - h, w, h, fs * 0.5, true);
  octx.beginPath(); octx.moveTo(x - fs * 0.4, y - 1); octx.lineTo(x, y + fs * 0.5); octx.lineTo(x + fs * 0.4, y - 1); octx.fill();
  octx.fillStyle = '#3a2a1a';
  octx.textBaseline = 'bottom';
  lines.forEach((l, i) => octx.fillText(l, x, y - h + fs * 0.25 + lh * (i + 1)));
}

function roundRect(x, y, w, h, rad, stroke) {
  octx.beginPath();
  octx.moveTo(x + rad, y);
  octx.arcTo(x + w, y, x + w, y + h, rad);
  octx.arcTo(x + w, y + h, x, y + h, rad);
  octx.arcTo(x, y + h, x, y, rad);
  octx.arcTo(x, y, x + w, y, rad);
  octx.closePath();
  octx.fill();
  if (stroke) octx.stroke();
}

// ---------- Main loop ----------
let last = performance.now();
let hudAcc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.me) {
    update(dt);
    render(now);
    hudAcc += dt;
    if (hudAcc > 0.25) { hudAcc = 0; updateContext(); }
  } else {
    // Behind the join screen: a slow drift over the village.
    view.setTarget(42 + Math.sin(now / 9000) * 14, 30 + Math.cos(now / 11000) * 10);
    if (!frame.plotsBuilt) { syncPlots(true); frame.plotsBuilt = true; }
    view.render(now, 0, true);
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }
  requestAnimationFrame(frame);
}

showJoin();
requestAnimationFrame(frame);

// Test hook: ?debug exposes state and helpers for automated playtests.
if (new URLSearchParams(location.search).has('debug')) {
  window.__tycoon = {
    S, view, world, pets, clock: (ms) => worldClock(ms, S.epoch),
    // Screen position of a plot-local point (at floor height + h).
    plotToClient: (lx, ly, h = 0, plotId = S.myPlot) => { const d = S.plots[plotId]; return view.toScreen(d.x + lx, S.level * LEVEL_H + h, d.y + ly); },
    worldToClient: (x, z, h = 0) => view.toScreen(x, h, z),
    tileToClient: (tx, ty) => view.toScreen(tx + 0.5, 0, ty + 0.5),
    setLevel, cycleWalls, turnCamera, setMode, send, nearestUsable, usableAt,
  };
}
