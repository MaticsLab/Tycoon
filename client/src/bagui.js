// The bag: a slot-grid inventory (Stardew / Minecraft style). 27 backpack slots and a
// 9-slot hotbar (also always on the HUD), drag and drop, Sort, a Trash target and a
// details pane with an amount picker and Eat / Give / Drop. Quests and the Journal are
// folder tabs on the same window.
//
// The server keeps the bag as counts per item; which slot each item sits in is just
// how you've arranged it, kept on this device.
import { GOODS, ITEMS } from '@shared/catalog.js';
import { FOODS, NEEDS, HEALTH } from '@shared/needs.js';

const HOT = 9, PACK = 27;
const CAT = {
  produce: ['Crop', 'crop'], fish: ['Fish', 'drink'], gift: ['Gift', 'gift'], product: ['Homemade', 'food'], animal: ['From animals', 'food'],
  tool: ['Tool', 'plain'], feed: ['Feed', 'plain'], material: ['Material', 'plain'],
};
const DRINKS = new Set(['tea', 'juice', 'milk']);
const ORDER = ['Crop', 'Food', 'Drink', 'Gift', 'Fish', 'From animals', 'Homemade', 'Material', 'Feed', 'Tool', 'Furniture'];

// c: { S, send, toast, esc, store, iconOf(id) -> element, nearest() -> { kind: 'player'|'npc', id, name } | null,
//      quests(el), goals(el), fest(el), paper(el), itemName(id) }
export function makeBag(c) {
  const { S, send, esc } = c;
  let root = null, tab = 'bag', jtab = 'goals', sel = null, amount = 1, drag = null;
  let slots = new Array(HOT + PACK).fill(null);
  const key = () => `bagslots:${S.me?.id || 'guest'}`;
  try { const v = JSON.parse(c.store.get(key()) || 'null'); if (Array.isArray(v)) slots = v; } catch { /* fresh */ }
  let loadedFor = S.me?.id;
  const save = () => { try { c.store.set(key(), JSON.stringify(slots)); } catch { /* full */ } };

  // Keep the slots in step with what's actually in the bag.
  function sync() {
    if (S.me?.id && loadedFor !== S.me.id) {
      loadedFor = S.me.id;
      try { const v = JSON.parse(c.store.get(key()) || 'null'); slots = Array.isArray(v) ? v : []; } catch { slots = []; }
    }
    const inv = S.inv || {};
    slots = slots.map((id) => (id && inv[id] > 0 ? id : null));
    const have = new Set(slots.filter(Boolean));
    for (const id of Object.keys(inv)) {
      if (!(inv[id] > 0) || have.has(id)) continue;
      let i = slots.indexOf(null);
      if (i < 0) { i = slots.length; slots.push(null); } // more kinds than slots: the backpack grows
      slots[i] = id;
    }
    while (slots.length < HOT + PACK) slots.push(null);
    // Trim empty overflow rows beyond the standard backpack.
    while (slots.length > HOT + PACK && slots.slice(-9).every((s) => !s)) slots.length -= 9;
    save();
  }

  const info = (id) => {
    if (ITEMS[id]) return { name: ITEMS[id].name, cat: 'Furniture', chip: 'plain', line: 'Furniture: place it from the Bag tab in Build mode.' };
    const g = GOODS[id] || { name: id, kind: '' };
    let [cat, chip] = CAT[g.kind] || ['Item', 'plain'];
    if (DRINKS.has(id)) { cat = 'Drink'; chip = 'drink'; } else if (FOODS[id] && g.kind !== 'produce' && g.kind !== 'gift' && g.kind !== 'fish') { cat = 'Food'; chip = 'food'; }
    const line = {
      tool: id === 'wateringcan' || id === 'bigcan' ? 'Walk through your crops to water them.' : 'Used automatically when you need it.',
      fish: 'Rosa buys fish. Eat them, smoke them, or enter the Fishing Derby.',
      feed: 'Feed your animals at their coop or barn.', animal: 'From your animals. Rosa buys these, or make cheese, cloth and cake.',
      produce: 'Rosa buys crops, or sell them in your own shop.', product: 'Homemade. Sell it in your shop or to Rosa.', material: 'For building and crafting.',
      gift: 'A gift. Villagers love the right present.',
    }[g.kind] || 'Give it to a villager, or sell it.';
    return { name: g.name, icon: g.icon, cat, chip, line };
  };

  // ---------- window ----------
  function build() {
    root = document.createElement('div');
    root.id = 'bagwin';
    root.hidden = true;
    root.innerHTML = `<div class="bw-wrap"><div class="bw-tabs" role="tablist"></div>
      <div class="bw-panel" role="dialog" aria-label="Bag"><button type="button" class="bw-close" aria-label="Close">✕</button><div class="bw-body"></div></div></div>`;
    document.body.appendChild(root);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
    root.querySelector('.bw-close').onclick = close;
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
  }
  const isOpen = (t) => !!root && !root.hidden && (!t || tab === t);
  function open(t = tab) {
    if (!root) build();
    tab = t;
    root.hidden = false;
    render();
  }
  function close() { if (root) root.hidden = true; drag = null; }

  function render() {
    if (!root || root.hidden) return;
    sync();
    const badge = { quests: S.quests?.length ? '!' : '', journal: S.paper && S.paperSeen !== S.paper.day ? '!' : '' };
    root.querySelector('.bw-tabs').innerHTML = [['bag', '🎒', 'Bag'], ['quests', '📜', 'Quests'], ['journal', '📖', 'Journal']].map(([k, ic, l]) =>
      `<button type="button" role="tab" class="bw-tab${tab === k ? ' on' : ''}" data-tab="${k}" aria-selected="${tab === k}"><span>${ic}</span>${l}${badge[k] ? '<i>!</i>' : ''}</button>`).join('');
    for (const b of root.querySelectorAll('.bw-tab')) b.onclick = () => { tab = b.dataset.tab; render(); };
    const body = root.querySelector('.bw-body');
    body.className = `bw-body bw-${tab}`;
    body.innerHTML = '';
    if (tab === 'bag') renderBag(body);
    else if (tab === 'quests') { body.insertAdjacentHTML('beforeend', '<h2 class="bw-h">Requests</h2>'); const el = document.createElement('div'); el.className = 'bw-list'; body.appendChild(el); c.quests(el); }
    else renderJournal(body);
  }

  function renderJournal(body) {
    body.insertAdjacentHTML('beforeend', `<div class="bw-subtabs">${[['goals', '✅ Goals'], ['fest', '🎪 Festival'], ['paper', '📰 Gazette']].map(([k, l]) => `<button type="button" class="${jtab === k ? 'on' : ''}" data-j="${k}">${l}</button>`).join('')}</div>`);
    for (const b of body.querySelectorAll('[data-j]')) b.onclick = () => { jtab = b.dataset.j; render(); };
    const pane = document.createElement('div');
    pane.className = 'bw-pane';
    body.appendChild(pane);
    if (jtab === 'goals') renderGoals(pane); else if (jtab === 'fest') c.fest(pane); else c.paper(pane);
  }
  function renderGoals(pane) {
    const g = S.goals;
    if (!g) { pane.innerHTML = '<p class="bw-muted">Loading…</p>'; return; }
    const card = (x) => `<div class="bw-goal${x.done ? ' done' : ''}"><div class="bw-goal-top"><b>${x.done ? '✅ ' : ''}${esc(x.text)}</b><span class="bw-chip food">🪙${x.reward}</span></div>
      <div class="bw-bar"><i style="width:${Math.min(100, (Math.max(0, x.have) / x.n) * 100)}%"></i></div><small>${Math.max(0, Math.min(x.have, x.n))}/${x.n}</small></div>`;
    pane.innerHTML = `<div class="bw-label">TODAY</div><div class="bw-goals">${g.daily.map(card).join('')}</div>
      <div class="bw-label">THIS WEEK</div><div class="bw-goals">${card(g.weekly)}</div>
      <p class="bw-muted">New goals every morning (and every Monday for the weekly one). Rewards are paid as soon as you finish.</p>`;
  }

  // ---------- the bag ----------
  const slotHtml = (i, small = false) => {
    const id = slots[i], n = id ? S.inv[id] || 0 : 0, q = id ? S.qual?.[id] : null;
    const it = id && info(id);
    return `<div class="bw-slot${sel === i ? ' sel' : ''}${i === S.hotHeld && i < HOT ? ' held' : ''}" data-slot="${i}" ${id ? `title="${esc(it.name)} ×${n}" draggable="false"` : ''} role="button" tabindex="0" aria-label="${id ? `${esc(it.name)}, ${n}` : 'Empty slot'}">
      ${i < HOT && !small ? `<em>${i + 1}</em>` : ''}${id ? `<span class="ic" data-icon="${id}">${it.icon || ''}</span>${n > 1 ? `<b>${n}</b>` : ''}${q && (q[0] || q[1]) ? '<u>★</u>' : ''}` : ''}</div>`;
  };
  function fillIcons(el) {
    for (const s of el.querySelectorAll('.ic[data-icon]')) if (!s.textContent) s.appendChild(c.iconOf(s.dataset.icon));
  }
  function renderBag(body) {
    const used = slots.filter(Boolean).length;
    body.innerHTML = `<div class="bw-left">
        <div class="bw-toolbar"><span class="bw-label">BACKPACK · ${used}/${slots.length}</span><span class="bw-spacer"></span>
          <div class="bw-pill bw-trash" data-trash="1" title="Drag something here to throw it away">🗑️ Trash</div>
          <button type="button" class="bw-pill bw-sort">↕️ Sort</button></div>
        <div class="bw-tray bw-pack">${slots.slice(HOT).map((_, j) => slotHtml(HOT + j)).join('')}</div>
        <div class="bw-hotlabel"><span class="bw-label">HOTBAR</span><small>Press 1–9 to hold. Drag items to move them.</small></div>
        <div class="bw-tray bw-hot">${Array.from({ length: HOT }, (_, i) => slotHtml(i)).join('')}</div>
      </div><div class="bw-details"></div>`;
    fillIcons(body);
    body.querySelector('.bw-sort').onclick = sort;
    wireSlots(body);
    renderDetails();
  }
  function renderDetails() {
    const el = root?.querySelector('.bw-details');
    if (!el) return;
    const id = sel != null ? slots[sel] : null;
    if (!id) { el.innerHTML = '<p class="bw-empty">Click an item to see what it does.</p>'; return; }
    const n = S.inv[id] || 0, it = info(id), food = FOODS[id];
    amount = Math.max(1, Math.min(amount, n));
    const gives = food ? Object.entries(food).map(([k, v]) => `+${v * amount} ${(NEEDS.find((x) => x.id === k) || HEALTH).name}`).join(', ') : '';
    const q = S.qual?.[id];
    const qual = q && (q[0] || q[1]) ? [q[1] && `★★ ${q[1]}`, q[0] && `★ ${q[0]}`, `plain ${Math.max(0, n - (q[0] || 0) - (q[1] || 0))}`].filter(Boolean).join(' · ') : '';
    const who = c.nearest();
    const giveN = who?.kind === 'npc' ? 1 : amount;
    el.innerHTML = `<div class="bw-dhead"><div class="bw-dicon ic" data-icon="${id}">${it.icon || ''}</div><div><b class="bw-dname">${esc(it.name)}</b><span class="bw-chip ${it.chip}">${it.cat}</span></div></div>
      <p class="bw-desc">${esc(it.line)}</p>
      <div class="bw-facts"><div><span>In bag</span><b>${n}</b></div>${gives ? `<div class="bw-good">Eating gives ${esc(gives)}</div>` : ''}${qual ? `<div class="bw-q"><span>Quality</span><b>${qual}</b></div>` : ''}</div>
      <div class="bw-amount"><span>Amount</span><button type="button" data-a="-1" aria-label="Fewer">−</button><b>${amount}</b><button type="button" data-a="1" aria-label="More">+</button><button type="button" class="bw-all" data-a="all">All</button></div>
      <div class="bw-actions">
        ${food && !ITEMS[id] ? `<button type="button" class="bw-eat" data-act="eat">Eat ${amount}</button>` : ''}
        <button type="button" class="bw-give${who ? '' : ' off'}" data-act="give" ${who ? '' : 'aria-disabled="true" title="Stand near someone to give them things"'}>${who ? `Give ${giveN} to ${esc(who.name)}` : 'Give'}</button>
        <button type="button" class="bw-drop" data-act="drop">Drop ${amount}</button>
      </div>`;
    fillIcons(el);
    for (const b of el.querySelectorAll('[data-a]')) b.onclick = () => { amount = b.dataset.a === 'all' ? n : amount + Number(b.dataset.a); renderDetails(); };
    for (const b of el.querySelectorAll('[data-act]')) b.onclick = () => act(b.dataset.act, id);
  }
  function act(what, id) {
    const n = Math.min(amount, S.inv[id] || 0);
    if (!n) return;
    if (what === 'eat') {
      for (let i = 0; i < n; i++) send({ type: 'eat', item: id });
      const f = FOODS[id] || {};
      c.toast(`Ate ${n} ${info(id).name}${f.hunger ? ` · +${f.hunger * n} Hunger` : ''}`);
    } else if (what === 'give') {
      const who = c.nearest();
      if (!who) return c.toast('Stand near someone to give them things');
      if (who.kind === 'npc') send({ type: 'gift', npc: who.id, item: id });
      else send({ type: 'giveTo', to: who.id, item: id, n });
      c.toast(`Gave ${who.name} ${info(id).name} ×${who.kind === 'npc' ? 1 : n}`);
    } else if (what === 'drop') send({ type: 'drop', item: id, n });
    amount = 1;
  }
  function sort() {
    const hot = slots.slice(0, HOT);
    const rest = slots.slice(HOT).filter(Boolean).sort((a, b) => ORDER.indexOf(info(a).cat) - ORDER.indexOf(info(b).cat) || info(a).name.localeCompare(info(b).name));
    slots = [...hot, ...rest];
    while (slots.length < HOT + PACK) slots.push(null);
    sel = null; save(); render(); renderHud();
  }

  // Click to select (and hold, on the hotbar); drag to move (onto Trash to throw away).
  function wireSlots(body) {
    for (const el of body.querySelectorAll('[data-slot]')) {
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(+el.dataset.slot); } };
      el.onpointerdown = (e) => {
        const i = +el.dataset.slot;
        if (!slots[i] || e.button > 0) { if (e.button === 0) pick(i); return; }
        drag = { from: i, x: e.clientX, y: e.clientY, moved: false, ghost: null };
        el.setPointerCapture(e.pointerId);
      };
      el.onpointermove = (e) => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        if (!drag.moved) {
          drag.moved = true;
          drag.ghost = document.createElement('div');
          drag.ghost.className = 'bw-ghost';
          drag.ghost.innerHTML = el.innerHTML;
          document.body.appendChild(drag.ghost);
          root.querySelector('.bw-trash')?.classList.add('armed');
        }
        drag.ghost.style.left = `${e.clientX - 30}px`; drag.ghost.style.top = `${e.clientY - 30}px`;
      };
      el.onpointerup = (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        d.ghost?.remove();
        root.querySelector('.bw-trash')?.classList.remove('armed');
        if (!d.moved) return pick(d.from);
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (under?.closest('[data-trash]')) {
          const id = slots[d.from], n = S.inv[id] || 0;
          send({ type: 'trash', item: id, n });
          c.toast(`Threw away ${info(id).name} ×${n}`);
          if (sel === d.from) sel = null;
          return;
        }
        const to = under?.closest('[data-slot]');
        if (!to) return;
        const j = +to.dataset.slot;
        [slots[d.from], slots[j]] = [slots[j], slots[d.from]];
        if (sel === d.from) sel = j; else if (sel === j) sel = d.from;
        save(); render(); renderHud();
      };
      el.onpointercancel = () => { drag?.ghost?.remove(); drag = null; };
    }
  }
  function pick(i) {
    sel = sel === i ? null : i;
    if (i < HOT) S.hotHeld = i;
    amount = 1;
    render(); renderHud();
  }

  // ---------- the HUD hotbar ----------
  let hud = null;
  function renderHud() {
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'hotbar';
      hud.setAttribute('aria-label', 'Hotbar');
      document.getElementById('hud')?.appendChild(hud);
      hud.addEventListener('click', (e) => { const s = e.target.closest('[data-slot]'); if (s) hold(+s.dataset.slot, true); });
    }
    sync();
    hud.innerHTML = Array.from({ length: HOT }, (_, i) => slotHtml(i)).join('');
    fillIcons(hud);
  }
  // Keys 1-9 hold that slot; clicking the held slot on the HUD again lets go.
  function hold(i, toggle = false) {
    S.hotHeld = toggle && S.hotHeld === i ? null : i;
    renderHud();
    const id = slots[i];
    if (id && S.hotHeld === i) c.toast(`Holding ${info(id).name}${FOODS[id] ? ' · tap the action button to eat' : ''}`);
  }
  const held = () => (S.hotHeld != null ? slots[S.hotHeld] : null);

  return { open, close, isOpen, render, renderHud, hold, held, refresh: () => { render(); renderHud(); } };
}
