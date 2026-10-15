// Browserseitige Aufnahmeprüfung. Die Werte sind Hinweise, kein Echtheitsnachweis.
(function (root) {
  const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

  function analyzePixels(imageData, options = {}) {
    const { width, height, data } = imageData || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || !data || data.length < width * height * 4) {
      throw new TypeError('Ein gültiges RGBA-Bild ist erforderlich.');
    }

    // Auch große Kamerabilder bleiben auf Mobilgeräten günstig auswertbar.
    const stride = Math.max(1, Math.ceil(Math.max(width / 720, height / 520)));
    const sampleWidth = Math.ceil(width / stride);
    const sampleHeight = Math.ceil(height / stride);
    const gray = new Uint8Array(sampleWidth * sampleHeight);
    let total = 0, dark = 0, pale = 0, clipped = 0;
    for (let y = 0; y < sampleHeight; y++) {
      for (let x = 0; x < sampleWidth; x++) {
        const source = (Math.min(height - 1, y * stride) * width + Math.min(width - 1, x * stride)) * 4;
        const luminance = Math.round(.2126 * data[source] + .7152 * data[source + 1] + .0722 * data[source + 2]);
        gray[y * sampleWidth + x] = luminance;
        total += luminance;
        if (luminance < 55) dark++;
        if (luminance > 235) pale++;
        if (luminance > 251) clipped++;
      }
    }

    const count = sampleWidth * sampleHeight;
    const mean = total / count;
    const darkFraction = dark / count;
    const paleFraction = pale / count;
    const clippedFraction = clipped / count;
    let laplacian = 0, localContrast = 0, eligible = 0;
    const bins = Array.from({ length: 12 * 8 }, () => ({ clipped: 0, count: 0 }));
    for (let y = 1; y < sampleHeight - 1; y++) {
      for (let x = 1; x < sampleWidth - 1; x++) {
        const index = y * sampleWidth + x;
        const center = gray[index];
        const left = gray[index - 1], right = gray[index + 1];
        const above = gray[index - sampleWidth], below = gray[index + sampleWidth];
        // Sehr helle/dunkle Flächen würden die Schärfeschätzung verzerren.
        if (center > 15 && center < 240) {
          laplacian += Math.abs(4 * center - left - right - above - below);
          localContrast += Math.abs(right - left) + Math.abs(below - above);
          eligible++;
        }
      }
    }
    for (let y = 0; y < sampleHeight; y++) {
      for (let x = 0; x < sampleWidth; x++) {
        const binX = Math.min(11, Math.floor(12 * x / sampleWidth));
        const binY = Math.min(7, Math.floor(8 * y / sampleHeight));
        const bin = bins[binY * 12 + binX];
        bin.count++;
        if (gray[y * sampleWidth + x] > 251) bin.clipped++;
      }
    }
    // Ein punktförmig ausgefressener Bereich ist verdächtiger als ein heller Kartengrund.
    const glareBins = bins.filter(bin => bin.count && bin.clipped / bin.count > .75).length;
    const glareCoverage = glareBins / bins.length;
    const detail = eligible ? laplacian / eligible : 0;
    const contrast = eligible ? localContrast / eligible : 0;
    const lowResolution = Math.min(width / 600, height / 375);

    // Ein Ausweis kann bildfüllend und trotzdem vollständig abgebildet sein.
    // Deshalb wird Beschnitt nur bei starker Formabweichung der bildfüllenden Karte vermutet.
    const ratio = width / height;
    const expectedRatio = options.expectedAspectRatio || 1.586;
    const ratioDeviation = Math.abs(ratio / expectedRatio - 1);
    const nearFullFrame = options.documentFillsFrame === true;
    const cropRisk = nearFullFrame ? clamp((ratioDeviation - .08) * 400) : null;

    const scores = {
      sharpness: clamp((detail - 2.2) * 9),
      exposure: clamp(100 - Math.max(0, 105 - mean) * .9 - Math.max(0, mean - 208) * 1.5 - Math.max(0, paleFraction - .52) * 95),
      glare: clamp(100 - Math.max(0, glareCoverage - .04) * 240 - Math.max(0, clippedFraction - .25) * 90),
      resolution: clamp(lowResolution * 100),
      crop: cropRisk == null ? null : 100 - cropRisk
    };
    const issues = [];
    if (width < 600 || height < 375) issues.push({ code: 'low-resolution', severity: 'warning', message: 'Das Bild ist klein. Für die Texterkennung möglichst näher und schärfer aufnehmen.' });
    if (detail < 4.2 && contrast < 32) issues.push({ code: 'blur', severity: 'warning', message: 'Das Bild wirkt unscharf. Bitte ruhig halten und neu aufnehmen.' });
    if (mean < 85 || darkFraction > .64) issues.push({ code: 'dark', severity: 'warning', message: 'Das Bild ist zu dunkel. Bitte bei gleichmäßigem Licht neu aufnehmen.' });
    if (mean > 225 && paleFraction > .62) issues.push({ code: 'overexposed', severity: 'warning', message: 'Das Bild ist sehr hell; Schrift kann überbelichtet sein. Bitte ohne direktes Licht neu aufnehmen.' });
    else if (glareCoverage > .06 && clippedFraction > .055) issues.push({ code: 'glare', severity: 'warning', message: 'Eine helle Spiegelung könnte Angaben verdecken. Bitte ohne Blitz neu aufnehmen.' });
    if (cropRisk != null && cropRisk > 35) issues.push({ code: 'possible-crop', severity: 'warning', message: 'Das Kartenformat wirkt beschnitten. Bitte alle vier Ränder im Bild prüfen.' });

    return {
      issues,
      scores,
      uncertain: issues.length > 0,
      metrics: {
        width, height, brightness: Math.round(mean), detail: Number(detail.toFixed(2)),
        contrast: Number(contrast.toFixed(2)), darkFraction: Number(darkFraction.toFixed(3)),
        paleFraction: Number(paleFraction.toFixed(3)), glareCoverage: Number(glareCoverage.toFixed(3)),
        clippedFraction: Number(clippedFraction.toFixed(3)), aspectRatio: Number(ratio.toFixed(3))
      }
    };
  }

  async function analyzeDataUrl(dataUrl, options = {}) {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      throw new Error('Für Bilddateien ist eine Browserumgebung erforderlich.');
    }
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 720 / width, 520 / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Bildanalyse ist in diesem Browser nicht verfügbar.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = analyzePixels(context.getImageData(0, 0, canvas.width, canvas.height), options);
    // Warnschwellen gelten für die Auflösung der Originalaufnahme.
    result.metrics.width = width;
    result.metrics.height = height;
    result.scores.resolution = clamp(Math.min(width / 600, height / 375) * 100);
    result.issues = result.issues.filter(issue => issue.code !== 'low-resolution');
    if (width < 600 || height < 375) result.issues.unshift({ code: 'low-resolution', severity: 'warning', message: 'Das Bild ist klein. Für die Texterkennung möglichst näher und schärfer aufnehmen.' });
    result.uncertain = result.issues.length > 0;
    return result;
  }

  const api = { analyzePixels, analyzeDataUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScanQuality = api;
})(typeof window === 'undefined' ? globalThis : window);
