// Village festivals: every 7th day there's a contest at the Harvest Fair. Bring your
// best entry (anything of the right kind from your bag) before 6 PM; the judges score
// it by value and quality, and the top three win prizes (and a trophy for first).
import { GOODS } from './catalog.js';
import { QUALITY } from './farm.js';

export const EVENT_EVERY = 7;
export const JUDGE_HOUR = 18;
export const EVENTS = {
  harvest: { name: 'Harvest Festival', icon: '🎃', what: 'your finest crop', kinds: ['produce'] },
  derby: { name: 'Fishing Derby', icon: '🎣', what: 'your best catch', kinds: ['fish'] },
  bakeoff: { name: 'Great Bake-Off', icon: '🥧', what: 'your best homemade product', kinds: ['product'] },
  fair: { name: 'Animal Fair', icon: '🐄', what: 'your best egg, milk or wool', kinds: ['animal'] },
};
export const PRIZES = [500, 250, 100];
const ORDER = ['harvest', 'derby', 'bakeoff', 'fair'];

// The festival on `day`, or null.
export function eventOn(day) {
  if (day % EVENT_EVERY !== 0) return null;
  return ORDER[Math.floor(day / EVENT_EVERY) % ORDER.length];
}
// The next festival day on or after `day`.
export function nextEvent(day) {
  let d = day;
  while (!eventOn(d)) d++;
  return { day: d, id: eventOn(d) };
}
export const canEnter = (eventId, item) => !!GOODS[item] && EVENTS[eventId].kinds.includes(GOODS[item].kind);
export const scoreOf = (item, q) => Math.round((GOODS[item]?.value || 0) * QUALITY[q || 0].mult);
