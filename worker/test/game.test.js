import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generateWorld, TILE, T, MAP_W } from '../../shared/world.js';
import { canStand, objAt } from '../../shared/plot.js';
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

test('world has 14 plots, two shops and a walkable spawn', () => {
  const w = generateWorld();
  assert.equal(w.plots.length, 14);
  assert.equal(w.shops.length, 2);
  assert.ok(canStand(w, [], w.spawn.x, w.spawn.y));
  for (const p of w.plots) for (const gx of p.gate) assert.equal(w.tiles[p.gateY * MAP_W + gx], T.GATE);
  for (const n of Object.values(NPCS)) assert.ok(canStand(w, [], n.home.x, n.home.y), n.name);
});

test('guests can claim a plot, build and get refunds', async () => {
  const { game, join } = setup();
  const a = await join({ name: 'Ana' });
  assert.equal(a.welcome.you.coins, START_COINS);
  a.send({ type: 'claim', plotId: 3 });
  assert.equal(a.last('claimed').plotId, 3);
  a.send({ type: 'place', plotId: 3, lx: 2, ly: 2, item: 'wall_wood' });
  assert.equal(game.plots[3].obj['2,2'].t, 'wall_wood');
  a.send({ type: 'place', plotId: 3, lx: 0, ly: 0, item: 'wall_wood' });
  assert.equal(game.plots[3].obj['0,0'], undefined);
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
  a.send({ type: 'place', plotId: 2, lx: 14, ly: 5, item: 'bed', r: 1 });
  assert.equal(objAt(plot, 14, 5), null);
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
  for (const p of game.world.plots) {
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
