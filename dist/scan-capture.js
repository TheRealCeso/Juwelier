// Rechnet den sichtbaren Kamerarahmen auf die tatsächlichen Videopixel zurück.
(function (root) {
  function guideCrop(videoWidth, videoHeight, stage, guide, padding = 0.025) {
    if (!(videoWidth > 0 && videoHeight > 0 && stage?.width > 0 && stage?.height > 0 && guide?.width > 0 && guide?.height > 0)) {
      throw new TypeError('Kamerabild und Rahmen müssen gültige Maße haben.');
    }
    // Das Video wird mit object-fit: cover dargestellt. Der abgeschnittene Teil
    // der Vorschau darf deshalb nicht mit dem gespeicherten Ausschnitt verwechselt werden.
    const scale = Math.max(stage.width / videoWidth, stage.height / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const offsetX = (stage.width - renderedWidth) / 2;
    const offsetY = (stage.height - renderedHeight) / 2;
    const margin = Math.min(guide.width, guide.height) * Math.max(0, padding);
    const left = guide.left - stage.left - margin;
    const top = guide.top - stage.top - margin;
    const right = guide.left + guide.width - stage.left + margin;
    const bottom = guide.top + guide.height - stage.top + margin;
    const x = Math.max(0, (left - offsetX) / scale);
    const y = Math.max(0, (top - offsetY) / scale);
    const x2 = Math.min(videoWidth, (right - offsetX) / scale);
    const y2 = Math.min(videoHeight, (bottom - offsetY) / scale);
    if (x2 <= x || y2 <= y) throw new RangeError('Kamerarahmen liegt außerhalb des Bildes.');
    return { x, y, width: x2 - x, height: y2 - y };
  }

  // Standbilder können ein anderes Seitenverhältnis als die Videovorschau haben.
  // Der Videobereich liegt dann mittig im größeren Sensorbild.
  function photoCrop(videoWidth, videoHeight, photoWidth, photoHeight, crop) {
    if (!(videoWidth > 0 && videoHeight > 0 && photoWidth > 0 && photoHeight > 0 &&
      crop?.width > 0 && crop?.height > 0 && crop.x >= 0 && crop.y >= 0 &&
      crop.x + crop.width <= videoWidth && crop.y + crop.height <= videoHeight)) {
      throw new TypeError('Kameraaufnahme und Ausschnitt müssen gültige Maße haben.');
    }
    const scale = Math.min(photoWidth / videoWidth, photoHeight / videoHeight);
    const offsetX = (photoWidth - videoWidth * scale) / 2;
    const offsetY = (photoHeight - videoHeight * scale) / 2;
    return {
      x: offsetX + crop.x * scale,
      y: offsetY + crop.y * scale,
      width: crop.width * scale,
      height: crop.height * scale
    };
  }

  // Zweiter OCR-Versuch für Fotos mit viel Hintergrund um einen mittigen Ausweis.
  // Die Originalaufnahme bleibt für Vorschau und PDF unverändert.
  function centeredDocumentCrop(width, height, fill = 0.82, aspectRatio = 1.586) {
    if (!(width > 0 && height > 0 && fill > 0 && fill < 1 && aspectRatio > 0)) {
      throw new TypeError('Bild und Kartenausschnitt müssen gültige Maße haben.');
    }
    const cropWidth = Math.min(width * fill, height * fill * aspectRatio);
    const cropHeight = cropWidth / aspectRatio;
    if (cropWidth < 600 || cropHeight < 375) return null;
    return {
      x: (width - cropWidth) / 2,
      y: (height - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight
    };
  }

  const api = { guideCrop, photoCrop, centeredDocumentCrop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScanCapture = api;
})(typeof window === 'undefined' ? globalThis : window);
