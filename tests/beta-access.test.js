// Acces bêta cote appli : le VRAI code (_loadProfile, _fetchBeta, _isPremium, planOf, resolveCoach, hydratation, initRoutines) dans Node,
// avec faux localStorage et faux Supabase dont get_my_beta est pilote par le test. Pas de vrai navigateur ni de vrai serveur :
// les regles cote serveur (heure Supabase, protection des colonnes, fonctions d'administration) sont testees dans tests/sql-beta.test.js.
const H = require('./_harness.js'); const { openApp, mkStore, KS, UA, UB, assert, vm } = H;
const clone = x => JSON.parse(JSON.stringify(x)); const NS = (b, u) => b + '_u_' + (u || 'user-A');
const user = id => ({ id, email: id + '@x.fr' });
const rpcActive = (active, extra) => async n => (n === 'get_my_beta' ? { data: Object.assign({ active, started_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-31T00:00:00Z', server_now: '2026-10-10T00:00:00Z' }, extra || {}), error: null } : { data: null, error: { message: '?' } });
async function boot(ls, o) { o = o || {}; const app = openApp(ls); Object.assign(app.backend, { profile: o.profile || { premium: false }, rpc: o.rpc === undefined ? null : o.rpc }); app.mount(null); app.startSupabase(); await app.auth(o.event || 'INITIAL_SESSION', user(o.uid || 'user-A')); return app; }
const prem = app => app.ctx._isPremium(); const planOf = (app, p) => app.ctx.planOf(p);
const sessions = n => Array.from({ length: n }, (_, i) => ({ id: 5000 + i, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), routineName: 'R', exercises: [{ name: 'Developpe couche haltères', sets: [{ weight: 20 + i, reps: 8, rir: 2 }] }] }));
const routines = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: 'PERSO ' + (i + 1), day: 'LUNDI', color: '#f60', exercises: [{ name: 'Exo ' + i, sets: 3, repsTarget: '8-10' }] }));
function mondayOfThisWeek() { const d = new Date(), w = d.getDay(), m = new Date(d); m.setDate(d.getDate() - (w === 0 ? 6 : w - 1)); return m.toISOString().split('T')[0]; }
const account = (uid, n) => ({ [NS('it3_routines', uid)]: JSON.stringify(routines), [NS('it3_sessions', uid)]: JSON.stringify(sessions(n || 40)), [NS('it3_supps', uid)]: '[{"id":1,"produit":"Creatine"}]', [NS('it3_fatigue', uid)]: '{"sleep":1}', [NS('it3_cycle', uid)]: '{"startDate":"2026-08-09","num":2}', [NS('it3_customEx', uid)]: '["Mon exo"]', [NS('it3_sns_reset', uid)]: mondayOfThisWeek(), it3_loaded_uid: uid });
const tests = []; const t = (n, f) => tests.push([n, f]);
const userKeys = (ls, uid) => Object.keys(ls._m).filter(k => k.endsWith('_u_' + (uid || 'user-A'))).sort().map(k => k + '=' + ls._m[k]).join('\n');

t('8. UN TESTEUR BETA (serveur : actif) a les droits Premium Training V1 : _isPremium vrai, plan « premium », jamais premium_plus', async () => {
  const app = await boot(mkStore(account('user-A')), { rpc: rpcActive(true) }); assert.strictEqual(prem(app), true); assert.strictEqual(planOf(app, vm.runInContext('userProfile', app.ctx)), 'premium'); assert.ok(vm.runInContext('userProfile.beta_active', app.ctx) === true);
  assert.notStrictEqual(planOf(app, { beta_active: true }), 'premium_plus');
});
t('9. UN TESTEUR BETA RESTE SUR LE CANAL STABLE / V1 : jamais de V2, meme si la fonctionnalite est « lab » ou « publiee », meme avec cohorte beta', async () => {
  const app = await boot(mkStore(account('user-A')), { rpc: rpcActive(true), profile: { premium: false, cohort: 'beta', coach_channel: 'stable', plan: 'free' } }); const prof = vm.runInContext('userProfile', app.ctx);
  for (const st of ['off', 'lab', 'published']) assert.strictEqual(app.ctx.resolveCoach(prof, { coach_v2: { state: st, min_plan: 'premium_plus' } }).engine, 'v1', st);
  assert.strictEqual(app.ctx.resolveCoach(prof, { coach_v2: { state: 'lab' } }).channel, 'stable');
});
t('10. UN COMPTE NON BETA reste limite au fonctionnement gratuit (_isPremium faux, plan free)', async () => {
  const app = await boot(mkStore(account('user-A')), { rpc: rpcActive(false) }); assert.strictEqual(prem(app), false); assert.strictEqual(planOf(app, vm.runInContext('userProfile', app.ctx)), 'free');
});
t('SECURITE : seules les decisions du SERVEUR comptent — colonnes brutes beta_*, beta_active injecte dans la ligne de profil, ou reponses douteuses => pas de bêta', async () => {
  const fut = '2999-01-01T00:00:00Z';
  const cases = [['colonnes brutes futures mais serveur inactif', { profile: { beta_expires_at: fut, beta_started_at: '2026-01-01T00:00:00Z' }, rpc: rpcActive(false) }],
    ['beta_active injecte dans la ligne, serveur inactif', { profile: { beta_active: true, beta_expires_at: fut }, rpc: rpcActive(false) }],
    ['colonnes brutes futures, fonction serveur absente', { profile: { beta_expires_at: fut }, rpc: null }], ['erreur serveur', { profile: { beta_expires_at: fut }, rpc: async () => ({ data: null, error: { message: 'boom' } }) }],
    ['exception reseau', { rpc: async () => { throw new Error('offline'); } }], ['active = "true" (texte)', { rpc: async () => ({ data: { active: 'true' }, error: null }) }], ['active = 1', { rpc: async () => ({ data: { active: 1 }, error: null }) }],
    ['reponse vide', { rpc: async () => ({ data: null, error: null }) }], ['reponse = tableau', { rpc: async () => ({ data: [{ active: true }], error: null }) }]];
  for (const [label, o] of cases) { const app = await boot(mkStore(account('user-A')), o); assert.strictEqual(prem(app), false, label); }
});
t('7. L\'HEURE DU TELEPHONE NE CHANGE RIEN : horloge locale en 2040 ou en 2000, seul le resultat serveur decide', async () => {
  for (const [fakeYear, active, rawExp, expected] of [[2040, true, '2026-10-31T00:00:00Z', true], [2000, false, '2999-01-01T00:00:00Z', false], [2040, false, '2026-10-31T00:00:00Z', false], [2000, true, '2000-01-02T00:00:00Z', true]]) {
    const app = openApp(mkStore(account('user-A'))); app.backend.rpc = rpcActive(active); app.backend.profile = { beta_expires_at: rawExp }; vm.runInContext(`(function(){ var R = Date; var fake = new R(${fakeYear}, 5, 1).getTime(); Date = class extends R { constructor(...a) { super(...(a.length ? a : [fake])); } static now() { return fake; } }; })()`, app.ctx);
    app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', user('user-A')); assert.strictEqual(prem(app), expected, 'horloge ' + fakeYear + ' / serveur ' + active); }
});
t('11. EXPIRATION SANS PERTE : 40 seances, 6 routines, supps, cycle, exercices perso conserves octet pour octet ; retour au mode gratuit seulement', async () => {
  const ls = mkStore(account('user-A', 40)); const before = userKeys(ls); let app = await boot(ls, { rpc: rpcActive(true) }); assert.strictEqual(prem(app), true);
  app.backend.rpc = rpcActive(false); await app.auth('TOKEN_REFRESHED', user('user-A'));                                         // le serveur dit : expiree
  assert.strictEqual(prem(app), false, 'retour au mode gratuit'); assert.strictEqual(app.state('sessions').length, 40); assert.strictEqual(app.state('routines').length, 6); assert.strictEqual(userKeys(ls), before, 'aucune donnee modifiee');
  app = await boot(ls, { rpc: rpcActive(false) }); assert.strictEqual(prem(app), false); assert.strictEqual(userKeys(ls), before); assert.strictEqual(app.state('sessions').length, 40);       // apres relance
  assert.strictEqual(JSON.stringify(app.state('routines')), JSON.stringify(routines));
});
t('RE-ACTIVATION : prolongation / nouvelle bêta => droits retrouves, donnees toujours identiques', async () => {
  const ls = mkStore(account('user-A')); const before = userKeys(ls); let app = await boot(ls, { rpc: rpcActive(false) }); assert.strictEqual(prem(app), false);
  app = await boot(ls, { rpc: rpcActive(true) }); assert.strictEqual(prem(app), true); assert.strictEqual(userKeys(ls), before);
});
t('12. DECONNEXION / RECONNEXION : le statut revient du serveur, les donnees restent identiques ; rien n\'est garde apres deconnexion', async () => {
  const ls = mkStore(account('user-A')); const before = userKeys(ls); let app = await boot(ls, { rpc: rpcActive(true) }); assert.strictEqual(prem(app), true);
  await app.auth('SIGNED_OUT', null); assert.strictEqual(vm.runInContext('userProfile', app.ctx), null); assert.strictEqual(prem(app), false, 'apres deconnexion : pas d\'acces'); assert.strictEqual(vm.runInContext('_betaLast', app.ctx), null);
  app = await boot(ls, { rpc: rpcActive(true), event: 'SIGNED_IN' }); assert.strictEqual(prem(app), true); assert.strictEqual(userKeys(ls), before);
  const off = await boot(ls, { rpc: async () => { throw new Error('offline'); } }); assert.strictEqual(prem(off), false, 'apres relance sans reseau : pas de bêta (jamais garde dans le navigateur)');
});
t('EN SESSION : un simple raté reseau au renouvellement du jeton ne coupe pas un testeur actif ; apres relance de la page il faut le serveur', async () => {
  const ls = mkStore(account('user-A')); const app = await boot(ls, { rpc: rpcActive(true) }); app.backend.rpc = async () => { throw new Error('blip'); }; await app.auth('TOKEN_REFRESHED', user('user-A')); assert.strictEqual(prem(app), true);
  app.backend.rpc = rpcActive(false); await app.auth('TOKEN_REFRESHED', user('user-A')); assert.strictEqual(prem(app), false, 'des que le serveur repond : expiree');
});
t('13. ISOLATION DES COMPTES : A (bêta) puis B (non bêta) sur le meme appareil — pas d\'acces herite, donnees separees, A retrouve tout', async () => {
  const ls = mkStore(Object.assign(account('user-A', 40), account('user-B', 3))); const aBefore = userKeys(ls, 'user-A'), bBefore = userKeys(ls, 'user-B');
  let app = await boot(ls, { rpc: rpcActive(true), uid: 'user-A' }); assert.strictEqual(prem(app), true); assert.strictEqual(app.state('sessions').length, 40);
  await app.auth('SIGNED_OUT', null);
  app = await boot(ls, { rpc: async () => { throw new Error('serveur injoignable pour B'); }, uid: 'user-B', event: 'SIGNED_IN' }); assert.strictEqual(prem(app), false, 'B n\'herite pas de la bêta de A'); assert.strictEqual(app.state('sessions').length, 3);
  app.saveSession({ id: 8000, date: '2026-10-09', routineId: 1, routineName: 'B', exercises: [{ name: 'Exo', sets: [{ weight: 1, reps: 1, rir: 1 }] }] }); assert.strictEqual(userKeys(ls, 'user-A'), aBefore, 'les donnees de A n\'ont pas bouge');
  assert.strictEqual(JSON.parse(ls.getItem(NS('it3_sessions', 'user-B'))).length, 4); assert.notStrictEqual(userKeys(ls, 'user-B'), bBefore);
  app = await boot(ls, { rpc: rpcActive(true), uid: 'user-A', event: 'SIGNED_IN' }); assert.strictEqual(prem(app), true); assert.strictEqual(userKeys(ls, 'user-A'), aBefore); assert.strictEqual(app.state('sessions').length, 40);
});
t('PERSISTANCE DES SEANCES AVEC LA BETA : nouvelle seance enregistree par un testeur, fermeture / reouverture -> presente ; anciennes seances intactes', async () => {
  const ls = mkStore(account('user-A', 40)); let app = await boot(ls, { rpc: rpcActive(true) }); const old = JSON.parse(ls.getItem(NS('it3_sessions')));
  app.saveSession({ id: 9001, date: '2026-10-10', routineId: 1, routineName: 'PERSO 1', exercises: [{ name: 'Exo', sets: [{ weight: 50, reps: 8, rir: 2 }] }] });
  app = await boot(ls, { rpc: rpcActive(true) }); const now = JSON.parse(ls.getItem(NS('it3_sessions'))); assert.strictEqual(now.length, 41); assert.deepStrictEqual(now.slice(0, 40), old); assert.strictEqual(app.state('sessions').length, 41);
});
t('1. COMPTE NEUF : demarre proprement — aucune routine, seance, supplement, cycle, exercice perso ni mensuration inventes ; seules les cles de fonctionnement interne apparaissent', async () => {
  const ls = mkStore({}); const app = await boot(ls, { rpc: rpcActive(false) }); assert.strictEqual(app.state('routines').length, 0); assert.strictEqual(app.state('sessions').length, 0); assert.strictEqual(app.state('supps').length, 0);
  const keys = Object.keys(ls._m).map(k => k.replace('_u_user-A', '')); for (const forbidden of ['it3_sessions', 'it3_supps', 'it3_cycle', 'it3_customEx', 'it3_current_session', 'it3_prog_version']) assert.ok(!keys.includes(forbidden), 'cle inattendue : ' + forbidden);
  const r = ls.getItem(NS('it3_routines')); assert.ok(r === null || r === '[]'); const f = JSON.parse(ls.getItem(NS('it3_fatigue')) || '{}'); assert.ok(Object.values(f).every(v => v === 0), 'bilan de fatigue a zero (valeurs par defaut, pas de donnees)');
});
t('COMPTE EXISTANT AVEC BETA : aucune donnee modifiee par l\'ajout de la bêta (demarrage, rechargements, expiration) — programme personnel jamais remplace', async () => {
  const ls = mkStore(account('user-A', 108)); ls.setItem(NS('it3_prog_version'), 'imported-1'); const before = userKeys(ls);
  for (const act of [true, true, false, true]) { const app = await boot(ls, { rpc: rpcActive(act) }); assert.strictEqual(userKeys(ls), before); assert.strictEqual(app.state('routines').length, 6); assert.strictEqual(app.state('sessions').length, 108); }
});
(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
