import {
  generateWorld, canStand, plotIdAtPixel, inInterior, key, worldClock, darkness,
  T, TILE, MAP_W, MAP_H, PLOT_W, PLOT_H, PLAYER_SPEED, WORLD_VERSION, tileHash,
} from '@shared/world.js';
import { ITEMS, CATEGORIES, cropStage, placementError } from '@shared/catalog.js';
import { renderGround, drawTree, drawFloor, drawObject, drawPlayer, itemIcon } from './sprites.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('tycoon.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('tycoon.' + k, v); } catch { /* private mode */ } },
};

// ---------- World ----------
const world = generateWorld();
const ground = renderGround(world);
const trees = [];
for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
  if (world.tiles[ty * MAP_W + tx] === T.TREE) trees.push([tx, ty, tileHash(tx * 3, ty * 7)]);
}

const S = {
  me: null,            // { id, name, color, x, y, dir, moving }
  players: new Map(),  // other players by id
  plots: world.plots.map((p) => ({ id: p.id, owner: null, ownerName: null, floor: {}, obj: {} })),
  coins: 0,
  myPlot: null,
  timeOffset: 0,
  epoch: 0,            // when this world was founded (day 1)
  mode: 'walk',        // 'walk' | 'build'
  tool: 'wall_wood',   // item id or 'remove'
  cat: 'build',
  hover: null,         // { plotId, lx, ly } while building with a mouse
  connected: false,
};
const serverNow = () => Date.now() + S.timeOffset;

// ---------- Networking ----------
const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ec6fa4'];
let ws = null;
let joinInfo = null;
let reconnectTimer = null;

function defaultServer() {
  const saved = store.get('server');
  if (saved) return saved;
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  // Inside the Android app the page is served locally, so we need a real address.
  // 10.0.2.2 is the host machine as seen from the Android emulator.
  if (window.Capacitor?.isNativePlatform?.()) return 'ws://10.0.2.2:8080/ws';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function connect() {
  clearTimeout(reconnectTimer);
  let sock;
  try { sock = new WebSocket(joinInfo.server); } catch (e) { $('joinerr').textContent = 'Bad server address'; return; }
  ws = sock;
  sock.onopen = () => send({ type: 'hello', token: store.get('token'), name: joinInfo.name, color: joinInfo.color });
  sock.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
  sock.onclose = () => {
    if (ws !== sock) return;
    if (S.connected) toast('Connection lost — reconnecting…');
    else $('joinerr').textContent = "Can't reach the server. Check the address and try again.";
    S.connected = false;
    if (S.me) reconnectTimer = setTimeout(connect, 2000);
  };
}

function onMessage(m) {
  switch (m.type) {
    case 'welcome': {
      if (m.worldVersion !== WORLD_VERSION) toast('Server is running a different version of the world');
      store.set('token', m.token);
      S.timeOffset = m.serverTime - Date.now();
      S.epoch = m.epoch;
      S.me = { ...m.you, dir: 0, moving: false };
      S.coins = m.you.coins;
      S.myPlot = m.you.plotId;
      S.players.clear();
      for (const p of m.players) S.players.set(p.id, { ...p, tx: p.x, ty: p.y });
      m.plots.forEach((p) => { S.plots[p.id] = p; });
      const first = $('hud').hidden;
      S.connected = true;
      $('join').hidden = true;
      $('hud').hidden = false;
      updateHud();
      if (first) {
        sysMsg(`Welcome, ${S.me.name}!`);
        if (S.myPlot == null) sysMsg('Walk around and find a plot marked "For sale" to claim it as your home.');
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
      break;
    case 'pos':
      S.me.x = m.x; S.me.y = m.y;
      break;
    case 'chat': {
      const who = m.id === S.me?.id ? S.me : S.players.get(m.id);
      if (who) { who.bubble = m.text; who.bubbleUntil = performance.now() + 6000; }
      chatMsg(m.name, m.text);
      break;
    }
    case 'emote': {
      const who = m.id === S.me?.id ? S.me : S.players.get(m.id);
      if (who) { who.bubble = m.e; who.bubbleUntil = performance.now() + 2500; }
      break;
    }
    case 'plot':
      S.plots[m.plot.id] = m.plot;
      break;
    case 'coins':
      S.coins = m.coins;
      updateHud();
      break;
    case 'claimed':
      S.myPlot = m.plotId;
      updateHud();
      toast('🏡 This plot is yours! Tap Build to start your home.');
      break;
    case 'harvested':
      toast(`🌾 Harvested ${m.count} crop${m.count > 1 ? 's' : ''} for ${m.earned} coins`);
      break;
    case 'error':
      toast(m.msg);
      break;
  }
}

// ---------- Join screen ----------
let pickedColor = store.get('color') || COLORS[Math.floor(Math.random() * COLORS.length)];
for (const c of COLORS) {
  const b = document.createElement('button');
  b.style.background = c;
  b.className = c === pickedColor ? 'sel' : '';
  b.onclick = () => {
    pickedColor = c;
    for (const o of $('colors').children) o.classList.toggle('sel', o === b);
  };
  $('colors').appendChild(b);
}
$('name').value = store.get('name') || '';
$('server').value = defaultServer();
$('enter').onclick = () => {
  const name = $('name').value.trim() || 'Villager';
  const server = $('server').value.trim();
  store.set('name', name);
  store.set('color', pickedColor);
  if (server !== defaultServer() || store.get('server')) store.set('server', server);
  $('joinerr').textContent = 'Connecting…';
  joinInfo = { name, color: pickedColor, server };
  connect();
};
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('enter').click(); });

// ---------- HUD ----------
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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

let lastAction = '';
function updateContext() {
  if (!S.me) return;
  $('clock').textContent = fmtClock();
  $('online').textContent = `👥 ${S.players.size + 1}`;
  const here = plotIdAtPixel(world, S.me.x, S.me.y);
  const plot = here >= 0 ? S.plots[here] : null;
  $('where').textContent = plot ? (plot.owner ? `${plot.ownerName}'s home` : `Plot ${here + 1} · For sale`) : 'Village';
  let action = '';
  if (S.mode === 'walk' && plot && !plot.owner && S.myPlot == null) action = 'claim';
  else if (S.mode === 'walk' && here === S.myPlot && here >= 0) {
    const ripe = Object.values(plot.obj).filter((o) => ITEMS[o.t]?.crop && cropStage(o, serverNow()) === 3).length;
    if (ripe) action = `harvest:${ripe}`;
  }
  if (action !== lastAction) {
    lastAction = action;
    const btn = $('action');
    btn.hidden = !action;
    if (action === 'claim') btn.textContent = '🏡 Claim this plot';
    else if (action.startsWith('harvest')) btn.textContent = `🌾 Harvest (${action.split(':')[1]})`;
  }
}
$('action').onclick = () => {
  if (lastAction === 'claim') send({ type: 'claim', plotId: plotIdAtPixel(world, S.me.x, S.me.y) });
  else if (lastAction.startsWith('harvest')) send({ type: 'harvest', plotId: S.myPlot });
};

$('btn-build').onclick = () => setMode(S.mode === 'build' ? 'walk' : 'build');
$('btn-done').onclick = () => setMode('walk');
$('btn-home').onclick = () => { setMode('walk'); send({ type: 'home' }); };
$('btn-chat').onclick = () => openChat();

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

// ---------- Build tray ----------
const iconCache = {};
function renderTabs() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  const all = [...CATEGORIES, { id: 'remove', name: '🧹 Remove' }];
  for (const c of all) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.className = (c.id === 'remove' ? S.tool === 'remove' : S.cat === c.id && S.tool !== 'remove') ? 'sel' : '';
    b.onclick = () => {
      if (c.id === 'remove') S.tool = 'remove';
      else {
        S.cat = c.id;
        const first = Object.keys(ITEMS).find((k) => ITEMS[k].cat === c.id);
        if (S.tool === 'remove' || ITEMS[S.tool]?.cat !== c.id) S.tool = first;
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
  if (S.tool === 'remove') {
    const d = document.createElement('div');
    d.style.cssText = 'padding:14px 8px;font-size:14px';
    d.textContent = 'Tap anything on your plot to remove it. Items are refunded in full (crops are not).';
    box.appendChild(d);
    return;
  }
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.cat !== S.cat) continue;
    const b = document.createElement('button');
    b.dataset.id = id;
    b.className = id === S.tool ? 'sel' : '';
    b.appendChild(iconCache[id] ||= itemIcon(id));
    b.insertAdjacentHTML('beforeend', `<span>${esc(def.name)}</span><span class="price">🪙${def.price}</span>`);
    b.onclick = () => {
      S.tool = id;
      for (const o of box.children) o.classList.toggle('sel', o === b);
    };
    box.appendChild(b);
  }
  refreshTrayAffordability();
}
function refreshTrayAffordability() {
  for (const b of $('items').children) {
    if (b.dataset?.id) b.classList.toggle('poor', ITEMS[b.dataset.id].price > S.coins);
  }
}

function setMode(mode) {
  if (mode === 'build' && S.myPlot == null) { toast('Claim a plot first!'); return; }
  S.mode = mode;
  S.hover = null;
  $('tray').hidden = mode !== 'build';
  $('btn-build').classList.toggle('on', mode === 'build');
  $('action').style.display = mode === 'build' ? 'none' : '';
  $('chatlog').style.display = mode === 'build' ? 'none' : '';
  if (mode === 'build') { renderTabs(); renderItems(); }
  resize();
}

function applyTool(lx, ly) {
  const plot = S.plots[S.myPlot];
  if (!inInterior(lx, ly)) return;
  if (S.tool === 'remove') {
    const k = key(lx, ly);
    if (plot.obj[k] || plot.floor[k]) send({ type: 'remove', plotId: S.myPlot, lx, ly });
    return;
  }
  const err = placementError(plot, lx, ly, S.tool);
  if (err) { if (err !== 'Already there') toast(err); return; }
  if (ITEMS[S.tool].price > S.coins) { toast('Not enough coins — grow some crops!'); return; }
  send({ type: 'place', plotId: S.myPlot, lx, ly, item: S.tool });
}

// ---------- Canvas, camera ----------
const cv = $('game');
const ctx = cv.getContext('2d');
const lightCv = document.createElement('canvas');
const lctx = lightCv.getContext('2d');
let dpr = 1, scale = 3, camX = 0, camY = 0, offX = 0, offY = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  lightCv.width = cv.width; lightCv.height = cv.height;
  if (S.mode === 'build') {
    const trayH = ($('tray').offsetHeight || 0) * dpr;
    const s = Math.min(cv.width / ((PLOT_W + 1) * TILE), (cv.height - trayH - 60 * dpr) / ((PLOT_H + 1.5) * TILE));
    scale = Math.max(1, s >= 2 ? Math.floor(s) : Math.floor(s * 2) / 2);
  } else {
    scale = Math.max(2, Math.round(Math.min(cv.width, cv.height) / (TILE * 13)));
  }
}
addEventListener('resize', resize);
resize();

function updateCamera() {
  let tx, ty;
  if (S.mode === 'build') {
    const p = world.plots[S.myPlot];
    const trayH = ($('tray').offsetHeight || 0) * dpr;
    tx = (p.x + p.w / 2) * TILE;
    ty = (p.y + p.h / 2) * TILE + (trayH / 2 - 20 * dpr) / scale;
  } else {
    tx = S.me.x; ty = S.me.y - 8;
  }
  const vw = cv.width / scale, vh = cv.height / scale;
  const clamp = (v, half, max) => (max <= half * 2 ? max / 2 : Math.max(half, Math.min(max - half, v)));
  const build = S.mode === 'build';
  camX = build ? tx : clamp(tx, vw / 2, MAP_W * TILE);
  camY = build ? ty : clamp(ty, vh / 2, MAP_H * TILE);
  offX = Math.round(cv.width / 2 - camX * scale);
  offY = Math.round(cv.height / 2 - camY * scale);
}

const toWorld = (cx, cy) => ({ x: (cx * dpr - offX) / scale, y: (cy * dpr - offY) / scale });

// ---------- Input ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (!S.me || document.activeElement?.tagName === 'INPUT') return;
  if (e.key === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.key === 'Escape') setMode('walk');
  if (e.key === 'b' || e.key === 'B') $('btn-build').click();
  keys.add(e.key.toLowerCase());
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const stick = { id: null, sx: 0, sy: 0, x: 0, y: 0, active: false, moved: false, t: 0 };
let lastPaint = null;

function tileUnder(cx, cy) {
  const w = toWorld(cx, cy);
  const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
  const p = world.plots[S.myPlot];
  return p ? { lx: tx - p.x, ly: ty - p.y, tx, ty } : null;
}

cv.addEventListener('pointerdown', (e) => {
  if (!S.me || stick.id !== null) return;
  cv.setPointerCapture(e.pointerId);
  stick.id = e.pointerId;
  stick.sx = stick.x = e.clientX; stick.sy = stick.y = e.clientY;
  stick.moved = false; stick.t = performance.now();
  if (S.mode === 'build') {
    const t = tileUnder(e.clientX, e.clientY);
    if (t) { lastPaint = `${t.lx},${t.ly}`; applyTool(t.lx, t.ly); }
  }
});
cv.addEventListener('pointermove', (e) => {
  if (S.mode === 'build') {
    const t = tileUnder(e.clientX, e.clientY);
    S.hover = t && inInterior(t.lx, t.ly) ? t : null;
    if (e.pointerId === stick.id && t && `${t.lx},${t.ly}` !== lastPaint) {
      lastPaint = `${t.lx},${t.ly}`;
      applyTool(t.lx, t.ly);
    }
    return;
  }
  if (e.pointerId !== stick.id) return;
  stick.x = e.clientX; stick.y = e.clientY;
  if (Math.hypot(stick.x - stick.sx, stick.y - stick.sy) > 10) { stick.moved = true; stick.active = true; }
});
const endPointer = (e) => {
  if (e.pointerId !== stick.id) return;
  if (S.mode === 'walk' && !stick.moved && performance.now() - stick.t < 350) onTap(e.clientX, e.clientY);
  stick.id = null; stick.active = false; lastPaint = null;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

function onTap(cx, cy) {
  if (S.myPlot == null) return;
  const t = tileUnder(cx, cy);
  const plot = S.plots[S.myPlot];
  const o = plot.obj[key(t.lx, t.ly)];
  const w = toWorld(cx, cy);
  if (o && ITEMS[o.t]?.crop && cropStage(o, serverNow()) === 3 && Math.hypot(w.x - S.me.x, w.y - S.me.y) < TILE * 3) {
    send({ type: 'harvest', plotId: S.myPlot, lx: t.lx, ly: t.ly });
  }
}

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

// ---------- Update ----------
let sendAcc = 0, lastSent = '';
function update(dt) {
  const me = S.me;
  const v = S.mode === 'walk' ? inputVector() : { x: 0, y: 0 };
  me.moving = Math.hypot(v.x, v.y) > 0.1;
  if (me.moving) {
    const sp = PLAYER_SPEED * dt;
    const nx = me.x + v.x * sp, ny = me.y + v.y * sp;
    if (canStand(world, S.plots, nx, me.y)) me.x = nx;
    if (canStand(world, S.plots, me.x, ny)) me.y = ny;
    me.dir = Math.abs(v.x) > Math.abs(v.y) ? (v.x < 0 ? 2 : 3) : (v.y < 0 ? 1 : 0);
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
}

// ---------- Render ----------
function render(now) {
  const W = cv.width, H = cv.height;
  updateCamera();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#2d5a3d';
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  ctx.drawImage(ground, 0, 0);

  const x0 = Math.floor(-offX / scale / TILE) - 1, y0 = Math.floor(-offY / scale / TILE) - 1;
  const x1 = x0 + Math.ceil(W / scale / TILE) + 3, y1 = y0 + Math.ceil(H / scale / TILE) + 3;
  const visible = (tx, ty) => tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
  const sNow = serverNow();

  // Water shimmer and fountain spray.
  for (let ty = Math.max(0, y0); ty < Math.min(MAP_H, y1); ty++) for (let tx = Math.max(0, x0); tx < Math.min(MAP_W, x1); tx++) {
    if (world.tiles[ty * MAP_W + tx] !== T.WATER) continue;
    const ph = (now / 900 + tileHash(tx, ty) * 6) % 6;
    if (ph < 1) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(tx * TILE + 4 + Math.floor(ph * 6), ty * TILE + 6, 2, 1); }
  }
  if (visible(41, 25)) {
    ctx.fillStyle = 'rgba(200,235,255,0.85)';
    for (let i = 0; i < 10; i++) {
      const f = ((now / 1000) + i / 10) % 1;
      const ang = i * 2.4;
      const fx = 42 * TILE + Math.cos(ang) * f * 14, fy = 25 * TILE + 4 - Math.sin(f * Math.PI) * 14 + f * 8;
      ctx.fillRect(Math.round(fx), Math.round(fy), 2, 2);
    }
  }

  const myPlotHere = plotIdAtPixel(world, S.me.x, S.me.y);
  const drawables = [];

  for (const p of world.plots) {
    if (p.x + p.w < x0 || p.x > x1 || p.y + p.h < y0 || p.y > y1) continue;
    const st = S.plots[p.id];
    for (const [k, f] of Object.entries(st.floor)) {
      const [lx, ly] = k.split(',').map(Number);
      drawFloor(ctx, f, (p.x + lx) * TILE, (p.y + ly) * TILE, lx, ly);
    }
    const short = (S.mode === 'build' && p.id === S.myPlot) || myPlotHere === p.id;
    for (const [k, o] of Object.entries(st.obj)) {
      const [lx, ly] = k.split(',').map(Number);
      const def = ITEMS[o.t];
      if (!def) continue;
      const px = (p.x + lx) * TILE, py = (p.y + ly) * TILE;
      const sortY = def.flat || def.crop ? py - 1000 : def.solid ? py + TILE : py + 4;
      drawables.push({ y: sortY, draw: () => drawObject(ctx, o, px, py, sNow, { short }) });
    }
    if (!st.owner) {
      // "For sale" sign by the gate.
      const sx = (p.gate[0] - 2) * TILE, sy = (p.gateY + 1) * TILE;
      drawables.push({ y: sy + 14, draw: () => forSaleSign(sx, sy) });
    }
  }

  for (const [tx, ty, v] of trees) if (visible(tx, ty)) drawables.push({ y: ty * TILE + TILE, draw: () => drawTree(ctx, tx * TILE, ty * TILE, v) });
  for (const p of S.players.values()) drawables.push({ y: p.y, draw: () => drawPlayer(ctx, p, now) });
  drawables.push({ y: S.me.y, draw: () => drawPlayer(ctx, S.me, now) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  if (S.mode === 'build') drawBuildOverlay();

  // Night.
  const dark = darkness(worldClock(sNow, S.epoch).hours);
  if (dark > 0) drawNight(dark, x0, y0, x1, y1);

  // Screen-space labels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fs = Math.round(11 * dpr);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const p of world.plots) {
    if (!visible(p.x + p.w / 2, p.y)) continue;
    const st = S.plots[p.id];
    const label = st.owner ? `🏡 ${st.ownerName}` : `Plot ${p.id + 1} · For sale`;
    tag(label, (p.x + p.w / 2) * TILE * scale + offX, p.y * TILE * scale + offY - 2 * dpr, fs, st.owner === S.me.id ? '#ffe08a' : '#fff');
  }
  const all = [...S.players.values(), S.me];
  for (const p of all) {
    const sx = p.x * scale + offX, sy = (p.y - 24) * scale + offY;
    tag(p.name, sx, sy, fs, p === S.me ? '#ffe08a' : '#fff');
    if (p.bubble && performance.now() < p.bubbleUntil) bubble(p.bubble, sx, sy - fs - 6 * dpr, Math.round(13 * dpr));
  }

  // Virtual joystick.
  if (stick.active && S.mode === 'walk') {
    const r = 40 * dpr;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(stick.sx * dpr, stick.sy * dpr, r, 0, Math.PI * 2); ctx.fill();
    const dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, 40 / d);
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc((stick.sx + dx * k) * dpr, (stick.sy + dy * k) * dpr, r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function forSaleSign(x, y) {
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x + 7, y + 4, 2, 11);
  ctx.fillStyle = '#c99363'; ctx.fillRect(x + 1, y - 3, 14, 8);
  ctx.fillStyle = '#e74c3c'; ctx.fillRect(x + 3, y - 1, 10, 4);
  ctx.fillStyle = '#fff'; ctx.fillRect(x + 5, y, 6, 1); ctx.fillRect(x + 5, y + 2, 4, 1);
}

function drawBuildOverlay() {
  const p = world.plots[S.myPlot];
  const st = S.plots[S.myPlot];
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let lx = 1; lx <= p.w - 1; lx++) { ctx.moveTo((p.x + lx) * TILE, (p.y + 1) * TILE); ctx.lineTo((p.x + lx) * TILE, (p.y + p.h - 1) * TILE); }
  for (let ly = 1; ly <= p.h - 1; ly++) { ctx.moveTo((p.x + 1) * TILE, (p.y + ly) * TILE); ctx.lineTo((p.x + p.w - 1) * TILE, (p.y + ly) * TILE); }
  ctx.stroke();
  if (S.hover) {
    const { lx, ly } = S.hover;
    const ok = S.tool === 'remove' ? !!(st.obj[key(lx, ly)] || st.floor[key(lx, ly)]) : !placementError(st, lx, ly, S.tool) && ITEMS[S.tool].price <= S.coins;
    ctx.fillStyle = ok ? 'rgba(120,255,120,0.3)' : 'rgba(255,90,90,0.35)';
    ctx.fillRect((p.x + lx) * TILE, (p.y + ly) * TILE, TILE, TILE);
    if (ok && S.tool !== 'remove') {
      ctx.globalAlpha = 0.6;
      const def = ITEMS[S.tool];
      if (def.layer === 'floor') drawFloor(ctx, S.tool, (p.x + lx) * TILE, (p.y + ly) * TILE, lx, ly);
      else drawObject(ctx, { t: S.tool, p: serverNow() }, (p.x + lx) * TILE, (p.y + ly) * TILE, serverNow(), { short: true });
      ctx.globalAlpha = 1;
    }
  }
}

function drawNight(dark, x0, y0, x1, y1) {
  const W = cv.width, H = cv.height;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, W, H);
  lctx.fillStyle = `rgba(16, 22, 60, ${dark})`;
  lctx.fillRect(0, 0, W, H);
  lctx.globalCompositeOperation = 'destination-out';
  const glow = (wx, wy, rad) => {
    const sx = wx * scale + offX, sy = wy * scale + offY, R = rad * scale;
    const g = lctx.createRadialGradient(sx, sy, 0, sx, sy, R);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g;
    lctx.fillRect(sx - R, sy - R, R * 2, R * 2);
  };
  for (const p of world.plots) {
    if (p.x + p.w < x0 || p.x > x1 || p.y + p.h < y0 || p.y > y1) continue;
    for (const [k, o] of Object.entries(S.plots[p.id].obj)) {
      if (!ITEMS[o.t]?.light && o.t !== 'window') continue;
      const [lx, ly] = k.split(',').map(Number);
      const big = o.t === 'lamppost';
      glow((p.x + lx) * TILE + 8, (p.y + ly) * TILE + (big ? -6 : 0), o.t === 'window' ? 22 : big ? 64 : 44);
    }
  }
  glow(42 * TILE, 26 * TILE, 70); // fountain plaza lights
  glow(S.me.x, S.me.y - 8, 34);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lightCv, 0, 0);
}

function tag(text, x, y, fs, color) {
  ctx.font = `bold ${fs}px ui-rounded, 'Trebuchet MS', sans-serif`;
  const w = ctx.measureText(text).width + fs * 0.8;
  ctx.fillStyle = 'rgba(30,22,12,0.55)';
  roundRect(x - w / 2, y - fs * 1.35, w, fs * 1.35, fs * 0.4);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y - fs * 0.15);
}

function bubble(text, x, y, fs) {
  ctx.font = `${fs}px ui-rounded, 'Trebuchet MS', sans-serif`;
  const words = text.split(' ');
  const maxW = fs * 14;
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  lines.push(line);
  const lh = fs * 1.25;
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + fs;
  const h = lines.length * lh + fs * 0.5;
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = Math.max(1, fs / 7);
  roundRect(x - w / 2, y - h, w, h, fs * 0.5, true);
  ctx.beginPath(); ctx.moveTo(x - fs * 0.4, y - 1); ctx.lineTo(x, y + fs * 0.5); ctx.lineTo(x + fs * 0.4, y - 1); ctx.fill();
  ctx.fillStyle = '#3a2a1a';
  ctx.textBaseline = 'bottom';
  lines.forEach((l, i) => ctx.fillText(l, x, y - h + fs * 0.25 + lh * (i + 1)));
}

function roundRect(x, y, w, h, rad, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
  ctx.fill();
  if (stroke) ctx.stroke();
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
    // Idle background behind the join screen: slow pan over the village.
    drawAttract(now);
  }
  requestAnimationFrame(frame);
}

function drawAttract(now) {
  const W = cv.width, H = cv.height;
  const s = Math.max(2, Math.round(Math.min(W, H) / (TILE * 13)));
  const cx = 42 * TILE + Math.sin(now / 9000) * 18 * TILE, cy = 30 * TILE + Math.cos(now / 11000) * 12 * TILE;
  ctx.setTransform(s, 0, 0, s, Math.round(W / 2 - cx * s), Math.round(H / 2 - cy * s));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ground, 0, 0);
  const vx0 = (cx - W / 2 / s) / TILE - 2, vx1 = (cx + W / 2 / s) / TILE + 2, vy0 = (cy - H / 2 / s) / TILE - 2, vy1 = (cy + H / 2 / s) / TILE + 3;
  for (const [tx, ty, v] of trees) if (tx > vx0 && tx < vx1 && ty > vy0 && ty < vy1) drawTree(ctx, tx * TILE, ty * TILE, v);
}

requestAnimationFrame(frame);
