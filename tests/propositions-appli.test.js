// Lancer : node tests/propositions-appli.test.js
// Coach 0.18.0, cote APPLI : le VRAI code d'index.html (stockage par compte, KEYS, load/save, decisionCoach) tourne dans un faux
// navigateur avec le vrai moteur. Accepter / Refuser une proposition : programme archive puis mis a jour, ou rien du tout.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
process.env.TZ = 'Europe/Paris';
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'coach-engine.js'), 'utf8');
const cut = (a, b) => { const i = SRC.indexOf(a); if (i < 0) throw new Error('marqueur ' + a); const j = SRC.indexOf(b, i); if (j < 0) throw new Error('fin ' + b); return SRC.slice(i, j); };
const fnSrc = sig => { const i = SRC.indexOf(sig); if (i < 0) throw new Error('fonction ' + sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
const CODE = cut('var supabase = null;', '// Migration legacy') + '\n' + cut('const KEYS = {', 'function analyzeEx(') + '\n' + fnSrc('function coachEngine()') + '\n' +
  fnSrc('function _ecrireVerifie(') + '\n' + fnSrc('function classementsStock(') + '\n' + fnSrc('function cleExercice(') + '\n' + fnSrc('function optionsMuscles(') + '\n' + fnSrc('function decisionCoach(') +
  '\nthis.__set = (u, uidEtat) => { currentUser = u; _stateUid = uidEtat; }; this.__KEYS = KEYS;';
const U = { id: 'compte-test-A' }, NS = k => k + '_u_' + U.id;
const DC = 'Développé couché haltères', J = '2026-11-28';
const addDays = (d, n) => { const p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
const st = txt => txt.split(',').map(y => { const [w, r] = y.split('x').map(Number); return { weight: String(w), reps: String(r), rir: '', rirSaisi: false, done: true }; });
const SESSIONS = Array.from({ length: 6 }, (_, i) => ({ id: Date.parse(addDays(J, -21 + i * 4) + 'T18:00:00Z'), date: addDays(J, -21 + i * 4), routineId: 1, routineName: 'Push',
  exercises: [{ name: DC, repsTarget: '8-12', sets: st(i < 3 ? '40x10,40x10,40x9' : '40x12,40x12,40x11') }] }));
const ROUTINES = [{ id: 1, name: 'Push', day: 'LUNDI', exercises: [{ name: DC, sets: 3, repsTarget: '8-12', rest: 180, note: 'Coude proche du buste.' }] }, { id: 2, name: 'Pull', exercises: [{ name: 'Rowing', sets: 3, repsTarget: '8-12' }] }];

function appareil(init, opts) {
  opts = opts || {};
  const m = Object.assign({}, init || {}), ecritures = [];
  const ls = { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { if (opts.plein && opts.plein(k)) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } ecritures.push(k); m[k] = String(v); }, removeItem: k => { delete m[k]; } };
  const ctx = { console: { warn() {}, log() {}, error() {} }, JSON, Math, Date, Array, Object, Promise, Error, String, Number, parseInt, parseFloat, isFinite, isNaN, setTimeout, localStorage: ls, alert() {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(ENGINE, ctx); vm.runInContext(CODE, ctx);
  ctx.__set(U, U.id);
  return { ctx, m, ecritures, lire: k => (m[NS(k)] === undefined ? null : JSON.parse(m[NS(k)])),
    propositions(o) { const CE = ctx.CoachEngine; return CE.propositionsAdaptation({ sessions: this.lire('it3_sessions'), routines: this.lire('it3_routines'), fatigue: this.lire('it3_fatigue'), decisions: this.lire('it3_coach_decisions') }, Object.assign({ maintenant: J, normaliserNom: ctx.cleExercice }, o || {})); },
    decider(p, statut, routinesAffichees) { return ctx.decisionCoach(ctx.CoachEngine, p, statut, routinesAffichees || this.lire('it3_routines'), J + 'T07:00:00.000Z'); } };
}
const depart = () => ({ [NS('it3_sessions')]: JSON.stringify(SESSIONS), [NS('it3_routines')]: JSON.stringify(ROUTINES), [NS('it3_fatigue')]: JSON.stringify({ sleep: 0, appetite: 0 }) });
const tests = []; const t = (n, f) => tests.push([n, f]);

t('Accepter : ancien programme archive a l\'identique, nouveau programme enregistre (charge cible datee), decision gardee ; seances intactes', () => {
  const a = appareil(depart()), avant = a.m[NS('it3_routines')], seancesAvant = a.m[NS('it3_sessions')];
  const p = a.propositions().propositions[0]; assert.strictEqual(JSON.stringify([p.type, p.apres]), JSON.stringify(['charge', { charge: 42.5 }]));
  const r = a.decider(p, 'acceptee'); assert.ok(r.ok, r.texte);
  const h = a.lire('it3_routines_historique'); assert.strictEqual(h.versions.length, 1); assert.strictEqual(JSON.stringify(h.versions[0].routines), avant);
  const nv = a.lire('it3_routines'); assert.strictEqual(JSON.stringify([nv[0].exercises[0].chargeCible, nv[0].exercises[0].chargeCibleLe, nv[0].exercises[0].note, nv[1]]), JSON.stringify([42.5, J + 'T07:00:00.000Z', 'Coude proche du buste.', ROUTINES[1]]));
  assert.strictEqual(a.lire('it3_coach_decisions').decisions[p.id].statut, 'acceptee');
  assert.strictEqual(a.m[NS('it3_sessions')], seancesAvant);
  assert.deepStrictEqual(a.ecritures, [NS('it3_routines_historique'), NS('it3_routines'), NS('it3_coach_decisions')], 'ordre : archive, programme, decision');
  // Le nouveau programme sert de reference : plus de proposition sur cet exercice ; la charge cible est utilisee au prochain demarrage.
  const ap = a.propositions(); assert.strictEqual(ap.propositions.length, 0); assert.strictEqual(ap.exercices[0].enEssai, true);
  assert.strictEqual(a.ctx.CoachEngine.chargeCibleActive(nv[0].exercises[0], SESSIONS, { normaliserNom: a.ctx.cleExercice }), 42.5);
  assert.ok(/Programme mis à jour/.test(r.texte));
});

t('Refuser : programme strictement inchange (aucune ecriture), decision gardee ; la proposition ne revient pas', () => {
  const a = appareil(depart()), avant = a.m[NS('it3_routines')], p = a.propositions().propositions[0];
  const r = a.decider(p, 'refusee'); assert.ok(r.ok); assert.strictEqual(r.routines, null);
  assert.strictEqual(a.m[NS('it3_routines')], avant); assert.deepStrictEqual(a.ecritures, [NS('it3_coach_decisions')]);
  assert.strictEqual(a.propositions().propositions.length, 0);
});

t('Programme modifie entre l\'affichage et le clic : RIEN n\'est ecrit (ni archive, ni programme, ni decision)', () => {
  const a = appareil(depart()), p = a.propositions().propositions[0];
  const modifie = JSON.parse(JSON.stringify(ROUTINES)); modifie[0].exercises[0].repsTarget = '6-10'; a.m[NS('it3_routines')] = JSON.stringify(modifie);
  const r = a.decider(p, 'acceptee'); assert.strictEqual(r.ok, false); assert.ok(/a changé/.test(r.texte));
  assert.deepStrictEqual(a.ecritures, []); assert.strictEqual(a.m[NS('it3_routines')], JSON.stringify(modifie));
});

t('Stockage plein au moment d\'ecrire le programme : programme enregistre inchange, decision non enregistree (la proposition reste)', () => {
  const a = appareil(depart(), { plein: k => k === NS('it3_routines') }), avant = a.m[NS('it3_routines')], p = a.propositions().propositions[0];
  const r = a.decider(p, 'acceptee'); assert.strictEqual(r.ok, false);
  assert.strictEqual(a.m[NS('it3_routines')], avant); assert.strictEqual(a.lire('it3_coach_decisions'), null);
  assert.strictEqual(a.propositions().propositions.length, 1);
});

t('Archive : chaque acceptation AJOUTE une version, aucune n\'est jamais effacee', () => {
  const a = appareil(Object.assign(depart(), { [NS('it3_routines_historique')]: JSON.stringify({ version: 1, versions: [{ le: '2026-01-01T00:00:00.000Z', proposition: 'ancienne', routines: [] }] }) }));
  a.decider(a.propositions().propositions[0], 'acceptee');
  const h = a.lire('it3_routines_historique'); assert.deepStrictEqual(h.versions.map(v => v.proposition), ['ancienne', a.lire('it3_coach_decisions') && Object.keys(a.lire('it3_coach_decisions').decisions)[0]]);
});

t('Compte non confirme (identite en cours de chargement) : aucune ecriture', () => {
  const a = appareil(depart()), p = a.propositions().propositions[0]; a.ctx.__set(U, null);
  assert.strictEqual(a.decider(p, 'acceptee').ok, false); assert.deepStrictEqual(a.ecritures, []);
});

t('Source : carte sur l\'Accueil, decision uniquement au clic ; pre-remplissage par la charge acceptee ; export inclut decisions et archive', () => {
  const carte = cut('function CoachPropositions(', 'function HomeTab(');
  assert.ok(/onClick=\{\(\) => decider\(p, "acceptee"\)\}/.test(carte) && /onClick=\{\(\) => decider\(p, "refusee"\)\}/.test(carte));
  assert.strictEqual((carte.match(/decider\(/g) || []).length, 3, 'decider : definition + 2 boutons, aucun appel automatique');
  assert.ok(!/appliquerProposition/.test(carte), 'la carte n\'applique rien elle-meme');
  assert.ok(/<CoachPropositions sessions=\{sessions\} routines=\{routines\} setRoutines=\{setRoutines\} fatigue=\{fatigue\} \/>/.test(cut('function HomeTab(', 'const FREQ_OPTIONS')));
  assert.ok(/weight: chargeCoach !== null \? String\(chargeCoach\) : \(lastSets\[i\]/.test(SRC));
  const ex = fnSrc('function exportData()'); assert.ok(/coachDecisions: load\(KEYS\.coachDecisions\)/.test(ex) && /routinesHistorique: load\(KEYS\.routinesHistorique\)/.test(ex));
  assert.ok(!/synchronis/i.test(carte.replace(/\/\/.*$/gm, '')));
});

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
