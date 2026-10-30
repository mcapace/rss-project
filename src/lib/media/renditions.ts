import "server-only";
import sharp, { type Sharp } from "sharp";
import type { CmsJsonObject } from "@/lib/cms/types";

export type RenditionFormat = "webp" | "avif" | "jpeg" | "png";
export type RenditionOptions = {
  /** Normalized crop (0..1) from the editor's cropper; omitted means the full frame. */
  crop?: { x: number; y: number; w: number; h: number } | null;
  /** Normalized focal point used when an aspect ratio asks for a cover crop. */
  focal?: { x: number; y: number } | null;
  /** Target aspect ratio (width / height) for a cover crop around the focal point. */
  aspect?: number | null;
  width?: number | null;
  format?: RenditionFormat;
  quality?: number;
};

export const RENDITION_WIDTHS = [480, 960, 1600] as const;
export const MAX_RENDITION_WIDTH = 2400;

export function parseAspect(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})[:x](\d{1,2})$/);
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function cropOf(item: CmsJsonObject, preset: string | null): RenditionOptions["crop"] {
  const crops = item.crops && typeof item.crops === "object" && !Array.isArray(item.crops) ? (item.crops as CmsJsonObject) : null;
  const crop = preset && crops ? crops[preset] : null;
  if (!crop || typeof crop !== "object" || Array.isArray(crop)) return null;
  const { x, y, w, h } = crop as Record<string, unknown>;
  if ([x, y, w, h].some(value => typeof value !== "number" || !Number.isFinite(value))) return null;
  return { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
}

export function focalOf(item: CmsJsonObject): RenditionOptions["focal"] {
  const focal = item.focal;
  if (!focal || typeof focal !== "object" || Array.isArray(focal)) return null;
  const { x, y } = focal as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Dimensions after EXIF auto-rotation: orientations 5 to 8 swap width and height, and crops are expressed in that frame. */
async function orientedSize(image: Sharp): Promise<{ width: number; height: number }> {
  const meta = await image.metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  return { width: (swap ? meta.height : meta.width) ?? 0, height: (swap ? meta.width : meta.height) ?? 0 };
}

/** Produce one rendition from an original: crop by stored geometry, else cover-crop around the focal point, then resize and encode. */
export async function renderRendition(source: Buffer | Uint8Array, options: RenditionOptions): Promise<{ body: Buffer; contentType: string; width: number; height: number }> {
  let image = sharp(source, { failOn: "none", limitInputPixels: 80_000_000 }).rotate();
  const { width: srcWidth, height: srcHeight } = await orientedSize(image);
  if (!srcWidth || !srcHeight) throw new Error("The image could not be read.");

  let region = { left: 0, top: 0, width: srcWidth, height: srcHeight };
  if (options.crop) {
    const c = options.crop;
    region = {
      left: Math.round(clamp(c.x, 0, 1) * srcWidth), top: Math.round(clamp(c.y, 0, 1) * srcHeight),
      width: Math.max(1, Math.round(clamp(c.w, 0, 1) * srcWidth)), height: Math.max(1, Math.round(clamp(c.h, 0, 1) * srcHeight)),
    };
  } else if (options.aspect) {
    const focal = options.focal ?? { x: 0.5, y: 0.5 };
    let width = srcWidth, height = Math.round(srcWidth / options.aspect);
    if (height > srcHeight) { height = srcHeight; width = Math.round(srcHeight * options.aspect); }
    const left = Math.round(clamp(focal.x * srcWidth - width / 2, 0, srcWidth - width));
    const top = Math.round(clamp(focal.y * srcHeight - height / 2, 0, srcHeight - height));
    region = { left, top, width, height };
  }
  region.width = Math.min(region.width, srcWidth - region.left);
  region.height = Math.min(region.height, srcHeight - region.top);
  if (region.left || region.top || region.width !== srcWidth || region.height !== srcHeight) image = image.extract(region);

  const width = options.width ? Math.min(MAX_RENDITION_WIDTH, Math.max(16, Math.round(options.width))) : null;
  if (width && width < region.width) image = image.resize({ width, withoutEnlargement: true });
  const format = options.format ?? "webp";
  const quality = options.quality ?? (format === "avif" ? 55 : 80);
  image = format === "avif" ? image.avif({ quality }) : format === "jpeg" ? image.jpeg({ quality, mozjpeg: true }) : format === "png" ? image.png() : image.webp({ quality });
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  return { body: data, contentType: `image/${format}`, width: info.width, height: info.height };
}

/** Where the eye lands, from sharp's attention strategy, as a normalized focal point of the input image. */
export async function detectFocalPoint(source: Buffer | Uint8Array): Promise<{ x: number; y: number }> {
  const image = sharp(source, { failOn: "none", limitInputPixels: 80_000_000 }).rotate();
  const { width, height } = await orientedSize(image);
  if (!width || !height) return { x: 0.5, y: 0.5 };
  // A square cover crop with the attention strategy reports the focal point it centred on, in input coordinates.
  const side = Math.min(width, height, 512);
  const { info } = await image.resize({ width: side, height: side, fit: "cover", position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
  if (typeof info.attentionX === "number" && typeof info.attentionY === "number") {
    return { x: clamp(info.attentionX / width, 0, 1), y: clamp(info.attentionY / height, 0, 1) };
  }
  return { x: 0.5, y: 0.5 };
}
