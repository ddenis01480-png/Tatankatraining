// Lancer : node tests/aiguillage-base.test.js      (INDEX_FILE=/chemin/index.html pour tester une autre version)
// Branche de developpement : la page ne doit connaitre QUE la base tatanka-test,
// uniquement sur l'adresse exacte de sa Preview, et demarrer avec un stockage local vierge.
// Execute le VRAI script d'environnement d'index.html dans Node, avec un faux localStorage.
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = fs.readFileSync(process.env.INDEX_FILE || path.join(__dirname, '..', 'index.html'), 'utf8');
let ok = 0, ko = 0;
function t(nom, fn) { try { fn(); ok++; console.log('OK   ' + nom); } catch (e) { ko++; console.log('ECHEC ' + nom + ' : ' + e.message); } }
function assert(c, m) { if (!c) throw new Error(m || 'assertion'); }

const debut = SRC.indexOf('// ENVIRONNEMENT DE TEST');
assert(debut > 0, 'script environnement introuvable');
const ENV_SRC = SRC.slice(SRC.lastIndexOf('<script>', debut) + 8, SRC.indexOf('</script>', debut));
function charger() { const m = { exports: {} }; vm.runInNewContext(ENV_SRC, { module: m }); return m.exports; }
const E = charger();
const HOTE = 'tatankatraining-git-dev-coach-moteur-ddenis01480-1492s-projects.vercel.app';
const PROD_REF = 'ogkrgsnnoebsvbgsngvm', TEST_REF = 'syfrtspfsevkbnnaispu';
function loc(href) { const u = new URL(href); return { protocol: u.protocol, hostname: u.hostname, host: u.host, port: u.port }; }
function store(init, opts) {
  const m = new Map(Object.entries(init || {})); opts = opts || {};
  return { m, get length() { return m.size; }, key: i => Array.from(m.keys())[i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => { m.delete(k); },
    setItem: (k, v) => { if (opts.plein && !m.has(k)) throw new Error('QuotaExceededError'); m.set(k, String(v)); } };
}

// ---------- 1. Une seule configuration : tatanka-test ----------
t('index.html ne contient plus la base tatanka-nutrition (adresse ni cle)', () => {
  assert(!SRC.includes(PROD_REF), 'reference de la base de prod presente');
  assert(!SRC.includes('sb_publishable_KvM3k3gw'), 'cle publique de prod presente');
});
t('seule adresse Supabase de la page = tatanka-test', () => {
  const urls = Array.from(new Set(SRC.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) || []));
  assert(urls.length === 1 && urls[0] === 'https://' + TEST_REF + '.supabase.co', JSON.stringify(urls));
});
t('aucune cle secrete dans la page (service_role, sb_secret)', () => {
  assert(!/service_role|sb_secret_/i.test(SRC), 'mention de cle secrete');
  const jwts = SRC.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
  assert(jwts.length === 0, 'jeton JWT present');
});
t('coach-engine.js ne contient aucune adresse Supabase', () => {
  const ce = fs.readFileSync(path.join(path.dirname(process.env.INDEX_FILE || path.join(__dirname, '..', 'index.html')), 'coach-engine.js'), 'utf8');
  assert(!/supabase\.co/.test(ce));
});
t('SB_URL / SB_KEY viennent uniquement de TATANKA_ENV, sans valeur par defaut', () => {
  const i = SRC.indexOf('var SB_ENV = '), bloc = SRC.slice(i, SRC.indexOf('var STRIPE_MONTHLY', i));
  assert(i > 0 && !/https?:|sb_publishable/.test(bloc), 'valeur en dur dans le bloc SB_*');
  for (const env of [undefined, { autorise: false, config: null }, { autorise: false, config: E.CONFIG_TEST }, { autorise: true, config: null }]) {
    const c = { window: { TATANKA_ENV: env } }; vm.runInNewContext(bloc, c);
    assert(c.SB_URL === null && c.SB_KEY === null, 'repli trouve pour ' + JSON.stringify(env));
  }
  const c = { window: { TATANKA_ENV: { autorise: true, config: E.CONFIG_TEST } } }; vm.runInNewContext(bloc, c);
  assert(c.SB_URL === 'https://' + TEST_REF + '.supabase.co' && c.SB_KEY === E.CONFIG_TEST.key);
});
t('initSupabase ne charge rien et ne cree aucun client sans base', () => {
  const i = SRC.indexOf('function initSupabase()'); const fin = SRC.indexOf('\n}\n', i) + 2;
  let charges = 0; const c = { SB_URL: null, SB_KEY: null, _sbInited: false, console: { warn() {} },
    document: { createElement() { charges++; return {}; }, head: { appendChild() { charges++; } } } };
  vm.runInNewContext(SRC.slice(i, fin) + '\ninitSupabase();', c);
  assert(charges === 0, 'script Supabase charge malgre l absence de base');
});

// ---------- 2. Adresse exacte, sinon blocage ----------
t('adresse exacte de la Preview en https -> tatanka-test', () => {
  const r = E.preparer(loc('https://' + HOTE + '/'), store());
  assert(r.autorise === true && r.config.url === 'https://' + TEST_REF + '.supabase.co', JSON.stringify(r));
});
const REFUSEES = [
  'https://tatankatraining.vercel.app/', 'https://tatankatraining-ddenis01480-1492s-projects.vercel.app/',
  'https://tatankatraining-git-main-ddenis01480-1492s-projects.vercel.app/',
  'https://tatankatraining-git-beta-closed-ddenis01480-1492s-projects.vercel.app/',
  'https://tatankatraining-git-dev-protection-donnees-ddenis01480-1492s-projects.vercel.app/',
  'https://tatankatraining-abc123xyz-ddenis01480-1492s-projects.vercel.app/',
  'http://' + HOTE + '/', 'https://' + HOTE + ':8443/', 'https://' + HOTE + '.evil.com/',
  'https://evil-' + HOTE + '/', 'https://x.' + HOTE + '/', 'https://' + HOTE.replace('dev-coach-moteur', 'dev-coach-moteurx') + '/',
  'https://localhost/', 'http://localhost:3000/', 'https://127.0.0.1/', 'file:///index.html', 'https://tatakanutrition.vercel.app/'
];
t('toute autre adresse -> aucune base (' + REFUSEES.length + ' cas)', () => {
  for (const u of REFUSEES) {
    const ls = store({ it3_sessions: '[1]' }); const r = E.preparer(loc(u), ls);
    assert(r.autorise === false && r.config === null, 'autorisee : ' + u);
    assert(ls.getItem('it3_sessions') === '[1]' && ls.length === 1, 'stockage touche sur ' + u);
  }
});
t('adresse absente ou stockage inaccessible -> aucune base', () => {
  assert(E.preparer(null, store()).autorise === false);
  const casse = { get length() { throw new Error('SecurityError'); }, getItem() { throw new Error('SecurityError'); } };
  const r = E.preparer(loc('https://' + HOTE + '/'), casse); assert(r.autorise === false && r.config === null && r.raison === 'stockage');
});

// ---------- 3. Demarrage vierge, rien d'ancien n'est perdu ni envoye ----------
const ANCIEN = { it3_sessions: '[{"id":1}]', 'it3_sessions_u_abc': '[{"id":2}]', it3_routines: '[]', it3_current_session: '{}',
  tt_device_id: 'dev_ancien', it3_loaded_uid: 'abc', it3_legacy_migrated: '1', cp_training: '1', ['sb-' + PROD_REF + '-auth-token']: '{"t":1}' };
t('premier chargement : anciennes donnees mises de cote, aucune cle lue par l appli ne reste', () => {
  const ls = store(ANCIEN); const r = E.preparer(loc('https://' + HOTE + '/'), ls);
  assert(r.autorise && r.misDeCote === Object.keys(ANCIEN).length, JSON.stringify(r));
  for (const k of Object.keys(ANCIEN)) {
    assert(ls.getItem(k) === null, 'cle encore active : ' + k);
    assert(ls.getItem(E.PREFIXE_MIS_DE_COTE + k) === ANCIEN[k], 'valeur perdue : ' + k);
  }
  assert(ls.getItem(E.MARQUE_VIERGE) === '1');
  for (const k of ls.m.keys()) assert(k === E.MARQUE_VIERGE || k.startsWith(E.PREFIXE_MIS_DE_COTE), 'cle inattendue ' + k);
});
t('le prefixe de mise de cote n est jamais lu par l appli', () => {
  assert(!/localStorage\.key\(|Object\.keys\(localStorage|localStorage\.length/.test(SRC.replace(ENV_SRC, '')), 'parcours global du stockage dans l appli');
  assert(!SRC.replace(ENV_SRC, '').includes('zz_mis_de_cote'));
});
t('chargements suivants : les donnees de test creees ensuite sont conservees', () => {
  const ls = store(ANCIEN); E.preparer(loc('https://' + HOTE + '/'), ls);
  ls.setItem('it3_sessions_u_fictif', '[{"id":99}]'); ls.setItem('tt_device_id', 'dev_test');
  const r = E.preparer(loc('https://' + HOTE + '/'), ls);
  assert(r.autorise && r.misDeCote === 0 && ls.getItem('it3_sessions_u_fictif') === '[{"id":99}]' && ls.getItem('tt_device_id') === 'dev_test');
});
t('stockage plein : connexion bloquee, aucune donnee perdue', () => {
  const ls = store(ANCIEN, { plein: true }); const r = E.preparer(loc('https://' + HOTE + '/'), ls);
  assert(r.autorise === false && r.config === null && r.raison === 'stockage');
  for (const k of Object.keys(ANCIEN)) assert(ls.getItem(k) === ANCIEN[k], 'perdu : ' + k);
  assert(ls.getItem(E.MARQUE_VIERGE) === null);
});
t('le script d environnement est le premier script de la page', () => {
  assert(SRC.indexOf('<script') === SRC.lastIndexOf('<script>', debut), 'un autre script passe avant');
});

console.log('\n' + ok + '/' + (ok + ko) + ' tests OK');
process.exit(ko ? 1 : 0);
