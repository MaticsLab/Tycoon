import fs from 'node:fs';
import path from 'node:path';

export function loadWorld(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`Could not read ${file}, starting a fresh world:`, e.message);
    return {};
  }
}

// Write to a temp file then rename, so a crash mid-write never corrupts the save.
export function saveWorld(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
