// Lancer : node tests/page-coach.test.js
// coach.html : meme appli qu'index.html, seul le script d'environnement change. Production = un seul compte (David),
// Preview perso-coach = base de test. Aucune donnee locale deplacee ou effacee. Import des donnees du coach par ajout seulement.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const R = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(R, 'index.html'), 'utf8'), COACH = fs.readFileSync(path.join(R, 'coach.html'), 'utf8');
const ENV_SRC = fs.readFileSync(path.join(R, 'outils', 'env-coach.js'), 'utf8');
const { construire } = require('../outils/construire-coach.js');
const ENV = require('../outils/env-coach.js');
const DAVID = '00e6db68-34dd-4f97-afea-1a91eef02886';
let n = 0, ko = 0; const t = (nom, f) => { try { f(); n++; console.log('OK   ' + nom); } catch (e) { ko++; console.log('FAIL ' + nom + '\n     -> ' + e.message); } };
const loc = href => { const u = new URL(href); return { protocol: u.protocol, hostname: u.hostname, host: u.host, port: u.port }; };

t('coach.html est a jour : exactement index.html + script d environnement coach (node outils/construire-coach.js)', () => {
  assert.strictEqual(COACH, construire(INDEX, ENV_SRC));
});

t('seules differences avec index.html : le titre et le script d environnement', () => {
  const a = INDEX.indexOf("// ENVIRONNEMENT DE L'APPLI"), finI = INDEX.indexOf('</script>', a);
  const b = COACH.indexOf('// ENVIRONNEMENT DE LA PAGE COACH'), finC = COACH.indexOf('</script>', b);
  assert.ok(a > 0 && b > 0);
  assert.strictEqual(COACH.slice(finC), INDEX.slice(finI), 'tout ce qui suit le script est identique');
  assert.strictEqual(COACH.slice(0, COACH.lastIndexOf('<script>', b)).replace('Tatanka Training · Coach', 'Tatanka Training'), INDEX.slice(0, INDEX.lastIndexOf('<script>', a)));
});

t('aucune donnee locale deplacee, renommee ou effacee par le script de la page coach', () => {
  const s = COACH.slice(COACH.indexOf('// ENVIRONNEMENT DE LA PAGE COACH'), COACH.indexOf('</script>', COACH.indexOf('// ENVIRONNEMENT DE LA PAGE COACH')));
  ['mettreDeCote', 'zz_mis_de_cote', 'removeItem', 'setItem', 'localStorage', 'clear('].forEach(m => assert.ok(!s.includes(m), m));
  assert.ok(!COACH.includes('mettreDeCote') && !COACH.includes('zz_mis_de_cote_avant_test'), 'aucune trace du script de la Preview de dev');
});

t('adresse de production exacte : base de production, compte de David SEUL', () => {
  const e = ENV.preparer(loc('https://tatankatraining.vercel.app/coach.html'));
  assert.ok(e.autorise && e.production); assert.ok(e.config.url.includes('ogkrgsnnoebsvbgsngvm'));
  assert.ok(ENV.compteAutorise(e, DAVID));
  ['f64bb7cb-0000-0000-0000-000000000000', 'test-user', '', null, undefined, DAVID.toUpperCase(), DAVID + ' '].forEach(u => assert.ok(!ENV.compteAutorise(e, u), String(u)));
});

t('Preview perso-coach : base de test uniquement (jamais la production)', () => {
  const e = ENV.preparer(loc('https://tatankatraining-git-perso-coach-ddenis01480-1492s-projects.vercel.app/coach.html'));
  assert.ok(e.autorise && !e.production); assert.ok(e.config.url.includes('syfrtspfsevkbnnaispu')); assert.ok(ENV.compteAutorise(e, 'compte-fictif'));
});

t('toute autre adresse : aucune base (beta, dev, http, port, sous-domaine, imitation)', () => {
  ['https://tatankatraining-git-beta-closed-ddenis01480-1492s-projects.vercel.app/coach.html', 'https://tatankatraining-git-dev-coach-moteur-ddenis01480-1492s-projects.vercel.app/coach.html',
   'http://tatankatraining.vercel.app/coach.html', 'https://tatankatraining.vercel.app:8443/coach.html', 'https://x.tatankatraining.vercel.app/', 'https://tatankatraining.vercel.app.evil.com/', 'https://localhost/']
    .forEach(h => { const e = ENV.preparer(loc(h)); assert.ok(!e.autorise && !e.config, h); assert.ok(!ENV.compteAutorise(e, DAVID), h); });
});

t('page coach : echanges/deplacements et synchro des choix de muscles coupes, bouton de retour present', () => {
  assert.deepStrictEqual(ENV.COACH, { sansDeplacements: true, sansSynchroClassements: true, retourVersionNormale: true });
  assert.ok(/if \(typeof _coachOptions === "function" && _coachOptions\(\)\.sansSynchroClassements\) return Promise\.resolve\(null\);/.test(INDEX));
  assert.ok(/sansDeplacements: !!_coachOptions\(\)\.sansDeplacements/.test(INDEX));
  assert.ok(/REVENIR À LA VERSION NORMALE/.test(INDEX) && /if \(currentSets\) \{ alert\("Termine ou annule ta séance en cours/.test(INDEX) && /exportData\(\);\s*try \{ localStorage\.setItem\("tatanka_coach_off", "1"\); \}/.test(INDEX));
});

t('compte non autorise : renvoye vers la version normale AVANT toute lecture ou ecriture de ses donnees', () => {
  const i = INDEX.indexOf('!window.TATANKA_ENV.compteAutorise(session.user.id)'), j = INDEX.indexOf('currentUser = session.user;', i);
  assert.ok(i > 0 && j > i && INDEX.slice(i, j).includes('window.location.replace("/")') && INDEX.slice(i, j).includes('return;'));
});

// Fonctions de fusion executees telles quelles
const fn = sig => { const i = INDEX.indexOf(sig); let d = 0; for (let p = INDEX.indexOf('{', i); p < INDEX.length; p++) { if (INDEX[p] === '{') d++; if (INDEX[p] === '}' && --d === 0) return INDEX.slice(i, p + 1); } };
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn('function fusionnerDecisionsCoach(') + '\n' + fn('function fusionnerHistoriqueRoutines('), ctx);

t('import : decisions du coach AJOUTEES, une decision deja presente n est jamais remplacee', () => {
  const ici = { version: 1, decisions: { a: { statut: 'acceptee', le: 1 }, b: { statut: 'refusee', le: 2 } } };
  const fichier = { version: 1, decisions: { b: { statut: 'acceptee', le: 9 }, c: { statut: 'refusee', le: 3 } } };
  const f = ctx.fusionnerDecisionsCoach(ici, fichier);
  assert.strictEqual(f.ajoutes, 1); assert.strictEqual(f.conserves, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.valeur.decisions)), { a: { statut: 'acceptee', le: 1 }, b: { statut: 'refusee', le: 2 }, c: { statut: 'refusee', le: 3 } });
  assert.strictEqual(ctx.fusionnerDecisionsCoach(null, fichier).ajoutes, 2);
  assert.strictEqual(ctx.fusionnerDecisionsCoach(ici, null).ajoutes, 0);
});

t('import : anciennes versions du programme AJOUTEES a la suite, rien de remplace, pas de doublon', () => {
  const v = (le, p) => ({ le, proposition: p, routines: [{ id: 1, name: 'P' + p, exercises: [] }] });
  const ici = { version: 1, versions: [v(1, 'x'), v(2, 'y')] };
  const f = ctx.fusionnerHistoriqueRoutines(ici, { version: 1, versions: [v(2, 'y'), v(3, 'z'), v(3, 'z'), { le: 4 }] });
  assert.strictEqual(f.ajoutes, 1);
  assert.deepStrictEqual(f.valeur.versions.map(x => x.proposition), ['x', 'y', 'z']);
  assert.strictEqual(f.valeur.versions[1], ici.versions[1], 'version deja presente gardee telle quelle');
});

t('export complet : seances, routines, exercices perso, decisions du coach, historique du programme', () => {
  const e = fn('function exportData(');
  ['sessions: load(KEYS.sessions)', 'routines: load(KEYS.routines)', 'customEx: CUSTOM_EXERCISES.slice()', 'coachDecisions: load(KEYS.coachDecisions)', 'routinesHistorique: load(KEYS.routinesHistorique)'].forEach(m => assert.ok(e.includes(m), m));
  const imp = fn('function applyImportToApp(');
  assert.ok(imp.includes('fusionnerDecisionsCoach(') && imp.includes('fusionnerHistoriqueRoutines('));
});

t('RIR reel : copie separee a l enregistrement, relue en priorite (la version normale la conserve sans la transformer)', () => {
  assert.ok(INDEX.includes('rir: parseRir(s.rir), rirReel: parseRir(s.rir), rirSaisi:'));
  assert.ok(INDEX.includes('rir: ("rirReel" in st) ? parseRir(st.rirReel) : (parseRir(st.rir) !== null ? parseRir(st.rir) : st.rir)'));
});

t('vercel.json : coach.html jamais mise en cache', () => {
  const v = JSON.parse(fs.readFileSync(path.join(R, 'vercel.json'), 'utf8'));
  const h = v.headers.find(x => x.source === '/coach.html'); assert.ok(h && h.headers.some(x => x.key === 'Cache-Control' && /no-store/.test(x.value)));
});

console.log(`\n${n}/${n + ko} tests passes`); process.exit(ko ? 1 : 0);
