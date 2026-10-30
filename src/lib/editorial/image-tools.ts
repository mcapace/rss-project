/** Client-side image helpers: crop geometry, aspect presets, focal points and palette extraction. */

export type CropRect = { x: number; y: number; w: number; h: number };
export type FocalPoint = { x: number; y: number };

export const ASPECT_PRESETS: { id: string; label: string; ratio: number | null; hint: string }[] = [
  { id: "free", label: "Free", ratio: null, hint: "Any shape" },
  { id: "16:9", label: "16:9", ratio: 16 / 9, hint: "Article hero, video" },
  { id: "3:2", label: "3:2", ratio: 3 / 2, hint: "Story card" },
  { id: "4:3", label: "4:3", ratio: 4 / 3, hint: "Inline image" },
  { id: "1:1", label: "1:1", ratio: 1, hint: "Social, thumbnails" },
  { id: "4:5", label: "4:5", ratio: 4 / 5, hint: "Portrait social" },
  { id: "2:3", label: "2:3", ratio: 2 / 3, hint: "Portrait card" },
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The largest crop of a given aspect that fits inside an image, centered on a focal point. Everything is normalized 0..1. */
export function fitCrop(imageAspect: number, targetRatio: number | null, focal: FocalPoint = { x: 0.5, y: 0.5 }): CropRect {
  if (!targetRatio) return { x: 0, y: 0, w: 1, h: 1 };
  // Work in image pixels with height 1 and width = imageAspect.
  let w: number, h: number;
  if (targetRatio >= imageAspect) { w = 1; h = (imageAspect / targetRatio); }
  else { h = 1; w = targetRatio / imageAspect; }
  const x = clamp01(focal.x - w / 2), y = clamp01(focal.y - h / 2);
  return { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
}

/** Keep a crop inside the image and, when a ratio is set, on that ratio. */
export function normalizeCrop(crop: CropRect, imageAspect: number, targetRatio: number | null): CropRect {
  let { x, y, w, h } = crop;
  w = clamp01(w); h = clamp01(h);
  if (targetRatio) {
    // Width in image-normalized units that gives the ratio for the current height.
    const wForH = h * (targetRatio / imageAspect);
    if (wForH <= 1) w = wForH; else { w = 1; h = w * (imageAspect / targetRatio); }
  }
  x = Math.min(clamp01(x), 1 - w); y = Math.min(clamp01(y), 1 - h);
  return { x, y, w: Math.max(0.05, w), h: Math.max(0.05, h) };
}

export function cropToPixels(crop: CropRect, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  return { sx: Math.round(crop.x * width), sy: Math.round(crop.y * height), sw: Math.max(1, Math.round(crop.w * width)), sh: Math.max(1, Math.round(crop.h * height)) };
}

/** CSS for showing a crop of an image inside a fixed box without re-encoding it. */
export function cropStyle(crop: CropRect | null | undefined): { objectFit: "cover"; objectPosition: string; transform?: string; transformOrigin?: string } {
  if (!crop || (crop.w >= 0.999 && crop.h >= 0.999)) return { objectFit: "cover", objectPosition: "50% 50%" };
  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
  const scale = 1 / Math.max(crop.w, crop.h);
  return { objectFit: "cover", objectPosition: `${(cx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`, transform: `scale(${scale.toFixed(3)})`, transformOrigin: `${(cx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%` };
}

/* Palette ----------------------------------------------------------- */

const NAMED_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "black", rgb: [20, 20, 20] }, { name: "charcoal", rgb: [55, 55, 60] }, { name: "gray", rgb: [128, 128, 128] }, { name: "silver", rgb: [190, 190, 195] }, { name: "white", rgb: [245, 245, 245] },
  { name: "cream", rgb: [240, 228, 200] }, { name: "beige", rgb: [214, 196, 160] }, { name: "tan", rgb: [184, 148, 100] }, { name: "brown", rgb: [110, 72, 40] }, { name: "dark brown", rgb: [60, 38, 22] },
  { name: "amber", rgb: [200, 140, 50] }, { name: "gold", rgb: [205, 165, 70] }, { name: "yellow", rgb: [235, 205, 60] }, { name: "orange", rgb: [225, 120, 40] }, { name: "copper", rgb: [175, 100, 55] },
  { name: "red", rgb: [190, 40, 45] }, { name: "burgundy", rgb: [110, 25, 45] }, { name: "pink", rgb: [225, 140, 170] }, { name: "purple", rgb: [110, 60, 150] }, { name: "navy", rgb: [30, 45, 90] },
  { name: "blue", rgb: [55, 110, 190] }, { name: "sky blue", rgb: [120, 170, 225] }, { name: "teal", rgb: [30, 125, 115] }, { name: "green", rgb: [60, 120, 70] }, { name: "olive", rgb: [110, 105, 55] }, { name: "dark green", rgb: [30, 65, 45] },
];

export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

/** The closest plain color name, so a palette can be searched with words. */
export function colorName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  let best = NAMED_COLORS[0], bestDistance = Infinity;
  for (const candidate of NAMED_COLORS) {
    const distance = (rgb[0] - candidate.rgb[0]) ** 2 + (rgb[1] - candidate.rgb[1]) ** 2 * 1.3 + (rgb[2] - candidate.rgb[2]) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best.name;
}

/** Dominant colors from pixel data: quantize to a coarse grid, rank by count, drop near-duplicates. */
export function dominantColors(pixels: Uint8ClampedArray, count = 4): string[] {
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key);
    if (bucket) { bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++; } else buckets.set(key, { r, g, b, n: 1 });
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  const out: string[] = [];
  for (const bucket of ranked) {
    const hex = rgbToHex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n);
    const rgb = hexToRgb(hex)!;
    const distinct = out.every(existing => { const other = hexToRgb(existing)!; return Math.abs(rgb[0] - other[0]) + Math.abs(rgb[1] - other[1]) + Math.abs(rgb[2] - other[2]) > 60; });
    if (distinct) out.push(hex);
    if (out.length >= count) break;
  }
  return out;
}

/** Read an image into a small canvas and extract its palette. Fails (returns null) for cross-origin images without CORS. */
export async function extractPalette(src: string): Promise<{ palette: string[]; names: string[] } | null> {
  if (typeof document === "undefined") return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>(resolve => { image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = src; });
  if (!loaded) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 32, 32);
    const palette = dominantColors(context.getImageData(0, 0, 32, 32).data, 4);
    return { palette, names: [...new Set(palette.map(colorName).filter(Boolean))] };
  } catch {
    return null;
  }
}

/** Render a crop to a Blob for download. Returns null when the source is cross-origin and the canvas is tainted. */
export async function renderCrop(src: string, crop: CropRect, maxWidth = 2400): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = await new Promise<boolean>(resolve => { image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = src; });
  if (!loaded) return null;
  const { sx, sy, sw, sh } = cropToPixels(crop, image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, maxWidth / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  try {
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
  } catch {
    return null;
  }
}
