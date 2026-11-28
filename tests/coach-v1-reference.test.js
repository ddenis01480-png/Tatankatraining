// Lancer : node tests/coach-v1-reference.test.js
//          EXPORT_FILE=/chemin/export.json node tests/coach-v1-reference.test.js   (ajoute les controles sur un export reel)
//
// TESTS DE REFERENCE DU COACH V1 — avant la creation du moteur d'analyse centralise (Coach V2).
// Execute le VRAI code d'index.html (e1RM, analyzeEx, getProgressionTip, et des extraits du code des ecrans) dans Node.
//
// Trois categories de resultats :
//   OK       comportement V1 A CONSERVER : le futur moteur doit donner le meme resultat (sinon : echec).
//   CONNU    incoherence connue, encore presente. Elle n'est PAS une reference : le test decrit aussi le comportement cible.
//            Ce n'est pas un echec. Quand la correction sera faite, le test affichera CORRIGE.
//   CORRIGE  l'incoherence a disparu : verifier que le comportement cible est le bon, puis deplacer le test dans « A conserver ».
//   FAIL     un comportement a conserver a change (ou un test est casse) : echec.
//
// Regles : les anciens RIR pre-remplis sont « non verifies » (impossible de savoir lesquels ont ete saisis) ;
// aucune donnee personnelle dans le depot ; l'export reel n'est que LU ; rien n'est ecrit nulle part.
const H = require('./_harness.js'); const { openApp, mkStore, SRC, vm, fs, assert, REAL_PROGRAMME } = H;

// ───────── Chargement du vrai code ─────────
function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start, open, close) { const i = SRC.indexOf(start); if (i < 0) throw new Error('introuvable : ' + start); let d = 0;
  for (let p = SRC.indexOf(open, i); p < SRC.length; p++) { if (SRC[p] === open) d++; if (SRC[p] === close && --d === 0) return SRC.slice(SRC.indexOf(open, i), p + 1); } }
function between(a, b) { const i = SRC.indexOf(a); if (i < 0) throw new Error('introuvable : ' + a); const j = SRC.indexOf(b, i); if (j < 0) throw new Error('introuvable : ' + b); return SRC.slice(i, j); }

// Tables V1 retirees d'index.html a l'etape 2 recuperation (commit 432b2ca = derniere version qui les contient) : copie figee pour comparaison.
const V1_MUSCLE_MAP = { "Élévations latérales": "Épaules", "Développé militaire": "Épaules", "Développé couché": "Pectoraux", "Écarté": "Pectoraux", "Extension triceps": "Triceps", "Dips": "Triceps", "Oiseau": "Deltoïde post.", "Tractions": "Dos", "Tirage": "Dos", "Rowing": "Dos", "Pull-over": "Dos", "Curl": "Biceps", "Adducteurs": "Jambes", "Leg extension": "Quadriceps", "Hack squat": "Quadriceps", "Leg press": "Quadriceps", "Leg curl": "Ischio-jambiers", "Mollets": "Mollets" };
const V1_MUSCLE_GROUPS = { "Épaules": ["Élévations latérales","Développé militaire"], "Pectoraux": ["Développé couché","Écarté"], "Triceps": ["Extension triceps","Dips"], "Deltoïde post.": ["Oiseau"], "Dos": ["Tractions","Tirage","Rowing","Pull-over"], "Biceps": ["Curl"], "Quadriceps": ["Hack squat","Leg extension","Leg press"], "Ischio-jambiers": ["Leg curl"], "Mollets": ["Mollets"], "Adducteurs": ["Adducteurs"] };
const C = { Math, JSON, Object, Array, String, Number, parseInt, parseFloat, isNaN, PROGRAMME: REAL_PROGRAMME, console };
vm.createContext(C);
vm.runInContext([fnSrc('function estActivation('), fnSrc('function horsActivation('), fnSrc('function coachEngine('), fnSrc('function e1RM('), fnSrc('function parseRir('), fnSrc('function analyzeEx('), fnSrc('function getProgressionTip('),
  'const PALIERS = ' + literal('const PALIERS = [', '[', ']') + ';', fnSrc('function getPalier('),
  'const DB = ' + literal('const DB = {', '{', '}') + '; const ALL_EXERCISES = Object.values(DB).flat();',
  'const MUSCLE_MAP = ' + JSON.stringify(V1_MUSCLE_MAP) + ';',
  'const MUSCLE_GROUPS = ' + JSON.stringify(V1_MUSCLE_GROUPS) + ';',
  'this.e1RM=e1RM; this.analyzeEx=analyzeEx; this.getProgressionTip=getProgressionTip; this.PALIERS=PALIERS; this.ALL_EXERCISES=ALL_EXERCISES; this.MUSCLE_MAP=MUSCLE_MAP; this.MUSCLE_GROUPS=MUSCLE_GROUPS;'].join('\n'), C);
const { e1RM, analyzeEx, getProgressionTip } = C;
// getMuscle (l. SessionTab) : meme expression que dans index.html
const getMuscle = name => (Object.entries(C.MUSCLE_MAP).find(([k]) => name.includes(k)) || [])[1] || 'Autre';
const groupOf = name => (Object.entries(C.MUSCLE_GROUPS).find(([, kws]) => kws.some(k => name.includes(k))) || [])[0] || null;

// Extrait du VRAI code de saveSession : classement post-seance progression / stagnation / regression (tonnage +-2 %).
const POST_SEANCE = between('const progressed = [], stagnated = [], regressed = [];', '// PRs de la s');
const postSeance = vm.runInContext('(function(validExs, sessions){ const finV2 = null; ' + POST_SEANCE + ' return { progressed, stagnated, regressed }; })', C);
// Extrait du VRAI code du bilan de cycle (CycleBilan) : progression = tonnage derniere seance > premiere seance du cycle.
const CYCLE = between('const exStats = exNames.map(name => {', 'const progressed = exStats.filter(e => e.gainT > 0);');
const cycleStats = vm.runInContext('(function(cycleSessions, exNames){ ' + CYCLE + ' return exStats; })', C);

// ───────── Petits outils de donnees (synthetiques, sans donnee personnelle) ─────────
const S = (w, r, rir) => ({ weight: w, reps: r, rir: rir === undefined ? 2 : rir, done: true });
const H3 = (date, w, reps, rir) => ({ date, sets: reps.map((r, i) => S(w, r, Array.isArray(rir) ? rir[i] : rir)) });
const sess = (id, date, name, sets, repsTarget) => ({ id, date, routineId: 1, routineName: 'R', exercises: [{ name, repsTarget: repsTarget || '8-12', sets }] });

const tests = []; const keep = (n, f) => tests.push(['keep', n, f]); const known = (n, target, isStillPresent) => tests.push(['known', n, isStillPresent, target]);

// ═════════ A. COMPORTEMENTS V1 A CONSERVER ═════════
keep('e1RM : formule d\'Epley arrondie (100 kg x 10 = 133), entrees invalides = 0', () => {
  assert.strictEqual(e1RM(100, 10), 133); assert.strictEqual(e1RM('60', '8'), 76); assert.strictEqual(e1RM(0, 8), 0); assert.strictEqual(e1RM(60, 0), 0); assert.strictEqual(e1RM('', ''), 0); });
keep('Double progression : la DERNIERE serie progresse d\'abord (8-8-8 -> S3 vise 9)', () => {
  const t = getProgressionTip([S(50, 8), S(50, 8), S(50, 8)], [], 'Exo test', '8-12'); assert.ok(/^S3 : vise 9 rep · 50kg/.test(t.msg), t.msg); });
keep('Double progression : puis S2 (8-8-9 -> S2 vise 9), puis S1 (8-9-9 -> S1 vise 9)', () => {
  assert.ok(/^S2 : vise 9/.test(getProgressionTip([S(50, 8), S(50, 8), S(50, 9)], [], 'Exo test', '8-12').msg));
  assert.ok(/^S1 : vise 9/.test(getProgressionTip([S(50, 8), S(50, 9), S(50, 9)], [], 'Exo test', '8-12').msg)); });
keep('Toutes les series au haut de la fourchette -> +2,5 kg (>= 20 kg) ou +1,25 kg (< 20 kg), et repartir au bas', () => {
  const a = getProgressionTip([S(50, 12), S(50, 12), S(50, 12)], [], 'Exo test', '8-12'); assert.ok(a.msg.includes('50kg +2.5 = 52.5kg') && a.msg.includes('Repars à 8 reps'), a.msg);
  const b = getProgressionTip([S(10, 15), S(10, 15), S(10, 15)], [], 'Exo test', '10-15'); assert.ok(b.msg.includes('+1.25 = 11.25kg') && b.msg.includes('Repars à 10'), b.msg); });
keep('Annonce « Puis +poids » quand il ne reste qu\'une rep a gagner', () => {
  assert.ok(getProgressionTip([S(50, 12), S(50, 12), S(50, 11)], [], 'Exo test', '8-12').msg.includes('Puis +poids')); });
keep('Serie incomplete la derniere fois : la serie non faite est prioritaire (serie « fantome »)', () => {
  const t = getProgressionTip([S(50, 10), S(50, 10)], [], 'Exo test', '8-12'); assert.ok(/^S3 : vise 11/.test(t.msg) && t.msg.includes('non faite'), t.msg); });
keep('Cas speciaux : serie de 100 = conseil dedie ; gainage en secondes (« 45-60s ») = aucun conseil', () => {
  assert.ok(getProgressionTip([S(5, 60)], [], 'Exo test', '100').msg.startsWith('SERIE DE 100'));
  assert.strictEqual(getProgressionTip([S(5, 45)], [], 'Exo test', '45-60s'), null); });
keep('Diagnostic : moins de 2 seances exploitables = pas de diagnostic', () => {
  assert.strictEqual(analyzeEx([H3('2026-01-01', 50, [8, 8, 8])]), null); assert.strictEqual(analyzeEx([]), null); });
keep('Diagnostic « progression trop rapide » : > +7 % ET > +3 kg de force estimee en une seance', () => {
  assert.strictEqual(analyzeEx([H3('2026-01-01', 50, [8, 8, 8]), H3('2026-01-03', 55, [8, 8, 8])]).type, 1); // 63 -> 70 : +11 %, +7 kg
  assert.notStrictEqual(analyzeEx([H3('2026-01-01', 50, [8, 8, 8]), H3('2026-01-03', 51, [8, 8, 8])]).type, 1); });
keep('Diagnostic « regression » : baisse continue sur 3 seances, > 4 %, sans hausse de charge ni de reps', () => {
  const h = [H3('2026-01-01', 60, [10, 10, 10]), H3('2026-01-03', 60, [9, 9, 9]), H3('2026-01-05', 60, [8, 8, 8])]; assert.strictEqual(analyzeEx(h).type, 3); });
keep('Pas de regression si la charge est montee (reps qui redescendent apres une hausse de charge)', () => {
  const h = [H3('2026-01-01', 60, [12, 12, 12]), H3('2026-01-03', 60, [11, 11, 11]), H3('2026-01-05', 62.5, [8, 8, 8])]; assert.notStrictEqual(analyzeEx(h).type, 3); });
keep('Diagnostic « stagnation » : 3 seances a 97 % du record avec 10,5 a 20 reps en moyenne', () => {
  const h = [H3('2026-01-01', 40, [12, 12, 12]), H3('2026-01-03', 40, [12, 12, 12]), H3('2026-01-05', 40, [12, 12, 12])]; assert.strictEqual(analyzeEx(h).type, 2); });
keep('Diagnostic « progression » : +1 rep au total a charge egale compte comme une progression', () => {
  const h = [H3('2026-01-01', 50, [8, 8, 8]), H3('2026-01-03', 50, [8, 8, 9])]; const d = analyzeEx(h); assert.strictEqual(d.type, 0); });
keep('Paliers : 10 paliers definis, enchainement 3x8-12 -> 4x8-12 -> 3x6-10 -> 4x6-10 -> TS/BO (structure a reutiliser)', () => {
  assert.strictEqual(C.PALIERS.length, 10); const chain = []; let p = C.PALIERS[0]; while (p) { chain.push(p.id); p = C.PALIERS.find(x => x.id === p.nextId); }
  assert.deepStrictEqual(chain, ['3x8-12', '4x8-12', '3x6-10', '4x6-10', 'tsbo']); });

// ═════════ B. INCOHERENCES CONNUES (non figees : comportement cible decrit) ═════════
// (Op. 2) RIR : anciennes incoherences corrigees, desormais comportements a conserver.
keep('RIR 0 conserve au chargement des seances ; RIR absent laisse inconnu (jamais 2 en silence)', async () => {
  const U = 'user-ref', NS = b => b + '_u_' + U; const d = new Date(), w = d.getDay(), m = new Date(d); m.setDate(d.getDate() - (w === 0 ? 6 : w - 1));
  const ls = mkStore({ [NS('it3_sessions')]: JSON.stringify([sess(1, '2026-01-01', 'Exo test', [S(50, 8, 0), { weight: 50, reps: 8, done: true }])]), [NS('it3_routines')]: JSON.stringify([{ id: 1, name: 'R', exercises: [{ name: 'Exo test', sets: 1 }] }]), [NS('it3_sns_reset')]: m.toISOString().split('T')[0], it3_loaded_uid: U });
  const app = openApp(ls); app.mount(null); app.startSupabase(); await app.auth('INITIAL_SESSION', { id: U, email: 'ref@x.fr' });
  const sets = app.state('sessions')[0].exercises[0].sets; assert.strictEqual(sets[0].rir, 0); assert.strictEqual(sets[1].rir, undefined); });
keep('Plus aucun « || 2 » ni « || 3 » sur le RIR dans le code', () => {
  assert.ok(!/rir\) \|\| [23]/.test(SRC) && !/rir \|\| [23]/.test(SRC) && !/rir\|\|"-"/.test(SRC)); });
keep('Conseil : des series a RIR 0 donnent l\'avertissement « RIR faible » ; RIR inconnus ignores (pas de note)', () => {
  assert.ok(getProgressionTip([S(50, 8, 0), S(50, 8, 0), S(50, 8, 0)], [], 'Exo test', '8-12').msg.includes('RIR faible'));
  const t = getProgressionTip([{ weight: 50, reps: 8 }, { weight: 50, reps: 8 }, { weight: 50, reps: 8 }], [], 'Exo test', '8-12'); assert.ok(!t.msg.includes('RIR'), t.msg); });
keep('Nouvelle serie : RIR reel vide + rirSaisi:false (5 endroits) ; RIR cible 3/2/1 (4/2/1 en « refaire », 1 en serie ajoutee) garde a part dans rirCible', () => {
  const news = SRC.match(/rir: "", rirCible: [^,]+(?:,[^,]+)*?, rirSaisi: false, done: false/g) || []; assert.strictEqual(news.length, 5, String(news.length));
  assert.ok(/rir: "", rirCible: i === 0 \? 4 : i === 1 \? 2 : 1, rirSaisi: false/.test(SRC), 'refaire : cible 4/2/1');
  assert.strictEqual((SRC.match(/rir: "", rirCible: (?:i|si) === 0 \? 3 : (?:i|si) === 1 \? 2 : 1, rirSaisi: false/g) || []).length, 3, 'demarrer / ajouter / remplacer : cible 3/2/1');
  assert.ok(/rir: "", rirCible: 1, rirSaisi: false/.test(SRC), 'serie ajoutee : cible 1');
  assert.ok(!/rir: (?:i|si) === 0 \? "\d"/.test(SRC) && !/rir: "1", rirSaisi/.test(SRC), 'plus aucun RIR reel pre-rempli'); });
keep('Liste RIR : RIR reel dans la liste (« RIR ? » = inconnu) ; RIR cible affiche A COTE, toujours visible ; choisir une valeur (meme egale a la cible) met rirSaisi:true ; la cible est enregistree a part', () => {
  assert.ok(/aria-label="RIR effectué"[\s\S]{0,600}<option value="">RIR \?<\/option>/.test(SRC), 'liste du RIR reel, demarre sur « RIR ? »');
  assert.ok(/\{parseRir\(s\.rirCible\) !== null && \(\s*<span[^>]*>cible \{parseRir\(s\.rirCible\)\}<\/span>/.test(SRC), 'cible affichee hors de la liste (reste visible apres la saisie)');
  assert.ok(/\.\.\.\(field === "rir" \? \{ rirSaisi: val !== "" \} : \{\}\)/.test(SRC));
  assert.ok(/rirSaisi: s\.rirSaisi === true && parseRir\(s\.rir\) !== null, \.\.\.\(parseRir\(s\.rirCible\) !== null \? \{ rirCible: parseRir\(s\.rirCible\) \} : \{\}\)(?:, \.\.\.\(parseInt\(s\.repsCible\) > 0 \? \{ repsCible: parseInt\(s\.repsCible\) \} : \{\}\))?, done: true/.test(SRC), 'enregistre : saisi seulement si une valeur existe ; cible a part'); });
known('Nombre de series attendu lu dans le programme code en dur (PROGRAMME), pas dans la routine de l\'utilisateur', 'le nombre de series vient de la routine reellement suivie', () => {
  // « Développé couché haltères » = 3 series dans PROGRAMME. Un utilisateur dont la routine prevoit 2 series a fait 10-10 :
  const t = getProgressionTip([S(30, 10), S(30, 10)], [], 'Développé couché haltères', '8-12'); return /S3/.test(t.msg) && t.msg.includes('non faite'); });
known('Historique non trie par date avant le diagnostic (l\'ordre d\'enregistrement fait foi)', 'le diagnostic est identique quel que soit l\'ordre des seances (tri par date dans le moteur)', () => {
  const h = [H3('2026-01-01', 60, [10, 10, 10]), H3('2026-01-03', 60, [9, 9, 9]), H3('2026-01-05', 60, [8, 8, 8])];
  const sorted = analyzeEx(h), shuffled = analyzeEx([h[2], h[0], h[1]]); return (sorted && sorted.type) !== (shuffled && shuffled.type); });
known('Deux calculs de force : e1RM() arrondi, et des calculs non arrondis pour les records et alertes', 'une seule formule de force, la meme partout', () =>
  /parseFloat\(currentSet\.weight\) \* \(1 \+ parseInt\(currentSet\.reps\) \/ 30\)/.test(SRC) && /Math\.round\(_w \* \(1 \+ _r \/ 30\)\)/.test(SRC));
known('Formule de force utilisee sans limite de reps ; seuil d\'exclusion different selon l\'endroit (15 ou 20 reps)', 'force estimee seulement jusqu\'a ~12 reps ; au-dela, suivi des reps a charge egale ; un seul seuil', () =>
  /maxReps <= 20/.test(SRC) && /rtMax > 15/.test(SRC));
known('« En progression » a plusieurs definitions : force estimee (diagnostic) contre tonnage +-2 % (apres seance)', 'une seule definition de la progression, partagee par tous les ecrans', () => {
  // Meme seance : charge en hausse, reps en baisse. Force estimee : en hausse. Tonnage : en baisse.
  const prev = sess(1, '2026-01-01', 'Exo test', [S(60, 10), S(60, 10), S(60, 10)]); const cur = { name: 'Exo test', sets: [S(70, 6), S(70, 6), S(70, 6)] };
  const diag = analyzeEx([{ date: prev.date, sets: prev.exercises[0].sets }, { date: '2026-01-03', sets: cur.sets }]); const post = postSeance([cur], [prev]);
  return diag.type === 0 && post.regressed.includes('Exo test'); });
known('Bilan de cycle : progression = derniere seance contre premiere seance seulement (pas de tendance)', 'tendance calculee sur l\'ensemble des seances du cycle', () => {
  const ss = [sess(1, '2026-01-01', 'Exo test', [S(50, 10), S(50, 10), S(50, 10)]), sess(2, '2026-01-08', 'Exo test', [S(60, 10), S(60, 10), S(60, 10)]), sess(3, '2026-01-15', 'Exo test', [S(60, 10), S(60, 10), S(60, 10)]), sess(4, '2026-01-22', 'Exo test', [S(50, 10), S(50, 10), S(50, 11)])];
  const st = cycleStats(ss, ['Exo test'])[0]; return st && st.gainT > 0; }); // 1 rep de plus que la 1re seance = « progresse », malgre la chute depuis 60 kg
keep('Une seule table muscle <-> exercice : les deux tables V1 (MUSCLE_MAP, MUSCLE_GROUPS) ne sont plus dans index.html (corrige a l\'etape 2 recuperation)', () => {
  assert.ok(!/MUSCLE_MAP|MUSCLE_GROUPS|getMuscle\(/.test(SRC)); assert.ok(/dernieresSollicitations/.test(SRC)); });
keep('Aucun exercice de la base classe « Autre » : chacun a un muscle principal dans le catalogue du moteur (corrige a l\'etape 2 recuperation)', () => {
  const E = require('../coach-engine.js'); assert.deepStrictEqual(C.ALL_EXERCISES.filter(n => !E.classerExercice(n).principal), []); });
keep('Score fatigue : un seul calcul (moteur) et une seule echelle /15 sur les 4 ecrans, sans bonus RIR (corrige a l\'etape 1 fatigue)', () => {
  assert.ok(!/score <= 2 \? "#00C853" : score <= 5/.test(SRC) && !/score <= 3  \? \{ level: "OPTIMAL"/.test(SRC) && !/\+ rirAutoScore/.test(SRC));
  assert.ok((SRC.match(/fatigueAffichage\(/g) || []).length >= 5); });
known('Paliers definis mais jamais attribues a un exercice (palierId seulement lu, ou mis a null)', 'les paliers sont proposes par le moteur et appliques seulement apres validation de l\'utilisateur', () =>
  !/palierId: (?!null)[^,}\s]/.test(SRC));
known('Date du jour calculee en heure UTC (une seance apres minuit heure francaise peut etre datee de la veille)', 'date locale de l\'utilisateur', () =>
  /function today\(\) \{ return new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]; \}/.test(SRC));

// ═════════ C. DONNEES REPRESENTATIVES ═════════
// Jeu synthetique calque sur la structure reelle (3 series, fourchettes 8-12 / 10-15 / 15-20 / 30-50 / 100 / 45-60s, RIR pre-remplis 3/2/1).
function representative() { const out = []; let id = 1; const day = i => new Date(Date.UTC(2026, 2, 18 + i * 2)).toISOString().slice(0, 10);
  for (let i = 0; i < 40; i++) out.push({ id: id++, date: day(i), routineId: 1 + (i % 2), routineName: i % 2 ? 'PULL' : 'PUSH', exercises: [
    { name: 'Développé couché haltères', repsTarget: '8-12', sets: [0, 1, 2].map(k => S(26 + 2 * Math.floor(i / 6), 8 + ((i + k) % 5), [3, 2, 1][k])) },
    { name: 'Élévations latérales haltères', repsTarget: '30-50', sets: [0, 1, 2].map(k => S(6, 30 + (i % 15), [3, 2, 1][k])) },
    { name: 'Leg curl assis machine', repsTarget: '8-12', sets: [0, 1, 2].map(k => S(45, 12, [3, 2, 1][k])) },               // plafond -> stagnation
    { name: 'Tirage poulie haute prise large', repsTarget: '8-12', sets: [0, 1, 2].map(k => S(60, Math.max(6, 12 - Math.floor(i / 8)), 2)) }, // baisse lente
    { name: 'Gainage planche', repsTarget: '45-60s', sets: [S(0.1, 50)] } ] });
  return out; }
function analyseAll(sessions) { const names = [...new Set(sessions.flatMap(s => s.exercises.map(e => e.name)))]; const res = {};
  names.forEach(n => { const hist = sessions.filter(s => s.exercises.some(e => e.name === n)).map(s => ({ date: s.date, sets: s.exercises.find(e => e.name === n).sets }));
    const rt = sessions.flatMap(s => s.exercises).find(e => e.name === n).repsTarget; const rtMax = parseInt((rt.split('-')[1] || rt.split('-')[0]));
    res[n] = { diag: rtMax <= 15 ? analyzeEx(hist) : null, tip: getProgressionTip(hist[hist.length - 1].sets.filter(st => st.weight && st.reps), sessions, n, rt) }; });
  return res; }
keep('Jeu representatif : le V1 analyse chaque exercice sans erreur ; series longues et gainage exclus du diagnostic', () => {
  const r = analyseAll(representative()); assert.strictEqual(r['Élévations latérales haltères'].diag, null); assert.strictEqual(r['Gainage planche'].diag, null); assert.strictEqual(r['Gainage planche'].tip, null);
  assert.strictEqual(r['Leg curl assis machine'].diag.type, 2, 'plafond a 12 reps = stagnation'); assert.ok(r['Développé couché haltères'].diag !== null); });
keep('Jeu representatif : resultats identiques a chaque execution (calculs deterministes)', () => { assert.deepStrictEqual(JSON.parse(JSON.stringify(analyseAll(representative()))), JSON.parse(JSON.stringify(analyseAll(representative())))); });

const REAL = process.env.EXPORT_FILE; const USING_REAL = !!(REAL && fs.existsSync(REAL)); const EXP = USING_REAL ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null;
if (USING_REAL) {
  keep('Export reel (lecture seule) : chaque exercice est analyse sans erreur, diagnostics dans les types connus', () => {
    const r = analyseAll(EXP.sessions); const types = new Set([-1, 0, 1, 2, 3]);
    Object.values(r).forEach(x => { if (x.diag) assert.ok(types.has(x.diag.type)); });
    const dist = {}; Object.values(r).forEach(x => { const k = x.diag ? x.diag.title : 'non analyse (series longues / < 2 seances)'; dist[k] = (dist[k] || 0) + 1; });
    console.log('       info : ' + Object.keys(r).length + ' exercices — ' + Object.entries(dist).map(([k, v]) => v + ' ' + k).join(', ')); });
  keep('Export reel : les RIR anciens sont classes « non verifies » (aucun champ rirSaisi) — on ne pretend pas retrouver les vrais', () => {
    const sets = EXP.sessions.flatMap(s => s.exercises.flatMap(e => e.sets || [])); const withFlag = sets.filter(st => 'rirSaisi' in st).length;
    const prefillLike = EXP.sessions.flatMap(s => s.exercises.flatMap(e => (e.sets || []).map((st, i) => [i, st.rir]))).filter(([i, r]) => [3, 2, 1][i] === r).length;
    const zero = sets.filter(st => st.rir === 0).length;
    assert.strictEqual(withFlag, 0, 'aucune serie ancienne ne peut etre marquee « saisie »');
    console.log('       info : ' + sets.length + ' series ; RIR 0 : ' + zero + ' ; identiques au pre-remplissage 3/2/1 : ' + prefillLike + ' (' + Math.round(prefillLike / sets.length * 100) + ' %) -> tous « non verifies »'); });
  keep('Export reel : l\'analyse ne modifie pas les donnees lues', () => { const before = JSON.stringify(EXP); analyseAll(EXP.sessions); assert.strictEqual(JSON.stringify(EXP), before); });
}

// ───────── Execution ─────────
(async () => { let fail = 0, stillKnown = 0, fixed = 0;
  console.log('Fichier teste : ' + H.FILE + (USING_REAL ? ' | export reel : ' + REAL + ' (' + EXP.sessions.length + ' seances)' : ' | sans export reel (EXPORT_FILE non fourni)'));
  for (const [kind, n, f, target] of tests) {
    try {
      if (kind === 'keep') { await f(); console.log('OK      ' + n); }
      else { const present = await f(); if (present) { stillKnown++; console.log('CONNU   ' + n + '\n          cible : ' + target); } else { fixed++; console.log('CORRIGE ' + n + '\n          verifier la cible puis deplacer dans « A conserver » : ' + target); } }
    } catch (e) { fail++; console.log('FAIL    ' + n + '\n          -> ' + String(e.message).split('\n')[0]); }
  }
  const nk = tests.filter(t => t[0] === 'keep').length;
  console.log(`\nA conserver : ${nk - fail}/${nk} OK | Incoherences connues encore presentes : ${stillKnown} | corrigees : ${fixed}`);
  process.exit(fail ? 1 : 0); })();
