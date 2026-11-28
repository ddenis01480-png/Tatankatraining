// Lancer : node tests/coach-fin-seance.test.js
//          EXPORT_FILE=/chemin/export.json node tests/coach-fin-seance.test.js   (rejoue tes vraies seances, lecture seule)
//
// Op. 4 etape 2 — ecran Fin de seance branche sur le moteur.
// Execute la VRAIE fonction saveSession() d'index.html (bouton « Terminer la seance ») avec de fausses dependances
// (stockage en memoire, pas de cloud), deux fois : sans moteur (V1) et avec moteur (window.CoachEngine). Compare ce qui
// est ENREGISTRE (doit etre identique) et ce qui est AFFICHE (alertes, bilan, records).
const H = require('./_harness.js'); const { SRC, vm, assert, fs, REAL_PROGRAMME } = H;
const E = require('../coach-engine.js');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }

const LIB = [fnSrc('function coachReferenceTexte('), fnSrc('function coachReferenceSeance('), fnSrc('function fmtDate('), fnSrc('function coachEngine('), fnSrc('function coachA('), fnSrc('function coachHistorique('), fnSrc('function coachConseilAffichage('), fnSrc('function coachDiagAffichage('), fnSrc('function coachEcartTexte('),
  fnSrc('function estActivation('), fnSrc('function horsActivation('), fnSrc('function coachFinSeance('), fnSrc('function coachBilanTexte('), fnSrc('function coachRaisonsTexte('), fnSrc('function coachIncompleteTexte('), 'const COACH_RAISONS = ' + literal('const COACH_RAISONS = {', '{', '}') + ';', 'const COACH_UNITES = ' + literal('const COACH_UNITES = {', '{', '}') + ';',  fnSrc('function coachRecordTexte('),
  fnSrc('function e1RM('), fnSrc('function parseRir('), fnSrc('function analyzeEx('),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  // saveSession reel, dans une fabrique qui recoit l'etat et les fonctions de l'ecran
  'function makeSave(env) { var currentSets = env.currentSets, sessions = env.sessions, setSessions = env.setSessions, save = env.save, KEYS = env.KEYS, load = env.load,',
  '  lsRemoveNs = function(){}, setSessionRecovered = function(){}, autoBackup = env.autoBackup, setCurrentSets = function(){}, setSeanceStartTime = function(){}, setSeanceElapsed = function(){},',
  '  setRestSec = function(){}, setTimerOn = function(){}, setStagAlert = env.setStagAlert, setPostSeanceModal = env.setPostSeanceModal, today = env.today, alert = env.alert, confirm = function(){ return true; };',
  fnSrc('  function saveSession() {'), ' return saveSession; }', 'this.makeSave = makeSave; this.coachFinSeance = coachFinSeance;'].join('\n');
function load(withEngine) { const ctx = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console };
  ctx.window = withEngine ? { CoachEngine: E, confirm: () => true } : { confirm: () => true }; vm.createContext(ctx); vm.runInContext(LIB, ctx); return ctx; }
const V1 = load(false), V2 = load(true);
const plain = o => JSON.parse(JSON.stringify(o));

// Termine une seance : retourne ce qui a ete enregistre et ce qui a ete affiche.
function finish(ctx, sessions, current, todayStr) {
  const out = { saved: null, alert: null, modal: null, backups: 0, alerts: [] };
  const env = { currentSets: current, sessions, today: () => todayStr, KEYS: { sessions: 'k', routines: 'r', cycle: 'c', supps: 's', fatigue: 'f' },
    setSessions: v => { out.saved = v; }, save: () => {}, load: () => null, autoBackup: () => { out.backups++; },
    setStagAlert: a => { out.alert = a; }, setPostSeanceModal: m => { out.modal = m; }, alert: m => { out.alertMsg = m; } };
  ctx.makeSave(env)(); return plain(out); }

const S = (w, r, rir, x) => Object.assign({ weight: w, reps: r, rir: rir === undefined ? 2 : rir, done: true }, x || {});
const sess = (id, date, exs, routineId) => ({ id, date, routineId: routineId || 1, routineName: 'R', exercises: exs });
const day = i => new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10);
const cur = exs => ({ routineId: 1, routineName: 'R', exercises: exs.map(e => ({ name: e.name, repsTarget: e.repsTarget, sets: e.sets.map(s => Object.assign({ done: true }, s, { weight: String(s.weight), reps: String(s.reps), rir: s.rir === undefined || s.rir === null ? '' : String(s.rir) })) })) });
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function genHist(r, n, lo, hi) { const out = []; let w = 20 + Math.round(r() * 80);
  for (let i = 0; i < n; i++) { if (r() < 0.25) w = Math.max(5, w + (r() < 0.6 ? 2.5 : -2.5)); const nb = 2 + Math.floor(r() * 3);
    out.push({ date: day(i), sets: Array.from({ length: nb }, () => S(w, lo + Math.floor(r() * (hi - lo + 1)), Math.floor(r() * 5))) }); } return out; }

const tests = []; const t = (n, f) => tests.push([n, f]); let infos = []; const info = s => infos.push(s);

// ── 1. Ce qui est ENREGISTRE ne change pas ──
t('ENREGISTREMENT identique avec ou sans moteur (seances, RIR cible et RIR reel separes) ; aucune seance ancienne touchee', () => {
  const old = [sess(1, day(0), [{ name: 'Squat barre', repsTarget: '8-12', sets: [S(100, 8, 3), S(100, 8, 2)] }]), sess(2, day(1), [{ name: 'Squat barre', repsTarget: '8-12', sets: [S(100, 9, 2), S(100, 8, 1)] }])];
  const before = JSON.stringify(old);
  const c = cur([{ name: 'Squat barre', repsTarget: '8-12', sets: [{ weight: 100, reps: 10, rir: '0', rirSaisi: true, rirCible: 3 }, { weight: 100, reps: 9, rir: '', rirSaisi: false, rirCible: 2 }, { weight: 100, reps: 8, rir: '2', rirSaisi: true }] }]);
  const a = finish(V1, old, c, day(2)), b = finish(V2, old, c, day(2));
  assert.strictEqual(JSON.stringify(old), before, 'anciennes seances intactes');
  assert.deepStrictEqual(b.saved.slice(0, 2), plain(old)); assert.strictEqual(b.saved.length, 3);
  const strip = x => x.map(s => Object.assign({}, s, { id: 0 })); assert.deepStrictEqual(strip(b.saved), strip(a.saved), 'meme enregistrement V1 / moteur');
  assert.deepStrictEqual(b.saved[2].exercises[0].sets, [{ weight: 100, reps: 10, rir: 0, rirReel: 0, rirSaisi: true, rirCible: 3, done: true }, { weight: 100, reps: 9, rir: null, rirReel: null, rirSaisi: false, rirCible: 2, done: true }, { weight: 100, reps: 8, rir: 2, rirReel: 2, rirSaisi: true, done: true }]);
  assert.strictEqual(b.backups, 1, 'une sauvegarde cloud, comme avant'); });

// ── 2. Bilan progression / stagnation / regression : memes regles que l'ecran Seance en cours ──
const bilan = (hist, today, rt) => { const sessions = hist.map((x, k) => sess(k + 1, day(k), [{ name: 'Exo test', repsTarget: rt || '8-12', sets: x.map(([w, r]) => S(w, r)) }]));
  const out = finish(V2, sessions, cur([{ name: 'Exo test', repsTarget: rt || '8-12', sets: today.map(([w, r]) => ({ weight: w, reps: r, rir: 2 })) }]), day(hist.length)); return out; };
const verdict = o => o.modal ? (o.modal.progressed.length ? 'progression' : o.modal.regressed.length ? 'regression' : o.modal.stagnated.length ? 'stable' : 'aucun') : 'alerte:' + o.alert.title;
const detail = o => o.modal && o.modal.details ? o.modal.details['Exo test'] : undefined;
t('Bilan 8-12 : progression en charge, en reps, en force estimee ; stagnation ; regression — avec le detail affiche', () => {
  let o = bilan([[[60, 10], [60, 10]]], [[62.5, 9], [62.5, 9]]); assert.deepStrictEqual([verdict(o), detail(o)], ['progression', 'charge +2.5kg (62.5kg)']);
  o = bilan([[[60, 10], [60, 10]]], [[60, 11], [60, 10]]); assert.deepStrictEqual([verdict(o), detail(o)], ['progression', '+1 rep à 60kg']);
  // Etape 3 (R-P3) : une serie de moins -> on compare les 3 meilleures series de chaque cote ; pas de baisse -> « seance incomplete », ni progression ni baisse.
  o = bilan([[[22.5, 8], [22.5, 8], [22.5, 7], [22.5, 6]]], [[22.5, 9], [22.5, 8], [22.5, 7]]); assert.deepStrictEqual([verdict(o), o.modal.nonComparables, detail(o)], ['aucun', ['Exo test'], 'Séance incomplète (3 séries contre 4) : pas de baisse sur les 3 meilleures séries, ni progression ni baisse retenue'], 'meilleure serie 8 -> 9 reps, une serie de moins');
  o = bilan([[[22.5, 8], [22.5, 8], [22.5, 7], [22.5, 6]]], [[22.5, 7], [22.5, 7], [22.5, 6]]); assert.deepStrictEqual([verdict(o), detail(o)], ['regression', '-3 reps à 22.5kg'], 'une serie de moins ET (8+8+7 contre 7+7+6) les 3 meilleures series en baisse : vraie baisse');
  o = bilan([[[60, 10], [60, 10]]], [[60, 10], [60, 10]]); assert.strictEqual(verdict(o), 'stable');
  o = bilan([[[60, 10], [60, 10]]], [[60, 10], [60, 10], [50, 5]]); assert.strictEqual(verdict(o), 'progression', 'une serie de plus a charge egale : +reps');
  o = bilan([[[60, 10], [60, 10]]], [[60, 8], [60, 8]]); assert.deepStrictEqual([verdict(o), detail(o)], ['regression', '-4 reps à 60kg']);
  o = bilan([[[60, 10], [60, 10]]], [[55, 9], [55, 9]]); assert.deepStrictEqual([verdict(o), detail(o)], ['regression', 'charge -5kg']); });
t('Bilan 10-15 : reps et charge distinguees, aucune limite a 12 reps, force affichee seulement « ≈ »', () => {
  let o = bilan([[[20, 13], [20, 13]]], [[20, 14], [20, 13]], '10-15'); assert.deepStrictEqual([verdict(o), detail(o)], ['progression', '+1 rep à 20kg']);
  o = bilan([[[20, 15], [20, 15]]], [[22.5, 11], [22.5, 10]], '10-15'); assert.deepStrictEqual([verdict(o), detail(o)], ['progression', 'charge +2.5kg (22.5kg)']);
  o = bilan([[[20, 15], [20, 15]]], [[25, 7], [25, 6]], '10-15'); assert.strictEqual(verdict(o), 'stable', 'charge plus lourde mais reps sous la fourchette');
  o = bilan([[[20, 14], [20, 14]]], [[20, 12], [20, 12]], '10-15'); assert.deepStrictEqual([verdict(o), detail(o)], ['regression', '-4 reps à 20kg']); });
t('Records : meme critere que le V1 (+1 % de force estimee sur tout l\'historique), avec la nature du record', () => {
  const sessions = [sess(1, day(0), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(60, 10), S(60, 9)] }])];
  const mk = (sets, rt) => [finish(V1, sessions, cur([{ name: 'Exo test', repsTarget: rt || '8-12', sets }]), day(1)), finish(V2, sessions, cur([{ name: 'Exo test', repsTarget: rt || '8-12', sets }]), day(1))];
  let [a, b] = mk([{ weight: 62.5, reps: 10, rir: 2 }]); assert.deepStrictEqual(b.modal.sessionPRs, a.modal.sessionPRs); assert.strictEqual(b.modal.prDetails['Exo test'], 'charge max 62.5kg · force 83kg');
  [a, b] = mk([{ weight: 60, reps: 12, rir: 2 }]); assert.deepStrictEqual(b.modal.sessionPRs, ['Exo test']); assert.strictEqual(b.modal.prDetails['Exo test'], '12 reps à 60kg · force 84kg');
  [a, b] = mk([{ weight: 50, reps: 20, rir: 2 }]); assert.deepStrictEqual(b.modal.sessionPRs, a.modal.sessionPRs); assert.strictEqual(b.modal.prDetails['Exo test'], '20 reps à 50kg · force ≈83kg', 'record estime avec 20 reps : marque ≈');
  [a, b] = mk([{ weight: 60, reps: 10, rir: 2 }]); assert.deepStrictEqual([a.modal.sessionPRs, b.modal.sessionPRs], [[], []]); });

// ── 3. Alertes de fin de seance ──
t('Alertes de fin de seance : meme diagnostic que pendant la seance (memes 5 cas verifies a l\'etape 1)', () => {
  const run = (rows, rt) => { const sessions = rows.slice(0, -1).map((x, k) => sess(k + 1, day(k), [{ name: 'Exo test', repsTarget: rt, sets: x.split(',').map(y => S(...y.split('x').map(Number))) }]));
    const last = rows[rows.length - 1].split(',').map(y => { const [w, r] = y.split('x').map(Number); return { weight: w, reps: r, rir: 2 }; });
    return [finish(V1, sessions, cur([{ name: 'Exo test', repsTarget: rt, sets: last }]), day(rows.length - 1)), finish(V2, sessions, cur([{ name: 'Exo test', repsTarget: rt, sets: last }]), day(rows.length - 1))]; };
  // regression V1 sans garde : le V1 alertait alors que la meilleure serie progressait (+1 rep a 22,5 kg)
  let [a, b] = run(['25x7,25x12', '25x10,25x10,25x6', '22.5x6,22.5x8,22.5x7,22.5x6', '22.5x9,22.5x8,22.5x7'], '8-12');
  assert.strictEqual(a.alert && a.alert.title, 'REGRESSION PERSISTANTE'); assert.strictEqual(b.alert, null); assert.ok(b.modal.nonComparables.includes('Exo test') && /^Séance incomplète/.test(b.modal.details['Exo test']), 'etape 3 (R-P3) : une serie de moins, meilleures series en hausse -> seance incomplete');
  [a, b] = run(['83x7,83x12,83x9,83x7', '85.5x11,85.5x9', '83x10,83x12,83x12,83x10'], '8-12'); assert.strictEqual(b.alert && b.alert.title, 'STAGNATION — PLAFOND'); assert.strictEqual(a.alert && a.alert.title, 'STAGNATION — PLAFOND', 'le V1 de fin de seance la montrait deja');
  [a, b] = run(['60x10,60x10', '66x10,66x10'], '8-12'); assert.deepStrictEqual([a.alert.title, b.alert.title], ['PROGRESSION TROP RAPIDE', 'PROGRESSION TROP RAPIDE']); assert.deepStrictEqual(b.alert, a.alert); });
t('Alertes de fin de seance : identiques au V1 sur 3 000 seances generees, sauf la garde « progression reelle » de l\'ecran Seance (ecarts comptes)', () => {
  const r = rng(321); let same = 0, retirees = 0, ajoutees = 0;
  for (let i = 0; i < 3000; i++) { const h = genHist(r, 2 + Math.floor(r() * 5), 6, 12); const sessions = h.slice(0, -1).map((x, k) => sess(k + 1, x.date, [{ name: 'Exo test', repsTarget: '8-12', sets: x.sets }]));
    const c = cur([{ name: 'Exo test', repsTarget: '8-12', sets: h[h.length - 1].sets }]); const a = finish(V1, sessions, c, h[h.length - 1].date), b = finish(V2, sessions, c, h[h.length - 1].date);
    const ka = a.alert ? a.alert.title : null, kb = b.alert ? b.alert.title : null;
    if (ka === kb) { same++; if (a.alert) assert.deepStrictEqual(b.alert, a.alert); continue; }
    if (ka && !kb) { retirees++; assert.ok(/PLAFOND|REGRESSION/.test(ka), ka); } else { ajoutees++; assert.fail('alerte ajoutee : ' + kb); } }
  info(same + ' / 3000 identiques ; ' + retirees + ' alerte(s) plafond/regression retiree(s) car la seance progresse sur la precedente (meme garde que pendant la seance) ; ' + ajoutees + ' ajoutee'); });

// ── 4. RIR saisi, inconnu, non verifie ──
t('RIR saisi / inconnu / non verifie : n\'influencent pas le bilan (charge et reps seulement) et sont enregistres tels quels', () => {
  const old = [sess(1, day(0), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(50, 10, 2), S(50, 10, 1)] }])]; // anciennes series : RIR « non verifie »
  const sets = [{ weight: 50, reps: 11, rir: '0', rirSaisi: true, rirCible: 3 }, { weight: 50, reps: 10, rir: '', rirSaisi: false, rirCible: 2 }];
  const b = finish(V2, old, cur([{ name: 'Exo test', repsTarget: '8-12', sets }]), day(1)); assert.deepStrictEqual(b.modal.progressed, ['Exo test']);
  const st = b.saved[1].exercises[0].sets; assert.deepStrictEqual(st.map(x => [x.rir, x.rirSaisi, x.rirCible]), [[0, true, 3], [null, false, 2]]);
  assert.deepStrictEqual(E.mesuresSeance(E.normaliserSeances(b.saved)[0].exercices[0].series).rir, { saisi: 0, prerempli: 0, non_verifie: 2, inconnu: 0 });
  assert.deepStrictEqual(E.mesuresSeance(E.normaliserSeances(b.saved)[1].exercices[0].series).rir, { saisi: 1, prerempli: 0, non_verifie: 0, inconnu: 1 }); });

// ── 5. Historiques : memes noms continus, noms differents distincts ──
t('Meme nom : la seance du jour se compare a la precedente de CE nom ; les deux curls renommes ont des historiques distincts', () => {
  const sessions = [sess(1, day(0), [{ name: 'Curl câble unilatéral face poulie', repsTarget: '10-12', sets: [S(10, 12), S(10, 12)] }]), sess(2, day(1), [{ name: 'Curl poulie basse prise neutre', repsTarget: '10-12', sets: [S(13.5, 12), S(13.5, 12)] }])];
  const b = finish(V2, sessions, cur([{ name: 'Curl câble unilatéral face poulie', repsTarget: '10-12', sets: [{ weight: 10, reps: 12, rir: 2 }, { weight: 10, reps: 13, rir: 2 }] }, { name: 'Curl câble face poulie (nouveau nom)', repsTarget: '10-12', sets: [{ weight: 8, reps: 10, rir: 2 }] }]), day(2));
  assert.deepStrictEqual(b.modal.progressed, ['Curl câble unilatéral face poulie']); assert.strictEqual(b.modal.details['Curl câble unilatéral face poulie'], '+1 rep à 10kg');
  assert.ok(!b.modal.stagnated.includes('Curl câble face poulie (nouveau nom)') && !b.modal.regressed.includes('Curl câble face poulie (nouveau nom)'), 'nouveau nom = premiere seance, pas de comparaison');
  assert.deepStrictEqual(b.saved.slice(0, 2), plain(sessions), 'anciens noms et anciennes performances intacts'); });
t('Seances dans le desordre : la fin de seance compare a la vraie seance precedente (par date), pas a la derniere enregistree', () => {
  const sessions = [sess(2, day(2), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(60, 10), S(60, 10)] }]), sess(1, day(0), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(57.5, 10), S(57.5, 10)] }])];
  const c = cur([{ name: 'Exo test', repsTarget: '8-12', sets: [{ weight: 58.75, reps: 10, rir: 2 }, { weight: 58.75, reps: 10, rir: 2 }] }]);
  assert.deepStrictEqual(finish(V2, sessions, c, day(3)).modal.regressed, ['Exo test'], 'compare a 60 kg (la plus recente par date)');
  assert.deepStrictEqual(finish(V1, sessions, c, day(3)).modal.progressed, ['Exo test'], 'reference : le V1 comparait a 57,5 kg (derniere enregistree)'); });
t('Sans moteur charge : la fin de seance garde exactement le calcul V1 (repli)', () => {
  const sessions = [sess(1, day(0), [{ name: 'Exo test', repsTarget: '8-12', sets: [S(60, 10), S(60, 10)] }])];
  const a = finish(V1, sessions, cur([{ name: 'Exo test', repsTarget: '8-12', sets: [{ weight: 60, reps: 10, rir: 2 }, { weight: 60, reps: 9, rir: 2 }] }]), day(1));
  assert.deepStrictEqual([a.modal.progressed, a.modal.stagnated, a.modal.regressed, a.modal.details], [[], [], ['Exo test'], null], 'V1 : tonnage -5 % = en baisse'); });

t('Mollets debout machine « 1 » = poids du corps (0.11.0) : progression en reps « au poids du corps », record en reps seulement, jamais compare aux kg', () => {
  const M = 'Mollets debout machine', ex = (sets) => ({ name: M, repsTarget: '10-15', sets });
  const sessions = [sess(1, day(0), [ex([S(20, 12), S(20, 12)])]), sess(2, day(1), [ex([S(1, 15), S(1, 15), S(1, 14)])]), sess(3, day(2), [ex([S(1, 15), S(1, 15), S(1, 15)])])];
  // Seance du jour au poids du corps : +1 rep -> progression, texte sans « kg », record de reps (16 > 15) sans force estimee.
  let r = plain(V2.coachFinSeance(E, sessions, [ex([S(1, 16), S(1, 15), S(1, 15)])], day(3), 4));
  assert.deepStrictEqual([r.progressed, r.details[M], r.sessionPRs, r.prDetails[M], r.alerts.length], [[M], '+1 rep au poids du corps · haut de fourchette : ajouter une charge possible', [M], '16 reps au poids du corps (avant 15)', 0]);
  // Meme nombre de reps : stable, pas de record.
  r = plain(V2.coachFinSeance(E, sessions, [ex([S(1, 15), S(1, 15), S(1, 15)])], day(3), 4));
  assert.deepStrictEqual([r.stagnated, r.sessionPRs], [[M], []]);
  // Premiere seance au poids du corps apres des kg : non comparable avec la raison en clair, jamais « -19kg ».
  r = plain(V2.coachFinSeance(E, sessions.slice(0, 1), [ex([S(1, 15), S(1, 15)])], day(3), 4));
  assert.deepStrictEqual([r.nonComparables, r.regressed, r.details[M]], [[M], [], 'Unité de charge différente (charge en kg → poids du corps (valeur 1)) : pas de comparaison directe']);
  // Retour aux kg : compare aux seuls kg (record de charge 21 > 20 kg), pas au 1.
  r = plain(V2.coachFinSeance(E, sessions, [ex([S(21, 12), S(21, 12)])], day(3), 4));
  assert.deepStrictEqual([r.nonComparables, r.prDetails[M]], [[M], 'charge max 21kg · force 29kg']); });

t('Ecran Fin de seance AFFICHE son analyse : rendue dans l\'ecran sans seance en cours (saveSession remet currentSets a null) ; alertes d\'abord, puis TOUJOURS l\'analyse', () => {
  const tab = SRC.slice(SRC.indexOf('function SessionTab('));
  const iSans = tab.indexOf('  if (!currentSets) return ('), iAvec = tab.indexOf('\n  return (', iSans), fin = tab.indexOf('\nfunction ', iAvec);
  const brancheSans = tab.slice(iSans, iAvec), brancheAvec = tab.slice(iAvec, fin), avant = tab.slice(0, iSans);
  assert.ok(iSans > 0 && iAvec > iSans && fin > iAvec);
  assert.ok(avant.includes('const postSeanceView = !stagAlert && postSeanceModal && (') && avant.includes('ANALYSE POST-SÉANCE'), 'fenetre definie avant les deux branches');
  assert.ok(brancheSans.includes('{alertesFinView}') && brancheSans.includes('{postSeanceView}'), 'rendue dans l\'ecran sans seance en cours');
  assert.ok(!brancheAvec.includes('postSeanceModal &&') && !brancheAvec.includes('ANALYSE POST-SÉANCE'), 'plus dans la branche « seance en cours » (jamais visible)');
  assert.ok(brancheAvec.includes('{stagAlert && <StagnationAlert'), 'alertes PENDANT la seance inchangees');
  // saveSession : analyse posee meme quand il y a des alertes (vraie fonction, avec moteur).
  const sessions = ['83x7,83x12,83x9,83x7', '85.5x11,85.5x9'].map((x, k) => sess(k + 1, day(k), [{ name: 'Exo test', repsTarget: '8-12', sets: x.split(',').map(y => S(...y.split('x').map(Number))) }]));
  const b = finish(V2, sessions, cur([{ name: 'Exo test', repsTarget: '8-12', sets: [{ weight: 83, reps: 10, rir: 2 }, { weight: 83, reps: 12, rir: 2 }, { weight: 83, reps: 12, rir: 2 }, { weight: 83, reps: 10, rir: 2 }] }]), day(2));
  assert.strictEqual(b.alert && b.alert.title, 'STAGNATION — PLAFOND'); assert.ok(b.modal && b.modal.routineName === 'R' && b.modal.nbEx === 1, 'analyse aussi posee');
  const c = finish(V2, sessions.slice(0, 1), cur([{ name: 'Exo test', repsTarget: '8-12', sets: [{ weight: 83, reps: 10, rir: 2 }] }]), day(2));
  assert.deepStrictEqual([c.alert, !!c.modal], [null, true]); });

// ── 6. Donnees reelles (lecture seule) ──
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Donnees reelles : tes 141 seances rejouees une par une (« Terminer la seance »), V1 contre moteur ; enregistrement identique, ecarts d\'affichage listes', () => {
  const before = JSON.stringify(EXP); const ss = [...EXP.sessions].sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id);
  const tally = { V1: { p: 0, s: 0, r: 0, pr: 0, al: 0 }, V2: { p: 0, s: 0, r: 0, pr: 0, al: 0 } }; const changes = {}, alV1 = {}, alV2 = {}, exAl = []; let n = 0, savedSame = 0, both = 0; const exemples = [];
  ss.forEach((s, k) => { const past = ss.slice(0, k); const exs = (s.exercises || []).filter(e => (e.sets || []).some(st => st.weight && st.reps)); if (!exs.length) return; n++;
    const c = { routineId: s.routineId, routineName: s.routineName, exercises: exs.map(e => ({ name: e.name, repsTarget: e.repsTarget, sets: e.sets.map(st => Object.assign({}, st, { weight: String(st.weight), reps: String(st.reps), rir: st.rir === undefined || st.rir === null ? '' : String(st.rir) })) })) };
    const a = finish(V1, past, c, s.date), b = finish(V2, past, c, s.date);
    const strip = x => x.map(q => Object.assign({}, q, { id: 0 })); if (JSON.stringify(strip(a.saved)) === JSON.stringify(strip(b.saved))) savedSame++;
    const all = o => o.alert ? (o.alert.allAlerts || [o.alert]) : [];
    all(a).forEach(x => { alV1[x.title] = (alV1[x.title] || 0) + 1; }); all(b).forEach(x => { alV2[x.title] = (alV2[x.title] || 0) + 1; });
    all(a).forEach(x => { if (!all(b).some(y => y.exName === x.exName && y.title === x.title) && exAl.length < 4 && x.title.includes('PLAFOND')) exAl.push(s.date + ' ' + x.exName + ' : ' + (b.modal && b.modal.details ? (b.modal.details[x.exName] || 'stable') : '(autre alerte)')); });
    [['V1', a], ['V2', b]].forEach(([v, o]) => { if (o.alert) tally[v].al++; if (o.modal && a.modal && b.modal) { tally[v].p += o.modal.progressed.length; tally[v].s += o.modal.stagnated.length; tally[v].r += o.modal.regressed.length; tally[v].pr += o.modal.sessionPRs.length; } });
    if (a.modal && b.modal) both++;
    if (a.modal && b.modal) exs.forEach(e => { const cl = m => m.progressed.includes(e.name) ? 'progression' : m.regressed.includes(e.name) ? 'baisse' : m.stagnated.includes(e.name) ? 'stable' : (m.nonComparables || []).includes(e.name) ? 'non_comparable' : 'premiere';
      const x = cl(a.modal), y = cl(b.modal); if (x !== y) { const key = x + ' -> ' + y; changes[key] = (changes[key] || 0) + 1; if (key === 'progression -> baisse' || key === 'stable -> baisse' || (exemples.length < 12 && key === 'baisse -> progression')) exemples.push(s.date + ' ' + e.name + ' : V1 ' + x + ' / moteur ' + y + ' (' + (b.modal.details[e.name] || '') + ')'); } }); });
  assert.strictEqual(JSON.stringify(EXP), before, 'export non modifie'); assert.strictEqual(savedSame, n, 'enregistrement identique pour chaque seance');
  info(n + ' fins de seance rejouees ; enregistrement identique ' + savedSame + '/' + n);
  info('bilan compare sur les ' + both + ' fins de seance sans alerte des deux cotes :');
  info('V1     : ' + tally.V1.p + ' en progression, ' + tally.V1.s + ' stables, ' + tally.V1.r + ' en baisse, ' + tally.V1.pr + ' records, ' + tally.V1.al + ' fins de seance avec alerte');
  info('moteur : ' + tally.V2.p + ' en progression, ' + tally.V2.s + ' stables, ' + tally.V2.r + ' en baisse, ' + tally.V2.pr + ' records, ' + tally.V2.al + ' fins de seance avec alerte');
  info('classements changes : ' + JSON.stringify(changes)); info('alertes V1 (toutes, pas seulement la 1re) : ' + JSON.stringify(alV1)); info('alertes moteur : ' + JSON.stringify(alV2)); exAl.forEach(x => info('plafond V1 retire : ' + x)); exemples.forEach(x => info('ex. ' + x)); });

(async () => { let fail = 0;
  console.log('Moteur v' + E.VERSION + ' — ecran Fin de seance (vraie fonction saveSession, avec et sans moteur)' + (EXP ? ' | donnees reelles : ' + REAL : ''));
  for (const [n, f] of tests) { infos = []; try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0].slice(0, 500)); } infos.forEach(s => console.log('       info : ' + s)); }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
