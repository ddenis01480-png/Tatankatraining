// Mise a jour beta-closed : paiements desactives et suppression du contournement ?payment=success.
// VRAI code d'index.html dans Node (harnais partage), faux Supabase. Lancer : node tests/beta-maj.test.js
const H = require('./_harness.js'); const { openApp, mkStore, UA, assert, vm, SRC } = H;
const fnSrc = sig => { const i = SRC.indexOf(sig); assert.ok(i > 0, sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
const NS = b => b + '_u_user-A';
const routines = [{ id: 1, name: 'PERSO 1', day: 'LUNDI', color: '#f60', exercises: [{ name: 'Squat', sets: 3, repsTarget: '8-10' }] }];
const sessions = n => Array.from({ length: n }, (_, i) => ({ id: 9000 + i, date: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), routineName: 'PERSO 1', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 8, rir: 2, done: true }] }] }));
const beta = (active, started) => async n => (n === 'get_my_beta' ? { data: { active, started_at: started, expires_at: '2026-12-17T18:43:30Z', server_now: '2026-11-21T00:00:00Z' }, error: null } : { data: null, error: { message: 'absent' } });
async function boot(o) { const ls = mkStore(o.ls || {}); const app = openApp(ls); if (o.search) app.ctx.window.location.search = o.search;
  Object.assign(app.backend, { profile: o.profile || { premium: false }, rpc: o.rpc }); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA); return app; }
const tests = []; const t = (n, f) => tests.push([n, f]);
t('TESTEUR BETA (validation manuelle, beta_grant) : Premium gratuit, routines et seances intactes', async () => {
  const init = { [NS('it3_routines')]: JSON.stringify(routines), [NS('it3_sessions')]: JSON.stringify(sessions(12)) };
  const app = await boot({ ls: init, rpc: beta(true, '2026-11-17T18:43:30Z') });
  assert.strictEqual(app.ctx._isPremium(), true);
  assert.strictEqual(app.ls.getItem(NS('it3_routines')), init[NS('it3_routines')]); assert.strictEqual(app.ls.getItem(NS('it3_sessions')), init[NS('it3_sessions')]);
});
t('INSCRIT NON ENCORE VALIDE : acces gratuit comme aujourd\'hui (aucun blocage ajoute)', async () => {
  const app = await boot({ rpc: beta(false, null) }); assert.strictEqual(app.ctx._isPremium(), false);
});
t('PROPRIETAIRE (droits du profil) : Premium inchange', async () => {
  const app = await boot({ rpc: beta(false, null), profile: { premium_training: true, pack: true } }); assert.strictEqual(app.ctx._isPremium(), true);
});
t('?payment=success : n\'accorde plus le Premium (contournement supprime)', async () => {
  const app = await boot({ search: '?payment=success', rpc: beta(false, null) }); assert.strictEqual(app.ctx._isPremium(), false);
  assert.ok(!/includes\('payment=success'\)\) \{ await _activateTrainingPremium/.test(SRC));
});
t('PAIEMENTS : startCheckout / startPackCheckout n\'ouvrent aucune page Stripe', async () => {
  const c = { alerts: [], window: { location: { href: 'app' } }, currentUser: { id: 'u', email: 'u@x.fr' }, COMMERCE_ENABLED: false, encodeURIComponent };
  c.alert = m => c.alerts.push(m); vm.createContext(c);
  vm.runInContext(['var STRIPE_MONTHLY="https://buy.stripe.com/test_1", STRIPE_YEARLY="https://buy.stripe.com/test_2", PACK_MONTHLY="https://buy.stripe.com/test_3", PACK_YEARLY="https://buy.stripe.com/test_4";',
    fnSrc('function _commerceDisabledNotice()'), fnSrc('function startCheckout(plan)'), fnSrc('function startPackCheckout(plan)')].join('\n'), c);
  for (const f of ['startCheckout("monthly")', 'startCheckout("yearly")', 'startPackCheckout("monthly")', 'startPackCheckout("yearly")']) vm.runInContext(f, c);
  assert.strictEqual(c.window.location.href, 'app'); assert.strictEqual(c.alerts.length, 4);
});
t('INTERFACE : COMMERCE_ENABLED=false ; 3 ecrans Premium, bouton PACK et code promo conditionnes ; stockage local non modifie', async () => {
  assert.ok(/var COMMERCE_ENABLED = false;/.test(SRC));
  assert.strictEqual((SRC.match(/\{window\.COMMERCE_ENABLED \? \(<div style=\{\{display:"flex",flexDirection:"column"/g) || []).length, 3);
  assert.ok(/\{window\.COMMERCE_ENABLED && window\.currentUser && window\.userProfile/.test(SRC));
  assert.ok(/\{window\.COMMERCE_ENABLED && \(\n\s*<button onClick=\{async \(\) => \{\n\s*const code = prompt/.test(SRC));
  assert.ok(/<button onclick="ttPromoCode\(\)" style="display:none;/.test(SRC));
});
(async () => { let fail = 0; console.log('Fichier teste : ' + H.FILE);
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
