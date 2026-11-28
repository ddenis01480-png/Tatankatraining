// Lancer : node tests/propositions.test.js     (avec tes donnees : EXPORT_FILE=/chemin/export.json node tests/propositions.test.js)
// Moteur 0.18.0 (regles de volume mises a jour en 0.20.0, voir tests/volume-duree.test.js) : propositions d'adaptation (propositionsAdaptation), application d'une proposition acceptee (appliquerProposition),
// decisions de l'utilisateur (enregistrerDecision) et charge proposee pour le pre-remplissage (chargeCibleActive).
process.env.TZ = 'Europe/Paris';
const fs = require('fs'), assert = require('assert');
const E = require('../coach-engine.js');
const EXPORT_FILE = process.env.EXPORT_FILE || null;
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const addDays = (d, n) => { const p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
const J = '2026-11-28';
let nid = 1;
// Series : "40x12,40x12,40x11" ; rir : valeur, ou null pour « non saisi ».
const sets = (txt, rir) => txt.split(',').map(y => { const [w, r] = y.split('x').map(Number); return rir === null ? { weight: w, reps: r, rir: '', rirSaisi: false, done: true } : { weight: w, reps: r, rir: rir === undefined ? 2 : rir, rirSaisi: true, done: true }; });
const sess = (date, exos) => ({ id: nid++, date, routineId: 1, routineName: 'Push', exercises: exos });
const ex = (name, txt, rt, rir) => ({ name, repsTarget: rt || '8-12', sets: sets(txt, rir) });
// Historique regulier finissant a J (dernier = J - 1).
const historique = (n, pas, f) => Array.from({ length: n }, (_, i) => sess(addDays(J, -1 - (n - 1 - i) * pas), f(i, n)));
const routine = (id, name, exos) => ({ id, name, day: '', exercises: exos.map(([nm, s, rt]) => ({ name: nm, sets: s, repsTarget: rt || '8-12', rest: 90 })) });
const P = (donnees, o) => E.propositionsAdaptation(donnees, Object.assign({ maintenant: J }, o || {}));
const fatigueComplete = (v, date) => ({ sleep: v, appetite: v, motivation: v, techDegrades: v, heavyFeel: v, _repondu: { sleep: date, appetite: date, motivation: date, techDegrades: date, heavyFeel: date } });

const tests = []; const t = (n, f) => tests.push([n, f]); const infos = []; const info = s => infos.push(s);

// Scenarios de base
const DC = 'Développé couché haltères';
const plafond = () => historique(6, 4, (i, n) => [ex(DC, i < n - 3 ? '40x10,40x10,40x9' : '40x12,40x12,40x11')]);
const regression = () => historique(6, 4, (i, n) => [ex(DC, ['40x10,40x10,40x10', '40x10,40x10,40x10', '40x10,40x10,40x10', '40x10,40x10,40x10', '40x9,40x9,40x9', '40x7,40x7,40x7'][i])]);
const stagnation = (n, pas, nbSeries) => historique(n, pas, () => [ex(DC, Array(nbSeries).fill('40x10').join(','))]);

t('Plafond (3 seances au haut de la fourchette) -> proposer +2,5 kg, raison chiffree, statut « proposee », rien d\'automatique', () => {
  const r = P({ sessions: plafond(), routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.strictEqual(r.propositions.length, 1); const p = r.propositions[0];
  assert.deepStrictEqual([p.type, p.avant, p.apres, p.statut, p.cible.exercice, p.cible.fourchette], ['charge', { charge: 40 }, { charge: 42.5 }, 'proposee', DC, '8-12']);
  assert.ok(/3 séances à 40 kg/.test(p.raison) && /8-12/.test(p.raison), p.raison);
  assert.strictEqual(r.adaptationAutomatique, false);
});

t('Baisse persistante SANS fatigue renseignee -> charge -5 % ; la raison dit que la fatigue n\'est pas connue (jamais « mauvaise recuperation »)', () => {
  const r = P({ sessions: regression(), routines: [routine(1, 'Push', [[DC, 3]])] });
  const p = r.propositions[0]; assert.ok(p, 'une proposition');
  assert.deepStrictEqual([p.type, p.avant, p.apres], ['charge', { charge: 40 }, { charge: 37.5 }]);
  assert.ok(/Fatigue non renseignée/.test(p.raison) && !/récupér/.test(p.raison), p.raison);
  assert.strictEqual(r.fatigue.utilisable, false); assert.strictEqual(r.fatigue.raison, 'non_renseigne');
});

t('Baisse persistante + fatigue COMPLETE, RECENTE et elevee -> une serie de moins (et non une baisse de charge)', () => {
  const r = P({ sessions: regression(), routines: [routine(1, 'Push', [[DC, 4]])], fatigue: fatigueComplete(2, addDays(J, -2)) });
  const p = r.propositions[0];
  assert.deepStrictEqual([p.type, p.avant, p.apres], ['series', { series: 4 }, { series: 3 }]);
  assert.ok(/Fatigue déclarée élevée \(10\/15\)/.test(p.raison), p.raison);
});

t('Fatigue ancienne (> 7 jours), partielle, ou fiche par defaut a 0 : NON utilisee (pas d\'invention, pas de « fatigue basse »)', () => {
  const routines = [routine(1, 'Push', [[DC, 4]])];
  const ancienne = P({ sessions: regression(), routines, fatigue: fatigueComplete(3, addDays(J, -9)) });
  assert.deepStrictEqual([ancienne.fatigue.utilisable, ancienne.fatigue.raison, ancienne.propositions[0].type], [false, 'ancien_ou_non_date', 'charge']);
  const partielle = P({ sessions: regression(), routines, fatigue: { sleep: 3, _repondu: { sleep: J } } });
  assert.deepStrictEqual([partielle.fatigue.utilisable, partielle.fatigue.raison], [false, 'partiel']);
  const defaut = P({ sessions: regression(), routines, fatigue: { sleep: 0, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0 } });
  assert.deepStrictEqual([defaut.fatigue.utilisable, defaut.fatigue.raison], [false, 'non_renseigne']);
});

t('Stagnation SANS periode de progression connue : jamais de serie en plus (0.20.0 : aucun seuil universel de volume)', () => {
  const r = P({ sessions: stagnation(6, 4, 3), routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.strictEqual(r.exercices[0].etat, 'stagnation');
  assert.deepStrictEqual([r.muscles.Pectoraux.volume.etat, r.muscles.Pectoraux.volume.raison], ['indetermine', 'aucune_periode_de_progression_connue']);
  assert.ok(!r.propositions.some(p => p.type === 'series' || p.type === 'transferer_serie'), JSON.stringify(r.propositions.map(p => p.type)));
});

t('Stagnation, volume suffisant, meme plage depuis >= 8 semaines -> nouvelle plage de repetitions (8-12 -> 6-10)', () => {
  const r = P({ sessions: stagnation(22, 3, 5), routines: [routine(1, 'Push', [[DC, 5]])] });
  const p = r.propositions[0]; assert.ok(p, JSON.stringify(r.muscles.Pectoraux));
  assert.deepStrictEqual([p.type, p.avant, p.apres], ['fourchette', { fourchette: '8-12' }, { fourchette: '6-10' }]);
  assert.ok(/depuis 9 semaines/.test(p.raison), p.raison);
});

t('Stagnation, plage recente -> remplacement UNIQUEMENT par un exercice deja fait (au moins 2 comparaisons), du meme muscle, plus productif, absent du programme', () => {
  const DI = 'Développé incliné haltères';
  const vieux = [10, 9, 8, 7].map((d, i) => sess(addDays(J, -d * 6), [ex(DI, ['30x9,30x9', '30x10,30x10', '30x11,30x11', '30x12,30x12'][i])]));
  const avec = P({ sessions: vieux.concat(stagnation(8, 3, 5)), routines: [routine(1, 'Push', [[DC, 5]])] });
  const p = avec.propositions[0]; assert.ok(p);
  assert.deepStrictEqual([p.type, p.avant, p.apres], ['remplacer_exercice', { exercice: DC }, { exercice: DI }]);
  assert.ok(/a progressé dans 100 % de tes séances comparables \(3 sur 3\), contre 0 %/.test(p.raison), p.raison);
  const une = P({ sessions: [sess(addDays(J, -45), [ex(DI, '30x10,30x10')])].concat(stagnation(8, 3, 5)), routines: [routine(1, 'Push', [[DC, 5]])] });
  assert.strictEqual(une.propositions.length, 0, 'fait une seule fois : rien a comparer -> pas de remplacement');
  const sans = P({ sessions: stagnation(8, 3, 5), routines: [routine(1, 'Push', [[DC, 5]])] });
  assert.strictEqual(sans.propositions.length, 0, 'aucun exercice connu -> aucune proposition (rien d\'invente)');
});

t('RIR : les propositions sont identiques avec ou sans RIR saisis (jamais de RIR invente)', () => {
  const avec = historique(6, 4, (i, n) => [ex(DC, i < n - 3 ? '40x10,40x10,40x9' : '40x12,40x12,40x11', '8-12', 1)]);
  nid = 1; const a = P({ sessions: avec, routines: [routine(1, 'Push', [[DC, 3]])] });
  nid = 1; const sansRir = historique(6, 4, (i, n) => [ex(DC, i < n - 3 ? '40x10,40x10,40x9' : '40x12,40x12,40x11', '8-12', null)]);
  const b = P({ sessions: sansRir, routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.deepStrictEqual(a.propositions.map(p => [p.id, p.raison]), b.propositions.map(p => [p.id, p.raison]));
  assert.strictEqual(a.rir.utilise, false);
});

t('Deux baisses legeres (seuil de baisse persistante non atteint) : « baisse a confirmer », AUCUNE proposition (surtout pas une serie de plus)', () => {
  const ss = historique(6, 4, (i) => [ex(DC, ['40x10,40x10,40x10', '40x10,40x10,40x10', '40x10,40x10,40x10', '40x10,40x10,40x10', '40x9,40x9,40x9', '40x8,40x8,40x7'][i])]);
  const r = P({ sessions: ss, routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.deepStrictEqual([r.exercices[0].etat, r.propositions.length], ['baisse_a_confirmer', 0]);
});

t('Donnees insuffisantes (2 seances, ou derniere seance > 28 jours) -> aucune proposition', () => {
  assert.strictEqual(P({ sessions: historique(2, 4, () => [ex(DC, '40x12,40x12,40x12')]), routines: [routine(1, 'Push', [[DC, 3]])] }).propositions.length, 0);
  const vieux = historique(6, 4, (i, n) => [ex(DC, i < n - 3 ? '40x10,40x10,40x9' : '40x12,40x12,40x11')]).map(s => Object.assign({}, s, { date: addDays(s.date, -40) }));
  const r = P({ sessions: vieux, routines: [routine(1, 'Push', [[DC, 3]])] });
  assert.strictEqual(r.propositions.length, 0); assert.strictEqual(r.exercices[0].etat, 'pas_recent');
  assert.strictEqual(P({ sessions: [], routines: [] }).propositions.length, 0);
});

t('Exercice d\'activation : jamais evalue ni modifie ; exercice hors programme : jamais propose', () => {
  const routines = [{ id: 1, name: 'Push', exercises: [{ name: DC, sets: 3, repsTarget: '8-12', activation: true }] }];
  assert.strictEqual(P({ sessions: plafond(), routines }).propositions.length, 0);
  assert.strictEqual(P({ sessions: plafond(), routines: [] }).propositions.length, 0);
});

t('Refus : la meme proposition (memes chiffres) ne revient pas ; acceptation : l\'exercice attend 2 seances avec le nouveau programme', () => {
  const routines = [routine(1, 'Push', [[DC, 3]])], sessions = plafond();
  const p = P({ sessions, routines }).propositions[0];
  const ref = E.enregistrerDecision(null, p, 'refusee', J + 'T08:00:00.000Z');
  assert.strictEqual(P({ sessions, routines, decisions: ref }).propositions.length, 0);
  const acc = E.enregistrerDecision(null, p, 'acceptee', J + 'T08:00:00.000Z');
  const r = P({ sessions, routines, decisions: acc }); assert.strictEqual(r.propositions.length, 0); assert.strictEqual(r.exercices[0].enEssai, true);
  // Apres 2 seances faites APRES l'acceptation (au plafond a 42,5 kg), l'exercice est de nouveau evalue.
  const apres = sessions.concat([sess(addDays(J, 1), [ex(DC, '42.5x12,42.5x12,42.5x11')]), sess(addDays(J, 4), [ex(DC, '42.5x12,42.5x12,42.5x11')]), sess(addDays(J, 7), [ex(DC, '42.5x12,42.5x12,42.5x11')])]);
  const r2 = P({ sessions: apres, routines, decisions: acc }, { maintenant: addDays(J, 8) });
  assert.strictEqual(r2.exercices[0].enEssai, false); assert.deepStrictEqual(r2.propositions.map(x => x.apres), [{ charge: 45 }]);
  assert.throws(() => E.enregistrerDecision(null, p, 'peut-etre'));
});

t('appliquerProposition : nouveau programme, l\'ancien intact ; charge = charge cible datee ; series ; plage ; remplacement', () => {
  const routines = deepFreeze([routine(1, 'Push', [[DC, 3], ['Pec deck', 3, '15-20']]), routine(2, 'Pull', [['Rowing', 4]])]);
  const p = P({ sessions: plafond(), routines }).propositions[0];
  const a = E.appliquerProposition(routines, p, { le: '2026-11-28T08:00:00.000Z' });
  assert.ok(a.ok); assert.strictEqual(a.routines[0].exercises[0].chargeCible, 42.5); assert.strictEqual(a.routines[0].exercises[0].chargeCibleLe, '2026-11-28T08:00:00.000Z');
  assert.strictEqual(routines[0].exercises[0].chargeCible, undefined, 'routines recues inchangees');
  assert.deepStrictEqual(a.routines[1], JSON.parse(JSON.stringify(routines[1])), 'autres routines identiques');
  const mk = (type, avant, apres) => ({ id: 'x', type, cible: { exercice: DC, fourchette: '8-12', occurrences: [{ routineId: 1, index: 0 }] }, avant, apres });
  assert.strictEqual(E.appliquerProposition(routines, mk('series', { series: 3 }, { series: 4 })).routines[0].exercises[0].sets, 4);
  assert.strictEqual(E.appliquerProposition(routines, mk('fourchette', { fourchette: '8-12' }, { fourchette: '6-10' })).routines[0].exercises[0].repsTarget, '6-10');
  const rem = E.appliquerProposition(routines, mk('remplacer_exercice', { exercice: DC }, { exercice: 'Développé incliné haltères' }));
  assert.deepStrictEqual([rem.routines[0].exercises[0].name, rem.routines[0].exercises[0].sets, rem.routines[0].exercises[0].repsTarget], ['Développé incliné haltères', 3, '8-12']);
});

t('appliquerProposition : programme modifie depuis la proposition -> RIEN n\'est applique', () => {
  const routines = [routine(1, 'Push', [[DC, 3]])];
  const mk = (type, avant, apres, occ) => ({ id: 'x', type, cible: { exercice: DC, fourchette: '8-12', occurrences: occ || [{ routineId: 1, index: 0 }] }, avant, apres });
  assert.deepStrictEqual(E.appliquerProposition(routines, mk('series', { series: 4 }, { series: 5 })), { ok: false, raison: 'programme_modifie' }, 'series deja changees');
  assert.strictEqual(E.appliquerProposition([routine(1, 'Push', [[DC, 3, '10-15']])], mk('series', { series: 3 }, { series: 4 })).ok, false, 'plage changee');
  assert.strictEqual(E.appliquerProposition(routines, mk('series', { series: 3 }, { series: 4 }, [{ routineId: 9, index: 0 }])).ok, false, 'routine supprimee');
  assert.strictEqual(E.appliquerProposition([routine(1, 'Push', [[DC, 3], ['Développé incliné haltères', 3]])], mk('remplacer_exercice', { exercice: DC }, { exercice: 'Développé incliné haltères' })).ok, false, 'remplacant deja present');
  // Exercice deplace dans la meme routine : retrouve par son nom et sa plage.
  const deplace = E.appliquerProposition([routine(1, 'Push', [['Pec deck', 3, '15-20'], [DC, 3]])], mk('series', { series: 3 }, { series: 4 }));
  assert.ok(deplace.ok); assert.strictEqual(deplace.routines[0].exercises[1].sets, 4);
});

t('Muscle en baisse sur 28 jours avec un volume direct > 20 series / semaine -> une serie de moins sur son exercice le plus charge', () => {
  const A = 'Développé couché haltères', B = 'Écarté poulie vis-à-vis couché';
  const ss = historique(10, 2, (i) => { const k = i < 6 ? 0 : i - 5; return [ex(A, Array(6).fill((40) + 'x' + (12 - k)).join(',')), ex(B, Array(5).fill('20x' + (14 - k)).join(','), '10-15')]; });
  const r = P({ sessions: ss, routines: [routine(1, 'Push', [[A, 6], [B, 5, '10-15']])] });
  info('muscle Pectoraux : ' + r.muscles.Pectoraux.etat + ', ' + r.muscles.Pectoraux.directParSemaine + ' series/sem ; propositions : ' + r.propositions.map(p => p.type + ' ' + p.cible.exercice).join(' ; '));
  assert.ok(r.muscles.Pectoraux.directParSemaine > 20);
  assert.ok(r.propositions.every(p => p.muscle === 'Pectoraux'));
  assert.ok(r.propositions.some(p => p.type === 'series' && p.apres.series === p.avant.series - 1 || p.type === 'charge' && p.apres.charge < p.avant.charge), 'reduction proposee');
});

t('Repartition : deplacer un exercice vers une autre seance qui s\'allongerait de plus de 2 min n\'est JAMAIS propose (0.20.0)', () => {
  const A = 'Curl barre EZ', B = 'Curl marteau haltères';
  const ss = historique(6, 6, () => [ex(A, '30x10,30x10,30x10,30x10,30x10,30x10'), ex(B, '14x10,14x10,14x10,14x10,14x10', '10-15')]);
  const routines = [routine(1, 'Pull', [[A, 6], [B, 5, '10-15'], ['Rowing', 3]]), routine(2, 'Bras', [['Dips', 3]]), routine(3, 'Jambes', [['Squat', 3], ['Leg curl', 3]])];
  const r = P({ sessions: ss, routines });
  info('Biceps : ' + r.muscles.Biceps.etat + ', frequence ' + r.muscles.Biceps.frequence + ', direct ' + r.muscles.Biceps.directParSemaine + ' ; ' + r.propositions.map(p => p.type + ' ' + p.cible.exercice).join(' ; '));
  assert.ok(!r.propositions.some(p => p.type === 'deplacer_exercice'));
  r.propositions.forEach(p => assert.ok(p.duree && p.duree.ok, p.type));
  // L'application d'un deplacement reste possible (proposition acceptee d'une version precedente).
  const d = { type: 'deplacer_exercice', cible: { exercice: B, fourchette: '10-15', occurrences: [{ routineId: 1, index: 1 }] }, avant: { routineId: 1 }, apres: { routineId: 2 } };
  const a = E.appliquerProposition(routines, d); assert.ok(a.ok);
  assert.deepStrictEqual([a.routines[0].exercises.map(e => e.name), a.routines[1].exercises.map(e => e.name)], [[A, 'Rowing'], ['Dips', B]]);
});

t('chargeCibleActive : utilisee au pre-remplissage jusqu\'a la premiere seance faite APRES l\'acceptation', () => {
  const exR = { name: DC, sets: 3, repsTarget: '8-12', chargeCible: 42.5, chargeCibleLe: '2026-11-28T08:00:00.000Z' };
  const avant = [{ id: Date.parse('2026-11-27T18:00:00Z'), date: '2026-11-27', exercises: [ex(DC, '40x12')] }];
  assert.strictEqual(E.chargeCibleActive(exR, avant), 42.5);
  const apres = avant.concat([{ id: Date.parse('2026-11-28T18:00:00Z'), date: '2026-11-28', exercises: [ex(DC, '42.5x10')] }]);
  assert.strictEqual(E.chargeCibleActive(exR, apres), null);
  assert.strictEqual(E.chargeCibleActive({ name: DC }, avant), null);
});

t('Entrees jamais modifiees (seances, routines, fatigue, decisions geles)', () => {
  const d = deepFreeze({ sessions: regression(), routines: [routine(1, 'Push', [[DC, 4]])], fatigue: fatigueComplete(2, J), decisions: E.decisionsVides() });
  const r = P(d); assert.ok(r.propositions.length >= 1);
});

if (EXPORT_FILE && fs.existsSync(EXPORT_FILE)) t('Donnees reelles (copie en lecture seule) : aucune erreur, chaque proposition a une raison et des mesures, export intact', () => {
  const brut = fs.readFileSync(EXPORT_FILE, 'utf8'), x = deepFreeze(JSON.parse(brut));
  const r = E.propositionsAdaptation({ sessions: x.sessions, routines: x.routines, fatigue: x.fatigue }, { maintenant: x.exportDate || J });
  r.propositions.forEach(p => { assert.ok(p.raison && p.mesures && p.titre && p.statut === 'proposee', p.id); });
  const c = {}; r.exercices.forEach(e => { c[e.etat] = (c[e.etat] || 0) + 1; });
  const mu = {}; Object.values(r.muscles).forEach(m => { mu[m.etat] = (mu[m.etat] || 0) + 1; });
  info('donnees reelles : ' + x.sessions.length + ' seances, exercices du programme ' + JSON.stringify(c) + ', muscles ' + JSON.stringify(mu) + ', fatigue utilisable ' + r.fatigue.utilisable + ' (' + r.fatigue.raison + ')');
  info('propositions : ' + (r.propositions.length ? r.propositions.map(p => p.titre).join(' | ') : 'aucune'));
  assert.strictEqual(fs.readFileSync(EXPORT_FILE, 'utf8'), brut);
});

let ok = 0;
for (const [n, f] of tests) { try { f(); ok++; console.log('OK   ' + n); } catch (e) { console.log('FAIL ' + n + '\n     -> ' + (e.message || e).split('\n')[0]); } }
infos.forEach(s => console.log('       info : ' + s));
console.log('\n' + ok + '/' + tests.length + ' tests passes'); process.exitCode = ok === tests.length ? 0 : 1;
