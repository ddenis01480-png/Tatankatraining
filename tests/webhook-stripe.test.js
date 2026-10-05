// Lancer : node tests/webhook-stripe.test.js
// Charge le VRAI api/webhook-stripe.js, l'appelle avec de fausses requetes signees (HMAC calcule ici) et un faux fetch.
// Limite : pas de vrai Stripe ni de vrai Supabase ; teste la logique du webhook, pas la configuration Vercel/Stripe.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto'), { EventEmitter } = require('events');
const SRC = fs.readFileSync(__dirname + '/../api/webhook-stripe.js', 'utf8').replace(/^export default async function handler/m, 'async function handler').replace(/^export const config.*$/m, '') + '\nmodule.exports = { handler, verifyStripeSignature };';
const SECRET = 'whsec_test_123', UID = '11111111-1111-4111-8111-111111111111';
function load(env, fetchLog, fetchImpl) {
  const m = { exports: {} };
  vm.runInNewContext(SRC, { module: m, require, process: { env }, console: { log() {}, error() {} }, fetch: async (u, o) => { fetchLog.push({ u, o }); return fetchImpl ? fetchImpl(u, o) : { ok: true, status: 200 }; }, Buffer, Date, JSON, Object, Array, String, Number, Promise, Error, RegExp });
  return m.exports;
}
const sign = (body, secret, ts) => { const t = ts === undefined ? Math.floor(Date.now() / 1000) : ts; return `t=${t},v1=` + crypto.createHmac('sha256', secret || SECRET).update(`${t}.${body}`).digest('hex'); };
async function call(mod, body, headers) { const req = new EventEmitter(); req.method = 'POST'; req.headers = headers || {};
  const res = { code: null, json: null, status(c) { this.code = c; return this; }, json(j) { this.body = j; return this; }, end() { return this; } };
  const p = mod.handler(req, res); setImmediate(() => { req.emit('data', body); req.emit('end'); }); await p; return res; }
const evt = (type, obj) => JSON.stringify({ type, data: { object: obj } });
const session = (o) => Object.assign({ customer_email: 'a@b.fr', customer: 'cus_1', client_reference_id: UID, payment_link: 'plink_TRAIN', amount_total: 499 }, o || {});
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, SUPABASE_SERVICE_KEY: 'svc' };
const tests = []; const t = (n, f) => tests.push([n, f]);

t('sans en-tete de signature -> 400, aucun appel Supabase (ancien comportement : acceptait)', async () => { const log = []; const r = await call(load(ENV, log), evt('checkout.session.completed', session()), {});
  assert.strictEqual(r.code, 400); assert.strictEqual(log.length, 0); });
t('signature invalide / mauvais secret / corps modifie -> 400', async () => { const log = []; const mod = load(ENV, log); const body = evt('checkout.session.completed', session());
  assert.strictEqual((await call(mod, body, { 'stripe-signature': sign(body, 'autre_secret') })).code, 400);
  assert.strictEqual((await call(mod, body + ' ', { 'stripe-signature': sign(body) })).code, 400);
  assert.strictEqual((await call(mod, body, { 'stripe-signature': 't=1,v1=zzzz' })).code, 400); assert.strictEqual(log.length, 0); });
t('secret non configure -> 500 (echec ferme), jamais d\'acceptation', async () => { const log = []; const body = evt('checkout.session.completed', session());
  const r = await call(load({ SUPABASE_SERVICE_KEY: 'svc' }, log), body, { 'stripe-signature': sign(body) }); assert.strictEqual(r.code, 500); assert.strictEqual(log.length, 0); });
t('anti-rejeu : horodatage trop ancien ou futur -> 400', async () => { const mod = load(ENV, []); const body = evt('x', {}); const now = Math.floor(Date.now() / 1000);
  assert.strictEqual((await call(mod, body, { 'stripe-signature': sign(body, SECRET, now - 3600) })).code, 400); assert.strictEqual((await call(mod, body, { 'stripe-signature': sign(body, SECRET, now + 3600) })).code, 400); });
t('signature valide : acceptee (200) ; plusieurs signatures v1 (rotation de secret) acceptees', async () => { const mod = load(ENV, []); const body = evt('ping', {}); const good = sign(body);
  assert.strictEqual((await call(mod, body, { 'stripe-signature': good })).code, 200);
  assert.strictEqual((await call(mod, body, { 'stripe-signature': good + ',v1=' + '0'.repeat(64) })).code, 200); });
t('evenement mal forme (JSON invalide, sans data.object) -> 400', async () => { const mod = load(ENV, []);
  assert.strictEqual((await call(mod, 'pas du json', { 'stripe-signature': sign('pas du json') })).code, 400); const b = JSON.stringify({ type: 'x' }); assert.strictEqual((await call(mod, b, { 'stripe-signature': sign(b) })).code, 400); });
t('activation INERTE par defaut (pas de STRIPE_PRODUCT_MAP / SUPABASE_URL) : comportement historique conserve', async () => { const log = []; const body = evt('checkout.session.completed', session());
  const r = await call(load(ENV, log), body, { 'stripe-signature': sign(body) }); assert.strictEqual(r.code, 200); assert.ok(log.every(c => !c.u.includes('/profiles?id=eq.')), 'aucun PATCH par id'); });
const ENV2 = Object.assign({}, ENV, { SUPABASE_URL: 'https://proj.supabase.co', STRIPE_PRODUCT_MAP: JSON.stringify({ plink_TRAIN: 'premium_training', plink_PACK: 'pack', plink_BAD: 'is_admin' }) });
const patches = log => log.filter(c => c.u.includes('/rest/v1/profiles?id=eq.'));
t('activation serveur : paiement Training -> PATCH premium_training=true sur le bon utilisateur', async () => { const log = []; const body = evt('checkout.session.completed', session());
  const r = await call(load(ENV2, log), body, { 'stripe-signature': sign(body) }); assert.strictEqual(r.code, 200); const p = patches(log); assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].u, `https://proj.supabase.co/rest/v1/profiles?id=eq.${UID}`); assert.strictEqual(p[0].o.method, 'PATCH'); assert.strictEqual(p[0].o.body, '{"premium_training":true}'); });
t('activation serveur : Pack -> pack=true ; lien inconnu -> rien ; colonne non autorisee (is_admin) -> rien', async () => { const run = async (pl) => { const log = []; const body = evt('checkout.session.completed', session({ payment_link: pl }));
    await call(load(ENV2, log), body, { 'stripe-signature': sign(body) }); return patches(log); };
  assert.strictEqual((await run('plink_PACK'))[0].o.body, '{"pack":true}'); assert.strictEqual((await run('plink_INCONNU')).length, 0); assert.strictEqual((await run('plink_BAD')).length, 0); assert.strictEqual((await run('__proto__')).length, 0); });
t('activation serveur : client_reference_id invalide (injection) -> rien', async () => { for (const id of ['1; drop', UID + '&premium=eq.x', '', null, undefined]) { const log = []; const body = evt('checkout.session.completed', session({ client_reference_id: id }));
    const r = await call(load(ENV2, log), body, { 'stripe-signature': sign(body) }); assert.strictEqual(r.code, 200); assert.strictEqual(patches(log).length, 0, String(id)); } });
t('activation serveur : echec Supabase -> 500 pour que Stripe reessaie', async () => { const log = []; const body = evt('checkout.session.completed', session());
  const r = await call(load(ENV2, log, async (u) => (u.includes('/profiles?id=eq.') ? { ok: false, status: 401 } : { ok: true, status: 200 })), body, { 'stripe-signature': sign(body) }); assert.strictEqual(r.code, 500); });
t('evenement non checkout (invoice, abonnement supprime) : pas d\'activation', async () => { const log = []; const body = evt('invoice.payment_succeeded', session());
  await call(load(ENV2, log), body, { 'stripe-signature': sign(body) }); assert.strictEqual(patches(log).length, 0); });
(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
