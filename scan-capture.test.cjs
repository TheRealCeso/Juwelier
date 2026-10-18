const assert = require('node:assert/strict');
const { guideCrop, photoCrop, centeredDocumentCrop } = require('./scan-capture.js');

const landscape = guideCrop(1920, 1080,
  { left: 0, top: 0, width: 700, height: 500 },
  { left: 70, top: 80, width: 560, height: 340 }, 0);
assert.ok(Math.abs(landscape.x - 355.2) < 1);
assert.ok(Math.abs(landscape.y - 172.8) < 1);
assert.ok(Math.abs(landscape.width - 1209.6) < 1);
assert.ok(Math.abs(landscape.height - 734.4) < 1);

// Portraitvideo in einer Querformatvorschau: nur der tatsächlich sichtbare
// mittlere Streifen darf im gespeicherten Dokument landen.
const portrait = guideCrop(1080, 1920,
  { left: 100, top: 50, width: 700, height: 500 },
  { left: 160, top: 130, width: 580, height: 340 }, 0);
assert.ok(portrait.x >= 0 && portrait.y > 500);
assert.ok(portrait.x + portrait.width <= 1080);
assert.ok(portrait.y + portrait.height <= 1920);
assert.ok(Math.abs(portrait.width / portrait.height - 580 / 340) < .001);

const padded = guideCrop(1080, 1920,
  { left: 100, top: 50, width: 700, height: 500 },
  { left: 160, top: 130, width: 580, height: 340 });
assert.ok(padded.width > portrait.width && padded.height > portrait.height);
assert.throws(() => guideCrop(0, 100, {}, {}), TypeError);
const stillCrop = photoCrop(1920, 1080, 4000, 3000, landscape);
assert.ok(Math.abs(stillCrop.x - landscape.x * 4000 / 1920) < 1);
assert.ok(Math.abs(stillCrop.y - (375 + landscape.y * 4000 / 1920)) < 1);
assert.ok(Math.abs(stillCrop.width - landscape.width * 4000 / 1920) < 1);
assert.ok(Math.abs(stillCrop.height - landscape.height * 4000 / 1920) < 1);
assert.throws(() => photoCrop(1920, 1080, 4000, 3000, { x: 1900, y: 0, width: 100, height: 100 }), TypeError);
const centered = centeredDocumentCrop(4000, 3000);
assert.equal(centered.width, 3280);
assert.ok(Math.abs(centered.width / centered.height - 1.586) < .001);
assert.ok(centered.x > 0 && centered.y > 0);
assert.ok(centered.x + centered.width <= 4000 && centered.y + centered.height <= 3000);
assert.equal(centeredDocumentCrop(400, 300), null, 'Kleine Bilder werden nicht weiter beschnitten.');
assert.throws(() => centeredDocumentCrop(0, 300), TypeError);
console.log('Kamerarahmen stimmt in Quer- und Hochformat mit dem gespeicherten Ausschnitt überein.');
