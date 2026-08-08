/**
 * Builds a multi-resolution Windows .ico from the app emblem for NSIS / exe.
 * Source: public/images/logo-emblem.png → build/icon.ico
 *
 * If sharp/png-to-ico are not installed but build/icon.ico already exists,
 * reuse it so installer builds are not blocked.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const sourcePng = path.join(root, 'public', 'images', 'logo-emblem.png');
const outIco = path.join(root, 'build', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

let sharp;
let pngToIco;
try {
  sharp = (await import('sharp')).default;
  pngToIco = (await import('png-to-ico')).default;
} catch (err) {
  if (fs.existsSync(outIco)) {
    console.log(
      `[generate-icon] Optional deps missing (${err.message}); reusing existing ${outIco}`,
    );
    process.exit(0);
  }
  console.error(
    '[generate-icon] Cannot generate icon: install sharp and png-to-ico, or place build/icon.ico first.',
  );
  process.exit(1);
}

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
