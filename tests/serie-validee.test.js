// Lancer : node tests/serie-validee.test.js
// 0.20.1 : une serie validee est enregistree IMMEDIATEMENT dans la seance en cours (it3_current_session), avec son heure,
// meme si l'appli est fermee juste apres. Le VRAI markSetDone d'index.html tourne dans un bac a sable.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fnSrc = sig => { const i = SRC.indexOf(sig); if (i < 0) throw new Error('fonction ' + sig); let d = 0; for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } };
const CODE = fnSrc('function markSetDone('); // pas de JSX dans cette fonction : execute tel quel

function bac(seance, maintenant) {
  const ctx = { stockage: {}, etat: seance, minuteurs: [], alertes: [], Date: { now: () => maintenant }, JSON, Math, parseFloat, parseInt,
    navigator: {}, window: { _isPremium: () => false }, sessions: [], estActivation: () => false, horsActivation: s => s, console };
  ctx.currentSets = seance;
  ctx.setCurrentSets = f => { ctx.etat = typeof f === 'function' ? f(ctx.etat) : f; };
  ctx.lsSetNs = (k, v) => { ctx.stockage[k] = v; };
  ctx.alert = m => ctx.alertes.push(m);
  ctx.setValidationToast = () => {}; ctx.setTimeout = () => {}; ctx.startTimer = (...a) => ctx.minuteurs.push(a); ctx.checkStagnation = () => {};
  vm.createContext(ctx); vm.runInContext(CODE, ctx);
  return ctx;
}
const seance = () => ({ routineId: 1, routineName: 'Push', exercises: [{ name: 'Développé couché haltères', rest: 120, sets: [
  { weight: '40', reps: '10', rir: '', rirSaisi: false, done: false }, { weight: '40', reps: '9', rir: '', rirSaisi: false, done: false }, { weight: '40', reps: '', rir: '', rirSaisi: false, done: false }] }] });
const tests = []; const t = (n, f) => tests.push([n, f]);

t('Validation : seance en cours ecrite tout de suite dans le stockage, serie validee + heure ; rien d\'autre ne change', () => {
  const T = 1795850000000, c = bac(seance(), T); c.markSetDone(0, 0);
  const lu = JSON.parse(c.stockage.it3_current_session); const s = lu.exercises[0].sets;
  assert.deepStrictEqual([s[0].done, s[0].faiteLe, s[1].done, s[1].faiteLe], [true, T, false, undefined]);
  assert.strictEqual(JSON.stringify(lu), JSON.stringify(c.etat), 'stockage = etat affiche');
  assert.deepStrictEqual([lu.routineId, lu.routineName, s[0].weight, s[0].reps], [1, 'Push', '40', '10']);
  assert.strictEqual(c.minuteurs.length, 1, 'minuteur de repos lance comme avant');
});

t('Fermeture juste apres la validation : a la reouverture, la serie validee et son heure sont la', () => {
  const T = 1795850000000, c = bac(seance(), T); c.markSetDone(0, 1);
  const reouverte = JSON.parse(c.stockage.it3_current_session); // ce que readCurrentSets relit au demarrage
  assert.deepStrictEqual([reouverte.exercises[0].sets[1].done, reouverte.exercises[0].sets[1].faiteLe], [true, T]);
});

t('Devalidation : enregistree tout de suite aussi, et l\'heure est retiree', () => {
  const T = 1795850000000, c = bac(seance(), T); c.markSetDone(0, 0);
  const c2 = bac(c.etat, T + 60000); c2.markSetDone(0, 0);
  const s = JSON.parse(c2.stockage.it3_current_session).exercises[0].sets[0];
  assert.deepStrictEqual([s.done, 'faiteLe' in s], [false, false]);
});

t('Serie incomplete (reps manquantes) : refusee, rien n\'est ecrit', () => {
  const c = bac(seance(), 1); c.markSetDone(0, 2);
  assert.strictEqual(c.stockage.it3_current_session, undefined); assert.strictEqual(c.alertes.length, 1);
});

t('Deux series validees a la suite : chacune garde sa propre heure', () => {
  const c = bac(seance(), 1000); c.markSetDone(0, 0);
  const c2 = bac(c.etat, 95000); c2.markSetDone(0, 1);
  const s = JSON.parse(c2.stockage.it3_current_session).exercises[0].sets;
  assert.deepStrictEqual([s[0].faiteLe, s[1].faiteLe], [1000, 95000]);
});

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
