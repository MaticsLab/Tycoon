// Sims-style needs. Every villager has five needs that run down while they're online,
// plus health, which falls while any need is empty and recovers while they're all fine.
// All values are 0..100; rates are per in-game hour (36 real seconds).
import { DAY_MS } from './world.js';
import { ITEMS } from './catalog.js';

export const HOUR_MS = DAY_MS / 24;

export const NEEDS = [
  { id: 'hunger', name: 'Hunger', icon: '🍽️', decay: 3.5, low: 'You’re hungry: grab a snack from the fridge or eat something from your bag' },
  { id: 'energy', name: 'Energy', icon: '⚡', decay: 2.5, low: 'You’re exhausted: get some sleep in a bed' },
  { id: 'bladder', name: 'Bladder', icon: '🚽', decay: 5, low: 'You really need the toilet!' },
  { id: 'hygiene', name: 'Hygiene', icon: '🧼', decay: 2.5, low: 'You’re getting smelly: take a shower or a bath' },
  { id: 'fun', name: 'Fun', icon: '🎈', decay: 3, low: 'You’re bored: watch TV, read a book or play' },
];
export const HEALTH = { id: 'health', name: 'Health', icon: '❤️' };
export const NEED_IDS = [...NEEDS.map((n) => n.id), 'health'];

export const fullNeeds = () => ({ hunger: 90, energy: 90, bladder: 90, hygiene: 90, fun: 80, health: 100 });

export function sanitizeNeeds(n) {
  const d = fullNeeds();
  if (!n || typeof n !== 'object') return d;
  for (const k of NEED_IDS) if (Number.isFinite(n[k])) d[k] = Math.max(0, Math.min(100, n[k]));
  return d;
}

// Things you can do with furniture. gain: need -> points per in-game hour while doing it.
//   max: in-game hours before it stops by itself (else it stops when `until` is full)
//   cost: coins up front · seat: you sit/lie on the item (else you stand next to it)
//   stove: only when there's a stove on the same plot
//   makes: when it finishes you're holding a plate of that food (see PLATES)
//   carry: needs a plate in your hands (eating)
export const ACTIVITIES = {
  snack:  { label: 'Grab a snack', icon: '🥪', verb: 'Making a sandwich', gain: {}, max: 1 / 6, cost: 5, makes: 'snack' },
  cook:   { label: 'Cook a meal', icon: '🍳', verb: 'Cooking', gain: { fun: 10 }, max: 2 / 3, cost: 15, stove: true, makes: 'meal' },
  eat:    { label: 'Sit and eat', icon: '🍽️', verb: 'Eating', gain: { hunger: 150 }, max: 1, seat: true, carry: true },
  eatHere: { label: 'Eat standing up', icon: '🍽️', verb: 'Eating', gain: { hunger: 150 }, max: 1, carry: true },
  tv:     { label: 'Watch TV', icon: '📺', verb: 'Watching TV', gain: { fun: 30, energy: 1 }, until: 'fun', max: 4 },
  read:   { label: 'Read a book', icon: '📖', verb: 'Reading', gain: { fun: 20 }, until: 'fun', max: 3 },
  sleep:  { label: 'Sleep', icon: '💤', verb: 'Sleeping', gain: { energy: 14, health: 3 }, until: 'energy', max: 10, seat: true },
  nap:    { label: 'Take a nap', icon: '😪', verb: 'Napping', gain: { energy: 14 }, max: 1.5, seat: true },
  shower: { label: 'Take a shower', icon: '🚿', verb: 'Showering', gain: { hygiene: 150 }, until: 'hygiene', max: 1, seat: true },
  bath:   { label: 'Take a bath', icon: '🛁', verb: 'Bathing', gain: { hygiene: 100, fun: 10 }, until: 'hygiene', max: 1.5, seat: true },
  wash:   { label: 'Wash hands', icon: '🧼', verb: 'Washing up', gain: { hygiene: 60 }, max: 1 / 6 },
  toilet: { label: 'Use the toilet', icon: '🚽', verb: 'On the toilet', gain: { bladder: 400 }, until: 'bladder', max: 0.5, seat: true },
  sit:    { label: 'Sit and relax', icon: '🛋️', verb: 'Relaxing', gain: { energy: 4, fun: 5 }, max: 6, seat: true },
  piano:  { label: 'Play the piano', icon: '🎹', verb: 'Playing piano', gain: { fun: 35 }, until: 'fun', max: 3 },
  fish:   { label: 'Watch the fish', icon: '🐠', verb: 'Watching fish', gain: { fun: 15, energy: 2 }, until: 'fun', max: 2 },
  warm:   { label: 'Warm up by the fire', icon: '🔥', verb: 'Warming up', gain: { fun: 10, energy: 5 }, max: 2 },
  stars:  { label: 'Stargaze', icon: '🔭', verb: 'Stargazing', gain: { fun: 25 }, until: 'fun', max: 3 },
  game:   { label: 'Play video games', icon: '🎮', verb: 'Gaming', gain: { fun: 35 }, until: 'fun', max: 3 },
  music:  { label: 'Play some records', icon: '🎶', verb: 'Listening to music', gain: { fun: 22, energy: 2 }, until: 'fun', max: 3 },
  paint:  { label: 'Paint a picture', icon: '🎨', verb: 'Painting', gain: { fun: 28 }, until: 'fun', max: 3 },
  cashier: { label: 'Work the register', icon: '🧾', verb: 'Running the shop', gain: { fun: 6 }, max: 12, shop: true },
  grill:  { label: 'Fire up the grill', icon: '🌭', verb: 'Grilling', gain: { fun: 15 }, max: 2 / 3, cost: 12, makes: 'bbq' },
};

// Plates of food you carry from the kitchen to a seat. hunger: how much it fills.
export const PLATES = {
  snack: { name: 'Sandwich', icon: '🥪', hunger: 32 },
  meal: { name: 'Home-cooked meal', icon: '🍲', hunger: 80, fun: 6 },
  bbq: { name: 'Grilled hot dogs', icon: '🌭', hunger: 70, fun: 6 },
};

export const USES = {
  fridge: ['snack', 'cook'], stove: ['cook'],
  tv: ['tv'], bookshelf: ['read'], desk: ['read'],
  bed: ['sleep', 'nap'],
  shower: ['shower'], bathtub: ['bath'], sink: ['wash'], toilet: ['toilet'],
  sofa: ['eat', 'sit', 'nap'], armchair: ['eat', 'sit'], chair: ['eat', 'sit'], beanbag: ['eat', 'sit', 'nap'], bench: ['eat', 'sit'],
  piano: ['piano'], aquarium: ['fish'], fireplace: ['warm'], telescope: ['stars'],
  recliner: ['eat', 'sit', 'nap'], loveseat: ['eat', 'sit', 'nap'], pouf: ['eat', 'sit'], rockingchair: ['eat', 'sit'], barstool: ['eat', 'sit'],
  picnic: ['eat', 'sit'], hammock: ['nap', 'sit'], bunkbed: ['sleep', 'nap'],
  lowshelf: ['read'], recordplayer: ['music'], arcade: ['game'], easel: ['paint'],
  register: ['cashier'],
  kitchensink: ['wash'], pedestalsink: ['wash'], fishbowl: ['fish'], grill: ['grill'], firepit: ['warm'],
};

export const usesOf = (t) => USES[t] || [];

// Food you can eat straight from your bag: need -> points.
export const FOODS = {
  turnip: { hunger: 12 }, carrot: { hunger: 18 }, berry: { hunger: 10, fun: 6 }, pumpkin: { hunger: 40 },
  honeycake: { hunger: 25, fun: 10 }, tea: { energy: 12, fun: 4 },
  jam: { hunger: 18, fun: 8 }, juice: { energy: 14, hunger: 6 }, pie: { hunger: 45, fun: 15 }, bread: { hunger: 24 }, soup: { hunger: 35, fun: 4 },
  corn: { hunger: 16 }, melon: { hunger: 22, fun: 8 }, kale: { hunger: 14, health: 3 }, milk: { hunger: 10, energy: 6 },
  cheese: { hunger: 28, fun: 6 }, cake: { hunger: 40, fun: 18 },
  smokedfish: { hunger: 30, fun: 4 }, apple: { hunger: 10, fun: 3 }, fishstew: { hunger: 42, fun: 8 },
};

// Run needs forward by `hours` of in-game time while doing activity `act` (or nothing).
// Returns { needs, low: [need ids that just dropped under 15], faint: health hit 0 }.
export function advanceNeeds(needs, hours, act = null) {
  const n = { ...needs };
  const a = act && ACTIVITIES[act];
  const before = { ...n };
  for (const need of NEEDS) {
    const g = a?.gain?.[need.id];
    n[need.id] += g ? g * hours : -need.decay * hours;
  }
  // Health: down while needs are empty, slowly back up while they're all okay.
  const empty = NEEDS.filter((need) => n[need.id] <= 5).length;
  if (empty) n.health -= 4 * empty * hours;
  else if (NEEDS.every((need) => n[need.id] >= 30)) n.health += 1.5 * hours;
  if (a?.gain?.health) n.health += a.gain.health * hours;
  for (const k of NEED_IDS) n[k] = Math.max(0, Math.min(100, n[k]));
  const low = NEEDS.filter((need) => before[need.id] >= 15 && n[need.id] < 15).map((need) => need.id);
  return { needs: n, low, faint: n.health <= 0 };
}

// Overall mood (-1..1) from the needs, for the plumbob colour.
export function mood(needs) {
  const vals = NEEDS.map((n) => needs[n.id]);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.max(-1, Math.min(1, (Math.min(avg, Math.min(...vals) * 1.6) - 45) / 45)) * (needs.health < 40 ? 0.5 : 1) - (needs.health < 40 ? 0.5 : 0);
}

// Is this activity done? (its need is full, or it ran its time)
export function activityDone(act, needs, hours) {
  const a = ACTIVITIES[act];
  if (!a) return true;
  if (a.until && needs[a.until] >= 100) return true;
  return hours >= a.max;
}

export const isUsable = (t) => !!USES[t] && !!ITEMS[t];
