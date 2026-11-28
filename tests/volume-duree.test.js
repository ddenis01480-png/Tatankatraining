// Lancer : node tests/volume-duree.test.js
// Coach 0.20.0 : volume compare a la REFERENCE INDIVIDUELLE de chaque muscle (ses propres periodes de progression, aucun seuil
// universel), ordre repartir > remplacer > reduire > echanger une serie, et DUREE ESTIMEE des seances : une proposition ne rallonge
// jamais une seance de plus de 2 min et n'augmente jamais le total de la semaine ; sinon, « sans solution ».
process.env.TZ = 'Europe/Paris';
const assert = require('assert');
const E = require('../coach-engine.js');
const addDays = (d, n) => { const p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
const J = '2026-11-28';
let nid = 1;
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const series = (w, r, n) => Array.from({ length: n }, () => ({ weight: w, reps: r, rir: '', rirSaisi: false, done: true }));
// mode : 'prog' (+1 rep par seance de 8 a 12, puis +2,5 kg), 'stag' (toujours base x 10), 'reg' (reps qui baissent a partir de la 3e seance).
const exo = (name, mode, n, i, base) => { let w = base, r = 10;
  if (mode === 'prog') { w = base + Math.floor(i / 5) * 2.5; r = 8 + (i % 5); } else if (mode === 'reg') r = Math.max(4, 10 - Math.max(0, i - 1));
  return { name, repsTarget: '8-12', sets: series(w, r, n) }; };
// plan : [{ du, au, pas, i0, routineId, routineName, exos: [[nom, mode, series, base]] }] (jours relatifs a J)
const seances = plan => { const out = []; plan.forEach(b => { let i = 0; for (let d = b.du; d <= b.au; d += b.pas, i++) out.push({ id: nid++, date: addDays(J, d), routineId: b.routineId || 1, routineName: b.routineName || 'Push', exercises: b.exos.map(x => exo(x[0], x[1], x[2], (b.i0 || 0) + i, x[3])) }); });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1)); };
const routine = (id, name, exos) => ({ id, name, day: '', exercises: exos.map(([nm, s, rest]) => ({ name: nm, sets: s, repsTarget: '8-12', rest: rest || 90 })) });
const P = (d, o) => E.propositionsAdaptation(d, Object.assign({ maintenant: J }, o || {}));
const totalSeries = rs => rs.reduce((a, r) => a + r.exercises.reduce((b, e) => b + e.sets, 0), 0);
const DC = 'Développé couché haltères', EC = 'Écarté poulie vis-à-vis couché', DI = 'Développé incliné haltères', TR = 'Extension triceps poulie', RB = 'Rowing barre', CU = 'Curl barre EZ';

// Scenarios reutilises
// Pectoraux : progressait avec 4 series (≈ 6-7 series / semaine), aujourd'hui 2 series qui stagnent ; triceps progresse au-dessus de sa reference.
const scTransfert = () => ({ sessions: seances([{ du: -120, au: -30, pas: 4, exos: [[EC, 'prog', 4, 20], [TR, 'prog', 3, 20]] }, { du: -27, au: -1, pas: 4, i0: 23, exos: [[EC, 'stag', 2, 30], [TR, 'prog', 4, 20]] }]),
  routines: [routine(1, 'Push', [[EC, 2], [TR, 4]])] });
// Pectoraux : 2 seances / semaine quand ils progressaient, aujourd'hui tout dans « Push » 1 fois / semaine ; le dos (Pull) progresse ou non.
const scRepartition = modeDos => ({ sessions: seances([
  { du: -120, au: -30, pas: 3, exos: [[EC, 'prog', 3, 20], [DC, 'prog', 3, 30]] },
  { du: -119, au: -29, pas: 3, routineId: 2, routineName: 'Pull', exos: [[RB, 'prog', 3, 40]] },
  { du: -27, au: -1, pas: 6, i0: 31, exos: [[EC, 'stag', 3, 30], [DC, 'stag', 3, 40]] },
  { du: -26, au: -2, pas: 3, i0: 31, routineId: 2, routineName: 'Pull', exos: [[RB, modeDos, 3, 40]] }]),
  routines: [routine(1, 'Push', [[EC, 3], [DC, 3]]), routine(2, 'Pull', [[RB, 3]])] });
// Pectoraux : progressaient avec 3 series, aujourd'hui 5 series et une baisse.
const scVolumeEleve = () => ({ sessions: seances([{ du: -120, au: -30, pas: 4, exos: [[DC, 'prog', 3, 30]] }, { du: -27, au: -1, pas: 4, exos: [[DC, 'reg', 5, 40]] }]),
  routines: [routine(1, 'Push', [[DC, 5]])] });

const tests = []; const t = (n, f) => tests.push([n, f]);

// ── Duree estimee ──
t('Duree : series x reps x 3 s + repos entre series + echauffement + transitions ; total de la semaine = somme des seances', () => {
  const d = E.dureeProgramme([routine(1, 'A', [[DC, 3, 120], [EC, 2, 60]]), routine(2, 'B', [])]);
  // DC : 3 x 10 x 3 + 2 x 120 ; EC : 2 x 10 x 3 + 1 x 60 ; + 1 transition (aucun echauffement saisi).
  const dc = E.dureeExercice({ name: DC, sets: 3, repsTarget: '8-12', rest: 120 }), ec = E.dureeExercice({ name: EC, sets: 2, repsTarget: '8-12', rest: 60 });
  assert.strictEqual(d.seances[0].secondes, dc + ec + 60);
  assert.strictEqual(d.seances[1].secondes, 0);
  assert.strictEqual(d.totalSecondes, d.seances[0].secondes);
  assert.strictEqual(dc, 3 * 30 + 2 * 120, 'execution des 3 series + 2 repos (aucun apres la derniere)');
  assert.ok(E.dureeExercice({ name: DC, sets: 4, repsTarget: '8-12', rest: 120 }) > dc, 'une serie de plus = plus long');
});

t('comparerDurees : refuse une seance qui depasse sa duree de plus de 2 min, ou un total de semaine en hausse', () => {
  const avant = [routine(1, 'A', [[DC, 3]]), routine(2, 'B', [[RB, 3]])];
  const plusUneSerie = [routine(1, 'A', [[DC, 4]]), routine(2, 'B', [[RB, 3]])];
  const transfert = [routine(1, 'A', [[DC, 4]]), routine(2, 'B', [[RB, 2]])];
  const deplace = [routine(1, 'A', []), routine(2, 'B', [[RB, 3], [DC, 3]])];
  assert.strictEqual(E.comparerDurees(avant, avant, 120).ok, true);
  assert.strictEqual(E.comparerDurees(avant, plusUneSerie, 120).ok, false, 'total en hausse');
  assert.strictEqual(E.comparerDurees(avant, transfert, 120).ok, true, 'meme total, chaque seance dans la marge');
  const cd = E.comparerDurees(avant, deplace, 120); assert.strictEqual(cd.ok, false, 'B s\'allonge de plus de 2 min');
  assert.ok(cd.seances[1].ecart > 120);
});

// ── Les 8 cas demandes ──
t('1. Muscle qui progresse normalement : volume « adapte », AUCUNE proposition', () => {
  const s = seances([{ du: -120, au: -1, pas: 4, exos: [[DC, 'prog', 3, 30]] }]);
  const r = P({ sessions: s, routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.strictEqual(r.muscles.Pectoraux.etat, 'progression');
  assert.strictEqual(r.muscles.Pectoraux.volume.etat, 'adapte');
  assert.ok(r.muscles.Pectoraux.volume.reference.periodes >= 3, 'reference construite sur son propre historique');
  assert.strictEqual(r.propositions.length, 0); assert.strictEqual(r.sansSolution.length, 0);
});

t('2. Muscle qui stagne : volume analyse AVANT toute proposition ; volume dans sa reference -> aucune proposition de volume', () => {
  const ins = P(scTransfert());
  assert.deepStrictEqual([ins.muscles.Pectoraux.etat, ins.muscles.Pectoraux.volume.etat, ins.muscles.Pectoraux.volume.raison], ['stagnation', 'insuffisant', 'volume_direct_sous_la_reference']);
  const ref = ins.muscles.Pectoraux.volume.reference; assert.ok(ref.directMin > ins.muscles.Pectoraux.directParSemaine);
  assert.ok(/moins que lors de tes \d+ périodes de 4 semaines où il progressait/.test(ins.propositions[0].raison), ins.propositions[0].raison);
  // Meme volume qu'avant, mais plus de progression : le volume n'est pas en cause, aucune serie ajoutee ni retiree.
  const s = seances([{ du: -120, au: -30, pas: 4, exos: [[DC, 'prog', 3, 30]] }, { du: -27, au: -1, pas: 4, exos: [[DC, 'stag', 3, 45]] }]);
  const r = P({ sessions: s, routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.deepStrictEqual([r.muscles.Pectoraux.etat, r.muscles.Pectoraux.volume.raison], ['stagnation', 'volume_dans_la_reference']);
  assert.ok(r.propositions.every(p => !['series', 'transferer_serie', 'deplacer_exercice', 'echanger_exercices'].includes(p.type)), JSON.stringify(r.propositions.map(p => p.type)));
  // Sans aucune periode de progression connue : on ne conclut rien sur le volume.
  const neuf = P({ sessions: seances([{ du: -27, au: -1, pas: 4, exos: [[DC, 'stag', 3, 45]] }]), routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.deepStrictEqual([neuf.muscles.Pectoraux.volume.etat, neuf.muscles.Pectoraux.volume.raison], ['indetermine', 'aucune_periode_de_progression_connue']);
});

t('3. Difficulte avec un volume deja eleve : jamais de serie en plus ; une serie de moins (au lieu d\'une charge plus basse)', () => {
  const d = scVolumeEleve(), r = P(d);
  assert.deepStrictEqual([r.muscles.Pectoraux.etat, r.muscles.Pectoraux.volume.etat], ['regression', 'excessif']);
  assert.strictEqual(r.propositions.length, 1); const p = r.propositions[0];
  assert.deepStrictEqual([p.type, p.avant, p.apres], ['series', { series: 5 }, { series: 4 }]);
  assert.ok(/plus que lors de tes 6 périodes de 4 semaines où il progressait \(5,5 au plus\) : une série de moins/.test(p.raison), p.raison);
  assert.ok(p.duree.ok && p.duree.ecartTotalS < 0 && /−2 min/.test(p.duree.texte), p.duree.texte);
  const a = E.appliquerProposition(d.routines, p); assert.ok(totalSeries(a.routines) < totalSeries(d.routines));
});

t('4. Muscle peu sollicite : une serie prise a un muscle qui progresse au-dessus de sa reference, MEME seance, duree et total inchanges', () => {
  const d = scTransfert(), r = P(d);
  assert.strictEqual(r.propositions.length, 1); const p = r.propositions[0];
  assert.strictEqual(p.type, 'transferer_serie');
  assert.deepStrictEqual([p.cible.exercice, p.avant.series, p.apres.series, p.apres.depuis.exercice, p.apres.depuis.series], [EC, 2, 3, TR, 3]);
  assert.ok(/Triceps progresse avec 7 séries par semaine \(il progressait déjà avec 4,5 par semaine\)/.test(p.raison), p.raison);
  assert.ok(p.duree.ok); assert.strictEqual(p.duree.ecartTotalS, 0); assert.strictEqual(p.duree.texte, 'Durée des séances : inchangée.');
  const a = E.appliquerProposition(d.routines, p); assert.ok(a.ok);
  assert.strictEqual(totalSeries(a.routines), totalSeries(d.routines), 'aucune serie ajoutee au programme');
  assert.deepStrictEqual(a.routines[0].exercises.map(e => [e.name, e.sets]), [[EC, 3], [TR, 3]]);
});

t('5. Exercice peu adapte : remplace par un exercice DEJA FAIT, meme muscle, qui a mieux progresse (chiffres a l\'appui)', () => {
  // Developpe incline : fait il y a 2 a 4 mois, progresse a chaque seance ; developpe couche : stagne depuis 4 semaines.
  const s = seances([{ du: -120, au: -60, pas: 4, exos: [[DI, 'prog', 3, 20]] }, { du: -56, au: -30, pas: 4, exos: [[DC, 'prog', 3, 30]] }, { du: -27, au: -1, pas: 4, exos: [[DC, 'stag', 3, 45]] }]);
  const rs = [routine(1, 'Push', [[DC, 3]])], r = P({ sessions: s, routines: rs });
  const p = r.propositions.find(x => x.type === 'remplacer_exercice'); assert.ok(p, JSON.stringify(r.propositions.map(x => x.type)));
  assert.deepStrictEqual([p.avant, p.apres], [{ exercice: DC }, { exercice: DI }]);
  assert.ok(/a progressé dans [\d,]+ % de tes séances comparables \(\d+ sur \d+\), contre [\d,]+ %/.test(p.raison) && /Mêmes séries et même plage/.test(p.raison), p.raison);
  assert.ok(p.duree.ok);
  // Remplacant moins productif que l'exercice actuel : aucune proposition de remplacement.
  const s2 = seances([{ du: -120, au: -60, pas: 4, exos: [[DI, 'stag', 3, 20]] }, { du: -56, au: -30, pas: 4, exos: [[DC, 'prog', 3, 30]] }, { du: -27, au: -1, pas: 4, exos: [[DC, 'stag', 3, 45]] }]);
  assert.ok(!P({ sessions: s2, routines: rs }).propositions.some(x => x.type === 'remplacer_exercice'));
});

t('6. Proposition qui rallongerait une seance : deplacement refuse, remplacee par un ECHANGE de duree proche ; sinon « sans solution »', () => {
  const d = scRepartition('prog'), r = P(d);
  assert.strictEqual(r.muscles.Pectoraux.volume.etat, 'insuffisant'); assert.ok(r.muscles.Pectoraux.frequence < r.muscles.Pectoraux.volume.reference.frequenceMin);
  // Deplacer le developpe couche vers « Pull » rallongerait Pull de plus de 2 min : jamais propose.
  assert.ok(!r.propositions.some(p => p.type === 'deplacer_exercice'));
  const p = r.propositions[0]; assert.strictEqual(p.type, 'echanger_exercices');
  assert.deepStrictEqual([p.cible.exercice, p.apres.echange.exercice, p.apres.routineNom], [DC, RB, 'Pull']);
  assert.ok(/Tout est dans « Push », 1,3 fois par semaine \(au moins 2,3 quand il progressait\)/.test(p.raison) && /dos, qui progresse/.test(p.raison), p.raison);
  assert.ok(p.duree.ok && p.duree.ecartTotalS === 0);
  // Le dos ne progresse pas non plus : rien a echanger -> aucune proposition de volume, une ligne « sans solution ».
  const r2 = P(scRepartition('stag'));
  assert.ok(!r2.propositions.some(x => ['deplacer_exercice', 'echanger_exercices', 'transferer_serie', 'series'].includes(x.type)));
  assert.deepStrictEqual(r2.sansSolution.map(x => [x.muscle, x.etat]), [['Pectoraux', 'insuffisant']]);
  assert.ok(/aucune solution sans rallonger tes séances/.test(r2.sansSolution[0].texte));
  // Toutes les propositions restantes respectent la duree.
  r2.propositions.forEach(x => assert.ok(x.duree && x.duree.ok));
});

t('7. Proposition acceptee : programme mis a jour (echange en place), duree recalculee, le nouveau programme devient la reference', () => {
  const d = scRepartition('prog'), r = P(d), p = r.propositions[0];
  const a = E.appliquerProposition(d.routines, p); assert.ok(a.ok);
  assert.deepStrictEqual(a.routines.map(x => x.exercises.map(e => e.name)), [[EC, RB], [DC]]);
  const avant = E.dureeProgramme(d.routines), apres = E.dureeProgramme(a.routines);
  assert.strictEqual(apres.totalSecondes, avant.totalSecondes);
  apres.seances.forEach((x, i) => assert.ok(x.secondes <= avant.seances[i].secondes + 120));
  const dec = E.enregistrerDecision(null, p, 'acceptee', J + 'T08:00:00.000Z');
  const ensuite = P({ sessions: d.sessions, routines: a.routines, decisions: dec });
  assert.ok(ensuite.exercices.filter(e => [DC, RB].includes(e.exercice)).every(e => e.enEssai), 'les deux exercices echanges attendent 2 seances');
  assert.ok(!ensuite.propositions.some(x => [DC, RB].includes(x.cible.exercice)));
  // Programme modifie entre-temps (l'exercice echange n'est plus dans Pull) : rien n'est applique.
  const modifie = JSON.parse(JSON.stringify(d.routines)); modifie[1].exercises[0].name = CU;
  assert.deepStrictEqual(E.appliquerProposition(modifie, p), { ok: false, raison: 'programme_modifie' });
});

t('8. Proposition refusee : programme strictement inchange, la meme proposition ne revient pas', () => {
  const d = scTransfert(), r = P(d), p = r.propositions[0], copie = JSON.stringify(d.routines);
  const dec = E.enregistrerDecision(null, p, 'refusee', J + 'T08:00:00.000Z');
  assert.strictEqual(JSON.stringify(d.routines), copie);
  const ensuite = P(Object.assign({}, d, { decisions: dec }));
  assert.ok(!ensuite.propositions.some(x => x.id === p.id));
});

// ── Securite et invariants ──
t('Transfert de serie : programme modifie (series changees) -> rien n\'est applique', () => {
  const d = scTransfert(), p = P(d).propositions[0];
  const m = JSON.parse(JSON.stringify(d.routines)); m[0].exercises[1].sets = 5;
  assert.deepStrictEqual(E.appliquerProposition(m, p), { ok: false, raison: 'programme_modifie' });
});

t('Aucune proposition n\'augmente le total de series ni la duree de la semaine (tous scenarios)', () => {
  [scTransfert(), scRepartition('prog'), scRepartition('stag'), scVolumeEleve()].forEach(d => {
    P(d).propositions.forEach(p => {
      const a = E.appliquerProposition(d.routines, p); assert.ok(a.ok, p.type);
      assert.ok(totalSeries(a.routines) <= totalSeries(d.routines), p.type);
      assert.ok(E.comparerDurees(d.routines, a.routines, 120).ok, p.type);
    });
  });
});

t('Entrees jamais modifiees ; resultat identique a chaque appel (aucun hasard)', () => {
  const d = scRepartition('prog'); deepFreeze(d);
  const a = JSON.stringify(P(d)), b = JSON.stringify(P(d)); assert.strictEqual(a, b);
  assert.ok(JSON.parse(a).duree.totalSecondes > 0);
});

// ── 0.20.1 : calcul corrige et heure des series ──
t('0.20.1 Duree : pas de repos apres la derniere serie ; formule exacte', () => {
  const D = E.DUREE, e = { name: DC, sets: 3, repsTarget: '8-12', rest: 120, warmupSets: 2 };
  const serie = 10 * D.SECONDES_PAR_REP; // fourchette 8-12 : 10 reps visees en moyenne
  assert.strictEqual(E.dureeExercice(e), 3 * serie + 2 * 120 + 2 * (D.ECHAUFFEMENT_SERIE_S + D.ECHAUFFEMENT_REPOS_S));
  assert.strictEqual(E.dureeExercice({ name: DC, sets: 1, repsTarget: '8-12', rest: 120 }), serie, 'une seule serie : aucun repos');
});

t('0.20.1 Duree : exercice unilateral = temps d\'execution double, repos inchange', () => {
  const bi = E.dureeExercice({ name: 'Curl biceps câble', sets: 3, repsTarget: '8-12', rest: 60 });
  const uni = E.dureeExercice({ name: 'Curl câble unilatéral', sets: 3, repsTarget: '8-12', rest: 60 });
  assert.strictEqual(uni - bi, 3 * 10 * E.DUREE.SECONDES_PAR_REP);
  ['Tirage horizontal câble une main', 'Rowing haltère unilatéral', 'Leg press unilatéral'].forEach(n =>
    assert.ok(E.dureeExercice({ name: n, sets: 2, repsTarget: '8-12', rest: 60 }) > E.dureeExercice({ name: 'X', sets: 2, repsTarget: '8-12', rest: 60 }), n));
});

t('0.20.1 Appli : heure de validation notee a la validation, retiree a la devalidation, gardee a l\'enregistrement ; rien d\'affiche', () => {
  const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(SRC.includes('(s.done ? (({ faiteLe, ...reste }) => ({ ...reste, done: false }))(s) : { ...s, done: true, faiteLe: Date.now() })'));
  assert.ok(SRC.includes('...(Number(s.faiteLe) > 0 ? { faiteLe: Number(s.faiteLe) } : {}), done: true }))'));
  assert.strictEqual((SRC.match(/faiteLe/g) || []).length, 5, 'aucun autre usage (pas d\'affichage)');
});

t('Page coach (option sansDeplacements) : aucun deplacement, echange ni transfert de serie ; les autres propositions restent', () => {
  const INTERDITS = ['deplacer_exercice', 'echanger_exercices', 'transferer_serie'];
  [scTransfert(), scRepartition('prog')].forEach(d => {
    const avec = P(d), sans = P(d, { sansDeplacements: true });
    assert.ok(avec.propositions.some(p => INTERDITS.includes(p.type)), 'le scenario produit bien un echange sans l option');
    assert.ok(!sans.propositions.some(p => INTERDITS.includes(p.type)), JSON.stringify(sans.propositions.map(p => p.type)));
  });
  const s = seances([{ du: -120, au: -60, pas: 4, exos: [[DI, 'prog', 3, 20]] }, { du: -56, au: -30, pas: 4, exos: [[DC, 'prog', 3, 30]] }, { du: -27, au: -1, pas: 4, exos: [[DC, 'stag', 3, 45]] }]);
  assert.ok(P({ sessions: s, routines: [routine(1, 'Push', [[DC, 3]])] }, { sansDeplacements: true }).propositions.some(x => x.type === 'remplacer_exercice'), 'remplacement toujours propose');
});

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
