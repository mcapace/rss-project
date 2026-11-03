// Static JPG backups of every house ad bundle: the end frame (first line, poster, live widget)
// at the exact pixel size, saved as backup.jpg beside the bundle. Serve public/ first:
//   (cd public && python3 -m http.server 8765) & node scripts/house-ads/backups.cjs [campaign,...]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  const root = path.join(__dirname, '../../public/wa/house-ads');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const browser = await chromium.launch();
  for (const [id, c] of Object.entries(m.campaigns)) {
    if (only && !only.includes(id)) continue;
    for (const size of Object.keys(c.sizes)) {
      const [w, h] = size.split('x').map(Number);
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await page.goto(`http://localhost:8765/wa/house-ads/${id}/${size}/index.html?static=1`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const png = await page.screenshot();
      await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(root, id, size, 'backup.jpg'));
      await page.close();
    }
    console.log('  backups', id);
  }
  await browser.close();
})();
