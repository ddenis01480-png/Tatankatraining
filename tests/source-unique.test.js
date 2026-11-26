// Lancer : node tests/source-unique.test.js
//          EXPORT_FILE=/chemin/export.json node tests/source-unique.test.js   (ajoute les controles sur un export reel, lu seulement)
//
// Etape 1 du moteur d'analyse du programme (0.14.0) : UNE seule source de verite par sujet.
//   1. Inventaire exhaustif des appels a analyser() et des lecteurs de ses champs (appli, API, moteur) : aucune dependance cassee.
//   2. analyser() reprend exactement volumeMuscles (volume / frequence) et dernieresSollicitations (recuperation).
//   3. Les anciennes volume(), recuperation(), priorites() restent exportees mais ne sont plus appelees par le moteur ni par l'appli.
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'coach-engine.js'));
const lire = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sansCommentaires = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
const HTML = lire('index.html'), MOTEUR = lire('coach-engine.js');
// Tous les fichiers de code livres (hors tests) : l'appli, le moteur, les fonctions serveur du depot.
const FICHIERS_CODE = ['index.html', 'coach-engine.js'].concat(fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f)).map(f => 'api/' + f));

const S = (w, r, extra) => Object.assign({ weight: w, reps: r, rir: 2, done: true }, extra || {});
const sess = (id, date, exs) => ({ id, date, routineId: 1, routineName: 'R', exercises: exs });
const ex = (name, sets, extra) => Object.assign({ name, repsTarget: '8-12', sets }, extra || {});
const plain = o => JSON.parse(JSON.stringify(o));
const finJour = j => { const p = j.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999).getTime(); };
const JEU = () => [
  sess(Date.UTC(2026, 0, 2, 17), '2026-01-02', [ex('Développé couché haltères', [S(30, 10), S(30, 9)]), ex('Élévations latérales haltères', [S(10, 15)])]),
  sess(Date.UTC(2026, 0, 5, 17), '2026-01-05', [ex('Oiseau haltères', [S(6, 20)], { activation: true }), ex('Tirage poulie haute prise large', [S(60, 10), S(60, 10)])]),
  sess(Date.UTC(2026, 0, 20, 17), '2026-01-20', [ex('Squat barre', [S(100, 8), S(100, 8), S(100, 7)]), ex('Exo perso inconnu', [S(10, 10)])]),
  sess(Date.UTC(2026, 0, 27, 17), '2026-01-27', [ex('Curl haltères', [S(14, 10)]), ex('Développé couché haltères', [S(30, 10), S(30, 10)])])];

const tests = []; const t = (n, f) => tests.push([n, f]);

// ═════════ 1. Inventaire exhaustif des consommateurs ═════════
t('Inventaire : dans tout le code livre, analyser n\'est cite qu\'a 2 endroits (sa definition et le test d\'existence du moteur)', () => {
  const trouves = [];
  FICHIERS_CODE.forEach(f => sansCommentaires(lire(f)).split('\n').forEach((l, i) => { if (/\banalyser\b/.test(l)) trouves.push(f + ':' + (i + 1) + ' ' + l.trim()); }));
  const attendus = trouves.filter(l => /^coach-engine\.js:\d+ function analyser\(donnees, options\)/.test(l) || /^coach-engine\.js:\d+ analyser: analyser$/.test(l)
    || /^index\.html:\d+ function coachEngine\(\).*typeof CE\.analyser === "function"/.test(l));
  assert.deepStrictEqual(trouves, attendus, 'appel ou lecture inattendus :\n' + trouves.filter(l => attendus.indexOf(l) < 0).map(l => l.slice(0, 160)).join('\n'));
  assert.strictEqual(attendus.length, 3); });
t('Inventaire : l\'appli n\'appelle jamais analyser() (seulement « typeof CE.analyser ») donc ne lit aucun de ses champs', () => {
  const code = sansCommentaires(HTML);
  assert.ok(!/analyser\s*\(/.test(code), 'appel a analyser( dans index.html');
  assert.ok(!/\[\s*["']analyser["']\s*\]/.test(code), 'acces indirect CE["analyser"]');
  // Aucun alias du type « const a = CE.analyser » ni destructuration { analyser }.
  assert.ok(!/=\s*CE\.analyser\b|\{\s*[^}]*\banalyser\b[^}]*\}\s*=/.test(code)); });
t('Inventaire : l\'appli n\'appelle ni volume(), ni recuperation(), ni priorites() du moteur, et ne lit aucun champ propre a analyser()', () => {
  const code = sansCommentaires(HTML);
  ['volume', 'recuperation', 'priorites', 'rirRecent', 'morphologie'].forEach(f => assert.ok(!new RegExp('\\b(CE|CEfin|CoachEngine|E)\\.' + f + '\\b').test(code), 'appel CE.' + f));
  ['.priorites', '.recuperation', '.parMuscle', '.rir7j', '.morphologie', '.propositions', '.exercicesNonClasses', '.idsEnDouble', '.seancesHorsOrdre'].forEach(champ =>
    assert.ok(code.indexOf(champ) < 0, 'lecture du champ ' + champ)); });
t('Inventaire : les fonctions serveur du depot (api/) n\'utilisent pas le moteur', () => {
  FICHIERS_CODE.filter(f => f.indexOf('api/') === 0).forEach(f => assert.ok(!/CoachEngine|coach-engine/.test(lire(f)), f)); });
t('Inventaire : dans le moteur, volume(), recuperation() et priorites() ne sont plus appelees (definition + export seulement)', () => {
  const code = sansCommentaires(MOTEUR);
  [['volume', /\bvolume\s*\(/g], ['recuperation', /\brecuperation\s*\(/g], ['priorites', /\bpriorites\s*\(/g]].forEach(([n, re]) => {
    const appels = (code.match(re) || []).length; assert.strictEqual(appels, 1, n + ' : ' + appels + ' occurrence(s), seule la definition attendue'); });
  assert.strictEqual(typeof E.volume, 'function'); assert.strictEqual(typeof E.recuperation, 'function'); assert.strictEqual(typeof E.priorites, 'function'); });

// ═════════ 2. Source unique ═════════
t('Version 0.14.0', () => assert.strictEqual(E.VERSION, '0.14.0'));
t('analyser().volume = volumeMuscles (28 jours, direct et indirect separes, valeurs reelles), au caractere pres', () => {
  const an = E.analyser({ sessions: JEU() }, { maintenant: '2026-01-28' });
  assert.deepStrictEqual(plain(an.volume), plain(E.volumeMuscles(E.normaliserSeances(JEU()), { fin: '2026-01-28' })));
  assert.strictEqual(an.volume.periode.jours, 28); assert.strictEqual(an.volume.periode.au, '2026-01-28');
  assert.strictEqual(an.volume.muscles.Pectoraux.direct.series, 4); assert.strictEqual(an.volume.muscles.Triceps.indirect.series, 4); assert.strictEqual(an.volume.muscles.Triceps.direct.series, 0); });
t('analyser().recuperation = dernieresSollicitations a la fin du jour d\'analyse (jour seul) ou a l\'instant exact (Date)', () => {
  const N = E.normaliserSeances(JEU());
  assert.deepStrictEqual(plain(E.analyser({ sessions: JEU() }, { maintenant: '2026-01-28' }).recuperation), plain(E.dernieresSollicitations(N, finJour('2026-01-28'))));
  const instant = new Date(Date.UTC(2026, 0, 28, 9, 30));
  assert.deepStrictEqual(plain(E.analyser({ sessions: JEU() }, { maintenant: instant }).recuperation), plain(E.dernieresSollicitations(N, instant.getTime())));
  assert.deepStrictEqual(plain(E.analyser({ sessions: JEU() }, { maintenant: instant.getTime() }).recuperation), plain(E.dernieresSollicitations(N, instant.getTime()))); });
t('Reclassement utilisateur (options.classements) transmis aux deux sources', () => {
  const o = { maintenant: '2026-01-28', classements: { 'Exo perso inconnu': { principal: 'Mollets', secondaires: [] } } };
  const an = E.analyser({ sessions: JEU() }, o), N = E.normaliserSeances(JEU());
  assert.deepStrictEqual(plain(an.volume), plain(E.volumeMuscles(N, { fin: '2026-01-28', classements: o.classements })));
  assert.deepStrictEqual(plain(an.recuperation), plain(E.dernieresSollicitations(N, finJour('2026-01-28'), o)));
  assert.strictEqual(an.volume.muscles.Mollets.direct.series, 1); });
t('Activation exclue du volume et de la recuperation de analyser() (l\'oiseau d\'activation ne compte pas)', () => {
  const an = E.analyser({ sessions: JEU() }, { maintenant: '2026-01-28' });
  assert.strictEqual(an.volume.muscles['Deltoïde post.'].direct.series, 0); assert.strictEqual(an.recuperation.groupes['Deltoïde post.'].dernierePrincipale, null); });
t('Plus de champ « priorites » dans analyser() ; les autres champs inchanges ; aucune proposition ; resultat reproductible', () => {
  const a = E.analyser({ sessions: JEU() }, { maintenant: '2026-01-28' });
  assert.deepStrictEqual(Object.keys(a), ['version', 'aujourdhui', 'donnees', 'exercices', 'fatigue', 'recuperation', 'volume', 'morphologie', 'propositions']);
  assert.deepStrictEqual(a.propositions, []);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(E.analyser({ sessions: JEU() }, { maintenant: '2026-01-28' }))); });
t('options.jours n\'influence pas la fenetre de 28 jours de analyser() ; les donnees recues ne sont pas modifiees', () => {
  const d = { sessions: JEU() }, avant = JSON.stringify(d);
  assert.strictEqual(E.analyser(d, { maintenant: '2026-01-28', jours: 7 }).volume.periode.jours, 28); assert.strictEqual(JSON.stringify(d), avant); });

// ═════════ 3. Export reel (lecture seule) ═════════
const REAL = process.env.EXPORT_FILE; const EXP = REAL && fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (EXP) t('Ton export : analyser() = volumeMuscles et dernieresSollicitations au caractere pres ; export inchange', () => {
  const brut = JSON.stringify(EXP), fin = EXP.sessions.map(s => s.date).sort().pop().slice(0, 10);
  const an = E.analyser(EXP, { maintenant: fin }), N = E.normaliserSeances(EXP.sessions);
  assert.deepStrictEqual(plain(an.volume), plain(E.volumeMuscles(N, { fin })));
  assert.deepStrictEqual(plain(an.recuperation), plain(E.dernieresSollicitations(N, finJour(fin))));
  assert.strictEqual(JSON.stringify(EXP), brut); });

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
