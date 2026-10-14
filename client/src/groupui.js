// Villagers talking among themselves: a chip to join any conversation you're standing
// near, the group chat panel (everyone's lines, yours included, and a box to join in),
// and the card a villager brings when they walk up to you with an offer or a hello.
import { NPCS } from '@shared/npcs.js';
import { GOODS } from '@shared/catalog.js';
import { TILE } from '@shared/world.js';
import { drawLook } from './people.js';
import { itemIcon } from './sprites.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const JOIN_TILES = 6;
const namesOf = (ids) => { const a = ids.map((id) => NPCS[id]?.name || id); return a.length < 2 ? a[0] : `${a.slice(0, -1).join(', ')} & ${a.at(-1)}`; };

export function makeGroupUI({ S, send, where }) {
  const convos = new Map();
  let joined = null, lines = [], chipFor = null, chipAt = 0, offer = null, offerTimer = 0;

  function faces(box, ids, size = 64) {
    box.innerHTML = '';
    for (const id of ids.slice(0, 4)) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.title = NPCS[id]?.name || '';
      drawLook(c, NPCS[id].look, { crop: 'bust' });
      box.appendChild(c);
    }
  }

  // ---------- the panel ----------
  function open(c, past) {
    joined = c.id;
    lines = [...(past || [])];
    $('grouppanel').hidden = false;
    $('convochip').hidden = true;
    renderHead();
    renderLog();
    if (!matchMedia('(pointer: coarse)').matches) $('gp-input').focus();
  }
  function renderHead() {
    const c = convos.get(joined);
    if (!c) return;
    faces($('gp-faces'), c.members);
    $('gp-title').textContent = namesOf(c.members);
    $('gp-where').textContent = where?.(c) || '';
    const others = (c.players || []).filter((p) => p !== S.me?.id).map((p) => S.players.get(p)?.name).filter(Boolean);
    $('gp-sub').textContent = `Group chat${others.length ? ` · with ${others.join(', ')}` : ''} · walk away to leave`;
    $('gp-input').placeholder = `Say something to ${namesOf(c.members)}…`;
  }
  function renderLog() {
    const log = $('gp-log');
    log.innerHTML = '';
    for (const l of lines.slice(-50)) {
      const d = document.createElement('div');
      const me = l.player && l.who === S.me?.id;
      d.className = `line ${l.note ? 'note' : me ? 'me' : l.player ? 'other' : 'them'}`;
      d.innerHTML = l.note ? esc(l.text) : `<b>${esc(me ? 'You' : l.name)}</b>${esc(l.text)}`;
      log.appendChild(d);
    }
    log.scrollTop = log.scrollHeight;
  }
  function close(tell = true) {
    if (joined != null && tell) send({ type: 'convoLeave', id: joined });
    joined = null;
    $('grouppanel').hidden = true;
    $('gp-input').blur();
  }
  $('gp-close').onclick = () => close();
  $('gp-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('gp-input').value.trim();
    if (!text || joined == null) return;
    send({ type: 'convoSay', id: joined, text });
    $('gp-input').value = '';
  };
  $('gp-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); });
  $('convochip').onclick = () => { if (chipFor != null) send({ type: 'convoJoin', id: chipFor }); };

  // ---------- offers & hellos ----------
  function card(npc, text, item, price, yes, no) {
    clearTimeout(offerTimer);
    drawLook($('of-portrait'), NPCS[npc].look, { crop: 'bust' });
    $('of-name').textContent = NPCS[npc].name;
    $('of-text').textContent = `“${text}”`;
    const it = $('of-item');
    it.innerHTML = '';
    if (item) {
      const g = GOODS[item];
      if (g?.icon) it.insertAdjacentHTML('beforeend', `<span class="of-ic">${g.icon}</span>`);
      else { const ic = itemIcon(item, 28); if (ic) it.appendChild(ic); }
      it.insertAdjacentHTML('beforeend', `<span>${esc(g?.name || item)} · 🪙${price}</span>`);
    }
    $('of-yes').textContent = yes[0];
    $('of-yes').disabled = !!yes[2];
    $('of-yes').onclick = () => { yes[1](); hideCard(); };
    $('of-no').textContent = no[0];
    $('of-no').onclick = () => { no[1]?.(); hideCard(); };
    $('offercard').hidden = false;
    offerTimer = setTimeout(() => { no[1]?.(); hideCard(); }, 45_000);
  }
  function hideCard() { clearTimeout(offerTimer); offer = null; $('offercard').hidden = true; }

  function onMessage(m) {
    switch (m.type) {
      case 'convo':
        convos.set(m.convo.id, m.convo);
        if (joined === m.convo.id) renderHead();
        break;
      case 'convoEnd':
        convos.delete(m.id);
        if (joined === m.id) {
          lines.push({ note: true, text: 'The conversation winds down.' });
          renderLog();
          const id = joined;
          setTimeout(() => { if (joined === id) close(false); }, 2500);
        }
        break;
      case 'convoLine':
        if (joined !== m.id) break;
        lines.push(m.line);
        renderLog();
        break;
      case 'convoJoined':
        convos.set(m.convo.id, m.convo);
        open(m.convo, m.lines);
        break;
      case 'npcOffer':
        offer = m;
        card(m.npc, m.text, m.item, m.price, [`Buy · 🪙${m.price}`, () => send({ type: 'offerAccept', id: m.id }), (S.coins ?? 0) < m.price], ['No thanks', () => send({ type: 'offerDecline', id: m.id })]);
        break;
      case 'npcApproach':
        card(m.npc, m.text, null, 0, ['💬 Talk', () => send({ type: 'npcOpen', npc: m.npc })], ['Not now', null]);
        break;
    }
  }

  // Every frame: offer the chip for the nearest conversation you're standing by.
  function frame(now) {
    if (now - chipAt < 250) return;
    chipAt = now;
    if (joined != null || !S.me || S.mode === 'build' || !$('npcpanel').hidden) { $('convochip').hidden = true; return; }
    let best = null, bd = JOIN_TILES * TILE;
    for (const c of convos.values()) {
      const ns = c.members.map((id) => S.npcs.get(id)).filter(Boolean);
      const x = ns.length ? ns.reduce((a, n) => a + n.x, 0) / ns.length : c.x, y = ns.length ? ns.reduce((a, n) => a + n.y, 0) / ns.length : c.y;
      const d = Math.hypot(x - S.me.x, y - S.me.y);
      if (d < bd) { bd = d; best = c; }
    }
    const chip = $('convochip');
    if (!best) { chip.hidden = true; chipFor = null; return; }
    if (chipFor !== best.id || chip.hidden) {
      chipFor = best.id;
      chip.innerHTML = '<div class="gp-faces"></div><span></span>';
      faces(chip.firstChild, best.members, 48);
      chip.lastChild.textContent = `💬 Join ${namesOf(best.members)}’s conversation`;
      chip.hidden = false;
    }
  }

  return {
    onMessage, frame, close,
    setConvos(list) { convos.clear(); for (const c of list || []) convos.set(c.id, c); },
    isOpen: () => joined != null,
    hasCard: () => !!offer,
  };
}
