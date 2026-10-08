// Lancer : node tests/session-hydration.test.js [chemin/vers/index.html]
// Execute le VRAI code d'index.html (namespace, auth listener, autoBackup, debut du composant IronTraining :
// initialiseurs + hydratation) dans Node avec faux localStorage / faux Supabase / faux hooks React.
// Ce n'est PAS un navigateur reel : les rendus sont simules (etat lu apres chaque action).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const FILE = process.env.INDEX_FILE || process.argv[2] || __dirname + '/../index.html';
const SRC = fs.readFileSync(FILE, 'utf8');
const REAL_PROGRAMME = (() => { const a = SRC.indexOf('const PROGRAMME = ['); let d = 0, e = -1;
  for (let p = SRC.indexOf('[', a); p < SRC.length; p++) { if (SRC[p] === '[') d++; if (SRC[p] === ']' && --d === 0) { e = p; break; } }
  return eval(SRC.slice(SRC.indexOf('[', a), e + 1)); })();

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
    PROGRAMME: REAL_PROGRAMME,
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


module.exports = { openApp, reload, mkStore, sess, many, UA, UB, KS, ids, count, STATE_NAMES, SRC, FILE, REAL_PROGRAMME, assert, vm, fs };
