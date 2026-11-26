// Lancer : node tests/plage-reference.test.js
//          EXPORT_FILE=/chemin/export.json node tests/plage-reference.test.js   (rejoue tes vraies seances, lecture seule)
//
// Commit A (moteur 0.12.0) — decisions de David du 26/11 :
//  Regle 1 (conseil en seance + charges pre-remplies) : derniere seance du MEME exercice dans la MEME plage, 28 jours maximum ;
//          sinon « Reference trop ancienne » ou « Premiere seance dans cette plage », sans chiffre ni charge pre-remplie.
//  Regle 2 (historique) : records = historique complet, separe par plage ; tendances = historique complet, dates reelles ;
//          bilan de fin de seance = derniere seance comparable sans limite d'age, date et anciennete affichees
//          (au-dela de 28 jours : information seulement, pas un conseil).
//  Alertes : seulement a l'interieur d'une periode sans interruption de plus de 28 jours.
const H = require('./_harness.js'); const { SRC, vm, assert, fs, REAL_PROGRAMME } = H;
const E = require('../coach-engine.js');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }

const LIB = [fnSrc('function coachReferenceTexte('), fnSrc('function coachReferenceSeance('), fnSrc('function fmtDate('), fnSrc('function coachEngine('), fnSrc('function coachA('), fnSrc('function coachHistorique('),
  fnSrc('function coachConseilAffichage('), fnSrc('function coachDiagAffichage('), fnSrc('function coachEcartTexte('), fnSrc('function coachFinSeance('), fnSrc('function coachBilanTexte('),
  fnSrc('function coachRaisonsTexte('), fnSrc('function coachIncompleteTexte('), 'const COACH_RAISONS = ' + literal('const COACH_RAISONS = {', '{', '}') + ';',
  'const COACH_UNITES = ' + literal('const COACH_UNITES = {', '{', '}') + ';', fnSrc('function coachRecordTexte('),
  fnSrc('function e1RM('), fnSrc('function parseRir('), fnSrc('function analyzeEx('), fnSrc('function getProgressionTip('),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  'this.api = { coachReferenceSeance, coachReferenceTexte, coachFinSeance, getProgressionTip, coachRecordTexte };'].join('\n');
const ctx = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console, window: { CoachEngine: E } };
vm.createContext(ctx); vm.runInContext(LIB, ctx); const A = ctx.api;
const plain = o => JSON.parse(JSON.stringify(o));

// « Aujourd'hui » fige (le conseil en seance lit l'horloge reelle du telephone).
const DateReelle = Date;
function aLaDate(iso, fn) { const fixe = new DateReelle(iso + 'T12:00:00').getTime();
  class DateFigee extends DateReelle { constructor(...a) { if (a.length) super(...a); else super(fixe); } static now() { return fixe; } }
  global.Date = DateFigee; try { return fn(); } finally { global.Date = DateReelle; } }
const plus = (iso, j) => { const d = new DateReelle(iso + 'T12:00:00'); d.setDate(d.getDate() + j); return d.toISOString().slice(0, 10); };

const S = (w, r, rir) => ({ weight: w, reps: r, rir: rir === undefined ? 2 : rir, done: true });
const sets = txt => txt.split(',').map(x => { const [w, r] = x.split('x').map(Number); return S(w, r); });
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const ex = (name, rt, txt) => ({ name, repsTarget: rt, sets: sets(txt) });
const H0 = (rows) => rows.map(([date, rt, txt], k) => sess(k + 1, date, [ex('Exo', rt, txt)]));
const histE = s => E.historiqueExercice(E.normaliserSeances(s), 'Exo');

const tests = []; const t = (n, f) => tests.push([n, f]); let infos = []; const info = s => infos.push(s);

// ── Regle 1 : conseil et charges pre-remplies ──
t('Alternance 8-12 / 15-20 : le conseil 15-20 se base sur la derniere seance en 15-20, jamais sur le 8-12 plus recent', () => {
  const s = H0([['2026-11-10', '15-20', '50x16,50x16,50x15'], ['2026-11-13', '8-12', '70x10,70x10,70x9'], ['2026-11-17', '15-20', '50x17,50x17,50x16'], ['2026-11-20', '8-12', '70x11,70x10,70x10']]);
  const r = E.referenceConseil(histE(s), '15-20', { aujourdhui: '2026-11-24' });
  assert.deepStrictEqual([r.statut, r.date, r.ageJours, r.fourchette.texte], ['ok', '2026-11-17', 7, '15-20']);
  const ref = aLaDate('2026-11-24', () => plain(A.coachReferenceSeance(s, 'Exo', '15-20')));
  assert.deepStrictEqual(ref.sets.map(x => x.weight + 'x' + x.reps), ['50x17', '50x17', '50x16'], 'charges pre-remplies du 15-20');
  const tip = aLaDate('2026-11-24', () => A.getProgressionTip(s[3].exercises[0].sets, s, 'Exo', '15-20', 3));
  assert.ok(tip && /50kg/.test(tip.msg) && !/70kg/.test(tip.msg), tip && tip.msg);
  const tip8 = aLaDate('2026-11-24', () => A.getProgressionTip(s[3].exercises[0].sets, s, 'Exo', '8-12', 3));
  assert.ok(tip8 && /70kg/.test(tip8.msg), tip8 && tip8.msg); });

t('10-12 et 10-15 sont deux plages differentes (strictement identiques seulement)', () => {
  assert.strictEqual(E.memePlage(E.lireFourchette('10-12'), E.lireFourchette('10-15')), false);
  assert.strictEqual(E.memePlage(E.lireFourchette('8-12'), E.lireFourchette('8 - 12')), true);
  const s = H0([['2026-11-20', '10-12', '30x12,30x12,30x12']]);
  const r = E.referenceConseil(histE(s), '10-15', { aujourdhui: '2026-11-24' });
  assert.deepStrictEqual([r.statut, r.reference], ['premiere_dans_plage', null]); });

t('28 jours : reference utilisee ; 29 jours : « Reference trop ancienne », sans chiffre ni charge pre-remplie', () => {
  const s = H0([['2026-10-27', '8-12', '60x10,60x10,60x10']]);
  assert.deepStrictEqual(pick(E.referenceConseil(histE(s), '8-12', { aujourdhui: '2026-11-24' })), ['ok', 28]);
  const r = E.referenceConseil(histE(s), '8-12', { aujourdhui: '2026-11-25' }); assert.deepStrictEqual(pick(r), ['reference_trop_ancienne', 29]);
  const ref = aLaDate('2026-11-25', () => plain(A.coachReferenceSeance(s, 'Exo', '8-12'))); assert.deepStrictEqual([ref.statut, ref.sets], ['reference_trop_ancienne', []]);
  const tip = aLaDate('2026-11-25', () => A.getProgressionTip(s[0].exercises[0].sets, s, 'Exo', '8-12', 3));
  assert.ok(/^Référence trop ancienne : dernière séance en 8-12 le 27\/10 \(il y a 29 j\)/.test(tip.msg) && !/\d+kg/.test(tip.msg), tip.msg);
  const tip28 = aLaDate('2026-11-24', () => A.getProgressionTip(s[0].exercises[0].sets, s, 'Exo', '8-12', 3)); assert.ok(/60kg|61|62/.test(tip28.msg), tip28.msg); });
function pick(r) { return [r.statut, r.ageJours]; }

t('Premiere seance dans une plage : message clair, aucune charge pre-remplie', () => {
  const s = H0([['2026-11-20', '8-12', '80x8,80x8,80x8']]);
  const tip = aLaDate('2026-11-24', () => A.getProgressionTip(s[0].exercises[0].sets, s, 'Exo', '15-20', 3));
  assert.strictEqual(tip.msg, 'Première séance dans cette plage (15-20) : pas de conseil chiffré ni de charge pré-remplie.');
  const ref = aLaDate('2026-11-24', () => plain(A.coachReferenceSeance(s, 'Exo', '15-20'))); assert.deepStrictEqual([ref.statut, ref.sets], ['premiere_dans_plage', []]);
  // Exercice jamais fait : rien du tout (comme avant).
  assert.strictEqual(aLaDate('2026-11-24', () => A.getProgressionTip([], [], 'Exo', '15-20', 3)), null); });

t('Cas reel PUSH 2 (chest press 15-20 apres 80 kg x 8 en 8-12) : ni « 80 kg », ni charge 80 pre-remplie', () => {
  const s = H0([['2026-11-16', '8-12', '75x10,75x11,75x11'], ['2026-11-20', '8-12', '75x11,75x11,75x11'], ['2026-11-23', '8-12', '80x8,80x8,80x8']]).map(x => { x.exercises[0].name = 'Chest press machine'; return x; });
  const tip = aLaDate('2026-11-26', () => A.getProgressionTip(s[2].exercises[0].sets, s, 'Chest press machine', '15-20', 3));
  assert.ok(!/80/.test(tip.msg), tip.msg);
  const ref = aLaDate('2026-11-26', () => plain(A.coachReferenceSeance(s, 'Chest press machine', '15-20'))); assert.deepStrictEqual(ref.sets, []); });

t('Les 3 chemins de pre-remplissage (debut de routine, ajout, remplacement) passent par la regle 1 ; « Rejouer » une seance reste explicite', () => {
  const n = (SRC.match(/= coachReferenceSeance\(sessions, /g) || []).length; assert.strictEqual(n, 3, n + ' appel(s)');
  ['const refS = coachReferenceSeance(sessions, ex.name,', 'const _addRef = coachReferenceSeance(sessions, ex,', 'const _repRef = coachReferenceSeance(sessions, ex,'].forEach(m => assert.ok(SRC.includes(m), m));
  info('replaySession (bouton « Rejouer » d\'une seance passee) recopie volontairement cette seance : non modifie'); });

// ── Regle 2 : records, tendances, bilan ──
t('Records : separes par plage, sur tout l\'historique (un vieux record reste un record)', () => {
  const s = H0([['2025-12-01', '8-12', '90x10,90x10'], ['2026-11-10', '15-20', '50x18,50x18'], ['2026-11-20', '8-12', '80x9,80x9']]);
  const h = histE(s);
  const r812 = E.recordsExercice(h, sets('85x10'), '8-12'); assert.ok(!r812 || !r812.record, 'le 90 kg de 2025 reste le record en 8-12');
  const r1520 = E.recordsExercice(h, sets('55x18'), '15-20'); assert.ok(r1520 && r1520.record && r1520.chargeMax && r1520.chargeMax.charge === 55, JSON.stringify(r1520));
  assert.ok(/ · record en 15-20$/.test(A.coachRecordTexte(r1520)), A.coachRecordTexte(r1520));
  const seul = E.recordsExercice(histE(H0([['2026-11-10', '8-12', '50x10']])), sets('55x10'), '8-12'); assert.ok(!/record en/.test(A.coachRecordTexte(seul)), 'une seule plage : pas de mention');
  assert.ok(!E.recordsExercice(h, sets('91x10'), '15-20') || E.recordsExercice(h, sets('91x10'), '15-20').chargeMax.charge === 91); });

t('Tendances : dates reelles (2 mois d\'arret ne comptent pas comme une seance d\'ecart)', () => {
  const rows = [['2026-09-01', '8-12', '60x10,60x10'], ['2026-09-04', '8-12', '62x10,62x10'], ['2026-09-08', '8-12', '64x10,64x10'], ['2026-11-10', '8-12', '66x10,66x10']];
  const tr = E.tendance(histE(H0(rows)), E.lireFourchette('8-12'));
  const ys = [60, 62, 64, 66].map(w => E.e1RM(w, 10));
  const parIndex = E.tendance(histE(H0(rows.map((r, k) => [plus('2026-09-01', 3 * k), r[1], r[2]]))), E.lireFourchette('8-12'));
  assert.ok(tr && parIndex && tr.variationPct !== parIndex.variationPct, JSON.stringify([tr, parIndex]));
  assert.deepStrictEqual([tr.du, tr.au, tr.seances], ['2026-09-01', '2026-11-10', 4]);
  info('meme 4 seances : ' + parIndex.variationPct + ' % a intervalles reguliers, ' + tr.variationPct + ' % avec 2 mois d\'arret (dates reelles) ; ys ' + ys.join('/')); });

t('Bilan de fin de seance : reference ancienne datee, avec la mention « information seulement »', () => {
  const s = H0([['2026-08-01', '8-12', '60x10,60x10,60x10']]);
  const fin = plain(A.coachFinSeance(E, s, [ex('Exo', '8-12', '62.5x10,62.5x10,62.5x10')], '2026-11-24', 9));
  assert.deepStrictEqual(fin.progressed, ['Exo']);
  assert.strictEqual(fin.references.Exo, 'comparé au 01/08 (il y a 115 j) · comparaison ancienne : information seulement, pas un conseil pour la prochaine séance');
  const recent = plain(A.coachFinSeance(E, H0([['2026-11-20', '8-12', '60x10,60x10,60x10']]), [ex('Exo', '8-12', '62.5x10,62.5x10,62.5x10')], '2026-11-24', 9));
  assert.strictEqual(recent.references.Exo, 'comparé au 20/11 (il y a 4 j)');
  assert.ok(SRC.includes('postSeanceModal.references'), 'reference affichee dans la fenetre de fin de seance'); });

// ── Alertes : periode sans interruption > 28 jours ──
const F812 = E.lireFourchette('8-12');
t('Alertes : coupure apres plus de 28 jours sans la seance ; pas de fausse baisse ni de fausse progression a la reprise', () => {
  const rows = [['2026-08-01', '8-12', '80x10,80x10,80x10'], ['2026-08-05', '8-12', '80x11,80x11,80x10'], ['2026-08-09', '8-12', '80x12,80x12,80x11'], ['2026-10-01', '8-12', '70x10,70x10,70x9']];
  const a = E.analyseExercice(histE(H0(rows)), { fourchette: F812 });
  assert.strictEqual(a.alerte, null, 'aucune alerte (baisse) tiree d\'avant l\'interruption');
  assert.ok(a.bloc.rupture && a.bloc.rupture.raisons.some(r => r.code === 'interruption' && r.jours === 53), JSON.stringify(a.bloc));
  // Reprise : la 2e seance de la nouvelle periode compare a la 1re, plus a celles d'avant l'interruption.
  const b = E.analyseExercice(histE(H0(rows.concat([['2026-10-04', '8-12', '70x11,70x10,70x10']]))), { fourchette: F812 });
  assert.strictEqual(b.bloc.seances, 2); assert.strictEqual(a.statut, 'non_comparable'); assert.ok(!b.alerte || b.alerte.code !== 'regression');
  // Sans interruption (<= 28 j) : meme suite de seances, le bloc continue.
  const c = E.analyseExercice(histE(H0(rows.map((r, k) => [plus('2026-08-01', 4 * k), r[1], r[2]]))), { fourchette: F812 });
  assert.ok(!c.bloc.rupture || !c.bloc.rupture.raisons.some(r => r.code === 'interruption')); });

// ── Garde-fous ──
t('Aucune proposition automatique, aucune donnee modifiee (seances gelees)', () => {
  const fz = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(fz); } return o; };
  const s = fz(H0([['2026-11-10', '15-20', '50x16,50x16'], ['2026-11-13', '8-12', '70x10,70x10'], ['2026-11-20', '8-12', '70x11,70x10']])); const avant = JSON.stringify(s);
  aLaDate('2026-11-24', () => { A.getProgressionTip(s[2].exercises[0].sets, s, 'Exo', '15-20', 3); A.coachReferenceSeance(s, 'Exo', '15-20'); A.coachFinSeance(E, s, [ex('Exo', '15-20', '52x16')], '2026-11-24', 9); });
  const an = E.analyser(E.normaliserSeances(s), { maintenant: '2026-11-24' }); assert.deepStrictEqual(an.propositions, []);
  assert.strictEqual(JSON.stringify(s), avant); });

// ── Ton export (lecture seule) ──
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Ton export : conseil de la prochaine seance pour chaque exercice de tes routines (regle 1, lendemain de la derniere seance)', () => {
  const avant = JSON.stringify(EXP); const der = EXP.sessions.map(x => String(x.date).slice(0, 10)).sort().pop(), auj = plus(der, 1);
  const tally = {}, lignes = [];
  (EXP.routines || []).forEach(rt => (rt.exercises || []).forEach(e => { const r = aLaDate(auj, () => plain(A.coachReferenceSeance(EXP.sessions, e.name, e.repsTarget || '8-12')));
    tally[r.statut] = (tally[r.statut] || 0) + 1; if (r.statut !== 'ok') lignes.push(rt.name.split(' ')[0] + ' ' + rt.name.split(' ')[1] + ' / ' + e.name + ' (' + e.repsTarget + ') : ' + r.statut + (r.ageJours !== null && r.ageJours !== undefined ? ' (' + r.ageJours + ' j)' : '')); }));
  assert.strictEqual(JSON.stringify(EXP), avant, 'export non modifie');
  info('au ' + auj + ' : ' + JSON.stringify(tally) + (lignes.length ? '\n         - ' + lignes.join('\n         - ') : '')); });

(async () => { let fail = 0;
  console.log('Commit A — plages identiques, reference 28 jours, historique complet (moteur v' + E.VERSION + ')');
  for (const [n, f] of tests) { infos = []; try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).slice(0, 800)); } infos.forEach(s => console.log('       info : ' + s)); }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
