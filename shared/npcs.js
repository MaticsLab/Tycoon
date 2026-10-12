// Village NPCs: who they are and what they trade. Their evolving minds (traits,
// memories, relationships) live on the server in worker/src/npc.js.
import { TILE } from './world.js';

export const TRAITS = ['warmth', 'cheer', 'trust', 'generosity', 'energy'];

export const NPCS = {
  rosa: {
    name: 'Rosa',
    role: 'Grocer · Rosa’s Market',
    icon: '🛒',
    look: { shirt: '#d35400', hair: '#7b3f1d', skin: '#e8b48a', apron: '#fdf2e0' },
    home: { x: 35.5 * TILE, y: 23.7 * TILE }, wander: 1.4 * TILE,
    bio: 'You run Rosa’s Market in the town square. You buy villagers’ crops and sell gifts. You grew up in the village, know everyone, love a bit of gossip and cooking, and worry that the young folks work too hard.',
    base: { warmth: 72, cheer: 66, trust: 62, generosity: 58, energy: 70 },
    likes: ['bouquet', 'tea', 'berry'], dislikes: ['bookgift'],
    buys: ['turnip', 'carrot', 'berry', 'pumpkin'],
    sells: ['bouquet', 'honeycake', 'tea', 'bookgift'],
  },
  otto: {
    name: 'Otto',
    role: 'Carpenter · Otto’s Furniture',
    icon: '🪑',
    look: { shirt: '#2c5d8a', hair: '#9aa0a6', skin: '#d9a679', beard: '#9aa0a6' },
    home: { x: 48.5 * TILE, y: 23.7 * TILE }, wander: 1.2 * TILE,
    bio: 'You are Otto, an old carpenter who builds fine furniture by hand. You are proud of your craft, blunt, a little grumpy, and secretly sentimental. You respect people who work hard and keep their word.',
    base: { warmth: 38, cheer: 40, trust: 45, generosity: 40, energy: 45 },
    likes: ['honeycake', 'bookgift'], dislikes: ['bouquet'],
    buys: [],
    sells: ['piano', 'fireplace', 'aquarium', 'grandclock', 'telescope', 'statue'],
  },
  juniper: {
    name: 'Juniper',
    role: 'Gardener · Village gossip',
    icon: '🌻',
    look: { shirt: '#27ae60', hair: '#f1c40f', skin: '#f2c79a', hat: '#e8c97a' },
    home: { x: 45 * TILE, y: 29.5 * TILE }, wander: 6 * TILE,
    bio: 'You are Juniper, the village gardener who tends the town square. You are dreamy, curious and talk to plants. You hear everything that happens in the village and love passing news along.',
    base: { warmth: 64, cheer: 74, trust: 70, generosity: 66, energy: 80 },
    likes: ['berry', 'pumpkin', 'tea'], dislikes: ['honeycake'],
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
