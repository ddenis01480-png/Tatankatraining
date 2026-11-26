// Lancer : node tests/activation.test.js
//          EXPORT_FILE=/chemin/export.json node tests/activation.test.js   (simulation sur une COPIE de tes seances, lecture seule)
//
// Commit B (moteur 0.13.0) — exercices d'activation (ex. 1 serie d'oiseau en debut de PUSH / LEGS) :
//  1. marques dans la ROUTINE (propriete activation: true par exercice), jamais par le nom ni le catalogue ;
//  2. recopies dans la seance au demarrage et enregistres avec elle ;
//  3. exclus du volume direct et indirect, de la frequence, de la progression, des records et de la recuperation ;
//  4. anciennes seances intactes (sans le champ = exercice de travail) ;
//  5. imports et doublons : signatures inchangees pour les anciens exports.
// Les series d'echauffement (warmupSets, en vert avec pourcentage) ne sont PAS concernees et ne changent pas.
const H = require('./_harness.js'); const { SRC, vm, assert, fs, REAL_PROGRAMME } = H;
const E = require('../coach-engine.js');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }

const LIB = [fnSrc('function estActivation('), fnSrc('function horsActivation('), fnSrc('function coachReferenceTexte('), fnSrc('function coachReferenceSeance('), fnSrc('function fmtDate('), fnSrc('function coachEngine('),
  fnSrc('function coachA('), fnSrc('function coachHistorique('), fnSrc('function coachConseilAffichage('), fnSrc('function coachDiagAffichage('), fnSrc('function coachEcartTexte('),
  fnSrc('function coachFinSeance('), fnSrc('function coachBilanTexte('), fnSrc('function coachRaisonsTexte('), fnSrc('function coachIncompleteTexte('),
  'const COACH_RAISONS = ' + literal('const COACH_RAISONS = {', '{', '}') + ';', 'const COACH_UNITES = ' + literal('const COACH_UNITES = {', '{', '}') + ';', fnSrc('function coachRecordTexte('),
  fnSrc('function e1RM('), fnSrc('function parseRir('), fnSrc('function analyzeEx('), fnSrc('function getProgressionTip('),
  'const EXERCISE_NAME_FIXES = ' + literal('const EXERCISE_NAME_FIXES = {', '{', '}') + ';', fnSrc('function normalizeExName('),
  fnSrc('function _jsonSig('), fnSrc('function sessionSignature('), fnSrc('function _baseRoutineName('), fnSrc('function routineSignature('), fnSrc('function _newId('),
  fnSrc('function mergeSessionsNonDestructive('), fnSrc('function mergeRoutinesNonDestructive('),
  'function makeSave(env) { var currentSets = env.currentSets, sessions = env.sessions, setSessions = env.setSessions, save = env.save, KEYS = env.KEYS, load = env.load,',
  '  lsRemoveNs = function(){}, setSessionRecovered = function(){}, autoBackup = env.autoBackup, setCurrentSets = function(){}, setSeanceStartTime = function(){}, setSeanceElapsed = function(){},',
  '  setRestSec = function(){}, setTimerOn = function(){}, setStagAlert = env.setStagAlert, setPostSeanceModal = env.setPostSeanceModal, today = env.today, alert = env.alert, confirm = function(){ return true; };',
  fnSrc('  function saveSession() {'), ' return saveSession; }',
  'this.api = { estActivation, horsActivation, coachFinSeance, coachHistorique, sessionSignature, routineSignature, mergeSessionsNonDestructive, mergeRoutinesNonDestructive, makeSave, getProgressionTip };'].join('\n');
function load(withEngine) { const ctx = { Math, JSON, Object, Array, String, Number, Date, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console };
  ctx.window = withEngine ? { CoachEngine: E, confirm: () => true } : { confirm: () => true }; vm.createContext(ctx); vm.runInContext(LIB, ctx); return ctx.api; }
const A = load(true), V1 = load(false);
const plain = o => JSON.parse(JSON.stringify(o));
const fz = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(fz); } return o; };

const S = (w, r) => ({ weight: w, reps: r, rir: 2, done: true });
const sets = t => t.split(',').map(x => { const [w, r] = x.split('x').map(Number); return S(w, r); });
const OIS = 'Oiseau haltères buste penché';
const act = txt => ({ name: OIS, repsTarget: '20-30', sets: sets(txt), activation: true });
const trav = (name, rt, txt) => ({ name, repsTarget: rt, sets: sets(txt) });
const sess = (id, date, routineName, exs) => ({ id, date, routineId: id, routineName, exercises: exs });
// PULL : oiseau = vrai exercice de travail (3 series) ; PUSH / LEGS : 1 serie d'oiseau d'activation, MEME nom et MEME plage.
const SEANCES = () => [
  sess(1, '2026-11-10', 'PULL 1', [trav(OIS, '20-30', '8x22,8x21,8x20'), trav('Tractions lestées prise large', '8-12', '10x8,10x8')]),
  sess(2, '2026-11-12', 'PUSH 1', [act('10x25'), trav('Chest press machine', '8-12', '75x10,75x10')]),
  sess(3, '2026-11-14', 'LEGS 1', [act('12x30'), trav('Leg press 45°', '15-20', '120x16,120x16')]),
  sess(4, '2026-11-17', 'PULL 2', [trav(OIS, '20-30', '8x23,8x22,8x21')])];

const tests = []; const t = (n, f) => tests.push([n, f]); let infos = []; const info = s => infos.push(s);

// ── 1. Marque dans la routine, jamais deduite ──
t('Seule la valeur true compte : sans le champ, false, "true" ou 1 -> exercice de travail (anciennes seances intactes)', () => {
  assert.deepStrictEqual([undefined, false, 'true', 1, true].map(v => E.estActivation({ name: OIS, activation: v })), [false, false, false, false, true]);
  assert.deepStrictEqual([undefined, false, 'true', 1, true].map(v => A.estActivation({ name: OIS, activation: v })), [false, false, false, false, true]);
  assert.ok(!/activation/i.test(JSON.stringify(E.classerExercice(OIS))), 'rien dans le catalogue');
  assert.ok(!/activation/.test(literal('const PROGRAMME = [', '[', ']')), 'aucune routine par defaut marquee'); });

t('Editeur de routine : case ACTIVATION par exercice ; decochee = champ retire (routine identique a avant)', () => {
  assert.ok(SRC.includes('>ACTIVATION</div>') && SRC.includes('const { activation, ...reste } = exs[i]; exs[i] = estActivation(ex) ? reste : { ...reste, activation: true };'));
  assert.ok(SRC.includes('>{warmupLabel} echauf.</div>}') && SRC.includes('ÉCHAUFFEMENT — {warmupLabel} SÉRIE'), 'echauffement inchange'); });

t('Demarrage d\'une routine et « Rejouer » : la marque est recopiee dans la seance ; ajout/remplacement d\'exercice : jamais', () => {
  assert.ok(SRC.includes('lastSets, lastSetsDate: refS.date, ...(estActivation(ex) ? { activation: true } : {}),'), 'demarrage de routine');
  assert.ok(/userNote: ex\.userNote \|\| "",\n\s+\.\.\.\(estActivation\(ex\) \? \{ activation: true \} : \{\}\),\n\s+lastSets: ex\.sets,/.test(SRC), 'Rejouer une seance');
  const ajout = SRC.slice(SRC.indexOf('const _addRef = coachReferenceSeance('), SRC.indexOf('setShowPicker(false);', SRC.indexOf('const _addRef = coachReferenceSeance(')));
  assert.ok(!/activation/.test(ajout)); });

// ── 2. Enregistrement ──
t('Enregistrement (vraie fonction saveSession) : activation: true conservee avec ses series ; les autres exercices sans le champ', () => {
  const out = {}; const env = { currentSets: { routineId: 2, routineName: 'PUSH 1', exercises: [
      { name: OIS, repsTarget: '20-30', activation: true, sets: [{ weight: '10', reps: '25', rir: '', done: true }] },
      { name: 'Chest press machine', repsTarget: '8-12', sets: [{ weight: '75', reps: '11', rir: '2', rirSaisi: true, done: true }, { weight: '75', reps: '10', rir: '', done: true }] }] },
    sessions: SEANCES(), today: () => '2026-11-19', KEYS: { sessions: 'k' }, setSessions: v => { out.saved = v; }, save: () => {}, load: () => null, autoBackup: () => {},
    setStagAlert: a => { out.alert = a; }, setPostSeanceModal: m => { out.modal = m; }, alert: m => { out.msg = m; } };
  const avant = JSON.stringify(env.sessions); A.makeSave(env)(); const nouvelle = out.saved[out.saved.length - 1];
  assert.strictEqual(JSON.stringify(out.saved.slice(0, -1)), avant, 'anciennes seances intactes');
  assert.deepStrictEqual([nouvelle.exercises[0].activation, nouvelle.exercises[0].sets.length, 'activation' in nouvelle.exercises[1]], [true, 1, false]);
  const m = plain(out.modal); const tout = [].concat(m.progressed, m.stagnated, m.regressed, m.nonComparables, m.sessionPRs);
  assert.ok(!tout.includes(OIS), 'activation absente du bilan de fin de seance : ' + JSON.stringify(m));
  assert.ok(tout.includes('Chest press machine')); });

// ── 3. Exclusions ──
t('Progression : l\'oiseau de travail (PULL) n\'est jamais compare a l\'oiseau d\'activation (PUSH / LEGS), meme nom, meme plage', () => {
  const h = E.historiqueExercice(E.normaliserSeances(SEANCES()), OIS);
  assert.deepStrictEqual(h.map(x => x.date), ['2026-11-10', '2026-11-17']);
  const a = E.analyseExercice(h, { fourchette: E.lireFourchette('20-30') }); assert.strictEqual(a.performance, 'progression', 'PULL 2 vs PULL 1');
  const sansMarque = SEANCES().map(s => Object.assign({}, s, { exercises: s.exercises.map(e => { const c = Object.assign({}, e); delete c.activation; return c; }) }));
  assert.strictEqual(E.historiqueExercice(E.normaliserSeances(sansMarque), OIS).length, 4, 'sans la marque : melange (comportement d\'avant)');
  const c = E.referenceConseil(h, '20-30', { aujourdhui: '2026-11-19' }); assert.deepStrictEqual([c.statut, c.date], ['ok', '2026-11-17'], 'conseil tire du PULL'); });

t('Records : une serie d\'activation n\'est ni un record ni une reference de record', () => {
  const s = SEANCES(); s[1].exercises[0] = act('14x26'); // activation plus lourde que le travail
  const fin = plain(A.coachFinSeance(E, s, [trav(OIS, '20-30', '9x22,9x22,9x21')], '2026-11-19', 9));
  assert.ok(fin.sessionPRs.includes(OIS) && /9kg/.test(fin.prDetails[OIS]), 'record de travail compare au seul travail : ' + JSON.stringify(fin.prDetails));
  const finAct = plain(A.coachFinSeance(E, s, [act('20x30')], '2026-11-19', 9)); assert.deepStrictEqual([finAct.sessionPRs, finAct.progressed, finAct.alerts], [[], [], []]); });

t('Volume direct et indirect, frequence : les series d\'activation ne comptent pas', () => {
  const v = E.volumeMuscles(E.normaliserSeances(SEANCES()), { fin: '2026-11-19' }).muscles;
  assert.deepStrictEqual([v['Deltoïde post.'].direct.series, v['Deltoïde post.'].direct.jours], [6, 2], 'oiseau : 3 + 3 series de travail, 2 jours');
  assert.strictEqual(v['Trapèzes'].indirect.exercices.filter(e => e.nom === OIS).reduce((n, e) => n + e.series, 0), 6, 'indirect : sans les 2 series d\'activation');
  const avec = E.volumeMuscles(E.normaliserSeances(SEANCES(), { avecActivation: true }), { fin: '2026-11-19' }).muscles;
  assert.deepStrictEqual([avec['Deltoïde post.'].direct.series, avec['Deltoïde post.'].direct.jours], [8, 4], 'option avecActivation (diagnostic seulement)'); });

t('Recuperation : une seance ou le muscle n\'a ete sollicite qu\'en activation ne compte pas', () => {
  const d = E.dernieresSollicitations(E.normaliserSeances(SEANCES().slice(0, 3)), Date.parse('2026-11-15T12:00:00Z'));
  assert.strictEqual(d.groupes['Deltoïde post.'].derniere.date, '2026-11-10', 'derniere sollicitation = le PULL, pas l\'activation du 14/11');
  assert.ok(SRC.includes('setRecupInfo(recupSollicitations(sessions, exercises.filter(e => !estActivation(e)).map(e => e.name), Date.now()));'), 'encart de la seance sans l\'activation'); });

t('Seance en cours : pas de conseil, pas de record « flash », pas d\'alerte de stagnation sur l\'activation ; badge ACTIVATION', () => {
  assert.ok(SRC.includes('if (estActivation(ex)) return null; // activation : pas de conseil de progression'));
  assert.ok(SRC.includes('currentSet.weight && currentSet.reps && !estActivation(ex)) {') && SRC.includes('validSets.length > 0 && !estActivation(ex)) checkStagnation('));
  assert.ok(SRC.includes('>ACTIVATION</div>}'));
  assert.ok(SRC.includes('function ProgressTab({ sessions: sessionsBrutes }) {\n  const sessions = horsActivation(sessionsBrutes);'), 'onglet Progres');
  assert.ok(SRC.includes('function CycleBilan({ sessions: sessionsBrutes,') && SRC.includes('function BilanMensuel({ sessions: sessionsBrutes,'), 'bilans de cycle et du mois'); });

t('Repli V1 (moteur absent) : memes exclusions dans la fin de seance', () => {
  const s = SEANCES(); const out = {}; const env = { currentSets: { routineId: 9, routineName: 'PUSH 1', exercises: [{ name: OIS, repsTarget: '20-30', activation: true, sets: [{ weight: '20', reps: '30', rir: '', done: true }] }] },
    sessions: s, today: () => '2026-11-19', KEYS: { sessions: 'k' }, setSessions: v => { out.saved = v; }, save: () => {}, load: () => null, autoBackup: () => {}, setStagAlert: () => {}, setPostSeanceModal: m => { out.modal = m; }, alert: () => {} };
  V1.makeSave(env)(); const m = plain(out.modal); assert.deepStrictEqual([m.progressed, m.regressed, m.sessionPRs], [[], [], []]); });

// ── 4. Imports et doublons ──
t('Signatures : identiques a avant pour les anciennes donnees (sans le champ) ; la marque distingue une routine ou une seance', () => {
  const ancienneSession = (s) => [String(s.date), String(s.routineName || s.routineId || ''), JSON.stringify((s.exercises || []).map(e => [e.name, (e.sets || []).map(x => [x.weight, x.reps, x.rir])]))].join('|');
  const ancienneRoutine = r => JSON.stringify([r.name, r.exercises.map(e => [e.name, e.sets, e.repsTarget, e.rest, e.warmupSets, e.note])]);
  const s = SEANCES()[0], r = { name: 'PUSH 1', exercises: [{ name: OIS, sets: 1, repsTarget: '20-30', rest: 60, warmupSets: 0, note: '' }] };
  assert.strictEqual(A.sessionSignature(s), ancienneSession(s)); assert.strictEqual(A.routineSignature(r), ancienneRoutine(r));
  const rA = { name: 'PUSH 1', exercises: [Object.assign({}, r.exercises[0], { activation: true })] };
  assert.notStrictEqual(A.routineSignature(rA), A.routineSignature(r)); assert.strictEqual(A.routineSignature(Object.assign({}, r, { exercises: [Object.assign({}, r.exercises[0], { activation: false })] })), A.routineSignature(r));
  const sA = SEANCES()[1], sSans = Object.assign({}, sA, { exercises: sA.exercises.map(e => { const c = Object.assign({}, e); delete c.activation; return c; }) });
  assert.notStrictEqual(A.sessionSignature(sA), A.sessionSignature(sSans)); });

t('Import : un ancien export (sans le champ) se fusionne comme avant, reimport = 0 ajout ; aucune donnee existante modifiee', () => {
  const existant = fz(SEANCES()); const avant = JSON.stringify(existant);
  const r1 = A.mergeSessionsNonDestructive(existant, plain(existant)); assert.deepStrictEqual([r1.added, r1.duplicates], [0, 4], 'meme export = doublons');
  const ancien = plain(existant).map(s => Object.assign(s, { exercises: s.exercises.map(e => { delete e.activation; return e; }) }));
  const r2 = A.mergeSessionsNonDestructive([], ancien); const r3 = A.mergeSessionsNonDestructive(r2.merged, ancien); assert.deepStrictEqual([r2.added, r3.added], [4, 0]);
  const routines = fz([{ id: 1, name: 'PUSH 1', exercises: [{ name: OIS, sets: 1, repsTarget: '20-30', rest: 60, warmupSets: 0, note: '', activation: true }] }]);
  const rr = A.mergeRoutinesNonDestructive(routines, plain(routines)); assert.deepStrictEqual([rr.added, rr.duplicates], [0, 1]);
  assert.strictEqual(JSON.stringify(existant), avant); });

t('Analyse complete (analyser) : series prevues lues sans l\'activation ; aucune proposition automatique', () => {
  const routines = [{ name: 'PUSH 1', exercises: [{ name: OIS, sets: 1, repsTarget: '20-30', activation: true }] }, { name: 'PULL 1', exercises: [{ name: OIS, sets: 3, repsTarget: '20-30' }] }];
  const an = E.analyser({ sessions: SEANCES(), routines }, { maintenant: '2026-11-19' });
  assert.deepStrictEqual(an.propositions, []); assert.strictEqual(an.exercices[OIS].seances, 2); });

// ── 5. Ton export : COPIE en memoire, rien n'est enregistre ──
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Ton export : aucune seance marquee aujourd\'hui (resultats identiques a 0.12.0) ; simulation si l\'oiseau a 1 serie en tete de PUSH / LEGS etait marque', () => {
  const brut = JSON.stringify(EXP); const n0 = EXP.sessions.reduce((n, s) => n + (s.exercises || []).length, 0);
  const norm = E.normaliserSeances(EXP.sessions); assert.strictEqual(norm.reduce((n, s) => n + s.exercices.length, 0), n0, 'rien d\'exclu sans marque');
  const copie = JSON.parse(brut); let marques = 0;
  copie.sessions.forEach(s => { const e = (s.exercises || [])[0]; if (e && e.name === OIS && /^(PUSH|LEGS)/.test(s.routineName || '') && (e.sets || []).length === 1) { e.activation = true; marques++; } });
  const fin = EXP.sessions.map(s => s.date).sort().pop();
  const vA = E.volumeMuscles(E.normaliserSeances(EXP.sessions), { fin }).muscles['Deltoïde post.'].direct, vB = E.volumeMuscles(E.normaliserSeances(copie.sessions), { fin }).muscles['Deltoïde post.'].direct;
  const hA = E.historiqueExercice(E.normaliserSeances(EXP.sessions), OIS).length, hB = E.historiqueExercice(E.normaliserSeances(copie.sessions), OIS).length;
  assert.strictEqual(JSON.stringify(EXP), brut, 'export non modifie');
  info(marques + ' series d\'activation simulees (oiseau a 1 serie en tete de PUSH/LEGS) ; Delto post. sur 28 j : ' + vA.series + ' -> ' + vB.series + ' series directes, ' + vA.jours + ' -> ' + vB.jours + ' jours ; historique de l\'oiseau : ' + hA + ' -> ' + hB + ' seances'); });

(async () => { let fail = 0;
  console.log('Commit B — exercices d\'activation (moteur v' + E.VERSION + ')');
  for (const [n, f] of tests) { infos = []; try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).slice(0, 800)); } infos.forEach(s => console.log('       info : ' + s)); }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
