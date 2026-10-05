// Lancer : node tests/coach-flags.test.js [chemin/index.html]
// Teste planOf / resolveCoach / _loadFlags / _refreshCoach / _applyPromoCode tels qu'ecrits dans index.html,
// et verifie que _isPremium() et les fonctions de progression du Coach V1 n'ont pas change (empreinte sur entrees fixes).
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const FILE = process.argv[2] || __dirname + '/../index.html'; const SRC = fs.readFileSync(FILE, 'utf8');
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable: ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
const CODE = ['var supabase = null;', 'var currentUser = null;', 'var userProfile = null;'].join('\n') + '\n' +
  (() => { const a = SRC.indexOf('var _PLAN_RANKS'); return SRC.slice(a, SRC.indexOf('window._coach = resolveCoach(null, null);', a)); })() + 'window._coach = resolveCoach(null, null);\n' +
  ['async function _loadFlags()', 'async function _refreshCoach()', 'function _isPremium()', 'async function _applyPromoCode('].map(fnSrc).join('\n');
function ctx(extra) { const c = Object.assign({ console, Promise, Date, Array, Object, String, Error, setTimeout, window: {} }, extra || {}); vm.createContext(c);
  vm.runInContext(CODE + '\nthis.__set=(a,b,c)=>{if(a!==undefined)supabase=a;if(b!==undefined)currentUser=b;if(c!==undefined)userProfile=c;};', c); return c; }
const tests = []; const t = (n, f) => tests.push([n, f]);
const FLAG_LAB = { coach_v2: { state: 'lab', min_plan: 'premium_plus' } }, FLAG_OFF = { coach_v2: { state: 'off', min_plan: 'premium_plus' } }, FLAG_PUB = { coach_v2: { state: 'published', min_plan: 'premium_plus' } };
const P = o => Object.assign({ premium_training: false, pack: false, promo: false, plan: 'free', coach_channel: 'stable' }, o);
const engine = (c, p, f) => c.resolveCoach(p, f).engine;

t('V1 par defaut : profil absent / invalide, flags absents / invalides', () => { const c = ctx();
  for (const p of [null, undefined, 0, 'x', [], {}]) assert.strictEqual(engine(c, p, FLAG_PUB), 'v1');
  for (const f of [null, undefined, 0, 'x', [], {}, { coach_v2: null }, { coach_v2: 'lab' }, { coach_v2: { state: 'weird' } }]) assert.strictEqual(engine(c, P({ coach_channel: 'lab' }), f), 'v1');
  assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v1'); });
t('compte stable (free, premium, premium_plus, beta) : JAMAIS V2 tant que le flag est off ou lab', () => { const c = ctx();
  for (const plan of ['free', 'premium', 'premium_plus']) for (const cohort of [null, 'beta']) for (const f of [FLAG_OFF, FLAG_LAB, {}])
    assert.strictEqual(engine(c, P({ plan, cohort, premium_training: plan !== 'free' }), f), 'v1', plan + '/' + cohort); });
t('compte stable premium_plus : V2 seulement quand le flag est PUBLIE', () => { const c = ctx();
  assert.strictEqual(engine(c, P({ plan: 'premium_plus' }), FLAG_PUB), 'v2'); assert.strictEqual(engine(c, P({ plan: 'premium' }), FLAG_PUB), 'v1'); assert.strictEqual(engine(c, P({ plan: 'free' }), FLAG_PUB), 'v1'); });
t('publie avec min_plan inconnu ou piege (toString, constructor) : jamais V2 pour un compte stable', () => { const c = ctx();
  for (const mp of ['gold', 'toString', 'constructor', '__proto__', null, undefined, 3]) assert.strictEqual(engine(c, P({ plan: 'premium_plus' }), { coach_v2: { state: 'published', min_plan: mp } }), 'v1', String(mp)); });
t('plan invalide ou piege dans le profil : traite comme free (jamais V2)', () => { const c = ctx();
  for (const pl of ['gold', 'toString', 'constructor', null, 7, {}]) assert.strictEqual(c.planOf(P({ plan: pl })), 'free'); });
t('compte lab : V2 en etat lab et publie, pas en etat off ; sans changer le resultat des autres', () => { const c = ctx(); const lab = P({ coach_channel: 'lab' }), stable = P({ plan: 'premium_plus' });
  assert.strictEqual(engine(c, lab, FLAG_LAB), 'v2'); assert.strictEqual(engine(c, lab, FLAG_PUB), 'v2'); assert.strictEqual(engine(c, lab, FLAG_OFF), 'v1');
  assert.strictEqual(engine(c, stable, FLAG_LAB), 'v1'); assert.strictEqual(engine(c, P({ premium_training: true }), FLAG_LAB), 'v1'); });
t('coach_channel invalide / casse / injecte => stable', () => { const c = ctx(); for (const ch of ['LAB', 'Lab', ' lab', 'admin', true, 1, null]) assert.strictEqual(engine(c, P({ coach_channel: ch }), FLAG_LAB), 'v1', String(ch)); });
t('une autre fonctionnalite lab ne bascule pas le moteur en V2', () => { const c = ctx(); const r = c.resolveCoach(P({ coach_channel: 'lab' }), { autre: { state: 'lab' } }); assert.strictEqual(r.engine, 'v1'); assert.strictEqual(r.features.autre, true); });
t('planOf coherent avec _isPremium (colonnes historiques, promo expiree ou non)', () => { const c = ctx(); const past = '2020-01-01T00:00:00Z', fut = '2999-01-01T00:00:00Z';
  for (const p of [P(), P({ premium_training: true }), P({ pack: true }), P({ promo: true }), P({ promo: true, promo_expires_at: past }), P({ promo: true, promo_expires_at: fut }), P({ plan: 'premium' })]) {
    c.__set(undefined, undefined, p); const legacyPremium = vm.runInContext('_isPremium()', c); if (p.plan === 'free') assert.strictEqual(c.planOf(p) !== 'free', legacyPremium, JSON.stringify(p)); } });
t('_refreshCoach : charge les flags, ne bloque pas si la requete pend (timeout), erreur reseau => V1', async () => {
  const mk = (res) => ({ from: () => ({ select: () => res }) }); const U = { id: 'u1' };
  let c = ctx(); c.__set(mk(Promise.resolve({ data: [{ key: 'coach_v2', state: 'lab', min_plan: 'premium_plus' }], error: null })), U, P({ coach_channel: 'lab' })); await c.window.__x; await vm.runInContext('_refreshCoach()', c);
  assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v2');
  c = ctx(); c.__set(mk(Promise.resolve({ data: null, error: { message: 'RLS' } })), U, P({ coach_channel: 'lab' })); await vm.runInContext('_refreshCoach()', c); assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v1');
  c = ctx(); c.__set(mk(Promise.reject(new Error('reseau'))), U, P({ coach_channel: 'lab' })); await vm.runInContext('_refreshCoach()', c); assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v1');
  c = ctx(); c.__set({ from: () => { throw new Error('boom'); } }, U, P({ coach_channel: 'lab' })); await vm.runInContext('_refreshCoach()', c); assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v1');
  c = ctx(); c.__set(undefined, U, P({ coach_channel: 'lab' })); await vm.runInContext('_refreshCoach()', c); assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v1'); });
t('_refreshCoach : si le compte change pendant le chargement, le resultat de l\'ancien compte est ecarte', async () => {
  let release; const gate = new Promise(r => { release = r; }); const c = ctx();
  c.__set({ from: () => ({ select: () => gate }) }, { id: 'A' }, P({ coach_channel: 'lab' })); const pending = vm.runInContext('_refreshCoach()', c);
  c.__set(undefined, { id: 'B' }, P()); release({ data: [{ key: 'coach_v2', state: 'lab', min_plan: 'premium_plus' }], error: null }); await pending;
  assert.strictEqual(vm.runInContext('window._coach.engine', c), 'v1'); });
t('_applyPromoCode : passe par le RPC apply_promo, n\'ecrit plus profiles ni ne lit promo_codes', async () => {
  const calls = []; const c = ctx({ fetch: () => { throw new Error('fetch interdit'); } });
  c.__set({ rpc: async (n, a) => { calls.push([n, a]); return { data: { promo: true, promo_expires_at: '2999-01-01T00:00:00Z' }, error: null }; }, from: () => { throw new Error('from interdit'); } }, { id: 'u1', email: 'a@b.c' }, P());
  assert.strictEqual(await vm.runInContext('_applyPromoCode("beta1")', c), true); assert.strictEqual(JSON.stringify(calls), JSON.stringify([['apply_promo', { p_code: 'beta1' }]]));
  assert.strictEqual(vm.runInContext('userProfile.promo', c), true); });
t('_applyPromoCode : erreurs serveur propagees avec leur message ; non connecte refuse', async () => {
  const c = ctx(); c.__set({ rpc: async () => ({ data: null, error: { message: 'Code expiré' } }) }, { id: 'u1', email: 'a@b.c' }, P());
  await assert.rejects(vm.runInContext('_applyPromoCode("X")', c), /Code expiré/); c.__set(undefined, null, P()); await assert.rejects(vm.runInContext('_applyPromoCode("X")', c), /Connecte-toi/); });
t('V1 INCHANGE : _isPremium + moteur de progression (getProgressionTip) identiques a main, sur entrees fixes', () => {
  const { execSync } = require('child_process'); const base = execSync('git show 0bc456c:index.html', { cwd: __dirname + '/..', maxBuffer: 1e8 }).toString();
  const grab = (src, sig) => { const i = src.indexOf(sig); let d = 0; for (let p = src.indexOf('{', i); p < src.length; p++) { if (src[p] === '{') d++; if (src[p] === '}' && --d === 0) return src.slice(i, p + 1); } };
  for (const sig of ['function _isPremium()', 'function getProgressionTip(', 'function checkStagnation(', 'function normalizeSessions(', 'async function autoBackup(', 'function _syncFromCloud()'])
    assert.strictEqual(grab(SRC, sig), grab(base, sig), sig + ' modifie');
  const h = s => crypto.createHash('sha1').update(s).digest('hex');
  // le bloc "Coach" (progression, adaptations de fatigue, onglets) est octet pour octet identique
  const a = SRC.indexOf('function getProgressionTip('), b = SRC.indexOf('function getProgressionTip(', 0);
  assert.strictEqual(h(grab(SRC, 'function getProgressionTip(')), h(grab(base, 'function getProgressionTip('))); });
(async () => { let fail = 0; console.log('Fichier teste : ' + FILE); for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
