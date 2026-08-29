// SOT: adaptive-playback, network-quality, variant-selection
// WHAT:  picks the right media rendition for this screen's panel and connection.
// WHY:   a store on weak DSL must not stall on a 1080p asset; a 4K lobby panel
//        should not be fed 360p. The choice has to be made on the device.
// HOW:   combines the Network Information API (when present) with measured
//        throughput from the last segment, then caps by the panel's own height.
// WHERE: renditions are produced in src/lib/transcode.js

export interface Mp4Variant {
  height: number;
  bitrate_kbps: number;
  url: string;
}

export interface ImageVariant {
  width: number;
  format: string;
  url: string;
  bytes: number;
}

/** Rough downlink estimate in kbps. */
export function estimateDownlinkKbps(): number | null {
  if (typeof navigator === "undefined") return null;
  const conn = (navigator as Navigator & {
    connection?: { downlink?: number; effectiveType?: string; saveData?: boolean };
  }).connection;
  if (!conn) return null;
  if (conn.saveData) return 700;
  if (typeof conn.downlink === "number" && conn.downlink > 0) return conn.downlink * 1000;
  switch (conn.effectiveType) {
    case "slow-2g": return 100;
    case "2g": return 300;
    case "3g": return 1200;
    case "4g": return 8000;
    default: return null;
  }
}

/**
 * Choose an MP4 rendition for players without HLS (older Tizen/webOS builds).
 * Leaves ~35% headroom so a dip does not immediately stall playback.
 */
export function chooseMp4(variants: Mp4Variant[], panelHeight: number, downlinkKbps: number | null): Mp4Variant | null {
  if (!variants.length) return null;
  const byHeight = [...variants].sort((a, b) => a.height - b.height);

  const fitsPanel = byHeight.filter((v) => v.height <= panelHeight * 1.05);
  const candidates = fitsPanel.length ? fitsPanel : [byHeight[0]!];

  if (downlinkKbps === null) return candidates[candidates.length - 1]!;

  const budget = downlinkKbps * 0.65;
  const affordable = candidates.filter((v) => v.bitrate_kbps <= budget);
  return affordable.length ? affordable[affordable.length - 1]! : candidates[0]!;
}

/**
 * Pick an image variant: never fetch more pixels than the panel can show, and
 * prefer WebP when the browser advertises support.
 */
export function chooseImage(
  variants: ImageVariant[],
  panelWidth: number,
  supportsWebp: boolean,
): ImageVariant | null {
  if (!variants.length) return null;
  const format = supportsWebp && variants.some((v) => v.format === "webp") ? "webp" : "jpg";
  const sameFormat = variants.filter((v) => v.format === format).sort((a, b) => a.width - b.width);
  if (!sameFormat.length) return variants[0]!;

  const target = panelWidth * (typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  const big = sameFormat.find((v) => v.width >= target);
  return big ?? sameFormat[sameFormat.length - 1]!;
}

export function supportsWebp(): boolean {
  if (typeof document === "undefined") return true;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
}

/** Native HLS (Safari, most smart-TV browsers) avoids shipping a JS player. */
export function hasNativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

/** Start bitrate cap for hls.js, so the first segment is not the largest. */
export function startLevelBitrateCap(downlinkKbps: number | null): number {
  if (downlinkKbps === null) return 3_000_000;
  return Math.max(400_000, Math.round(downlinkKbps * 0.6 * 1000));
}
