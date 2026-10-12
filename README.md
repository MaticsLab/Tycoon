# Tycoon Village

A cozy multiplayer life-sim for the browser and Android: Stardew Valley's pixel art meets The Sims' build mode.
Everyone shares one village. You claim a plot, build a house wall by wall in 3D, furnish it, and grow crops.
You can also befriend villagers whose personalities change based on how you treat them.

**Play:** https://tycoon-village.plain-silence-2a72.workers.dev

## Features

- **A 3D village that still looks like pixel art.** The world renders at low resolution and is scaled up with sharp pixels.
  Ground, walls, floors and roofs use hand-painted pixel textures.
  Characters, NPCs, trees and crops are pixel sprites that always face the camera (the "HD-2D" look).
  - The camera orbits freely. Hold the **middle mouse button (scroll wheel) and drag** to rotate and tilt it, **right-drag** to move it anywhere, or turn in 90° steps with ⟲ ⟳ or Q / E. Zoom with + −, the mouse wheel or a pinch.
  - Distant textures are mip-mapped and the camera snaps to whole pixels, so the zoomed-out view stays steady instead of shimmering.
  - Sunlight casts shadows. At night, lamps, fireplaces and windows light up.
- **Land you can reshape.** Plots are open land with no fences, laid out along wide dirt roads with grassy verges.
  A plot must touch a road and may cover one, but roads are always public: anyone can walk them and nothing can be built on them.
  In build mode, the **🗺️ Land** tab lets you:
  - **Resize**: drag any side of your plot. Growing costs 🪙2 per new tile.
  - **Merge**: join an empty plot next door that lines up with yours.
  - **Split**: cut off an empty side, which goes up for sale as a new plot.
  - **Pave road / Dig up road**: move a road that crosses your land. Every end of the road must stay connected. To close a road completely, ask City Hall.
  Your house keeps its place in the world while the plot's edges move around it.
  In build mode your plot is outlined, nearby plots show faintly, and public road tiles on your land are shaded.
- **Public places:** the Town Square, City Hall, Willow Park (a lake, a gazebo and benches) and the Harvest Fair (a pumpkin patch, corn rows and market stalls).
- **Seasons follow the real calendar.** From September to November the trees turn red and gold, leaves cover the ground and pumpkins fill the fair.
  In October the village decorates for Halloween with jack-o'-lanterns, hay bales, bubbling cauldrons and a spooky graveyard. Fall decorations are also for sale in build mode.
- **City Hall and elections.** Talk to **Mabel, the City Clerk** (an AI villager) at City Hall, then tap **🏛️ City Hall business**.
  - **Elections** every 4 village years (about 4½ real days) for a **mayor** and a **50-seat council**. Players file a platform and vote in person at City Hall.
    A new village holds a founding election straight away. Seats nobody wins go to **AI caretakers**, and **Mayor Bramble (AI)** serves if nobody runs for mayor.
  - **Proposals**: close the road across your plot, set the price of land, or pass a resolution. The council votes for two village days.
    AI caretakers vote as a bloc on advice from Workers AI, which weighs the city data. A player mayor signs or vetoes; unsigned bills become law after a day.
  - **City data**: road traffic, visits to public places, the economy and the treasury (land payments go to the city). Mabel sees all of it and answers questions about it.
  - Only villagers with an account can run, vote or bring proposals.
- **Village clock:** a day runs from 5:00 AM to 5:00 AM. The clock moves in 10-minute steps, about 6 real seconds each, and there are 112 days in a year.
- **Sims-style build mode** on your own plot:
  - **Walls** sit on the grid lines between tiles. Drag to draw a wall, or use the **Room** tool to drag out four walls plus a floor at once. There are six wall materials.
  - **Doors and windows** go into walls: wood or French doors, archways, and normal or tall windows. Doors let people through; windows don't.
  - **Floors** are laid by dragging a rectangle. **Roofs** are gable roofs dragged over your rooms.
  - **Two storeys and stairs.** Switch between *Ground floor* and *Upstairs* to build and furnish each one. Stairs (in **Walls & Stairs**) take up 1×3 tiles, can be rotated, and cut their own stairwell through the floor above. Walk onto them to go upstairs.
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
- **Cheat console** in **⚙️ Settings → Cheats** (the same on desktop and phones). Type a command or tap one of the shortcut chips.
  Type `testingcheats true` first, then any of:
  - `money 9999999` sets your coins.
  - `motherlode` gives +50,000. `kaching` and `rosebud` give +1,000.
  - `freerealestate on` makes land changes free.
  - `bb.enablefreebuild` turns free building on or off.
  - `tp cityhall`, `tp park`, `tp fair` or `tp square` teleports you.
  The server setting `CHEATS` in `worker/wrangler.jsonc` controls who can use cheats: `all`, `admins` (only the usernames listed in `ADMINS`) or `off`.
- **Character creator** in the Stardew style: roll the dice, turn the preview, pick a build, then skin, hair (22 styles, from swept spikes and emo fringes to curls and long waves), shirt (20 designs) and accessory (glasses, beards, hats and more) with the arrows.
  Sliders set eye, hair and pants colour, and you name yourself, your farm and your favourite thing. Change your look later from **👤 Me → Change look**.
  Choose a cat or a dog under **Animal Preference** (tap it again for another breed). Your pet follows you everywhere (indoors and upstairs too), sits when you stop, and loves being petted. While you're home it wanders around the house. From 10 PM to 6 AM it sleeps at home, on its **Pet Bed** if you've bought one, and rejoins you in the morning.
  Villagers and players are Stardew-style pixel sprites with four walking directions, and NPCs show a portrait when you talk to them.
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
| Run             | hold Shift while walking                      | drag the joystick far out          |
| Camera          | middle-drag to orbit, right-drag to pan, Q / E to turn, wheel to zoom | two-finger drag to pan, twist to rotate, pinch to zoom, ⟲ ⟳ + − buttons |
| Talk / interact | Enter, or click an NPC                        | tap the action button or the NPC   |
| Build mode      | B · R rotate · V walls · PgUp/PgDn floors · WASD or right-drag to pan | two-finger drag to pan |
| Cheat console   | ⚙️ Settings → Cheats                           | ⚙️ Settings → Cheats               |

## Ideas for next steps

- Wallpaper and paint on each side of a wall, and terrain tools
- More villagers and seasonal events driven by NPC gossip
- Several village shards once one fills up
