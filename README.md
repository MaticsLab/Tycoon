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
  In build mode your plot is outlined with a tile grid, nearby plots show faintly, and public road tiles on your land are shaded.
  Everything you place is previewed in its real colours (red if it can't go there), with a label at the cursor giving the price and the reason.
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
- **Village map.** A minimap in the corner shows the whole village: roads, public places, every plot (yours in gold, land for sale dashed), houses, and live dots for you, other players, townsfolk and pets.
  Tap it or press **M** for the full map with labels and a legend.
- **Village clock:** a day runs from 5:00 AM to 5:00 AM. The clock moves in 10-minute steps, about 6 real seconds each, and there are 112 days in a year.
- **Sims-style build mode** on your own plot:
  - **Walls** sit on the grid lines between tiles. Drag to draw a wall, or use the **Room** tool to drag out four walls plus a floor at once. There are six wall materials.
  - **Doors and windows** go into walls: wood or French doors, archways, and normal or tall windows. Doors let people through; windows don't.
  - **Floors** are laid by dragging a rectangle. **Roofs** are gable roofs dragged over your rooms.
  - **Two storeys and stairs.** Switch between *Ground floor* and *Upstairs* to build and furnish each one. Stairs (in **Walls & Stairs**) take up 1×3 tiles, can be rotated, and cut their own stairwell through the floor above. Walk onto them to go upstairs.
  - **Walls up / cutaway / down**, just like The Sims. When you walk inside a house, the walls cut away and the roof and upstairs hide automatically.
  - **Furniture** comes as small 3D models. Larger pieces span 2 or 4 tiles, and anything with a front can be rotated. Plants are pixel-art cards.
  - The **sledgehammer** removes anything with a full refund. Tap a door or window to remove just that, or drag a box to clear a whole area at once.
  - **Sims 4 build tools** along the strip under the catalogue:
    - **👆 Select (H)** picks up furniture so you can move or turn it for free, with a green footprint and an arrow showing which way it faces. Click a room's floor instead to lift the **whole room** (walls, floor and furniture) in a white wireframe box, then move it and turn it with R or right-click. From the ground floor the room takes everything above it along too: its upstairs, stairs and roof. Whatever you carry disappears from its old spot until you set it down.
    - **💧 Copy (C)** copies whatever you click as your current tool. **🎨 Design (T)** cycles furniture through colour swatches and roofs through materials.
    - **↶ Undo / ↷ Redo** for every build action, **🏠 Move** to shift the whole house, **🌗 Day** to preview your house at morning, afternoon, dusk and night, and **ℹ️ Lot** for lot value, bedrooms, bathrooms, rooms and the bulldozer.
    - **⌁ Custom room** (Walls tab): click corner points, then double-click or press Enter to finish. Click the first point again to close the room and it gets a floor. The tooltip shows the cost as you go.
  - **📚 Rooms & Library**: nine ready-made **styled rooms** (bedroom, bathroom, kitchen, living room, study, garden patio, game room, laundry nook and backyard picnic) that you place and turn, with live previews of their furniture, then **Buy**. Save any room, or your whole house, to **My Library** (up to 12) and place copies anywhere. Shop furniture in a blueprint comes from your bag; any pieces you don't have are left out and the game tells you which.
- **Town square** with two shops and three NPCs:
  - **Rosa's Market** buys your crops and sells gifts.
  - **More furniture & decor**: recliner, spindle loveseat, knitted pouf, low bookcase, record player, arcade cabinet, arc floor lamp, bunk bed, rocking chair and vanity; a kitchen island, kitchen sink, dishwasher, bar stool, washer, dryer and pedestal sink; cactus, succulents, globe, painting easel, fishbowl, candle lantern and cat tree; and for the garden a picnic table, BBQ grill, birdbath, gnome, hammock, rose arch, fire pit and stone lantern.
  - **Otto's Furniture** sells exclusive pieces: piano, fireplace, aquarium, grandfather clock, telescope and statue.
  - **Juniper** is the village gardener and gossip.
- **Villagers with daily lives.** Every morning each villager plans their day. The routine is fixed but the AI picks the variations, and also decides what's on their mind and what they'll call out to passers-by. Rosa opens the market, lunches on a park bench and gossips with Otto in the evening. Juniper gardens and stargazes; Mabel takes her coffee outside City Hall before her shift. They walk real routes around the village (A* path finding over public land), sit on benches, and sleep indoors at night (no chatting while they're asleep). Friends meet up and trade AI-written banter in speech bubbles everyone nearby can see.
- **Requests (quests).** Chat with a villager and they may ask a favour, at most once a day each, up to 3 at a time:
  - bring them crops or gifts;
  - put a particular piece of furniture in your home;
  - do something (cook, read, paint, stargaze…);
  - carry a message to another villager, who reacts when you deliver it.

  The game picks what's asked, so it's always doable, and the villager's AI words it in character. Rewards are coins and friendship. Track them with **📜 Quests**, and hand them in from the talk panel.
- **NPCs with memory and evolving personalities.** Conversations run on Workers AI. Each villager has their own sense of humour: Rosa's teasing auntie food puns, Otto's bone-dry deadpan, Juniper's whimsical plant drama, Mabel's bureaucratic comedy. They read how *you* write (casual or formal, playful, emoji, short and snappy) and mirror it, keep running jokes with you, and know what they're doing right now and what they've asked you for. Their core personality stays, but it shifts with how they're treated.
  - Each NPC has five traits: warmth, cheer, trust, generosity and energy. Kindness, insults and gifts shift those traits over time, and the NPC keeps a diary of how and why they changed.
  - They remember facts about you, keep the last few lines of your conversation, and pass gossip to each other.
  - Their mood and how much they like you change their shop prices.
- **Needs, like The Sims.** Hunger, energy, bladder, hygiene and fun run down while you play (one in-game hour is 36 seconds), shown in the **Needs** panel under the map with a plumbob that turns from green to red as your mood drops. **Health** falls while any need is empty and recovers while they're all okay; if it hits zero you faint and wake up at home, patched up by the village doctor for 🪙25. Being exhausted or unwell also slows you down.
  Walk up to furniture and use the action button, or tap it for a menu:
  - **Fridge**: grab a sandwich (🪙5) or cook a meal (🪙15, needs a stove); the stove cooks and the BBQ grill grills too. When it's ready you're holding a plate (everyone can see it), so carry it anywhere and **sit and eat** on a chair, sofa, stool, bench or picnic table, or eat standing up. Walk off before it's ready and you get your coins back.
  - **Toilet**, **shower**, **bathtub** and **sink** fill bladder and hygiene; showers and baths steam.
  - **Bed** or **bunk bed**: sleep or nap, tucked in under the covers with drifting Zzz. Sofas, loveseats, armchairs, recliners, rocking chairs, chairs, poufs, bar stools, bean bags, benches and picnic tables let you really sit down (a seated pose, toilet included) and relax; recliners and hammocks are good for a nap.
  - **BBQ grill**: grill a meal (🪙12, no stove needed). Kitchen and pedestal sinks wash up.
  - **TV**, **bookshelf**, **low bookcase** or **desk** (read), **piano**, **aquarium** or **fishbowl**, **fireplace** or **fire pit**, **telescope**, **arcade cabinet**, **record player** and **painting easel** fill fun.
  Moving stops what you're doing. Others see a thought bubble with what you're up to, and you can use things in a friend's house while they're home. Crops, Honey Cake and Herbal Tea can be eaten straight from the bag.
- **Farming.** Till soil, plant seeds, harvest into your bag, then sell to Rosa.
- **Run a business.** Get a licence at City Hall (🪙500, paid to the treasury). Then stand on a plot that's for sale and tap **Open my shop here**; the land costs the usual price per tile.
  - **Build it** like a house. In build mode the **🏠 Home ⇄ 🏪** button switches which plot you're building.
  - **Shop & Machines** tab: shop shelves, produce stands, display tables, chilled cases, a cash register and a shop sign.
  - **Machines** turn crops into products over a few in-game hours:

    | Machine | Makes |
    |---|---|
    | Preserves jar | strawberry jam |
    | Juice press | carrot juice |
    | Bakery oven | pumpkin pie, turnip bread |
    | Soup pot | veggie soup |

    Products sell for more than raw crops, and you can eat them or sell them to Rosa.
  - **Shelves:** tap one to stock it from your bag and set your own prices. Customers see the goods and price tags on the shelf.
  - **Opening hours:** the shop is open while you **work the register** (you also earn 10% tips), or while a hired clerk is in, 8 AM to 8 PM. The clerks are Pip, Hazel, Bram and Wren, each with a daily wage and a sales skill. Wages are paid each morning, and a clerk you can't pay quits.
  - **Customers:**
    - Walk-in customers (villagers and townsfolk) come more often on busy roads, using City Hall's traffic data, and buy more when prices are fair.
    - Other players can browse and buy too.
    - The money reaches you even while you're offline.
  - **🏪 Shop panel:** shows status, takings, staff and recent sales.
- **Cheat console** in **⚙️ Settings → Cheats** (the same on desktop and phones). Type a command or tap one of the shortcut chips.
  Type `testingcheats true` first, then any of:
  - `money 9999999` sets your coins.
  - `motherlode` gives +50,000. `kaching` and `rosebud` give +1,000.
  - `freerealestate on` makes land changes free.
  - `bb.enablefreebuild` turns free building on or off.
  - `tp cityhall`, `tp park`, `tp fair` or `tp square` teleports you (or `tp <x> <y>` in tiles).
  - `fillneeds` (or `sims.fill_all_commodities`) fills every need; `needs hunger 20` sets one.
  - `give berry 5` puts items in your bag.
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
client/   the game: Vite + Babylon.js (3D view, one custom shader for the HD-2D pixel look) + canvas pixel-art painters; Capacitor Android project in client/android
```

| Piece                 | Cloudflare product                                                                                         |
|-----------------------|------------------------------------------------------------------------------------------------------------|
| Game client           | Workers Static Assets                                                                                      |
| Live world            | one Durable Object (`World`). It runs the simulation and stores plots, profiles and NPC minds in its SQLite storage |
| Accounts and sessions | Better Auth on the **`tycoon-auth` D1 database** (`user`, `session`, `account` and `verification` tables)  |
| NPC dialogue          | Workers AI: Llama 3.3 70B, falling back to Llama 3.1 8B, then to scripted lines                            |

**Keeping it smooth.** Moves are checked against a movement budget, so packets that arrive bunched up after a network hiccup aren't rejected. Positions use interest management: you get every move of people within 48 tiles of you as it happens, and everyone else's position once a second (enough for the map, and it doubles as a heartbeat). Rows that didn't change aren't sent at all. Clients reconnect when the server has been silent for 5 seconds, when the tab comes back or when the network returns, with randomised back-off. The server drops players it hasn't heard from for about 45 seconds. Each plot carries a revision number, so clients rebuild a house only when it changed, nearest first and at most two per frame. Other players are drawn about 120 ms in the past, interpolated between server updates. The camera and sprites share one pixel grid, so walking doesn't wobble.

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
| Build mode      | B · H select/move · C copy (or Alt+click) · K sledgehammer · T design · L time of day · R or right-click rotate · V walls · PgUp/PgDn floors · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo · Delete sells a held item · Enter or double-click finishes a custom room · Esc cancels · WASD or right-drag to pan | two-finger drag to pan, tool strip buttons |
| Village map     | M, or click the minimap                       | tap the minimap                    |
| Cheat console   | ⚙️ Settings → Cheats                           | ⚙️ Settings → Cheats               |

## Ideas for next steps

- Wallpaper and paint on each side of a wall, and terrain tools
- More villagers and seasonal events driven by NPC gossip
- Several village shards once one fills up
