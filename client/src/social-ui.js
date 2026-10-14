// Village life UI: trading with players, the notice board, mail, chests and fridges,
// fishing, festivals, daily goals and the morning paper. main.js hands in what it needs.
import { ITEMS, GOODS, itemName } from '@shared/catalog.js';
import { TILE, worldClock, publicAreaAt, SQUARE, FAIR } from '@shared/world.js';
import { QUALITY } from '@shared/farm.js';
import { FOODS } from '@shared/needs.js';
import { waterNear } from '@shared/fishing.js';
import { EVENTS, canEnter } from '@shared/events.js';
import { footprint, levelView } from '@shared/plot.js';

export function socialUI(c) {
  const { S, send, openModal, closeModal, modal, toast, esc, itemRow, world } = c;
  const qtxt = (ql) => (ql ? [ql[1] && `${ql[1]}★★`, ql[0] && `${ql[0]}★`].filter(Boolean).join(' ') : '');
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
  const num = (value, min = 1, max = 99) => { const i = el('input', { type: 'number', min, max, value, className: 'qty' }); i.addEventListener('keydown', (e) => e.stopPropagation()); return i; };
  const bagItems = (filter = () => true) => Object.keys(S.inv).filter((k) => S.inv[k] > 0 && filter(k));
  const itemSelect = (filter) => { const s = el('select'); for (const k of bagItems(filter)) s.add(new Option(`${GOODS[k]?.icon || '📦'} ${itemName(k)} ×${S.inv[k]}`, k)); return s; };

  // ---------- trading ----------
  function showTrade() {
    const t = S.trade;
    if (!t) { if (modal() === 'trade') closeModal(); return; }
    const body = openModal('trade', `🤝 Trading with ${t.with}`);
    const side = (title, o, mine) => {
      const box = el('div', { className: 'city-card' });
      box.innerHTML = `<b>${title}</b> ${o?.ok ? '✅ agreed' : ''}<div>${Object.entries(o?.items || {}).map(([k, n]) => `${GOODS[k]?.icon || '📦'} ${esc(itemName(k))} ×${n}`).join(', ') || '<span class="muted">nothing yet</span>'}${o?.coins ? ` · 🪙${o.coins}` : ''}</div>`;
      if (mine) {
        const list = el('div', { className: 'list' });
        for (const k of bagItems()) {
          const have = t.mine.items[k] || 0;
          const set = (n) => send({ type: 'tradeSet', items: { ...t.mine.items, [k]: Math.max(0, Math.min(S.inv[k], n)) }, coins: t.mine.coins });
          list.appendChild(itemRow(k, `you have ${S.inv[k]} · offering ${have}`, [['−', () => set(have - 1), !have], ['+', () => set(have + 1), have >= S.inv[k]], ['All', () => set(S.inv[k])]]));
        }
        const coins = num(t.mine.coins, 0, 1e7);
        const setc = el('button', { className: 'chip', textContent: 'Offer coins' });
        setc.onclick = () => send({ type: 'tradeSet', items: t.mine.items, coins: Number(coins.value) });
        box.append(list, el('div', { className: 'row' }, '🪙 ', coins, setc));
      }
      return box;
    };
    body.append(side(`${t.with} offers`, t.theirs, false), side('You offer', t.mine, true));
    const row = el('div', { className: 'row' });
    const ok = el('button', { className: 'primary', textContent: t.mine.ok ? '✅ Waiting for them…' : '🤝 Agree to this trade', disabled: t.mine.ok });
    ok.onclick = () => send({ type: 'tradeOk' });
    const cancel = el('button', { className: 'chip', textContent: 'Cancel' });
    cancel.onclick = () => send({ type: 'tradeCancel' });
    row.append(ok, cancel);
    body.append(row, el('p', { className: 'muted small', textContent: 'Changing either offer clears both agreements. Nothing changes hands until you both agree.' }));
  }

  // ---------- the notice board ----------
  function showBoard() {
    const body = openModal('board', '📌 Village notice board');
    body.insertAdjacentHTML('beforeend', '<p class="muted">Post things for sale; anyone can buy them here (you get paid even when you’re away). Up to 5 notices each.</p>');
    const list = el('div', { className: 'list' });
    const notes = S.board || [];
    if (!notes.length) list.innerHTML = '<div class="muted">No notices up. Be the first!</div>';
    for (const b of notes) {
      const mine = b.by === S.me.id;
      list.appendChild(itemRow(b.item, `${b.n} × 🪙${b.price} each · ${mine ? 'your notice' : `from ${b.name}`}${b.q && (b.q[1] || b.q[2]) ? ` · ${qtxt([b.q[1], b.q[2]])}` : ''}`, mine
        ? [['Take down', () => send({ type: 'boardCancel', id: b.id })]]
        : [['Buy 1', () => send({ type: 'boardBuy', id: b.id, n: 1 }), S.coins < b.price], ['Buy all', () => send({ type: 'boardBuy', id: b.id, n: b.n }), S.coins < b.price * b.n]]));
    }
    body.appendChild(list);
    const items = bagItems();
    if (items.length) {
      const sel = itemSelect(), n = num(1), price = num(GOODS[items[0]]?.value || ITEMS[items[0]]?.price || 10, 1, 99999);
      sel.onchange = () => { price.value = GOODS[sel.value]?.value || ITEMS[sel.value]?.price || 10; };
      const post = el('button', { className: 'primary', textContent: '📌 Post' });
      post.onclick = () => send({ type: 'boardPost', item: sel.value, n: Number(n.value), price: Number(price.value) });
      body.append(el('h3', { textContent: 'Sell something' }), el('div', { className: 'row' }, sel, ' × ', n, ' at 🪙', price, ' each ', post));
    }
  }

  // ---------- mail ----------
  let composeTo = '';
  function showMail() {
    const body = openModal('mail', '📬 Mail');
    const mail = (S.mail || []).slice().reverse();
    if (!mail.length) body.insertAdjacentHTML('beforeend', '<p class="muted">No letters yet.</p>');
    for (const m of mail) {
      const card = el('div', { className: `qcard${m.read ? '' : ' unread'}` });
      const att = [...Object.entries(m.items || {}).map(([k, n]) => `${GOODS[k]?.icon || '📦'} ${itemName(k)} ×${n}`), m.coins ? `🪙${m.coins}` : ''].filter(Boolean).join(', ');
      card.innerHTML = `<b>${m.read ? '' : '🆕 '}From ${esc(m.from)}</b> <small class="muted">day ${m.day}</small><p>${esc(m.text)}</p>${att ? `<small>📎 ${esc(att)}</small>` : ''}`;
      const row = el('div', { className: 'row' });
      if (att) { const take = el('button', { className: 'chip sel', textContent: 'Take' }); take.onclick = () => send({ type: 'mailTake', id: m.id }); row.appendChild(take); }
      if (!m.read && !att) { const r = el('button', { className: 'chip', textContent: 'Mark read' }); r.onclick = () => send({ type: 'mailRead', id: m.id }); row.appendChild(r); }
      if (m.from && !['City Hall', 'The Notice Board', 'The Festival Committee'].includes(m.from)) { const rep = el('button', { className: 'chip', textContent: 'Reply' }); rep.onclick = () => { composeTo = m.from; showMail(); body.querySelector('textarea')?.focus(); }; row.appendChild(rep); }
      const del = el('button', { className: 'chip', textContent: '🗑' }); del.onclick = () => send({ type: 'mailDelete', id: m.id }); row.appendChild(del);
      card.appendChild(row);
      body.appendChild(card);
    }
    // Compose
    const to = el('input', { placeholder: 'To (villager name)', value: composeTo, maxLength: 30 });
    const text = el('textarea', { placeholder: 'Your letter…', maxLength: 400, rows: 3 });
    for (const i of [to, text]) i.addEventListener('keydown', (e) => e.stopPropagation());
    to.oninput = () => { composeTo = to.value; };
    const item = itemSelect(); item.add(new Option('— no gift —', ''), 0); item.value = '';
    const n = num(1), coins = num(0, 0, 1e7);
    const go = el('button', { className: 'primary', textContent: '📮 Send (🪙5 postage)' });
    go.onclick = () => send({ type: 'mailSend', to: to.value, text: text.value, item: item.value || null, n: Number(n.value), coins: Number(coins.value) });
    body.append(el('h3', { textContent: 'Write a letter' }), to, text, el('div', { className: 'row' }, 'Gift: ', item, ' × ', n, ' + 🪙', coins), go,
      el('p', { className: 'muted small', textContent: 'Post letters from any mailbox: the town square, City Hall, or one on someone’s plot.' }));
  }
  const unread = () => (S.mail || []).filter((m) => !m.read).length;

  // ---------- storage ----------
  let storeAt = null;
  function showStore(u) {
    if (u) storeAt = { plotId: u.plot.id, level: u.level, lx: u.lx, ly: u.ly, key: u.key };
    const a = storeAt;
    const plot = a && S.plots[a.plotId];
    const o = plot && levelView(plot, a.level).obj[a.key];
    if (!o) { closeModal(); return; }
    const def = ITEMS[o.t];
    const body = openModal('store', `${def.store === 'food' ? '🧊' : '📦'} ${def.name}`);
    const inside = Object.entries(o.inv || {});
    const total = inside.reduce((x, [, n]) => x + n, 0);
    body.insertAdjacentHTML('beforeend', `<p class="muted">${total}/300 stored${def.store === 'food' ? ' · food only' : ''}</p>`);
    const left = el('div', { className: 'list' });
    if (!inside.length) left.innerHTML = '<div class="muted">Empty.</div>';
    for (const [k, n] of inside) left.appendChild(itemRow(k, `×${n} ${qtxt(o.qual?.[k])}`, [['Take 1', () => send({ type: 'store', ...a, item: k, n: 1, put: false })], ['Take all', () => send({ type: 'store', ...a, item: k, n, put: false })]]));
    const right = el('div', { className: 'list' });
    const ok = (k) => def.store !== 'food' || FOODS[k] || ['produce', 'fish', 'animal', 'product'].includes(GOODS[k]?.kind);
    for (const k of bagItems(ok)) right.appendChild(itemRow(k, `×${S.inv[k]} in your bag`, [['Put 1', () => send({ type: 'store', ...a, item: k, n: 1, put: true })], ['Put all', () => send({ type: 'store', ...a, item: k, n: S.inv[k], put: true })]]));
    body.append(el('h3', { textContent: 'Inside' }), left, el('h3', { textContent: 'Your bag' }), right);
  }

  // ---------- fishing ----------
  const fish = { state: null, tx: 0, ty: 0, at: 0 };
  function fishAvailable() {
    return S.inv.rod > 0 && !S.act && !S.ride && !(S.me.level || 0) && !!waterNear(world, S.me.x, S.me.y);
  }
  // Draw lines and bobbers for everyone fishing (others: to the nearest water).
  function drawFishing(octx, view, now, people) {
    for (const p of people) {
      if (p.act !== 'fish') continue;
      const w = p === S.me && fish.state ? { tx: fish.tx, ty: fish.ty } : waterNear(world, p.x, p.y);
      if (!w) continue;
      const hand = view.toScreen(p.x / TILE + 0.2, 1.1, p.y / TILE - 0.1);
      const bite = p === S.me && fish.state === 'bite';
      const bob = view.toScreen(w.tx + 0.5, 0.05 + (bite ? Math.sin(now / 40) * 0.08 : Math.sin(now / 400) * 0.03), w.ty + 0.5);
      octx.strokeStyle = 'rgba(255,255,255,.75)'; octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(hand.x, hand.y); octx.quadraticCurveTo((hand.x + bob.x) / 2, Math.max(hand.y, bob.y) + 10, bob.x, bob.y); octx.stroke();
      octx.fillStyle = '#e8453c'; octx.beginPath(); octx.arc(bob.x, bob.y, 3, 0, Math.PI * 2); octx.fill();
      octx.fillStyle = '#fff'; octx.fillRect(bob.x - 3, bob.y - 1, 6, 1);
      if (bite) { octx.font = 'bold 22px sans-serif'; octx.fillStyle = '#ffd23a'; octx.fillText('❗', hand.x, hand.y - 18); }
      octx.fillStyle = '#000';
    }
  }

  // ---------- festivals, goals, the paper ----------
  let journalTab = 'goals';
  function showJournal(tab = journalTab) {
    journalTab = tab;
    if (c.openJournal) return c.openJournal(tab); // the bag window's Journal tab
    const body = openModal('journal', '📖 Journal');
    const tabs = el('div', { className: 'seg city-tabs' });
    for (const [k, label] of [['goals', '✅ Goals'], ['fest', '🎪 Festival'], ['paper', '📰 Gazette']]) {
      const b = el('button', { textContent: label, className: k === tab ? 'sel' : '' });
      b.onclick = () => showJournal(k);
      tabs.appendChild(b);
    }
    body.appendChild(tabs);
    const pane = el('div');
    body.appendChild(pane);
    if (tab === 'goals') renderGoals(pane);
    else if (tab === 'fest') renderFest(pane);
    else renderPaper(pane);
  }
  function renderGoals(pane) {
    const g = S.goals;
    if (!g) { pane.innerHTML = '<p class="muted">Loading…</p>'; return; }
    const line = (x) => `<div class="goal${x.done ? ' done' : ''}"><span>${x.done ? '✅' : '⬜'} ${esc(x.text)}</span><small>${Math.max(0, x.have)}/${x.n} · 🪙${x.reward}</small><i><b style="width:${Math.min(100, (Math.max(0, x.have) / x.n) * 100)}%"></b></i></div>`;
    pane.innerHTML = `<h3>Today</h3>${g.daily.map(line).join('')}<h3>This week</h3>${line(g.weekly)}<p class="muted small">New goals every morning (and every Monday for the weekly one). Rewards are paid as soon as you finish.</p>`;
  }
  function renderFest(pane) {
    const fv = S.fest;
    const f = fv?.fest;
    const today = worldClock(Date.now() + S.timeOffset, S.epoch).day;
    if (!f || f.day !== today) {
      const nx = fv?.next;
      pane.innerHTML = nx ? `<div class="city-card">${EVENTS[nx.id].icon} Next festival: <b>${EVENTS[nx.id].name}</b> on day ${nx.day} (in ${nx.day - today} day${nx.day - today === 1 ? '' : 's'}). Bring ${EVENTS[nx.id].what}.</div>` : '';
      pane.insertAdjacentHTML('beforeend', `<p class="muted">Festivals happen every 7th day at the Harvest Fair (or the town square). Enter before 6 PM for 🪙${fv?.fee || 25} (it goes into the prize pool, with City Hall’s sponsorship); the top three share the pool 50 / 30 / 20, and first place gets a trophy. Villagers enter too!${fv?.pool ? ` Today’s pool: 🪙${fv.pool}.` : ''}</p>`);
    }
    if (f) {
      const E = EVENTS[f.id];
      const card = el('div', { className: 'city-card hl' });
      card.innerHTML = `${E.icon} <b>${E.name}</b> · day ${f.day} · ${f.judged ? 'judged' : 'judging at 6 PM'}<div class="muted">Bring ${E.what}: judged on value and quality.</div>`;
      pane.appendChild(card);
      const list = f.judged ? f.results : f.entries;
      pane.insertAdjacentHTML('beforeend', `<h3>${f.judged ? 'Winners' : 'Entries so far'}</h3>${(list || []).map((e, i) => `<div>${f.judged ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} <b>${esc(e.name)}</b>: ${GOODS[e.item]?.icon || ''} ${esc(itemName(e.item))} ${QUALITY[e.q || 0].icon} <small class="muted">${Math.round(e.score)} pts${e.prize ? ` · 🪙${e.prize}` : ''}</small></div>`).join('') || '<div class="muted">No entries yet.</div>'}`);
      if (!f.judged && f.day === today && !f.entries.some((e) => e.pid === S.me.id)) {
        const opts = bagItems((k) => canEnter(f.id, k));
        if (!opts.length) pane.insertAdjacentHTML('beforeend', `<p class="muted">You have nothing to enter yet.</p>`);
        else {
          const sel = itemSelect((k) => canEnter(f.id, k));
          const go = el('button', { className: 'primary', textContent: `${E.icon} Enter` });
          go.onclick = () => send({ type: 'festEnter', item: sel.value });
          pane.append(el('div', { className: 'row' }, sel, go), el('p', { className: 'muted small', textContent: 'Enter at the Harvest Fair or the town square. Your best-quality one is entered.' }));
        }
      }
    }
  }
  function renderPaper(pane) {
    const p = S.paper;
    if (!p) { pane.innerHTML = '<p class="muted">The first edition comes out tomorrow morning.</p>'; return; }
    S.paperSeen = p.day;
    c.badges();
    pane.innerHTML = `<div class="paper"><h2>📰 ${esc(p.title)}</h2><div class="muted">Day ${p.day}</div>${p.stories.map((s) => `<h4>${esc(s.h)}</h4><p>${esc(s.text)}</p>`).join('')}</div>`;
  }

  // ---------- context actions (the big button) ----------
  function contextAction() {
    if (fish.state === 'bite') return { id: 'reel', label: '❗ Reel in!' };
    if (fish.state === 'cast') return { id: 'fishstop', label: '🎣 Waiting for a bite… ✋' };
    if (fishAvailable()) return { id: 'fish', label: '🎣 Fish' };
    const near = (t, r = 2.6) => world.decor.some((d) => d.t === t && Math.hypot((d.x + footprint(t, d.r || 0)[0] / 2) * TILE - S.me.x, (d.y + footprint(t, d.r || 0)[1] / 2) * TILE - S.me.y) < r * TILE);
    if (near('noticeboard', 3)) return { id: 'board', label: '📌 Notice board' };
    const nearPlotThing = (t, r = 2.2) => Object.values(S.plots).some((p) => Math.abs(p.x + p.w / 2 - S.me.x / TILE) < p.w / 2 + 3 && Math.abs(p.y + p.h / 2 - S.me.y / TILE) < p.h / 2 + 3
      && Object.entries(p.obj).some(([k, o]) => { if (o.t !== t) return false; const [x, y] = k.split(',').map(Number); return Math.hypot((p.x + x + 0.5) * TILE - S.me.x, (p.y + y + 0.5) * TILE - S.me.y) < r * TILE; }));
    if (near('mailbox') || nearPlotThing('mailbox')) return { id: 'mailbox', label: `📬 Mailbox${unread() ? ` (${unread()} new)` : ''}` };
    const f = S.fest?.fest;
    const area = publicAreaAt(Math.floor(S.me.x / TILE), Math.floor(S.me.y / TILE));
    if (f && !f.judged && f.day === worldClock(Date.now() + S.timeOffset, S.epoch).day && (area === FAIR || area === SQUARE) && !f.entries.some((e) => e.pid === S.me.id)) return { id: 'fest', label: `${EVENTS[f.id].icon} Enter the ${EVENTS[f.id].name}` };
    return null;
  }
  function runAction(id) {
    if (id === 'reel') send({ type: 'fishReel' });
    else if (id === 'fishstop') send({ type: 'fishStop' });
    else if (id === 'fish') send({ type: 'fishCast' });
    else if (id === 'board') showBoard();
    else if (id === 'mailbox') showMail();
    else if (id === 'fest') showJournal('fest');
  }
  function onMove() { if (fish.state) { send({ type: 'fishStop' }); fish.state = null; } }

  // ---------- messages ----------
  function handle(m) {
    switch (m.type) {
      case 'trade': S.trade = m.trade; showTrade(); return true;
      case 'board': S.board = m.board; if (modal() === 'board') showBoard(); return true;
      case 'mail': S.mail = m.mail; c.badges(); if (modal() === 'mail') showMail(); return true;
      case 'goals': S.goals = m.goals; c.bookChanged?.(); return true;
      case 'fest': S.fest = m; c.bookChanged?.(); return true;
      case 'paper': S.paper = m.paper; c.badges(); c.bookChanged?.(); return true;
      case 'fishing': {
        if (m.state === 'cast') Object.assign(fish, { state: 'cast', tx: m.tx, ty: m.ty, at: performance.now() });
        else if (m.state === 'bite') { fish.state = 'bite'; navigator.vibrate?.(80); }
        else {
          fish.state = null;
          if (m.state === 'caught') toast(`🎣 Caught a ${QUALITY[m.q].name ? `${QUALITY[m.q].name.toLowerCase()} ` : ''}${itemName(m.fish)}! ${GOODS[m.fish].icon}${QUALITY[m.q].icon ? ` ${QUALITY[m.q].icon}` : ''}`);
          else if (m.state === 'early') toast('🎣 Too soon! Wait for the ❗ before reeling in.');
          else if (m.state === 'escaped') toast('🎣 It got away… reel in faster when you see ❗');
        }
        return true;
      }
    }
    return false;
  }

  return { handle, showTrade, showBoard, showMail, showStore, showJournal, renderFest, renderPaper, drawFishing, contextAction, runAction, onMove, unread, fish, storeOpen: () => storeAt };
}
