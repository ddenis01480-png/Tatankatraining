// Lancer : node tests/recuperation.test.js       (avec tes donnees : EXPORT_FILE=/chemin/export.json node tests/recuperation.test.js)
// Etape 2 : recuperation musculaire fiable. Catalogue unique du moteur (plus de MUSCLE_MAP / MUSCLE_GROUPS), muscles secondaires,
// heure reelle d'enregistrement (id de seance), affichage descriptif sans conclusion « recupere / insuffisant ».
process.env.TZ = 'Europe/Paris'; // fuseau de l'appareil de David ; les calculs d'ecart sont independants du fuseau (millisecondes)
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const SRC = fs.readFileSync(process.env.INDEX_FILE || __dirname + '/../index.html', 'utf8');
const E = require('../coach-engine.js');
const EXPORT_FILE = process.env.EXPORT_FILE || null;
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); if (i < 0) throw new Error('introuvable : ' + start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }
const between = (a, b) => { const i = SRC.indexOf(a); if (i < 0) throw new Error('introuvable : ' + a); const j = SRC.indexOf(b, i); if (j < 0) throw new Error('fin introuvable : ' + b); return SRC.slice(i, j); };
const plain = x => JSON.parse(JSON.stringify(x));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// Vrai code d'index.html : helpers d'affichage de la recuperation.
const LIB = [fnSrc('function coachEngine('), fnSrc('function recupSollicitations('), fnSrc('function recupDelaiTexte('), fnSrc('function recupQuandTexte('),
  fnSrc('function recupExercicesTexte('), 'const RECUP_JOURS = ' + literal('const RECUP_JOURS = [', '[', ']') + ';', between('const RECUP_NOTE =', '\n'),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName(')].join('\n');
const CTX = { window: { CoachEngine: E }, Date, Math, JSON, Object, String, Number }; vm.createContext(CTX); vm.runInContext(LIB + '\nthis.__f={recupSollicitations,recupDelaiTexte,recupQuandTexte,recupExercicesTexte,RECUP_NOTE};', CTX);
const H = CTX.__f;
const DB = vm.runInNewContext('(' + literal('const DB = {', '{', '}') + ')'); const ALL_EXERCISES = Object.values(DB).flat();

// Catalogue final des 67 exercices de l'historique de David : [nom, muscle principal, muscles secondaires].
const CATALOGUE_67 = [
  ["Abducteurs machine", "Fessiers", []],
  ["Adducteurs machine", "Adducteurs", []],
  ["Belt squat", "Quadriceps", ["Fessiers","Adducteurs"]],
  ["Butterfly inversé câble", "Deltoïde post.", ["Trapèzes"]],
  ["Calf raises machine assise", "Mollets", []],
  ["Chest press machine", "Pectoraux", ["Triceps","Épaules"]],
  ["Crunch machine", "Abdominaux", []],
  ["Crunchs câble + Relevé de jambes", "Abdominaux", []],
  ["Curl câble unilatéral", "Biceps", []],
  ["Curl câble unilatéral face poulie", "Biceps", []],
  ["Curl haltères incliné 45", "Biceps", []],
  ["Curl marteau haltères", "Biceps", []],
  ["Curl poulie basse prise neutre", "Biceps", []],
  ["Curl poulie basse unilatérale", "Biceps", []],
  ["Développé convergent machine", "Pectoraux", ["Triceps","Épaules"]],
  ["Développé couché haltères", "Pectoraux", ["Triceps","Épaules"]],
  ["Développé décliné haltères", "Pectoraux", ["Triceps","Épaules"]],
  ["Développé épaules machine", "Épaules", ["Triceps"]],
  ["Développé incliné haltères", "Pectoraux", ["Triceps","Épaules"]],
  ["Développé incliné machine", "Pectoraux", ["Triceps","Épaules"]],
  ["Développé militaire haltères", "Épaules", ["Triceps"]],
  ["Développé militaire Smith Machine", "Épaules", ["Triceps"]],
  ["Dips lestés", "Triceps", ["Pectoraux","Épaules"]],
  ["Dips machine", "Triceps", ["Pectoraux","Épaules"]],
  ["Dips poids de corps", "Triceps", ["Pectoraux","Épaules"]],
  ["Écarté couché haltères", "Pectoraux", []],
  ["Écarté poulie basse (Fly câble bas)", "Pectoraux", []],
  ["Écarté poulie haute (Fly câble)", "Pectoraux", []],
  ["Elevation laterale avec cuff poulie au sol", "Épaules", []],
  ["Élévation latérale cuff 1 bras", "Épaules", []],
  ["Élévations latérales câble (1 bras)", "Épaules", []],
  ["Élévations latérales câble (2 bras)", "Épaules", []],
  ["Élévations latérales câble unilatéral", "Épaules", []],
  ["Élévations latérales haltères", "Épaules", []],
  ["Extension triceps câble corde", "Triceps", []],
  ["Extension triceps overhead câble", "Triceps", []],
  ["Face pull câble corde", "Deltoïde post.", ["Trapèzes"]],
  ["Front squat smith machine", "Quadriceps", ["Fessiers","Adducteurs"]],
  ["Gainage planche", "Abdominaux", []],
  ["Hack squat machine", "Quadriceps", ["Fessiers","Adducteurs"]],
  ["Hip thrust Smith Machine", "Fessiers", ["Ischio-jambiers"]],
  ["Leg curl assis machine", "Ischio-jambiers", []],
  ["Leg curl couché machine", "Ischio-jambiers", []],
  ["Leg extension machine", "Quadriceps", []],
  ["Leg press", "Quadriceps", ["Fessiers"]],
  ["Leg press 45°", "Quadriceps", ["Fessiers"]],
  ["Leg press horizontal machine", "Quadriceps", ["Fessiers"]],
  ["Mollets debout machine", "Mollets", []],
  ["Oiseau haltères buste penché", "Deltoïde post.", ["Trapèzes"]],
  ["Oiseau poulie 1bras", "Deltoïde post.", ["Trapèzes"]],
  ["Oiseau poulie unilatéral", "Deltoïde post.", ["Trapèzes"]],
  ["Pec deck (Butterfly)", "Pectoraux", []],
  ["Preacher curl haltere", "Biceps", []],
  ["Pull-over câble bras tendus", "Dos", []],
  ["Reverse pec deck", "Deltoïde post.", ["Trapèzes"]],
  ["Rowing assis machine", "Dos", ["Biceps","Deltoïde post.","Trapèzes"]],
  ["Rowing haltère unilatéral", "Dos", ["Biceps","Deltoïde post.","Trapèzes"]],
  ["Rowing machine bras indépendants", "Dos", ["Biceps","Deltoïde post.","Trapèzes"]],
  ["Rowing machine dos haut", "Dos", ["Biceps","Deltoïde post.","Trapèzes"]],
  ["Rowing machine prise large", "Dos", ["Biceps","Deltoïde post.","Trapèzes"]],
  ["Tirage poulie haute prise large", "Dos", ["Biceps"]],
  ["Tirage poulie haute prise neutre", "Dos", ["Biceps"]],
  ["Tirage poulie haute prise serrée", "Dos", ["Biceps"]],
  ["Tirage vertical unilatéral", "Dos", ["Biceps"]],
  ["Tractions lestées prise large", "Dos", ["Biceps"]],
  ["Tractions prise large pronation", "Dos", ["Biceps"]],
  ["Tractions prise semi-pronée", "Dos", ["Biceps"]]
];

const ms = (iso) => new Date(iso).getTime();
const S = (w, r) => ({ weight: w, reps: r, rir: 2, done: true });
const sess = (iso, date, exos) => ({ id: ms(iso), date, routineName: 'R', exercises: exos.map(n => ({ name: n, repsTarget: '8-12', sets: [S(50, 10), S(50, 10)] })) });
const sol = (sessions, maintenantIso, exercices) => E.dernieresSollicitations(E.normaliserSeances(sessions), ms(maintenantIso), exercices ? { exercices } : undefined);

const tests = []; const t = (n, f) => tests.push([n, f]); const infos = []; const info = s => infos.push(s);

t('Les 67 exercices de l\'historique : muscle principal et secondaires = catalogue final verifie', () => {
  assert.strictEqual(CATALOGUE_67.length, 67);
  CATALOGUE_67.forEach(([n, p, sec]) => { const c = E.classerExercice(n); assert.strictEqual(c.principal, p, n); assert.deepStrictEqual(plain(c.secondaires), sec, n); });
  const parGroupe = {}; CATALOGUE_67.forEach(([, p]) => { parGroupe[p] = (parGroupe[p] || 0) + 1; }); info('groupes principaux : ' + JSON.stringify(parGroupe)); });

t('Aucun exercice connu dans « Autre » : les 67 exercices et les 133 de la base ont un groupe parmi les 14 ; « Autre » n\'existe pas', () => {
  assert.ok(!E.GROUPES.includes('Autre')); assert.strictEqual(E.GROUPES.length, 14);
  CATALOGUE_67.concat(ALL_EXERCISES.map(n => [n])).forEach(([n]) => { const c = E.classerExercice(n); assert.ok(c.principal && E.GROUPES.includes(c.principal), n);
    c.secondaires.forEach(m => assert.ok(E.GROUPES.includes(m), n + ' / ' + m)); }); });

t('Exercice personnalise indeterminable -> « classification a definir » (aucun muscle invente)', () => {
  ['Développé Arnold', 'Mon exercice perso', 'Machine 3', 'Circuit'].forEach(n => { const c = E.classerExercice(n); assert.strictEqual(c.principal, null, n); assert.strictEqual(c.source, 'non_classe'); });
  assert.strictEqual(E.classerExercice('Développé Arnold', { classements: { 'Développé Arnold': { principal: 'Épaules', secondaires: ['Triceps'] } } }).principal, 'Épaules'); });

t('Les deux anciennes tables (MUSCLE_MAP, MUSCLE_GROUPS) et getMuscle ne sont plus utilisees ; Seance et Bilan passent par le moteur', () => {
  assert.ok(!/MUSCLE_MAP|MUSCLE_GROUPS|getMuscle\(|muscleAlerts|recovScore|minHoursSince/.test(SRC));
  assert.ok(/setRecupInfo\(recupSollicitations\(sessions, exercises\.map\(e => e\.name\), Date\.now\(\)\)\)/.test(SRC));
  assert.ok(/const recupBilan = recupSollicitations\(sessions, null, Date\.now\(\)\)/.test(SRC)); });

t('Muscles secondaires pris en compte : un developpe couche sollicite Triceps et Epaules (role secondaire)', () => {
  const r = sol([sess('2026-11-20T12:00:00Z', '2026-11-20', ['Développé couché haltères'])], '2026-11-21T12:00:00Z');
  assert.strictEqual(r.groupes['Pectoraux'].derniere.role, 'principal'); assert.strictEqual(r.groupes['Triceps'].derniere.role, 'secondaire');
  assert.strictEqual(r.groupes['Épaules'].ecoule.heures, 24); assert.strictEqual(r.groupes['Triceps'].dernierePrincipale, null);
  assert.strictEqual(r.groupes['Dos'].derniere, null); assert.strictEqual(H.recupDelaiTexte(r.groupes['Dos'].ecoule), 'aucune séance'); });

t('Heure reelle : id = horodatage de fin de seance ; plus de minuit fictif (seance hier 13:05 -> 24 h, pas ~35 h)', () => {
  const r = sol([sess('2026-11-22T12:05:00Z', '2026-11-22', ['Leg extension machine'])], '2026-11-23T12:05:00Z');
  const g = r.groupes['Quadriceps']; assert.strictEqual(g.ecoule.heures, 24); assert.strictEqual(g.derniere.heureFiable, true);
  assert.strictEqual(H.recupQuandTexte(g.derniere), 'dim. 22/11 · enregistrée à 13:05'); assert.strictEqual(H.recupDelaiTexte(g.ecoule), 'il y a 1 j 0 h'); });

t('Heure non fiable -> « heure inconnue », aucune duree fabriquee (id d\'import, id 1, id futur, autre jour)', () => {
  const base = { date: '2026-11-20', routineName: 'R', exercises: [{ name: 'Leg curl assis machine', repsTarget: '8-12', sets: [S(40, 10)] }] };
  for (const id of [1, 'abc', null, ms('2026-11-22T10:00:00Z'), ms('2030-01-01T00:00:00Z')]) {
    const r = sol([Object.assign({ id }, base)], '2026-11-23T12:00:00Z'); const g = r.groupes['Ischio-jambiers'];
    assert.strictEqual(g.derniere.heureFiable, false, String(id)); assert.strictEqual(g.ecoule.heures, null); assert.strictEqual(g.ecoule.minutes, null); assert.strictEqual(g.ecoule.jours, 3);
    assert.strictEqual(H.recupDelaiTexte(g.ecoule), 'il y a 3 jours (heure inconnue)'); assert.ok(/heure inconnue/.test(H.recupQuandTexte(g.derniere))); }
  assert.strictEqual(E.heureSeance({ id: '1763900000000', date: new Date(1763900000000).toISOString().slice(0, 10) }).fiable, true); });

t('Changement de jour : seance a 00:30 (heure de Paris) datee de la veille en UTC -> heure fiable ; minuit franchi -> 1 jour calendaire mais 1 h', () => {
  assert.strictEqual(E.heureSeance({ id: ms('2026-11-22T23:30:00Z'), date: '2026-11-22' }).fiable, true);   // 00:30 a Paris le 23
  assert.strictEqual(E.heureSeance({ id: ms('2026-11-22T23:30:00Z'), date: '2026-11-23' }).fiable, true);
  const r = sol([sess('2026-11-22T22:30:00Z', '2026-11-22', ['Mollets debout machine'])], '2026-11-22T23:40:00Z'); // 23:30 -> 00:40 a Paris
  assert.strictEqual(r.groupes['Mollets'].ecoule.heures, 1); assert.strictEqual(r.groupes['Mollets'].ecoule.jours, 1); assert.strictEqual(H.recupDelaiTexte(r.groupes['Mollets'].ecoule), 'il y a 1 h'); });

t('Pause de 22 jours et seances rapprochees (matin + soir) : derniere sollicitation exacte', () => {
  const r = sol([sess('2026-06-23T12:00:00Z', '2026-06-23', ['Leg press 45°'])], '2026-07-15T12:00:00Z');
  assert.strictEqual(r.groupes['Quadriceps'].ecoule.jours, 22); assert.strictEqual(r.groupes['Quadriceps'].ecoule.heures, 528); assert.strictEqual(H.recupDelaiTexte(r.groupes['Quadriceps'].ecoule), 'il y a 22 jours');
  const r2 = sol([sess('2026-11-23T18:00:00Z', '2026-11-23', ['Curl marteau haltères']), sess('2026-11-23T07:00:00Z', '2026-11-23', ['Tractions lestées prise large'])], '2026-11-23T19:00:00Z');
  assert.strictEqual(r2.groupes['Biceps'].ecoule.heures, 1); assert.strictEqual(r2.groupes['Biceps'].derniere.role, 'principal');
  assert.strictEqual(r2.groupes['Dos'].ecoule.heures, 12);
  const r3 = sol([sess('2026-11-23T07:00:00Z', '2026-11-23', ['Tractions lestées prise large'])], '2026-11-23T07:30:00Z'); assert.strictEqual(H.recupDelaiTexte(r3.groupes['Dos'].ecoule), 'il y a 30 min'); });

t('Un exercice inconnu ne fausse aucun autre groupe ; il est liste « a classer »', () => {
  const ss = [sess('2026-11-20T12:00:00Z', '2026-11-20', ['Leg extension machine']), sess('2026-11-23T08:00:00Z', '2026-11-23', ['Machine 3'])];
  const r = sol(ss, '2026-11-23T12:00:00Z', ['Leg extension machine', 'Machine 3']);
  assert.strictEqual(r.groupes['Quadriceps'].ecoule.heures, 72); assert.deepStrictEqual(Object.keys(r.groupes), ['Quadriceps']);
  assert.deepStrictEqual(plain(r.nonClasses), [{ nom: 'Machine 3', derniereDate: '2026-11-23', series: 2 }]); assert.deepStrictEqual(plain(r.exercicesAClasser), ['Machine 3']);
  Object.values(sol(ss, '2026-11-23T12:00:00Z').groupes).forEach(g => { if (g.muscle !== 'Quadriceps') assert.strictEqual(g.derniere, null, g.muscle); }); });

t('Aucune conclusion de recuperation sur le seul delai : moteur sans verdict, ecrans sans « optimal / insuffisant / recupere »', () => {
  const r = sol([sess('2026-11-23T11:00:00Z', '2026-11-23', ['Hack squat machine'])], '2026-11-23T12:00:00Z');
  assert.strictEqual(r.conclusion, null); Object.values(r.groupes).forEach(g => assert.strictEqual(g.conclusion, null));
  const seance = between('      {recupInfo && (', '      {adaptModal && ('), bilan = between('      {recupBilan && (', '      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end"');
  [seance, bilan, H.RECUP_NOTE].forEach(x => assert.ok(!/optimal|insuffisant|OPTIMAL|INSUFFISANT|RÉCUPÉRÉ|bien récupéré|Récupéré/.test(x.replace('ne dit pas si un muscle est récupéré', ''))));
  assert.ok(/ne dit pas si un muscle est récupéré/.test(H.RECUP_NOTE));
  // Plus de fenetre au demarrage declenchee par les seuils 24 / 48 / 72 h
  const trig = between('      // Derniere sollicitation des muscles de cette seance', '  }, [activeRoutine]);'); assert.ok(!/72|48|24/.test(trig.replace(/24 \/ 48 \/ 72 h/, ''))); });

t('Seance qui demarre : seuls les groupes de ses exercices (principaux + secondaires) sont affiches', () => {
  const ss = [sess('2026-11-21T08:35:00Z', '2026-11-21', ['Tractions lestées prise large', 'Oiseau haltères buste penché']), sess('2026-11-20T13:46:00Z', '2026-11-20', ['Chest press machine'])];
  const r = H.recupSollicitations(ss, ['Chest press machine', 'Pec deck (Butterfly)'], ms('2026-11-23T17:40:00Z'));
  assert.deepStrictEqual(Object.keys(r.groupes), ['Pectoraux', 'Épaules', 'Triceps']);
  assert.strictEqual(H.recupExercicesTexte(r.groupes['Triceps'].derniere), 'Chest press machine (secondaire)'); });

if (EXPORT_FILE) t('Tes donnees : 141 heures fiables ; routines et ecrans Seance / Bilan calcules ; export et seances inchanges', () => {
  const avant = crypto.createHash('md5').update(fs.readFileSync(EXPORT_FILE)).digest('hex');
  const exp = deepFreeze(JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8'))); const empreinte = JSON.stringify(exp);
  const noms = [...new Set(exp.sessions.flatMap(s => s.exercises.map(e => e.name)))].sort((a, b) => a.localeCompare(b, 'fr'));
  assert.deepStrictEqual(noms, CATALOGUE_67.map(x => x[0]));
  const N = E.normaliserSeances(exp.sessions); assert.strictEqual(N.filter(s => E.heureSeance(s, Date.now()).fiable).length, exp.sessions.length);
  const routines = exp.routines.flatMap(r => r.exercises.map(e => e.name)); assert.deepStrictEqual(routines.filter(n => !E.classerExercice(n).principal), []);
  const now = ms('2026-11-23T17:40:00Z'), bilan = H.recupSollicitations(exp.sessions, null, now);
  assert.strictEqual(bilan.nonClasses.length, 0); assert.strictEqual(Object.keys(bilan.groupes).length, 14);
  exp.routines.forEach(rt => { const r = H.recupSollicitations(exp.sessions, rt.exercises.map(e => e.name), now);
    rt.exercises.forEach(e => assert.ok(r.groupes[E.classerExercice(e.name).principal], rt.name + ' / ' + e.name)); });
  const d = bilan.groupes['Dos']; info('Bilan au 23/11 18:40 : Dos ' + H.recupDelaiTexte(d.ecoule) + ' (' + H.recupQuandTexte(d.derniere) + ') ; Quadriceps ' + H.recupDelaiTexte(bilan.groupes['Quadriceps'].ecoule) + ' ; Lombaires ' + H.recupDelaiTexte(bilan.groupes['Lombaires'].ecoule));
  assert.strictEqual(JSON.stringify(exp), empreinte); assert.strictEqual(crypto.createHash('md5').update(fs.readFileSync(EXPORT_FILE)).digest('hex'), avant);
  info('export md5 ' + avant + ' (identique avant/apres)'); });

let ok = 0;
for (const [n, f] of tests) { infos.length = 0; try { f(); ok++; console.log('OK   ' + n); } catch (e) { console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0]); } infos.forEach(s => console.log('       info : ' + s)); }
console.log(`\n${ok}/${tests.length} tests passes`); if (ok !== tests.length) process.exit(1);
