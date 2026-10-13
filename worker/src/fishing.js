// Fishing on the server: cast (with a rod, at the water's edge), a fish bites a few
// seconds later, reel in quickly to land it. Faster reels make better fish.
import { itemName } from '../../shared/catalog.js';
import { worldClock } from '../../shared/world.js';
import { FISH, BITE_MIN, BITE_MAX, REEL_WINDOW, waterNear, rollFish, reelQuality } from '../../shared/fishing.js';

export class Fishing {
  constructor(game) { this.game = game; }

  cast(s) {
    const g = this.game;
    if (!(s.profile.inv.rod > 0)) return s.send({ type: 'error', msg: 'You need a fishing rod (Juniper sells them)' });
    if (s.act || s.ride || s.level) return;
    const w = waterNear(g.world, s.x, s.y);
    if (!w) return s.send({ type: 'error', msg: 'Stand at the water’s edge to fish' });
    const now = g.now();
    s.fish = { t0: now, bite: now + BITE_MIN + Math.random() * (BITE_MAX - BITE_MIN), where: w.where, tx: w.tx, ty: w.ty, x: s.x, y: s.y };
    s.dir = Math.abs((w.tx + 0.5) * 16 - s.x) > Math.abs((w.ty + 0.5) * 16 - s.y) ? ((w.tx + 0.5) * 16 < s.x ? 2 : 3) : ((w.ty + 0.5) * 16 < s.y ? 1 : 0);
    s.send({ type: 'fishing', state: 'cast', tx: w.tx, ty: w.ty });
  }

  stop(s, why) {
    if (!s.fish) return;
    s.fish = null;
    s.send({ type: 'fishing', state: why || 'stop' });
  }

  reel(s) {
    const f = s.fish;
    if (!f) return;
    const g = this.game, now = g.now();
    if (!f.bitten) return this.stop(s, 'early');
    const ms = Math.max(0, now - f.bitten - 120); // a little slack for the network
    if (ms > REEL_WINDOW + 300) return this.stop(s, 'escaped');
    const { day, hours } = worldClock(now, g.epoch);
    const fish = rollFish(f.where, day, hours);
    const q = reelQuality(ms);
    s.fish = null;
    g.bag(s, fish, 1, q);
    g.count(s.profile, 'fish');
    g.life.onActivity(s, 'fish');
    s.send({ type: 'fishing', state: 'caught', fish, q });
    if (FISH[fish].legend) {
      g.addGossip('the village', `${s.profile.name} caught ${itemName(fish)}, the legendary fish of Willow Lake!`);
      g.broadcast({ type: 'toast', text: `🐋 ${s.profile.name} landed ${itemName(fish)}, the legend of the lake!` });
    }
  }

  // Bites, fish that got away, and walking off.
  tick(now) {
    for (const s of this.game.sessions.values()) {
      const f = s.fish;
      if (!f) continue;
      if (Math.hypot(s.x - f.x, s.y - f.y) > 6 || s.act || s.ride) { this.stop(s); continue; }
      if (!f.bitten && now >= f.bite) { f.bitten = now; s.send({ type: 'fishing', state: 'bite' }); }
      else if (f.bitten && now - f.bitten > REEL_WINDOW + 600) this.stop(s, 'escaped');
    }
  }
}
