// Lancer : node tests/data-safety.test.js            (INDEX_FILE=/chemin/index.html pour tester une autre version)
// Regle d'architecture testee : « Ma donnee reste ma donnee. Un import ajoute. Seul l'utilisateur decide de supprimer ou remplacer. »
// Execute le VRAI code d'index.html (initRoutines, hydratation, et le VRAI gestionnaire importData) dans Node, avec faux localStorage/Supabase.
// Donnees de reference : un export reel s'il est fourni (EXPORT_FILE=/chemin/export.json), sinon un jeu synthetique equivalent a l'export
// de David du 22/11 (141 seances, 6 routines, 3 exercices personnalises). Aucune donnee personnelle n'est stockee dans le depot.
// Les nombres attendus sont lus dans les donnees de reference (plus aucun nombre en dur). Pour exiger des nombres precis :
//   EXPORT_FILE=/chemin/export.json EXPECT_COUNTS=141/6/3 node tests/data-safety.test.js   (seances/routines/exercices perso)
// Aucun test n'ecrit sur un compte reel : tout se passe dans un faux localStorage en memoire.
const H = require('./_harness.js'); const { openApp, mkStore, KS, UA, UB, assert, SRC, vm, fs } = H;
const REAL = process.env.EXPORT_FILE || '/mnt/user-data/uploads/tatanka-training-backup-2026-10-03.json';
function synthetic() {
  const routines = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: 'ROUTINE ' + (i + 1) + ' - perso', day: 'JOUR', color: '#ff6600', exercises: [{ name: 'Exo perso ' + i, sets: 3 + (i % 2), repsTarget: '8-12', rest: 90 + i, warmupSets: i % 3, warmupLabel: '0-1', note: 'note ' + i }, { name: 'Exo B ' + i, sets: 2, repsTarget: '10-15', rest: 60 }] }));
  const sessions = Array.from({ length: 141 }, (_, i) => ({ id: 1700000000000 + i * 86400000, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), routineId: (i % 6) + 1, routineName: 'ROUTINE ' + ((i % 6) + 1) + ' - perso', exercises: [{ name: 'Exo perso ' + (i % 6), sets: [{ weight: 50 + i, reps: 8, rir: 2, done: true }] }] }));
  return { version: 'tatanka-training-v6', routines, sessions, supps: [{ id: 1, name: 'Creatine' }], fatigue: { sleep: 1, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0 }, cycle: { startDate: '2026-08-09', num: 2 }, customEx: ['Exo perso test A', 'Exo perso test B', 'Exo perso test C'] };
}
const USING_REAL = fs.existsSync(REAL); const EXP = USING_REAL ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : synthetic();
const N = EXP.sessions.length, NR = EXP.routines.length; // nombres attendus, lus dans les donnees de reference
const PROG_VERSION = (SRC.match(/const PROG_VERSION = "([^"]+)"/) || [])[1];
const clone = x => JSON.parse(JSON.stringify(x));
const U = 'user-A', NS = b => b + '_u_' + U, BOOKKEEPING = ['it3_loaded_uid', 'it3_legacy_migrated', 'tt_device_id'];

// Marqueur de la remise a zero hebdomadaire du bilan (comportement existant, sans rapport avec les routines/seances) :
// present sur tout compte reel ; on le fixe a la semaine courante pour que le test ne mesure que ce qui nous interesse.
function mondayOfThisWeek() { const d = new Date(), w = d.getDay(), m = new Date(d); m.setDate(d.getDate() - (w === 0 ? 6 : w - 1)); return m.toISOString().split('T')[0]; }
// Compte existant : routines + seances + tout le reste, tels que stockes par l'appli (chaines JSON).
function existingAccount(extra) {
  return mkStore(Object.assign({
    [NS('it3_routines')]: JSON.stringify(EXP.routines), [NS('it3_sessions')]: JSON.stringify(EXP.sessions), [NS('it3_supps')]: JSON.stringify(EXP.supps || []),
    [NS('it3_fatigue')]: JSON.stringify(EXP.fatigue || { sleep: 0 }), [NS('it3_cycle')]: JSON.stringify(EXP.cycle || { startDate: '2026-08-09', num: 2 }),
    [NS('it3_customEx')]: JSON.stringify(EXP.customEx || []), [NS('it3_sns_reset')]: mondayOfThisWeek(), it3_loaded_uid: U }, extra || {}));
}
const snap = ls => Object.assign({}, ls._m);
function assertUserDataIdentical(before, after, label) {
  Object.keys(before).forEach(k => { if (k === NS('it3_prog_version')) return; assert.strictEqual(after[k], before[k], label + ' : la cle ' + k + ' a change'); });
  const added = Object.keys(after).filter(k => !(k in before) && !BOOKKEEPING.includes(k));
  assert.deepStrictEqual(added, [], label + ' : cles inattendues creees : ' + added.join(', '));
}
async function boot(ls, identityKnown) { const app = openApp(ls); app.mount(identityKnown ? { id: U, email: 'a@x.fr' } : null); app.startSupabase(); await app.auth('INITIAL_SESSION', { id: U, email: 'a@x.fr' }); return app; }

const tests = []; const t = (n, f) => tests.push([n, f]);

// ───────── 1. initRoutines / it3_prog_version : un compte existant n'est JAMAIS reinitialise ─────────
const VERSION_CASES = [['version normale (' + PROG_VERSION + ')', PROG_VERSION], ['version absente', null], ['version imported-...', 'imported-1759500000000'], ['ancienne version', 'v5-old-2025']];
for (const [label, ver] of VERSION_CASES) {
  for (const known of [false, true]) {
    t('COMPTE EXISTANT, ' + label + (known ? ', identite connue au 1er rendu' : '') + ' : ' + NR + ' routines et ' + N + ' seances strictement intactes', async () => {
      const ls = existingAccount(ver ? { [NS('it3_prog_version')]: ver } : {}); const before = snap(ls);
      const app = await boot(ls, known);
      assertUserDataIdentical(before, snap(ls), label);
      assert.strictEqual(app.state('routines').length, EXP.routines.length); assert.deepStrictEqual(JSON.parse(JSON.stringify(app.state('routines'))), EXP.routines, 'etat React = routines du compte');
      assert.strictEqual(app.state('sessions').length, EXP.sessions.length, 'etat React = ' + N + ' seances');
      assert.strictEqual(ls.getItem(NS('it3_routines')), JSON.stringify(EXP.routines), 'routines stockees octet pour octet');
      assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(EXP.sessions), 'seances stockees octet pour octet');
    });
  }
}
t('COMPTE EXISTANT : demarrages repetes (3 relances) + sauvegarde d\'une nouvelle seance -> routines et anciennes seances toujours identiques', async () => {
  const ls = existingAccount({ [NS('it3_prog_version')]: 'imported-1759500000000' }); let app = await boot(ls, false);
  for (let i = 0; i < 3; i++) app = await boot(ls, false);
  const newS = { id: 9999, date: '2026-10-09', routineId: 1, routineName: 'X', exercises: [{ name: 'Exo perso 0', sets: [{ weight: 60, reps: 8, rir: 2 }] }] };
  app.saveSession(newS); app = await boot(ls, false);
  assert.strictEqual(ls.getItem(NS('it3_routines')), JSON.stringify(EXP.routines));
  const stored = JSON.parse(ls.getItem(NS('it3_sessions'))); assert.strictEqual(stored.length, EXP.sessions.length + 1);
  assert.deepStrictEqual(stored.slice(0, EXP.sessions.length).map(s => s.id), EXP.sessions.map(s => s.id));
});
t('routines partiellement corrompues : les valides sont conservees, la copie de securite contient le contenu d\'origine, rien n\'est perdu', async () => {
  const mixed = [EXP.routines[0], { id: 99, name: 'cassee' }, EXP.routines[1], null]; const raw = JSON.stringify(mixed); const ls = existingAccount({ [NS('it3_routines')]: raw });
  const app = await boot(ls, false); const kept = JSON.parse(ls.getItem(NS('it3_routines')));
  assert.deepStrictEqual(kept, [EXP.routines[0], EXP.routines[1]]); assert.strictEqual(app.state('routines').length, 2);
  const bk = Object.keys(ls._m).filter(k => k.startsWith(NS('it3_routines_backup_')) || k.startsWith('it3_routines_backup_')); assert.strictEqual(bk.length, 1, 'une copie de securite'); assert.strictEqual(ls.getItem(bk[0]), raw);
  assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(EXP.sessions));
});
t('routines illisibles (JSON casse) : copie de securite conservee avant de repartir du programme par defaut ; seances intactes', async () => {
  const ls = existingAccount({ [NS('it3_routines')]: '{casse' }); await boot(ls, false);
  const bk = Object.keys(ls._m).filter(k => k.includes('it3_routines_backup_')); assert.strictEqual(bk.length, 1); assert.strictEqual(ls.getItem(bk[0]), '{casse');
  assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(EXP.sessions));
});
t('compte avec seances mais SANS routine : seances intactes (comportement par defaut conserve pour les routines)', async () => {
  const ls = existingAccount(); ls.removeItem(NS('it3_routines')); const app = await boot(ls, false);
  assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(EXP.sessions)); assert.ok(app.state('routines').length >= 1);
});

// ───────── 2. IMPORT = AJOUT (vrai gestionnaire importData) ─────────
const FNS = ['parseRowsToProgramme', 'applyImportToApp', 'importSummaryText', 'addImportedRoutines', 'importData'];
function fnSrc(sig) { const i = SRC.indexOf('function ' + sig + '('); if (i < 0) throw new Error('introuvable: ' + sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function importer(app, opts) {
  opts = opts || {}; const log = { alerts: [], confirms: [], customEx: [] };
  class FR { readAsText(f) { this.onload({ target: { result: f.text } }); } readAsArrayBuffer() {} }
  const factory = vm.runInContext('(function(setRoutines,setSessions,setSupps,setFatigue,setShowDataMenu,alert,confirm,FileReader,addCustomExercise,XLSX){\n' + FNS.map(fnSrc).join('\n') + '\nreturn importData; })', app.ctx);
  const fn = factory(v => app.setState('routines', v), v => app.setState('sessions', v), v => app.setState('supps', v), v => app.setState('fatigue', v), () => {},
    m => log.alerts.push(m), m => { log.confirms.push(m); return opts.confirm !== false; }, FR, opts.realCustomEx ? n => { log.customEx.push(n); return app.ctx.addCustomExercise(n); } : n => log.customEx.push(n), undefined);
  return { log, run: (name, text) => fn({ target: { files: [{ name, text: typeof text === 'string' ? text : JSON.stringify(text) }], value: 'x' } }) };
}
async function importCtx(extra, identityKnown) { const ls = existingAccount(extra); const app = await boot(ls, identityKnown); return { ls, app }; }
const withVersion = d => Object.assign({ version: 'tatanka-training-v6' }, d);

t('IMPORT JSON de ton propre export (doublons) : rien ne change, toutes les seances (' + N + ') ignorees comme doublons, aucun mot « remplac » sans negation', async () => {
  const { ls, app } = await importCtx({ [NS('it3_prog_version')]: 'imported-1' }); const before = snap(ls); const imp = importer(app);
  imp.run('backup.json', withVersion({ sessions: EXP.sessions, routines: EXP.routines, supps: EXP.supps, fatigue: EXP.fatigue, cycle: EXP.cycle, customEx: EXP.customEx }));
  assertUserDataIdentical(before, snap(ls), 'import doublons'); assert.ok(/ajoutées : 0/.test(imp.log.alerts[0]) && imp.log.alerts[0].includes('ignorées : ' + EXP.sessions.length), imp.log.alerts[0]);
  assert.ok(!/remplac/i.test(imp.log.confirms[0].replace(/ni remplacé/g, '')), imp.log.confirms[0]);
});
t('IMPORT JSON : 1 nouvelle seance + 1 conflit d\'identifiant -> les ' + N + ' existantes intactes (memes objets, meme ordre relatif), conflit = nouvel identifiant', async () => {
  const { ls, app } = await importCtx(); const imp = importer(app); const orig = clone(EXP.sessions);
  const neu = { id: 777000000001, date: '2026-12-01', routineName: 'Nouvelle', exercises: [{ name: 'Exo X', sets: [{ weight: 10, reps: 10, rir: 2 }] }] };
  const conflict = Object.assign(clone(orig[5]), { exercises: [{ name: 'Autre exo', sets: [{ weight: 1, reps: 1, rir: 1 }] }] }); // meme id que orig[5], contenu different
  imp.run('b.json', withVersion({ sessions: [neu, conflict] }));
  const stored = JSON.parse(ls.getItem(NS('it3_sessions'))); assert.strictEqual(stored.length, N + 2);
  const idsAll = stored.map(s => String(s.id)); assert.strictEqual(new Set(idsAll).size, N + 2, 'identifiants uniques');
  const existingNow = stored.filter(s => orig.some(o => JSON.stringify(o) === JSON.stringify(s))); assert.strictEqual(existingNow.length, N, 'les ' + N + ' originales strictement identiques');
  assert.deepStrictEqual(existingNow.map(s => s.id), orig.map(s => s.id), 'ordre relatif conserve');
  assert.strictEqual(stored.find(s => JSON.stringify(s) === JSON.stringify(orig[5])) !== undefined, true, 'l\'ancienne seance au meme id garde son contenu');
  assert.ok(stored.some(s => s.exercises[0].name === 'Autre exo' && String(s.id) !== String(orig[5].id)), 'le conflit a recu un nouvel id');
  assert.strictEqual(app.state('sessions').length, N + 2);
});
t('IMPORT JSON routines : identique ignoree, meme nom mais contenu different = ajoutee « (import) », nouvelle ajoutee ; les 6 existantes intactes et en tete', async () => {
  const { ls, app } = await importCtx(); const imp = importer(app); const orig = clone(EXP.routines);
  const diff = Object.assign(clone(orig[0]), { exercises: [{ name: 'Exo different', sets: 5, repsTarget: '5', rest: 120 }] }); const brandNew = { id: 4242, name: 'PROGRAMME MORPHO', day: 'X', color: '#fff', exercises: [{ name: 'Exo M', sets: 3, repsTarget: '8' }] };
  imp.run('b.json', withVersion({ routines: [clone(orig[2]), diff, brandNew] }));
  const r = JSON.parse(ls.getItem(NS('it3_routines'))); assert.strictEqual(r.length, 8); assert.deepStrictEqual(r.slice(0, 6), orig);
  assert.ok(r[6].name.endsWith('(import)') && r[6].exercises[0].name === 'Exo different'); assert.strictEqual(r[7].name, 'PROGRAMME MORPHO');
  assert.strictEqual(new Set(r.map(x => String(x.id))).size, 8, 'identifiants de routines uniques'); assert.strictEqual(app.state('routines').length, 8);
});
t('REIMPORT du meme fichier (routine homonyme differente + seance en conflit) : aucune nouvelle copie, ni routine « (import 2) », ni seance', async () => {
  const { ls, app } = await importCtx(); const imp = importer(app); const orig = clone(EXP.routines);
  const file = withVersion({ sessions: [Object.assign(clone(EXP.sessions[3]), { exercises: [{ name: 'Autre', sets: [] }] })], routines: [Object.assign(clone(orig[1]), { exercises: [{ name: 'Different', sets: 5, repsTarget: '5' }] }), { id: 9001, name: 'NOUVELLE', exercises: [{ name: 'N', sets: 3 }] }] });
  imp.run('b.json', file); const after1 = snap(ls); assert.strictEqual(JSON.parse(after1[NS('it3_routines')]).length, 8); assert.strictEqual(JSON.parse(after1[NS('it3_sessions')]).length, EXP.sessions.length + 1);
  imp.run('b.json', file); imp.run('b.json', file); assert.deepStrictEqual(snap(ls), after1, 'reimporter le meme fichier ne change plus rien');
});
t('IMPORT JSON : supps, fatigue et cycle existants ne sont jamais remplaces ; renseignes seulement s\'ils sont absents', async () => {
  let { ls, app } = await importCtx(); const before = snap(ls); importer(app).run('b.json', withVersion({ supps: [{ id: 555, name: 'Autre' }], fatigue: { sleep: 3 }, cycle: { startDate: '2020-01-01', num: 9 } }));
  assert.strictEqual(ls.getItem(NS('it3_fatigue')), before[NS('it3_fatigue')]); assert.strictEqual(ls.getItem(NS('it3_cycle')), before[NS('it3_cycle')]);
  const supps = JSON.parse(ls.getItem(NS('it3_supps'))); assert.deepStrictEqual(supps.slice(0, (EXP.supps || []).length), EXP.supps || []); assert.ok(supps.some(x => x.id === 555));
  ({ ls, app } = await importCtx()); ls.removeItem(NS('it3_fatigue')); ls.removeItem(NS('it3_cycle')); app = await boot(ls, false);
  importer(app).run('b.json', withVersion({ fatigue: { sleep: 3 }, cycle: { startDate: '2020-01-01', num: 9 } }));
  assert.deepStrictEqual(JSON.parse(ls.getItem(NS('it3_fatigue'))), { sleep: 3 }); assert.strictEqual(JSON.parse(ls.getItem(NS('it3_cycle'))).num, 9);
});
t('IMPORT JSON dans un compte vide (nouvel appareil) : tout est restaure — l\'import par ajout reste utilisable pour une restauration', async () => {
  const ls = mkStore({ it3_loaded_uid: U }); const app = await boot(ls, false); ls.removeItem(NS('it3_routines')); const imp = importer(app);
  imp.run('b.json', withVersion({ sessions: EXP.sessions, routines: EXP.routines, supps: EXP.supps, fatigue: EXP.fatigue, cycle: EXP.cycle }));
  assert.strictEqual(JSON.parse(ls.getItem(NS('it3_sessions'))).length, N); assert.deepStrictEqual(JSON.parse(ls.getItem(NS('it3_routines'))), EXP.routines, 'les ' + NR + ' routines restaurees a l\'identique');
  assert.strictEqual(app.state('sessions').length, N); assert.strictEqual(app.state('routines').length, NR);
});
t('IMPORT : l\'utilisateur refuse la confirmation -> aucun changement ; fichier non reconnu -> aucun changement', async () => {
  const { ls, app } = await importCtx(); const before = snap(ls);
  importer(app, { confirm: false }).run('b.json', withVersion({ sessions: [{ id: 1, date: '2030-01-01', exercises: [] }], routines: [{ id: 1, name: 'Z', exercises: [] }] }));
  importer(app).run('b.json', { sessions: [{ id: 1, date: '2030-01-01', exercises: [] }] }); assert.deepStrictEqual(snap(ls), before);
});
t('IMPORT CSV : les routines existantes ne sont pas remplacees (ajout), plus aucun marqueur « imported- » ecrit ; refus = aucun changement', async () => {
  const { ls, app } = await importCtx({ [NS('it3_prog_version')]: PROG_VERSION }); const before = snap(ls); const csv = 'Séance;Jour;Exercice;Séries;Reps\nPROGRAMME CSV;LUNDI;Squat;4;6-8\nPROGRAMME CSV;LUNDI;Presse;3;10-12\n';
  importer(app, { confirm: false }).run('p.csv', csv); assert.deepStrictEqual(snap(ls), before);
  importer(app).run('p.csv', csv); const r = JSON.parse(ls.getItem(NS('it3_routines'))); assert.strictEqual(r.length, 7); assert.deepStrictEqual(r.slice(0, 6), EXP.routines); assert.strictEqual(r[6].name, 'PROGRAMME CSV');
  assert.strictEqual(ls.getItem(NS('it3_prog_version')), PROG_VERSION, 'le numero de version n\'est plus ecrase par imported-...'); assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(EXP.sessions));
  const again = importer(app); again.run('p.csv', csv); assert.strictEqual(JSON.parse(ls.getItem(NS('it3_routines'))).length, 7, 'reimporter le meme CSV n\'ajoute rien');
});
t('IMPORT autre extension (liste de seances) : fusion sans remplacer supps/fatigue/cycle ; routines jamais touchees', async () => {
  const { ls, app } = await importCtx(); const before = snap(ls);
  importer(app).run('s.txt', { sessions: [{ id: 888, date: '2026-11-11', routineName: 'T', exercises: [{ name: 'E', sets: [{ weight: '20', reps: '5', rir: '2' }] }] }], supps: [{ id: 9, name: 'Z' }], fatigue: { sleep: 9 }, cycle: { startDate: '2000-01-01', num: 7 }, routines: [{ id: 1, name: 'ZZ', exercises: [] }] });
  assert.strictEqual(ls.getItem(NS('it3_routines')), before[NS('it3_routines')]); assert.strictEqual(ls.getItem(NS('it3_fatigue')), before[NS('it3_fatigue')]); assert.strictEqual(ls.getItem(NS('it3_cycle')), before[NS('it3_cycle')]);
  assert.strictEqual(JSON.parse(ls.getItem(NS('it3_sessions'))).length, N + 1);
});

// ───────── 3. Regle generale sur les fonctions de fusion (toute source : JSON, Morphologie, futures) ─────────
function pure() { const c = { normalizeExName: x => x, Date, JSON, Object, Array, String, Math }; vm.createContext(c);
  const a = SRC.indexOf('// ── Regle d\'architecture'), b = SRC.indexOf('// ── fin des helpers d\'import non destructif'); if (a < 0 || b < 0) throw new Error('helpers introuvables (version sans correctif)');
  vm.runInContext(SRC.slice(a, b), c); return c; }
t('PROPRIETE (600 cas aleatoires) : l\'existant est toujours conserve a l\'identique et dans l\'ordre, jamais moins d\'elements, identifiants uniques, import idempotent', () => {
  const c = pure(); let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const mkS = (id, d, w) => ({ id, date: '2026-0' + (1 + d % 9) + '-1' + (d % 9), routineName: 'R' + (d % 3), exercises: [{ name: 'E' + (d % 4), sets: [{ weight: w, reps: 8, rir: 2 }] }] });
  for (let n = 0; n < 600; n++) {
    const existing = Array.from({ length: rnd(12) }, (_, i) => mkS(1000 + i, rnd(30), rnd(5))).sort((a, b) => a.date.localeCompare(b.date));
    const incoming = Array.from({ length: rnd(12) }, () => (rnd(4) === 0 && existing.length ? Object.assign(clone(existing[rnd(existing.length)]), rnd(2) ? { exercises: [{ name: 'Z', sets: [] }] } : {}) : mkS(1000 + rnd(30), rnd(30), rnd(5))));
    const frozen = JSON.stringify(existing); Object.freeze(existing); existing.forEach(Object.freeze);
    const r = c.mergeSessionsNonDestructive(existing, incoming);
    assert.strictEqual(JSON.stringify(existing), frozen, 'entree non modifiee');
    const kept = r.merged.filter(s => existing.includes(s)); assert.strictEqual(kept.length, existing.length, 'tous les existants presents (memes objets)');
    assert.deepStrictEqual(kept, existing, 'ordre relatif des existants conserve'); assert.ok(r.merged.length >= existing.length);
    assert.strictEqual(new Set(r.merged.map(s => String(s.id))).size, r.merged.length, 'identifiants uniques');
    const r2 = c.mergeSessionsNonDestructive(r.merged, incoming); assert.strictEqual(r2.added, 0, 'import idempotent'); assert.strictEqual(r2.merged.length, r.merged.length);
    const rr = c.mergeRoutinesNonDestructive([{ id: 1, name: 'A', exercises: [] }], [{ id: 1, name: 'A', exercises: [{ name: 'x' }] }, { id: 2, name: 'a', exercises: [{ name: 'y' }] }]);
    assert.strictEqual(rr.merged[0].name, 'A'); assert.strictEqual(new Set(rr.merged.map(x => x.name.toLowerCase())).size, rr.merged.length, 'pas de noms identiques');
    const rr2 = c.mergeRoutinesNonDestructive(rr.merged, [{ id: 1, name: 'A', exercises: [{ name: 'x' }] }, { id: 2, name: 'a', exercises: [{ name: 'y' }] }]); assert.strictEqual(rr2.added, 0, 'reimport de routines homonymes : aucune copie supplementaire');
  } });
t('applyImport ne modifie jamais ses entrees et renvoie les memes objets pour tout ce qui n\'est pas touche', () => {
  const c = pure(); const cur = { sessions: clone(EXP.sessions), routines: clone(EXP.routines), supps: clone(EXP.supps || []), fatigue: { sleep: 1 }, cycle: { startDate: '2026-01-01', num: 1 } };
  const frozen = JSON.stringify(cur); const data = clone(EXP); Object.freeze(cur); Object.keys(cur).forEach(k => Object.freeze(cur[k]));
  const r = c.applyImport(data, cur, {}); assert.strictEqual(JSON.stringify(cur), frozen); assert.deepStrictEqual(Object.keys(r.changed), []); assert.strictEqual(r.fatigue, cur.fatigue); assert.strictEqual(r.cycle, cur.cycle);
});

// ───────── 4. Export reel complet : seances, routines ET exercices personnalises (compte gratuit, vrai addCustomExercise) ─────────
// Charge le vrai bloc « exercices de base + exercices personnalises » d'index.html (DB, CUSTOM_EXERCISES, addCustomExercise)
// dans le contexte de l'appli, une fois l'identite connue, exactement comme reloadCustomEx() le fait apres la connexion.
function loadCustomExBlock(app) { const a = SRC.indexOf('const DB = {'), b = SRC.indexOf('const PROGRAMME = ['); if (a < 0 || b < 0) throw new Error('bloc exercices introuvable');
  vm.runInContext(SRC.slice(a, b), app.ctx); app.ctx.reloadCustomEx(); }
// Exercices perso de l'export ; si le fichier n'en contient pas (ex. copie tiree de la sauvegarde cloud, qui ne les garde pas),
// 3 noms de test sont utilises pour verifier quand meme le mecanisme.
const CUSTOM = (Array.isArray(EXP.customEx) && EXP.customEx.length) ? EXP.customEx : ['Exo perso test A', 'Exo perso test B', 'Exo perso test C'];
const FULL = () => withVersion({ sessions: clone(EXP.sessions), routines: clone(EXP.routines), supps: clone(EXP.supps || []), fatigue: clone(EXP.fatigue || {}), cycle: clone(EXP.cycle || null), customEx: clone(CUSTOM) });
const storedCustom = ls => JSON.parse(ls.getItem(NS('it3_customEx')) || '[]');
async function freshFreeAccount(withoutDefaultRoutines) { // compte de test neuf ; le faux profil Supabase renvoie premium:false (compte gratuit)
  const ls = mkStore({ it3_loaded_uid: U }); const app = await boot(ls, false); if (withoutDefaultRoutines) ls.removeItem(NS('it3_routines')); loadCustomExBlock(app); return { ls, app }; }

t('EXPORT DE REFERENCE : contenu lisible et nombres attendus' + (process.env.EXPECT_COUNTS ? ' (' + process.env.EXPECT_COUNTS + ')' : ''), () => {
  assert.ok(EXP.version && EXP.version.includes('tatanka-training'), 'version tatanka-training');
  assert.ok(EXP.sessions.every(s => s && typeof s.date === 'string' && Array.isArray(s.exercises)), 'toutes les seances sont valides');
  assert.ok(EXP.routines.every(r => r && r.name && Array.isArray(r.exercises)), 'toutes les routines sont valides');
  if (process.env.EXPECT_COUNTS) { const [es, er, ec] = process.env.EXPECT_COUNTS.split('/').map(x => parseInt(x, 10));
    assert.strictEqual(N, es, 'nombre de seances dans le fichier'); assert.strictEqual(NR, er, 'nombre de routines dans le fichier');
    if (!isNaN(ec)) assert.strictEqual((EXP.customEx || []).length, ec, 'nombre d\'exercices personnalises dans le fichier (champ customEx)'); }
});
t('IMPORT JSON, compte GRATUIT vide : toutes les seances, toutes les routines et tous les exercices perso (' + CUSTOM.length + ') sont importes et stockes', async () => {
  const { ls, app } = await freshFreeAccount(true); const imp = importer(app, { realCustomEx: true });
  imp.run('export.json', FULL());
  const sessions = JSON.parse(ls.getItem(NS('it3_sessions'))); assert.strictEqual(sessions.length, N, 'seances stockees');
  assert.deepStrictEqual(sessions.map(s => s.id), EXP.sessions.map(s => s.id), 'memes seances, meme ordre');
  assert.strictEqual(JSON.stringify(sessions), JSON.stringify(EXP.sessions), 'contenu des seances identique octet pour octet');
  assert.deepStrictEqual(JSON.parse(ls.getItem(NS('it3_routines'))), EXP.routines, 'les ' + NR + ' routines a l\'identique');
  assert.deepStrictEqual(storedCustom(ls), CUSTOM, 'exercices perso enregistres dans it3_customEx du compte');
  assert.deepStrictEqual(Array.from(app.ctx.CUSTOM_EXERCISES), CUSTOM, 'exercices perso disponibles dans la liste « MES EXERCICES »');
  assert.strictEqual(app.state('sessions').length, N); assert.strictEqual(app.state('routines').length, NR);
  assert.ok(/Séances ajoutées : /.test(imp.log.alerts[0]) && imp.log.alerts[0].includes('ajoutées : ' + N), imp.log.alerts[0]);
});
t('IMPORT JSON, compte GRATUIT neuf (programme par defaut deja cree au 1er demarrage) : seances et exercices perso complets, routines par defaut conservees', async () => {
  const { ls, app } = await freshFreeAccount(false); const defaults = JSON.parse(ls.getItem(NS('it3_routines')) || '[]'); assert.ok(defaults.length > 0, 'programme par defaut cree');
  importer(app, { realCustomEx: true }).run('export.json', FULL());
  assert.strictEqual(JSON.parse(ls.getItem(NS('it3_sessions'))).length, N); assert.deepStrictEqual(storedCustom(ls), CUSTOM);
  const r = JSON.parse(ls.getItem(NS('it3_routines'))); assert.deepStrictEqual(r.slice(0, defaults.length), defaults, 'routines par defaut intactes et en tete');
  const base = n => String(n).replace(/ \(import(?: \d+)?\)$/i, '');
  const same = (x, y) => require('util').isDeepStrictEqual(x, y); // comparaison sans tenir compte de l'ordre des champs
  EXP.routines.forEach(er => assert.ok(r.some(x => base(x.name) === er.name && same(x.exercises, er.exercises)), 'routine de l\'export presente (ajoutee, ou deja identique au programme par defaut) : ' + er.name));
  console.log('       info : compte neuf = ' + defaults.length + ' routines par defaut ; apres import = ' + r.length + ' routines (' + (r.length - defaults.length) + ' ajoutees, ' + (NR - (r.length - defaults.length)) + ' identiques au programme par defaut donc ignorees)');
});
t('REIMPORT du meme export complet : 0 seance, 0 routine et 0 exercice perso en double', async () => {
  const { ls, app } = await freshFreeAccount(true); const imp = importer(app, { realCustomEx: true });
  imp.run('export.json', FULL()); const after1 = snap(ls); imp.run('export.json', FULL()); imp.run('export.json', FULL());
  assert.deepStrictEqual(snap(ls), after1, 'aucun changement au 2e et 3e import'); assert.strictEqual(storedCustom(ls).length, CUSTOM.length);
});
t('EXERCICES PERSO : deja presents -> pas de doublon ; meme nom qu\'un exercice de base -> ignore ; les exercices perso existants restent', async () => {
  const ls = existingAccount({ [NS('it3_customEx')]: JSON.stringify(['Deja la']) }); const app = await boot(ls, false); loadCustomExBlock(app);
  importer(app, { realCustomEx: true }).run('b.json', withVersion({ customEx: ['Deja la', 'Squat barre', CUSTOM[0], 42] }));
  assert.deepStrictEqual(storedCustom(ls), ['Deja la', CUSTOM[0]]);
  assert.strictEqual(ls.getItem(NS('it3_sessions')), JSON.stringify(EXP.sessions), 'seances intactes'); assert.strictEqual(ls.getItem(NS('it3_routines')), JSON.stringify(EXP.routines), 'routines intactes');
});

(async () => { let fail = 0; console.log('Fichier teste : ' + H.FILE + ' | donnees de reference : ' + (USING_REAL ? 'export reel ' + REAL + ' (' + N + ' seances, ' + NR + ' routines, ' + (EXP.customEx || []).length + ' exercices perso)' : 'jeu synthetique (' + N + ' seances, ' + NR + ' routines, ' + EXP.customEx.length + ' exercices perso)'));
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
