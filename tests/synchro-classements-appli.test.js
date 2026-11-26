// Lancer : node tests/synchro-classements-appli.test.js
//
// Etape 2b-2 : synchronisation des choix de muscles, cote APPLI. Le VRAI code d'index.html (stockage par compte, KEYS, load/save,
// bloc « SYNCHRONISATION CLOUD DES CHOIX DE MUSCLES ») tourne dans un faux navigateur, avec le vrai moteur et un FAUX Supabase
// qui applique les regles du SQL (declencheur et archivage). Aucune connexion reseau, aucune vraie base.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'coach-engine.js'), 'utf8');
const cut = (a, b) => { const i = SRC.indexOf(a); if (i < 0) throw new Error('marqueur ' + a); const j = SRC.indexOf(b, i); if (j < 0) throw new Error('fin ' + b); return SRC.slice(i, j); };
const fnSrc = sig => { const i = SRC.indexOf(sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
const BLOC_SYNCHRO = cut('// SYNCHRONISATION CLOUD DES CHOIX DE MUSCLES', 'function recupSollicitations(');
const CODE = cut('var supabase = null;', '// Migration legacy') + '\n' + cut('const KEYS = {', 'function analyzeEx(') + '\n' + fnSrc('function coachEngine()') + '\n' + BLOC_SYNCHRO +
  '\nthis.__set = (u, sb, uidEtat) => { currentUser = u; supabase = sb; _stateUid = uidEtat; }; this.__KEYS = KEYS;';
const copie = o => JSON.parse(JSON.stringify(o));
const U = { id: 'compte-test-A' }, U2 = { id: 'compte-test-B' };
const NS = (k, u) => k + '_u_' + (u || U).id;

// ── Faux Supabase : table exercise_classements + fonction archiver_versions_ecartees, regles du SQL ──
function fauxSupabase() {
  const base = { lignes: new Map(), journal: [], archives: new Map(), appels: [], mode: 'ok', refuserNom: null, horloge: Date.parse('2026-11-26T17:00:00Z'), avantReponse: null };
  const pg = ms => new Date(ms).toISOString().replace('Z', '+00:00');
  const contenu = l => JSON.stringify([l.catalogue, l.principal, l.secondaires]);
  const panne = () => base.mode === 'horsligne' ? Promise.reject(new TypeError('Failed to fetch')) : base.mode === 'erreur500' ? Promise.resolve({ data: null, error: { message: 'Internal', code: '500' } })
    : base.mode === 'delai' ? new Promise(() => {}) : base.mode === 'tableAbsente' ? Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) : null;
  const reponse = v => { const p = Promise.resolve(v); return base.avantReponse ? p.then(r => { base.avantReponse(); return r; }) : p; };
  const vue = (uid, l) => ({ nom: l.nom, catalogue: l.catalogue, principal: l.principal, secondaires: l.secondaires.slice(), modifie_le: pg(l._t) });
  const sb = {
    from(table) {
      assert.strictEqual(table, 'exercise_classements', 'seule la table des choix est utilisee');
      return {
        select(cols) { return { eq(col, uid) { base.appels.push('lecture'); return panne() || reponse({ data: [...base.lignes.values()].filter(l => l.user_id === uid).map(l => vue(uid, l)), error: null }); } }; },
        upsert(rows, opts) {
          assert.strictEqual(JSON.stringify(opts), JSON.stringify({ onConflict: 'user_id,nom' }));
          return { select(cols) { base.appels.push('envoi:' + rows.length); const p = panne(); if (p) return p;
            if (base.refuserNom && rows.some(r => r.nom === base.refuserNom)) return reponse({ data: null, error: { code: '23514', message: 'check violation' } });
            const out = rows.map(r => { let t = Date.parse(r.modifie_le); if (t > base.horloge + 300000) { base.journal.push({ raison: 'date_future_ramenee' }); t = base.horloge; }
              const k = r.user_id + '|' + r.nom, old = base.lignes.get(k), n = { user_id: r.user_id, nom: r.nom, catalogue: r.catalogue, principal: r.principal, secondaires: r.secondaires.slice(), _t: t };
              if (old && (t < old._t || (t === old._t && contenu(n) !== contenu(old)))) base.journal.push({ raison: t < old._t ? 'plus_ancienne_ecartee' : 'meme_date_contenu_different', ecartee: n });
              else base.lignes.set(k, n);
              return vue(r.user_id, base.lignes.get(k)); });
            return reponse({ data: out, error: null }); } };
        }
      };
    },
    rpc(nom, args) {
      assert.strictEqual(nom, 'archiver_versions_ecartees'); base.appels.push('archivage:' + args.p_lignes.length); const p = panne(); if (p) return p;
      return reponse({ data: args.p_lignes.map((l, i) => { const ex = base.archives.get(l.cle_locale), v = JSON.stringify(l);
        if (!ex) { base.archives.set(l.cle_locale, v); return { indice: i, cle: l.cle_locale, statut: 'archivee' }; }
        return { indice: i, cle: l.cle_locale, statut: ex === v ? 'deja_archivee' : 'cle_en_conflit' }; }), error: null });
    },
    functions: { invoke() { base.appels.push('training-backup'); return Promise.resolve({}); } }
  };
  return { sb, base };
}

// ── Un appareil (onglet) : localStorage propre, meme faux Supabase ──
let uuid = 0;
function appareil(fs_, init, opts) {
  opts = opts || {};
  const m = Object.assign({}, init || {}), ecritures = [];
  const ls = { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { if (opts.plein && opts.plein(k)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } ecritures.push(k); m[k] = String(v); }, removeItem: k => { delete m[k]; } };
  const ecoutes = {};
  const ctx = { console: { warn() {}, log() {}, error() {} }, JSON, Math, Date, Array, Object, Promise, Error, String, Number, parseInt, parseFloat, isFinite, isNaN, Uint8Array,
    setTimeout: (f, ms) => setTimeout(f, ms >= 10000 ? 1 : ms), localStorage: ls, alert() {},
    crypto: { randomUUID: () => 'cle-' + (++uuid) },
    document: { visibilityState: 'visible', addEventListener: (ev, f) => { ecoutes['doc:' + ev] = f; } } };
  ctx.window = ctx; ctx.addEventListener = (ev, f) => { ecoutes['win:' + ev] = f; };
  vm.createContext(ctx); vm.runInContext(ENGINE, ctx); vm.runInContext(CODE, ctx);
  const a = { ctx, m, ecritures, ecoutes,
    connecter(u, confirme) { ctx.__set(u, fs_.sb, confirme === false ? null : u.id); },
    sync: r => ctx.syncClassements(r || 'test'),
    stock: u => m[NS('it3_classements', u)] === undefined ? null : JSON.parse(m[NS('it3_classements', u)]),
    journal: u => m[NS('it3_classements_journal', u)] === undefined ? null : JSON.parse(m[NS('it3_classements_journal', u)]),
    choisir(nom, choix, ms) { const s = ctx.CoachEngine.choisirClassement(a.stock(), nom, choix, ms); ctx.save(ctx.__KEYS.classements, s); } };
  return a;
}
const AUTRES = () => ({ [NS('it3_sessions')]: JSON.stringify([{ id: 1, date: '2026-11-20', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 8 }] }] }]), [NS('it3_routines')]: JSON.stringify([{ id: 'r1', name: 'Push', exercises: [] }]),
  [NS('it3_fatigue')]: '{"x":1}', [NS('it3_cycle')]: '{"num":2}', [NS('it3_supps')]: '[]', [NS('it3_customEx')]: '["Bel"]', 'tt_device_id': 'dev_test' });
const CHOIX = { version: 1, exercices: { 'Hip trust machine': { principal: 'Fessiers', secondaires: ['Ischio-jambiers'], modifieLe: '2026-11-26T16:00:00.000Z' }, 'Bel': { principal: 'Mollets', secondaires: [], modifieLe: '2026-11-26T16:01:00.000Z' } } };
const departAvecChoix = () => Object.assign(AUTRES(), { [NS('it3_classements')]: JSON.stringify(CHOIX) });
const autresIdentiques = a => Object.keys(AUTRES()).forEach(k => assert.strictEqual(a.m[k], AUTRES()[k], 'modifie : ' + k));

const tests = []; const t = (n, f) => tests.push([n, f]);

t('Hors connexion, erreur 500, delai depasse, table absente : choix identiques octet pour octet, en attente, aucune exception, autres donnees intactes', async () => {
  for (const mode of ['horsligne', 'erreur500', 'delai', 'tableAbsente']) {
    const f = fauxSupabase(); f.base.mode = mode; const a = appareil(f, departAvecChoix()); a.connecter(U);
    const avant = a.m[NS('it3_classements')]; const r = await a.sync();
    assert.strictEqual(a.m[NS('it3_classements')], avant, mode); assert.strictEqual(a.journal(), null, mode + ' : aucun journal cree');
    assert.ok(r && r.erreurs.length > 0, mode + ' : erreur notee (console seulement)'); autresIdentiques(a);
    assert.ok(Object.values(a.stock().exercices).every(c => !c.confirmeLe), mode + ' : toujours en attente'); } });
t('Retour du reseau : l\'envoi repart tout seul (evenement « online ») puis confirmation ; la base a les deux choix', async () => {
  const f = fauxSupabase(); f.base.mode = 'horsligne'; const a = appareil(f, departAvecChoix()); a.connecter(U); await a.sync();
  f.base.mode = 'ok'; assert.ok(a.ecoutes['win:online'], 'ecoute du retour reseau'); a.ecoutes['win:online']();
  for (let i = 0; i < 20 && !Object.values(a.stock().exercices).every(c => c.confirmeLe); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(Object.values(a.stock().exercices).every(c => c.confirmeLe), 'confirmes'); assert.strictEqual(f.base.lignes.size, 2);
  assert.ok(a.ecoutes['doc:visibilitychange'], 'retour au premier plan ecoute'); autresIdentiques(a); });
t('Deux appareils, meme compte : un choix fait sur l\'un arrive sur l\'autre ; l\'ancienne version de l\'autre va au journal puis est archivee', async () => {
  const f = fauxSupabase(), a = appareil(f, departAvecChoix()), b = appareil(f, AUTRES()); a.connecter(U); b.connecter(U);
  b.choisir('Bel', { principal: 'Dos', secondaires: [] }, Date.parse('2026-11-26T15:00:00Z')); // plus ancien que celui de A
  await a.sync(); await b.sync();
  assert.strictEqual(b.stock().exercices.Bel.principal, 'Mollets'); assert.strictEqual(b.stock().exercices['Hip trust machine'].principal, 'Fessiers');
  const j = b.journal(); assert.strictEqual(j.entrees.length, 1); assert.strictEqual(j.entrees[0].ancienne.principal, 'Dos'); assert.ok(j.entrees[0].archiveeLe, 'archive confirmee');
  assert.strictEqual(f.base.archives.size, 1); autresIdentiques(a); autresIdentiques(b); });
t('Identite non confirmee (etat pas encore charge) ou pas de connexion Supabase : aucune synchro, aucun appel', async () => {
  const f = fauxSupabase(), a = appareil(f, departAvecChoix()); a.connecter(U, false); assert.strictEqual(await a.sync(), null);
  a.ctx.__set(U, null, U.id); assert.strictEqual(await a.sync(), null); assert.deepStrictEqual(f.base.appels, []); });
t('Changement de compte pendant un envoi : reponse ignoree, rien ecrit dans l\'un ou l\'autre compte', async () => {
  const f = fauxSupabase(), a = appareil(f, departAvecChoix()); a.connecter(U);
  const avant = JSON.stringify(a.m); f.base.avantReponse = () => { f.base.avantReponse = null; a.ctx.__set(U2, f.sb, U2.id); };
  const r = await a.sync(); assert.ok(r.interrompu); assert.strictEqual(JSON.stringify(a.m), avant); assert.strictEqual(a.m[NS('it3_classements', U2)], undefined); });
t('Memoire pleine pour le journal : le choix local n\'est pas remplace par le cloud', async () => {
  const f = fauxSupabase(), a = appareil(f, departAvecChoix()); a.connecter(U); await a.sync();
  const b = appareil(f, Object.assign(AUTRES(), { [NS('it3_classements')]: JSON.stringify({ version: 1, exercices: { Bel: { principal: 'Dos', secondaires: [], modifieLe: '2026-11-26T10:00:00.000Z' } } }) }), { plein: k => k.indexOf('journal') >= 0 });
  b.connecter(U); const avant = b.m[NS('it3_classements')]; const r = await b.sync();
  assert.strictEqual(b.m[NS('it3_classements')], avant); assert.ok(r.erreurs.includes('journal_non_ecrit')); autresIdentiques(b); });
t('Lot refuse par un controle : nouvel essai ligne par ligne ; la ligne refusee reste en attente, les autres sont confirmees', async () => {
  const f = fauxSupabase(); f.base.refuserNom = 'Bel'; const a = appareil(f, departAvecChoix()); a.connecter(U); await a.sync();
  assert.ok(a.stock().exercices['Hip trust machine'].confirmeLe); assert.ok(!a.stock().exercices.Bel.confirmeLe);
  assert.deepStrictEqual(f.base.appels.filter(x => x.startsWith('envoi')), ['envoi:2', 'envoi:1', 'envoi:1']); });
t('Seances, routines, fatigue, cycle, complements, exercices perso : identiques octet pour octet ; training-backup jamais appele par la synchro', async () => {
  const f = fauxSupabase(), a = appareil(f, departAvecChoix()); a.connecter(U); await a.sync(); await a.sync();
  autresIdentiques(a); assert.ok(!f.base.appels.includes('training-backup'));
  assert.ok(a.ecritures.every(k => k === NS('it3_classements') || k === NS('it3_classements_journal')), 'seules les cles des choix et du journal sont ecrites : ' + a.ecritures.join(','));
  assert.ok(!/it3_sessions|it3_routines|training-backup|autoBackup/.test(BLOC_SYNCHRO.replace(/\/\/.*$/gm, '')), 'le bloc ne touche pas aux seances / routines / sauvegarde'); });
t('Aucun texte « synchronise » ni etat de synchro dans l\'interface ; le panneau affiche toujours « Enregistré » apres relecture locale seulement', () => {
  const code = BLOC_SYNCHRO.replace(/\/\/.*$/gm, '');
  assert.ok(!/alert\(|setEtat|innerHTML|textContent|<\w/.test(code), 'aucun affichage dans le bloc');
  assert.ok(!/synchronis|sync ✓|☁/i.test(SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/syncClassements|_syncMusclesEnCours|_syncMusclesARelancer|synchroniserClassements|_syncFromCloud|syncFromCloud/g, '')), 'aucun texte de synchronisation');
  const panel = cut('function MusclesPanel(', 'const bouton = ');
  assert.ok(/setEtat\(ok \? "ok" : "erreur"\);\s*\n\s*if \(ok\) \{ onSaved && onSaved\(\); setTimeout\(onClose, 900\); \(typeof syncClassements === "function" && syncClassements\("choix"\)\); \}/.test(panel), 'envoi apres « Enregistré », en arriere-plan'); });
t('Export : le journal des versions ecartees est inclus ; l\'import des choix declenche un envoi (ajout seulement)', () => {
  assert.ok(/classementsJournal: load\(KEYS\.classementsJournal\) \|\| \{ version: 1, entrees: \[\] \}/.test(fnSrc('function exportData()')));
  assert.ok(/if \(f\.change\) \{ save\(KEYS\.classements, f\.classements\); \(typeof syncClassements === "function" && syncClassements\("import"\)\); \}/.test(SRC)); });
t('Idempotence cote appli : deux synchros de suite ne changent rien (stockage, journal, base)', async () => {
  const f = fauxSupabase(), a = appareil(f, departAvecChoix()); a.connecter(U); await a.sync();
  const s1 = JSON.stringify([a.m, [...f.base.lignes], [...f.base.archives]]); await a.sync(); assert.strictEqual(JSON.stringify([a.m, [...f.base.lignes], [...f.base.archives]]), s1); });

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
