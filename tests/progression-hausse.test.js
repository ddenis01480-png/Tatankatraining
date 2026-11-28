// Lancer : node tests/progression-hausse.test.js
// Moteur 0.19.0 : progression APRES une hausse de charge acceptee. Exemple de reference (David) : Developpe couche halteres, 8-12,
// 40 kg -> 42,5 kg acceptes ; cible 8 reps ; puis +1 rep par seance jusqu'a 12 avant la prochaine hausse.
process.env.TZ = 'Europe/Paris';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const E = require('../coach-engine.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fnSrc = sig => { const i = SRC.indexOf(sig); if (i < 0) throw new Error('fonction ' + sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
const addDays = (d, n) => { const p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
const DC = 'Développé couché haltères', J0 = '2026-11-10';
// Series : "40x12,40x12,40x11" ; rir : nombre (saisi) ou null (non saisi).
const st = (txt, rir) => txt.split(',').map(y => { const [w, r] = y.split('x').map(Number); return rir === null || rir === undefined ? { weight: w, reps: r, rir: '', rirSaisi: false, done: true } : { weight: w, reps: r, rir, rirSaisi: true, done: true }; });
let nid = 1;
const sess = (date, txt, rt, rir) => ({ id: nid++, date, exercises: [{ name: DC, repsTarget: rt || '8-12', sets: st(txt, rir) }] });
const H = list => E.historiqueExercice(E.normaliserSeances(list), DC);
const conseil = (list, o) => E.conseilProgression(H(list), Object.assign({ fourchette: (o && o.rt) || '8-12', seriesPrevues: 3, aujourdhui: addDays(list[list.length - 1].date, 1) }, o || {}));
const AVANT = () => [sess(J0, '40x10,40x10,40x9'), sess(addDays(J0, 3), '40x11,40x11,40x10'), sess(addDays(J0, 6), '40x12,40x12,40x11'), sess(addDays(J0, 9), '40x12,40x12,40x11'), sess(addDays(J0, 12), '40x12,40x12,40x11')];

const tests = []; const t = (n, f) => tests.push([n, f]); const infos = []; const info = s => infos.push(s);

t('Seance qui suit l\'acceptation : la nouvelle charge (42,5) est la reference, cible = bas de fourchette (8) ; rien d\'autre', () => {
  const c = conseil(AVANT(), { chargeAcceptee: 42.5 });
  assert.deepStrictEqual([c.action, c.charge, c.chargeAvant, c.repsCible, c.repsMax], ['nouvelle_charge', 42.5, 40, 8, 12]);
  // Sans charge acceptee, le conseil reste celui d'avant (aucun changement de comportement).
  assert.strictEqual(conseil(AVANT()).action, 'ajouter_rep');
});

t('Fourchette propre a chaque exercice : 10-15 -> cible 10 ; 15-20 -> cible 15 ; jamais une fourchette par defaut', () => {
  const h = [sess(J0, '20x15,20x15,20x15', '10-15'), sess(addDays(J0, 3), '20x15,20x15,20x15', '10-15')];
  assert.strictEqual(conseil(h, { rt: '10-15', chargeAcceptee: 21.25 }).repsCible, 10);
  const h2 = [sess(J0, '30x20,30x20,30x20', '15-20')];
  assert.strictEqual(conseil(h2, { rt: '15-20', chargeAcceptee: 32.5 }).repsCible, 15);
});

t('Premiere seance a 42,5 kg (8,8,8) : pas lue comme une baisse ; historique a 40 kg conserve ; conseil suivant = +1 rep sur une serie', () => {
  const l = AVANT().concat([sess(addDays(J0, 15), '42.5x8,42.5x8,42.5x8')]), h = H(l);
  assert.strictEqual(h.length, 6, 'historique complet, rien remis a zero');
  const a = E.analyseExercice(h); assert.notStrictEqual(a.performance, 'regression'); assert.strictEqual(a.alerte, null);
  const c = conseil(l);
  assert.deepStrictEqual([c.action, c.charge, c.reps], ['ajouter_rep', 42.5, 9]);
  assert.deepStrictEqual([c.apresHausse.chargeAvant, c.apresHausse.charge, c.apresHausse.evaluation, c.apresHausse.rirUtilise], [40, 42.5, 'adaptee', false]);
});

t('Reconstruction progressive : en suivant le conseil, 42,5 x 8 -> 42,5 x 12 sur toutes les series, +1 rep a la fois, puis hausse a 45 kg en repartant a 8', () => {
  let l = AVANT().concat([sess(addDays(J0, 15), '42.5x8,42.5x8,42.5x8')]), d = addDays(J0, 15), n = 0, total = [24];
  for (;;) {
    const c = conseil(l);
    if (c.action === 'augmenter_charge') { assert.deepStrictEqual([c.charge, c.nouvelleCharge, c.repsCible], [42.5, 45, 8]); break; }
    assert.strictEqual(c.action, 'ajouter_rep', 'seance ' + n + ' : ' + c.action);
    const dern = H(l)[H(l).length - 1].series.map(s => s.reps); dern[c.serie - 1] = c.reps; d = addDays(d, 3);
    l = l.concat([sess(d, dern.map(r => '42.5x' + r).join(','))]); total.push(dern.reduce((a, b) => a + b, 0)); n++;
    assert.ok(n < 20, 'boucle');
    const a = E.analyseExercice(H(l)); assert.notStrictEqual(a.performance, 'regression');
  }
  assert.deepStrictEqual(H(l)[H(l).length - 1].series.map(s => s.reps), [12, 12, 12]);
  assert.ok(total.every((x, i) => i === 0 || x === total[i - 1] + 1), 'une rep de plus par seance : ' + total.join(','));
  info(n + ' seances pour passer de 3 x 8 a 3 x 12 a 42,5 kg, puis proposition 45 kg / 8 reps');
});

t('RIR reellement saisi : sous le bas de fourchette avec RIR <= 1 -> « trop lourde probable » (information) ; le conseil +1 rep n\'est PAS bloque', () => {
  const l = AVANT().concat([sess(addDays(J0, 15), '42.5x7,42.5x7,42.5x6', '8-12', 1)]);
  const c = conseil(l); assert.strictEqual(c.action, 'ajouter_rep');
  assert.deepStrictEqual([c.apresHausse.sousLeBas, c.apresHausse.evaluation, c.apresHausse.rirUtilise], [true, 'trop_lourde_probable', true]);
  const m = conseil(AVANT().concat([sess(addDays(J0, 15), '42.5x9,42.5x9,42.5x9', '8-12', 4)]));
  assert.strictEqual(m.apresHausse.evaluation, 'marge');
});

t('RIR non saisi (ou saisi sur une partie des series seulement) : jamais invente, aucune conclusion, progression non bloquee', () => {
  const c = conseil(AVANT().concat([sess(addDays(J0, 15), '42.5x7,42.5x7,42.5x6')]));
  assert.deepStrictEqual([c.action, c.apresHausse.evaluation, c.apresHausse.rirUtilise, c.rir.moyen], ['ajouter_rep', 'sous_le_bas', false, null]);
  const l = AVANT().concat([sess(addDays(J0, 15), '42.5x7,42.5x7,42.5x6')]); const s = l[l.length - 1].exercises[0].sets; s[0].rir = 0; s[0].rirSaisi = true;
  assert.deepStrictEqual([conseil(l).apresHausse.evaluation, conseil(l).apresHausse.rirUtilise], ['sous_le_bas', false], 'un seul RIR saisi sur 3 : non utilise');
});

t('Hors hausse de charge (meme charge que la seance precedente) : aucun champ apresHausse ; charge conventionnelle : jamais', () => {
  assert.strictEqual(conseil(AVANT()).apresHausse, undefined);
});

t('Proposition de hausse : la raison annonce le retour au bas de la fourchette puis la remontee', () => {
  const r = E.propositionsAdaptation({ sessions: AVANT(), routines: [{ id: 1, name: 'Push', exercises: [{ name: DC, sets: 3, repsTarget: '8-12' }] }] }, { maintenant: addDays(J0, 13) });
  const p = r.propositions[0]; assert.strictEqual(p.type, 'charge');
  assert.ok(/Tu repartiras à 8 reps, puis tu remonteras vers 12\./.test(p.raison), p.raison);
});

t('Appli : textes affiches (vrai coachConseilAffichage) ; pre-remplissage 42,5 kg + cible 8 a part ; cible enregistree a part, jamais dans les reps faites', () => {
  const ctx = { fmtDate: d => d }; vm.createContext(ctx); vm.runInContext(fnSrc('function coachConseilAffichage(') + '; this.f = coachConseilAffichage;', ctx);
  assert.strictEqual(ctx.f(conseil(AVANT(), { chargeAcceptee: 42.5 })).msg, 'NOUVELLE CHARGE 42.5kg (validée) · vise 8 reps sur chaque série, puis +1 rep par séance jusqu\'à 12 avant la prochaine hausse');
  assert.ok(/S3 : vise 9 rep · 42.5kg$/.test(ctx.f(conseil(AVANT().concat([sess(addDays(J0, 15), '42.5x8,42.5x8,42.5x8')]))).msg));
  assert.ok(/charge est peut-être trop lourde$/.test(ctx.f(conseil(AVANT().concat([sess(addDays(J0, 15), '42.5x7,42.5x7,42.5x6', '8-12', 1)]))).msg));
  assert.ok(/\.\.\.\(chargeCoach !== null \? \{ chargeAcceptee: chargeCoach \} : \{\}\)/.test(SRC), 'charge acceptee transmise a la seance');
  assert.ok(/\.\.\.\(repsCibleCoach !== null \? \{ repsCible: repsCibleCoach \} : \{\}\),\s*\n\s*rir: "", rirCible/.test(SRC), 'cible de reps : champ a part, reps vides');
  assert.ok(/getProgressionTip\(ex\.lastSets, horsActivation\(sessions\), ex\.name, ex\.repsTarget, ex\.sets\.length, ex\.chargeAcceptee\)/.test(SRC));
  assert.ok(/placeholder=\{parseInt\(s\.repsCible\) > 0 \? String\(s\.repsCible\) : \(ref && ref\.reps\)/.test(SRC), 'la cible s\'affiche en indication, la case reste vide');
  const m = SRC.match(/\.map\(s => \(\{ weight: parseFloat\(s\.weight\), reps: parseInt\(s\.reps\),[^\n]*repsCible: parseInt\(s\.repsCible\)[^\n]*done: true \}\)\)/); assert.ok(m, 'enregistrement');
  const sauve = vm.runInContext('(function(sets){ return sets.filter(s => s.weight && s.reps)' + m[0] + '; })', Object.assign(vm.createContext({ parseRir: v => (v === '' || v === null || v === undefined ? null : parseInt(v, 10)) })))(
    [{ weight: '42.5', reps: '9', rir: '', rirCible: 3, repsCible: 8, rirSaisi: false }, { weight: '42.5', reps: '', rir: '', repsCible: 8 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sauve)), [{ weight: 42.5, reps: 9, rir: null, rirSaisi: false, rirCible: 3, repsCible: 8, done: true }], 'reps faites = 9, cible = 8 a part ; serie vide non enregistree');
  // La cible enregistree n'entre dans aucun calcul : memes mesures avec ou sans elle.
  const a = E.mesuresSeance(st('42.5x9,42.5x9').map(E.normaliserSerie)), b = E.mesuresSeance(st('42.5x9,42.5x9').map(s => Object.assign(s, { repsCible: 8 })).map(E.normaliserSerie));
  assert.deepStrictEqual(a, b);
});

t('Autres exercices : une charge acceptee sur un exercice ne change rien au conseil des autres', () => {
  const autre = [{ id: 1, date: J0, exercises: [{ name: 'Rowing', repsTarget: '8-12', sets: st('60x10,60x10,60x10') }, { name: DC, repsTarget: '8-12', sets: st('40x12,40x12,40x12') }] }];
  const hR = E.historiqueExercice(E.normaliserSeances(autre), 'Rowing');
  assert.strictEqual(E.conseilProgression(hR, { fourchette: '8-12', aujourdhui: addDays(J0, 1) }).action, 'ajouter_rep');
});

let ok = 0;
for (const [n, f] of tests) { try { f(); ok++; console.log('OK   ' + n); } catch (e) { console.log('FAIL ' + n + '\n     -> ' + String(e.message || e).split('\n').slice(0, 4).join(' | ')); } }
infos.forEach(s => console.log('       info : ' + s));
console.log('\n' + ok + '/' + tests.length + ' tests passes'); process.exitCode = ok === tests.length ? 0 : 1;
