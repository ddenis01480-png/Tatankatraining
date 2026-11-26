// Lancer : node tests/coach-coherence.test.js
//          EXPORT_FILE=/chemin/export.json node tests/coach-coherence.test.js   (tes vraies seances, lecture seule)
//
// Harmonisation Fin de seance / onglet Progres : les deux ecrans appellent la MEME analyse du moteur (CE.analyseExercice).
// Ce test execute les VRAIES fonctions d'index.html des deux ecrans (coachFinSeance, saveSession, coachProgres) sur les memes
// seances et verifie qu'elles aboutissent au meme resultat : performance de la derniere seance, alerte, indication de plafond,
// comparaison non fiable (avec sa raison), et absence de diagnostic quand les donnees ne sont pas comparables.
const H = require('./_harness.js'); const { SRC, vm, assert, fs, REAL_PROGRAMME } = H;
const E = require('../coach-engine.js');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }

const LIB = [fnSrc('function coachReferenceTexte('), fnSrc('function coachReferenceSeance('), fnSrc('function coachEngine('), fnSrc('function coachA('), fnSrc('function coachHistorique('), fnSrc('function coachConseilAffichage('), fnSrc('function coachDiagAffichage('), fnSrc('function coachEcartTexte('),
  fnSrc('function coachFinSeance('), fnSrc('function coachBilanTexte('), fnSrc('function coachRecordTexte('), fnSrc('function coachRaisonsTexte('), fnSrc('function coachIncompleteTexte('), 'const COACH_RAISONS = ' + literal('const COACH_RAISONS = {', '{', '}') + ';', 'const COACH_UNITES = ' + literal('const COACH_UNITES = {', '{', '}') + ';', 
  fnSrc('function coachProgres('), fnSrc('function coachPlafondProgression('),
  fnSrc('function e1RM('), fnSrc('function fmtDate('), fnSrc('function parseRir('), fnSrc('function analyzeEx('),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  'function makeSave(env) { var currentSets = env.currentSets, sessions = env.sessions, setSessions = env.setSessions, save = env.save, KEYS = env.KEYS, load = env.load,',
  '  lsRemoveNs = function(){}, setSessionRecovered = function(){}, autoBackup = env.autoBackup, setCurrentSets = function(){}, setSeanceStartTime = function(){}, setSeanceElapsed = function(){},',
  '  setRestSec = function(){}, setTimerOn = function(){}, setStagAlert = env.setStagAlert, setPostSeanceModal = env.setPostSeanceModal, today = env.today, alert = env.alert, confirm = function(){ return true; };',
  fnSrc('  function saveSession() {'), ' return saveSession; }',
  'this.makeSave = makeSave; this.coachFinSeance = coachFinSeance; this.coachProgres = coachProgres;'].join('\n');
const ctx = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console, window: { CoachEngine: E, confirm: () => true } };
vm.createContext(ctx); vm.runInContext(LIB, ctx);
const plain = o => JSON.parse(JSON.stringify(o));

const S = (w, r) => ({ weight: w, reps: r, rir: 2, done: true });
const fmt = d => d.slice(8, 10) + '/' + d.slice(5, 7);
const day = i => new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10);
// rows : [['60x10,60x10', '8-12'], ...] ; la DERNIERE ligne est la seance du jour.
const build = rows => rows.map(([txt, rt], k) => ({ id: k + 1, date: day(k), routineId: 1, routineName: 'R', exercises: [{ name: 'Exo', repsTarget: rt || '8-12', sets: txt.split(',').map(y => S(...y.split('x').map(Number))) }] }));

// Les deux ecrans sur les memes seances.
function deuxEcrans(sessions, name) {
  const k = sessions.length - 1, today = sessions[k], past = sessions.slice(0, k), exs = today.exercises.filter(e => e.name === name).slice(0, 1);
  const fin = plain(ctx.coachFinSeance(ctx.window.CoachEngine, past, exs, today.date, today.id));
  const prog = plain(ctx.coachProgres(ctx.window.CoachEngine, sessions, name));
  const cat = fin.progressed.includes(name) ? 'progression' : fin.regressed.includes(name) ? 'regression' : fin.stagnated.includes(name) ? 'stable' : (fin.incompletes || []).includes(name) ? 'seance_incomplete' : fin.nonComparables.includes(name) ? 'non_comparable' : 'premiere';
  const alerteFin = (fin.alerts.find(a => a.exName === name) || {}).title || null;
  const a = prog.analyse, alerteProg = a && a.alerte ? prog.diag.title : null;
  return { fin: { performance: cat, alerte: alerteFin, plafondPositif: / haut de fourchette : augmenter la charge possible$/.test(fin.details[name] || ''), detail: fin.details[name] || null },
    progres: { performance: a ? a.performance : 'premiere', alerte: alerteProg, plafondPositif: !!(a && a.diagnostic && a.diagnostic.enProgression), statut: a ? a.statut : null, carte: prog.diag ? prog.diag.title : null, raison: prog.diag ? prog.diag.msg : null } };
}
const memes = r => { assert.deepStrictEqual([r.fin.performance, r.fin.alerte, r.fin.plafondPositif], [r.progres.performance, r.progres.alerte, r.progres.plafondPositif], 'Fin de seance et Progres different : ' + JSON.stringify(r)); return r; };

const tests = []; const t = (n, f) => tests.push([n, f]); let infos = []; const info = s => infos.push(s);

t('Progression reelle : « en progression » dans les deux ecrans, sans alerte', () => {
  const r = memes(deuxEcrans(build([['60x10,60x10,60x10'], ['60x10,60x10,60x10'], ['60x11,60x10,60x10']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.detail, r.progres.carte], ['progression', '+1 rep à 60kg', 'PROGRESSION OPTIMALE']); });
t('Progression en haut de fourchette (cas Belt squat) : progression + indication « augmenter la charge » dans les deux ecrans, pas d\'alerte', () => {
  const r = memes(deuxEcrans(build([['80x11,80x11,80x12'], ['80x11,80x12,80x12'], ['80x12,80x12,80x12']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.alerte, r.fin.plafondPositif, r.progres.carte], ['progression', null, true, 'PROGRESSION — HAUT DE FOURCHETTE ATTEINT']);
  assert.strictEqual(r.fin.detail, '+1 rep à 80kg · haut de fourchette : augmenter la charge possible'); });
t('Regression reelle (3 seances en baisse a charge egale) : « en baisse » et alerte REGRESSION PERSISTANTE dans les deux ecrans', () => {
  const r = memes(deuxEcrans(build([['80x10,80x10'], ['80x9,80x9'], ['80x8,80x8'], ['80x7,80x7']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.alerte], ['regression', 'REGRESSION PERSISTANTE']); });
t('Changement de fourchette (cas Leg press 8-12 -> 15-20, Leg curl 8-12 -> 10-15) : « non comparable » avec la raison, aucun diagnostic, dans les deux ecrans', () => {
  let r = memes(deuxEcrans(build([['160x11,160x12,160x12'], ['120x15,120x15,120x15', '15-20']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.detail, r.fin.alerte], ['non_comparable', 'Première séance en 15-20 (dernière séance de cet exercice en 8-12, le 01/01) : plages différentes, jamais comparées', null], 'le V1 et le moteur 0.5 affichaient ici « en baisse » ; 0.12.0 : plages differentes jamais comparees');
  r = memes(deuxEcrans(build([['32x10,32x10'], ['32x10,32x10'], ['25x12,25x12,25x11', '10-15']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.progres.statut, r.progres.carte], ['non_comparable', 'non_comparable', "PAS DE DIAGNOSTIC POUR L'INSTANT"]);
  assert.strictEqual(r.progres.raison, 'Première séance en 10-15 (dernière séance de cet exercice en 8-12, le 03/01) : plages différentes, jamais comparées. Le diagnostic reprendra après 2 séances comparables.'); });
t('Rupture de charge (cas Hack squat 160 -> 120 kg, memes reps) : « non comparable » avec la raison, aucune alerte, dans les deux ecrans', () => {
  const r = memes(deuxEcrans(build([['160x10,160x10,160x10', '10-15'], ['160x10,160x10,160x10', '10-15'], ['160x10,160x10,160x11', '10-15'], ['120x10,120x10,120x11', '10-15']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.alerte, r.progres.statut], ['non_comparable', null, 'non_comparable']);
  assert.strictEqual(r.fin.detail, 'Charge 160 → 120kg (−25%) avec les mêmes reps : changement de machine ou de réglage ?');
  const apres = memes(deuxEcrans(build([['160x10,160x10,160x11', '10-15'], ['120x10,120x10,120x11', '10-15'], ['120x10,120x11,120x11', '10-15']]), 'Exo'));
  assert.deepStrictEqual([apres.fin.performance, apres.progres.carte], ['progression', 'PROGRESSION OPTIMALE'], 'des la 2e seance a 120 kg : diagnostic sur le bloc comparable'); });
t('Serie aberrante (cas 6,8 kg x 112) : ignoree pareil dans les deux ecrans, dans l\'historique ET dans la seance du jour', () => {
  let r = memes(deuxEcrans(build([['6.8x12,6.8x112,6.8x12', '12-15'], ['6.8x12,6.8x12,6.8x13', '12-15']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.detail], ['progression', '+13 reps à 6.8kg'], 'sans protection : fausse « baisse » (la serie x112 ignoree, la seance precedente compte 2 series x 12)');
  r = memes(deuxEcrans(build([['20x10,20x10,20x10'], ['20x10,20x100,20x10']]), 'Exo'));
  // Etape 3 (R-P3) : la serie x100 ignoree laisse 2 series analysables contre 3 -> « seance incomplete » (ni progression ni baisse).
  assert.strictEqual(r.fin.performance, 'seance_incomplete', 'faute de frappe du jour (x100) : ni progression ni record');
  const s = build([['20x10,20x10,20x10'], ['20x10,20x100,20x10']]);
  assert.deepStrictEqual(plain(ctx.coachFinSeance(E, s.slice(0, 1), s[1].exercises, s[1].date, 2)).sessionPRs, [], 'pas de faux record'); });
t('Historique insuffisant : premiere seance -> aucun bilan ni diagnostic dans les deux ecrans ; une seule seance avant -> bilan sans alerte', () => {
  let r = memes(deuxEcrans(build([['60x10,60x10']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.progres.statut, r.progres.carte], ['premiere', 'historique_insuffisant', null]);
  r = memes(deuxEcrans(build([['60x10,60x10'], ['60x9,60x9']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.alerte, r.progres.carte], ['regression', null, 'PERFORMANCE EN BAISSE'], 'il faut 3 seances pour une alerte de regression ; la carte ne dit plus « meme performance »'); });
// Carte du diagnostic : coherente avec la ligne Performance.
const CARTE_PERF = { 'CHARGE MAINTENUE': ['stable'], 'PERFORMANCE EN BAISSE': ['regression'], 'LEGERE PROGRESSION': ['progression'], 'PROGRESSION OPTIMALE': ['progression'],
  'PROGRESSION — HAUT DE FOURCHETTE ATTEINT': ['progression'], 'PROGRESSION — HAUT DE FOURCHETTE PRESQUE ATTEINT': ['progression'], 'PROGRESSION TROP RAPIDE': ['progression'],
  'REGRESSION PERSISTANTE': ['regression'], 'STAGNATION — PLAFOND': ['stable', 'regression'], "PAS DE DIAGNOSTIC POUR L'INSTANT": ['non_comparable'], 'SÉANCE INCOMPLÈTE': ['seance_incomplete'] };
// 0.12.0 : apres une interruption de plus de 28 jours, le bilan compare quand meme a la derniere seance (information datee),
// mais aucune alerte n'est tiree d'avant l'interruption : la carte « pas de diagnostic » accompagne alors n'importe quelle performance.
const carteCoherente = r => !r.progres.carte || (CARTE_PERF[r.progres.carte] || []).includes(r.progres.performance)
  || (r.progres.carte === "PAS DE DIAGNOSTIC POUR L'INSTANT" && /^Interruption de \d+ jours/.test(r.progres.raison || ''));
t('Carte « CHARGE MAINTENUE » seulement si la performance est vraiment stable ; en baisse -> « PERFORMANCE EN BAISSE » ; legere hausse -> « LEGERE PROGRESSION »', () => {
  let r = memes(deuxEcrans(build([['60x10,60x10'], ['60x10,60x10']]), 'Exo'));
  assert.deepStrictEqual([r.progres.performance, r.progres.carte, r.progres.raison], ['stable', 'CHARGE MAINTENUE', 'Meme performance que la seance precedente.']);
  r = memes(deuxEcrans(build([['60x10,60x10'], ['60x9,60x9']]), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.progres.performance, r.progres.carte, r.progres.raison],
    ['regression', 'regression', 'PERFORMANCE EN BAISSE', '−2 reps a 60kg depuis la derniere seance. Une seule seance en baisse : pas encore une regression persistante.']);
  r = memes(deuxEcrans(build([['60x10,60x10'], ['57.5x10,57.5x10']]), 'Exo'));
  assert.deepStrictEqual([r.progres.carte, r.progres.raison.split(' depuis')[0]], ['PERFORMANCE EN BAISSE', 'Charge −2.5kg']);
  r = memes(deuxEcrans(build([['22.5x8,22.5x8'], ['22.5x9,22.5x7']]), 'Exo'));
  assert.deepStrictEqual([r.progres.performance, r.progres.carte, r.progres.raison], ['progression', 'LEGERE PROGRESSION', 'Force estimee +0.8kg depuis la derniere seance.'], '+0,75 kg de force : invisible une fois arrondi, le V1 disait « meme performance »');
  r = memes(deuxEcrans(build([['20x13,20x13', '10-15'], ['20x12,20x12', '10-15']]), 'Exo'));
  assert.deepStrictEqual([r.progres.carte, r.progres.raison.split(' depuis')[0]], ['PERFORMANCE EN BAISSE', '−2 reps a 20kg'], 'mode repetitions (10-15)'); });
t('Saisies probablement inversees (cas reels Tractions 6 x 80 et 7 x 80, Extension triceps 12 x 32) : exclues des graphiques, force, records et comparaisons ; visibles avec l\'avertissement ; donnees intactes ; les deux ecrans d\'accord', () => {
  const deepFreeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const tr = build([['6x80,6x80,6x80'], ['6x80,6x80,7x80'], ['80x8,80x8,80x8'], ['80x8,80x8,80x9']]); const avant = JSON.stringify(tr); deepFreeze(tr);
  const p = plain(ctx.coachProgres(E, tr, 'Exo'));
  assert.deepStrictEqual(p.history.map(h => [h.date, h.analysee, h.sets.map(x => x.suspecte)[0]]), [[day(0), false, 'inversion_probable'], [day(1), false, 'inversion_probable'], [day(2), true, null], [day(3), true, null]], 'visibles dans l\'historique');
  assert.deepStrictEqual(p.chartData.map(c => [c.date, c.rm, c.charge]), [[fmt(day(2)), 101, 80], [fmt(day(3)), 104, 80]], 'graphique et force : seulement les seances fiables');
  assert.ok(SRC.includes('⚠ saisie probablement inversée (charge ↔ reps) · ignorée par l\'analyse, non modifiée'), 'avertissement affiche');
  let r = memes(deuxEcrans(tr.slice(0, 3), 'Exo'));
  assert.deepStrictEqual([r.fin.performance, r.fin.alerte], ['premiere', null], 'plus de faux « charge +73kg » ni « PROGRESSION TROP RAPIDE » le 08/06');
  assert.deepStrictEqual(plain(ctx.coachFinSeance(E, tr.slice(0, 2), tr[2].exercises, tr[2].date, 3)).sessionPRs, [], 'pas de faux record « charge max 80kg » contre 7 kg');
  r = memes(deuxEcrans(tr.slice(0, 2), 'Exo')); assert.strictEqual(r.fin.performance, 'premiere', 'le 30/05 : plus de faux « trop rapide » 6 -> 7 kg');
  assert.deepStrictEqual(plain(ctx.coachFinSeance(E, tr.slice(0, 1), tr[1].exercises, tr[1].date, 2)).sessionPRs, [], 'pas de faux record « charge max 7kg »');
  r = memes(deuxEcrans(tr, 'Exo')); assert.deepStrictEqual([r.fin.performance, r.fin.detail], ['progression', '+1 rep à 80kg']);
  assert.strictEqual(JSON.stringify(tr), avant, 'seances enregistrees intactes');
  const tri = build([['12x32,12x32,12x32', '12-15'], ['32x12,32x12,32x12', '12-15']]);
  r = memes(deuxEcrans(tri, 'Exo')); assert.deepStrictEqual([r.fin.performance, r.fin.detail], ['premiere', null], 'plus de fausse progression « charge +20kg » le 26/03');
  assert.deepStrictEqual(plain(ctx.coachProgres(E, tri, 'Exo')).chartData.map(c => c.charge), [32]);
  const le = build([['47.5x10,47.5x10', '15-20'], ['15x32,15x32,15x32', '15-20'], ['15x35,15x35,15x35', '15-20']]);
  assert.ok(plain(ctx.coachProgres(E, le, 'Exo')).history.every(h => h.analysee && h.sets.every(x => !x.suspecte)), 'Leg extension 15 x 32 / 15 x 35 (non confirme) : regle NON appliquee'); });
t('Ecran Fin de seance reel (saveSession) : la rubrique « ≠ NON COMPARABLE » recoit l\'exercice et sa raison ; l\'enregistrement ne change pas', () => {
  const sessions = build([['160x11,160x12,160x12']]);
  const out = {}; const env = { currentSets: { routineId: 1, routineName: 'R', exercises: [{ name: 'Exo', repsTarget: '15-20', sets: [1, 2, 3].map(() => ({ weight: '120', reps: '15', rir: '', done: true })) }] },
    sessions, today: () => day(1), KEYS: { sessions: 'k' }, setSessions: v => { out.saved = v; }, save: () => {}, load: () => null, autoBackup: () => {}, setStagAlert: a => { out.alert = a; }, setPostSeanceModal: m => { out.modal = m; }, alert: () => {} };
  const before = JSON.stringify(sessions); ctx.makeSave(env)(); const m = plain(out.modal);
  assert.deepStrictEqual([m.nonComparables, m.details.Exo, m.regressed, m.progressed], [['Exo'], 'Première séance en 15-20 (dernière séance de cet exercice en 8-12, le 01/01) : plages différentes, jamais comparées', [], []]);
  assert.strictEqual(JSON.stringify(sessions), before); assert.strictEqual(out.saved.length, 2);
  assert.ok(SRC.includes('≠ NON COMPARABLE ({postSeanceModal.nonComparables.length})'), 'rubrique affichee dans la fenetre de fin de seance'); });
t('Une seule regle : les deux ecrans passent par CE.analyseExercice (pas de diagnostic calcule a part)', () => {
  const fin = fnSrc('function coachFinSeance('), prog = fnSrc('function coachProgres(');
  [fin, prog].forEach(src => { assert.ok(src.includes('CE.analyseExercice('), 'analyse unique'); assert.ok(!/CE\.diagnostiquer\(|CE\.blocComparable\(|CE\.comparer\(/.test(src), 'pas de regle locale'); }); });

const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Donnees reelles : chaque exercice de chaque seance, rejoue en Fin de seance et dans l\'onglet Progres -> meme resultat ; export non modifie', () => {
  const before = JSON.stringify(EXP); const ss = [...EXP.sessions].sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id);
  let n = 0, ecarts = [], ecartsCarte = []; const tally = {}, alertes = {};
  ss.forEach((s, k) => { const names = [...new Set((s.exercises || []).filter(e => (e.sets || []).some(st => st.weight && st.reps)).map(e => e.name))];
    names.forEach(nm => { const r = deuxEcrans(ss.slice(0, k + 1), nm); n++;
      if (JSON.stringify([r.fin.performance, r.fin.alerte, r.fin.plafondPositif]) !== JSON.stringify([r.progres.performance, r.progres.alerte, r.progres.plafondPositif])) ecarts.push(s.date + ' ' + nm + ' ' + JSON.stringify(r));
      if (!carteCoherente(r)) ecartsCarte.push(s.date + ' ' + nm + ' : ' + r.progres.carte + ' / ' + r.progres.performance);
      tally[r.fin.performance] = (tally[r.fin.performance] || 0) + 1; if (r.fin.alerte) alertes[r.fin.alerte] = (alertes[r.fin.alerte] || 0) + 1; }); });
  assert.strictEqual(JSON.stringify(EXP), before, 'export non modifie');
  assert.deepStrictEqual(ecarts.slice(0, 3), [], ecarts.length + ' ecart(s)');
  assert.deepStrictEqual(ecartsCarte.slice(0, 3), [], ecartsCarte.length + ' carte(s) incoherente(s) avec la ligne Performance');
  const inv = []; [...new Set(ss.flatMap(x => (x.exercises || []).map(e => e.name)))].forEach(nm => plain(ctx.coachProgres(E, ss, nm)).history.forEach(h => { if (h.sets.some(x => x.suspecte === 'inversion_probable')) inv.push(nm + ' ' + h.date); }));
  assert.deepStrictEqual(inv.sort(), ['Extension triceps overhead câble 2026-03-19', 'Tractions lestées prise large 2026-05-22', 'Tractions lestées prise large 2026-05-30'], 'exactement les 3 seances signalees, pas la Leg extension');
  info('cartes coherentes avec la ligne Performance : ' + (n - ecartsCarte.length) + '/' + n + ' ; saisies probablement inversees : ' + inv.join(', '));
  info(n + ' analyses (exercice x seance) : resultat identique dans les deux ecrans ' + (n - ecarts.length) + '/' + n);
  info('performance : ' + JSON.stringify(tally)); info('alertes : ' + JSON.stringify(alertes)); });

(async () => { let fail = 0;
  console.log('Moteur v' + E.VERSION + ' — coherence Fin de seance / onglet Progres (vraies fonctions d\'index.html)' + (EXP ? ' | donnees reelles : ' + REAL : ''));
  for (const [n, f] of tests) { infos = []; try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0].slice(0, 600)); } infos.forEach(s => console.log('       info : ' + s)); }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
