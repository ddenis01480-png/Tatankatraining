// Lancer : node tests/stockage-durable.test.js
// Regles de rattrapage de stockage-durable.js (sans navigateur) + branchement dans index.html.
// Le comportement reel (IndexedDB, fermeture brutale) est verifie a part dans un vrai navigateur.
const fs = require('fs'), path = require('path'), assert = require('assert');
const D = require('../stockage-durable.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let n = 0; const t = (nom, f) => { f(); n++; console.log('ok -', nom); };

// Simule une suite d'ecritures faites par l'appli : renvoie le dernier enregistrement durable.
function ecritures(depart, valeurs) {
  let rec = null, ls = depart;
  for (const v of valeurs) { rec = D.nouvelEnregistrement(rec, ls, v, Date.now()); ls = v; }
  return rec;
}
const S = (k) => JSON.stringify({ routineId: 1, exercises: [{ name: 'X', sets: [{ reps: '10', weight: '30', done: k > 0 }, { reps: '9', weight: '30', done: k > 1 }] }] });

t('cles protegees : seance en cours, seances, programme, decisions du coach (par compte)', () => {
  ['it3_current_session_u_a', 'it3_sessions_u_a', 'it3_routines_u_a', 'it3_coach_decisions_u_a', 'it3_routines_historique_u_a', 'it3_fatigue_u_a'].forEach(k => assert.ok(D.estProtegee(k), k));
  ['it3_routines_backup_123_u_a', 'tt_device_id', 'it3_loaded_uid', 'zz_mis_de_cote_avant_test::it3_sessions'].forEach(k => assert.ok(!D.estProtegee(k), k));
});

t('serie validee perdue par le navigateur (stockage local reste a la version d avant) : elle est remise', () => {
  const rec = ecritures(S(0), [S(1)]);
  assert.strictEqual(D.decider(S(0), rec), 'restaurer');
  assert.strictEqual(rec.v, S(1));
});

t('plusieurs ecritures perdues d affilee : la plus recente est remise', () => {
  const rec = ecritures(S(0), [S(1), S(2)]);
  assert.strictEqual(D.decider(S(0), rec), 'restaurer');
  assert.strictEqual(D.decider(S(1), rec), 'restaurer');
  assert.strictEqual(rec.v, S(2));
});

t('seance demarree puis perdue alors que rien n existait : elle est remise', () => {
  const rec = ecritures(null, [S(0)]);
  assert.strictEqual(D.decider(null, rec), 'restaurer');
});

t('stockage local deja a jour : on ne touche a rien', () => {
  const rec = ecritures(S(0), [S(1)]);
  assert.strictEqual(D.decider(S(1), rec), 'rien');
});

t('seance terminee (copie en cours retiree) mais retrait perdu : la seance en cours fantome est retiree', () => {
  const rec = ecritures(S(0), [S(1), null]);
  assert.strictEqual(D.decider(S(1), rec), 'retirer');
  assert.strictEqual(D.decider(null, rec), 'rien');
});

t('donnee ecrite par une AUTRE version de l appli (ex. version normale) : jamais ecrasee', () => {
  const sessionsCoach = JSON.stringify([{ id: 1 }, { id: 2 }]);
  const rec = ecritures(JSON.stringify([{ id: 1 }]), [sessionsCoach]);
  const ecritParAutreVersion = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.strictEqual(D.decider(ecritParAutreVersion, rec), 'rien');
});

t('import ou donnee inconnue : jamais ecrasee ; pas d enregistrement : rien', () => {
  const rec = ecritures(S(0), [S(1)]);
  assert.strictEqual(D.decider('{"autre":true}', rec), 'rien');
  assert.strictEqual(D.decider(S(0), null), 'rien');
});

t('empreintes : valeurs differentes = empreintes differentes, cle absente distincte de vide', () => {
  assert.notStrictEqual(D.empreinte(S(0)), D.empreinte(S(1)));
  assert.notStrictEqual(D.empreinte(null), D.empreinte(''));
  assert.strictEqual(D.empreinte(S(2)), D.empreinte(S(2)));
});

t('historique des versions borne (pas de croissance sans fin)', () => {
  const vals = Array.from({ length: 200 }, (_, i) => 'v' + i);
  const rec = ecritures('v-depart', vals);
  assert.ok(rec.connus.length <= 60);
  assert.strictEqual(D.decider('v198', rec), 'restaurer');
});

t('index.html : copie durable chargee avant le moteur, appelee par lsSetNs/lsRemoveNs, rattrapage avant affichage', () => {
  assert.ok(SRC.indexOf('<script src="/stockage-durable.js"></script>') > 0 && SRC.indexOf('<script src="/stockage-durable.js"></script>') < SRC.indexOf('<script src="/coach-engine.js"></script>'));
  const set = SRC.slice(SRC.indexOf('function lsSetNs('), SRC.indexOf('function lsRemoveNs('));
  assert.ok(/localStorage\.setItem\(k, value\);\s*_copieDurable\(k, value, avant\);/.test(set));
  const rem = SRC.slice(SRC.indexOf('function lsRemoveNs('), SRC.indexOf('// Migration legacy'));
  assert.ok(/_copieDurable\(k, null, avant\)/.test(rem));
  assert.ok(/TatankaDurable\.restaurer\(window\.localStorage, 2500\)\.then\(afficher, afficher\)/.test(SRC));
  assert.strictEqual((SRC.match(/ReactDOM\.createRoot/g) || []).length, 1);
});

t('index.html : seance en cours enregistree des le demarrage et a chaque changement', () => {
  assert.ok(/if \(currentSets && Array\.isArray\(currentSets\.exercises\)\) \{ try \{ lsSetNs\("it3_current_session", JSON\.stringify\(currentSets\)\); \} catch\(e\) \{\} \}/.test(SRC));
  assert.ok(/else if \(avant && !currentSets\) \{ try \{ lsRemoveNs\("it3_current_session"\); \} catch\(e\) \{\} \}/.test(SRC));
});

t('vercel.json : stockage-durable.js jamais mis en cache (comme index.html)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const h = v.headers.find(x => x.source === '/stockage-durable.js');
  assert.ok(h && h.headers.some(x => x.key === 'Cache-Control' && /no-store/.test(x.value)));
});

console.log(n + ' tests OK');
