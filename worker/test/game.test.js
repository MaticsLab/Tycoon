import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generateWorld, TILE, T, MAP_W, STARTER_PLOTS, WORLD_VERSION } from '../../shared/world.js';
import { canStand, objAt, rectEdges, edgeKey, levelView, landError, LAND_PRICE, heightAt, LEVEL_H, plotEntrance } from '../../shared/plot.js';
import { START_COINS, ITEMS } from '../../shared/catalog.js';
import { NPCS } from '../../shared/npcs.js';
import { DEFAULT_LOOK } from '../../shared/look.js';

function setup(opts = {}) {
  let clock = 1_000_000;
  const game = new Game(opts.saved || {}, { now: () => clock, ai: opts.ai || null });
  let n = 0;
  // `user` stands in for the Better Auth user the Worker verified.
  const join = async (hello = {}, user = { userId: `user${++n}`, name: hello.name }) => {
    const inbox = [];
    const conn = { sendRaw: (d) => inbox.push(JSON.parse(d)), close() {} };
    const h = game.attach(conn, user);
    await h.onMessage(JSON.stringify({ type: 'hello', ...hello }));
    const send = (m) => h.onMessage(JSON.stringify(m));
    const last = (type) => inbox.filter((m) => m.type === type).at(-1);
    const welcome = inbox.find((m) => m.type === 'welcome');
    return { inbox, send, last, h, welcome, session: () => game.sessions.get(welcome.you.id) };
  };
  return { game, join, advance: (ms) => { clock += ms; } };
}

// Put a player right next to an NPC so they can talk.
function standBy(game, a, npc) {
  const s = a.session();
  const n = game.npcs[npc];
  s.x = n.x; s.y = n.y + 12;
}

test('a new world has 16 roadside plots, two shops and a walkable spawn', () => {
  const game = new Game({});
  const w = game.world;
  assert.equal(Object.keys(game.plots).length, STARTER_PLOTS.length);
  assert.equal(w.shops.length, 2);
  assert.ok(canStand(w, game.plots, w.spawn.x, w.spawn.y));
  for (const n of Object.values(NPCS)) assert.ok(canStand(w, game.plots, n.home.x, n.home.y), n.name);
  // Every plot is valid land that touches a road, and its entrance is walkable.
  for (const p of Object.values(game.plots)) {
    assert.equal(landError(game.plots, p.id, p, w), null, `plot ${p.id}`);
    const e = plotEntrance(w, p);
    assert.ok(canStand(w, game.plots, e.x, e.y), `entrance of plot ${p.id}`);
  }
});

test('guests can claim a plot, build and get refunds', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  assert.equal(a.welcome.you.coins, START_COINS);
  a.send({ type: 'claim', plotId: 3 });
  assert.equal(a.last('claimed').plotId, 3);
  a.send({ type: 'place', plotId: 3, lx: 2, ly: 2, item: 'lamp' });
  assert.equal(game.plots[3].obj['2,2'].t, 'lamp');
  a.send({ type: 'place', plotId: 3, lx: -1, ly: 0, item: 'lamp' });
  assert.equal(game.plots[3].obj['-1,0'], undefined);
  a.send({ type: 'remove', plotId: 3, lx: 2, ly: 2 });
  assert.equal(a.last('coins').coins, START_COINS);
});

test('multi-tile items occupy their footprint and rotate', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 2 });
  a.send({ type: 'place', plotId: 2, lx: 3, ly: 3, item: 'sofa' }); // 2x1
  const plot = game.plots[2];
  assert.equal(objAt(plot, 4, 3).key, '3,3');
  // Overlapping placement is refused.
  a.send({ type: 'place', plotId: 2, lx: 4, ly: 3, item: 'chair' });
  assert.equal(objAt(plot, 4, 3).obj.t, 'sofa');
  // Rotated bed (1x2 -> 2x1) at the right edge would stick out of the plot.
  a.send({ type: 'place', plotId: 2, lx: 23, ly: 5, item: 'bed', r: 1 });
  assert.equal(objAt(plot, 23, 5), null);
  a.send({ type: 'place', plotId: 2, lx: 6, ly: 6, item: 'bed', r: 1 });
  assert.equal(objAt(plot, 7, 6).obj.r, 1);
  assert.equal(objAt(plot, 6, 7), null);
  // Lamps can't rotate.
  a.send({ type: 'place', plotId: 2, lx: 9, ly: 9, item: 'lamp', r: 1 });
  assert.equal(objAt(plot, 9, 9), null);
  // Removing from any tile of the footprint removes the whole item.
  a.send({ type: 'remove', plotId: 2, lx: 4, ly: 3 });
  assert.equal(objAt(plot, 3, 3), null);
});

test("cannot claim twice or build on someone else's plot", async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  const b = await join({ name: 'Ben' });
  a.send({ type: 'claim', plotId: 0 });
  a.send({ type: 'claim', plotId: 1 });
  assert.equal(game.plots[1].owner, null);
  b.send({ type: 'claim', plotId: 0 });
  b.send({ type: 'place', plotId: 0, lx: 3, ly: 3, item: 'bed' });
  assert.equal(game.plots[0].obj['3,3'], undefined);
});

test('crops go to the bag and sell at Rosa’s for coins', async () => {
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 5 });
  a.send({ type: 'place', plotId: 5, lx: 4, ly: 4, item: 'seed_turnip' });
  assert.match(a.last('error').msg, /soil/);
  a.send({ type: 'place', plotId: 5, lx: 4, ly: 4, item: 'soil' });
  a.send({ type: 'place', plotId: 5, lx: 4, ly: 4, item: 'seed_turnip' });
  advance(60_000);
  a.send({ type: 'harvest', plotId: 5 });
  assert.equal(a.last('inv').inv.turnip, 1);
  const coins = a.last('coins').coins;
  standBy(game, a, 'rosa');
  a.send({ type: 'sell', npc: 'rosa', item: 'turnip', qty: 5 });
  assert.equal(a.last('inv').inv.turnip, undefined);
  assert.ok(a.last('coins').coins > coins);
});

test('shop furniture is bought into the bag and placed from it', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 6 });
  a.send({ type: 'place', plotId: 6, lx: 3, ly: 3, item: 'grandclock' });
  assert.match(a.last('error').msg, /Otto/);
  a.send({ type: 'buy', npc: 'otto', item: 'grandclock' });
  assert.match(a.last('error').msg, /closer/);
  standBy(game, a, 'otto');
  a.send({ type: 'buy', npc: 'otto', item: 'grandclock' });
  assert.equal(a.last('inv').inv.grandclock, 1);
  a.send({ type: 'place', plotId: 6, lx: 3, ly: 3, item: 'grandclock' });
  assert.equal(game.plots[6].obj['3,3'].t, 'grandclock');
  assert.equal(a.last('inv').inv.grandclock, undefined);
  a.send({ type: 'remove', plotId: 6, lx: 3, ly: 3 });
  assert.equal(a.last('inv').inv.grandclock, 1);
});

test('NPCs remember players and their personality drifts with treatment', async () => {
  const replies = [];
  const ai = async (messages, schema, parse) => {
    replies.push(messages);
    const insult = /hate/.test(messages.at(-1).content);
    return parse(JSON.stringify({ reply: insult ? 'How rude!' : 'Lovely!', sentiment: insult ? -2 : 2, remember: insult ? '' : 'Ana loves pumpkins', gossip: '' }));
  };
  const { game, join, advance } = setup({ ai });
  const a = await join({ name: 'Ana' });
  standBy(game, a, 'otto');
  const warmth0 = game.npcs.otto.s.traits.warmth;
  for (let i = 0; i < 12; i++) { await a.send({ type: 'npcTalk', npc: 'otto', text: 'I love your chairs, Otto!' }); advance(2000); }
  const otto = game.npcs.otto.s;
  assert.ok(otto.traits.warmth > warmth0 + 5, 'Otto warms up');
  assert.ok(otto.rel[a.welcome.you.id].affinity > 40);
  assert.deepEqual(otto.rel[a.welcome.you.id].notes, ['Ana loves pumpkins']);
  assert.ok(otto.diary.length > 0, 'personality change is written in the diary');
  assert.ok(a.inbox.some((m) => m.type === 'npcSay' && m.changes.length));
  // The memory and relationship are part of the next prompt.
  await a.send({ type: 'npcTalk', npc: 'otto', text: 'Hello again' });
  const sys = replies.at(-1)[0].content;
  assert.match(sys, /Ana loves pumpkins/);
  assert.match(sys, /friends/);

  const rosa0 = game.npcs.rosa.s.traits.cheer;
  standBy(game, a, 'rosa');
  for (let i = 0; i < 6; i++) { advance(2000); await a.send({ type: 'npcTalk', npc: 'rosa', text: 'I hate this market' }); }
  assert.ok(game.npcs.rosa.s.traits.cheer < rosa0 - 3, 'Rosa gets glum');
  assert.ok(game.npcs.rosa.s.rel[a.welcome.you.id].affinity < 0);
  // Bad relationship -> worse prices.
  assert.ok(game.npcs.rosa.price(a.session().profile, 'bouquet', true) > game.npcs.rosa.price({ id: 'x' }, 'bouquet', true));
});

test('NPCs fall back to scripted replies without AI, and gifts matter', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  standBy(game, a, 'rosa');
  a.send({ type: 'npcOpen', npc: 'rosa' });
  assert.ok(a.last('npc').say.length > 5);
  await a.send({ type: 'npcTalk', npc: 'rosa', text: 'hi' });
  assert.ok(a.last('npcSay').text.length > 1);
  a.send({ type: 'buy', npc: 'rosa', item: 'bouquet' });
  const before = game.npcs.rosa.s.rel[a.welcome.you.id].affinity;
  await a.send({ type: 'gift', npc: 'rosa', item: 'bouquet' });
  assert.equal(game.npcs.rosa.s.rel[a.welcome.you.id].affinity, before + 12); // loved gift = +2
});

test('players get their profile back from any device with the same account', async () => {
  const { game, join } = setup();
  const user = { userId: 'u-ana', name: 'Ana', username: 'ana' };
  const laptop = await join({ name: 'Ana' }, user);
  laptop.send({ type: 'claim', plotId: 7 });
  const phone = await join({}, { ...user, name: 'ana' }); // replaces the laptop connection
  assert.equal(phone.welcome.you.name, 'Ana', 'logging in elsewhere keeps the chosen name');
  assert.equal(phone.welcome.you.id, laptop.welcome.you.id);
  assert.equal(phone.welcome.you.plotId, 7);
  assert.equal(phone.welcome.you.username, 'ana');
  assert.equal(game.sessions.size, 1);
});

test('a guest who signs up keeps their plot, coins and NPC friendships', async () => {
  const { game, join } = setup();
  const g = await join({ name: 'Gus' }, { userId: 'anon-1', isAnonymous: true });
  assert.equal(g.welcome.you.guest, true);
  g.send({ type: 'claim', plotId: 9 });
  standBy(game, g, 'juniper');
  await g.send({ type: 'npcTalk', npc: 'juniper', text: 'Thanks for the flowers!' });
  game.linkAccount('anon-1', 'real-1', { name: 'Gus' });
  assert.equal(game.profiles['anon-1'], undefined);
  const again = await join({}, { userId: 'real-1', username: 'gus' });
  assert.equal(again.welcome.you.id, g.welcome.you.id);
  assert.equal(again.welcome.you.plotId, 9);
  assert.equal(again.welcome.you.guest, false);
  assert.equal(game.npcs.juniper.s.rel[g.welcome.you.id].talks, 1);

  // Round-trip through the key/value persistence format.
  const stored = new Map(Object.entries(JSON.parse(JSON.stringify(game.takeDirty()))).filter(([, v]) => v != null));
  const reloaded = new Game(Game.fromEntries(stored));
  assert.equal(reloaded.profiles['real-1'].plotId, 9);
  assert.equal(reloaded.profiles['anon-1'], undefined);
  assert.equal(reloaded.plots[9].owner, g.welcome.you.id);
  assert.equal(reloaded.npcs.juniper.s.rel[g.welcome.you.id].talks, 1);
  assert.equal(reloaded.epoch, game.epoch);
});

test('a guest logging into an existing account releases the guest plot', async () => {
  const { game, join } = setup();
  const real = await join({ name: 'Ana' }, { userId: 'real-a' });
  real.send({ type: 'claim', plotId: 1 });
  real.h.onClose();
  const g = await join({ name: 'Guest' }, { userId: 'anon-2', isAnonymous: true });
  g.send({ type: 'claim', plotId: 2 });
  game.linkAccount('anon-2', 'real-a');
  assert.equal(game.plots[2].owner, null);
  assert.equal(game.plots[1].owner, real.welcome.you.id);
  assert.equal(game.profiles['real-a'].plotId, 1);
});

test('connections without a verified user are ignored', async () => {
  const { game } = setup();
  const inbox = [];
  const h = game.attach({ sendRaw: (d) => inbox.push(JSON.parse(d)), close() {} }, {});
  await h.onMessage(JSON.stringify({ type: 'hello', name: 'Hacker' }));
  assert.equal(inbox[0].type, 'error');
  assert.equal(game.sessions.size, 0);
});

test('movement is validated against speed and walls', async () => {
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' });
  const s = a.session();
  const { x, y } = s;
  a.send({ type: 'move', x: x + 500, y, d: 3, m: 1 });
  assert.equal(s.x, x);
  advance(100);
  a.send({ type: 'move', x: x + 7, y, d: 3, m: 1 });
  assert.equal(s.x, x + 7);
  advance(1000);
  a.send({ type: 'move', x: 41.5 * TILE, y: 26 * TILE, d: 1, m: 1 });
  assert.notEqual(s.y, 26 * TILE);
});

test('"home" lands on a walkable tile outside every plot gate', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  const s = a.session();
  for (const p of Object.values(game.plots)) {
    s.profile.plotId = p.id;
    a.send({ type: 'home' });
    assert.ok(canStand(game.world, game.plots, s.x, s.y), `plot ${p.id}`);
  }
});

test('villagers live their day: walk to planned places, sit, sleep indoors, meet up and chat', async () => {
  const { PLACES, NPC_ACTS, stepAt } = await import('../../shared/village.js');
  let clock = 0;
  const game = new Game({}, { now: () => clock });
  const bubbles = [];
  game.sessions.set('x', { profile: { id: 'x', uid: 'x', name: 'X' }, x: 0, y: 0, greeted: {}, quiet: -1e9, sendRaw(d) { const m = JSON.parse(d); if (m.type === 'npcBubble') bubbles.push(m); }, send() {} });
  // Run two whole village days (24 in-game hours = 864 s each) in 100 ms ticks.
  const seen = {};
  for (let i = 0; i < 17280; i++) {
    clock += 100; game.tick();
    if (i % 50) continue;
    await new Promise((r) => setTimeout(r, 0)); // let banter (async) arrive
    for (const n of Object.values(game.npcs)) {
      const act = NPC_ACTS[n.act];
      if (!n.act) continue;
      (seen[n.id] ||= new Set()).add(n.act);
      // Arrived somewhere: standing on walkable ground, on their bench, or indoors.
      const place = PLACES[n.step.place];
      if (act?.pose === 'sit' && place.seat) assert.deepEqual([n.x, n.y], [place.seat[0] * TILE, place.seat[1] * TILE], `${n.id} on the bench`);
      else if (!act?.hidden) assert.ok(canStand(game.world, game.plots, n.x, n.y) || Math.hypot(n.x - place.x * TILE, n.y - place.y * TILE) < 4, `${n.id} ${n.act} at ${n.x},${n.y}`);
    }
  }
  for (const id of Object.keys(game.npcs)) {
    assert.ok(seen[id]?.has('sleep'), `${id} slept`);
    assert.ok(seen[id].size >= 3, `${id} did several things: ${[...seen[id]]}`);
  }
  // Rosa works at her market in the morning.
  assert.equal(stepAt(game.npcs.rosa.plan, 9).place, 'rosa_shop');
  // Friends met up and their banter showed in bubbles (scripted without the AI).
  assert.ok(bubbles.length >= 2, `banter bubbles: ${bubbles.length}`);
});

test('broken model output is salvaged or rejected, never shown raw', async () => {
  const { parseAiReply } = await import('../src/npc.js');
  const runaway = '{"reply": "Hmm, thanks. Been doing this a long time.", "sentiment": 1236934106222955896561650752037231';
  assert.deepEqual(parseAiReply(runaway).reply, 'Hmm, thanks. Been doing this a long time.');
  assert.equal(parseAiReply(runaway).sentiment, 0);
  assert.equal(parseAiReply('{"sentiment": 2'), null);
  assert.equal(parseAiReply(''), null);
  assert.equal(parseAiReply({ reply: 'Hi!', sentiment: 9 }).sentiment, 2);
  assert.equal(parseAiReply('Just words.').reply, 'Just words.');
});

// Put the player's feet at the centre of a local tile of their plot.
function stand(game, a, plotId, lx, ly) {
  const p = game.plots[plotId];
  const s = a.session();
  s.x = (p.x + lx + 0.5) * TILE; s.y = (p.y + ly + 0.8) * TILE;
}

test('Sims-style rooms: walls on edges, doors let you through, windows do not', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 0 });
  stand(game, a, 0, 12, 9);
  const coins = a.welcome.you.coins;
  // A 4x3 room with its top-left tile at (2, 2).
  a.send({ type: 'walls', plotId: 0, m: 'wall_brick', segs: rectEdges(2, 2, 4, 3) });
  const plot = game.plots[0];
  assert.equal(Object.keys(plot.walls).length, 14);
  assert.equal(a.last('coins').coins, coins - 14 * ITEMS.wall_brick.price);
  a.send({ type: 'floorRect', plotId: 0, x: 2, y: 2, w: 4, h: 3, item: 'floor_wood' });
  assert.equal(Object.keys(plot.floor).length, 12);

  // Walking from inside to outside through the bottom wall is blocked...
  const p = game.plots[0];
  const inside = { x: (p.x + 3.5) * TILE, y: (p.y + 4.6) * TILE };
  const outside = { x: (p.x + 3.5) * TILE, y: (p.y + 5.3) * TILE };
  assert.ok(canStand(game.world, game.plots, inside.x, inside.y));
  assert.ok(!canStand(game.world, game.plots, inside.x, (p.y + 5) * TILE + 2), 'wall blocks');
  // ...until a door goes in. A window keeps it closed.
  a.send({ type: 'feature', plotId: 0, d: 'h', x: 3, y: 5, f: 'window' });
  assert.ok(!canStand(game.world, game.plots, inside.x, (p.y + 5) * TILE + 2), 'window blocks');
  a.send({ type: 'feature', plotId: 0, d: 'h', x: 3, y: 5, f: 'door' });
  assert.equal(plot.walls[edgeKey(0, 'h', 3, 5)].f, 'door');
  assert.ok(canStand(game.world, game.plots, inside.x, (p.y + 5) * TILE + 2), 'door lets you through');
  assert.ok(canStand(game.world, game.plots, outside.x, outside.y));

  // Doors need a wall; walls must stay on the plot (its outline is fine).
  a.send({ type: 'feature', plotId: 0, d: 'h', x: 9, y: 9, f: 'door' });
  assert.match(a.last('error').msg, /into a wall/);
  a.send({ type: 'walls', plotId: 0, m: 'wall_brick', segs: [['h', 3, p.h + 1]] });
  assert.match(a.last('error').msg, /on your plot/);
  a.send({ type: 'walls', plotId: 0, m: 'wall_brick', segs: [['h', 3, 0]] });
  assert.ok(plot.walls[edgeKey(0, 'h', 3, 0)], 'property-line wall');

  // Big furniture can't straddle a wall.
  a.send({ type: 'place', plotId: 0, lx: 5, ly: 3, item: 'sofa' });
  assert.match(a.last('error').msg, /wall/);

  // Sledgehammer: removing the door keeps the wall, removing the wall refunds both.
  const before = a.last('coins').coins;
  a.send({ type: 'remove', plotId: 0, edge: ['h', 3, 5], featureOnly: true });
  assert.equal(plot.walls[edgeKey(0, 'h', 3, 5)].f, undefined);
  a.send({ type: 'remove', plotId: 0, edge: ['h', 3, 5] });
  assert.equal(plot.walls[edgeKey(0, 'h', 3, 5)], undefined);
  assert.equal(a.last('coins').coins, before + ITEMS.door.price + ITEMS.wall_brick.price);
});

test('second storey, roofs and walls refused on top of players', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 1 });
  stand(game, a, 1, 3, 3);
  a.session().y = (game.plots[1].y + 4) * TILE; // feet right on the tile's bottom edge
  a.send({ type: 'walls', plotId: 1, m: 'wall_wood', segs: [['h', 3, 4]] });
  assert.match(a.last('error').msg, /standing/);
  stand(game, a, 1, 13, 9);
  // Upstairs furniture needs a floor first.
  a.send({ type: 'place', plotId: 1, lx: 3, ly: 3, item: 'bed', level: 1 });
  assert.match(a.last('error').msg, /floor/);
  a.send({ type: 'floorRect', plotId: 1, x: 2, y: 2, w: 4, h: 4, item: 'floor_blue', level: 1 });
  a.send({ type: 'place', plotId: 1, lx: 3, ly: 3, item: 'bed', level: 1 });
  const up = levelView(game.plots[1], 1);
  assert.equal(up.obj['3,3'].t, 'bed');
  assert.equal(game.plots[1].obj['3,3'], undefined, 'ground floor untouched');
  a.send({ type: 'walls', plotId: 1, m: 'wall_white', segs: rectEdges(2, 2, 4, 4), level: 1 });
  assert.equal(Object.keys(game.plots[1].walls).filter((k) => k.startsWith('1:')).length, 16);
  // Upstairs walls don't block walking on the ground.
  const p = game.plots[1];
  assert.ok(canStand(game.world, game.plots, (p.x + 3.5) * TILE, (p.y + 2) * TILE + 2));
  // Roofs
  a.send({ type: 'roof', plotId: 1, x: 2, y: 2, w: 4, h: 4, m: 'roof_red', level: 1 });
  assert.equal(game.plots[1].roofs.length, 1);
  a.send({ type: 'roof', plotId: 1, x: 3, y: 3, w: 2, h: 2, m: 'roof_blue', level: 1 });
  assert.match(a.last('error').msg, /Overlaps/);
  const coins = a.last('coins').coins;
  a.send({ type: 'remove', plotId: 1, lx: 4, ly: 4, level: 1, roof: true });
  assert.equal(game.plots[1].roofs.length, 0);
  assert.equal(a.last('coins').coins, coins + 16 * ITEMS.roof_red.price);
});

test('saves from the old fixed-plot map start fresh land and free their owners', () => {
  const old = { meta: { epoch: 5, version: 2 }, plots: { 0: { id: 0, owner: 'p1', floor: {}, obj: {} } }, profiles: { u1: { id: 'p1', uid: 'u1', name: 'Ana', coins: 900, plotId: 0, x: 10, y: 10, inv: {} } } };
  const game = new Game(old);
  assert.equal(game.plots[0].owner, null);
  assert.equal(game.plots[0].w, STARTER_PLOTS[0].w);
  assert.equal(game.profiles.u1.plotId, null);
  assert.equal(game.profiles.u1.coins, 900, 'coins are kept');
  const out = game.takeDirty();
  assert.equal(out.meta.version, WORLD_VERSION);
  assert.ok(out['profile:u1']);
});

test('plots have no fences: walk across the border, but property-line walls block', async () => {
  const { game, join } = setup();
  const p = game.plots[4];
  const midY = (p.y + 5.5) * TILE;
  // Walk straight across the west border.
  assert.ok(canStand(game.world, game.plots, p.x * TILE + 1, midY));
  assert.ok(canStand(game.world, game.plots, p.x * TILE - 2, midY));
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 4 });
  a.send({ type: 'walls', plotId: 4, m: 'wall_stone', segs: [['v', 0, 5]] });
  assert.ok(!canStand(game.world, game.plots, p.x * TILE + 1, midY), 'wall on the outline blocks');
  assert.ok(!canStand(game.world, game.plots, p.x * TILE - 2, midY), 'from both sides');
});

test('land: grow into open land, shrink, merge with the empty plot next door, split', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  stand(game, a, 1, 2, 2); // stand on the neighbouring plot, out of the way
  a.send({ type: 'place', plotId: 0, lx: 2, ly: 3, item: 'lamp' });
  const coins0 = a.last('coins').coins;
  // Plot 0 is x 7..30; open land runs to x 32. Grow 2 tiles east.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: plot.w + 2, h: plot.h });
  assert.equal(plot.w, 26);
  assert.equal(a.last('coins').coins, coins0 - 2 * plot.h * LAND_PRICE);
  // Can't overlap the next plot (x 33+).
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: 28, h: plot.h });
  assert.match(a.last('error').msg, /Overlaps/);
  // Must keep touching a road (west road at x 3..6, south road from y 21).
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x + 2, y: plot.y, w: plot.w - 2, h: plot.h - 2 });
  assert.match(a.last('error').msg, /touch a road/);
  // Public land and the forest are off limits.
  assert.match(landError(game.plots, null, { x: 120, y: 30, w: 10, h: 10 }, game.world), /public/);
  assert.match(landError(game.plots, null, { x: 0, y: 4, w: 10, h: 10 }, game.world), /forest/);
  // Plots may cover a road (it stays public).
  assert.equal(landError(game.plots, null, { x: 31, y: 41, w: 12, h: 10 }, game.world), null);
  // Shrinking from the north keeps furniture where it stands in the world.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y + 2, w: plot.w, h: plot.h - 2 });
  assert.equal(plot.h, 15);
  assert.equal(plot.obj['2,1'].t, 'lamp', 'lamp shifted to the new local coordinates');
  // Can't shrink over the house.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x + 3, y: plot.y, w: plot.w - 3, h: plot.h });
  assert.match(a.last('error').msg, /fit/);

  // Merge with plot 1 (empty, for sale) after making the depths match again.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y - 2, w: 26, h: 17 });
  assert.equal(plot.x + plot.w, game.plots[1].x);
  assert.equal(plot.obj['2,3'].t, 'lamp', 'growing north shifts it back');
  const s = a.session(); s.x = game.world.spawn.x; s.y = game.world.spawn.y;
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'mergePlot', plotId: 0, other: 1 });
  assert.equal(game.plots[1], undefined);
  assert.equal(plot.w, 26 + 24);
  assert.ok(a.inbox.some((m) => m.type === 'plotRemoved' && m.id === 1));
  assert.equal(game.world.plotAt[(plot.y + 1) * MAP_W + plot.x + 40], 0, 'merged land belongs to the plot');

  // Split off the empty east side: it becomes a new plot for sale.
  a.send({ type: 'splitPlot', plotId: 0, at: plot.x + 20 });
  const fresh = Object.values(game.plots).find((p) => p.id >= STARTER_PLOTS.length);
  assert.equal(plot.w, 20);
  assert.equal(fresh.x, plot.x + 20);
  assert.equal(fresh.owner, null);
  assert.equal(plot.obj['2,3'].t, 'lamp');
  // A split through the house is refused.
  a.send({ type: 'walls', plotId: 0, m: 'wall_wood', segs: [['h', 3, 5], ['h', 4, 5], ['h', 5, 5]] });
  a.send({ type: 'splitPlot', plotId: 0, at: plot.x + 4 });
  assert.match(a.last('error').msg, /wide|both sides/);
  // Persisted: the new plot and the removed one.
  const out = game.takeDirty();
  assert.equal(out['plot:1'], null);
  assert.ok(out[`plot:${fresh.id}`]);
  assert.equal(out.meta.nextPlotId, fresh.id + 1);
});

test('cheat console: testingcheats gate, money, motherlode, free build, free real estate', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  assert.match(a.last('console').text, /testingcheats/);
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'money 9999999' });
  assert.equal(a.last('coins').coins, 9999999);
  a.send({ type: 'cheat', cmd: 'motherlode' });
  assert.equal(a.last('coins').coins, 10049999);
  a.send({ type: 'cheat', cmd: 'kaching' });
  a.send({ type: 'cheat', cmd: 'rosebud' });
  assert.equal(a.last('coins').coins, 10051999);
  a.send({ type: 'cheat', cmd: 'money 100' });
  a.send({ type: 'claim', plotId: 2 });
  a.send({ type: 'cheat', cmd: 'bb.enablefreebuild' });
  assert.equal(a.last('freebuild').on, true);
  a.send({ type: 'walls', plotId: 2, m: 'wall_stone', segs: rectEdges(2, 2, 6, 6) });
  assert.equal(Object.keys(game.plots[2].walls).length, 24);
  assert.equal(a.session().profile.coins, 100, 'free build costs nothing');
  a.send({ type: 'cheat', cmd: 'freerealestate on' });
  a.send({ type: 'resizePlot', plotId: 2, x: game.plots[2].x, y: game.plots[2].y, w: 26, h: 17 });
  assert.equal(game.plots[2].w, 26);
  assert.equal(a.session().profile.coins, 100, 'free real estate');
  a.send({ type: 'cheat', cmd: 'nope' });
  assert.match(a.last('console').text, /Unknown/);
  // Servers can switch cheats off.
  const locked = new Game({}, { cheats: 'off' });
  const inbox = [];
  const h = locked.attach({ sendRaw: (d) => inbox.push(JSON.parse(d)), close() {} }, { userId: 'u' });
  await h.onMessage(JSON.stringify({ type: 'hello', name: 'X' }));
  await h.onMessage(JSON.stringify({ type: 'cheat', cmd: 'testingcheats true' }));
  assert.match(inbox.at(-1).text, /off/);
});

test('stairs: climb to the upper floor, walk around up there, come back down', async () => {
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const p = game.plots[0];
  const s = a.session();
  s.x = game.world.spawn.x; s.y = game.world.spawn.y;
  // Upstairs floor first; the staircase then cuts its own stairwell.
  a.send({ type: 'floorRect', plotId: 0, x: 8, y: 2, w: 5, h: 6, item: 'floor_wood', level: 1 });
  assert.equal(levelView(p, 1).floor['10,6'], 'floor_wood');
  a.send({ type: 'place', plotId: 0, lx: 10, ly: 5, item: 'stairs' }); // climbs north: bottom at ly 7, top at ly 5
  assert.equal(p.obj['10,5'].t, 'stairs');
  assert.equal(levelView(p, 1).floor['10,6'], undefined, 'stairwell cut');
  a.send({ type: 'place', plotId: 0, lx: 10, ly: 6, item: 'floor_blue', level: 1 });
  assert.match(a.last('error').msg, /stairwell/);

  const X = (p.x + 10.5) * TILE;
  // Walk north from the ground up the stairs and onto the landing (ly 4) upstairs.
  const walk = (tx, ty) => {
    for (let i = 0; i < 200; i++) {
      const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      if (d < 0.5) return true;
      const st = Math.min(d, 6);
      const before = [s.x, s.y];
      advance(100);
      a.send({ type: 'move', x: s.x + (dx / d) * st, y: s.y + (dy / d) * st, d: 1, m: 1 });
      if (s.x === before[0] && s.y === before[1]) return false; // blocked
    }
    return false;
  };
  s.x = X; s.y = (p.y + 9) * TILE; s.level = 0;
  assert.ok(walk(X, (p.y + 6.5) * TILE));
  assert.ok(heightAt(game.world, game.plots, s.x, s.y, s.level) > 0.3 * LEVEL_H, 'halfway up');
  assert.ok(walk(X, (p.y + 4.6) * TILE), 'reached the landing');
  assert.equal(s.level, 1);
  // Upstairs you can walk on the floor but not off its edge.
  assert.ok(walk((p.x + 8.6) * TILE, (p.y + 3.5) * TILE));
  assert.ok(!walk((p.x + 8.6) * TILE, (p.y + 0.8) * TILE), 'no floor beyond y=2');
  // Back down the stairs.
  assert.ok(walk(X, (p.y + 4.6) * TILE));
  assert.ok(walk(X, (p.y + 9) * TILE));
  assert.equal(s.level, 0);

  // From the ground you can't walk into the top of the stairs (it's above you)...
  s.x = X; s.y = (p.y + 4.5) * TILE; s.level = 0;
  assert.ok(!walk(X, (p.y + 6) * TILE));
  assert.equal(s.level, 0);
  // ...or step onto them from the side.
  s.x = (p.x + 11.6) * TILE; s.y = (p.y + 6.5) * TILE;
  assert.ok(!walk((p.x + 10.5) * TILE, (p.y + 6.5) * TILE));

  // Removing the stairs while someone is upstairs sends them home safely.
  s.x = X; s.y = (p.y + 3.5) * TILE; s.level = 1;
  a.send({ type: 'floorRect', plotId: 0, x: 10, y: 3, w: 1, h: 1, item: 'floor_wood', level: 1 });
  a.send({ type: 'remove', plotId: 0, lx: 10, ly: 3, level: 1 });
  assert.equal(s.level, 0);
  // Stairs only go on the ground floor.
  a.send({ type: 'place', plotId: 0, lx: 9, ly: 2, item: 'stairs', level: 1 });
  assert.match(a.last('error').msg, /ground floor/);
});

test('character looks are validated, saved and shared; logging in elsewhere keeps them', async () => {
  const { game, join } = setup();
  const user = { userId: 'u-look', name: 'x' };
  const a = await join({ name: 'Dwight', farm: 'Schrute', fav: 'Beets', look: { body: 1, skin: 3, hair: 999, shirt: 2, acc: 4, eyes: [10, 20, 30], hairColor: 'red', pants: [1, 2, 3] } }, user);
  const you = a.welcome.you;
  assert.equal(you.farm, 'Schrute');
  assert.equal(you.look.hair, DEFAULT_LOOK.hair, 'out-of-range style falls back');
  assert.deepEqual(you.look.eyes, [10, 20, 30]);
  assert.ok(Array.isArray(you.look.hairColor));
  const b = await join({ name: 'Pam' });
  assert.deepEqual(b.welcome.players[0].look, you.look);
  a.send({ type: 'claim', plotId: 2 });
  assert.equal(game.plots[2].farm, 'Schrute');
  a.send({ type: 'setLook', name: 'Dwight', farm: 'Beet', look: { ...you.look, shirt: 5 } });
  assert.equal(b.last('look').look.shirt, 5);
  assert.equal(b.last('plot').plot.farm, 'Beet');
  // A new connection without creator data keeps the saved look.
  const again = await join({}, user);
  assert.equal(again.welcome.you.look.shirt, 5);
  assert.equal(again.welcome.you.name, 'Dwight');
});

test('roads across a plot stay public: they can be moved but not cut', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  stand(game, a, 1, 2, 2);
  // Grow south over the 4-wide road (world rows 21..24 = local rows 17..20).
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: plot.w, h: 21 });
  assert.equal(plot.h, 21);
  a.send({ type: 'place', plotId: 0, lx: 5, ly: 18, item: 'lamp' });
  assert.match(a.last('error').msg, /public road/);
  a.send({ type: 'floorRect', plotId: 0, x: 4, y: 15, w: 3, h: 4, item: 'floor_wood' });
  assert.equal(plot.floor['5,18'], undefined, 'no floor on the road');
  assert.ok(plot.floor['5,15']);
  // Cutting straight through the road is refused...
  const cut = [17, 18, 19, 20].map((y) => [10, y]);
  a.send({ type: 'road', plotId: 0, tiles: cut, on: false });
  assert.match(a.last('error').msg, /connected/);
  // ...and so is digging up where the road enters the plot.
  a.send({ type: 'road', plotId: 0, tiles: [[0, 18]], on: false });
  assert.match(a.last('error').msg, /City Hall/);
  // Pave a detour along row 16, then the cut is fine.
  a.send({ type: 'road', plotId: 0, tiles: [[5, 16]], on: true });
  assert.match(a.last('error').msg, /Clear/, 'can’t pave over a floor');
  const detour = [];
  for (let x = 0; x < plot.w; x++) if (!plot.floor[`${x},16`]) detour.push([x, 16]);
  a.send({ type: 'road', plotId: 0, tiles: [[4, 15], [5, 15], [6, 15], ...detour], on: true });
  assert.match(a.last('error').msg, /Clear/);
  a.send({ type: 'remove', plotId: 0, lx: 4, ly: 16 });
  for (const x of [4, 5, 6]) a.send({ type: 'remove', plotId: 0, lx: x, ly: 16 });
  a.send({ type: 'road', plotId: 0, tiles: [...Array(plot.w).keys()].map((x) => [x, 16]), on: true });
  assert.ok(a.last('roads'), 'road change broadcast');
  a.send({ type: 'road', plotId: 0, tiles: cut, on: false });
  assert.equal(game.world.tiles[(plot.y + 18) * MAP_W + plot.x + 10], T.GRASS);
  a.send({ type: 'place', plotId: 0, lx: 10, ly: 18, item: 'lamp' });
  assert.equal(plot.obj['10,18'].t, 'lamp');
  // Saved, and a reloaded world has the same roads.
  const out = game.takeDirty();
  assert.ok(out.roads.del.length >= 3 && out.roads.add.length >= 20);
  const again = new Game(Game.fromEntries(Object.entries({ ...out, meta: { ...out.meta } })));
  assert.equal(again.world.tiles[(plot.y + 18) * MAP_W + plot.x + 10], T.GRASS);
  assert.equal(again.world.tiles[(plot.y + 16) * MAP_W + plot.x + 3], T.PATH);
});

test('v3 saves keep their plots; anything left on the new roads is refunded', () => {
  const saved = {
    meta: { version: 3, epoch: 1, nextPlotId: 1 },
    plots: { 0: { id: 0, x: 7, y: 4, w: 24, h: 18, owner: 'p1', ownerName: 'Ana', floor: { '3,17': 'floor_wood', '3,2': 'floor_wood' }, obj: { '5,17': { t: 'lamp' }, '5,5': { t: 'lamp' } }, l1: { floor: {}, obj: {} }, walls: {}, roofs: [] } },
    profiles: { u1: { id: 'p1', uid: 'u1', name: 'Ana', coins: 100, plotId: 0, inv: {} } },
  };
  const game = new Game(saved);
  const p = game.plots[0];
  assert.deepEqual([p.x, p.y, p.w, p.h], [7, 4, 24, 18]);
  assert.equal(p.obj['5,17'], undefined);
  assert.ok(p.obj['5,5']);
  assert.equal(p.floor['3,17'], undefined);
  assert.equal(game.profiles.u1.coins, 100 + ITEMS.lamp.price + ITEMS.floor_wood.price);
  const out = game.takeDirty();
  assert.equal(out.meta.version, WORLD_VERSION);
  assert.ok(out['plot:0'] && out['profile:u1']);
});

test('City Hall: founding election, council proposals, AI caretakers and the mayor’s pen', async () => {
  const { DAY_MS } = await import('../../shared/world.js');
  const { game, join, advance } = setup();
  const tickDays = (d) => { advance(d * DAY_MS); game.tick(); };
  const atHall = (p) => { const s = p.session(); s.x = 139.5 * TILE; s.y = 37.5 * TILE; };
  const ana = await join({ name: 'Ana' });
  const ben = await join({ name: 'Ben' });
  const guest = await join({ name: 'Gus' }, { userId: 'g1', name: 'Gus', isAnonymous: true });
  game.tick();
  const e = game.city.s.election;
  assert.ok(e && e.founding, 'a new village opens its founding election');

  // Filing happens in person, by registered villagers.
  ana.send({ type: 'cityRun', office: 'mayor', platform: 'Pumpkins for all' });
  assert.match(ana.last('error').msg, /City Hall/);
  for (const p of [ana, ben, guest]) atHall(p);
  guest.send({ type: 'cityRun', office: 'council' });
  assert.match(guest.last('error').msg, /account/);
  ana.send({ type: 'cityRun', office: 'mayor', platform: 'Pumpkins for all' });
  ben.send({ type: 'cityRun', office: 'council' });
  assert.equal(e.candidates.length, 2);
  // Voting opens after filing.
  ana.send({ type: 'cityVote', office: 'mayor', candidate: ana.welcome.you.id });
  assert.match(ana.last('error').msg, /Voting/);
  tickDays(e.filingEnd - game.day());
  ana.send({ type: 'cityVote', office: 'mayor', candidate: ana.welcome.you.id });
  ben.send({ type: 'cityVote', office: 'mayor', candidate: ana.welcome.you.id });
  ben.send({ type: 'cityVote', office: 'council', candidate: ben.welcome.you.id });
  assert.equal(ben.last('city').city.election.myVotes.mayor, ana.welcome.you.id);
  tickDays(e.votingEnd - game.day());
  const off = game.city.s.officials;
  assert.equal(off.mayor.name, 'Ana');
  assert.deepEqual(off.council.map((c) => c.name), ['Ben']);
  assert.equal(game.city.aiSeats(), 49);

  // Ana covers the road with her plot and asks the city to close it.
  const s = ana.session();
  ana.send({ type: 'cheat', cmd: 'testingcheats true' });
  ana.send({ type: 'cheat', cmd: 'motherlode' });
  ana.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  ana.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: plot.w, h: 21 });
  assert.equal(plot.h, 21);
  atHall(ana);
  ana.send({ type: 'cityPropose', kind: 'closeRoad', plotId: 0, text: 'Nobody uses it' });
  const bill = game.city.s.proposals.at(-1);
  assert.equal(bill.kind, 'closeRoad');
  assert.equal(game.city.advice(bill).recommend, 'yes', 'light traffic, nobody cut off');
  ana.send({ type: 'councilVote', id: bill.id, vote: 'yes' });
  assert.match(ana.last('error').msg, /council members/);
  ben.send({ type: 'councilVote', id: bill.id, vote: 'no' });
  tickDays(2);
  assert.equal(bill.status, 'awaiting', 'passed 49–1, on the mayor’s desk');
  assert.deepEqual([bill.result.yes, bill.result.no], [49, 1]);
  ana.send({ type: 'mayorAct', id: bill.id, sign: true });
  assert.equal(bill.status, 'passed');
  assert.equal(game.world.tiles[(plot.y + 18) * MAP_W + plot.x + 5], T.GRASS, 'road closed');
  assert.ok(ana.last('roads'));

  // Land price change, and the treasury collects land payments.
  atHall(ben);
  ben.send({ type: 'cityPropose', kind: 'landPrice', price: 4 });
  const lp = game.city.s.proposals.at(-1);
  tickDays(2);
  assert.equal(lp.status, 'awaiting');
  tickDays(1);
  assert.equal(lp.status, 'passed', 'unsigned bills become law');
  assert.equal(game.city.landPrice, 4);
  ana.send({ type: 'cheat', cmd: 'testingcheats false' });
  s.x = game.world.spawn.x; s.y = game.world.spawn.y;
  const t0 = game.city.s.treasury, c0 = s.profile.coins;
  ana.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: plot.w + 1, h: plot.h });
  assert.equal(c0 - s.profile.coins, plot.h * 4);
  assert.equal(game.city.s.treasury - t0, plot.h * 4);

  // City data and the clerk's brief.
  for (let i = 0; i < 5; i++) ben.send({ type: 'move', x: (40 + i) * TILE + 8, y: 22.5 * TILE, d: 3, m: true });
  assert.ok(game.city.brief().includes('Mayor: Ana'));
  const saved = game.takeDirty();
  assert.equal(saved.city.officials.mayor.name, 'Ana');
});

test('Sims build tools: styled rooms, move/rotate rooms, move furniture, design, library, bulldoze', async () => {
  const { STYLED_ROOMS } = await import('../../shared/rooms.js');
  const { rotateTimes, extract } = await import('../../shared/blueprint.js');
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  stand(game, a, 1, 2, 2);
  // Every styled room is a valid build: place each on an empty plot copy and check its furniture.
  for (const [id, r] of Object.entries(STYLED_ROOMS)) {
    const p = { ...plot, floor: {}, obj: {}, l1: { floor: {}, obj: {} }, walls: {}, roofs: [] };
    const { placeError, applyAt } = await import('../../shared/blueprint.js');
    assert.equal(placeError(p, r.frag, 1, 1, game.world), null, id);
    applyAt(p, r.frag, 1, 1);
    for (const [k, o] of Object.entries(p.obj)) {
      const [x, y] = k.split(',').map(Number);
      delete p.obj[k];
      const { occChanged, placementError } = await import('../../shared/plot.js');
      occChanged(p);
      assert.equal(placementError(p, x, y, o.t, o.r || 0, 0, game.world), null, `${id}: ${o.t}`);
      p.obj[k] = o; occChanged(p);
    }
    // Four quarter turns bring it back.
    assert.deepEqual(rotateTimes(r.frag, 4), { w: r.frag.w, h: r.frag.h, levels: r.frag.levels, walls: r.frag.walls, roofs: r.frag.roofs }, id);
  }
  // Buy the bedroom.
  const c0 = a.last('coins').coins;
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'styled', id: 'bedroom', x: 2, y: 2 });
  assert.equal(c0 - a.last('coins').coins, STYLED_ROOMS.bedroom.price);
  assert.equal(plot.obj['3,2'].t, 'bed');
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'styled', id: 'bedroom', x: 3, y: 3 });
  assert.match(a.last('error').msg, /Clear|wall/);
  // Move the whole room 6 east, then turn it a quarter.
  a.send({ type: 'moveRegion', plotId: 0, room: [3, 3], dx: 6, dy: 0 });
  assert.equal(plot.obj['3,2'], undefined);
  assert.equal(plot.obj['9,2'].t, 'bed');
  assert.ok(plot.walls['0:h:10:6'].f === 'door', 'door moved with it');
  a.send({ type: 'moveRegion', plotId: 0, room: [9, 3], rot: 1 });
  const bed = Object.values(plot.obj).find((o) => o.t === 'bed');
  assert.equal(bed.r, 1, 'turned furniture turns too');
  assert.equal(Object.keys(plot.walls).length, 18, 'same walls, now 4 wide and 5 deep');
  // Select tool: move the lamp, keep its colour; design tool recolours for free.
  const lampKey = Object.keys(plot.obj).find((k) => plot.obj[k].t === 'lamp');
  const [lx, ly] = lampKey.split(',').map(Number);
  const c1 = a.last('coins').coins;
  a.send({ type: 'design', plotId: 0, lx, ly });
  assert.equal(plot.obj[lampKey].c, 1);
  a.send({ type: 'moveObj', plotId: 0, from: [lx, ly], to: [1, 12] });
  assert.equal(plot.obj['1,12'].t, 'lamp');
  assert.equal(plot.obj['1,12'].c, 1);
  assert.equal(a.last('coins').coins, c1, 'moving and designing are free');
  // Library: save the room, place a copy, delete it.
  a.send({ type: 'saveBlueprint', plotId: 0, room: [9, 3], name: 'Guest room' });
  assert.equal(a.last('library').library[0].name, 'Guest room');
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'library', id: 0, x: 15, y: 1 });
  assert.equal(Object.values(plot.obj).filter((o) => o.t === 'bed').length, 2);
  a.send({ type: 'deleteBlueprint', idx: 0 });
  assert.equal(a.last('library').library.length, 0);
  // Move the whole house; then bulldoze terrain, then the lot.
  const before = extract(plot);
  a.send({ type: 'moveRegion', plotId: 0, all: true, dx: -1, dy: 1 });
  assert.equal(extract(plot).ox, before.ox - 1);
  a.send({ type: 'place', plotId: 0, lx: 1, ly: 14, item: 'soil' });
  a.send({ type: 'bulldoze', plotId: 0, terrain: true });
  assert.equal(plot.floor['1,14'], undefined);
  assert.ok(Object.keys(plot.walls).length > 0, 'terrain bulldoze keeps the house');
  const c2 = a.last('coins').coins;
  a.send({ type: 'bulldoze', plotId: 0 });
  assert.equal(Object.keys(plot.walls).length + Object.keys(plot.obj).length + Object.keys(plot.floor).length, 0);
  assert.ok(a.last('coins').coins > c2, 'refunded');
});

test('rooms move with their upstairs, stairs and roof; blueprints use shop furniture from the bag', async () => {
  const { ITEMS } = await import('../../shared/catalog.js');
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  stand(game, a, 1, 2, 2);
  // A two-storey bedroom (tiles 2..6 × 2..5) with stairs, upstairs furniture and a roof.
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'styled', id: 'bedroom', x: 2, y: 2 });
  a.send({ type: 'floorRect', plotId: 0, x: 2, y: 2, w: 5, h: 4, item: 'floor_wood', level: 1 });
  a.send({ type: 'place', plotId: 0, lx: 2, ly: 2, item: 'stairs' });
  assert.equal(plot.obj['2,2'].t, 'stairs');
  a.send({ type: 'place', plotId: 0, lx: 5, ly: 3, item: 'chair', level: 1 });
  assert.equal(levelView(plot, 1).obj['5,3'].t, 'chair');
  const roofMat = Object.keys(ITEMS).find((k) => ITEMS[k].layer === 'roof');
  plot.roofs.push({ x: 2, y: 2, w: 5, h: 4, l: 1, m: roofMat });
  // Pick it up from the ground floor and move it 8 east: everything comes along.
  a.send({ type: 'moveRegion', plotId: 0, room: [3, 3], dx: 8, dy: 0 });
  assert.equal(plot.obj['2,2'], undefined);
  assert.equal(plot.obj['10,2'].t, 'stairs', 'stairs moved');
  const up = levelView(plot, 1);
  assert.equal(up.obj['13,3'].t, 'chair', 'upstairs furniture moved');
  assert.equal(up.floor['10,3'], undefined, 'stairwell moved with the stairs');
  assert.equal(up.floor['11,3'], 'floor_wood');
  assert.equal(up.floor['3,3'], undefined, 'nothing left upstairs');
  assert.deepEqual(plot.roofs.map((r) => [r.x, r.y]), [[10, 2]], 'roof moved');
  // Shop furniture in a library blueprint comes from the bag.
  a.session().profile.inv.grandclock = 1;
  a.send({ type: 'place', plotId: 0, lx: 12, ly: 3, item: 'grandclock' });
  assert.equal(plot.obj['12,3'].t, 'grandclock');
  a.send({ type: 'saveBlueprint', plotId: 0, room: [11, 3], name: 'Loft' });
  const bp = a.last('library').library[0].frag;
  assert.ok(Object.values(bp.levels[0].obj).some((o) => o.t === 'grandclock'), 'shop piece saved');
  assert.ok(Object.keys(bp.levels[1].floor).length, 'upstairs saved');
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'library', id: 0, x: 2, y: 2 });
  assert.match(a.last('toast').text, /without Grandfather Clock/);
  assert.equal(plot.obj['2,2'].t, 'stairs');
  assert.equal(Object.values(plot.obj).filter((o) => o.t === 'grandclock').length, 1, 'none in the bag: left out');
  a.session().profile.inv.grandclock = 1;
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'library', id: 0, x: 2, y: 8 });
  assert.equal(Object.values(plot.obj).filter((o) => o.t === 'grandclock').length, 2, 'taken from the bag');
  assert.equal(a.last('inv').inv.grandclock, undefined);
});

test('needs: run down over time; fridge, toilet, shower, bed and TV fill them; eating; fainting', async () => {
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' });
  assert.equal(a.welcome.you.needs.health, 100);
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  for (const [item, lx, ly] of [['fridge', 2, 2], ['stove', 3, 2], ['toilet', 6, 2], ['shower', 8, 2], ['bed', 10, 2], ['tv', 12, 2]]) {
    a.send({ type: 'place', plotId: 0, lx, ly, item });
    assert.equal(plot.obj[`${lx},${ly}`]?.t, item, item);
  }
  const s = a.session();
  const run = (secs) => { for (let i = 0; i < secs; i++) { advance(1000); game.tick(); } };
  // Needs decay while online.
  const h0 = s.profile.needs.hunger;
  run(36); // one in-game hour
  assert.ok(Math.abs(h0 - s.profile.needs.hunger - 3.5) < 0.2, `hunger fell ${h0 - s.profile.needs.hunger}`);
  // Too far away to use the toilet.
  stand(game, a, 0, 14, 10);
  a.send({ type: 'use', plotId: 0, lx: 6, ly: 2, act: 'toilet' });
  assert.match(a.last('error').msg, /Walk up/);
  // Use the toilet: you sit on it, the bladder fills, then you get back up.
  s.profile.needs.bladder = 10;
  stand(game, a, 0, 6, 3);
  const back = [s.x, s.y];
  a.send({ type: 'use', plotId: 0, lx: 6, ly: 2, act: 'toilet' });
  assert.equal(s.act.id, 'toilet');
  assert.equal(a.last('pos').y, (plot.y + 2.5) * TILE, 'sitting on it');
  a.send({ type: 'move', x: 0, y: 0, d: 0, m: 1 });
  assert.equal(s.y, (plot.y + 2.5) * TILE, 'moves ignored while busy');
  run(20);
  assert.ok(s.profile.needs.bladder > 97, 'bladder filled');
  assert.equal(s.act, null, 'done by itself');
  assert.deepEqual([s.x, s.y], back, 'back where you stood');
  // Snack from the fridge costs 5 and feeds you; cooking needs the stove (there is one).
  s.profile.needs.hunger = 20;
  stand(game, a, 0, 2, 3);
  const c0 = s.profile.coins;
  a.send({ type: 'use', plotId: 0, lx: 2, ly: 2, act: 'cook' });
  assert.equal(c0 - s.profile.coins, 15);
  // Walking off before it's ready refunds it.
  a.send({ type: 'stop' });
  assert.equal(s.profile.coins, c0, 'refunded');
  assert.equal(s.carry, undefined);
  a.send({ type: 'use', plotId: 0, lx: 2, ly: 2, act: 'cook' });
  run(26);
  assert.equal(s.carry?.food, 'meal', 'holding a plate');
  assert.equal(s.act, null);
  assert.equal(game.lastRows.get(a.welcome.you.id).split(',')[7], 'meal', 'others see the plate');
  // Can't grab more food with full hands; eating needs a plate.
  a.send({ type: 'use', plotId: 0, lx: 2, ly: 2, act: 'snack' });
  assert.match(a.last('error').msg, /already holding/);
  // Eat standing up: hunger goes up by the plate's worth (80) at most.
  const h1 = s.profile.needs.hunger;
  a.send({ type: 'use', act: 'eatHere' });
  assert.equal(s.act.id, 'eatHere');
  run(30);
  assert.equal(s.act, null);
  assert.equal(s.carry, null, 'plate finished');
  assert.ok(s.profile.needs.hunger > 90 && s.profile.needs.hunger <= h1 + 80 + 0.01, `hunger ${h1} -> ${s.profile.needs.hunger}`);
  a.send({ type: 'use', act: 'eatHere' });
  assert.match(a.last('error').msg, /Get some food/);
  // Shower, then stop early by walking away.
  s.profile.needs.hygiene = 0;
  stand(game, a, 0, 8, 3);
  a.send({ type: 'use', plotId: 0, lx: 8, ly: 2, act: 'shower' });
  run(5);
  a.send({ type: 'stop' });
  assert.equal(s.act, null);
  assert.ok(s.profile.needs.hygiene > 15 && s.profile.needs.hygiene < 30, `hygiene ${s.profile.needs.hygiene}`);
  // Others see what you're doing; someone else can't use the same thing.
  const b = await join({ name: 'Ben' });
  stand(game, b, 0, 14, 5); // nearby, so he hears about it right away
  stand(game, a, 0, 12, 3);
  a.send({ type: 'use', plotId: 0, lx: 12, ly: 2, act: 'tv' });
  game.tick();
  assert.equal(b.last('state').p.find((p) => p[0] === a.welcome.you.id)[6], 'tv');
  stand(game, b, 0, 12, 3);
  b.send({ type: 'use', plotId: 0, lx: 12, ly: 2, act: 'tv' });
  assert.match(b.last('error').msg, /Ana is using/);
  // Ben can't use Ana's bed while she's out.
  a.send({ type: 'stop' });
  stand(game, a, 0, 10, 5);
  s.x = game.world.spawn.x; s.y = game.world.spawn.y;
  stand(game, b, 0, 11, 3);
  b.send({ type: 'use', plotId: 0, lx: 10, ly: 2, act: 'sleep' });
  assert.match(b.last('error').msg, /while they’re in/);
  // Eat a turnip from the bag.
  s.profile.inv.turnip = 1;
  s.profile.needs.hunger = 50;
  a.send({ type: 'eat', item: 'turnip' });
  assert.equal(s.profile.needs.hunger, 62);
  assert.equal(s.profile.inv.turnip, undefined);
  // Health falls while needs are empty; at zero you faint and wake up at home.
  Object.assign(s.profile.needs, { hunger: 0, bladder: 0, health: 1 });
  run(20);
  assert.match(a.last('toast').text, /fainted/);
  assert.ok(s.profile.needs.health >= 40);
});

test('interest management: nearby moves every tick, far ones once a second', async () => {
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' }), b = await join({ name: 'Ben' }), c = await join({ name: 'Cy' });
  const [sa, sb, sc] = [a.session(), b.session(), c.session()];
  sa.x = 40 * TILE; sa.y = 40 * TILE;
  sb.x = 45 * TILE; sb.y = 40 * TILE;          // 5 tiles from Ana
  sc.x = 140 * TILE; sc.y = 40 * TILE;         // 100 tiles away
  advance(1000); game.tick();                  // a full update for everyone
  const rowOf = (m, who) => m.p.find((r) => r[0] === who.welcome.you.id);
  assert.ok(rowOf(c.last('state'), a), 'full updates include everyone');
  // Ana moves: Ben (near) hears it next tick, Cy (far) doesn't until the next full update.
  sa.x += 8;
  const cBefore = c.inbox.length;
  advance(100); game.tick();
  assert.equal(rowOf(b.last('state'), a)[1], 40 * TILE + 8);
  assert.ok(!c.inbox.slice(cBefore).some((m) => m.type === 'state' && rowOf(m, a)), 'far player not told yet');
  // Nothing moving: no state at all between full updates.
  const bBefore = b.inbox.length;
  advance(100); game.tick();
  assert.ok(!b.inbox.slice(bBefore).some((m) => m.type === 'state' && m.p.length), 'quiet ticks send nothing');
  advance(1000); game.tick();
  assert.equal(rowOf(c.last('state'), a)[1], 40 * TILE + 8, 'far player catches up on the full update');
});

test('villager requests: offered on talking, accepted, handed in, messages delivered', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  const s = a.session();
  // Talking to Rosa: she asks a favour.
  standBy(game, a, 'rosa');
  game.npcs.rosa.act = 'work';
  a.send({ type: 'npcOpen', npc: 'rosa' });
  await new Promise((r) => setTimeout(r, 0));
  const offer = a.last('questOffer').quest;
  assert.equal(offer.npc, 'rosa');
  assert.ok(offer.text.length > 10);
  a.send({ type: 'questAccept', id: offer.id });
  assert.equal(a.last('quests').quests[0].id, offer.id);
  // Only one offer a day each.
  a.send({ type: 'npcOpen', npc: 'rosa' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(a.inbox.filter((m) => m.type === 'questOffer').length, 1);
  const q = s.profile.quests[0];
  // Force a deliver request we can test: 2 turnips.
  Object.assign(q, { kind: 'deliver', item: 'turnip', n: 2, reward: 50 });
  a.send({ type: 'questTurnIn', id: q.id });
  assert.match(a.last('error').msg, /Not yet/);
  s.profile.inv.turnip = 3;
  const c0 = s.profile.coins, aff0 = game.npcs.rosa.affinity(s.profile);
  a.send({ type: 'questTurnIn', id: q.id });
  assert.equal(s.profile.coins, c0 + 50);
  assert.equal(s.profile.inv.turnip, 1);
  assert.ok(game.npcs.rosa.affinity(s.profile) > aff0, 'she likes you more');
  assert.equal(q.status, 'done');
  // A message for Otto: delivered by talking to him.
  s.profile.quests.push({ id: 'm1', npc: 'juniper', kind: 'visit', target: 'otto', message: 'a snail moved into the fountain', reply: 'A snail. In MY fountain.', reward: 35, status: 'active' });
  standBy(game, a, 'otto');
  game.npcs.otto.act = 'work';
  const c1 = s.profile.coins;
  a.send({ type: 'npcOpen', npc: 'otto' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.profile.coins, c1 + 35);
  assert.equal(a.last('npcSay').text, 'A snail. In MY fountain.');
  // Sleeping villagers can't talk.
  game.npcs.otto.act = 'sleep';
  a.send({ type: 'npcOpen', npc: 'otto' });
  assert.match(a.last('error').msg, /asleep/);
});

test('villagers read how you write', async () => {
  const { readTone, blendTone, toneGuide } = await import('../../shared/village.js');
  const casual = readTone('yo lol thats so sick bro 😂');
  const formal = readTone('Good afternoon, Mabel. Could you please explain how the council election works?');
  assert.ok(casual.casual > 0.5 && casual.playful > 0.4 && casual.emoji > 0.3);
  assert.ok(formal.formal > 0.6 && formal.casual < 0.2);
  assert.match(toneGuide(blendTone(null, casual)), /casually|playful/);
  assert.match(toneGuide(blendTone(null, formal)), /polite/);
  // One message doesn't flip a settled style.
  const mixed = blendTone(blendTone(blendTone(null, formal), formal), casual);
  assert.ok(mixed.formal > mixed.casual);
});

test('businesses: licence, shop plot, shelves, the till, machines, clerks and customers', async () => {
  const { HOUR_MS } = await import('../../shared/needs.js');
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' }), b = await join({ name: 'Ben' });
  const sa = a.session(), sb = b.session();
  sa.profile.coins = 5000; sb.profile.coins = 1000;
  // A licence costs 500 and needs a trip to City Hall.
  a.send({ type: 'bizStart', name: 'Ana’s Pantry' });
  assert.match(a.last('error').msg, /City Hall/);
  sa.x = 139.5 * TILE; sa.y = 37.5 * TILE;
  const t0 = game.city.s.treasury;
  a.send({ type: 'bizStart', name: 'Ana’s Pantry' });
  assert.equal(sa.profile.coins, 4500);
  assert.equal(game.city.s.treasury, t0 + 500);
  assert.equal(a.last('business').biz.name, 'Ana’s Pantry');
  // Home on plot 0, shop on plot 1 (land at the city price).
  a.send({ type: 'claim', plotId: 0 });
  a.send({ type: 'claim', plotId: 1, business: true });
  const shop = game.plots[1];
  assert.equal(shop.owner, sa.profile.id);
  assert.equal(shop.biz.name, 'Ana’s Pantry');
  assert.equal(sa.profile.plotId, 0, 'home stays home');
  // Build it like a house: shelf, register, preserves jar.
  for (const [item, lx, ly] of [['shelf', 3, 3], ['register', 6, 3], ['preservesjar', 9, 3]]) {
    a.send({ type: 'place', plotId: 1, lx, ly, item });
    assert.equal(shop.obj[`${lx},${ly}`]?.t, item, item);
  }
  // Make jam: 2 berries, 3 in-game hours.
  stand(game, a, 1, 9, 4);
  sa.profile.inv.berry = 4;
  a.send({ type: 'craft', plotId: 1, lx: 9, ly: 3, recipe: 'jam' });
  assert.equal(sa.profile.inv.berry, 2);
  a.send({ type: 'collect', plotId: 1, lx: 9, ly: 3 });
  assert.match(a.last('error').msg, /Not ready/);
  advance(3 * HOUR_MS);
  a.send({ type: 'collect', plotId: 1, lx: 9, ly: 3 });
  assert.equal(sa.profile.inv.jam, 1);
  // Stock the shelf: jam at 140, berries at 70.
  stand(game, a, 1, 3, 4);
  sa.profile.inv.jam = 3;
  a.send({ type: 'stock', plotId: 1, lx: 3, ly: 3, item: 'jam', n: 3, price: 140 });
  a.send({ type: 'stock', plotId: 1, lx: 3, ly: 3, item: 'berry', n: 2, price: 70 });
  assert.deepEqual(shop.obj['3,3'].stock.map((x) => [x.item, x.n, x.price]), [['jam', 3, 140], ['berry', 2, 70]]);
  assert.equal(sa.profile.inv.jam, undefined);
  // Closed (no clerk, nobody at the till): Ben can't buy.
  stand(game, b, 1, 3, 4);
  b.send({ type: 'buyStock', plotId: 1, lx: 3, ly: 3, slot: 0 });
  assert.match(b.last('error').msg, /closed/);
  // Ana works the register: open. Ben buys a jam; Ana gets the money (+10% tip).
  stand(game, a, 1, 6, 4);
  a.send({ type: 'use', plotId: 1, lx: 6, ly: 3, act: 'cashier' });
  assert.equal(sa.act.id, 'cashier');
  const ca = sa.profile.coins;
  b.send({ type: 'buyStock', plotId: 1, lx: 3, ly: 3, slot: 0 });
  assert.equal(sb.profile.inv.jam, 1);
  assert.equal(sb.profile.coins, 1000 - 140);
  assert.equal(sa.profile.coins, ca + 140 + 14);
  assert.equal(shop.obj['3,3'].stock[0].n, 2);
  // Ben can't run Ana's till.
  stand(game, b, 1, 6, 4);
  b.send({ type: 'use', plotId: 1, lx: 6, ly: 3, act: 'cashier' });
  assert.match(b.last('error').msg, /own shop/);
  // Hire Hazel: wage up front, then each morning. A clerk keeps it open 8 AM–8 PM.
  a.send({ type: 'stop' });
  a.send({ type: 'bizHire', staff: 'hazel' });
  assert.equal(shop.biz.staff, 'hazel');
  // Walk-in customers: with fair prices, someone buys within a few in-game hours.
  shop.obj['3,3'].stock[0].price = 100;
  const sold = sa.profile.biz.sales.items;
  for (let i = 0; i < 200 && sa.profile.biz.sales.items === sold; i++) { advance(HOUR_MS / 6); const { hours } = (await import('../../shared/world.js')).worldClock(game.now(), game.epoch); if (hours < 8 || hours >= 20) continue; game.biz.tick(game.now()); }
  assert.ok(sa.profile.biz.sales.items > sold, 'a customer bought something');
  // Next morning Hazel's wage is paid; if you're broke, she quits.
  sa.profile.coins = 10;
  advance(24 * HOUR_MS); game.biz.nextSale = 0; game.biz.tick(game.now());
  assert.equal(sa.profile.biz.staff, null);
  assert.equal(shop.biz.staff, null);
});

test('walls: paint each side, fill a room or the outside; double doors, shopfronts and door colours', async () => {
  const { rotateTimes, extract } = await import('../../shared/blueprint.js');
  const { featurePair } = await import('../../shared/plot.js');
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  stand(game, a, 0, 1, 14);
  // A 4×3 room (walls + floor) at (2,2).
  a.send({ type: 'placeBlueprint', plotId: 0, src: 'styled', id: 'bathroom', x: 2, y: 2 });
  const wk = Object.keys(plot.walls).find((k) => k.startsWith('0:h:') && k.endsWith(':2'));   // a north wall
  const [, , wx, wy] = wk.split(':');
  const m0 = plot.walls[wk].m;
  // Paint only the outside (north side 0) of one wall.
  a.send({ type: 'wallPaint', plotId: 0, d: 'h', x: +wx, y: +wy, side: 0, m: 'wall_shopfront' });
  assert.equal(plot.walls[wk].m, 'wall_shopfront');
  assert.equal(plot.walls[wk].o, m0, 'inside keeps its paint');
  // Shift: the whole room's inside faces get wallpaper; the outside of that wall stays.
  a.send({ type: 'wallPaint', plotId: 0, d: 'h', x: +wx, y: +wy, side: 1, m: 'wall_paper', fill: 'room' });
  assert.equal(plot.walls[wk].o, 'wall_paper');
  assert.equal(plot.walls[wk].m, 'wall_shopfront');
  const inside = Object.values(plot.walls).filter((w) => w.o === 'wall_paper' || w.m === 'wall_paper').length;
  assert.ok(inside >= 8, `room painted (${inside} faces)`);
  // Outside fill: every outward face.
  a.send({ type: 'wallPaint', plotId: 0, d: 'h', x: +wx, y: +wy, side: 0, m: 'wall_stucco', fill: 'outside' });
  assert.ok(Object.values(plot.walls).every((w) => [w.m, w.o].includes('wall_stucco')), 'every wall got stucco outside');
  assert.ok(Object.values(plot.walls).every((w) => [w.m, w.o].includes('wall_paper')), 'and kept wallpaper inside');
  // Turning the room keeps paints on the right sides (four turns = unchanged).
  const frag = extract(plot);
  assert.deepEqual(rotateTimes(frag, 4).walls, frag.walls);
  // Double doors: two segments; they come out together.
  a.send({ type: 'feature', plotId: 0, d: 'h', x: +wx, y: +wy, f: 'door_shopdouble' });
  const k2 = `0:h:${+wx + 1}:${wy}`;
  if (plot.walls[k2]) {
    assert.equal(plot.walls[wk].f, 'door_shopdouble');
    assert.equal(plot.walls[k2].f, 'door_shopdouble');
    assert.equal(featurePair(plot, 0, 'h', +wx + 1, +wy).part, 1);
    // Door colour (both halves).
    a.send({ type: 'design', plotId: 0, edge: ['h', +wx, +wy] });
    assert.equal(plot.walls[wk].fc, 1); assert.equal(plot.walls[k2].fc, 1);
    a.send({ type: 'remove', plotId: 0, edge: ['h', +wx + 1, +wy], featureOnly: true });
    assert.equal(plot.walls[wk].f, undefined); assert.equal(plot.walls[k2].f, undefined);
  }
  // Storefront window on a single segment.
  a.send({ type: 'feature', plotId: 0, d: 'h', x: +wx, y: +wy, f: 'window_shop' });
  assert.equal(plot.walls[wk].f, 'window_shop');
});

test('sleeping: when everyone online is in bed the village skips to 6 AM; rows harvest at once', async () => {
  const { worldClock } = await import('../../shared/world.js');
  const { HOUR_MS } = await import('../../shared/needs.js');
  const { game, join, advance } = setup();
  const a = await join({ name: 'Ana' }), b = await join({ name: 'Ben' });
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  a.send({ type: 'place', plotId: 0, lx: 2, ly: 2, item: 'bed' });
  // A row of turnips planted now.
  for (let x = 4; x < 8; x++) { a.send({ type: 'place', plotId: 0, lx: x, ly: 10, item: 'soil' }); a.send({ type: 'place', plotId: 0, lx: x, ly: 10, item: 'seed_turnip' }); }
  advance(14 * HOUR_MS); game.tick(); // evening
  const before = worldClock(game.now(), game.epoch);
  stand(game, a, 0, 3, 3);
  a.send({ type: 'use', plotId: 0, lx: 2, ly: 2, act: 'sleep' });
  for (let i = 0; i < 40; i++) { advance(100); game.tick(); }
  assert.equal(worldClock(game.now(), game.epoch).day, before.day, 'Ben is awake: no skip');
  assert.match(a.last('toast').text, /1\/2 asleep/);
  // Ben logs off: Ana's the only one, asleep -> morning.
  game.leave(b.session());
  for (let i = 0; i < 40; i++) { advance(100); game.tick(); }
  const after = worldClock(game.now(), game.epoch);
  assert.equal(after.day, before.day + 1);
  assert.equal(after.shownHours, 6);
  assert.match(a.last('toast').text, /Good morning/);
  assert.equal(a.session().act, null, 'woken up');
  assert.ok(a.session().profile.needs.energy > 99, 'rested');
  assert.ok(a.last('epoch'));
  // The turnips grew overnight: walk into the row and pick all four at once.
  a.send({ type: 'harvest', plotId: 0, tiles: [[4, 10], [5, 10], [6, 10], [7, 10]] });
  assert.equal(a.session().profile.inv.turnip, 4);
  assert.equal(plot.obj['5,10'], undefined);
});
