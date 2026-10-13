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
    home: { x: 55.5 * TILE, y: 48.7 * TILE }, wander: 1.4 * TILE,
    bio: 'You run Rosa’s Market in the town square. You buy villagers’ crops and sell gifts. You grew up in the village, know everyone, love a bit of gossip and cooking, and worry that the young folks work too hard.',
    base: { warmth: 72, cheer: 66, trust: 62, generosity: 58, energy: 70 },
    likes: ['bouquet', 'tea', 'berry'], dislikes: ['bookgift'],
    buys: ['turnip', 'carrot', 'berry', 'pumpkin', 'jam', 'juice', 'pie', 'bread', 'soup'],
    sells: ['bouquet', 'honeycake', 'tea', 'bookgift'],
  },
  otto: {
    name: 'Otto',
    humor: 'Bone-dry deadpan. Grumbles, understatement and sarcasm, grudging wood and carpentry puns he pretends not to enjoy, and the odd accidental sweetness he immediately denies.',
    role: 'Carpenter · Otto’s Furniture',
    icon: '🪑',
    look: { pet: -1, body: 0, skin: 7, hair: 6, shirt: 11, acc: 4, eyes: [58, 45, 45], hairColor: [58, 6, 68], pants: [8, 40, 30] },
    home: { x: 65.5 * TILE, y: 48.7 * TILE }, wander: 1.2 * TILE,
    bio: 'You are Otto, an old carpenter who builds fine furniture by hand. You are proud of your craft, blunt, a little grumpy, and secretly sentimental. You respect people who work hard and keep their word.',
    base: { warmth: 38, cheer: 40, trust: 45, generosity: 40, energy: 45 },
    likes: ['honeycake', 'bookgift'], dislikes: ['bouquet'],
    buys: [],
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
    buys: [], sells: [],
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
