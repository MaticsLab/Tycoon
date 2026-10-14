// How you feel (The Sims style): moodlets from what you do and where you go, a mood made
// of those and your needs (which changes how fast the needs run down), and now and then
// a thought and a whim: a small wish the AI picks for you from things you could
// really do right now. Follow a whim for a few coins and a good mood.
import { MOODLETS, activeMoodlets, moodScore, moodLevel, decayFor, NEEDS, ACTIVITIES, HOUR_MS, PLATES } from '../../shared/needs.js';
import { TILE, worldClock, publicAreaAt } from '../../shared/world.js';

const SCENIC = new Set(['Seashell Beach', 'Eagle Lookout', 'The Highlands', 'Pine Hollow Campsite', 'Gull Point', 'Duck Pond', 'Willow Park', 'Riverside Green', 'Standing Stones']);
const FUN_ACTS = ['read', 'tv', 'game', 'piano', 'music', 'paint', 'stars', 'fish', 'bath', 'cook', 'warm'];
const NICE_PLACES = ['Seashell Beach', 'Eagle Lookout', 'Pine Hollow Campsite', 'Duck Pond', 'Standing Stones', 'Riverside Green', 'Gull Point', 'Willow Park', 'Town Square'];
const THOUGHT_EVERY = 3 * HOUR_MS; // in-game hours between thoughts
const WHIM_SCHEMA = {
  type: 'object',
  properties: { thought: { type: 'string', maxLength: 140 }, pick: { type: 'integer' }, whim: { type: 'string', maxLength: 90 } },
  required: ['thought', 'pick', 'whim'],
};
const asJson = (out) => {
  if (out && typeof out === 'object') return out;
  const m = String(out || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const tidy = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Mood {
  constructor(game) { this.game = game; }

  // ---------- moodlets ----------
  give(s, id) {
    const m = MOODLETS[id];
    if (!m?.hours) return;
    const pr = s.profile, now = this.game.now();
    const had = (pr.moodlets ||= {})[id] > now;
    pr.moodlets[id] = now + m.hours * HOUR_MS;
    if (!had) s.send({ type: 'toast', text: `${m.icon} ${m.label}` });
    this.game.markProfile(pr);
  }
  ids(s, now = this.game.now()) { return activeMoodlets(s.profile.needs, s.profile.moodlets || {}, now); }
  score(s, now) { return moodScore(s.profile.needs, this.ids(s, now)); }
  decay(s, now) { return decayFor(this.score(s, now)); }

  // What the client shows: mood, moodlets (with how long they've left), thought, whim.
  view(s) {
    const now = this.game.now(), ids = this.ids(s, now), score = moodScore(s.profile.needs, ids);
    return {
      score, level: moodLevel(score),
      moodlets: ids.map((id) => [id, MOODLETS[id].hours ? Math.max(0, Math.round((s.profile.moodlets[id] - now) / 1000)) : null]),
      thought: s.profile.thought || null, whim: s.profile.whim || null,
    };
  }

  // ---------- events from the game ----------
  activityEnded(s, act, done, hours) {
    const n = s.profile.needs;
    if (act === 'sleep' && n.energy >= 95) this.give(s, 'rested');
    if ((act === 'shower' || act === 'bath') && n.hygiene >= 90) this.give(s, 'fresh');
    if (FUN_ACTS.includes(act) && n.fun >= 85) this.give(s, 'delighted');
    const w = s.profile.whim;
    if (w?.kind === 'do' && w.act === act && (done || hours >= 0.25)) this.fulfil(s);
  }
  ate(s, { plate, food }) {
    if ((plate && PLATES[plate]?.hunger >= 60) || (food?.hunger >= 35)) this.give(s, 'wellfed');
  }
  chatted(s) {
    this.give(s, 'social');
    if (s.profile.whim?.kind === 'talk') this.fulfil(s);
  }
  gave(s) {
    this.give(s, 'generous');
    if (s.profile.whim?.kind === 'gift') this.fulfil(s);
  }
  fainted(s) { this.give(s, 'fainted'); }

  // Every few seconds: lovely places, a warm fire, whims to check, thoughts to think.
  tick(s, now) {
    if (now - (s.moodTick || 0) < 3000) return;
    s.moodTick = now;
    const pr = s.profile, { day, hours } = worldClock(now, this.game.epoch);
    const area = publicAreaAt(Math.floor(s.x / TILE), Math.floor(s.y / TILE))?.name;
    if (area && SCENIC.has(area) && (s.scenic ||= {})[area] !== day) { s.scenic[area] = day; this.give(s, 'scenic'); }
    if (pr.whim?.kind === 'visit' && area === pr.whim.area) this.fulfil(s);
    if ((hours >= 18 || hours < 5) && this.nearFire(s) && !(pr.moodlets?.cozy > now + HOUR_MS)) this.give(s, 'cozy');
    // Forget old moodlets.
    for (const [k, t] of Object.entries(pr.moodlets || {})) if (t < now) delete pr.moodlets[k];
    // Time for a new thought (or something's urgent)?
    const low = NEEDS.find((n) => pr.needs[n.id] < 20);
    const due = !pr.thoughtAt || now - pr.thoughtAt > THOUGHT_EVERY || (low && pr.thoughtNeed !== low.id);
    if (due && !s.thinking) this.think(s, now, low).catch(() => {});
  }
  nearFire(s) {
    const g = this.game;
    for (const d of g.world.decor) if (d.t === 'firepit' && Math.hypot((d.x + 0.5) * TILE - s.x, (d.y + 0.5) * TILE - s.y) < TILE * 2.5) return true;
    const pid = g.world.plotAt[Math.floor(s.y / TILE) * g.world.w + Math.floor(s.x / TILE)];
    const plot = pid >= 0 ? g.plots[pid] : null;
    if (!plot) return false;
    for (const [k, o] of Object.entries(plot.obj)) {
      if (o.t !== 'fireplace' && o.t !== 'firepit') continue;
      const [x, y] = k.split(',').map(Number);
      if (Math.hypot((plot.x + x + 1) * TILE - s.x, (plot.y + y + 0.5) * TILE - s.y) < TILE * 2.5) return true;
    }
    return false;
  }

  // ---------- thoughts and whims ----------
  // Whims are things you can actually do from here: go somewhere lovely, do something
  // fun, chat with a villager, give a gift.
  candidates(s) {
    const pr = s.profile, n = pr.needs, out = [];
    const here = publicAreaAt(Math.floor(s.x / TILE), Math.floor(s.y / TILE))?.name;
    const places = NICE_PLACES.filter((p) => p !== here);
    out.push({ kind: 'visit', area: pick(places) });
    const acts = FUN_ACTS.filter((a) => a !== 'cook' || Object.values(pr.inv || {}).length);
    out.push({ kind: 'do', act: pick(acts) });
    out.push(Math.random() < 0.5 ? { kind: 'talk' } : Object.keys(pr.inv || {}).length ? { kind: 'gift' } : { kind: 'visit', area: pick(places) });
    if (n.fun < 40) out.unshift({ kind: 'do', act: pick(['game', 'piano', 'tv', 'paint']) });
    return out.slice(0, 3);
  }
  whimText(w) {
    if (w.kind === 'visit') return `Go to ${w.area}`;
    if (w.kind === 'do') return `${ACTIVITIES[w.act].label}`;
    if (w.kind === 'talk') return 'Have a chat with a villager';
    return 'Give a villager a gift';
  }
  async think(s, now, low) {
    s.thinking = true;
    try {
      const pr = s.profile, g = this.game;
      const { hours } = worldClock(now, g.epoch);
      const ids = this.ids(s, now), level = moodLevel(moodScore(pr.needs, ids));
      const cands = pr.whim ? null : this.candidates(s);
      const here = publicAreaAt(Math.floor(s.x / TILE), Math.floor(s.y / TILE))?.name || (g.world.plotAt[Math.floor(s.y / TILE) * g.world.w + Math.floor(s.x / TILE)] === pr.plotId ? 'at home' : 'out and about');
      let thought = null, whim = cands?.[0] || null, text = whim ? this.whimText(whim) : null;
      if (g.ai) {
        const msgs = [
          { role: 'system', content: [
            `You voice the inner thoughts of ${pr.name}, a villager in a cosy life-sim game (like The Sims). Write one short first-person thought (max 18 words), warm and a little funny, about how they feel right now.`,
            `Right now: ${Math.floor(hours)}:00, ${here}. Mood: ${level}. Needs (0-100): ${NEEDS.map((x) => `${x.name} ${Math.round(pr.needs[x.id])}`).join(', ')}. Feelings: ${ids.map((k) => MOODLETS[k].label).join(', ') || 'none in particular'}.`,
            low ? `Their ${low.name.toLowerCase()} is very low: the thought should be about that.` : '',
            cands ? `Also pick ONE whim from these options by index, and word it as a short wish (max 9 words): ${cands.map((c, i) => `${i}: ${this.whimText(c)}`).join(' | ')}` : 'They already have a whim; set pick to -1 and whim to "".',
            'Respond with JSON: {"thought": "...", "pick": 0, "whim": "..."}',
          ].filter(Boolean).join('\n') },
          { role: 'user', content: 'Think.' },
        ];
        const res = await g.ai(msgs, WHIM_SCHEMA, (out) => { const o = asJson(out); return o && typeof o.thought === 'string' && o.thought.trim() ? o : null; }, { maxTokens: 120, temperature: 0.9 }).catch(() => null);
        if (res) {
          thought = tidy(res.thought, 140);
          if (cands && Number.isInteger(res.pick) && cands[res.pick]) { whim = cands[res.pick]; text = tidy(res.whim, 90) || this.whimText(whim); }
        }
      }
      if (!thought) thought = this.fallbackThought(pr, low, hours, ids);
      pr.thought = thought;
      pr.thoughtAt = now;
      pr.thoughtNeed = low?.id || null;
      if (cands && whim) pr.whim = { ...whim, text, reward: 20 + Math.floor(Math.random() * 3) * 10, at: now };
      g.markProfile(pr);
      g.sendNeeds(s);
    } finally { s.thinking = false; }
  }
  fallbackThought(pr, low, hours, ids) {
    if (low) return {
      hunger: 'My stomach is making noises I didn’t know it could make.', energy: 'If I blink slowly enough, does that count as a nap?',
      bladder: 'I really, really need to find a loo. Right now.', hygiene: 'Is that smell… me? It’s me, isn’t it.', fun: 'I am SO bored. Even the rocks look more fun than me.',
    }[low.id];
    if (ids.includes('scenic')) return 'What a view. I should come here more often.';
    if (ids.includes('rested')) return 'Slept like a log. Today’s going to be a good one.';
    if (hours >= 21 || hours < 5) return 'It’s getting late. A warm bed sounds perfect.';
    return pick(['What a lovely day for a wander.', 'I wonder what everyone’s up to in the square.', 'I could do with a little adventure today.', 'Maybe I’ll treat myself to something nice.']);
  }
  fulfil(s) {
    const pr = s.profile, w = pr.whim;
    if (!w) return;
    pr.whim = null;
    this.game.coins(s, w.reward);
    this.give(s, 'whim');
    s.send({ type: 'toast', text: `✨ Whim fulfilled: ${w.text} · +🪙${w.reward}` });
    pr.thoughtAt = 0; // a fresh thought (and whim) soon
    this.game.markProfile(pr);
    this.game.sendNeeds(s);
  }
  dismiss(s) { s.profile.whim = null; s.profile.thoughtAt = 0; this.game.sendNeeds(s); }
}
