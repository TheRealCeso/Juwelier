const assert = require('node:assert/strict');
const { extract, checkDigit } = require('./id-parser.js');

const labeled = extract(
  'Name / Surname\nMustermann\nVorname / Given name\nMax\nGeburtsdatum: 01.01.1990\nAusweisnummer TEST123456',
  'Anschrift\nMusterstraße 1\n86150 Augsburg\nGültig bis 01.01.2030\nStaatsangehörigkeit DEU'
);
assert.deepEqual(
  [labeled.first, labeled.last, labeled.birth, labeled.street, labeled.postal, labeled.city, labeled.number, labeled.expiry],
  ['Max', 'Mustermann', '01.01.1990', 'Musterstraße 1', '86150', 'Augsburg', 'TEST123456', '01.01.2030']
);

const td1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'
].join('\n');
const id = extract('', td1);
assert.deepEqual([id.first, id.last, id.birth, id.number, id.expiry, id.nationality],
  ['ANNA MARIA', 'ERIKSSON', '12.08.1974', 'D23145890', '15.04.2012', 'UTO']);

const passportTop = 'P<UTOMUSTERMANN<<MAX'.padEnd(44, '<');
const passportNo = 'C01X23456';
const passportBottom = `${passportNo}${checkDigit(passportNo)}DEU900101${checkDigit('900101')}M300101${checkDigit('300101')}`.padEnd(44, '<');
const passport = extract(`${passportTop}\n${passportBottom}`);
assert.deepEqual([passport.first, passport.last, passport.birth, passport.number, passport.expiry],
  ['MAX', 'MUSTERMANN', '01.01.1990', passportNo, '01.01.2030']);

const damaged = extract(`${passportTop}\n${passportBottom.slice(0, 9)}9${passportBottom.slice(10, 19)}9${passportBottom.slice(20, 27)}9${passportBottom.slice(28)}`);
assert.equal(damaged.number, '');
assert.equal(damaged.birth, '');
assert.equal(damaged.last, '');

const { analyze } = require('./id-parser.js');
assert.equal(analyze('', td1).mrzStatus.state, 'valid');
assert.deepEqual(analyze('', td1).mrzStatus.checks, { document: true, birth: true, expiry: true });
assert.equal(analyze('', td1).fieldStatus.number.confidence, 'review', 'Ohne visuellen Abgleich bleibt selbst eine gültige MRZ prüfpflichtig.');
const damagedAnalysis = analyze('', `${passportTop}\n${passportBottom.slice(0, 9)}9${passportBottom.slice(10, 19)}9${passportBottom.slice(20, 27)}9${passportBottom.slice(28)}`);
assert.equal(damagedAnalysis.mrzStatus.state, 'invalid');
assert.ok(damagedAnalysis.mrzStatus.issues.includes('mrz-check-document'));
assert.equal(analyze('', 'IDD<<ABCD').mrzStatus.issues[0], 'mrz-incomplete');
assert.equal(analyze('Kein maschinenlesbarer Text').mrzStatus.state, 'missing');
const impossibleBirth = '991332';
const invalidDateBottom = `${passportNo}${checkDigit(passportNo)}DEU${impossibleBirth}${checkDigit(impossibleBirth)}M300101${checkDigit('300101')}`.padEnd(44, '<');
assert.equal(analyze(`${passportTop}\n${invalidDateBottom}`).mrzStatus.checks.birth, false, 'Eine gültige Prüfziffer darf ein unmögliches Datum nicht freigeben.');
const germanFront = 'LZ6311T47\n[a] Name/Surname/Nom\n[a] MUSTERMANN\n[b] GABLER\nVornamen/Given names/Prénoms\nERIKA\nGeburtstag/Date of birth\n12.08.1983\nGeburtsort/Place of birth\nBERLIN\nStaatsangehörigkeit/Nationality\nDEUTSCH\nGültig bis/Date of expiry\n01.05.2034';
const germanBack = 'Anschrift/Address/Adresse\n51147 KÖLN\nHEIDESTRASSE, 17\nIDD<<LOIXOOT471<<<<<<<<<<<<<<<\n8308126<3108011D<<2108<<<<<<<7\nMUSTERMANN<<ERIKA<<<<<<<<<<<<<';
const german = analyze(germanFront, germanBack);
assert.deepEqual([german.fields.first, german.fields.last, german.fields.birth, german.fields.birthplace, german.fields.street, german.fields.postal, german.fields.city, german.fields.nationality],
  ['ERIKA', 'MUSTERMANN', '12.08.1983', 'BERLIN', 'HEIDESTRASSE 17', '51147', 'KÖLN', 'DEU']);
assert.equal(german.mrz.number, 'L01X00T47');
assert.deepEqual(german.conflicts, ['Dokumentnummer', 'Gültigkeitsdatum']);
assert.equal(german.mrzStatus.state, 'valid');
assert.equal(german.fieldStatus.number.confidence, 'review');
assert.equal(german.fieldStatus.birth.confidence, 'high');

// Rohes Tesseract-Ergebnis der beiden vom Nutzer bereitgestellten Ausweisabbildungen.
const noisyFront = `Dokumentnummer
LZ6311T47
[ID] Goburtensnsertbanne ob bith Nols de eitenence
fIMUSTERMANN                 LA ie
[IGABLER                  UND
Vornamen/Given names/Prenoms > A A N
ERIKA          > RES
Geburtstag/Date ot nav  _Steatsangehorigkeit/Nationality/
12,08.1 983 DEUTSCH
BERLIN
ge
01.05.2034     938568`;
const noisyBack = `Anschrift/Address/Adresse y
51147 KÖLN ip
HEIDESTRASSE,{2 \\
160 cm ı HEIDESTRASSE, 17. 2 =
IDD<<LOIXOOT471<<<<<<<<<<<<<<<
8308126<3108011D<<2108<<<<<<<7
MUSTERMANN<<ERIKA<<<<<<<<<<<<<`;
const noisy = analyze(noisyFront, noisyBack);
assert.deepEqual([noisy.fields.first, noisy.fields.last, noisy.fields.birth, noisy.fields.street, noisy.fields.postal, noisy.fields.city, noisy.fields.number, noisy.fields.expiry],
  ['ERIKA', 'MUSTERMANN', '12.08.1983', 'HEIDESTRASSE 17', '51147', 'KÖLN', 'LZ6311T47', '01.05.2034']);
assert.equal(noisy.mrz.number, 'L01X00T47');
assert.deepEqual(noisy.conflicts, ['Dokumentnummer', 'Gültigkeitsdatum']);

console.log('OCR-Feldextraktion, MRZ-Prüfstatus und Seitenabgleich: 11 Fälle bestanden.');
