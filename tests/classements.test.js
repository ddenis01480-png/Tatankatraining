// Lancer : node tests/classements.test.js
//          EXPORT_FILE=/chemin/export.json node tests/classements.test.js   (ajoute les controles sur un export reel, lu seulement)
//
// Etape 2b-1 (moteur 0.16.0) : l'utilisateur precise ou corrige les muscles d'un exercice.
//   - Choix rattache a l'exercice (son nom) et au compte, jamais a une routine ni a une seance ; rien n'est ecrit dans les seances.
//   - Applique au calcul (seances passees et futures) : recuperation, volume, frequence, futurs diagnostics.
//   - Enregistrement automatique (cle locale du compte) ; export / import inclus sans action ; un import AJOUTE seulement.
//   - Interface simple : aucun vocabulaire technique, aucun reglage de sauvegarde ou de synchronisation.
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const H = require('./_harness.js'); const { openApp, mkStore, SRC } = H;
const E = require(path.join(__dirname, '..', 'coach-engine.js'));
const plain = o => JSON.parse(JSON.stringify(o));
const S = (w, r) => ({ weight: w, reps: r, rir: 2, done: true });
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const ex = (name, n) => ({ name, repsTarget: '8-12', sets: Array.from({ length: n }, () => S(20, 10)) });
const T0 = new Date('2026-11-26T12:00:00Z');
const tests = []; const t = (n, f) => tests.push([n, f]);

// ═════════ 1. Moteur : format, controles, fusion ═════════
t('Version 0.16.0 ou plus ; noms des muscles en langage courant (Epaules - avant / cote / arriere), un libelle par groupe', () => {
  assert.ok(/^0\.(1[6-9]|[2-9]\d)\./.test(E.VERSION), E.VERSION);
  assert.deepStrictEqual(Object.keys(E.LIBELLES_GROUPES), E.GROUPES.slice());
  assert.deepStrictEqual(['Deltoïde ant.', 'Deltoïde lat.', 'Deltoïde post.'].map(E.libelleGroupe), ['Épaules – avant', 'Épaules – côté', 'Épaules – arrière']); });
t('Lecture tolerante : absent, illisible ou partiel -> jamais d\'erreur, on garde ce qui est lisible', () => {
  [null, undefined, 'x', 3, [], {}, { exercices: null }, { exercices: 'x' }].forEach(b => assert.deepStrictEqual(E.lireClassements(b), { version: 1, exercices: {} }));
  const r = E.lireClassements({ exercices: { A: { principal: 'Dos', secondaires: ['Biceps', 'Dos', 3] }, B: { catalogue: true }, C: null, D: { secondaires: [] }, '': { principal: 'Dos' } } });
  assert.deepStrictEqual(r.exercices, { A: { principal: 'Dos', secondaires: ['Biceps'], modifieLe: null }, B: { catalogue: true, modifieLe: null } }); });
t('Controles : muscle principal parmi les 15 groupes ; indirects valides, sans doublon, sans le principal, dans l\'ordre des groupes', () => {
  assert.strictEqual(E.validerClassement('Épaules', []), null); assert.strictEqual(E.validerClassement('', []), null); assert.strictEqual(E.validerClassement(null), null);
  assert.deepStrictEqual(E.validerClassement('Fessiers', ['Ischio-jambiers', 'Fessiers', 'Inconnu', 'Ischio-jambiers', 'Quadriceps']), { principal: 'Fessiers', secondaires: ['Quadriceps', 'Ischio-jambiers'] }); });
t('Choisir : nouvel objet date (l\'ancien n\'est pas modifie) ; « revenir au choix par defaut » garde une trace ; choix invalide refuse', () => {
  const vide = E.classementsVides(), avant = JSON.stringify(vide);
  const a = E.choisirClassement(vide, 'Bel', { principal: 'Mollets', secondaires: [] }, T0);
  assert.strictEqual(JSON.stringify(vide), avant); assert.deepStrictEqual(a.exercices.Bel, { principal: 'Mollets', secondaires: [], modifieLe: T0.toISOString() });
  const b = E.choisirClassement(a, 'Bel', { catalogue: true }, T0); assert.deepStrictEqual(b.exercices.Bel, { catalogue: true, modifieLe: T0.toISOString() });
  assert.strictEqual(E.choixUtilisateur(b, 'Bel'), null); assert.deepStrictEqual(E.choixUtilisateur(a, 'Bel').principal, 'Mollets');
  assert.strictEqual(E.choisirClassement(a, 'Bel', { principal: 'Épaules' }), null); assert.strictEqual(E.choisirClassement(a, '  ', { principal: 'Dos' }), null); });
t('Moteur : le choix passe avant le classement par defaut ; « choix par defaut » et choix devenus invalides ne sont pas appliques', () => {
  let st = E.choisirClassement(null, 'Développé militaire haltères', { principal: 'Deltoïde lat.', secondaires: ['Trapèzes'] }, T0);
  st = E.choisirClassement(st, 'Leg press', { catalogue: true }, T0); st.exercices['Vieux'] = { principal: 'Épaules', secondaires: [], modifieLe: null };
  const o = { classements: E.classementsMoteur(st) };
  assert.deepStrictEqual(Object.keys(o.classements), ['Développé militaire haltères']);
  assert.deepStrictEqual(E.classerExercice('Développé militaire haltères', o), { principal: 'Deltoïde lat.', secondaires: ['Trapèzes'], mouvement: null, source: 'utilisateur' });
  assert.strictEqual(E.classerExercice('Leg press', o).source, 'catalogue');
  assert.deepStrictEqual(E.classementsARevoir(st), ['Vieux'], 'groupe disparu : a revoir, jamais supprime'); assert.ok('Vieux' in E.lireClassements(st).exercices); });
t('Noms corriges par l\'appli (EXERCISE_NAME_FIXES) : l\'ancien nom suit le choix du nom corrige', () => {
  const fixes = { 'Leg extension': 'Leg extension machine' };
  const st = E.choisirClassement(null, 'Leg extension machine', { principal: 'Quadriceps', secondaires: ['Fessiers'] }, T0), o = { classements: E.classementsMoteur(st, fixes) };
  assert.strictEqual(E.classerExercice('Leg extension', o).source, 'utilisateur'); assert.deepStrictEqual(E.classerExercice('Leg extension', o).secondaires, ['Fessiers']);
  assert.strictEqual(E.choixUtilisateur(st, 'Leg extension', fixes).principal, 'Quadriceps'); });
t('Import : on AJOUTE seulement ; un choix deja fait (meme « par defaut ») est toujours conserve ; rien n\'est supprime ; entrees inchangees', () => {
  let local = E.choisirClassement(null, 'A', { principal: 'Dos', secondaires: [] }, T0); local = E.choisirClassement(local, 'B', { catalogue: true }, T0);
  local.exercices.Ancien = { principal: 'Épaules', secondaires: [], modifieLe: null };
  const imp = { version: 1, exercices: { A: { principal: 'Biceps', secondaires: [] }, B: { principal: 'Triceps', secondaires: [] }, C: { principal: 'Mollets', secondaires: ['Fessiers'] },
    D: { principal: 'Épaules', secondaires: [] }, E: { catalogue: true }, A2: { principal: 'Dos', secondaires: [] } } };
  const avL = JSON.stringify(local), avI = JSON.stringify(imp);
  const f = E.fusionnerClassements(local, imp);
  assert.strictEqual(JSON.stringify(local), avL); assert.strictEqual(JSON.stringify(imp), avI);
  assert.deepStrictEqual([f.ajoutes, f.conserves, f.identiques, f.invalides, f.change], [3, 2, 0, 1, true]);
  assert.strictEqual(f.classements.exercices.A.principal, 'Dos'); assert.strictEqual(f.classements.exercices.B.catalogue, true);
  assert.strictEqual(f.classements.exercices.C.principal, 'Mollets'); assert.ok(!('D' in f.classements.exercices), 'groupe inconnu importe : non ajoute');
  assert.ok('Ancien' in f.classements.exercices, 'un choix local n\'est jamais retire');
  const re = E.fusionnerClassements(f.classements, imp); assert.deepStrictEqual([re.ajoutes, re.change], [0, false], 'reimporter le meme fichier ne change rien');
  assert.deepStrictEqual(E.fusionnerClassements(local, undefined).ajoutes, 0); });
t('Applique a TOUT l\'historique et aux calculs (volume, frequence, recuperation, performance) sans modifier aucune seance', () => {
  const ss = [sess(Date.UTC(2026, 10, 18, 17), '2026-11-18', [ex('Bel', 3)]), sess(Date.UTC(2026, 10, 20, 17), '2026-11-20', [ex('Bel', 4)])], avant = JSON.stringify(ss);
  const N = E.normaliserSeances(ss);
  const sans = E.volumeMuscles(N, { fin: '2026-11-21' }); assert.deepStrictEqual(sans.nonClasses.map(x => x.nom), ['Bel']);
  const o = { classements: E.classementsMoteur(E.choisirClassement(null, 'Bel', { principal: 'Mollets', secondaires: ['Fessiers'] }, T0)) };
  const v = E.volumeMuscles(N, Object.assign({ fin: '2026-11-21' }, o));
  assert.deepStrictEqual([v.muscles.Mollets.direct.series, v.muscles.Mollets.direct.jours, v.muscles.Fessiers.indirect.series, v.nonClasses.length], [7, 2, 7, 0]);
  const r = E.dernieresSollicitations(N, Date.UTC(2026, 10, 21, 17), o); assert.strictEqual(r.groupes.Mollets.dernierePrincipale.date, '2026-11-20');
  assert.ok(E.performanceMuscles(N, Object.assign({ fin: '2026-11-21' }, o)).muscles.Mollets);
  assert.strictEqual(JSON.stringify(ss), avant, 'seances jamais modifiees'); });

// ═════════ 2. Appli (vrai code d'index.html) ═════════
t('Appli : cle de stockage propre au compte (it3_classements) ; recuperation (Seance et Bilan) calculee avec les choix', () => {
  assert.ok(/classements: "it3_classements"/.test(SRC));
  const fn = s => { const i = SRC.indexOf(s); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
  let stock = E.choisirClassement(null, 'Bel', { principal: 'Mollets', secondaires: [] }, T0);
  const ctx = { JSON, Object, Array, String, Number, Date, KEYS: { classements: 'it3_classements' }, load: k => (k === 'it3_classements' ? stock : null), coachEngine: () => E,
    EXERCISE_NAME_FIXES: { 'Leg extension': 'Leg extension machine' } };
  vm.createContext(ctx); vm.runInContext(['function normalizeExName(n) { return EXERCISE_NAME_FIXES[n] || n; }', fn('function classementsStock('), fn('function cleExercice('), fn('function optionsMuscles('), fn('function recupSollicitations(')].join('\n'), ctx);
  const ss = [sess(Date.UTC(2026, 10, 20, 17), '2026-11-20', [ex('Bel', 3)])];
  const r = ctx.recupSollicitations(ss, null, Date.UTC(2026, 10, 21, 17)); assert.strictEqual(r.groupes.Mollets.dernierePrincipale.date, '2026-11-20'); assert.strictEqual(r.nonClasses.length, 0);
  const rs = ctx.recupSollicitations(ss, ['Bel'], Date.UTC(2026, 10, 21, 17)); assert.deepStrictEqual(Object.keys(rs.groupes), ['Mollets'], 'seance qui demarre : groupes de ses exercices, choix compris');
  stock = E.choisirClassement(stock, 'Bel', { catalogue: true }, T0); assert.strictEqual(ctx.recupSollicitations(ss, null, Date.UTC(2026, 10, 21, 17)).nonClasses.length, 1, 'retour au choix par defaut immediat'); });
t('Appli : export avec les choix (sans action de l\'utilisateur) ; import qui ajoute via le moteur ; resume en francais simple', () => {
  assert.ok(/classements: load\(KEYS\.classements\) \|\| \{ version: 1, exercices: \{\} \}/.test(SRC), 'export');
  assert.ok(/CEi\.fusionnerClassements\(load\(KEYS\.classements\), data\.classements\)/.test(SRC) && /if \(f\.change\) save\(KEYS\.classements, f\.classements\)/.test(SRC), 'import par ajout');
  assert.ok(SRC.includes("Muscles d'exercices ajoutés : ") && SRC.includes('Tes choix de muscles déjà faits sont conservés : '));
  assert.ok(!/autoBackup\([^)]*classements/.test(SRC), '2b-1 : aucun envoi cloud'); });
t('Appli : vrai import JSON (importData) dans un faux navigateur : choix ajoutes, choix existants conserves, seances et routines inchangees', async () => {
  const U = 'user-A', NS = b => b + '_u_' + U;
  const routines = [{ id: 1, name: 'R1', exercises: [{ name: 'Bel', sets: 3, repsTarget: '8-12' }] }], sessions = [sess(1700000000000, '2026-11-20', [ex('Bel', 3)])];
  const local = E.choisirClassement(null, 'A', { principal: 'Dos', secondaires: [] }, T0);
  const ls = mkStore({ [NS('it3_routines')]: JSON.stringify(routines), [NS('it3_sessions')]: JSON.stringify(sessions), [NS('it3_classements')]: JSON.stringify(local),
    [NS('it3_prog_version')]: 'imported-1', it3_loaded_uid: U });
  const app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', { id: U, email: 'a@x.fr' });
  app.ctx.coachEngine = () => E;
  const FNS = ['parseRowsToProgramme', 'applyImportToApp', 'importSummaryText', 'addImportedRoutines', 'importData'];
  const fn = s => { const i = SRC.indexOf('function ' + s + '('); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
  const alerts = []; class FR { readAsText(f) { this.onload({ target: { result: f.text } }); } readAsArrayBuffer() {} }
  const imp = vm.runInContext('(function(setRoutines,setSessions,setSupps,setFatigue,setShowDataMenu,alert,confirm,FileReader,addCustomExercise,XLSX){\n' + FNS.map(fn).join('\n') + '\nreturn importData; })', app.ctx)(
    () => {}, () => {}, () => {}, () => {}, () => {}, m => alerts.push(m), () => true, FR, () => {}, undefined);
  const avantS = ls.getItem(NS('it3_sessions')), avantR = ls.getItem(NS('it3_routines'));
  const fichier = { version: 'tatanka-training-v6', sessions, routines, classements: { version: 1, exercices: { A: { principal: 'Biceps', secondaires: [] }, Bel: { principal: 'Mollets', secondaires: [] } } } };
  imp({ target: { files: [{ name: 'b.json', text: JSON.stringify(fichier) }], value: 'x' } });
  const st = JSON.parse(ls.getItem(NS('it3_classements')));
  assert.strictEqual(st.exercices.A.principal, 'Dos', 'choix deja fait conserve'); assert.strictEqual(st.exercices.Bel.principal, 'Mollets', 'choix manquant ajoute');
  assert.strictEqual(ls.getItem(NS('it3_sessions')), avantS); assert.strictEqual(ls.getItem(NS('it3_routines')), avantR);
  assert.ok(alerts.some(a => a.includes("Muscles d'exercices ajoutés : 1") && a.includes('déjà faits sont conservés : 1')), alerts.join(' | '));
  // Ancien export sans choix de muscles : rien ne change cote choix
  const avantC = ls.getItem(NS('it3_classements')); imp({ target: { files: [{ name: 'c.json', text: JSON.stringify({ version: 'tatanka-training-v6', sessions, routines }) }], value: 'x' } });
  assert.strictEqual(ls.getItem(NS('it3_classements')), avantC); });
t('Interface : panneau « Muscles » simple, en francais courant, sans vocabulaire technique ni reglage de sauvegarde', () => {
  const i = SRC.indexOf('function MusclesPanel('), j = SRC.indexOf('function RoutinesTab(');
  const panneau = SRC.slice(i, j).replace(/\/\/.*$/gm, '');
  const rendu = panneau.slice(panneau.indexOf('  return (')), textes = [...rendu.matchAll(/"([^"\n]*)"/g)].map(m => m[1]).filter(x => /[a-zé] [a-zé]/i.test(x)).concat([...panneau.slice(panneau.indexOf('  return (')).matchAll(/>([^<>{}=]*[A-Za-zé][^<>{}=]*)</g)].map(m => m[1].trim()).filter(Boolean));
  ['Quel muscle cet exercice travaille-t-il surtout ?', 'D\'autres muscles travaillent aussi ?', '(facultatif)', 'Ce choix s\'applique à cet exercice partout, même dans tes séances passées.',
   'Valider', 'Revenir au choix par défaut', 'Annuler', 'Enregistré ✓'].forEach(x => assert.ok(panneau.includes(x), x));
  assert.ok(textes.includes('Muscles reconnus automatiquement') && textes.includes('Muscles choisis par toi'), JSON.stringify(textes));
  textes.forEach(x => assert.ok(!/cloud|synchro|export|import|json|sauvegard|catalogue|classement|stockage|serveur|base de donn/i.test(x), 'mot technique : ' + x));
  assert.ok(SRC.includes('"Muscles à préciser"') && SRC.includes('aPreciser(ex) ? "Muscles à préciser" : "Muscles"'));
  assert.ok(/!estActivation\(ex\) && !CEm\.classerExercice/.test(SRC), 'pas de demande pour un exercice d\'activation'); });
t('Interface : « Enregistré » seulement apres relecture de ce qui est reellement enregistre ; sinon message simple', () => {
  const p = SRC.slice(SRC.indexOf('function MusclesPanel('), SRC.indexOf('function RoutinesTab('));
  assert.ok(/save\(KEYS\.classements, nouveau\);[\s\S]*const relu = classementsStock\(\);[\s\S]*setEtat\(ok \? "ok" : "erreur"\)/.test(p));
  assert.ok(p.includes("Impossible d'enregistrer pour l'instant. Réessaie dans un moment.")); });

// ═════════ 3. Ton export (lecture seule) ═════════
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Ton export : sans choix enregistre, tous les calculs sont identiques au caractere pres ; avec un choix (Bel), seul ce qui concerne cet exercice change', () => {
  const brut = JSON.stringify(EXP), N = E.normaliserSeances(EXP.sessions), fin = EXP.sessions.map(s => s.date).sort().pop().slice(0, 10);
  const vide = { classements: E.classementsMoteur(null) };
  assert.strictEqual(JSON.stringify(E.volumeMuscles(N, Object.assign({ fin }, vide))), JSON.stringify(E.volumeMuscles(N, { fin })));
  assert.strictEqual(JSON.stringify(E.dernieresSollicitations(N, Date.parse(fin + 'T23:00:00Z'), vide)), JSON.stringify(E.dernieresSollicitations(N, Date.parse(fin + 'T23:00:00Z'))));
  const o = { classements: E.classementsMoteur(E.choisirClassement(null, 'Bel', { principal: 'Mollets', secondaires: [] }, T0)) };
  assert.strictEqual(JSON.stringify(E.volumeMuscles(N, Object.assign({ fin }, o))), JSON.stringify(E.volumeMuscles(N, { fin })), '« Bel » n\'a aucune seance : rien ne change');
  assert.strictEqual(JSON.stringify(EXP), brut);
  assert.ok(!('classements' in EXP) || typeof EXP.classements === 'object', 'ancien export sans choix : accepte'); });

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
