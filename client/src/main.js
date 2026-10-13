import {
  generateWorld, applyRoads, plotIdAtPixel, worldClock, darkness,
  TILE, MAP_W, MAP_H, PLAYER_SPEED, RUN_MULT, WORLD_VERSION, DAY_MS, T,
} from '@shared/world.js';
import {
  canStand, crossesWall, inInterior, key, placementError, objAt, footprint, canRotate, levelView, wallSideAt,
  LEVELS, wallError, lineEdges, rectEdges, roofError, roofAt, edgeKey,
  indexPlots, landError, contentFits, mergedRect, splitRects, hasContent, LAND_PRICE,
  stepLevel, heightAt, roadEditError, roadIn, plotEntrance, occChanged, wallRun, parseEdge, wallHeight,
} from '@shared/plot.js';
import { ITEMS, GOODS, CATEGORIES, cropStage, isWet, itemName } from '@shared/catalog.js';
import { FARMHANDS, TRACTOR_MODES, SEEDS, connected, networks, UTILITIES, QUALITY, ANIMALS, seasonOf, seasonDay, inSeason, growsAt, seasonsLabel } from '@shared/farm.js';
import { NPCS } from '@shared/npcs.js';
import { itemIcon } from './sprites.js';
import { View, LEVEL_H } from './gfx/view.js';
import { lowered, LOW_H } from './gfx/houses.js';
import { Ghost, Outline } from './gfx/ghost.js';
import { slotFronts } from './gfx/goods.js';
import { itemHeight } from './gfx/models.js';
import { FENCE_MODELS } from './gfx/models-fences.js';
import { modelIcon } from './modelicon.js';
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
import { socialUI } from './social-ui.js';
import { makeWeather } from './weather.js';
import { createAudio } from './audio.js';
import { FOUNTAIN } from '@shared/world.js';
import { applyNature, wildKind, treeStage, fruitReady, HITS, TOOL_FOR, weatherAt } from '@shared/nature.js';
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
  query: '',           // build catalog search
  sel: null,           // build mode: the selected placed object { at: [lx, ly], level }
  connected: false,
  talk: null,
  freeBuild: false,    // bb.enablefreebuild
  freeLand: false,     // freerealestate on
  drops: new Map(),    // things lying on the ground: id -> { item, n, x, y, level }
  util: {},            // your water / electricity: { water: { due, off }, ... }
  hand: null,          // your farmhand
  market: null,        // { pick, mult: { item: x } } what Rosa pays today
  ride: null,          // driving the tractor: { mode, seed }
};
const afford = (cost) => S.freeBuild || cost <= S.coins;
let ui = null; // village life UI (social-ui.js), set up at the end
// Your role on a plot: 'build' (yours, or a co-builder), 'farm' (a farmhand friend) or null.
const roleOn = (plot) => (!plot || !S.me ? null : plot.owner === S.me.id ? 'build' : plot.helpers?.[S.me.id]?.role || null);
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
  if (m.type === 'fishing') audio.sfx(m.state === 'cast' ? 'splash' : m.state === 'bite' ? 'bite' : m.state === 'caught' ? 'splash' : '');
  if (ui?.handle(m)) return;
  switch (m.type) {
    case 'welcome': {
      if (m.worldVersion !== WORLD_VERSION) toast('A new version of the game is available — please reload');
      S.timeOffset = m.serverTime - Date.now();
      S.epoch = m.epoch;
      const first = $('hud').hidden;
      S.me = { ...m.you, dir: 0, moving: false, level: m.you.level || 0 };
      S.coins = m.you.coins;
      S.inv = m.you.inv || {};
      S.qual = m.qual || {};
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
      applyNature(world, m.nature);
      view.refreshTerrain();
      view.refreshNature();
      S.weather = m.weather || null;
      S.city = m.city;
      S.drops = new Map((m.drops || []).map((d) => [d.id, d]));
      S.util = m.util || {}; S.hand = m.hand || null; S.market = m.market || null; S.ride = null;
      renderRideBar();
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
        sysMsg(matchMedia('(pointer: coarse)').matches ? 'Tip: pinch to zoom, twist two fingers to turn the camera.' : 'Tip: Q / E turn the camera, the mouse wheel zooms.');
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
      chatMsg(m.to ? `${m.name} → ${m.to}` : m.name, m.text, m.id === S.me?.id);
      break;
    }
    case 'npcBubble': {
      const n = S.npcs.get(m.id);
      if (n) { n.bubble = m.text; n.bubbleUntil = performance.now() + Math.min(9000, 2500 + m.text.length * 60); }
      break;
    }
    case 'npc': openTalk(m); break;
    case 'npcSay': npcSaid(m); break;
    case 'epoch':
      // The village slept through the night: fade to black and back to morning.
      S.epoch = m.epoch;
      document.body.classList.add('night-skip');
      setTimeout(() => document.body.classList.remove('night-skip'), 1600);
      plotsDirty = true;
      break;
    case 'business':
      S.biz = m.biz;
      $('btn-shop').hidden = !S.biz;
      $('btn-editplot').hidden = !(S.biz?.plotId != null && S.homePlot != null);
      updateHud();
      if (modalKind === 'shop') showShop();
      if (modalKind === 'city') showCity();
      break;
    case 'sale': saleFx(m); break;
    case 'nature': {
      if ((m.cut || []).length === 1 && Math.hypot((m.cut[0] % MAP_W + 0.5) * TILE - S.me.x, (Math.floor(m.cut[0] / MAP_W) + 0.5) * TILE - S.me.y) < TILE * 3) audio.sfx(world.tiles[m.cut[0]] === T.ROCK ? 'mine' : 'fell');
      for (const i of m.cut || []) if (world.tiles[i] === T.TREE || world.tiles[i] === T.ROCK) { const x = i % MAP_W, y = Math.floor(i / MAP_W); chips(x, y, world.tiles[i] === T.TREE ? 'tree' : 'rock', 14); world.tiles[i] = T.GRASS; }
      for (const [i, kind] of m.grow || []) if (world.tiles[i] !== T.PATH) world.tiles[i] = kind === 'rock' ? T.ROCK : T.TREE;
      world.natureVersion = (world.natureVersion || 0) + 1;
      view.refreshNature();
      break;
    }
    case 'natureHit': {
      const x = m.i % MAP_W, y = Math.floor(m.i / MAP_W);
      chips(x, y, world.tiles[m.i] === T.ROCK ? 'rock' : 'tree', 6);
      if (m.by === S.me.id) { haptic(10); audio.sfx(world.tiles[m.i] === T.ROCK ? 'mine' : 'chop'); }
      break;
    }
    case 'weather': S.weather = m.now; break;
    case 'farm':
      S.util = m.util || {}; S.hand = m.hand || null; S.market = m.market || null;
      if (modalKind === 'city') showCity();
      break;
    case 'drop': S.drops.set(m.drop.id, m.drop); break;
    case 'dropGone': S.drops.delete(m.id); break;
    case 'ride':
      S.ride = m.ride;
      renderRideBar();
      break;
    case 'gifted':
      toast(m.text);
      sysMsg(m.text);
      break;
    case 'questOffer':
      if (S.talk && S.talk.npc === m.quest.npc) { S.talk.offer = m.quest; renderQuestCard(); }
      break;
    case 'quests':
      S.quests = m.quests; S.stats = m.stats || {};
      badges();
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
      if (modalKind === 'store') ui.showStore();
      if (modalKind === 'lot' && m.plot.id === S.myPlot) showLot();
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
      if (S.talk && m.coins > S.coins) audio.sfx('coin');
      S.coins = m.coins;
      updateHud();
      if (S.talk?.extra) renderExtra();
      break;
    case 'inv':
      S.inv = m.inv;
      S.qual = m.qual || {};
      updateHud();
      if (S.stockRedraw && modalKind === 'stock') S.stockRedraw();
      if (S.mode === 'build' && S.cat === 'special') renderItems();
      if (S.talk?.extra) renderExtra();
      if (modalKind === 'bag') showBag();
      if (modalKind === 'store') ui.showStore();
      if (modalKind === 'trade') ui.showTrade();
      break;
    case 'claimed':
      S.myPlot = S.homePlot = m.plotId;
      updateHud();
      toast('🏡 This plot is yours! Tap Build to start your home.');
      break;
    case 'harvested': {
      const parts = Object.entries(m.items).map(([k, n]) => `${n} ${GOODS[k].icon}`);
      if (m.silver || m.gold) parts.push(`(${[m.gold && `${m.gold} ★★ gold`, m.silver && `${m.silver} ★ silver`].filter(Boolean).join(', ')})`);
      if (m.quiet && !m.gold) break;
      if (m.auto) { if (performance.now() - (S.autoToast || 0) > 20_000) { S.autoToast = performance.now(); toast(`🤖 Your farm harvested ${parts.join(' ')}`); } break; }
      toast(`${GOODS[Object.keys(m.items)[0]]?.kind === 'animal' ? '🧺 Collected' : '🌾 Harvested'} ${parts.join(' ')}`);
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
      if (S.mode === 'build' && /coins|afford/i.test(m.msg)) flashCoins('Not enough', 'neg');
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

// ---------- chat ----------
// Recent lines float up over the bottom-left corner for a few seconds; the chat panel
// keeps the whole conversation, with quick replies and an unread count on the button.
const chatHist = [];
let chatUnread = 0;
const NAME_COLS = ['#ffd27a', '#9fe0ff', '#ffb0c8', '#b8f0a0', '#e0c0ff', '#ffc89a', '#a8f0e0'];
const nameCol = (name) => NAME_COLS[[...String(name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLS.length];
function chatLine(m) {
  const d = document.createElement('div');
  d.className = m.sys ? 'sys' : m.mine ? 'mine' : '';
  if (m.sys) d.textContent = m.text;
  else d.innerHTML = `<b style="color:${nameCol(m.name)}">${esc(m.name)}</b><span>${esc(m.text)}</span>`;
  return d;
}
function addLog(m) {
  chatHist.push({ ...m, t: Date.now() });
  if (chatHist.length > 80) chatHist.shift();
  if (!$('chatpanel').hidden) { appendHist(chatHist[chatHist.length - 1]); return; }
  if (!m.sys && !m.mine) { chatUnread++; $('btn-chat').dataset.n = chatUnread; }
  const d = chatLine(m);
  const log = $('chatlog');
  log.appendChild(d);
  while (log.children.length > 5) log.firstChild.remove();
  setTimeout(() => d.classList.add('old'), 12000);
  setTimeout(() => d.remove(), 13500);
}
function appendHist(m) {
  const h = $('chathist'), stick = h.scrollHeight - h.scrollTop - h.clientHeight < 40;
  const d = chatLine(m);
  d.title = new Date(m.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  h.appendChild(d);
  if (stick) h.scrollTop = h.scrollHeight;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chatMsg = (name, text, mine = false) => addLog({ name, text, mine });
const sysMsg = (text) => addLog({ sys: true, text });

// The coin pill in build mode flashes what each build cost or refunded.
let shownCoins = null, coinFlash = 0;
function syncCoins() { $('bc-n').textContent = S.coins.toLocaleString(); shownCoins = S.coins; }
function flashCoins(text, cls) {
  const d = $('bc-delta');
  d.textContent = text; d.className = `show ${cls}`;
  clearTimeout(coinFlash);
  coinFlash = setTimeout(() => d.classList.remove('show'), 1400);
}
function updateHud() {
  $('coins').textContent = `🪙 ${S.coins}`;
  if (shownCoins != null && S.coins !== shownCoins && S.mode === 'build') { const dl = S.coins - shownCoins; flashCoins(`${dl > 0 ? '+' : '−'}${Math.abs(dl).toLocaleString()}`, dl > 0 ? 'pos' : 'neg'); }
  syncCoins();
  syncBuildBtn();
  refreshTrayAffordability();
}

function fmtClock() {
  const { day, year, shownHours: h, minutes: mi } = worldClock(serverNow(), S.epoch);
  const h12 = ((h + 11) % 12) + 1;
  const se = seasonOf(day);
  return `Y${year} ${se.icon} ${se.name} ${seasonDay(day)} · ${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
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
let lastViewKey = '';
function updateContext() {
  if (!S.me) return;
  $('clock').textContent = fmtClock();
  view.setSeason(S.seasonOverride || seasonOf(worldClock(serverNow(), S.epoch).day).id);
  syncBuildBtn();
  const here = plotIdAtPixel(world, S.me.x, S.me.y);

  const plot = here >= 0 ? S.plots[here] : null;
  let action = '';
  const npc = nearestNpc();
  const usable = S.mode === 'walk' && !S.talk && !S.act ? nearestUsable() : null;
  if (S.mode !== 'walk' || S.talk) action = '';
  else if (S.act) action = `stop:${S.act}`;
  else if (ui.fish.state) action = `ui:${ui.contextAction().id}`;
  else if (npc) action = `talk:${npc.id}`;
  else if (usable) action = `use:${usable.plot.id}:${usable.level}:${usable.key}`;
  else if (ui.contextAction()) action = `ui:${ui.contextAction().id}`;
  else if (wildNear()) { const w = wildNear(); action = `wild:${w.x}:${w.y}:${w.kind}`; }
  else if (S.carry) action = `eatHere:${S.carry.food}`;
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
    else if (action.startsWith('ui:')) btn.textContent = ui.contextAction()?.label || '…';
    else if (action.startsWith('wild:')) btn.textContent = action.endsWith('tree') ? '🪓 Chop tree' : '⛏️ Break rock';
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
  if (lastAction.startsWith('ui:')) { ui.runAction(lastAction.slice(3)); return; }
  if (lastAction.startsWith('wild:')) { const [, x, y] = lastAction.split(':'); swing(+x, +y); return; }
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
  return id >= 0 && roleOn(S.plots[id]) === 'build' ? id : null;
}
// Build only shows while you're on land you can build on (and while building, to leave).
function syncBuildBtn() {
  const show = S.mode === 'build' || ownPlotHere() != null;
  if ($('btn-build').hidden === show) $('btn-build').hidden = !show;
}
$('btn-done').onclick = () => setMode('walk');
$('btn-chat').onclick = () => ($('chatpanel').hidden ? openChat() : closeChat());
$('btn-bag').onclick = () => (BOOK.some(([k]) => k === modalKind) ? closeModal() : showBag());
$('btn-settings').onclick = () => (modalKind === 'settings' ? closeModal() : showSettings());
function turnCamera(d) { view.rotate(d); }

const QUICK_CHAT = ['👋 Hi!', '😊', '😂', '❤️', '👍', '🎉', 'Thanks!', 'Want to trade?', 'Come visit my farm!'];
for (const q of QUICK_CHAT) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.textContent = q;
  b.onclick = () => { send({ type: 'chat', text: q }); $('chatinput').focus({ preventScroll: true }); };
  $('chatquick').appendChild(b);
}
function openChat() {
  const panel = $('chatpanel');
  if (panel.hidden) {
    panel.hidden = false;
    $('chatlog').replaceChildren();
    $('chathist').replaceChildren();
    for (const m of chatHist) appendHist(m);
    $('chathist').scrollTop = $('chathist').scrollHeight;
  }
  chatUnread = 0; $('btn-chat').dataset.n = '';
  $('chatwho').textContent = `${S.players.size + 1} online`;
  $('chatinput').focus();
}
function closeChat() { $('chatpanel').hidden = true; $('chatinput').blur(); }
$('chatclose').onclick = closeChat;
$('chatform').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatinput').value.trim();
  if (text) send({ type: 'chat', text });
  $('chatinput').value = '';
  // Keep chatting on a phone; on a keyboard, Enter sends and hands the keys back to the game.
  if (!matchMedia('(pointer: coarse)').matches) $('chatinput').blur();
};
$('chatinput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeChat();
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
// Little numbers: open requests and a new paper on the Bag button (and its tabs), and an
// envelope by the clock while there's unread mail (read it at any mailbox).
function badges() {
  if (!ui) return;
  const n = ui.unread();
  $('mailflag').hidden = !n;
  $('mailflag').textContent = `📬 ${n}`;
  const paper = S.paper && S.paperSeen !== S.paper.day;
  $('btn-bag').dataset.n = (S.quests?.length || '') || (paper ? '!' : '');
  for (const b of document.querySelectorAll('.booktabs button')) b.dataset.n = BOOK_BADGE[b.dataset.k]?.() || '';
}
const BOOK_BADGE = { quests: () => S.quests?.length || '', journal: () => (S.paper && S.paperSeen !== S.paper.day ? '!' : '') };

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
  const hearts = v.hearts ?? Math.max(0, Math.min(5, Math.round((v.affinity + 100) / 40)));
  const parts = [
    `<span>${v.mood.emoji} ${esc(v.mood.label)}</span>`,
    `<span title="Friendship">${'❤️'.repeat(hearts)}${'🤍'.repeat(5 - hearts)} ${esc(v.friendship)}</span>`,
    ...v.personality.map((w) => `<span class="trait">${esc(w)}</span>`),
  ];
  if (v.likes) parts.push(`<span>💝 loves ${esc(v.likes.join(', '))}</span>`);
  if (v.dating) parts.push('<span>💕 sweethearts</span>');
  $('npc-status').innerHTML = parts.join('');
  if (v.canDate) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = v.dating ? '💕 Spend the afternoon together' : '💕 Ask out';
    b.onclick = () => { send({ type: 'date', npc: S.talk.npc }); S.talk.waiting = true; renderLog(); };
    $('npc-status').appendChild(b);
  }
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
    iconCache[id] = d?.fence ? modelIcon(FENCE_MODELS[id](), 44) : d && ['wall', 'feature', 'roof'].includes(d.layer) ? swatchIcon(id) : itemIcon(id);
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
        const m = S.market?.mult?.[b.item] || 1;
        const trend = S.market?.pick === b.item ? ' · ⭐ today’s pick: +50%' : m > 1.25 ? ' · ❄️ out of season: scarce!' : m < 0.9 ? ' · 📉 lots sold lately' : m > 1.05 ? ' · 📈 in demand' : '';
        const bq = S.qual?.[b.item];
        const qnote = bq ? ` (${[bq[1] && `${bq[1]} ★★ +60%`, bq[0] && `${bq[0]} ★ +25%`].filter(Boolean).join(', ')}, sold first)` : '';
        list.appendChild(itemRow(b.item, `🪙${b.price} each · you have ${have}${qnote}${trend}`, [
          ['Sell 1', () => send({ type: 'sell', npc: t.npc, item: b.item, qty: 1 }), !have],
          ['Sell all', () => send({ type: 'sell', npc: t.npc, item: b.item, qty: have }), !have],
        ]));
      }
    }
    list.insertAdjacentHTML('beforeend', '<p class="muted">Prices depend on how generous they feel, how much they like you, and the market: sell lots of one crop and its price drops for a while.</p>');
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
// The Bag button opens one book with three tabs: your bag, villagers' requests and the
// journal (goals, festivals, the Gazette).
const BOOK = [['bag', '🎒 Bag', () => showBag()], ['quests', '📜 Quests', () => showQuests()], ['journal', '📖 Journal', () => ui.showJournal()]];
function openModal(kind, title) {
  modalKind = kind;
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = '';
  $('modal').hidden = false;
  const book = BOOK.some(([k]) => k === kind);
  $('modal').classList.toggle('book', book);
  if (book) {
    const bar = document.createElement('div');
    bar.className = 'booktabs';
    for (const [k, label, show] of BOOK) {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.k = k; b.dataset.n = BOOK_BADGE[k]?.() || '';
      if (k === kind) b.className = 'sel';
      b.onclick = () => { if (modalKind !== k) show(); };
      bar.appendChild(b);
    }
    $('modal-body').appendChild(bar);
  }
  return $('modal-body');
}
function closeModal() { modalKind = null; $('modal').hidden = true; }
$('modal-close').onclick = closeModal;

function showCity() {
  const keep = modalKind === 'city' ? $('modal-body').scrollTop : 0;
  const body = openModal('city', '🏛️ City Hall');
  renderCity(body, { city: S.city, me: S.me, myPlot: S.homePlot ?? S.myPlot, plots: S.plots, biz: S.biz, util: S.util, hand: S.hand, coins: S.coins, send, rerender: showCity });
  body.scrollTop = keep;
}

// Players close enough to hand things to.
const nearbyPlayers = () => [...S.players.values()].filter((p) => Math.hypot(p.x - S.me.x, p.y - S.me.y) < TILE * 4);
let bagTo = null, bagN = 1;
function showBag() {
  const body = openModal('bag', '🎒 Your bag');
  const entries = Object.entries(S.inv);
  // Give to someone nearby, or drop things on the ground (anyone can pick them up).
  const near = nearbyPlayers();
  if (!near.some((p) => p.id === bagTo)) bagTo = near[0]?.id || null;
  const bar = document.createElement('div');
  bar.className = 'row bag-bar';
  const amount = document.createElement('input');
  amount.type = 'number'; amount.min = 1; amount.max = 99; amount.value = bagN; amount.className = 'qty';
  amount.title = 'How many to drop or give';
  amount.addEventListener('keydown', (e) => e.stopPropagation());
  amount.oninput = () => { bagN = Math.max(1, Math.min(99, Math.floor(+amount.value) || 1)); };
  bar.append(Object.assign(document.createElement('span'), { textContent: 'Amount', className: 'muted' }), amount);
  if (near.length) {
    const sel = document.createElement('select');
    for (const p of near) sel.add(new Option(`🎁 to ${p.name}`, p.id, false, p.id === bagTo));
    sel.onchange = () => { bagTo = sel.value; };
    const coins = document.createElement('button');
    coins.className = 'chip'; coins.textContent = '🪙 Give coins';
    coins.onclick = () => {
      const c = Math.floor(Number(prompt(`How many coins for ${S.players.get(bagTo)?.name}?`, '50')));
      if (c > 0) send({ type: 'giveTo', to: bagTo, coins: c });
    };
    const trade = document.createElement('button');
    trade.className = 'chip'; trade.textContent = '🤝 Trade';
    trade.onclick = () => send({ type: 'tradeAsk', to: bagTo });
    bar.append(sel, coins, trade);
  } else bar.append(Object.assign(document.createElement('span'), { textContent: '· stand near someone to give them things', className: 'muted small' }));
  body.appendChild(bar);
  if (!entries.length) body.insertAdjacentHTML('beforeend', '<p class="muted">Empty. Harvest crops, or buy gifts and furniture in the town square.</p>');
  const list = document.createElement('div');
  list.className = 'list';
  for (const [k, n] of entries) {
    const sub = ITEMS[k] ? 'Furniture · place it from the Bag tab in Build mode' : GOODS[k].kind === 'tool' ? 'Tool · walk through your crops to water them' : GOODS[k].kind === 'fish' ? 'Fish · Rosa buys these, eat them, smoke them or enter the Fishing Derby' : GOODS[k].kind === 'feed' ? 'Animal feed · feed your animals at their coop or barn' : GOODS[k].kind === 'animal' ? 'From your animals · Rosa buys these, or make cheese, cloth and cake' : GOODS[k].kind === 'produce' ? 'Crop · Rosa buys these, or sell them in your shop' : GOODS[k].kind === 'product' ? 'Homemade · sell it in your shop or to Rosa' : 'Gift · give it to a villager';
    const food = FOODS[k];
    const gives = food ? Object.entries(food).map(([nd, v]) => `+${v} ${(NEEDS.find((x) => x.id === nd) || HEALTH).icon}`).join(' ') : '';
    const ql = S.qual?.[k];
    const qtxt = ql ? ` · ${[ql[1] && `${ql[1]} ★★`, ql[0] && `${ql[0]} ★`].filter(Boolean).join(' ')}` : '';
    const btns = food ? [['😋 Eat', () => { send({ type: 'eat', item: k }); closeModal(); }]] : [];
    btns.push(['⬇️ Drop', () => send({ type: 'drop', item: k, n: Math.min(n, bagN) }), S.ride && k === 'tractor']);
    if (bagTo) btns.push(['🎁 Give', () => send({ type: 'giveTo', to: bagTo, item: k, n: Math.min(n, bagN) }), S.ride && k === 'tractor']);
    list.appendChild(itemRow(k, `×${n}${qtxt} · ${sub}${gives ? ` · eat: ${gives}` : ''}`, btns));
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

// The catalog: a rail of groups on the left, the group's categories as tabs, a two-row
// grid of items and a detail column for whatever you're pointing at or holding.
const svgI = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const GROUPS = [
  { id: 'build', name: 'Build', icon: svgI('<path d="M3 21h18M5 21V10l7-6 7 6v11"/><path d="M9 21v-6h6v6"/>'), cats: ['build', 'fence', 'opening', 'floor', 'roof', 'land'] },
  { id: 'home', name: 'Home', icon: svgI('<path d="M4 18v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6"/><path d="M2 14h20v4H2zM6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M5 18v2M19 18v2"/>'), cats: ['furniture', 'kitchen', 'decor'] },
  { id: 'biz', name: 'Business', icon: svgI('<path d="M3 9h18l-1.5-5h-15z"/><path d="M4 9v11h16V9M9 20v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>'), cats: ['shop', 'shopdecor', 'utility'] },
  { id: 'out', name: 'Outdoor', icon: svgI('<path d="M12 22v-6"/><path d="M12 2 5 12h4l-3 4h12l-3-4h4z"/>'), cats: ['garden', 'fall', 'farm'] },
  { id: 'mine', name: 'Mine', icon: svgI('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>'), cats: ['starred', 'recent', 'special', 'library'] },
];
const EXTRA_CATS = { land: 'Land', starred: 'Starred', recent: 'Recent', special: 'In bag', library: 'Rooms & Library' };
const catName = (id) => EXTRA_CATS[id] || CATEGORIES.find((c) => c.id === id)?.name || id;
const groupOf = (cat) => GROUPS.find((g) => g.cats.includes(cat)) || GROUPS[0];
const readList = (k) => { try { return JSON.parse(store.get(k) || '[]').filter((id) => ITEMS[id]); } catch { return []; } };
let starred = readList('starItems'), recent = readList('recentItems');
let detailHover = null;      // item id under the pointer in the grid
const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>';
const listable = (id) => { const d = ITEMS[id]; return d && d.cat !== 'public' && (!d.shop || S.inv[id] > 0); };
function itemsOf(cat) {
  if (S.query) {
    const q = S.query.toLowerCase();
    return Object.keys(ITEMS).filter((id) => listable(id) && (ITEMS[id].name.toLowerCase().includes(q) || catName(ITEMS[id].cat).toLowerCase().includes(q)));
  }
  if (cat === 'starred') return starred.filter(listable);
  if (cat === 'recent') return recent.filter(listable);
  if (cat === 'special') return Object.keys(ITEMS).filter((id) => S.inv[id] > 0 && ITEMS[id].layer);
  return Object.keys(ITEMS).filter((id) => ITEMS[id].cat === cat && listable(id));
}
const catCount = (cat) => (cat === 'land' ? 7 : cat === 'library' ? Object.keys(STYLED_ROOMS).length + S.library.length : itemsOf(cat).length);
function pickCat(id) {
  S.query = ''; $('build-q').value = '';
  if (id === 'library') { S.cat = 'library'; S.tool = { kind: 'none' }; }
  else if (id === 'land') {
    S.cat = 'land'; S.tool = { kind: 'resize' };
    const p = myDef();
    view.zoom = Math.max(view.zoom, Math.min(70, p.w + 10)); view.zoomBy(1);
  } else {
    S.cat = id;
    if (!['starred', 'recent', 'special'].includes(id)) { const first = itemsOf(id)[0]; S.tool = first ? toolOf(first) : { kind: 'none' }; }
  }
  syncStrip(); renderTabs(); renderItems(); refreshPreview();
}
function renderTabs() {
  const rail = $('grouprail');
  rail.innerHTML = '';
  const g0 = groupOf(S.cat);
  for (const g of GROUPS) {
    const b = document.createElement('button');
    b.innerHTML = `${g.icon}<span>${g.name}</span>`;
    b.title = g.cats.map(catName).join(' · ');
    if (g === g0 && !S.query) b.className = 'sel';
    b.onclick = () => pickCat(g === g0 ? S.cat : g.cats[0]);
    rail.appendChild(b);
  }
  const tabs = $('tabs');
  tabs.innerHTML = '';
  if (S.query) {
    tabs.insertAdjacentHTML('beforeend', `<span class="results">Results for “${esc(S.query)}” <small style="opacity:.65">${itemsOf().length}</small></span>`);
    return;
  }
  for (const c of g0.cats) {
    const b = document.createElement('button');
    b.innerHTML = `${esc(catName(c))}<small>${catCount(c)}</small>`;
    if (S.cat === c) b.className = 'sel';
    b.onclick = () => pickCat(c);
    tabs.appendChild(b);
  }
  // Walls & Stairs and Fences: how a drag builds (a line, a room, corner by corner, paint).
  if ((S.cat === 'build' || S.cat === 'fence') && S.tool.kind === 'wall') {
    const seg = document.createElement('div');
    seg.className = 'seg2';
    for (const [k, label] of [['line', '▬ Line'], ['room', '▢ Room'], ['chain', '⌁ Custom'], ['paint', '🖌 Paint']]) {
      if (S.cat === 'fence' && (k === 'paint' || k === 'chain')) continue;
      const b = document.createElement('button');
      b.textContent = label;
      b.className = S.wallTool === k ? 'sel' : '';
      b.onclick = () => { S.wallTool = k; S.chain = null; renderTabs(); toolInfo(); refreshPreview(); };
      seg.appendChild(b);
    }
    tabs.appendChild(seg);
  }
}

const unitOf = (d) => (d.fence || d.layer === 'wall' ? '/seg' : d.layer === 'roof' || d.layer === 'floor' ? '/tile' : '');
function itemTile(id) {
  const def = ITEMS[id];
  const b = document.createElement('button');
  b.dataset.id = id;
  b.className = id === S.tool.id ? 'sel' : '';
  b.appendChild(iconFor(id));
  const own = S.inv[id] || 0;
  b.insertAdjacentHTML('beforeend', `<span class="nm">${esc(def.name)}</span>${own ? `<span class="price own">Owned</span><span class="badge">×${own}</span>` : `<span class="price">🪙${def.price}${unitOf(def)}</span>`}`);
  const star = document.createElement('span');
  star.className = 'star' + (starred.includes(id) ? ' on' : '');
  star.innerHTML = STAR_SVG;
  star.title = 'Star it (find it under Mine → Starred)';
  star.onclick = (e) => {
    e.stopPropagation();
    starred = starred.includes(id) ? starred.filter((x) => x !== id) : [id, ...starred];
    store.set('starItems', JSON.stringify(starred));
    star.classList.toggle('on', starred.includes(id));
    if (S.cat === 'starred') { renderItems(); renderTabs(); }
  };
  b.appendChild(star);
  b.title = `${def.name}${def.crop ? ` · grows in ${seasonsLabel(def.crop)}` : ''}`;
  b.onmouseenter = () => { detailHover = id; renderDetail(); };
  b.onmouseleave = () => { if (detailHover === id) { detailHover = null; renderDetail(); } };
  b.onclick = () => {
    S.tool = toolOf(id);
    if (!canRotate(id)) S.rot = 0;
    S.sel = null;
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    store.set('recentItems', JSON.stringify(recent));
    for (const o of $('items').querySelectorAll('button[data-id]')) o.classList.toggle('sel', o === b);
    syncStrip(); renderTabs(); toolInfo(); renderDetail(); refreshPreview();
    if (coarse && ['obj', 'feature'].includes(S.tool.kind)) stageAtCentre();
  };
  return b;
}
function renderItems() {
  const box = $('items');
  box.innerHTML = '';
  toolInfo();
  renderDetail();
  const tile = (icon, label, sub, sel, onclick, title) => {
    const b = document.createElement('button');
    b.className = 'tool' + (sel ? ' sel' : '');
    b.innerHTML = `<span class="ticon">${icon}</span><span class="nm">${label}</span><span class="price">${sub}</span>`;
    if (title) b.title = title;
    b.onclick = onclick;
    box.appendChild(b);
  };
  if (!S.query && S.cat === 'library') { renderLibrary(box); return; }
  if (!S.query && S.cat === 'land') {
    for (const [k, icon, label, sub] of [['resize', '↔️', 'Resize', `🪙${landPrice()}/tile`], ['merge', '🔗', 'Merge', 'next door'], ['split', '✂️', 'Split', 'sell part'], ['pave', '🛣️', 'Pave road', 'public'], ['dig', '⛏️', 'Dig up road', 'reroute']]) {
      tile(icon, label, sub, S.tool.kind === k, () => { S.tool = { kind: k }; syncStrip(); renderItems(); refreshPreview(); });
    }
    tile('🏠', 'Move house', 'free', S.tool.kind === 'movehouse', () => setStripTool('movehouse'), 'Move your whole house around the plot');
    tile('ℹ️', 'Lot info', 'bulldoze', false, () => (modalKind === 'lot' ? closeModal() : showLot()), 'Lot info, library and bulldozer');
    return;
  }
  const ids = itemsOf(S.cat);
  for (const id of ids) box.appendChild(itemTile(id));
  if (!S.query && S.cat === 'roof') tile('🧹', 'Remove roof', 'refund', S.tool.kind === 'roofRemove', () => { S.tool = { kind: 'roofRemove' }; renderItems(); refreshPreview(); });
  if (!ids.length) {
    const msg = S.query ? 'Nothing matches that. Try another word.'
      : S.cat === 'starred' ? 'Tap the ☆ on any item to keep it here.'
      : S.cat === 'recent' ? 'The last 8 things you picked show up here.'
      : S.cat === 'special' ? 'No furniture in your bag. Otto sells pianos, fireplaces and more in the town square.' : 'Nothing here yet.';
    box.insertAdjacentHTML('beforeend', `<div class="empty">${msg}</div>`);
  }
  refreshTrayAffordability();
}

// The detail column: the hovered item, else the one in hand, else the selected object.
function renderDetail() {
  const el = $('detail');
  if (!el) return;
  const selT = selObj()?.o.t || null;
  const id = detailHover || (ITEMS[S.tool.id] && S.tool.kind !== 'none' ? S.tool.id : null) || selT;
  if (!id || !ITEMS[id]) { el.innerHTML = '<div class="d-empty">Hover an item to see its size, price and how many you own.</div>'; return; }
  const d = ITEMS[id];
  const kick = detailHover ? 'PREVIEW' : id === S.tool.id ? `IN HAND${canRotate(id) ? ` · ${S.rot * 90}°` : ''}` : 'PLACED';
  const rot = !detailHover && id === S.tool.id ? S.rot : 0;
  const [w, h] = d.layer === 'obj' ? footprint(id, rot) : [1, 1];
  const own = S.inv[id] || 0;
  const fromBag = own > 0 && d.layer === 'obj';
  const notes = [d.light && 'Glows at night', canRotate(id) && 'Rotates', d.layer === 'obj' && (d.solid ? 'Blocks movement' : 'Walk-through'), d.stairs && 'Climbs one floor', d.fence && (d.gate ? 'You can walk through' : 'Fences don’t close a room'), d.slots && `Shows ${d.slots} kinds of goods`, d.outdoor && 'Made for outdoors', d.crop && `Grows in ${seasonsLabel(d.crop)}`].filter(Boolean);
  const cost = fromBag ? 'Free' : `🪙${d.price}${unitOf(d)}`;
  const foot = fromBag ? (own > 1 ? `<div class="d-foot ok">${own - 1} left after placing</div>` : `<div class="d-foot bag">Uses 1 of ${own} from your bag</div>`)
    : !afford(d.price) ? `<div class="d-foot bad">Need ${d.price - S.coins} more coins</div>` : '';
  el.innerHTML = `<div class="d-head"><div class="d-thumb"></div><div><div class="d-kick">${kick}</div><div class="d-name">${esc(d.name)}</div><div class="d-cat">${esc(catName(d.cat))}</div></div></div>
    <div class="d-stats"><div><small>Size</small><b>${w}×${h}</b></div><div><small>In bag</small><b>${own}</b></div><div><small>Cost</small><b>${cost}</b></div></div>
    ${notes.length ? `<div class="d-notes">${notes.join(' · ')}</div>` : ''}${foot}`;
  const ic = iconFor(id);
  el.querySelector('.d-thumb').appendChild(ic);
}

function refreshTrayAffordability() {
  for (const b of $('items').querySelectorAll('button[data-id]')) {
    const d = ITEMS[b.dataset.id];
    if (d && !S.inv[b.dataset.id]) b.classList.toggle('poor', !afford(d.price));
  }
  renderDetail();
}
function updateRotateBtn() { renderDetail(); }
function rotateItem(d = 1) {
  if (S.held && S.held.kind !== 'obj') { S.held.rot = (S.held.rot + d + 4) % 4; refreshPreview(); return; }
  if (S.held?.kind === 'obj') { if (canRotate(S.held.t)) { S.rot = (S.rot + d + 4) % 4; refreshPreview(); } return; }
  if (S.tool.kind !== 'obj' || !canRotate(S.tool.id)) return;
  S.rot = (S.rot + d + 4) % 4;
  updateRotateBtn();
  refreshPreview();
}
$('btn-undo').onclick = undo;

function setLevel(l) {
  S.level = Math.max(0, Math.min(LEVELS - 1, l));
  syncFloors();
  S.sel = null;
  plotsDirty = true;
  toolInfo();
  refreshPreview();
}
function syncFloors() {
  $('floor-up').disabled = S.level >= LEVELS - 1;
  $('floor-down').disabled = S.level <= 0;
  $('floorsw').title = `${S.level ? 'Upstairs' : 'Ground floor'} (PgUp/PgDn)`;
}
$('floor-up').onclick = () => setLevel(S.level + 1);
$('floor-down').onclick = () => setLevel(S.level - 1);
// One line across the cube shows the walls mode: top = up, middle = cutaway, low = down.
const WALL_MODES = { up: 'Walls up', cut: 'Cutaway', down: 'Walls down' };
const WALL_LINE = { up: 'M3.5 7 12 11.5 20.5 7', cut: 'M3.5 12 12 16.5 20.5 12', down: 'M3.5 15.4 12 19.9l8.5-4.5' };
function syncWalls() {
  document.querySelector('#btn-walls .wl').setAttribute('d', WALL_LINE[S.wallMode]);
  $('btn-walls').setAttribute('aria-label', WALL_MODES[S.wallMode]);
}
function cycleWalls() {
  S.wallMode = { up: 'cut', cut: 'down', down: 'up' }[S.wallMode];
  syncWalls();
  toast(`🧱 ${WALL_MODES[S.wallMode]}`);
  plotsDirty = true;
}
$('btn-walls').onclick = cycleWalls;
// Search every category from the box above the catalog ("/" jumps to it).
$('build-q').addEventListener('input', () => { S.query = $('build-q').value.trim(); renderTabs(); renderItems(); });
$('build-q').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('build-q').value = ''; S.query = ''; renderTabs(); renderItems(); $('build-q').blur(); }
  e.stopPropagation();
});

const coarse = matchMedia('(pointer: coarse)').matches;
function toolInfo(extra) {
  const t = S.tool, d = ITEMS[t.id];
  const msgs = {
    wall: S.wallTool === 'paint' ? 'Paint: click one side of a wall to paint just that side (inside and outside can differ). Shift+click paints the whole room, or the whole outside of that building.' : S.wallTool === 'room' ? 'Drag from corner to corner to build a room (walls + wood floor).' : S.wallTool === 'chain' ? 'Custom room: click corner after corner; close the shape for a room with a floor, or double-click / Enter to stop.' : ITEMS[S.tool.id]?.fence ? 'Drag along the grid lines to build a fence (gates let you through).' : 'Drag along the grid lines to build a wall.',
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
  // On a touch screen: drag to aim, then confirm.
  if (coarse) {
    if (t.kind === 'obj' && !d?.crop) msgs.obj = staged ? '' : 'Drag anywhere to slide it into place, then ✓. ↻ turns it.';
    msgs.select = 'Tap something to select it · long-press to grab and move it';
    if (staged) extra = 'Drag anywhere to slide it · ✓ place · ↻ turn · ✕ cancel';
    else if (S.held) extra = 'Drag it where you want it, then ✓';
  }
  msgs.eyedrop = 'Copy: click anything to pick up another one like it';
  msgs.remove = 'Sledge: click, or drag a box to clear an area. You get the price back';
  msgs.design = 'Design: click furniture or a roof to change its colour. Free';
  msgs.movehouse = 'Move house: your whole house follows the cursor; R turns it; click to set it down. Free';
  // A hint pill under the tool bar, for any tool but Select.
  const text = t.kind === 'select' || t.kind === 'none' ? (extra || (coarse ? msgs.select : '')) : [S.freeBuild && '🆓 Free build', extra, S.level && !['resize', 'merge', 'split', 'pave', 'dig'].includes(t.kind) && 'Upstairs', msgs[t.kind]].filter(Boolean).join(' · ');
  $('toolhint').textContent = text;
  $('toolhint').hidden = !text;
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
  S.sel = null;
  if (mode === 'build') {
    syncEditPlotBtn(); syncFloors(); syncWalls(); syncStrip(); syncCoins();
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
// The furniture under the pointer, by its real 3D size: the ray from the camera is tested
// against each object's box, and the first one it meets wins. So clicking the back of a
// sofa or the top of a fridge picks it, not the floor (or room) behind it.
function pickUnder(h, level = S.level) {
  const plot = S.plots[S.myPlot];
  if (!plot || !h) return null;
  const base = level * LEVEL_H;
  const a = view.pick(h.cx, h.cy, base), b = view.pick(h.cx, h.cy, base + 2);
  if (!a || !b) return null;
  // The ray as x(y), z(y) between the two picks (y = height above this floor). Higher up
  // the ray is nearer the camera, so the hit with the highest y is the one you see.
  const X = (y) => a.x + (b.x - a.x) * (y / 2), Z = (y) => a.z + (b.z - a.z) * (y / 2);
  let best = null, bestY = -1;
  for (const [k, o] of Object.entries(levelView(plot, level).obj)) {
    if (!ITEMS[o.t] || ITEMS[o.t].crop) continue;
    const [ax, ay] = k.split(',').map(Number);
    const [w, d] = footprint(o.t, o.r || 0);
    const x0 = plot.x + ax, z0 = plot.y + ay, top = itemHeight(o.t);
    // Walk down the ray from the item's top: the first height inside its box is the hit.
    for (let y = top; y >= 0; y -= 0.05) {
      const x = X(y), z = Z(y);
      if (x >= x0 && x <= x0 + w && z >= z0 && z <= z0 + d) { if (y > bestY) { bestY = y; best = { obj: { key: k, obj: o, at: [ax, ay] } }; } break; }
    }
  }
  // Walls (as tall as they're drawn right now: cut away, down or up).
  const g = view.ground(), cut = { mode: S.wallMode, fx: g.fx, fz: g.fz };
  for (const [k, w] of Object.entries(plot.walls || {})) {
    const e = parseEdge(k);
    if (e.l !== level || ITEMS[w.m]?.fence) continue;
    const H = lowered(plot, e, level, cut) ? LOW_H : wallHeight(plot, level, e.d, e.x, e.y, w);
    const along = e.d === 'h' ? b.z - a.z : b.x - a.x;
    if (Math.abs(along) < 1e-6) continue;
    const y = 2 * ((e.d === 'h' ? plot.y + e.y - a.z : plot.x + e.x - a.x) / along);
    if (y < 0 || y > H || y <= bestY) continue;
    const t = e.d === 'h' ? X(y) - (plot.x + e.x) : Z(y) - (plot.y + e.y);
    if (t < 0 || t > 1) continue;
    bestY = y; best = { wall: [e.d, e.x, e.y] };
  }
  return best;
}
const objUnder = (h, level) => pickUnder(h, level)?.obj || null;
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
// While you hold an item (and aren't dragging), a little label follows the cursor
// instead: price or "From bag", R rotate, Esc cancel (the 3D ghost shows the item).
const HOLD_KINDS = ['obj', 'floor', 'roof', 'wall', 'feature'];
function heldId() {
  if (S.held?.kind === 'obj') return S.held.t;
  return HOLD_KINDS.includes(S.tool.kind) && ITEMS[S.tool.id] ? S.tool.id : null;
}
function drawTip() {
  const el = $('cursortip'), hg = $('heldghost');
  const id = S.mode === 'build' && hover && !hover.touch && !drag && !S.chain ? heldId() : null;
  document.body.classList.toggle('holding', !!id);
  if (id) {
    el.hidden = true; hg.hidden = false;
    if (hg.dataset.id !== id) { hg.dataset.id = id; hg.firstElementChild.replaceChildren(iconFor(id)); }
    hg.firstElementChild.firstElementChild.classList.toggle('flip', S.rot % 2 === 1 && ITEMS[id].layer === 'obj');
    const d = ITEMS[id], err = tipState?.err;
    const what = S.held ? `Moving ${d.name}` : S.inv[id] > 0 && d.layer === 'obj' ? 'From bag' : `${d.price}`;
    const rot = S.held || (d.layer === 'obj' && canRotate(id)) ? ' · R rotate' : '';
    hg.lastElementChild.innerHTML = `${esc(what)}${rot} · Esc cancel${err ? ` · <b>${esc(err)}</b>` : ''}`;
    hg.classList.toggle('bad', !!err);
    hg.style.transform = `translate(${Math.round(hover.cx - hg.offsetWidth / 2)}px, ${Math.round(hover.cy + 18)}px)`;
    return;
  }
  hg.hidden = true;
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

// The selection glows: a box round furniture, the wall itself, or the room's floor.
function markSel() {
  const s = selNow();
  if (!s) return;
  const def = myDef(), l = S.sel.level;
  if (s.kind === 'obj') { const [w, h] = footprint(s.o.t, s.o.r || 0); ghost.box(def.x + S.sel.at[0], def.y + S.sel.at[1], w, h, l * LEVEL_H, Math.min(2.2, itemHeight(s.o.t) + 0.1)); }
  else if (s.kind === 'wall') ghost.walls([S.sel.edge], def, l, true, true);
  else ghost.tiles([...s.tiles].map((k) => k.split(',').map(Number)), def, l, true, 0.03);
}
function previewInner() {
  if (S.mode === 'build' && !S.held) markSel();
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
    const hit = (t.kind !== 'saveRoom' && objUnder(hover)) || objAt(v, lx, ly);
    if (hit && t.kind !== 'saveRoom') {
      const [ax, ay] = hit.key.split(',').map(Number);
      const [w, h] = footprint(hit.obj.t, hit.obj.r || 0);
      ghost.box(def.x + ax, def.y + ay, w, h, S.level * LEVEL_H, 1.2);
      const name = ITEMS[hit.obj.t].name;
      tip(t.kind === 'design' ? `🎨 ${name} · colour ${(hit.obj.c || 0) + 1}/6 · click for the next (free)` : t.kind === 'eyedrop' ? `💧 Copy ${name}` : `👆 ${name} · click to select`);
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
      tip(t.kind === 'saveRoom' ? `📚 Save this room (${tiles.size} tiles)` : `👆 Room · ${tiles.size} tiles · click to select`);
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
    if (S.chain) ghost.tiles(S.chain.map(([x, y]) => [x - 0.2, y - 0.2]), def, S.level, true, 0.5);
    const fresh = edges.filter((e) => !plot.walls?.[edgeKey(S.level, ...e)]);
    const cost = S.freeBuild ? 0 : fresh.length * d.price;
    const bad = edges.map((e) => wallError(plot, S.level, ...e, world)).find(Boolean) || coinsErr(cost);
    ghost.wallCursor(p[0], p[1], def, S.level, !bad);
    ghost.walls(edges, def, S.level, !bad, d.fence ? 'fence' : false, d.fence ? null : t.id);
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
      if (q) { const [cx, cz] = cornerOf(q); ghost.wallCursor(cx, cz, def, S.level, true); }
      tip(`${d.name} · 🪙${d.price}/${d.fence ? 'length' : 'wall'} · ${S.wallTool === 'room' ? (d.fence ? 'drag a fenced pen' : 'drag a room') : 'drag along the grid'}`);
      return;
    }
    const plan = wallPlan();
    const news = plan.edges.filter((e) => plot.walls?.[edgeKey(S.level, ...e)]?.m !== t.id);
    if (d.fence) plan.room = null; // a fenced pen, no floor
    const cost = S.freeBuild ? 0 : news.length * d.price + (plan.room ? plan.room.w * plan.room.h * ITEMS.floor_wood.price : 0);
    const bad = plan.edges.map((e) => wallError(plot, S.level, ...e, world)).find(Boolean) || coinsErr(cost);
    ghost.walls(plan.edges, def, S.level, !bad, d.fence ? 'fence' : false, d.fence ? null : t.id);
    ghost.wallCursor(drag.cur[0], drag.cur[1], def, S.level, !bad);
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
      || (d.crop && !growsAt(plot, lx, ly, d.crop, worldClock(serverNow(), S.epoch).day) ? `Out of season (grows in ${seasonsLabel(d.crop)}): plant it under a roof` : null)
      || (S.freeBuild ? null : d.shop ? (S.inv[t.id] > 0 ? null : `None left: buy more from ${NPCS[d.shop].name}`) : coinsErr(d.price));
    ghost.item(t.id, r, def, lx, ly, S.level, !bad);
    tip(`${d.name} · ${d.shop ? `×${S.inv[t.id] || 0}` : `🪙${d.price}`}${w * h > 1 ? ` · ${w}×${h}` : ''}${canRotate(t.id) && !coarse ? ' · R / right-click ↻' : ''}`, bad);
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
  // Clicking the active tool again goes back to Select (Select itself stays on).
  S.tool = S.tool.kind === kind && kind !== 'remove' && kind !== 'select' ? { kind: 'select' } : { kind };
  if (S.tool.kind === 'movehouse') {
    const frag = extract(S.plots[S.myPlot]);
    if (!frag) { S.tool = { kind: 'none' }; toast('Build something first'); }
    else S.held = { kind: 'house', frag, rot: 0, grab: [frag.w / 2, frag.h / 2], ox: frag.ox, oy: frag.oy };
  }
  syncStrip(); renderTabs(); renderItems(); refreshPreview();
}
const SUN_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4L17 8.4z"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24"><path d="M14.5 2.5A9.5 9.5 0 1 0 21.5 16 8 8 0 0 1 14.5 2.5z"/></svg>';
function syncStrip() {
  for (const b of document.querySelectorAll('#buildtools [data-tool]')) b.classList.toggle('sel', S.tool.kind === b.dataset.tool);
  syncTimeIcon();
}
// Day/night preview: a moon while it's (previewing) night, a sun by day.
function syncTimeIcon() {
  const hr = S.previewHour ?? worldClock(serverNow(), S.epoch).hours;
  const night = darkness(hr) > 0.4;
  const b = $('btn-time');
  if (b.dataset.night !== String(night)) { b.dataset.night = String(night); b.innerHTML = night ? MOON_SVG : SUN_SVG; }
  b.classList.toggle('sel', S.previewHour != null);
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

// Select with nothing in hand: click furniture to select it (a popup over it rotates it
// or picks it up), click a room's floor to lift the whole room, or empty ground to clear.
const REPEAT = new Set(['pipe', 'cable', 'spout']);
function selectAt(h) {
  const plot = S.plots[S.myPlot];
  const q = pickLocal(h.cx, h.cy);
  // Whatever the pointer meets first: furniture (by its real size) or a wall, else the
  // room's floor.
  const under = pickUnder(h);
  const hit = under?.obj || (!under?.wall && q && objAt(levelView(plot, S.level), ...tileOf(q)));
  if (hit) { S.sel = { kind: 'obj', at: hit.key.split(',').map(Number), level: S.level }; renderDetail(); refreshPreview(); return; }
  if (under?.wall) { S.sel = { kind: 'wall', edge: under.wall, level: S.level }; renderDetail(); refreshPreview(); return; }
  const [lx, ly] = q ? tileOf(q) : [0, 0];
  S.sel = q && roomRegion(plot, S.level, lx, ly) ? { kind: 'room', at: [lx, ly], level: S.level } : null;
  renderDetail(); refreshPreview();
}
function selObj() {
  if (!S.sel || S.mode !== 'build' || (S.sel.kind && S.sel.kind !== 'obj')) return null;
  const plot = S.plots[S.myPlot], o = plot && levelView(plot, S.sel.level).obj[key(...S.sel.at)];
  return o ? { plot, o } : null;
}
// What's selected, checked against the plot now: { kind, plot, o?, w?, region? } or null.
function selNow() {
  if (!S.sel || S.mode !== 'build') return null;
  const plot = S.plots[S.myPlot];
  if (!plot) return null;
  if (S.sel.kind === 'wall') { const w = plot.walls?.[edgeKey(S.sel.level, ...S.sel.edge)]; return w ? { kind: 'wall', plot, w } : null; }
  if (S.sel.kind === 'room') { const tiles = roomTiles(plot, S.sel.level, ...S.sel.at); return tiles ? { kind: 'room', plot, tiles } : null; }
  const so = selObj();
  return so && { kind: 'obj', ...so };
}
const base0 = () => ({ plotId: S.myPlot, level: S.sel.level });
// Turn the selection where it stands (d = +1 right, -1 left): furniture or a whole room.
function rotateSel(d) {
  const s = selNow();
  if (!s) return;
  if (s.kind === 'room') {
    const rot = d > 0 ? 1 : 3;
    send({ type: 'moveRegion', ...base0(), room: S.sel.at, dx: 0, dy: 0, rot });
    pushUndo('turning the room', [{ type: 'moveRegion', ...base0(), room: S.sel.at, dx: 0, dy: 0, rot: 4 - rot }]);
    return;
  }
  if (s.kind !== 'obj') return;
  if (!canRotate(s.o.t)) return toast(`${ITEMS[s.o.t].name} doesn’t turn`);
  const r0 = s.o.r || 0, r = (r0 + d + 4) % 4;
  send({ type: 'moveObj', ...base0(), from: S.sel.at, to: S.sel.at, r });
  pushUndo(`turning ${ITEMS[s.o.t].name}`, [{ type: 'moveObj', ...base0(), from: S.sel.at, to: S.sel.at, r: r0 }]);
}
// Pick the selection up to move it (it stays where it is until you set it down).
function pickUpSel() {
  const s = selNow();
  if (!s || s.kind === 'wall') return;
  const plot = s.plot, at = S.sel.at, level = S.sel.level;
  S.sel = null;
  if (s.kind === 'obj') {
    if (ITEMS[s.o.t].stairs) return toast('Stairs can’t be moved: sledgehammer them and build new ones');
    S.held = { kind: 'obj', from: at, level, t: s.o.t, r: s.o.r || 0, c: s.o.c || 0 };
    S.rot = S.held.r;
  } else {
    const frag = extract(plot, roomRegion(plot, level, ...at));
    if (!frag) return;
    S.held = { kind: 'room', at, level, frag, rot: 0, grab: [at[0] - frag.ox + 0.5, at[1] - frag.oy + 0.5], ox: frag.ox, oy: frag.oy };
  }
  // Start the carried thing where it stands, so it doesn't jump.
  const p = view.toScreen(plot.x + at[0] + 0.5, level * LEVEL_H, plot.y + at[1] + 0.5);
  hover = { cx: p.x, cy: p.y, touch: coarse };
  if (coarse) { staged = { w: { x: plot.x + at[0] + 0.5, z: plot.y + at[1] + 0.5 }, h: { ...hover }, drag: null, key: toolKey() }; showStage(); }
  toast(coarse ? '✋ Drag anywhere to slide it, then ✓' : '✋ Click to set it down · R turns it · Esc cancels');
  renderDetail(); toolInfo(); refreshPreview();
}
function sellSel() {
  const s = selNow();
  if (!s || s.kind !== 'obj') return;
  send({ type: 'remove', plotId: S.myPlot, level: S.sel.level, lx: S.sel.at[0], ly: S.sel.at[1] });
  S.sel = null; renderDetail(); refreshPreview();
}
$('op-rotl').onclick = () => rotateSel(-1);
$('op-rotr').onclick = () => rotateSel(1);
$('op-move').onclick = pickUpSel;
// Wall height bars (short, medium, tall) for a selected wall: set the whole run.
function setWallHeight(h) {
  const s = selNow();
  if (s?.kind !== 'wall') return;
  const [d, x, y] = S.sel.edge;
  const plot = s.plot;
  const before = wallRun(plot, S.sel.level, d, x, y).map((k) => [k, plot.walls[k]?.ht || 2]);
  send({ type: 'wallHeight', ...base0(), d, x, y, h });
  // Undo puts each wall back (they may have differed).
  pushUndo(`${['', 'short', 'medium', 'tall'][h]} walls`, before.map(([k, ht]) => { const e = parseEdge(k); return { type: 'wallHeight', ...base0(), d: e.d, x: e.x, y: e.y, h: ht }; }));
}
// Keep the popup 60px above the selection, whatever the camera does.
function placeObjPop() {
  const pop = $('objpop'), s = selNow();
  if (!s || S.held) { pop.hidden = true; return; }
  let wx, wz, top, title;
  if (s.kind === 'obj') {
    const [w, hh] = footprint(s.o.t, s.o.r || 0);
    wx = s.plot.x + S.sel.at[0] + w / 2; wz = s.plot.y + S.sel.at[1] + hh / 2; top = Math.min(1.6, itemHeight(s.o.t)) + 0.2; title = ITEMS[s.o.t].name;
  } else if (s.kind === 'wall') {
    const [d, x, y] = S.sel.edge;
    wx = s.plot.x + x + (d === 'h' ? 0.5 : 0); wz = s.plot.y + y + (d === 'v' ? 0.5 : 0); top = wallHeight(s.plot, S.sel.level, d, x, y) * (S.wallMode === 'up' ? 1 : 0.3); title = `wall:${s.w.ht || 2}`;
  } else {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of s.tiles) { const [x, y] = k.split(',').map(Number); x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
    wx = s.plot.x + (x0 + x1) / 2; wz = s.plot.y + (y0 + y1) / 2; top = 0.4; title = `Room · ${x1 - x0}×${y1 - y0}`;
  }
  const p = view.toScreen(wx, S.sel.level * LEVEL_H + top, wz);
  if (pop.hidden) pop.hidden = false;
  if (pop.dataset.t !== title) {
    pop.dataset.t = title;
    const head = pop.querySelector('.op-top');
    head.replaceChildren();
    if (s.kind === 'wall') {
      head.className = 'op-top bars';
      [1, 2, 3].forEach((h) => {
        const b = document.createElement('button');
        b.className = 'hbar' + (h <= (s.w.ht || 2) ? ' on' : '');
        b.style.height = `${[0, 13, 18, 23][h]}px`;
        b.title = ['', 'Short walls', 'Medium walls', 'Tall walls'][h];
        b.onclick = () => setWallHeight(h);
        head.appendChild(b);
      });
    } else { head.className = 'op-top'; head.textContent = title; }
  }
  const turn = s.kind === 'room' || (s.kind === 'obj' && canRotate(s.o.t));
  const move = s.kind !== 'wall' && !(s.kind === 'obj' && ITEMS[s.o.t].stairs);
  for (const [id, ok] of [['op-rotl', turn], ['op-rotr', turn], ['op-move', move]]) { $(id).disabled = !ok; $(id).style.opacity = ok ? '' : '.35'; }
  pop.style.transform = `translate(${Math.round(p.x - 88)}px, ${Math.round(p.y - 60 - pop.offsetHeight - 8)}px)`;
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
  const qw = !objUnder(h) && pickLocal(h.cx, h.cy, 1.0);
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
  const hit = objUnder(h) || objAt(levelView(plot, S.level), lx, ly);
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
  if (plot.owner === S.me.id) {
    // Co-op: friends who can farm (or also build) here.
    body.insertAdjacentHTML('beforeend', '<h3>🤝 Co-op helpers</h3>');
    for (const [id, h] of Object.entries(plot.helpers || {})) {
      const r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = `<span class="grow">${esc(h.name)} · ${h.role === 'build' ? 'farms and builds' : 'farms'}</span>`;
      const x = document.createElement('button'); x.className = 'chip'; x.textContent = 'Remove';
      x.onclick = () => send({ type: 'helperRemove', plotId: plot.id, id });
      r.appendChild(x); body.appendChild(r);
    }
    const r = document.createElement('div');
    r.className = 'row';
    const name = Object.assign(document.createElement('input'), { placeholder: 'Villager name', maxLength: 30 });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const role = document.createElement('select');
    role.add(new Option('can farm', 'farm')); role.add(new Option('can farm & build', 'build'));
    const add = document.createElement('button'); add.className = 'chip sel'; add.textContent = 'Add';
    add.onclick = () => name.value.trim() && send({ type: 'helperAdd', plotId: plot.id, name: name.value.trim(), role: role.value });
    r.append(name, role, add);
    body.appendChild(r);
  }
  body.insertAdjacentHTML('beforeend', '<p class="muted small">Change your farm name from ⚙️ Settings → 👤 Me → Change look.</p>');
}

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
  const hit = objUnder(h) || objAt(v, lx, ly);
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
  const under = pickUnder(h), ray = under?.obj;
  if (under?.wall) { const w = plot.walls[edgeKey(S.level, ...under.wall)]; return { edge: under.wall, featureOnly: !!w?.f }; }
  if (qm && !ray) {
    const { edge, dist } = edgeOf(qm);
    const w = plot.walls?.[edgeKey(S.level, ...edge)];
    if (w && dist < 0.22) return { edge, featureOnly: !!w.f };
  }
  const hit = ray || objAt(view_, lx, ly);
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
  if (t.kind === 'select') return selectAt(h);
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
    if (ITEMS[t.id]?.fence) plan.room = null;
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
    // Furniture drops from your hand and the new piece is selected (its popup turns or
    // moves it); seeds, pipes and cables stay in hand for the next one.
    if (!REPEAT.has(t.id) && !d.crop) {
      S.tool = { kind: 'select' };
      S.sel = { kind: 'obj', at: [lx, ly], level: S.level };
      syncStrip(); renderItems();
    }
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
  // Sound: music, ambience and effects volumes.
  body.insertAdjacentHTML('beforeend', '<h3>🔊 Sound</h3>');
  for (const [k, label] of [['music', '🎵 Music'], ['ambience', '🌧️ Ambience'], ['sfx', '🪓 Effects']]) {
    const row = document.createElement('label');
    row.className = 'row vol';
    row.innerHTML = `<span>${label}</span>`;
    const r = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.05, value: audio.vol[k] });
    r.oninput = () => { audio.start(); audio.setVolume(k, +r.value); };
    row.appendChild(r);
    body.appendChild(row);
  }
  const mute = document.createElement('button');
  mute.className = 'chip'; mute.textContent = audio.vol.muted ? '🔇 Sound off: tap to turn on' : '🔊 Sound on: tap to mute';
  mute.onclick = () => { audio.start(); audio.setVolume('muted', !audio.vol.muted); showSettings('game'); };
  body.appendChild(mute);
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
      <span>Walk</span><span>WASD / arrows · on a phone, drag anywhere: the joystick follows your finger</span>
      <span>Run</span><span>hold Shift · hold the joystick out at its edge</span>
      <span>Rotate camera</span><span>hold the scroll wheel and drag · Q / E · two-finger twist or sideways swipe</span>
      <span>Tilt camera</span><span>scroll-wheel drag up/down · two-finger swipe up/down</span>
      <span>Move camera</span><span>right-drag · two-finger drag in build mode</span>
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
  if (k === 'escape' && S.sel && S.mode === 'build' && !S.held) { S.sel = null; renderDetail(); return; }
  // Esc drops the item in your hand (back to Select) rather than leaving build mode.
  if (k === 'escape' && S.mode === 'build' && !S.held && !S.chain && !drag && HOLD_KINDS.includes(S.tool.kind)) { S.tool = { kind: 'select' }; syncStrip(); renderItems(); refreshPreview(); return; }
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
    if (e.key === '/') { e.preventDefault(); $('build-q').focus(); return; }
    if ((k === 'delete' || k === 'backspace') && S.sel && !S.held) { sellSel(); keys.add(k); return; }
    if (k === 'r' && S.sel && !S.held && !HOLD_KINDS.includes(S.tool.kind)) { rotateSel(e.shiftKey ? -1 : 1); return; }
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
    if (k === 'r') rotateItem(e.shiftKey ? -1 : 1);
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
const stick = { id: null, sx: 0, sy: 0, x: 0, y: 0, active: false, moved: false, t: 0, edgeSince: 0 };
const STICK_R = 46; // joystick radius (CSS px)
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
  try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
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
  const touch = e.pointerType !== 'mouse';
  // On a touch screen the preview sits a little above your finger, so you can see it.
  hover = touch && S.mode === 'build' ? { cx: e.clientX, cy: e.clientY - TOUCH_LIFT, fx: e.clientX, fy: e.clientY, touch: true } : { cx: e.clientX, cy: e.clientY };
  if (S.mode === 'build' && e.altKey) { eyedrop(hover); pointers.delete(e.pointerId); return; }
  if (S.mode === 'build' && touch) document.body.classList.add('touching');
  // Touch: with something staged to place, a drag anywhere slides it (like a trackpad),
  // so your finger never covers it and you don't have to hit an exact spot.
  if (S.mode === 'build' && touch && staged && slidable()) {
    nudge = { sx: e.clientX, sy: e.clientY, h0: stagedH() };
    hover = { ...nudge.h0, touch: true };
    refreshPreview();
    return;
  }
  if (S.mode === 'build') {
    if (touch) startLongPress(e);
    const q = pickLocal(hover.cx, hover.cy);
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
  stick.moved = false; stick.t = performance.now(); stick.edgeSince = 0;
});

cv.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && prev) {
    const pts = [...pointers.values()];
    if (pts.length === 2) {
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2, dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      let da = ang - gesture.ang;
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      const dcx = cx - gesture.cx, dcy = cy - gesture.cy;
      // Ignore the first few pixels so a plain pinch doesn't also wobble the camera.
      gesture.travel = (gesture.travel || 0) + Math.abs(dcx) + Math.abs(dcy) + Math.abs(da) * 60 + Math.abs(dist - gesture.dist);
      if (gesture.travel > 10) {
        if (gesture.dist > 0 && dist > 0) view.zoomBy(gesture.dist / dist);   // pinch: zoom
        view.orbit(-da, 0);                                                  // twist: turn
        if (S.mode === 'build') panBy(dcx, dcy);                             // building: two-finger drag pans
        else view.orbit(-dcx * 0.006, dcy * 0.004);                          // walking: swipe sideways to turn, up/down to tilt
      }
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
    const touch = e.pointerType !== 'mouse';
    if (touch && !prev) return; // a finger that isn't down
    if (nudge) {
      hover = { cx: nudge.h0.cx + e.clientX - nudge.sx, cy: nudge.h0.cy + e.clientY - nudge.sy, touch: true };
      refreshPreview();
      return;
    }
    hover = touch ? { cx: e.clientX, cy: e.clientY - TOUCH_LIFT, fx: e.clientX, fy: e.clientY, touch: true } : { cx: e.clientX, cy: e.clientY };
    if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) cancelLongPress();
    if (drag && drag.start) {
      const q = pickLocal(hover.cx, hover.cy);
      if (q) drag.cur = S.tool.kind === 'wall' ? cornerOf(q) : tileOf(q);
      if (q && S.tool.kind === 'remove') drag.cur = tileOf(q);
    }
    refreshPreview();
    return;
  }
  if (e.pointerId !== stick.id) return;
  stick.x = e.clientX; stick.y = e.clientY;
  const dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy);
  if (d > 10) { stick.moved = true; stick.active = true; }
  // A floating stick: past the rim, the base slides along behind your finger, so you
  // can steer anywhere without lifting it.
  if (d > STICK_R) { stick.sx = stick.x - (dx / d) * STICK_R; stick.sy = stick.y - (dy / d) * STICK_R; }
  if (d >= STICK_R * 0.92) { if (!stick.edgeSince) stick.edgeSince = performance.now(); } else stick.edgeSince = 0;
});

const endPointer = (e) => {
  const had = pointers.delete(e.pointerId);
  if (gesture) {
    // A quick right-click (no drag) rotates the item you're placing.
    const g = gesture;
    if (g.button === 2 && S.mode === 'build' && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6 && performance.now() - g.t < 450) {
      if (S.held || (S.tool.kind === 'obj' && canRotate(S.tool.id))) rotateItem(); else if (S.tool.kind === 'obj') toast('That item can’t be rotated');
    }
    if (!pointers.size) { gesture = null; if (staged) restoreStage(); }
    return;
  }
  if (!pointers.size) document.body.classList.remove('touching');
  if (!had) return;
  if (S.mode === 'build') {
    cancelLongPress();
    const touch = e.pointerType !== 'mouse';
    if (nudge) {
      nudge = null;
      const wp = view.pick(hover.cx, hover.cy, S.level * LEVEL_H);
      staged = { w: wp && { x: wp.x, z: wp.z }, h: { ...hover }, drag: null, key: toolKey() };
      showStage(); refreshPreview(); haptic(6);
      return;
    }
    if (e.type === 'pointerup' && touch && stageable()) {
      // Touch: nothing is placed yet. The preview stays put: ✓ to place, ↻ to turn,
      // ✕ to cancel, or drag again to move it.
      const wp = view.pick(hover.cx, hover.cy, S.level * LEVEL_H);
      staged = { w: wp && { x: wp.x, z: wp.z }, h: { ...hover }, drag: drag ? { ...drag } : null, key: toolKey() };
      showStage();
      refreshPreview();
      toolInfo();
      return;
    }
    if (e.type === 'pointerup') {
      const tapTool = ['select', 'design', 'eyedrop'].includes(S.tool.kind) && !S.held;
      const h = touch && !tapTool ? hover : { cx: e.clientX, cy: e.clientY };
      if (S.tool.kind === 'wall' && S.wallTool === 'chain' && !S.held) chainClick(h);
      else commit(h);
      if (touch) haptic(12);
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
    if (u.d > TILE * 1.5) {
      // Too far: walk over, then open its menu.
      const [w, h] = footprint(u.t, (u.level ? u.plot.l1 : u.plot).obj[u.key]?.r || 0);
      return walkTo((u.plot.x + u.lx + w / 2) * TILE, (u.plot.y + u.ly + h + 0.4) * TILE, () => { const v = nearestUsable(TILE * 1.6); if (v) { const p = view.toScreen(v.plot.x + v.lx + 0.5, 1, v.plot.y + v.ly + 0.5); openUseMenu(v, p.x, p.y - 10); } }, TILE * 1.2);
    }
    openUseMenu(u, cx, cy - 10);
    return;
  }
  // Tap your pet to pet it.
  const pet = pets.get(S.me.id);
  if (pet) {
    const pp = view.toScreen(U(pet.x), 0.4 + heightAt(world, S.plots, pet.x, pet.y, pet.level), U(pet.y));
    if (Math.hypot(pp.x - cx, pp.y - cy) < 28) {
      if (Math.hypot(pet.x - S.me.x, pet.y - S.me.y) < TILE * 3) { pet.heartUntil = performance.now() + 2200; pet.idle = 2; }
      else toast(`Walk closer to your ${PETS[petOf(S.me)].kind}`);
      return;
    }
  }
  // Tap an NPC to talk.
  for (const n of S.npcs.values()) {
    if (NPC_ACTS[n.act]?.hidden) continue;
    const p = view.toScreen(U(n.x), 0.8, U(n.y));
    if (Math.hypot(p.x - cx, p.y - cy) < 34) {
      if (Math.hypot(n.x - S.me.x, n.y - S.me.y) < TILE * 3.4) send({ type: 'npcOpen', npc: n.id });
      else walkTo(n.x, n.y, () => send({ type: 'npcOpen', npc: n.id }), TILE * 2.2);
      return;
    }
  }
  const p = view.pick(cx, cy, (S.me.level || 0) * LEVEL_H);
  if (!p) return;
  const def = S.myPlot != null ? myDef() : null;
  if (def) {
    const lx = Math.floor(p.x - def.x), ly = Math.floor(p.z - def.y);
    const hit = objAt(S.plots[S.myPlot], lx, ly);
    if (hit && ITEMS[hit.obj.t]?.crop && cropStage(hit.obj, serverNow()) === 3 && Math.hypot(p.x * TILE - S.me.x, p.z * TILE - S.me.y) < TILE * 3) {
      send({ type: 'harvest', plotId: S.myPlot, lx, ly });
      return;
    }
  }
  // Tap a tree or a rock (they stand tall, so look a little around the spot) to chop it.
  let best = null, bd = 2.2;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const tx = Math.floor(p.x) + dx, ty = Math.floor(p.z) + dy, kind = wildKind(world, tx, ty);
    if (!kind) continue;
    const sp = view.toScreen(tx + 0.5, kind === 'tree' ? 1.6 : 0.3, ty + 0.5);
    const d = Math.hypot(sp.x - cx, sp.y - cy) / 30;
    if (d < bd) { bd = d; best = { x: tx, y: ty, kind }; }
  }
  if (best) {
    const tool = TOOL_FOR[best.kind];
    if (!(S.inv[tool] > 0)) { toast(`You need ${best.kind === 'tree' ? 'an axe' : 'a pickaxe'} (Juniper sells them)`); return; }
    const cxp = (best.x + 0.5) * TILE, cyp = (best.y + 0.5) * TILE;
    if (Math.hypot(cxp - S.me.x, cyp - S.me.y) < TILE * 1.8) swing(best.x, best.y);
    else walkTo(cxp, cyp, () => swing(best.x, best.y), TILE * 1.4);
    return;
  }
  // Tap the ground to walk there.
  walkTo(p.x * TILE, p.z * TILE + 4, null, 3);
}

// ---------- tap to walk ----------
// A path over tiles on your floor (walls and furniture in the way, doors open), then
// straightened out. `near`: stop within this many px of the target.
function findWalk(fx, fy, tx, ty, level, near) {
  const sx = Math.floor(fx / TILE), sy = Math.floor(fy / TILE);
  const ok = (x, y) => canStand(world, S.plots, (x + 0.5) * TILE, (y + 0.5) * TILE + 4, level);
  const goal = (x, y) => Math.hypot((x + 0.5) * TILE - tx, (y + 0.5) * TILE - ty) <= Math.max(near, TILE * 0.75);
  const R = 40, k = (x, y) => `${x},${y}`;
  const from = new Map([[k(sx, sy), null]]);
  const queue = [[sx, sy]];
  let end = null;
  for (let i = 0; i < queue.length && i < 9000; i++) {
    const [x, y] = queue[i];
    if (goal(x, y)) { end = [x, y]; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (Math.abs(nx - sx) > R || Math.abs(ny - sy) > R || from.has(k(nx, ny)) || !ok(nx, ny)) continue;
      if (crossesWall(world, S.plots, (x + 0.5) * TILE, (y + 0.5) * TILE + 4, (nx + 0.5) * TILE, (ny + 0.5) * TILE + 4, level)) continue;
      from.set(k(nx, ny), [x, y]);
      queue.push([nx, ny]);
    }
  }
  if (!end) return null;
  const pts = [];
  for (let c = end; c; c = from.get(k(...c))) pts.push([(c[0] + 0.5) * TILE, (c[1] + 0.5) * TILE + 4]);
  pts.reverse();
  pts.shift(); // the tile you're on
  // Ending on open ground right where you tapped.
  if (near <= 4 && canStand(world, S.plots, tx, ty, level)) { if (pts.length) pts[pts.length - 1] = [tx, ty]; else pts.push([tx, ty]); }
  // Straighten: skip waypoints you can walk to in a straight line.
  const clear = (ax, ay, bx, by) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 4);
    let px = ax, py = ay;
    for (let i = 1; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
      if (!canStand(world, S.plots, x, y, level) || crossesWall(world, S.plots, px, py, x, y, level)) return false;
      px = x; py = y;
    }
    return true;
  };
  const out = [];
  let [ax, ay] = [fx, fy], i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clear(ax, ay, pts[j][0], pts[j][1])) j--;
    out.push(pts[j]);
    [ax, ay] = pts[j];
    i = j + 1;
  }
  return out;
}
function walkTo(x, y, then = null, near = 3) {
  const path = findWalk(S.me.x, S.me.y, x, y, S.me.level || 0, near);
  if (!path) { toast('Can’t get there from here'); return; }
  if (S.act) send({ type: 'stop' });
  S.walk = { path, then, dest: { x, y }, tiles: path.reduce((a, p, i) => a + Math.hypot(p[0] - (i ? path[i - 1][0] : S.me.x), p[1] - (i ? path[i - 1][1] : S.me.y)), 0) / TILE, lastX: S.me.x, lastY: S.me.y, still: 0 };
  if (!path.length) arrive();
}
function arrive() {
  const w = S.walk;
  S.walk = null;
  w?.then?.();
}
// Next step along the path: a unit direction in world px, or null (arrived / stuck).
function walkStep(dt) {
  const w = S.walk;
  while (w.path.length && Math.hypot(w.path[0][0] - S.me.x, w.path[0][1] - S.me.y) < 2.5) w.path.shift();
  if (!w.path.length) { arrive(); return null; }
  // Stuck behind something that moved in the way: give up.
  if (Math.hypot(S.me.x - w.lastX, S.me.y - w.lastY) < 0.3) { w.still += dt; if (w.still > 0.6) { S.walk = null; return null; } } else w.still = 0;
  w.lastX = S.me.x; w.lastY = S.me.y;
  const [tx, ty] = w.path[0];
  const d = Math.hypot(tx - S.me.x, ty - S.me.y);
  return [(tx - S.me.x) / d, (ty - S.me.y) / d];
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
    if (d > 6) { const k = Math.min(1, d / STICK_R) / d; x = dx * k; y = dy * k; }
    // Hold the stick out at the rim for a moment to break into a run.
    run = stick.edgeSince > 0 && performance.now() - stick.edgeSince > 350;
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
    if (f && f !== 'soil' && f !== 'soil_rich' && f !== 'floor_stone') return { ...base, cut: 'cut', maxLevel: 0, roofs: false };
  }
  return base;
}
function syncPlots(force) {
  const now = performance.now();
  if (!force && !plotsDirty && now - lastPlotSync < 1500) return;
  plotsDirty = false;
  lastPlotSync = now;
  const sNow = serverNow();
  // What you carry stays drawn where it is until you set it down (a ghost shows where
  // it's going), so nothing seems to vanish when you pick it up.
  if (S.dropped && now - S.droppedAt > 4000) S.dropped = null;
  // Nearest plots first, and at most two rebuilds a frame so building never freezes the
  // game (the rest catch up over the next frames).
  const plots = Object.values(S.plots).sort((a, b) => plotDist(a) - plotDist(b));
  let rebuilt = 0;
  for (let st of plots) {
    const variant = '';
    const crops = Object.values(st.obj).filter((o) => ITEMS[o.t]?.crop || ITEMS[o.t]?.tree).map((o) => (ITEMS[o.t].tree ? `t${treeStage(o, sNow)}` : cropStage(o, sNow) + (isWet(o, sNow) ? 'w' : ''))).join('');
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
  me.act = S.ride ? 'drive' : ui.fish.state ? 'fish' : S.act || 0;
  autoHarvest();
  tractorWork();
  checkViewKey();
  // Steering: the stick / keys, or a tap-to-walk path.
  let wdir = null;
  if (Math.hypot(v.x, v.y) > 0.1) { S.walk = null; const g = view.ground(); wdir = [g.rx * v.x - g.fx * v.y, g.rz * v.x - g.fz * v.y]; }
  else if (S.walk && S.mode === 'walk' && !S.act) wdir = walkStep(dt);
  me.moving = !!wdir;
  me.running = me.moving && (!!v.run || (!!S.walk && S.walk.tiles > 8));
  if (me.moving) ui.onMove();
  if (me.moving) view.offset.multiplyScalar(Math.max(0, 1 - dt * 3));
  if (view.quadrant !== lastQuadrant) { lastQuadrant = view.quadrant; plotsDirty = true; }
  if (me.moving) {
    const [wx, wz] = wdir;
    const tired = S.needs && (S.needs.energy < 8 || S.needs.health < 20) ? 0.7 : 1; // exhausted or unwell: slower
    const sp = PLAYER_SPEED * (S.ride ? RUN_MULT : me.running ? RUN_MULT : 1) * (S.ride ? 1 : tired) * dt;
    const nx = me.x + wx * sp, ny = me.y + wz * sp;
    // Each axis separately, so you slide along walls; stairs change your level.
    let l = stepLevel(world, S.plots, nx, me.y, me.level);
    if (l >= 0) { me.x = nx; me.level = l; }
    l = stepLevel(world, S.plots, me.x, ny, me.level);
    if (l >= 0) { me.y = ny; me.level = l; }
    me.dir = Math.abs(wx) > Math.abs(wz) ? (wx < 0 ? 2 : 3) : (wz < 0 ? 1 : 0);
    if (S.talk) { const n = S.npcs.get(S.talk.npc); const shop = n && plotIdAtPixel(world, n.x, n.y); if (n && Math.hypot(n.x - me.x, n.y - me.y) > TILE * 4 && !(shop >= 0 && S.plots[shop]?.town && plotIdAtPixel(world, me.x, me.y) === shop)) closeTalk(); }
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
  'shop:keeper': { icon: '🛒', label: 'Shop here' },
  'farm:drive': { icon: '🚜', label: 'Drive' },
  'store:open': { icon: '📦', label: 'Open' },
  'tree:pick': { icon: '🍎', label: 'Pick apples' },
  'tree:chop': { icon: '🪓', label: 'Chop down' },
  'animal:feed': { icon: '🌿', label: 'Feed (hay or wheat)' },
  'animal:pet': { icon: '❤️', label: 'Pet them' },
  'animal:collect': { icon: '🧺', label: 'Collect' },
  ...Object.fromEntries(Object.entries(ANIMALS).flatMap(([k, A]) => [
    [`animal:buy:${k}`, { icon: A.icon, label: `Buy a ${A.name.toLowerCase()} (🪙${A.price})` }],
    [`animal:sell:${k}`, { icon: '👋', label: `Sell a ${A.name.toLowerCase()} (🪙${Math.round(A.price / 2)})` }],
  ])),
};
const actInfo = (id) => ACTIVITIES[id] || SHOP_ACTS[id];
function actionsFor(plot, o) {
  const mine = plot.owner === S.me.id;
  const out = canUseOn(plot) ? usesNow(o.t).filter((id) => !ACTIVITIES[id].shop || (mine && plot.biz)) : [];
  if (slotsOf(o.t) || (plot.town && o.t === 'register')) { if (mine) out.push('shop:stock'); else if (plot.biz) out.push('shop:browse'); else if (plot.town) out.push('shop:keeper'); }
  if (isMachine(o.t) && mine) out.push(o.job ? (serverNow() >= o.job.ready ? 'shop:collect' : 'shop:wait') : 'shop:make');
  const role = roleOn(plot);
  if (o.t === 'tractor' && role && !S.ride) out.push('farm:drive');
  if (ITEMS[o.t]?.store && role === 'build') out.push('store:open');
  if (ITEMS[o.t]?.tree && role) { if (fruitReady(o, serverNow())) out.push('tree:pick'); if (S.inv.axe > 0) out.push('tree:chop'); }
  const home = ITEMS[o.t]?.animals;
  if (home && role) {
    const list = o.animals || [];
    if (o.goods?.length) out.push('animal:collect');
    if (list.length) out.push('animal:feed', 'animal:pet');
    if (list.length < ITEMS[o.t].cap) for (const k of home) out.push(`animal:buy:${k}`);
    for (const k of home) if (list.some((a) => a.k === k)) out.push(`animal:sell:${k}`);
  }
  return out;
}

// You can use things at home, or in someone's home while they're in.
function canUseOn(plot) {
  if (!plot?.owner) return false;
  if (plot.owner === S.me.id || plot.town || roleOn(plot)) return true;
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
  if (!plot || !(canUseOn(plot) || plot.biz || plot.town)) return null;
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
  if (act === 'shop:keeper') {
    // A village shop: talk to the keeper (they need to be in).
    const n = S.npcs.get(u.plot.keeper);
    if (!n || NPC_ACTS[n.act]?.hidden || plotIdAtPixel(world, n.x, n.y) !== u.plot.id) return toast(`${NPCS[u.plot.keeper].name} isn’t at the counter right now`);
    return send({ type: 'npcOpen', npc: n.id });
  }
  if (act === 'farm:drive') return send({ type: 'drive', plotId: u.plot.id, lx: u.lx, ly: u.ly });
  if (act === 'store:open') return ui.showStore(u);
  if (act.startsWith('tree:')) { haptic(10); return send({ type: 'tree', plotId: u.plot.id, lx: u.lx, ly: u.ly, act: act.slice(5) }); }
  if (act.startsWith('animal:')) {
    const [, what, kind] = act.split(':');
    return send({ type: 'animal', plotId: u.plot.id, lx: u.lx, ly: u.ly, act: what, kind });
  }
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
    if (id === 'animal:collect') label = `Collect ${o.goods.map(([it]) => GOODS[it].icon).join('')}`;
    if (id === 'animal:feed') { const hungry = (o.animals || []).filter((x) => x.fed !== worldClock(serverNow(), S.epoch).day).length; label = hungry ? `Feed ${hungry} hungry (hay or wheat)` : 'Everyone’s fed today'; }
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

// Walk into a ripe crop on your plot and you pick the whole row it's in: the unbroken
// line of ripe crops along the way you're walking (sideways = the row, up/down = the
// column).
const harvestSent = new Map();
function autoHarvest() {
  if (S.mode !== 'walk' || S.act || S.ride || (S.me.level || 0)) return;
  const id = plotIdAtPixel(world, S.me.x, S.me.y);
  const plot = id >= 0 ? S.plots[id] : null;
  if (!roleOn(plot)) return;
  const fx = S.me.x / TILE - plot.x, fy = S.me.y / TILE - plot.y - 0.3;
  const now = performance.now(), sNow = serverNow();
  // With a watering can, dry crops count too: the row gets watered as you go.
  const can = S.inv.wateringcan > 0 || S.inv.bigcan > 0;
  const ripe = (x, y) => { const o = plot.obj[key(x, y)]; return !!o && !!ITEMS[o.t]?.crop && (cropStage(o, sNow) >= 3 || (can && !isWet(o, sNow + DAY_MS * 0.3))) && now - (harvestSent.get(`${id}:${x},${y}`) || 0) > 1500; };
  // The tile under your feet and any you brush past.
  for (const [dx, dy] of [[0, 0], [-0.35, 0], [0.35, 0], [0, -0.35], [0, 0.35]]) {
    const lx = Math.floor(fx + dx), ly = Math.floor(fy + dy);
    if (!ripe(lx, ly)) continue;
    const [sx, sy] = S.me.dir === 2 || S.me.dir === 3 ? [1, 0] : [0, 1];
    const tiles = [[lx, ly]];
    for (const sgn of [-1, 1]) for (let n = 1; n < 32 && ripe(lx + sx * n * sgn, ly + sy * n * sgn); n++) tiles.push([lx + sx * n * sgn, ly + sy * n * sgn]);
    // The scythe sweeps the rows either side too; the big can waters three rows.
    if (S.inv.scythe > 0 || S.inv.bigcan > 0) {
      for (const [x, y] of [...tiles]) for (const o of [-1, 1]) { const tx = x + sy * o, ty = y + sx * o; if (ripe(tx, ty) && tiles.length < 64) tiles.push([tx, ty]); }
    }
    for (const [x, y] of tiles) harvestSent.set(`${id}:${x},${y}`, now);
    send({ type: 'harvest', plotId: id, tiles });
    return;
  }
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
    const indoor = (x, y) => { const f = plot.floor[key(x, y)]; return f && f !== 'soil' && f !== 'soil_rich' && f !== 'floor_stone'; };
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
    if (p.act === 'drive') {
      // On the tractor: the driver sits on the seat, a little behind the middle.
      const yaw = view.vehicle(`ride:${p.id}`, 'tractor', U(p.x), h, U(p.y), p.dir);
      const bx = Math.sin(yaw) * 0.35, bz = Math.cos(yaw) * 0.35;
      view.actor(p.id, U(p.x) + bx, U(p.y) + bz, p.dir, false, p.look, now, true, h + 0.62, null, { kind: 'sit' });
      return;
    }
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
  drawFarmhands(now);
  drawAnimals(now);
  for (const [id, p] of pets) {
    const owner = id === S.me.id ? S.me : S.players.get(id);
    if (!owner) continue;
    const pose = p.sleeping ? 'sleep' : !p.moving && (p.idle > 1.2 || p.heartUntil > now) ? 'sit' : false;
    view.actor(`pet:${id}`, U(p.x), U(p.y), p.dir, p.moving, null, now, true, heightAt(world, S.plots, p.x, p.y, p.level), { idx: petOf(owner), sit: pose });
  }
  view.pruneActors();
  updateOutline();
  updateMap(now);
  const hour = S.debugHour ?? (S.mode === 'build' && S.previewHour != null ? S.previewHour : worldClock(sNow, S.epoch).hours);
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
    if (st.town) {
      // Village shops: their name over the door.
      const p = view.toScreen(st.x + st.w / 2, 3.2, st.y + st.h);
      if (onScreen(p)) tag(`🏪 ${st.name}`, p.x, p.y, 12, '#ffe9b0');
      continue;
    }
    if (!st.owner || st.biz) continue;
    const p = view.toScreen(st.x + st.w / 2, 0.9, st.y + 0.5);
    if (onScreen(p)) tag(`🏡 ${st.farm ? st.farm + ' Farm' : st.ownerName}`, p.x, p.y, 11, st.owner === S.me.id ? '#ffe08a' : '#fff');
  }
  drawFarmOverlay(onScreen, now);
  drawTouchMarks(now);
  if (S.mode === 'build') { placeObjPop(); syncTimeIcon(); } else if (!$('objpop').hidden) $('objpop').hidden = true;
  drawChips(now);
  for (const plot of Object.values(S.plots)) {
    if (Math.abs(plot.x + plot.w / 2 - U(S.me.x)) > 30 || Math.abs(plot.y + plot.h / 2 - U(S.me.y)) > 30) continue;
    for (const [k, o] of Object.entries(plot.obj)) {
      if (!ITEMS[o.t]?.tree || !fruitReady(o, serverNow())) continue;
      const [x, y] = k.split(',').map(Number);
      const p = view.toScreen(plot.x + x + 0.5, 2.2, plot.y + y + 0.5);
      octx.font = '14px sans-serif'; octx.fillText('🍎', p.x, p.y);
    }
  }
  {
    const { day, hours } = worldClock(serverNow(), S.epoch);
    const wx = S.weather ?? weatherAt(day, hours);
    view.overcast = wx === 'storm' ? 1 : wx ? 0.6 : 0;
    updateAudio(now, wx, day);
    weather.draw(octx, innerWidth, innerHeight, now, Math.min(0.05, (now - (lastWeather || now)) / 1000), { kind: wx, season: seasonOf(day).id, dark: darkness(serverNow(), S.epoch) });
    lastWeather = now;
  }
  ui.drawFishing(octx, view, now, [S.me, ...S.players.values()]);
  octx.textAlign = 'center';
  // Goods on shelves (with price tags up close), machines at work, coins from sales.
  const cam = view.target;
  octx.textAlign = 'center';
  for (const plot of Object.values(S.plots)) {
    if (Math.abs(plot.x + plot.w / 2 - cam.x) > 30 || Math.abs(plot.y + plot.h / 2 - cam.z) > 30) continue;
    // A village shop's goods show once you're inside.
    if (plot.town && plotIdAtPixel(world, S.me.x, S.me.y) !== plot.id) continue;
    for (const [lvl, v] of [[0, plot], [1, plot.l1]]) {
      if (!v || (lvl && !(S.mode === 'build' ? S.level : S.me.level))) continue;
      for (const [k, o] of Object.entries(v.obj)) {
        const [lx, ly] = k.split(',').map(Number);
        const [w, h] = footprint(o.t, o.r || 0);
        // The goods themselves sit in the display (see gfx/goods.js); up close, each
        // slot gets a little price tag on its front edge.
        if (o.stock?.length && !plot.town && Math.hypot(plot.x + lx + w / 2 - S.me.x / TILE, plot.y + ly + h / 2 - S.me.y / TILE) < 3.2) {
          const [w0, h0] = footprint(o.t, 0), a = (-(o.r || 0) * Math.PI) / 2, c = Math.cos(a), sn = Math.sin(a);
          const fronts = slotFronts(o.t);
          o.stock.forEach((sl, i) => {
            const f = fronts[i];
            if (!f) return;
            const ux = f[0] - w0 / 2, uz = f[2] - h0 / 2;
            const p = view.toScreen(plot.x + lx + w / 2 + c * ux + sn * uz, lvl * LEVEL_H + f[1] + 0.02, plot.y + ly + h / 2 - sn * ux + c * uz);
            if (onScreen(p)) priceTag(`🪙${sl.price}`, p.x, p.y + 6);
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
    const running = S.me.running;
    octx.globalAlpha = 0.3;
    octx.fillStyle = '#fff';
    octx.beginPath(); octx.arc(stick.sx, stick.sy, STICK_R, 0, Math.PI * 2); octx.fill();
    octx.globalAlpha = 0.8;
    octx.lineWidth = 3; octx.strokeStyle = running ? '#ffb347' : 'rgba(255,255,255,.9)';
    octx.beginPath(); octx.arc(stick.sx, stick.sy, STICK_R, 0, Math.PI * 2); octx.stroke();
    const dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, STICK_R / d);
    octx.globalAlpha = 0.85;
    octx.fillStyle = running ? '#ffb347' : '#fff';
    octx.beginPath(); octx.arc(stick.sx + dx * k, stick.sy + dy * k, 20, 0, Math.PI * 2); octx.fill();
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

// A paper price tag clipped to a shelf edge.
function priceTag(text, x, y) {
  octx.font = `bold 9px ui-rounded, 'Trebuchet MS', sans-serif`;
  const w = octx.measureText(text).width + 6;
  octx.fillStyle = '#fff8e6';
  roundRect(x - w / 2, y - 6, w, 12, 2);
  octx.fillStyle = '#c0392b';
  octx.fillRect(x - w / 2, y - 6, 2, 12);
  octx.fillStyle = '#3a2a1a';
  octx.textBaseline = 'middle';
  octx.fillText(text, x + 1, y + 0.5);
  octx.textBaseline = 'bottom';
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
    setLevel, cycleWalls, turnCamera, setMode, send, nearestUsable, usableAt, showCity: () => showCity(), showBag: () => showBag(), audio: () => audio, season: (id) => { S.seasonOverride = id; },
  };
}

// ---------- Farm: tractor, farmhands, drops, water & power ----------
// The tractor bar: what the tractor does as you drive, and getting off.
function renderRideBar() {
  const el = $('ridebar');
  if (!el) return;
  el.hidden = !S.ride;
  if (!S.ride) { el.innerHTML = ''; return; }
  el.innerHTML = '<b>🚜</b>';
  for (const [k, m] of Object.entries(TRACTOR_MODES)) {
    const b = document.createElement('button');
    b.className = `chip${S.ride.mode === k ? ' sel' : ''}`;
    b.innerHTML = `${m.icon} ${m.label}`;
    b.onclick = () => send({ type: 'rideMode', mode: k });
    el.appendChild(b);
  }
  if (S.ride.mode === 'plant') {
    const sel = document.createElement('select');
    const today = worldClock(serverNow(), S.epoch).day;
    for (const id of SEEDS.filter((x) => inSeason(ITEMS[x].crop, today))) sel.add(new Option(`${GOODS[ITEMS[id].crop]?.icon || '🌱'} ${ITEMS[id].name} · 🪙${ITEMS[id].price}`, id, false, id === S.ride.seed));
    sel.onchange = () => send({ type: 'rideMode', seed: sel.value });
    el.appendChild(sel);
  }
  const off = document.createElement('button');
  off.className = 'chip';
  off.textContent = '🅿️ Park';
  off.onclick = () => send({ type: 'park' });
  el.appendChild(off);
}

// Driving over your plot: work a 3-wide strip across the way you're going.
const workSent = new Map();
let workAt = 0;
function tractorWork() {
  if (!S.ride || S.mode !== 'walk' || !S.me.moving || (S.me.level || 0)) return;
  const now = performance.now();
  if (now - workAt < 120) return;
  const id = plotIdAtPixel(world, S.me.x, S.me.y);
  const plot = id >= 0 ? S.plots[id] : null;
  if (!roleOn(plot)) return;
  workAt = now;
  const sNow = serverNow(), mode = S.ride.mode;
  const cx = Math.floor(S.me.x / TILE) - plot.x, cy = Math.floor(S.me.y / TILE) - plot.y;
  const [sx, sy] = S.me.dir === 2 || S.me.dir === 3 ? [0, 1] : [1, 0];
  const wants = (x, y) => {
    if (!inInterior(plot, x, y) || roadIn(world, plot, x, y)) return false;
    const k = key(x, y), o = plot.obj[k], crop = o && ITEMS[o.t]?.crop;
    if (mode === 'harvest') return !!crop && cropStage(o, sNow) >= 3;
    if (mode === 'water') return !!crop && cropStage(o, sNow) < 3 && !isWet(o, sNow + DAY_MS * 0.3) && !!plot.util?.water;
    if (mode === 'plant') return !o && (plot.floor[k] === 'soil' || plot.floor[k] === 'soil_rich') && !objAt(plot, x, y);
    return !o && !plot.floor[k] && !objAt(plot, x, y);
  };
  const tiles = [];
  for (let i = -1; i <= 1; i++) {
    const x = cx + sx * i, y = cy + sy * i;
    if (wants(x, y) && now - (workSent.get(`${id}:${x},${y}`) || 0) > 1500) { tiles.push([x, y]); workSent.set(`${id}:${x},${y}`, now); }
  }
  if (tiles.length) send({ type: 'farmWork', plotId: id, tiles });
}

// Farmhands stroll from crop to crop on their owner's farm (6 AM – 9 PM).
function drawFarmhands(now) {
  const { hours } = worldClock(serverNow(), S.epoch);
  if (hours < 6 || hours >= 21) return;
  for (const plot of Object.values(S.plots)) {
    const h = plot.hand && FARMHANDS[plot.hand];
    if (!h) continue;
    if (Math.abs(plot.x + plot.w / 2 - U(S.me.x)) > 50 || Math.abs(plot.y + plot.h / 2 - U(S.me.y)) > 50) continue;
    const crops = Object.keys(plot.obj).filter((k) => ITEMS[plot.obj[k].t]?.crop).sort();
    const spot = (i) => {
      if (!crops.length) return [plot.w / 2 + Math.sin(i) * 2, plot.h / 2 + Math.cos(i * 1.3) * 2];
      const [x, y] = crops[((i % crops.length) + crops.length) % crops.length].split(',').map(Number);
      return [x + 0.5, y + 1.05];
    };
    const T = 5000, t = now / T + plot.id * 0.37, i = Math.floor(t), f = t - i;
    const a = spot(i * 7), b = spot((i + 1) * 7);
    const walk = Math.min(1, f / 0.45); // walk for a bit, then tend the crop
    const x = a[0] + (b[0] - a[0]) * walk, y = a[1] + (b[1] - a[1]) * walk;
    view.actor(`hand:${plot.id}`, plot.x + x, plot.y + y, 0, walk < 1, h.look, now);
  }
}

// Things on the ground, and (in build mode) what's on the water / power network.
function drawFarmOverlay(onScreen, now) {
  octx.textAlign = 'center';
  for (const d of S.drops.values()) {
    if (Math.abs(U(d.x) - U(S.me.x)) > 30 || Math.abs(U(d.y) - U(S.me.y)) > 30) continue;
    const h = heightAt(world, S.plots, d.x, d.y, d.level || 0);
    const p = view.toScreen(U(d.x), h + 0.25 + Math.sin(now / 300 + d.id) * 0.06, U(d.y));
    if (!onScreen(p)) continue;
    octx.font = '16px sans-serif';
    octx.fillText(GOODS[d.item]?.icon || '📦', p.x, p.y);
    if (d.n > 1) { octx.font = 'bold 9px sans-serif'; octx.fillStyle = '#fff'; octx.fillText(`×${d.n}`, p.x + 10, p.y + 2); octx.fillStyle = '#000'; }
  }
  const plot = S.mode === 'build' ? S.plots[S.myPlot] : null;
  if (!plot || S.level) return;
  octx.font = '12px sans-serif';
  for (const [k, o] of Object.entries(plot.obj)) {
    const d = ITEMS[o.t];
    if (!d?.needs) continue;
    const [lx, ly] = k.split(',').map(Number);
    const [w, h] = footprint(o.t, o.r || 0);
    const p = view.toScreen(plot.x + lx + w / 2, 1.2, plot.y + ly + h / 2);
    if (!onScreen(p)) continue;
    const ok = connected(plot, k, d.needs);
    octx.fillText(ok ? UTILITIES[d.needs].icon : '⚠️', p.x, p.y);
  }
}

// Farm animals wander around in front of their coop or barn (cosmetic, run locally:
// each one strolls between spots near home and rests now and then). At night they're
// tucked in.
const animalSpots = new WeakMap();
function drawAnimals(now) {
  const { hours, day } = worldClock(serverNow(), S.epoch);
  if (hours < 6 || hours >= 20) return;
  for (const plot of Object.values(S.plots)) {
    if (Math.abs(plot.x + plot.w / 2 - U(S.me.x)) > 50 || Math.abs(plot.y + plot.h / 2 - U(S.me.y)) > 50) continue;
    for (const [k, o] of Object.entries(plot.obj)) {
      if (!o.animals?.length) continue;
      const [ax, ay] = k.split(',').map(Number);
      const [w, h] = footprint(o.t, o.r || 0);
      // Free tiles in front of the building (up to 3 out), cached per plot revision.
      let spots = animalSpots.get(o);
      if (!spots || spots.rev !== plot.rev) {
        const list = [];
        const [fx, fy] = [[0, 1], [-1, 0], [0, -1], [1, 0]][o.r || 0];
        for (let y = ay - 3; y < ay + h + 3; y++) for (let x = ax - 3; x < ax + w + 3; x++) {
          const ahead = fx > 0 ? x - (ax + w - 1) : fx < 0 ? ax - x : fy > 0 ? y - (ay + h - 1) : ay - y;
          const side = fx ? y >= ay - 1 && y <= ay + h : x >= ax - 1 && x <= ax + w;
          if (ahead < 1 || !side) continue;
          if (!inInterior(plot, x, y) || objAt(plot, x, y) || roadIn(world, plot, x, y)) continue;
          const f = plot.floor[key(x, y)];
          if (f && f !== 'soil' && f !== 'soil_rich' && f !== 'floor_stone') continue;
          list.push([x, y]);
        }
        spots = { rev: plot.rev, list };
        animalSpots.set(o, spots);
      }
      if (!spots.list.length) continue;
      o.animals.forEach((a, i) => {
        const seed = (a.n.length * 31 + i * 17 + plot.id * 7) % 97;
        const T = 6000 + seed * 40, t = now / T + seed / 10, n = Math.floor(t), f = t - n;
        const at = (m) => spots.list[(m * 13 + seed) % spots.list.length];
        const p = at(n), q = at(n + 1);
        const walk = Math.min(1, f / 0.4);
        const x = p[0] + 0.5 + (q[0] - p[0]) * walk, y = p[1] + 0.6 + (q[1] - p[1]) * walk;
        const rest = walk >= 1 && (seed + n) % 3 === 0;
        view.actor(`animal:${plot.id}:${k}:${i}`, plot.x + x, plot.y + y, 0, walk < 1, null, now, true, 0, { animal: a.k, sit: rest });
      });
    }
  }
}

ui = socialUI({ S, send, openModal, closeModal, modal: () => modalKind, toast, esc, itemRow, world, badges });

// ---------- touch: staged placement, long press, haptics ----------
const TOUCH_LIFT = 56; // CSS px the preview sits above your finger
let staged = null, longPress = null, nudge = null;
// Staged things that slide with a drag (rather than being drawn out like a wall or floor).
const slidable = () => !!S.held || ['obj', 'feature', 'blueprint', 'movehouse'].includes(S.tool.kind);
function haptic(ms = 10) { try { navigator.vibrate?.(ms); } catch { /* not supported */ } }
const toolKey = () => `${S.mode}|${S.tool.kind}|${S.tool.id || ''}|${S.held ? S.held.kind : ''}|${S.level}|${S.wallTool}`;
// Tools whose touch placement waits for ✓ (anything that builds, moves or destroys).
function stageable() {
  if (S.held) return true;
  const k = S.tool.kind;
  if (k === 'wall') return S.wallTool !== 'chain' && S.wallTool !== 'paint';
  return ['obj', 'floor', 'roof', 'remove', 'feature', 'pave', 'dig', 'blueprint', 'movehouse', 'resize', 'merge', 'split'].includes(k);
}
function showStage() {
  const bar = $('stagebar');
  bar.hidden = false;
  const cat = $('catalog');
  bar.style.bottom = `${($('tray').hidden ? 0 : innerHeight - cat.getBoundingClientRect().top) + 64}px`;
  $('stage-rot').hidden = !(S.held ? S.held.kind !== 'obj' || canRotate(S.held.t) : S.tool.kind === 'obj' ? canRotate(S.tool.id) : ['blueprint', 'movehouse'].includes(S.tool.kind));
  haptic(8);
}
function dropStage() { staged = null; $('stagebar').hidden = true; }
// Phones: a freshly picked item appears in the middle of the view, ready to slide.
function stageAtCentre() {
  const top = 110, bottom = $('catalog').getBoundingClientRect().top - 60;
  hover = { cx: innerWidth / 2, cy: (top + bottom) / 2, touch: true };
  const wp = view.pick(hover.cx, hover.cy, S.level * LEVEL_H);
  staged = { w: wp && { x: wp.x, z: wp.z }, h: { ...hover }, drag: null, key: toolKey() };
  showStage(); refreshPreview(); toolInfo();
}
// The staged spot on screen now (it's anchored in the world, so panning and zooming
// while you decide don't move it).
function stagedH() {
  if (!staged.w) return staged.h;
  const p = view.toScreen(staged.w.x, S.level * LEVEL_H, staged.w.z);
  return { ...staged.h, cx: p.x, cy: p.y, fx: null, fy: null };
}
function restoreStage() { hover = stagedH(); drag = staged.drag; refreshPreview(); }
function confirmStage() {
  if (!staged) return;
  const st = staged, h = stagedH();
  dropStage();
  drag = st.drag;
  hover = h;
  commit(h);
  drag = null; hover = null;
  haptic(18);
  audio.sfx('place');
  refreshPreview(); toolInfo();
}
function cancelStage() { dropStage(); drag = null; hover = null; refreshPreview(); toolInfo(); }
$('stage-ok').onclick = confirmStage;
$('stage-no').onclick = cancelStage;
$('stage-rot').onclick = () => { rotateItem(); if (staged) restoreStage(); haptic(6); };
// A long press (without moving) picks up the furniture under your finger.
function startLongPress(e) {
  cancelLongPress();
  if (S.held || S.tool.kind === 'remove') return;
  const x = e.clientX, y = e.clientY;
  longPress = { x, y, timer: setTimeout(() => {
    longPress = null;
    if (pointers.size !== 1 || S.held || S.mode !== 'build') return;
    selectAt({ cx: x, cy: y });
    if (S.sel && S.sel.kind !== 'wall') { drag = null; pickUpSel(); if (S.held) { haptic(25); audio.sfx('pickup'); } }
  }, 480) };
}
function cancelLongPress() { if (longPress) { clearTimeout(longPress.timer); longPress = null; } }
// Switching tools, floors or modes drops a staged placement.
setInterval(() => { if (staged && staged.key !== toolKey()) cancelStage(); }, 250);

// Where your finger points while building (the lifted target), and where you're walking to.
function drawTouchMarks(now) {
  if (S.mode === 'build' && hover?.touch && (pointers.size === 1 || staged)) {
    const h = staged ? stagedH() : hover;
    octx.strokeStyle = 'rgba(255,255,255,.9)'; octx.lineWidth = 2;
    octx.beginPath(); octx.arc(h.cx, h.cy, 7, 0, Math.PI * 2); octx.stroke();
    if (!staged && h.fy) { octx.setLineDash([3, 4]); octx.beginPath(); octx.moveTo(h.fx, h.fy - 18); octx.lineTo(h.cx, h.cy + 8); octx.stroke(); octx.setLineDash([]); }
  }
  if (S.walk?.dest && S.mode === 'walk') {
    const d = S.walk.dest, p = view.toScreen(d.x / TILE, (S.me.level || 0) * LEVEL_H + 0.02, d.y / TILE);
    const r = 9 + Math.sin(now / 160) * 2;
    octx.strokeStyle = 'rgba(255,230,120,.95)'; octx.lineWidth = 2.5;
    octx.beginPath(); octx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, Math.PI * 2); octx.stroke();
  }
}

// The build tray folds down to show more of your plot.


// ---------- trees and rocks ----------
const audio = createAudio({ store });
const weather = makeWeather({ onFlash: () => audio.thunder() });
// Sound can only start after the player touches the page.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => audio.start(), { passive: true });
// What the soundscape should be right now (called every frame; cheap).
let audioAt = 0;
function updateAudio(now, wx, day) {
  if (now - audioAt < 300 || !S.me) return;
  audioAt = now;
  const here = plotIdAtPixel(world, S.me.x, S.me.y), plot = here >= 0 ? S.plots[here] : null;
  let indoor = false;
  if (plot) {
    const lx = Math.floor(S.me.x / TILE) - plot.x, ly = Math.floor(S.me.y / TILE) - plot.y;
    indoor = roofAt(plot, lx, ly, S.me.level || 0) >= 0 || (S.me.level || 0) > 0;
  }
  // How close the nearest water is (pond, lake, the fountain).
  let water = 0;
  const tx = Math.floor(S.me.x / TILE), ty = Math.floor(S.me.y / TILE);
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const t = world.tiles[(ty + dy) * MAP_W + tx + dx];
    if (t === T.WATER || t === T.FOUNTAIN) water = Math.max(water, 1 - Math.hypot(dx, dy) / 6);
  }
  audio.update({ season: S.seasonOverride || seasonOf(day).id, night: darkness(serverNow(), S.epoch) > 0.35, weather: wx, indoor, water });
}
let lastWeather = 0;
// A wild tree or rock right next to you (in front of you first), if you have the tool.
function wildNear() {
  if (!S.me || S.mode !== 'walk' || S.act || S.ride || (S.me.level || 0)) return null;
  const mx = Math.floor(S.me.x / TILE), my = Math.floor((S.me.y - 4) / TILE);
  const [fx, fy] = [[0, 1], [0, -1], [-1, 0], [1, 0]][S.me.dir || 0];
  const cand = [[mx + fx, my + fy], [mx, my - 1], [mx - 1, my], [mx + 1, my], [mx, my + 1], [mx + fx, my + fy - 1]];
  for (const [x, y] of cand) {
    const kind = wildKind(world, x, y);
    if (kind && S.inv[TOOL_FOR[kind]] > 0 && Math.hypot((x + 0.5) * TILE - S.me.x, (y + 0.5) * TILE - S.me.y) < TILE * 1.8) return { x, y, kind };
  }
  return null;
}
function swing(x, y) {
  const now = performance.now();
  if (now - (S.lastSwing || 0) < 300) return;
  S.lastSwing = now;
  S.me.dir = Math.abs(x + 0.5 - S.me.x / TILE) > Math.abs(y + 0.5 - S.me.y / TILE) ? (x + 0.5 < S.me.x / TILE ? 2 : 3) : (y + 0.5 < S.me.y / TILE ? 1 : 0);
  send({ type: 'chop', tx: x, ty: y });
}
// Wood chips and stone shards flying off.
const chipFx = [];
function chips(x, y, kind, n) {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) chipFx.push({ x: x + 0.5, y: y + 0.5, h: kind === 'tree' ? 0.6 + Math.random() * 0.8 : 0.25, vx: (Math.random() - 0.5) * 2.4, vz: (Math.random() - 0.5) * 2.4, vy: 1.5 + Math.random() * 2, t0, c: kind === 'tree' ? ['#c99363', '#8a5a32', '#58a842'][i % 3] : ['#9a9384', '#d3cdbf', '#7d776b'][i % 3] });
  if (kind === 'tree' && n > 8) for (let i = 0; i < 14; i++) chipFx.push({ x: x + 0.5, y: y + 0.5, h: 1.6 + Math.random(), vx: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3, vy: Math.random(), t0, c: ['#3f8a35', '#58a842', '#2d6a2c'][i % 3] });
}
function drawChips(now) {
  for (let i = chipFx.length - 1; i >= 0; i--) {
    const f = chipFx[i], t = (now - f.t0) / 1000;
    if (t > 0.9) { chipFx.splice(i, 1); continue; }
    const p = view.toScreen(f.x + f.vx * t, Math.max(0, f.h + f.vy * t - 4.5 * t * t), f.y + f.vz * t);
    octx.fillStyle = f.c;
    octx.fillRect(p.x - 2, p.y - 2, 4, 3);
  }
}

// Walking in or out of a building (or up the stairs) changes how it's cut away: rebuild
// it this frame, not at the next routine refresh.
function checkViewKey() {
  if (!S.me) return;
  const here = plotIdAtPixel(world, S.me.x, S.me.y);
  const o = here >= 0 ? plotOpts(here) : null;
  const vk = o ? `${here}|${o.cut}|${o.maxLevel}|${o.roofs}` : '';
  if (vk !== lastViewKey) { lastViewKey = vk; plotsDirty = true; syncPlots(true); }
}
