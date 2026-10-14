// The City Hall popup (opened from Mabel, the City Clerk): a wide modal with a sidebar of
// sections (government, services, records), each fitting on one screen. Everything is
// read from the city state the server sends; buttons send actions back.
import { ROAD_ROWS, ROAD_COLS, ROAD_W, MAP_W, STEP_MS, DAY_STEPS, ROAD_PLANS } from '@shared/world.js';
import { UTILITIES, FARMHANDS, MONTH_DAYS } from '@shared/farm.js';
import { PROJECTS } from '@shared/townshops.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "Mayor Bramble" is already titled; players aren't.
const mayorName = (m) => (/^mayor\b/i.test(m.name) ? m.name : `Mayor ${m.name}`);
const num = (n) => Number(n || 0).toLocaleString();
const coin = '<span class="ch-coin" aria-hidden="true">🪙</span>';
const ROW_NAMES = ['North Road', 'Market Road', 'South Road', 'Far South Road'];
const COL_NAMES = ['West Lane', 'Main Avenue', 'East Lane', 'Hall Lane'];
const realTime = (days) => {
  const min = Math.round((days * DAY_STEPS * STEP_MS) / 60000);
  return min < 90 ? `about ${min} min` : `about ${Math.round(min / 6) / 10} h`;
};
const LOAN_MIN = 100;

// Name the road a tile belongs to (or "side roads" for paths players laid).
function roadName(i) {
  const x = i % MAP_W, y = Math.floor(i / MAP_W);
  const r = ROAD_ROWS.findIndex((ry) => y >= ry && y < ry + ROAD_W);
  if (r >= 0) return ROW_NAMES[r];
  const c = ROAD_COLS.findIndex((rx) => x >= rx && x < rx + ROAD_W);
  return c >= 0 ? COL_NAMES[c] : 'Side roads';
}

// Lucide-style stroked icons.
const ICONS = {
  landmark: '<path d="M3 22h18"/><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="M12 2 20 7H4z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  election: '<path d="m9 12 2 2 4-4"/><path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5z"/><path d="M22 19H2"/>',
  council: '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/>',
  projects: '<path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25a3.2 3.2 0 0 1-.93-2.25v-.86L16 4.6A5.56 5.56 0 0 0 12.07 3H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>',
  utilities: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  farmhands: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  business: '<path d="M2 7 6.4 2.6A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-2 1 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-2 1 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-2 1 2.7 2.7 0 0 1-2-1 2 2 0 0 1-2 1 2 2 0 0 1-2-2z"/>',
  bank: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  data: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
};
const icon = (k, size = 18) => `<svg class="ch-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

const GROUPS = [
  ['Government', [['overview', 'Overview'], ['election', 'Election'], ['council', 'Council'], ['projects', 'Public projects']]],
  ['Services', [['utilities', 'Utilities'], ['farmhands', 'Farmhands'], ['business', 'Business'], ['bank', 'Bank & taxes']]],
  ['Records', [['data', 'Data']]],
];

let section = 'overview';
let root = null, ctx = null, pending = false;
// What the player has typed or picked, kept across re-renders.
const draft = { kind: 'closeRoad', title: '', price: '', rate: '', plan: '', project: '', why: '', loan: 500, shop: '', platform: '' };

export const cityOpen = () => !!root && !root.hidden;
export function closeCity() { if (root) root.hidden = true; }

// Open (or refresh) the popup. ctx: { city, me, myPlot, plots, biz, util, hand, coins, send }
export function renderCity(c) {
  ctx = c;
  if (!root) build();
  const wasOpen = !root.hidden;
  root.hidden = false;
  // Don't yank a text box out from under someone typing: refresh when they leave it.
  const a = document.activeElement;
  if (wasOpen && root.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'range'))) { pending = true; head(); return; }
  draw();
  if (!wasOpen) root.querySelector('.ch-close').focus({ preventScroll: true });
}

function build() {
  root = document.createElement('div');
  root.id = 'cityhall';
  root.hidden = true;
  root.innerHTML = `<div class="ch-modal" role="dialog" aria-modal="true" aria-labelledby="ch-title">
      <header class="ch-head"></header>
      <div class="ch-body"><nav class="ch-side" aria-label="City Hall sections"></nav><main class="ch-content"></main></div>
    </div>`;
  document.body.appendChild(root);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closeCity(); });
  root.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing here never moves your character
    if (e.key === 'Escape') { e.preventDefault(); closeCity(); }
  });
  root.addEventListener('keyup', (e) => e.stopPropagation());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cityOpen()) closeCity(); });
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('focusout', () => setTimeout(() => {
    if (!pending || !cityOpen()) return;
    const a = document.activeElement;
    if (root.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;
    pending = false;
    draw();
  }, 0));
}

function draw() {
  pending = false;
  head();
  side();
  const el = root.querySelector('.ch-content');
  const keep = el.dataset.s === section ? el.scrollTop : 0;
  el.dataset.s = section;
  if (!ctx.city) { el.innerHTML = '<p class="ch-intro">Loading city records…</p>'; return; }
  el.innerHTML = SECTIONS[section](ctx);
  el.scrollTop = keep;
  sync();
}

function head() {
  const { city, me, coins } = ctx;
  const m = city?.officials.mayor;
  root.querySelector('.ch-head').innerHTML = `
    <span class="ch-landmark">${icon('landmark', 30)}</span>
    <div class="ch-titles"><h2 id="ch-title">City Hall</h2>
      <div class="ch-sub">${city ? `Day ${city.day} · Term ${city.term.n} · ${esc(mayorName(m))}` : '…'}</div></div>
    <span class="ch-spacer"></span>
    <div class="ch-pill"><span class="ch-pill-l">TREASURY</span>${coin}<b>${num(city?.treasury)}</b></div>
    <div class="ch-pill"><span class="ch-pill-l">YOU</span>${coin}<b>${num(coins)}</b></div>
    <button type="button" class="ch-close" data-act="close" aria-label="Close City Hall">${icon('x', 20)}</button>`;
  void me;
}

function side() {
  const { city, hand } = ctx;
  const badge = { farmhands: hand ? 1 : 0, council: city ? city.proposals.filter((p) => p.status === 'open').length : 0 };
  root.querySelector('.ch-side').innerHTML = GROUPS.map(([g, items]) => `
    <div class="ch-group">${g.toUpperCase()}</div>
    ${items.map(([k, label]) => `<button type="button" class="ch-nav${section === k ? ' sel' : ''}" data-act="go" data-arg="${k}"${section === k ? ' aria-current="page"' : ''}>
      ${icon(k)}<span>${label}</span>${badge[k] ? `<i class="ch-badge">${badge[k]}</i>` : ''}</button>`).join('')}`).join('');
}

// ---------- sections ----------
const stat = (label, value, sub = '') => `<div class="ch-card ch-stat"><div class="ch-stat-l">${label}</div><div class="ch-stat-v">${value}</div>${sub ? `<div class="ch-stat-s">${sub}</div>` : ''}</div>`;
const chip = (kind, text) => `<span class="ch-chip ${kind}">${text}</span>`;
const bar = (frac, h = 10) => `<div class="ch-bar" style="height:${h}px"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>`;
const heading = (title, intro = '') => `<div><h3 class="ch-h">${title}</h3>${intro ? `<p class="ch-intro">${intro}</p>` : ''}</div>`;

const SECTIONS = {
  overview({ city }) {
    const m = city.officials.mayor, people = city.officials.council;
    const left = Math.max(0, city.term.end - city.day);
    const span = Math.max(1, city.term.end - city.term.start);
    const e = city.election;
    return `
      <div class="ch-tiles ch-4">
        ${stat('Treasury', `${coin}${num(city.treasury)}`, 'City funds')}
        ${stat('Land', `${coin}${num(city.landPrice)}`, 'coins a tile')}
        ${stat('Villagers', num(city.stats.villagers), 'living here')}
        ${stat('Council', `${people.length} / ${city.seats}`, 'seats held by villagers')}
      </div>
      <div class="ch-card">
        <div class="ch-row"><div class="ch-grow"><b class="ch-big">${esc(mayorName(m))}</b> ${m.ai ? chip('ai', 'AI caretaker') : chip('on', 'Villager')}</div>
          <div class="ch-soft">Term ${city.term.n} ends day ${city.term.end} · ${left} days (${realTime(left)})</div></div>
        ${bar((city.day - city.term.start) / span, 12)}
        <div class="ch-row"><div class="ch-grow">Council: ${people.length} villager${people.length === 1 ? '' : 's'} + ${city.seats - people.length} AI caretakers (${city.seats} seats)${people.length ? `<div class="ch-soft">${people.map((c) => esc(c.name)).join(', ')}</div>` : ''}</div>
          <button type="button" class="ch-link" data-act="go" data-arg="election">Run for office →</button></div>
      </div>
      ${e ? `<div class="ch-card ch-gold">🗳️ ${e.founding ? 'The founding election' : `The election for term ${e.n}`} is <b>${e.phase === 'filing' ? 'taking candidates' : 'open for voting'}</b>. <button type="button" class="ch-link" data-act="go" data-arg="election">See the election →</button></div>` : ''}
      <div>
        <h4 class="ch-h4">City news</h4>
        <div class="ch-news">${city.log.slice().reverse().map((l) => `<div class="ch-news-row"><span class="ch-day">Day ${l.day}</span><span>${esc(l.text)}</span></div>`).join('') || '<div class="ch-empty">Nothing yet.</div>'}</div>
      </div>
      <p class="ch-foot">Government business happens in person here at City Hall. Only villagers with an account can run and vote.</p>`;
  },

  election({ city, me }) {
    const e = city.election;
    const mine = e?.candidates.find((c) => c.pid === me.id);
    let status;
    if (!e) {
      const next = city.term.end - 14;
      status = `No election right now. Filing for the next term opens on day ${next} (${realTime(Math.max(0, next - city.day))}).`;
    } else {
      const dl = e.phase === 'filing' ? e.filingEnd : e.votingEnd;
      status = `<b>${e.founding ? 'Founding election' : `Election for term ${e.n}`}</b>: ${e.phase === 'filing' ? 'taking candidates' : 'voting'} until day ${dl} (${realTime(Math.max(0, dl - city.day))}).${e.phase === 'filing' ? ` Voting runs to day ${e.votingEnd}.` : ''}`;
    }
    const card = (office, title, line) => {
      const list = e ? e.candidates.filter((c) => c.office === office) : [];
      const filed = mine?.office === office;
      let btn = '';
      if (e?.phase === 'filing') {
        btn = filed ? '<button type="button" class="ch-btn ch-green" data-act="withdraw">Filed ✓ · withdraw</button>'
          : `<button type="button" class="ch-btn" data-act="run" data-arg="${office}"${mine ? ' disabled' : ''}>File to run</button>`;
      }
      return `<div class="ch-card ch-col">
        <div class="ch-row"><b class="ch-big ch-grow">${title}</b>${list.length ? chip('off', `${list.length} running`) : ''}</div>
        <p class="ch-text">${line}</p>
        <div class="ch-cands">${list.map((c) => {
          const voted = e.myVotes?.[office] === c.pid;
          return `<div class="ch-cand"><div class="ch-grow"><b>${esc(c.name)}</b>${c.pid === me.id ? ` ${chip('gold', 'you')}` : ''}<div class="ch-soft">${esc(c.platform) || 'No platform given.'}</div></div>
            ${e.phase === 'voting' ? `<button type="button" class="ch-btn ch-sm${voted ? ' ch-green' : ' ch-sec'}" data-act="vote" data-arg="${office}" data-c="${esc(c.pid)}">${voted ? 'Your vote ✓' : 'Vote'}</button>` : ''}</div>`;
        }).join('') || `<div class="ch-soft">No candidates yet${office === 'mayor' ? ' (Mayor Bramble, AI, stays on if nobody runs).' : ' (empty seats go to AI caretakers).'}</div>`}</div>
        ${btn ? `<div class="ch-actions">${btn}</div>` : ''}
      </div>`;
    };
    const last = city.lastElection;
    return `${heading('Election', 'Every term the village picks a mayor and a council. Run for a seat, tell people what you’ll do, then come back to vote.')}
      <div class="ch-card ch-gold">${status}</div>
      ${e?.phase === 'filing' && !mine ? `<label class="ch-field"><span>Your platform</span><input name="platform" maxlength="160" value="${esc(draft.platform)}" placeholder="What will you do for the village?"></label>` : ''}
      <div class="ch-grid2">
        ${card('mayor', 'Run for mayor', 'Sign or veto the bills the council passes, and speak for the village.')}
        ${card('council', `Run for council`, `${city.seats} seats. Vote on every proposal brought to City Hall.`)}
      </div>
      ${last ? `<p class="ch-text"><b>Last election (day ${last.day}).</b> Mayor: ${last.mayor.length ? last.mayor.map((c) => `${esc(c.name)} ${c.votes}`).join(' · ') : 'no candidates'}. Council: ${last.council.length ? last.council.map((c) => `${esc(c.name)} ${c.votes}`).join(' · ') : 'no candidates'}.</p>` : ''}`;
  },

  council({ city, me }) {
    const isCouncil = city.officials.council.some((c) => c.pid === me.id);
    const isMayor = city.officials.mayor.pid === me.id;
    const list = city.proposals.slice().reverse();
    const floor = list.filter((p) => p.status === 'open' || p.status === 'awaiting');
    const past = list.filter((p) => p.status !== 'open' && p.status !== 'awaiting');
    const bill = (p) => {
      const st = { open: chip('vote', `Voting until day ${p.closes}`), awaiting: chip('vote', `Awaiting the mayor · day ${p.signBy}`), passed: chip('on', 'Law ✓'), failed: chip('off', 'Voted down'), vetoed: chip('off', 'Vetoed') }[p.status];
      let acts = '';
      if (p.status === 'open' && isCouncil) acts = ['yes', 'no'].map((v) => `<button type="button" class="ch-btn ch-sm${p.myVote === v ? '' : ' ch-sec'}" data-act="cvote" data-arg="${p.id}" data-c="${v}">${v === 'yes' ? '👍 Yes' : '👎 No'}</button>`).join('');
      if (p.status === 'awaiting' && isMayor) acts = `<button type="button" class="ch-btn ch-sm ch-green" data-act="sign" data-arg="${p.id}" data-c="1">✍️ Sign</button><button type="button" class="ch-btn ch-sm ch-sec" data-act="sign" data-arg="${p.id}" data-c="0">✋ Veto</button>`;
      return `<div class="ch-card ch-bill">
        <div class="ch-row"><b class="ch-grow">#${p.id} ${esc(p.title)}</b>${st}</div>
        <div class="ch-soft">by ${esc(p.by.name)} · ${p.result ? `${p.result.yes}–${p.result.no}` : `${p.votes.yes} yes, ${p.votes.no} no so far`}</div>
        ${p.text ? `<p class="ch-text">${esc(p.text)}</p>` : ''}
        <div class="ch-advice">${chip('ai', 'AI caretakers')} <b>${p.advice.recommend === 'yes' ? 'For' : 'Against'}</b> (${city.seats - city.officials.council.length} seats). ${esc(p.advice.reason)}</div>
        ${acts ? `<div class="ch-actions">${acts}</div>` : ''}
      </div>`;
    };
    const k = draft.kind;
    const plans = Object.entries(ROAD_PLANS).filter(([id]) => !city.roads?.[id]?.built);
    const projs = Object.entries(PROJECTS).filter(([id]) => !city.projects.includes(id));
    return `${heading('Council', `${isMayor ? 'You are the <b>mayor</b>: sign or veto the bills the council passes. ' : isCouncil ? 'You hold a <b>council seat</b>: vote on open proposals. ' : ''}Anyone with an account can bring a proposal; the council votes on it for two days. AI caretakers in empty seats vote together on the clerk’s advice.`)}
      <div>
        <div class="ch-label">ON THE FLOOR</div>
        <div class="ch-list">${floor.map(bill).join('') || '<div class="ch-empty">No proposals yet.</div>'}</div>
      </div>
      <form class="ch-card ch-col" data-form="propose">
        <b class="ch-big">Bring a proposal</b>
        <select name="kind" aria-label="Kind of proposal">
          ${[['closeRoad', 'Close the road across my plot'], ['landPrice', 'Set the price of land'], ['tax', 'Set property tax'], ['project', 'Build a public project'], ['road', 'Build a road'], ['resolution', 'A resolution (anything else)']].map(([v, l]) => `<option value="${v}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        ${k === 'resolution' ? `<input name="title" maxlength="60" placeholder="Title" value="${esc(draft.title)}">` : ''}
        ${k === 'landPrice' ? `<input name="price" type="number" min="1" max="20" placeholder="Coins per tile (1–20)" value="${esc(draft.price)}">` : ''}
        ${k === 'tax' ? `<input name="rate" type="number" min="0" max="20" placeholder="Coins per 10 tiles a month (0–20)" value="${esc(draft.rate)}">` : ''}
        ${k === 'road' ? (plans.length ? `<select name="plan">${plans.map(([id, p]) => `<option value="${id}"${draft.plan === id ? ' selected' : ''}>🛣️ ${esc(p.name)} (🪙${num(city.roads?.[id]?.cost)})</option>`).join('')}</select>` : '<div class="ch-soft">Every planned road is built.</div>') : ''}
        ${k === 'project' ? (projs.length ? `<select name="project">${projs.map(([id, p]) => `<option value="${id}"${draft.project === id ? ' selected' : ''}>${p.icon} ${esc(p.name)} (🪙${num(p.cost)})</option>`).join('')}</select>` : '<div class="ch-soft">Every project is built.</div>') : ''}
        <textarea name="why" rows="2" maxlength="280" placeholder="Why? (the council and caretakers will read this)">${esc(draft.why)}</textarea>
        <div class="ch-actions"><button class="ch-btn ch-green" data-submit>Submit to the council</button></div>
      </form>
      ${past.length ? `<div><div class="ch-label">DECIDED</div><div class="ch-list">${past.map(bill).join('')}</div></div>` : ''}`;
  },

  projects({ city }) {
    const card = (name, icon_, cost, line, built, where, propose) => {
      const frac = cost ? city.treasury / cost : 1;
      return `<div class="ch-card ch-col${built ? ' ch-done' : ''}">
        <div class="ch-row"><b class="ch-big ch-grow">${icon_} ${esc(name)}</b>${built ? chip('on', 'Built ✓') : `<b>${coin}${num(cost)}</b>`}</div>
        <p class="ch-text">${esc(line)}${where ? ` <span class="ch-soft">(${esc(where)})</span>` : ''}</p>
        ${built ? '' : `${bar(frac, 10)}<div class="ch-row"><span class="ch-soft ch-grow">${frac >= 1 ? 'Treasury can cover this' : `${num(cost - city.treasury)} short · ${Math.floor(frac * 100)}% covered`}</span>
          <button type="button" class="ch-link" data-act="propose" data-arg="${propose}">Propose it →</button></div>`}
      </div>`;
    };
    return `${heading('Public projects', 'Things the village can build with the treasury. Bring one to the council; it’s built when it passes and the treasury can pay.')}
      <div class="ch-grid2">
        ${Object.entries(PROJECTS).map(([id, p]) => card(p.name, p.icon, p.cost, p.line, city.projects.includes(id), p.where, `project:${id}`)).join('')}
        ${Object.entries(ROAD_PLANS).map(([id, p]) => card(p.name, '🛣️', city.roads?.[id]?.cost || 0, p.line, city.roads?.[id]?.built, '', `road:${id}`)).join('')}
      </div>
      <p class="ch-foot">Players can also lay road on their own land in build mode → Land.</p>`;
  },

  utilities({ util = {}, myPlot, city }) {
    return `${heading('Utilities', `Water and power for your plot. Bills go to the city every ${MONTH_DAYS} days; if you can’t pay, the service is cut off until you settle up here.`)}
      ${Object.entries(UTILITIES).map(([k, u]) => {
        const cur = util[k];
        const on = cur && !cur.off;
        let line, btn;
        if (!cur) { line = `${coin}${u.setup} to hook up + ${coin}${u.monthly} a month`; btn = `<button type="button" class="ch-btn" data-act="utilStart" data-arg="${k}"${myPlot == null ? ' disabled' : ''}>Hook up · ${u.setup + u.monthly}</button>`; }
        else if (cur.off) { line = '<span class="ch-red">Cut off: the last bill went unpaid</span>'; btn = `<button type="button" class="ch-btn" data-act="utilPay" data-arg="${k}">Turn on · ${u.monthly}</button>`; }
        else { line = `${coin}${u.monthly} a month · next bill on day ${cur.due} (in ${Math.max(0, cur.due - city.day)} days)`; btn = `<button type="button" class="ch-btn ch-sec" data-act="utilStop" data-arg="${k}">Cancel</button>`; }
        return `<div class="ch-card ch-util">
          <div class="ch-uicon${on ? ' on' : ''}">${u.icon}</div>
          <div class="ch-grow"><div class="ch-row"><b class="ch-big">${u.name}</b>${on ? chip('on', 'On') : chip('off', cur?.off ? 'Cut off' : 'Off')}</div>
            <div class="ch-soft">${line}</div><p class="ch-text">${esc(u.line)}</p></div>
          ${btn}</div>`;
      }).join('')}
      ${myPlot == null ? '<p class="ch-foot">Claim a plot first to hook up utilities.</p>' : ''}`;
  },

  farmhands({ hand, myPlot }) {
    return `${heading('Farmhands', 'They water, harvest and replant your crops (seeds come out of your coins). Paid every morning; the harvest goes in your bag.')}
      <div class="ch-grid3">${Object.entries(FARMHANDS).map(([id, h]) => {
        const hired = hand === id;
        return `<div class="ch-card ch-col${hired ? ' ch-hired' : ''}">
          <b class="ch-name">${esc(h.name)}</b>
          <div class="ch-kv"><div><span>Per day</span><b>${coin}${h.wage}</b></div><div><span>Crops per hour</span><b>${h.rate}</b></div></div>
          <p class="ch-text ch-grow">${esc(h.line)}</p>
          <button type="button" class="ch-btn${hired ? ' ch-sec' : ''}" data-act="${hired ? 'fireHand' : 'hireHand'}" data-arg="${id}"${myPlot == null ? ' disabled' : ''}>${hired ? 'Hired · let go' : 'Hire'}</button>
        </div>`;
      }).join('')}</div>
      <p class="ch-text">${hand ? `Paying ${coin}${FARMHANDS[hand]?.wage} a day each morning.` : 'Nobody hired yet. One farmhand at a time.'}</p>
      ${myPlot == null ? '<p class="ch-foot">Claim a plot first to hire a farmhand.</p>' : ''}`;
  },

  business({ biz, me, coins }) {
    if (biz) {
      return `${heading('Business', 'Business licences are issued here at City Hall.')}
        <div class="ch-card ch-hired"><b class="ch-big">🏪 ${esc(biz.name)}</b> is registered.
          <p class="ch-text">${biz.plotId == null ? 'Now pick a shop plot: stand on one that’s for sale and tap “Open my shop here”.' : 'Manage it from the 🏪 Shop button: stock shelves, set prices, work the till or hire a clerk.'}</p></div>`;
    }
    return `${heading('Business', 'Claim a shop plot, build your store, stock shelves with crops and things you make, set your prices, work the till or hire a clerk.')}
      <form class="ch-card ch-col" data-form="biz">
        <label class="ch-field"><span>Shop name</span><input class="ch-main" name="shop" maxlength="24" value="${esc(draft.shop)}" placeholder="${esc(me?.name || 'My')}’s Shop"></label>
        <div class="ch-row"><button class="ch-btn" data-submit${coins < 500 ? ' disabled' : ''}>Register · licence 500</button>
          <span class="ch-soft">${coins >= 500 ? `${num(coins - 500)} left after` : `You need ${num(500 - coins)} more`}</span></div>
      </form>`;
  },

  bank({ city }) {
    const loan = city.loan;
    const tiles = `<div class="ch-tiles ch-2">
      ${stat('Property tax', city.taxRate ? `${coin}${city.taxRate} per 10 tiles a month` : 'None', 'set by the council')}
      ${stat('Land', `${coin}${num(city.landPrice)} a tile`, 'set by the council')}
    </div>`;
    if (loan) {
      return `${heading('Bank & taxes', 'The village bank lends from the treasury.')}${tiles}
        <form class="ch-card ch-col" data-form="repay">
          <div class="ch-row"><b class="ch-big ch-grow">Your loan</b>${chip(loan.due < city.day ? 'off' : 'vote', loan.due < city.day ? 'Late' : `Due day ${loan.due}`)}</div>
          <div class="ch-tiles ch-3">${stat('You owe', `${coin}${num(loan.owed)}`)}${stat('Due by', `Day ${loan.due}`)}${stat('If late', '+10% a week')}</div>
          <div class="ch-row"><input name="repay" type="number" min="1" max="${loan.owed}" value="${loan.owed}" aria-label="Amount to repay"><button class="ch-btn" data-submit>Repay</button></div>
        </form>`;
    }
    const max = city.loanMax;
    return `${heading('Bank & taxes', 'The village bank lends from the treasury. Pay it back within a month.')}${tiles}
      <form class="ch-card ch-col" data-form="loan">
        <b class="ch-big">Take a loan</b>
        <div class="ch-row"><input type="range" name="loanR" min="${LOAN_MIN}" max="${max}" step="50" value="${draft.loan}" aria-label="Loan amount" class="ch-grow">
          <input type="number" name="loan" min="${LOAN_MIN}" max="${max}" step="50" value="${draft.loan}" aria-label="Loan amount" class="ch-num"></div>
        <div class="ch-tiles ch-3">${stat('You pay back', `${coin}<span data-out="back"></span>`, `×${1 + city.loanRate}`)}${stat('Due by', `Day ${city.day + MONTH_DAYS}`)}${stat('If late', '+10% a week')}</div>
        <div class="ch-row"><button class="ch-btn" data-submit>Borrow</button><span class="ch-soft" data-out="note"></span></div>
      </form>`;
  },

  data({ city }) {
    const st = city.stats;
    const visits = Object.entries(st.visits).sort((a, b) => b[1] - a[1]);
    const byRoad = {};
    for (const [i, n] of st.traffic) byRoad[roadName(i)] = (byRoad[roadName(i)] || 0) + n;
    const roads = Object.entries(byRoad).sort((a, b) => b[1] - a[1]);
    const chart = (title, rows, none) => {
      const max = Math.max(1, ...rows.map(([, n]) => n));
      return `<div class="ch-card ch-col"><b class="ch-big">${title}</b>${rows.map(([k, n]) => `<div class="ch-hbar"><span>${esc(k)}</span>${bar(n / max, 10)}<b>${n}</b></div>`).join('') || `<div class="ch-soft">${none}</div>`}</div>`;
    };
    const h = st.history.slice(-7).reverse();
    return `<div class="ch-tiles ch-3">${stat('Villagers', num(st.villagers))}${stat('Coins held', `${coin}${num(st.coins)}`)}${stat('Treasury', `${coin}${num(city.treasury)}`)}</div>
      <div class="ch-today"><b>Today</b><span>Earned ${coin}${num(st.today.earned)}</span><span>Spent ${coin}${num(st.today.spent)}</span><span>Land ${coin}${num(st.today.land)}</span></div>
      <div class="ch-grid2">${chart('Road traffic', roads, 'No traffic recorded yet.')}${chart('Visits to public places', visits, 'No visits recorded yet.')}</div>
      ${h.length ? `<div class="ch-card"><b class="ch-big">Past days</b><table class="ch-table"><thead><tr><th>Day</th><th>Out</th><th>Earned</th><th>Spent</th><th>Treasury</th></tr></thead>
        <tbody>${h.map((d) => `<tr><td>${d.day}</td><td>${d.players}</td><td class="${d.earned > 0 ? 'ch-pos' : ''}">${num(d.earned)}</td><td>${num(d.spent)}</td><td>${num(d.treasury)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="ch-foot">Mabel keeps these records. Ask her about them!</p>`;
  },
};

// ---------- live bits and actions ----------
// Keep dependent bits up to date without redrawing (loan maths, submit buttons).
function sync() {
  const el = root.querySelector('.ch-content');
  const loanF = el.querySelector('[data-form=loan]');
  if (loanF && ctx.city) {
    const { city } = ctx, n = Number(draft.loan);
    const ok = n >= LOAN_MIN && n <= city.loanMax && n <= city.treasury;
    loanF.querySelector('[data-out=back]').textContent = num(Math.round(n * (1 + city.loanRate)));
    const note = loanF.querySelector('[data-out=note]');
    note.textContent = !(n >= LOAN_MIN && n <= city.loanMax) ? `Loans are ${LOAN_MIN} to ${num(city.loanMax)}.` : n > city.treasury ? `The treasury only has ${num(city.treasury)} to lend.` : `Paid out of the treasury (${num(city.treasury)} on hand).`;
    note.classList.toggle('ch-red', !ok);
    loanF.querySelector('[data-submit]').disabled = !ok;
  }
  const prop = el.querySelector('[data-form=propose]');
  if (prop) prop.querySelector('[data-submit]').disabled = !draft.why.trim();
}

function onInput(e) {
  const t = e.target;
  if (!t.name) return;
  if (t.name === 'loanR' || t.name === 'loan') {
    draft.loan = t.value;
    const other = t.form?.querySelector(`[name=${t.name === 'loan' ? 'loanR' : 'loan'}]`);
    if (other) other.value = t.value;
  } else if (t.name in draft) draft[t.name] = t.value;
  sync();
}

function onChange(e) {
  const t = e.target;
  if (t.name === 'kind') { draft.kind = t.value; draw(); }
  else if (t.name in draft) draft[t.name] = t.value;
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const { send, city } = ctx;
  if (b.hasAttribute('data-submit')) { e.preventDefault(); return submit(b.closest('form')); }
  const arg = b.dataset.arg;
  switch (b.dataset.act) {
    case 'close': return closeCity();
    case 'go': section = arg; return draw();
    case 'run': return send({ type: 'cityRun', office: arg, platform: draft.platform.trim() });
    case 'withdraw': return send({ type: 'cityWithdraw' });
    case 'vote': return send({ type: 'cityVote', office: arg, candidate: b.dataset.c });
    case 'cvote': return send({ type: 'councilVote', id: Number(arg), vote: b.dataset.c });
    case 'sign': return send({ type: 'mayorAct', id: Number(arg), sign: b.dataset.c === '1' });
    case 'propose': {
      const [kind, id] = arg.split(':');
      draft.kind = kind;
      if (kind === 'project') draft.project = id; else draft.plan = id;
      section = 'council';
      draw();
      root.querySelector('.ch-content textarea[name=why]')?.focus();
      return;
    }
    case 'utilStart': return send({ type: 'utilStart', kind: arg });
    case 'utilPay': return send({ type: 'utilPay', kind: arg });
    case 'utilStop':
      if (confirm(`Cancel ${UTILITIES[arg].name.toLowerCase()}? Sprinklers and machines on it stop working.`)) send({ type: 'utilStop', kind: arg });
      return;
    case 'hireHand': return send({ type: 'hireHand', id: arg });
    case 'fireHand': return send({ type: 'fireHand' });
  }
  void city;
}

function submit(f) {
  const { send, myPlot, plots } = ctx;
  const kind = f.dataset.form;
  if (kind === 'propose') {
    const k = draft.kind;
    const own = myPlot != null ? plots[myPlot] : null;
    const project = f.project?.value || draft.project, plan = f.plan?.value || draft.plan;
    send({ type: 'cityPropose', kind: k, plotId: own?.id, price: Number(draft.price), rate: Number(draft.rate), project, plan, title: k === 'resolution' ? draft.title.trim() : '', text: draft.why.trim() });
    draft.why = ''; draft.title = '';
  } else if (kind === 'biz') {
    send({ type: 'bizStart', name: draft.shop.trim() });
  } else if (kind === 'loan') {
    send({ type: 'loanTake', amount: Number(draft.loan) });
  } else if (kind === 'repay') {
    const n = Number(f.repay.value);
    if (n > 0) send({ type: 'loanRepay', amount: n });
  }
}
