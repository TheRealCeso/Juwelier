// Ausfüllhilfe für OCR-Text. Eine maschinenlesbare Zeile wird nur mit gültiger Prüfziffer übernommen.
(function (root) {
  const labels = {
    last: /^(?:familienname|nachname|name|surname|nom|soyad[ıi]|apellidos?|cognome)\b(?:\s*[/|]\s*(?:surname|nom|name|familienname|nachname|soyad[ıi]))*\b/i,
    first: /^(?:vornamen?|given\s*names?|pr[eé]noms?|ad[ıi]|nombre|nome)\b(?:\s*[/|]\s*(?:given\s*names?|pr[eé]noms?|vornamen?|ad[ıi]|nombre|nome))*\b/i,
    birth: /^(?:geburtstag|geburtsdatum|date\s*(?:of\s*)?birth|date\s*de\s*naissance|do[gğ]um\s*tarihi|fecha\s*de\s*nacimiento|data\s*di\s*nascita)\b(?:\s*[/|]\s*(?:date\s*(?:of\s*)?birth|date\s*de\s*naissance|do[gğ]um\s*tarihi))*\b/i,
    birthplace: /^(?:geburts[oa]rt|place\s*of\s*birth|lieu\s*de\s*naissance|do[gğ]um\s*yeri|lugar\s*de\s*nacimiento|luogo\s*di\s*nascita)\b(?:\s*[/|]\s*(?:(?:place\s*)?of\s*birth|lieu\s*de\s*naissance|do[gğ]um\s*yeri))*\b/i,
    street: /^(?:anschrift|adresse|address|wohnort|ikametgah|domicilio|indirizzo)\b(?:\s*[/|]\s*(?:address|adresse))*\b/i,
    nationality: /^(?:staatsangeh[oö]rigkeit|nationality|nationalit[eé]|uyru[gğ]u|nacionalidad|nazionalit[aà])\b(?:\s*[/|]\s*(?:nationality|nationalit[eé]|uyru[gğ]u))*\b/i,
    number: /^(?:ausweis(?:nummer|nr\.?|\s*nr\.?|\s*no\.?|\s*number)?|dokument(?:en)?(?:nummer|nr\.?|\s*nr\.?|\s*no\.?)|serien(?:nummer|nr\.?|\s*nr\.?)|document\s*(?:no\.?|number)|passport\s*(?:no\.?|number)|pass(?:nummer|nr\.?)|seri\s*no|belge\s*no|kimlik\s*no)\b/i,
    expiry: /^(?:g[uü]ltig\s*bis|ablaufdatum|date\s*of\s*expiry|expiry\s*date|expiration\s*date|son\s*ge[cç]erlilik|validez|scadenza)\b(?:\s*[/|]\s*(?:date\s*of\s*expiry|expiry\s*date|expiration\s*date))*\b/i
  };
  const labelList = Object.values(labels);
  const clean = value => String(value || '').replace(/^\s*(?:\[[ab]\]|[ab]\])\s*/i, '').replace(/^[\s:;|/\-]+|[\s:;|]+$/g, '').replace(/\s+/g, ' ').trim();
  const isLabel = line => labelList.some(pattern => pattern.test(clean(line)));
  const looksLikeMrz = line => /^(?:P|I|A|C)[<«][A-Z0-9<«]{20,}/i.test(line.replace(/\s/g, ''));

  function nameFromText(value) {
    // Verzierungen und überlagerter OCR-Text nach ">" sind keine Namensbestandteile.
    const name = clean(String(value || '').split(/[>\\|]/)[0])
      .replace(/^[^A-Za-zÄÖÜäöüßẞ]+|[^A-Za-zÄÖÜäöüßẞ' -]+$/g, '').trim();
    if (!name || !/[A-Za-zÄÖÜäöüßẞ]{2,}/.test(name) || /\d/.test(name) || isLabel(name)) return '';
    return name;
  }

  function labelValue(value, key) {
    if (key === 'first' || key === 'last') return nameFromText(value);
    if (key === 'birth' || key === 'expiry') return dateFromText(value);
    return clean(value);
  }

  function labeled(lines, key) {
    const pattern = labels[key];
    for (let index = 0; index < lines.length; index++) {
      const line = clean(lines[index]).replace(/^[0-9]{1,2}\s*[/.)-]?\s*/, '').trim();
      const match = line.match(pattern);
      if (!match) continue;
      const inline = labelValue(line.slice(match[0].length), key);
      if (inline && !isLabel(inline) && !looksLikeMrz(inline) && !/^(?:nom|surname|given\s*names?|date|nationalit[eé])$/i.test(inline)) return inline;
      for (let offset = 1; offset <= 2; offset++) {
        const next = clean(lines[index + offset]);
        if (!next || isLabel(next)) break;
        const candidate = labelValue(next, key);
        if (candidate && !looksLikeMrz(candidate)) return candidate;
      }
    }
    return '';
  }

  function dateFromText(value) {
    const normalized = String(value || '').replace(/(\d)\s+(\d{3})(?!\d)/g, '$1$2');
    const match = normalized.match(/(?:^|\D)(\d{1,2})\s*[.,\/-]\s*(\d{1,2})\s*[.,\/-]\s*(\d{4})(?!\d)/);
    if (!match) return '';
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) return '';
    return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
  }

  function numericMrz(value) {
    return value.toUpperCase().replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  }

  function checkDigit(value) {
    const weights = [7, 3, 1];
    let total = 0;
    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      const number = char === '<' ? 0 : /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 55;
      if (number < 0 || number > 35) return null;
      total += number * weights[index % 3];
    }
    return total % 10;
  }

  function checked(value, digit) {
    return /^\d$/.test(numericMrz(digit)) && checkDigit(value) === Number(numericMrz(digit));
  }

  function mrzExpiryDate(value) {
    const digits = numericMrz(value);
    if (!/^\d{6}$/.test(digits)) return '';
    const fullYear = 2000 + Number(digits.slice(0, 2));
    return dateFromText(`${digits.slice(4, 6)}.${digits.slice(2, 4)}.${fullYear}`);
  }

  function mrzBirthDate(value) {
    const digits = numericMrz(value);
    if (!/^\d{6}$/.test(digits)) return { valid: false, date: '', ambiguous: false };
    const year = Number(digits.slice(0, 2));
    const day = digits.slice(4, 6), month = digits.slice(2, 4);
    const today = new Date();
    const dates = [1900 + year, 2000 + year]
      .map(fullYear => dateFromText(`${day}.${month}.${fullYear}`))
      .filter(date => {
        if (!date) return false;
        const [d, m, y] = date.split('.').map(Number);
        return Date.UTC(y, m - 1, d) <= Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      });
    return { valid: dates.length > 0, date: dates.length === 1 ? dates[0] : '', ambiguous: dates.length > 1 };
  }

  function mrzNames(value) {
    const [last, first] = value.split('<<');
    return { last: clean(last?.replace(/</g, ' ')), first: clean(first?.replace(/</g, ' ')) };
  }

  function mrzLines(text) {
    return String(text || '').split(/\r?\n/).map(line => line.toUpperCase().replace(/[«‹]/g, '<').replace(/[^A-Z0-9<]/g, '')
      // Tesseract occasionally reads the initial I of an ID card as 1.
      .replace(/^1(?=<|[A-Z]{2}<)/, 'I'));
  }

  function normalizedMrzLine(line, expected, trailingCheck = false) {
    if (line.length === expected) return line;
    // OCR frequently loses or duplicates filler characters at the end of a line.
    // Only repair that filler area; never invent characters in checked fields.
    if (Math.abs(line.length - expected) > 3) return '';
    const check = trailingCheck ? line.slice(-1) : '';
    const body = trailingCheck ? line.slice(0, -1) : line;
    const target = expected - (trailingCheck ? 1 : 0);
    if (trailingCheck && !/^[0-9OQDISBL]$/.test(check)) return '';
    if (body.length < target && body.endsWith('<')) return `${body.padEnd(target, '<')}${check}`;
    if (body.length > target && /^<+$/.test(body.slice(target))) return `${body.slice(0, target)}${check}`;
    return '';
  }

  function inspectMrz(text) {
    const lines = mrzLines(text);
    let candidateSeen = false;
    let best = null;
    const accept = (type, checks, fields, ambiguousBirthCentury = false) => {
      const validCount = Object.values(checks).filter(Boolean).length;
      const status = {
        state: validCount === 3 ? 'valid' : 'invalid', type, checks,
        ambiguousBirthCentury,
        issues: [
          ...Object.entries(checks).filter(([, valid]) => !valid).map(([key]) => `mrz-check-${key}`),
          ...(ambiguousBirthCentury ? ['mrz-birth-century-ambiguous'] : [])
        ],
        message: validCount === 3
          ? ambiguousBirthCentury ? 'MRZ-Prüfziffern gültig; das Jahrhundert des Geburtsjahres muss am Original geprüft werden.' : 'MRZ-Prüfziffern gültig.'
          : 'Eine oder mehrere MRZ-Prüfziffern stimmen nicht.'
      };
      const result = { fields: validCount >= 2 ? fields : {}, status, validCount };
      if (!best || result.validCount > best.validCount) best = result;
    };

    // TD1: drei Zeilen mit je 30 Zeichen (Personalausweis).
    for (let index = 0; index < lines.length; index++) {
      const top = lines[index];
      if (!/^[IAC](?:<|[A-Z]{2}<)/.test(top)) continue;
      candidateSeen = true;
      const normalizedTop = normalizedMrzLine(top, 30);
      const middle = normalizedMrzLine(lines[index + 1] || '', 30, true);
      const bottom = normalizedMrzLine(lines[index + 2] || '', 30);
      if (!normalizedTop || !middle || !bottom || !bottom.includes('<<')) continue;
      const fields = mrzNames(bottom);
      // Auf deutschen Ausweisen sind O und I in der Dokumentnummer unzulässig; OCR verwechselt sie oft mit 0 und 1.
      const germanId = normalizedTop.startsWith('IDD');
      const doc = germanId ? normalizedTop.slice(5, 14).replace(/[OQ]/g, '0').replace(/I/g, '1') : normalizedTop.slice(5, 14);
      const birth = numericMrz(middle.slice(0, 6));
      const expiry = numericMrz(middle.slice(8, 14));
      const birthDate = mrzBirthDate(birth);
      const expiryDate = mrzExpiryDate(expiry);
      const checks = {
        document: !!doc.replace(/<+$/, '') && checked(doc, normalizedTop[14]),
        birth: birthDate.valid && checked(birth, middle[6]),
        expiry: !!expiryDate && checked(expiry, middle[14])
      };
      if (checks.document) fields.number = doc.replace(/<+$/, '');
      if (checks.birth && birthDate.date) fields.birth = birthDate.date;
      if (checks.expiry) fields.expiry = expiryDate;
      fields.nationality = germanId ? 'DEU' : middle.slice(15, 18).replace(/</g, '');
      accept('TD1', checks, fields, checks.birth && birthDate.ambiguous);
      if (best?.status.state === 'valid') return best;
    }

    // TD3: zwei Zeilen mit je 44 Zeichen (Reisepass).
    for (let index = 0; index < lines.length; index++) {
      const top = lines[index];
      if (!/^P</.test(top)) continue;
      candidateSeen = true;
      const normalizedTop = normalizedMrzLine(top, 44);
      const bottom = normalizedMrzLine(lines[index + 1] || '', 44, true);
      if (!normalizedTop || !bottom || !normalizedTop.includes('<<')) continue;
      const fields = mrzNames(normalizedTop.slice(5));
      const doc = bottom.slice(0, 9);
      const birth = numericMrz(bottom.slice(13, 19));
      const expiry = numericMrz(bottom.slice(21, 27));
      const birthDate = mrzBirthDate(birth);
      const expiryDate = mrzExpiryDate(expiry);
      const checks = {
        document: !!doc.replace(/<+$/, '') && checked(doc, bottom[9]),
        birth: birthDate.valid && checked(birth, bottom[19]),
        expiry: !!expiryDate && checked(expiry, bottom[27])
      };
      if (checks.document) fields.number = doc.replace(/<+$/, '');
      if (checks.birth && birthDate.date) fields.birth = birthDate.date;
      if (checks.expiry) fields.expiry = expiryDate;
      fields.nationality = bottom.slice(10, 13).replace(/</g, '');
      accept('TD3', checks, fields, checks.birth && birthDate.ambiguous);
      if (best?.status.state === 'valid') return best;
    }
    if (best) return best;
    return {
      fields: {},
      status: {
        state: candidateSeen ? 'invalid' : 'missing', type: null,
        ambiguousBirthCentury: false,
        checks: { document: null, birth: null, expiry: null },
        issues: [candidateSeen ? 'mrz-incomplete' : 'mrz-missing'],
        message: candidateSeen ? 'MRZ-Zeilen sind unvollständig oder nicht lesbar.' : 'MRZ fehlt oder wurde nicht erkannt.'
      },
      validCount: 0
    };
  }

  function fromMrz(text) { return inspectMrz(text).fields; }

  function normalizeStreet(value) {
    const street = clean(value);
    if (/[{}<>\\]/.test(street)) return '';
    const match = street.match(/^([A-Za-zÄÖÜäöüßẞ][A-Za-zÄÖÜäöüßẞ .-]{2,65}?)\s*,?\s*(\d{1,4}[A-Za-z]?)\b/);
    return match ? `${match[1].trim()} ${match[2]}` : '';
  }

  function streetFromLine(value) {
    const line = clean(value);
    const streetWord = /[A-Za-zÄÖÜäöüßẞ-]+(?:strasse|straße|straẞe|str\.?|str\b|weg|platz|allee|gasse|ring|damm|ufer|chaussee|zeile|pfad)\b/i.exec(line);
    if (!streetWord) return '';
    const after = line.slice(streetWord.index + streetWord[0].length);
    // Zeichen wie "{" in einer unsicheren Hausnummer nicht als Ziffer erraten.
    const house = after.match(/^[\s,.;/\-]*(\d{1,4}[A-Za-z]?)(?!\d)/);
    if (!house) return '';
    let start = streetWord.index;
    let before = line.slice(0, start);
    for (let count = 0; count < 2; count++) {
      const previous = before.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüßẞ-]{1,})\s+$/);
      if (!previous || /^(?:cm|mm|datum|date)$/i.test(previous[1])) break;
      start -= previous[0].length;
      before = line.slice(0, start);
    }
    return `${line.slice(start, streetWord.index + streetWord[0].length).trim()} ${house[1]}`;
  }

  function dateOrder(value) {
    const [day, month, year] = String(value || '').split('.').map(Number);
    return year * 10000 + month * 100 + day;
  }

  function visualMentionsName(text, name) {
    if (!name) return false;
    const tokens = name.toUpperCase().split(/\s+/).filter(token => token.length >= 3);
    if (!tokens.length) return false;
    return String(text || '').split(/\r?\n/)
      .filter(line => !looksLikeMrz(line))
      .some(line => tokens.every(token => line.toUpperCase().includes(token)));
  }

  function visualFields(text, side) {
    const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
    const result = {};
    for (const key of Object.keys(labels)) {
      if (key !== 'street') result[key] = labeled(lines, key);
    }
    result.birth = dateFromText(result.birth);
    result.expiry = dateFromText(result.expiry);
    result.nationality = /^deutsch/i.test(result.nationality) ? 'DEU' : result.nationality;
    if (/^nationalit[eé]$/i.test(result.nationality)) result.nationality = '';
    if (/\bDEUTSCH\b/i.test(text)) result.nationality = 'DEU';

    if (side === 'front' && !result.expiry) {
      // Auf der Vorderseite ist das letzte vollständige Datum gewöhnlich "gültig bis".
      // Das Geburtsdatum wird ausgeschlossen; die sichtbaren Angaben bleiben prüfpflichtig.
      const laterDates = lines.map(dateFromText).filter(date => date && date !== result.birth && (!result.birth || dateOrder(date) > dateOrder(result.birth)));
      laterDates.sort((a, b) => dateOrder(b) - dateOrder(a));
      result.expiry = laterDates[0] || '';
    }
    if (side === 'front' && !result.birthplace && result.birth) {
      const birthLine = lines.findIndex(line => dateFromText(line) === result.birth);
      for (let offset = 1; birthLine >= 0 && offset <= 2; offset++) {
        const candidate = clean(lines[birthLine + offset]);
        if (/^[A-ZÄÖÜ][A-ZÄÖÜẞ -]{2,}$/.test(candidate) && !/^(?:DEUTSCH|DEU|GERMAN|GERMANY)$/.test(candidate)) {
          result.birthplace = candidate;
          break;
        }
      }
    }

    // Bei deutschen Ausweisen stehen PLZ/Ort über der Straße, nicht darunter.
    const postalIndex = lines.findIndex(line => /(?:^|\s)(?:D-)?\d{5}\s+[A-Za-zÄÖÜäöüß]/.test(line));
    if (postalIndex >= 0) {
      const match = lines[postalIndex].match(/(?:^|\s)(?:D-)?(\d{5})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s.-]*)/);
      if (match) {
        result.postal = match[1];
        const city = clean(match[2]);
        result.city = /^[A-ZÄÖÜẞ\s-]+\b/.test(city) ? (city.match(/^[A-ZÄÖÜẞ-]+(?:\s+[A-ZÄÖÜẞ-]+)*/)?.[0] || city) : city;
        // Kurze Restzeichen am Ende einer OCR-Zeile stammen häufig von Mustern/Überdruck.
        result.city = result.city.replace(/\s+[A-ZÄÖÜẞ]{1,2}$/, '');
      }
    }
    const streetLabel = lines.findIndex(line => labels.street.test(line));
    const streetCandidates = streetLabel >= 0 ? lines.slice(streetLabel + 1) : lines;
    result.street = streetCandidates.map(streetFromLine).find(Boolean) ||
      streetCandidates.slice(0, 4).map(normalizeStreet).find(line => line && !/^\d{5}\b/.test(line) && !looksLikeMrz(line)) || '';
    if (result.street && /^(?:datum|date|geburtstag|g[uü]ltig)/i.test(result.street)) result.street = '';

    if (side === 'front') {
      const top = lines.slice(0, Math.min(lines.length, 8)).join(' ');
      const number = top.match(/\b(?=[A-Z0-9]{9}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{9}\b/);
      result.number ||= number?.[0] || '';
    }
    result.number = clean(result.number).replace(/\s/g, '').toUpperCase();
    return result;
  }

  function analyze(frontText, backText = '') {
    const front = visualFields(frontText, 'front');
    const back = visualFields(backText, 'back');
    const mrzResult = inspectMrz(`${backText}\n${frontText}`);
    const mrz = mrzResult.fields;
    const trustedMrz = mrzResult.status.state === 'valid';
    const frontMentionsMrzFirst = trustedMrz && visualMentionsName(frontText, mrz.first);
    const frontMentionsMrzLast = trustedMrz && visualMentionsName(frontText, mrz.last);
    const conflicts = [];
    if (front.number && mrz.number && front.number !== mrz.number) conflicts.push('Dokumentnummer');
    if (front.expiry && mrz.expiry && front.expiry !== mrz.expiry) conflicts.push('Gültigkeitsdatum');
    if (front.birth && mrz.birth && front.birth !== mrz.birth) conflicts.push('Geburtsdatum');
    if (trustedMrz && front.first?.length >= 3 && mrz.first && front.first !== mrz.first && !frontMentionsMrzFirst) conflicts.push('Vorname');
    if (trustedMrz && front.last?.length >= 3 && mrz.last && front.last !== mrz.last && !frontMentionsMrzLast) conflicts.push('Nachname');
    const fields = {
      first: frontMentionsMrzFirst ? mrz.first : front.first || mrz.first || back.first || '',
      last: frontMentionsMrzLast ? mrz.last : front.last || mrz.last || back.last || '',
      birth: front.birth || mrz.birth || back.birth || '',
      birthplace: front.birthplace || back.birthplace || '',
      street: back.street || front.street || '',
      postal: back.postal || front.postal || '',
      city: back.city || front.city || '',
      nationality: front.nationality || mrz.nationality || back.nationality || '',
      number: front.number || mrz.number || back.number || '',
      expiry: front.expiry || mrz.expiry || back.expiry || ''
    };
    const fieldStatus = {};
    for (const [key, value] of Object.entries(fields)) {
      const source = front[key] ? 'front' : mrz[key] ? 'mrz' : back[key] ? 'back' : 'none';
      const compared = front[key] && mrz[key] && String(front[key]).toUpperCase() === String(mrz[key]).toUpperCase();
      const checksumKey = key === 'number' ? 'document' : key === 'birth' ? 'birth' : key === 'expiry' ? 'expiry' : null;
      const high = compared && !(key === 'birth' && mrzResult.status.ambiguousBirthCentury) &&
        (checksumKey ? mrzResult.status.checks[checksumKey] : mrzResult.status.state === 'valid');
      fieldStatus[key] = { source, confidence: !value ? 'missing' : high ? 'high' : 'review' };
    }
    return { fields, conflicts, front, back, mrz, mrzStatus: mrzResult.status, fieldStatus };
  }

  function extract(frontText, backText = '') { return analyze(frontText, backText).fields; }

  const api = { extract, analyze, fromMrz, inspectMrz, checkDigit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IdParser = api;
})(typeof window === 'undefined' ? globalThis : window);
