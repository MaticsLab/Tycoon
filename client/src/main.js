import {
  generateWorld, plotIdAtPixel, worldClock, darkness,
  TILE, MAP_W, MAP_H, PLAYER_SPEED, WORLD_VERSION,
} from '@shared/world.js';
import {
  canStand, inInterior, key, placementError, objAt, footprint, canRotate, levelView,
  LEVELS, wallError, lineEdges, rectEdges, roofError, roofAt, edgeKey,
  indexPlots, landError, contentFits, mergedRect, splitRects, hasContent, LAND_PRICE,
} from '@shared/plot.js';
import { ITEMS, GOODS, CATEGORIES, cropStage, itemName } from '@shared/catalog.js';
import { NPCS } from '@shared/npcs.js';
import { itemIcon } from './sprites.js';
import { View, LEVEL_H } from './gfx/view.js';
import { Ghost } from './gfx/ghost.js';
import { httpBase, signInGuest, signIn, signUp, getSession, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('tycoon.' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('tycoon.' + k) : localStorage.setItem('tycoon.' + k, v); } catch { /* private mode */ } },
};

// ---------- World & 3D view ----------
const world = generateWorld();
const view = new View($('game'), world);
const ghost = new Ghost(view.scene);
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
const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ec6fa4'];
let ws = null;
const look = { name: store.get('name') || '', color: store.get('color') || COLORS[Math.floor(Math.random() * COLORS.length)] };
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
  sock.onopen = () => { opened = true; failures = 0; send({ type: 'hello', name: look.name, color: look.color }); };
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
      S.me = { ...m.you, dir: 0, moving: false };
      S.coins = m.you.coins;
      S.inv = m.you.inv || {};
      S.myPlot = m.you.plotId;
      S.username = m.you.username;
      S.guest = m.you.guest;
      store.set('guest', S.guest ? '1' : '0');
      store.set('name', m.you.name);
      look.name = m.you.name;
      S.players.clear();
      for (const p of m.players) S.players.set(p.id, { ...p, tx: p.x, ty: p.y });
      S.npcs.clear();
      for (const n of m.npcs) S.npcs.set(n.id, { ...n, tx: n.x, ty: n.y, moving: false, name: NPCS[n.id].name });
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
      for (const [id, x, y, dir, moving] of m.p) {
        const p = S.players.get(id);
        if (!p) continue;
        p.tx = x; p.ty = y; p.dir = dir; p.moving = !!moving;
        if (Math.hypot(p.x - x, p.y - y) > 96) { p.x = x; p.y = y; }
      }
      for (const [id, x, y, dir, moving] of m.n || []) {
        const n = S.npcs.get(id);
        if (!n) continue;
        n.tx = x; n.ty = y; n.dir = dir; n.moving = !!moving;
      }
      break;
    case 'pos':
      S.me.x = m.x; S.me.y = m.y;
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
for (const c of COLORS) {
  const b = document.createElement('button');
  b.style.background = c;
  b.className = c === look.color ? 'sel' : '';
  b.onclick = () => { look.color = c; for (const o of $('colors').children) o.classList.toggle('sel', o === b); };
  $('colors').appendChild(b);
}
$('name').value = look.name;
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
  $('look').hidden = mode === 'login';
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

$('enter').onclick = async () => {
  readServerField();
  const btn = $('enter');
  if (btn.disabled) return;
  btn.disabled = true;
  joinError(joinMode === 'guest' ? 'Connecting…' : 'Checking…');
  try {
    look.name = $('name').value.trim() || look.name || 'Villager';
    store.set('color', look.color);
    const guestToken = store.get('guest') === '1' ? store.get('token') : null;
    let res;
    if (joinMode === 'guest') {
      res = guestToken ? { token: guestToken } : await signInGuest(api());
    } else if (joinMode === 'login') {
      res = await signIn(api(), $('login').value.trim(), $('password').value, guestToken);
      look.name = '';
    } else {
      res = await signUp(api(), { email: $('email').value.trim(), username: $('username').value.trim(), password: $('password').value, name: look.name }, guestToken);
    }
    if (!res.token) throw new Error('The server did not return a session');
    store.set('token', res.token);
    store.set('guest', joinMode === 'guest' ? '1' : '0');
    $('password').value = '';
    connect();
  } catch (e) {
    joinError(e.message);
  } finally {
    btn.disabled = false;
  }
};
for (const id of ['name', 'login', 'password', 'email', 'username']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('enter').click(); });

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
  const { day, hours } = worldClock(serverNow(), S.epoch);
  const h = Math.floor(hours), mi = Math.floor((hours - h) * 6) * 10;
  const h12 = ((h + 11) % 12) + 1;
  return `Day ${day} · ${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
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
  $('where').textContent = plot ? (plot.owner ? `${plot.ownerName}'s home` : `Plot ${here + 1} · For sale`) : 'Village';
  let action = '';
  const npc = nearestNpc();
  if (S.mode !== 'walk' || S.talk) action = '';
  else if (npc) action = `talk:${npc.id}`;
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
  }
  syncPlots();
}
$('action').onclick = () => {
  if (lastAction === 'claim') send({ type: 'claim', plotId: plotIdAtPixel(world, S.me.x, S.me.y) });
  else if (lastAction.startsWith('harvest')) send({ type: 'harvest', plotId: S.myPlot });
  else if (lastAction.startsWith('talk')) send({ type: 'npcOpen', npc: lastAction.split(':')[1] });
};

$('btn-build').onclick = () => setMode(S.mode === 'build' ? 'walk' : 'build');
$('btn-done').onclick = () => setMode('walk');
$('btn-home').onclick = () => { setMode('walk'); closeTalk(); send({ type: 'home' }); };
$('btn-chat').onclick = () => openChat();
$('btn-bag').onclick = () => (modalKind === 'bag' ? closeModal() : showBag());
$('btn-me').onclick = () => (modalKind === 'me' ? closeModal() : showMe());
$('cam-left').onclick = () => turnCamera(-1);
$('cam-right').onclick = () => turnCamera(1);
$('zoom-in').onclick = () => view.zoomBy(1 / 1.25);
$('zoom-out').onclick = () => view.zoomBy(1.25);
function turnCamera(d) { view.rotate(d); plotsDirty = true; }

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
  }
  S.talk.view = v;
  if (v.say) S.talk.lines.push({ who: 'them', text: v.say });
  $('npcpanel').hidden = false;
  $('npc-shop').hidden = !(v.sells.length || v.buys.length);
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
    for (const [k, icon, label] of [['resize', '↔️', 'Resize'], ['merge', '🔗', 'Merge'], ['split', '✂️', 'Split']]) {
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
    resize: `Drag your fence's west, east or north side. Growing costs 🪙${LAND_PRICE} per tile.`,
    merge: 'Tap the empty plot next door to join it to yours.',
    split: 'Drag across your plot to choose a cut line; the empty side goes up for sale.',
    none: '',
  };
  $('toolinfo').textContent = (S.freeBuild ? '🆓 Free build · ' : '') + (extra ? extra + ' · ' : '') + (S.level && !['resize', 'merge', 'split'].includes(t.kind) ? 'Upstairs · ' : '') + (msgs[t.kind] || '');
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
    const ok = plan.edges.every((e) => !wallError(plot, S.level, ...e)) && afford(cost);
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
      const ok = tiles.filter(([x, y]) => !placementError(plot, x, y, t.id, 0, S.level));
      ghost.tiles(tiles, def, S.level, ok.length > 0 && afford(ok.length * d.price));
      if (drag) toolInfo(`${ok.length} tiles · 🪙${ok.length * d.price}`);
    } else {
      const err = roofError(plot, r.x, r.y, r.w, r.h, S.level);
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
    const ok = !placementError(plot, lx, ly, t.id, r, S.level) && (S.freeBuild || (d.shop ? S.inv[t.id] > 0 : d.price <= S.coins));
    ghost.item(t.id, r, def, lx, ly, S.level, ok);
  } else if (t.kind === 'remove' || t.kind === 'roofRemove') {
    const target = removeTarget(hover);
    if (!target) return;
    if (target.edge) ghost.walls([target.edge], def, S.level, false);
    else if (target.tiles) ghost.tiles(target.tiles, def, target.level ?? S.level, false, 0.3);
  } else if (t.kind === 'resize' || t.kind === 'merge' || t.kind === 'split') {
    const plan = landPlan(hover);
    if (!plan) { ghost.rect(def.x, def.y, def.w, def.h, true); return; }
    if (plan.rect) ghost.rect(plan.rect.x, plan.rect.y, plan.rect.w, plan.rect.h, plan.ok);
    if (plan.sold) { ghost.rect(plan.sold.x, plan.sold.y, plan.sold.w, plan.sold.h, false); ghost.cut(plan.at, def.y, def.h); }
    toolInfo(plan.info);
  }
}

// What the land tools would do at the pointer: { rect, ok, info, ...message fields }.
const LAND_SIDES = ['west', 'east', 'north'];
function landPlan(h) {
  const plot = myDef(), t = S.tool;
  const q = pickWorld(h.cx, h.cy);
  if (!q) return null;
  const landCost = (n) => (S.freeLand ? 0 : Math.max(0, n) * LAND_PRICE);
  if (t.kind === 'resize') {
    // Which side are we dragging? Picked on pointer-down, else the nearest one.
    const dist = { west: Math.abs(q.x - plot.x), east: Math.abs(q.x - plot.x - plot.w), north: Math.abs(q.z - plot.y) };
    const side = drag?.side || LAND_SIDES.reduce((a, b) => (dist[a] <= dist[b] ? a : b));
    if (!drag) return { rect: { ...plot }, ok: true, info: `Drag the ${side} fence` };
    let { x, y, w, h: hh } = plot;
    if (side === 'west') { x = Math.round(q.x); w = plot.x + plot.w - x; }
    else if (side === 'east') w = Math.round(q.x) - plot.x;
    else { y = Math.round(q.z); hh = plot.y + plot.h - y; }
    const rect = { x, y, w, h: hh };
    const ix = Math.max(0, Math.min(x + w, plot.x + plot.w) - Math.max(x, plot.x)), iy = Math.max(0, Math.min(y + hh, plot.y + plot.h) - Math.max(y, plot.y));
    const cost = landCost(w * hh - ix * iy);
    const err = landError(S.plots, plot.id, rect) || (contentFits(plot, rect) ? null : 'your house wouldn’t fit');
    return { rect, ok: !err && afford(cost), info: `${w}×${hh} · 🪙${cost}${err ? ' · ' + err : ''}`, msg: { type: 'resizePlot', plotId: plot.id, ...rect } };
  }
  if (t.kind === 'merge') {
    const id = world.plotAt[Math.floor(q.z) * MAP_W + Math.floor(q.x)];
    const o = id >= 0 && id !== plot.id ? S.plots[id] : null;
    if (!o) return { rect: { ...plot }, ok: true, info: 'Point at the plot next door' };
    const rect = mergedRect(plot, o);
    const rest = Object.fromEntries(Object.entries(S.plots).filter(([k]) => +k !== o.id));
    const err = o.owner ? 'that plot is owned' : hasContent(o) ? 'that plot isn’t empty' : !rect ? 'not side by side' : landError(rest, plot.id, rect);
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
    const err = placementError(plot, lx, ly, t.id, r, S.level);
    if (err) { if (err !== 'Already there') toast(err); return; }
    if (!S.freeBuild && (d.shop ? !S.inv[t.id] : d.price > S.coins)) return toast(d.shop ? `None left — buy more from ${NPCS[d.shop].name}` : 'Not enough coins — sell some crops!');
    send({ type: 'place', ...base, lx, ly, item: t.id, r });
  } else if (t.kind === 'remove' || t.kind === 'roofRemove') {
    const target = removeTarget(h);
    if (!target) return;
    if (target.edge) send({ type: 'remove', ...base, edge: target.edge, featureOnly: target.featureOnly });
    else send({ type: 'remove', ...base, lx: target.lx, ly: target.ly, roof: !!target.roof });
  } else if (t.kind === 'resize' || t.kind === 'merge' || t.kind === 'split') {
    const plan = landPlan(h);
    if (plan?.msg && plan.ok) send(plan.msg);
    else if (plan?.info && drag) toast(plan.info.split(' · ').pop());
  }
}

// ---------- Cheat console (Ctrl/Cmd + Shift + C, or the ` key) ----------
function openConsole() {
  $('console').hidden = false;
  $('console-input').focus();
}
function closeConsole() { $('console').hidden = true; $('console-input').blur(); }
function consoleLine(text) {
  const d = document.createElement('div');
  d.textContent = text;
  const log = $('console-log');
  log.appendChild(d);
  while (log.children.length > 5) log.firstChild.remove();
  $('console').hidden = false;
}
$('console').onsubmit = (e) => {
  e.preventDefault();
  const cmd = $('console-input').value.trim();
  if (!cmd) return;
  consoleLine('> ' + cmd);
  const c = cmd.toLowerCase();
  if (c.startsWith('freerealestate')) S.freeLand = /\b(on|true)\b/.test(c);
  send({ type: 'cheat', cmd });
  $('console-input').value = '';
};
$('console-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConsole(); e.stopPropagation(); });
$('console-close').onclick = closeConsole;
// Phones: tap the coins five times.
let coinTaps = [];
$('coins').addEventListener('click', () => {
  const now = performance.now();
  coinTaps = [...coinTaps.filter((t) => now - t < 2000), now];
  if (coinTaps.length >= 5) { coinTaps = []; openConsole(); }
});
addEventListener('keydown', (e) => {
  if (!S.me) return;
  const combo = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyC';
  if (combo || (e.code === 'Backquote' && document.activeElement?.tagName !== 'INPUT')) {
    e.preventDefault();
    e.stopPropagation();
    if ($('console').hidden) openConsole(); else closeConsole();
  }
}, true);

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

const pointers = new Map();
const stick = { id: null, sx: 0, sy: 0, x: 0, y: 0, active: false, moved: false, t: 0 };
let gesture = null; // two-finger pan/pinch, or right-mouse pan

function panBy(dx, dy) {
  const k = (view.camera.top - view.camera.bottom) / cv.clientHeight;
  const g = view.ground();
  view.goal.x += (-g.rx * dx + g.fx * dy / Math.sin(0.62)) * k;
  view.goal.z += (-g.rz * dx + g.fz * dy / Math.sin(0.62)) * k;
}

cv.addEventListener('pointerdown', (e) => {
  if (!S.me) return;
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 || e.button === 1 || e.button === 2) {
    // Second finger (or right/middle mouse): camera gesture instead of a tool/joystick.
    const pts = [...pointers.values()];
    gesture = { cx: e.clientX, cy: e.clientY, dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 };
    drag = null; stick.id = null; stick.active = false;
    refreshPreview();
    return;
  }
  hover = { cx: e.clientX, cy: e.clientY };
  if (S.mode === 'build') {
    const q = pickLocal(e.clientX, e.clientY);
    if (q && ['wall', 'floor', 'roof'].includes(S.tool.kind)) drag = { start: S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q), cur: S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q) };
    else if (['resize', 'merge', 'split'].includes(S.tool.kind)) {
      const plot = myDef(), w = pickWorld(e.clientX, e.clientY);
      const dist = w ? { west: Math.abs(w.x - plot.x), east: Math.abs(w.x - plot.x - plot.w), north: Math.abs(w.z - plot.y) } : null;
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
      if (S.mode === 'build') panBy(cx - gesture.cx, cy - gesture.cy);
      if (gesture.dist > 0 && dist > 0) view.zoomBy(gesture.dist / dist);
      Object.assign(gesture, { cx, cy, dist });
    } else if (S.mode === 'build') {
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
  if (stick.active) {
    const dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy);
    if (d > 8) { const k = Math.min(1, d / 40) / d; x = dx * k; y = dy * k; }
  }
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

// ---------- Plots in 3D ----------
let plotsDirty = true;
let lastPlotSync = 0;
function plotOpts(id) {
  const base = { cut: 'up', maxLevel: LEVELS - 1, roofs: true, now: serverNow() };
  if (S.mode === 'build' && id === S.myPlot) return { ...base, cut: S.wallMode, maxLevel: S.level, roofs: S.wallMode === 'up' };
  // Walking inside a house: cut the walls away and hide what's above, Sims-style.
  if (S.me && plotIdAtPixel(world, S.me.x, S.me.y) === id) {
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
    view.setPlot(st, { ...plotOpts(st.id), crops });
  }
}

// ---------- Update ----------
let sendAcc = 0, lastSent = '';
function update(dt) {
  const me = S.me;
  const v = S.mode === 'walk' ? inputVector() : { x: 0, y: 0 };
  me.moving = Math.hypot(v.x, v.y) > 0.1;
  if (me.moving) {
    const g = view.ground();
    const wx = g.rx * v.x - g.fx * v.y, wz = g.rz * v.x - g.fz * v.y;
    const sp = PLAYER_SPEED * dt;
    const nx = me.x + wx * sp, ny = me.y + wz * sp;
    if (canStand(world, S.plots, nx, me.y)) me.x = nx;
    if (canStand(world, S.plots, me.x, ny)) me.y = ny;
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
    const msg = { type: 'move', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, d: me.dir, m: me.moving ? 1 : 0 };
    const sig = `${msg.x},${msg.y},${msg.d},${msg.m}`;
    if (sig !== lastSent) { lastSent = sig; send(msg); }
  }
  const k = Math.min(1, dt * 10);
  for (const p of S.players.values()) { p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
  for (const n of S.npcs.values()) { n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k; }
  if (plotsDirty) syncPlots();
}

// ---------- Render ----------
function render(now) {
  if (S.mode !== 'build' || !S.me) view.setTarget(U(S.me.x), U(S.me.y));
  const sNow = serverNow();
  for (const p of S.players.values()) view.actor(p.id, U(p.x), U(p.y), p.dir, p.moving, p.color, null, now);
  for (const n of S.npcs.values()) {
    const d = NPCS[n.id];
    view.actor(`npc:${n.id}`, U(n.x), U(n.y), n.dir, n.moving, d.look.shirt, d.look, now);
  }
  view.actor(S.me.id, U(S.me.x), U(S.me.y), S.me.dir, S.me.moving, S.me.color, null, now);
  view.pruneActors();
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
    if (onScreen(p)) tag(`🏡 ${st.ownerName}`, p.x, p.y, 11, st.owner === S.me.id ? '#ffe08a' : '#fff');
  }
  const heads = [];
  for (const p of [...S.players.values(), S.me]) heads.push([p, p.name, p === S.me ? '#ffe08a' : '#fff']);
  for (const n of S.npcs.values()) { const d = NPCS[n.id]; heads.push([n, `${d.icon} ${d.name}`, '#bdf0a8']); }
  for (const [p, label, col] of heads) {
    const s = view.toScreen(U(p.x), 1.95, U(p.y));
    if (!onScreen(s)) continue;
    tag(label, s.x, s.y, 11, col);
    if (p.bubble && performance.now() < p.bubbleUntil) bubble(p.bubble, s.x, s.y - 20, 13);
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
    S, view, world,
    // Screen position of a plot-local point (at floor height + h).
    plotToClient: (lx, ly, h = 0, plotId = S.myPlot) => { const d = S.plots[plotId]; return view.toScreen(d.x + lx, S.level * LEVEL_H + h, d.y + ly); },
    worldToClient: (x, z, h = 0) => view.toScreen(x, h, z),
    tileToClient: (tx, ty) => view.toScreen(tx + 0.5, 0, ty + 0.5),
    setLevel, cycleWalls, turnCamera, setMode, send,
  };
}
