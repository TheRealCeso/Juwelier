const assert = require('node:assert/strict');
const { analyzePixels } = require('./scan-quality.js');

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

const codes = result => result.issues.map(issue => issue.code);
const clear = image(800, 500, (x, y) => (x % 32 < 4 || y % 41 < 3) ? 35 : 206);
const clearResult = analyzePixels(clear, { documentFillsFrame: true });
assert.equal(clearResult.uncertain, false);
assert.ok(clearResult.scores.sharpness > 40);
assert.ok(clearResult.scores.resolution === 100);

const soft = image(800, 500, () => 180);
assert.ok(codes(analyzePixels(soft)).includes('blur'));
assert.ok(codes(analyzePixels(image(800, 500, () => 25))).includes('dark'));
assert.ok(codes(analyzePixels(image(800, 500, () => 255))).includes('overexposed'));
const reflected = image(800, 500, (x, y) => (x > 240 && x < 520 && y > 150 && y < 350) ? 255 : (x % 32 < 4 || y % 41 < 3) ? 35 : 206);
assert.ok(codes(analyzePixels(reflected)).includes('glare'));
assert.ok(codes(analyzePixels(image(300, 180, (x, y) => (x + y) % 2 ? 20 : 190))).includes('low-resolution'));

const cropped = image(800, 800, (x, y) => (x % 22 < 3 || y % 29 < 2) ? 35 : 205);
assert.ok(codes(analyzePixels(cropped, { documentFillsFrame: true })).includes('possible-crop'));
assert.ok(!codes(analyzePixels(cropped)).includes('possible-crop'), 'Ohne Bildfüllung ist das Seitenverhältnis kein verlässlicher Beschnittnachweis.');

assert.throws(() => analyzePixels({ width: 5, height: 5, data: [] }), TypeError);
console.log('Bildqualität: Schärfe, Licht, Blendung, Auflösung und möglicher Beschnitt geprüft.');
