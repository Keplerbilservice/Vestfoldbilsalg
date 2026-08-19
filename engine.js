// engine.js — datamodell og forretningslogikk for produksjons- og lagersystemet
// Registrerer også window.KeplerEngine slik at den bundlede index.html (uten modul-oppløsning) kan bruke motoren.
const KEY = 'kjemiprod_db_v1';
export const uid = () => Math.random().toString(36).slice(2, 9);
export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, d) => { const t = new Date(iso); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
export const addMonths = (iso, m) => { const t = new Date(iso); t.setMonth(t.getMonth() + m); return t.toISOString().slice(0, 10); };
export const fmtDate = iso => iso ? iso.slice(0, 10).split('-').reverse().join('.') : '–';
export const fmtNum = n => (n == null || isNaN(n)) ? '–' : Number(n).toLocaleString('nb-NO', { maximumFractionDigits: 1 });
export const fmtNok = n => 'kr ' + Math.round(n).toLocaleString('nb-NO') + ',-';
export const daysUntil = iso => iso ? Math.round((new Date(iso) - new Date(today())) / 86400000) : null;

export function load() {
  try { const s = localStorage.getItem(KEY); if (s) { const db = JSON.parse(s); if (db.v === 1) { seedTest(db); importOrders(db); importOrders2(db); importHms(db); importRecipes(db); importGoods(db); importLocs(db); cleanFiction(db); noteBaypure(db); fixPrices(db); autoPlan(db); ensureTestStock(db); return db; } } } catch (e) { }
  const db = seed(); seedTest(db); importOrders(db); importOrders2(db); importHms(db); importRecipes(db); importGoods(db); importLocs(db); cleanFiction(db); noteBaypure(db); fixPrices(db); autoPlan(db); ensureTestStock(db); persist(db); return db;
}
// priser som manglet: fra reseptfilene, og vann settes til 5 øre per liter
function fixPrices(db) {
  if (db.pricesFixed === 2) return;
  db.pricesFixed = 2;
  // MOQ på handelsvarene = opprinnelig bestilt kvantum (fra PI-ene)
  (db.goods || []).forEach(g => { if (g.moq == null && g.max) g.moq = Math.round(g.max / 2); });
  const set = { 'INT-VANN': 0.05, 'BRE-29357': 17, 'BRE-21610': 23.2 };
  db.rawMaterials.forEach(r => {
    if (set[r.sku] != null && (!r.price || r.sku === 'INT-VANN')) { r.price = set[r.sku]; r.comment = (r.comment || '').replace(' – pris ikke bekreftet', '') + (r.sku === 'INT-VANN' ? '' : '. Pris fra reseptfil'); }
  });
  persist(db);
}
// Baypure CX 100 kan erstattes med Dissolvine GL 47 S – merknad på alle oppskriftslinjer
function noteBaypure(db) {
  if (db.baypureNoted) return;
  db.baypureNoted = true;
  const bp = db.rawMaterials.find(r => r.sku === 'VEN-63000');
  if (!bp) return;
  const note = 'Kan erstattes med Dissolvine GL 47 S';
  let n = 0;
  db.recipes.forEach(rc => rc.lines.forEach(l => {
    if (l.rawId === bp.id && (l.note || '').indexOf('Dissolvine') === -1) { l.note = l.note ? l.note + '. ' + note : note; n++; }
  }));
  bp.comment = (bp.comment ? bp.comment + '. ' : '') + note;
  if (n) { audit(db, 'Import', 'Oppdaterte oppskrifter', 'Merknad på ' + n + ' Baypure-linjer: kan erstattes med Dissolvine GL 47 S'); persist(db); }
}
// Fjerner all fiktiv demo-informasjon – kun reelle data fra brukerens dokumenter beholdes
function cleanFiction(db) {
  // VETRO SOL-produktene: Graphene, Borophene og Pure Grade + Tuf Kote som Antirust
  if (!db.vetroNamed2) {
    db.vetroNamed2 = true;
    const nm = { 'MT-30ML': 'Graphene keramisk coating 30 ml', 'MT-50ML': 'Borophene keramisk coating 50 ml', 'VS-50ML': 'Pure Grade keramisk coating 50 ml' };
    (db.goods || []).forEach(g => {
      if (nm[g.sku]) g.name = nm[g.sku];
      if (g.supplier === 'Tuf Kote Automotive Pvt Ltd') g.category = 'Antirust';
    });
    db.goodsCats = db.goodsCats || [];
    if ((db.goods || []).some(g => g.category === 'Antirust') && !db.goodsCats.includes('Antirust')) db.goodsCats.push('Antirust');
    db.goodsCats = db.goodsCats.filter(c => c !== 'Understellsbehandling' || (db.goods || []).some(g => g.category === 'Understellsbehandling'));
    persist(db);
  }
  if (!db.vetroNamed3) {
    db.vetroNamed3 = true;
    (db.goods || []).forEach(g => { if (/clip|klips/i.test(g.name) || g.sku === 'ZT-CLIP') g.category = 'Klips'; });
    db.goodsCats = db.goodsCats || [];
    if ((db.goods || []).some(g => g.category === 'Klips') && !db.goodsCats.includes('Klips')) db.goodsCats.push('Klips');
    db.goodsCats = db.goodsCats.filter(c => c !== 'Diverse' || (db.goods || []).some(g => g.category === 'Diverse'));
    persist(db);
  }
  // én varelinje per klipstype (5, 10 og 22 mm) – fordeling ukjent, justeres ved telling
  if (!db.clipsSplit) {
    db.clipsSplit = true;
    const old = (db.goods || []).find(g => g.sku === 'ZT-CLIP');
    if (old) {
      db.goods = db.goods.filter(g => g.sku !== 'ZT-CLIP');
      [['ZT-CLIP-5', 'Plastklips nylon 5 mm', 1667], ['ZT-CLIP-10', 'Plastklips nylon 10 mm', 1667], ['ZT-CLIP-22', 'Plastklips nylon 22 mm', 1666]].forEach(([sku, name, qty]) => {
        db.goods.push({ ...old, id: uid(), sku, name, stock: qty, min: 300, max: 3400, moq: 1700, comment: 'Fordeling av 5000 stk ukjent – juster ved telling' });
      });
    }
    persist(db);
  }
  // varelinjer fra skannet PI 2025090202 som manglet
  if (!db.importedGoods2) {
    db.importedGoods2 = true;
    const ZT2 = 'Shanghai Zhentian Polyurethane Co., Ltd';
    db.goodsCats = db.goodsCats || [];
    [['Mikrofiberkluter', 'Microfiber Glass cloth 400×300 mm', 'ZT567', 'stk', 1000, 0.25],
     ['Verktøy og tilbehør', 'Mini Detail Dusters vindu/bil 260 mm', 'ZT568', 'stk', 1000, 0.097],
     ['Svamper og puter', 'EVA applikatorpute sort 90×40×25 mm', 'ZT526', 'stk', 10000, 0.14],
     ['Svamper og puter', 'Mikrofiber vaskesvamp coral/mesh 240×120×50 mm', 'ZT510', 'stk', 1000, 0.46],
     ['Mikrofiberkluter', 'Tørkehåndkle Twist Pile 900×700 mm 600 g', 'ZT569', 'stk', 500, 1.13],
     ['Verneutstyr', 'Vernedress PP+EPTFE str. XXXXL', 'ZT548-XXXXL', 'stk', 1000, 1.29]].forEach(([category, name, sku, unit, qty, usd]) => {
      if (db.goods.some(g => g.sku === sku)) return;
      if (!db.goodsCats.includes(category)) db.goodsCats.push(category);
      db.goods.push({ id: uid(), name, sku, category, unit, stock: qty, min: Math.max(2, Math.round(qty * 0.2)), max: qty * 2, moq: qty, price: Math.round(usd * 10.2 * 100) / 100, supplier: ZT2, locId: 'l6', leadDays: 60, status: 'Aktiv' });
      db.movements.unshift({ id: uid(), date: today(), itemType: 'Handelsvare', item: name, batch: 'PI2025090202', before: 0, change: qty, after: qty, reason: 'Varemottak – PI 2025090202 (Shanghai Zhentian)', user: 'Import' });
    });
    persist(db);
  }
  // PI 2026040601 + sjøfrakt SHASE2605184 (skipet 31.05.2026): 10 000 ZT505 + 15 000 ZT507 à $0,25
  if (!db.importedGoods3) {
    db.importedGoods3 = true;
    [['ZT505', 10000], ['ZT507', 15000]].forEach(([sku, qty]) => {
      const g = (db.goods || []).find(x => x.sku === sku);
      if (!g) return;
      db.movements.unshift({ id: uid(), date: '2026-07-01', itemType: 'Handelsvare', item: g.name, batch: 'PI2026040601', before: g.stock, change: qty, after: g.stock + qty, reason: 'Varemottak – PI 2026040601 / SHASE2605184 (Shanghai Zhentian)', user: 'Import' });
      g.stock += qty; g.price = Math.round(0.25 * 10.2 * 100) / 100; g.max = Math.max(g.max, g.stock * 2); g.min = Math.round(g.stock * 0.2); g.moq = qty;
    });
    persist(db);
  }
  // klips fra tre PI-er (2024090501, 2025020502, 2025032402) – én varelinje per klipstype
  if (!db.importedClips) {
    db.importedClips = true;
    db.goods = (db.goods || []).filter(g => !['ZT-CLIP-5', 'ZT-CLIP-10', 'ZT-CLIP-22'].includes(g.sku));
    const ZT3 = 'Shanghai Zhentian Polyurethane Co., Ltd';
    db.goodsCats = db.goodsCats || [];
    if (!db.goodsCats.includes('Klips')) db.goodsCats.push('Klips');
    const rows = [
      // [sku, navn, antall, USD, PI, mottatt]
      ['KLIPS-01', 'Klips nylon 20×20×26 mm (Item 1)', 7500, 0.0117, '2024090501', '2024-10-15'],
      ['KLIPS-02', 'Klips nylon 18×18×27,9 mm (Item 2)', 7500, 0.03, '2024090501', '2024-10-15'],
      ['KLIPS-03', 'Klips nylon 17,8×17,8×28,3 mm (Item 3)', 7500, 0.0133, '2024090501', '2024-10-15'],
      ['KLIPS-06', 'Klips nylon 20,2×20,2×55 mm (Item 6)', 7500, 0.0333, '2024090501', '2024-10-15'],
      ['KLIPS-07', 'Klips nylon 18×18×10 mm (Item 7)', 7500, 0.015, '2024090501', '2024-10-15'],
      ['KLIPS-08', 'Klips nylon 20×20×22,5 mm (Item 8)', 7500, 0.013, '2024090501', '2024-10-15'],
      ['KLIPS-09', 'Klips nylon 16,3×16,3×34,8 mm (Item 9)', 7500, 0.025, '2024090501', '2024-10-15'],
      ['KLIPS-10', 'Klips nylon 19,8×19,8×30 mm (Item 10)', 7500, 0.0133, '2024090501', '2024-10-15'],
      ['KLIPS-11', 'Klips nylon 16×16×28 mm (Item 11)', 7500, 0.0153, '2024090501', '2024-10-15'],
      ['KLIPS-12', 'Klips nylon 19,5×19,5×30 mm (Item 12)', 7500, 0.012, '2024090501', '2024-10-15'],
      ['KLIPS-16', 'Klips nylon 18,5×18,5×37 mm (Item 16)', 7500, 0.015, '2024090501', '2024-10-15'],
      ['KLIPS-18', 'Klips nylon 10×10×28 mm (Item 18)', 7500, 0.0142, '2024090501', '2024-10-15'],
      ['KLIPS-05', 'Klips nylon 16,3×16,3×35,7 mm (Item 5)', 7500, 0.0333, '2025020502', '2025-03-30'],
      ['KLIPS-13', 'Klips nylon 19,8×19,8×17 mm (Item 13)', 7500, 0.02, '2025020502', '2025-03-30'],
      ['KLIPS-14', 'Klips nylon 16,1×16,1×33,7 mm (Item 14)', 7500, 0.0167, '2025020502', '2025-03-30'],
      ['KLIPS-15', 'Klips nylon 19,5×19,5×22 mm (Item 15)', 7500, 0.013, '2025020502', '2025-03-30'],
      ['KLIPS-17', 'Klips nylon 15×15×44,3 mm (Item 17)', 7500, 0.0367, '2025020502', '2025-03-30'],
      ['KLIPS-20', 'Klips nylon 15,5×15,5×32 mm (Item 20)', 7500, 0.0167, '2025020502', '2025-03-30'],
      ['KLIPS-21', 'Klips nylon 13,8×13,8×15 mm (Item 21)', 7500, 0.0147, '2025020502', '2025-03-30'],
      ['KLIPS-POM', 'Klips POM-plast 34×20×20 mm', 7500, 0.038, '2025032402', '2025-04-15'],
      ['KLIPS-NYL35', 'Klips nylon 35×35×25 mm', 7500, 0.03, '2025032402', '2025-04-15'],
      ['KLIPS-STAL', 'Klips rustfritt stål 26,6×29,4 mm', 7500, 0.04, '2025032402', '2025-04-15'],
      ['KLIPS-GUMMI', 'Plugg gummi 12,8×12,8×9,2 mm', 20000, 0.03, '2025032402', '2025-04-15'],
    ];
    rows.forEach(([sku, name, qty, usd, pi, date]) => {
      if (db.goods.some(g => g.sku === sku)) return;
      db.goods.push({ id: uid(), name, sku, category: 'Klips', unit: 'stk', stock: qty, min: Math.round(qty * 0.2), max: qty * 2, moq: qty, price: Math.round(usd * 10.2 * 1000) / 1000, supplier: ZT3, locId: 'l6', leadDays: 60, status: 'Aktiv' });
      db.movements.unshift({ id: uid(), date, itemType: 'Handelsvare', item: name, batch: 'PI' + pi, before: 0, change: qty, after: qty, reason: 'Varemottak – PI ' + pi + ' (Shanghai Zhentian)', user: 'Import' });
    });
    persist(db);
  }
  // produktbilder hentet fra leverandørkatalogen
  if (!db.goodsImgs) {
    db.goodsImgs = true;
    const avail = ['ZT501', 'ZT502', 'ZT503', 'ZT504', 'ZT505', 'ZT506', 'ZT507', 'ZT508', 'ZT509', 'ZT510', 'ZT511', 'ZT512', 'ZT513', 'ZT514', 'ZT515', 'ZT516', 'ZT517', 'ZT518', 'ZT525', 'ZT526', 'ZT527', 'ZT528', 'ZT529', 'ZT530', 'ZT531', 'ZT532', 'ZT533', 'ZT534', 'ZT535', 'ZT536', 'ZT537', 'ZT538', 'ZT539', 'ZT540', 'ZT541', 'ZT542', 'ZT543', 'ZT544', 'ZT545', 'ZT546', 'ZT547', 'ZT548'];
    (db.goods || []).forEach(g => {
      const base = (g.sku || '').split('-').slice(0, 1)[0];
      const key = avail.includes(g.sku) ? g.sku : (avail.includes(base) ? base : null);
      if (key) g.img = 'uploads/produktbilder/' + key + '.png';
    });
    persist(db);
  }
  // Dissolvine GL 47 S (GLDA-4Na 47 %) – godkjent erstatning for Baypure CX 100, med datablad
  if (!db.dissolvineAdded) {
    db.dissolvineAdded = true;
    if (!db.rawMaterials.some(r => r.sku === 'NY-GLDA')) {
      db.rawMaterials.push({ id: uid(), name: 'Dissolvine GL 47 S (GLDA-4Na 47 %)', sku: 'NY-GLDA', supplier: '', price: 0, unit: 'kg', stock: 0, min: 0, max: 0, orderPoint: 0, orderQty: 0, leadDays: 7, shelfMonths: 36, expiry: '', locId: 'l1', hms: null, tds: { name: 'Datasheet GLDA-4Na 47 % (03.02.2023)', date: today(), url: 'uploads/datasheet-glda.pdf' }, comment: 'Erstatning for Baypure CX 100/34', status: 'Aktiv' });
    }
    persist(db);
  }
  // Baypure-erstatningen er GLDA-4Na 47 % (Dissolvine GL 47 S) – oppdater merknaden i alle oppskrifter
  if (!db.baypureNoted2) {
    db.baypureNoted2 = true;
    const bp2 = db.rawMaterials.find(r => r.sku === 'VEN-63000');
    const newNote = 'Kan erstattes med GLDA-4Na 47 % (Dissolvine GL 47 S)';
    if (bp2) {
      db.recipes.forEach(rc => rc.lines.forEach(l => {
        if (l.rawId === bp2.id) l.note = (l.note || '').indexOf('Dissolvine') >= 0 ? (l.note.replace(/Kan erstattes med Dissolvine GL 47 S/g, newNote)) : (l.note ? l.note + '. ' + newNote : newNote);
      }));
      bp2.comment = (bp2.comment || '').replace('Kan erstattes med Dissolvine GL 47 S', newNote);
    }
    persist(db);
  }
  // kategoriopprydding: Svamper og Poleringsputer som egne kategorier
  if (!db.catSplit) {
    db.catSplit = true;
    (db.goods || []).forEach(g => {
      if (/pute/i.test(g.name)) g.category = 'Poleringsputer';
      else if (/svamp|sponge/i.test(g.name)) g.category = 'Svamper';
      else if (g.category === 'Svamper og puter') g.category = 'Svamper';
    });
    db.goodsCats = db.goodsCats || [];
    ['Svamper', 'Poleringsputer'].forEach(c => { if (!db.goodsCats.includes(c)) db.goodsCats.push(c); });
    db.goodsCats = db.goodsCats.filter(c => c !== 'Svamper og puter');
    persist(db);
  }
  // bildefiks: katalogens ZT541–ZT548 er klips – fjern feilkoblede bilder fra svamper/puter/verneutstyr
  if (!db.goodsImgsFix) {
    db.goodsImgsFix = true;
    const bad = ['ZT537', 'ZT538', 'ZT539', 'ZT540', 'ZT541', 'ZT542', 'ZT543', 'ZT544', 'ZT545', 'ZT546', 'ZT547', 'ZT548'];
    (db.goods || []).forEach(g => {
      const base = (g.sku || '').split('-')[0];
      if (g.img && bad.includes(base)) delete g.img;
    });
    persist(db);
  }
  if (!db.goodsImgsFix2) {
    db.goodsImgsFix2 = true;
    // kun visuelt verifiserte bilder beholdes
    const okImgs = ['ZT504', 'ZT505', 'ZT526', 'ZT533', 'ZT534', 'ZT535', 'ZT536'];
    (db.goods || []).forEach(g => {
      const base = (g.sku || '').split('-')[0];
      if (g.img && !okImgs.includes(base)) delete g.img;
    });
    persist(db);
  }
  // WilSil 350 = Wacker AK350 – merk råvaren og oppskriftslinjene
  if (!db.wilsilNoted) {
    db.wilsilNoted = true;
    const ws2 = db.rawMaterials.find(r => r.sku === 'DYC-1040102');
    if (ws2) {
      ws2.name = 'WilSil 350 (= Wacker AK350)';
      ws2.comment = (ws2.comment ? ws2.comment + '. ' : '') + 'Wacker AK350 er samme produkt';
      const note = 'Wacker AK350 er samme produkt som WilSil 350';
      db.recipes.forEach(rc => rc.lines.forEach(l => {
        if (l.rawId === ws2.id && (l.note || '').indexOf('AK350') === -1) l.note = l.note ? l.note + '. ' + note : note;
      }));
    }
    persist(db);
  }
  if (db.cleanedFiction === 3) return;
  const v3only = db.cleanedFiction === 2;
  const firstRun = !db.cleanedFiction;
  db.cleanedFiction = 3;
  // demo-handelsvarer og -leverandører fra første versjon
  db.goods = (db.goods || []).filter(g => !/^HV-20\d\d$/.test(g.sku || ''));
  db.suppliers = (db.suppliers || []).filter(s => !['Norengros', 'Würth Norge', 'RPC Promens'].includes(s.name));
  if (db.goodsCats) db.goodsCats = db.goodsCats.filter(c => c !== 'Reservedeler' || db.goods.some(g => g.category === 'Reservedeler'));
  if (v3only) { persist(db); return; }
  // VETRO SOL og MIRROR TOUCH er samme leverandør
  db.suppliers = (db.suppliers || []).filter(s => s.name !== 'MIRROR TOUCH');
  const vs = db.suppliers.find(s => s.name === 'VETRO SOL');
  if (vs) vs.note = 'Mumbai, India – keramisk/graphene coating. Merkene VETRO SOL og MIRROR TOUCH. www.vetrosol.com · www.mirrortouch.com';
  (db.goods || []).forEach(g => { if (g.supplier === 'MIRROR TOUCH') g.supplier = 'VETRO SOL'; });
  if (!firstRun) { persist(db); return; }
  // sitronsyren: kun det reelle mottaket fra ordre 80058
  const cit = db.rawMaterials.find(r => r.sku === 'RV-1003');
  if (cit) { cit.stock = 50; cit.supplier = 'Vendico Chemical AB'; cit.price = 18.3; cit.min = 10; cit.max = 100; cit.orderPoint = 15; cit.orderQty = 50; cit.comment = 'Ordre 80058'; }
  // emballasje: behold IBC (trengs for tanketømming) og Ivar Holte-varene
  db.packaging = db.packaging.filter(p => p.type === 'IBC' || p.supplier === 'Ivar Holte AS');
  const ibcP = db.packaging.find(p => p.type === 'IBC');
  if (ibcP) { ibcP.supplier = ''; ibcP.comment = 'Juster beholdning av tomme IBC til det reelle antallet'; }
  // kun reelle leverandører, med riktig Brenntag-kontakt
  const keep = ['Vendico Chemical AB', 'Brenntag Nordic', 'DYC Industrier AS', 'Ivar Holte AS', 'Shanghai Zhentian Polyurethane Co., Ltd', 'VETRO SOL', 'MIRROR TOUCH', 'Tuf Kote Automotive Pvt Ltd'];
  db.suppliers = (db.suppliers || []).filter(s => keep.includes(s.name));
  const br = db.suppliers.find(s => s.name === 'Brenntag Nordic');
  if (br) Object.assign(br, { contact: 'Maria Helene Falch', phone: '+47 69 10 25 21', email: 'norge.order@brenntag-nordic.com', note: 'Kalnesveien 1, 1712 Grålum. Betaling 14 dager netto, DDP Sem' });
  // fiktive IBC-er, historikk og demo-transaksjoner
  db.ibcs = db.ibcs.filter(i => !/^i\d+$/.test(i.id));
  db.tappings = (db.tappings || []).filter(t => !/^tp\d+$/.test(t.id));
  db.movements = (db.movements || []).filter(m => m.user === 'Import');
  db.purchases = []; db.orders = []; db.counts = [];
  db.audit = (db.audit || []).filter(a => a.user === 'Import');
  db.finished = db.finished.filter(f => db.packaging.some(p => p.id === f.packId));
  db.productions = db.productions.filter(p => db.products.some(x => x.id === p.productId));
  db.tanks.forEach(t => { t.note = ''; if (t.productionId && !db.productions.some(p => p.id === t.productionId)) { t.productionId = null; t.status = 'Ledig'; } });
  audit(db, 'Import', 'Fjernet fiktiv demo-informasjon', 'Kun reelle varer, leverandører, oppskrifter og bevegelser beholdt');
  persist(db);
}
// Kepler sine faktiske lagerlokasjoner
function importLocs(db) {
  if (db.importedLocs === 4) return;
  db.importedLocs = 4;
  const names = {
    l1: 'Kjemifabrikken / Hovedlager', l2: 'Kjemifabrikken / Sidelager', l3: 'Kjemifabrikken / Hems',
    l6: 'Bilpleiehallen / Vaskehall', l7: 'Bilpleiehallen / Hems vaskehall', l9: 'Bilpleiehallen / Verksted lager',
    l4: 'Hovedlager', l5: 'Hovedlager / Lite lager',
    l8: 'Antirustlager',
  };
  // gjenbruk de gamle id-ene så alle varereferanser peker riktig, og fjern duplikater fra første import
  db.locations = db.locations.filter(l => names[l.id]);
  Object.keys(names).forEach(id => {
    const l = db.locations.find(x => x.id === id);
    if (l) { l.name = names[id]; l.note = ''; }
    else db.locations.push({ id, name: names[id], note: '' });
  });
  // emballasje hører hjemme på sidelageret, ikke i antirusthallen
  db.packaging.forEach(p => { if (p.locId === 'l8') p.locId = 'l2'; });
  audit(db, 'Import', 'Ryddet lokasjoner', 'Kun de 8 reelle lokasjonene beholdt (Kjemifabrikken og Kepler)');
  persist(db);
}
// Varemottak fra ordrebekreftelser (Vendico 80058/80911, Brenntag 11554949/11553729/11537981/11537978, DYC 5547) – alle allerede på lager
function importOrders(db) {
  if (db.importedOrders) return;
  db.importedOrders = true;
  db.suppliers = db.suppliers || [];
  const addSup = (name, contact, phone, email) => { if (!db.suppliers.some(s => s.name === name)) db.suppliers.push({ id: uid(), name, contact, phone, email, note: '' }); };
  addSup('Vendico Chemical AB', 'Pamela Mattsson', '+46 40 98 85 00', 'order@vendico.se');
  addSup('DYC Industrier AS', 'Maurice Velterop', '944 11 472', 'info@dycas.no');
  const rows = [
    // [navn, sku, kg, pris/kg, leverandør, ordre, mottatt]
    ['Baypure CX 100/34', 'VEN-63000', 520, 32.7, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Lialet 111-3', 'VEN-14210', 190, 52.2, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Lialet 111-5,5', 'VEN-14211', 400, 48, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Mackam CAB 818', 'VEN-38025', 200, 32.2, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Mackam DP-122', 'VEN-38114', 400, 42.7, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Marlinat 242/28', 'VEN-13003-C', 1000, 14.7, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Silikonemulsion E 1 P', 'VEN-75080', 200, 73, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Simulsol AS48', 'VEN-20300', 200, 54.9, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['WMB Solv 06', 'VEN-75045', 175, 75.9, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Mackamine CS', 'VEN-38098', 200, 32.9, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Na-Glukonat', 'VEN-76066', 300, 19.5, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Parfym Apple Flower SC15425', 'VEN-76007', 25, 384, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Hansa Care 7120', 'VEN-48042', 30, 97.3, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Hansa Care 7920', 'VEN-48043', 30, 73.2, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Hansa Care 8140 D', 'VEN-48047', 120, 70.5, 'Vendico Chemical AB', '80058', '2026-04-30'],
    ['Addpol Green NGL', 'VEN-25472', 25, 500, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Addpol Blue', 'VEN-25473', 25, 500, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Addpol Pink AL', 'VEN-25474', 25, 500, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Hansa Care HTC', 'VEN-48041', 30, 383, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Saboderm SHO MB', 'VEN-49009', 200, 34.06, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Thiocare C 102L 46 %', 'VEN-75041', 250, 55.8, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Hansa Care 2020 D', 'VEN-48036', 120, 144.84, 'Vendico Chemical AB', '80911', '2026-07-29'],
    ['Butylglykol', 'BRE-5513', 185, 44.4, 'Brenntag Nordic', '11554949', '2026-06-24'],
    ['Brennsol D 60', 'BRE-21463', 2361, 20.6, 'Brenntag Nordic', '11553729', '2026-06-23'],
    ['Natriumhydroksid perler', 'BRE-29357', 1200, 0, 'Brenntag Nordic', '11537981', '2026-03-23'],
    ['Arcosolv DPM', 'BRE-6239', 380, 0, 'Brenntag Nordic', '11537978', '2026-03-23'],
    ['Isopropylalkohol', 'BRE-21610', 165, 0, 'Brenntag Nordic', '11537978', '2026-03-23'],
    ['WilSil 350', 'DYC-1040102', 200, 108.16, 'DYC Industrier AS', '5547', '2026-03-17'],
  ];
  rows.forEach(([name, sku, qty, price, supplier, order, date]) => {
    if (db.rawMaterials.some(r => r.sku === sku)) return;
    db.rawMaterials.push({
      id: uid(), name, sku, supplier, price, unit: 'kg', stock: qty,
      min: Math.max(5, Math.round(qty * 0.2)), max: qty * 2, orderPoint: Math.max(5, Math.round(qty * 0.25)), orderQty: qty,
      leadDays: supplier === 'Vendico Chemical AB' ? 14 : 7, shelfMonths: 36, expiry: '', locId: 'l1',
      hms: null, tds: null, comment: 'Ordre ' + order + (price ? '' : ' – pris ikke bekreftet'), status: 'Aktiv',
    });
    db.movements.unshift({ id: uid(), date, itemType: 'Råvare', item: name, batch: order, before: 0, change: qty, after: qty, reason: 'Varemottak – ordre ' + order + ' (' + supplier + ')', user: 'Import' });
  });
  // Sitronsyre monohydrat fantes fra før – legg mottaket på eksisterende vare
  const cit = db.rawMaterials.find(r => r.sku === 'RV-1003');
  if (cit && !db.movements.some(m => m.batch === '80058' && m.item === cit.name)) {
    db.movements.unshift({ id: uid(), date: '2026-04-30', itemType: 'Råvare', item: cit.name, batch: '80058', before: cit.stock, change: 50, after: cit.stock + 50, reason: 'Varemottak – ordre 80058 (Vendico Chemical AB)', user: 'Import' });
    cit.stock += 50; cit.price = 18.3;
  }
  audit(db, 'Import', 'Varemottak fra ordrebekreftelser', rows.length + ' råvarer lagt inn fra 7 ordrer (Vendico, Brenntag, DYC)');
  persist(db);
}
// Emballasje fra faktura 175572, Ivar Holte AS – allerede på lager
function importOrders2(db) {
  if (db.importedOrders2) return;
  db.importedOrders2 = true;
  db.suppliers = db.suppliers || [];
  if (!db.suppliers.some(s => s.name === 'Ivar Holte AS')) db.suppliers.push({ id: uid(), name: 'Ivar Holte AS', contact: 'Benedikte Fjellheim', phone: '+47 64 83 88 80', email: '', note: 'Emballasje – www.ivar-holte.no' });
  const rows = [
    // [navn, type, volum, stk, pris, sku]
    ['Flaske 0,5 l Boston Round klar 28/410', 'Flaske', 0.5, 2400, 2.47, 'IH-CS-0500-08'],
    ['Kapsel 28 mm BS svart', 'Kork', 0, 2500, 1.1, 'IH-49002102'],
    ['Trigger spray 28/410 255 mm', 'Annet', 0, 500, 4.5, 'IH-SNXT035'],
  ];
  rows.forEach(([name, type, volume, qty, price, sku]) => {
    if (db.packaging.some(p => p.comment === sku)) return;
    db.packaging.push({ id: uid(), name, type, volume, stock: qty, min: Math.round(qty * 0.2), max: qty * 2, price, supplier: 'Ivar Holte AS', leadDays: 15, locId: 'l8', status: 'Aktiv', comment: sku });
    db.movements.unshift({ id: uid(), date: '2026-06-26', itemType: 'Emballasje', item: name, batch: '175572', before: 0, change: qty, after: qty, reason: 'Varemottak – faktura 175572 (Ivar Holte AS)', user: 'Import' });
  });
  audit(db, 'Import', 'Varemottak fra faktura', '3 emballasjetyper fra Ivar Holte AS (faktura 175572, ordre 60368)');
  persist(db);
}
// HMS-datablader (SDS) og analysesertifikater fra Vendico – koblet på råvarene
function importHms(db) {
  if (db.importedHms === 9) return;
  db.importedHms = 9;
  const u = p => 'uploads/' + p.split('/').map(encodeURIComponent).join('/');
  const sds = {
    'VEN-13003-C': ['SDS Marlinat 242/28 (CLP-NO)', 'Marlinat_242_28_-_CLP-NO_nb_NO-136945.pdf'],
    'VEN-38098': ['SDS Mackamine CS (CLP-NO, oppdatert)', 'Uppdaterat SDS från Vendico Chemical/Mackamine_CS_-_CLP-NO_nb_NO-137050.pdf'],
    'VEN-38025': ['SDS Mackam CAB 818 (CLP-NO, oppdatert)', 'Uppdaterat SDS från Vendico Chemical/Mackam_CAB_818_-_CLP-NO_nb_NO-136982.pdf'],
    'VEN-38114': ['SDS Mackam DP 122 (CLP-NO)', 'Mackam_DP_122_-_CLP-NO_nb_NO-137205.pdf'],
    'VEN-48036': ['SDS Hansa Care 2020 D (CLP-NO)', 'SDS från Vendico Chemical/Hansa_Care_2020_D_-_CLP-NO_nb_NO-306418.pdf'],
    'VEN-49009': ['SDS Saboderm SHO (CLP-NO)', 'SDS från Vendico Chemical/Saboderm_SHO_-_CLP-NO_nb_NO-202429.pdf'],
    'VEN-75041': ['SDS Thiocare C102L 46 % (CLP-NO)', 'SDS från Vendico Chemical/Thiocare_C102L_46%-NO_nb_NO-137695.pdf'],
    'BRE-21463': ['SDS Brennsol D 60 (NO-ESDS)', 'BRENNSOL D 60 _ IBC 787 KG NO-ESDS_NO.PDF'],
    'VEN-75045': ['SDS WMB Solv 06 (NO)', 'WMB_Solv_06-NO_nb_NO-181142.pdf'],
    'VEN-63000': ['SDS Baypure CX 100/34 (CLP-NO)', 'Baypure_CX_100_34%_-_CLP-NO_nb_NO-136819.pdf'],
    'RV-1003': ['SDS Sitronsyre monohydrat (NO)', 'Citronsyra_monohydrat___Citric_acid_monohydrate-NO_nb_NO-134085.pdf'],
    'VEN-48042': ['SDS Hansa Care 7120 (CLP-NO)', 'Hansa_Care_7120_-_CLP-NO_nb_NO-341694.pdf'],
    'VEN-48043': ['SDS Hansa Care 7920 (CLP-NO)', 'Hansa_Care_7920_-_CLP-NO_nb_NO-341693.pdf'],
    'VEN-48047': ['SDS Hansa Care 8140 D (CLP-NO)', 'Hansa_Care_8140_D_-_CLP-NO_nb_NO-345369.pdf'],
    'VEN-14210': ['SDS Lialet 111-3 (CLP-NO)', 'Lialet_111-3_-_CLP-NO_nb_NO-136850.pdf'],
    'VEN-14211': ['SDS Lialet 111-5,5 (CLP-NO)', 'Lialet_111-55_-_CLP-NO_nb_NO-137028.pdf'],
    'VEN-76066': ['SDS Na-Glukonat (NO)', 'Na-Glukonat-NO_nb_NO-136035.pdf'],
    'VEN-76007': ['SDS Parfym Apple Flower SC154250 (CLP-NO)', 'Parfym_Apple_Flower_SC154250_-_CLP-NO_nb_NO-202133.pdf'],
    'VEN-75080': ['SDS Silikonemulsion E1P (NO)', 'Silikonemulsion_E1P_-NO_nb_NO-134488.pdf'],
    'VEN-20300': ['SDS Simulsol AS 48 (CLP-NO)', 'Simulsol_AS_48_-_CLP-NO_nb_NO-136604.pdf'],
    'VEN-48041': ['MSDS Hansa Care HTC Base', 'MSDS HANSA CARE HTC BASE.pdf'],
    'BRE-29357': ['SDS Natriumhydroksid perler (Brenntag)', '874058E792FF0B268D4B0687351662DB.pdf'],
    'BRE-5513': ['SDS Butylglykol (Brenntag)', '280F3D10320D4D77E56008C753FE9618.pdf'],
    'BRE-21610': ['SDS Isopropylalkohol (Brenntag)', '23230D9345161786E2E15F883F555355.pdf'],
    'BRE-6239': ['SDS Arcosolv DPM (Brenntag)', '0BD009CEA054D9AEC88A0A9B86EB147E.pdf'],
    'DYC-1040102': ['MSDS Wacker AK 350 (WilSil 350)', 'WACKER_AK_350_MSDS_en.pdf'],
  };
  const cert = {
    'RV-1003': ['Analysesertifikat AM-2410-2200', '55001_AM-2410-2200_Citronsyra-monohydrat.pdf'],
    'VEN-13003-C': ['Analysesertifikat batch 260008', '13003-C_260008_Marlinat-242-28.pdf'],
    'VEN-20300': ['Analysesertifikat 250524010685', '20300_250524010685_Simulsol-AS48.pdf'],
    'VEN-14210': ['Analysesertifikat 240911', '14210_240911_Lialet-111-3.pdf'],
    'VEN-48042': ['Analysesertifikat 0001836450', '48042-25_0001836450_Hansa-Care-7120.pdf'],
    'VEN-38098': ['Analysesertifikat 0000001297', '38098_0000001297_Mackamine-CS.pdf'],
    'VEN-76066': ['Analysesertifikat 69520', '76066_69520_Na-Glukonat.pdf'],
    'VEN-75045': ['Analysesertifikat 112', '75045_112_WMB-Solv-06.pdf'],
    'VEN-48047': ['Analysesertifikat 0001803951', '48047_0001803951_Hansa-Care-8140-D.pdf'],
    'VEN-49009': ['Analysesertifikat batch 2000136116', '49009_2000136116_Saboderm-SHO-MB.pdf'],
    'VEN-48036': ['Analysesertifikat 0001827164', '48036_0001827164_Hansa-Care-2020-D.pdf'],
    'VEN-25472': ['Analysesertifikat SO30733-1', '25472-25_SO30733-1_Addpol-Green-NGL_.pdf'],
    'VEN-75041': ['Analysesertifikat 0000090181', '75041_0000090181_Thiocare-C102L-46_.pdf'],
    'VEN-25474': ['Analysesertifikat SO30733-1', '25474-25_SO30733-1_Addpol-Pink-AL.pdf'],
    'VEN-25473': ['Analysesertifikat SO30733-3', '25473-25_SO30733-3_Addpol-Blue.pdf'],
    'VEN-75080': ['Analysesertifikat 252139E070', '75080_252139E070_Silikonemulsion-E-1-P.pdf'],
    'VEN-38114': ['Analysesertifikat 34706-1', '38114_34706-1_Mackam-DP-122.pdf'],
    'VEN-63000': ['Analysesertifikat CHASMK1125', '63000_CHASMK1125_Baypure-CX-100-34.pdf'],
    'VEN-38025': ['Analysesertifikat 33717-1', '38025_33717-1_Mackam-CAB-818.pdf'],
    'VEN-48043': ['Analysesertifikat 0001841062', '48043-25_0001841062_Hansa-Care-7920.pdf'],
    'VEN-76007': ['Analysesertifikat 7540990013', '76007_7540990013_Parfym-Apple-Flower-SC-154250.pdf'],
  };
  let n = 0;
  db.rawMaterials.forEach(r => {
    if (r.sku === 'INT-VANN') { r.hmsExempt = true; r.hms = null; }
    // ekte SDS foretrekkes – oppgraderer også varer som hadde analysesertifikat som HMS
    if (sds[r.sku] && (!r.hms || (r.hms.name || '').indexOf('Analysesertifikat') === 0)) { r.hms = { name: sds[r.sku][0], date: today(), size: '', url: u(sds[r.sku][1]) }; n++; }
    // analysesertifikat teller som HMS-dokumentasjon der SDS mangler
    if (!r.hms && cert[r.sku]) { r.hms = { name: cert[r.sku][0], date: today(), size: '', url: u(cert[r.sku][1]) }; n++; }
    if (cert[r.sku] && !r.tds) { r.tds = { name: cert[r.sku][0], date: today(), url: u(cert[r.sku][1]) }; }
  });
  if (n) audit(db, 'Import', 'HMS-datablad koblet', n + ' SDS-er og ' + Object.keys(cert).length + ' analysesertifikater fra Vendico');
  persist(db);
}
// Produkter som nærmer seg tomt legges automatisk i ventelisten (kan også legges til manuelt)
export function autoPlan(db) {
  let n = 0;
  productionSuggestions(db).forEach(s => {
    db.productions.unshift({ id: uid(), productId: s.productId, volume: s.volume, tankId: '', priority: 'Normal', plannedDate: addDays(today(), 2), status: 'I venteliste', batch: '', comment: 'Lagt inn automatisk – ' + s.reason, responsible: 'Automatisk', startedAt: '', finishedAt: '', actualVolume: null, loss: null });
    n++;
  });
  if (n) persist(db);
  return n;
}
// Fiktivt testprodukt med instruksjoner – legges til én gang, også i eksisterende data
function seedTest(db) {
  if (db.demoCleaned) return;
  const pid = 'p-test';
  if (!db.products.some(p => p.code === 'TEST')) {
    db.products.push({ id: pid, name: 'Testprodukt Skumvask', code: 'TEST', shelfMonths: 12, ibcMinL: 500, status: 'Aktiv' });
    db.recipes.push({
      id: 'o-test', productId: pid, baseVolume: 1000, version: 1, status: 'Aktiv', comment: 'Fiktiv oppskrift for testing av instruksjoner', lines: [
        { rawId: 'r9', qty: 800, unit: 'l' },
        { rawId: 'r1', qty: 100, unit: 'kg', note: 'Må siles før tilsetting' },
        { step: true, text: 'Vent i 5 minutter til blandingen er klar' },
        { rawId: 'r2', qty: 80, unit: 'l', note: 'Blandes inn litt om gangen under omrøring' },
        { step: true, text: 'Rør i 10 minutter på lav hastighet' },
        { rawId: 'r6', qty: 3, unit: 'kg', note: 'Tilsettes til slutt, rør forsiktig' },
      ]
    });
    persist(db);
  }
  if (!db.productions.some(x => x.id === 'pd-test')) {
    const freeTank = db.tanks.find(t => ['Ledig', 'Vasket'].includes(t.status));
    db.productions.unshift({ id: 'pd-test', productId: pid, volume: 1000, tankId: freeTank ? freeTank.id : '', priority: 'Normal', plannedDate: today(), status: 'Klar til produksjon', batch: '', comment: 'Testproduksjon – prøv instruksjonene', responsible: 'Truls K.', startedAt: '', finishedAt: '', actualVolume: null, loss: null });
    persist(db);
  }
  // testdata for varer og ferdigvare, så hele flyten kan simuleres
  if (!(db.goods || []).some(g => g.id === 'g-test1')) {
    db.goods = db.goods || []; db.goodsCats = db.goodsCats || ['Andre varer'];
    if (!db.goodsCats.includes('Testvarer')) db.goodsCats.push('Testvarer');
    db.goods.push(
      { id: 'g-test1', name: 'Testklut Mikrofiber 40x40', sku: 'HV-TEST1', category: 'Testvarer', unit: 'pk', stock: 5, min: 20, max: 100, price: 89, supplier: 'Nordisk Bilpleiegrossist', locId: 'l6', leadDays: 7, status: 'Aktiv' },
      { id: 'g-test2', name: 'Testsvamp Polering', sku: 'HV-TEST2', category: 'Testvarer', unit: 'stk', stock: 40, min: 10, max: 80, price: 45, supplier: 'Nordisk Bilpleiegrossist', locId: 'l6', leadDays: 7, status: 'Aktiv' }
    );
    persist(db);
  }
  if (!db.finished.some(f => f.id === 'f-test')) {
    db.finished.push({ id: 'f-test', productId: pid, packId: 'k3', stock: 0, min: 10, max: 60, locId: 'l6', status: 'Aktiv', batches: [] });
    persist(db);
  }
}
// sørg for at testproduksjonen faktisk kan startes: fyll opp råvarelageret ved behov (etter autoPlan, så reservasjoner telles med)
function ensureTestStock(db) {
  if (db.demoCleaned) return;
  const pd = db.productions.find(x => x.id === 'pd-test');
  if (pd && ['I venteliste', 'Klar til produksjon', 'Mangler råvarer'].includes(pd.status)) {
    let changed = false;
    calcNeeds(db, pd.productId, pd.volume).forEach(n => {
      const r = raw(db, n.rawId); if (!r) return;
      const avail = r.stock - reservedRaw(db, n.rawId, pd.id);
      if (avail < n.need) { r.stock = Math.round((r.stock + (n.need - avail)) * 10) / 10; changed = true; }
    });
    if (changed) { pd.status = 'Klar til produksjon'; persist(db); }
  }
}
export function persist(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
export function reset() { localStorage.removeItem(KEY); return load(); }

export function move(db, m) { db.movements.unshift({ id: uid(), date: nowIso(), ...m }); }
export function audit(db, user, action, detail) { db.audit.unshift({ id: uid(), date: nowIso(), user, action, detail }); }

// ---------- oppslag ----------
export const raw = (db, id) => db.rawMaterials.find(r => r.id === id);
export const pack = (db, id) => db.packaging.find(p => p.id === id);
export const product = (db, id) => db.products.find(p => p.id === id);
export const recipe = (db, productId) => db.recipes.find(r => r.productId === productId && r.status === 'Aktiv');
export const tank = (db, id) => db.tanks.find(t => t.id === id);
export const loc = (db, id) => { const l = db.locations.find(l => l.id === id); return l ? l.name : ''; };

// ---------- kalkyler ----------
// Handelsvarer fra leverandørdokumenter (Zhentian, VETRO SOL, MIRROR TOUCH, Tuf Kote) – kurs USD/NOK 10,20
function importGoods(db) {
  if (db.importedGoods) return;
  db.importedGoods = true;
  db.suppliers = db.suppliers || [];
  const addSup = (name, contact, phone, email, note) => { if (!db.suppliers.some(s => s.name === name)) db.suppliers.push({ id: uid(), name, contact, phone, email, note }); };
  addSup('Shanghai Zhentian Polyurethane Co., Ltd', 'Ling', '+86 189 3007 6310', 'ling@shztpm.com', 'Shanghai/Ningbo, Kina – mikrofiber, svamper, puter, hansker. Tlf. kontor +86 21 3393 7059. Betaling: Bank of China, SWIFT BKCHCNBJ300, konto 455969665552');
  addSup('VETRO SOL', 'Navin Nisar', '+91 93226 65538', 'vetrosolindia@gmail.com', 'Mumbai, India – keramisk coating. www.vetrosol.com · IEC AAEPF3752E');
  addSup('MIRROR TOUCH', 'Navin Nisar', '+91 93226 65538', 'vetrosolindia@gmail.com', 'Mumbai, India – keramisk/graphene coating. www.mirrortouch.com');
  addSup('Tuf Kote Automotive Pvt Ltd', '', '+91 98210 71178', 'support@tufkote.in', 'Mumbai, India – understellsbehandling og hulromskonservering. HDFC Bank, SWIFT HDFCINBB');
  const ZT = 'Shanghai Zhentian Polyurethane Co., Ltd';
  const usd = 10.2;
  const rows = [
    // [kategori, navn, sku, enhet, antall bestilt, USD-pris, leverandør, leadDays]
    ['Mikrofiberkluter', 'Waffle Towel 5-pk 60×80 cm rød', 'ZT504', 'pk', 500, 1.43, ZT, 60],
    ['Mikrofiberkluter', 'Mikrofiberklut 40×40 cm grønn', 'ZT505', 'stk', 3000, 0.32, ZT, 60],
    ['Mikrofiberkluter', 'Mikrofiberklut 40×40 cm grå', 'ZT507', 'stk', 2850, 0.32, ZT, 60],
    ['Mikrofiberkluter', 'Poleringsklut hvit 150×100 mm', 'ZT512', 'stk', 20000, 0.05, ZT, 60],
    ['Mikrofiberkluter', 'Clay Bar Towel 30×30 cm', 'ZT522', 'stk', 500, 3.02, ZT, 60],
    ['Mikrofiberkluter', 'Clay Bar Care 200 g med clay bar', 'ZT523', 'stk', 500, 2.17, ZT, 60],
    ['Vaskeutstyr', 'Vaskehanske 260×180 mm sort/hvit', 'ZT508', 'stk', 666, 1.02, ZT, 60],
    ['Svamper og puter', 'Interiørsvamp 120×100×30 mm', 'ZT509', 'stk', 5460, 0.06, ZT, 60],
    ['Svamper og puter', 'Magic sponge 100×80×50 mm', 'ZT541', 'stk', 5600, 0.062, ZT, 60],
    ['Svamper og puter', 'Poleringspute sort 140 mm (hardhet 30)', 'ZT533', 'stk', 2000, 0.64, ZT, 60],
    ['Svamper og puter', 'Poleringspute ull 140 mm', 'ZT534', 'stk', 2000, 0.9, ZT, 60],
    ['Svamper og puter', 'Poleringspute blå 140 mm (hardhet 90)', 'ZT535', 'stk', 2000, 0.75, ZT, 60],
    ['Svamper og puter', 'Poleringspute grønn 145 mm (hardhet 100)', 'ZT536', 'stk', 2000, 0.77, ZT, 60],
    ['Svamper og puter', 'Poleringspute 90 mm (hardhet 30)', 'ZT542', 'stk', 500, 0.43, ZT, 60],
    ['Svamper og puter', 'Poleringspute ull 90 mm', 'ZT543', 'stk', 500, 0.68, ZT, 60],
    ['Svamper og puter', 'Poleringspute 90 mm (hardhet 90)', 'ZT544', 'stk', 500, 0.51, ZT, 60],
    ['Svamper og puter', 'Poleringspute 90 mm (55 kg)', 'ZT545', 'stk', 500, 0.59, ZT, 60],
    ['Verneutstyr', 'Nitrilhansker XL (eske à 100)', 'ZT546-XL', 'eske', 1000, 2.54, ZT, 60],
    ['Verneutstyr', 'Nitrilhansker L (eske à 100)', 'ZT546-L', 'eske', 930, 2.54, ZT, 60],
    ['Verneutstyr', 'Halvmaske 720D med filtre (sett)', 'ZT547', 'stk', 500, 4, ZT, 60],
    ['Verneutstyr', 'Vernedress PP+EPTFE str. L', 'ZT548-L', 'stk', 500, 1.02, ZT, 60],
    ['Verneutstyr', 'Vernedress PP+EPTFE str. XL', 'ZT548-XL', 'stk', 500, 1.1, ZT, 60],
    ['Verneutstyr', 'Vernedress PP+EPTFE str. XXL', 'ZT548-XXL', 'stk', 500, 1.16, ZT, 60],
    ['Diverse', 'Plastklips nylon 5/10/22 mm', 'ZT-CLIP', 'stk', 5000, 0.042, ZT, 60],
    ['Coating', 'Keramisk nano coating 50 ml', 'VS-50ML', 'stk', 100, 24, 'VETRO SOL', 45],
    ['Coating', 'Keramisk nano coating Graphene 30 ml', 'MT-30ML', 'stk', 1000, 5.5, 'MIRROR TOUCH', 45],
    ['Coating', 'Keramisk nano coating 50 ml (Mirror Touch)', 'MT-50ML', 'stk', 50, 20, 'MIRROR TOUCH', 45],
    ['Understellsbehandling', 'TK Cavity Protection 4852 (fat 200 l)', 'TKA-4852', 'stk', 30, 999, 'Tuf Kote Automotive Pvt Ltd', 45],
    ['Understellsbehandling', 'TK Under body Coating 4950 (fat 200 l)', 'TKA-4950', 'stk', 45, 579, 'Tuf Kote Automotive Pvt Ltd', 45],
  ];
  db.goods = db.goods || []; db.goodsCats = db.goodsCats || ['Andre varer'];
  rows.forEach(([category, name, sku, unit, qty, usdPrice, supplier, leadDays]) => {
    if (db.goods.some(g => g.sku === sku)) return;
    if (!db.goodsCats.includes(category)) db.goodsCats.push(category);
    db.goods.push({
      id: uid(), name, sku, category, unit, stock: qty,
      min: Math.max(2, Math.round(qty * 0.2)), max: qty * 2,
      price: Math.round(usdPrice * usd * 100) / 100, supplier, locId: 'l6', leadDays, status: 'Aktiv',
    });
    db.movements.unshift({ id: uid(), date: today(), itemType: 'Handelsvare', item: name, batch: sku, before: 0, change: qty, after: qty, reason: 'Varemottak – import fra leverandørdokumenter (' + supplier + ')', user: 'Import' });
  });
  audit(db, 'Import', 'Handelsvarer importert', rows.length + ' varer i 7 kategorier fra 4 leverandører (Zhentian, VETRO SOL, MIRROR TOUCH, Tuf Kote)');
  persist(db);
}
// Oppskrifter fra BPG Chemicals-reseptfilene (20 filer) + opprydding av demo-data
function importRecipes(db) {
  if (db.importedRecipes) return;
  db.importedRecipes = true;
  const newRaws = [
    ['INT-VANN', 'Vann', 0.02, 'l', 'Internt anlegg', 100000],
    ['NY-HYPO', 'Natriumhypokloritt 15 %', 9.6, 'l', '', 0],
    ['NY-FOSFOR', 'Fosforsyre', 21.55, 'kg', '', 0],
    ['NY-OXAL', 'Oksalsyre', 28.2, 'kg', '', 0],
    ['NY-FARGE-G', 'Farge grønn', 100, 'l', '', 0],
    ['NY-FARGE-R', 'Farge rød (pulver)', 0, 'kg', '', 0],
    ['NY-SERVOXYL', 'Servoxyl VPTZ 3/100', 59, 'l', '', 0],
    ['NY-PARF-SITRON', 'Parfyme sitron', 398, 'l', '', 0],
    ['NY-FLEXISORB', 'Flexisorb OD-120Z', 297, 'kg', '', 0],
    ['NY-HC10F', 'Hansa Care 10-F', 0, 'l', '', 0],
  ];
  newRaws.forEach(([sku, name, price, unit, supplier, stock]) => {
    if (!db.rawMaterials.some(r => r.sku === sku)) db.rawMaterials.push({ id: uid(), name, sku, supplier, price, unit, stock, min: 0, max: 0, orderPoint: 0, orderQty: 0, leadDays: 7, shelfMonths: 36, expiry: '', locId: 'l1', hms: null, tds: null, comment: 'Fra reseptur-import', status: 'Aktiv' });
  });
  const bySku = s => { const r = db.rawMaterials.find(x => x.sku === s); return r ? r.id : null; };
  const L = (sku, qty, unit, note) => ({ rawId: bySku(sku), qty, unit, note: note || '' });
  const S = text => ({ step: true, text });
  db.prodCats = db.prodCats || []; ['Evershine', 'Autocare', 'Hoseki'].forEach(c => { if (!db.prodCats.includes(c)) db.prodCats.push(c); });
  const intro = 'Blandes i rekkefølge fra topp til bunn';
  const oipNote = 'Mackam OIP-40 erstattes av DP 122 – bruk det som er på lager';
  const recipes = [
    ['Aura Keramisk Bilshampo', 'AURA', 'Evershine', 2000, '', [
      S(intro),
      L('INT-VANN', 1588.2, 'l'),
      L('VEN-76066', 20, 'kg'),
      L('VEN-48036', 40, 'l', 'Mikses med Butyl glykol før tilsetting'),
      L('BRE-5513', 62, 'l', '60 l mikses med HansaCare 2020, 2 l med parfymen'),
      L('VEN-13003-C', 200, 'l'),
      L('VEN-38025', 100, 'l'),
      L('VEN-76007', 6, 'l', 'Mikses med Butyl glykol (2 l) før tilsetting'),
      L('RV-1003', 0.2, 'kg', 'For pH-justering'),
      L('NY-FARGE-G', 0.006, 'l', 'Tilsett 3 ml per 1000 l, juster mot forrige batch'),
      S('Test pH: skal være 5–6. For høy? Tilsett sitronsyre (100 ml pulver blandet i vann) og mål på nytt'),
    ]],
    ['Alkalisk Forvask Hyperkonsentrat', 'ALKF', 'Evershine', 400, '', [
      S(intro), L('INT-VANN', 254.4, 'l'), L('BRE-29357', 20, 'kg'), L('VEN-63000', 8, 'kg'), L('VEN-76066', 28, 'kg'),
      L('VEN-14211', 20, 'l'), L('VEN-38114', 16, 'l', oipNote), L('DYC-1040102', 6, 'l', 'WiSil'), L('VEN-20300', 16, 'l'),
      L('VEN-13003-C', 20, 'l'), L('NY-SERVOXYL', 16, 'l'), L('VEN-38025', 40, 'l'), L('NY-PARF-SITRON', 0.4, 'l'),
    ]],
    ['Cleaner', 'CLNR', 'Evershine', 400, '', [S(intro), L('INT-VANN', 260, 'l'), L('BRE-21610', 140, 'l')]],
    ['Kraftrent', 'KRAF', 'Autocare', 50, '', [
      S(intro), L('INT-VANN', 18.2, 'l'), L('BRE-29357', 0.25, 'kg'), L('NY-HYPO', 25, 'l'), L('VEN-38025', 5, 'kg'), L('VEN-13003-C', 1.75, 'l'),
    ]],
    ['Acid Cleaner', 'ACID', 'Autocare', 50, '', [
      S(intro), L('INT-VANN', 34.5, 'l'), L('NY-FOSFOR', 7.5, 'kg'), L('NY-OXAL', 5, 'kg'), L('VEN-20300', 1.5, 'kg'), L('VEN-14211', 1.5, 'l'),
    ]],
    ['Høytrykk Bilsjampo med Voks', 'HBV', 'Autocare', 50, '', [
      S(intro), L('INT-VANN', 44.21, 'l'), L('BRE-29357', 1.75, 'kg'), L('VEN-76066', 2, 'kg'), L('VEN-63000', 0.45, 'kg'),
      L('VEN-14211', 1.65, 'l'), L('VEN-38114', 1.65, 'l', oipNote), L('VEN-38025', 1.65, 'l'),
    ]],
    ['HD Grønn Foam', 'HDG', 'Autocare', 1000, '', [
      S(intro), L('INT-VANN', 884.2, 'l'), L('BRE-29357', 35, 'kg'), L('VEN-76066', 40, 'kg'), L('VEN-63000', 9, 'kg'),
      L('VEN-14211', 33, 'l'), L('VEN-38114', 33, 'l', oipNote), L('VEN-38025', 33, 'l'),
    ]],
    ['Wet Coate', 'WETC', 'Autocare', 1000, '', [
      S(intro), L('INT-VANN', 900, 'l'), L('VEN-48042', 50, 'kg'), L('VEN-48043', 50, 'kg'),
      L('NY-FARGE-R', 0, 'kg', 'Tilsettes visuelt til rosa farge'),
      S('NB! Farge tilsettes visuelt for å oppnå rosa farge'),
    ]],
    ['Skumforsegling', 'SKUM', 'Autocare', 1000, '', [
      S(intro), L('INT-VANN', 895, 'l'), L('VEN-48042', 50, 'l'), L('VEN-48043', 50, 'l'), L('VEN-38025', 5, 'l'),
    ]],
    ['Tekstilimpregnering', 'TEKS', 'Autocare', 1000, '', [
      S(intro), L('NY-HC10F', 80, 'l'), L('INT-VANN', 919, 'l'), L('NY-FOSFOR', 1, 'l', 'For pH-justering'),
      S('Juster til pH 4,5 med fosforsyre'),
    ]],
    ['Micro Foam', 'MICR', 'Autocare', 1000, 'Kundetilpasninger: Sveberg Storbilvask, Børstad og Vianor Steinkjer: +2 % Mackam CAB 818. Bilkjemi: spedes ut med 10 % vann + 0,5 % natriumhydroksid.', [
      S(intro), L('INT-VANN', 785, 'l'), L('BRE-29357', 25, 'kg'), L('VEN-76066', 40, 'kg'), L('VEN-63000', 9, 'kg'),
      L('VEN-14211', 33, 'l'), L('VEN-38114', 20, 'l', oipNote), L('VEN-20300', 30, 'l'), L('VEN-13003-C', 20, 'l'),
      L('VEN-38025', 33, 'l'), L('VEN-75045', 5, 'l'),
    ]],
    ['Luktfjerner', 'LUKT', 'Autocare', 1000, '', [
      S(intro), L('INT-VANN', 928.5, 'l'), L('NY-FLEXISORB', 70, 'kg'), L('NY-PARF-SITRON', 1.5, 'l'),
    ]],
    ['Alkalisk Cargo Avfetting', 'CARG', 'Autocare', 1000, '', [
      S(intro), L('INT-VANN', 790, 'l'), L('BRE-29357', 40, 'kg'), L('VEN-63000', 50, 'kg'), L('VEN-14211', 40, 'l'), L('VEN-20300', 40, 'l'), L('VEN-38025', 40, 'l'),
    ]],
    ['Polar Seal', 'PSEA', 'Hoseki', 2000, '', [S(intro), L('INT-VANN', 1800, 'l'), L('VEN-48042', 100, 'l'), L('VEN-48043', 100, 'l')]],
    ['Cockpit Spray', 'COCK', 'Hoseki', 1000, '', [S(intro), L('INT-VANN', 547, 'l'), L('VEN-75080', 450, 'l'), L('VEN-76007', 3, 'l')]],
    ['Interiørfornyer', 'INTF', 'Hoseki', 1000, '', [S(intro), L('INT-VANN', 547, 'l'), L('VEN-75080', 450, 'l'), L('VEN-76007', 3, 'l')]],
    ['Metall- og Flyverustfjerner', 'FLYR', 'Hoseki', 1000, '', [
      S(intro), L('INT-VANN', 682, 'l'), L('VEN-49009', 15, 'l'), L('VEN-13003-C', 50, 'l'), L('VEN-75041', 250, 'l'),
      L('RV-1003', 0, 'kg', 'For pH-regulering – små mengder'), L('NY-PARF-SITRON', 3, 'l'),
      S('Reguler pH til 5,7 – bruk sitronsyre i små mengder og mål mellom hver tilsetting'),
    ]],
    ['Polar Blast', 'PBLA', 'Hoseki', 2000, '', [
      S(intro), L('INT-VANN', 1699.2, 'l'), L('BRE-29357', 20, 'kg'), L('VEN-76066', 66, 'kg'), L('VEN-63000', 18, 'kg'),
      L('VEN-14211', 40, 'l'), L('VEN-38114', 40, 'l', oipNote), L('VEN-20300', 40, 'l'), L('VEN-38025', 100, 'l'), L('VEN-13003-C', 60, 'l'),
    ]],
    ['Polar Wash', 'PWAS', 'Hoseki', 2000, '', [
      S(intro), L('INT-VANN', 1508, 'l'), L('VEN-76066', 60, 'kg'), L('VEN-13003-C', 100, 'l'), L('VEN-38025', 100, 'l'),
      L('BRE-5513', 60, 'l', 'Mikses med parfymen før tilsetting'), L('VEN-76007', 6, 'l', 'Mikses med Butyl glykol før tilsetting'),
      L('NY-FARGE-G', 0.006, 'l', 'Tilsett 3 ml per 1000 l, juster mot forrige batch'),
    ]],
  ];
  recipes.forEach(([name, code, category, baseVolume, comment, lines]) => {
    if (db.products.some(p => p.code === code)) return;
    const id = uid();
    db.products.push({ id, name, code, category, shelfMonths: 24, ibcMinL: 0, status: 'Aktiv' });
    db.recipes.push({ id: uid(), productId: id, baseVolume, version: 1, status: 'Aktiv', comment, lines: lines.filter(l => l.step || l.rawId) });
  });
  // rydd ut demo- og testdata
  const rmProd = db.products.filter(p => ['p1', 'p2', 'p3', 'p4', 'p-test'].includes(p.id)).map(p => p.id);
  db.products = db.products.filter(p => !rmProd.includes(p.id));
  db.recipes = db.recipes.filter(r => !rmProd.includes(r.productId));
  db.productions = db.productions.filter(p => !rmProd.includes(p.productId));
  db.ibcs = db.ibcs.filter(i => !i.productId || !rmProd.includes(i.productId));
  db.finished = db.finished.filter(f => !rmProd.includes(f.productId));
  db.tappings = db.tappings.filter(t => !rmProd.includes(t.productId));
  db.tanks.forEach(t => { if (t.productionId && !db.productions.some(p => p.id === t.productionId)) { t.productionId = null; if (t.status !== 'Ute av drift') t.status = 'Ledig'; } });
  const rmRaw = db.rawMaterials.filter(r => ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'].includes(r.id) && r.sku !== 'RV-1003').map(r => r.id);
  db.rawMaterials = db.rawMaterials.filter(r => !rmRaw.includes(r.id));
  if (db.purchases) { db.purchases.forEach(o => { o.lines = o.lines.filter(l => !l.itemId || !rmRaw.includes(l.itemId)); }); db.purchases = db.purchases.filter(o => o.lines.length); }
  db.goods = (db.goods || []).filter(g => !['g-test1', 'g-test2'].includes(g.id));
  if (db.goodsCats) db.goodsCats = db.goodsCats.filter(c => c !== 'Testvarer');
  db.demoCleaned = true;
  audit(db, 'Import', 'Oppskrifter importert', recipes.length + ' produkter med steg-for-steg-oppskrifter (Evershine, Autocare, Hoseki). Demo-data fjernet.');
  persist(db);
}
export function costPerLiter(db, productId) {
  const rc = recipe(db, productId); if (!rc) return 0;
  const sum = rc.lines.reduce((a, l) => { const r = raw(db, l.rawId); return a + (r ? r.price * l.qty : 0); }, 0);
  return sum / rc.baseVolume;
}
export function reservedRaw(db, rawId, exceptProdId) {
  return db.productions
    .filter(p => ['I venteliste', 'Klar til produksjon', 'Mangler råvarer', 'Mangler emballasje'].includes(p.status) && p.id !== exceptProdId)
    .reduce((a, p) => a + (calcNeeds(db, p.productId, p.volume).find(n => n.rawId === rawId)?.need || 0), 0);
}
export function calcNeeds(db, productId, volume) {
  const rc = recipe(db, productId); if (!rc) return [];
  const f = volume / rc.baseVolume;
  return rc.lines.filter(l => l.rawId).map(l => { const r = raw(db, l.rawId); return { rawId: l.rawId, name: r ? r.name : '?', unit: l.unit, need: Math.round(l.qty * f * 10) / 10, stock: r ? r.stock : 0 }; });
}
export function prodBlockers(db, p, exceptSelf) {
  const b = [];
  const rc = recipe(db, p.productId);
  if (!rc) b.push('Produktoppskrift mangler');
  const t = tank(db, p.tankId);
  if (!t) b.push('Ingen tank valgt');
  else {
    if (t.capacity < p.volume) b.push('Tanken er for liten (' + t.capacity + ' l)');
    if (t.status === 'Aktiv' && t.productionId !== p.id) b.push('Tanken er opptatt');
    if (t.status === 'Ute av drift') b.push('Tanken er ute av drift');
  }
  if (rc) calcNeeds(db, p.productId, p.volume).forEach(n => {
    const r = raw(db, n.rawId);
    const avail = r.stock - reservedRaw(db, n.rawId, exceptSelf ? p.id : null);
    if (avail < n.need) b.push('Mangler ' + n.name + ' (' + fmtNum(n.need) + ' ' + n.unit + ' trengs, ' + fmtNum(Math.max(avail, 0)) + ' tilgjengelig)');
    if (db.settings.hmsRequired && !r.hms && !r.hmsExempt) b.push('HMS-datablad mangler for ' + r.name);
    if (r.status === 'Utgått') b.push(r.name + ' er utgått');
  });
  const ibcPack = db.packaging.find(x => x.type === 'IBC');
  if (ibcPack && ibcPack.stock < Math.ceil(p.volume / 1000)) b.push('Mangler tom IBC-emballasje (' + Math.ceil(p.volume / 1000) + ' trengs, ' + ibcPack.stock + ' på lager)');
  return b;
}
export function genBatch(db, p) {
  const prod = product(db, p.productId); const t = tank(db, p.tankId);
  const dato = today().replace(/-/g, '');
  const seq = db.productions.filter(x => x.batch && x.productId === p.productId).length + 1;
  return db.settings.batchFormat
    .replace('{KODE}', prod ? prod.code : 'PROD').replace('{DATO}', dato)
    .replace('{TANK}', t ? t.name.replace('Tank ', 'T') : 'T?')
    .replace('{LNR}', String(seq).padStart(3, '0'));
}

// ---------- arbeidsflyter ----------
export function startProduction(db, id, user) {
  const p = db.productions.find(x => x.id === id);
  const b = prodBlockers(db, p, true);
  if (b.length) return { ok: false, msg: b.join('. ') };
  p.batch = p.batch || genBatch(db, p);
  calcNeeds(db, p.productId, p.volume).forEach(n => {
    const r = raw(db, n.rawId);
    move(db, { itemType: 'Råvare', item: r.name, batch: p.batch, before: r.stock, change: -n.need, after: r.stock - n.need, reason: 'Produksjon startet', user });
    r.stock = Math.round((r.stock - n.need) * 10) / 10;
  });
  const t = tank(db, p.tankId); t.status = 'Aktiv'; t.productionId = p.id;
  p.status = 'Under produksjon'; p.startedAt = today();
  audit(db, user, 'Startet produksjon', p.batch + ' · ' + product(db, p.productId).name + ' · ' + p.volume + ' l');
  return { ok: true, msg: 'Produksjon startet. Batchnummer ' + p.batch };
}
export function finishProduction(db, id, actual, lossNote, locId, user) {
  const p = db.productions.find(x => x.id === id);
  const prod = product(db, p.productId);
  const ibcPack = db.packaging.find(x => x.type === 'IBC');
  const n = Math.ceil(actual / 1000);
  const empties = db.ibcs.filter(i => i.status === 'Tom').slice(0, n);
  const newN = n - empties.length;
  if (ibcPack.stock < newN) return { ok: false, msg: 'Mangler tomme IBC (' + n + ' trengs, ' + empties.length + ' skylte + ' + ibcPack.stock + ' nye på lager)' };
  let rest = actual; const made = [];
  for (let i = 0; i < n; i++) {
    const vol = Math.min(1000, rest); rest -= vol;
    const emp = empties[i];
    if (emp) {
      Object.assign(emp, { productId: p.productId, batch: p.batch, prodDate: today(), volume: vol, status: 'Tilgjengelig', locId: locId || emp.locId || '', expiry: addMonths(today(), prod.shelfMonths) });
      emp.history = emp.history || []; emp.history.unshift({ date: today(), text: 'Fylt ' + vol + ' l fra ' + tank(db, p.tankId).name + ' (gjenbrukt IBC)' });
      made.push(emp.code + ' (' + vol + ' l, gjenbrukt)');
    } else {
      const code = 'IBC-' + String(db.seqIbc++).padStart(3, '0');
      db.ibcs.unshift({ id: uid(), code, productId: p.productId, batch: p.batch, prodDate: today(), volume: vol, max: 1000, status: 'Tilgjengelig', locId: locId || '', expiry: addMonths(today(), prod.shelfMonths), comment: '', history: [{ date: today(), text: 'Fylt ' + vol + ' l fra ' + tank(db, p.tankId).name + ' (ny IBC)' }] });
      made.push(code + ' (' + vol + ' l, ny)');
    }
  }
  if (newN > 0) {
    move(db, { itemType: 'Emballasje', item: ibcPack.name, batch: p.batch, before: ibcPack.stock, change: -newN, after: ibcPack.stock - newN, reason: 'Tapping til IBC', user });
    ibcPack.stock -= newN;
  }
  db.tappings.unshift({ id: uid(), date: today(), from: tank(db, p.tankId).name, to: n + ' × IBC', productId: p.productId, batch: p.batch, volume: actual, units: n, user, locId, loss: Math.max(0, p.volume - actual), comment: lossNote || '' });
  const t = tank(db, p.tankId); t.status = 'Vasket'; t.productionId = null;
  p.status = 'Fullført'; p.finishedAt = today(); p.actualVolume = actual; p.loss = Math.max(0, p.volume - actual);
  audit(db, user, 'Fullført produksjon', p.batch + ' · ' + actual + ' l → ' + made.join(', '));
  return { ok: true, msg: 'Opprettet ' + made.join(', ') + '. Tanken er frigjort. Neste steg: tapp fra IBC til flasker og kanner.' };
}
export function doTapping(db, { ibcId, packId, units, locId, loss, user, comment }) {
  const ibc = db.ibcs.find(i => i.id === ibcId); const pk = pack(db, packId);
  units = Number(units); loss = Number(loss || 0);
  const vol = units * pk.volume + loss;
  if (!units || units < 1) return { ok: false, msg: 'Angi antall enheter' };
  if (vol > ibc.volume) return { ok: false, msg: 'Ikke nok volum i ' + ibc.code + ' (' + ibc.volume + ' l tilgjengelig, ' + vol + ' l trengs)' };
  if (pk.stock < units) return { ok: false, msg: 'Ikke nok emballasje: ' + pk.name + ' (' + pk.stock + ' stk på lager)' };
  if (db.settings.requireLocation && !locId) return { ok: false, msg: 'Lagerlokasjon må velges' };
  const srcProdId = ibc.productId, srcBatch = ibc.batch, srcExpiry = ibc.expiry;
  ibc.volume = Math.round((ibc.volume - vol) * 10) / 10;
  if (ibc.volume <= 0) { ibc.volume = 0; ibc.status = 'Tom'; ibc.batch = ''; ibc.productId = null; }
  ibc.history.push({ date: today(), text: 'Tappet ' + units + ' × ' + pk.name + (loss ? ' + ' + loss + ' l svinn' : '') });
  move(db, { itemType: 'Emballasje', item: pk.name, batch: '', before: pk.stock, change: -units, after: pk.stock - units, reason: 'Tapping', user });
  pk.stock -= units;
  let fg = db.finished.find(f => f.productId === srcProdId && f.packId === packId);
  if (!fg) { fg = { id: uid(), productId: srcProdId, packId, stock: 0, min: 0, max: 0, locId, batches: [], status: 'Aktiv' }; db.finished.push(fg); }
  move(db, { itemType: 'Ferdigvare', item: product(db, srcProdId).name + ' ' + pk.volume + ' l', batch: srcBatch, before: fg.stock, change: units, after: fg.stock + units, reason: 'Tapping fra ' + ibc.code, toLoc: loc(db, locId), user });
  fg.stock += units; if (locId) fg.locId = locId;
  fg.batches.unshift({ batch: srcBatch, qty: units, date: today(), expiry: srcExpiry });
  db.tappings.unshift({ id: uid(), date: today(), from: ibc.code, to: units + ' × ' + pk.name, productId: srcProdId, batch: srcBatch, volume: vol, units, user, locId, loss, comment: comment || '' });
  audit(db, user, 'Tappet produkt', ibc.code + ' → ' + units + ' × ' + pk.name + ' · batch ' + (srcBatch || '–'));
  return { ok: true, msg: 'Tappet ' + units + ' × ' + pk.name + '. Etiketter kan printes fra ferdigvarelageret.' };
}

// ---------- forslag ----------
export function purchaseSuggestions(db) {
  const lines = [];
  db.rawMaterials.filter(r => r.status === 'Aktiv').forEach(r => {
    const avail = r.stock - reservedRaw(db, r.id);
    if ((r.orderPoint || r.min) > 0 && avail <= (r.orderPoint || r.min)) lines.push({ itemType: 'Råvare', itemId: r.id, name: r.name, stock: r.stock, reserved: Math.round((r.stock - avail) * 10) / 10, min: r.min, max: r.max, qty: r.orderQty || Math.max(r.max - r.stock, 0), unit: r.unit, supplier: r.supplier, price: r.price, leadDays: r.leadDays });
  });
  db.packaging.filter(p => p.status === 'Aktiv').forEach(p => {
    if (p.min > 0 && p.stock <= p.min) lines.push({ itemType: 'Emballasje', itemId: p.id, name: p.name, stock: p.stock, reserved: 0, min: p.min, max: p.max, qty: Math.max(p.max - p.stock, 0), unit: 'stk', supplier: p.supplier, price: p.price, leadDays: p.leadDays });
  });
  (db.goods || []).filter(g => g.status === 'Aktiv').forEach(g => {
    if (g.min > 0 && g.stock <= g.min) lines.push({ itemType: 'Handelsvare', itemId: g.id, name: g.name, stock: g.stock, reserved: 0, min: g.min, max: g.max, qty: Math.max(g.moq || 0, Math.max(g.max - g.stock, 0)), unit: g.unit || 'stk', supplier: g.supplier, price: g.price, leadDays: g.leadDays || 7 });
  });
  return lines;
}
export function ibcVolume(db, productId) { return db.ibcs.filter(i => i.productId === productId && ['Tilgjengelig', 'I bruk'].includes(i.status) && (!i.expiry || daysUntil(i.expiry) > 0)).reduce((a, i) => a + i.volume, 0); }
export function openOrderQty(db, finishedId) { return (db.orders || []).filter(o => o.status === 'Åpen').reduce((a, o) => a + o.lines.filter(l => l.finishedId === finishedId).reduce((b, l) => b + l.qty, 0), 0); }
export function tappingSuggestions(db) {
  const out = [];
  db.finished.forEach(f => {
    const demand = openOrderQty(db, f.id);
    const target = (f.min || 0) + demand;
    if (f.stock >= target || !target) return;
    const pk = pack(db, f.packId); const needUnits = target - f.stock;
    const needVol = needUnits * pk.volume; const avail = ibcVolume(db, f.productId);
    if (avail >= needVol && pk.stock >= needUnits)
      out.push({ finishedId: f.id, productId: f.productId, packId: f.packId, text: product(db, f.productId).name + ' ' + pk.volume + ' l: ' + f.stock + '/' + target + ' stk' + (demand ? ' (herav ' + demand + ' i kundeordrer)' : '') + '. Tapp ' + needUnits + ' stk (' + needVol + ' l) fra IBC (' + fmtNum(avail) + ' l tilgjengelig).', units: needUnits });
  });
  return out;
}
export function productionSuggestions(db) {
  const out = [];
  db.products.filter(p => p.status !== 'Inaktiv').forEach(p => {
    const iv = ibcVolume(db, p.id);
    const shortVariants = db.finished.filter(f => f.productId === p.id && ((f.min || 0) + openOrderQty(db, f.id)) > f.stock);
    const needVol = shortVariants.reduce((a, f) => a + (((f.min || 0) + openOrderQty(db, f.id)) - f.stock) * pack(db, f.packId).volume, 0);
    const reasons = [];
    if (iv < p.ibcMinL) reasons.push('IBC-beholdning ' + fmtNum(iv) + ' l er under minimum ' + fmtNum(p.ibcMinL) + ' l');
    if (needVol > iv && shortVariants.length) reasons.push('Ferdigvarer under minimum krever ' + fmtNum(needVol) + ' l, kun ' + fmtNum(iv) + ' l på IBC');
    const planned = db.productions.some(x => x.productId === p.id && ['I venteliste', 'Klar til produksjon', 'Under produksjon', 'Mangler råvarer', 'Mangler emballasje'].includes(x.status));
    if (reasons.length && !planned) {
      const rc = recipe(db, p.id);
      out.push({ productId: p.id, name: p.name, volume: rc ? rc.baseVolume : 1000, reason: reasons.join('. ') });
    }
  });
  return out;
}

// ---------- verdi og varsler ----------
export function stockValue(db) {
  const rawV = db.rawMaterials.reduce((a, r) => a + r.stock * r.price, 0);
  const packV = db.packaging.reduce((a, p) => a + p.stock * p.price, 0);
  const ibcV = db.ibcs.reduce((a, i) => a + (i.productId ? i.volume * costPerLiter(db, i.productId) : 0), 0);
  const finV = db.finished.reduce((a, f) => { const pk = pack(db, f.packId); return a + f.stock * (pk.volume * costPerLiter(db, f.productId) + pk.price); }, 0);
  const goodsV = (db.goods || []).reduce((a, g) => a + g.stock * g.price, 0);
  return { raw: rawV, pack: packV, ibc: ibcV, fin: finV, goods: goodsV, total: rawV + packV + ibcV + finV + goodsV };
}
export function alerts(db) {
  const out = []; const wd = db.settings.shelfWarnDays;
  const add = (id, sev, text, mod) => out.push({ id, sev, text, mod, status: db.alertStatus[id] || 'Åpen' });
  db.rawMaterials.filter(r => r.status === 'Aktiv').forEach(r => {
    if (r.min > 0 && r.stock <= r.min) add('rv-min-' + r.id, r.stock <= r.min * 0.5 ? 'Kritisk' : 'Høy', 'Råvare under minimum: ' + r.name + ' (' + fmtNum(r.stock) + ' av min. ' + fmtNum(r.min) + ' ' + r.unit + ')', 'raw');
    if (!r.hms && !r.hmsExempt && r.stock > 0) add('rv-hms-' + r.id, db.settings.hmsRequired ? 'Høy' : 'Normal', 'HMS-datablad mangler: ' + r.name, 'raw');
    if (r.expiry) { const d = daysUntil(r.expiry); if (d != null && d <= wd) add('rv-exp-' + r.id, d <= 0 ? 'Kritisk' : 'Normal', (d <= 0 ? 'Utløpt råvare: ' : 'Nærmer seg utløp: ') + r.name + ' (' + fmtDate(r.expiry) + ')', 'raw'); }
    if (!r.locId) add('rv-loc-' + r.id, 'Normal', 'Råvare mangler lokasjon: ' + r.name, 'raw');
  });
  db.packaging.filter(p => p.status === 'Aktiv').forEach(p => { if (p.min > 0 && p.stock <= p.min) add('em-min-' + p.id, p.stock <= p.min * 0.5 ? 'Kritisk' : 'Høy', 'Emballasje under minimum: ' + p.name + ' (' + p.stock + ' av min. ' + p.min + ')', 'pack'); });
  (db.goods || []).filter(g => g.status === 'Aktiv').forEach(g => { if (g.min > 0 && g.stock <= g.min) add('hv-min-' + g.id, g.stock <= g.min * 0.5 ? 'Kritisk' : 'Høy', 'Handelsvare under minimum: ' + g.name + ' (' + g.stock + ' av min. ' + g.min + ')', 'goods'); });
  db.products.forEach(p => { const iv = ibcVolume(db, p.id); if (iv < p.ibcMinL) add('ibc-min-' + p.id, 'Høy', 'IBC-beholdning under minimum: ' + p.name + ' (' + fmtNum(iv) + ' av ' + fmtNum(p.ibcMinL) + ' l)', 'ibc'); });
  db.ibcs.filter(i => i.status !== 'Tom' && i.status !== 'Kassert').forEach(i => {
    if (!i.locId) add('ibc-loc-' + i.id, 'Normal', 'IBC mangler plassering: ' + i.code + (i.productId ? ' · ' + (product(db, i.productId) || {}).name : ''), 'ibc');
    const d = daysUntil(i.expiry);
    if (d != null && d <= 0) add('ibc-exp-' + i.id, 'Kritisk', 'Utløpt IBC: ' + i.code + ' · ' + (product(db, i.productId) || {}).name + ' (' + fmtDate(i.expiry) + ')', 'ibc');
    else if (d != null && d <= wd) add('ibc-exp-' + i.id, 'Normal', 'IBC nærmer seg utløp: ' + i.code + ' (' + fmtDate(i.expiry) + ')', 'ibc');
    if (!i.locId) add('ibc-loc-' + i.id, 'Normal', 'IBC mangler lokasjon: ' + i.code, 'ibc');
    if (!i.batch) add('ibc-bat-' + i.id, 'Høy', 'IBC mangler batchnummer: ' + i.code, 'ibc');
  });
  db.finished.forEach(f => {
    const pk = pack(db, f.packId); const nm = product(db, f.productId).name + ' ' + pk.volume + ' l';
    if (f.min && f.stock < f.min) add('fv-min-' + f.id, f.stock <= f.min * 0.5 ? 'Kritisk' : 'Høy', 'Ferdigvare under minimum: ' + nm + ' (' + f.stock + ' av min. ' + f.min + ' stk)', 'fin');
    if (!f.locId) add('fv-loc-' + f.id, 'Normal', 'Ferdigvare mangler lokasjon: ' + nm, 'fin');
    f.batches.forEach(b => { const d = daysUntil(b.expiry); if (b.qty > 0 && d != null && d <= wd) add('fv-exp-' + f.id + b.batch, d <= 0 ? 'Kritisk' : 'Normal', (d <= 0 ? 'Utløpt batch: ' : 'Batch nærmer seg utløp: ') + nm + ' · ' + b.batch, 'fin'); });
  });
  db.productions.filter(p => ['I venteliste', 'Klar til produksjon', 'Mangler råvarer', 'Mangler emballasje'].includes(p.status)).forEach(p => {
    const b = prodBlockers(db, p, true);
    if (b.length) add('pr-blk-' + p.id, 'Høy', 'Planlagt produksjon ' + product(db, p.productId).name + ' ' + fmtNum(p.volume) + ' l: ' + b[0], 'plan');
  });
  const sevRank = { Kritisk: 0, Høy: 1, Normal: 2 };
  return out.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);
}

// ---------- sporing ----------
export function traceBatch(db, batch) {
  const p = db.productions.find(x => x.batch === batch);
  if (!p) return null;
  const prod = product(db, p.productId);
  const needs = calcNeeds(db, p.productId, p.volume);
  const ibcs = db.ibcs.filter(i => i.batch === batch);
  const taps = db.tappings.filter(t => t.batch === batch);
  const fin = db.finished.map(f => ({ f, b: f.batches.find(b => b.batch === batch) })).filter(x => x.b);
  const events = [];
  events.push({ date: p.plannedDate, text: 'Planlagt: ' + prod.name + ' · ' + fmtNum(p.volume) + ' l · ' + (tank(db, p.tankId) || {}).name });
  if (p.startedAt) events.push({ date: p.startedAt, text: 'Produksjon startet i ' + (tank(db, p.tankId) || {}).name + '. Råvarer trukket fra lager.' });
  taps.slice().reverse().forEach(t => events.push({ date: t.date, text: 'Tapping: ' + t.from + ' → ' + t.to + ' (' + fmtNum(t.volume) + ' l)' + (t.loss ? ' · svinn ' + t.loss + ' l' : '') }));
  if (p.finishedAt) events.push({ date: p.finishedAt, text: 'Produksjon fullført. Faktisk mengde ' + fmtNum(p.actualVolume) + ' l' + (p.loss ? ', svinn ' + fmtNum(p.loss) + ' l' : '') });
  return { p, prod, needs, ibcs, taps, fin, events };
}

export function exportCsv(name, headers, rows) {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const txt = [headers, ...rows].map(r => r.map(esc).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + txt], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv'; a.click();
}

export function orderText(db, lines, note) {
  let t = 'Hei,\n\nVi ønsker å bestille følgende:\n\n';
  lines.forEach(l => { t += '- ' + l.name + ': ' + fmtNum(l.qty) + ' ' + l.unit + '\n'; });
  if (note) t += '\n' + note + '\n';
  t += '\nLeveres til: Andebuveien 63, 3170 Sem\n\nMed vennlig hilsen\nKepler Bilservice AS – produksjon\nRing 33 33 44 00';
  return t;
}

// ---------- seed ----------
function seed() {
  const t = today();
  const L = [
    { id: 'l1', name: 'Lager A / Reol 1 / Hylle 1', note: 'Råvarer flytende' },
    { id: 'l2', name: 'Lager A / Reol 2 / Hylle 1', note: 'Råvarer pulver' },
    { id: 'l3', name: 'Lager A / Reol 3 / Hylle 2', note: 'Tilsetninger' },
    { id: 'l4', name: 'Lager B / IBC-hall / Sone 1', note: '' },
    { id: 'l5', name: 'Lager B / IBC-hall / Sone 2', note: '' },
    { id: 'l6', name: 'Lager C / Reol 1 / Plass A', note: 'Ferdigvarer' },
    { id: 'l7', name: 'Lager C / Reol 2 / Plass B', note: 'Ferdigvarer' },
    { id: 'l8', name: 'Lager D / Emballasje', note: '' },
  ];
  const hms = (n, d) => ({ name: n, date: d, size: '1,2 MB' });
  const RV = [
    { id: 'r1', name: 'Tensid AN-30', sku: 'RV-1001', supplier: 'Brenntag Nordic', price: 38, unit: 'kg', stock: 420, min: 300, max: 1200, orderPoint: 350, orderQty: 600, leadDays: 7, shelfMonths: 36, expiry: '', locId: 'l1', hms: hms('HMS_Tensid_AN30.pdf', '2026-01-12'), tds: null, comment: '', status: 'Aktiv' },
    { id: 'r2', name: 'Kaliumhydroksid 50 %', sku: 'RV-1002', supplier: 'Univar Solutions', price: 12, unit: 'l', stock: 180, min: 250, max: 1000, orderPoint: 300, orderQty: 800, leadDays: 10, shelfMonths: 24, expiry: '', locId: 'l1', hms: hms('HMS_KOH50.pdf', '2025-11-03'), tds: null, comment: 'Etsende – egen sone', status: 'Aktiv' },
    { id: 'r3', name: 'Sitronsyre monohydrat', sku: 'RV-1003', supplier: 'Azelis Norge', price: 24, unit: 'kg', stock: 90, min: 50, max: 300, orderPoint: 60, orderQty: 150, leadDays: 5, shelfMonths: 36, expiry: '', locId: 'l2', hms: null, tds: null, comment: '', status: 'Aktiv' },
    { id: 'r4', name: 'Etanol 96 %', sku: 'RV-1004', supplier: 'Solveco', price: 31, unit: 'l', stock: 640, min: 400, max: 1600, orderPoint: 500, orderQty: 800, leadDays: 7, shelfMonths: 12, expiry: addDays(t, 21), locId: 'l1', hms: hms('HMS_Etanol96.pdf', '2026-02-20'), tds: null, comment: 'Brannfarlig', status: 'Aktiv' },
    { id: 'r5', name: 'Kompleksbinder EDTA', sku: 'RV-1005', supplier: 'Brenntag Nordic', price: 55, unit: 'kg', stock: 35, min: 40, max: 200, orderPoint: 50, orderQty: 100, leadDays: 12, shelfMonths: 48, expiry: '', locId: 'l2', hms: hms('HMS_EDTA.pdf', '2025-09-14'), tds: null, comment: '', status: 'Aktiv' },
    { id: 'r6', name: 'Parfyme sitrus', sku: 'RV-1006', supplier: 'Firmenich', price: 240, unit: 'kg', stock: 18, min: 10, max: 40, orderPoint: 12, orderQty: 20, leadDays: 21, shelfMonths: 18, expiry: '', locId: 'l3', hms: hms('HMS_Parfyme_Sitrus.pdf', '2026-03-02'), tds: null, comment: '', status: 'Aktiv' },
    { id: 'r7', name: 'Fargestoff rød E-124', sku: 'RV-1007', supplier: 'Azelis Norge', price: 310, unit: 'kg', stock: 6, min: 4, max: 15, orderPoint: 5, orderQty: 8, leadDays: 14, shelfMonths: 60, expiry: '', locId: 'l3', hms: hms('HMS_E124.pdf', '2025-06-30'), tds: null, comment: '', status: 'Aktiv' },
    { id: 'r8', name: 'Lanolinbase LX', sku: 'RV-1008', supplier: 'Kemetyl', price: 66, unit: 'kg', stock: 510, min: 200, max: 800, orderPoint: 250, orderQty: 400, leadDays: 9, shelfMonths: 24, expiry: '', locId: 'l2', hms: hms('HMS_LanolinLX.pdf', '2026-04-11'), tds: null, comment: 'Til rustbeskyttelse', status: 'Aktiv' },
    { id: 'r9', name: 'Demineralisert vann', sku: 'RV-1009', supplier: 'Internt anlegg', price: 1.2, unit: 'l', stock: 9500, min: 4000, max: 20000, orderPoint: 5000, orderQty: 10000, leadDays: 1, shelfMonths: 6, expiry: '', locId: '', hms: hms('HMS_Demivann.pdf', '2025-01-05'), tds: null, comment: 'Eget RO-anlegg', status: 'Aktiv' },
  ];
  const PK = [
    { id: 'k1', name: 'IBC 1000 l', type: 'IBC', volume: 1000, stock: 6, min: 4, max: 12, price: 2400, supplier: 'Schütz Nordic', leadDays: 14, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k2', name: 'Fat 200 l', type: 'Fat', volume: 200, stock: 18, min: 10, max: 40, price: 890, supplier: 'Greif Norge', leadDays: 10, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k3', name: 'Kanne 25 l', type: 'Kanne', volume: 25, stock: 60, min: 150, max: 600, price: 74, supplier: 'RPC Promens', leadDays: 12, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k4', name: 'Flaske 0,5 l', type: 'Flaske', volume: 0.5, stock: 2400, min: 1000, max: 6000, price: 3.2, supplier: 'RPC Promens', leadDays: 12, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k5', name: 'Kork 28 mm', type: 'Kork', volume: 0, stock: 2500, min: 1500, max: 8000, price: 0.4, supplier: 'RPC Promens', leadDays: 12, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k6', name: 'Etikett Evershine 0,5 l', type: 'Etikett', volume: 0, stock: 1900, min: 2000, max: 10000, price: 0.9, supplier: 'Skipnes Etikett', leadDays: 8, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k7', name: 'Kartong 12 × 0,5 l', type: 'Kartong', volume: 0, stock: 260, min: 150, max: 800, price: 11, supplier: 'Smurfit Kappa', leadDays: 10, locId: 'l8', status: 'Aktiv', comment: '' },
    { id: 'k8', name: 'Europall', type: 'Pall', volume: 0, stock: 22, min: 10, max: 60, price: 120, supplier: 'Pallegrossisten', leadDays: 4, locId: 'l8', status: 'Aktiv', comment: '' },
  ];
  const PR = [
    { id: 'p1', name: 'Evershine Avfetting', code: 'AVF', shelfMonths: 24, ibcMinL: 1000, status: 'Aktiv' },
    { id: 'p2', name: 'Evershine Alkalisk Vask', code: 'ALK', shelfMonths: 24, ibcMinL: 2000, status: 'Aktiv' },
    { id: 'p3', name: 'Kepler Felgrens', code: 'FEL', shelfMonths: 18, ibcMinL: 1000, status: 'Aktiv' },
    { id: 'p4', name: 'Evershine Graphene Shampoo', code: 'GRA', shelfMonths: 12, ibcMinL: 500, status: 'Aktiv' },
  ];
  const RC = [
    { id: 'o1', productId: 'p1', baseVolume: 1000, version: 3, status: 'Aktiv', comment: 'Rev. 3 – redusert EDTA', lines: [{ rawId: 'r9', qty: 780, unit: 'l' }, { rawId: 'r1', qty: 120, unit: 'kg', note: 'Blandes inn litt om gangen under omrøring' }, { step: true, text: 'Vent i 5 minutter til blandingen er klar' }, { rawId: 'r2', qty: 60, unit: 'l' }, { rawId: 'r5', qty: 25, unit: 'kg' }, { rawId: 'r6', qty: 3, unit: 'kg', note: 'Tilsettes til slutt, rør forsiktig' }] },
    { id: 'o2', productId: 'p2', baseVolume: 1000, version: 5, status: 'Aktiv', comment: '', lines: [{ rawId: 'r9', qty: 800, unit: 'l' }, { rawId: 'r2', qty: 150, unit: 'l' }, { rawId: 'r1', qty: 40, unit: 'kg' }, { rawId: 'r5', qty: 8, unit: 'kg' }] },
    { id: 'o3', productId: 'p3', baseVolume: 1000, version: 2, status: 'Aktiv', comment: 'Syrebasert', lines: [{ rawId: 'r9', qty: 810, unit: 'l' }, { rawId: 'r3', qty: 90, unit: 'kg' }, { rawId: 'r1', qty: 70, unit: 'kg' }, { rawId: 'r7', qty: 1.5, unit: 'kg' }, { rawId: 'r6', qty: 2, unit: 'kg' }] },
    { id: 'o4', productId: 'p4', baseVolume: 1000, version: 1, status: 'Aktiv', comment: '', lines: [{ rawId: 'r9', qty: 850, unit: 'l' }, { rawId: 'r8', qty: 90, unit: 'kg' }, { rawId: 'r1', qty: 50, unit: 'kg' }, { rawId: 'r6', qty: 4, unit: 'kg' }] },
  ];
  const TK = [
    { id: 't1', name: 'Tank 1', capacity: 3000, status: 'Aktiv', productionId: 'pd1', responsible: 'Jonas M.', note: '' },
    { id: 't2', name: 'Tank 2', capacity: 3000, status: 'Ledig', productionId: null, responsible: '', note: '' },
    { id: 't3', name: 'Tank 3', capacity: 1000, status: 'Reservert', productionId: 'pd2', responsible: 'Sara L.', note: 'Reservert til Felgrens' },
    { id: 't4', name: 'Tank 4', capacity: 1000, status: 'Vasket', productionId: null, responsible: '', note: 'Vasket 12.08' },
  ];
  const PD = [
    { id: 'pd1', productId: 'p2', volume: 3000, tankId: 't1', priority: 'Høy', plannedDate: addDays(t, -1), status: 'Under produksjon', batch: 'ALK-20260813-T1-005', comment: '', responsible: 'Jonas M.', startedAt: addDays(t, -1), finishedAt: '', actualVolume: null, loss: null },
    { id: 'pd2', productId: 'p3', volume: 1000, tankId: 't3', priority: 'Normal', plannedDate: addDays(t, 1), status: 'Klar til produksjon', batch: '', comment: 'Kampanjeproduksjon', responsible: 'Sara L.', startedAt: '', finishedAt: '', actualVolume: null, loss: null },
    { id: 'pd3', productId: 'p1', volume: 3000, tankId: 't2', priority: 'Kritisk', plannedDate: addDays(t, 3), status: 'I venteliste', batch: '', comment: 'AVF 25 l under minimum', responsible: 'Jonas M.', startedAt: '', finishedAt: '', actualVolume: null, loss: null },
    { id: 'pd0', productId: 'p4', volume: 1000, tankId: 't3', priority: 'Normal', plannedDate: addDays(t, -9), status: 'Fullført', batch: 'GRA-20260805-T3-001', comment: '', responsible: 'Jonas M.', startedAt: addDays(t, -9), finishedAt: addDays(t, -9), actualVolume: 980, loss: 20 },
  ];
  const IB = [
    { id: 'i1', code: 'IBC-011', productId: 'p2', batch: 'ALK-20260721-T1-004', prodDate: '2026-07-21', volume: 400, max: 1000, status: 'Tilgjengelig', locId: 'l4', expiry: '2028-07-21', comment: '', history: [{ date: '2026-07-21', text: 'Fylt 1000 l fra Tank 1' }, { date: '2026-07-30', text: 'Tappet 24 × Kanne 25 l' }] },
    { id: 'i2', code: 'IBC-012', productId: 'p4', batch: 'GRA-20260805-T3-001', prodDate: '2026-08-05', volume: 1000, max: 1000, status: 'Tilgjengelig', locId: 'l4', expiry: '2027-08-05', comment: '', history: [{ date: '2026-08-05', text: 'Fylt 1000 l fra Tank 3' }] },
    { id: 'i3', code: 'IBC-013', productId: 'p4', batch: 'GRA-20260805-T3-001', prodDate: '2026-08-05', volume: 650, max: 1000, status: 'I bruk', locId: 'l5', expiry: '2027-08-05', comment: '', history: [{ date: '2026-08-05', text: 'Fylt 980 l fra Tank 3' }, { date: '2026-08-10', text: 'Tappet 660 × Flaske 0,5 l' }] },
    { id: 'i4', code: 'IBC-009', productId: 'p3', batch: 'FEL-20260618-T3-002', prodDate: '2026-06-18', volume: 250, max: 1000, status: 'Reservert for tapping', locId: 'l5', expiry: addDays(t, 18), comment: 'Prioriter tapping før utløp', history: [{ date: '2026-06-18', text: 'Fylt 1000 l fra Tank 3' }] },
    { id: 'i5', code: 'IBC-005', productId: 'p1', batch: 'AVF-20260430-T1-002', prodDate: '2026-04-30', volume: 120, max: 1000, status: 'Tilgjengelig', locId: '', expiry: '2028-04-30', comment: '', history: [{ date: '2026-04-30', text: 'Fylt 1000 l fra Tank 1' }] },
    { id: 'i6', code: 'IBC-002', productId: null, batch: '', prodDate: '', volume: 0, max: 1000, status: 'Tom', locId: 'l8', expiry: '', comment: 'Skylt og klar', history: [] },
  ];
  const FG = [
    { id: 'f1', productId: 'p1', packId: 'k3', stock: 14, min: 20, max: 80, locId: 'l6', status: 'Aktiv', batches: [{ batch: 'AVF-20260430-T1-002', qty: 14, date: '2026-05-02', expiry: '2028-04-30' }] },
    { id: 'f2', productId: 'p2', packId: 'k3', stock: 8, min: 24, max: 100, locId: 'l6', status: 'Aktiv', batches: [{ batch: 'ALK-20260721-T1-004', qty: 8, date: '2026-07-30', expiry: '2028-07-21' }] },
    { id: 'f3', productId: 'p4', packId: 'k4', stock: 130, min: 400, max: 2000, locId: 'l7', status: 'Aktiv', batches: [{ batch: 'GRA-20260805-T3-001', qty: 130, date: '2026-08-10', expiry: '2027-08-05' }] },
    { id: 'f4', productId: 'p3', packId: 'k2', stock: 5, min: 3, max: 12, locId: 'l7', status: 'Aktiv', batches: [{ batch: 'FEL-20260618-T3-002', qty: 5, date: '2026-06-20', expiry: addDays(t, 18) }] },
    { id: 'f5', productId: 'p1', packId: 'k4', stock: 900, min: 500, max: 3000, locId: 'l7', status: 'Aktiv', batches: [{ batch: 'AVF-20260430-T1-002', qty: 900, date: '2026-05-02', expiry: '2028-04-30' }] },
  ];
  return {
    v: 1, seqIbc: 14, seqPo: 15,
    settings: { batchFormat: '{KODE}-{DATO}-{TANK}-{LNR}', shelfWarnDays: 30, hmsRequired: true, requireLocation: true, allowNegative: false, orderEmailEnabled: false },
    users: [
      { id: 'u1', name: 'Truls K.', role: 'Admin' }, { id: 'u2', name: 'Jonas M.', role: 'Produksjonsleder' },
      { id: 'u3', name: 'Sara L.', role: 'Lager' }, { id: 'u4', name: 'Kari E.', role: 'Lesetilgang' },
    ],
    locations: L, rawMaterials: RV, packaging: PK, products: PR, recipes: RC, tanks: TK, productions: PD, ibcs: IB, finished: FG,
    tappings: [
      { id: 'tp1', date: '2026-08-10', from: 'IBC-013', to: '660 × Flaske 0,5 l', productId: 'p4', batch: 'GRA-20260805-T3-001', volume: 330, units: 660, user: 'Sara L.', locId: 'l7', loss: 0, comment: '' },
      { id: 'tp2', date: '2026-08-05', from: 'Tank 3', to: '2 × IBC', productId: 'p4', batch: 'GRA-20260805-T3-001', volume: 1980, units: 2, user: 'Jonas M.', locId: 'l4', loss: 20, comment: 'Normalt svinn' },
      { id: 'tp3', date: '2026-07-30', from: 'IBC-011', to: '24 × Kanne 25 l', productId: 'p2', batch: 'ALK-20260721-T1-004', volume: 600, units: 24, user: 'Sara L.', locId: 'l6', loss: 0, comment: '' },
    ],
    purchases: [
      { id: 'BF-2026-014', date: addDays(t, -6), status: 'Sendt', comment: 'Hastebestilling KOH', lines: [{ itemType: 'Råvare', itemId: 'r2', name: 'Kaliumhydroksid 50 %', qty: 800, unit: 'l', supplier: 'Univar Solutions', price: 12, received: 0 }] },
    ],
    counts: [],
    movements: [
      { id: 'm1', date: '2026-08-10T09:14:00Z', itemType: 'Ferdigvare', item: 'Evershine Graphene Shampoo 0,5 l', batch: 'GRA-20260805-T3-001', before: 0, change: 660, after: 660, reason: 'Tapping fra IBC-013', toLoc: 'Lager C / Reol 2 / Plass B', user: 'Sara L.' },
      { id: 'm2', date: '2026-08-05T13:02:00Z', itemType: 'Emballasje', item: 'IBC 1000 l', batch: 'GRA-20260805-T3-001', before: 8, change: -2, after: 6, reason: 'Tapping til IBC', user: 'Jonas M.' },
    ],
    audit: [
      { id: 'a1', date: '2026-08-13T07:55:00Z', user: 'Jonas M.', action: 'Startet produksjon', detail: 'ALK-20260813-T1-005 · Evershine Alkalisk Vask · 3000 l' },
      { id: 'a2', date: '2026-08-08T10:20:00Z', user: 'Truls K.', action: 'Sendt bestillingsforslag', detail: 'BF-2026-014 · Univar Solutions' },
      { id: 'a3', date: '2026-08-05T14:40:00Z', user: 'Jonas M.', action: 'Fullført produksjon', detail: 'GRA-20260805-T3-001 · 980 l → IBC-012, IBC-013' },
    ],
    alertStatus: {},
  };
}


if (typeof window !== "undefined") window.KeplerEngine = { uid, nowIso, today, addDays, addMonths, fmtDate, fmtNum, fmtNok, daysUntil, load, persist, reset, move, audit, raw, pack, product, recipe, tank, loc, costPerLiter, reservedRaw, calcNeeds, prodBlockers, genBatch, startProduction, finishProduction, doTapping, purchaseSuggestions, ibcVolume, openOrderQty, tappingSuggestions, productionSuggestions, stockValue, alerts, traceBatch, exportCsv, orderText };
