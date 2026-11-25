// Bêta PRIVÉE : aucun accès gratuit. Le VRAI code d'index.html (_betaGateApply, _fetchBeta, _loadProfile, flux de connexion, autoBackup,
// _syncFromCloud) dans Node, avec faux localStorage, faux DOM et faux Supabase dont get_my_beta est piloté par le test.
// Ce n'est ni un vrai navigateur ni un vrai serveur : les règles serveur (beta_grant, colonnes protégées) sont testées dans sql-beta.test.js.
const H = require('./_harness.js'); const { openApp, mkStore, SRC, assert } = H;
const tests = []; const t = (n, f) => tests.push([n, f]);
const MSG = "Accès bêta privé : ton compte est créé, en attente d'autorisation";
const U = 'user-A', NS = b => b + '_u_' + U;
const sess = n => Array.from({ length: n }, (_, i) => ({ id: 7000 + i, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), routineName: 'R', exercises: [{ name: 'Squat barre', sets: [{ weight: 60 + i, reps: 8, rir: 2 }] }] }));
const rout = [{ id: 1, name: 'PERSO 1', day: 'LUNDI', color: '#f60', exercises: [{ name: 'Squat barre', sets: 3, repsTarget: '8-10' }] }];
const account = () => ({ tt_device_id: 'dev_test', [NS('it3_sessions')]: JSON.stringify(sess(40)), [NS('it3_routines')]: JSON.stringify(rout), [NS('it3_supps')]: '[{"id":1,"produit":"Creatine"}]' });
const rpcServer = active => async n => (n === 'get_my_beta' ? { data: { active, started_at: '2026-11-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', server_now: '2026-11-10T00:00:00Z' }, error: null } : { data: null, error: { message: 'absent' } });
const rpcDown = async () => ({ data: null, error: { message: 'reseau' } });
const keys = ls => Object.keys(ls._m).filter(k => k.endsWith('_u_' + U)).sort().map(k => k + '=' + ls._m[k]).join('\n');

// Démarre l'appli avec le verrou ACTIF (les harnais le coupent par défaut) et un faux DOM qui garde l'état de chaque élément.
async function boot(ls, o) {
  o = o || {}; const app = openApp(ls); app.ctx.BETA_GATE = o.gate === undefined ? true : o.gate;
  const els = {}; app.ctx.document.getElementById = id => (els[id] = els[id] || { style: {}, textContent: '' });
  const fetches = []; app.ctx.fetch = u => { fetches.push(String(u)); return new Promise(() => {}); };
  Object.assign(app.backend, { profile: o.profile || { premium: false }, rpc: o.rpc === undefined ? rpcServer(false) : o.rpc });
  app.mount(null); app.startSupabase(); await app.auth(o.event || 'INITIAL_SESSION', { id: U, email: 'testeur@x.fr' });
  return Object.assign(app, { els, fetches, wait: () => els['tt-beta-wait'], auth_: () => els['tt-auth-screen'] || { style: {} }, blocked: () => app.ctx._betaGateBlocked });
}

t('page : écran d\'attente présent, masqué par défaut, au-dessus de la connexion, avec Actualiser et Se déconnecter ; message exact', () => {
  const { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.TEST_MODULES || '/tmp/jsd/node_modules', process.cwd()] }));
  const d = new JSDOM(SRC).window.document, w = d.getElementById('tt-beta-wait'), a = d.getElementById('tt-auth-screen');
  assert.ok(w, 'tt-beta-wait absent'); assert.strictEqual(w.style.display, 'none'); assert.ok(parseInt(w.style.zIndex) > parseInt(a.style.zIndex), 'doit recouvrir la connexion');
  const btns = [...w.querySelectorAll('button')].map(b => b.textContent.trim()); assert.deepStrictEqual(btns, ['ACTUALISER', 'SE DÉCONNECTER']);
  assert.ok(SRC.includes(MSG), 'message exact absent'); assert.ok(SRC.includes('var BETA_GATE = true;'), 'verrou actif par défaut');
});
t('compte SANS bêta (gratuit) : BLOQUÉ — écran d\'attente affiché, message exact, connexion jamais masquée, aucune synchro cloud', async () => {
  const app = await boot(mkStore(account()), { profile: { premium: false } });
  assert.strictEqual(app.blocked(), true); assert.strictEqual(app.wait().style.display, 'flex'); assert.strictEqual(app.els['tt-beta-wait-msg'].textContent, MSG);
  assert.ok(app.els['tt-beta-wait-mail'].textContent.includes('testeur@x.fr'), 'le compte est affiché'); assert.notStrictEqual(app.auth_().style.display, 'none', 'l\'appli ne doit jamais être découverte');
  assert.strictEqual(app.fetches.length, 0, 'aucune synchro cloud'); assert.strictEqual(app.ctx._isPremium(), false);
});
t('compte AVEC bêta active (serveur) : accès normal — attente masquée, connexion masquée, synchro lancée', async () => {
  const app = await boot(mkStore({ tt_device_id: 'dev_test' }), { rpc: rpcServer(true) });
  assert.strictEqual(app.blocked(), false); assert.strictEqual(app.wait().style.display, 'none'); assert.strictEqual(app.auth_().style.display, 'none'); assert.ok(app.fetches.length >= 1, 'synchro lancée');
});
t('bêta EXPIRÉE ou RÉVOQUÉE (serveur : inactive) : bloqué, même si la ligne du profil prétend le contraire', async () => {
  const fut = new Date(Date.now() + 9e9).toISOString();
  for (const profile of [{ premium: false }, { beta_active: true, beta_expires_at: fut, beta_started_at: '2026-01-01' }]) {
    const app = await boot(mkStore(account()), { profile, rpc: rpcServer(false) }); assert.strictEqual(app.blocked(), true); assert.strictEqual(app.wait().style.display, 'flex');
  }
});
t('STRICT : abonné, pack, promo ou lifetime SANS beta_grant sont bloqués aussi (seul beta_grant ouvre la bêta)', async () => {
  for (const profile of [{ premium_training: true }, { pack: true }, { promo: true, promo_expires_at: null }, { premium: true, lifetime: true }]) {
    const app = await boot(mkStore(account()), { profile, rpc: rpcServer(false) }); assert.strictEqual(app.blocked(), true, JSON.stringify(profile)); assert.strictEqual(app.wait().style.display, 'flex');
  }
});
t('serveur INJOIGNABLE (jamais confirmé) : échec FERMÉ, message « vérification impossible » (pas « en attente »)', async () => {
  const app = await boot(mkStore(account()), { rpc: rpcDown });
  assert.strictEqual(app.blocked(), true); assert.strictEqual(app.wait().style.display, 'flex'); assert.ok(app.els['tt-beta-wait-msg'].textContent.includes('vérification impossible')); assert.ok(!app.els['tt-beta-wait-msg'].textContent.includes('en attente'));
});
t('testeur déjà confirmé actif : une coupure réseau pendant la session ne le bloque pas', async () => {
  const app = await boot(mkStore({ tt_device_id: 'dev_test' }), { rpc: rpcServer(true) }); assert.strictEqual(app.blocked(), false);
  app.backend.rpc = rpcDown; await app.auth('TOKEN_REFRESHED', { id: U, email: 'testeur@x.fr' }); assert.strictEqual(app.blocked(), false); assert.strictEqual(app.wait().style.display, 'none');
});
t('expiration / révocation PENDANT la session (renouvellement ≈ 1 h) : l\'écran d\'attente apparaît et plus aucune écriture n\'est possible', async () => {
  const app = await boot(mkStore(account()), { rpc: rpcServer(true) }); assert.strictEqual(app.blocked(), false); assert.strictEqual(app.ctx._canWriteUserData(), true);
  app.backend.rpc = rpcServer(false); await app.auth('TOKEN_REFRESHED', { id: U, email: 'testeur@x.fr' });
  assert.strictEqual(app.blocked(), true); assert.strictEqual(app.wait().style.display, 'flex'); assert.strictEqual(app.ctx._canWriteUserData(), false);
});
t('DONNÉES : un compte bloqué ne perd rien, et rien n\'est écrit (ni stockage local, ni sauvegarde cloud) tant qu\'il est bloqué', async () => {
  const ls = mkStore(account()), app = await boot(ls, { rpc: rpcServer(false) }); assert.strictEqual(app.blocked(), true);
  const before = keys(ls), n = JSON.parse(ls._m[NS('it3_sessions')]).length; assert.strictEqual(n, 40);
  app.saveSession({ id: 99999, date: '2026-11-20', routineName: 'X', exercises: [] });   // même une action de l'appli ne doit rien écrire
  assert.strictEqual(keys(ls), before, 'stockage local inchangé'); assert.strictEqual(app.backups.length, 0, 'aucune sauvegarde cloud');
});
t('après un beta_grant : « Actualiser » (rechargement) ouvre l\'appli et les données sont toutes là', async () => {
  const ls = mkStore(account()); const b1 = await boot(ls, { rpc: rpcServer(false) }); assert.strictEqual(b1.blocked(), true);
  const b2 = await boot(ls, { rpc: rpcServer(true) });   // même localStorage, nouveau chargement, le serveur dit « actif »
  assert.strictEqual(b2.blocked(), false); assert.strictEqual(b2.auth_().style.display, 'none'); assert.strictEqual(b2.state('sessions').length, 40); assert.strictEqual(b2.state('routines').length, 1);
});
t('déconnexion : l\'écran d\'attente disparaît, la connexion revient, le verrou est remis à zéro', async () => {
  const app = await boot(mkStore(account()), { rpc: rpcServer(false) }); assert.strictEqual(app.blocked(), true);
  await app.auth('SIGNED_OUT', null); assert.strictEqual(app.blocked(), false); assert.strictEqual(app.wait().style.display, 'none'); assert.strictEqual(app.auth_().style.display, 'flex');
});
t('ouverture publique (BETA_GATE = false) : comportement d\'origine, un compte gratuit entre sans écran d\'attente', async () => {
  const app = await boot(mkStore(account()), { gate: false, rpc: rpcServer(false) });
  assert.strictEqual(app.blocked(), false); assert.strictEqual(app.auth_().style.display, 'none'); assert.strictEqual(app.wait().style.display, 'none'); assert.strictEqual(app.ctx._canWriteUserData(), true);
});
t('le verrou ne touche ni aux droits Premium, ni à la décision serveur : _isPremium inchangé (bêta active = Premium, sinon règles d\'origine)', async () => {
  assert.strictEqual((await boot(mkStore(account()), { rpc: rpcServer(true) })).ctx._isPremium(), true);
  assert.strictEqual((await boot(mkStore(account()), { gate: false, rpc: rpcServer(false) })).ctx._isPremium(), false);
});
(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
