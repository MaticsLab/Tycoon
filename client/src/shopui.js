// Shops, the way the design handoff has them:
//  · the shopkeeper's Shop window (villager shops: what they sell, and what they buy),
//  · shelves in player and villager shops you browse yourself, filling a cart you carry
//    from shelf to shelf and pay for once (owners stock spots, set prices, take back),
//  · the cart button on the HUD while you're in a shop.
import { NPCS } from '@shared/npcs.js';
import { ITEMS, GOODS, itemName } from '@shared/catalog.js';
import { slotsOf, valueOf, sellable, shopOpen, STAFF, OPEN_HOURS } from '@shared/business.js';
import { worldClock, plotIdAtPixel, TILE } from '@shared/world.js';
import { drawLook } from './people.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COIN = '<i class="coin" aria-hidden="true"></i>';
const money = (n) => `${COIN}${Number(n).toLocaleString()}`;
const X_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const CHAT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const CART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H7"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/></svg>';

export function makeShopUI({ S, send, toast, thumb, world, serverNow, onBackToChat, onClose }) {
  // ---------- 1a. the shopkeeper's window ----------
  let shop = null; // { npc, tab, sel, qty, line }
  const win = document.createElement('div');
  win.id = 'shopwin'; win.className = 'sw'; win.hidden = true; win.setAttribute('role', 'dialog');
  document.body.appendChild(win);
  const back = document.createElement('div');
  back.className = 'sw-dim'; back.hidden = true;
  document.body.appendChild(back);
  back.onclick = () => closeShop();

  const big = (id, px) => {
    const el = thumb(id);
    el.classList.add('sw-sprite');
    el.style.setProperty('--px', `${px}px`);
    return el;
  };
  function openShop(view, line) {
    shop = { npc: view.npc, tab: view.sells.length ? 'buy' : 'sell', sel: null, qty: 1, line: line || null };
    win.hidden = false; back.hidden = false;
    renderShop();
  }
  function closeShop(toChat = false) {
    if (!shop) return;
    shop = null;
    win.hidden = true; back.hidden = true;
    if (toChat) onBackToChat?.(); else onClose?.();
  }
  function renderShop() {
    if (!shop || !S.talk || S.talk.npc !== shop.npc) return;
    const v = S.talk.view, def = NPCS[shop.npc];
    const [job, place] = def.role.split(' · ');
    const title = place || `${def.name}’s Shop`;
    const list = shop.tab === 'buy' ? v.sells : v.buys;
    if (!shop.sel || !list.some((x) => x.item === shop.sel)) { shop.sel = list[0]?.item || null; shop.qty = 1; }
    const lastLine = shop.line || [...S.talk.lines].reverse().find((l) => l.who === 'them')?.text || 'Have a look around.';
    win.innerHTML = `
      <div class="sw-head">
        <canvas class="sw-portrait" width="72" height="72"></canvas>
        <div class="sw-who">
          <div class="sw-title">${esc(title)}</div>
          <div class="sw-sub">${esc(def.name)} · ${esc(job)}</div>
          <div class="sw-bubble">${esc(lastLine)}</div>
        </div>
        <span class="sw-coins" title="Your coins">${money(S.coins)}</span>
        <button type="button" class="sw-round" data-k="chat" title="Back to chat" aria-label="Back to chat">${CHAT_ICON}</button>
        <button type="button" class="sw-round" data-k="close" aria-label="Close">${X_ICON}</button>
      </div>
      ${v.sells.length && v.buys.length ? `<div class="sw-tabs"><button type="button" data-tab="buy" class="${shop.tab === 'buy' ? 'on' : ''}">🛍️ For sale</button><button type="button" data-tab="sell" class="${shop.tab === 'sell' ? 'on' : ''}">🧺 Sell to ${esc(def.name)}</button></div>` : ''}
      <div class="sw-body">
        <div class="sw-left">
          <div class="sw-label">${shop.tab === 'buy' ? `FOR SALE · ${list.length} ITEMS` : `${esc(def.name.toUpperCase())} BUYS · ${list.length} ITEMS`}</div>
          <div class="sw-grid"></div>
        </div>
        <div class="sw-detail"></div>
      </div>`;
    drawLook(win.querySelector('.sw-portrait'), def.look, { crop: 'bust' });
    win.querySelector('[data-k=chat]').onclick = () => closeShop(true);
    win.querySelector('[data-k=close]').onclick = () => closeShop();
    for (const b of win.querySelectorAll('[data-tab]')) b.onclick = () => { shop.tab = b.dataset.tab; shop.sel = null; renderShop(); };
    const grid = win.querySelector('.sw-grid');
    for (const it of list) {
      const have = S.inv[it.item] || 0;
      const c = document.createElement('button');
      c.type = 'button';
      c.className = `sw-card${shop.sel === it.item ? ' sel' : ''}${shop.tab === 'buy' && it.price > S.coins ? ' poor' : ''}${shop.tab === 'sell' && !have ? ' poor' : ''}`;
      const tile = document.createElement('div'); tile.className = 'sw-tile'; tile.appendChild(big(it.item, 48));
      c.appendChild(tile);
      c.insertAdjacentHTML('beforeend', `<div class="sw-cardtxt"><b>${esc(itemName(it.item))}</b><small>${ITEMS[it.item] ? 'Furniture' : GOODS[it.item]?.tool ? 'Tool' : 'Goods'}</small><span class="sw-chip">${money(it.price)}</span></div>${have ? `<em class="sw-owned">${have} ${shop.tab === 'buy' ? 'owned' : 'in bag'}</em>` : ''}`);
      c.onclick = () => { shop.sel = it.item; shop.qty = 1; renderShop(); };
      grid.appendChild(c);
    }
    if (!list.length) grid.innerHTML = '<p class="sw-empty">Nothing here today.</p>';
    renderDetail(list.find((x) => x.item === shop.sel));
  }
  function renderDetail(it) {
    const box = win.querySelector('.sw-detail');
    if (!it) { box.innerHTML = '<p class="sw-empty">Pick something to see more.</p>'; return; }
    const buying = shop.tab === 'buy', have = S.inv[it.item] || 0;
    const max = buying ? 9 : Math.max(1, have);
    shop.qty = Math.max(1, Math.min(max, shop.qty));
    const total = it.price * shop.qty, after = buying ? S.coins - total : S.coins + total;
    const ok = buying ? after >= 0 : have >= shop.qty;
    box.innerHTML = `
      <div class="sw-stage"></div>
      <div class="sw-dname">${esc(itemName(it.item))}</div>
      <span class="sw-cat">${ITEMS[it.item] ? 'Furniture' : 'Goods'}</span>
      <div class="sw-facts">
        <div><span>Price each</span><b>${money(it.price)}</b></div>
        <div><span>Amount</span><span class="sw-qty"><button type="button" data-q="-1" aria-label="Less">−</button><b>${shop.qty}</b><button type="button" data-q="1" aria-label="More">+</button></span></div>
        <div><span>Total</span><b>${money(total)}</b></div>
        ${buying ? `<div><span>Left after</span><b class="${ok ? 'ok' : 'bad'}">${ok ? money(after) : `Need ${money(-after)} more`}</b></div>` : `<div><span>In your bag</span><b class="${have ? 'ok' : 'bad'}">${have}</b></div>`}
      </div>
      <button type="button" class="sw-buy" ${ok ? '' : 'disabled'}>${buying ? `Buy for ${money(total)}` : `Sell ${shop.qty} for ${money(total)}`}</button>
      <p class="sw-note">${buying ? (ITEMS[it.item] ? 'Goes in your bag. Place it from Builder mode.' : 'Goes in your bag.') : 'Prices depend on how they feel about you and the market.'}</p>`;
    box.querySelector('.sw-stage').appendChild(big(it.item, 96));
    for (const b of box.querySelectorAll('[data-q]')) b.onclick = () => { shop.qty += Number(b.dataset.q); renderDetail(it); };
    box.querySelector('.sw-buy').onclick = () => {
      if (buying) { send({ type: 'buy', npc: shop.npc, item: it.item, qty: shop.qty }); toast(`Bought ${itemName(it.item)} ×${shop.qty}`); }
      else send({ type: 'sell', npc: shop.npc, item: it.item, qty: shop.qty });
      shop.qty = 1;
    };
  }

  // ---------- 1b/1c. shelves ----------
  let shelf = null; // { plotId, i, sel, qty, picking }
  const sw = document.createElement('div');
  sw.id = 'shelfwin'; sw.className = 'sw sh'; sw.hidden = true; sw.setAttribute('role', 'dialog');
  document.body.appendChild(sw);
  const shelvesOf = (plot) => [[0, plot], [1, plot.l1]].flatMap(([level, v]) => (v ? Object.entries(v.obj).filter(([, o]) => slotsOf(o.t)).map(([key, o]) => ({ level, key, o })) : []))
    .sort((a, b) => a.level - b.level || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const mine = (plot) => plot.owner === S.me?.id;
  function openShelf(u) {
    const plot = S.plots[u.plot.id];
    const list = shelvesOf(plot);
    const i = Math.max(0, list.findIndex((x) => x.level === (u.level || 0) && x.key === u.key));
    shelf = { plotId: plot.id, i, sel: null, qty: 1, picking: false };
    sw.hidden = false; back.hidden = false;
    back.onclick = () => closeShelf();
    renderShelf();
  }
  function closeShelf() { shelf = null; sw.hidden = true; back.hidden = true; back.onclick = () => closeShop(); }
  const cartQty = (plotId, level, key, item) => S.cart.filter((c) => c.plotId === plotId && c.level === level && c.key === key && c.item === item).reduce((a, c) => a + c.qty, 0);
  function renderShelf() {
    if (!shelf) return;
    const plot = S.plots[shelf.plotId];
    const list = plot ? shelvesOf(plot) : [];
    if (!list.length) return closeShelf();
    shelf.i = Math.min(shelf.i, list.length - 1);
    const cur = list[shelf.i], own = mine(plot), stock = cur.o.stock || [];
    const n = slotsOf(cur.o.t), name = plot.biz?.name || `${plot.ownerName || 'A'}’s Shop`;
    const b = S.biz;
    const { hours } = worldClock(serverNow(), S.epoch);
    const tillManned = [...S.players.values()].some((p) => p.id === plot.owner && p.act === 'cashier');
    const open = shopOpen(plot.biz, hours, tillManned);
    sw.innerHTML = `
      <div class="sw-head">
        <div class="sh-glyph"></div>
        <div class="sw-who">
          <div class="sw-title">${own ? 'Your shelf' : `${esc(name)} · Shelf ${shelf.i + 1}`}</div>
          <div class="sw-sub">${own ? `${esc(name)} · sold ${plot.rental ? plot.sold || 0 : b?.sales?.items || 0} so far${plot.rental ? ' this week' : ''}` : open ? 'Self-serve. Add things to your cart, then pay.' : `Closed right now${plot.biz?.staff ? ` (${STAFF[plot.biz.staff].name} works ${OPEN_HOURS[0]} AM – ${OPEN_HOURS[1] - 12} PM)` : plot.biz?.npc ? ' (open 8 AM – 8 PM)' : ''}.`}</div>
        </div>
        ${list.length > 1 ? `<span class="sh-switch"><button type="button" data-s="-1" aria-label="Previous shelf">‹</button>Shelf ${shelf.i + 1} of ${list.length}<button type="button" data-s="1" aria-label="Next shelf">›</button></span>` : ''}
        <span class="sw-coins"><small>${own ? 'TILL' : 'YOU'}</small>${money(own ? (plot.rental ? plot.till || 0 : b?.sales?.today || 0) : S.coins)}</span>
        <button type="button" class="sw-round" data-k="close" aria-label="Close">${X_ICON}</button>
      </div>
      <div class="sh-board"></div>
      <div class="sh-bar"></div>`;
    sw.querySelector('.sh-glyph').appendChild(thumb(cur.o.t));
    sw.querySelector('[data-k=close]').onclick = () => closeShelf();
    for (const bt of sw.querySelectorAll('[data-s]')) bt.onclick = () => { shelf.i = (shelf.i + Number(bt.dataset.s) + list.length) % list.length; shelf.sel = null; shelf.picking = false; renderShelf(); };
    const board = sw.querySelector('.sh-board');
    const perRow = n <= 4 ? n : Math.ceil(n / 2);
    for (let r = 0; r * perRow < n; r++) {
      const row = document.createElement('div'); row.className = 'sh-row';
      for (let k = r * perRow; k < Math.min(n, (r + 1) * perRow); k++) {
        const sl = stock[k];
        const spot = document.createElement('button');
        spot.type = 'button';
        const inCart = sl ? cartQty(plot.id, cur.level, cur.key, sl.item) : 0;
        const left = sl ? sl.n - inCart : 0;
        spot.className = `sh-spot${sl ? '' : ' empty'}${shelf.sel === k ? ' sel' : ''}${sl && !left ? ' gone' : ''}`;
        if (sl) {
          const ic = thumb(sl.item); ic.classList.add('sh-ic');
          spot.appendChild(ic);
          spot.insertAdjacentHTML('beforeend', `<b class="sh-n">${left}</b>${inCart ? `<span class="sh-incart">${CART_ICON}${inCart}</span>` : ''}<span class="sh-tag">${money(sl.price)}</span>`);
          spot.title = `${itemName(sl.item)} ×${sl.n}`;
        } else spot.innerHTML = `<span class="sh-emptyl">${own ? '+ Stock' : 'Empty'}</span>`;
        spot.onclick = () => { if (!sl && !own) return; shelf.sel = k; shelf.qty = 1; shelf.picking = !sl; renderShelf(); };
        row.appendChild(spot);
      }
      board.appendChild(row);
    }
    renderBar(plot, cur, own, open);
  }
  function renderBar(plot, cur, own, open) {
    const bar = sw.querySelector('.sh-bar');
    const at = { plotId: plot.id, level: cur.level, lx: +cur.key.split(',')[0], ly: +cur.key.split(',')[1] };
    const sl = shelf.sel != null ? cur.o.stock?.[shelf.sel] : null;
    if (own && shelf.picking) {
      const goods = Object.entries(S.inv).filter(([k, q]) => q > 0 && sellable(k));
      bar.innerHTML = `<div class="sh-label">STOCK THIS SPOT FROM YOUR BAG</div><div class="sh-pills"></div>`;
      const pills = bar.querySelector('.sh-pills');
      if (!goods.length) pills.innerHTML = '<p class="sw-empty">Nothing to sell yet: harvest crops, or make products in machines.</p>';
      for (const [k, q] of goods) {
        const p = document.createElement('button'); p.type = 'button'; p.className = 'sh-pill';
        p.appendChild(thumb(k));
        p.insertAdjacentHTML('beforeend', `<span>${esc(itemName(k))}</span><small>×${q}</small>`);
        p.onclick = () => { send({ type: 'stock', ...at, item: k, n: Math.min(10, q), price: (cur.o.stock || []).find((x) => x.item === k)?.price || valueOf(k) }); shelf.picking = false; shelf.sel = null; };
        pills.appendChild(p);
      }
      return;
    }
    if (!sl) { bar.innerHTML = `<p class="sh-hint">${own ? 'Tap an empty spot to stock it, or a stocked one to change its price.' : 'Tap something on the shelf.'}</p>`; return; }
    const ic = thumb(sl.item);
    if (own) {
      bar.innerHTML = `<div class="sh-item"></div><div class="sh-what"><b>${esc(itemName(sl.item))}</b><small>${sl.n} on the shelf · worth about ${money(valueOf(sl.item))}</small></div>
        <div class="sh-price"><small>PRICE EACH</small><span class="sw-qty"><button type="button" data-p="-1" aria-label="Lower">−</button><input type="number" min="1" value="${sl.price}" aria-label="Price each"><button type="button" data-p="1" aria-label="Higher">+</button></span></div>
        <button type="button" class="sh-take">Take back</button>`;
      bar.querySelector('.sh-item').appendChild(ic);
      const inp = bar.querySelector('input');
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      let timer = 0;
      const set = (v) => { v = Math.max(1, Math.floor(v) || 1); inp.value = v; clearTimeout(timer); timer = setTimeout(() => send({ type: 'restock', ...at, slot: shelf.sel, price: v }), 350); };
      inp.onchange = () => set(+inp.value);
      for (const bt of bar.querySelectorAll('[data-p]')) bt.onclick = () => set(+inp.value + Number(bt.dataset.p));
      bar.querySelector('.sh-take').onclick = () => { send({ type: 'restock', ...at, slot: shelf.sel, take: true }); shelf.sel = null; };
      return;
    }
    const avail = sl.n - cartQty(plot.id, cur.level, cur.key, sl.item);
    shelf.qty = Math.max(1, Math.min(Math.max(1, avail), shelf.qty));
    const can = open && avail > 0;
    bar.innerHTML = `<div class="sh-item"></div><div class="sh-what"><b>${esc(itemName(sl.item))}</b><small>${avail} left · ${money(sl.price)} each</small></div>
      <span class="sw-qty"><button type="button" data-q="-1" aria-label="Less">−</button><b>${shelf.qty}</b><button type="button" data-q="1" aria-label="More">+</button></span>
      <button type="button" class="sh-add" ${can ? '' : 'disabled'}>Add ${shelf.qty} to cart · ${money(sl.price * shelf.qty)}</button>`;
    bar.querySelector('.sh-item').appendChild(ic);
    for (const bt of bar.querySelectorAll('[data-q]')) bt.onclick = () => { shelf.qty += Number(bt.dataset.q); renderShelf(); };
    bar.querySelector('.sh-add').onclick = () => {
      if (!can) return;
      const line = S.cart.find((c) => c.plotId === plot.id && c.level === cur.level && c.key === cur.key && c.item === sl.item);
      if (line) { line.qty += shelf.qty; line.price = sl.price; } else S.cart.push({ plotId: plot.id, level: cur.level, key: cur.key, shelf: shelf.i + 1, item: sl.item, price: sl.price, qty: shelf.qty });
      shelf.qty = 1;
      renderShelf(); renderCart();
    };
  }

  // ---------- the cart ----------
  S.cart = [];
  let cartOpen = false;
  const side = $('side');
  const cbtn = document.createElement('button');
  cbtn.id = 'cartbtn'; cbtn.type = 'button'; cbtn.hidden = true; cbtn.title = 'Your cart'; cbtn.setAttribute('aria-label', 'Your cart');
  cbtn.innerHTML = `${CART_ICON}<span class="cart-n"></span>`;
  side.appendChild(cbtn);
  const panel = document.createElement('div');
  panel.id = 'cartpanel'; panel.hidden = true;
  document.body.appendChild(panel);
  cbtn.onclick = () => { cartOpen = !cartOpen; renderCart(); };
  function stockOf(c) {
    const plot = S.plots[c.plotId];
    const v = plot && (c.level ? plot.l1 : plot);
    const sl = v?.obj[c.key]?.stock?.find((x) => x.item === c.item);
    return sl ? sl.n : 0;
  }
  function renderCart() {
    const count = S.cart.reduce((a, c) => a + c.qty, 0);
    cbtn.querySelector('.cart-n').textContent = count || '';
    panel.hidden = !cartOpen || cbtn.hidden;
    if (panel.hidden) return;
    const total = S.cart.reduce((a, c) => a + c.qty * c.price, 0), after = S.coins - total;
    panel.innerHTML = `<div class="cp-head"><b>Your cart</b>${S.cart.length ? '<button type="button" class="cp-clear">Empty cart</button>' : ''}</div>
      <div class="cp-lines">${S.cart.length ? '' : '<p class="cp-empty">Nothing yet. Pick items on any shelf and add them here, then pay once.</p>'}</div>
      ${S.cart.length ? `<div class="cp-foot"><div class="cp-total"><span>Total</span><b>${money(total)}</b></div><div class="cp-after ${after >= 0 ? '' : 'bad'}">${after >= 0 ? `${money(after)} left after` : `Need ${money(-after)} more`}</div><button type="button" class="cp-pay" ${after >= 0 ? '' : 'disabled'}>Pay ${money(total)}</button></div>` : ''}`;
    const lines = panel.querySelector('.cp-lines');
    S.cart.forEach((c, i) => {
      const row = document.createElement('div'); row.className = 'cp-line';
      const tile = document.createElement('div'); tile.className = 'cp-tile'; tile.appendChild(thumb(c.item));
      row.appendChild(tile);
      row.insertAdjacentHTML('beforeend', `<div class="cp-what"><b>${esc(itemName(c.item))}</b><small>Shelf ${c.shelf} · ${money(c.price)} each</small></div>
        <span class="sw-qty sm"><button type="button" data-d="-1" aria-label="Less">−</button><b>${c.qty}</b><button type="button" data-d="1" aria-label="More">+</button></span>
        <button type="button" class="cp-x" aria-label="Remove">✕</button><b class="cp-lt">${money(c.qty * c.price)}</b>`);
      for (const bt of row.querySelectorAll('[data-d]')) bt.onclick = () => { c.qty = Math.max(1, Math.min(stockOf(c), c.qty + Number(bt.dataset.d))); renderCart(); renderShelf(); };
      row.querySelector('.cp-x').onclick = () => { S.cart.splice(i, 1); renderCart(); renderShelf(); };
      lines.appendChild(row);
    });
    panel.querySelector('.cp-clear')?.addEventListener('click', () => { S.cart.length = 0; renderCart(); renderShelf(); });
    panel.querySelector('.cp-pay')?.addEventListener('click', () => {
      const plotId = S.cart[0].plotId;
      send({ type: 'buyCart', plotId, items: S.cart.map((c) => ({ level: c.level, lx: +c.key.split(',')[0], ly: +c.key.split(',')[1], item: c.item, price: c.price, n: c.qty })) });
    });
    const r = cbtn.getBoundingClientRect();
    panel.style.top = `${r.bottom + 10}px`;
    panel.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  }

  // Every few frames: the cart button shows while you're in someone's shop; walking out
  // puts everything back.
  let tickAt = 0, inShop = null;
  function frame(now) {
    if (now - tickAt < 200 || !S.me) return;
    tickAt = now;
    const pid = plotIdAtPixel(world, S.me.x, S.me.y);
    let plot = pid >= 0 ? S.plots[pid] : null;
    // Standing at a market stall counts as being in the shop.
    if (!plot?.biz) plot = Object.values(S.plots).find((p) => p.stall && Math.hypot(S.me.x / TILE - (p.x + 1), S.me.y / TILE - (p.y + 1)) < 3.5) || plot;
    const here = plot?.biz && !mine(plot) ? plot.id : null;
    if (here !== inShop) {
      if (inShop != null && S.cart.length) { S.cart.length = 0; toast('You left the shop, so your cart was put back'); }
      inShop = here;
      cbtn.hidden = here == null;
      if (here == null) cartOpen = false;
      renderCart();
    }
    // Lines whose stock sold out under you shrink.
    let changed = false;
    for (let i = S.cart.length - 1; i >= 0; i--) {
      const c = S.cart[i], max = stockOf(c);
      if (c.qty > max) { changed = true; if (max > 0) c.qty = max; else S.cart.splice(i, 1); }
    }
    if (changed) { renderCart(); renderShelf(); }
  }

  return {
    openShop, closeShop, openShelf, closeShelf, frame,
    refresh() { if (shop) renderShop(); if (shelf) renderShelf(); if (cartOpen) renderCart(); },
    said(text) { if (shop) { shop.line = text; renderShop(); } },
    paid() { S.cart.length = 0; cartOpen = false; renderCart(); renderShelf(); },
    isOpen: () => !!shop || !!shelf,
    // Esc: the cart panel first, then the windows.
    escape() { if (cartOpen) { cartOpen = false; renderCart(); return true; } if (shelf) { closeShelf(); return true; } if (shop) { closeShop(); return true; } return false; },
    shopNpc: () => shop?.npc || null,
  };
}
