// Lancer : node tests/coach-integration.test.js
//
// Op. 4 — branchement du moteur (coach-engine.js) dans index.html, ecran par ecran.
// Execute le VRAI code d'index.html deux fois : sans moteur (repli V1) et avec le moteur charge (window.CoachEngine),
// puis compare. Les differences attendues (incoherences V1 corrigees) sont testees a part et listees.
// Ecran branche a cette etape : Seance en cours (conseil de progression, badge de force, alerte de stagnation).
const H = require('./_harness.js'); const { SRC, vm, assert, REAL_PROGRAMME } = H;
const E = require('../coach-engine.js');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }

const CODE = [fnSrc('function coachEngine('), fnSrc('function coachHistorique('), fnSrc('function coachConseilAffichage('), fnSrc('function coachDiagAffichage('),
  fnSrc('function e1RM('), fnSrc('function parseRir('), fnSrc('function analyzeEx('), fnSrc('function getProgressionTip('),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  'this.api = { coachEngine, coachHistorique, coachConseilAffichage, coachDiagAffichage, e1RM, analyzeEx, getProgressionTip, normalizeExName };'].join('\n');
function load(withEngine) { const ctx = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console };
  if (withEngine) ctx.window = { CoachEngine: E }; vm.createContext(ctx); vm.runInContext(CODE, ctx); ctx.api.ctx = ctx; return ctx.api; }
const V1 = load(false), V2 = load(true);

// checkStagnation : la VRAIE fonction de l'ecran Seance, avec ses dependances.
function stagnation(api, sessions, current, exName, newSets, todayStr) { let alert = null;
  const f = vm.runInContext('(function(currentSets, sessions, setStagAlert, today){ ' + fnSrc('function checkStagnation(') + ' return checkStagnation; })', api.ctx)(current, sessions, a => { alert = a; }, () => todayStr);
  f(exName, newSets); return alert; }

const S = (w, r, rir) => ({ weight: w, reps: r, rir: rir === undefined ? 2 : rir, done: true });
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const day = i => new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function genHist(r, n, lo, hi) { const out = []; let w = 20 + Math.round(r() * 80);
  for (let i = 0; i < n; i++) { if (r() < 0.25) w = Math.max(5, w + (r() < 0.6 ? 2.5 : -2.5)); const nb = 2 + Math.floor(r() * 3);
    out.push({ date: day(i), sets: Array.from({ length: nb }, () => S(w, lo + Math.floor(r() * (hi - lo + 1)), Math.floor(r() * 5))) }); } return out; }

const tests = []; const t = (n, f) => tests.push([n, f]); let infos = []; const info = s => infos.push(s);

t('Moteur charge : coachEngine() le trouve ; sans moteur : null (l\'appli garde le V1)', () => { assert.strictEqual(V2.coachEngine(), E); assert.strictEqual(V1.coachEngine(), null); });
t('index.html n\'appelle que des fonctions de LECTURE du moteur (aucune ecriture possible)', () => {
  const calls = [...new Set([...SRC.matchAll(/\bCE(?:fin)?\.(\w+)/g)].map(m => m[1]))].sort();
  const allowed = ['bilanExercice', 'syntheseExercice', 'recordsExercice', 'trierSeances', 'comparer', 'conseilProgression', 'diagnostiquer', 'historiqueExercice', 'lireFourchette', 'mesuresSeance', 'normaliserSeances', 'normaliserSerie', 'analyser'];
  calls.forEach(c => assert.ok(allowed.includes(c), 'appel non prevu : CE.' + c)); info('fonctions du moteur utilisees : ' + calls.join(', ')); });

// ── Conseil de progression (encadre au-dessus des series) ──
t('Conseil : meme texte, couleur et icone que le V1 sur 4 000 cas (fourchettes <= 12 sur plusieurs seances ; toutes fourchettes sur 1 seance)', () => {
  const r = rng(99); const ranges = ['8-12', '6-10', '10-12', '8-10', '12', '10-15', '15-20', '20', '30-50', '100', '45-60s', undefined]; let n = 0;
  for (let i = 0; i < 4000; i++) { const rt = ranges[Math.floor(r() * ranges.length)]; const f = E.lireFourchette(rt);
    const multi = f.type === 'reps' && f.max <= 12; const hi = f.type === 'reps' ? (multi ? 12 : f.max + 1) : 15, lo = f.type === 'reps' ? Math.max(1, f.min - 2) : 5;
    const h = genHist(r, multi ? 1 + Math.floor(r() * 5) : 1, lo, hi); const sessions = h.map((x, k) => sess(k + 1, x.date, [{ name: 'Exo test', repsTarget: rt, sets: x.sets }]));
    const last = h[h.length - 1].sets; const a = V1.getProgressionTip(last, sessions, 'Exo test', rt), b = V2.getProgressionTip(last, sessions, 'Exo test', rt, 3);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), 'cas ' + i + ' (' + rt + ')'); n++; }
  info(n + ' cas identiques'); });
t('Conseil — difference voulue : series prevues lues dans la seance en cours (ta routine), plus dans le programme code en dur', () => {
  const name = 'Développé couché haltères'; assert.strictEqual(REAL_PROGRAMME.flatMap(r => r.exercises).find(e => e.name === name).sets, 3);
  const sessions = [sess(1, day(0), [{ name, repsTarget: '8-12', sets: [S(30, 10), S(30, 10)] }])];
  assert.ok(V1.getProgressionTip(sessions[0].exercises[0].sets, sessions, name, '8-12').msg.includes('série non faite'), 'V1 : S3 « non faite » (programme code en dur)');
  const b = V2.getProgressionTip(sessions[0].exercises[0].sets, sessions, name, '8-12', 2); assert.ok(!b.msg.includes('non faite'), b.msg); assert.ok(/^S2 : vise 11/.test(b.msg) || /^S\d/.test(b.msg)); });
t('Conseil — difference voulue (10-15) : diagnostic en repetitions/charge au lieu de la force estimee ; ecarts comptes', () => {
  const r = rng(5); let diff = 0, n = 0; const ex = [];
  for (let i = 0; i < 1500; i++) { const h = genHist(r, 2 + Math.floor(r() * 4), 8, 16); const sessions = h.map((x, k) => sess(k + 1, x.date, [{ name: 'Exo test', repsTarget: '10-15', sets: x.sets }]));
    const last = h[h.length - 1].sets; const a = V1.getProgressionTip(last, sessions, 'Exo test', '10-15'), b = V2.getProgressionTip(last, sessions, 'Exo test', '10-15', 3); n++;
    if (a.msg !== b.msg) { diff++; if (ex.length < 2) ex.push('V1 « ' + a.msg + ' » / V2 « ' + b.msg + ' »'); assert.ok(/Régression|Progression rapide/.test(a.msg + b.msg), 'seuls les avertissements de diagnostic peuvent changer : ' + a.msg + ' / ' + b.msg); } }
  info(diff + ' / ' + n + ' cas differents (avertissements « progression rapide » / « regression » recalcules en reps et charge)' + (ex.length ? ' ; ex. ' + ex.join(' ; ') : '')); });
t('Conseil : historique trie par date avant l\'analyse (resultat independant de l\'ordre des seances)', () => {
  const sessions = [60, 60, 60].map((w, i) => sess(i + 1, day(i), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(w, 10 - i), S(w, 10 - i), S(w, 10 - i)] }]));
  const last = sessions[2].exercises[0].sets; const shuffled = [sessions[2], sessions[0], sessions[1]];
  assert.deepStrictEqual(V2.getProgressionTip(last, shuffled, 'Exo test', '8-12', 3), V2.getProgressionTip(last, sessions, 'Exo test', '8-12', 3));
  assert.ok(V2.getProgressionTip(last, sessions, 'Exo test', '8-12', 3).msg.startsWith('Régression')); });

// ── Diagnostic (texte des alertes) ──
t('Alertes : en mode force, le texte du diagnostic du moteur = celui du V1 (analyzeEx) sur 3 000 historiques', () => {
  const r = rng(11); for (let i = 0; i < 3000; i++) { const h = genHist(r, 2 + Math.floor(r() * 6), 6, 12); const a = V1.analyzeEx(h);
    const b = V2.coachDiagAffichage(E.diagnostiquer(h.map(x => ({ date: x.date, series: x.sets.map(E.normaliserSerie) })), E.lireFourchette('8-12')));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), 'cas ' + i); } });
t('Alertes en mode repetitions (10-15) : textes en reps et en charge, jamais « 1RM »', () => {
  const h = (...ss) => ss.map((x, i) => ({ date: day(i), series: x.map(([w, k]) => E.normaliserSerie(S(w, k))) })); const f = E.lireFourchette('10-15');
  const p = V2.coachDiagAffichage(E.diagnostiquer(h([[20, 15], [20, 14]], [[20, 15], [20, 14]], [[20, 15], [20, 15]]), f)); assert.strictEqual(p.title, 'STAGNATION — PLAFOND'); assert.ok(!p.msg.includes('1RM') && p.msg.includes('20kg'), p.msg);
  const g = V2.coachDiagAffichage(E.diagnostiquer(h([[20, 13], [20, 13]], [[20, 14], [20, 14]]), f)); assert.ok(g.msg.includes('+2 rep(s) a 20kg'), g.msg);
  const c = V2.coachDiagAffichage(E.diagnostiquer(h([[20, 15], [20, 15]], [[22.5, 11], [22.5, 10]]), f)); assert.ok(c.msg.includes('+2.5kg de charge'), c.msg);
  const rg = V2.coachDiagAffichage(E.diagnostiquer(h([[20, 15], [20, 15]], [[20, 13], [20, 13]], [[20, 11], [20, 11]]), f)); assert.ok(rg.msg.startsWith('Moins de repetitions'), rg.msg); });

// ── Alerte de stagnation pendant la seance (checkStagnation) ──
t('Alerte pendant la seance : meme decision que le V1 sur 3 000 cas en mode force (alerte ou non, et laquelle)', () => {
  const r = rng(77); let alerts = 0, same = 0; const diffs = [];
  for (let i = 0; i < 3000; i++) { const h = genHist(r, 3 + Math.floor(r() * 5), 6, 12); const past = h.slice(0, -1), cur = h[h.length - 1];
    const sessions = past.map((x, k) => sess(k + 1, x.date, [{ name: 'Exo test', repsTarget: '8-12', sets: x.sets }]));
    const current = { exercises: [{ name: 'Exo test', repsTarget: '8-12', sets: cur.sets }] };
    const a = stagnation(V1, sessions, current, 'Exo test', cur.sets, cur.date), b = stagnation(V2, sessions, current, 'Exo test', cur.sets, cur.date);
    const ka = a ? a.title : null, kb = b ? b.title : null; if (a) alerts++;
    if (ka === kb) { same++; if (a) assert.deepStrictEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a))); }
    else diffs.push({ i, ka, kb, msg: b && b.msg, hist: h.map(x => x.date + ' ' + x.sets.map(s => s.weight + 'x' + s.reps).join(',')), prev: past[past.length - 1].sets.map(s => s.weight + 'x' + s.reps).join(','), cur: cur.sets.map(s => s.weight + 'x' + s.reps).join(',') }); }
  if (process.env.DETAIL) diffs.forEach(d => console.log(JSON.stringify(d)));
  // Differences admises, toutes dues aux definitions de « progression reelle » propres a cette alerte V1 :
  //   (a) force calculee NON arrondie (2e formule du V1) ; (b) « plus de reps au total » meme avec une charge PLUS LEGERE.
  // Le moteur applique sa definition unique : plus de reps ne compte que si la charge est egale ou plus lourde.
  let fa = 0, fb = 0;
  diffs.forEach(d => { const prev = d.prev.split(',').map(x => x.split('x').map(Number)), cur = d.cur.split(',').map(x => x.split('x').map(Number));
    const raw = a => Math.max(...a.map(([w, k]) => w * (1 + k / 30))), rnd = a => Math.max(...a.map(([w, k]) => E.e1RM(w, k)));
    const reps = a => a.reduce((x, [, k]) => x + k, 0), cmax = a => Math.max(...a.map(([w]) => w));
    if (raw(cur) > raw(prev) && rnd(cur) <= rnd(prev)) fa++; else if (reps(cur) > reps(prev) && cmax(cur) < cmax(prev)) fb++;
    else assert.fail('difference inattendue : ' + JSON.stringify(d)); assert.ok(d.ka === null && d.kb !== null, 'le moteur ne retire jamais une alerte du V1, il peut seulement en ajouter : ' + JSON.stringify(d)); });
  info(same + ' / 3000 identiques (' + alerts + ' alertes V1) ; ' + diffs.length + ' alerte(s) en plus : ' + fa + ' (force non arrondie du V1), ' + fb + ' (plus de reps mais charge plus legere)'); });

// Les 5 cas ou l'etape 1 (014c45e) declenchait une alerte que le V1 ne montrait pas — fixes, avec la conclusion de l'analyse.
const CINQ = [
  { cas: 937, attendu: null, pourquoi: 'faux positif corrige : 98x9 vs 100,5x8 = meme force (127,4 vs 127,3) ; l\'arrondi au kg cachait l\'egalite', hist: ['98x6,98x9,98x12', '98x10,98x7,98x10,98x11', '98x7,98x12,98x9,98x7', '100.5x7,100.5x6,100.5x8', '98x9,98x7'] },
  { cas: 1315, attendu: null, pourquoi: 'faux positif corrige : a 22,5 kg la meilleure serie passe de 8 a 9 reps (+0,75 kg de force, invisible une fois arrondi)', hist: ['25x7,25x12', '25x10,25x10,25x6', '22.5x6,22.5x8,22.5x7,22.5x6', '22.5x9,22.5x8,22.5x7'] },
  { cas: 1009, attendu: 'STAGNATION — PLAFOND', pourquoi: 'plafond reel : force 128-131 sur 3 seances, reps en haut de fourchette ; plus de reps seulement parce que la charge a baisse', hist: ['96x8,96x7', '96x10,96x8,96x7', '96x10,96x6,96x9,96x9', '96x6,96x11', '93.5x10,93.5x11,93.5x11'] },
  { cas: 2248, attendu: 'STAGNATION — PLAFOND', pourquoi: 'plafond reel : force 116-117 sur 3 seances ; charge redescendue de 85,5 a 83 kg, series en plus', hist: ['83x7,83x12,83x9,83x7', '85.5x11,85.5x9', '83x10,83x12,83x12,83x10'] },
  { cas: 2250, attendu: 'STAGNATION — PLAFOND', pourquoi: 'plafond reel : force 120 sur 3 seances ; charge redescendue de 88 a 85,5 kg', hist: ['88x10,88x11,88x11', '88x11,88x11,88x9,88x8', '85.5x12,85.5x11,85.5x12,85.5x7'] }];
t('Les 5 alertes en plus de l\'etape 1 : 2 faux positifs (arrondi) corriges, 3 plafonds reels gardes (le V1 les masquait car plus de reps avec une charge plus legere)', () => {
  CINQ.forEach(c => { const h = c.hist.map((x, k) => ({ date: day(k), sets: x.split(',').map(y => { const [w, r] = y.split('x').map(Number); return S(w, r); }) }));
    const past = h.slice(0, -1), cur = h[h.length - 1]; const sessions = past.map((x, k) => sess(k + 1, x.date, [{ name: 'Exo test', repsTarget: '8-12', sets: x.sets }]));
    const current = { exercises: [{ name: 'Exo test', repsTarget: '8-12', sets: cur.sets }] };
    const a = stagnation(V1, sessions, current, 'Exo test', cur.sets, cur.date), b = stagnation(V2, sessions, current, 'Exo test', cur.sets, cur.date);
    assert.strictEqual(a, null, 'cas ' + c.cas + ' : le V1 ne montrait rien'); assert.strictEqual(b ? b.title : null, c.attendu, 'cas ' + c.cas);
    info('cas ' + c.cas + ' -> ' + (c.attendu || 'plus d\'alerte') + ' : ' + c.pourquoi); }); });

// ── Badge de force (a cote de « Derniere fois ») ──
t('Badge de force : meme valeur que le V1 ; « ≈ » ajoute quand la meilleure serie depasse 12 reps (estimation peu fiable)', () => {
  const badge = (api, lastSets) => vm.runInContext('(function(ex){ return ' + SRC.slice(SRC.indexOf('{(() => { const CE = coachEngine(); if (!CE) return "1RM "') + 1, SRC.indexOf('})()}', SRC.indexOf('{(() => { const CE = coachEngine(); if (!CE) return "1RM "')) + 4) + '; })', api.ctx)({ lastSets });
  assert.strictEqual(badge(V1, [S(100, 10), S(100, 8)]), '1RM 133kg'); assert.strictEqual(badge(V2, [S(100, 10), S(100, 8)]), '1RM 133kg');
  assert.strictEqual(badge(V2, [S(20, 15), S(20, 14)]), '1RM ≈' + E.e1RM(20, 15) + 'kg'); assert.strictEqual(badge(V1, [S(20, 15), S(20, 14)]), '1RM ' + E.e1RM(20, 15) + 'kg'); });

// ── Garde-fous ──
t('Le branchement ne modifie ni les seances ni les series recues (donnees gelees)', () => {
  const fz = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(fz); } return o; };
  const sessions = fz([sess(1, day(0), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(50, 8), S(50, 8)] }]), sess(2, day(1), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(50, 9), S(50, 8)] }])]);
  const before = JSON.stringify(sessions); V2.getProgressionTip(sessions[1].exercises[0].sets, sessions, 'Exo test', '8-12', 2);
  const current = fz({ exercises: [{ name: 'Exo test', repsTarget: '8-12', sets: [S(50, 9), S(50, 9)] }] }); stagnation(V2, sessions, current, 'Exo test', current.exercises[0].sets, day(2));
  assert.strictEqual(JSON.stringify(sessions), before); });
t('Seances : les noms differents restent des historiques distincts (aucune fusion, aucun renommage des anciennes donnees)', () => {
  const sessions = [sess(1, day(0), [{ name: 'Curl câble unilatéral face poulie', repsTarget: '10-12', sets: [S(10, 12), S(10, 12), S(10, 12)] }]),
    sess(2, day(1), [{ name: 'Curl câble unilatéral face poulie v2', repsTarget: '10-12', sets: [S(10, 10), S(10, 10), S(10, 10)] }])];
  assert.strictEqual(V2.coachHistorique(E, sessions, 'Curl câble unilatéral face poulie v2').length, 1); assert.strictEqual(V2.coachHistorique(E, sessions, 'Curl câble unilatéral face poulie').length, 1); });

// ── Export reel (lecture seule) : ce que tu verrais a ta prochaine seance, V1 contre moteur ──
const REAL = process.env.EXPORT_FILE; const EXP = REAL && H.fs.existsSync(REAL) ? JSON.parse(H.fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Export reel : conseil affiche a la prochaine seance pour chaque exercice des routines, V1 contre moteur (differences listees)', () => {
  const before = JSON.stringify(EXP); const ss = EXP.sessions; const diffs = []; let n = 0;
  (EXP.routines || []).forEach(rt => (rt.exercises || []).forEach(ex => {
    const lastS = [...ss].reverse().find(s => s.exercises && s.exercises.some(e => e.name === ex.name)); if (!lastS) return;
    const lastSets = lastS.exercises.find(e => e.name === ex.name).sets.filter(st => st.weight && st.reps); if (!lastSets.length) return; n++;
    const a = V1.getProgressionTip(lastSets, ss, ex.name, ex.repsTarget), b = V2.getProgressionTip(lastSets, ss, ex.name, ex.repsTarget, ex.sets || 3);
    if ((a && a.msg) !== (b && b.msg)) diffs.push(rt.name + ' / ' + ex.name + ' (' + ex.repsTarget + ', ' + (ex.sets || 3) + ' series) : V1 « ' + (a && a.msg) + ' » -> moteur « ' + (b && b.msg) + ' »'); }));
  assert.strictEqual(JSON.stringify(EXP), before, 'export non modifie');
  info(n + ' exercices de routine ; ' + (n - diffs.length) + ' conseils identiques ; ' + diffs.length + ' differents' + (diffs.length ? ' :\n         - ' + diffs.join('\n         - ') : '')); });

if (EXP) t('Export reel : alerte de stagnation rejouee seance par seance (chaque exercice de chaque seance, comme si tu validais tes series), V1 contre moteur', () => {
  const ss = [...EXP.sessions].sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id); let n = 0, alertsV1 = 0, alertsV2 = 0; const diffs = [];
  ss.forEach((cur, k) => { const past = ss.slice(0, k); (cur.exercises || []).forEach(ex => { const sets = (ex.sets || []).filter(st => st.weight && st.reps); if (!sets.length) return; n++;
    const current = { exercises: [{ name: ex.name, repsTarget: ex.repsTarget, sets }] };
    const a = stagnation(V1, past, current, ex.name, sets, cur.date), b = stagnation(V2, past, current, ex.name, sets, cur.date); if (a) alertsV1++; if (b) alertsV2++;
    if ((a && a.title) !== (b && b.title)) diffs.push(cur.date + ' ' + ex.name + ' : V1 ' + (a ? a.title : 'aucune') + ' / moteur ' + (b ? b.title + ' (' + b.msg + ')' : 'aucune')); }); });
  info(n + ' validations rejouees ; alertes V1 ' + alertsV1 + ', moteur ' + alertsV2 + ' ; ' + diffs.length + ' difference(s)' + (diffs.length ? ' :\n         - ' + diffs.join('\n         - ') : '')); });

(async () => { let fail = 0;
  console.log('Moteur v' + E.VERSION + ' branche sur : Seance en cours (conseil, badge de force, alerte de stagnation)');
  for (const [n, f] of tests) { infos = []; try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0].slice(0, 500)); } infos.forEach(s => console.log('       info : ' + s)); }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
