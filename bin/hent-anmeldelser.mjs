/*
 * Henter Google-anmeldelsene til Vestfold Bilsalg og lagrer dem i
 * anmeldelser.json – bare dem med 5 stjerner, slik eieren vil ha det.
 *
 * Kjøres av GitHub Actions én gang i døgnet (se .github/workflows/
 * anmeldelser.yml). Nettsiden er statisk, så det finnes ingen server som
 * kan spørre Google i det øyeblikket noen åpner siden; fila er «serveren».
 *
 * Ingen nøkkel: GitHub Actions henter et kortlevd Google-token via Workload
 * Identity (google-github-actions/auth) og sender det som GOOGLE_ACCESS_TOKEN,
 * sammen med GOOGLE_PROJECT (prosjektet som faktureres). Se
 * .github/workflows/anmeldelser.yml.
 *
 * Google gir maks fem anmeldelser per oppslag. Vi tar vare på dem vi har
 * sett før, så lista vokser over tid selv om Google bare viser de fem
 * «mest relevante» hver gang.
 */
import { readFile, writeFile } from 'node:fs/promises';

const FIL = new URL('../anmeldelser.json', import.meta.url);
const TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const PROSJEKT = process.env.GOOGLE_PROJECT;
const SOK = 'Vestfold Bilsalg, Andebuveien 63, 3170 Sem';

if (!TOKEN || !PROSJEKT) {
  console.error('GOOGLE_ACCESS_TOKEN og GOOGLE_PROJECT må være satt');
  process.exit(1);
}

let gammel = { sted_id: null, anmeldelser: [] };
try { gammel = JSON.parse(await readFile(FIL, 'utf8')); } catch {}

async function google(sti, felter, body) {
  const svar = await fetch('https://places.googleapis.com/v1/' + sti, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOKEN,
      'X-Goog-User-Project': PROSJEKT,
      'X-Goog-FieldMask': felter,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!svar.ok) throw new Error(sti + ' → ' + svar.status + ' ' + (await svar.text()).slice(0, 300));
  return svar.json();
}

// ── Finn stedet én gang ─────────────────────────────────────────────
let stedId = gammel.sted_id;
if (!stedId) {
  const r = await google('places:searchText', 'places.id,places.displayName,places.formattedAddress',
    { textQuery: SOK, languageCode: 'nb' });
  const treff = (r.places || [])[0];
  if (!treff) throw new Error('Fant ikke stedet: ' + SOK);
  stedId = treff.id;
  console.log('Sted:', treff.displayName?.text, '–', treff.formattedAddress, '–', stedId);
}

// ── Hent vurdering og anmeldelser ───────────────────────────────────
const sted = await google('places/' + stedId + '?languageCode=nb',
  'rating,userRatingCount,reviews');

const nye = (sted.reviews || [])
  .filter(a => a.rating === 5)
  .map(a => ({
    id: a.name,
    navn: a.authorAttribution?.displayName || 'Google-bruker',
    bilde: a.authorAttribution?.photoUri || null,
    profil: a.authorAttribution?.uri || null,
    tekst: (a.text?.text || a.originalText?.text || '').trim(),
    tid: a.relativePublishTimeDescription || '',
    publisert: a.publishTime || null,
  }));

// Slå sammen med dem vi hadde fra før (samme id = samme anmeldelse).
const alle = new Map((gammel.anmeldelser || []).map(a => [a.id, a]));
for (const a of nye) alle.set(a.id, a);
const liste = [...alle.values()]
  .filter(a => a.tekst)
  .sort((a, b) => String(b.publisert || '').localeCompare(String(a.publisert || '')));

const ut = {
  oppdatert: gammel.oppdatert || null,
  sted_id: stedId,
  vurdering: sted.rating ?? null,
  antall: sted.userRatingCount ?? null,
  anmeldelser: liste,
};

// Bare skriv (og dermed committ) når innholdet faktisk er nytt – ellers
// ville tidsstempelet gitt en ny commit og et nytt Pages-bygg hver natt.
const { oppdatert: _a, ...nyUten } = ut;
const { oppdatert: _b, ...gammelUten } = gammel;
if (JSON.stringify(nyUten) === JSON.stringify(gammelUten)) {
  console.log('Ingen endring i anmeldelsene.');
  process.exit(0);
}
ut.oppdatert = new Date().toISOString();
await writeFile(FIL, JSON.stringify(ut, null, 2) + '\n');
console.log(`Lagret ${liste.length} anmeldelser (${sted.rating} av 5, ${sted.userRatingCount} totalt).`);
