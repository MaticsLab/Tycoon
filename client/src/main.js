import {
  generateWorld, plotIdAtPixel, worldClock, darkness, SHOPS,
  T, TILE, MAP_W, MAP_H, PLOT_W, PLOT_H, PLAYER_SPEED, WORLD_VERSION, tileHash,
} from '@shared/world.js';
import { canStand, inInterior, key, placementError, objAt, footprint, canRotate } from '@shared/plot.js';
import { ITEMS, GOODS, CATEGORIES, cropStage, itemName } from '@shared/catalog.js';
import { NPCS } from '@shared/npcs.js';
import { renderGround, drawTree, drawFloor, drawObject, drawPlayer, drawShop, itemIcon, shopSignY } from './sprites.js';
import { httpBase, signInGuest, signIn, signUp, getSession, signOut } from './auth.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('tycoon.' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('tycoon.' + k) : localStorage.setItem('tycoon.' + k, v); } catch { /* private mode */ } },
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
  npcs: new Map(),     // npc id -> { id, x, y, tx, ty, dir, moving, bubble }
  plots: world.plots.map((p) => ({ id: p.id, owner: null, ownerName: null, floor: {}, obj: {} })),
  coins: 0,
  inv: {},
  myPlot: null,
  username: null,
  guest: true,
  timeOffset: 0,
  epoch: 0,
  mode: 'walk',        // 'walk' | 'build'
  tool: 'wall_wood',   // item id or 'remove'
  cat: 'build',
  rot: 0,
  hover: null,
  connected: false,
  talk: null,          // { npc, view, extra: null|'shop'|'gift', waiting, lines }
};
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
      // Rejected before connecting: maybe the session expired.
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
      m.plots.forEach((p) => { S.plots[p.id] = p; });
      S.connected = true;
      $('join').hidden = true;
      $('hud').hidden = false;
      updateHud();
      if (first) {
        sysMsg(`Welcome, ${S.me.name}!`);
        if (S.myPlot == null) sysMsg('Find a plot marked "For sale" to claim it. Rosa, Otto and Juniper are in the town square.');
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
    case 'npc':
      openTalk(m);
      break;
    case 'npcSay':
      npcSaid(m);
      break;
    case 'plot':
      S.plots[m.plot.id] = m.plot;
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
function openTalk(view) {
  closeModal();
  setMode('walk');
  const def = NPCS[view.npc];
  if (!S.talk || S.talk.npc !== view.npc) {
    S.talk = { npc: view.npc, view, extra: null, waiting: false, lines: [] };
    $('npc-name').textContent = `${def.icon} ${def.name}`;
    $('npc-role').textContent = def.role;
  }
  S.talk.view = view;
  if (view.say) S.talk.lines.push({ who: 'them', text: view.say });
  $('npcpanel').hidden = false;
  $('npc-shop').hidden = !(view.sells.length || view.buys.length);
  renderStatus();
  renderLog();
  renderExtra();
}

function npcSaid(m) {
  if (!S.talk || S.talk.npc !== m.npc) return;
  S.talk.waiting = false;
  S.talk.view = { ...S.talk.view, ...m };
  S.talk.lines.push({ who: 'them', text: m.text });
  for (const c of m.changes || []) S.talk.lines.push({ who: 'note', text: `✨ ${c}` });
  renderStatus();
  renderLog();
  renderExtra();
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

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
function itemThumb(id) {
  if (GOODS[id]) { const s = document.createElement('span'); s.className = 'emo'; s.textContent = GOODS[id].icon; return s; }
  return cloneCanvas(iconCache[id] ||= itemIcon(id));
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

// ---------- Build tray ----------
const iconCache = {};
function renderTabs() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  const all = [...CATEGORIES, { id: 'special', name: '🎒 Bag' }, { id: 'remove', name: '🧹 Remove' }];
  for (const c of all) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.className = (c.id === 'remove' ? S.tool === 'remove' : S.cat === c.id && S.tool !== 'remove') ? 'sel' : '';
    b.onclick = () => {
      if (c.id === 'remove') S.tool = 'remove';
      else {
        S.cat = c.id;
        const first = Object.keys(ITEMS).find((k) => ITEMS[k].cat === c.id && (c.id !== 'special' || S.inv[k]));
        if (S.tool === 'remove' || ITEMS[S.tool]?.cat !== c.id) S.tool = first || null;
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
  if (S.tool === 'remove') {
    box.insertAdjacentHTML('beforeend', '<div style="padding:14px 8px;font-size:14px">Tap anything on your plot to remove it. Items are refunded in full, shop furniture goes back to your bag, crops are lost.</div>');
    return;
  }
  let any = false;
  for (const [id, def] of Object.entries(ITEMS)) {
    if (def.cat !== S.cat) continue;
    if (def.shop && !S.inv[id]) continue;
    any = true;
    const b = document.createElement('button');
    b.dataset.id = id;
    b.className = id === S.tool ? 'sel' : '';
    b.appendChild(cloneCanvas(iconCache[id] ||= itemIcon(id)));
    const [w, h] = footprint(id, 0);
    const size = w * h > 1 ? ` · ${w}×${h}` : '';
    b.insertAdjacentHTML('beforeend', def.shop
      ? `<span>${esc(def.name)}</span><span class="count">×${S.inv[id]}${size}</span>`
      : `<span>${esc(def.name)}</span><span class="price">🪙${def.price}${size}</span>`);
    b.onclick = () => {
      S.tool = id;
      if (!canRotate(id)) S.rot = 0;
      for (const o of box.children) o.classList.toggle('sel', o === b);
      updateRotateBtn();
    };
    box.appendChild(b);
  }
  if (!any && S.cat === 'special') box.insertAdjacentHTML('beforeend', '<div style="padding:14px 8px;font-size:14px">No furniture in your bag. Otto sells pianos, fireplaces and more in the town square.</div>');
  refreshTrayAffordability();
}
function refreshTrayAffordability() {
  for (const b of $('items').children) {
    if (b.dataset?.id && !ITEMS[b.dataset.id].shop) b.classList.toggle('poor', ITEMS[b.dataset.id].price > S.coins);
  }
}
function updateRotateBtn() {
  const ok = S.tool && S.tool !== 'remove' && canRotate(S.tool);
  $('btn-rotate').disabled = !ok;
  $('btn-rotate').textContent = ok ? `↻ Rotate (${['front', 'left', 'back', 'right'][S.rot]})` : '↻ Rotate';
}
function rotate() {
  if (!S.tool || S.tool === 'remove' || !canRotate(S.tool)) return;
  S.rot = (S.rot + 1) % 4;
  updateRotateBtn();
}
$('btn-rotate').onclick = rotate;

function setMode(mode) {
  if (mode === 'build' && S.myPlot == null) { toast('Claim a plot first!'); return; }
  if (mode === 'build') closeTalk();
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
  if (!S.tool) return;
  if (S.tool === 'remove') {
    if (objAt(plot, lx, ly) || plot.floor[key(lx, ly)]) send({ type: 'remove', plotId: S.myPlot, lx, ly });
    return;
  }
  const def = ITEMS[S.tool];
  const r = canRotate(S.tool) ? S.rot : 0;
  const err = placementError(plot, lx, ly, S.tool, r);
  if (err) { if (err !== 'Already there' && err !== 'Tile is occupied') toast(err); return; }
  if (def.shop ? !S.inv[S.tool] : def.price > S.coins) { toast(def.shop ? `None left — buy more from ${NPCS[def.shop].name}` : 'Not enough coins — sell some crops!'); return; }
  send({ type: 'place', plotId: S.myPlot, lx, ly, item: S.tool, r });
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
    // Keep the speaker visible above the conversation sheet.
    if (S.talk) ty += ($('npcpanel').offsetHeight * dpr) / 2 / scale;
  }
  const vw = cv.width / scale, vh = cv.height / scale;
  const clamp = (v, half, max) => (max <= half * 2 ? max / 2 : Math.max(half, Math.min(max - half, v)));
  camX = S.mode === 'build' ? tx : clamp(tx, vw / 2, MAP_W * TILE);
  camY = S.mode === 'build' || S.talk ? ty : clamp(ty, vh / 2, MAP_H * TILE);
  offX = Math.round(cv.width / 2 - camX * scale);
  offY = Math.round(cv.height / 2 - camY * scale);
}

const toWorld = (cx, cy) => ({ x: (cx * dpr - offX) / scale, y: (cy * dpr - offY) / scale });

// ---------- Input ----------
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
  if (e.key === 'Escape') { setMode('walk'); closeTalk(); closeModal(); }
  if (e.key === 'b' || e.key === 'B') $('btn-build').click();
  if ((e.key === 'r' || e.key === 'R') && S.mode === 'build') rotate();
  if (e.key === 'i' || e.key === 'I') $('btn-bag').click();
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
  return p ? { lx: tx - p.x, ly: ty - p.y, tx, ty } : { tx, ty };
}

cv.addEventListener('pointerdown', (e) => {
  if (!S.me || stick.id !== null) return;
  cv.setPointerCapture(e.pointerId);
  stick.id = e.pointerId;
  stick.sx = stick.x = e.clientX; stick.sy = stick.y = e.clientY;
  stick.moved = false; stick.t = performance.now();
  if (S.mode === 'build') {
    const t = tileUnder(e.clientX, e.clientY);
    S.hover = inInterior(t.lx, t.ly) ? t : null;
    lastPaint = `${t.lx},${t.ly}`;
    applyTool(t.lx, t.ly);
  }
});
cv.addEventListener('pointermove', (e) => {
  if (S.mode === 'build') {
    const t = tileUnder(e.clientX, e.clientY);
    S.hover = inInterior(t.lx, t.ly) ? t : null;
    // Walls, floors and other 1x1 items paint while dragging; big items place on tap.
    const paintable = S.tool === 'remove' || (ITEMS[S.tool] && footprint(S.tool, 0).join() === '1,1' && !ITEMS[S.tool].shop);
    if (e.pointerId === stick.id && paintable && `${t.lx},${t.ly}` !== lastPaint) {
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
  const w = toWorld(cx, cy);
  // Tap an NPC to talk.
  for (const n of S.npcs.values()) {
    if (Math.abs(w.x - n.x) < 10 && w.y < n.y + 3 && w.y > n.y - 26) {
      if (Math.hypot(n.x - S.me.x, n.y - S.me.y) < TILE * 3.4) send({ type: 'npcOpen', npc: n.id });
      else toast(`Walk closer to ${n.name}`);
      return;
    }
  }
  if (S.myPlot == null) return;
  const t = tileUnder(cx, cy);
  const hit = objAt(S.plots[S.myPlot], t.lx, t.ly);
  if (hit && ITEMS[hit.obj.t]?.crop && cropStage(hit.obj, serverNow()) === 3 && Math.hypot(w.x - S.me.x, w.y - S.me.y) < TILE * 3) {
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
    // Walking away ends the conversation.
    if (S.talk) { const n = S.npcs.get(S.talk.npc); if (n && Math.hypot(n.x - me.x, n.y - me.y) > TILE * 4) closeTalk(); }
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
      const bottom = py + footprint(o.t, o.r || 0)[1] * TILE;
      const sortY = def.flat || def.crop ? py - 1000 : def.solid ? bottom : bottom - 12;
      const nb = def.wall ? { l: ITEMS[objAt(st, lx - 1, ly)?.obj.t]?.wall, r: ITEMS[objAt(st, lx + 1, ly)?.obj.t]?.wall } : undefined;
      drawables.push({ y: sortY, draw: () => drawObject(ctx, o, px, py, sNow, { short, nb }) });
    }
    if (!st.owner) {
      const sx = (p.gate[0] - 2) * TILE, sy = (p.gateY + 1) * TILE;
      drawables.push({ y: sy + 14, draw: () => forSaleSign(sx, sy) });
    }
  }
  for (const shop of SHOPS) {
    if (shop.x + shop.w >= x0 && shop.x <= x1 && shop.y + shop.h >= y0 - 2 && shop.y <= y1) {
      drawables.push({ y: (shop.y + shop.h) * TILE, draw: () => drawShop(ctx, shop, now) });
    }
  }

  for (const [tx, ty, v] of trees) if (visible(tx, ty)) drawables.push({ y: ty * TILE + TILE, draw: () => drawTree(ctx, tx * TILE, ty * TILE, v) });
  for (const p of S.players.values()) drawables.push({ y: p.y, draw: () => drawPlayer(ctx, p, now) });
  for (const n of S.npcs.values()) {
    const d = NPCS[n.id];
    drawables.push({ y: n.y, draw: () => drawPlayer(ctx, { ...n, color: d.look.shirt }, now, d.look) });
  }
  drawables.push({ y: S.me.y, draw: () => drawPlayer(ctx, S.me, now) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  if (S.mode === 'build') drawBuildOverlay();

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
  for (const shop of SHOPS) {
    if (!visible(shop.x + shop.w / 2, shop.y)) continue;
    ctx.font = `bold ${Math.round(4.2 * scale)}px ui-rounded, 'Trebuchet MS', sans-serif`;
    ctx.fillStyle = '#3a2716';
    ctx.fillText(shop.name, (shop.x + shop.w / 2) * TILE * scale + offX, shopSignY(shop) * scale + offY);
  }
  for (const p of [...S.players.values(), S.me]) {
    const sx = p.x * scale + offX, sy = (p.y - 24) * scale + offY;
    tag(p.name, sx, sy, fs, p === S.me ? '#ffe08a' : '#fff');
    if (p.bubble && performance.now() < p.bubbleUntil) bubble(p.bubble, sx, sy - fs - 6 * dpr, Math.round(13 * dpr));
  }
  for (const n of S.npcs.values()) {
    const sx = n.x * scale + offX, sy = (n.y - 24) * scale + offY;
    const d = NPCS[n.id];
    tag(`${d.icon} ${d.name}`, sx, sy, fs, '#bdf0a8');
    if (n.bubble && performance.now() < n.bubbleUntil) bubble(n.bubble, sx, sy - fs - 6 * dpr, Math.round(13 * dpr));
  }

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
  if (!S.hover || !S.tool) return;
  const { lx, ly } = S.hover;
  if (S.tool === 'remove') {
    const hit = objAt(st, lx, ly);
    const [w, h] = hit ? footprint(hit.obj.t, hit.obj.r || 0) : [1, 1];
    const [ax, ay] = hit ? hit.key.split(',').map(Number) : [lx, ly];
    ctx.fillStyle = hit || st.floor[key(lx, ly)] ? 'rgba(255,90,90,0.4)' : 'rgba(255,255,255,0.15)';
    ctx.fillRect((p.x + ax) * TILE, (p.y + ay) * TILE, w * TILE, h * TILE);
    return;
  }
  const def = ITEMS[S.tool];
  const r = canRotate(S.tool) ? S.rot : 0;
  const [w, h] = def.layer === 'floor' ? [1, 1] : footprint(S.tool, r);
  const ok = !placementError(st, lx, ly, S.tool, r) && (def.shop ? S.inv[S.tool] > 0 : def.price <= S.coins);
  ctx.fillStyle = ok ? 'rgba(120,255,120,0.3)' : 'rgba(255,90,90,0.35)';
  ctx.fillRect((p.x + lx) * TILE, (p.y + ly) * TILE, w * TILE, h * TILE);
  ctx.globalAlpha = 0.65;
  if (def.layer === 'floor') drawFloor(ctx, S.tool, (p.x + lx) * TILE, (p.y + ly) * TILE, lx, ly);
  else drawObject(ctx, { t: S.tool, r, p: serverNow() }, (p.x + lx) * TILE, (p.y + ly) * TILE, serverNow(), { short: true });
  ctx.globalAlpha = 1;
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
      const [w] = footprint(o.t, o.r || 0);
      const big = o.t === 'lamppost';
      glow((p.x + lx) * TILE + (w * TILE) / 2, (p.y + ly) * TILE + (big ? -6 : 0), o.t === 'window' ? 22 : big ? 64 : 44);
    }
  }
  for (const shop of SHOPS) {
    glow(shop.x * TILE + 15, shop.y * TILE + 30, 26);
    glow((shop.x + shop.w) * TILE - 15, shop.y * TILE + 30, 26);
  }
  glow(42 * TILE, 26 * TILE, 70);
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
    drawAttract(now);
  }
  requestAnimationFrame(frame);
}

// Idle background behind the join screen: slow pan over the village.
function drawAttract(now) {
  const W = cv.width, H = cv.height;
  const s = Math.max(2, Math.round(Math.min(W, H) / (TILE * 13)));
  const cx = 42 * TILE + Math.sin(now / 9000) * 18 * TILE, cy = 30 * TILE + Math.cos(now / 11000) * 12 * TILE;
  ctx.setTransform(s, 0, 0, s, Math.round(W / 2 - cx * s), Math.round(H / 2 - cy * s));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ground, 0, 0);
  const vx0 = (cx - W / 2 / s) / TILE - 2, vx1 = (cx + W / 2 / s) / TILE + 2, vy0 = (cy - H / 2 / s) / TILE - 2, vy1 = (cy + H / 2 / s) / TILE + 3;
  for (const shop of SHOPS) drawShop(ctx, shop, now);
  for (const [tx, ty, v] of trees) if (tx > vx0 && tx < vx1 && ty > vy0 && ty < vy1) drawTree(ctx, tx * TILE, ty * TILE, v);
}

showJoin();
requestAnimationFrame(frame);

// Test hook: ?debug exposes state and a tile -> screen helper for automated playtests.
if (new URLSearchParams(location.search).has('debug')) {
  window.__tycoon = {
    S,
    tileToClient: (tx, ty) => ({ x: ((tx + 0.5) * TILE * scale + offX) / dpr, y: ((ty + 0.5) * TILE * scale + offY) / dpr }),
  };
}
