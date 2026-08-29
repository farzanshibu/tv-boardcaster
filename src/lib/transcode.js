// SOT: transcode-pipeline, hls-ladder, image-variants, media-renditions
// WHAT:  turns an uploaded original into network-adaptive renditions.
// WHY:   a 4K MP4 pushed to a store on weak DSL stalls the screen. Multi-bitrate HLS
//        lets the player drop to a lower rung instead of buffering, and responsive
//        images stop a 4MB PNG being fetched for a 720p panel.
// HOW:   ffmpeg builds an HLS ladder capped at the source height (never upscale) plus
//        progressive MP4 fallbacks for TVs without HLS. Everything lands in MinIO.
// WHERE: storage keys in src/lib/storage.js; playback logic in web/src/app/tv

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, now, uid } from './db.js';
import { keys, putDirectory, putFile, publicUrl } from './storage.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/** Bitrate ladder. Each rung is only produced if the source is at least that tall. */
export const VIDEO_LADDER = [
  { height: 360, bitrate: 800, audio: 96 },
  { height: 480, bitrate: 1400, audio: 128 },
  { height: 720, bitrate: 3000, audio: 128 },
  { height: 1080, bitrate: 6000, audio: 192 },
];

/** Image widths for responsive delivery. */
export const IMAGE_WIDTHS = [640, 1280, 1920, 3840];

const run = (bin, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += String(d); });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(stderr) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-400)}`)));
  });

export async function ffmpegAvailable() {
  try { await run(FFMPEG, ['-version']); return true; } catch { return false; }
}

/** Not every ffmpeg build ships libwebp; fall back to JPEG when it is missing. */
let encoderCache = null;
export async function availableEncoders() {
  if (encoderCache) return encoderCache;
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-encoders']);
      let buf = '';
      p.stdout.on('data', (d) => { buf += String(d); });
      p.on('error', reject);
      p.on('close', () => resolve(buf));
    });
    encoderCache = { webp: /\blibwebp\b|\bwebp\b/.test(out) };
  } catch {
    encoderCache = { webp: false };
  }
  return encoderCache;
}

/** Probe width/height/duration/bitrate of a source file. */
export async function probe(filePath) {
  const out = await new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ]);
    let json = '';
    p.stdout.on('data', (d) => { json += String(d); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(json) : reject(new Error('ffprobe failed'))));
  });
  const meta = JSON.parse(out);
  const video = (meta.streams || []).find((s) => s.codec_type === 'video');
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    duration: Math.round(Number(meta.format?.duration ?? 0)),
    bitrate: Number(meta.format?.bit_rate ?? 0),
    codec: video?.codec_name ?? null,
    hasAudio: (meta.streams || []).some((st) => st.codec_type === 'audio'),
  };
}

async function probeHasAudio(filePath) {
  try {
    const meta = await probe(filePath);
    return meta.hasAudio;
  } catch { return false; }
}

/** Rungs that make sense for this source: never upscale, always keep one. */
export function ladderFor(sourceHeight) {
  const usable = VIDEO_LADDER.filter((r) => r.height <= (sourceHeight || 1080));
  return usable.length ? usable : [VIDEO_LADDER[0]];
}

/**
 * Build an HLS ladder + MP4 fallbacks and upload them.
 * Returns the rendition manifest stored on the media row.
 */
export async function transcodeVideo({ orgId, mediaId, sourcePath }) {
  const info = await probe(sourcePath);
  const rungs = ladderFor(info.height);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `bc-hls-${mediaId}-`));

  try {
    // One ffmpeg pass emits every rung plus the master playlist.
    // Maps must be ordered v0,a0,v1,a1... so var_stream_map indices line up.
    const hasAudio = await probeHasAudio(sourcePath);
    const args = ['-y', '-i', sourcePath];
    const filters = rungs.map((rung, i) => `[0:v]scale=-2:${rung.height},format=yuv420p[v${i}]`);
    args.push('-filter_complex', filters.join(';'));

    const varStream = [];
    rungs.forEach((rung, i) => {
      args.push('-map', `[v${i}]`);
      if (hasAudio) args.push('-map', '0:a:0');
      varStream.push(hasAudio ? `v:${i},a:${i}` : `v:${i}`);
    });

    rungs.forEach((rung, i) => {
      args.push(
        `-c:v:${i}`, 'libx264', `-b:v:${i}`, `${rung.bitrate}k`,
        `-maxrate:v:${i}`, `${Math.round(rung.bitrate * 1.07)}k`,
        `-bufsize:v:${i}`, `${rung.bitrate * 2}k`,
      );
      if (hasAudio) args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, `${rung.audio}k`);
    });
    args.push(
      '-preset', 'veryfast', '-profile:v', 'main', '-sc_threshold', '0',
      '-g', '48', '-keyint_min', '48',
    );

    args.push(
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(work, 'v%v/segment%03d.ts'),
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', varStream.join(' '),
      path.join(work, 'v%v/playlist.m3u8'),
    );

    for (let i = 0; i < rungs.length; i++) fs.mkdirSync(path.join(work, `v${i}`), { recursive: true });
    await run(FFMPEG, args);

    const hlsPrefix = keys.hlsRoot(orgId, mediaId);
    await putDirectory(hlsPrefix, work);

    // Poster frame for the dashboard grid and for pre-roll on the TV.
    const posterPath = path.join(work, 'poster.jpg');
    await run(FFMPEG, ['-y', '-ss', '1', '-i', sourcePath, '-frames:v', '1', '-q:v', '3', posterPath]);
    const posterUrl = await putFile(keys.posterFrame(orgId, mediaId), posterPath, 'image/jpeg');

    // Progressive MP4 per rung: Tizen/webOS builds without HLS still get a match.
    const mp4 = [];
    for (const rung of rungs) {
      const out = path.join(work, `${rung.height}p.mp4`);
      await run(FFMPEG, [
        '-y', '-i', sourcePath,
        '-vf', `scale=-2:${rung.height},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${rung.bitrate}k`,
        '-c:a', 'aac', '-b:a', `${rung.audio}k`,
        '-movflags', '+faststart', out,
      ]);
      const url = await putFile(keys.mp4Variant(orgId, mediaId, rung.height), out, 'video/mp4');
      mp4.push({ height: rung.height, bitrate_kbps: rung.bitrate, url });
    }

    return {
      kind: 'video',
      source: info,
      hls_url: publicUrl(keys.hlsMaster(orgId, mediaId)),
      poster_url: posterUrl,
      mp4,
      ladder: rungs.map((r) => ({ height: r.height, bitrate_kbps: r.bitrate })),
      created_at: now(),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Downscaled WebP + JPEG variants so a 720p panel never pulls a 4K asset. */
export async function transcodeImage({ orgId, mediaId, sourcePath }) {
  const info = await probe(sourcePath).catch(() => ({ width: 0, height: 0 }));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `bc-img-${mediaId}-`));
  try {
    const widths = IMAGE_WIDTHS.filter((w) => w <= (info.width || 1920));
    if (!widths.length) widths.push(Math.min(info.width || 640, 640));

    const { webp } = await availableEncoders();
    const formats = webp ? ['webp', 'jpg'] : ['jpg'];

    const variants = [];
    for (const width of widths) {
      for (const format of formats) {
        const out = path.join(work, `${width}.${format}`);
        await run(FFMPEG, [
          '-y', '-i', sourcePath, '-vf', `scale=${width}:-2`,
          ...(format === 'webp' ? ['-quality', '82'] : ['-q:v', '4']),
          out,
        ]);
        const url = await putFile(
          keys.imageVariant(orgId, mediaId, width, format), out,
          format === 'webp' ? 'image/webp' : 'image/jpeg',
        );
        variants.push({ width, format, url, bytes: fs.statSync(out).size });
      }
    }
    return { kind: 'image', source: info, variants, created_at: now() };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/* ---------------- job queue ---------------- */

const queue = [];
let working = false;

/** Queue a transcode. Uploads return immediately; renditions land asynchronously. */
export function enqueueTranscode(job) {
  queue.push(job);
  void drain();
  return queue.length;
}

async function drain() {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      db.prepare("UPDATE media SET rendition_status='processing' WHERE id=?").run(job.mediaId);
      const result = job.type === 'video' ? await transcodeVideo(job) : await transcodeImage(job);
      db.prepare("UPDATE media SET renditions=?, rendition_status='ready' WHERE id=?")
        .run(JSON.stringify(result), job.mediaId);
      db.prepare('INSERT INTO notifications (id,org_id,kind,message,read,created_at) VALUES (?,?,?,?,0,?)')
        .run(uid('ntf'), job.orgId, 'media_ready', `"${job.name}" is ready for streaming`, now());
    } catch (err) {
      console.error('[transcode]', err.message);
      db.prepare("UPDATE media SET rendition_status='failed', rendition_error=? WHERE id=?")
        .run(String(err.message).slice(0, 500), job.mediaId);
    } finally {
      if (job.cleanup) fs.rmSync(job.sourcePath, { force: true });
    }
  }
  working = false;
}

export const queueDepth = () => queue.length;
