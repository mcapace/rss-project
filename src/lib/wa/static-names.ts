import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { WaStaticNames } from "./root-routing";

/**
 * The names of the Whisky Advocate static site's files, read from public/wa at build time (next.config.ts passes them
 * to the proxy through `env`, because the proxy cannot read the disk per request; the unit tests read them here too).
 *
 * top:    every top-level file and folder name in public/wa (site.css, index.html, img, fonts, house-ads, ...).
 * shared: for each public/wa folder whose name also exists in public/ (today: fonts), the file names inside the WA one,
 *         so /fonts/Aeonik-Regular.ttf is the site's while /fonts/inter.woff2 stays the CMS's.
 * No generated file is committed; public/wa/gen (scratch) and dotfiles are left out.
 */

const SKIP = new Set(["gen"]);

export function readWaStaticNames(root: string = process.cwd()): WaStaticNames {
  const wa = path.join(root, "public", "wa");
  if (!existsSync(wa)) return { top: [], shared: {} };
  const top = readdirSync(wa).filter(name => !name.startsWith(".") && !SKIP.has(name)).sort();
  const shared: Record<string, string[]> = {};
  for (const name of top) {
    const inWa = path.join(wa, name);
    if (!statSync(inWa).isDirectory() || !existsSync(path.join(root, "public", name))) continue;
    shared[name] = readdirSync(inWa).filter(file => !file.startsWith(".")).sort();
  }
  return { top, shared };
}
