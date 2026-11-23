// Lancer : node tests/fatigue.test.js            (avec tes donnees : EXPORT_FILE=/chemin/export.json node tests/fatigue.test.js)
// Etape 1 fatigue : UN seul score (moteur CoachEngine.scoreFatigue), une seule echelle sur 15, un seul affichage
// (fatigueAffichage d'index.html) pour Accueil, En-tete, Bilan et Demarrage de seance.
// Execute le VRAI code d'index.html (fatigueAffichage, declenchement au demarrage de seance, BilanTab.update, readFatigueState).
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const SRC = fs.readFileSync(process.env.INDEX_FILE || __dirname + '/../index.html', 'utf8');
const E = require('../coach-engine.js');
const EXPORT_FILE = process.env.EXPORT_FILE || null;

function fnSrc(sig) { const i = SRC.indexOf(sig); if (i < 0) throw new Error('introuvable : ' + sig); let d = 0;
  for (let p = SRC.indexOf('{', i); p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(i, p + 1); } }
function literal(start) { const i = SRC.indexOf(start); if (i < 0) throw new Error('introuvable : ' + start); let d = 0; const o = SRC.indexOf('{', i);
  for (let p = o; p < SRC.length; p++) { if (SRC[p] === '{') d++; if (SRC[p] === '}' && --d === 0) return SRC.slice(o, p + 1); } }
const between = (a, b) => { const i = SRC.indexOf(a); if (i < 0) throw new Error('introuvable : ' + a); const j = SRC.indexOf(b, i); if (j < 0) throw new Error('fin introuvable : ' + b); return SRC.slice(i, j); };
const plain = x => JSON.parse(JSON.stringify(x));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// Code reel : adaptateur d'affichage unique.
const LIB = 'const FATIGUE_NIVEAUX_AFFICHAGE = ' + literal('const FATIGUE_NIVEAUX_AFFICHAGE = {') + ';\n' +
  between('const FATIGUE_NOTE =', '\n') + '\n' + fnSrc('function fatigueAffichage(');
function contexte(extra) { const ctx = Object.assign({ window: { CoachEngine: E }, Object, Math, JSON, String }, extra || {}); vm.createContext(ctx); vm.runInContext(LIB, ctx); return ctx; }
const CTX = contexte();
const aff = fiche => plain(CTX.fatigueAffichage(fiche));

// Regions de code de chaque ecran.
const ECRANS = {
  'Accueil': between('function HomeTab(', 'const FREQ_OPTIONS'),
  'En-tete': between('  const fat = fatigueAffichage(fatigue);\n  const cycleData', '{cycleAlert && <span'),
  'Bilan': between('function BilanTab(', 'function IronTraining()'),
  'Demarrage de seance': between('// Fatigue ressentie (calcul unique du moteur)', '}, [activeRoutine]);') + between('      {adaptModal && (', '      {toast && ('),
};

// Scenarios (fiches telles qu'elles sont stockees dans it3_fatigue).
const M = (cles) => cles.reduce((o, k) => (o[k] = '2026-11-23', o), {});
const TOUS = ['sleep', 'appetite', 'motivation', 'techDegrades', 'heavyFeel'];
const SC = {
  absent: null,
  ancienneFicheAZero: { sleep: 0, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0 }, // defaut + remise a zero du lundi
  partiel: { sleep: 2, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0, _repondu: M(['sleep', 'appetite']) },
  partielDejaEleve: { sleep: 3, appetite: 3, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0, _repondu: M(['sleep', 'appetite']) },
  completZero: { sleep: 0, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0, _repondu: M(TOUS) },
  completIntermediaire: { sleep: 1, appetite: 0, motivation: 1, repLoss: 3, techDegrades: 1, heavyFeel: 1, _repondu: M(TOUS) },
  completMax: { sleep: 3, appetite: 3, motivation: 3, repLoss: 3, techDegrades: 3, heavyFeel: 3, _repondu: M(TOUS) },
};

const tests = []; const t = (n, f) => tests.push([n, f]); const infos = []; const info = s => infos.push(s);

t('Stockage : la fiche par defaut et la remise a zero du lundi ecrivent des 0 (code inchange) -> lus comme NON renseignes', () => {
  const src = fnSrc('const readFatigueState = () =>');
  assert.ok(src.includes('{ sleep: 0, appetite: 0, motivation: 0, repLoss: 0, techDegrades: 0, heavyFeel: 0 }'));
  const store = {}; const ctx = { load: () => null, lsGetNs: () => '2000-01-03', lsSetNs: (k, v) => { store[k] = v; }, save: (k, v) => { store[k] = v; }, KEYS: { fatigue: 'it3_fatigue' }, Date };
  vm.createContext(ctx); const fresh = vm.runInContext('(' + src.replace('const readFatigueState = ', '') + ')()', ctx);
  assert.strictEqual(E.scoreFatigue(fresh).statut, 'non_renseigne'); assert.strictEqual(aff(fresh).titre, 'NON RENSEIGNÉ'); });

t('Questionnaire absent (aucune fiche, ou ancienne fiche a 0) : « NON RENSEIGNÉ », score « —/15 », jamais « optimal » ni « basse »', () => {
  for (const k of ['absent', 'ancienneFicheAZero']) { const a = aff(SC[k]);
    assert.strictEqual(a.statut, 'non_renseigne'); assert.strictEqual(a.score, null); assert.strictEqual(a.scoreTexte, '—/15'); assert.strictEqual(a.scoreCourt, '—/15'); assert.strictEqual(a.titre, 'NON RENSEIGNÉ');
    assert.strictEqual(a.fatigueElevee, false); assert.ok(!/optimal|basse/i.test(a.titre + a.texte)); }
  assert.strictEqual(aff({}).statut, 'non_renseigne'); assert.strictEqual(aff('x').statut, 'non_renseigne'); });

t('Questionnaire partiel : « INCOMPLET », score provisoire, nombre de reponses ; niveau eleve signale seulement s\'il est deja certain', () => {
  const a = aff(SC.partiel); assert.strictEqual(a.statut, 'partiel'); assert.strictEqual(a.scoreTexte, '2/15'); assert.strictEqual(a.detail, '2/5 réponses');
  assert.strictEqual(a.titre, 'INCOMPLET'); assert.strictEqual(a.scoreCourt, '2/15 (2/5)'); assert.strictEqual(a.niveau, null); assert.strictEqual(a.fatigueElevee, false); assert.ok(/3 questions restent/.test(a.texte));
  const b = aff(SC.partielDejaEleve); assert.strictEqual(b.score, 6); assert.strictEqual(b.fatigueElevee, true); assert.ok(/déjà au moins élevée/.test(b.texte)); });

t('Ancienne fiche sans marque : une valeur 1-3 compte (seul un clic la produisait), un 0 reste « non repondu »', () => {
  const r = E.scoreFatigue({ sleep: 2, appetite: 0, motivation: 0, repLoss: 1, techDegrades: 0, heavyFeel: 0 });
  assert.strictEqual(r.statut, 'partiel'); assert.strictEqual(r.score, 2); assert.strictEqual(r.sources.sleep, 'ancienne_fiche'); assert.deepStrictEqual(plain(r.manquants), ['appetite', 'motivation', 'techDegrades', 'heavyFeel']); });

t('Questionnaire complet a zero : « BASSE », 0/15, « Aucun signe de fatigue declare » (distinct du non renseigne)', () => {
  const a = aff(SC.completZero); assert.strictEqual(a.statut, 'complet'); assert.strictEqual(a.scoreTexte, '0/15'); assert.strictEqual(a.scoreCourt, '0/15'); assert.strictEqual(a.titre, 'BASSE');
  assert.strictEqual(a.texte, 'Aucun signe de fatigue déclaré.'); assert.notStrictEqual(a.titre, aff(SC.ancienneFicheAZero).titre); });

t('Questionnaire complet intermediaire : 4/15 « MODÉRÉE » ; la perte de reps (3) n\'est pas comptee', () => {
  const a = aff(SC.completIntermediaire); assert.strictEqual(a.score, 4); assert.strictEqual(a.scoreTexte, '4/15'); assert.strictEqual(a.titre, 'MODÉRÉE');
  assert.deepStrictEqual(Object.keys(a.reponses), TOUS); assert.ok(!('repLoss' in a.reponses)); });

t('Questionnaire complet maximal : 15/15 « TRÈS ÉLEVÉE » ; echelle unique 0-2 / 3-5 / 6-9 / 10-15', () => {
  const a = aff(SC.completMax); assert.strictEqual(a.scoreTexte, '15/15'); assert.strictEqual(a.titre, 'TRÈS ÉLEVÉE'); assert.strictEqual(a.pct, 1);
  const niv = s => { const f = { _repondu: M(TOUS) }; let r = s; TOUS.forEach(k => { const v = Math.min(3, r); f[k] = v; r -= v; }); return aff(f).titre; };
  assert.deepStrictEqual([0, 2, 3, 5, 6, 9, 10, 15].map(niv), ['BASSE', 'BASSE', 'MODÉRÉE', 'MODÉRÉE', 'ÉLEVÉE', 'ÉLEVÉE', 'TRÈS ÉLEVÉE', 'TRÈS ÉLEVÉE']); });

t('Les 4 ecrans utilisent le meme calcul : chacun appelle fatigueAffichage, aucun ne calcule son propre score ni n\'affiche /18', () => {
  for (const [nom, code] of Object.entries(ECRANS)) {
    assert.ok(/fatigueAffichage\(/.test(code), nom + ' : pas d\'appel a fatigueAffichage');
    assert.ok(!/Object\.values\(\(?fatigue|snsScore|snsColor|\/18|\/ 18|rirAutoScore\s*;|\+ rirAutoScore/.test(code), nom + ' : calcul ou echelle propre restant'); }
  assert.ok(!/SNS \{score\}\/18|Score SNS : \{adaptModal\.score\}/.test(SRC)); });

t('Les 4 ecrans affichent exactement le meme resultat (score, niveau, couleur) dans les 7 scenarios', () => {
  // Valeurs lues par chaque ecran : le meme objet fatigueAffichage(fiche). On verifie que chaque ecran affiche bien score et niveau...
  const champs = { 'Accueil': ['fat.scoreCourt', 'fat.couleur', 'fat.emoji', 'fat.titre'], 'En-tete': ['fat.scoreCourt', 'fat.couleur', 'fat.titre'],
    'Bilan': ['fat.score', 'fat.max', 'fat.couleur', 'fat.titre', 'fat.texte'], 'Demarrage de seance': ['adaptModal.fatigue.scoreTexte', 'adaptModal.fatigue.couleur', 'adaptModal.fatigue.titre', 'adaptModal.fatigue.texte'] };
  for (const [nom, cs] of Object.entries(champs)) cs.forEach(c => assert.ok(ECRANS[nom].includes(c), nom + ' n\'affiche pas ' + c));
  // ... puis on execute le VRAI code du demarrage de seance : la fenetre recoit exactement le resultat des autres ecrans.
  const trig = between('      // Fatigue ressentie (calcul unique du moteur)', '    }\n  }, [activeRoutine]);');
  for (const [k, fiche] of Object.entries(SC)) {
    let modal = null; const ctx = contexte({ load: () => fiche, KEYS: { fatigue: 'it3_fatigue' }, activeRoutine: { name: 'R' }, sessions: [], exercises: [], recupSollicitations: () => null, setRecupInfo: () => {}, Date, setAdaptModal: m => { modal = m; } });
    vm.runInContext(trig, ctx); const ref = aff(fiche);
    if (ref.fatigueElevee) assert.deepStrictEqual(plain(modal.fatigue), ref, k); else assert.strictEqual(modal, null, k + ' : fenetre ouverte sans fatigue elevee');
    // Etape 2 : la recuperation ne declenche plus la fenetre ; seule une fatigue elevee certaine l'ouvre.
    assert.ok(!/recovScore|insuffisant/.test(trig)); }
  info('scenarios : ' + Object.entries(SC).map(([k, f]) => k + ' = ' + aff(f).scoreTexte + ' ' + aff(f).titre).join(' | ')); });

t('Aucune baisse de charge ou de volume declenchee par ce score : textes de reduction retires des 4 ecrans', () => {
  for (const [nom, code] of Object.entries(ECRANS)) assert.ok(!/-20%|-10%|-5%|-20-30%|volume -40%|2 séries|RIR min 3|RIR minimum/.test(code), nom + ' : consigne de reduction restante');
  Object.values(SC).forEach(f => { const a = aff(f); assert.ok(!/r[ée]dui|baiss|-\d+ ?%/i.test(a.texte), a.texte); });
  assert.strictEqual(E.scoreFatigue(SC.completMax).adaptationAutomatique, false); });

t('Absence de bonus RIR : le score ne depend que du questionnaire (RIR tres bas sur 7 jours -> meme score)', () => {
  const bilan = ECRANS['Bilan']; assert.ok(!/\+ rirAutoScore/.test(bilan)); assert.ok(/non compté dans le score fatigue/.test(bilan));
  assert.strictEqual(E.scoreFatigue(SC.completIntermediaire).bonusRir, 0);
  const sessions = [{ id: 1, date: '2026-11-22', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 8, rir: 0, rirSaisi: true, done: true }] }] }];
  const avec = E.analyser({ sessions, fatigue: SC.completIntermediaire }, { maintenant: '2026-11-23' }).fatigue.questionnaire;
  assert.strictEqual(avec.score, 4); assert.strictEqual(avec.niveau, 'modere'); });

t('Reponse dans le Bilan (vrai code de update) : valeur + marque datee ; fiche recue non modifiee ; ancien repLoss conserve', () => {
  const upd = fnSrc('  function update(key, val) {'); let saved = null, state = null;
  const fiche = deepFreeze({ sleep: 0, appetite: 0, motivation: 0, repLoss: 2, techDegrades: 0, heavyFeel: 0 });
  const ctx = { window: { CoachEngine: E }, fatigue: fiche, setFatigue: v => { state = v; }, save: (k, v) => { saved = [k, v]; }, KEYS: { fatigue: 'it3_fatigue' }, today: () => '2026-11-23' };
  vm.createContext(ctx); vm.runInContext(upd + '\n update("appetite", 0);', ctx);
  assert.deepStrictEqual(plain(saved), ['it3_fatigue', { sleep: 0, appetite: 0, motivation: 0, repLoss: 2, techDegrades: 0, heavyFeel: 0, _repondu: { appetite: '2026-11-23' } }]);
  assert.strictEqual(state, saved[1]); assert.strictEqual(E.scoreFatigue(saved[1]).statut, 'partiel'); assert.strictEqual(E.scoreFatigue(saved[1]).score, 0);
  let f = saved[1]; TOUS.forEach(k => { f = E.repondreFatigue(f, k, 0, '2026-11-23'); }); assert.strictEqual(aff(f).titre, 'BASSE');
  assert.throws(() => E.repondreFatigue(f, 'repLoss', 1)); assert.throws(() => E.repondreFatigue(f, 'sleep', 4)); });

t('Compatibilite : une fiche avec marques reste lisible par l\'ancien calcul (main / beta-closed) sans erreur', () => {
  const ancien = f => Object.values(f).reduce((a, b) => a + (parseInt(b) || 0), 0);
  assert.strictEqual(ancien(SC.completIntermediaire), 7); assert.strictEqual(ancien(SC.completZero), 0); });

if (EXPORT_FILE) t('Tes donnees : export et seances strictement inchanges ; ta fiche actuelle (6 x 0, sans marque) = NON RENSEIGNÉ', () => {
  const avant = crypto.createHash('md5').update(fs.readFileSync(EXPORT_FILE)).digest('hex');
  const exp = deepFreeze(JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8'))); const empreinte = JSON.stringify(exp);
  const a = aff(exp.fatigue); assert.strictEqual(a.statut, 'non_renseigne');
  const r = E.analyser({ sessions: exp.sessions, routines: exp.routines, fatigue: exp.fatigue }, { maintenant: '2026-11-23' }); assert.strictEqual(r.fatigue.questionnaire.statut, 'non_renseigne');
  assert.strictEqual(JSON.stringify(exp), empreinte); assert.strictEqual(crypto.createHash('md5').update(fs.readFileSync(EXPORT_FILE)).digest('hex'), avant);
  info('export md5 ' + avant + ' (identique avant/apres) ; fiche actuelle : ' + a.scoreTexte + ' ' + a.titre); });

let ok = 0;
for (const [n, f] of tests) { infos.length = 0; try { f(); ok++; console.log('OK   ' + n); } catch (e) { console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n')[0]); } infos.forEach(s => console.log('       info : ' + s)); }
console.log(`\n${ok}/${tests.length} tests passes`); if (ok !== tests.length) process.exit(1);
