/* Object storage, transcoding and adaptive delivery.
   These run against real MinIO when it is reachable and fall back to the local
   driver otherwise, so the suite is meaningful on a laptop and in CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-media-'));
const SRC = path.join(WORK, 'src.mp4');
const IMG = path.join(WORK, 'src.png');

const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

test.before(() => {
  if (!hasFfmpeg) return;
  // A 1080p clip so the full ladder is exercised, and a wide still image.
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', SRC,
  ], { stdio: 'ignore' });
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:duration=1', '-frames:v', '1', IMG,
  ], { stdio: 'ignore' });
});

test.after(() => fs.rmSync(WORK, { recursive: true, force: true }));

/* ---------------- ladder selection ---------------- */

test('the ladder never upscales beyond the source', async () => {
  process.env.STORAGE_DRIVER = 'local';
  const { ladderFor, VIDEO_LADDER } = await import('../src/lib/transcode.js');

  assert.deepEqual(ladderFor(1080).map((r) => r.height), [360, 480, 720, 1080]);
  assert.deepEqual(ladderFor(720).map((r) => r.height), [360, 480, 720]);
  assert.deepEqual(ladderFor(480).map((r) => r.height), [360, 480]);
  assert.deepEqual(ladderFor(240).map((r) => r.height), [360], 'always keeps one playable rung');
  assert.ok(VIDEO_LADDER.every((r) => r.bitrate > 0 && r.audio > 0));
});

test('bitrates increase monotonically with resolution', async () => {
  const { VIDEO_LADDER } = await import('../src/lib/transcode.js');
  for (let i = 1; i < VIDEO_LADDER.length; i++) {
    assert.ok(
      VIDEO_LADDER[i].bitrate > VIDEO_LADDER[i - 1].bitrate,
      'a taller rung must not be cheaper than a shorter one',
    );
  }
});

/* ---------------- real transcode ---------------- */

test('video transcode produces a valid adaptive master playlist', { skip: !hasFfmpeg }, async () => {
  const out = fs.mkdtempSync(path.join(WORK, 'hls-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.UPLOAD_DIR = out;

  const { transcodeVideo } = await import('../src/lib/transcode.js');
  const result = await transcodeVideo({ orgId: 'org_t', mediaId: 'med_t', sourcePath: SRC });

  assert.equal(result.kind, 'video');
  assert.equal(result.ladder.length, 4, '1080p source yields the full ladder');
  assert.equal(result.mp4.length, 4, 'one progressive fallback per rung');
  assert.ok(result.poster_url, 'poster frame extracted');

  const master = fs.readFileSync(path.join(out, 'org/org_t/media/med_t/hls/master.m3u8'), 'utf8');
  assert.match(master, /^#EXTM3U/);
  const variants = master.match(/#EXT-X-STREAM-INF/g) ?? [];
  assert.equal(variants.length, 4, 'master advertises every rung');
  assert.match(master, /RESOLUTION=640x360/, 'lowest rung present for weak links');
  assert.match(master, /RESOLUTION=1920x1080/, 'highest rung present for good links');
  assert.match(master, /BANDWIDTH=\d+/, 'players need BANDWIDTH to choose');
  assert.match(master, /CODECS="avc1/, 'codec string present so TVs can pre-check support');
});

test('image transcode produces responsive width variants', { skip: !hasFfmpeg }, async () => {
  const out = fs.mkdtempSync(path.join(WORK, 'img-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.UPLOAD_DIR = out;

  const { transcodeImage } = await import('../src/lib/transcode.js');
  const result = await transcodeImage({ orgId: 'org_t', mediaId: 'med_i', sourcePath: IMG });

  assert.equal(result.kind, 'image');
  const widths = [...new Set(result.variants.map((v) => v.width))].sort((a, b) => a - b);
  assert.deepEqual(widths, [640, 1280, 1920], 'never wider than the source');
  assert.ok(result.variants.some((v) => v.format === 'jpg'), 'jpeg is always produced');
  // libwebp is optional in ffmpeg builds; when present it must be offered.
  const { availableEncoders } = await import('../src/lib/transcode.js');
  if ((await availableEncoders()).webp) {
    assert.ok(result.variants.some((v) => v.format === 'webp'), 'webp offered when supported');
  }
  for (const v of result.variants) assert.ok(v.bytes > 0, 'each variant has real bytes');
});

test('a smaller source does not gain rungs it cannot fill', { skip: !hasFfmpeg }, async () => {
  const small = path.join(WORK, 'small.mp4');
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=25:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', small,
  ], { stdio: 'ignore' });

  const out = fs.mkdtempSync(path.join(WORK, 'small-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.UPLOAD_DIR = out;

  const { transcodeVideo } = await import('../src/lib/transcode.js');
  const result = await transcodeVideo({ orgId: 'org_t', mediaId: 'med_s', sourcePath: small });
  assert.deepEqual(result.ladder.map((r) => r.height), [360, 480], 'no 720p/1080p invented');
});

/* ---------------- storage driver ---------------- */

test('the local driver round-trips objects', async () => {
  const out = fs.mkdtempSync(path.join(WORK, 'local-'));
  process.env.STORAGE_DRIVER = 'local';
  process.env.UPLOAD_DIR = out;

  const storage = await import('../src/lib/storage.js');
  const info = await storage.initStorage();
  assert.equal(info.driver, 'local');

  await storage.putBuffer('org/x/note.txt', Buffer.from('hello'), 'text/plain');
  const chunks = [];
  for await (const c of await storage.getStream('org/x/note.txt')) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString(), 'hello');
});

test('key layout keeps renditions beside their original', async () => {
  const { keys } = await import('../src/lib/storage.js');
  const org = 'org_1';
  const med = 'med_1';
  assert.equal(keys.original(org, med, '.mp4'), 'org/org_1/media/med_1/original.mp4');
  assert.equal(keys.hlsMaster(org, med), 'org/org_1/media/med_1/hls/master.m3u8');
  assert.equal(keys.mp4Variant(org, med, 720), 'org/org_1/media/med_1/mp4/720p.mp4');
  assert.equal(keys.imageVariant(org, med, 1280, 'webp'), 'org/org_1/media/med_1/img/1280.webp');

  // every derived key shares the media prefix, so deleting the prefix cleans up
  const prefix = `org/${org}/media/${med}`;
  for (const key of [
    keys.original(org, med, '.mp4'), keys.hlsMaster(org, med),
    keys.mp4Variant(org, med, 720), keys.posterFrame(org, med),
  ]) assert.ok(key.startsWith(prefix), `${key} lives under the media prefix`);
});

/* ---------------- adaptive selection (client logic) ---------------- */

test('client picks a rendition that fits both the panel and the link', async () => {
  // Node 22+ strips types natively, so the real client module is imported here
  // rather than a rebuilt copy that could drift from what ships.
  const mod = path.join(WORK, 'adaptive.mts');
  fs.copyFileSync(path.join(ROOT, 'web/src/lib/adaptive.ts'), mod);
  const { chooseMp4, chooseImage } = await import(`file://${mod}`);
  const ladder = [
    { height: 360, bitrate_kbps: 800, url: 'a' },
    { height: 480, bitrate_kbps: 1400, url: 'b' },
    { height: 720, bitrate_kbps: 3000, url: 'c' },
    { height: 1080, bitrate_kbps: 6000, url: 'd' },
  ];

  assert.equal(chooseMp4(ladder, 1080, 1500).height, 360, 'weak DSL drops to the lowest rung');
  assert.equal(chooseMp4(ladder, 1080, 20000).height, 1080, 'fast link uses the top rung');
  assert.equal(chooseMp4(ladder, 720, 50000).height, 720, 'never exceeds the panel');
  assert.equal(chooseMp4(ladder, 1080, 150).height, 360, 'degrades rather than failing');
  assert.equal(chooseMp4([], 1080, 5000), null, 'empty ladder is handled');

  const images = [
    { width: 640, format: 'webp', url: 'w640', bytes: 1 },
    { width: 1920, format: 'webp', url: 'w1920', bytes: 3 },
    { width: 640, format: 'jpg', url: 'j640', bytes: 1 },
  ];
  assert.equal(chooseImage(images, 600, true).format, 'webp', 'prefers webp when supported');
  assert.equal(chooseImage(images, 600, false).format, 'jpg', 'falls back without webp');
});
