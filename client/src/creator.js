// Stardew-style character creator: dice, rotating preview, body choice, arrow pickers
// for skin / hair / shirt / accessory, HSV sliders for eyes, hair and pants, and the
// name, farm name and favourite thing fields.
import { SKINS, HAIR, SHIRTS, ACCESSORIES, PETS, hsvHex, sanitizeLook, randomLook } from '@shared/look.js';
import { drawPet } from './pets.js';
import { drawLook } from './people.js';

const $ = (id) => document.getElementById(id);
const COUNTS = { skin: SKINS.length, hair: HAIR.length, shirt: SHIRTS.length, acc: ACCESSORIES.length };
const NAMES = { hair: HAIR, shirt: SHIRTS, acc: ACCESSORIES };

// Pixel-art arrow (pointing left) and dice, painted once and used as CSS images.
function pixelArt(rows, palette, scale = 1) {
  const cv = document.createElement('canvas');
  cv.width = rows[0].length * scale; cv.height = rows.length * scale;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x * scale, y * scale, scale, scale); } }));
  return cv.toDataURL();
}
const ARROW = [
  '.....kk.....',
  '....kok.....',
  '...kooK.....',
  '..koookkkkk.',
  '.koooooooooK',
  'kooolllllloK',
  '.koooooooooK',
  '..koookKKKK.',
  '...kooK.....',
  '....kok.....',
  '.....kK.....',
];
const ARROW_PAL = { k: '#5b2b0a', K: '#3a1a06', o: '#e07a12', l: '#f7b44a' };
const DICE = [
  '.kkkkkkkkkkkk.',
  'kwwwwwwwwwwwwk',
  'kwkkwwwwwwkkwk',
  'kwkkwwwwwwkkwk',
  'kwwwwwwwwwwwwk',
  'kwwwwwkkwwwwwk',
  'kwwwwwkkwwwwwk',
  'kwwwwwwwwwwwwk',
  'kwkkwwwwwwkkwk',
  'kwkkwwwwwwkkwk',
  'kwwwwwwwwwwwwk',
  'kggggggggggggk',
  'kggggggggggggk',
  '.kkkkkkkkkkkk.',
];

const MALE = [
  '......kkkkk',
  '.......kook',
  '......kooo.',
  '..kkkkook.k',
  '.kooooook..',
  'kook..kook.',
  'kok....kok.',
  'kok....kok.',
  'kook..kook.',
  '.kooooook..',
  '..kkkkkk...',
];
const FEMALE = [
  '..kkkkkk..',
  '.kooooook.',
  'kook..kook',
  'kok....kok',
  'kok....kok',
  'kook..kook',
  '.kooooook.',
  '..kkookk..',
  '.kkkookkk.',
  '.koooooook',
  '.kkkookkk.',
  '....kok...',
  '....kkk...',
];

let state = null;  // { look, name, farm, fav, dir }
let handlers = null;
let built = false;

function build() {
  if (built) return;
  built = true;
  document.documentElement.style.setProperty('--sv-arrow', `url(${pixelArt(ARROW, ARROW_PAL, 1)})`);
  const dice = $('cr-dice').querySelector('canvas');
  const img = new Image();
  img.onload = () => { const g = dice.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0); };
  img.src = pixelArt(DICE, { k: '#4a4a52', w: '#f2f2f6', g: '#b8b8c4' });

  for (const b of document.querySelectorAll('#creator .sv-previewrow .sv-arrow')) {
    b.onclick = () => { state.dir = (state.dir + (+b.dataset.rot) + 4) % 4; render(); };
  }
  for (const b of document.querySelectorAll('#creator .sv-body button')) {
    const male = b.dataset.body === '0';
    b.textContent = '';
    b.style.backgroundImage = `url(${pixelArt(male ? MALE : FEMALE, { k: male ? '#7a3a06' : '#1d5e1d', o: male ? '#f2b21b' : '#3fbf3f' })})`;
    b.onclick = () => { state.look.body = +b.dataset.body; render(); };
  }
  for (const row of document.querySelectorAll('#creator .sv-pick')) {
    const key = row.dataset.key;
    for (const b of row.querySelectorAll('.sv-arrow')) {
      b.onclick = () => { state.look[key] = (state.look[key] + (+b.dataset.d) + COUNTS[key]) % COUNTS[key]; render(); };
    }
  }
  for (const box of document.querySelectorAll('#creator .sv-color')) {
    const key = box.dataset.key;
    const wrap = box.querySelector('.sv-sliders');
    for (let i = 0; i < 3; i++) {
      const line = document.createElement('label');
      line.className = 'sv-slider';
      line.innerHTML = `<input type="range" min="0" max="100" step="1" aria-label="${['Hue', 'Saturation', 'Brightness'][i]}"><output></output>`;
      const input = line.querySelector('input');
      input.oninput = () => { state.look[key][i] = +input.value; render(); };
      wrap.appendChild(line);
    }
  }
  // Animal preference: tap cat or dog; tap the chosen one again for another breed.
  for (const b of document.querySelectorAll('#creator .sv-petbtns button')) {
    b.onclick = () => {
      const kind = b.dataset.kind;
      const breeds = PETS.map((p, i) => [p, i]).filter(([p]) => p.kind === kind).map(([, i]) => i);
      const cur = state.look.pet;
      state.look.pet = PETS[cur]?.kind === kind ? breeds[(breeds.indexOf(cur) + 1) % breeds.length] : (state.lastPet?.[kind] ?? breeds[0]);
      (state.lastPet ||= {})[kind] = state.look.pet;
      render();
    };
  }
  $('cr-dice').onclick = () => { state.look = randomLook(); render(); };
  $('cr-ok').onclick = () => {
    const name = $('cr-name').value.trim();
    if (!name) { $('cr-err').textContent = 'Pick a name'; $('cr-name').focus(); return; }
    const out = { name, look: sanitizeLook(state.look), farm: $('cr-farm').value.trim(), fav: $('cr-fav').value.trim() };
    const h = handlers;
    closeCreator();
    h?.onDone?.(out);
  };
  $('cr-cancel').onclick = () => { const h = handlers; closeCreator(); h?.onCancel?.(); };
  for (const id of ['cr-name', 'cr-farm', 'cr-fav']) $(id).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('cr-ok').click(); });
}

function trackFor(key, i, hsv) {
  if (i === 0) return 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
  if (i === 1) return `linear-gradient(90deg,${hsvHex([hsv[0], 0, hsv[2]])},${hsvHex([hsv[0], 100, hsv[2]])})`;
  return `linear-gradient(90deg,#000,${hsvHex([hsv[0], hsv[1], 100])})`;
}

function render() {
  const l = state.look;
  drawLook($('cr-preview'), l, { dir: [0, 3, 1, 2][state.dir] });
  for (const b of document.querySelectorAll('#creator .sv-body button')) b.classList.toggle('sel', +b.dataset.body === l.body);
  for (const b of document.querySelectorAll('#creator .sv-petbtns button')) {
    const kind = b.dataset.kind;
    const mine = PETS[l.pet]?.kind === kind;
    const idx = mine ? l.pet : (state.lastPet?.[kind] ?? PETS.findIndex((p) => p.kind === kind));
    drawPet(b.querySelector('canvas'), idx, { sit: true });
    b.classList.toggle('sel', mine);
  }
  $('cr-petname').textContent = PETS[l.pet] ? PETS[l.pet].name : 'No pet';
  for (const row of document.querySelectorAll('#creator .sv-pick')) {
    const key = row.dataset.key;
    const span = row.querySelector('span');
    span.textContent = l[key] + 1;
    row.title = NAMES[key]?.[l[key]]?.name || '';
  }
  for (const box of document.querySelectorAll('#creator .sv-color')) {
    const key = box.dataset.key;
    box.querySelectorAll('.sv-slider').forEach((line, i) => {
      const input = line.querySelector('input');
      if (+input.value !== l[key][i]) input.value = l[key][i];
      input.style.setProperty('--track', trackFor(key, i, l[key]));
      line.querySelector('output').textContent = l[key][i];
    });
  }
}

// opts: { name, look, farm, fav, mode: 'new' | 'edit', onDone({ name, look, farm, fav }), onCancel() }
export function openCreator(opts) {
  build();
  handlers = opts;
  state = { look: sanitizeLook(opts.look || randomLook()), dir: 0 };
  $('cr-name').value = opts.name || '';
  $('cr-farm').value = opts.farm || '';
  $('cr-fav').value = opts.fav || '';
  $('cr-err').textContent = '';
  $('cr-ok').textContent = 'OK';
  $('creator').hidden = false;
  render();
  if (matchMedia('(pointer: fine)').matches && !opts.name) $('cr-name').focus();
}

export function closeCreator() {
  $('creator').hidden = true;
  handlers = null;
}

export const creatorOpen = () => !$('creator').hidden;
