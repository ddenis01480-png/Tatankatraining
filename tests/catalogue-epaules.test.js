// Lancer : node tests/catalogue-epaules.test.js
//          EXPORT_FILE=/chemin/export.json node tests/catalogue-epaules.test.js   (ajoute les controles sur un export reel, lu seulement)
//
// Etape 2a (moteur 0.15.0) : catalogue musculaire fiabilise.
//   - Epaule separee en trois faisceaux : Deltoide ant., Deltoide lat., Deltoide post. Le groupe « Epaules » n'existe plus.
//   - Decisions de David (26/11) : developpe militaire / epaules / Arnold = Deltoide ant. (indirects Triceps + Deltoide lat.) ;
//     rowing menton et tirage menton = Deltoide lat. + Trapezes ; « Hip trust machine » reconnu (Fessiers) ; Abducteurs = Fessiers ;
//     « Bel » non classe ; dips banc inchange ; aucun coefficient sur les series indirectes.
//   - Les noms d'exercices et l'historique ne sont jamais modifies.
const fs = require('fs'), path = require('path'), assert = require('assert');
const E = require(path.join(__dirname, '..', 'coach-engine.js'));
const C = n => { const c = E.classerExercice(n); return [c.principal, c.secondaires]; };
const S = (w, r) => ({ weight: w, reps: r, rir: 2, done: true });
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const ex = (name, n) => ({ name, repsTarget: '8-12', sets: Array.from({ length: n }, () => S(20, 10)) });

const tests = []; const t = (n, f) => tests.push([n, f]);

t('15 groupes : les trois faisceaux de l\'epaule, plus de groupe « Epaules »', () => {
  assert.deepStrictEqual(E.GROUPES.slice(0, 4), ['Pectoraux', 'Deltoïde ant.', 'Deltoïde lat.', 'Deltoïde post.']);
  assert.strictEqual(E.GROUPES.length, 15); assert.ok(!E.GROUPES.includes('Épaules'));
  E.CATALOGUE.forEach(r => { assert.ok(E.GROUPES.includes(r.principal), r.mots.join(' ')); r.secondaires.forEach(m => assert.ok(E.GROUPES.includes(m), r.mots.join(' ') + ' / ' + m)); }); });
t('Deltoide lateral : toutes les elevations laterales (haltères, câble, cuff, machine), sans indirect', () => {
  ['Élévations latérales haltères', 'Élévations latérales câble unilatéral', 'Élévations latérales câble (1 bras)', 'Élévations latérales câble (2 bras)',
   'Élévation latérale cuff 1 bras', 'Elevation laterale avec cuff poulie au sol', 'Élévations latérales machine', 'Élévations latérales câble']
    .forEach(n => assert.deepStrictEqual(C(n), ['Deltoïde lat.', []], n)); });
t('Deltoide anterieur : elevations frontales ; developpes militaire / epaules / Arnold avec Triceps et Deltoide lat. en indirect', () => {
  ['Élévations frontales haltères', 'Élévations frontales câble'].forEach(n => assert.deepStrictEqual(C(n), ['Deltoïde ant.', []], n));
  ['Développé militaire haltères', 'Développé militaire machine', 'Développé militaire Smith Machine', 'Développé militaire barre', 'Développé militaire haltères assis',
   'Développé épaules machine', 'Développé Arnold', 'Développé Arnold haltères'].forEach(n => assert.deepStrictEqual(C(n), ['Deltoïde ant.', ['Triceps', 'Deltoïde lat.']], n)); });
t('Rowing menton et tirage menton : Deltoide lat. + Trapezes (et plus « Dos »)', () => {
  ['Rowing menton barre', 'Rowing menton haltères', 'Tirage menton poulie', 'Tirage menton câble'].forEach(n => assert.deepStrictEqual(C(n), ['Deltoïde lat.', ['Trapèzes']], n));
  assert.strictEqual(C('Rowing machine dos haut')[0], 'Dos'); assert.strictEqual(C('Tirage poulie haute prise large')[0], 'Dos'); });
t('Deltoide posterieur inchange (oiseau, face pull, reverse pec deck, butterfly inverse) ; rowings : Deltoide post. indirect inchange', () => {
  ['Oiseau haltères buste penché', 'Oiseau poulie unilatéral', 'Oiseau poulie 1bras', 'Face pull câble corde', 'Reverse pec deck', 'Butterfly inversé câble']
    .forEach(n => assert.deepStrictEqual(C(n), ['Deltoïde post.', ['Trapèzes']], n));
  assert.deepStrictEqual(C('Rowing haltère unilatéral'), ['Dos', ['Biceps', 'Deltoïde post.', 'Trapèzes']]); });
t('Presses pectoraux et pompes : indirects Triceps + Deltoide ant. (avant : Triceps + Epaules) ; isolation pecs sans indirect', () => {
  ['Développé couché haltères', 'Développé incliné haltères', 'Développé incliné Smith Machine', 'Développé décliné haltères', 'Développé convergent machine',
   'Développé incliné machine', 'Chest press machine', 'Pompes', 'Pompes déclinées'].forEach(n => assert.deepStrictEqual(C(n), ['Pectoraux', ['Triceps', 'Deltoïde ant.']], n));
  ['Pec deck (Butterfly)', 'Écarté couché haltères', 'Écarté couché haltères decliné', 'Écarté poulie haute (Fly câble)'].forEach(n => assert.deepStrictEqual(C(n), ['Pectoraux', []], n)); });
t('Dips : toutes les variantes de dips aux barres / machine de dips = Triceps + Pectoraux + Deltoide ant. ; dips banc et « Triceps dips machine » inchanges', () => {
  ['Dips lestés', 'Dips poids de corps', 'Dips barre parallèles', 'Dips assistés machine', 'Dips machine'].forEach(n => assert.deepStrictEqual(C(n), ['Triceps', ['Pectoraux', 'Deltoïde ant.']], n));
  assert.deepStrictEqual(C('Dips banc'), ['Triceps', ['Pectoraux', 'Deltoïde ant.']], 'dips banc : meme regle qu\'avant, seul le nom du faisceau change');
  assert.deepStrictEqual(C('Triceps dips machine'), ['Triceps', []], 'non modifie (equivalence non etablie)'); });
t('« Hip trust machine » (nom saisi) reconnu Fessiers + Ischios, comme « Hip thrust » ; le nom n\'est pas corrige', () => {
  assert.deepStrictEqual(C('Hip trust machine'), ['Fessiers', ['Ischio-jambiers']]); assert.deepStrictEqual(C('Hip thrust Smith Machine'), ['Fessiers', ['Ischio-jambiers']]);
  const s = [sess(1, '2026-11-20', [ex('Hip trust machine', 3)])], avant = JSON.stringify(s);
  const v = E.volumeMuscles(E.normaliserSeances(s), { fin: '2026-11-21' });
  assert.strictEqual(v.muscles.Fessiers.direct.series, 3); assert.deepStrictEqual(v.muscles.Fessiers.direct.exercices, [{ nom: 'Hip trust machine', series: 3 }]);
  assert.deepStrictEqual(v.nonClasses, []); assert.strictEqual(JSON.stringify(s), avant); });
t('Abducteurs machine = Fessiers (conserve) ; « Bel » reste non classe (rien d\'invente, rien de supprime)', () => {
  assert.deepStrictEqual(C('Abducteurs machine'), ['Fessiers', []]);
  assert.deepStrictEqual(E.classerExercice('Bel'), { principal: null, secondaires: [], mouvement: null, source: 'non_classe' }); });
t('Aucun coefficient : un developpe militaire = 1 serie directe Deltoide ant. + 1 indirecte Triceps + 1 indirecte Deltoide lat., en entiers', () => {
  const v = E.volumeMuscles(E.normaliserSeances([sess(1, '2026-11-20', [ex('Développé militaire haltères', 4), ex('Élévations latérales haltères', 3)])]), { fin: '2026-11-21' }).muscles;
  assert.deepStrictEqual([v['Deltoïde ant.'].direct.series, v['Deltoïde ant.'].indirect.series], [4, 0]);
  assert.deepStrictEqual([v['Deltoïde lat.'].direct.series, v['Deltoïde lat.'].indirect.series], [3, 4], 'direct et indirect separes, jamais additionnes');
  assert.deepStrictEqual([v.Triceps.direct.series, v.Triceps.indirect.series], [0, 4]); assert.ok(!('Épaules' in v)); });
t('Recuperation : les trois faisceaux apparaissent separement', () => {
  const r = E.dernieresSollicitations(E.normaliserSeances([sess(Date.UTC(2026, 10, 20, 12), '2026-11-20', [ex('Élévations latérales haltères', 3)])]), Date.UTC(2026, 10, 21, 12));
  assert.strictEqual(r.groupes['Deltoïde lat.'].ecoulePrincipale.heures, 24); assert.strictEqual(r.groupes['Deltoïde ant.'].derniere, null); assert.ok(!('Épaules' in r.groupes)); });
t('Reclassement utilisateur (options.classements) toujours prioritaire sur le catalogue', () => {
  const c = E.classerExercice('Développé militaire haltères', { classements: { 'Développé militaire haltères': { principal: 'Deltoïde lat.', secondaires: [] } } });
  assert.deepStrictEqual([c.principal, c.secondaires, c.source], ['Deltoïde lat.', [], 'utilisateur']); });

// ── Ton export : lecture seule ──
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Ton export : tous les exercices de l\'historique et des routines classes (seul « Bel » du catalogue perso ne l\'est pas) ; noms et donnees inchanges', () => {
  const brut = JSON.stringify(EXP), noms = new Set();
  (EXP.sessions || []).forEach(s => (s.exercises || []).forEach(e => noms.add(e.name))); (EXP.routines || []).forEach(r => (r.exercises || []).forEach(e => noms.add(e.name)));
  assert.deepStrictEqual([...noms].filter(n => !E.classerExercice(n).principal), []);
  if (Array.isArray(EXP.customEx)) assert.deepStrictEqual(EXP.customEx.filter(n => !E.classerExercice(n).principal), EXP.customEx.includes('Bel') ? ['Bel'] : []);
  const N = E.normaliserSeances(EXP.sessions); const fin = EXP.sessions.map(s => s.date).sort().pop().slice(0, 10), v = E.volumeMuscles(N, { fin });
  const tot = k => Object.keys(v.muscles).reduce((a, m) => a + v.muscles[m][k].series, 0);
  assert.ok(tot('direct') > 0 && v.nonClasses.length === 0); assert.strictEqual(JSON.stringify(EXP), brut); });

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
