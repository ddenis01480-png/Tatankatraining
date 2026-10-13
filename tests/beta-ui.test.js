// Rendu REEL de l'ecran Programme (RoutinesTab) avec React + jsdom, a partir du vrai index.html.
// Dev uniquement : npm i react@18 react-dom@18 jsdom @babel/core @babel/preset-react --no-save   puis   node tests/beta-ui.test.js
const { loadApp } = require('./_dom.js'); const vm = require('vm'), assert = require('assert');
global.IS_REACT_ACT_ENVIRONMENT = true;
const U = 'user-A', NS = b => b + '_u_' + U; const clone = x => JSON.parse(JSON.stringify(x));
const own = n => ({ id: 1000 + n, name: 'MA ROUTINE ' + n, day: 'LUNDI', color: '#fff', exercises: [{ name: 'Mon exo', sets: 3, repsTarget: '8' }] });
function mount(o) {
  o = o || {}; const log = { confirms: [], alerts: [] };
  const app = loadApp({ confirm: m => { log.confirms.push(m); return o.confirm !== false; }, alert: m => log.alerts.push(m) }); const { w, createRoot, React, act } = app; const ctx = app.dom.getInternalVMContext();
  assert.strictEqual(app.errors.length, 0, 'chargement du vrai index.html : ' + app.errors.join(' | '));
  global.window = w; global.document = w.document;
  vm.runInContext("currentUser = { id: '" + U + "', email: 'a@x.fr' }; _stateUid = '" + U + "';", ctx);                // identite connue + etat appartient au compte : ecritures autorisees
  Object.entries(o.store || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
  let setR; function Wrapper() { const [routines, setRoutines] = React.useState(o.routines || []); const [view, setView] = React.useState(o.view || 'list'); const [editing, setEditing] = React.useState(o.editing || null); setR = setRoutines;
    return React.createElement(w.RoutinesTab, { routines, setRoutines, onStartSession() {}, view, setView, editing, setEditing }); }
  const container = w.document.getElementById('root'); const root = createRoot(container); act(() => root.render(React.createElement(Wrapper)));
  const btn = label => [...container.querySelectorAll('button')].find(b => b.textContent.trim().includes(label));
  return { w, ctx, container, log, act, text: () => container.textContent, btn, has: l => !!btn(l),
    click: label => { const b = btn(label); assert.ok(b, 'bouton introuvable : ' + label); act(() => { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); },
    store: k => w.localStorage.getItem(k), badges: () => [...container.querySelectorAll('div')].filter(d => d.textContent === 'EXEMPLE TATANKA').length,
    example: () => vm.runInContext('EXAMPLE_PROGRAM', ctx), remount: () => { act(() => root.unmount()); const r2 = createRoot(container); act(() => r2.render(React.createElement(Wrapper))); } };
}
const tests = []; const t = (n, f) => tests.push([n, f]);

t('PROGRAMME EXEMPLE : 6 routines, aucune donnee personnelle ni performance (ni date, poids, reps realises, e-mail), ids uniques', () => {
  const m = mount(); const ex = m.example(); assert.strictEqual(ex.length, 6); assert.strictEqual(new Set(ex.map(r => r.id)).size, 6);
  const js = JSON.stringify(ex); for (const bad of ['"weight"', '"date"', '"done"', '@', '"sessions"', '"email"']) assert.ok(!js.includes(bad), 'ne doit pas contenir ' + bad);
  ex.forEach(r => { assert.ok(r.name && r.exercises.length > 0); r.exercises.forEach(e => assert.deepStrictEqual(Object.keys(e).filter(k => !['name', 'sets', 'repsTarget', 'rest', 'warmupSets', 'warmupLabel', 'note'].includes(k)), [])); });
});
t('15. COMPTE NEUF (aucune routine) : ecran propre + offre « Programme exemple Tatanka » (Charger / Ignorer), rien d\'ecrit, aucune routine affichee', () => {
  const m = mount({ routines: [] }); assert.ok(m.text().includes('PROGRAMME EXEMPLE TATANKA')); assert.ok(m.has('CHARGER LE PROGRAMME EXEMPLE')); assert.ok(m.has('IGNORER')); assert.ok(m.has('+ NOUVELLE ROUTINE'));
  assert.strictEqual(m.badges(), 0); assert.strictEqual(m.store(NS('it3_routines')), null, 'rien d\'ecrit tant que l\'utilisateur ne decide pas'); assert.strictEqual(m.store(NS('it3_sessions')), null);
});
t('14. CHARGER : 6 routines marquees EXEMPLE TATANKA ; AUCUNE seance / stat / donnee creee ; donnees deja presentes intactes', () => {
  const sessions = JSON.stringify([{ id: 1, date: '2026-10-01', exercises: [] }]); const m = mount({ routines: [], store: { [NS('it3_sessions')]: sessions, [NS('it3_supps')]: '[{"id":1}]' } });
  m.click('CHARGER LE PROGRAMME EXEMPLE'); const stored = JSON.parse(m.store(NS('it3_routines'))); assert.strictEqual(stored.length, 6); assert.ok(stored.every(r => r.example === true)); assert.strictEqual(m.badges(), 6);
  m.example().forEach(r => assert.ok(m.text().includes(r.name))); assert.ok(!m.has('CHARGER LE PROGRAMME EXEMPLE'), 'l\'offre disparait'); assert.ok(m.has('SUPPRIMER LE PROGRAMME EXEMPLE'));
  assert.strictEqual(m.store(NS('it3_sessions')), sessions); assert.strictEqual(m.store(NS('it3_supps')), '[{"id":1}]'); assert.strictEqual(m.store(NS('it3_cycle')), null); assert.strictEqual(m.store(NS('it3_fatigue')), null);
});
t('SUPPRIMER le programme exemple en un geste : seules les routines exemple partent ; refus = aucun changement ; seances intactes', () => {
  const sessions = JSON.stringify([{ id: 1, date: '2026-10-01', exercises: [] }]); const m = mount({ routines: [], store: { [NS('it3_sessions')]: sessions } }); m.click('CHARGER LE PROGRAMME EXEMPLE');
  const full = m.store(NS('it3_routines')); m.w.confirm = () => false; vm.runInContext('confirm = () => false', m.ctx); m.click('SUPPRIMER LE PROGRAMME EXEMPLE'); assert.strictEqual(m.store(NS('it3_routines')), full, 'refus => rien ne change');
  vm.runInContext('confirm = () => true', m.ctx); m.click('SUPPRIMER LE PROGRAMME EXEMPLE'); assert.deepStrictEqual(JSON.parse(m.store(NS('it3_routines'))), []); assert.strictEqual(m.badges(), 0); assert.strictEqual(m.store(NS('it3_sessions')), sessions);
  assert.ok(m.has('CHARGER LE PROGRAMME EXEMPLE'), 'compte de nouveau sans routine : l\'offre reapparait');
});
t('IGNORER : l\'offre se reduit a un petit bouton, le choix est memorise (relance de l\'ecran) ; aucune routine creee', () => {
  const m = mount({ routines: [] }); m.click('IGNORER'); assert.strictEqual(m.store(NS('it3_example_dismissed')), '1'); assert.ok(!m.has('IGNORER')); assert.ok(m.has('CHARGER LE PROGRAMME EXEMPLE TATANKA'));
  m.remount(); assert.ok(!m.has('IGNORER') && m.has('CHARGER LE PROGRAMME EXEMPLE TATANKA')); assert.strictEqual(m.store(NS('it3_routines')), null);
});
t('COMPTE EXISTANT (avec routines) : aucune offre, aucun badge, aucun bouton exemple — son programme personnel n\'est jamais remplace ni complete', () => {
  const m = mount({ routines: [own(1), own(2)] }); assert.ok(!m.text().includes('PROGRAMME EXEMPLE')); assert.ok(!m.has('CHARGER')); assert.ok(!m.has('SUPPRIMER LE PROGRAMME')); assert.strictEqual(m.badges(), 0); assert.ok(m.text().includes('MA ROUTINE 1') && m.text().includes('MA ROUTINE 2'));
  assert.strictEqual(m.store(NS('it3_routines')), null, 'simple affichage : aucune ecriture');
});
t('MELANGE (routine perso + programme exemple) : supprimer l\'exemple conserve les routines perso', () => {
  const ex = mount().example().map(r => ({ ...clone(r), example: true })); const m = mount({ routines: [own(1), ...ex] }); assert.strictEqual(m.badges(), 6); m.click('SUPPRIMER LE PROGRAMME EXEMPLE');
  const left = JSON.parse(m.store(NS('it3_routines'))); assert.deepStrictEqual(left.map(r => r.name), ['MA ROUTINE 1']);
});
t('MODIFIER une routine exemple en fait une routine PERSONNELLE : elle survit a la suppression du programme exemple', () => {
  const ex = mount().example().map(r => ({ ...clone(r), example: true })); const m = mount({ routines: ex, view: 'edit', editing: clone(ex[1]) });
  m.click('SAUVEGARDER'); const saved = JSON.parse(m.store(NS('it3_routines'))); assert.strictEqual(saved.length, 6); const mine = saved.find(r => r.id === ex[1].id); assert.ok(mine && !('example' in mine), 'plus de marque exemple');
  assert.strictEqual(saved.filter(r => r.example === true).length, 5); m.click('SUPPRIMER LE PROGRAMME EXEMPLE'); const left = JSON.parse(m.store(NS('it3_routines'))); assert.deepStrictEqual(left.map(r => r.id), [ex[1].id]);
});
(async () => { let fail = 0; console.log('Rendu reel (React + jsdom) du vrai index.html');
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
