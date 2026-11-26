// Lancer : node tests/muscles.test.js       (avec tes donnees : EXPORT_FILE=/chemin/export.json node tests/muscles.test.js)
// Etape 3 : volume et performances par muscle (moteur 0.10.0 ; 0.11.0 : Mollets debout machine « 1 » = poids du corps). Fonctions de CONSTAT en lecture seule :
// volumeMuscles (28 jours), performanceMuscles (28 jours), bilanEntrainement (14 jours) ; regles R-P2 (charge suspecte)
// et R-P3 (seance incomplete) dans analyseExercice ; suppression du coefficient 0,5.
process.env.TZ = 'Europe/Paris';
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const E = require('../coach-engine.js');
// 0.12.0 : le conseil (regle 1) depend de la date du jour (reference de 28 jours au plus). Les cas historiques ci-dessous sont
// evalues le jour de leur derniere seance, comme le ferait l'appli ce jour-la.
const conseilJ = (h, o) => E.conseilProgression(h, Object.assign({ aujourdhui: (h || []).reduce((m, x) => (x && x.date && x.date > m ? x.date : m), '2000-01-01') }, o || {}));
const EXPORT_FILE = process.env.EXPORT_FILE || null;
const plain = x => JSON.parse(JSON.stringify(x));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// Donnees de test : seances au format de l'appli.
const S = (w, r, extra) => Object.assign({ weight: w, reps: r, rir: 2, done: true }, extra || {});
const sets = txt => txt.split(',').map(y => { const [w, r] = y.split('x').map(Number); return S(w, r); });
const ex = (name, txt, rt) => ({ name, repsTarget: rt || '8-12', sets: typeof txt === 'string' ? sets(txt) : txt });
let nid = 1;
const sess = (date, exercises, routineName) => ({ id: nid++, date, routineId: 1, routineName: routineName || 'R', exercises });
const addDays = (d, n) => { const p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
const N = list => E.normaliserSeances(list);
// Un historique regulier : un exercice tous les `pas` jours, `n` seances, charges/reps donnees par une fonction.
const serie = (debut, pas, n, f) => Array.from({ length: n }, (_, i) => sess(addDays(debut, i * pas), f(i)));

const tests = []; const t = (n, f) => tests.push([n, f]); const infos = []; const info = s => infos.push(s);

// ───────────────────────── R-P2 / R-P3 dans analyseExercice ─────────────────────────
t('Mollets debout machine : « 1 » = charge conventionnelle au poids du corps (0.11.0) -> jamais « charge probablement erronee » ; progression en repetitions ; jamais comparee aux kg ; donnee intacte', () => {
  const M = 'Mollets debout machine';
  const raw = deepFreeze([sess('2026-04-01', [ex(M, '20x12,20x12,20x12', '10-15')]), sess('2026-04-05', [ex(M, '20x13,20x13,20x12', '10-15')]),
    sess('2026-05-06', [ex(M, '1x15,1x15,1x14', '10-15')]), sess('2026-05-10', [ex(M, '1x15,1x15,1x15', '10-15')])]);
  const avant = JSON.stringify(raw), h = E.historiqueExercice(N(raw), M);
  assert.deepStrictEqual(h.map(x => x.series.map(s => s.suspecte || s.conventionnelle || null)), [[null, null, null], [null, null, null], ['poids_du_corps', 'poids_du_corps', 'poids_du_corps'], ['poids_du_corps', 'poids_du_corps', 'poids_du_corps']]);
  assert.ok(h.every(x => x.series.every(s => s.valide)), 'aucune serie retiree de l\'analyse');
  assert.deepStrictEqual(h.map(x => E.uniteEntree(x)), ['kg', 'kg', 'conventionnelle', 'conventionnelle']);
  // 1re seance au poids du corps apres des kg : non comparable (unite differente), jamais une baisse de 20 a 1 kg.
  const a1 = E.analyseExercice(h.slice(0, 3));
  assert.deepStrictEqual([a1.performance, a1.bilan.comparaison.raisons.map(r => r.code)], ['non_comparable', ['unite_charge']]);
  assert.deepStrictEqual(a1.bilan.comparaison.raisons[0], { code: 'unite_charge', avant: 'kg', apres: 'conventionnelle' });
  // Deux seances au poids du corps : progression lue en repetitions a charge constante (+1 rep).
  const a = E.analyseExercice(h);
  assert.deepStrictEqual([a.performance, a.bilan.comparaison.fiable, a.bilan.axes.charge, a.bilan.axes.reps, a.bilan.nature, a.bilan.jour.unite, a.bilan.precedente.unite], ['progression', true, 0, 1, 'reps', 'conventionnelle', 'conventionnelle']);
  // Moins de reps au poids du corps : vraie baisse en repetitions ; meme nombre : stable.
  const H = txt => E.historiqueExercice(N(raw.slice(0, 3).concat([sess('2026-05-10', [ex(M, txt, '10-15')])])), M);
  assert.strictEqual(E.analyseExercice(H('1x14,1x14,1x14')).performance, 'regression');
  assert.strictEqual(E.analyseExercice(H('1x15,1x15,1x14')).performance, 'stable');
  // En mode force (fourchette <= 12), deux seances au poids du corps sont quand meme comparees en repetitions, jamais en force estimee.
  const hf = E.historiqueExercice(N([sess('2026-05-01', [ex(M, '1x10,1x10', '8-12')]), sess('2026-05-04', [ex(M, '1x11,1x10', '8-12')])]), M);
  const bf = E.analyseExercice(hf).bilan; assert.deepStrictEqual([bf.verdict, bf.mode, bf.axes.reps], ['progression', 'force', 1]);
  // Retour aux kg : non comparable aussi (unite differente) ; pas de « rupture de charge » 1 -> 25 kg.
  const h2 = E.historiqueExercice(N(raw.concat([sess('2026-05-14', [ex(M, '25x12,25x12,25x12', '10-15')])])), M);
  const a2 = E.analyseExercice(h2); assert.deepStrictEqual([a2.performance, a2.bilan.comparaison.raisons.map(r => r.code)], ['non_comparable', ['unite_charge']]);
  // La reference R-P2 en kg n'inclut jamais la valeur conventionnelle.
  // Seance du jour brute (Fin de seance) : reconnue avec le nom de l'exercice.
  const f = E.lireFourchette('10-15'), b = E.bilanExercice(h.slice(0, 3), sets('1x16,1x15,1x15'), f, { exercice: M });
  assert.deepStrictEqual([b.verdict, b.axes.reps, b.jour.unite, b.comparaison.fiable], ['progression', 2, 'conventionnelle', true]);
  // Records : uniquement en repetitions, contre les seules series au poids du corps ; ni charge max, ni force en kg.
  const r = E.recordsExercice(h, sets('1x16,1x15,1x15'), f, { exercice: M });
  assert.deepStrictEqual([r.record, r.conventionnelle, r.chargeMax, r.force, r.reps.reps, r.reps.avant], [true, 'poids_du_corps', null, null, 16, 15]);
  assert.strictEqual(E.recordsExercice(h, sets('1x15'), f, { exercice: M }).record, false, '15 reps = pas de record (deja fait)');
  const rk = E.recordsExercice(h, sets('21x12'), f, { exercice: M }); assert.deepStrictEqual([rk.record, rk.chargeMax.avant], [true, 20], 'kg : compares aux seuls kg (pas au 1)');
  // Conseil : jamais « 1kg + 1,25 = 2,25kg ».
  const c = conseilJ(h, { fourchette: '10-15', exercice: M }); assert.deepStrictEqual([c.action, c.chargeConventionnelle, c.nouvelleCharge], ['augmenter_charge', true, null]);
  // Volume : les series faites comptent.
  const v = E.volumeMuscles(N(raw), { fin: '2026-05-10' }); assert.strictEqual(v.muscles.Mollets.direct.series, 6);
  // Performance du muscle : plus de « charge non fiable » ; la comparaison kg -> poids du corps est non comparable.
  const p = E.performanceMuscles(N(raw), { fin: '2026-05-10' }).muscles.Mollets;
  assert.deepStrictEqual(p.comparaisons.map(x => [x.date, x.resultat]), [['2026-05-06', 'non_comparable'], ['2026-05-10', 'progression']]); // fenetre 28 j
  assert.notStrictEqual(p.raison, 'charge_non_fiable');
  // Convention propre a CET exercice : un autre exercice a 1 kg apres >= 10 kg reste « charge probablement erronee » (R-P2 inchangee).
  const ho = E.historiqueExercice(N([sess('2026-04-01', [ex('Mollets assis machine', '20x12,20x12', '10-15')]), sess('2026-04-05', [ex('Mollets assis machine', '1x15,1x15', '10-15')])]), 'Mollets assis machine');
  assert.deepStrictEqual(ho[1].series.map(s => [s.valide, s.suspecte || null, s.conventionnelle || null]), [[false, 'charge_suspecte', null], [false, 'charge_suspecte', null]]);
  assert.deepStrictEqual(E.analyseExercice(ho).bilan.comparaison.raisons.map(x => x.code), ['charge_suspecte']);
  // Une autre valeur (ex. 2) sur les Mollets debout machine n'est PAS conventionnelle.
  assert.strictEqual(E.chargeConventionnelle(M).valeur, 1); assert.strictEqual(E.chargeConventionnelle('mollets  debout machine '), null);
  assert.ok(Object.isFrozen(E.CHARGES_CONVENTIONNELLES));
  assert.strictEqual(JSON.stringify(raw), avant, 'aucune donnee modifiee'); });

t('R-P2 : le Butterfly inverse a 5 kg (max connu 25 kg) n\'est PAS touche ; une charge de 1 kg sans passe >= 10 kg non plus', () => {
  const h = E.historiqueExercice(N([sess('2026-04-01', [ex('Butterfly inversé câble', '25x10,25x10')]), sess('2026-04-08', [ex('Butterfly inversé câble', '5x15,5x15')])]), 'Butterfly inversé câble');
  assert.deepStrictEqual(h[1].series.map(s => [s.valide, s.suspecte || null]), [[true, null], [true, null]]);
  const h2 = E.historiqueExercice(N([sess('2026-04-01', [ex('Élévations latérales haltères', '2x15,2x15')]), sess('2026-04-08', [ex('Élévations latérales haltères', '1x20,1x20')])]), 'Élévations latérales haltères');
  assert.deepStrictEqual(h2[1].series.map(s => s.valide), [true, true], 'petites charges legitimes : aucune reference >= 10 kg');
  assert.deepStrictEqual([E.REGLES.CHARGE_SUSPECTE_MAX, E.REGLES.CHARGE_SUSPECTE_REFERENCE], [1, 10]); });

t('R-P3 : 45x12 x3 puis 45x13 x1 -> « seance incomplete » (ni baisse ni progression) ; une vraie baisse sur les series restantes reste une baisse', () => {
  const f = E.lireFourchette('8-12'), H = txt => [{ date: '2026-04-01', fourchette: f, series: sets(txt).map(E.normaliserSerie) }];
  let b = E.bilanExercice(H('45x12,45x12,45x12'), sets('45x13'), f);
  assert.deepStrictEqual([b.verdict, b.incomplete.seriesPrecedente, b.incomplete.seriesJour, b.incomplete.seriesComparees, b.incomplete.resultatMeilleuresSeries], ['seance_incomplete', 3, 1, 1, 'progression']);
  assert.strictEqual(b.tendance, null, 'aucune tendance tiree d\'une seance incomplete');
  b = E.bilanExercice(H('45x12,45x12,45x12'), sets('45x10,45x10'), f); assert.deepStrictEqual([b.verdict, b.axes.repsTotal], ['regression', -4], 'les 2 meilleures (12+12) contre 10+10 : vraie baisse');
  b = E.bilanExercice(H('45x12,45x12,45x12'), sets('45x12,45x12'), f); assert.strictEqual(b.verdict, 'seance_incomplete', 'memes series, une de moins : ni stable ni baisse');
  // Selection des meilleures series : mode force = force estimee ; mode repetitions = charge puis reps. Meme nombre de series des deux cotes.
  b = E.bilanExercice(H('40x12,50x8,45x6'), sets('50x8,40x11'), f);
  assert.deepStrictEqual([b.incomplete.precedenteMeilleures.series, b.incomplete.precedenteMeilleures.chargeMax, b.incomplete.precedenteMeilleures.repsTotal], [2, 50, 20], 'force : 50x8 (63) et 40x12 (56), pas 45x6 (54)');
  const f2 = E.lireFourchette('15-20'), H2 = txt => [{ date: '2026-04-01', fourchette: f2, series: sets(txt).map(E.normaliserSerie) }];
  b = E.bilanExercice(H2('10x20,12x15,12x16'), sets('12x16'), f2);
  assert.deepStrictEqual([b.incomplete.precedenteMeilleures.chargeMax, b.incomplete.precedenteMeilleures.repsAChargeMax, b.verdict], [12, 16, 'seance_incomplete'], 'repetitions : 12x16 (charge la plus lourde, puis reps)');
  b = E.bilanExercice(H2('10x20,12x15,12x16'), sets('12x14'), f2); assert.strictEqual(b.verdict, 'regression', 'meme charge, moins de reps sur la meilleure serie');
  // Conditions de comparaison coherentes : une fourchette changee reste non comparable (la regle R-P3 ne l'efface pas).
  const a = E.analyseExercice([{ date: '2026-04-01', fourchette: f, series: sets('45x12,45x12,45x12').map(E.normaliserSerie) }, { date: '2026-04-08', fourchette: f2, series: sets('30x16').map(E.normaliserSerie) }]);
  assert.deepStrictEqual([a.performance, a.bilan.comparaison.raisons[0].code], ['non_comparable', 'fourchette']); });

t('R-P3 dans analyseExercice : meme resultat pour Fin de seance, Progres et l\'analyse par muscle ; pas de diagnostic « regression » ni « progression » fonde sur une seance incomplete', () => {
  const raw = serie('2026-04-01', 3, 3, i => [ex('Leg extension machine', ['30x15,30x15,30x15', '30x14,30x14,30x14', '30x13,30x12,30x12'][i], '10-15')])
    .concat([sess('2026-04-10', [ex('Leg extension machine', '30x13', '10-15')])]);
  const h = E.historiqueExercice(N(raw), 'Leg extension machine'), a = E.analyseExercice(h);
  assert.deepStrictEqual([a.performance, a.diagnostic && a.diagnostic.code, a.alerte], ['seance_incomplete', null, null], 'regression persistante sur 3 seances neutralisee par une seance incomplete');
  const c = E.performanceMuscles(N(raw), { fin: '2026-04-10' }).muscles.Quadriceps.comparaisons.find(x => x.date === '2026-04-10');
  assert.strictEqual(c.resultat, 'seance_incomplete'); });

// ───────────────────────── Volume (R-V) ─────────────────────────
t('1. Direct et indirect separes, jamais additionnes : un developpe militaire = 1 serie directe Epaules + 1 serie indirecte Triceps', () => {
  const v = E.volumeMuscles(N([sess('2026-04-20', [ex('Développé militaire haltères', '20x10')])]), { fin: '2026-04-21' });
  assert.deepStrictEqual([v.muscles['Épaules'].direct.series, v.muscles['Épaules'].indirect.series, v.muscles.Triceps.direct.series, v.muscles.Triceps.indirect.series], [1, 0, 0, 1]);
  assert.deepStrictEqual(v.muscles.Triceps.indirect.exercices, [{ nom: 'Développé militaire haltères', series: 1 }]); });

t('2. Aucun coefficient : sollicitations indirectes en series entieres (0,5 supprime, aussi dans l ancienne volume())', () => {
  const raw = [sess('2026-04-20', [ex('Développé couché haltères', '30x10,30x10,30x9')])];
  const v = E.volumeMuscles(N(raw), { fin: '2026-04-21' });
  assert.deepStrictEqual([v.muscles.Triceps.indirect.series, v.muscles['Épaules'].indirect.series], [3, 3]);
  assert.ok(!('VOLUME_SECONDAIRE' in E.REGLES));
  const vol7 = E.volume(N(raw), '2026-04-21', 7).parMuscle; // 0.14.0 : ancienne volume() testee en direct (analyser utilise volumeMuscles)
  assert.deepStrictEqual([vol7.Pectoraux.series, vol7.Triceps.series, vol7.Triceps.indirect.series], [3, 0, 3]);
  const src = fs.readFileSync(__dirname + '/../coach-engine.js', 'utf8').replace(/\/\/.*$/gm, ''); assert.ok(!/\* *0\.5|0\.5 *\*/.test(src), 'aucune multiplication par 0,5 dans le code'); });

t('3. Series effectuees : « non faite » et 0 rep ne comptent pas ; une serie faite compte meme si sa charge est suspecte ou ses reps aberrantes (elle a ete faite)', () => {
  const v = E.volumeMuscles(N([sess('2026-04-20', [ex('Pec deck (Butterfly)', [S(40, 12), S(40, 12, { done: false }), S(40, 0), S(40, 112), S(0, 12)])])]), { fin: '2026-04-21' });
  assert.strictEqual(v.muscles.Pectoraux.direct.series, 3, '40x12, 40x112 (aberrante mais faite), 0x12 (sans charge, faite)');
  const g = E.volumeMuscles(N([sess('2026-04-20', [ex('Gainage planche', [S(0, 45), S(0, 50)], '45-60s')])]), { fin: '2026-04-21' });
  assert.strictEqual(g.muscles.Abdominaux.direct.series, 2, 'duree > 0 : comptee'); });

t('4. Rotation de 6 routines sur 5 jours : semaine calendaire qui oscille (cas reel Pectoraux 12/12/6/12), moyenne sur 28 jours stable', () => {
  const raw = ['2026-10-26', '2026-10-28', '2026-11-03', '2026-11-05', '2026-11-11', '2026-11-16', '2026-11-18'].map((d, i) => sess(d, [ex('Développé couché haltères', i === 4 ? '30x10,30x10' : '30x10,30x10,30x10,30x10,30x10,30x10'.split(',').slice(0, 6).join(','))]));
  const semaines = ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].map(l => E.volumeMuscles(N(raw), { fin: addDays(l, 6), jours: 7 }).muscles.Pectoraux.direct.series);
  assert.deepStrictEqual(semaines, [12, 12, 2, 12], 'semaines calendaires : oscillation');
  const v = E.volumeMuscles(N(raw), { fin: '2026-11-22' }).muscles.Pectoraux.direct;
  assert.deepStrictEqual([v.series, v.parSemaineCalendaire, v.parSemaineActive], [38, 9.5, 9.5]); });

t('5. Pause >= 7 jours : signalee explicitement, les deux moyennes (calendaire ET semaines actives) sont donnees, aucune baisse de volume deduite', () => {
  const raw = ['2026-04-01', '2026-04-04', '2026-04-07', '2026-04-10', '2026-04-13', '2026-04-16'].concat(['2026-05-01', '2026-05-04', '2026-05-07', '2026-05-10', '2026-05-13', '2026-05-16', '2026-05-19', '2026-05-22'])
    .map(d => sess(d, [ex('Pec deck (Butterfly)', '40x12,40x12,40x12')]));
  const v = E.volumeMuscles(N(raw), { fin: '2026-05-22' });
  assert.deepStrictEqual(v.fenetre.pauses, [{ du: '2026-04-25', au: '2026-04-30', jours: 6, type: 'pause' }], 'pause 16/04 -> 01/05 (6 jours dans la fenetre 25/04-22/05)');
  const d = v.muscles.Pectoraux.direct; assert.deepStrictEqual([d.series, d.parSemaineCalendaire, d.parSemaineActive, v.fenetre.semainesActives], [24, 6, 7.6, 3.1]);
  assert.ok(d.parSemaineCalendaire < d.parSemaineActive, 'la moyenne calendaire montre l\'interruption, elle n\'est jamais masquee');
  assert.notStrictEqual(v.muscles.Pectoraux.evolution.statut, 'baisse');
  const enCours = E.volumeMuscles(N(raw), { fin: '2026-06-05' });
  assert.deepStrictEqual(enCours.fenetre.pauses.map(p => p.type), ['pause_en_cours']); });

t('6. Frequence : 2 seances le meme jour = 1 jour ; un muscle seulement secondaire a 0 jour direct', () => {
  const v = E.volumeMuscles(N([sess('2026-04-20', [ex('Développé couché haltères', '30x10')]), sess('2026-04-20', [ex('Écarté couché haltères', '12x12')]), sess('2026-04-23', [ex('Pec deck (Butterfly)', '40x12')])]), { fin: '2026-04-28' });
  assert.deepStrictEqual([v.muscles.Pectoraux.direct.jours, v.muscles.Triceps.direct.jours, v.muscles.Triceps.indirect.jours], [2, 0, 1]); });

t('7. Exercice non classe : compte dans aucun muscle, liste « a classer »', () => {
  const v = E.volumeMuscles(N([sess('2026-04-20', [ex('Exercice maison XYZ', '10x10,10x10')])]), { fin: '2026-04-21' });
  assert.deepStrictEqual(v.nonClasses, [{ nom: 'Exercice maison XYZ', series: 2, classification: 'a_definir' }]);
  assert.ok(Object.values(v.muscles).every(m => m.direct.series === 0 && m.indirect.series === 0)); });

t('R-V4 / R-V6 : evolution signalee seulement si >= 20 % ET >= 2 series/semaine ; changement d\'exercices = « volume modifie par le programme » ; series efficaces « non mesurables » sans RIR saisis', () => {
  const jours = n => Array.from({ length: n }, (_, i) => addDays('2026-03-01', i * 3));
  const mk = (n0, n1, nom1) => jours(19).map((d, i) => sess(d, [ex(i < 10 ? 'Pec deck (Butterfly)' : nom1, i < 10 ? n0 : n1)]));
  let v = E.volumeMuscles(N(mk('40x12,40x12,40x12', '40x12,40x12', 'Pec deck (Butterfly)')), { fin: '2026-04-25' }).muscles.Pectoraux.evolution;
  assert.deepStrictEqual([v.statut, v.avant, v.apres, v.ecartPct], ['baisse', 7.5, 4.5, -40]);
  v = E.volumeMuscles(N(mk('40x12,40x12,40x12', '40x12,40x12,40x12,40x12', 'Pec deck (Butterfly)')), { fin: '2026-04-25' }).muscles.Pectoraux.evolution;
  assert.deepStrictEqual([v.statut, v.avant, v.apres, v.ecartPct], ['non_signale', 7.5, 9, 20], '+20 % mais seulement +1,5 serie par semaine : les DEUX seuils sont exiges');
  v = E.volumeMuscles(N(mk('40x12,40x12', '40x12,40x12', 'Pec deck (Butterfly)')), { fin: '2026-04-25' }).muscles.Pectoraux.evolution;
  assert.deepStrictEqual([v.statut, v.avant, v.apres, v.ecartPct], ['non_signale', 5, 4.5, -10], '-10 % : sous le seuil de 20 %');
  v = E.volumeMuscles(N(mk('40x12', '40x12,40x12', 'Pec deck (Butterfly)')), { fin: '2026-04-25' }).muscles.Pectoraux.evolution;
  assert.deepStrictEqual([v.statut, v.avant, v.apres], ['hausse', 2.5, 4.5], '+80 % et +2 series par semaine : signale');
  const alt = jours(19).map((d, i) => sess(d, [ex('Pec deck (Butterfly)', i < 10 ? '40x12' : i % 2 ? '40x12' : '40x12,40x12')]));
  v = E.volumeMuscles(N(alt), { fin: '2026-04-25' }).muscles.Pectoraux.evolution;
  assert.deepStrictEqual([v.statut, v.avant, v.apres, v.ecartPct], ['non_signale', 2.5, 3.5, 40], '+40 % mais seulement +1 serie par semaine : non signale');
  v = E.volumeMuscles(N(mk('40x12,40x12,40x12', '40x12,40x12', 'Écarté couché haltères')), { fin: '2026-04-25' }).muscles.Pectoraux.evolution;
  assert.deepStrictEqual([v.statut, v.exercicesAjoutes, v.exercicesRetires], ['volume_modifie_par_le_programme', ['Écarté couché haltères'], ['Pec deck (Butterfly)']]);
  v = E.volumeMuscles(N(mk('40x12,40x12,40x12', '40x12,40x12,40x12', 'Pec deck (Butterfly)')), { fin: '2026-04-25' }).muscles.Pectoraux.evolution; assert.strictEqual(v.statut, 'non_signale');
  const eff = E.volumeMuscles(N(mk('40x12,40x12,40x12', '40x12,40x12,40x12', 'Pec deck (Butterfly)')), { fin: '2026-04-25' }).muscles.Pectoraux.efficaces;
  assert.deepStrictEqual([eff.statut, eff.valeur, eff.raison], ['non_mesurable', null, 'rir_non_saisis'], 'RIR anciens (non verifies) : jamais de series efficaces');
  const saisis = jours(10).map(d => sess(d, [ex('Pec deck (Butterfly)', [S(40, 12, { rir: 2, rirSaisi: true }), S(40, 12, { rir: 5, rirSaisi: true })])]));
  const e2 = E.volumeMuscles(N(saisis), { fin: '2026-03-28' }).muscles.Pectoraux.efficaces; assert.deepStrictEqual([e2.statut, e2.valeur, e2.series], ['mesure', 10, 20]); });

// ───────────────────────── Performance (R-P) ─────────────────────────
t('8. Mode repetitions : charge qui monte et reps qui redescendent = progression, pas une baisse (cas Leg extension 32 -> 35 kg)', () => {
  const raw = serie('2026-04-01', 4, 3, i => [ex('Leg extension machine', ['32x15,32x15,32x15', '32x16,32x16,32x15', '35x12,35x12,35x11'][i], '10-15')]);
  const p = E.performanceMuscles(N(raw), { fin: '2026-04-09' }).muscles.Quadriceps;
  assert.deepStrictEqual(p.comparaisons.map(c => c.resultat), ['premiere', 'progression', 'progression']);
  const amp = p.exercices[0].ampleur; assert.deepStrictEqual([amp.mode, amp.monteesDeCharge.length, amp.chargeDebut, amp.chargeFin, amp.variationPct], ['reps', 1, 32, 35, undefined], 'mode repetitions : aucun % de force ni de tonnage'); });

t('9. Mode force : ampleur en % seulement si la force estimee est fiable (<= 12 reps) ; charge totale des tractions lestees (poids de corps + lest) telle quelle', () => {
  const raw = serie('2026-04-01', 4, 3, i => [ex('Tractions lestées', ['80x8,80x8', '82.5x8,82.5x7', '85x8,85x7'][i], '6-10')]);
  const amp = E.performanceMuscles(N(raw), { fin: '2026-04-09' }).muscles.Dos.exercices[0].ampleur;
  assert.deepStrictEqual([amp.mode, amp.forceFiable, amp.forceDebut, amp.forceFin, amp.variationPct], ['force', true, 101.3, 107.7, 6.2]);
  const raw2 = serie('2026-04-01', 4, 3, i => [ex('Pec deck (Butterfly)', ['40x14,40x14', '40x15,40x15', '40x16,40x15'][i], '8-12')]);
  const a2 = E.performanceMuscles(N(raw2), { fin: '2026-04-09' }).muscles.Pectoraux.exercices[0].ampleur;
  assert.deepStrictEqual([a2.forceFiable, a2.variationPct], [false, null], 'meilleure serie > 12 reps : pas de % de force'); });

t('10. Changement de notation ou de machine -> « non comparable » (cas Mollets 20 kg -> poids du corps, Hack squat 160 -> 120 kg memes reps)', () => {
  const m = E.performanceMuscles(N([sess('2026-04-01', [ex('Mollets debout machine', '20x15,20x15', '10-15')]), sess('2026-04-05', [ex('Mollets debout machine', '1x15,1x15', '10-15')])]), { fin: '2026-04-06' }).muscles.Mollets;
  assert.deepStrictEqual(m.comparaisons.map(c => c.resultat), ['premiere', 'non_comparable']); // 0.11.0 : 1 = poids du corps, unite differente des kg
  const hm = E.historiqueExercice(N([sess('2026-04-01', [ex('Mollets debout machine', '20x15,20x15', '10-15')]), sess('2026-04-05', [ex('Mollets debout machine', '1x15,1x15', '10-15')])]), 'Mollets debout machine');
  assert.deepStrictEqual(E.analyseExercice(hm).bilan.comparaison.raisons.map(r => r.code), ['unite_charge']);
  const hk = E.performanceMuscles(N([sess('2026-04-01', [ex('Hack squat machine', '160x10,160x10')]), sess('2026-04-05', [ex('Hack squat machine', '120x10,120x10')])]), { fin: '2026-04-06' }).muscles.Quadriceps;
  assert.deepStrictEqual(hk.comparaisons.map(c => c.resultat), ['premiere', 'non_comparable']); });

t('11. Minimum de donnees : moins de 4 comparaisons fiables, ou pas d\'exercice avec 3 seances dans son bloc -> « donnees insuffisantes », jamais une tendance', () => {
  const raw = serie('2026-04-01', 4, 4, i => [ex('Pec deck (Butterfly)', '40x' + (10 + i) + ',40x10')]);
  let p = E.performanceMuscles(N(raw), { fin: '2026-04-14' }).muscles.Pectoraux;
  assert.deepStrictEqual([p.statut, p.tendance, p.confiance, p.compte.fiables], ['donnees_insuffisantes', null, null, 3]);
  const raw2 = serie('2026-04-01', 3, 5, i => [ex('Pec deck (Butterfly)', '40x' + (10 + i) + ',40x10')]);
  p = E.performanceMuscles(N(raw2), { fin: '2026-04-14' }).muscles.Pectoraux;
  assert.deepStrictEqual([p.statut, p.tendance, p.confiance], ['ok', 'hausse', 'moyenne'], '4 fiables, 1 seul exercice : confiance moyenne');
  assert.ok(p.comparaisons.length === 5 && p.comparaisons.every(c => c.exercice && c.date && c.resultat), 'les comparaisons qui justifient le resultat sont listees'); });

// Jeu complet : 4 muscles, 3 exercices chacun... donne des baisses a la demande.
function jeu(baisses) { // baisses : { 'Exercice': [indices de seances en baisse] }
  const plan = { 'Pec deck (Butterfly)': 'Pectoraux', 'Développé couché haltères': 'Pectoraux', 'Tirage horizontal machine': 'Dos', 'Rowing haltère unilatéral': 'Dos',
    'Leg extension machine': 'Quadriceps', 'Hack squat machine': 'Quadriceps', 'Élévations latérales haltères': 'Épaules', 'Développé militaire haltères': 'Épaules' };
  const reps = {}; Object.keys(plan).forEach(n => { reps[n] = 8; });
  return Array.from({ length: 8 }, (_, i) => sess(addDays('2026-04-01', i * 2), Object.keys(plan).map(n => {
    if (i > 0) reps[n] += (baisses[n] || []).includes(i) ? -2 : 1; return ex(n, '50x' + reps[n] + ',50x' + reps[n]); })));
}
t('12. Une baisse isolee sur une seance est rejetee, ni « localisee » ni « generale »', () => {
  const b = E.bilanEntrainement(N(jeu({ 'Pec deck (Butterfly)': [6] })), { fin: '2026-04-15' });
  assert.deepStrictEqual(b.constats.map(c => c.type), ['rien_a_signaler']);
  const b2 = E.bilanEntrainement(N(jeu({ 'Pec deck (Butterfly)': [6], 'Tirage horizontal machine': [6] })), { fin: '2026-04-15' });
  assert.deepStrictEqual(b2.constats.map(c => [c.type, c.confiance]), [['seance_isolee', 'basse']], '2 baisses le meme jour, aucune ailleurs : seance isolee, sans conclusion'); });

t('13. Baisse localisee : un muscle avec >= 2 baisses sur >= 2 seances et autant de baisses que de progressions, les autres muscles sans baisse -> « localisee », avec ses comparaisons et sa confiance', () => {
  const b = E.bilanEntrainement(N(jeu({ 'Pec deck (Butterfly)': [4, 5, 6, 7], 'Développé couché haltères': [5, 6, 7] })), { fin: '2026-04-15' });
  const c = b.constats.find(x => x.type === 'baisse_localisee');
  assert.ok(c, JSON.stringify(b.constats.map(x => x.type))); assert.deepStrictEqual(c.muscles, ['Pectoraux']);
  assert.ok(['haute', 'moyenne'].includes(c.confiance)); assert.ok(c.comparaisons.filter(x => x.resultat === 'regression').length >= 2);
  assert.ok(!b.constats.some(x => x.type === 'baisse_generale')); });

t('14. Baisse generale : >= 30 % de baisses sur >= 3 groupes et >= 3 seances -> « generale » ; sinon « a surveiller » au plus', () => {
  const tous = ['Pec deck (Butterfly)', 'Tirage horizontal machine', 'Leg extension machine', 'Élévations latérales haltères', 'Développé couché haltères', 'Rowing haltère unilatéral'];
  const b = E.bilanEntrainement(N(jeu(Object.fromEntries(tous.map(n => [n, [5, 6, 7]])))), { fin: '2026-04-15' });
  assert.deepStrictEqual(b.constats.map(c => c.type), ['baisse_generale']);
  assert.ok(b.constats[0].muscles.length >= 3 && ['haute', 'moyenne'].includes(b.constats[0].confiance) && b.constats[0].raisons.length); });

t('15. Retour de pause : la premiere seance apres >= 7 jours est classee « retour de pause », non interpretee, et ne compte pas dans une baisse', () => {
  const raw = serie('2026-04-01', 3, 4, i => [ex('Pec deck (Butterfly)', '40x' + (10 + i) + ',40x10')]).concat([sess('2026-04-25', [ex('Pec deck (Butterfly)', '40x8,40x8')])]);
  const p = E.performanceMuscles(N(raw), { fin: '2026-04-25' }).muscles.Pectoraux;
  assert.strictEqual(p.comparaisons[p.comparaisons.length - 1].resultat, 'retour_pause');
  assert.strictEqual(p.compte.regression, 0); });

// ───────────────────────── Securite ─────────────────────────
t('16. Donnees recues gelees : jamais modifiees, aucune ecriture (stockage, reseau, horloge)', () => {
  const raw = deepFreeze(jeu({ 'Pec deck (Butterfly)': [5, 6] })), before = JSON.stringify(raw), sn = deepFreeze(N(raw)), snB = JSON.stringify(sn);
  const opts = deepFreeze({ fin: '2026-04-15' });
  E.volumeMuscles(sn, opts); E.performanceMuscles(sn, opts); E.bilanEntrainement(sn, opts);
  assert.strictEqual(JSON.stringify(raw), before); assert.strictEqual(JSON.stringify(sn), snB);
  const ctx = vm.createContext({ Object, Math, JSON, Date, Array, String, Number, isFinite, parseInt, parseFloat });
  vm.runInContext(fs.readFileSync(__dirname + '/../coach-engine.js', 'utf8') + ';this.CE=this.CoachEngine||module.exports;', Object.assign(ctx, { module: {}, self: undefined }));
  assert.ok(ctx.CE && ctx.CE.bilanEntrainement, 'charge sans stockage ni reseau'); });

t('17. Programme et routines jamais modifies ; aucun resultat ne contient d\'action appliquee ; aucune fonction d\'application', () => {
  const raw = jeu({ 'Pec deck (Butterfly)': [5, 6], 'Développé couché haltères': [6] }), routines = deepFreeze([{ id: 1, name: 'R', exercises: [{ name: 'Pec deck (Butterfly)', sets: 3, repsTarget: '8-12' }] }]);
  const r = [E.volumeMuscles(N(raw), { fin: '2026-04-15' }), E.performanceMuscles(N(raw), { fin: '2026-04-15' }), E.bilanEntrainement(N(raw), { fin: '2026-04-15' })];
  r.forEach(x => { assert.deepStrictEqual(x.actions, []); assert.strictEqual(x.adaptationAutomatique, false); });
  assert.ok(!/"(nouvelleCharge|appliquer|applique|reduire|decharge)"/.test(JSON.stringify(r)), 'aucune consigne dans les constats');
  assert.deepStrictEqual(Object.keys(E).filter(k => /^(appliquer|modifier|ecrire|sauver|enregistrer)/i.test(k)), []);
  assert.strictEqual(JSON.stringify(routines), '[{"id":1,"name":"R","exercises":[{"name":"Pec deck (Butterfly)","sets":3,"repsTarget":"8-12"}]}]'); });

t('19. Donnees generees au hasard (beta-testeurs) : aucun plantage ; petits historiques -> « donnees insuffisantes »', () => {
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noms = ['Pec deck (Butterfly)', 'Leg press', 'Curl marteau haltères', 'Exo perso', 'Gainage planche', 'Mollets debout machine'];
  for (let k = 0; k < 60; k++) {
    const n = 1 + Math.floor(r() * 25), raw = Array.from({ length: n }, (_, i) => sess(addDays('2026-01-01', Math.floor(i * (1 + r() * 6))), noms.filter(() => r() < 0.5).map(nm => ex(nm,
      Array.from({ length: Math.floor(r() * 5) }, () => S(r() < 0.1 ? 1 : Math.round(r() * 80), Math.floor(r() * 20), r() < 0.1 ? { done: false } : {})), r() < 0.1 ? '100' : r() < 0.2 ? '45-60s' : '8-12'))));
    const fin = addDays('2026-01-01', Math.floor(r() * 200)), sn = N(raw);
    const v = E.volumeMuscles(sn, { fin }), p = E.performanceMuscles(sn, { fin }), b = E.bilanEntrainement(sn, { fin });
    assert.ok(v.muscles && p.muscles && b.constats.length >= 1);
    if (n <= 3) assert.ok(Object.values(p.muscles).every(m => m.tendance === null), 'petit historique : aucune tendance');
  }
  const vide = [E.volumeMuscles([], { fin: '2026-04-01' }), E.performanceMuscles(null, { fin: '2026-04-01' }), E.bilanEntrainement(undefined, { fin: '2026-04-01' })];
  assert.deepStrictEqual([vide[0].statut, vide[2].constats[0].type], ['donnees_insuffisantes', 'rien_a_signaler']); });

// ───────────────────────── Tes donnees (lecture seule) ─────────────────────────
if (EXPORT_FILE) t('18. Tes donnees : rejeu jour par jour (01/04 -> 21/11) sans fausse baisse generale ni localisee ; tendances au 21/11 ; Mollets au poids du corps lus en repetitions ; export identique', () => {
  const md5 = () => crypto.createHash('md5').update(fs.readFileSync(EXPORT_FILE)).digest('hex'), m0 = md5();
  const d = deepFreeze(JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8'))), avant = JSON.stringify(d), sn = N(d.sessions);
  const jours = [...new Set(sn.map(s => s.date))].filter(x => x >= '2026-04-01' && x <= '2026-11-21').sort(), types = {}, isolees = [];
  jours.forEach(j => E.bilanEntrainement(sn, { fin: j }).constats.forEach(c => { types[c.type] = (types[c.type] || 0) + 1; if (c.type === 'seance_isolee') isolees.push(j); }));
  assert.ok(!types.baisse_generale && !types.baisse_localisee, JSON.stringify(types));
  info(jours.length + ' jours rejoues : ' + JSON.stringify(types));
  const p = E.performanceMuscles(sn, { fin: '2026-11-21' }).muscles, T = m => [p[m].statut, p[m].tendance, p[m].confiance];
  ['Pectoraux', 'Épaules', 'Dos', 'Deltoïde post.', 'Quadriceps', 'Ischio-jambiers', 'Triceps', 'Biceps'].forEach(m => assert.deepStrictEqual(T(m), ['ok', 'hausse', 'haute'], m));
  assert.deepStrictEqual(T('Adducteurs'), ['ok', 'hausse', 'moyenne']);
  // 0.11.0 : Mollets debout machine « 1 » = poids du corps -> 10 comparaisons fiables en repetitions sur 28 jours (8 hausses, 2 stables).
  assert.deepStrictEqual([T('Mollets'), p.Mollets.compte.fiables, p.Mollets.compte.progression, p.Mollets.compte.stable, p.Mollets.compte.regression], [['ok', 'hausse', 'moyenne'], 10, 8, 2, 0]);
  const hm = E.historiqueExercice(sn, 'Mollets debout machine');
  assert.deepStrictEqual([hm.length, hm.filter(x => E.uniteEntree(x) === 'conventionnelle').length, hm.reduce((n, x) => n + x.series.filter(s => s.suspecte === 'charge_suspecte').length, 0)], [57, 52, 0]);
  // 0.12.0 : le 06/05 est aussi la 1re seance en 20-30 (avant : 15-20) -> premiere dans cette plage, jamais comparee aux kg d'avant.
  const a6 = E.analyseExercice(hm.slice(0, hm.findIndex(x => x.date === '2026-05-06') + 1)), am = a6.bilan.comparaison.raisons.map(r => r.code);
  assert.deepStrictEqual([a6.performance, am, a6.bilan.premiereDansPlage], ['non_comparable', ['fourchette'], true], '06/05 : 1re seance au poids du corps (et en 20-30) apres 10 kg -> non comparable');
  assert.deepStrictEqual([p['Trapèzes'].statut, p.Fessiers.statut, p.Abdominaux.statut, p.Lombaires.statut], ['secondaire_seulement', 'secondaire_seulement', 'aucune_donnee', 'aucune_donnee']);
  const v = E.volumeMuscles(sn, { fin: '2026-11-21' });
  assert.deepStrictEqual([v.muscles.Pectoraux.direct.series, v.muscles.Mollets.direct.series, v.nonClasses.length], [42, 30, 0], 'Mollets : series faites comptees');
  const toutes = []; Object.values(E.performanceMuscles(sn, { fin: '2026-11-22', jours: 400 }).muscles).forEach(m => (m.comparaisons || []).forEach(c => toutes.push(c)));
  const cls = {}; toutes.forEach(c => { cls[c.resultat] = (cls[c.resultat] || 0) + 1; });
  info('classement de ' + toutes.length + ' comparaisons (exercices classes, tout l\'historique) : ' + JSON.stringify(cls));
  info('baisses fiables : ' + toutes.filter(c => c.resultat === 'regression').map(c => c.date + ' ' + c.exercice).join(' ; '));
  assert.strictEqual(JSON.stringify(d), avant); assert.strictEqual(md5(), m0); info('export md5 ' + m0 + ' (identique avant/apres)'); });

let ok = 0;
for (const [n, f] of tests) { try { f(); ok++; console.log('OK   ' + n); } catch (e) { console.log('FAIL ' + n + '\n     -> ' + (e.message || e).split('\n')[0]); } }
infos.forEach(s => console.log('       info : ' + s));
console.log('\n' + ok + '/' + tests.length + ' tests passes'); process.exitCode = ok === tests.length ? 0 : 1;
