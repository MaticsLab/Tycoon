# Tycoon Village

A cozy multiplayer life-sim for the browser and Android: Stardew Valley's pixel art meets The Sims' build mode.
Everyone shares one village. You claim a plot, build a house wall by wall in 3D, furnish it, and grow crops.
You can also befriend villagers whose personalities change based on how you treat them.

**Play:** https://tycoon-village.plain-silence-2a72.workers.dev

## Features

- **A 3D village that still looks like pixel art.** The world renders at low resolution and is scaled up with sharp pixels.
  Ground, walls, floors and roofs use hand-painted pixel textures.
  Characters, NPCs, trees and crops are pixel sprites that always face the camera (the "HD-2D" look).
  - The camera is isometric. Turn it in 90° steps with ⟲ ⟳ or Q / E, and zoom with + −, the mouse wheel or a pinch.
  - Sunlight casts shadows. At night, lamps, fireplaces and windows light up.
- **Sims-style build mode** on your own plot:
  - **Walls** sit on the grid lines between tiles. Drag to draw a wall, or use the **Room** tool to drag out four walls plus a floor at once. There are six wall materials.
  - **Doors and windows** go into walls: wood or French doors, archways, and normal or tall windows. Doors let people through; windows don't.
  - **Floors** are laid by dragging a rectangle. **Roofs** are gable roofs dragged over your rooms.
  - **Two storeys.** Switch between *Ground floor* and *Upstairs* to build and furnish each one.
  - **Walls up / cutaway / down**, just like The Sims. When you walk inside a house, the walls cut away and the roof and upstairs hide automatically.
  - **Furniture** comes as small 3D models. Larger pieces span 2 or 4 tiles, and anything with a front can be rotated. Plants are pixel-art cards.
  - The **sledgehammer** removes anything with a full refund. Tap a door or window to remove just that.
- **Town square** with two shops and three NPCs:
  - **Rosa's Market** buys your crops and sells gifts.
  - **Otto's Furniture** sells exclusive pieces: piano, fireplace, aquarium, grandfather clock, telescope and statue.
  - **Juniper** is the village gardener and gossip.
- **NPCs with memory and evolving personalities.** Conversations run on Workers AI.
  - Each NPC has five traits: warmth, cheer, trust, generosity and energy. Kindness, insults and gifts shift those traits over time, and the NPC keeps a diary of how and why they changed.
  - They remember facts about you, keep the last few lines of your conversation, and pass gossip to each other.
  - Their mood and how much they like you change their shop prices.
- **Farming.** Till soil, plant seeds, harvest into your bag, then sell to Rosa.
- **Accounts.** Sign up with email and password, and log in with either your username or email. Your plot follows you to any device.
  "Play now" starts you as a guest; signing up later keeps the guest's plot, coins and friendships.

## How it's built

```
shared/   world map, plot & building rules (walls, levels, roofs, collision), catalog, NPC definitions
worker/   Cloudflare Worker + Durable Object (the authoritative game server), Better Auth, NPC minds
client/   the game: Vite + Three.js (3D view) + canvas pixel-art painters; Capacitor Android project in client/android
```

| Piece                 | Cloudflare product                                                                                         |
|-----------------------|------------------------------------------------------------------------------------------------------------|
| Game client           | Workers Static Assets                                                                                      |
| Live world            | one Durable Object (`World`). It runs the simulation and stores plots, profiles and NPC minds in its SQLite storage |
| Accounts and sessions | Better Auth on the **`tycoon-auth` D1 database** (`user`, `session`, `account` and `verification` tables)  |
| NPC dialogue          | Workers AI: Llama 3.3 70B, falling back to Llama 3.1 8B, then to scripted lines                            |

The Worker checks the player's Better Auth session before letting a WebSocket into the Durable Object. The game itself never handles passwords.
The browser and the Android app both use bearer tokens, which work the same in both and avoid cross-site cookies.

## Development

Requires Node.js 22+.

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # then fill in a BETTER_AUTH_SECRET
npm run db:migrate:local -w worker              # create the Better Auth tables in local D1
npm run dev                                     # builds the client, runs `wrangler dev` on http://localhost:8787
npm test                                        # server/game rule tests
```

`wrangler dev` runs the Worker, Durable Object and D1 locally. Workers AI always calls Cloudflare, so log in with `wrangler login` or set `CLOUDFLARE_API_TOKEN`.

## Deploying

```bash
npx wrangler secret put BETTER_AUTH_SECRET -c worker/wrangler.jsonc   # once: any long random string
npm run db:migrate -w worker                                           # apply D1 migrations remotely
npm run deploy                                                         # build the client and deploy the Worker
```

If you move to your own domain, update `BETTER_AUTH_URL` in `worker/wrangler.jsonc`.

## Android app

You'll need Android Studio with JDK 21.

```bash
VITE_SERVER_URL=wss://tycoon-village.plain-silence-2a72.workers.dev/ws npm run android
```

This builds the client with the server address baked in, syncs it into `client/android` and opens Android Studio. Press **Run** to install it.
Players can also change the server under **Server** on the join screen.

## Controls

|                 | Desktop                                       | Phone                              |
|-----------------|-----------------------------------------------|------------------------------------|
| Walk            | WASD / arrows (relative to the camera)        | drag anywhere (virtual joystick)   |
| Camera          | Q / E to turn, mouse wheel to zoom            | ⟲ ⟳ + − buttons, pinch to zoom     |
| Talk / interact | Enter, or click an NPC                        | tap the action button or the NPC   |
| Build mode      | B · R rotate · V walls · PgUp/PgDn floors · WASD or right-drag to pan | two-finger drag to pan |

## Ideas for next steps

- Stairs so avatars can walk upstairs (upper floors can already be built and furnished)
- Wallpaper and paint on each side of a wall, and terrain tools
- More villagers and seasonal events driven by NPC gossip
- Several village shards once one fills up
