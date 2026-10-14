# CrossPaths

A cozy multiplayer life-sim for the browser and Android: Stardew Valley's pixel art meets The Sims' build mode.
Everyone shares one village. You claim a plot, build a house wall by wall in 3D, furnish it, and grow crops.
You can also befriend villagers whose personalities change based on how you treat them.

**Play:** https://tycoon-village.plain-silence-2a72.workers.dev

## Features

- **A 3D village that still looks like pixel art.** The world renders at low resolution and is scaled up with sharp pixels.
  Ground, walls, floors and roofs use hand-painted pixel textures.
  Characters, NPCs, trees and crops are pixel sprites that always face the camera (the "HD-2D" look).
  - The camera orbits freely. Hold the **middle mouse button (scroll wheel) and drag** to rotate and tilt it, **right-drag** to move it anywhere, or turn in 90° steps with Q / E. Zoom with the mouse wheel or a pinch.
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
  In build mode your plot gets a Sims-style build grid: crisp white lines over grass and floors alike, with a dashed white border round the lot. Nearby plots show faintly, and public road tiles on your land are shaded. The wall and fence tools show a tall white pole with a pointer that snaps to the grid corners, so you can see exactly where a wall will start and end (it turns red where you can't build).
  Everything you place is previewed in its real colours (red if it can't go there), with a label at the cursor giving the price and the reason.
- **Public places:** the Town Square, City Hall, Willow Park (a lake, a gazebo and benches) and the Harvest Fair (a pumpkin patch, corn rows and market stalls).
- **The countryside.** The map is more than twice the size: the old village sits in the north-west, and round it the land is wild and winding.
  - A **river** runs down from the north to the sea, crossed by wooden **bridges**.
  - **Seashell Beach** runs along the south coast, with parasols, towels, rowboats and a **pier** with lamps.
  - East of the river the land rises into **the Highlands**: cliffs of layered rock, rock formations and boulders, and **stone stairs** up to the moor and on up to **Eagle Lookout** (with a telescope). Cliffs block the way; the stairs are the way up.
  - **Pine Hollow Campsite** in the pinewoods: tents round a campfire, log seats and lanterns.
  - Also the **Duck Pond**, the **Standing Stones**, **Riverside Green** and **Gull Point** on its headland.
  - Winding lanes link it all, with **dozens of new lots for sale** of all shapes along them. Existing homes keep their place when a world upgrades to the new map.
- **Seasons follow the real calendar.** From September to November the trees turn red and gold, leaves cover the ground and pumpkins fill the fair.
  In October the village decorates for Halloween with jack-o'-lanterns, hay bales, bubbling cauldrons and a spooky graveyard. Fall decorations are also for sale in build mode.
- **City Hall and elections.** Talk to **Mabel, the City Clerk** (an AI villager) at City Hall, then tap **🏛️ City Hall business**. City Hall opens as a wide window with a sidebar: Overview, Election, Council and Public projects; Utilities, Farmhands, Business and Bank & taxes; and Data. Each section fits on one screen. You can withdraw from a race while filing is still open.
  - **Elections** every 4 village years (about 4½ real days) for a **mayor** and a **50-seat council**. Players file a platform and vote in person at City Hall.
    A new village holds a founding election straight away. Seats nobody wins go to **AI caretakers**, and **Mayor Bramble (AI)** serves if nobody runs for mayor.
  - **Proposals**: close the road across your plot, set the price of land, or pass a resolution. The council votes for two village days.
    AI caretakers vote as a bloc on advice from Workers AI, which weighs the city data. A player mayor signs or vetoes; unsigned bills become law after a day.
  - **City data**: road traffic, visits to public places, the economy and the treasury (land payments go to the city). Mabel sees all of it and answers questions about it.
  - Only villagers with an account can run, vote or bring proposals.
- **Village map.** A square minimap in the corner follows you as you walk, and the full map (M) shows the whole village: roads, public places, every plot (yours in gold, land for sale dashed), houses, and live dots for you, other players, townsfolk and pets.
  Tap it or press **M** for the full map with labels and a legend.
- **Village clock:** a day runs from 5:00 AM to 5:00 AM. The clock moves in 10-minute steps, about 6 real seconds each, and there are 112 days in a year.
- **Sims-style build mode** on your own plot:
  - **Walls** sit on the grid lines between tiles. Drag to draw a wall, or use the **Room** tool to drag out four walls plus a floor at once. There are six wall materials.
  - **Doors and windows** go into walls. Doors let people through; windows don't.
    - **Doors:** panelled wood doors, French doors, archways, glass shop doors, and two-segment **double doors** (French, or glass shopfront).
    - **Windows:** normal and tall windows, plus floor-to-ceiling **storefront windows** that join into one glass wall when placed side by side.
    - **Colours:** the 🎨 Design tool repaints any door or window frame (wood, blue, red, green, black or cream).
  - **16 wall materials**, including shiplap, stucco, cedar shingles, board-and-batten, painted brick, slate, shopfront panelling, subway tile, floral wallpaper and wainscoting.
    - **Each side paints separately:** the **🖌 Paint** wall tool paints one side of a wall, so the outside and inside can differ.
    - **Shift+click** paints a whole room's inside, or the whole outside of that building.
  - **Floors** are laid by dragging a rectangle. **Roofs** are gable roofs dragged over your rooms.
  - **Two storeys and stairs.** Switch between *Ground floor* and *Upstairs* to build and furnish each one. Stairs (in **Walls & Stairs**) come in six styles: oak with a banister, painted box stairs, carpet-runner stairs, floating treads on a steel spine, stone steps and iron stairs. Each shows up as itself in the catalog. They take up 1×3 tiles, can be rotated, and cut their own stairwell through the floor above. Walk onto them to go upstairs.
  - **Fences** have their own tab and build along the grid lines just like walls (drag a line or a whole pen, with the same pole cursor): white picket, ranch rail, woven willow, porch railing, wrought iron, dry-stone wall and box hedge. **Gates** (picket or iron) let people through. Fences block the way like walls but never close off a room, and they also work upstairs as balcony railings.
  - **Walls up / cutaway / down**, just like The Sims. When you walk inside a house, the walls cut away and the roof and upstairs hide automatically.
  - **Furniture** comes as small 3D models. Larger pieces span 2 or 4 tiles, and anything with a front can be rotated. Plants are pixel-art cards.
  - The **sledgehammer** removes anything with a full refund. Tap a door or window to remove just that, or drag a box to clear a whole area at once.
  - **A see-through build HUD** keeps most of the plot in view:
    - **Top left:** an icon bar with Select, Sledgehammer, Eyedropper and Design, then Undo/Redo and a sun/moon for the day/night preview. Any tool but Select shows a hint pill underneath.
    - **Top right:** ▲/▼ to switch floors, a cube whose line shows the walls mode (up, cutaway or down), and **✓ Done**.
    - **Bottom:** a frosted catalog panel. The left rail picks a group (**Build**, **Home**, **Business**, **Outdoor**, **Mine**), the tabs pick a category (with item counts), and items sit in a two-row grid with price or "Owned ×N" and a ☆ to star them. The right column shows whatever you hover or hold: size (turned when rotated), how many you own, the cost, notes like "Glows at night · Rotates", and what placing it will leave you with. **Mine** holds Starred, Recent (your last 8 picks), In bag, and Rooms & Library. **Land** (resize, merge, split, roads, move house, lot info) lives under Build.
    - **Above the panel:** a search box that searches every item ("/" jumps to it) and your coins, which flash −45 or +45 as you build.
    - **While you hold an item,** a dashed box with its icon follows the cursor, labelled with the price (or "From bag"), R rotate and Esc cancel. Esc puts it down.
    - **Click with Select** to select what's under the pointer. The game tests each piece of furniture's real 3D shape (and the walls in front of it), so clicking the top of a fridge or the back of a sofa inside a house picks that, not the floor or the room behind it. A popup appears above the selection:
      - **Furniture:** turn it left or right (Shift+R / R, or right-click it) or pick it up and move it. Delete sells it back.
      - **A room's floor:** turn the whole room or pick it up and move it.
      - **A wall:** selects the whole straight line of wall, with an arrow at each end: drag one to lengthen the line (new walls in the same material) or shorten it (knocked down, refunded). Five bars set **wall height** like The Sims: low, half, short, medium or tall. The whole run of joined walls changes together, roofs sit on top of tall walls, a tall wall drops back to medium under an upstairs floor, and a wall with a door or window is never lower than short.
      - Hovering a room's floor doesn't outline the room; it's only outlined once you click its floor.
    - **Nothing vanishes while you move it:** the furniture or room stays drawn where it is, and a ghost shows where it's going until you set it down.
    - **After you place a piece of furniture** it drops from your hand and becomes selected, so you can turn or nudge it straight away. Seeds, pipes and cables stay in hand.
  - **The build tools:**
    - **👆 Select (H)** picks up furniture so you can move or turn it for free, with a green footprint and an arrow showing which way it faces. Click a room's floor instead to lift the **whole room** (walls, floor and furniture) in a white wireframe box, then move it and turn it with R or right-click. From the ground floor the room takes everything above it along too: its upstairs, stairs and roof. Whatever you carry disappears from its old spot until you set it down.
    - **💧 Copy (C)** copies whatever you click as your current tool. **🎨 Design (T)** cycles furniture through colour swatches and roofs through materials.
    - **Undo / Redo** for every build action, the **day/night** button to preview your house at morning, afternoon, dusk and night, and in **Build → Land**, **Move house** to shift the whole house and **Lot info** for lot value, bedrooms, bathrooms, rooms and the bulldozer.
    - **⌁ Custom room** (Walls tab): click corner points, then double-click or press Enter to finish. Click the first point again to close the room and it gets a floor. The tooltip shows the cost as you go.
  - **📚 Rooms & Library**: nine ready-made **styled rooms** (bedroom, bathroom, kitchen, living room, study, garden patio, game room, laundry nook and backyard picnic) that you place and turn, with live previews of their furniture, then **Buy**. Save any room, or your whole house, to **My Library** (up to 12) and place copies anywhere. Shop furniture in a blueprint comes from your bag; any pieces you don't have are left out and the game tells you which.
- **Town square** with two shops and three NPCs:
  - **Rosa's Market** buys your crops and sells gifts.
  - **More furniture & decor**: recliner, spindle loveseat, knitted pouf, low bookcase, record player, arcade cabinet, arc floor lamp, bunk bed, rocking chair and vanity; a kitchen island, kitchen sink, dishwasher, bar stool, washer, dryer and pedestal sink; cactus, succulents, globe, painting easel, fishbowl, candle lantern and cat tree; and for the garden a picnic table, BBQ grill, birdbath, gnome, hammock, rose arch, fire pit and stone lantern.
  - **Otto's Furniture** sells exclusive pieces: piano, fireplace, aquarium, grandfather clock, telescope and statue.
  - **Juniper** is the village gardener and gossip.
- **Villagers with daily lives.** Every morning each villager plans their day. The routine is fixed but the AI picks the variations, and also decides what's on their mind and what they'll call out to passers-by. Rosa opens the market, lunches on a park bench and gossips with Otto in the evening. Juniper gardens and stargazes; Mabel takes her coffee outside City Hall before her shift. They walk real routes around the village (A* path finding over public land), sit on benches, and sleep indoors at night (no chatting while they're asleep). Friends meet up and trade AI-written banter in speech bubbles everyone nearby can see.
- **Twenty villagers.** Besides Rosa (grocer), Otto (carpenter), Juniper (gardener) and Mabel (City Clerk), the village is home to:
  - Hazel the fisher, Bram the blacksmith, Willa the librarian and Doc Ellis;
  - young Pip, Marigold the florist, Gus at the Saloon and Theo the musician;
  - Ivy the painter, Sam the postie, Nell the retired teacher and Fern the beekeeper;
  - Rowan who farms East Field, Lila the baker (Rosa's niece), Felix the astronomer and Bea the teenage skater.

  Each has their own cottage out in the countryside, somewhere that suits them: Hazel on the riverbank, Ivy in the woods past the campsite, Felix's observatory up north under dark skies, Gus's saloon on the coast road, Bea by the pier. The cottages are real walk-in houses with interiors to match their owner (Hazel's aquarium, Willa's wall of books, Theo's piano, Felix's telescopes under a glass roof). Villagers walk home through the front door at night, hurrying on long trips, and spend days out at the beach, the campfire, the lookout and the duck pond. Each also has their own look, sense of humour, daily routine (fishing, painting, playing music, delivering the post, playing in the square…), likes and dislikes, and friendship gifts.
- **Requests (quests).** Favours are rare and on purpose: each day only a few villagers (about one in five, picked at random for you) have something to ask, and they show a bobbing **!** over their head. Talk to one of them to hear it; everyone else just chats. Up to 3 at a time:
  - bring them crops or gifts;
  - put a particular piece of furniture in your home;
  - do something (cook, read, paint, stargaze…);
  - carry a message to another villager, who reacts when you deliver it.

  The game picks what's asked, so it's always doable, and the villager's AI words it in character. Rewards are coins and friendship. Track them with **📜 Quests**, and hand them in from the talk panel.
- **NPCs with memory and evolving personalities.** Conversations run on Workers AI. Each villager has their own sense of humour: Rosa's teasing auntie food puns, Otto's bone-dry deadpan, Juniper's whimsical plant drama, Mabel's bureaucratic comedy. They read how *you* write (casual or formal, playful, emoji, short and snappy) and mirror it, keep running jokes with you, and know what they're doing right now and what they've asked you for. Their core personality stays, but it shifts with how they're treated.
  - Each NPC has five traits: warmth, cheer, trust, generosity and energy. Kindness, insults and gifts shift those traits over time, and the NPC keeps a diary of how and why they changed.
  - They remember facts about you, keep the last few lines of your conversation, and pass gossip to each other.
  - Their mood and how much they like you change their shop prices.
- **Characters with a skeleton.** Arms and legs are two-bone limbs (shoulder–elbow–hand, hip–knee–foot) posed with inverse kinematics, so villagers really sit (thighs forward, knees bent, feet on the floor), stride when they walk, and use their hands: lifting food to their mouth, holding a book, playing the piano or a game pad, stirring a pot, painting, warming their hands, washing up, carrying a plate, whittling, or resting their hands in their lap. Townsfolk wave now and then while they chat. Lying down is animated: they sit on the edge, then lie back, and get up the same way. Asleep in bed they breathe under the quilt and roll over now and then. A nap on a sofa, loveseat or hammock stretches them out along it (head on the armrest, eyes shut, hands on their belly), and on a recliner or beanbag they lean right back with their legs out. The lying figure faces the camera like everyone else, so it looks just as solid from any angle.
- **Needs, like The Sims.** Hunger, energy, bladder, hygiene and fun run down while you play (one in-game hour is 36 seconds), shown in the **Needs** panel under the map with a plumbob that turns from green to red as your mood drops. **Health** falls while any need is empty and recovers while they're all okay; you get a warning when it drops low, and if it hits zero you faint and the village doctor patches you up right where you are for 🪙25. Being exhausted or unwell also slows you down.
  Walk up to furniture and use the action button, or tap it for a menu:
  - **Fridge**: grab a sandwich (🪙5) or cook a meal (🪙15, needs a stove); the stove cooks and the BBQ grill grills too. When it's ready you're holding a plate (everyone can see it), so carry it anywhere and **sit and eat** on a chair, sofa, stool, bench or picnic table, or eat standing up. Walk off before it's ready and you get your coins back.
  - **Toilet**, **shower**, **bathtub** and **sink** fill bladder and hygiene; showers and baths steam.
  - **Bed** or **bunk bed**: sleep or nap, tucked in under the covers with drifting Zzz. When everyone online is asleep in bed, the night passes and the village wakes at 6:00 AM the next day: crops grow and machines finish overnight, and you wake rested. If others are still up, you're told how many are asleep so far. Sofas, loveseats, armchairs, recliners, rocking chairs, chairs, poufs, bar stools, bean bags, benches and picnic tables let you really sit down (a seated pose, toilet included) and relax; recliners and hammocks are good for a nap.
  - **BBQ grill**: grill a meal (🪙12, no stove needed). Kitchen and pedestal sinks wash up.
  - **TV**, **bookshelf**, **low bookcase** or **desk** (read), **piano**, **aquarium** or **fishbowl**, **fireplace** or **fire pit**, **telescope**, **arcade cabinet**, **record player** and **painting easel** fill fun.
  Moving stops what you're doing. Others see a thought bubble with what you're up to, and you can use things in a friend's house while they're home. Crops, Honey Cake and Herbal Tea can be eaten straight from the bag.
- **Farming.** Till soil and plant seeds. Walk into a ripe crop to pick the whole row (or column) of ripe crops you're walking along, then sell them to Rosa or in your shop.
- **Seasons.** Each year has four 28-day seasons, shown on the clock: 🌸 spring, ☀️ summer, 🍂 fall and ❄️ winter. The world changes with them: trees turn in fall and snow covers the ground in winter.

  | Crop | Seasons |
  |---|---|
  | Turnip | spring, fall |
  | Carrot | spring to fall |
  | Strawberry | spring, summer |
  | Pumpkin | fall |
  | Wheat | spring to fall |
  | Corn | summer, fall |
  | Melon | summer |
  | Kale | winter |

  - Out-of-season seeds can't be planted outdoors, and when the season turns, out-of-season crops wither.
  - **Greenhouses:** anything under a roof grows in any season. There's a Greenhouse Glass roof.
  - Rosa pays 30% more for crops that are out of season.
- **Crop quality.** Crops come out normal, ★ silver or ★★ gold. Watering them through their growth and planting on **Rich Soil** (🪙14 a tile) raise the odds. Rosa pays +25% for silver and +60% for gold, and sells your best ones first. Your bag shows how many of each you have.
- **Animals.** Build a **Chicken Coop** (🪙400, up to 4 chickens) or a **Barn** (🪙1,200, up to 4 cows or sheep), then tap it to buy animals:

  | Animal | Price | Gives |
  |---|---|---|
  | Chicken | 🪙120 | an egg a day |
  | Cow | 🪙650 | milk a day |
  | Sheep | 🪙500 | wool every 2 days |

  - Feed them **hay** (from Rosa) or **wheat** once a day. Each morning, fed animals make their product; tap the building to **Collect**.
  - **Pet** them daily. Happier animals make better-quality goods; hungry ones get sad.
  - They wander around their home during the day. A farmhand feeds them from your bag and collects for you.
  - You can't tear down a coop or barn with animals inside: sell them first (half price).
  - New machines and recipes:
    - **Cheese Press:** milk → cheese.
    - **Loom:** wool → cloth.
    - **Bakery Oven:** wheat, eggs and milk → Farmhouse Cake; wheat → bread.
    - **Juice Press:** melon juice.
    - **Soup Pot:** corn & kale soup.
- **Fishing.** Buy a rod from Juniper and stand at the water's edge (the square's pond or Willow Lake), then tap **🎣 Fish**. When the **❗** appears, tap **Reel in!** quickly; a faster reel can land a better-quality fish. What bites depends on the water, the season and the time of day:
  - sunfish, carp, bass, trout and pike;
  - catfish (at night) and koi (in the pond);
  - and the legendary **Old Whiskers** (Willow Lake, fall nights).

  Rosa buys fish. You can eat them, smoke them in a **Fish Smoker**, or make **Fish Stew**.
- **Trading.** In the bag, choose someone standing near you and tap **🤝 Trade**. Each side puts items and coins in a two-sided window, and nothing changes hands until both agree.
- **The notice board** (town square or City Hall) is a player market. Post items at your price, up to 5 notices each. Anyone can buy them, and you're paid even when offline, with a letter to tell you.
- **Mail** (📬). Every home and shop comes with a mailbox by the road. Walk up to any mailbox (yours, the square's, City Hall's or a neighbour's) to read your letters and write new ones, attaching items or coins; postage is 🪙5. An envelope by the clock tells you when there's unread mail. Letters wait in the recipient's mail even if they're offline. Bills, festival prizes and villagers' letters arrive here too.
- **Co-op farms.** In build mode, open **Build → Land → Lot info** and add friends by name, either as farm helpers or co-builders:
  - **Farm helpers** can harvest, water, plant, look after animals and drive your tractor.
  - **Co-builders** can do all of that and build too.

  Whoever does the work keeps the harvest and pays for what they build.
- **Storage.** A **Storage Chest** holds 300 of anything (30 kinds), and the fridge holds food. Quality is kept. Removing a chest gives its contents back.
- **Festivals.** Every 7th day there's a contest at the Harvest Fair (or the square), rotating through:
  - the Harvest Festival (crops);
  - the Fishing Derby (fish);
  - the Great Bake-Off (homemade products);
  - the Animal Fair (eggs, milk, wool).

  Enter before 6 PM. Entries are judged on value × quality, and the top three win 🪙500 / 🪙250 / 🪙100, with a **Festival Trophy** for first place.
- **Bag, Quests and Journal** share one popup: the 🎒 Bag button opens it, with a tab for each (red badges show open requests and a new paper).
- **Talking to villagers:** the talk window shows their portrait, friendship hearts (filling part-way as you get closer), how close you are, their mood and where they are. Their personality and loves sit behind the ⓘ About button. The conversation scrolls, with dots while they're typing. Pick a gift from your bag right in the window (loved ones are tagged once you know them).
- **The bag** (🎒, or I) is a slot inventory like Stardew's: a 27-slot backpack and a 9-slot hotbar. Drag items between slots (onto 🗑️ Trash to throw them away), Sort to tidy up, and click one for its details: what it's for, what eating it gives, its quality, and Eat / Give / Drop with an amount. Give goes to whoever is nearest (a player, or a villager as a gift). The hotbar is always on screen: press 1–9 (or tap a slot) to hold something, and hold food to eat it from the action button. Quests and the Journal are tabs on the same window.
- **Chat** (💬): a chat panel with the whole conversation, your own messages on the right, colour-coded names, quick replies and emoji, and an unread count on the button. New lines also float up over the corner for a few seconds.
- **Settings** is the ⚙️ gear in the top-left corner.
- **Journal** (📖):
  - **Daily and weekly goals:** 3 small goals a day and 1 bigger one a week, paid as soon as you finish.
  - **The festival:** entries and results.
  - **The Village Gazette:** a morning newspaper the AI writes from what really happened (winners, new sweethearts, Rosa's best supplier, council news).
- **Friendship and dating.** Villagers' hearts (0–5) grow as you're kind to them:
  - **3 ♥:** a letter with a gift (Rosa's honey cakes, a chest from Otto, Juniper's big watering can, a grant from Mabel).
  - **4 ♥:** a friend's discount, or interest-free loans from Mabel.
  - **5 ♥:** best friends. You can **💕 ask them out** (once a day, +40 fun). After three dates, you're sweethearts.
- **More tools and machines.**
  - **Juniper's cart** sells a **Scythe** (harvests the rows either side of the one you walk) and a **Big Watering Can** (waters three rows).
  - **Electric Mill** (needs power): wheat → flour. Flour goes into Farmhouse Cake and wheat bread.
- **The village bank and public projects** (City Hall):
  - **Loans:** borrow 🪙100–3,000 from the treasury and pay back 10% more within 28 days.
  - **Property tax:** the council can set it (0–20 coins per 10 tiles a month); it's collected on the first day of each month.
  - **Public projects:** the council can vote to spend the treasury on a Flower Garden (Willow Park), a Farmers' Market and a Village Library (City Hall lawn, walk-in, with books to read), or a Bandstand at the fair. Each appears in the world once it's built.
- **Rosa reacts to supply.** Each morning she runs short of whatever in-season crop nobody's been bringing her and pays 50% more for it. She also brags about yesterday's best supplier.
- **A big town square** (56×16) with room around the shops. The shop fronts are layered like a real high street:
  - stone plinths, corner pilasters and cornices;
  - a tall painted sign board above the glass doors;
  - striped awnings and flower boxes over the windows;
  - lanterns by the door that glow at night, and a front step;
  - Otto's brick chimney.

  Rosa has a market stall, a produce cart and flower buckets out front, a fishmonger's stall sits by the pond, and Otto has a rocking chair and an OPEN sign; the square is kept roomy, with benches, planters and lamps around the fountain.
- **Woods, chopping and mining.** Groves of trees and rocky outcrops cover the open land. Buy an **axe** or a **pickaxe** from Juniper, walk up and tap **🪓 Chop tree** / **⛏️ Break rock**, or tap the tree itself; if you're far away, you walk over first.
  - A tree takes 3 swings (3–5 wood, sometimes an oak sapling) and a rock takes 4 (2–4 stone). Otto buys wood and stone.
  - Claiming land clears it, and the wood and stone go to you.
  - Stumps grow back after about a day. When the village runs low, new trees and rocks sprout next to the old ones.
- **Plant trees.** **Oak saplings** grow into trees you can chop for wood (you get the sapling back to replant). **Apple trees** fruit every day once grown: tap them to pick 3 apples (🍎 shows when ready). Both are in Build → Farm, and oak saplings also drop from wild trees.
- **Fewer roads.** The village starts with three east–west roads and two north–south ones. The rest is wild land the council can open up (City Hall → Council → Build a road, paid from the treasury, 🪙3 a tile): East Lane, Far East Road, Far South Road and West Link. Players can still lay road on their own land.
- **Weather and ambience.**
  - **Forecast:** a daily forecast for the whole village brings rain (sometimes a thunderstorm with lightning in summer) or snow in winter, for part of the day.
  - **Rain** darkens the sky and waters every outdoor crop (not the ones in greenhouses).
  - **By season:** petals and leaves fall from the actual trees around you, in each tree's own colours (pink petals from blossom trees in spring, red, orange and gold leaves from autumn maples, the odd green leaf in summer), flutter down, rest on the ground and fade. Fireflies glow on summer nights.
  - **Cloud shadows** drift slowly over the land.
- **Things come alive.** Live sprinklers spray arcs of water that splash down (the big one sweeps back and forth), fireplaces and fire pits flicker with embers and smoke, candles and lanterns glow at night, busy machines puff steam, the cauldron bubbles and the harvester's light blinks while it's powered.
- **Music and sound** are all synthesized in the browser, with no audio files. Things near you make their own sounds, louder the closer you are: sprinklers hiss and tick, fires crackle, machines hum, a grandfather clock ticks, the cauldron bubbles. **Settings → 🔊 Sounds** has a volume for everything, music, weather & nature, things around you and actions.
  - **Music:** four calm, looping pieces, one per season, that crossfade when the season turns:
    - **Spring:** flute over electric piano, in C major.
    - **Summer:** marimba, in D major.
    - **Fall:** piano over strings, in A minor.
    - **Winter:** a music box over a soft pad, in E minor.

    At night the melody rests and a few bell notes play instead.
  - **Ambience:**
    - rain with pattering droplets;
    - storms with rumble, and thunder that follows the lightning;
    - wind, stronger in fall and winter;
    - birdsong by day;
    - crickets on summer and fall nights, owls in fall and winter;
    - babbling water near the pond and fountain.

    Everything is muffled when you're indoors.
  - **Effects:** chopping, a tree falling, mining, fishing splashes and bites, placing and picking up, and coins when trading.
  - **Volumes:** set music, ambience and effects in ⚙️ Settings → Game.
- **Walk-in village shops.** Rosa's Market and Otto's Furniture on the town square are real buildings: in through the glass double doors, the walls cut away like at home. Rosa's is kept roomy, with a wide aisle from the door to the counter: wall shelving and shelves round the walls, a produce stand, chilled cases and a bakery case, all filled with real goods you can see (turnips heaped in crates, loaves in the bakery case, milk bottles in the chiller); Otto's is a furniture showroom with a fireplace and a piano. The keepers stand behind their counters during opening hours. Tap a shelf or the register (**🛒 Shop here**), or talk to the keeper from anywhere inside, to buy and sell. The shops belong to the village: nobody can claim or edit them.
- **Watering.** Watered crops grow twice as fast while the soil stays wet (one in-game day; wet soil looks dark). Buy a **watering can** from Rosa and walking through your rows waters them.
- **Water and electricity.** At City Hall, hook up **💧 water** (🪙100 setup + 🪙120 a month) or **⚡ electricity** (🪙150 + 🪙200 a month). Bills go to the city treasury every 28 days. If you can't pay, the service is cut off until you settle up at City Hall.
  - Water gives you a **ground spout** and electricity a **power box**. Place either anywhere on your plot from Build → Bag.
  - Run **water pipes** and **power cables** from them. They're buried: drag to lay a run (an L from where you press to where you let go), and crops, floors and furniture can go on top. Tap a pipe with the pipe tool, or use the sledgehammer, to dig it up. In build mode they show as thin joined lines (bright when connected to the spout or power box, grey when not); otherwise you only see the stub where a line comes up into a sprinkler or machine. Anything on or next to a live line is connected.
  - In build mode, 💧/⚡ marks connected things and ⚠️ unconnected ones.
- **Automation** (Build → Water, Power & Automation):
  - **Sprinkler** and **Big Sprinkler** keep the crops around them watered (3×3 and 5×5).
  - **Auto-Harvester** (needs power) picks ripe crops in a 7×7 area into your bag and replants them; seeds come out of your coins.
  - **Powered shop machines** (a cable to the power box) work twice as fast.
  - **Tractor:** tap it and choose **🚜 Drive**. While you drive, it works a 3-tile strip across your path, in one of four modes:
    - **Harvest** ripe crops;
    - **Plant** a seed of your choice;
    - **Till** bare ground;
    - **Water** (needs water service).

    Tap **🅿️ Park** to get off. If there's no room to park, it goes in your bag.
- **Farmhands.** Hire Clem, Dottie or Moss at City Hall (🪙35–80 a day, paid each morning). They walk your rows, harvest and replant (into your bag), and water the dry crops, even while you're offline. If you can't pay the wage, they quit.
- **Drop and give.** In the bag:
  - **⬇️ Drop** puts things on the ground; anyone who walks over them picks them up.
  - **🎁 Give** hands items, or coins, to a player standing near you.
- **The market.** Selling lots of one crop lowers what Rosa pays for it for a while (it recovers hour by hour). Each morning she names a **⭐ pick of the day** that she pays 50% more for. Her stall shows the trends.
- **Run a business.** Get a licence at City Hall (🪙500, paid to the treasury). Then stand on a plot that's for sale and tap **Open my shop here**; the land costs the usual price per tile.
  - **Build it** like a house. In build mode the **🏠 Home ⇄ 🏪** button switches which plot you're building.
  - **Shop & Machines** tab: indoor displays (shop shelves, wall shelving, produce stands, display tables, gondola end caps, basket stands, chilled cases, a bakery case), outdoor displays (market stall, produce cart, barrel display, crate stack, fish stall), a cash register and a shop sign.
  - **Shop Decor** tab: chalkboard sign, bunting, flower buckets, an OPEN sign, basket stacks, a market parasol and a weighing scale.
  - **Machines** turn crops into products over a few in-game hours:

    | Machine | Makes |
    |---|---|
    | Preserves jar | strawberry jam |
    | Juice press | carrot juice |
    | Bakery oven | pumpkin pie, turnip bread |
    | Soup pot | veggie soup |

    Products sell for more than raw crops, and you can eat them or sell them to Rosa.
  - **Shelves:** tap one to stock it from your bag and set your own prices. The goods sit on the display itself as little models (more stock, fuller shelves), and price tags appear on the shelf edge when someone walks up.
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
  Sliders set eye, hair and pants colour, and you name yourself, your farm and your favourite thing. Change your look later from **⚙️ Settings → 👤 Me → Change look**.
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
| Walk            | WASD / arrows (relative to the camera)        | drag anywhere: a floating joystick that follows your finger |
| Run             | hold Shift while walking                      | hold the joystick out at its edge (it glows orange) |
| Camera          | middle-drag to orbit, right-drag to pan, Q / E to turn, wheel to zoom | pinch to zoom, twist or two-finger swipe sideways to turn, two-finger swipe up/down to tilt (pans in build mode) |
| Talk / interact | Enter, or click an NPC                        | tap the action button or the NPC   |
| Build mode      | B · H select/move · C copy (or Alt+click) · K sledgehammer · T design · L time of day · R or right-click rotate · V walls · PgUp/PgDn floors · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo · Shift+R turns the other way · / search · Delete sells a held or selected item · Enter or double-click finishes a custom room · Esc drops what you hold or clears the selection · WASD or right-drag to pan | two-finger drag to pan, the icon bar |
| Village map     | M, or click the minimap                       | tap the minimap                    |
| Cheat console   | ⚙️ Settings → Cheats                           | ⚙️ Settings → Cheats               |


### Playing on a phone
The touch controls follow common mobile-game guidance: thumb-sized targets (44–48 pt or more, about 8 pt apart), the main actions in the bottom third of the screen, nothing placed by accident, and short vibrations as feedback.
- **Tap to walk:** tap the ground to walk there (a ring marks the spot); long trips break into a run. The floating joystick still works and takes over the moment you use it.
- **Tap to interact from afar:** tap a villager or a piece of furniture that's far away; you walk over and then talk to them or open its menu.
- **Building with confirmation:** drag to aim. The preview sits above your finger so your thumb doesn't hide it, with a dotted line to show where it points. Lifting your finger doesn't place anything: a bar appears with **✓ place**, **↻ turn** and **✕ cancel**, and you can drag again to move it. Pinching or panning while you decide keeps the preview where it is.
- **Long-press** any furniture in build mode to pick it up and move it.
- **Placing on a phone:** tap an item and it appears in the middle of the screen. Drag anywhere (like a trackpad, so your finger never hides it) to slide it, then tap ✓; ↻ turns it and ✕ cancels. The catalog fades while your finger is on the plot. Tap something to select it, or long-press to grab it and slide it somewhere else.
- The build HUD is see-through so more of your plot shows; on a phone the detail column folds away. Buttons, tabs and item tiles are at least 44px on touch screens.

## Ideas for next steps

- Wallpaper and paint on each side of a wall, and terrain tools
- More villagers and seasonal events driven by NPC gossip
- Several village shards once one fills up
