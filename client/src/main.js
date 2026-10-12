import {
  generateWorld, applyRoads, plotIdAtPixel, worldClock, darkness,
  TILE, MAP_W, MAP_H, PLAYER_SPEED, RUN_MULT, WORLD_VERSION,
} from '@shared/world.js';
import {
  canStand, inInterior, key, placementError, objAt, footprint, canRotate, levelView,
  LEVELS, wallError, lineEdges, rectEdges, roofError, roofAt, edgeKey,
  indexPlots, landError, contentFits, mergedRect, splitRects, hasContent, LAND_PRICE,
  stepLevel, heightAt, roadEditError, roadIn, plotEntrance,
} from '@shared/plot.js';
import { ITEMS, GOODS, CATEGORIES, cropStage, itemName } from '@shared/catalog.js';
import { NPCS } from '@shared/npcs.js';
import { itemIcon } from './sprites.js';
import { View, LEVEL_H } from './gfx/view.js';
import { Ghost, Outline } from './gfx/ghost.js';
import { openCreator, closeCreator } from './creator.js';
import { renderCity } from './cityui.js';
import { drawLook } from './people.js';
import { sanitizeLook, PETS } from '@shared/look.js';
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
  sock.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
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
    reconnectTimer = setTimeout(connect, Math.min(10000, 1000 * 2 ** Math.min(failures, 3)));
  };
}

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
      S.myPlot = m.you.plotId;
      S.username = m.you.username;
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
      if (modalKind === 'me') showMe();
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
      for (const [id, x, y, dir, moving, level] of m.p) {
        const p = S.players.get(id);
        if (!p) continue;
        p.tx = x; p.ty = y; p.dir = dir; p.moving = !!moving; p.running = moving === 2; p.level = level || 0;
        if (Math.hypot(p.x - x, p.y - y) > 96) { p.x = x; p.y = y; }
      }
      for (const [id, x, y, dir, moving] of m.n || []) {
        const n = S.npcs.get(id);
        if (!n) continue;
        n.tx = x; n.ty = y; n.dir = dir; n.moving = !!moving;
      }
      break;
    case 'pos':
      S.me.x = m.x; S.me.y = m.y; S.me.level = m.level || 0;
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
    case 'plot':
      S.plots[m.plot.id] = m.plot;
      indexPlots(world, S.plots);
      plotsDirty = true;
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
      if (S.mode === 'build' && S.cat === 'special') renderItems();
      if (S.talk?.extra) renderExtra();
      if (modalKind === 'bag') showBag();
      break;
    case 'claimed':
      S.myPlot = m.plotId;
      updateHud();
      toast('🏡 This plot is yours! Tap Build to start your home.');
      break;
    case 'harvested': {
      const parts = Object.entries(m.items).map(([k, n]) => `${n} ${GOODS[k].icon}`);
      toast(`🌾 Harvested ${parts.join(' ')} — sell them at Rosa’s Market`);
      break;
    }
    case 'error':
      toast(m.msg);
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
  $('btn-build').disabled = S.myPlot == null;
  $('online').textContent = `👥 ${S.players.size + 1}`;
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
    const d = Math.hypot(n.x - S.me.x, n.y - S.me.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

let lastAction = '';
function updateContext() {
  if (!S.me) return;
  $('clock').textContent = fmtClock();
  $('online').textContent = `👥 ${S.players.size + 1}`;
  const here = plotIdAtPixel(world, S.me.x, S.me.y);
  const plot = here >= 0 ? S.plots[here] : null;
  $('where').textContent = plot ? (plot.owner ? (plot.farm ? `${plot.farm} Farm` : `${plot.ownerName}'s home`) : `Plot ${here + 1} · For sale`) : 'Village';
  let action = '';
  const npc = nearestNpc();
  if (S.mode !== 'walk' || S.talk) action = '';
  else if (npc) action = `talk:${npc.id}`;
  else if (nearMyPet()) action = 'pet';
  else if (plot && !plot.owner && S.myPlot == null) action = 'claim';
  else if (here === S.myPlot && here >= 0) {
    const ripe = Object.values(plot.obj).filter((o) => ITEMS[o.t]?.crop && cropStage(o, serverNow()) === 3).length;
    if (ripe) action = `harvest:${ripe}`;
  }
  if (action !== lastAction) {
    lastAction = action;
    const btn = $('action');
    btn.hidden = !action;
    if (action === 'claim') btn.textContent = '🏡 Claim this plot';
    else if (action.startsWith('harvest')) btn.textContent = `🌾 Harvest (${action.split(':')[1]})`;
    else if (action.startsWith('talk')) btn.textContent = `💬 Talk to ${NPCS[action.split(':')[1]].name}`;
    else if (action === 'pet') btn.textContent = `🐾 Pet your ${PETS[petOf(S.me)].kind}`;
  }
  syncPlots();
}
$('action').onclick = () => {
  if (lastAction === 'claim') send({ type: 'claim', plotId: plotIdAtPixel(world, S.me.x, S.me.y) });
  else if (lastAction.startsWith('harvest')) send({ type: 'harvest', plotId: S.myPlot });
  else if (lastAction.startsWith('talk')) send({ type: 'npcOpen', npc: lastAction.split(':')[1] });
  else if (lastAction === 'pet') { const p = nearMyPet(); if (p) { p.heartUntil = performance.now() + 2200; p.idle = 2; } }
};

$('btn-build').onclick = () => setMode(S.mode === 'build' ? 'walk' : 'build');
$('btn-done').onclick = () => setMode('walk');
$('btn-home').onclick = () => { setMode('walk'); closeTalk(); send({ type: 'home' }); };
$('btn-chat').onclick = () => openChat();
$('btn-bag').onclick = () => (modalKind === 'bag' ? closeModal() : showBag());
$('btn-me').onclick = () => (modalKind === 'me' ? closeModal() : showMe());
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
  if (v.say) S.talk.lines.push({ who: 'them', text: v.say });
  $('npcpanel').hidden = false;
  $('npc-shop').hidden = !(v.sells.length || v.buys.length);
  $('npc-city').hidden = !def.clerk;
  renderStatus(); renderLog(); renderExtra();
}

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
    if (id.startsWith('window')) { g.fillStyle = '#8fd0f0'; g.fillRect(12, id === 'window' ? 10 : 6, 20, id === 'window' ? 16 : 28); g.fillStyle = '#4a2e18'; g.fillRect(21, 8, 2, 30); }
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
  renderCity(body, { city: S.city, me: S.me, myPlot: S.myPlot, plots: S.plots, send, rerender: showCity });
  body.scrollTop = keep;
}

function showBag() {
  const body = openModal('bag', '🎒 Your bag');
  const entries = Object.entries(S.inv);
  if (!entries.length) body.insertAdjacentHTML('beforeend', '<p class="muted">Empty. Harvest crops, or buy gifts and furniture in the town square.</p>');
  const list = document.createElement('div');
  list.className = 'list';
  for (const [k, n] of entries) {
    const sub = ITEMS[k] ? 'Furniture · place it from the Bag tab in Build mode' : GOODS[k].kind === 'produce' ? 'Crop · Rosa buys these' : 'Gift · give it to a villager';
    list.appendChild(itemRow(k, `×${n} · ${sub}`, []));
  }
  body.appendChild(list);
}

function showMe() {
  const body = openModal('me', '👤 ' + (S.me?.name || 'You'));
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
  const all = [{ id: 'land', name: '🗺️ Land' }, ...CATEGORIES, { id: 'special', name: '🎒 Bag' }, { id: 'remove', name: '🔨 Sledgehammer' }];
  for (const c of all) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.className = (c.id === 'remove' ? S.tool.kind === 'remove' : S.cat === c.id && S.tool.kind !== 'remove') ? 'sel' : '';
    b.onclick = () => {
      if (c.id === 'remove') S.tool = { kind: 'remove' };
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
  if (S.tool.kind === 'remove') {
    box.insertAdjacentHTML('beforeend', '<div style="padding:14px 8px;font-size:14px">Tap furniture, a floor tile or a wall to remove it. Tap a door or window to take just that out. Everything is refunded (shop furniture goes back to your bag; crops are lost).</div>');
    return;
  }
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
    for (const [k, label] of [['line', '▬ Wall'], ['room', '▢ Room']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = S.wallTool === k ? 'sel' : '';
      b.onclick = () => { S.wallTool = k; renderItems(); };
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
  if (S.tool.kind !== 'obj' || !canRotate(S.tool.id)) return;
  S.rot = (S.rot + 1) % 4;
  updateRotateBtn();
  refreshPreview();
}
$('btn-rotate').onclick = rotateItem;

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
    wall: S.wallTool === 'room' ? 'Drag from corner to corner to build a room (walls + wood floor).' : 'Drag along the grid lines to build a wall.',
    feature: 'Tap a wall to set the door or window into it.',
    floor: 'Tap or drag a rectangle to lay floor.',
    roof: 'Drag a rectangle over your rooms to add a roof. Roofs show with walls up.',
    roofRemove: 'Tap a roofed tile to remove that roof.',
    obj: d?.crop ? 'Plant on tilled soil.' : 'Drag to position, release to place. ↻ rotates.',
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
  if (mode === 'build' && S.myPlot == null) { toast('Claim a plot first!'); return; }
  if (mode === 'build') closeTalk();
  S.mode = mode;
  document.body.classList.toggle('building', mode === 'build');
  $('tray').hidden = mode !== 'build';
  $('btn-build').classList.toggle('on', mode === 'build');
  $('action').style.display = mode === 'build' ? 'none' : '';
  $('chatlog').style.display = mode === 'build' ? 'none' : '';
  drag = null;
  ghost.clear();
  if (mode === 'build') {
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

function refreshPreview() {
  ghost.clear();
  if (S.mode !== 'build' || !hover) return;
  const plot = S.plots[S.myPlot], def = myDef(), t = S.tool;
  const d = ITEMS[t.id];
  if (t.kind === 'wall') {
    if (!drag) {
      const q = pickLocal(hover.cx, hover.cy);
      if (q) { const [cx, cz] = cornerOf(q); ghost.tiles([[cx - 0.5, cz - 0.5]].map(([a, b]) => [a + 0.3, b + 0.3]), def, S.level, true, 0.6); }
      return;
    }
    const plan = wallPlan();
    const news = plan.edges.filter((e) => plot.walls?.[edgeKey(S.level, ...e)]?.m !== t.id);
    const cost = news.length * d.price + (plan.room ? plan.room.w * plan.room.h * ITEMS.floor_wood.price : 0);
    const ok = plan.edges.every((e) => !wallError(plot, S.level, ...e, world)) && afford(cost);
    ghost.walls(plan.edges, def, S.level, ok);
    toolInfo(plan.room ? `Room ${plan.room.w}×${plan.room.h} · 🪙${cost}` : `${news.length} wall${news.length === 1 ? '' : 's'} · 🪙${cost}`);
  } else if (t.kind === 'floor' || t.kind === 'roof') {
    const q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const r = clampRect(drag ? rectOf(drag.start, drag.cur) : rectOf(tileOf(q), tileOf(q)));
    if (r.w < 1 || r.h < 1) return;
    const tiles = [];
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) tiles.push([r.x + i, r.y + j]);
    if (t.kind === 'floor') {
      const ok = tiles.filter(([x, y]) => !placementError(plot, x, y, t.id, 0, S.level, world));
      ghost.tiles(tiles, def, S.level, ok.length > 0 && afford(ok.length * d.price));
      if (drag) toolInfo(`${ok.length} tiles · 🪙${ok.length * d.price}`);
    } else {
      const err = roofError(plot, r.x, r.y, r.w, r.h, S.level, world);
      ghost.tiles(tiles, def, S.level + 1, !err && afford(r.w * r.h * d.price), 0.06);
      if (drag) toolInfo(`Roof ${r.w}×${r.h} · 🪙${r.w * r.h * d.price}${err ? ' · ' + err : ''}`);
    }
  } else if (t.kind === 'feature') {
    const q = pickLocal(hover.cx, hover.cy, 1.0);
    if (!q) return;
    const { edge } = edgeOf(q);
    const has = !!plot.walls?.[edgeKey(S.level, ...edge)];
    ghost.walls([edge], def, S.level, has && afford(d.price));
  } else if (t.kind === 'obj') {
    const q = pickLocal(hover.cx, hover.cy);
    if (!q) return;
    const r = canRotate(t.id) ? S.rot : 0;
    const [w, h] = footprint(t.id, r);
    const lx = Math.round(q.fx - w / 2), ly = Math.round(q.fz - h / 2);
    const ok = !placementError(plot, lx, ly, t.id, r, S.level, world) && (S.freeBuild || (d.shop ? S.inv[t.id] > 0 : d.price <= S.coins));
    ghost.item(t.id, r, def, lx, ly, S.level, ok);
  } else if (t.kind === 'remove' || t.kind === 'roofRemove') {
    const target = removeTarget(hover);
    if (!target) return;
    if (target.edge) ghost.walls([target.edge], def, S.level, false);
    else if (target.tiles) ghost.tiles(target.tiles, def, target.level ?? S.level, false, 0.3);
  } else if (t.kind === 'pave' || t.kind === 'dig') {
    const plan = roadPlan(hover);
    if (!plan) return;
    ghost.tiles(plan.tiles, def, 0, !plan.err, 0.06);
    toolInfo(`${plan.tiles.length} tile${plan.tiles.length === 1 ? '' : 's'}${plan.err ? ' · ' + plan.err : ''}`);
  } else if (t.kind === 'resize' || t.kind === 'merge' || t.kind === 'split') {
    const plan = landPlan(hover);
    if (!plan) { ghost.rect(def.x, def.y, def.w, def.h, true); return; }
    if (plan.rect) ghost.rect(plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h, plan.ok);
    if (plan.sold) { ghost.rect(plan.sold.x, plan.sold.y, plan.sold.w, plan.sold.h, false); ghost.cut(plan.at, def.y, def.h); }
    toolInfo(plan.info);
  }
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
  const plot = S.plots[S.myPlot], t = S.tool, d = ITEMS[t.id];
  const base = { plotId: S.myPlot, level: S.level };
  if (t.kind === 'wall') {
    const plan = wallPlan();
    if (!plan || !plan.edges.length) return;
    send({ type: 'walls', ...base, m: t.id, segs: plan.edges });
    if (plan.room) send({ type: 'floorRect', ...base, x: plan.room.x, y: plan.room.y, w: plan.room.w, h: plan.room.h, item: 'floor_wood' });
  } else if (t.kind === 'floor' || t.kind === 'roof') {
    const q = pickLocal(h.cx, h.cy);
    const end = q ? tileOf(q) : drag?.cur;
    const r = clampRect(rectOf(drag?.start || end, end));
    if (r.w < 1 || r.h < 1) return;
    if (t.kind === 'floor') send({ type: 'floorRect', ...base, x: r.x, y: r.y, w: r.w, h: r.h, item: t.id });
    else send({ type: 'roof', ...base, x: r.x, y: r.y, w: r.w, h: r.h, m: t.id });
  } else if (t.kind === 'feature') {
    const q = pickLocal(h.cx, h.cy, 1.0);
    if (!q) return;
    const { edge } = edgeOf(q);
    if (!plot.walls?.[edgeKey(S.level, ...edge)]) return toast('Doors and windows go into a wall');
    send({ type: 'feature', ...base, d: edge[0], x: edge[1], y: edge[2], f: t.id });
  } else if (t.kind === 'obj') {
    const q = pickLocal(h.cx, h.cy);
    if (!q) return;
    const r = canRotate(t.id) ? S.rot : 0;
    const [w, hh] = footprint(t.id, r);
    const lx = Math.round(q.fx - w / 2), ly = Math.round(q.fz - hh / 2);
    const err = placementError(plot, lx, ly, t.id, r, S.level, world);
    if (err) { if (err !== 'Already there') toast(err); return; }
    if (!S.freeBuild && (d.shop ? !S.inv[t.id] : d.price > S.coins)) return toast(d.shop ? `None left — buy more from ${NPCS[d.shop].name}` : 'Not enough coins — sell some crops!');
    send({ type: 'place', ...base, lx, ly, item: t.id, r });
  } else if (t.kind === 'remove' || t.kind === 'roofRemove') {
    const target = removeTarget(h);
    if (!target) return;
    if (target.edge) send({ type: 'remove', ...base, edge: target.edge, featureOnly: target.featureOnly });
    else send({ type: 'remove', ...base, lx: target.lx, ly: target.ly, roof: !!target.roof });
  } else if (t.kind === 'pave' || t.kind === 'dig') {
    const plan = roadPlan(h);
    if (!plan) return;
    if (plan.err) return toast(plan.err);
    send({ type: 'road', plotId: S.myPlot, tiles: plan.tiles, on: plan.on });
  } else if (t.kind === 'resize' || t.kind === 'merge' || t.kind === 'split') {
    const plan = landPlan(h);
    if (plan?.msg && plan.ok) send(plan.msg);
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

function showSettings() {
  const body = openModal('settings', '⚙️ Settings');
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
      <span>Build mode</span><span>B · R rotate · V walls · PgUp/PgDn floors</span>
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
  if (!mine && modalKind !== 'settings') toast(text);
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
  if (e.key === 'Enter') {
    e.preventDefault();
    if (S.talk) $('npc-input').focus();
    else if (lastAction.startsWith('talk')) $('action').click();
    else openChat();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'escape') { if (drag) { drag = null; refreshPreview(); } else { setMode('walk'); closeTalk(); closeModal(); } }
  if (k === 'b') $('btn-build').click();
  if (k === 'q') turnCamera(-1);
  if (k === 'e') turnCamera(1);
  if (k === 'i') $('btn-bag').click();
  if (S.mode === 'build') {
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
      kind: e.button === 1 ? 'orbit' : 'pan', cx: e.clientX, cy: e.clientY,
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      ang: pts.length === 2 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0,
    };
    drag = null; stick.id = null; stick.active = false;
    refreshPreview();
    return;
  }
  hover = { cx: e.clientX, cy: e.clientY };
  if (S.mode === 'build') {
    const q = pickLocal(e.clientX, e.clientY);
    if (q && ['wall', 'floor', 'roof', 'pave', 'dig'].includes(S.tool.kind)) drag = { start: S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q), cur: S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q) };
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
  if (gesture) { if (!pointers.size) gesture = null; return; }
  if (!had) return;
  if (S.mode === 'build') {
    if (e.type === 'pointerup') commit({ cx: e.clientX, cy: e.clientY });
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
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && S.mode === 'build' && !drag) { hover = null; refreshPreview(); } });

function onTap(cx, cy) {
  // Tap an NPC to talk.
  for (const n of S.npcs.values()) {
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
  for (const st of Object.values(S.plots)) {
    const crops = Object.values(st.obj).filter((o) => ITEMS[o.t]?.crop).map((o) => cropStage(o, sNow)).join('');
    const e = st.owner ? null : plotEntrance(world, st);
    view.setPlot(st, { ...plotOpts(st.id), crops, entrance: e && { x: e.x / TILE, z: e.y / TILE } });
  }
}

// ---------- Update ----------
let sendAcc = 0, lastSent = '', lastQuadrant = -1;
function update(dt) {
  const me = S.me;
  const v = S.mode === 'walk' ? inputVector() : { x: 0, y: 0 };
  me.moving = Math.hypot(v.x, v.y) > 0.1;
  me.running = me.moving && !!v.run;
  if (me.moving) view.offset.multiplyScalar(Math.max(0, 1 - dt * 3));
  if (view.quadrant !== lastQuadrant) { lastQuadrant = view.quadrant; plotsDirty = true; }
  if (me.moving) {
    const g = view.ground();
    const wx = g.rx * v.x - g.fx * v.y, wz = g.rz * v.x - g.fz * v.y;
    const sp = PLAYER_SPEED * (me.running ? RUN_MULT : 1) * dt;
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
  for (const p of S.players.values()) { p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
  for (const n of S.npcs.values()) { n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k; }
  updatePets(dt);
  if (plotsDirty) syncPlots();
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
  for (const p of S.players.values()) view.actor(p.id, U(p.x), U(p.y), p.dir, p.running ? 'run' : p.moving, p.look, now, true, hOf(p));
  for (const n of S.npcs.values()) {
    const d = NPCS[n.id];
    view.actor(`npc:${n.id}`, U(n.x), U(n.y), n.dir, n.moving, d.look, now);
  }
  view.actor(S.me.id, U(S.me.x), U(S.me.y), S.me.dir, S.me.running ? 'run' : S.me.moving, S.me.look, now, true, myH);
  for (const [id, p] of pets) {
    const owner = id === S.me.id ? S.me : S.players.get(id);
    if (!owner) continue;
    const pose = p.sleeping ? 'sleep' : !p.moving && (p.idle > 1.2 || p.heartUntil > now) ? 'sit' : false;
    view.actor(`pet:${id}`, U(p.x), U(p.y), p.dir, p.moving, null, now, true, heightAt(world, S.plots, p.x, p.y, p.level), { idx: petOf(owner), sit: pose });
  }
  view.pruneActors();
  updateOutline();
  view.render(now, darkness(worldClock(sNow, S.epoch).hours), S.mode !== 'build');
  drawOverlay(now);
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
    if (!st.owner) continue;
    const p = view.toScreen(st.x + st.w / 2, 0.9, st.y + 0.5);
    if (onScreen(p)) tag(`🏡 ${st.farm ? st.farm + ' Farm' : st.ownerName}`, p.x, p.y, 11, st.owner === S.me.id ? '#ffe08a' : '#fff');
  }
  const heads = [];
  for (const p of [...S.players.values(), S.me]) heads.push([p, p.name, p === S.me ? '#ffe08a' : '#fff']);
  for (const n of S.npcs.values()) { const d = NPCS[n.id]; heads.push([n, `${d.icon} ${d.name}`, '#bdf0a8']); }
  for (const [p, label, col] of heads) {
    const s = view.toScreen(U(p.x), 1.95 + heightAt(world, S.plots, p.x, p.y, p.level || 0), U(p.y));
    if (!onScreen(s)) continue;
    tag(label, s.x, s.y, 11, col);
    if (p.bubble && performance.now() < p.bubbleUntil) bubble(p.bubble, s.x, s.y - 20, 13);
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
    setLevel, cycleWalls, turnCamera, setMode, send,
  };
}
