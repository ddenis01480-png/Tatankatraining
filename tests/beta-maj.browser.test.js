// Test NAVIGATEUR (Chromium/Playwright) de la mise a jour beta-closed (paiements desactives) : vrai index.html, rendu React complet, mobile 390 px et
// ordinateur 1280 px. Aucun reseau : React 18.2.0, ReactDOM 18.2.0 et Babel 7.23.2 servis depuis des copies locales
// (memes versions qu'en production), Supabase remplace par un faux client pilote par le scenario.
// Lancer : TT_DEPS=<dossier avec node_modules/{react,react-dom,@babel/standalone}> node tests/beta-private.browser.test.js
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const { chromium } = require('playwright');
const FILE = process.argv[2] || path.join(__dirname, '..', 'index.html'), ROOT = path.dirname(FILE);
const DEPS = process.env.TT_DEPS; if (!DEPS) { console.error('TT_DEPS non defini'); process.exit(2); }
const nm = p => fs.readFileSync(path.join(DEPS, 'node_modules', p), 'utf8');
const LIBS = { 'react.production.min.js': nm('react/umd/react.production.min.js'), 'react-dom.production.min.js': nm('react-dom/umd/react-dom.production.min.js'), 'babel.min.js': nm('@babel/standalone/babel.min.js') };
const HTML = fs.readFileSync(FILE, 'utf8'), ORIGIN = 'https://tatanka-beta.test', UID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const SHOTS = process.env.TT_SHOTS || os.tmpdir();

const FAKE = `(function(){ var SC = window.__SC; window.__calls = { rpc: [], signUp: [], writes: [], reset: null };
  function profile(){ return Object.assign({ id: SC.uid, email: 'testeur@test.local', premium: false, premium_training: false, pack: false, promo: false }, SC.profile || {}); }
  function q(table){ var api = { select: function(){ return api; }, eq: function(){ return api; }, order: function(){ return api; }, limit: function(){ return api; },
    single: function(){ return Promise.resolve({ data: table === 'profiles' ? profile() : null, error: null }); },
    insert: function(v){ window.__calls.writes.push(['insert', table]); return Promise.resolve({ error: { code: '42501' } }); },
    upsert: function(v){ window.__calls.writes.push(['upsert', table]); return Promise.resolve({ error: { code: '42501' } }); },
    update: function(v){ window.__calls.writes.push(['update', table, v]); return { eq: function(){ return Promise.resolve({ error: { code: '42501' } }); } }; },
    then: function(r){ return Promise.resolve({ data: [], error: table === 'feature_flags' ? { code: '42P01' } : null }).then(r); } }; return api; }
  window.supabase = { createClient: function(){ return {
    auth: { onAuthStateChange: function(cb){ setTimeout(function(){ cb('INITIAL_SESSION', SC.session ? { user: { id: SC.uid, email: 'testeur@test.local' } } : null); }, 20); return { data: { subscription: { unsubscribe: function(){} } } }; },
            signUp: function(a){ window.__calls.signUp.push(a.email); return Promise.resolve({ data: { session: null }, error: null }); },
            signInWithPassword: function(){ return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } }); },
            resetPasswordForEmail: function(e, o){ window.__calls.reset = [e, o]; return Promise.resolve({ data: {}, error: null }); },
            signOut: function(){ return Promise.resolve({}); }, getSession: function(){ return Promise.resolve({ data: { session: null } }); } },
    from: q,
    rpc: function(n, a){ window.__calls.rpc.push(n); return new Promise(function(res){ setTimeout(function(){
      if (n === 'beta_signup_allowed') return res({ data: (SC.invited || []).indexOf(a.p_email) >= 0, error: null });
      if (n === 'claim_beta_invite') return res({ data: { invited: !!SC.betaActive, claimed: false }, error: null });
      if (n === 'get_my_beta') return res({ data: { active: !!SC.betaActive, started_at: SC.betaStarted || null, expires_at: SC.betaEnd || null, server_now: new Date().toISOString() }, error: null });
      res({ data: null, error: { message: 'absent' } }); }, 20); }); },
    functions: { invoke: function(){ return Promise.resolve({ data: { ok: true }, error: null }); } } }; } }; })();`;

const sess = (i) => ({ id: 1000 + i, date: '2026-11-' + String(1 + (i % 19)).padStart(2, '0'), routineId: 1, routineName: 'Push', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 8, rir: 2, done: true }] }] });
async function open(browser, sc, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 } }); const page = await ctx.newPage();
  const errors = [], dialogs = [], nav = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  page.on('request', r => { if (/stripe\.com/.test(r.url())) nav.push(r.url()); });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.startsWith(ORIGIN)) { const p = new URL(u).pathname; if (p === '/beta.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(ROOT, 'beta.html'), 'utf8') });
      if (/\.(png|json)$/.test(p) && fs.existsSync(path.join(ROOT, p))) return route.fulfill({ status: 200, body: fs.readFileSync(path.join(ROOT, p)) });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }); }
    for (const k of Object.keys(LIBS)) if (u.endsWith('/' + k)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LIBS[k] });
    if (u.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE });
    return route.abort(); });
  await page.addInitScript(([sc, uid, s]) => { window.__SC = Object.assign({ uid }, sc);
    if (!sessionStorage.getItem('seed')) { sessionStorage.setItem('seed', '1'); localStorage.setItem('it3_loaded_uid', uid);
      if (s) localStorage.setItem('it3_sessions_u_' + uid, JSON.stringify(s)); } }, [sc, UID, sc.sessions || null]);
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  await page.waitForSelector('#splash-train', { state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { ctx, page, errors, dialogs, nav };
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const txt = page => page.evaluate(() => document.body.innerText);
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const PRICE = /4,99€|39,99€|9,99€|Pack 9|débloquer les 3 apps/;

const results = [];
async function scenario(browser, name, sc, vp, f) {
  const o = await open(browser, sc, vp);
  try { await f(o); const errs = o.errors.filter(e => !/net::|Failed to load/.test(e)); assert.deepStrictEqual(errs, [], 'erreurs JS : ' + errs.join(' | ')); assert.deepStrictEqual(o.nav, [], 'appel Stripe : ' + o.nav); results.push(['OK  ', name]); }
  catch (e) { results.push(['FAIL', name + '\n       -> ' + String(e.message).split('\n')[0]]); } finally { await o.ctx.close(); }
}
async function tabs(page) { // ouvre les onglets via l'accueil puis la barre de navigation
  const out = {};
  await page.locator('text=Programmes prets a l emploi').first().click().catch(() => {}); await page.waitForTimeout(200);
  for (const l of ['ROUTINES', 'SEANCE', 'PROG.', 'BILAN', 'SUPP.', 'SNS']) { await page.locator('button:has-text("' + l + '")').last().click(); await page.waitForTimeout(200); out[l] = await txt(page); }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  for (const [label, vp] of [['MOBILE 390', { width: 390, height: 844 }], ['ORDINATEUR 1280', { width: 1280, height: 800 }]]) {
    await scenario(browser, label + ' — TESTEUR BETA ACTIF : 7 onglets sans erreur, aucun prix, aucun verrou, aucun code promo', { session: true, betaActive: true, betaStarted: '2026-11-17T18:43:30Z', betaEnd: '2026-12-17T18:43:30Z', sessions: Array.from({ length: 35 }, (_, i) => sess(i)) }, vp, async ({ page }) => {
      const all = await tabs(page); for (const [k, v] of Object.entries(all)) { assert.ok(!PRICE.test(v), 'prix dans ' + k); assert.ok(!/Fonctionnalité Premium/.test(v), 'verrou dans ' + k); }
      assert.ok(await overflow(page) <= 0);
      await page.locator('button:has-text("DATA")').click(); await page.waitForTimeout(200); assert.ok(!/CODE PROMO/.test(await txt(page)));
      await page.screenshot({ path: path.join(SHOTS, 'maj-' + vp.width + '-data.png') });
    });
  }
  await scenario(browser, 'INSCRIT NON VALIDE / TESTEUR EXPIRE : mode gratuit, ecrans Premium "Réservé aux testeurs", aucun bouton de paiement ni PACK', { session: true, betaActive: false, betaStarted: null }, null, async ({ page }) => {
    const all = await tabs(page);
    for (const k of ['PROG.', 'BILAN', 'SNS']) { assert.ok(/Réservé aux testeurs de la bêta/.test(all[k]), k); assert.ok(!PRICE.test(all[k]), 'prix dans ' + k); }
    assert.strictEqual(await page.locator('button:has-text("PACK")').count(), 0);
  });
  await scenario(browser, 'ECRAN DE CONNEXION : inscription et connexion inchangees, code promo masque', {}, null, async ({ page }) => {
    const t = await page.locator('#tt-auth-screen').innerText(); assert.ok(/INSCRIPTION/.test(t) && /CONNEXION/.test(t) && !/Code promo/.test(t), t);
  });
  await scenario(browser, 'PAIEMENT : retour ?payment=success -> aucun Premium, aucune ecriture du profil', { session: true, betaActive: false }, null, async ({ page }) => {
    await page.goto(ORIGIN + '/?payment=success'); await page.waitForTimeout(1500);
    assert.strictEqual(await page.evaluate(() => window._isPremium()), false);
    assert.deepStrictEqual((await page.evaluate(() => window.__calls.writes)).filter(w => w[0] === 'update'), []);
  });
  await browser.close();
  let fail = 0; for (const [s, n] of results) { if (s === 'FAIL') fail++; console.log(s + ' ' + n); }
  console.log(`\n${results.length - fail}/${results.length} scenarios navigateur passes`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
