// Lancer : node tests/session-hydration.test.js [chemin/vers/index.html]
// Execute le VRAI code d'index.html (namespace, auth listener, autoBackup, debut du composant IronTraining :
// initialiseurs + hydratation) dans Node avec faux localStorage / faux Supabase / faux hooks React.
// Ce n'est PAS un navigateur reel : les rendus sont simules (etat lu apres chaque action).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const FILE = process.argv[2] || __dirname + '/../index.html';
const SRC = fs.readFileSync(FILE, 'utf8');

function cut(start, end, includeEnd) {
  const i = SRC.indexOf(start); if (i < 0) throw new Error('marqueur introuvable: ' + start);
  const j = SRC.indexOf(end, i); if (j < 0) throw new Error('fin introuvable: ' + end);
  return SRC.slice(i, j + (includeEnd ? end.length : 0));
}
function fnSrc(sig) {
  const i = SRC.indexOf(sig); if (i < 0) throw new Error('fonction introuvable: ' + sig);
  let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); }
}
const GLOBALS = cut('var supabase = null;', 'function initSupabase()') + '\n' +
  ['function initSupabase()', 'async function _loadProfile(', 'function _showAuthScreen()', 'function _hideAuthScreen()', 'async function autoBackup(', 'function _syncFromCloud()', 'function normalizeSessions('].map(fnSrc).join('\n') + '\n' +
  cut('const EXERCISE_NAME_FIXES', 'function save(k, v) {') + fnSrc('function save(k, v) {');
const COMP_HEAD = cut('function IronTraining() {', 'useEffect(() => { save(KEYS.routines, routines); }, [routines]);', true);
const STATE_NAMES = [...COMP_HEAD.matchAll(/const \[(\w+), (\w+)\] = useState/g)].map(m => m[1]);
assert.strictEqual(STATE_NAMES.length, (COMP_HEAD.match(/useState\(/g) || []).length, 'useState non standard dans la region');

const mkStore = init => { const m = Object.assign({}, init || {}); return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };

// Un onglet du navigateur ; `ls` (localStorage) survit aux rechargements.
function openApp(ls) {
  const backups = [], nav = { reloads: 0 }, cells = [], effects = [];
  let authCb = null, n = 0, scriptEl = {}, writes = 0; const prevDeps = [];
  const lsSpy = { getItem: k => ls.getItem(k), setItem: (k, v) => { writes++; ls.setItem(k, v); }, removeItem: k => { writes++; ls.removeItem(k); } };
  const sb = { auth: { onAuthStateChange: cb => { authCb = cb; } },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { premium: false } }) }) }), insert: async () => ({}), update: () => ({ eq: async () => ({}) }) }),
    functions: { invoke: async (_, o) => { backups.push(JSON.parse(JSON.stringify(o.body))); return {}; } } };
  const ctx = { console, JSON, Math, Date, Array, Object, parseInt, parseFloat, encodeURIComponent, setTimeout, Promise, Error, String, Number,
    localStorage: lsSpy, sessionStorage: mkStore(), alert() {}, confirm: () => true, fetch: () => new Promise(() => {}),
    SB_URL: 'https://x.supabase.co', SB_KEY: 'k', today: () => '2026-10-03', _activateTrainingPremium: async () => {},
    PROGRAMME: [{ id: 'p1', name: 'Push', day: 'Lun', color: '#f00', exercises: [{ name: 'Squat', sets: 3, repsTarget: '8-10' }] }],
    document: { addEventListener() {}, createElement: () => scriptEl, head: { appendChild: () => {} }, getElementById: () => ({ style: {} }) },
    useState: init => { const i = n++; if (!cells[i]) { const c = { v: typeof init === 'function' ? init() : init }; c.set = v => { c.v = typeof v === 'function' ? v(c.v) : v; }; cells[i] = c; } return [cells[i].v, cells[i].set]; },
    useRef: v => ({ current: v === undefined ? null : v }), useEffect: (f, d) => effects.push({ f, d }), useCallback: f => f, useMemo: f => f(), useLayoutEffect: () => {} };
  ctx.addEventListener = () => {}; ctx.window = ctx; ctx.window.location = { search: '', reload: () => { nav.reloads++; } }; 
  vm.createContext(ctx);
  vm.runInContext(GLOBALS + '\nthis.__KEYS=KEYS; this.__setUser=u=>{currentUser=u};', ctx);
  const app = { ctx, ls, backups, nav, get writes() { return writes; }, resetWrites() { writes = 0; },
    state: name => cells[STATE_NAMES.indexOf(name)].v, setState: (name, v) => cells[STATE_NAMES.indexOf(name)].set(v),
    mount(user) { // rendu initial du VRAI composant ; `user` = identite deja connue au demarrage (ou null)
      if (user) ctx.__setUser(user);
      app.render(); app.flush(); },
    render() { n = 0; effects.length = 0; vm.runInContext('(' + COMP_HEAD.replace('function IronTraining() {', 'function(){') + '\n})', ctx)(); },
    // Simule les re-rendus React : nouveau rendu (donc nouvelles fermetures d'effets), puis effets dont les deps ont change.
    // Seuls les effets de sauvegarde des routines et d'hydratation sont executes (les autres dependent du DOM/audio).
    flush() { for (let it = 0; it < 6; it++) { app.render(); let ran = false;
      effects.forEach((e, i) => { const src = String(e.f); if (!src.includes('save(KEYS.routines') && !src.includes('_hydrateUserState')) return;
        const p = prevDeps[i], changed = !p || !e.d || e.d.length !== p.length || e.d.some((x, k) => x !== p[k]);
        if (changed) { prevDeps[i] = e.d ? [...e.d] : null; e.f(); ran = true; } });
      if (!ran) break; } },
    startSupabase() { ctx.initSupabase(); ctx.supabase = { createClient: () => sb }; scriptEl.onload(); },
    async auth(event, user) { await authCb(event, user ? { user } : null); app.flush(); },
    // Reproduit a l'identique les lignes de saveSession() (SessionTab) qui touchent l'etat, le stockage et le cloud.
    saveSession(session) { const updated = [...app.state('sessions'), session]; app.setState('sessions', updated);
      ctx.save(ctx.__KEYS.sessions, updated); ctx.autoBackup(updated, ctx.load(ctx.__KEYS.routines), ctx.load(ctx.__KEYS.cycle), ctx.load(ctx.__KEYS.supps), ctx.load(ctx.__KEYS.fatigue)); app.flush(); },
  };
  return app;
}
// "Recharger la page" : meme localStorage, nouveau contexte JS.
const reload = app => openApp(app.ls);

const sess = (id, date) => ({ id, date, routineId: 'p1', routineName: 'Push', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 8, rir: 2, done: true }] }] });
const many = (n, base) => Array.from({ length: n }, (_, i) => sess(base + i, '2026-01-' + String(1 + (i % 28)).padStart(2, '0')));
const UA = { id: 'user-A', email: 'a@x.fr' }, UB = { id: 'user-B', email: 'b@x.fr' };
const KS = u => 'it3_sessions_u_' + u.id;
const ids = list => list.map(s => s.id);
const count = ls => JSON.parse(ls.getItem(KS(UA)) || '[]').length;

const tests = [];
const t = (name, f) => tests.push([name, f]);

t('DEMARRAGE : currentUser=null -> aucune donnee lue depuis la cle legacy, aucune ecriture', async () => {
  const ls = mkStore({ it3_sessions: JSON.stringify(many(100, 1)), it3_routines: '[{"id":"legacy"}]', [KS(UA)]: JSON.stringify(many(109, 5000)) });
  const before = JSON.stringify(ls._m);
  const app = openApp(ls); app.resetWrites(); app.mount(null);
  assert.strictEqual(app.state('sessions').length, 0, 'ne doit pas charger la cle legacy sans identite');
  assert.strictEqual(app.writes, 0, 'aucune ecriture localStorage au demarrage sans identite');
  assert.strictEqual(JSON.stringify(ls._m), before);
});
t('SCENARIO 109 -> 110 -> rechargement -> 110 (avec cle legacy plus ancienne et plus courte)', async () => {
  const ls = mkStore({ it3_sessions: JSON.stringify(many(100, 1)), [KS(UA)]: JSON.stringify(many(109, 5000)) });
  let app = openApp(ls); app.mount(null); app.startSupabase();
  await app.auth('INITIAL_SESSION', UA);
  assert.strictEqual(app.state('sessions').length, 109, 'etat React = 109 apres hydratation');
  assert.strictEqual(count(ls), 109, 'hydratation sans ecriture destructive');
  app.saveSession(sess(9001, '2026-10-03'));
  assert.strictEqual(count(ls), 110, 'sauvegarde = 110');
  app = reload(app); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA);
  assert.strictEqual(app.state('sessions').length, 110, '110 apres fermeture/rechargement');
  assert.strictEqual(new Set(ids(app.state('sessions'))).size, 110, 'aucun doublon');
  app.saveSession(sess(9002, '2026-10-04')); app = reload(app); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA);
  assert.strictEqual(app.state('sessions').length, 111, 'plusieurs lancements successifs : aucune perte');
});
t('namespace plus complet que la legacy -> jamais ecrase par la legacy figee', async () => {
  const ls = mkStore({ it3_sessions: JSON.stringify(many(5, 1)), [KS(UA)]: JSON.stringify(many(109, 5000)) });
  const app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA);
  app.saveSession(sess(9001, '2026-10-03'));
  assert.deepStrictEqual(ids(JSON.parse(ls.getItem(KS(UA)))).slice(0, 109), ids(many(109, 5000)), 'les 109 existantes intactes, dans l\'ordre');
});
t('HYDRATATION : routines, fatigue, supps, current_session relus depuis le namespace ; cycle lisible', async () => {
  const cs = { routineId: 'p1', routineName: 'Push', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 8 }] }] };
  const ls = mkStore({
    [KS(UA)]: JSON.stringify(many(3, 10)), ['it3_routines_u_user-A']: JSON.stringify([{ id: 'r1', name: 'MesRoutines', day: 'L', color: '#0f0', exercises: [{ name: 'Dips', sets: 3 }] }]),
    ['it3_prog_version_u_user-A']: 'v6-notes-2026d', ['it3_fatigue_u_user-A']: JSON.stringify({ sleep: 2, appetite: 1, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0 }),
    ['it3_sns_reset_u_user-A']: (() => { const d = new Date(), w = d.getDay(), m = new Date(d); m.setDate(d.getDate() - (w === 0 ? 6 : w - 1)); return m.toISOString().split('T')[0]; })(),
    ['it3_supps_u_user-A']: JSON.stringify([{ name: 'Creatine' }]), ['it3_current_session_u_user-A']: JSON.stringify(cs), ['it3_cycle_u_user-A']: JSON.stringify({ startDate: '2026-09-01', num: 3 }) });
  const app = openApp(ls); app.mount(null);
  assert.strictEqual(app.state('supps').length, 0); assert.strictEqual(app.state('currentSets'), null);
  app.startSupabase(); await app.auth('INITIAL_SESSION', UA);
  assert.strictEqual(app.state('sessions').length, 3);
  assert.strictEqual(app.state('routines')[0].name, 'MesRoutines');
  assert.strictEqual(app.state('fatigue').sleep, 2);
  assert.strictEqual(app.state('supps')[0].name, 'Creatine');
  assert.strictEqual(app.state('currentSets').routineId, 'p1'); assert.strictEqual(app.state('sessionRecovered'), true);
  assert.strictEqual(app.ctx.load('it3_cycle').num, 3, 'cycle relu depuis le namespace de l\'utilisateur');
  assert.strictEqual(JSON.parse(ls.getItem('it3_routines_u_user-A'))[0].name, 'MesRoutines', 'routines existantes non remplacees');
});
t('INITIAL_SESSION et SIGNED_IN (meme compte, sans changement d\'identite) hydratent ; TOKEN_REFRESHED ne re-ecrase pas', async () => {
  const ls = mkStore({ [KS(UA)]: JSON.stringify(many(10, 1)), it3_loaded_uid: 'user-A' });
  const app = openApp(ls); app.mount(null); app.startSupabase();
  await app.auth('SIGNED_IN', UA); assert.strictEqual(app.state('sessions').length, 10); assert.strictEqual(app.nav.reloads, 0);
  app.saveSession(sess(7777, '2026-10-03'));
  await app.auth('TOKEN_REFRESHED', UA);
  assert.strictEqual(app.state('sessions').length, 11, 'un rafraichissement de jeton ne doit pas reinitialiser l\'etat');
  assert.strictEqual(count(ls), 11);
});
t('AUCUNE SAUVEGARDE avec un etat non hydrate (identite connue mais etat charge avant) -> bloquee', async () => {
  const ls = mkStore({ [KS(UA)]: JSON.stringify(many(109, 5000)) });
  const app = openApp(ls); app.mount(null);               // etat initial vide (identite inconnue)
  app.ctx.__setUser(UA);                                  // identite connue MAIS hydratation pas encore faite
  app.saveSession(sess(1, '2026-10-03'));                // ecrirait [1] a la place des 109 sur l'ancien code
  assert.strictEqual(count(ls), 109, 'les 109 doivent rester intactes');
  assert.strictEqual(app.backups.length, 0, 'aucune sauvegarde cloud depuis un etat non hydrate');
});
t('ecritures vides : l\'hydratation d\'un compte sans donnees n\'ecrase rien et ne cree pas de sessions', async () => {
  const ls = mkStore({ it3_sessions: JSON.stringify(many(100, 1)), [KS(UA)]: JSON.stringify(many(109, 5000)) });
  const app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UB);
  assert.strictEqual(app.state('sessions').length, 0); assert.strictEqual(ls.getItem(KS(UB)), null, 'pas de tableau vide ecrit');
  assert.strictEqual(count(ls), 109, 'donnees du compte A intactes');
});
t('ISOLATION A -> B -> A (avec rechargement entre comptes comme le fait l\'app)', async () => {
  const ls = mkStore({ it3_sessions: JSON.stringify(many(100, 1)), [KS(UA)]: JSON.stringify(many(109, 5000)), [KS(UB)]: JSON.stringify(many(3, 8000)), it3_loaded_uid: 'user-A' });
  let app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA);
  assert.strictEqual(app.state('sessions').length, 109);
  await app.auth('SIGNED_OUT', null);                      // deconnexion A
  app.saveSession(sess(555, '2026-10-03'));                // tentative d'ecriture apres deconnexion : bloquee
  assert.strictEqual(count(ls), 109);
  app = reload(app); app.mount(null); app.startSupabase(); await app.auth('SIGNED_IN', UB);   // connexion B (nouvelle identite -> reload applicatif)
  assert.strictEqual(app.nav.reloads, 1, 'l\'app recharge sur changement d\'identite');
  assert.deepStrictEqual(ids(app.state('sessions')), ids(many(3, 8000)), 'B ne voit que ses 3 seances');
  app.saveSession(sess(8100, '2026-10-03'));
  assert.strictEqual(JSON.parse(ls.getItem(KS(UB))).length, 4); assert.strictEqual(count(ls), 109, 'A intact apres une ecriture de B');
  app = reload(app); app.mount(null); app.startSupabase(); await app.auth('SIGNED_IN', UA);
  assert.strictEqual(app.state('sessions').length, 109, 'retour sur A : ses 109 retrouvees'); assert.ok(!ids(app.state('sessions')).includes(8100));
});
t('ISOLATION sans rechargement : changement de compte dans la meme page -> etat de A remplace par celui de B', async () => {
  const ls = mkStore({ [KS(UA)]: JSON.stringify(many(109, 5000)), [KS(UB)]: JSON.stringify(many(3, 8000)),
    ['it3_current_session_u_user-A']: JSON.stringify({ routineId: 'p1', exercises: [{ name: 'X', sets: [] }] }) });
  const app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA);
  assert.ok(app.state('currentSets'));
  await app.auth('TOKEN_REFRESHED', UB);
  assert.strictEqual(app.state('sessions').length, 3); assert.strictEqual(app.state('currentSets'), null, 'seance en cours de A non conservee chez B');
  app.saveSession(sess(8100, '2026-10-03')); assert.strictEqual(count(ls), 109);
});
t('SAUVEGARDE CLOUD : apres hydratation le backup contient bien les 110 seances ; rien n\'est envoye avant', async () => {
  const ls = mkStore({ [KS(UA)]: JSON.stringify(many(109, 5000)) });
  const app = openApp(ls); app.mount(null); app.startSupabase();
  app.ctx.autoBackup([], null, null, null, null); await Promise.resolve();
  assert.strictEqual(app.backups.length, 0, 'aucun backup sans identite');
  await app.auth('INITIAL_SESSION', UA); app.saveSession(sess(9001, '2026-10-03')); await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(app.backups.length, 1); assert.strictEqual(app.backups[0].sessions.length, 110);
});
t('RESTAURATION APRES RECONNEXION : deconnexion puis reconnexion -> 110 seances retrouvees, sans doublon', async () => {
  const ls = mkStore({ [KS(UA)]: JSON.stringify(many(109, 5000)) });
  let app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', UA); app.saveSession(sess(9001, '2026-10-03'));
  await app.auth('SIGNED_OUT', null);
  app = reload(app); app.mount(null); app.startSupabase(); await app.auth('SIGNED_IN', UA);
  assert.strictEqual(app.state('sessions').length, 110); assert.strictEqual(new Set(ids(app.state('sessions'))).size, 110);
});
t('identite deja connue au premier rendu : etat initial correct, hydratation sans effet', async () => {
  const ls = mkStore({ [KS(UA)]: JSON.stringify(many(109, 5000)) });
  const app = openApp(ls); app.mount(UA);
  assert.strictEqual(app.state('sessions').length, 109);
  app.startSupabase(); await app.auth('INITIAL_SESSION', UA); app.saveSession(sess(9001, '2026-10-03'));
  assert.strictEqual(count(ls), 110);
});

(async () => {
  let fail = 0;
  console.log('Fichier teste : ' + FILE);
  for (const [name, f] of tests) { try { await f(); console.log('OK   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`);
  process.exit(fail ? 1 : 0);
})();
