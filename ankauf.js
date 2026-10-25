const byId = id => document.getElementById(id);
const slots = { front: null, back: null };
const scanStatus = byId('scan-status');
const exportStatus = byId('export-status');
const cameraDialog = byId('camera-dialog');
const cameraVideo = byId('camera-video');
const cameraStage = byId('camera-stage');
const cameraReviewImage = byId('camera-review-image');
const cameraReviewStatus = byId('camera-review-status');
const cameraRetake = byId('camera-retake');
const signatureDialog = byId('signature-dialog');
const signatureCanvas = byId('signature-canvas');
const purchaseAgreement = byId('purchase-agreement');
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
let agreementConfirmed = false;
let drawing = false;
let busy = false;
let previewUrl = null;
let previewDocument = null;
let previewRenderId = 0;
let archiveBusy = false;
const scanQuality = { front: null, back: null };
const sellerOtherInfo = byId('seller-other-info');

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
  byId('export-button').disabled = value;
  byId('preview-button').disabled = value;
  byId('archive-save-button').disabled = value;
  document.querySelectorAll('.scan-action input, [data-camera]').forEach(control => { control.disabled = value; });
}

function invalidateApproval() {
  if (receiptIssued) {
    receiptNumber = BelegArchive.newNumber();
    byId('receipt-number').textContent = receiptNumber;
    receiptIssued = false;
  }
  agreementConfirmed = false;
}

function updateCaptureAvailability() {
  document.querySelectorAll('.scan-action input, [data-camera]').forEach(control => { control.disabled = busy; });
  if (busy) return;
  if (!slots.front && !slots.back) scanStatus.textContent = 'Vorder- und Rückseite erfassen. Beide Bilder werden in den Beleg übernommen.';
  else if (!slots.front) scanStatus.textContent = 'Die Vorderseite fehlt noch.';
  else if (!slots.back) scanStatus.textContent = 'Die Rückseite fehlt noch.';
  else scanStatus.textContent = 'Vorder- und Rückseite sind erfasst und werden als Bilder angehängt.';
}

byId('document-type').addEventListener('change', invalidateApproval);
sellerOtherInfo.addEventListener('input', invalidateApproval);

function renderScanQuality() {
  const result = byId('scan-quality-result');
  const list = byId('scan-quality-list');
  if (!result || !list) return;
  list.replaceChildren();
  for (const side of ['front', 'back']) {
    const label = side === 'front' ? 'Vorderseite' : 'Rückseite';
    for (const issue of scanQuality[side]?.issues || []) {
      const item = document.createElement('li');
      item.textContent = `${label}: ${issue.message}`;
      list.append(item);
    }
  }
  const hasIssues = list.childElementCount > 0;
  result.classList.toggle('has-warning', hasIssues);
  result.hidden = !hasIssues;
}

async function analyzeSlotQuality(side, slot, source) {
  scanQuality[side] = { uncertain: false, issues: [] };
  renderScanQuality();
  try {
    const quality = await window.ScanQuality?.analyzeDataUrl(slot.dataUrl);
    if (!quality || slots[side] !== slot) return;
    scanQuality[side] = quality;
    renderScanQuality();
  } catch (error) {
    console.warn(`Bildqualität der ${side === 'front' ? 'Vorderseite' : 'Rückseite'} konnte nicht geprüft werden:`, error);
  }
}

function setSlot(side, dataUrl, filename = 'Aufnahme', source = 'upload') {
  slots[side] = { dataUrl, filename, source };
  scanQuality[side] = { uncertain: false, issues: [] };
  renderScanQuality();
  setBusy(busy);
  const preview = byId(`${side}-preview`);
  preview.src = dataUrl;
  preview.hidden = false;
  byId(`${side}-placeholder`).hidden = true;
  byId(`${side}-state`).textContent = 'Erfasst';
  updateCaptureAvailability();
  void analyzeSlotQuality(side, slots[side], source);
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

function canvasToBestJpeg(canvas, quality = 0.92) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!dataUrl || !dataUrl.startsWith('data:image/')) throw new Error('Bild konnte nicht gespeichert werden.');
  return dataUrl;
}

async function imageFileToDataUrl(file) {
  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });

  try {
    const img = new Image();
    await new Promise(resolve => {
      const timer = setTimeout(() => resolve(), 8000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); resolve(); };
      img.src = rawDataUrl;
    });
    const maxDim = 2200;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        return canvasToBestJpeg(canvas, 0.92);
      }
    }
  } catch (err) {
    console.warn('Canvas-Skalierung übersprungen:', err);
  }
  return rawDataUrl;
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
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  return images;
}

async function handleFile(side, file, source = 'upload') {
  if (!file) return;
  if (file.size > 35 * 1024 * 1024) { scanStatus.textContent = 'Datei zu groß. Maximal 35 MB pro Datei.'; return; }
  const fileName = file.name || '';
  const isPdf = file.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  const isImage = file.type?.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif|bmp|tiff)$/i.test(fileName) || !file.type;
  if (!isPdf && !isImage) { scanStatus.textContent = 'Bitte ein Foto, Bild oder PDF wählen.'; return; }
  setBusy(true);
  byId(`${side}-state`).textContent = 'Wird geladen …';
  byId(`${side}-frame`)?.closest('.scan-card')?.classList.add('scan-card--loading');
  scanStatus.textContent = `${fileName || 'Foto'} wird geladen …`;
  let loaded = false;
  try {
    if (isPdf) {
      const images = await pdfFileToImages(file);
      if (!images.length) throw new Error('Dieses PDF hat keine lesbare Seite.');
      if (images.length > 1) {
        setSlot('front', images[0], fileName, 'pdf');
        setSlot('back', images[1], fileName, 'pdf');
      } else {
        setSlot(side, images[0], fileName, 'pdf');
      }
    } else {
      const dataUrl = await imageFileToDataUrl(file);
      setSlot(side, dataUrl, fileName || 'Foto', source);
    }
    loaded = true;
  } catch (error) {
    console.error('Dokument konnte nicht gelesen werden:', error);
    byId(`${side}-state`).textContent = slots[side] ? 'Erfasst' : 'Noch nicht erfasst';
    scanStatus.textContent = 'Foto konnte nicht geladen werden. Bitte erneut versuchen.';
  } finally {
    byId(`${side}-frame`)?.closest('.scan-card')?.classList.remove('scan-card--loading');
    setBusy(false);
    if (loaded) {
      updateCaptureAvailability();
    }
  }
}

for (const side of ['front', 'back']) {
  byId(`${side}-file`).addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) {
      await handleFile(side, file, 'upload');
    }
    event.target.value = '';
  });
  byId(`${side}-capture-file`).addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) {
      await handleFile(side, file, 'native-camera');
    }
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
  if (!navigator.mediaDevices?.getUserMedia) {
    byId(`${side}-capture-file`)?.click();
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
    byId('camera-help').textContent = 'Ausweis im Rahmen halten und auf „Aufnehmen“ tippen.';
  } catch (err) {
    stopCamera();
    scanStatus.textContent = 'Live-Kamera nicht verfügbar. Bitte „Foto aufnehmen“ antippen.';
    try { byId(`${side}-capture-file`)?.click(); } catch {}
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
  byId('camera-help').textContent = 'Ausweis im Rahmen halten und auf „Aufnehmen“ tippen.';
  void cameraVideo.play().catch(() => {
    byId('camera-help').textContent = 'Die Kameravorschau wurde angehalten. Bitte die Kamera schließen und erneut öffnen.';
  });
});
byId('camera-capture').addEventListener('click', async () => {
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
    setSlot(side, image.dataUrl, 'Kameraaufnahme', 'camera');
    stopCamera();
    updateCaptureAvailability();
  } catch (error) {
    console.error('Kamerabild konnte nicht übernommen werden:', error);
    scanStatus.textContent = 'Aufnahme fehlgeschlagen. Bitte „Foto aufnehmen“ nutzen.';
  } finally {
    releasePhoto?.();
    button.disabled = false;
  }
});
window.addEventListener('pagehide', stopCamera);

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
  updateSignatureSaveState();
}

function updateSignatureSaveState() {
  byId('signature-save').disabled = !signatureHasInk || !purchaseAgreement.checked;
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
  updateSignatureSaveState();
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
purchaseAgreement.addEventListener('change', updateSignatureSaveState);
byId('sign-button').addEventListener('click', () => {
  clearSignature();
  purchaseAgreement.checked = false;
  updateSignatureSaveState();
  signatureDialog.showModal();
});
byId('signature-clear').addEventListener('click', clearSignature);
byId('signature-close').addEventListener('click', () => signatureDialog.close());
byId('signature-save').addEventListener('click', () => {
  if (!purchaseAgreement.checked) { byId('signature-status').textContent = 'Bitte zuerst Ihr Einverständnis bestätigen.'; return; }
  if (!signatureHasInk) { byId('signature-status').textContent = 'Bitte zuerst im Feld unterschreiben.'; return; }
  signatureDataUrl = signatureCanvas.toDataURL('image/png');
  agreementConfirmed = true;
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
  setSlot('front', sampleDocument('front'), 'Muster Vorderseite', 'sample');
  setSlot('back', sampleDocument('back'), 'Muster Rückseite', 'sample');
  invalidateApproval();
  sellerOtherInfo.value = '';
  byId('items-body').innerHTML = '';
  addItem({ metal: 'Gold', grams: '12.50', price: '650.00', date: localDate() });
  scanStatus.textContent = 'Beispielbilder geladen. Vorder- und Rückseite werden dem Beleg als Bilder angehängt.';
  exportStatus.textContent = 'Bitte noch die Unterschrift erfassen.';
});

byId('logout-button').addEventListener('click', () => {
  sessionStorage.removeItem('juwelier-goek-demo');
  window.location.replace('login.html');
});

function collectAndValidate(requireSignature = true) {
  if (!slots.front || !slots.back) {
    byId('scan-title').scrollIntoView({ behavior: 'smooth' });
    throw new Error('Bitte Vorder- und Rückseite erfassen.');
  }
  const items = getItems();
  if (!items.length || items.some(item => !['Gold', 'Silber'].includes(item.metal) || !Number.isFinite(item.grams) || item.grams <= 0 || !Number.isFinite(item.price) || item.price <= 0 || !validIsoDate(item.date))) {
    byId('items-title').scrollIntoView({ behavior: 'smooth' });
    throw new Error('Bitte Edelmetall, Gramm, Preis und Datum für jede Position ausfüllen.');
  }
  if (requireSignature && (!signatureDataUrl || !agreementConfirmed)) {
    byId('sign-button').focus();
    throw new Error('Bitte Einverständnis bestätigen und unterschreiben.');
  }
  return { receiptNumber, otherInfo: sellerOtherInfo.value.trim(), items, documentType: byId('document-type').value };
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

function drawDetailRow(page, font, label, value, x, labelY, maxWidth, colors) {
  page.drawText(label.toUpperCase(), { x, y: labelY, size: 6.5, font, color: colors.muted });
  drawFitted(page, font, value || '—', x, labelY - 10, maxWidth, 8.5, colors.ink);
}

function drawInfoCard(page, font, x, title, details, colors) {
  const y = 495;
  const width = 245;
  const height = 190;
  page.drawRectangle({ x, y, width, height, color: colors.paper, borderColor: colors.line, borderWidth: .7 });
  page.drawRectangle({ x, y: y + height - 27, width, height: 27, color: colors.cardHead });
  page.drawText(title, { x: x + 12, y: y + height - 18, size: 8, font, color: colors.gold });
  details.forEach(([label, value], index) => {
    drawDetailRow(page, font, label, value, x + 12, 644 - index * 25, width - 24, colors);
  });
}

function drawImagePairPage(page, font, frontImage, backImage, receiptNumber, pdfLib, colors) {
  const { rgb } = pdfLib;
  const width = page.getWidth();
  const height = page.getHeight();
  page.drawRectangle({ x: 0, y: 0, width, height, color: colors.paper });
  page.drawRectangle({ x: 0, y: height - 118, width, height: 118, color: rgb(.10, .10, .10) });
  page.drawText('JUWELIER GÖK · AUGSBURG', { x: 45, y: 808, size: 9, font, color: rgb(.79, .70, .55) });
  page.drawText('Dokumentbilder', { x: 45, y: 775, size: 17, font, color: rgb(.97, .95, .91) });
  const numberLabel = `BELEG NR. ${receiptNumber}`;
  page.drawText(numberLabel, { x: width - 45 - font.widthOfTextAtSize(numberLabel, 8), y: 808, size: 8, font, color: rgb(.87, .84, .79) });
  const pageLabel = 'SEITE 2 / 2';
  page.drawText(pageLabel, { x: width - 45 - font.widthOfTextAtSize(pageLabel, 8), y: 775, size: 8, font, color: rgb(.87, .84, .79) });

  const imageRows = [
    { label: 'VORDERSEITE / DATENSEITE', image: frontImage, labelY: 695, box: { x: 45, y: 390, width: 505, height: 280 } },
    { label: 'RÜCKSEITE', image: backImage, labelY: 370, box: { x: 45, y: 65, width: 505, height: 280 } }
  ];
  for (const row of imageRows) {
    page.drawText(row.label, { x: 45, y: row.labelY, size: 8, font, color: colors.gold });
    page.drawRectangle({ ...row.box, color: rgb(1, 1, 1), borderColor: colors.line, borderWidth: .8 });
    const dims = row.image.scaleToFit(row.box.width - 28, row.box.height - 28);
    page.drawImage(row.image, { x: row.box.x + (row.box.width - dims.width) / 2, y: row.box.y + (row.box.height - dims.height) / 2, width: dims.width, height: dims.height });
  }
  page.drawLine({ start: { x: 45, y: 42 }, end: { x: 550, y: 42 }, thickness: .6, color: colors.line });
  page.drawText('Dokumentkopien · Vorder- und Rückseite', { x: 45, y: 22, size: 7, font, color: colors.muted });
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
  const line = rgb(.78, .75, .70);
  const cardHead = rgb(.93, .91, .87);
  const colors = { ink, muted, gold, paper, line, cardHead };
  const width = page.getWidth();
  const height = page.getHeight();
  page.drawRectangle({ x: 0, y: 0, width, height, color: paper });
  page.drawRectangle({ x: 0, y: height - 140, width, height: 140, color: rgb(.10, .10, .10) });
  page.drawText('JUWELIER GÖK · AUGSBURG', { x: 45, y: height - 40, size: 10, font, color: rgb(.79, .70, .55) });
  page.drawText('Ankaufbeleg', { x: 45, y: height - 82, size: 29, font, color: rgb(.97, .95, .91) });
  page.drawText('TESTVERSION · KEIN ECHTER GESCHÄFTSBELEG', { x: 45, y: height - 113, size: 8, font, color: rgb(.83, .71, .52) });
  const dateLabel = `DATUM · ${displayDate(localDate())}`;
  const numberLabel = `BELEG NR. ${data.receiptNumber}`;
  page.drawText(dateLabel, { x: width - 45 - font.widthOfTextAtSize(dateLabel, 8), y: height - 41, size: 8, font, color: rgb(.87, .84, .79) });
  page.drawText(numberLabel, { x: width - 45 - font.widthOfTextAtSize(numberLabel, 8), y: height - 60, size: 8, font, color: rgb(.87, .84, .79) });

  const sellerDetails = [
    ['DOKUMENTART', data.documentType],
    ['DOKUMENTSEITEN', 'Vorder- und Rückseite'],
    ['ERFASSUNG', 'Bildanlage'],
    ['VERKÄUFERANGABEN', 'Siehe Dokumentkopien'],
    ['ZUSATZHINWEISE', data.otherInfo ? 'Auf dem Beleg aufgeführt' : 'Keine'],
    ['BILDANLAGE', '2 Dokumentseiten']
  ];
  const buyerDetails = [
    ['UNTERNEHMEN', 'Juwelier Gök'],
    ['ANSPRECHPARTNER', 'Murat Gök'],
    ['STRASSE / HAUSNUMMER', 'Hermanstraße 11'],
    ['PLZ / ORT', '86150 Augsburg'],
    ['E-MAIL', 'info@juwelier-goek.de'],
    ['TELEFON', '0821 314670']
  ];
  drawInfoCard(page, font, 45, 'VERKÄUFER/IN', sellerDetails, colors);
  drawInfoCard(page, font, 305, 'ANKÄUFER', buyerDetails, colors);
  if (data.otherInfo) {
    page.drawRectangle({ x: 45, y: 440, width: 505, height: 45, color: paper, borderColor: line, borderWidth: .7 });
    page.drawText('SONSTIGE INFORMATION', { x: 56, y: 470, size: 6.5, font, color: gold });
    page.drawText(data.otherInfo, { x: 56, y: 457, size: 8, font, color: ink, maxWidth: 483, lineHeight: 9 });
  }
  const tableTitleY = data.otherInfo ? 420 : 464;
  page.drawText('ANKAUFPOSITIONEN', { x: 45, y: tableTitleY, size: 9, font, color: gold });
  const headerY = tableTitleY - 24;
  page.drawRectangle({ x: 45, y: headerY - 7, width: 505, height: 22, color: cardHead });
  const columns = [{ x: 56, label: 'NR.' }, { x: 96, label: 'EDELMETALLART' }, { x: 315, label: 'GRAMM' }, { x: 390, label: 'PREIS' }, { x: 476, label: 'DATUM' }];
  columns.forEach(column => page.drawText(column.label, { x: column.x, y: headerY, size: 7, font, color: muted }));
  const firstRowY = headerY - 28;
  const rowGap = 24;
  data.items.forEach((item, index) => {
    const y = firstRowY - index * rowGap;
    if (index % 2 === 1) page.drawRectangle({ x: 45, y: y - 8, width: 505, height: rowGap, color: rgb(.95, .94, .91) });
    drawFitted(page, font, String(item.number).padStart(2, '0'), 56, y, 28, 8, ink);
    drawFitted(page, font, item.metal, 96, y, 195, 8, ink);
    drawFitted(page, font, grams(item.grams), 315, y, 60, 8, ink);
    drawFitted(page, font, euro(item.price), 390, y, 73, 8, ink);
    drawFitted(page, font, displayDate(item.date), 476, y, 74, 8, ink);
    page.drawLine({ start: { x: 45, y: y - 10 }, end: { x: 550, y: y - 10 }, thickness: .35, color: line });
  });
  const totalGrams = data.items.reduce((sum, item) => sum + item.grams, 0);
  const totalPrice = data.items.reduce((sum, item) => sum + item.price, 0);
  const lastRowY = firstRowY - (data.items.length - 1) * rowGap;
  const totalY = lastRowY - 58;
  page.drawRectangle({ x: 45, y: totalY, width: 505, height: 42, color: rgb(.91, .88, .82) });
  page.drawText('GESAMTGEWICHT', { x: 58, y: totalY + 25, size: 6.5, font, color: muted });
  page.drawText(grams(totalGrams), { x: 58, y: totalY + 10, size: 10, font, color: ink });
  page.drawText('GESAMTPREIS', { x: 320, y: totalY + 25, size: 6.5, font, color: muted });
  drawFitted(page, font, euro(totalPrice), 320, totalY + 10, 215, 11, ink);
  const signatureTop = Math.min(222, totalY - 18);
  const signatureY = signatureTop - 88;
  const signatureCards = [{ x: 45, title: 'UNTERSCHRIFT VERKÄUFER/IN' }, { x: 305, title: 'BESTÄTIGUNG' }];
  signatureCards.forEach(card => {
    page.drawRectangle({ x: card.x, y: signatureY, width: 245, height: 88, color: paper, borderColor: line, borderWidth: .7 });
    page.drawRectangle({ x: card.x, y: signatureY + 63, width: 245, height: 25, color: cardHead });
    page.drawText(card.title, { x: card.x + 11, y: signatureY + 72, size: 7, font, color: gold });
  });
  if (signatureDataUrl && agreementConfirmed) {
    const signature = await pdf.embedPng(signatureDataUrl);
    const signatureSize = signature.scaleToFit(215, 42);
    page.drawImage(signature, { x: 60, y: signatureY + 17, width: signatureSize.width, height: signatureSize.height });
  } else {
    page.drawText('Unterschrift ausstehend', { x: 58, y: signatureY + 31, size: 8, font, color: muted });
  }
  page.drawText(agreementConfirmed ? 'Angaben und Ankaufspreis bestätigt.' : 'Einverständnis ausstehend.', { x: 316, y: signatureY + 43, size: 8, font, color: agreementConfirmed ? ink : muted, maxWidth: 220, lineHeight: 10 });
  page.drawText('Vorder- und Rückseite auf Seite 2.', { x: 316, y: signatureY + 22, size: 7, font, color: muted });
  page.drawText('Achtung: Dem Verkauf liegen unsere allgemeinen Geschäftsbedingungen zugrunde. Der Verkäufer bestätigt den Verkauf zum angegebenen Verkaufspreis und den Erhalt des Geldes, bestätigt, dass die Ware sein Eigentum ist, und stellt unsere Firma von allen erhobenen Ansprüchen Dritter frei. Der Ankauf erfolgt unter Vorbehalt der Echtheit und Richtigkeit eventuell oben angegebener Eigenschaften.', { x: 45, y: 47, size: 6.5, font, color: muted, maxWidth: 505, lineHeight: 8 });
  page.drawText('Nur für Testdaten · Kein echter Geschäftsbeleg.', { x: 45, y: 16, size: 6.5, font, color: muted });

  const copyPage = pdf.addPage([595.28, 841.89]);
  const frontImage = await pdf.embedJpg(slots.front.dataUrl);
  const backImage = await pdf.embedJpg(slots.back.dataUrl);
  drawImagePairPage(copyPage, font, frontImage, backImage, data.receiptNumber, lib, colors);
  return pdf.save();
}

async function createValidatedPdf(requireSignature = true) {
  if (busy) throw new Error('Bitte warten, bis der aktuelle Vorgang abgeschlossen ist.');
  const data = collectAndValidate(requireSignature);
  setBusy(true);
  exportStatus.textContent = 'PDF wird erstellt …';
  try {
    const bytes = await createReceiptPdf(data);
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
    const { bytes, data } = await createValidatedPdf(false);
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
    sellerName: 'Ankaufbeleg',
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
