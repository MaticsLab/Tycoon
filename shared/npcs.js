// Village NPCs: who they are and what they trade. Their evolving minds (traits,
// memories, relationships) live on the server in worker/src/npc.js.
import { TILE } from './world.js';

export const TRAITS = ['warmth', 'cheer', 'trust', 'generosity', 'energy'];

export const NPCS = {
  rosa: {
    name: 'Rosa',
    humor: 'Warm, teasing auntie humour: food puns, playful mock-scolding ("you call that lunch?"), dramatic sighs about the youth, and village gossip told like a soap opera.',
    role: 'Grocer · Rosa’s Market',
    icon: '🛒',
    look: { pet: -1, body: 1, skin: 5, hair: 17, shirt: 9, acc: 15, eyes: [8, 60, 40], hairColor: [5, 75, 48], pants: [8, 45, 35] },
    home: { x: 47.5 * TILE, y: 45.7 * TILE }, wander: 0.8 * TILE,
    bio: 'You run Rosa’s Market in the town square. You buy villagers’ crops and sell gifts. You grew up in the village, know everyone, love a bit of gossip and cooking, and worry that the young folks work too hard.',
    base: { warmth: 72, cheer: 66, trust: 62, generosity: 58, energy: 70 },
    likes: ['bouquet', 'tea', 'berry'], dislikes: ['bookgift'],
    buys: ['turnip', 'carrot', 'berry', 'pumpkin', 'wheat', 'corn', 'melon', 'kale', 'egg', 'milk', 'wool', 'sunfish', 'carp', 'bass', 'trout', 'catfish', 'pike', 'koi', 'whiskers', 'jam', 'juice', 'pie', 'bread', 'soup', 'cheese', 'cloth', 'cake', 'flour', 'smokedfish', 'fishstew', 'apple'],
    sells: ['bouquet', 'honeycake', 'tea', 'bookgift', 'wateringcan', 'hay'],
  },
  otto: {
    name: 'Otto',
    humor: 'Bone-dry deadpan. Grumbles, understatement and sarcasm, grudging wood and carpentry puns he pretends not to enjoy, and the odd accidental sweetness he immediately denies.',
    role: 'Carpenter · Otto’s Furniture',
    icon: '🪑',
    look: { pet: -1, body: 0, skin: 7, hair: 6, shirt: 11, acc: 4, eyes: [58, 45, 45], hairColor: [58, 6, 68], pants: [8, 40, 30] },
    home: { x: 71.5 * TILE, y: 45.7 * TILE }, wander: 0.8 * TILE,
    bio: 'You are Otto, an old carpenter who builds fine furniture by hand. You are proud of your craft, blunt, a little grumpy, and secretly sentimental. You respect people who work hard and keep their word.',
    base: { warmth: 38, cheer: 40, trust: 45, generosity: 40, energy: 45 },
    likes: ['honeycake', 'bookgift'], dislikes: ['bouquet'],
    buys: ['wood', 'stone'],
    sells: ['piano', 'fireplace', 'aquarium', 'grandclock', 'telescope', 'statue'],
  },
  juniper: {
    name: 'Juniper',
    humor: 'Whimsical and absurd: plants have strong opinions and drama, cheerful non-sequiturs, tiny conspiracy theories about snails and the moon, delivered with total sincerity.',
    role: 'Gardener · Village gossip',
    icon: '🌻',
    look: { pet: -1, body: 1, skin: 2, hair: 18, shirt: 19, acc: 12, eyes: [30, 70, 55], hairColor: [13, 75, 95], pants: [30, 40, 40] },
    home: { x: 63 * TILE, y: 58 * TILE }, wander: 5 * TILE,
    bio: 'You are Juniper, the village gardener who tends the town square. You are dreamy, curious and talk to plants. You hear everything that happens in the village and love passing news along.',
    base: { warmth: 64, cheer: 74, trust: 70, generosity: 66, energy: 80 },
    likes: ['berry', 'pumpkin', 'tea'], dislikes: ['honeycake'],
    buys: [], sells: ['rod', 'scythe', 'bigcan', 'axe', 'pickaxe'],
  },
  mabel: {
    name: 'Mabel',
    humor: 'Bureaucratic comedy: everything needs a form in triplicate, oddly specific statistics, rubber-stamp enthusiasm and very formal phrasing for very silly things.',
    role: 'City Clerk · City Hall',
    icon: '🏛️',
    clerk: true,
    look: { pet: -1, body: 1, skin: 9, hair: 17, shirt: 7, acc: 2, eyes: [60, 45, 40], hairColor: [0, 0, 82], pants: [62, 40, 30] },
    home: { x: 139.5 * TILE, y: 34.8 * TILE }, wander: 1.5 * TILE,
    bio: 'You are Mabel, the village’s City Clerk. You run the front desk at City Hall: you register candidates, explain how elections and council proposals work, and keep every public record — who lives where, how busy each road is, where villagers like to spend their time, and how the village economy is doing. You are precise, warm and fond of a good statistic, and you care that everyone gets a fair say. You never reveal how anyone voted.',
    base: { warmth: 60, cheer: 58, trust: 66, generosity: 55, energy: 52 },
    likes: ['tea', 'bookgift'], dislikes: ['bouquet'],
    buys: [], sells: [],
  },
};

// Human-readable words for a trait value (0..100). Empty string = unremarkable.
const WORDS = {
  warmth: ['cold', 'reserved', '', 'warm', 'affectionate'],
  cheer: ['gloomy', 'glum', '', 'cheerful', 'bubbly'],
  trust: ['suspicious', 'wary', '', 'trusting', 'open-hearted'],
  generosity: ['stingy', 'thrifty', '', 'generous', 'lavish'],
  energy: ['sluggish', 'calm', '', 'lively', 'restless'],
};
export const traitBand = (v) => (v < 22 ? 0 : v < 42 ? 1 : v < 60 ? 2 : v < 80 ? 3 : 4);
export const traitWord = (trait, v) => WORDS[trait][traitBand(v)];
export function personalityWords(traits) {
  return TRAITS.map((t) => traitWord(t, traits[t])).filter(Boolean);
}

export function moodLabel(m) {
  if (m > 0.5) return { emoji: '😄', label: 'delighted' };
  if (m > 0.15) return { emoji: '🙂', label: 'happy' };
  if (m > -0.15) return { emoji: '😐', label: 'calm' };
  if (m > -0.5) return { emoji: '😕', label: 'upset' };
  return { emoji: '😠', label: 'angry' };
}

export function friendshipLabel(a) {
  if (a >= 70) return 'best friends';
  if (a >= 40) return 'good friends';
  if (a >= 15) return 'friendly';
  if (a > -15) return 'acquaintances';
  if (a > -45) return 'on bad terms';
  return 'can’t stand you';
}

// Friendship hearts (0-5) from affinity. 3 ♥: a letter and a gift, 4 ♥: a friend's
// discount, 5 ♥: best friends, and you can ask them out (three dates: sweethearts).
export const heartsOf = (a) => (a >= 90 ? 5 : a >= 80 ? 4 : a >= 60 ? 3 : a >= 40 ? 2 : a >= 20 ? 1 : 0);
export const HEART_GIFTS = {
  rosa: { 3: { items: { honeycake: 3 }, text: 'You’re one of my favourite customers, so here are some of my honey cakes. Don’t tell the others!' }, 4: { text: 'From now on I’ll pay you a little extra for your produce and give you a friend’s price. Family looks after family.' } },
  otto: { 3: { items: { chest: 1 }, text: 'Made you a chest. Solid oak. Don’t put it in the damp. ...I mean it.' }, 4: { text: 'Friends get my good prices. Don’t spread it around.' } },
  juniper: { 3: { items: { bigcan: 1 }, text: 'Your crops deserve better than that little can. Have my old big one, it waters three rows at once!' }, 4: { text: 'Friends get the tools at cost. Well, nearly at cost.' } },
  mabel: { 3: { coins: 150, text: 'A small grant from the village beautification fund, for being such an upstanding citizen. All above board, I assure you.' }, 4: { text: 'I’ve noted in the records that City Hall lends to you interest-free from now on.' } },
};
