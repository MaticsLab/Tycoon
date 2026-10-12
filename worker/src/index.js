// Cloudflare Worker entry.
//   /api/auth/*  Better Auth (accounts, sessions) backed by D1
//   /ws          WebSocket into the single World Durable Object, after the Worker
//                has checked the player's session
//   everything else: the game client, served by Workers Static Assets
import { DurableObject } from 'cloudflare:workers';
import { Game } from './game.js';
import { WORLD_VERSION } from '../../shared/world.js';
import { getAuth, userFromToken, worldStub, NATIVE_ORIGINS } from './auth.js';

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];

function withCors(request, response) {
  const origin = request.headers.get('Origin');
  if (!origin || !NATIVE_ORIGINS.includes(origin)) return response;
  const res = new Response(response.body, response);
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Allow-Headers', 'content-type, authorization');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Expose-Headers', 'set-auth-token');
  res.headers.append('Vary', 'Origin');
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/')) {
      if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204 }));
      return withCors(request, await getAuth(env).handler(request));
    }
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      // Browsers can't set headers on WebSocket requests, so the session token rides in the query.
      const user = await userFromToken(env, url.searchParams.get('auth'));
      if (!user) return new Response('Sign in first', { status: 401 });
      // Only this Worker can reach the Durable Object, so these headers can be trusted there.
      const headers = new Headers(request.headers);
      headers.set('X-User-Id', user.id);
      headers.set('X-User-Name', encodeURIComponent(user.displayUsername || user.name || ''));
      headers.set('X-Username', user.username || '');
      headers.set('X-Anonymous', user.isAnonymous ? '1' : '0');
      headers.set('X-Version', env.CF_VERSION_METADATA?.id || '');
      return worldStub(env).fetch(new Request(request, { headers }));
    }
    if (url.pathname === '/health') {
      const headers = new Headers(request.headers);
      headers.set('X-Version', env.CF_VERSION_METADATA?.id || '');
      return worldStub(env).fetch(new Request(request, { headers }));
    }
    return env.ASSETS.fetch(request);
  },
};

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;
    this.timers = null;
    ctx.blockConcurrencyWhile(async () => {
      const entries = await ctx.storage.list();
      this.game = new Game(Game.fromEntries(entries), {
        ai: env.AI ? (messages, schema, parse) => this.askAI(messages, schema, parse) : null,
        cheats: env.CHEATS || 'all',
        admins: String(env.ADMINS || '').split(',').map((u) => u.trim().toLowerCase()).filter(Boolean),
      });
    });
  }

  // Try each model until one returns something `parse` accepts.
  async askAI(messages, schema, parse) {
    for (const model of MODELS) {
      try {
        const res = await this.env.AI.run(model, {
          messages,
          max_tokens: 220,
          temperature: 0.7,
          response_format: { type: 'json_schema', json_schema: schema },
        });
        const parsed = parse(res?.response ?? res?.choices?.[0]?.message?.content);
        if (parsed) return parsed;
        console.warn(`Workers AI ${model} returned an unusable reply`);
      } catch (e) {
        console.error(`Workers AI ${model} failed:`, e?.message || e);
      }
    }
    return null;
  }

  async fetch(request) {
    // A Durable Object can outlive a deploy while players are connected. If the Worker
    // in front of us is a newer version, save, drop connections and restart on new code
    // (clients reconnect automatically).
    const want = request.headers.get('X-Version'), mine = this.env.CF_VERSION_METADATA?.id;
    if (want && mine && want !== mine) {
      this.flush();
      for (const s of [...this.game.sessions.values()]) { try { s.conn.close(); } catch { /* gone */ } }
      this.ctx.abort('Restarting on the newly deployed version');
      return new Response('Updating, please reconnect', { status: 503 });
    }
    if (new URL(request.url).pathname === '/health') {
      return Response.json({ ok: true, online: this.game.sessions.size, world: WORLD_VERSION, version: this.env.CF_VERSION_METADATA?.id || null });
    }
    const h = request.headers;
    const identity = {
      userId: h.get('X-User-Id'),
      name: decodeURIComponent(h.get('X-User-Name') || ''),
      username: h.get('X-Username') || null,
      isAnonymous: h.get('X-Anonymous') === '1',
    };
    if (!identity.userId) return new Response('Forbidden', { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const handlers = this.game.attach({
      sendRaw: (d) => { try { server.send(d); } catch { /* closed */ } },
      close: () => { try { server.close(1000, 'replaced'); } catch { /* closed */ } },
    }, identity);
    server.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string' && ev.data.length <= 16 * 1024) handlers.onMessage(ev.data);
    });
    const done = () => { handlers.onClose(); this.maybeStop(); };
    server.addEventListener('close', done);
    server.addEventListener('error', done);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Called by Better Auth (RPC) when a guest signs up or logs in.
  linkAccount(fromUserId, toUserId, info) {
    this.game.linkAccount(fromUserId, toUserId, info);
    this.flush();
  }

  // The simulation only runs while someone is connected.
  start() {
    if (this.timers) return;
    this.timers = [
      setInterval(() => this.game.tick(), 100),
      setInterval(() => this.flush(), 2000),
    ];
  }

  maybeStop() {
    if (this.game.sessions.size) return;
    this.flush();
    if (this.timers) this.timers.forEach(clearInterval);
    this.timers = null;
  }

  flush() {
    const dirty = Object.entries(this.game.takeDirty());
    if (!dirty.length) return;
    const puts = dirty.filter(([, v]) => v != null);
    const dels = dirty.filter(([, v]) => v == null).map(([k]) => k);
    for (let i = 0; i < puts.length; i += 128) this.ctx.storage.put(Object.fromEntries(puts.slice(i, i + 128)));
    if (dels.length) this.ctx.storage.delete(dels);
  }
}
