import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generateWorld, TILE, T, MAP_W, STARTER_PLOTS, WORLD_VERSION } from '../../shared/world.js';
import { canStand, objAt, rectEdges, edgeKey, levelView, gateTiles, LAND_PRICE, heightAt, LEVEL_H } from '../../shared/plot.js';
import { START_COINS, ITEMS } from '../../shared/catalog.js';
import { NPCS } from '../../shared/npcs.js';

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

test('a new world has 14 roadside plots, two shops and a walkable spawn', () => {
  const game = new Game({});
  const w = game.world;
  assert.equal(Object.keys(game.plots).length, STARTER_PLOTS.length);
  assert.equal(w.shops.length, 2);
  assert.ok(canStand(w, game.plots, w.spawn.x, w.spawn.y));
  for (const n of Object.values(NPCS)) assert.ok(canStand(w, game.plots, n.home.x, n.home.y), n.name);
  // Every plot's gate opens onto a road.
  for (const p of Object.values(game.plots)) for (const gx of gateTiles(p)) assert.equal(w.tiles[(p.y + p.h) * MAP_W + p.x + gx], T.PATH);
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

test('NPCs wander but stay on walkable ground', () => {
  let clock = 0;
  const game = new Game({}, { now: () => clock });
  game.sessions.set('x', { profile: { id: 'x', uid: 'x', name: 'X' }, x: 0, y: 0, greeted: {}, sendRaw() {} });
  for (let i = 0; i < 3000; i++) { clock += 100; game.tick(); }
  for (const n of Object.values(game.npcs)) {
    assert.ok(canStand(game.world, game.plots, n.x, n.y), n.id);
    assert.ok(Math.hypot(n.x - n.def.home.x, n.y - n.def.home.y) <= n.def.wander + 1, n.id);
  }
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

  // Doors need a wall; walls must stay inside the fence.
  a.send({ type: 'feature', plotId: 0, d: 'h', x: 9, y: 9, f: 'door' });
  assert.match(a.last('error').msg, /into a wall/);
  a.send({ type: 'walls', plotId: 0, m: 'wall_brick', segs: [['h', 3, 0]] });
  assert.match(a.last('error').msg, /inside your fence/);

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

test('fences block the plot border except at the gate', async () => {
  const game = new Game({});
  const p = game.plots[4];
  const [g0] = gateTiles(p);
  const southY = (p.y + p.h) * TILE;
  // Crossing the south fence away from the gate is blocked...
  assert.ok(!canStand(game.world, game.plots, (p.x + 2.5) * TILE, southY + 2));
  // ...but the gate is open.
  assert.ok(canStand(game.world, game.plots, (p.x + g0 + 1) * TILE, southY + 2));
  // Side fences block too.
  assert.ok(!canStand(game.world, game.plots, p.x * TILE + 2, (p.y + 5) * TILE));
});

test('land: grow into open land, shrink, merge with the empty plot next door, split', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  a.send({ type: 'claim', plotId: 0 });
  const plot = game.plots[0];
  stand(game, a, 1, 2, 2); // stand on the neighbouring plot, out of the way
  a.send({ type: 'place', plotId: 0, lx: 2, ly: 3, item: 'lamp' });
  const coins0 = a.last('coins').coins;
  // Plot 0 is x 5..28; open land runs to x 33. Grow 3 tiles east.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: plot.w + 3, h: plot.h });
  assert.equal(plot.w, 27);
  assert.equal(a.last('coins').coins, coins0 - 3 * plot.h * LAND_PRICE);
  // Can't overlap the next plot (x 34+).
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: 31, h: plot.h });
  assert.match(a.last('error').msg, /Overlaps/);
  // Must stay on the road.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y, w: plot.w, h: plot.h - 2 });
  assert.match(a.last('error').msg, /road/);
  // Shrinking from the north keeps furniture where it stands in the world.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y + 2, w: plot.w, h: plot.h - 2 });
  assert.equal(plot.h, 16);
  assert.equal(plot.obj['2,1'].t, 'lamp', 'lamp shifted to the new local coordinates');
  // Can't shrink over the house.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x + 3, y: plot.y, w: plot.w - 3, h: plot.h });
  assert.match(a.last('error').msg, /fit/);

  // Merge with plot 1 (empty, for sale) after making the depths match again.
  a.send({ type: 'resizePlot', plotId: 0, x: plot.x, y: plot.y - 2, w: 29, h: 18 });
  assert.equal(plot.x + plot.w, game.plots[1].x);
  assert.equal(plot.obj['2,3'].t, 'lamp', 'growing north shifts it back');
  const s = a.session(); s.x = game.world.spawn.x; s.y = game.world.spawn.y;
  a.send({ type: 'cheat', cmd: 'testingcheats true' });
  a.send({ type: 'cheat', cmd: 'motherlode' });
  a.send({ type: 'mergePlot', plotId: 0, other: 1 });
  assert.equal(game.plots[1], undefined);
  assert.equal(plot.w, 29 + 24);
  assert.ok(a.inbox.some((m) => m.type === 'plotRemoved' && m.id === 1));
  assert.equal(game.world.plotAt[(plot.y + 1) * MAP_W + plot.x + 40], 0, 'merged land belongs to the plot');

  // Split off the empty east side: it becomes a new plot for sale.
  a.send({ type: 'splitPlot', plotId: 0, at: plot.x + 20 });
  const fresh = Object.values(game.plots).find((p) => p.id >= 14);
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
  a.send({ type: 'resizePlot', plotId: 2, x: game.plots[2].x, y: game.plots[2].y, w: 28, h: 18 });
  assert.equal(game.plots[2].w, 28);
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
