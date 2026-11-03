// Runway stills and loops for the Whisky Advocate house ads.
// Reads scripts/house-ads/assets.json and writes <out>/<campaign>-<shape>.png and .mp4,
// plus <out>/manifest.json (prompts, task ids). Unchanged prompts are skipped.
//
//   RUNWAYML_API_SECRET=... node scripts/house-ads/runway.mjs --out <dir> [--only whiskyfest,notes] [--shape wide] [--force] [--dry-run]
//
// gen4_image makes the still in the frame's shape, gen4_turbo turns it into a 5 second loop.
// The key is read from the environment only and never written anywhere.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const out = opt('--out') ?? join(here, '../../.house-ads');
const only = opt('--only')?.split(',');
const onlyShape = opt('--shape')?.split(',');
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

const API = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';
const key = process.env.RUNWAYML_API_SECRET;
if (!key && !dryRun) throw new Error('RUNWAYML_API_SECRET is not set');

const spec = JSON.parse(readFileSync(join(here, 'assets.json'), 'utf8'));
mkdirSync(out, { recursive: true });
const manifestPath = join(out, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const items = [];
for (const [id, c] of Object.entries(spec.campaigns)) {
  if (only && !only.includes(id)) continue;
  for (const [shape, s] of Object.entries(spec.shapes)) {
    if (onlyShape && !onlyShape.includes(shape)) continue;
    const still = `${spec.style} ${c.scene} ${s.frame}`;
    const motion = `${c.motion} Slow, seamless, cinematic; no cuts, no text, no new objects.`;
    const hash = createHash('sha256').update(JSON.stringify([still, motion, s.still, s.video, c.reference?.file ?? ''])).digest('hex').slice(0, 12);
    const ref = c.reference ? { path: join(here, c.reference.file), tag: c.reference.tag } : null;
    items.push({ name: `${id}-${shape}`, still, motion, stillRatio: s.still, videoRatio: s.video, hash, ref });
  }
}
const todo = items.filter((i) => force || manifest[i.name]?.hash !== i.hash || !existsSync(join(out, `${i.name}.mp4`)));
console.log(`${items.length} in the plan, ${todo.length} to make${dryRun ? ' (dry run)' : ''}`);
if (dryRun) { todo.forEach((i) => console.log(' ', i.name, i.stillRatio, i.videoRatio)); process.exit(0); }

async function call(path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, 'X-Runway-Version': VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
}

async function run(path, body) {
  const { id } = await call(path, body);
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const t = await call(`/tasks/${id}`);
    if (t.status === 'SUCCEEDED') return { id, url: t.output[0] };
    if (t.status === 'FAILED' || t.status === 'CANCELLED') throw new Error(`task ${id} ${t.status}: ${t.failure ?? ''} ${t.failureCode ?? ''}`);
  }
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

async function make(item) {
  const stillPath = join(out, `${item.name}.png`);
  // A campaign can name a reference photograph (gen4_image referenceImages, called by its @tag in the prompt).
  const body = { model: 'gen4_image', promptText: item.still, ratio: item.stillRatio };
  if (item.ref) body.referenceImages = [{ uri: `data:image/png;base64,${readFileSync(item.ref.path).toString('base64')}`, tag: item.ref.tag }];
  const still = await run('/text_to_image', body);
  await download(still.url, stillPath);
  console.log('  still', item.name);
  const uri = `data:image/png;base64,${readFileSync(stillPath).toString('base64')}`;
  const loop = await run('/image_to_video', { model: 'gen4_turbo', promptImage: uri, promptText: item.motion, ratio: item.videoRatio, duration: 5 });
  await download(loop.url, join(out, `${item.name}.mp4`));
  console.log('  loop ', item.name);
  manifest[item.name] = { hash: item.hash, prompts: { still: item.still, motion: item.motion }, tasks: { still: still.id, loop: loop.id }, at: new Date().toISOString() };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// Four at a time keeps under Runway's concurrency limit.
const queue = [...todo];
const failures = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let item; (item = queue.shift()); ) {
    try { await make(item); } catch (e) { failures.push(item.name); console.error('  failed', item.name, e.message); }
  }
}));
if (failures.length) { console.error('failed:', failures.join(', ')); process.exit(1); }
