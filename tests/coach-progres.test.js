// Lancer : node tests/coach-progres.test.js
//          EXPORT_FILE=/chemin/export.json node tests/coach-progres.test.js   (tes vraies seances, lecture seule)
//
// Op. 4 etape 3 — onglet Progres branche sur le moteur.
// Execute les VRAIES fonctions d'index.html (coachProgres, lectures, et le calcul V1 de l'onglet : getHistory + analyzeEx)
// avec et sans moteur, et compare : historique, diagnostic, graphique, et les trois lectures performance / volume / tendance.
const H = require('./_harness.js'); const { SRC, vm, assert, fs } = H;
const E = require('../coach-engine.js');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }

const LIB = [fnSrc('function coachEngine('), fnSrc('function coachHistorique('), fnSrc('function coachDiagAffichage('), fnSrc('function coachBilanTexte('),
  fnSrc('function coachProgres('), fnSrc('function coachPlafondProgression('), fnSrc('function coachRaisonsTexte('), 'const COACH_TENDANCES = ' + literal('const COACH_TENDANCES = {', '{', '}') + ';',
  fnSrc('function coachSens('), fnSrc('function coachPct('), fnSrc('function coachLectureDerniere('), fnSrc('function coachLecturePeriode('),
  fnSrc('function e1RM('), fnSrc('function fmtDate('), fnSrc('function parseRir('), fnSrc('function analyzeEx('),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  // calcul V1 de l'onglet (tel qu'il est dans ProgressTab, repli quand le moteur n'est pas charge)
  'function v1Progres(sessions, selectedEx) {', fnSrc('  function getHistory(name) {'),
  '  const history = getHistory(selectedEx);',
  '  const selectedExRt = (sessions.flatMap(s => s.exercises || []).find(e => e.name === selectedEx) || {}).repsTarget;',
  '  const selectedExMax = selectedExRt ? parseInt((selectedExRt.split("-")[1] || selectedExRt.split("-")[0])) : 12;',
  '  const diag = (history.length >= 2 && selectedExMax <= 15) ? analyzeEx(history) : null;',
  '  const chartData = history.map(s => ({ date: fmtDate(s.date), rm: s.sets.length ? Math.max(...s.sets.map(st => e1RM(st.weight, st.reps))) : 0, charge: s.sets.length ? Math.max(...s.sets.map(st => st.weight)) : 0, tonnage: s.sets.reduce((a, st) => a + st.weight * st.reps, 0) }));',
  '  return { history, diag, chartData }; }',
  'this.v1Progres = v1Progres; this.coachProgres = coachProgres; this.coachEngine = coachEngine; this.coachLectureDerniere = coachLectureDerniere; this.coachLecturePeriode = coachLecturePeriode;'].join('\n');
function load(withEngine) { const ctx = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, console };
  ctx.window = withEngine ? { CoachEngine: E } : {}; vm.createContext(ctx); vm.runInContext(LIB, ctx); return ctx; }
const V1 = load(false), V2 = load(true);
const plain = o => JSON.parse(JSON.stringify(o));
const progSrc = () => SRC.slice(SRC.indexOf('function ProgressTab('), SRC.indexOf('function MiniCurve('));
const progres = (sessions, name) => plain(V2.coachProgres(V2.coachEngine(), sessions, name));

const S = (w, r, rir, x) => Object.assign({ weight: w, reps: r, rir: rir === undefined ? 2 : rir, done: true }, x || {});
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const day = i => new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10);
const hist = (rows, rt, name) => rows.map((x, k) => sess(k + 1, day(k), [{ name: name || 'Exo test', repsTarget: rt || '8-12', sets: x.split(',').map(y => S(...y.split('x').map(Number))) }]));
const lect = l => l && plain(l).map(r => r[0] + ': ' + r[1]);

const tests = []; const t = (n, f) => tests.push([n, f]); let infos = []; const info = s => infos.push(s);

// ── 1. Sans moteur : l'onglet garde le calcul V1 ──
t('Moteur charge : coachEngine() le trouve ; sans moteur : null (l\'onglet garde exactement le calcul V1)', () => {
  assert.strictEqual(V2.coachEngine(), E); assert.strictEqual(V1.coachEngine(), null);
  const src = progSrc();
  assert.ok(/const v2 = CE && selectedEx \? coachProgres\(CE, sessions, selectedEx\) : null;/.test(src));
  assert.ok(src.includes('const history = v2 ? v2.history : selectedEx ? getHistory(selectedEx) : [];'), 'repli historique V1');
  assert.ok(src.includes('const diag = v2 ? v2.diag : (history.length >= 2 && selectedExMax <= 15) ? analyzeEx(history) : null;'), 'repli diagnostic V1'); });

// ── 2. Comparaison avec le V1 sur des cas construits ──
t('Graphique : 1RM, charge max et tonnage identiques au V1 ; seule difference : « ≈ » quand la meilleure serie depasse 12 reps', () => {
  const s = hist(['60x10,60x9', '62.5x8,62.5x8', '20x15,20x14']);
  const a = plain(V1.v1Progres(s, 'Exo test')), b = progres(s, 'Exo test');
  assert.deepStrictEqual(b.chartData.map(d => [d.date, d.rm, d.charge, d.tonnage]), a.chartData.map(d => [d.date, d.rm, d.charge, d.tonnage]));
  assert.deepStrictEqual(b.chartData.map(d => d.fiable), [true, true, false]);
  assert.deepStrictEqual(b.history.map(h => h.best), a.chartData.map(d => d.rm), 'meilleure force de la liste = V1'); });
t('Diagnostic : memes textes que le V1 en 8-12 (progression, stable, plafond, regression, trop rapide)', () => {
  const cas = [['60x10,60x10', '60x11,60x10'], ['60x10,60x10', '60x10,60x10'], ['60x11,60x11,60x11', '60x11,60x11,60x11', '60x11,60x11,60x11'],
    ['80x10,80x10', '80x9,80x9', '80x8,80x8', '80x7,80x7'], ['60x10,60x10', '66x10,66x10']];
  cas.forEach(rows => { const s = hist(rows); const a = plain(V1.v1Progres(s, 'Exo test')).diag, b = progres(s, 'Exo test').diag;
    assert.deepStrictEqual(b && [b.title, b.msg], a && [a.title, a.msg], rows.join(' | ')); }); });
t('Diagnostic 10-15 : en repetitions et en charge, sans limite a 12 reps (le V1 lisait la force estimee)', () => {
  let b = progres(hist(['20x13,20x13', '20x14,20x13'], '10-15'), 'Exo test');
  assert.deepStrictEqual([b.diag.title, b.diag.msg], ['PROGRESSION OPTIMALE', '+1 rep(s) a 20kg depuis la derniere seance.']);
  b = progres(hist(['20x15,20x14', '20x15,20x15', '20x15,20x15,20x14'], '10-15'), 'Exo test');
  assert.deepStrictEqual([b.diag.title, b.diag.urgency], ['PROGRESSION — HAUT DE FOURCHETTE PRESQUE ATTEINT', 'EN PROGRESSION · HAUT DE FOURCHETTE'], 'plafond garde, presente comme une indication positive');
  b = progres(hist(['20x15,20x14,20x15', '20x15,20x15,20x14', '20x15,20x14,20x15'], '10-15'), 'Exo test');
  assert.deepStrictEqual([b.diag.title, b.diag.msg], ['STAGNATION — PLAFOND', 'Haut de fourchette atteint a 20kg depuis 3 seances (14.7 reps en moyenne).']);
  b = progres(hist(['20x15,20x15', '20x16,20x15', '20x18,20x17'], '15-20'), 'Exo test'); assert.strictEqual(b.diag, null, 'fourchette > 15 : pas de diagnostic (perimetre V1)');
  assert.strictEqual(plain(V1.v1Progres(hist(['20x15,20x15', '20x16,20x15'], '15-20'), 'Exo test')).diag, null); });

// ── 3. Trois lectures distinctes ──
t('PERFORMANCE / VOLUME / TENDANCE : une meilleure serie n\'est jamais confondue avec plus de travail', () => {
  const L = rows => lect(V2.coachLectureDerniere(progres(hist(rows), 'Exo test').synthese.derniere));
  assert.deepStrictEqual(L(['60x10,60x10', '62.5x10,62.5x9']), ['PERFORMANCE: En hausse', 'VOLUME: Stable', 'TENDANCE: Performance en hausse, volume de travail stable'], 'charge +2,5 kg, tonnage -1 %');
  assert.deepStrictEqual(L(['60x10,60x10,60x10', '60x11,60x10,60x10']), ['PERFORMANCE: En hausse', 'VOLUME: En hausse', 'TENDANCE: Progression globale : meilleure performance et plus de travail'], '+1 rep = +3,3 % de tonnage');
  assert.deepStrictEqual(L(['60x10,60x10,60x10', '60x11,60x11,60x11,60x10']), ['PERFORMANCE: En hausse', 'VOLUME: En hausse', 'TENDANCE: Progression globale : meilleure performance et plus de travail']);
  assert.deepStrictEqual(L(['160x10,160x10,160x10', '160x10,160x11']), ['PERFORMANCE: En hausse', 'VOLUME: En baisse', 'TENDANCE: Meilleure performance, mais moins de travail au total'], 'cas reel Leg press : 1 rep de plus, une serie de moins');
  assert.deepStrictEqual(L(['20x12', '20x12,20x12,20x12']), ['PERFORMANCE: En hausse', 'VOLUME: En hausse', 'TENDANCE: Plus de travail, sans meilleure performance'], 'cas reel Hip thrust : 2 series de plus, meme serie');
  assert.deepStrictEqual(L(['60x10,60x10', '60x10,60x10']), ['PERFORMANCE: Stable', 'VOLUME: Stable', 'TENDANCE: Performance et volume stables']);
  assert.deepStrictEqual(L(['60x10,60x10,60x10', '60x10,60x10']), ['PERFORMANCE: Stable', 'VOLUME: En baisse', 'TENDANCE: Performance maintenue avec moins de travail']);
  assert.deepStrictEqual(L(['60x10,60x10', '60x8,60x8']), ['PERFORMANCE: En baisse', 'VOLUME: En baisse', 'TENDANCE: Baisse de la performance et du volume']);
  const d = plain(V2.coachLectureDerniere(progres(hist(['20x12', '20x12,20x12,20x12']), 'Exo test').synthese.derniere));
  assert.deepStrictEqual([d[1][3], d[2][3]], ['1 → 3 séries · tonnage +200%', 'le gain vient des séries en plus, pas d\'une meilleure série']); });
t('Tendance sur les 8 dernieres seances : meilleure serie et tonnage separes ; « ≈ » si une meilleure serie depasse 12 reps', () => {
  const rows = ['60x8,60x8,60x8', '60x9,60x8,60x8', '60x10,60x9,60x9', '60x10,60x10', '62.5x9,62.5x8', '62.5x10,62.5x9'];
  const p = progres(hist(rows), 'Exo test').synthese.periode;
  assert.deepStrictEqual([p.seances, p.performance.sens, p.volume.sens, p.tendance], [6, 'hausse', 'baisse', 'meilleure_serie_seule']);
  assert.ok(p.performance.fiable);
  const l = V2.coachLecturePeriode(p); assert.ok(/^meilleure série \+\d+% \(force 76 → 83kg\)$/.test(l[0][3]), l[0][3]);
  const q = progres(hist(['20x13,20x13', '20x14,20x13', '20x15,20x14', '20x15,20x15'], '10-15'), 'Exo test').synthese.periode;
  assert.strictEqual(q.performance.fiable, false); assert.ok(V2.coachLecturePeriode(q)[0][3].includes('force ≈'));
  const many = Array.from({ length: 12 }, (_, i) => '60x' + (8 + (i % 4)) + ',60x8');
  assert.strictEqual(progres(hist(many), 'Exo test').synthese.periode.seances, 8, 'fenetre = 8 dernieres seances');
  assert.strictEqual(progres(hist(['60x8', '60x9']), 'Exo test').synthese.periode, null, 'moins de 3 seances : pas de tendance')
  const chg = hist(['160x10,160x10,160x10', '160x11,160x10,160x10', '160x11,160x11,160x11']).concat(hist(['120x15,120x15,120x15', '120x15,120x15,120x16', '120x16,120x16,120x16'], '15-20').map((x, k) => Object.assign(x, { id: 10 + k, date: day(5 + k) })));
  const pc = progres(chg, 'Exo test').synthese.periode;
  assert.deepStrictEqual([pc.seances, pc.fourchette, pc.performance.sens], [3, '15-20', 'hausse'], 'changement de fourchette (charge plus legere) : pas lu comme une baisse');
  assert.ok(V2.coachLecturePeriode(pc)[2][3].startsWith('3 séances en 15-20, du ')); });
t('Futures adaptations preparees mais NON activees : statut « non_activee », jamais affichees, aucune fonction pour les appliquer', () => {
  const s = progres(hist(['60x11,60x10,60x11', '60x11,60x11,60x10', '60x11,60x11,60x11', '60x11,60x11']), 'Exo test').synthese;
  assert.ok(s.pistes.length >= 1); s.pistes.forEach(p => assert.strictEqual(p.statut, 'non_activee'));
  const src = progSrc() + fnSrc('function coachLectureDerniere(') + fnSrc('function coachLecturePeriode(');
  assert.ok(!/pistes/.test(src), 'les pistes ne sont pas affichees');
  assert.ok(!Object.keys(E).some(k => /appliquer|apply|ecrire|save|write/i.test(k)), 'aucune fonction d\'ecriture dans le moteur'); });

// ── 3 bis. Verifications demandees (PLAFOND, rupture de charge, serie aberrante, fourchettes differentes) ──
t('PLAFOND en progression (cas reel Belt squat 80 kg, 8-12) : diagnostic positif garde + indication « augmenter la charge »', () => {
  const b = progres(hist(['80x11,80x11,80x12', '80x11,80x12,80x12', '80x12,80x12,80x12']), 'Exo test');
  assert.deepStrictEqual([b.diag.color, b.diag.title], ['#00C853', 'PROGRESSION — HAUT DE FOURCHETTE ATTEINT']);
  assert.strictEqual(b.diag.msg, '+1 rep à 80kg. Haut de fourchette atteint à 80kg (12 reps en moyenne, fourchette 8-12) : prochaine étape possible, augmenter la charge.');
  assert.deepStrictEqual(lect(V2.coachLectureDerniere(b.synthese.derniere))[0], 'PERFORMANCE: En hausse', 'le diagnostic positif de performance n\'est pas annule');
  const c = progres(hist(['75x10,75x10,75x11', '75x10,75x11,75x11', '75x11,75x11,75x11']), 'Exo test');
  assert.strictEqual(c.diag.title, 'PROGRESSION — HAUT DE FOURCHETTE PRESQUE ATTEINT', 'Chest press 75 kg : 11 reps en 8-12');
  const vrai = progres(hist(['80x12,80x12,80x12', '80x12,80x12,80x12', '80x12,80x12,80x12']), 'Exo test');
  assert.strictEqual(vrai.diag.title, 'STAGNATION — PLAFOND', 'sans progression : la vraie alerte plafond reste'); });
t('Rupture de charge (cas reel Hack squat 160 -> 120 kg, memes reps) : comparaison signalee non fiable, diagnostic et tendance seulement sur le bloc 120 kg, aucune donnee touchee', () => {
  const rows = ['160x10,160x10,160x10', '160x10,160x10,160x10', '160x10,160x10,160x11', '120x10,120x10,120x11', '120x10,120x11,120x11', '120x11,120x11,120x11', '120x11,120x11,120x12', '120x11,120x12,120x12'];
  const s = hist(rows, '10-15'), before = JSON.stringify(s), b = progres(s, 'Exo test');
  assert.strictEqual(JSON.stringify(s), before);
  assert.deepStrictEqual([b.synthese.periode.seances, b.synthese.periode.performance.sens, b.synthese.rupture.raisons[0].code], [5, 'hausse', 'rupture_charge']);
  assert.ok(V2.coachLecturePeriode(plain(b.synthese.periode), plain(b.synthese.rupture))[2][3].includes('charge 160 → 120kg (−25%) avec les mêmes reps'));
  assert.strictEqual(b.history.length, 8, 'historique complet affiche, rien fusionne');
  const juste = progres(hist(rows.slice(0, 4), '10-15'), 'Exo test');
  assert.deepStrictEqual(lect(V2.coachLectureDerniere(juste.synthese.derniere)), ['PERFORMANCE: Comparaison non fiable', 'VOLUME: En baisse', 'TENDANCE: Non interprétée']);
  assert.deepStrictEqual([juste.diag.urgency, juste.diag.msg], ['COMPARAISON NON FIABLE', 'Charge 160 → 120kg (−25%) avec les mêmes reps : changement de machine ou de réglage ? Le diagnostic reprendra après 2 séances comparables.']);
  const normal = progres(hist(['100x12,100x12,100x12', '105x8,105x8,105x8']), 'Exo test');
  assert.ok(normal.synthese.derniere.comparaison.fiable, 'une hausse de charge normale (reps qui redescendent) reste comparable'); });
t('Serie aberrante (cas reel 6,8 kg x 112 entre deux x 12) : ignoree pour force, graphique, tonnage, records et diagnostic ; affichee barree ; seance enregistree intacte', () => {
  const s = hist(['6.8x12,6.8x112,6.8x12', '6.8x12,6.8x12,6.8x13', '9x12,9x12,9x12'], '12-15'), before = JSON.stringify(s);
  const a = plain(V1.v1Progres(s, 'Exo test')), b = progres(s, 'Exo test');
  assert.strictEqual(JSON.stringify(s), before, 'donnee enregistree non modifiee');
  assert.deepStrictEqual(a.chartData.map(d => [d.rm, Math.round(d.tonnage)]), [[32, 925], [10, 252], [13, 324]], 'V1 : force 32 kg et tonnage x5,7 le 1er jour');
  assert.deepStrictEqual(b.chartData.map(d => [d.rm, d.tonnage]), [[10, 163.2], [10, 251.6], [13, 324]]);
  assert.deepStrictEqual(b.history[0].sets.map(x => [x.reps, x.suspecte]), [[12, false], [112, true], [12, false]], 'serie montee barree, pas cachee');
  const r = E.recordsExercice(E.historiqueExercice(E.normaliserSeances(s.slice(0, 2)), 'Exo test'), [{ weight: 9, reps: 12 }], E.lireFourchette('12-15'));
  assert.deepStrictEqual([r.record, r.force.avant], [true, 10], 'records : la reference passe de 32 kg (faux) a 10 kg');
  const nonFiltre = E.recordsExercice([{ date: 'x', series: s[0].exercises[0].sets.map(E.normaliserSerie) }, { date: 'y', series: s[1].exercises[0].sets.map(E.normaliserSerie) }], [{ weight: 9, reps: 12 }]);
  assert.strictEqual(nonFiltre.record, false, 'reference : sans protection, la serie x112 bloquait le record du 16/04');
  const jour = E.bilanExercice([], [{ weight: 20, reps: 10 }, { weight: 20, reps: 100 }, { weight: 20, reps: 10 }], E.lireFourchette('8-12'));
  assert.strictEqual(jour.jour.repsTotal, 20, 'une faute de frappe du jour est aussi ignoree par l\'analyse');
  const cent = E.filtrerSuspectes([10, 100, 10].map(r => E.normaliserSerie({ weight: 5, reps: r })), E.lireFourchette('100'));
  assert.strictEqual(cent.nb, 0, 'series de 100 : jamais marquees'); });
t('Fourchettes differentes (cas reel Leg press 8-12 -> 15-20) : plus de fausse regression, comparaison signalee non fiable', () => {
  const s = hist(['160x11,160x12,160x12']).concat(hist(['120x15,120x15,120x15'], '15-20').map(x => Object.assign(x, { id: 9, date: day(3) })));
  const b = progres(s, 'Exo test').synthese.derniere;
  assert.strictEqual(b.verdict, 'regression', 'la regle de comparaison elle-meme ne change pas');
  assert.deepStrictEqual(plain(b.comparaison), { fiable: false, raisons: [{ code: 'fourchette', avant: '8-12', apres: '15-20' }] });
  assert.deepStrictEqual(lect(V2.coachLectureDerniere(b))[0], 'PERFORMANCE: Comparaison non fiable');
  const diag = progres(hist(['60x10,60x10', '60x11,60x10']).concat(hist(['50x14,50x14', '50x14,50x15'], '10-15').map((x, k) => Object.assign(x, { id: 9 + k, date: day(4 + k) }))), 'Exo test');
  assert.strictEqual(diag.diag.title, 'PROGRESSION OPTIMALE', 'diagnostic calcule seulement sur les seances en 10-15'); });

// ── 4. Ordre chronologique ──
t('Historique trie par date puis par ordre d\'enregistrement, meme si les seances sont stockees dans le desordre', () => {
  const s = hist(['57.5x10,57.5x10', '60x10,60x9', '58.75x10,58.75x10']); const shuffled = [s[2], s[0], s[1]];
  const b = progres(shuffled, 'Exo test'); assert.deepStrictEqual(b.history.map(h => h.sets[0].weight), [57.5, 60, 58.75]);
  const twin = [sess(5, day(1), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(62.5, 8)] }]), sess(4, day(1), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(60, 8)] }])];
  assert.deepStrictEqual(progres(twin, 'Exo test').history.map(h => h.sets[0].weight), [60, 62.5], 'meme jour : id croissant');
  assert.deepStrictEqual(plain(V1.v1Progres(twin, 'Exo test')).history.map(h => h.sets[0].weight), [62.5, 60], 'reference : le V1 gardait l\'ordre du stockage'); });
t('Exercice en double dans une seance : 1re occurrence seulement (comme le V1) ; deux noms differents = deux historiques distincts', () => {
  const s = [sess(1, day(0), [{ name: 'Curl A', repsTarget: '8-12', sets: [S(12, 10)] }, { name: 'Curl A', repsTarget: '15-20', sets: [S(8, 18)] }, { name: 'Curl B', repsTarget: '8-12', sets: [S(14, 9)] }]),
    sess(2, day(1), [{ name: 'Curl A', repsTarget: '8-12', sets: [S(12, 11)] }])];
  const a = progres(s, 'Curl A'), b = progres(s, 'Curl B');
  assert.deepStrictEqual(a.history.map(h => h.sets.map(x => x.weight + 'x' + x.reps)), [['12x10'], ['12x11']]);
  assert.deepStrictEqual(b.history.map(h => h.sets.map(x => x.weight + 'x' + x.reps)), [['14x9']]); });

// ── 5. RIR ──
t('RIR : saisi, prerempli, inconnu ou ancien non verifie ne changent ni le diagnostic ni les lectures (le RIR n\'est pas un critere de progression)', () => {
  const base = ['60x10,60x10', '60x11,60x10', '60x11,60x11'];
  const variants = [undefined, { rir: null }, { rir: 2, rirSaisi: true }, { rir: 3 }, { rir: 1, rirSaisi: false, rirCible: 1 }];
  const out = variants.map(v => { const s = hist(base); s.forEach(x => x.exercises[0].sets = x.exercises[0].sets.map(st => Object.assign({}, st, v || {}))); const p = progres(s, 'Exo test');
    return JSON.stringify([p.diag, p.chartData, V2.coachLectureDerniere(p.synthese.derniere), V2.coachLecturePeriode(p.synthese.periode)]); });
  out.forEach(o => assert.strictEqual(o, out[0])); });

// ── 6. Protection des donnees ──
t('Lecture seule : seances, series et RIR jamais modifies (objets geles), y compris les anciens RIR non verifies', () => {
  const s = hist(['60x10,60x10', '60x11,60x10', '20x15,20x14', '60x11,60x11']); s[0].exercises[0].sets[0].rir = 3; s[1].exercises[0].sets[0].rirCible = 2;
  const deepFreeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const before = JSON.stringify(s); deepFreeze(s);
  progres(s, 'Exo test'); progres(s, 'Inconnu'); plain(V1.v1Progres(s, 'Exo test'));
  assert.strictEqual(JSON.stringify(s), before);
  const src = progSrc() + fnSrc('function coachProgres(');
  assert.ok(!/\bsave\(|localStorage|setSessions|supabase|autoBackup/.test(src), 'aucune ecriture dans l\'onglet Progres'); });
t('Exercice sans seance valide ou inconnu : aucun plantage, ecran « Aucune seance »', () => {
  const s = [sess(1, day(0), [{ name: 'Exo vide', repsTarget: '8-12', sets: [S('', ''), S(0, 10)] }])];
  assert.deepStrictEqual([progres(s, 'Exo vide').history.length, progres(s, 'Exo vide').synthese, progres(s, 'Inconnu').history.length], [0, null, 0]);
  assert.strictEqual(plain(V1.v1Progres(s, 'Exo vide')).history.length, 0); });

// ── 7. Donnees reelles (lecture seule) ──
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Donnees reelles : chaque exercice de tes seances dans l\'onglet Progres, V1 contre moteur ; export non modifie ; ecarts listes', () => {
  const before = JSON.stringify(EXP); const sessions = EXP.sessions;
  const noms = [...new Set(sessions.flatMap(s => (s.exercises || []).map(e => e.name)))].sort();
  let same = { hist: 0, chart: 0, diag: 0 }, n = 0, approx = 0, ordre = []; const diagDiff = [], chartDiff = [], tend = {}, tendP = {}, pistes = {}; let nonFiables = 0;
  noms.forEach(nm => { const a = plain(V1.v1Progres(sessions, nm)), b = progres(sessions, nm); n++;
    const key = h => h.map(x => x.date + ':' + x.sets.map(st => st.weight + 'x' + st.reps).join(','));
    if (JSON.stringify(key(a.history)) === JSON.stringify(key(b.history))) same.hist++; else ordre.push(nm);
    const cv = c => c.map(d => [d.date, d.rm, d.charge, Math.round(d.tonnage * 10) / 10]);
    if (JSON.stringify(cv(a.chartData)) === JSON.stringify(cv(b.chartData))) same.chart++; else chartDiff.push(nm + ' : ' + a.chartData.map((d, k) => JSON.stringify(cv([d])) === JSON.stringify(cv([b.chartData[k]])) ? '' : d.date + ' V1 ' + d.rm + 'kg / ' + d.tonnage + 'kg -> moteur ' + b.chartData[k].rm + 'kg / ' + b.chartData[k].tonnage + 'kg').filter(Boolean).join(', '));
    nonFiables += b.synthese && b.synthese.derniere.comparaison && !b.synthese.derniere.comparaison.fiable ? 1 : 0;
    approx += b.history.filter(h => h.fiable === false).length;
    const da = a.diag ? a.diag.title : '-', db = b.diag ? b.diag.title : '-';
    if (da === db && (!a.diag || a.diag.msg === b.diag.msg)) same.diag++; else diagDiff.push(nm + ' : V1 « ' + da + ' » / moteur « ' + db + ' »' + (b.diag ? ' (' + b.diag.msg + ')' : ''));
    if (b.synthese && b.synthese.derniere.tendance) tend[b.synthese.derniere.tendance] = (tend[b.synthese.derniere.tendance] || 0) + 1;
    if (b.synthese && b.synthese.periode) tendP[b.synthese.periode.tendance] = (tendP[b.synthese.periode.tendance] || 0) + 1;
    if (b.synthese) b.synthese.pistes.forEach(p => { assert.strictEqual(p.statut, 'non_activee'); pistes[p.code] = (pistes[p.code] || 0) + 1; }); });
  assert.strictEqual(JSON.stringify(EXP), before, 'export non modifie');
  assert.strictEqual(same.hist, n, 'meme historique (dates, series) que le V1 : ' + ordre.join(', '));
  assert.deepStrictEqual(chartDiff.map(x => x.split(' : ')[0]), ['Écarté poulie basse (Fly câble bas)'], 'graphique = V1 sauf la serie aberrante');
  chartDiff.forEach(x => info('graphique different : ' + x));
  info('derniere seance signalee « comparaison non fiable » : ' + nonFiables + ' exercice(s)');
  info(n + ' exercices ; historique identique au V1 : ' + same.hist + '/' + n + ' ; graphique identique : ' + same.chart + '/' + n + ' ; seances marquees « ≈ » : ' + approx);
  info('diagnostic identique au V1 : ' + same.diag + '/' + n); diagDiff.forEach(x => info('diag. different : ' + x));
  info('tendance derniere seance : ' + JSON.stringify(tend)); info('tendance 8 dernieres seances : ' + JSON.stringify(tendP)); info('pistes preparees (non activees, non affichees) : ' + JSON.stringify(pistes)); });

(async () => { let fail = 0;
  console.log('Moteur v' + E.VERSION + ' — onglet Progres (vraies fonctions d\'index.html, avec et sans moteur)' + (EXP ? ' | donnees reelles : ' + REAL : ''));
  for (const [n, f] of tests) { infos = []; try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0].slice(0, 500)); } infos.forEach(s => console.log('       info : ' + s)); }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
