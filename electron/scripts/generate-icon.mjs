/**
 * Builds a multi-resolution Windows .ico from the app emblem for NSIS / exe.
 * Source: public/images/logo-emblem.png → build/icon.ico
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const sourcePng = path.join(root, 'public', 'images', 'logo-emblem.png');
const outIco = path.join(root, 'build', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

if (!fs.existsSync(sourcePng)) {
  console.error(`[generate-icon] Missing source logo: ${sourcePng}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outIco), { recursive: true });

const buffers = [];
for (const size of sizes) {
  const buf = await sharp(sourcePng)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  buffers.push(buf);
}

const ico = await pngToIco(buffers);
fs.writeFileSync(outIco, ico);
console.log(`[generate-icon] Wrote ${outIco} (${ico.length} bytes, sizes ${sizes.join('/')})`);
