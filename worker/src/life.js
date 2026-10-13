// Village life on the server: each villager's day plan (routine + the AI's twist on it),
// friends meeting up for a chat (with AI-written banter that everyone nearby sees), and
// villagers' requests to players (offered, accepted, handed in).
import { NPCS } from '../../shared/npcs.js';
import { PLACES, NPC_ACTS, ROUTINES, stepAt } from '../../shared/village.js';
import { makeQuest, questProgress, questGoal, MAX_QUESTS } from '../../shared/quests.js';
import { TILE } from '../../shared/world.js';

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    choices: { type: 'array', items: { type: 'integer' } },
    thought: { type: 'string', maxLength: 160 },
    passing: { type: 'array', items: { type: 'string', maxLength: 70 } },
  },
  required: ['choices', 'thought'],
};
const BANTER_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, text: { type: 'string', maxLength: 110 } }, required: ['who', 'text'] } } },
  required: ['lines'],
};
const QUEST_SCHEMA = {
  type: 'object',
  properties: { ask: { type: 'string', maxLength: 260 }, thanks: { type: 'string', maxLength: 200 }, reply: { type: 'string', maxLength: 200 } },
  required: ['ask', 'thanks'],
};

const asJson = (out) => {
  if (out && typeof out === 'object') return out;
  const m = String(out || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const tidy = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Lines for when the AI isn't available.
const THOUGHTS = {
  rosa: ['perfecting a pumpkin pie that does not collapse', 'who keeps buying all the honey cake', 'whether Otto is secretly lonely (he is)'],
  otto: ['a chair leg that will not sit square', 'the racket the youth call music', 'finally finishing that rocking chair'],
  juniper: ['the snails are planning something', 'the sunflowers seem jealous of the pumpkins', 'naming every bee in the park'],
  mabel: ['Form 27-B needs a sequel', 'the fountain’s footfall is up 12 percent', 'colour-coding the council minutes'],
};
const BANTER = {
  'otto|rosa': [['rosa', 'Otto! You look like a man who skipped lunch.'], ['otto', 'I had sawdust. Very filling.'], ['rosa', 'I’m bringing you soup and you will like it.'], ['otto', '…Fine. But no carrots.']],
  'juniper|rosa': [['juniper', 'Rosa! The pumpkins asked about you.'], ['rosa', 'Did they now? What did they say?'], ['juniper', 'Mostly “please don’t make us into pie”.'], ['rosa', 'No promises, my dears.']],
  'juniper|mabel': [['juniper', 'Mabel, do snails need a permit?'], ['mabel', 'There is a form for that. There is a form for everything.'], ['juniper', 'Even for moonlight?'], ['mabel', '…I’ll draft one.']],
  'mabel|otto': [['mabel', 'Otto, your bench is the most sat-on in the village. 41 percent!'], ['otto', 'Of course it is. It’s a good bench.'], ['mabel', 'I’ve made a chart.'], ['otto', 'Please don’t show me the chart.']],
};

export class Life {
  constructor(game) {
    this.game = game;
    this.meetings = new Map(); // "a|b|at" -> { lines, i, next, asked }
  }

  get npcs() { return this.game.npcs; }

  // ---------- day plans ----------
  // Called every tick: start a new day at 5 AM, keep plans after a restart.
  ensurePlans(day) {
    if (this.planned === day) return;
    this.planned = day;
    const fresh = Object.values(this.npcs).some((n) => n.s.plan?.day !== day);
    if (!fresh) { for (const n of Object.values(this.npcs)) n.plan = n.s.plan.steps; return; }
    const plans = {};
    const choices = {};
    for (const id of Object.keys(this.npcs)) {
      choices[id] = (ROUTINES[id] || []).map((slot) => Math.floor(Math.random() * slot.opts.length));
      plans[id] = this.fromChoices(id, choices[id]);
    }
    this.linkMeetups(plans);
    // Every day has at least one get-together: if the dice gave none, Otto drops by
    // Rosa's in the evening (both are free then).
    if (!Object.values(plans).some((p) => p.some((st) => st.side === -1)) && plans.otto && plans.rosa) {
      const slot = (ROUTINES.otto || []).findIndex((sl) => sl.opts.some((o) => o[2] === 'rosa'));
      if (slot >= 0) {
        choices.otto[slot] = ROUTINES.otto[slot].opts.findIndex((o) => o[2] === 'rosa');
        for (const id of Object.keys(plans)) plans[id] = this.fromChoices(id, choices[id]);
        this.linkMeetups(plans);
      }
    }
    for (const [id, n] of Object.entries(this.npcs)) {
      const ts = THOUGHTS[id] || [''];
      n.setPlan(day, plans[id], ts[Math.floor(Math.random() * ts.length)]);
      this.game.mark(`npc:${id}`);
    }
    this.meetings.clear();
    if (this.game.ai) this.enrichDay(day).catch((e) => console.error('plan ai', e));
  }

  fromChoices(id, choices) {
    return (ROUTINES[id] || []).map((slot, i) => {
      const [place, act, withNpc] = slot.opts[Math.min(slot.opts.length - 1, Math.max(0, choices[i] | 0))];
      return { at: slot.at, place, act, ...(withNpc ? { with: withNpc } : {}) };
    });
  }

  // Friends meet up: when one plans a chat with another, the other comes too (and goes
  // back to what they were doing an hour later).
  linkMeetups(plans) {
    for (const [id, plan] of Object.entries(plans)) {
      for (const st of plan) {
        if (!st.with || st.side) continue;
        const other = plans[st.with];
        if (!other) { st.act = 'stroll'; delete st.with; continue; }
        const theirs = stepAt(other, st.at);
        if (theirs?.with || theirs?.act === 'sleep') { st.act = 'stroll'; delete st.with; continue; }
        st.side = -1;
        const resumeAt = st.at + 1;
        const resume = { ...stepAt(other, resumeAt) };
        other.push({ at: st.at, place: st.place, act: 'chat', with: id, side: 1 });
        if (!other.some((o) => o.at > st.at && o.at <= resumeAt)) other.push({ ...resume, at: resumeAt });
        other.sort((a, b) => a.at - b.at);
      }
    }
  }

  // Ask each villager's mind to pick today's options and say what's on their mind.
  async enrichDay(day) {
    for (const [id, n] of Object.entries(this.npcs)) {
      const routine = ROUTINES[id] || [];
      const menu = routine.map((slot, i) => `${i}. from ${fmtHour(slot.at)}: ${slot.opts.map(([p, a, w], j) => `[${j}] ${NPC_ACTS[a].verb} at ${PLACES[p].name}${w ? ` with ${NPCS[w].name}` : ''}`).join(' or ')}`).join('\n');
      const msgs = [
        { role: 'system', content: `You are ${n.def.name}. ${n.def.bio}\nYour sense of humour: ${n.def.humor || ''}\nIt's the start of day ${day} in the village. Recent village news:\n- ${this.game.gossip.slice(-4).join('\n- ') || 'nothing much'}\nPlan your day by choosing one option per time slot, decide what's on your mind today (one specific, funny sentence in third person, like a diary teaser), and write 3 short things you'd call out to a passer-by today (in your voice, under 60 characters each).\nRespond with JSON: {"choices": [option index per slot], "thought": "...", "passing": ["...", "...", "..."]}` },
        { role: 'user', content: `Today's slots:\n${menu}` },
      ];
      const res = await this.game.ai(msgs, PLAN_SCHEMA, (out) => {
        const o = asJson(out);
        if (!o || !Array.isArray(o.choices) || typeof o.thought !== 'string') return null;
        return o;
      }, { maxTokens: 260, temperature: 0.9 });
      if (!res || n.s.plan?.day !== day) continue;
      const plans = Object.fromEntries(Object.entries(this.npcs).map(([k, v]) => [k, v.plan]));
      plans[id] = this.fromChoices(id, res.choices);
      // Keep the friends who were already coming to meet up in sync.
      for (const st of n.plan || []) if (st.side === 1) plans[id].push(st);
      plans[id].sort((a, b) => a.at - b.at);
      this.linkMeetups({ [id]: plans[id], ...Object.fromEntries(Object.entries(plans).filter(([k]) => k !== id)) });
      n.setPlan(day, plans[id], tidy(res.thought, 160));
      n.s.plan.passing = (res.passing || []).map((p) => tidy(p, 70)).filter((p) => p.length > 2).slice(0, 3);
      for (const [k, v] of Object.entries(plans)) if (k !== id) { this.npcs[k].plan = v; this.npcs[k].s.plan.steps = v; }
      this.game.mark(`npc:${id}`);
    }
  }

  // ---------- friends chatting ----------
  // Every second or so: friends who are both at their meet-up trade lines in speech
  // bubbles (everyone nearby sees them).
  tickMeetups(now) {
    for (const n of Object.values(this.npcs)) {
      const st = n.step;
      if (n.act !== 'chat' || !st?.with || st.side !== -1) continue;
      const o = this.npcs[st.with];
      // They're there and free (chatting, or just pottering at the counter), not
      // walking, asleep or sat down somewhere else.
      if (!o || !o.act || o.path || NPC_ACTS[o.act]?.hidden || Math.hypot(o.x - n.x, o.y - n.y) > TILE * 3) continue;
      if (n.talkingTo || o.talkingTo) continue;
      const key = `${[n.id, o.id].sort().join('|')}|${st.at}`;
      let m = this.meetings.get(key);
      if (!m) {
        m = { lines: null, i: 0, next: now + 1500 };
        this.meetings.set(key, m);
        n.faceToward(o.x, o.y); o.faceToward(n.x, n.y);
        this.writeBanter(n, o, st).then((lines) => { m.lines = lines; });
      }
      if (!m.lines || now < m.next || m.i >= m.lines.length) continue;
      const [who, text] = m.lines[m.i++];
      const speaker = who === o.id ? o : n;
      this.game.broadcast({ type: 'npcBubble', id: speaker.id, text });
      m.next = now + Math.min(9000, 3500 + text.length * 55);
      if (m.i === m.lines.length && text.length > 20) this.game.addGossip(speaker.def.name, `${n.def.name} and ${o.def.name} were chatting at ${PLACES[st.place].name}`);
    }
  }

  async writeBanter(a, b, st) {
    const pair = [a.id, b.id].sort().join('|');
    const fallback = BANTER[pair] || [[a.id, `Evening, ${b.def.name}.`], [b.id, `Evening, ${a.def.name}. Nice night for it.`]];
    if (!this.game.ai) return fallback;
    const msgs = [
      { role: 'system', content: `Write a short, funny exchange between two villagers in a cozy farming village, meeting at ${PLACES[st.place].name}.\n${a.def.name}: ${a.def.bio} Humour: ${a.def.humor}. On their mind today: ${a.thought}\n${b.def.name}: ${b.def.bio} Humour: ${b.def.humor}. On their mind today: ${b.thought}\nVillage news they might bring up:\n- ${this.game.gossip.slice(-4).join('\n- ') || 'nothing much'}\nWrite 4 to 6 alternating lines, each under 100 characters, in their own voices, kind and silly (it's a family game). Respond with JSON: {"lines": [{"who": "${a.id}" or "${b.id}", "text": "..."}]}` },
      { role: 'user', content: 'Go.' },
    ];
    const res = await this.game.ai(msgs, BANTER_SCHEMA, (out) => {
      const o = asJson(out);
      const lines = (o?.lines || []).filter((l) => (l.who === a.id || l.who === b.id) && typeof l.text === 'string' && l.text.trim()).map((l) => [l.who, tidy(l.text, 110)]);
      return lines.length >= 2 ? lines.slice(0, 6) : null;
    }, { maxTokens: 320, temperature: 0.95 }).catch(() => null);
    return res || fallback;
  }

  // ---------- requests ----------
  state(p) {
    p.quests ||= [];
    p.stats ||= {};
    p.questOffered ||= {};
    return p;
  }

  // When you open a conversation: messages you're carrying for them get delivered, and
  // they may have a favour to ask.
  async onOpen(s, n) {
    const p = this.state(s.profile);
    for (const q of p.quests) {
      if (q.status !== 'active' || q.kind !== 'visit' || q.target !== n.id) continue;
      q.delivered = true;
      this.complete(s, q, q.reply || `Ha! Tell ${NPCS[q.npc].name} I said thanks.`, n);
    }
    const day = this.game.day();
    const active = p.quests.filter((q) => q.status === 'active');
    if (p.questOffered[n.id] === day || active.length >= MAX_QUESTS || active.some((q) => q.npc === n.id) || n.affinity(p) < -30) return;
    p.questOffered[n.id] = day;
    this.game.markProfile(p);
    const q = makeQuest(n.id, Math.random, { day, stats: p.stats });
    if (!q) return;
    q.thanks = 'You’re a star. Here, take this.';
    q.reply = q.kind === 'visit' ? `${NPCS[q.npc].name} said that? Well! Tell them I said hello back.` : '';
    await this.phrase(s, n, q);
    (s.offers ||= {})[n.id] = q;
    s.send({ type: 'questOffer', quest: this.view(s, q) });
  }

  // The villager's mind words the request (and the thank-you, and for messages, how
  // the other villager reacts), matching how this player talks.
  async phrase(s, n, q) {
    if (!this.game.ai) return;
    const r = n.rel(s.profile);
    const target = q.kind === 'visit' ? this.npcs[q.target] : null;
    const msgs = [
      { role: 'system', content: [
        `You are ${n.def.name}. ${n.def.bio}`,
        `Your sense of humour: ${n.def.humor}`,
        `You're asking ${s.profile.name} (relationship: ${Math.round(r.affinity)} from -100 to 100) for a favour: ${questGoal(q)}.${q.kind === 'visit' ? ` The message is: "${q.message}".` : ''} Reward: ${q.reward} coins.`,
        r.bits?.length ? `Running jokes with them: ${r.bits.join(' · ')}` : '',
        'Write how you ask (1-2 sentences, funny, in character, give a silly or sweet reason, mention exactly what you need), and what you say when they finish it (1 sentence).',
        target ? `Also write how ${target.def.name} reacts on hearing the message (1 sentence, in ${target.def.name}'s voice: ${target.def.humor})` : '',
        `Respond with JSON: {"ask": "...", "thanks": "..."${target ? ', "reply": "..."' : ''}}`,
      ].filter(Boolean).join('\n') },
      { role: 'user', content: 'Ask.' },
    ];
    const res = await this.game.ai(msgs, QUEST_SCHEMA, (out) => {
      const o = asJson(out);
      return o && typeof o.ask === 'string' && o.ask.trim() ? o : null;
    }, { maxTokens: 220, temperature: 0.9 }).catch(() => null);
    if (!res) return;
    q.text = tidy(res.ask, 260);
    if (res.thanks) q.thanks = tidy(res.thanks, 200);
    if (target && res.reply) q.reply = tidy(res.reply, 200);
  }

  accept(s, { id }) {
    const p = this.state(s.profile);
    const entry = Object.entries(s.offers || {}).find(([, q]) => q.id === id);
    if (!entry) return;
    const [npc, q] = entry;
    delete s.offers[npc];
    q.status = 'active';
    q.base = q.kind === 'do' ? p.stats[q.act] || 0 : q.base;
    p.quests.push(q);
    this.game.markProfile(p);
    const n = this.npcs[npc];
    if (n && n.talkingTo === p.id) s.send({ type: 'npcSay', text: ['Wonderful!', 'You’re a gem.', 'Knew I could count on you.'][Math.floor(Math.random() * 3)], sentiment: 1, changes: [], ...n.view(p, this.game.now()) });
    this.send(s);
  }

  decline(s, { id }) {
    for (const [npc, q] of Object.entries(s.offers || {})) if (q.id === id) delete s.offers[npc];
  }

  abandon(s, { id }) {
    const p = this.state(s.profile);
    const q = p.quests.find((x) => x.id === id && x.status === 'active');
    if (!q) return;
    q.status = 'dropped';
    this.trim(p);
    this.game.markProfile(p);
    this.send(s);
  }

  // Hand a finished request in to the villager who asked.
  turnIn(s, { id }) {
    const p = this.state(s.profile);
    const q = p.quests.find((x) => x.id === id && x.status === 'active');
    if (!q || q.kind === 'visit') return;
    const n = this.game.nearNpc(s, q.npc);
    if (!n) return;
    const prog = questProgress(q, { inv: p.inv, stats: p.stats, plot: this.game.plots[p.plotId] });
    if (!prog.ready) return s.send({ type: 'error', msg: `Not yet: ${questGoal(q)} (${prog.have}/${prog.need})` });
    if (q.kind === 'deliver') this.game.bag(s, q.item, -q.n);
    this.complete(s, q, q.thanks, n);
  }

  complete(s, q, line, speaker) {
    const p = s.profile;
    q.status = 'done';
    q.doneDay = this.game.day();
    this.game.coins(s, q.reward);
    const giver = this.npcs[q.npc];
    const changes = giver ? giver.feel(p, 2, this.game.now(), `${p.name} did me a favour`, this.game.epoch) : [];
    if (giver) { giver.rel(p).affinity = Math.min(100, giver.rel(p).affinity + 6); this.game.mark(`npc:${giver.id}`); }
    p.questsDone = (p.questsDone || 0) + 1;
    this.trim(p);
    this.game.markProfile(p);
    s.send({ type: 'toast', text: `📜 Request done for ${NPCS[q.npc].name}! +🪙${q.reward}` });
    if (speaker) {
      this.game.hold(speaker, s);
      s.send({ type: 'npcSay', text: line, sentiment: 2, changes: speaker === giver ? changes : [], ...speaker.view(p, this.game.now()) });
      this.game.broadcast({ type: 'npcBubble', id: speaker.id, text: line });
    }
    this.send(s);
  }

  trim(p) {
    const old = p.quests.filter((q) => q.status !== 'active');
    if (old.length > 6) p.quests = p.quests.filter((q) => q.status === 'active' || old.slice(-6).includes(q));
  }

  // An activity finished: count it (for "do" requests).
  onActivity(s, act) {
    const p = this.state(s.profile);
    p.stats[act] = (p.stats[act] || 0) + 1;
    this.game.markProfile(p);
    if (p.quests.some((q) => q.status === 'active' && q.kind === 'do' && q.act === act)) this.send(s);
  }

  view(s, q) {
    const p = s.profile;
    return { ...q, goal: questGoal(q), progress: questProgress(q, { inv: p.inv, stats: p.stats, plot: this.game.plots[p.plotId] }) };
  }

  send(s) {
    const p = this.state(s.profile);
    s.send({ type: 'quests', quests: p.quests.filter((q) => q.status === 'active').map((q) => this.view(s, q)), done: p.questsDone || 0, stats: p.stats });
  }

  // For the villager's prompt: what they've asked this player for.
  promptFor(s, n) {
    const p = this.state(s.profile);
    const mine = p.quests.filter((q) => q.status === 'active' && q.npc === n.id);
    if (!mine.length) return '';
    return `Favours you've asked ${p.name} for: ${mine.map((q) => { const pr = questProgress(q, { inv: p.inv, stats: p.stats, plot: this.game.plots[p.plotId] }); return `${questGoal(q)} (${pr.ready ? 'they have it ready to hand over' : `${pr.have}/${pr.need}`})`; }).join('; ')}.`;
  }
}

const fmtHour = (h) => { const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

