// Villager requests ("quests"). The game picks what's asked (so it's always doable and
// checkable) and the villager's AI writes how they ask for it.
//   deliver  bring them N of something (a crop or a gift)
//   build    put a particular piece of furniture in your home
//   do       do an activity N times (cook a meal, read a book, paint...)
//   visit    carry a message to another villager
import { GOODS, ITEMS } from './catalog.js';
import { ACTIVITIES } from './needs.js';
import { NPCS } from './npcs.js';

export const MAX_QUESTS = 3;

// What each villager tends to ask for.
const WANTS = {
  rosa: { deliver: ['turnip', 'carrot', 'berry', 'pumpkin', 'egg', 'milk', 'corn'], build: ['stove', 'table', 'counter', 'island', 'houseplant'], do: ['cook', 'snack'], visit: ['otto', 'juniper', 'mabel'] },
  otto: { deliver: ['honeycake', 'bookgift', 'tea'], build: ['chair', 'bookshelf', 'rockingchair', 'desk', 'wardrobe'], do: ['read', 'sit'], visit: ['rosa', 'mabel'] },
  juniper: { deliver: ['berry', 'pumpkin', 'bouquet', 'tea'], build: ['houseplant', 'monstera', 'cactus', 'succulents', 'flowerbed', 'birdbath'], do: ['paint', 'stars', 'nap'], visit: ['rosa', 'otto', 'mabel'] },
  mabel: { deliver: ['tea', 'bookgift', 'honeycake'], build: ['desk', 'bookshelf', 'lowshelf', 'grandclock'], do: ['read', 'music'], visit: ['otto', 'juniper', 'rosa'] },
};

// Ready-made wording for when the AI isn't around (it normally writes these).
const FALLBACK = {
  deliver: (q) => `Could you bring me ${q.n > 1 ? `${q.n} ` : 'a '}${GOODS[q.item].name}${q.n > 1 ? 's' : ''}? I’d be ever so grateful.`,
  build: (q) => `I keep picturing your place with a ${ITEMS[q.item].name.toLowerCase()} in it. Humour me and put one in?`,
  do: (q) => `You look like you need to ${ACTIVITIES[q.act].label.toLowerCase()}${q.n > 1 ? ` ${q.n} times` : ''}. Doctor’s orders. Well, my orders.`,
  visit: (q) => `Would you tell ${NPCS[q.target].name} something for me? Just say: “${q.message}”`,
};
const MESSAGES = {
  rosa: ['the pie dish is ready to collect', 'I saved them a slice', 'the turnips are in, finally'],
  otto: ['the chair is done, and no, it does not wobble', 'I want my good chisel back', 'thank you for the honey cake (I said it, don’t make it weird)'],
  juniper: ['the roses have been talking about them', 'the moon is extra round tonight', 'a snail moved into the fountain'],
  mabel: ['their form is missing a signature', 'the council meets at noon sharp', 'please return the library book'],
};

// A new request from `npc` for a player. rand: () => 0..1. have: the player's progress
// counters (to measure 'do' quests from now on). Returns a quest object without text.
export function makeQuest(npc, rand = Math.random, { day = 0, stats = {} } = {}) {
  const w = WANTS[npc];
  if (!w) return null;
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const kind = pick(['deliver', 'deliver', 'build', 'do', 'visit']);
  const id = `${npc}-${day}-${Math.floor(rand() * 1e6).toString(36)}`;
  const q = { id, npc, kind, day, status: 'offered' };
  if (kind === 'deliver') {
    q.item = pick(w.deliver);
    const value = GOODS[q.item].value;
    q.n = value >= 100 ? 1 : value >= 40 ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 3);
    q.reward = Math.round(value * q.n * 1.6 + 20);
  } else if (kind === 'build') {
    q.item = pick(w.build.filter((t) => ITEMS[t])); // shop pieces mean a trip to Otto's first
    q.reward = Math.round(Math.min(220, (ITEMS[q.item]?.price || 40) * 1.3 + 25));
  } else if (kind === 'do') {
    q.act = pick(w.do);
    q.n = q.act === 'nap' || q.act === 'stars' ? 1 : 1 + Math.floor(rand() * 2);
    q.base = stats[q.act] || 0;
    q.reward = 30 + q.n * 25;
  } else {
    q.target = pick(w.visit);
    q.message = pick(MESSAGES[npc]);
    q.reward = 35;
  }
  q.text = FALLBACK[kind](q);
  return q;
}

// Is the request done? plot: the player's plot (for build), inv: their bag,
// stats: activity counters.
export function questProgress(q, { inv = {}, stats = {}, plot = null } = {}) {
  if (q.kind === 'deliver') { const have = inv[q.item] || 0; return { have: Math.min(have, q.n), need: q.n, ready: have >= q.n }; }
  if (q.kind === 'build') {
    const has = !!plot && [plot.obj, plot.l1?.obj].some((v) => v && Object.values(v).some((o) => o.t === q.item));
    return { have: has ? 1 : 0, need: 1, ready: has };
  }
  if (q.kind === 'do') { const did = Math.max(0, (stats[q.act] || 0) - (q.base || 0)); return { have: Math.min(did, q.n), need: q.n, ready: did >= q.n }; }
  return { have: q.delivered ? 1 : 0, need: 1, ready: !!q.delivered };
}

// Short summary line for the quest log.
export function questGoal(q) {
  if (q.kind === 'deliver') return `Bring ${NPCS[q.npc].name} ${q.n} × ${GOODS[q.item].name}`;
  if (q.kind === 'build') return `Put a ${ITEMS[q.item].name} in your home, then tell ${NPCS[q.npc].name}`;
  if (q.kind === 'do') return `${ACTIVITIES[q.act].label}${q.n > 1 ? ` ×${q.n}` : ''}, then tell ${NPCS[q.npc].name}`;
  return `Tell ${NPCS[q.target].name}: “${q.message}”`;
}
