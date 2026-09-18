// Regenerates every icon and social image from the mark in src/lib/logo.ts: `npm run icons` (Node 22.18+ runs the .ts
// import directly). Outputs are committed, so this only needs running after the logo changes.
import { writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp'; // ships with Next.js for image optimisation
import { logoGlyphSvg, logoSvg } from '../src/lib/logo.ts';

const png = (svg, size) => sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
const out = (path, data) => {
  writeFileSync(path, data);
  console.log('wrote', path);
};
mkdirSync('public/icons', { recursive: true });

// Browser tab: SVG for modern browsers, ICO (16/32/48) for the rest.
out('src/app/icon.svg', logoSvg());
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map((s) => png(logoSvg(), s)));
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(icoImages[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += icoImages[i].length;
});
out('src/app/favicon.ico', Buffer.concat([header, ...icoImages]));

// Home Screen and installed app. iOS and Android masks round the corners themselves, so those are full-bleed.
out('src/app/apple-icon.png', await png(logoSvg({ rounded: false }), 180));
out('public/icons/icon-192.png', await png(logoSvg(), 192));
out('public/icons/icon-512.png', await png(logoSvg(), 512));
out('public/icons/maskable-512.png', await png(logoSvg({ rounded: false, scale: 0.78 }), 512));

// Android notification badge: a white silhouette on transparent (the system tints it).
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${logoGlyphSvg({ wickOpacity: 1 })}</svg>`;
out('public/icons/badge-96.png', await png(badge, 96));

// Link previews (X, Telegram, Discord, iMessage).
const W = 1200;
const H = 630;
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="glow" cx="0.82" cy="0.18" r="0.75"><stop offset="0" stop-color="#10b981" stop-opacity=".28"/><stop offset=".45" stop-color="#3b82f6" stop-opacity=".12"/><stop offset="1" stop-color="#0f1115" stop-opacity="0"/></radialGradient>
<linearGradient id="text" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#10b981"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#0f1115"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<g font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif">
<text x="220" y="163" font-size="64" font-weight="800" fill="#f3f4f6">Nadobot</text>
<rect x="516" y="112" width="204" height="48" rx="24" fill="#ffffff" fill-opacity=".1"/>
<text x="618" y="144" font-size="24" font-weight="600" fill="#9ca3af" text-anchor="middle">Built on Nado</text>
<text x="96" y="330" font-size="76" font-weight="800" fill="#f3f4f6">Keep trading on Nado</text>
<text x="96" y="420" font-size="76" font-weight="800" fill="url(#text)">while you’re offline</text>
<text x="96" y="520" font-size="32" fill="#9ca3af">Protected trades, ladders and TWAP, signed by your own wallet.</text>
</g>
</svg>`;
const social = await sharp(Buffer.from(card))
  .composite([{ input: await png(logoSvg(), 104), left: 96, top: 84 }])
  .png({ compressionLevel: 9 })
  .toBuffer();
out('src/app/opengraph-image.png', social);
out('src/app/twitter-image.png', social);
