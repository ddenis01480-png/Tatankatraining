// Lancer : node tests/rir.test.js
// Op. 2 — RIR : 0 conserve, RIR inconnu jamais invente, RIR saisi (rirSaisi:true) distingue du RIR pre-rempli (rirSaisi:false).
// Les anciennes series (sans rirSaisi) restent « non verifiees » : aucune reconstitution, aucune reecriture.
// Execute le VRAI code d'index.html (chargement des seances, updateSet, enregistrement d'une seance, import) avec un faux localStorage.
const H = require('./_harness.js'); const { openApp, mkStore, SRC, vm, assert } = H;
const U = 'user-rir', NS = b => b + '_u_' + U;
function mondayOfThisWeek() { const d = new Date(), w = d.getDay(), m = new Date(d); m.setDate(d.getDate() - (w === 0 ? 6 : w - 1)); return m.toISOString().split('T')[0]; }
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
// Anciennes seances, telles qu'enregistrees avant l'op. 2 (pas de rirSaisi) + un RIR absent + un RIR texte.
const OLD = [
  { id: 1, date: '2026-03-18', routineId: 1, routineName: 'PUSH', exercises: [{ name: 'Exo A', repsTarget: '8-12', note: '', rest: 90, sets: [{ weight: 50, reps: 10, rir: 3, done: true }, { weight: 50, reps: 9, rir: 2, done: true }, { weight: 50, reps: 8, rir: 1, done: true, setType: 'normal' }] }] },
  { id: 2, date: '2026-03-20', routineId: 1, routineName: 'PUSH', exercises: [{ name: 'Exo A', repsTarget: '8-12', note: '', rest: 90, sets: [{ weight: 50, reps: 10, done: true }, { weight: 50, reps: 10, rir: '2', done: true }] }] },
];
const store = extra => mkStore(Object.assign({ [NS('it3_sessions')]: JSON.stringify(OLD), [NS('it3_routines')]: JSON.stringify([{ id: 1, name: 'PUSH', exercises: [{ name: 'Exo A', sets: 3, repsTarget: '8-12' }] }]),
  [NS('it3_sns_reset')]: mondayOfThisWeek(), it3_loaded_uid: U }, extra || {}));
async function boot(ls) { const app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', { id: U, email: 'rir@x.fr' }); return app; }
// Le VRAI updateSet de la seance en cours, et la VRAIE transformation des series a l'enregistrement (saveSession).
function realUpdateSet(app) { let cur = null; const f = vm.runInContext('(function(setCurrentSets, lsSetNs){ ' + fnSrc('function updateSet(') + ' return updateSet; })', app.ctx)(fn => { cur = fn(cur); }, () => {});
  return { set: v => { cur = v; }, get: () => cur, update: f }; }
const SAVE_MAP = SRC.match(/\.map\(s => \(\{ weight: parseFloat\(s\.weight\), reps: parseInt\(s\.reps\), rir: parseRir\(s\.rir\), rirSaisi: s\.rirSaisi === true && parseRir\(s\.rir\) !== null, \.\.\.\(parseRir\(s\.rirCible\) !== null \? \{ rirCible: parseRir\(s\.rirCible\) \} : \{\}\)(?:, \.\.\.\(parseInt\(s\.repsCible\) > 0 \? \{ repsCible: parseInt\(s\.repsCible\) \} : \{\}\))?(?:, \.\.\.\(Number\(s\.faiteLe\) > 0 \? \{ faiteLe: Number\(s\.faiteLe\) \} : \{\}\))?, done: true \}\)\)/);
if (!SAVE_MAP) throw new Error('transformation des series de saveSession introuvable');
const toSaved = (app, sets) => vm.runInContext('(function(sets){ return sets.filter(s => s.weight && s.reps)' + SAVE_MAP[0] + '; })', app.ctx)(sets);

const tests = []; const t = (n, f) => tests.push([n, f]);
t('parseRir : 0 -> 0 ; "0" -> 0 ; "3" -> 3 ; absent, vide, texte ou hors limites -> inconnu (null)', async () => {
  const app = await boot(store()); const p = app.ctx.parseRir;
  assert.strictEqual(p(0), 0); assert.strictEqual(p('0'), 0); assert.strictEqual(p('3'), 3); assert.strictEqual(p(5), 5);
  [undefined, null, '', 'abc', -1, 11].forEach(v => assert.strictEqual(p(v), null, String(v))); });
t('RECHARGEMENT : les anciennes seances restent identiques (RIR, setType...) ; RIR absent laisse absent ; RIR texte lu comme nombre', async () => {
  const ls = store(); const app = await boot(ls); const s = app.state('sessions');
  assert.deepStrictEqual(s[0].exercises[0].sets.map(x => x.rir), [3, 2, 1]); assert.strictEqual(s[0].exercises[0].sets[2].setType, 'normal');
  assert.strictEqual('rir' in JSON.parse(JSON.stringify(s[1].exercises[0].sets[0])), false, 'RIR absent : rien n\'est invente'); assert.strictEqual(s[1].exercises[0].sets[1].rir, 2);
  assert.ok(s.every(x => x.exercises.every(e => e.sets.every(st => !('rirSaisi' in st)))), 'anciennes series : aucun rirSaisi ajoute (non verifiees)');
  assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(OLD), 'le stockage n\'est pas reecrit au chargement'); });
t('SEANCE EN COURS : serie neuve = RIR vide + rirSaisi:false ; choisir une valeur = rirSaisi:true (RIR 0, et aussi 3/2/1 = anciennes valeurs pre-remplies) ; revenir a « RIR ? » = false', async () => {
  const app = await boot(store()); const u = realUpdateSet(app);
  u.set({ routineId: 1, routineName: 'PUSH', exercises: [{ name: 'Exo A', repsTarget: '8-12', sets: [0, 1, 2, 3].map(() => ({ weight: 50, reps: '', rir: '', rirSaisi: false, done: false })) }] });
  u.update(0, 0, 'rir', '0'); u.update(0, 1, 'rir', '3'); u.update(0, 2, 'rir', '2'); u.update(0, 2, 'rir', ''); u.update(0, 3, 'reps', '9');
  const sets = u.get().exercises[0].sets;
  assert.deepStrictEqual(sets.map(x => [x.rir, x.rirSaisi]), [['0', true], ['3', true], ['', false], ['', false]]); });
t('ENREGISTREMENT : RIR jamais choisi -> RIR inconnu (null) et rirSaisi:false, rien d\'invente', async () => {
  const app = await boot(store()); const out = toSaved(app, [{ weight: '50', reps: '8', rir: '', rirSaisi: false }, { weight: '50', reps: '8', rir: '', rirSaisi: true }, { weight: '50', reps: '8', rir: '3', rirSaisi: true }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [{ weight: 50, reps: 8, rir: null, rirSaisi: false, done: true }, { weight: 50, reps: 8, rir: null, rirSaisi: false, done: true }, { weight: 50, reps: 8, rir: 3, rirSaisi: true, done: true }]); });
t('ENREGISTREMENT : RIR 0 enregistre 0 (plus 2) ; rirSaisi true/false conserve ; serie ancienne sans rirSaisi -> false', async () => {
  const app = await boot(store()); const out = toSaved(app, [{ weight: '50', reps: '8', rir: '0', rirSaisi: true, done: true }, { weight: '50', reps: '8', rir: '2', rirSaisi: false, done: true }, { weight: '50', reps: '7', rir: '1', done: true }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [{ weight: 50, reps: 8, rir: 0, rirSaisi: true, done: true }, { weight: 50, reps: 8, rir: 2, rirSaisi: false, done: true }, { weight: 50, reps: 7, rir: 1, rirSaisi: false, done: true }]); });
t('SAUVEGARDE + RECHARGEMENT : une nouvelle seance a RIR 0 survit au rechargement ; les anciennes seances restent octet pour octet', async () => {
  const ls = store(); let app = await boot(ls);
  const newS = { id: 3, date: '2026-11-22', routineId: 1, routineName: 'PUSH', exercises: [{ name: 'Exo A', repsTarget: '8-12', note: '', rest: 90, sets: toSaved(app, [{ weight: '52.5', reps: '8', rir: '0', rirSaisi: true }, { weight: '52.5', reps: '7', rir: '1', rirSaisi: false }]) }] };
  app.saveSession(newS); app = await boot(ls);
  const stored = JSON.parse(ls.getItem(NS('it3_sessions'))); assert.strictEqual(stored.length, 3);
  const expectedOld = JSON.parse(JSON.stringify(OLD)); expectedOld[1].exercises[0].sets[1].rir = 2; // seul le RIR texte "2" devient le nombre 2 (comportement deja existant)
  assert.strictEqual(JSON.stringify(stored.slice(0, 2)), JSON.stringify(expectedOld), 'anciennes seances identiques (aucun RIR invente, aucun rirSaisi ajoute)');
  const last = app.state('sessions')[2].exercises[0].sets; assert.strictEqual(last[0].rir, 0); assert.strictEqual(last[0].rirSaisi, true); assert.strictEqual(last[1].rirSaisi, false); });
t('RIR CIBLE : enregistre a part (rirCible) ; jamais recopie dans le RIR reel ; RIR reel vide = inconnu', async () => {
  const app = await boot(store()); const out = toSaved(app, [{ weight: '50', reps: '8', rir: '', rirCible: 3, rirSaisi: false }, { weight: '50', reps: '8', rir: '2', rirCible: 2, rirSaisi: true }, { weight: '50', reps: '8', rir: '1', rirSaisi: true }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), [{ weight: 50, reps: 8, rir: null, rirSaisi: false, rirCible: 3, done: true }, { weight: 50, reps: 8, rir: 2, rirSaisi: true, rirCible: 2, done: true }, { weight: 50, reps: 8, rir: 1, rirSaisi: true, done: true }]); });
t('EXPORT JSON : l\'export lit les seances stockees telles quelles (RIR 0 et rirSaisi inclus)', async () => {
  const ex = fnSrc('function exportData('); assert.ok(/sessions: load\(KEYS\.sessions\) \|\| \[\]/.test(ex), 'export = contenu stocke, sans transformation');
  const ls = store(); const app = await boot(ls); const withNew = OLD.concat([{ id: 3, date: '2026-11-22', routineName: 'PUSH', exercises: [{ name: 'Exo A', sets: [{ weight: 50, reps: 8, rir: 0, rirSaisi: true, done: true }] }] }]);
  ls.setItem(NS('it3_sessions'), JSON.stringify(withNew)); const exported = JSON.parse(JSON.stringify({ sessions: app.ctx.load(app.ctx.__KEYS.sessions) }));
  assert.strictEqual(exported.sessions[2].exercises[0].sets[0].rir, 0); assert.strictEqual(exported.sessions[2].exercises[0].sets[0].rirSaisi, true); });
// Import : le VRAI gestionnaire importData (memes branchements que tests/data-safety.test.js).
function importer(app) { const FNS = ['parseRowsToProgramme', 'applyImportToApp', 'importSummaryText', 'addImportedRoutines', 'importData'];
  class FR { readAsText(f) { this.onload({ target: { result: f.text } }); } readAsArrayBuffer() {} }
  const fn = vm.runInContext('(function(setRoutines,setSessions,setSupps,setFatigue,setShowDataMenu,alert,confirm,FileReader,addCustomExercise,XLSX){\n' + FNS.map(n => fnSrc('function ' + n + '(')).join('\n') + '\nreturn importData; })', app.ctx)(
    v => app.setState('routines', v), v => app.setState('sessions', v), v => app.setState('supps', v), v => app.setState('fatigue', v), () => {}, () => {}, () => true, FR, () => true, undefined);
  return (name, data) => fn({ target: { files: [{ name, text: JSON.stringify(data) }], value: 'x' } }); }
const IMPORTED = [{ id: 10, date: '2026-11-01', routineName: 'PULL', exercises: [{ name: 'Exo B', sets: [{ weight: 40, reps: 10, rir: 0, rirSaisi: true, done: true }, { weight: 40, reps: 9, rir: 2, rirSaisi: false, done: true }, { weight: 40, reps: 8, done: true }] }] }];
t('IMPORT JSON (fichier d\'export) : RIR 0, rirSaisi et RIR absent importes tels quels ; anciennes seances intactes', async () => {
  const ls = store(); const app = await boot(ls); importer(app)('export.json', { version: 'tatanka-training-v6', sessions: IMPORTED });
  const stored = JSON.parse(ls.getItem(NS('it3_sessions'))); const imp = stored.find(s => s.id === 10).exercises[0].sets;
  assert.strictEqual(imp[0].rir, 0); assert.strictEqual(imp[0].rirSaisi, true); assert.strictEqual(imp[1].rirSaisi, false); assert.strictEqual('rir' in imp[2], false);
  assert.strictEqual(JSON.stringify(stored.filter(s => s.id !== 10)), JSON.stringify(OLD)); });
t('IMPORT autre format (liste de seances) : RIR 0 conserve (plus 2), RIR absent non invente, rirSaisi conserve', async () => {
  const ls = store(); const app = await boot(ls); importer(app)('liste.txt', { sessions: IMPORTED });
  const imp = JSON.parse(ls.getItem(NS('it3_sessions'))).find(s => s.date === '2026-11-01').exercises[0].sets;
  assert.strictEqual(imp[0].rir, 0); assert.strictEqual(imp[0].rirSaisi, true); assert.strictEqual(imp[2].rir, undefined); });
t('REIMPORT : une seance identique (meme charge, reps, RIR) reste un doublon, que rirSaisi soit present ou non', async () => {
  const ls = store(); const app = await boot(ls); const imp = importer(app);
  imp('export.json', { version: 'tatanka-training-v6', sessions: IMPORTED }); const n1 = JSON.parse(ls.getItem(NS('it3_sessions'))).length;
  imp('export.json', { version: 'tatanka-training-v6', sessions: IMPORTED }); imp('export.json', { version: 'tatanka-training-v6', sessions: OLD });
  assert.strictEqual(JSON.parse(ls.getItem(NS('it3_sessions'))).length, n1); });

(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
