// Test de fumee de l'APPLICATION COMPLETE (React + jsdom, vrai index.html) : un compte neuf (sans routine ni seance), gratuit ou bêta,
// et un compte existant, parcourent tous les onglets sans erreur. Dev uniquement : npm i react@18 react-dom@18 jsdom @babel/core @babel/preset-react --no-save
const { loadApp } = require('./_dom.js'); const vm = require('vm'), assert = require('assert'); global.IS_REACT_ACT_ENVIRONMENT = true; const U = 'user-A';
const TABS = ['ACCUEIL', 'ROUTINES', 'SEANCE', 'PROG.', 'BILAN', 'SUPP.', 'SNS'];
async function run(store, profile) {
  const errs = []; const app = loadApp({ alert: m => errs.push('alert: ' + m) }); const { w, createRoot, React, act } = app; const ctx = app.dom.getInternalVMContext(); global.window = w; global.document = w.document;
  w.console.error = (...a) => errs.push('console.error: ' + String(a[0]).slice(0, 140));
  w.AudioContext = function () { return { createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {} }; }, createGain() { return { connect() {}, gain: {} }; }, destination: {}, currentTime: 0, resume() {} }; };
  vm.runInContext("currentUser = { id: '" + U + "', email: 'a@x.fr' }; _stateUid = '" + U + "'; userProfile = " + JSON.stringify(profile) + ";", ctx); Object.entries(store).forEach(([k, v]) => w.localStorage.setItem(k, v));
  const root = createRoot(w.document.getElementById('root')); act(() => root.render(React.createElement(w.IronTraining)));
  const visited = []; for (const n of TABS) { const b = [...w.document.querySelectorAll('button')].find(x => x.textContent.trim() === n); assert.ok(b, 'onglet introuvable : ' + n); act(() => { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); visited.push(n); }
  return { errs, visited, text: w.document.body.textContent };
}
const sess = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: i + 1, date: '2026-10-0' + (i + 1), routineName: 'R', exercises: [{ name: 'Développé couché haltères', sets: [{ weight: 20, reps: 8, rir: 2 }] }] })));
const rout = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: 'PERSO ' + i, day: 'LUNDI', color: '#f60', exercises: [{ name: 'Exo', sets: 3, repsTarget: '8' }] })));
const tests = []; const t = (n, f) => tests.push([n, f]);
for (const [label, store, profile] of [['compte NEUF, gratuit', {}, { premium: false }], ['compte NEUF, bêta active (Premium)', {}, { premium: false, beta_active: true }],
  ['compte avec seances mais SANS routine, bêta', { ['it3_sessions_u_' + U]: sess }, { beta_active: true }], ['compte existant (6 routines + seances), bêta', { ['it3_sessions_u_' + U]: sess, ['it3_routines_u_' + U]: rout }, { beta_active: true }],
  ['compte existant, bêta expiree (gratuit)', { ['it3_sessions_u_' + U]: sess, ['it3_routines_u_' + U]: rout }, { beta_active: false, beta_expires_at: '2026-10-01T00:00:00Z' }]])
  t('APPLICATION COMPLETE — ' + label + ' : les 7 onglets s\'affichent sans aucune erreur', async () => { const r = await run(store, profile); assert.deepStrictEqual(r.visited, TABS); assert.deepStrictEqual(r.errs, []); });
t('onglets Progres / Bilan : verrouilles en gratuit, ouverts avec la bêta', async () => {
  const g = await run({ ['it3_sessions_u_' + U]: sess }, { premium: false }); const b = await run({ ['it3_sessions_u_' + U]: sess }, { beta_active: true });
  assert.ok(/premium|Premium|PREMIUM/.test(g.text), 'invitation Premium en gratuit'); assert.deepStrictEqual(b.errs, []);
});
(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
