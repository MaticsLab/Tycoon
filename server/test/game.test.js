import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generateWorld, canStand, TILE, T, MAP_W } from '../../shared/world.js';
import { START_COINS, ITEMS, CROPS } from '../../shared/catalog.js';

function setup() {
  let clock = 1_000_000;
  const game = new Game({}, () => clock);
  const join = (name, token) => {
    const inbox = [];
    const conn = { sendRaw: (d) => inbox.push(JSON.parse(d)), close() {} };
    const h = game.attach(conn);
    h.onMessage(JSON.stringify({ type: 'hello', name, token }));
    const send = (m) => h.onMessage(JSON.stringify(m));
    const last = (type) => inbox.filter((m) => m.type === type).at(-1);
    return { inbox, send, last, h, welcome: inbox[0] };
  };
  return { game, join, advance: (ms) => { clock += ms; } };
}

test('world has 14 plots and a walkable spawn', () => {
  const w = generateWorld();
  assert.equal(w.plots.length, 14);
  assert.ok(canStand(w, [], w.spawn.x, w.spawn.y));
  for (const p of w.plots) {
    for (const gx of p.gate) assert.equal(w.tiles[p.gateY * MAP_W + gx], T.GATE);
  }
});

test('join, claim a plot, build and get refunds', () => {
  const { game, join } = setup();
  const a = join('Ana');
  assert.equal(a.welcome.type, 'welcome');
  assert.equal(a.welcome.you.coins, START_COINS);
  assert.equal(a.welcome.plots.length, 14);

  a.send({ type: 'claim', plotId: 3 });
  assert.equal(a.last('claimed').plotId, 3);
  assert.equal(game.plots[3].ownerName, 'Ana');

  a.send({ type: 'place', plotId: 3, lx: 2, ly: 2, item: 'wall_wood' });
  assert.equal(game.plots[3].obj['2,2'].t, 'wall_wood');
  assert.equal(a.last('coins').coins, START_COINS - ITEMS.wall_wood.price);

  // Fence ring is not buildable.
  a.send({ type: 'place', plotId: 3, lx: 0, ly: 0, item: 'wall_wood' });
  assert.equal(game.plots[3].obj['0,0'], undefined);

  a.send({ type: 'remove', plotId: 3, lx: 2, ly: 2 });
  assert.equal(game.plots[3].obj['2,2'], undefined);
  assert.equal(a.last('coins').coins, START_COINS);
});

test("cannot claim twice or build on someone else's plot", () => {
  const { game, join } = setup();
  const a = join('Ana');
  const b = join('Ben');
  a.send({ type: 'claim', plotId: 0 });
  a.send({ type: 'claim', plotId: 1 });
  assert.equal(game.plots[1].owner, null);
  b.send({ type: 'claim', plotId: 0 });
  assert.equal(game.plots[0].owner, a.welcome.you.id);
  b.send({ type: 'place', plotId: 0, lx: 3, ly: 3, item: 'bed' });
  assert.equal(game.plots[0].obj['3,3'], undefined);
  assert.match(b.last('error').msg, /isn't your plot/);
});

test('crops grow and harvest for coins', () => {
  const { game, join, advance } = setup();
  const a = join('Ana');
  a.send({ type: 'claim', plotId: 5 });
  a.send({ type: 'place', plotId: 5, lx: 4, ly: 4, item: 'seed_turnip' });
  assert.match(a.last('error').msg, /soil/);
  a.send({ type: 'place', plotId: 5, lx: 4, ly: 4, item: 'soil' });
  a.send({ type: 'place', plotId: 5, lx: 4, ly: 4, item: 'seed_turnip' });
  const before = a.last('coins').coins;
  a.send({ type: 'harvest', plotId: 5 });
  assert.equal(a.last('coins').coins, before, 'unripe crop should not harvest');
  advance(CROPS.turnip.growMs);
  a.send({ type: 'harvest', plotId: 5 });
  assert.equal(a.last('coins').coins, before + CROPS.turnip.sell);
  assert.equal(game.plots[5].obj['4,4'], undefined);
  assert.equal(game.plots[5].floor['4,4'], 'soil');
});

test('movement is validated against speed and walls', () => {
  const { game, join, advance } = setup();
  const a = join('Ana');
  const s = game.sessions.get(a.welcome.you.id);
  const { x, y } = s;
  a.send({ type: 'move', x: x + 500, y, d: 3, m: 1 });
  assert.equal(s.x, x);
  assert.ok(a.last('pos'));
  advance(100);
  a.send({ type: 'move', x: x + 7, y, d: 3, m: 1 });
  assert.equal(s.x, x + 7);
  // Walking into the fountain is rejected.
  advance(1000);
  a.send({ type: 'move', x: 41.5 * TILE, y: 26 * TILE, d: 1, m: 1 });
  assert.notEqual(s.y, 26 * TILE);
});

test('profile and plot persist across reconnect via token', () => {
  const { game, join } = setup();
  const a = join('Ana');
  a.send({ type: 'claim', plotId: 7 });
  a.h.onClose();
  const again = join('Ana2', a.welcome.token);
  assert.equal(again.welcome.you.id, a.welcome.you.id);
  assert.equal(again.welcome.you.plotId, 7);
  assert.equal(game.plots[7].ownerName, 'Ana2');
  const saved = JSON.parse(JSON.stringify(game.snapshot()));
  const reloaded = new Game(saved);
  assert.equal(reloaded.plots[7].owner, a.welcome.you.id);
});

test('"home" lands on a walkable tile outside every plot gate', () => {
  const { game, join } = setup();
  const a = join('Ana');
  const s = game.sessions.get(a.welcome.you.id);
  for (const p of game.world.plots) {
    s.profile.plotId = p.id;
    a.send({ type: 'home' });
    assert.ok(canStand(game.world, game.plots, s.x, s.y), `plot ${p.id}`);
  }
});
