// Catalog icons drawn straight from an item's 3D box model: a little isometric view from
// the front-right, top faces lit, sides shaded, boxes painted back to front. Used where an
// item has no hand-drawn sprite (the staircases), so the icon shows the real thing.
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

export function modelIcon(boxes, size = 44) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  // Isometric-ish: x runs right-down, z left-down, y up.
  const P = (x, y, z) => [(x - z) * 0.87, (x + z) * 0.5 - y * 1.0];
  const faces = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, z, w, h, d, col] of boxes) {
    const v = (a, b, cc) => { const p = P(a, b, cc); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); return p; };
    const depth = x + w / 2 + z + d / 2 + (y + h / 2) * 0.05;
    faces.push({ depth, col: shade(col, 0.68), pts: [v(x + w, y, z), v(x + w, y, z + d), v(x + w, y + h, z + d), v(x + w, y + h, z)] });
    faces.push({ depth: depth + 1e-4, col: shade(col, 0.84), pts: [v(x, y, z + d), v(x + w, y, z + d), v(x + w, y + h, z + d), v(x, y + h, z + d)] });
    faces.push({ depth: depth + 2e-4, col: shade(col, 1.06), pts: [v(x, y + h, z), v(x + w, y + h, z), v(x + w, y + h, z + d), v(x, y + h, z + d)] });
  }
  faces.sort((a, b) => a.depth - b.depth);
  const s = (size - 4) / Math.max(x1 - x0, y1 - y0);
  const ox = (size - (x1 - x0) * s) / 2 - x0 * s, oy = (size - (y1 - y0) * s) / 2 - y0 * s;
  c.lineJoin = 'round';
  for (const f of faces) {
    c.beginPath();
    f.pts.forEach(([px, py], i) => (i ? c.lineTo : c.moveTo).call(c, ox + px * s, oy + py * s));
    c.closePath();
    c.fillStyle = f.col;
    c.strokeStyle = f.col;
    c.lineWidth = 0.6;
    c.fill();
    c.stroke();
  }
  return cv;
}
