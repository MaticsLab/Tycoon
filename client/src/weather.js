// Weather and seasonal particles drawn over the 3D view: rain (and storms with
// lightning), snow, falling leaves in fall, blossom petals in spring and fireflies on
// summer nights. Screen-space and cheap: a few hundred particles at most.
export function makeWeather() {
  const parts = [];
  let mode = '', flash = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function reset(kind, W, H) {
    parts.length = 0;
    const n = { rain: 220, storm: 340, snow: 140, leaves: 42, petals: 30, fireflies: 26 }[kind] || 0;
    for (let i = 0; i < n; i++) parts.push(spawn(kind, W, H, true));
  }
  function spawn(kind, W, H, anywhere) {
    const p = { x: rnd(-40, W + 40), y: anywhere ? rnd(-20, H) : rnd(-60, -10), s: 0, a: rnd(0, Math.PI * 2), t: rnd(0, 1000) };
    if (kind === 'rain' || kind === 'storm') { p.v = rnd(560, 760); p.len = rnd(9, 16); }
    else if (kind === 'snow') { p.v = rnd(28, 60); p.r = rnd(1, 2.6); }
    else if (kind === 'leaves') { p.v = rnd(26, 52); p.r = rnd(4.5, 7); p.c = ['#d9622b', '#e8a33a', '#b8402a', '#c98a2b', '#9b4a1e'][Math.floor(Math.random() * 5)]; p.spin = rnd(-3, 3); }
    else if (kind === 'petals') { p.v = rnd(18, 34); p.r = rnd(3, 4.6); p.c = ['#f7c4dc', '#ffd9ea', '#eba2c8'][Math.floor(Math.random() * 3)]; p.spin = rnd(-2, 2); }
    else if (kind === 'fireflies') { p.y = rnd(H * 0.3, H); p.v = 0; p.r = rnd(1.2, 2.2); }
    return p;
  }
  // state: { kind: 'rain'|'storm'|'snow'|null, season: 'spring'|..., dark: 0..0.65 }
  function draw(c, W, H, now, dt, state) {
    let kind = state.kind || (state.season === 'fall' ? 'leaves' : state.season === 'spring' ? 'petals' : state.season === 'summer' && state.dark > 0.3 ? 'fireflies' : '');
    if (kind !== mode) { mode = kind; reset(kind, W, H); }
    // The sky darkens under rain and snow clouds.
    if (kind === 'rain' || kind === 'storm' || kind === 'snow') {
      c.fillStyle = kind === 'snow' ? 'rgba(170,185,210,.10)' : kind === 'storm' ? 'rgba(25,32,52,.30)' : 'rgba(40,52,72,.18)';
      c.fillRect(0, 0, W, H);
    }
    const wind = kind === 'storm' ? 220 : kind === 'rain' ? 90 : 26;
    c.save();
    for (const p of parts) {
      p.t += dt;
      if (kind === 'rain' || kind === 'storm') {
        p.y += p.v * dt; p.x += wind * dt;
        c.strokeStyle = 'rgba(200,220,255,.62)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - wind * p.len / p.v, p.y - p.len); c.stroke();
        if (p.y > H) { if (Math.random() < 0.5) { c.fillStyle = 'rgba(210,225,255,.45)'; c.fillRect(p.x - 2, H - rnd(0, H * 0.7), 4, 1); } Object.assign(p, spawn(kind, W, H, false)); }
      } else if (kind === 'snow') {
        p.y += p.v * dt; p.x += (Math.sin(p.t * 1.3 + p.a) * 18 + wind * 0.4) * dt;
        c.fillStyle = 'rgba(255,255,255,.9)';
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
        if (p.y > H + 4) Object.assign(p, spawn(kind, W, H, false));
      } else if (kind === 'leaves' || kind === 'petals') {
        p.y += p.v * dt; p.x += (Math.sin(p.t * 1.6 + p.a) * 30 + wind) * dt; p.s += p.spin * dt;
        c.save(); c.translate(p.x, p.y); c.rotate(p.s); c.scale(1, Math.abs(Math.sin(p.t * 2 + p.a)) * 0.7 + 0.3);
        c.fillStyle = p.c;
        c.beginPath(); c.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2); c.fill();
        if (kind === 'leaves') { c.strokeStyle = 'rgba(80,40,10,.5)'; c.beginPath(); c.moveTo(-p.r, 0); c.lineTo(p.r, 0); c.stroke(); }
        c.restore();
        if (p.y > H + 8 || p.x > W + 40) Object.assign(p, spawn(kind, W, H, false));
      } else if (kind === 'fireflies') {
        p.x += Math.sin(p.t * 0.7 + p.a) * 14 * dt; p.y += Math.cos(p.t * 0.9 + p.a) * 10 * dt;
        const glow = Math.max(0, Math.sin(p.t * 2.2 + p.a));
        if (glow > 0.05) {
          const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
          g.addColorStop(0, `rgba(255,250,150,${0.9 * glow})`); g.addColorStop(1, 'rgba(255,250,150,0)');
          c.fillStyle = g; c.fillRect(p.x - p.r * 5, p.y - p.r * 5, p.r * 10, p.r * 10);
        }
      }
    }
    c.restore();
    // Storms: now and then, lightning.
    if (kind === 'storm') {
      if (flash <= 0 && Math.random() < dt * 0.08) flash = 1;
      if (flash > 0) { c.fillStyle = `rgba(255,255,255,${flash * 0.55})`; c.fillRect(0, 0, W, H); flash -= dt * 3.5; }
    }
  }
  return { draw };
}
