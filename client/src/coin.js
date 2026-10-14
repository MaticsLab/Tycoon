// The gold coin (16×16 pixel art, from the shop handoff) wherever money shows. Text all
// over the game (and messages from the server) says 🪙; this swaps each one in the page
// for the coin, as it appears.
const px = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#f5c542"/><stop offset="1" stop-color="#c98a1a"/></linearGradient></defs>
${px(5, 1, 6, 1, '#6b3d0a')}${px(3, 2, 2, 1, '#6b3d0a')}${px(11, 2, 2, 1, '#6b3d0a')}${px(2, 3, 1, 2, '#6b3d0a')}${px(13, 3, 1, 2, '#6b3d0a')}
${px(1, 5, 1, 6, '#6b3d0a')}${px(14, 5, 1, 6, '#6b3d0a')}${px(2, 11, 1, 2, '#6b3d0a')}${px(13, 11, 1, 2, '#6b3d0a')}${px(3, 13, 2, 1, '#6b3d0a')}${px(11, 13, 2, 1, '#6b3d0a')}${px(5, 14, 6, 1, '#6b3d0a')}
${px(5, 2, 6, 1, 'url(#g)')}${px(3, 3, 10, 2, 'url(#g)')}${px(2, 5, 12, 6, 'url(#g)')}${px(3, 11, 10, 2, 'url(#g)')}${px(5, 13, 6, 1, 'url(#g)')}
${px(6, 4, 4, 1, '#c98a1a')}${px(4, 5, 2, 1, '#c98a1a')}${px(10, 5, 2, 1, '#c98a1a')}${px(4, 6, 1, 4, '#c98a1a')}${px(11, 6, 1, 4, '#e0a82e')}${px(4, 10, 2, 1, '#e0a82e')}${px(10, 10, 2, 1, '#e0a82e')}${px(6, 11, 4, 1, '#e0a82e')}
${px(7, 6, 2, 4, '#c98a1a')}${px(7, 6, 1, 3, '#ffe680')}
${px(4, 3, 2, 1, '#ffffff')}${px(3, 4, 1, 2, '#ffffff')}
</svg>`;
export const COIN_URL = `url("data:image/svg+xml,${encodeURIComponent(SVG)}")`;

export function installCoins(root = document.body) {
  document.documentElement.style.setProperty('--coin', COIN_URL);
  const swap = (node) => {
    if (node.nodeType !== 3 || !node.nodeValue.includes('🪙')) return;
    const p = node.parentNode;
    if (!p || /^(INPUT|TEXTAREA|SCRIPT|STYLE|OPTION|TITLE)$/.test(p.nodeName)) return;
    const parts = node.nodeValue.split('🪙');
    const frag = document.createDocumentFragment();
    parts.forEach((t, i) => {
      if (i) { const c = document.createElement('i'); c.className = 'coin'; c.setAttribute('aria-label', 'coins'); frag.appendChild(c); }
      if (t) frag.appendChild(document.createTextNode(t));
    });
    p.replaceChild(frag, node);
  };
  const walk = (n) => {
    if (n.nodeType === 3) return swap(n);
    if (n.nodeType !== 1) return;
    const it = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const found = [];
    for (let t = it.nextNode(); t; t = it.nextNode()) if (t.nodeValue.includes('🪙')) found.push(t);
    found.forEach(swap);
  };
  walk(root);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') swap(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
