const byId = id => document.getElementById(id);
const archiveForm = byId('archive-unlock-form');
const archiveBrowser = byId('archive-browser');
const archiveStatus = byId('archive-status');
const previewDialog = byId('archive-preview-dialog');
let archiveEntries = [];
let archiveBusy = false;
let previewUrl = null;

function euro(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function displayDate(isoDate) {
  const parts = String(isoDate).split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : isoDate;
}

function archiveCard(entry) {
  const card = document.createElement('article');
  card.className = 'archive-card';
  const details = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = entry.sellerName;
  const subline = document.createElement('span');
  const date = new Intl.DateTimeFormat('de-DE').format(new Date(entry.createdAt));
  subline.textContent = `${entry.number} · ${date} · ${euro(entry.totalPrice)}`;
  details.append(name, subline);
  const actions = document.createElement('div');
  actions.className = 'archive-card-actions';
  for (const [action, label] of [['view', 'Ansehen'], ['download', 'PDF laden'], ['delete', 'Löschen']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.number = entry.number;
    button.textContent = label;
    actions.append(button);
  }
  card.append(details, actions);
  return card;
}

function renderArchiveList() {
  const query = byId('archive-search').value.trim().toLocaleLowerCase('de');
  const matching = archiveEntries.filter(entry => `${entry.number} ${entry.sellerName} ${entry.createdAt} ${displayDate(entry.createdAt.slice(0, 10))}`.toLocaleLowerCase('de').includes(query));
  const list = byId('archive-list');
  list.replaceChildren();
  if (!matching.length) {
    const empty = document.createElement('p');
    empty.className = 'archive-empty';
    empty.textContent = query ? 'Kein passender Beleg gefunden.' : 'Noch keine Belege in diesem Browser gespeichert.';
    list.append(empty);
    return;
  }
  list.append(...matching.map(archiveCard));
}

function setArchiveBusy(value) {
  archiveBusy = value;
  byId('archive-unlock-button').disabled = value;
  byId('archive-lock-button').disabled = value;
  byId('archive-search').disabled = value;
  byId('archive-list').querySelectorAll('button').forEach(button => { button.disabled = value; });
}

async function showLockedArchive() {
  archiveEntries = [];
  byId('archive-section-title').textContent = 'Archiv öffnen';
  archiveForm.reset();
  archiveForm.hidden = false;
  archiveBrowser.hidden = true;
  byId('archive-list').replaceChildren();
  archiveStatus.textContent = '';
  try {
    const configured = await BelegArchive.isConfigured();
    byId('archive-confirm-wrap').hidden = configured;
    byId('archive-confirm').required = !configured;
    byId('archive-unlock-button').textContent = configured ? 'Archiv entsperren' : 'Archiv anlegen';
    archiveStatus.textContent = configured
      ? 'Bitte Archiv-Passwort eingeben.'
      : 'Neues Archiv-Passwort mit mindestens 12 Zeichen festlegen. Es kann nicht zurückgesetzt werden.';
  } catch (error) { archiveStatus.textContent = error.message; }
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

function showPdfPreview(bytes, number) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  byId('archive-preview-frame').src = previewUrl;
  byId('archive-preview-label').textContent = `Archivierter Beleg ${number}`;
  previewDialog.showModal();
}

archiveForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (archiveBusy) return;
  setArchiveBusy(true);
  archiveStatus.textContent = 'Archiv wird geöffnet …';
  try {
    await BelegArchive.unlock(byId('archive-password').value, byId('archive-confirm').value);
    archiveEntries = await BelegArchive.list();
    archiveForm.reset();
    archiveForm.hidden = true;
    archiveBrowser.hidden = false;
    byId('archive-section-title').textContent = 'Belege verwalten';
    renderArchiveList();
    archiveStatus.textContent = `${archiveEntries.length} Belege im lokalen Archiv.`;
  } catch (error) { archiveStatus.textContent = error.message || 'Archiv konnte nicht geöffnet werden.'; }
  finally { setArchiveBusy(false); }
});

byId('archive-search').addEventListener('input', renderArchiveList);
byId('archive-list').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || archiveBusy) return;
  const { action, number } = button.dataset;
  setArchiveBusy(true);
  try {
    if (action === 'delete') {
      if (!window.confirm(`Beleg ${number} unwiderruflich aus diesem Browserarchiv löschen?`)) return;
      await BelegArchive.remove(number);
      archiveEntries = await BelegArchive.list();
      renderArchiveList();
      archiveStatus.textContent = `Beleg ${number} aus dem lokalen Archiv gelöscht.`;
    } else {
      const bytes = await BelegArchive.pdf(number);
      if (action === 'download') {
        downloadPdf(bytes, number);
        archiveStatus.textContent = `PDF ${number} heruntergeladen.`;
      } else showPdfPreview(bytes, number);
    }
  } catch (error) { archiveStatus.textContent = error.message || 'Archivaktion fehlgeschlagen.'; }
  finally { setArchiveBusy(false); }
});

byId('archive-lock-button').addEventListener('click', () => {
  if (archiveBusy) return;
  BelegArchive.lock();
  void showLockedArchive();
});
byId('archive-preview-close').addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('close', () => {
  byId('archive-preview-frame').removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
});
byId('logout-button').addEventListener('click', () => {
  BelegArchive.lock();
  sessionStorage.removeItem('juwelier-goek-demo');
  window.location.replace('login.html');
});
window.addEventListener('pagehide', () => BelegArchive.lock());
void showLockedArchive();
