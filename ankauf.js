const byId = id => document.getElementById(id);
const slots = { front: null, back: null };
const scanConsent = byId('scan-consent');
const dataVerified = byId('data-verified');
const reviewAck = byId('review-ack');
const scanStatus = byId('scan-status');
const identityWarning = byId('identity-warning');
const reviewWarning = byId('review-warning');
const exportStatus = byId('export-status');
const cameraDialog = byId('camera-dialog');
const cameraVideo = byId('camera-video');
const cameraStage = byId('camera-stage');
const cameraReviewImage = byId('camera-review-image');
const cameraReviewStatus = byId('camera-review-status');
const cameraRetake = byId('camera-retake');
const signatureDialog = byId('signature-dialog');
const signatureCanvas = byId('signature-canvas');
const signatureContext = signatureCanvas.getContext('2d');
const archiveDialog = byId('archive-dialog');
const previewDialog = byId('pdf-preview-dialog');
let receiptNumber = BelegArchive.newNumber();
byId('receipt-number').textContent = receiptNumber;
let receiptIssued = false;
let cameraStream = null;
let cameraSide = null;
let pendingCameraImage = null;
let signatureDataUrl = null;
let signatureHasInk = false;
let drawing = false;
let busy = false;
let identityConflicts = [];
let approvalRevision = 0;
let verifiedRevision = null;
let signedRevision = null;
let previewUrl = null;
let previewDocument = null;
let previewRenderId = 0;
let archiveBusy = false;
const scanQuality = { front: null, back: null };
let mrzStatus = null;
let ocrFieldReview = [];
let manualReviewRequired = false;

const reviewFieldLabels = {
  first: 'Vorname', last: 'Nachname', birth: 'Geburtsdatum',
  number: 'Dokumentnummer', expiry: 'Gültigkeitsdatum'
};

const sellerFields = {
  first: byId('seller-first'), last: byId('seller-last'), birth: byId('seller-birth'),
  birthplace: byId('seller-birthplace'), street: byId('seller-street'),
  postal: byId('seller-postal'), city: byId('seller-city'),
  nationality: byId('seller-nationality'), number: byId('seller-id-number'),
  expiry: byId('seller-expiry')
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function displayDate(isoDate) {
  const parts = String(isoDate).split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : isoDate;
}

function numberValue(value) {
  return Number.parseFloat(String(value).replace(',', '.'));
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validGermanDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  return Boolean(match && validIsoDate(`${match[3]}-${match[2]}-${match[1]}`));
}

function euro(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function grams(value) {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} g`;
}

function setBusy(value) {
  busy = value;
  byId('recognize-button').disabled = value;
  byId('export-button').disabled = value || identityConflicts.length > 0;
  byId('preview-button').disabled = value || identityConflicts.length > 0;
  byId('archive-save-button').disabled = value || identityConflicts.length > 0;
  document.querySelectorAll('.scan-action input, [data-camera]').forEach(control => { control.disabled = !scanConsent.checked || value; });
}

function invalidateApproval() {
  const wasApproved = dataVerified.checked || Boolean(signatureDataUrl);
  if (receiptIssued) {
    receiptNumber = BelegArchive.newNumber();
    byId('receipt-number').textContent = receiptNumber;
    receiptIssued = false;
  }
  approvalRevision++;
  verifiedRevision = null;
  signedRevision = null;
  dataVerified.checked = false;
  reviewAck.checked = false;
  signatureDataUrl = null;
  if (signatureHasInk || signatureDialog.open) clearSignature();
  if (signatureDialog.open) signatureDialog.close();
  const preview = byId('signature-preview');
  const placeholder = document.createElement('span');
  placeholder.textContent = 'Noch keine Unterschrift';
  preview.replaceChildren(placeholder);
  if (wasApproved) exportStatus.textContent = 'Angaben geändert. Bitte erneut prüfen und unterschreiben.';
}

function updateCaptureAvailability() {
  const allowed = scanConsent.checked;
  document.querySelectorAll('.scan-action input, [data-camera]').forEach(control => { control.disabled = !allowed || busy; });
  if (busy) return;
  if (!allowed) scanStatus.textContent = 'Bitte erst die Zustimmung bestätigen und beide Seiten erfassen.';
  else if (!slots.front || !slots.back) scanStatus.textContent = 'Vorder- und Rückseite erfassen.';
  else scanStatus.textContent = 'Beide Seiten sind bereit. Angaben können erkannt werden.';
}

scanConsent.addEventListener('change', () => { invalidateApproval(); updateCaptureAvailability(); });
dataVerified.addEventListener('change', () => { verifiedRevision = dataVerified.checked ? approvalRevision : null; });
reviewAck.addEventListener('change', () => { if (!reviewAck.checked) invalidateApproval(); });
byId('document-type').addEventListener('change', invalidateApproval);
Object.values(sellerFields).forEach(field => {
  const changed = () => {
    field.dataset.userEdited = 'true';
    field.dataset.ocrFilled = 'false';
    field.dataset.ocrConfidence = 'manual';
    invalidateApproval();
  };
  field.addEventListener('input', changed);
  field.addEventListener('change', changed);
});

function renderScanQuality() {
  const result = byId('scan-quality-result');
  const list = byId('scan-quality-list');
  list.replaceChildren();
  for (const side of ['front', 'back']) {
    const label = side === 'front' ? 'Vorderseite' : 'Rückseite';
    for (const issue of scanQuality[side]?.issues || []) {
      const item = document.createElement('li');
      item.textContent = `${label}: ${issue.message}`;
      list.append(item);
    }
  }
  result.hidden = list.children.length === 0;
}

function syncReviewGate() {
  const reasons = [];
  if (Object.values(scanQuality).some(result => result?.uncertain)) reasons.push('Mindestens eine Aufnahme hat einen Qualitätshinweis. Dokumentränder und lesbare Angaben am Original prüfen.');
  if (mrzStatus && mrzStatus.state !== 'valid') reasons.push(`Maschinenlesbare Zone: ${mrzStatus.message} Angaben manuell mit dem Original abgleichen.`);
  if (ocrFieldReview.length) reasons.push(`Unsichere oder fehlende Erkennung: ${ocrFieldReview.map(key => reviewFieldLabels[key]).join(', ')}. Diese Felder prüfen und bei Bedarf ergänzen.`);
  manualReviewRequired = reasons.length > 0;
  reviewWarning.hidden = !manualReviewRequired;
  reviewWarning.textContent = reasons.join(' ');
  byId('review-ack-wrap').hidden = !manualReviewRequired;
  if (!manualReviewRequired) reviewAck.checked = false;
}

async function analyzeSlotQuality(side, slot, source) {
  if (!window.ScanQuality?.analyzeDataUrl) {
    scanQuality[side] = { uncertain: true, issues: [{ message: 'Automatische Qualitätsprüfung nicht verfügbar. Bitte die Lesbarkeit selbst prüfen.' }] };
    renderScanQuality();
    syncReviewGate();
    return;
  }
  try {
    const result = await ScanQuality.analyzeDataUrl(slot.dataUrl, { documentFillsFrame: source === 'camera' });
    if (slots[side] !== slot) return;
    if (source === 'camera' || source === 'native-camera') {
      result.issues.push({ code: 'camera-edges', severity: 'warning', message: 'Bitte alle vier Dokumentränder in der Vorschau prüfen; der Kamerarahmen kann Beschnitt nicht sicher erkennen.' });
      result.uncertain = true;
      if (result.metrics.width < 1000 || result.metrics.height < 620) {
        result.issues.push({ code: 'camera-resolution', severity: 'warning', message: 'Die Auflösung der Aufnahme ist gering. Für kleine Ausweisschrift bitte näher und schärfer fotografieren.' });
      }
    }
    scanQuality[side] = result;
    renderScanQuality();
    if (result.uncertain) invalidateApproval();
    syncReviewGate();
  } catch (error) {
    if (slots[side] !== slot) return;
    console.error('Bildqualität konnte nicht geprüft werden:', error);
    scanQuality[side] = { uncertain: true, issues: [{ message: 'Automatische Qualitätsprüfung nicht verfügbar. Bitte die Lesbarkeit selbst prüfen.' }] };
    renderScanQuality();
    invalidateApproval();
    syncReviewGate();
  }
}

function setSlot(side, dataUrl, filename = 'Aufnahme', embeddedText = '', source = 'upload') {
  invalidateApproval();
  slots[side] = { dataUrl, filename, embeddedText, source };
  scanQuality[side] = source === 'sample' ? { uncertain: false, issues: [] } : null;
  mrzStatus = null;
  ocrFieldReview = [];
  renderScanQuality();
  syncReviewGate();
  dataVerified.disabled = false;
  identityConflicts = [];
  identityWarning.hidden = true;
  identityWarning.textContent = '';
  setBusy(busy);
  byId('ocr-details').hidden = true;
  byId('ocr-raw').textContent = '';
  Object.values(sellerFields).forEach(field => {
    if (field.dataset.userEdited !== 'true') field.value = '';
    field.dataset.ocrFilled = 'false';
    field.dataset.ocrConfidence = field.dataset.userEdited === 'true' ? 'manual' : '';
  });
  const preview = byId(`${side}-preview`);
  preview.src = dataUrl;
  preview.hidden = false;
  byId(`${side}-placeholder`).hidden = true;
  byId(`${side}-state`).textContent = 'Erfasst';
  updateCaptureAvailability();
  if (source !== 'sample') void analyzeSlotQuality(side, slots[side], source);
}

async function loadImageSource(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, release: () => bitmap.close() };
    } catch { /* Einige Safari-Versionen können Dateien nur über <img> dekodieren. */ }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { source: image, release: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToBestJpeg(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 1);
  if (!dataUrl.startsWith('data:image/jpeg,')) throw new Error('Bild konnte nicht gespeichert werden.');
  return dataUrl;
}

async function imageFileToDataUrl(file) {
  const { source, release } = await loadImageSource(file);
  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('Bildformat kann nicht dekodiert werden.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Bildverarbeitung nicht verfügbar.');
    context.drawImage(source, 0, 0);
    return canvasToBestJpeg(canvas);
  } finally {
    release();
  }
}

let pdfJsPromise;
function getPdfJs() {
  pdfJsPromise ??= import('./assets/vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
    return pdfjs;
  });
  return pdfJsPromise;
}

async function pdfFileToImages(file) {
  const pdfjs = await getPdfJs();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;
  const images = [];
  const texts = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 2); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, 2100 / original.width, 1700 / original.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', .91));
      const textContent = await page.getTextContent();
      texts.push(textContent.items.map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join(''));
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  return { images, texts };
}

async function handleFile(side, file, source = 'upload') {
  if (!file) return;
  if (!scanConsent.checked) { scanStatus.textContent = 'Bitte erst die Zustimmung bestätigen.'; return; }
  if (file.size > 25 * 1024 * 1024) { scanStatus.textContent = 'Datei zu groß. Maximal 25 MB pro Datei.'; return; }
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = /^(image\/(png|jpeg|webp|heic|heif))$/i.test(file.type) || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);
  if (!isPdf && !isImage) { scanStatus.textContent = 'Bitte JPEG, PNG, WebP, HEIC/HEIF oder PDF wählen.'; return; }
  setBusy(true);
  scanStatus.textContent = `${file.name} wird vorbereitet …`;
  try {
    if (isPdf) {
      const { images, texts } = await pdfFileToImages(file);
      if (!images.length) throw new Error('Dieses PDF hat keine lesbare Seite.');
      setSlot(side, images[0], file.name, texts[0], 'pdf');
      if (side === 'front' && images[1] && !slots.back) setSlot('back', images[1], `${file.name} · Seite 2`, texts[1], 'pdf');
    } else {
      setSlot(side, await imageFileToDataUrl(file), file.name, '', source);
    }
    scanStatus.textContent = 'Datei geladen. Bitte die Vorschau kontrollieren.';
  } catch (error) {
    console.error('Dokument konnte nicht gelesen werden:', error);
    scanStatus.textContent = /heic|heif/i.test(`${file.type} ${file.name}`)
      ? 'HEIC/HEIF kann dieser Browser nicht lesen. Bitte die Kameraaufnahme oder ein JPEG/PNG verwenden.'
      : 'Die Datei konnte nicht gelesen werden. Bitte ein anderes Bild oder PDF wählen.';
  } finally {
    setBusy(false);
  }
}

for (const side of ['front', 'back']) {
  byId(`${side}-file`).addEventListener('change', event => {
    handleFile(side, event.target.files?.[0]);
    event.target.value = '';
  });
  byId(`${side}-capture-file`).addEventListener('change', event => {
    handleFile(side, event.target.files?.[0], 'native-camera');
    event.target.value = '';
  });
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  pendingCameraImage = null;
  cameraStage.classList.remove('reviewing');
  cameraReviewImage.removeAttribute('src');
  cameraReviewImage.hidden = true;
  cameraReviewStatus.hidden = true;
  cameraRetake.hidden = true;
  byId('camera-capture').textContent = 'Aufnehmen';
  if (cameraDialog.open) cameraDialog.close();
}

async function captureStillPhoto(track) {
  if (typeof ImageCapture !== 'function') return null;
  let camera;
  try { camera = new ImageCapture(track); }
  catch { return null; }
  const settings = {};
  try {
    const capabilities = await camera.getPhotoCapabilities();
    if (capabilities.imageWidth?.max > 0) settings.imageWidth = capabilities.imageWidth.max;
    if (capabilities.imageHeight?.max > 0) settings.imageHeight = capabilities.imageHeight.max;
    if (capabilities.fillLightMode?.includes('off')) settings.fillLightMode = 'off';
  } catch { /* Fotoaufnahme ohne zusätzliche Einstellungen versuchen. */ }
  try { return await camera.takePhoto(settings); }
  catch {
    try { return await camera.takePhoto(); }
    catch { return null; }
  }
}

function cameraFrameToDataUrl(source, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Kamerabild konnte nicht verarbeitet werden.');
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvasToBestJpeg(canvas), width: canvas.width, height: canvas.height };
}

async function openCamera(side) {
  if (!scanConsent.checked) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    scanStatus.textContent = 'Live-Kamera hier nicht verfügbar. Bitte „Foto aufnehmen“ oder eine Datei wählen.';
    return;
  }
  cameraSide = side;
  byId('camera-title').textContent = side === 'front' ? 'Vorderseite aufnehmen' : 'Rückseite aufnehmen';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
      audio: false
    });
    const track = cameraStream.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() || {};
    if (capabilities.width?.max && capabilities.height?.max) {
      try {
        await track.applyConstraints({
          width: { ideal: capabilities.width.max },
          height: { ideal: capabilities.height.max },
          aspectRatio: { ideal: 4 / 3 }
        });
      } catch { /* Die bereits gewählte Kameraauflösung bleibt nutzbar. */ }
    }
    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      try {
        await track.applyConstraints({ ...track.getConstraints(), advanced: [{ focusMode: 'continuous' }] });
      } catch { /* Die Kamera fokussiert mit ihren Standardeinstellungen. */ }
    }
    cameraVideo.srcObject = cameraStream;
    cameraDialog.showModal();
    await cameraVideo.play();
    const settings = cameraStream.getVideoTracks()[0]?.getSettings?.() || {};
    const cameraHint = byId('camera-help');
    cameraHint.textContent = settings.width && settings.width < 1280
      ? 'Die Kamera liefert wenig Auflösung. Für besser lesbare Schrift bitte „Foto aufnehmen“ verwenden oder nah an den Ausweis gehen.'
      : 'Alle vier Ränder innerhalb des Rahmens halten. Gleichmäßiges Licht ohne Spiegelung verwenden.';
  } catch {
    stopCamera();
    scanStatus.textContent = 'Kamerazugriff nicht möglich. Bitte „Foto aufnehmen“ oder eine Datei wählen.';
  }
}

document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => openCamera(button.dataset.camera)));
byId('camera-close').addEventListener('click', stopCamera);
byId('camera-cancel').addEventListener('click', stopCamera);
cameraDialog.addEventListener('cancel', event => { event.preventDefault(); stopCamera(); });
cameraRetake.addEventListener('click', () => {
  pendingCameraImage = null;
  cameraStage.classList.remove('reviewing');
  cameraReviewImage.removeAttribute('src');
  cameraReviewImage.hidden = true;
  cameraReviewStatus.hidden = true;
  cameraRetake.hidden = true;
  byId('camera-capture').textContent = 'Aufnehmen';
  byId('camera-help').textContent = 'Alle vier Ränder innerhalb des Rahmens halten. Gleichmäßiges Licht ohne Spiegelung verwenden.';
  void cameraVideo.play().catch(() => {
    byId('camera-help').textContent = 'Die Kameravorschau wurde angehalten. Bitte die Kamera schließen und erneut öffnen.';
  });
});
byId('camera-capture').addEventListener('click', async () => {
  if (pendingCameraImage) {
    const image = pendingCameraImage;
    setSlot(image.side, image.dataUrl, 'Kameraaufnahme', '', 'camera');
    stopCamera();
    scanStatus.textContent = `Aufnahme mit ${image.width} × ${image.height} Pixeln übernommen. Bitte die Lesbarkeit mit dem Original vergleichen.`;
    return;
  }
  const stream = cameraStream;
  const side = cameraSide;
  const width = cameraVideo.videoWidth;
  const height = cameraVideo.videoHeight;
  if (!stream || !width || !height) { scanStatus.textContent = 'Kamera ist noch nicht bereit.'; return; }
  const button = byId('camera-capture');
  button.disabled = true;
  let releasePhoto = null;
  try {
    const videoCrop = ScanCapture.guideCrop(width, height,
      cameraDialog.querySelector('.camera-stage').getBoundingClientRect(),
      cameraDialog.querySelector('.camera-guide').getBoundingClientRect());
    let source = cameraVideo;
    let crop = videoCrop;
    const stillPhoto = await captureStillPhoto(stream.getVideoTracks()[0]);
    if (cameraStream !== stream) return;
    if (stillPhoto) {
      try {
        const image = await loadImageSource(stillPhoto);
        if (cameraStream !== stream) { image.release(); return; }
        const photoWidth = image.source.width || image.source.naturalWidth;
        const photoHeight = image.source.height || image.source.naturalHeight;
        if ((photoWidth >= photoHeight) === (width >= height)) {
          releasePhoto = image.release;
          source = image.source;
          crop = ScanCapture.photoCrop(width, height, photoWidth, photoHeight, videoCrop);
        } else image.release();
      } catch (error) {
        console.warn('Standbild nicht nutzbar, Videobild wird verwendet:', error);
      }
    }
    let image;
    try { image = cameraFrameToDataUrl(source, crop); }
    catch (error) {
      if (source === cameraVideo) throw error;
      console.warn('Standbild zu groß oder nicht lesbar, Videobild wird verwendet:', error);
      image = cameraFrameToDataUrl(cameraVideo, videoCrop);
    }
    pendingCameraImage = { ...image, side };
    cameraReviewImage.src = image.dataUrl;
    cameraReviewImage.hidden = false;
    cameraStage.classList.add('reviewing');
    cameraRetake.hidden = false;
    button.textContent = 'Foto verwenden';
    byId('camera-help').textContent = 'Prüfen Sie jetzt alle vier Ränder und die kleine Schrift. Bei Unschärfe oder Spiegelung erneut aufnehmen.';
    cameraReviewStatus.hidden = false;
    cameraReviewStatus.textContent = 'Bildqualität wird geprüft …';
    try {
      const quality = await ScanQuality.analyzeDataUrl(image.dataUrl, { documentFillsFrame: true });
      if (cameraStream !== stream || pendingCameraImage?.dataUrl !== image.dataUrl) return;
      const issues = quality.issues.map(issue => issue.message);
      if (image.width < 1000 || image.height < 620) issues.unshift('Die Auflösung ist für kleine Ausweisschrift gering.');
      cameraReviewStatus.textContent = issues.length
        ? `${issues.slice(0, 2).join(' ')} Bitte neu aufnehmen oder nur nach Prüfung des Originals verwenden.`
        : `${image.width} × ${image.height} Pixel. Prüfen Sie Ränder und Schrift; danach „Foto verwenden“ wählen.`;
    } catch {
      if (cameraStream === stream) cameraReviewStatus.textContent = 'Automatische Bildprüfung nicht verfügbar. Bitte Ränder und Schrift selbst prüfen.';
    }
  } catch (error) {
    console.error('Kamerabild konnte nicht übernommen werden:', error);
    scanStatus.textContent = 'Aufnahme fehlgeschlagen. Bitte erneut versuchen oder „Foto aufnehmen“ nutzen.';
  } finally {
    releasePhoto?.();
    button.disabled = false;
  }
});
window.addEventListener('pagehide', stopCamera);

async function enhancedForOcr(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance = .299 * pixels.data[index] + .587 * pixels.data[index + 1] + .114 * pixels.data[index + 2];
    const value = Math.max(0, Math.min(255, (luminance - 128) * 1.35 + 128));
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

async function cropForOcr(dataUrl, region, zoom = 3, threshold = false) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const left = Math.round(image.naturalWidth * region[0]);
  const top = Math.round(image.naturalHeight * region[1]);
  const width = Math.round(image.naturalWidth * region[2]);
  const height = Math.round(image.naturalHeight * region[3]);
  const scale = Math.min(zoom, 2600 / width, 1800 / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: threshold });
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
  if (threshold) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance = .299 * pixels.data[index] + .587 * pixels.data[index + 1] + .114 * pixels.data[index + 2];
      const value = luminance < 157 ? 24 : 255;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas.toDataURL('image/png');
}

async function centeredDocumentForOcr(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const crop = ScanCapture.centeredDocumentCrop(image.naturalWidth, image.naturalHeight);
  if (!crop) return null;
  const scale = Math.min(1, 3200 / crop.width, 2400 / crop.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(crop.width * scale);
  canvas.height = Math.round(crop.height * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .96);
}

function recognitionScore(analysis) {
  const required = ['first', 'last', 'birth', 'number', 'expiry', 'street', 'postal', 'city'];
  const filled = required.filter(key => analysis.fields[key]).length;
  const corroborated = required.filter(key => analysis.fieldStatus[key]?.confidence === 'high').length;
  return (analysis.mrzStatus.state === 'valid' ? 30 : 0) + filled * 3 + corroborated * 2 - analysis.conflicts.length * 20;
}

function needsMoreRecognition(analysis) {
  const required = ['first', 'last', 'birth', 'number', 'expiry', 'street', 'postal', 'city'];
  return analysis.mrzStatus.state !== 'valid' || required.some(key => !analysis.fields[key]) ||
    ['first', 'last', 'birth', 'number', 'expiry'].some(key => analysis.fieldStatus[key]?.confidence !== 'high');
}

async function recognizeDocumentZones(worker, frontDataUrl, backDataUrl, documentType, analysis) {
  const psm = window.Tesseract.PSM || {};
  const zones = { front: '', back: '' };
  const read = async (dataUrl, region, zoom = 3, threshold = false) =>
    (await worker.recognize(await cropForOcr(dataUrl, region, zoom, threshold), { rotateAuto: true })).data.text;

  if (documentType === 'Personalausweis') {
    await worker.setParameters({ tessedit_pageseg_mode: psm.SINGLE_BLOCK || '6', tessedit_char_whitelist: '', preserve_interword_spaces: '1' });
    if (['first', 'last', 'birth', 'birthplace', 'expiry'].some(key => analysis.fieldStatus[key]?.confidence !== 'high')) {
      scanStatus.textContent = 'Vorderseite wird gezielt gelesen …';
      zones.front += `${await read(frontDataUrl, [.38, .14, .61, .74])}\n`;
    }
    if (['street', 'postal', 'city'].some(key => !analysis.fields[key])) {
      scanStatus.textContent = 'Anschrift wird gezielt gelesen …';
      zones.back += `${await read(backDataUrl, [.37, .01, .58, .34])}\n`;
    }
    if (analysis.fieldStatus.number?.confidence !== 'high') {
      await worker.setParameters({ tessedit_pageseg_mode: psm.SINGLE_LINE || '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
      const numberText = (await read(frontDataUrl, [.66, .02, .33, .15], 4)).toUpperCase();
      const number = numberText.match(/\b(?=[A-Z0-9]{9}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{9}\b/)?.[0];
      if (number) zones.front = `Dokumentnummer\n${number}\n${zones.front}`;
    }
  }

  if (analysis.mrzStatus.state !== 'valid') {
    scanStatus.textContent = 'Maschinenlesbare Zeilen werden geprüft …';
    await worker.setParameters({ tessedit_pageseg_mode: psm.SINGLE_BLOCK || '6', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<' });
    const mrzSide = documentType === 'Reisepass' ? 'front' : 'back';
    const dataUrl = mrzSide === 'front' ? frontDataUrl : backDataUrl;
    const region = documentType === 'Reisepass' ? [.015, .68, .97, .31] : [.015, .66, .97, .32];
    zones[mrzSide] += `\n${await read(dataUrl, region, 2.5)}`;
    const firstPass = IdParser.inspectMrz(zones[mrzSide]);
    if (firstPass.status.state !== 'valid') {
      zones[mrzSide] += `\n${await read(dataUrl, region, 2.5, true)}`;
    }
  }
  return zones;
}

byId('recognize-button').addEventListener('click', async () => {
  if (busy) return;
  if (!scanConsent.checked || !slots.front || !slots.back) { scanStatus.textContent = 'Zustimmung und beide Dokumentseiten sind erforderlich.'; return; }
  if (!window.Tesseract?.createWorker) { scanStatus.textContent = 'Texterkennung ist nicht verfügbar. Bitte Angaben manuell eintragen.'; return; }
  setBusy(true);
  scanStatus.textContent = 'Texterkennung wird vorbereitet …';
  const frontSlot = slots.front;
  const backSlot = slots.back;
  const documentType = byId('document-type').value;
  let worker;
  try {
    if (!window.IdParser?.extract) throw new Error('Parser nicht verfügbar');
    const base = new URL('./assets/vendor/tesseract/', document.baseURI);
    worker = await Tesseract.createWorker(['deu', 'eng'], 1, {
      workerPath: new URL('worker.min.js', base).href,
      corePath: new URL('core/', base).href,
      langPath: new URL('lang', base).href,
      gzip: false,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: message => {
        if (message.status === 'recognizing text') scanStatus.textContent = `Text wird erkannt: ${Math.round(message.progress * 100)} %`;
      }
    });
    let front = (await worker.recognize(frontSlot.dataUrl, { rotateAuto: true })).data.text;
    let back = (await worker.recognize(backSlot.dataUrl, { rotateAuto: true })).data.text;
    let frontOcrImage = frontSlot.dataUrl;
    let backOcrImage = backSlot.dataUrl;
    const parse = (a, b) => IdParser.analyze(`${a}\n${frontSlot.embeddedText || ''}`, `${b}\n${backSlot.embeddedText || ''}`);
    let analysis = parse(front, back);
    if (documentType === 'Personalausweis' && needsMoreRecognition(analysis)) {
      scanStatus.textContent = 'Ausweis im Foto wird gezielt gesucht …';
      for (const side of ['front', 'back']) {
        if (!needsMoreRecognition(analysis)) break;
        const slot = side === 'front' ? frontSlot : backSlot;
        if (slot.source === 'camera' || slot.source === 'sample' || slot.embeddedText.trim().length > 20) continue;
        try {
          const candidateImage = await centeredDocumentForOcr(slot.dataUrl);
          if (!candidateImage) continue;
          const candidateText = (await worker.recognize(candidateImage, { rotateAuto: true })).data.text;
          if (candidateText.trim().length < 8) continue;
          const candidateFront = side === 'front' ? `${candidateText}\n${front}` : front;
          const candidateBack = side === 'back' ? `${candidateText}\n${back}` : back;
          const candidateAnalysis = parse(candidateFront, candidateBack);
          if (recognitionScore(candidateAnalysis) > recognitionScore(analysis)) {
            front = candidateFront;
            back = candidateBack;
            analysis = candidateAnalysis;
            if (side === 'front') frontOcrImage = candidateImage;
            else backOcrImage = candidateImage;
          }
        } catch (error) {
          console.warn('Zusätzlicher Ausweis-Ausschnitt konnte nicht gelesen werden:', error);
        }
      }
    }
    if (needsMoreRecognition(analysis)) {
      const zones = await recognizeDocumentZones(worker, frontOcrImage, backOcrImage, documentType, analysis);
      const zonedFront = `${zones.front}\n${front}`;
      const zonedBack = `${zones.back}\n${back}`;
      const zoned = parse(zonedFront, zonedBack);
      if (recognitionScore(zoned) >= recognitionScore(analysis)) {
        front = zonedFront;
        back = zonedBack;
        analysis = zoned;
      }
    }
    if (analysis.mrzStatus.state !== 'valid' || ['first', 'last', 'birth', 'number', 'expiry', 'street', 'postal', 'city'].some(key => !analysis.fields[key])) {
      scanStatus.textContent = 'Schwierige Stellen werden mit verbessertem Kontrast gelesen …';
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM?.AUTO || '3', tessedit_char_whitelist: '', preserve_interword_spaces: '0' });
      const improveFront = ['first', 'last', 'birth', 'number', 'expiry'].some(key => !analysis.fields[key]);
      const improveBack = analysis.mrzStatus.state !== 'valid' || ['street', 'postal', 'city'].some(key => !analysis.fields[key]);
      const enhancedFront = improveFront ? (await worker.recognize(await enhancedForOcr(frontOcrImage), { rotateAuto: true })).data.text : '';
      const enhancedBack = improveBack ? (await worker.recognize(await enhancedForOcr(backOcrImage), { rotateAuto: true })).data.text : '';
      const enhanced = parse(`${front}\n${enhancedFront}`, `${back}\n${enhancedBack}`);
      if (recognitionScore(enhanced) > recognitionScore(analysis)) {
        front += `\n${enhancedFront}`;
        back += `\n${enhancedBack}`;
        analysis = enhanced;
      }
    }
    if (slots.front !== frontSlot || slots.back !== backSlot || byId('document-type').value !== documentType) {
      throw new Error('Dokument während der Erkennung geändert. Bitte die Erkennung erneut starten.');
    }
    invalidateApproval();
    identityConflicts = analysis.conflicts;
    identityWarning.hidden = identityConflicts.length === 0;
    identityWarning.textContent = identityConflicts.length
      ? `Vorder- und Rückseite passen nicht zusammen. Abweichend: ${identityConflicts.join(' und ')}. Bitte passende Dokumentseiten laden. Der PDF-Export ist gesperrt.`
      : '';
    dataVerified.disabled = identityConflicts.length > 0;
    mrzStatus = analysis.mrzStatus;
    ocrFieldReview = Object.keys(reviewFieldLabels).filter(key => analysis.fieldStatus[key]?.confidence !== 'high');
    let applied = 0;
    for (const [key, field] of Object.entries(sellerFields)) {
      field.dataset.ocrConfidence = field.dataset.userEdited === 'true' ? 'manual' : analysis.fieldStatus[key]?.confidence || 'missing';
      if (!analysis.fields[key] || field.dataset.userEdited === 'true') continue;
      field.value = analysis.fields[key];
      field.dataset.ocrFilled = 'true';
      applied++;
    }
    syncReviewGate();
    const raw = `VORDERSEITE\n${front}\n\nRÜCKSEITE\n${back}`;
    byId('ocr-raw').textContent = raw;
    byId('ocr-details').hidden = false;
    scanStatus.textContent = identityConflicts.length
      ? `${applied} Felder erkannt. Die Dokumentseiten weichen voneinander ab; bitte den Hinweis bei den Verkäuferangaben prüfen.`
      : `${applied} von 10 Feldern automatisch ausgefüllt. Gold markierte Felder und übrige Angaben mit dem Original prüfen.`;
  } catch (error) {
    console.error('Texterkennung fehlgeschlagen:', error);
    scanStatus.textContent = error.message?.includes('während der Erkennung')
      ? error.message
      : 'Texterkennung fehlgeschlagen. Sie können die Angaben manuell eintragen.';
  } finally {
    if (worker) await worker.terminate();
    setBusy(false);
  }
});

let openPurchaseDropdown = null;
let purchaseDropdownCount = 0;

function closePurchaseDropdown(returnFocus = false) {
  if (!openPurchaseDropdown) return;
  const { trigger, menu, wrapper } = openPurchaseDropdown;
  menu.hidden = true;
  wrapper.append(menu);
  trigger.setAttribute('aria-expanded', 'false');
  openPurchaseDropdown = null;
  if (returnFocus) trigger.focus();
}

function enhancePurchaseSelect(select) {
  const wrapper = document.createElement('div');
  wrapper.className = 'purchase-select';
  select.before(wrapper);
  wrapper.append(select);
  const label = select.id ? document.querySelector(`label[for="${select.id}"]`) : null;
  const labelText = label?.textContent.trim() || select.getAttribute('aria-label') || 'Auswahl';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'purchase-select-trigger';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const value = document.createElement('span');
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 12 12');
  chevron.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm2 4 4 4 4-4');
  chevron.append(path);
  trigger.append(value, chevron);
  wrapper.append(trigger);

  const menu = document.createElement('div');
  menu.className = 'purchase-select-menu';
  menu.id = `purchase-select-menu-${++purchaseDropdownCount}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', labelText);
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);
  const options = [...select.options].map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'purchase-select-option';
    button.setAttribute('role', 'menuitemradio');
    button.dataset.value = option.value;
    const text = document.createElement('span');
    text.textContent = option.textContent;
    const check = document.createElement('span');
    check.className = 'purchase-select-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    button.append(text, check);
    menu.append(button);
    button.addEventListener('click', () => {
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closePurchaseDropdown(true);
    });
    return button;
  });
  wrapper.append(menu);
  select.hidden = true;

  function sync() {
    value.textContent = select.selectedOptions[0]?.textContent || 'Bitte wählen';
    trigger.setAttribute('aria-label', `${labelText}: ${value.textContent}`);
    options.forEach(option => option.setAttribute('aria-checked', String(option.dataset.value === select.value)));
  }

  function open(focusLast = false) {
    closePurchaseDropdown();
    if (!wrapper.isConnected) return;
    sync();
    document.body.append(menu);
    menu.hidden = false;
    const bounds = trigger.getBoundingClientRect();
    const menuWidth = Math.min(window.innerWidth - 24, Math.max(bounds.width, select.classList.contains('item-metal') ? 220 : 0));
    menu.style.width = `${menuWidth}px`;
    const menuHeight = menu.getBoundingClientRect().height;
    const roomBelow = window.innerHeight - bounds.bottom;
    const top = roomBelow >= Math.min(menuHeight, 180) || roomBelow >= bounds.top
      ? Math.min(bounds.bottom + 6, window.innerHeight - menuHeight - 12)
      : Math.max(12, bounds.top - menuHeight - 6);
    menu.style.top = `${Math.max(12, top)}px`;
    menu.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - menuWidth - 12))}px`;
    trigger.setAttribute('aria-expanded', 'true');
    openPurchaseDropdown = { trigger, menu, wrapper };
    const selectedIndex = options.findIndex(option => option.dataset.value === select.value);
    options[focusLast ? options.length - 1 : Math.max(0, selectedIndex)]?.focus();
  }

  trigger.addEventListener('click', () => {
    if (openPurchaseDropdown?.trigger === trigger) closePurchaseDropdown(true);
    else open();
  });
  trigger.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp');
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePurchaseDropdown(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
    options[next]?.focus();
  });
  label?.addEventListener('click', event => { event.preventDefault(); open(); });
  select.addEventListener('change', sync);
  sync();
}

document.addEventListener('pointerdown', event => {
  if (openPurchaseDropdown && !openPurchaseDropdown.menu.contains(event.target) && !openPurchaseDropdown.trigger.contains(event.target)) closePurchaseDropdown();
});
document.addEventListener('focusin', event => {
  if (openPurchaseDropdown && !openPurchaseDropdown.menu.contains(event.target) && event.target !== openPurchaseDropdown.trigger) closePurchaseDropdown();
});
window.addEventListener('scroll', event => {
  if (openPurchaseDropdown && !openPurchaseDropdown.menu.contains(event.target)) closePurchaseDropdown();
}, true);
window.addEventListener('resize', () => closePurchaseDropdown());
enhancePurchaseSelect(byId('document-type'));

const metalOptions = ['Gold', 'Silber'];
function addItem(data = {}) {
  const body = byId('items-body');
  if (body.children.length >= 5) { exportStatus.textContent = 'In der Testversion sind bis zu fünf Positionen möglich.'; return; }
  const row = document.createElement('tr');
  row.innerHTML = `<td class="item-index"></td><td><select class="item-metal" aria-label="Edelmetallart">${metalOptions.map(option => `<option>${option}</option>`).join('')}</select></td><td><input class="item-grams" type="number" min="0.01" step="0.01" inputmode="decimal" aria-label="Gramm" /></td><td><input class="item-price" type="number" min="0.01" step="0.01" inputmode="decimal" aria-label="Preis in Euro" /></td><td><input class="item-date" type="date" aria-label="Datum" /></td><td><button type="button" class="item-remove" aria-label="Position entfernen">×</button></td>`;
  row.querySelector('.item-metal').value = data.metal || metalOptions[0];
  row.querySelector('.item-grams').value = data.grams ?? '';
  row.querySelector('.item-price').value = data.price ?? '';
  row.querySelector('.item-date').value = data.date || localDate();
  body.append(row);
  enhancePurchaseSelect(row.querySelector('.item-metal'));
  row.addEventListener('input', () => { invalidateApproval(); updateTotals(); });
  row.addEventListener('change', invalidateApproval);
  row.querySelector('.item-remove').addEventListener('click', () => {
    if (body.children.length === 1) return;
    invalidateApproval();
    row.remove();
    updateTotals();
  });
  invalidateApproval();
  updateTotals();
}

function getItems() {
  return [...byId('items-body').children].map((row, index) => ({
    number: index + 1,
    metal: row.querySelector('.item-metal').value,
    grams: numberValue(row.querySelector('.item-grams').value),
    price: numberValue(row.querySelector('.item-price').value),
    date: row.querySelector('.item-date').value
  }));
}

function updateTotals() {
  const rows = [...byId('items-body').children];
  rows.forEach((row, index) => { row.querySelector('.item-index').textContent = String(index + 1).padStart(2, '0'); });
  const items = getItems();
  byId('total-grams').textContent = grams(items.reduce((sum, item) => sum + (Number.isFinite(item.grams) ? item.grams : 0), 0));
  byId('total-price').textContent = euro(items.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0));
}

byId('add-item').addEventListener('click', () => addItem());
addItem();

function clearSignature() {
  signatureContext.fillStyle = '#ffffff';
  signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signatureContext.strokeStyle = '#24211c';
  signatureContext.lineWidth = 3.4;
  signatureContext.lineCap = 'round';
  signatureContext.lineJoin = 'round';
  signatureHasInk = false;
  byId('signature-status').textContent = '';
}

function signaturePoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * signatureCanvas.width / rect.width, y: (event.clientY - rect.top) * signatureCanvas.height / rect.height };
}

signatureCanvas.addEventListener('pointerdown', event => {
  drawing = true;
  signatureCanvas.setPointerCapture(event.pointerId);
  const point = signaturePoint(event);
  signatureContext.beginPath();
  signatureContext.moveTo(point.x, point.y);
  signatureContext.lineTo(point.x + .1, point.y + .1);
  signatureContext.stroke();
  signatureHasInk = true;
});
signatureCanvas.addEventListener('pointermove', event => {
  if (!drawing) return;
  const point = signaturePoint(event);
  signatureContext.lineTo(point.x, point.y);
  signatureContext.stroke();
});
function endSignature() { drawing = false; }
signatureCanvas.addEventListener('pointerup', endSignature);
signatureCanvas.addEventListener('pointercancel', endSignature);
byId('sign-button').addEventListener('click', () => { clearSignature(); signatureDialog.showModal(); });
byId('signature-clear').addEventListener('click', clearSignature);
byId('signature-close').addEventListener('click', () => signatureDialog.close());
byId('signature-save').addEventListener('click', () => {
  if (!signatureHasInk) { byId('signature-status').textContent = 'Bitte zuerst im Feld unterschreiben.'; return; }
  signatureDataUrl = signatureCanvas.toDataURL('image/png');
  signedRevision = approvalRevision;
  byId('signature-preview').innerHTML = '';
  const image = document.createElement('img');
  image.src = signatureDataUrl;
  image.alt = 'Erfasste Unterschrift';
  byId('signature-preview').append(image);
  exportStatus.textContent = 'Unterschrift erfasst. Der PDF-Beleg kann erstellt werden.';
  signatureDialog.close();
});
clearSignature();

function sampleDocument(side) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 760;
  const context = canvas.getContext('2d');
  context.fillStyle = side === 'front' ? '#e4ddd0' : '#d8d0c2';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#262421';
  context.font = 'bold 35px Arial';
  context.fillText('MUSTER · TESTDOKUMENT', 70, 90);
  context.font = '26px Arial';
  if (side === 'front') {
    context.fillText('Name / Surname', 70, 205);
    context.fillText('Mustermann', 70, 250);
    context.fillText('Vorname / Given name', 70, 325);
    context.fillText('Max', 70, 370);
    context.fillText('Geburtsdatum', 70, 445);
    context.fillText('01.01.1990', 70, 490);
    context.fillText('Ausweisnummer', 70, 565);
    context.fillText('TEST123456', 70, 610);
  } else {
    context.fillText('Anschrift', 70, 205);
    context.fillText('Musterstraße 1', 70, 250);
    context.fillText('86150 Augsburg', 70, 295);
    context.fillText('Gültig bis', 70, 390);
    context.fillText('01.01.2030', 70, 435);
    context.fillText('Staatsangehörigkeit', 70, 530);
    context.fillText('DEU', 70, 575);
  }
  context.save();
  context.translate(570, 400);
  context.rotate(-.4);
  context.fillStyle = 'rgba(120, 72, 42, .27)';
  context.font = 'bold 120px Arial';
  context.fillText('NUR TEST', -300, 0);
  context.restore();
  return canvas.toDataURL('image/jpeg', .9);
}

byId('sample-button').addEventListener('click', () => {
  setSlot('front', sampleDocument('front'), 'Muster Vorderseite', '', 'sample');
  setSlot('back', sampleDocument('back'), 'Muster Rückseite', '', 'sample');
  Object.entries({ first: 'Max', last: 'Mustermann', birth: '01.01.1990', birthplace: 'Augsburg', street: 'Musterstraße 1', postal: '86150', city: 'Augsburg', nationality: 'DEU', number: 'TEST123456', expiry: '01.01.2030' }).forEach(([key, value]) => {
    sellerFields[key].value = value;
    sellerFields[key].dataset.userEdited = 'false';
    sellerFields[key].dataset.ocrFilled = 'false';
    sellerFields[key].dataset.ocrConfidence = '';
  });
  invalidateApproval();
  byId('items-body').innerHTML = '';
  addItem({ metal: 'Gold', grams: '12.50', price: '650.00', date: localDate() });
  scanStatus.textContent = 'Beispieldaten geladen. Dokument prüfen und „Daten überprüft“ erst nach dem Abgleich bestätigen.';
  exportStatus.textContent = 'Bitte noch die Unterschrift erfassen.';
});

byId('logout-button').addEventListener('click', () => {
  sessionStorage.removeItem('juwelier-goek-demo');
  window.location.replace('login.html');
});

function collectAndValidate() {
  if (!scanConsent.checked || !slots.front || !slots.back) {
    byId('scan-title').scrollIntoView({ behavior: 'smooth' });
    throw new Error('Bitte Zustimmung bestätigen und beide Ausweisseiten erfassen.');
  }
  if (identityConflicts.length) {
    identityWarning.scrollIntoView({ behavior: 'smooth', block: 'center' });
    throw new Error('Die Dokumentseiten passen nicht zusammen. Bitte passende Vorder- und Rückseite laden.');
  }
  if (!scanQuality.front || !scanQuality.back) {
    byId('scan-quality-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
    throw new Error('Die Bildqualität wird noch geprüft. Bitte einen Moment warten.');
  }
  if (manualReviewRequired && !reviewAck.checked) {
    reviewAck.focus();
    throw new Error('Bitte Qualitätshinweise und unsichere Felder mit dem Original prüfen und „Unsichere Angaben manuell geprüft“ bestätigen.');
  }
  for (const key of ['first', 'last', 'birth', 'street', 'postal', 'city', 'number', 'expiry']) {
    if (sellerFields[key].value.trim()) continue;
    sellerFields[key].focus();
    throw new Error('Bitte die Pflichtfelder des Verkäufers vervollständigen.');
  }
  for (const key of ['birth', 'expiry']) {
    if (validGermanDate(sellerFields[key].value.trim())) continue;
    sellerFields[key].focus();
    throw new Error('Bitte Geburtsdatum und Gültigkeitsdatum im Format TT.MM.JJJJ prüfen.');
  }
  if (!dataVerified.checked || verifiedRevision !== approvalRevision) {
    dataVerified.focus();
    throw new Error('Bitte die Angaben mit dem Originaldokument vergleichen und „Daten überprüft“ bestätigen.');
  }
  const items = getItems();
  if (!items.length || items.some(item => !['Gold', 'Silber'].includes(item.metal) || !Number.isFinite(item.grams) || item.grams <= 0 || !Number.isFinite(item.price) || item.price <= 0 || !validIsoDate(item.date))) {
    byId('items-title').scrollIntoView({ behavior: 'smooth' });
    throw new Error('Bitte Edelmetall, Gramm, Preis und Datum für jede Position ausfüllen.');
  }
  if (!signatureDataUrl || signedRevision !== approvalRevision) {
    byId('sign-button').focus();
    throw new Error('Bitte die Unterschrift des Verkäufers erfassen.');
  }
  return { receiptNumber, seller: Object.fromEntries(Object.entries(sellerFields).map(([key, field]) => [key, field.value.trim()])), items, documentType: byId('document-type').value };
}

function fitText(font, text, maxWidth, size, minimum = 8) {
  const value = String(text || '—');
  let fittedSize = size;
  while (fittedSize > minimum && font.widthOfTextAtSize(value, fittedSize) > maxWidth) fittedSize -= .5;
  if (font.widthOfTextAtSize(value, fittedSize) <= maxWidth) return { value, size: fittedSize };
  let short = value;
  while (short.length > 1 && font.widthOfTextAtSize(`${short}…`, fittedSize) > maxWidth) short = short.slice(0, -1);
  return { value: `${short}…`, size: fittedSize };
}

function drawFitted(page, font, text, x, y, maxWidth, size, color) {
  const fitted = fitText(font, text, maxWidth, size);
  page.drawText(fitted.value, { x, y, size: fitted.size, font, color });
}

function drawCopyPage(page, font, image, heading, top, pdfLib) {
  const { rgb, degrees } = pdfLib;
  page.drawText(heading, { x: 48, y: top, size: 12, font, color: rgb(.23, .22, .20) });
  const box = { x: 48, y: top - 318, width: 499, height: 300 };
  page.drawRectangle({ ...box, borderColor: rgb(.78, .75, .70), borderWidth: 1 });
  const dims = image.scaleToFit(box.width - 20, box.height - 20);
  page.drawImage(image, { x: box.x + (box.width - dims.width) / 2, y: box.y + (box.height - dims.height) / 2, width: dims.width, height: dims.height });
  page.drawText('KOPIE · TESTVERSION', { x: 115, y: box.y + 118, size: 36, font, color: rgb(.61, .45, .27), rotate: degrees(20), opacity: .42 });
}

async function createReceiptPdf(data) {
  if (!window.PDFLib || !window.fontkit) throw new Error('PDF-Bibliothek ist nicht verfügbar.');
  const lib = window.PDFLib;
  const { PDFDocument, rgb } = lib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  const fontResponse = await fetch('assets/vendor/pdf-lib/NotoSans-Regular.ttf');
  if (!fontResponse.ok) throw new Error('PDF-Schrift konnte nicht geladen werden.');
  const font = await pdf.embedFont(await fontResponse.arrayBuffer(), { subset: true });
  pdf.setTitle('Ankaufbeleg · Testversion');
  pdf.setAuthor('Juwelier Gök · Testbereich');
  pdf.setSubject(`Testbeleg für Edelmetallankauf · ${data.receiptNumber}`);
  const page = pdf.addPage([595.28, 841.89]);
  const ink = rgb(.14, .14, .13);
  const muted = rgb(.40, .38, .35);
  const gold = rgb(.64, .50, .29);
  const paper = rgb(.98, .97, .95);
  const width = page.getWidth();
  const height = page.getHeight();
  page.drawRectangle({ x: 0, y: 0, width, height, color: paper });
  page.drawRectangle({ x: 0, y: height - 140, width, height: 140, color: rgb(.10, .10, .10) });
  page.drawText('JUWELIER GÖK · AUGSBURG', { x: 45, y: height - 40, size: 10, font, color: rgb(.79, .70, .55) });
  page.drawText('Ankaufbeleg', { x: 45, y: height - 84, size: 29, font, color: rgb(.97, .95, .91) });
  page.drawText('TESTVERSION · KEIN ECHTER GESCHÄFTSBELEG', { x: 45, y: height - 114, size: 9, font, color: rgb(.83, .71, .52) });
  page.drawText(`Datum: ${displayDate(localDate())}`, { x: 425, y: height - 41, size: 9, font, color: rgb(.87, .84, .79) });
  page.drawText(`Nr. ${data.receiptNumber}`, { x: 425, y: height - 58, size: 7, font, color: rgb(.87, .84, .79) });

  page.drawText('VERKÄUFER/IN', { x: 45, y: 674, size: 10, font, color: gold });
  page.drawText('ANKÄUFER', { x: 320, y: 674, size: 10, font, color: gold });
  const seller = data.seller;
  const sellerLines = [
    `${seller.first} ${seller.last}`,
    seller.street,
    `${seller.postal} ${seller.city}`,
    `Geboren: ${seller.birth || '—'}${seller.birthplace ? ` · ${seller.birthplace}` : ''}`,
    `Staatsangehörigkeit: ${seller.nationality || '—'}`,
    `Dokument: ${data.documentType}`,
    `Dokumentnummer: ${seller.number || '—'}`,
    `Gültig bis: ${seller.expiry || '—'}`
  ];
  sellerLines.forEach((line, index) => drawFitted(page, font, line, 45, 650 - index * 19, 250, index === 0 ? 11 : 9, ink));
  page.drawText('Dokumentangaben mit Original abgeglichen', { x: 45, y: 497, size: 8, font, color: gold });
  ['Murat Gök · Juwelier Gök', 'Hermanstraße 11', '86150 Augsburg', 'info@juwelier-goek.de', '0821 314670'].forEach((line, index) => drawFitted(page, font, line, 320, 650 - index * 19, 225, index === 0 ? 11 : 9, ink));
  page.drawLine({ start: { x: 45, y: 482 }, end: { x: 550, y: 482 }, thickness: .7, color: rgb(.76, .73, .68) });
  page.drawText('ANKAUFPOSITIONEN', { x: 45, y: 461, size: 10, font, color: gold });
  const columns = [{ x: 45, label: 'Nr.' }, { x: 84, label: 'Edelmetallart' }, { x: 280, label: 'Gramm' }, { x: 366, label: 'Preis' }, { x: 460, label: 'Datum' }];
  columns.forEach(column => page.drawText(column.label, { x: column.x, y: 433, size: 9, font, color: muted }));
  data.items.forEach((item, index) => {
    const y = 401 - index * 34;
    page.drawLine({ start: { x: 45, y: y - 11 }, end: { x: 550, y: y - 11 }, thickness: .4, color: rgb(.85, .83, .80) });
    drawFitted(page, font, String(item.number).padStart(2, '0'), 45, y, 35, 9, ink);
    drawFitted(page, font, item.metal, 84, y, 180, 9, ink);
    drawFitted(page, font, grams(item.grams), 280, y, 78, 9, ink);
    drawFitted(page, font, euro(item.price), 366, y, 88, 9, ink);
    drawFitted(page, font, displayDate(item.date), 460, y, 86, 9, ink);
  });
  const totalGrams = data.items.reduce((sum, item) => sum + item.grams, 0);
  const totalPrice = data.items.reduce((sum, item) => sum + item.price, 0);
  page.drawRectangle({ x: 45, y: 185, width: 505, height: 52, color: rgb(.91, .88, .82) });
  page.drawText(`Gesamtgewicht  ${grams(totalGrams)}`, { x: 60, y: 205, size: 10, font, color: ink });
  drawFitted(page, font, `Gesamtpreis  ${euro(totalPrice)}`, 326, 205, 209, 11, ink);
  page.drawText('Unterschrift Verkäufer/in', { x: 45, y: 154, size: 9, font, color: muted });
  const signature = await pdf.embedPng(signatureDataUrl);
  const signatureSize = signature.scaleToFit(245, 80);
  page.drawImage(signature, { x: 45, y: 68, width: signatureSize.width, height: signatureSize.height });
  page.drawLine({ start: { x: 45, y: 64 }, end: { x: 290, y: 64 }, thickness: .7, color: ink });
  page.drawText('Ausweiskopien siehe Folgeseite.', { x: 320, y: 88, size: 9, font, color: muted });
  page.drawText('Nur für Testdaten · Kein echter Geschäftsbeleg.', { x: 45, y: 29, size: 8, font, color: muted });

  const copyPage = pdf.addPage([595.28, 841.89]);
  copyPage.drawRectangle({ x: 0, y: 0, width, height, color: paper });
  copyPage.drawRectangle({ x: 0, y: 754, width, height: 88, color: rgb(.10, .10, .10) });
  copyPage.drawText('AUSWEISKOPIEN · TESTVERSION', { x: 45, y: 802, size: 12, font, color: rgb(.82, .72, .56) });
  copyPage.drawText(`${seller.first} ${seller.last}`, { x: 45, y: 778, size: 10, font, color: rgb(.96, .94, .91) });
  drawCopyPage(copyPage, font, await pdf.embedJpg(slots.front.dataUrl), 'Vorderseite / Datenseite', 728, lib);
  drawCopyPage(copyPage, font, await pdf.embedJpg(slots.back.dataUrl), 'Rückseite / weitere Seite', 380, lib);
  copyPage.drawText('KOPIE · Beleganlage · Nicht für die echte Aufbewahrung vorgesehen.', { x: 48, y: 20, size: 8, font, color: muted });
  return pdf.save();
}

function assertApprovalRevision(revision) {
  if (revision !== approvalRevision || verifiedRevision !== approvalRevision || signedRevision !== approvalRevision || (manualReviewRequired && !reviewAck.checked)) {
    throw new Error('Angaben wurden während der PDF-Erstellung geändert. Bitte erneut prüfen und unterschreiben.');
  }
}

async function createValidatedPdf() {
  if (busy) throw new Error('Bitte warten, bis der aktuelle Vorgang abgeschlossen ist.');
  const data = collectAndValidate();
  const revision = approvalRevision;
  setBusy(true);
  exportStatus.textContent = 'PDF wird erstellt …';
  try {
    const bytes = await createReceiptPdf(data);
    assertApprovalRevision(revision);
    return { bytes, data };
  } finally {
    setBusy(false);
  }
}

function downloadPdf(bytes, number) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Ankaufbeleg_TEST_${number}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function showPdfPreview(bytes, label) {
  const renderId = ++previewRenderId;
  const pages = byId('pdf-preview-pages');
  const status = byId('pdf-preview-status');
  pages.replaceChildren();
  status.textContent = 'PDF-Vorschau wird geladen …';
  previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  byId('pdf-preview-open').href = previewUrl;
  byId('pdf-preview-label').textContent = label;
  previewDialog.showModal();
  try {
    const pdfjs = await getPdfJs();
    const pdfDocument = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isOffscreenCanvasSupported: false
    }).promise;
    if (renderId !== previewRenderId) { await pdfDocument.destroy(); return false; }
    previewDocument = pdfDocument;
    for (let number = 1; number <= pdfDocument.numPages; number++) {
      status.textContent = `Seite ${number} von ${pdfDocument.numPages} wird angezeigt …`;
      const page = await pdfDocument.getPage(number);
      if (renderId !== previewRenderId) return false;
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, Math.max(1, pages.clientWidth - 24) / original.width);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.round(original.width * scale)}px`;
      canvas.style.height = `${Math.round(original.height * scale)}px`;
      canvas.setAttribute('aria-label', `Seite ${number} von ${pdfDocument.numPages}`);
      pages.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (renderId !== previewRenderId) return false;
      page.cleanup();
    }
    status.textContent = '';
    return true;
  } catch (error) {
    if (renderId !== previewRenderId) return false;
    console.error('PDF-Vorschau fehlgeschlagen:', error);
    status.textContent = 'Vorschau konnte nicht dargestellt werden. Bitte „PDF separat öffnen“ verwenden.';
    return false;
  }
}

byId('pdf-preview-close').addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('close', () => {
  ++previewRenderId;
  byId('pdf-preview-pages').replaceChildren();
  byId('pdf-preview-open').removeAttribute('href');
  if (previewDocument) previewDocument.destroy().catch(() => {});
  previewDocument = null;
  if (previewUrl) {
    const url = previewUrl;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  previewUrl = null;
});

byId('preview-button').addEventListener('click', async () => {
  if (busy) return;
  try {
    const { bytes, data } = await createValidatedPdf();
    const shown = await showPdfPreview(bytes, `Beleg ${data.receiptNumber} · vor dem Speichern und Herunterladen prüfen`);
    if (shown) exportStatus.textContent = 'PDF-Vorschau geöffnet. Bitte beide Seiten kontrollieren.';
    else if (previewDialog.open) exportStatus.textContent = 'PDF erstellt. Bei Problemen mit der Vorschau bitte „PDF separat öffnen“ verwenden.';
  } catch (error) { exportStatus.textContent = error.message || 'PDF-Vorschau konnte nicht erstellt werden.'; }
});

byId('export-button').addEventListener('click', async () => {
  if (busy) return;
  try {
    const { bytes, data } = await createValidatedPdf();
    downloadPdf(bytes, data.receiptNumber);
    receiptIssued = true;
    exportStatus.textContent = `PDF ${data.receiptNumber} heruntergeladen.`;
  } catch (error) { exportStatus.textContent = error.message || 'PDF konnte nicht erstellt werden. Bitte Angaben und Bilder prüfen.'; }
});

function setArchiveBusy(value) {
  archiveBusy = value;
  byId('archive-close').disabled = value;
  byId('archive-unlock-button').disabled = value;
  byId('archive-done-button').disabled = value;
}

async function openArchiveForSave() {
  byId('archive-status').textContent = '';
  byId('archive-unlock-form').hidden = false;
  byId('archive-save-done').hidden = true;
  byId('archive-unlock-form').reset();
  archiveDialog.showModal();
  try {
    const configured = await BelegArchive.isConfigured();
    byId('archive-confirm-wrap').hidden = configured;
    byId('archive-confirm').required = !configured;
    byId('archive-unlock-button').textContent = configured ? 'Archiv entsperren' : 'Archiv anlegen';
    byId('archive-status').textContent = configured
      ? 'Bitte Archiv-Passwort eingeben.'
      : 'Neues Archiv-Passwort mit mindestens 12 Zeichen festlegen. Es kann nicht zurückgesetzt werden.';
    byId('archive-password').focus();
  } catch (error) { byId('archive-status').textContent = error.message; }
}

async function saveCurrentToArchive() {
  const { bytes, data } = await createValidatedPdf();
  const metadata = {
    sellerName: `${data.seller.first} ${data.seller.last}`,
    createdAt: new Date().toISOString(),
    totalPrice: data.items.reduce((sum, item) => sum + item.price, 0),
    documentType: data.documentType
  };
  const wasIssued = receiptIssued;
  receiptIssued = true;
  try { await BelegArchive.save(data.receiptNumber, metadata, bytes); }
  catch (error) {
    if (receiptNumber === data.receiptNumber) receiptIssued = wasIssued;
    throw error;
  }
  const message = data.receiptNumber === receiptNumber
    ? `Beleg ${data.receiptNumber} verschlüsselt im lokalen Browserarchiv gespeichert. Für einen weiteren Beleg die Angaben ändern oder die Seite neu laden.`
    : `Beleg ${data.receiptNumber} gespeichert. Das Formular wurde inzwischen geändert; der neue Beleg ${receiptNumber} muss erneut geprüft und unterschrieben werden.`;
  byId('archive-status').textContent = message;
  exportStatus.textContent = message;
}

byId('archive-save-button').addEventListener('click', async () => {
  if (busy) return;
  try { collectAndValidate(); await openArchiveForSave(); }
  catch (error) { exportStatus.textContent = error.message; }
});
byId('archive-unlock-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (archiveBusy) return;
  setArchiveBusy(true);
  byId('archive-status').textContent = 'Archiv wird geöffnet …';
  try {
    await BelegArchive.unlock(byId('archive-password').value, byId('archive-confirm').value);
    await saveCurrentToArchive();
    byId('archive-unlock-form').reset();
    byId('archive-unlock-form').hidden = true;
    byId('archive-save-done').hidden = false;
  } catch (error) { byId('archive-status').textContent = error.message || 'Archiv konnte nicht geöffnet werden.'; }
  finally { setArchiveBusy(false); }
});
byId('archive-close').addEventListener('click', () => { if (!archiveBusy) archiveDialog.close(); });
byId('archive-done-button').addEventListener('click', () => { if (!archiveBusy) archiveDialog.close(); });
archiveDialog.addEventListener('cancel', event => { if (archiveBusy) event.preventDefault(); });
archiveDialog.addEventListener('close', () => {
  BelegArchive.lock();
  byId('archive-unlock-form').reset();
  byId('archive-save-done').hidden = true;
});
window.addEventListener('pagehide', () => BelegArchive.lock());
