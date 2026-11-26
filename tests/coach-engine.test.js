// Lancer : node tests/coach-engine.test.js
//          EXPORT_FILE=/chemin/export.json node tests/coach-engine.test.js   (ajoute les controles sur un export reel, lu seulement)
//
// Tests du moteur d'analyse coach-engine.js (op. 3, moteur NON branche a index.html).
//   A. Purete : aucun acces au stockage / reseau / ecran, donnees recues jamais modifiees, aucune fonction « appliquer ».
//   B. Normalisation : RIR, fourchettes, dates, tri chronologique.
//   C. Mesures et catalogue.
//   D. Comportements V1 conserves : compares au VRAI code V1 d'index.html (e1RM, parseRir, analyzeEx, getProgressionTip) sur
//      des milliers de cas generes (graine fixe, resultats reproductibles).
//   E. Incoherences V1 corrigees dans le moteur (tri, une definition de la progression, seuil unique, routine de l'utilisateur...).
//   F. Domaines prepares : fatigue, recuperation, volume, priorites, morphologie, propositions.
//   G. Cas limites.
//   H. Donnees representatives (jeu synthetique ; export reel si EXPORT_FILE).
const H = require('./_harness.js'); const { SRC, vm, fs, assert, REAL_PROGRAMME } = H;
const path = require('path');
const ENGINE_FILE = path.join(__dirname, '..', 'coach-engine.js');
const ENGINE_SRC = fs.readFileSync(ENGINE_FILE, 'utf8');
const E = require(ENGINE_FILE);

// ───────── Vrai code V1 (meme chargement que tests/coach-v1-reference.test.js) ─────────
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); if (i < 0) throw new Error('introuvable : ' + start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }
// Tables V1 retirees d'index.html a l'etape 2 recuperation (commit 432b2ca = derniere version qui les contient) : copie figee pour comparaison.
const V1_MUSCLE_MAP = { "Élévations latérales": "Épaules", "Développé militaire": "Épaules", "Développé couché": "Pectoraux", "Écarté": "Pectoraux", "Extension triceps": "Triceps", "Dips": "Triceps", "Oiseau": "Deltoïde post.", "Tractions": "Dos", "Tirage": "Dos", "Rowing": "Dos", "Pull-over": "Dos", "Curl": "Biceps", "Adducteurs": "Jambes", "Leg extension": "Quadriceps", "Hack squat": "Quadriceps", "Leg press": "Quadriceps", "Leg curl": "Ischio-jambiers", "Mollets": "Mollets" };
const V1_MUSCLE_GROUPS = { "Épaules": ["Élévations latérales","Développé militaire"], "Pectoraux": ["Développé couché","Écarté"], "Triceps": ["Extension triceps","Dips"], "Deltoïde post.": ["Oiseau"], "Dos": ["Tractions","Tirage","Rowing","Pull-over"], "Biceps": ["Curl"], "Quadriceps": ["Hack squat","Leg extension","Leg press"], "Ischio-jambiers": ["Leg curl"], "Mollets": ["Mollets"], "Adducteurs": ["Adducteurs"] };
const V = { Math, JSON, Object, Array, String, Number, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console };
vm.createContext(V);
vm.runInContext([fnSrc('function coachEngine('), fnSrc('function e1RM('), fnSrc('function parseRir('), fnSrc('function analyzeEx('), fnSrc('function getProgressionTip('),
  'const DB = ' + literal('const DB = {', '{', '}') + '; const ALL_EXERCISES = Object.values(DB).flat();',
  'const MUSCLE_MAP = ' + JSON.stringify(V1_MUSCLE_MAP) + ';', 'const MUSCLE_GROUPS = ' + JSON.stringify(V1_MUSCLE_GROUPS) + ';',
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  'this.v1 = { e1RM, parseRir, analyzeEx, getProgressionTip, ALL_EXERCISES, MUSCLE_MAP, MUSCLE_GROUPS, normalizeExName };'].join('\n'), V);
const v1 = V.v1;
const groupOfV1 = name => (Object.entries(v1.MUSCLE_GROUPS).find(([, kws]) => kws.some(k => name.includes(k))) || [])[0] || null;
const muscleOfV1 = name => (Object.entries(v1.MUSCLE_MAP).find(([k]) => name.includes(k)) || [])[1] || 'Autre';

// ───────── Outils de donnees (synthetiques) ─────────
const S = (w, r, rir, extra) => Object.assign({ weight: w, reps: r, rir: rir === undefined ? 2 : rir, done: true }, extra || {});
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const ex = (name, sets, repsTarget) => ({ name, repsTarget: repsTarget === undefined ? '8-12' : repsTarget, sets });
const plain = o => JSON.parse(JSON.stringify(o));
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const day = i => new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10);
// historique moteur a partir de seances brutes
// 0.12.0 : le conseil (regle 1) depend de la date du jour (reference de 28 jours au plus). Les cas historiques ci-dessous sont
// evalues le jour de leur derniere seance, comme le ferait l'appli ce jour-la.
const conseilJ = (h, o) => E.conseilProgression(h, Object.assign({ aujourdhui: (h || []).reduce((m, x) => (x && x.date && x.date > m ? x.date : m), '2000-01-01') }, o || {}));
const histOf = (sessions, name) => E.historiqueExercice(E.normaliserSeances(sessions), name);

const tests = []; const t = (group, n, f) => tests.push([group, n, f]);

// ═════════ A. PURETE ═════════
t('A', 'Le moteur se charge et analyse dans un bac a sable SANS localStorage, window, document, fetch ni Supabase', () => {
  const box = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, isFinite, Infinity };
  box.self = box; vm.createContext(box); vm.runInContext(ENGINE_SRC, box);
  assert.ok(box.CoachEngine && typeof box.CoachEngine.analyser === 'function', 'expose CoachEngine dans le navigateur');
  const r = box.CoachEngine.analyser({ sessions: [sess(1, '2026-01-01', [ex('Squat barre', [S(100, 8)])])] }, { maintenant: '2026-01-05' });
  assert.strictEqual(r.donnees.seances, 1); assert.deepStrictEqual(Object.keys(box).filter(k => !['Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Infinity', 'self', 'CoachEngine'].includes(k)), [], 'aucune variable globale creee'); });
t('A', 'Le code ne fait reference a aucun stockage, reseau, ecran ou horloge cachee (hors commentaires)', () => {
  const code = ENGINE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'supabase', 'document.', 'window.', 'React', 'setTimeout', 'Math.random', 'lsSetNs', 'lsGetNs', 'it3_'].forEach(w => assert.ok(!code.includes(w), 'reference interdite : ' + w));
  assert.strictEqual((code.match(/new Date\(\)/g) || []).length, 1, 'une seule lecture de l\'horloge : la date du jour par defaut de analyser()'); });
t('A', 'Les donnees recues (gelees) ne sont jamais modifiees : seances, routines, reponses de fatigue, profil, options', () => {
  const data = deepFreeze({ sessions: [sess(2, '2026-01-03', [ex('Squat barre', [S('100', '8', '0', { rirSaisi: true }), S(100, 7)])]), sess(1, '2026-01-01', [ex('Squat barre', [S(95, 8)])])],
    routines: [{ id: 1, name: 'R', exercises: [{ name: 'Squat barre', sets: 4, repsTarget: '8-12' }] }], fatigue: { sommeil: 2, motivation: 1 }, profil: { taille: 180 } });
  const opts = deepFreeze({ maintenant: '2026-01-05', classements: { X: { principal: 'Dos' } } });
  const before = JSON.stringify(data);
  const r = E.analyser(data, opts); assert.strictEqual(JSON.stringify(data), before);
  assert.strictEqual(data.sessions[0].id, 2, 'l\'ordre stocke reste celui recu (le tri se fait sur une copie)');
  r.exercices['Squat barre'].derniereMesure.force = -1; assert.strictEqual(JSON.stringify(data), before, 'modifier le resultat ne touche pas les donnees'); });
t('A', 'API figee ; aucune fonction qui appliquerait une adaptation ; propositions = liste vide', () => {
  assert.ok(Object.isFrozen(E) && Object.isFrozen(E.REGLES));
  assert.ok(!Object.keys(E).some(k => /appliqu|apply|save|enregistr|ecrire|write|set[A-Z]/i.test(k)), Object.keys(E).join(','));
  assert.deepStrictEqual(E.analyser({ sessions: [] }, { maintenant: '2026-01-01' }).propositions, []); });
t('A', 'Resultats deterministes : deux analyses identiques des memes donnees donnent le meme resultat', () => {
  const d = representative(); assert.deepStrictEqual(plain(E.analyser(d, { maintenant: '2026-06-01' })), plain(E.analyser(d, { maintenant: '2026-06-01' }))); });
t('A', 'index.html charge le moteur AVANT le script Babel ; sans moteur (fichier absent), coachEngine() rend null et le V1 s\'applique', () => {
  const i = SRC.indexOf('<script src="/coach-engine.js"></script>'), j = SRC.indexOf('<script type="text/babel">'); assert.ok(i > 0 && i < j);
  const box = {}; vm.createContext(box); vm.runInContext(fnSrc('function coachEngine(') + '; this.r = coachEngine();', box); assert.strictEqual(box.r, null);
  const box2 = { window: { CoachEngine: E } }; vm.createContext(box2); vm.runInContext(fnSrc('function coachEngine(') + '; this.r = coachEngine();', box2); assert.strictEqual(box2.r, E); });

// ═════════ B. NORMALISATION ═════════
t('B', 'lireRir = parseRir du V1 sur toutes les entrees (0 conserve ; absent, vide, texte, hors 0-10 = inconnu)', () => {
  [0, '0', 1, '3', 5, 10, '10', 11, -1, '', null, undefined, 'abc', '2.7', 2.7, ' 4', 'RIR 2'].forEach(v => assert.strictEqual(E.lireRir(v), v1.parseRir(v), 'valeur ' + JSON.stringify(v))); });
t('B', 'statutRir : saisi / prerempli / non_verifie (anciennes series) / inconnu', () => {
  assert.strictEqual(E.statutRir({ rir: 0, rirSaisi: true }), 'saisi'); assert.strictEqual(E.statutRir({ rir: 2, rirSaisi: false }), 'prerempli');
  assert.strictEqual(E.statutRir({ rir: 2 }), 'non_verifie'); assert.strictEqual(E.statutRir({ rir: null, rirSaisi: false }), 'inconnu');
  assert.strictEqual(E.statutRir({ rirSaisi: true }), 'inconnu'); assert.strictEqual(E.statutRir({ rir: '' }), 'inconnu'); });
t('B', 'Fourchettes : 8-12, « 10- 15 », 20, 100 (serie de 100), 45-60s (duree), vide = 8-12 par defaut, illisible = inconnu', () => {
  const f = E.lireFourchette;
  assert.deepStrictEqual([f('8-12').type, f('8-12').min, f('8-12').max], ['reps', 8, 12]);
  assert.deepStrictEqual([f('10- 15').min, f('10- 15').max], [10, 15]); assert.deepStrictEqual([f('20').min, f('20').max], [20, 20]);
  assert.strictEqual(f('100').type, 'serie100'); assert.deepStrictEqual([f('45-60s').type, f('45-60s').min, f('45-60s').max], ['duree', 45, 60]);
  assert.deepStrictEqual([f('').min, f('').max, f('').defaut], [8, 12, true]); assert.strictEqual(f(undefined).defaut, true);
  assert.strictEqual(f('abc').type, 'inconnu'); assert.deepStrictEqual([f('15-10').min, f('15-10').max], [10, 15]); });
t('B', 'Tri chronologique unique : par date, puis par id, sans date a la fin ; tableau d\'origine intact', () => {
  const a = [sess(30, '2026-01-03', []), sess(10, '2026-01-01', []), { id: 99, exercises: [] }, sess(21, '2026-01-02', []), sess(20, '2026-01-02', [])];
  const copy = plain(a); assert.deepStrictEqual(E.trierSeances(a).map(s => s.id), [10, 20, 21, 30, 99]); assert.deepStrictEqual(plain(a), copy); });
t('B', 'Dates : date locale (pas UTC), jours calendaires exacts meme au changement d\'heure', () => {
  assert.strictEqual(E.dateLocale('2026-11-22'), '2026-11-22'); assert.strictEqual(E.dateLocale(new Date(2026, 10, 22, 23, 59)), '2026-11-22');
  assert.strictEqual(E.dateLocale(new Date(2026, 10, 23, 0, 30)), '2026-11-23');
  assert.strictEqual(E.joursEntre('2026-03-28', '2026-03-30'), 2); assert.strictEqual(E.joursEntre('2026-10-24', '2026-10-26'), 2); assert.strictEqual(E.joursEntre('2026-01-05', '2026-01-01'), -4); });
t('B', 'Series : virgule decimale lue (« 52,5 »), serie sans charge ou sans reps = non valide, type d\'origine garde', () => {
  const n = E.normaliserSerie; assert.strictEqual(n({ weight: '52,5', reps: '8' }).charge, 52.5); assert.strictEqual(n({ weight: '52,5', reps: '8' }).valide, true);
  assert.strictEqual(n({ weight: 0, reps: 8 }).valide, false); assert.strictEqual(n({ weight: 50, reps: '' }).valide, false); assert.strictEqual(n({ weight: -5, reps: 8 }).valide, false);
  assert.strictEqual(n({ weight: 50, reps: 8, setType: 'normal' }).type, 'normal'); });
t('B', 'Exercice present deux fois dans une seance : une seule entree d\'historique, PREMIERE occurrence analysee (comme le V1), occurrences comptees', () => {
  const ss = [sess(1, '2026-01-01', [ex('Curl haltères', [S(14, 10)]), ex('Squat barre', [S(100, 8)]), ex('Curl haltères', [S(10, 15), S(10, 14)], '15-20')])];
  const h = histOf(ss, 'Curl haltères'); assert.strictEqual(h.length, 1); assert.deepStrictEqual([h[0].series.length, h[0].series[0].charge, h[0].fourchette.texte, h[0].occurrences], [1, 14, '8-12', 2]); });
t('B', 'Noms differents = historiques distincts (aucune fusion d\'exercices renommes)', () => {
  const ss = [sess(1, '2026-01-01', [ex('Curl câble unilatéral face poulie', [S(10, 10)])]), sess(2, '2026-01-03', [ex('Curl câble unilatéral face poulie (nouveau nom)', [S(10, 11)])])];
  assert.strictEqual(histOf(ss, 'Curl câble unilatéral face poulie').length, 1); assert.strictEqual(histOf(ss, 'Curl câble unilatéral face poulie (nouveau nom)').length, 1); });
t('B', 'Correction des noms : la fonction de l\'appli (normalizeExName) peut etre transmise ; historique regroupe', () => {
  const ss = [sess(1, '2026-01-01', [ex('Leg curl assis', [S(40, 10)])]), sess(2, '2026-01-03', [ex('Leg curl assis machine', [S(40, 11)])])];
  assert.strictEqual(E.historiqueExercice(E.normaliserSeances(ss, { normaliserNom: v1.normalizeExName }), 'Leg curl assis machine').length, 2);
  assert.strictEqual(E.historiqueExercice(E.normaliserSeances(ss), 'Leg curl assis machine').length, 1, 'sans correction : rien n\'est devine'); });

// ═════════ C. MESURES ET CATALOGUE ═════════
t('C', 'Force : e1RM du moteur = e1RM du V1 sur 2 000 couples charge/reps (y compris textes et valeurs invalides)', () => {
  const r = rng(7); for (let i = 0; i < 2000; i++) { const w = Math.round(r() * 2000) / 10, k = Math.floor(r() * 25); assert.strictEqual(E.e1RM(w, k), v1.e1RM(w, k)); }
  [['', ''], ['60', '8'], [0, 8], [60, 0], [null, 5], ['abc', 5], [50, -3]].forEach(([w, k]) => assert.strictEqual(E.e1RM(w, k), v1.e1RM(w, k))); });
t('C', 'Force d\'une serie : formule V1 NON plafonnee ; au-dela de 12 reps, la force de la seance est marquee « non fiable »', () => {
  assert.strictEqual(E.forceSerie(E.normaliserSerie(S(50, 15))), E.e1RM(50, 15)); assert.strictEqual(E.forceSerie(E.normaliserSerie(S(50, 10))), E.e1RM(50, 10));
  assert.strictEqual(E.mesuresSeance([S(50, 15)].map(E.normaliserSerie)).forceFiable, false); assert.strictEqual(E.mesuresSeance([S(50, 12), S(40, 15)].map(E.normaliserSerie)).forceFiable, true);
  const m = E.mesuresSeance([S(50, 12), S(50, 11), S(45, 14)].map(E.normaliserSerie)); assert.deepStrictEqual([m.chargeMax, m.repsAChargeMax, m.repsTotal], [50, 23, 37]); });
t('C', 'Mesures d\'une seance : tonnage, reps, charge max, series dures (RIR connu <= 4), statuts RIR', () => {
  const m = E.mesuresSeance([S(50, 10, 0, { rirSaisi: true }), S(50, 9, 5), S(55, 8, null), S(0, 10), S(50, '', 2)].map(E.normaliserSerie));
  assert.deepStrictEqual([m.seriesValides, m.tonnage, m.repsTotal, m.chargeMax, m.seriesDures], [3, 50 * 10 + 50 * 9 + 55 * 8, 27, 55, 1]);
  assert.deepStrictEqual(m.rir, { saisi: 1, prerempli: 0, non_verifie: 1, inconnu: 1 }); assert.strictEqual(m.force, Math.max(E.e1RM(50, 10), E.e1RM(55, 8))); });
t('C', 'Catalogue : CHAQUE exercice de la base (' + v1.ALL_EXERCISES.length + ') a un muscle principal et un type de mouvement', () => {
  const sans = v1.ALL_EXERCISES.filter(n => !E.classerExercice(n).principal); assert.deepStrictEqual(sans, []);
  v1.ALL_EXERCISES.forEach(n => { const c = E.classerExercice(n); assert.ok(E.GROUPES.includes(c.principal), n + ' -> ' + c.principal); assert.ok(c.mouvement, n); c.secondaires.forEach(m => assert.ok(E.GROUPES.includes(m), n + ' / ' + m)); }); });
t('C', 'Catalogue compatible V1 : quand le V1 classe un exercice (MUSCLE_GROUPS), le moteur donne le meme groupe', () => {
  // 0.15.0 : le groupe V1 « Épaules » correspond desormais a Deltoide ant. OU lat. (faisceaux separes) ; les autres groupes sont identiques.
  const memeGroupe = (moteur, v1g) => v1g === 'Épaules' ? ['Deltoïde ant.', 'Deltoïde lat.'].includes(moteur) : moteur === v1g;
  const names = v1.ALL_EXERCISES.concat(REAL_LIKE_NAMES); const diff = names.filter(n => groupOfV1(n) && !memeGroupe(E.classerExercice(n).principal, groupOfV1(n)));
  assert.deepStrictEqual(diff, []); });
t('C', 'Catalogue : noms reels avec variantes (sans accents, singulier, « cuff », « unilateral »...) tous classes', () => {
  const sans = REAL_LIKE_NAMES.filter(n => !E.classerExercice(n).principal); assert.deepStrictEqual(sans, []);
  assert.strictEqual(E.classerExercice('Elevation laterale avec cuff poulie au sol').principal, 'Deltoïde lat.');
  assert.strictEqual(E.classerExercice('Butterfly inversé câble').principal, 'Deltoïde post.'); assert.strictEqual(E.classerExercice('Pec deck (Butterfly)').principal, 'Pectoraux');
  assert.strictEqual(E.classerExercice('Leg curl assis machine').principal, 'Ischio-jambiers'); assert.strictEqual(E.classerExercice('Curl marteau haltères').principal, 'Biceps'); });
t('C', 'Catalogue : exercice perso inconnu = « non classe » (jamais devine) ; classement choisi par l\'utilisateur prioritaire', () => {
  assert.deepStrictEqual(E.classerExercice('Exo perso test A'), { principal: null, secondaires: [], mouvement: null, source: 'non_classe' });
  assert.strictEqual(E.classerExercice('Exo perso test A', { classements: { 'Exo perso test A': { principal: 'Dos' } } }).principal, 'Dos');
  assert.strictEqual(E.classerExercice('Curl haltères', { classements: { 'Curl haltères': { principal: 'Avant-bras' } } }).source, 'utilisateur'); });

// ═════════ D. COMPORTEMENTS V1 CONSERVES (compares au vrai code V1) ═════════
function genHist(r, n, rmin, rmax) { const out = []; let w = 20 + Math.round(r() * 80);
  for (let i = 0; i < n; i++) { if (r() < 0.25) w = Math.max(5, w + (r() < 0.6 ? 2.5 : -2.5)); const nb = 2 + Math.floor(r() * 3);
    out.push({ date: day(i), sets: Array.from({ length: nb }, () => S(w, rmin + Math.floor(r() * (rmax - rmin + 1)), Math.floor(r() * 5))) }); }
  return out; }
t('D', 'Diagnostic : meme resultat que analyzeEx du V1 sur 3 000 historiques (fourchette 8-12, reps <= 12, seances en ordre)', () => {
  const r = rng(42); let compared = 0; const dist = {};
  for (let i = 0; i < 3000; i++) { const h = genHist(r, 2 + Math.floor(r() * 7), 6, 12); const a = v1.analyzeEx(h);
    const b = E.diagnostiquer(h.map(x => ({ date: x.date, series: x.sets.map(E.normaliserSerie) })), E.lireFourchette('8-12'));
    assert.strictEqual(b ? b.typeV1 : null, a ? a.type : null, 'cas ' + i + ' : ' + JSON.stringify(h)); if (b) dist[b.code] = (dist[b.code] || 0) + 1; compared++; }
  assert.ok(Object.keys(dist).length >= 4, 'tous les diagnostics sont couverts : ' + JSON.stringify(dist)); info(compared + ' cas — ' + JSON.stringify(dist)); });
// Formateur de test : reproduit le texte du V1 a partir du resultat du moteur (prototype de l'affichage pour l'op. 4).
function texteV1(c) { if (!c) return null; const note = c.rir.note === 'pousser' ? ' · RIR élevé → pousse plus fort' : c.rir.note === 'prudence' ? ' · RIR faible → sois prudent' : '';
  switch (c.action) {
    case 'serie100': return 'SERIE DE 100 — charge légère, rest-pause 1-5 sec autorisé. Vise les 100 reps en continu à terme.';
    case 'reduire_charge': return 'Régression — réduis de 5-10% et repars à RIR 4 minimum';
    case 'consolider': return 'Progression rapide — maintiens ' + c.charge + 'kg, consolide les reps avant d\'augmenter';
    case 'augmenter_charge': return '✓ AUGMENTE → ' + c.charge + 'kg +' + c.increment + ' = ' + c.nouvelleCharge + 'kg · Repars à ' + c.repsCible + ' reps' + note;
    case 'ajouter_rep': return 'S' + c.serie + ' : vise ' + c.reps + ' rep · ' + c.charge + 'kg' + (c.serieNonFaite ? ' · série non faite la dernière fois' : '') + (c.ensuiteCharge ? ' · Puis +poids' : '') + note;
    case 'maintenir': return 'Maintiens ' + c.charge + 'kg · Vise ' + c.repsMin + ' reps minimum sur toutes les séries';
  } throw new Error('action inconnue ' + c.action); }
t('D', 'Conseil de double progression : meme conseil que getProgressionTip du V1 sur 4 000 cas (8 fourchettes, series manquantes, RIR)', () => {
  const r = rng(2026); const ranges = ['8-12', '6-10', '10-12', '8-10', '10-15', '15-20', '20', '30-50', '100', '45-60s', ''];
  let n = 0; const dist = {};
  for (let i = 0; i < 4000; i++) { const rt = ranges[Math.floor(r() * ranges.length)]; const f = E.lireFourchette(rt);
    const multi = f.type === 'reps' && f.max <= 12; // au-dela de 12, le V1 mesurait la force sur des series longues (incoherence corrigee : voir E)
    const hi = f.type === 'reps' ? Math.min(f.max + 1, multi ? 12 : f.max + 1) : 15, lo = f.type === 'reps' ? Math.max(1, f.min - 2) : 5;
    const h = genHist(r, multi ? 1 + Math.floor(r() * 5) : 1, lo, hi); if (r() < 0.2) h[h.length - 1].sets[0].rir = undefined;
    const sessions = h.map((x, k) => sess(k + 1, x.date, [ex('Exo test', x.sets, rt)]));
    const a = v1.getProgressionTip(h[h.length - 1].sets.filter(st => st.weight && st.reps), sessions, 'Exo test', rt || undefined);
    const c = conseilJ(histOf(sessions, 'Exo test'), { seriesPrevues: 3, fourchette: rt });
    assert.strictEqual(texteV1(c), a ? a.msg : null, 'cas ' + i + ' (' + rt + ') : ' + JSON.stringify(h)); n++; if (c) dist[c.action] = (dist[c.action] || 0) + 1; }
  assert.ok(Object.keys(dist).length >= 5, JSON.stringify(dist)); info(n + ' cas — ' + JSON.stringify(dist)); });
t('D', 'Exemples V1 de reference : 8-8-8 -> S3 vise 9 ; 8-8-9 -> S2 ; 12-12-12 -> +2,5 kg ; 15 kg -> +1,25 kg ; serie manquante d\'abord', () => {
  const c = sets => conseilJ([{ date: '2026-01-01', series: sets.map(E.normaliserSerie) }], { fourchette: '8-12' });
  assert.deepStrictEqual([c([S(50, 8), S(50, 8), S(50, 8)]).action, c([S(50, 8), S(50, 8), S(50, 8)]).serie], ['ajouter_rep', 3]);
  assert.strictEqual(c([S(50, 8), S(50, 8), S(50, 9)]).serie, 2);
  assert.deepStrictEqual([c([S(50, 12), S(50, 12), S(50, 12)]).nouvelleCharge, c([S(15, 12), S(15, 12), S(15, 12)]).nouvelleCharge], [52.5, 16.25]);
  const m = c([S(50, 10), S(50, 10)]); assert.deepStrictEqual([m.serie, m.serieNonFaite], [3, true]); });

// ═════════ E. INCOHERENCES V1 CORRIGEES DANS LE MOTEUR ═════════
t('E', 'Historique dans le desordre : le diagnostic est le meme que dans l\'ordre (le V1 donnait un autre resultat)', () => {
  const h = [60, 60, 60].map((w, i) => ({ date: day(i), series: [10 - i, 10 - i, 10 - i].map(k => E.normaliserSerie(S(w, k))) }));
  const sorted = E.diagnostiquer(h), shuffled = E.diagnostiquer([h[2], h[0], h[1]]); assert.strictEqual(sorted.code, 'regression'); assert.deepStrictEqual(shuffled, sorted);
  const v1Shuffled = v1.analyzeEx([h[2], h[0], h[1]].map(x => ({ date: x.date, sets: x.series.map(s => S(s.charge, s.reps)) }))); assert.notStrictEqual(v1Shuffled && v1Shuffled.type, 3, 'reference : le V1 se trompait'); });
t('E', 'Une seule definition de la progression : charge en hausse et reps en baisse (60x10 -> 70x6) = progression partout', () => {
  const a = E.mesuresSeance([S(60, 10), S(60, 10), S(60, 10)].map(E.normaliserSerie)), b = E.mesuresSeance([S(70, 6), S(70, 6), S(70, 6)].map(E.normaliserSerie));
  assert.strictEqual(E.comparer(a, b, 'force'), 'progression');
  assert.strictEqual(E.diagnostiquer([{ date: day(0), series: [S(60, 10), S(60, 10), S(60, 10)].map(E.normaliserSerie) }, { date: day(1), series: [S(70, 6), S(70, 6), S(70, 6)].map(E.normaliserSerie) }]).code, 'progression'); });
t('E', 'Series prevues lues dans la routine de l\'utilisateur (plus dans le programme code en dur)', () => {
  const h = [{ date: day(0), series: [S(30, 10), S(30, 10)].map(E.normaliserSerie) }];
  assert.strictEqual(conseilJ(h, { seriesPrevues: 2, fourchette: '8-12' }).serieNonFaite, false);
  assert.strictEqual(conseilJ(h, { seriesPrevues: 3, fourchette: '8-12' }).serieNonFaite, true);
  const r = E.analyser({ sessions: [sess(1, day(0), [ex('Développé couché haltères', [S(30, 10), S(30, 10)])])], routines: [{ id: 1, exercises: [{ name: 'Développé couché haltères', sets: 2 }] }] }, { maintenant: day(1) });
  assert.strictEqual(r.exercices['Développé couché haltères'].conseil.serieNonFaite, false, 'routine a 2 series : pas de « serie non faite »'); });
t('E', 'Seuil unique de force (12 reps) : series longues (15-20, 30-50) suivies par le travail total, plus par la force estimee', () => {
  const h = [{ date: day(0), series: [S(20, 15), S(20, 15), S(20, 15)].map(E.normaliserSerie) }, { date: day(1), series: [S(20, 18), S(20, 17), S(20, 16)].map(E.normaliserSerie) }];
  const d = E.diagnostiquer(h, E.lireFourchette('15-20')); assert.strictEqual(d.mode, 'reps'); assert.strictEqual(d.code, 'progression'); assert.strictEqual(d.nature, 'reps');
  const top = [0, 1, 2].map(i => ({ date: day(i), series: [S(20, 20), S(20, 20), S(20, 19)].map(E.normaliserSerie) }));
  assert.strictEqual(E.diagnostiquer(top, E.lireFourchette('15-20')).code, 'plafond', 'reps au haut de la fourchette 3 fois = plafond (augmenter la charge)');
  assert.strictEqual(E.diagnostiquer(h, E.lireFourchette('45-60s')).code, 'non_applicable'); assert.strictEqual(E.diagnostiquer(h, E.lireFourchette('100')).raison, 'serie_de_100'); });
t('E', '10-15 : progression en reps, en charge et force estimee distinguees ; aucune limite a 12 reps', () => {
  const f = E.lireFourchette('10-15'); const h = (...ss) => ss.map((x, i) => ({ date: day(i), series: x.map(([w, r]) => E.normaliserSerie(S(w, r))) }));
  const reps = E.diagnostiquer(h([[20, 13], [20, 13], [20, 12]], [[20, 14], [20, 13], [20, 13]]), f);
  assert.deepStrictEqual([reps.code, reps.nature, reps.axes.reps, reps.axes.charge, reps.derniere.forceFiable], ['progression', 'reps', 2, 0, false], '13 -> 14 reps a 20 kg = progression en repetitions');
  const charge = E.diagnostiquer(h([[20, 15], [20, 15], [20, 15]], [[22.5, 11], [22.5, 10], [22.5, 10]]), f);
  assert.deepStrictEqual([charge.code, charge.nature, charge.axes.charge, charge.axes.reps], ['progression', 'charge', 2.5, null], 'charge plus lourde, reps dans la fourchette');
  assert.ok(typeof charge.axes.force === 'number', 'la force estimee reste fournie, a titre indicatif');
  const tropTot = E.diagnostiquer(h([[20, 15], [20, 15], [20, 15]], [[25, 7], [25, 6], [25, 6]]), f); assert.strictEqual(tropTot.code, 'stable', 'charge montee mais reps sous la fourchette : pas une progression');
  const recul = E.diagnostiquer(h([[20, 14], [20, 14]], [[20, 12], [20, 12]]), f); assert.strictEqual(recul.code, 'stable'); assert.strictEqual(recul.axes.reps, -4);
  const plafond = E.diagnostiquer(h([[20, 15], [20, 14]], [[20, 15], [20, 14]], [[20, 15], [20, 15]]), f); assert.strictEqual(plafond.code, 'plafond');
  const regr = E.diagnostiquer(h([[20, 15], [20, 15]], [[20, 13], [20, 13]], [[20, 11], [20, 11]]), f); assert.strictEqual(regr.code, 'regression'); });
t('E', 'Mode force (8-12) : une serie a 13 reps compte avec sa vraie force (comme le V1), marquee non fiable', () => {
  const h = [{ date: day(0), series: [S(30, 12), S(30, 12)].map(E.normaliserSerie) }, { date: day(1), series: [S(30, 13), S(30, 12)].map(E.normaliserSerie) }];
  const d = E.diagnostiquer(h, E.lireFourchette('8-12')); assert.deepStrictEqual([d.code, d.mesure.derniere, d.derniere.forceFiable], ['progression', E.e1RM(30, 13), false]); });
t('E', 'Conseil : les series de reference peuvent venir de l\'ecran (comme le V1) ; RIR cible lu a part du RIR reel', () => {
  const c = conseilJ([{ date: day(0), series: [S(50, 8)].map(E.normaliserSerie) }], { fourchette: '8-12', dernieresSeries: [S(50, 10), S(50, 10), S(50, 9)] });
  assert.deepStrictEqual([c.action, c.serie], ['ajouter_rep', 3]);
  const st = E.normaliserSerie({ weight: 50, reps: 8, rir: '', rirCible: 2, rirSaisi: false }); assert.deepStrictEqual([st.rir, st.rirCible, st.statutRir], [null, 2, 'inconnu']); });
t('E', 'Tendance de cycle sur TOUTES les seances (le V1 comparait seulement la premiere et la derniere)', () => {
  const mk = ws => ws.map((w, i) => ({ date: day(i), series: [S(w, 10), S(w, 10), S(w, 10)].map(E.normaliserSerie) }));
  assert.strictEqual(E.tendance(mk([50, 52.5, 55, 57.5])).sens, 'hausse'); assert.strictEqual(E.tendance(mk([60, 57.5, 55, 52.5])).sens, 'baisse');
  assert.strictEqual(E.tendance(mk([50, 50, 50, 50])).sens, 'stable'); assert.strictEqual(E.tendance(mk([50, 60, 55, 50, 45, 52.5])).sens, 'baisse', 'premiere < derniere mais tendance en baisse');
  assert.strictEqual(E.tendance(mk([50])), null); });
t('E', 'RIR : le conseil indique si le RIR utilise est fiable (saisi) ou non verifie (anciennes series) — rien n\'est reconstitue', () => {
  const old = conseilJ([{ date: day(0), series: [S(50, 8, 3), S(50, 8, 2), S(50, 8, 1)].map(E.normaliserSerie) }], { fourchette: '8-12' });
  assert.deepStrictEqual([old.rir.moyen, old.rir.fiable, old.rir.statuts.non_verifie], [2, false, 3]);
  const neuf = conseilJ([{ date: day(0), series: [S(50, 8, 0, { rirSaisi: true }), S(50, 8, 1, { rirSaisi: true }), S(50, 8, 0, { rirSaisi: true })].map(E.normaliserSerie) }], { fourchette: '8-12' });
  assert.deepStrictEqual([neuf.rir.moyen, neuf.rir.note, neuf.rir.fiable], [0, 'prudence', true]);
  const mix = conseilJ([{ date: day(0), series: [S(50, 8, 2, { rirSaisi: true }), S(50, 8, 2, { rirSaisi: false })].map(E.normaliserSerie) }], { fourchette: '8-12' });
  assert.strictEqual(mix.rir.fiable, false, 'un RIR non choisi suffit a rendre la moyenne non fiable'); });

t('E', 'Fin de seance : bilanExercice (meme definition que comparer) et recordsExercice (nature du record) ; premiere seance sans comparaison', () => {
  const H1 = [{ date: day(0), series: [S(60, 10), S(60, 10)].map(E.normaliserSerie) }];
  assert.strictEqual(E.bilanExercice([], [S(60, 10)], E.lireFourchette('8-12')).verdict, 'premiere');
  const b = E.bilanExercice(H1, [S(60, 11), S(60, 10)], E.lireFourchette('8-12')); assert.deepStrictEqual([b.verdict, b.nature, b.axes.reps], ['progression', 'reps', 1]);
  assert.strictEqual(E.bilanExercice(H1, [S(60, 9), S(60, 9)], E.lireFourchette('8-12')).verdict, 'regression');
  assert.strictEqual(E.bilanExercice(H1, [S(0.1, 50)], E.lireFourchette('45-60s')).mode, 'aucun');
  const r = E.recordsExercice(H1, [S(62.5, 10)]); assert.deepStrictEqual([r.record, r.chargeMax.charge, r.force.fiable], [true, 62.5, true]);
  const r2 = E.recordsExercice(H1, [S(50, 20)]); assert.deepStrictEqual([r2.reps, r2.force.fiable], [{ reps: 20, charge: 50, avant: 10 }, false]);
  assert.strictEqual(E.recordsExercice([], [S(60, 10)]), null);
  const fz = deepFreeze({ h: [{ date: day(0), series: [S(60, 10)] }], s: [S(70, 10)] }); E.bilanExercice(fz.h, fz.s); E.recordsExercice(fz.h, fz.s); });

// ═════════ F. DOMAINES PREPARES ═════════
t('F', 'Fatigue : un seul score sur 15 (5 criteres, sans perte de reps ni bonus RIR), statuts non renseigne / partiel / complet', () => {
  const C5 = (v) => ({ sleep: v, appetite: v, motivation: v, techDegrades: v, heavyFeel: v, _repondu: { sleep: 'd', appetite: 'd', motivation: 'd', techDegrades: 'd', heavyFeel: 'd' } });
  assert.strictEqual(E.scoreFatigue(null).statut, 'non_renseigne'); assert.strictEqual(E.scoreFatigue(null).score, null);
  assert.strictEqual(E.scoreFatigue({ sleep: 0, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0 }).statut, 'non_renseigne');
  assert.strictEqual(E.scoreFatigue(C5(0)).niveau, 'bas'); assert.strictEqual(E.scoreFatigue(C5(1)).niveau, 'modere');
  assert.strictEqual(E.scoreFatigue(C5(2)).niveau, 'tres_eleve'); assert.strictEqual(E.scoreFatigue(C5(3)).score, 15);
  assert.strictEqual(E.scoreFatigue(Object.assign(C5(1), { repLoss: 3 })).score, 5);
  assert.strictEqual(E.scoreFatigue({ sleep: 'x', appetite: '2' }).score, 2); });
t('F', 'Recuperation et priorites : jours depuis le dernier travail par muscle ; muscles suivis > 7 jours ou jamais travailles', () => {
  const ss = [sess(1, '2026-01-01', [ex('Curl haltères', [S(14, 10)])]), sess(2, '2026-01-10', [ex('Squat barre', [S(100, 8)]), ex('Tirage poulie haute prise large', [S(60, 10)])]), sess(3, '2026-01-12', [ex('Développé couché barre', [S(80, 8)])])];
  // 0.14.0 : analyser() n'appelle plus recuperation() / priorites() ; les anciennes fonctions restent testees en direct, memes valeurs.
  const recup = E.recuperation(E.normaliserSeances(ss), '2026-01-13'); const r = { recuperation: recup, priorites: E.priorites(recup) };
  assert.deepStrictEqual(r.recuperation.Biceps, { derniereDate: '2026-01-01', jours: 12 }); assert.strictEqual(r.recuperation.Quadriceps.jours, 3); assert.strictEqual(r.recuperation.Pectoraux.jours, 1);
  const pr = r.priorites.map(p => p.muscle); assert.ok(pr.includes('Biceps') && !pr.includes('Dos') && !pr.includes('Pectoraux')); assert.strictEqual(r.priorites.find(p => p.muscle === 'Mollets').raison, 'jamais_travaille');
  assert.strictEqual(pr[pr.length - 1], 'Biceps', 'jamais travailles d\'abord, puis du plus ancien au plus recent'); });
t('F', 'Volume 7 jours : series du muscle principal ; muscles secondaires comptes a part (indirect), en entiers, sans coefficient (0,5 supprime a l\'etape 3)', () => {
  const ss = [sess(1, '2026-01-01', [ex('Développé couché barre', [S(80, 8)])]), sess(2, '2026-01-10', [ex('Développé couché barre', [S(80, 8, 2, { rirSaisi: true }), S(80, 8, 6), S(80, 8, null)]), ex('Exo perso test A', [S(10, 10)])])];
  const v = E.volume(E.normaliserSeances(ss), '2026-01-12', 7); // 0.14.0 : ancienne fonction appelee en direct (plus par analyser)
  const zero = { series: 0, seriesDures: 0, seriesRirSaisi: 0 };
  assert.deepStrictEqual(v.parMuscle.Pectoraux, { series: 3, seriesDures: 1, seriesRirSaisi: 1, indirect: zero });
  assert.deepStrictEqual(v.parMuscle.Triceps, { series: 0, seriesDures: 0, seriesRirSaisi: 0, indirect: { series: 3, seriesDures: 1, seriesRirSaisi: 1 } });
  assert.ok(!('VOLUME_SECONDAIRE' in E.REGLES), 'plus de coefficient 0,5');
  assert.deepStrictEqual(v.nonClasses, { 'Exo perso test A': 1 }); });
t('F', 'Morphologie : aucune donnee -> non disponible, champs manquants listes, aucune regle appliquee', () => {
  const m = E.morphologie(undefined); assert.deepStrictEqual([m.disponible, m.champsFournis, m.regles], [false, [], []]); assert.strictEqual(m.champsManquants.length, E.CHAMPS_MORPHO.length);
  const p = E.morphologie({ taille: 180, longueurBras: 'longs' }); assert.deepStrictEqual([p.disponible, p.champsFournis], [true, ['taille', 'longueurBras']]); });
t('F', 'RIR des 7 derniers jours : moyenne de tous les RIR connus et moyenne des seuls RIR saisis', () => {
  const ss = [sess(1, '2026-01-01', [ex('Squat barre', [S(100, 8, 0)])]), sess(2, '2026-01-10', [ex('Squat barre', [S(100, 8, 1, { rirSaisi: true }), S(100, 8, 3), S(100, 8, null)])])];
  assert.deepStrictEqual(plain(E.analyser({ sessions: ss }, { maintenant: '2026-01-12' }).fatigue.rir7j), { jours: 7, series: 3, rirConnus: 2, rirSaisis: 1, moyen: 2, moyenSaisis: 1 }); });

// ═════════ G. CAS LIMITES ═════════
t('G', 'Entrees vides ou absentes : analyser(), analyser({}), sessions null -> resultat vide sans erreur', () => {
  [undefined, null, {}, { sessions: null }, { sessions: 'x' }, { sessions: [] }].forEach(d => { const r = E.analyser(d, { maintenant: '2026-01-01' }); assert.strictEqual(r.donnees.seances, 0); assert.deepStrictEqual(r.exercices, {}); }); });
t('G', 'Donnees abimees : seance sans exercices, exercice null, series vides, reps texte, charge negative, date absente, ids en double', () => {
  const ss = [{ id: 1, date: '2026-01-01' }, { id: 1, date: '2026-01-02', exercises: [null, { name: 'Squat barre' }, ex('Squat barre', [S('', ''), S(-5, 8), S(100, 'abc')])] }, { id: 3, exercises: [ex('Squat barre', [S(100, 8)])] }, sess(4, '2026-01-03', [ex(undefined, [S(10, 10)])])];
  const r = E.analyser({ sessions: ss }, { maintenant: '2026-01-05' });
  assert.deepStrictEqual([r.donnees.seances, r.donnees.idsEnDouble, r.donnees.seancesSansDate, r.donnees.seriesValides], [4, 1, 1, 2]);
  assert.strictEqual(r.exercices['Squat barre'].seances, 2, 'deux occurrences dans la meme seance = une seule entree'); assert.ok(r.exercices[''] !== undefined, 'nom absent : exercice vide, non classe'); assert.ok(r.donnees.exercicesNonClasses.includes('')); });
t('G', 'Une seule seance ou series toutes invalides : pas de diagnostic, pas de conseil invente', () => {
  assert.strictEqual(E.diagnostiquer([{ date: day(0), series: [S(50, 8)].map(E.normaliserSerie) }]), null);
  assert.strictEqual(E.diagnostiquer([{ date: day(0), series: [S(0, 8)].map(E.normaliserSerie) }, { date: day(1), series: [S(50, '')].map(E.normaliserSerie) }]), null);
  assert.strictEqual(conseilJ([{ date: day(0), series: [S('', '')].map(E.normaliserSerie) }], { fourchette: '8-12' }), null);
  assert.strictEqual(conseilJ([], {}), null); assert.strictEqual(conseilJ([{ date: day(0), series: [S(50, 8)].map(E.normaliserSerie) }], { fourchette: '45-60s' }), null); });
t('G', 'RIR 0 : serie a l\'echec reconnue comme serie dure, et note « prudence » ; RIR 10 lu, RIR 11 inconnu', () => {
  const m = E.mesuresSeance([S(50, 8, 0), S(50, 8, 10), S(50, 8, 11)].map(E.normaliserSerie)); assert.deepStrictEqual([m.seriesDures, m.rir.non_verifie, m.rir.inconnu], [1, 2, 1]); });
t('G', 'Fourchette illisible signalee dans le constat des donnees, sans diagnostic', () => {
  const r = E.analyser({ sessions: [sess(1, day(0), [ex('Squat barre', [S(100, 8)], 'beaucoup')]), sess(2, day(1), [ex('Squat barre', [S(100, 9)], 'beaucoup')])] }, { maintenant: day(2) });
  assert.deepStrictEqual(r.donnees.fourchettesIllisibles, ['beaucoup']); assert.strictEqual(r.exercices['Squat barre'].diagnostic.code, 'non_applicable'); });
t('G', 'Meme jour, deux seances : ordre par id (horodatage) ; seances hors ordre comptees dans le constat', () => {
  const ss = [sess(200, '2026-01-02', [ex('Squat barre', [S(100, 9)])]), sess(100, '2026-01-02', [ex('Squat barre', [S(100, 8)])]), sess(50, '2026-01-01', [ex('Squat barre', [S(100, 7)])])];
  const r = E.analyser({ sessions: ss }, { maintenant: '2026-01-03' }); assert.strictEqual(r.donnees.seancesHorsOrdre, 1);
  assert.deepStrictEqual(E.historiqueExercice(E.normaliserSeances(ss), 'Squat barre').map(h => h.series[0].reps), [7, 8, 9]); });
t('G', 'Gros volume : 2 000 seances analysees en moins de 2 secondes', () => {
  const big = []; for (let i = 0; i < 2000; i++) big.push(sess(i + 1, new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), [ex('Squat barre', [S(100, 8), S(100, 8), S(100, 8)]), ex('Curl haltères', [S(14, 10), S(14, 10)], '10-15')]));
  const t0 = Date.now(); const r = E.analyser({ sessions: big }, { maintenant: '2025-06-01' }); const ms = Date.now() - t0;
  assert.strictEqual(r.donnees.seances, 2000); assert.ok(ms < 2000, ms + ' ms'); info(ms + ' ms'); });

// ═════════ H. DONNEES REPRESENTATIVES ═════════
// Noms d'exercices du catalogue reel (variantes d'ecriture comprises) — noms generiques, aucune donnee personnelle.
var REAL_LIKE_NAMES = ['Hip thrust Smith Machine', 'Leg press', 'Leg curl couché machine', 'Leg extension machine', 'Adducteurs machine', 'Crunchs câble + Relevé de jambes', 'Calf raises machine assise',
  'Développé militaire haltères', 'Développé décliné haltères', 'Écarté poulie basse (Fly câble bas)', 'Élévations latérales câble (2 bras)', 'Reverse pec deck', 'Extension triceps overhead câble',
  'Pull-over câble bras tendus', 'Tractions prise semi-pronée', 'Rowing machine bras indépendants', 'Face pull câble corde', 'Mollets debout machine', 'Curl poulie basse prise neutre',
  'Développé incliné haltères', 'Écarté poulie haute (Fly câble)', 'Élévations latérales câble (1 bras)', 'Pec deck (Butterfly)', 'Développé convergent machine', 'Extension triceps câble corde',
  'Tirage poulie haute prise neutre', 'Rowing haltère unilatéral', 'Curl haltères incliné 45', 'Curl marteau haltères', 'Dips machine', 'Butterfly inversé câble', 'Oiseau haltères buste penché',
  'Tirage poulie haute prise serrée', 'Abducteurs machine', 'Gainage planche', 'Preacher curl haltere', 'Crunch machine', 'Développé épaules machine', 'Développé incliné machine', 'Oiseau poulie 1bras',
  'Tirage poulie haute prise large', 'Rowing machine prise large', 'Front squat smith machine', 'Leg press horizontal machine', 'Leg curl assis machine', 'Dips poids de corps', 'Oiseau poulie unilatéral',
  'Tractions prise large pronation', 'Curl poulie basse unilatérale', 'Hack squat machine', 'Élévations latérales haltères', 'Elevation laterale avec cuff poulie au sol', 'Développé militaire Smith Machine',
  'Développé couché haltères', 'Élévation latérale cuff 1 bras', 'Écarté couché haltères', 'Tirage vertical unilatéral', 'Rowing assis machine', 'Élévations latérales câble unilatéral', 'Tractions lestées prise large',
  'Curl câble unilatéral', 'Leg press 45°', 'Rowing machine dos haut', 'Dips lestés', 'Curl câble unilatéral face poulie', 'Belt squat', 'Chest press machine'];
function representative() { const out = []; let id = 1; const d = i => new Date(Date.UTC(2026, 2, 18 + i * 2)).toISOString().slice(0, 10);
  for (let i = 0; i < 40; i++) out.push({ id: id++, date: d(i), routineId: 1 + (i % 2), routineName: i % 2 ? 'PULL' : 'PUSH', exercises: [
    ex('Développé couché haltères', [0, 1, 2].map(k => S(26 + 2 * Math.floor(i / 6), 8 + ((i + k) % 5), [3, 2, 1][k]))),
    ex('Élévations latérales haltères', [0, 1, 2].map(k => S(6, 30 + (i % 15), [3, 2, 1][k])), '30-50'),
    ex('Leg curl assis machine', [0, 1, 2].map(k => S(45, 12, [3, 2, 1][k]))),
    ex('Tirage poulie haute prise large', [0, 1, 2].map(k => S(60, Math.max(6, 12 - Math.floor(i / 8)), 2))),
    ex('Gainage planche', [S(0.1, 50)], '45-60s'),
    ex('Curl haltères', [0, 1, 2].map(k => S(14, 10 + (i % 3), i > 30 ? k : undefined, i > 30 ? { rirSaisi: true } : {})), '10-15') ] });
  return out; }
t('G', 'Volume / tendance : seuil de 2 % sur le tonnage ; les 8 lectures combinees ; une serie en plus n\'est pas une meilleure performance', () => {
  const M = arr => E.mesuresSeance(arr.map(x => E.normaliserSerie({ weight: x[0], reps: x[1] })));
  assert.deepStrictEqual(E.volumeEntre(M([[100, 10]]), M([[100, 10], [100, 10]])).sens, 'hausse');
  assert.strictEqual(E.volumeEntre(M([[100, 50]]), M([[100, 51]])).sens, 'stable', '+2 % pile = stable');
  assert.strictEqual(E.volumeEntre(M([[100, 50]]), M([[100, 48]])).sens, 'baisse');
  const T = E.tendanceGenerale;
  assert.deepStrictEqual(['hausse', 'stable', 'baisse'].map(v => T('hausse', v, false)), ['progression_globale', 'progression_performance', 'meilleure_serie_seule']);
  assert.deepStrictEqual(['hausse', 'stable', 'baisse'].map(v => T('stable', v, false)), ['plus_de_travail', 'stable', 'moins_de_travail']);
  assert.deepStrictEqual(['hausse', 'stable', 'baisse'].map(v => T('baisse', v, false)), ['performance_en_baisse', 'performance_en_baisse', 'baisse_globale']);
  assert.strictEqual(T('hausse', 'hausse', true), 'plus_de_travail'); assert.strictEqual(T(null, 'stable'), null);
  const h = [{ date: '2026-01-01', fourchette: E.lireFourchette('8-12'), series: [E.normaliserSerie({ weight: 60, reps: 10 })] }];
  const b = E.bilanExercice(h, [{ weight: 60, reps: 10 }, { weight: 60, reps: 10 }], E.lireFourchette('8-12'));
  assert.deepStrictEqual([b.verdict, b.nature, b.gainParSeriesSeules, b.tendance, b.volume.series], ['progression', 'reps', true, 'plus_de_travail', 1], 'verdict de performance inchange, lecture separee');
  const s = E.syntheseExercice(h.concat([{ date: '2026-01-03', fourchette: E.lireFourchette('8-12'), series: [E.normaliserSerie({ weight: 60, reps: 11 })] }]));
  assert.ok(Object.isFrozen(s.pistes)); assert.strictEqual(s.periode, null); });
t('H', 'Jeu representatif (40 seances, 6 exercices) : chaque exercice analyse, diagnostics attendus, RIR non verifies comptes', () => {
  const r = E.analyser({ sessions: representative(), fatigue: { sommeil: 2 } }, { maintenant: '2026-05-30' }); const x = r.exercices;
  assert.strictEqual(x['Leg curl assis machine'].diagnostic.code, 'plafond'); assert.strictEqual(x['Leg curl assis machine'].conseil.action, 'augmenter_charge');
  assert.strictEqual(x['Gainage planche'].diagnostic.code, 'non_applicable'); assert.strictEqual(x['Gainage planche'].conseil, null);
  assert.strictEqual(x['Élévations latérales haltères'].mode, 'reps'); assert.strictEqual(x['Tirage poulie haute prise large'].tendance.sens, 'baisse');
  assert.strictEqual(x['Curl haltères'].conseil.rir.fiable, true, 'dernieres seances avec RIR saisi'); assert.strictEqual(r.donnees.rir.saisi, 27);
  assert.deepStrictEqual(r.donnees.exercicesNonClasses, []); assert.strictEqual(r.fatigue.questionnaire.statut, 'non_renseigne'); });
t('H', 'Jeu representatif : le diagnostic du moteur = celui du V1 pour les exercices en mode force (8-12)', () => {
  const ss = representative(); ['Développé couché haltères', 'Leg curl assis machine', 'Tirage poulie haute prise large'].forEach(n => {
    const h = ss.filter(s => s.exercises.some(e => e.name === n)).map(s => ({ date: s.date, sets: s.exercises.find(e => e.name === n).sets }));
    const a = v1.analyzeEx(h), b = E.diagnostiquer(histOf(ss, n)); assert.strictEqual(b.typeV1, a.type, n); }); });

const REAL = process.env.EXPORT_FILE; const USING_REAL = !!(REAL && fs.existsSync(REAL)); const EXP = USING_REAL ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (USING_REAL) {
  t('H', 'Export reel (lecture seule) : analyse complete sans erreur, donnees identiques avant/apres, chaque exercice classe', () => {
    const before = JSON.stringify(EXP); const r = E.analyser(EXP, { maintenant: E.dateLocale(new Date()), normaliserNom: v1.normalizeExName });
    assert.strictEqual(JSON.stringify(EXP), before); assert.strictEqual(r.donnees.seances, EXP.sessions.length); assert.deepStrictEqual(r.donnees.exercicesNonClasses, []);
    assert.strictEqual(r.donnees.rir.saisi + r.donnees.rir.prerempli, EXP.sessions.flatMap(s => s.exercises.flatMap(e => e.sets || [])).filter(st => 'rirSaisi' in st && st.rir !== null && st.rir !== undefined && st.weight && st.reps).length);
    const dist = {}; Object.values(r.exercices).forEach(x => { const k = x.diagnostic ? x.diagnostic.code : 'moins de 2 seances'; dist[k] = (dist[k] || 0) + 1; });
    info(r.donnees.seances + ' seances, ' + r.donnees.seriesValides + ' series valides, ' + Object.keys(r.exercices).length + ' exercices ; RIR ' + JSON.stringify(r.donnees.rir) + ' ; diagnostics ' + JSON.stringify(dist)); });
  t('H', 'Export reel : diagnostic identique au V1 pour chaque exercice en mode force (8-12, 6-10...)', () => {
    const ss = EXP.sessions; const names = [...new Set(ss.flatMap(s => s.exercises.map(e => e.name)))]; let same = 0; const ecarts = [];
    names.forEach(n => { const h = ss.filter(s => s.exercises.some(e => e.name === n)).map(s => ({ date: s.date, sets: s.exercises.find(e => e.name === n).sets }));
      const hh = histOf(ss, n); const f = hh[hh.length - 1].fourchette; if (E.modeMesure(f) !== 'force') return;
      const a = v1.analyzeEx(h), b = E.diagnostiquer(hh, f); const over12 = hh.some(x => x.series.some(st => st.valide && st.reps > 12));
      const doublon = hh.some(x => x.occurrences > 1);
      if ((a ? a.type : null) === (b ? b.typeV1 : null)) same++; else if (doublon) assert.fail(n + ' (doublon) : V1 ' + (a && a.type) + ' / moteur ' + (b && b.typeV1)); else assert.fail(n + ' : V1 ' + (a && a.type) + ' / moteur ' + (b && b.typeV1) + (over12 ? ' (series > 12 reps)' : '')); });
    info(same + ' exercices en mode force identiques au V1' + (ecarts.length ? ' ; ecart voulu (exercice present 2 fois dans une seance : le V1 ignorait la 2e occurrence) : ' + ecarts.join(', ') : '')); });
}

// ───────── Execution ─────────
let infos = []; function info(s) { infos.push(s); }
(async () => { let fail = 0, cur = '';
  const titles = { A: 'A. Purete', B: 'B. Normalisation', C: 'C. Mesures et catalogue', D: 'D. Comportements V1 conserves', E: 'E. Incoherences V1 corrigees', F: 'F. Domaines prepares', G: 'G. Cas limites', H: 'H. Donnees representatives' };
  console.log('Moteur : coach-engine.js v' + E.VERSION + ' | V1 : ' + H.FILE + (USING_REAL ? ' | export reel : ' + REAL + ' (' + EXP.sessions.length + ' seances)' : ' | sans export reel (EXPORT_FILE non fourni)'));
  for (const [g, n, f] of tests) {
    if (g !== cur) { cur = g; console.log('\n' + titles[g]); }
    infos = [];
    try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0].slice(0, 400)); }
    infos.forEach(s => console.log('       info : ' + s));
  }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
