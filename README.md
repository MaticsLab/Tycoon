# Tycoon Village

A small cozy multiplayer life-sim for Android (and the browser), inspired by Stardew Valley and The Sims.
Everyone joins the same village. You pick a free plot, then build a house on it tile by tile: walls, windows, doors, floors, furniture.
You can also lay out a garden and grow crops to earn coins for more furniture.

## What's in the world

- **A shared village**: 14 fenced plots around a town square with a pond and a fountain, surrounded by forest.
- **Plots**: walk into any plot marked *For sale* and tap **Claim this plot**. Each player can own one plot.
- **Sims-style build mode**: tap **Build** to open the catalogue (Walls, Floors, Furniture, Garden, Farm). Tap or drag to place items, and use **Remove** for a full refund.
  Walls switch to a cut-away view when you're inside a plot, so you can see the rooms.
- **Farming**: till soil, plant turnips, carrots, strawberries or pumpkins, and harvest them when they sparkle. Crops keep growing while you're offline.
- **Multiplayer**: you see other villagers walking around in real time, and chat shows up as speech bubbles.
- **Day and night**: one in-game day lasts 24 real minutes. At night the village goes dark, and lamps, lamp posts and windows light up.
- **Persistence**: plots, houses, coins and positions are saved on the server. Players get their own plot back when they reconnect from the same device.

All the art is pixel art drawn in code, so the project has no image assets to manage.

## Project layout

```
shared/   world map generation, collision, clock, item catalogue (used by server AND client)
server/   Node.js authoritative game server (WebSocket at /ws, also serves the built client)
client/   the game (Vite + canvas), plus the Capacitor Android project in client/android
```

## Running it

Requires Node.js 20 or newer.

```bash
npm install
npm run build        # build the web client
npm start            # server on http://localhost:8080 — open it in a browser
```

Open the page in two browser windows to see multiplayer working.

To develop with hot reload, run `npm run dev -w server` and `npm run dev -w client` in two terminals, then open the Vite URL (http://localhost:5173). Vite forwards `/ws` to the game server.

Run the server tests with `npm test`.

### Server settings (environment variables)

| Variable    | Default                  | Purpose                               |
|-------------|--------------------------|---------------------------------------|
| `PORT`      | `8080`                   | HTTP + WebSocket port                 |
| `DATA_FILE` | `server/data/world.json` | where the world is saved (every 5 s)  |
| `STATIC_DIR`| `client/dist`            | built client to serve                 |

## Building the Android app

You'll need [Android Studio](https://developer.android.com/studio) with JDK 21.

```bash
npm install
npm run android      # builds the client, syncs it into client/android, opens Android Studio
```

In Android Studio, press **Run** to install the app on an emulator or a phone, or use *Build → Build APK(s)*.

The app needs to know where the game server is. Set it in either of two ways:

- **On the join screen**, open **Server** and enter `ws://<your-computer's-LAN-IP>:8080/ws`. The app remembers it.
  The Android emulator defaults to `ws://10.0.2.2:8080/ws`, which points at your computer.
- **Baked in at build time**: `VITE_SERVER_URL=wss://play.example.com/ws npm run android`.

When you host the server publicly, put it behind HTTPS so players connect with `wss://`.
Any Node host works (Fly.io, Render, Railway, a small VPS), as long as `DATA_FILE` is on a persistent disk.

## How the multiplayer works

- The server is authoritative. It checks every claim, placement, removal and harvest against plot ownership, the coin balance and the shared placement rules in `shared/catalog.js`.
- Movement is predicted on the client for responsiveness. The server checks it against speed and collision limits and snaps back anyone who cheats or desyncs.
- Positions are broadcast 10 times a second, and clients interpolate between updates. Plot changes are pushed to every player as they happen.
- Identity is a random token kept on the device; there are no accounts yet.

## Ideas for next steps

- Accounts and login, so a plot follows you across devices
- Multi-tile furniture and item rotation
- Shops and NPCs in the town square, and selling crops to a market
- Visiting permissions (lock your door, a friends list)
- Several worlds/shards once one village fills up
