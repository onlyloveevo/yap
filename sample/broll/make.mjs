// Builds the small B-roll library the app ships. Run from the app folder: node sample/broll/make.mjs
// Every clip is made here with the bundled ffmpeg: five are close crops of the room in sample/take1.mp4 (the same
// generated footage the sample take uses), one is drawn by ffmpeg itself. Nothing is downloaded.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const dir = path.dirname(new URL(import.meta.url).pathname);
const take = path.join(dir, '..', 'take1.mp4');
const run = (args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const out = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', '6'];
const push = "zoompan=z='1+0.0005*on':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=30";
const crop = (x, y, w = 360, h = 202) => `crop=${w}:${h}:${x}:${y},scale=2560:1440:flags=lanczos,${push},unsharp=5:5:0.6,setsar=1`;

const clips = [
  { file: 'plant-window', name: 'Plant by the window', tags: ['plant', 'window', 'green', 'nature', 'morning', 'calm'], args: ['-ss', '2', '-i', take, '-vf', crop(0, 120)] },
  { file: 'shelf-lamp', name: 'Shelf and lamp', tags: ['lamp', 'shelf', 'books', 'home', 'evening', 'cosy'], args: ['-ss', '2', '-i', take, '-vf', crop(760, 90)] },
  { file: 'coffee-desk', name: 'Coffee on the desk', tags: ['coffee', 'mug', 'desk', 'morning', 'work'], args: ['-ss', '2', '-i', take, '-vf', crop(880, 400)] },
  { file: 'warm-light', name: 'Warm light', tags: ['light', 'warm', 'glow', 'abstract', 'mood'], args: ['-f', 'lavfi', '-i', 'gradients=s=1280x720:c0=0x8a4a1c:c1=0xf2b75a:c2=0x7a3b12:c3=0x5a2e12:n=4:speed=0.02:d=6:r=30', '-vf', 'gblur=sigma=40,setsar=1'] },
  { file: 'shelf-plant', name: 'Plant on the shelf', tags: ['plant', 'shelf', 'green', 'home', 'calm'], args: ['-ss', '2', '-i', take, '-vf', crop(730, 0, 320, 180)] },
  { file: 'desk-books', name: 'Books on the desk', tags: ['books', 'desk', 'plant', 'work', 'reading'], args: ['-ss', '2', '-i', take, '-vf', crop(1000, 370, 280, 158)] },
];

const records = [];
for (const c of clips) {
  const mp4 = path.join(dir, `${c.file}.mp4`);
  run([...c.args, ...out, mp4]);
  run(['-ss', '3', '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', path.join(dir, `${c.file}.jpg`)]);
  const bytes = fs.readFileSync(mp4);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  records.push({ id: sha256.slice(0, 32), sha256, bytes: bytes.length, duration: 6, width: 1280, height: 720, container: 'mp4', name: c.name, tags: c.tags, file: `${c.file}.mp4`, poster: `${c.file}.jpg` });
}
fs.writeFileSync(path.join(dir, 'library.json'), `${JSON.stringify({ version: 1, clips: records }, null, 2)}\n`);
console.log(records.map((r) => `${r.file} ${r.bytes} bytes`).join('\n'));
