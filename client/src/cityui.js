// The City Hall panel (opened from Mabel, the City Clerk): the government, elections,
// council proposals and the city's data. Rendered into the shared modal sheet.
import { ROAD_ROWS, ROAD_COLS, ROAD_W, MAP_W, STEP_MS, DAY_STEPS } from '@shared/world.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROW_NAMES = ['North Road', 'Market Road', 'South Road', 'Far South Road'];
const COL_NAMES = ['West Lane', 'Main Avenue', 'East Lane', 'Hall Lane'];
const realTime = (days) => {
  const min = Math.round((days * DAY_STEPS * STEP_MS) / 60000);
  return min < 90 ? `about ${min} min` : `about ${Math.round(min / 6) / 10} h`;
};

// Name the road a tile belongs to (or "a side road" for paths players laid).
function roadName(i) {
  const x = i % MAP_W, y = Math.floor(i / MAP_W);
  const r = ROAD_ROWS.findIndex((ry) => y >= ry && y < ry + ROAD_W);
  if (r >= 0) return ROW_NAMES[r];
  const c = ROAD_COLS.findIndex((rx) => x >= rx && x < rx + ROAD_W);
  return c >= 0 ? COL_NAMES[c] : 'side roads';
}

let tab = 'overview';

// ctx: { city, me, myPlot, plots, send, rerender }
export function renderCity(body, ctx) {
  const { city } = ctx;
  body.innerHTML = '';
  if (!city) { body.textContent = 'Loading city records…'; return; }
  const tabs = document.createElement('div');
  tabs.className = 'seg city-tabs';
  for (const [k, label] of [['overview', '🏛️ City'], ['election', '🗳️ Election'], ['council', '📜 Council'], ['data', '📊 Data']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = tab === k ? 'sel' : '';
    b.onclick = () => { tab = k; ctx.rerender(); };
    tabs.appendChild(b);
  }
  body.appendChild(tabs);
  const pane = document.createElement('div');
  pane.className = 'city-pane';
  body.appendChild(pane);
  ({ overview, election, council, data })[tab](pane, ctx);
}

function overview(el, ctx) {
  overviewInner(el, ctx);
  bizCard(el, ctx);
}

// Business licences are issued here.
function bizCard(el, { biz, me, send }) {
  const c = document.createElement('div');
  c.className = 'city-card hl';
  if (biz) {
    c.innerHTML = `🏪 You run <b>${esc(biz.name)}</b>. ${biz.plotId == null ? 'Pick a shop plot: stand on one that’s for sale and tap “Open my shop here”.' : 'Manage it from the 🏪 Shop button.'}`;
  } else {
    c.innerHTML = `<b>🏪 Start a business</b> · licence 🪙500<div class="muted">Claim a shop plot, build your store, stock shelves with crops and things you make, set your prices, work the till or hire a clerk.</div>`;
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('input');
    name.maxLength = 24; name.placeholder = `${me?.name || 'My'}’s Shop`;
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const go = document.createElement('button');
    go.className = 'chip sel'; go.textContent = 'Register (🪙500)';
    go.onclick = () => send({ type: 'bizStart', name: name.value.trim() });
    row.append(name, go);
    c.appendChild(row);
  }
  el.insertBefore(c, el.children[1] || null);
}

function overviewInner(el, { city }) {
  const m = city.officials.mayor;
  const left = city.term.end - city.day;
  const people = city.officials.council;
  el.innerHTML = `
    <div class="city-card">
      <div><b>Term ${city.term.n}</b> · ends day ${city.term.end} (${left} days, ${realTime(left)})</div>
      <div>Mayor: <b>${esc(m.name)}</b>${m.ai ? ' <span class="tag">AI caretaker</span>' : ''}</div>
      <div>Council: <b>${people.length}</b> villager${people.length === 1 ? '' : 's'} + <b>${city.seats - people.length}</b> AI caretakers (${city.seats} seats)</div>
      ${people.length ? `<div class="muted">${people.map((c) => esc(c.name)).join(', ')}</div>` : ''}
      <div>Treasury: <b>🪙${city.treasury.toLocaleString()}</b> · Land: <b>🪙${city.landPrice}</b> a tile</div>
    </div>
    ${city.election ? `<div class="city-card hl">🗳️ ${city.election.founding ? 'The founding election' : `The election for term ${city.election.n}`} is <b>${city.election.phase === 'filing' ? 'taking candidates' : 'open for voting'}</b>. See the Election tab.</div>` : ''}
    <h3>City news</h3>
    <div class="list">${city.log.slice().reverse().map((l) => `<div class="news"><span class="muted">Day ${l.day}</span> ${esc(l.text)}</div>`).join('') || '<div class="muted">Nothing yet.</div>'}</div>
    <p class="muted small">Government business happens in person here at City Hall. Only villagers with an account can run and vote.</p>`;
}

function election(el, { city, me, send }) {
  const e = city.election;
  if (!e) {
    const nextStart = city.term.end - 14;
    el.innerHTML = `<div class="city-card">No election right now. Filing for the next term opens on day ${nextStart} (${realTime(Math.max(0, nextStart - city.day))}).</div>`;
  } else {
    const mine = e.candidates.find((c) => c.pid === me.id);
    const dl = e.phase === 'filing' ? e.filingEnd : e.votingEnd;
    el.innerHTML = `<div class="city-card hl"><b>${e.founding ? 'Founding election' : `Election for term ${e.n}`}</b>: ${e.phase === 'filing' ? 'filing' : 'voting'} until day ${dl} (${realTime(dl - city.day)}).
      ${e.phase === 'filing' ? 'Voting runs to day ' + e.votingEnd + '.' : ''}</div>`;
    for (const office of ['mayor', 'council']) {
      const list = e.candidates.filter((c) => c.office === office);
      const h = document.createElement('h3');
      h.textContent = office === 'mayor' ? 'For mayor' : `For the council (${city.seats} seats)`;
      el.appendChild(h);
      if (!list.length) el.insertAdjacentHTML('beforeend', `<div class="muted">No candidates yet${office === 'mayor' ? ' (Mayor Bramble, AI, stays on if nobody runs)' : ' (empty seats go to AI caretakers)'}.</div>`);
      for (const c of list) {
        const row = document.createElement('div');
        row.className = 'cand';
        const voted = e.myVotes?.[office] === c.pid;
        row.innerHTML = `<div class="grow"><b>${esc(c.name)}</b>${c.pid === me.id ? ' <span class="tag">you</span>' : ''}<div class="muted">${esc(c.platform) || 'No platform given.'}</div></div>`;
        if (e.phase === 'voting') {
          const b = document.createElement('button');
          b.className = voted ? 'chip sel' : 'chip';
          b.textContent = voted ? '✔ Your vote' : 'Vote';
          b.onclick = () => send({ type: 'cityVote', office, candidate: c.pid });
          row.appendChild(b);
        }
        el.appendChild(row);
      }
    }
    if (e.phase === 'filing' && !mine) {
      const f = document.createElement('form');
      f.innerHTML = `<h3>Run for office</h3>
        <div class="seg2"><button type="button" data-o="council" class="sel">Council</button><button type="button" data-o="mayor">Mayor</button></div>
        <input name="platform" maxlength="160" placeholder="Your platform (what will you do for the village?)">
        <button class="primary">File my candidacy</button>`;
      let office = 'council';
      for (const b of f.querySelectorAll('[data-o]')) b.onclick = () => { office = b.dataset.o; for (const o of f.querySelectorAll('[data-o]')) o.classList.toggle('sel', o === b); };
      f.onsubmit = (ev) => { ev.preventDefault(); send({ type: 'cityRun', office, platform: f.platform.value.trim() }); };
      el.appendChild(f);
    }
  }
  const last = city.lastElection;
  if (last) {
    el.insertAdjacentHTML('beforeend', `<h3>Last election (day ${last.day})</h3>
      <div class="muted">Mayor: ${last.mayor.length ? last.mayor.map((c) => `${esc(c.name)} ${c.votes}`).join(' · ') : 'no candidates'}</div>
      <div class="muted">Council: ${last.council.length ? last.council.map((c) => `${esc(c.name)} ${c.votes}`).join(' · ') : 'no candidates'}</div>`);
  }
}

function council(el, { city, me, myPlot, plots, send }) {
  const isCouncil = city.officials.council.some((c) => c.pid === me.id);
  const isMayor = city.officials.mayor.pid === me.id;
  el.innerHTML = `<div class="city-card">${isMayor ? 'You are the <b>mayor</b>: sign or veto bills the council passes.' : isCouncil ? 'You hold a <b>council seat</b>: vote on open proposals.' : 'Anyone with an account can bring a proposal. The council votes on it for two days.'}
    AI caretakers in empty seats vote together on the clerk’s advice.</div>`;
  const list = city.proposals.slice().reverse();
  if (!list.length) el.insertAdjacentHTML('beforeend', '<div class="muted">No proposals yet.</div>');
  for (const p of list) {
    const card = document.createElement('div');
    card.className = `bill ${p.status}`;
    const status = { open: `Voting until day ${p.closes}`, awaiting: `Passed, awaiting the mayor until day ${p.signBy}`, passed: 'Law ✔', failed: 'Voted down', vetoed: 'Vetoed' }[p.status];
    card.innerHTML = `<div><b>#${p.id} ${esc(p.title)}</b></div>
      <div class="muted">by ${esc(p.by.name)} · ${status}${p.result ? ` · ${p.result.yes}–${p.result.no}` : ` · ${p.votes.yes} yes, ${p.votes.no} no so far`}</div>
      ${p.text ? `<div>${esc(p.text)}</div>` : ''}
      <div class="advice">🤖 Caretakers: <b>${p.advice.recommend === 'yes' ? 'For' : 'Against'}</b> (${city.seats - city.officials.council.length} seats). ${esc(p.advice.reason)}</div>`;
    const row = document.createElement('div');
    row.className = 'row';
    if (p.status === 'open' && isCouncil) {
      for (const v of ['yes', 'no']) {
        const b = document.createElement('button');
        b.className = p.myVote === v ? 'chip sel' : 'chip';
        b.textContent = v === 'yes' ? '👍 Yes' : '👎 No';
        b.onclick = () => send({ type: 'councilVote', id: p.id, vote: v });
        row.appendChild(b);
      }
    }
    if (p.status === 'awaiting' && isMayor) {
      for (const [sign, label] of [[true, '✍️ Sign'], [false, '✋ Veto']]) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = label;
        b.onclick = () => send({ type: 'mayorAct', id: p.id, sign });
        row.appendChild(b);
      }
    }
    if (row.children.length) card.appendChild(row);
    el.appendChild(card);
  }
  // New proposal
  const f = document.createElement('form');
  const own = myPlot != null ? plots[myPlot] : null;
  f.innerHTML = `<h3>Bring a proposal</h3>
    <select name="kind">
      <option value="closeRoad">Close the road across my plot</option>
      <option value="landPrice">Set the price of land</option>
      <option value="resolution">A resolution (anything else)</option>
    </select>
    <input name="title" maxlength="60" placeholder="Title">
    <input name="price" type="number" min="1" max="20" placeholder="Coins per tile (1–20)" hidden>
    <input name="text" maxlength="280" placeholder="Why? (the council and caretakers will read this)">
    <button class="primary">Submit to the council</button>`;
  const sync = () => {
    const k = f.kind.value;
    f.price.hidden = k !== 'landPrice';
    f.title.hidden = k !== 'resolution';
  };
  f.kind.onchange = sync;
  sync();
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const k = f.kind.value;
    send({ type: 'cityPropose', kind: k, plotId: own?.id, price: Number(f.price.value), title: k === 'resolution' ? f.title.value.trim() : '', text: f.text.value.trim() });
  };
  el.appendChild(f);
}

function data(el, { city }) {
  const st = city.stats;
  const visits = Object.entries(st.visits).sort((a, b) => b[1] - a[1]);
  const vmax = Math.max(1, ...visits.map(([, n]) => n));
  const byRoad = {};
  for (const [i, n] of st.traffic) byRoad[roadName(i)] = (byRoad[roadName(i)] || 0) + n;
  const roads = Object.entries(byRoad).sort((a, b) => b[1] - a[1]);
  const rmax = Math.max(1, ...roads.map(([, n]) => n));
  const bar = (label, n, max) => `<div class="bar"><span>${esc(label)}</span><i style="width:${Math.max(3, (n / max) * 100)}%"></i><b>${n}</b></div>`;
  const h = st.history.slice(-7);
  el.innerHTML = `
    <div class="city-card">Villagers: <b>${st.villagers}</b> · Coins held: <b>🪙${st.coins.toLocaleString()}</b> · Treasury: <b>🪙${city.treasury.toLocaleString()}</b></div>
    <div class="city-card">Today: earned 🪙${st.today.earned}, spent 🪙${st.today.spent}, land 🪙${st.today.land}</div>
    <h3>Road traffic (recent trips)</h3>
    ${roads.map(([k, n]) => bar(k, n, rmax)).join('') || '<div class="muted">No traffic recorded yet.</div>'}
    <h3>Visits to public places</h3>
    ${visits.map(([k, n]) => bar(k, n, vmax)).join('') || '<div class="muted">No visits recorded yet.</div>'}
    ${h.length ? `<h3>Past days</h3><table class="hist"><tr><th>Day</th><th>Out</th><th>Earned</th><th>Spent</th><th>Treasury</th></tr>${h.map((d) => `<tr><td>${d.day}</td><td>${d.players}</td><td>${d.earned}</td><td>${d.spent}</td><td>${d.treasury}</td></tr>`).join('')}</table>` : ''}
    <p class="muted small">Mabel keeps these records. Ask her about them!</p>`;
}
