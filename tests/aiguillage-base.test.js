// Lancer : node tests/aiguillage-base.test.js
// Appli unique (Coach integre) : production = base de production pour TOUS les comptes (comme avant),
// Coach (propositions) allume seulement pour les comptes de la liste ; Preview coach-integre = base de test ;
// toute autre adresse = aucune base. Le script ne touche jamais au stockage local.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const R = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const ENV_FICHIER = fs.readFileSync(path.join(R, 'outils', 'env-appli.js'), 'utf8');
const E = require('../outils/env-appli.js');
const DAVID = '00e6db68-34dd-4f97-afea-1a91eef02886', PROD_REF = 'ogkrgsnnoebsvbgsngvm', TEST_REF = 'syfrtspfsevkbnnaispu';
let ok = 0, ko = 0; const t = (nom, fn) => { try { fn(); ok++; console.log('OK   ' + nom); } catch (e) { ko++; console.log('ECHEC ' + nom + ' : ' + e.message); } };
const loc = href => { const u = new URL(href); return { protocol: u.protocol, hostname: u.hostname, host: u.host, port: u.port }; };
const debut = SRC.indexOf("// ENVIRONNEMENT DE L'APPLI");
const ENV_SRC = SRC.slice(SRC.lastIndexOf('<script>', debut) + 8, SRC.indexOf('</script>', debut));

t('index.html contient exactement outils/env-appli.js comme premier script', () => {
  assert.ok(debut > 0); assert.strictEqual(ENV_SRC.trim(), ENV_FICHIER.trim());
  assert.strictEqual(SRC.indexOf('<script'), SRC.lastIndexOf('<script>', debut));
});
t('le script d environnement ne touche jamais au stockage local', () => {
  ['mettreDeCote', 'zz_mis_de_cote', 'removeItem', 'setItem', 'localStorage', 'clear('].forEach(m => assert.ok(!ENV_SRC.includes(m), m));
  assert.ok(!SRC.includes('zz_mis_de_cote_avant_test'));
});
t('aucune cle secrete dans la page', () => {
  assert.ok(!/service_role|sb_secret_/i.test(SRC));
  assert.strictEqual((SRC.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []).length, 0);
});
t('production (et alias main) : base de production, tous les comptes, Coach pour David seul', () => {
  for (const h of ['https://tatankatraining.vercel.app/', 'https://tatankatraining-git-main-ddenis01480-1492s-projects.vercel.app/']) {
    const e = E.preparer(loc(h)); assert.ok(e.autorise && e.production && e.config.url.includes(PROD_REF), h);
    assert.ok(E.compteAutorise(e, DAVID) && E.compteAutorise(e, 'autre-compte'), 'connexion refusee a un compte');
    assert.ok(E.coachPour(e, DAVID));
    ['autre-compte', 'f64bb7cb-0000', '', null, undefined, DAVID.toUpperCase(), DAVID + ' '].forEach(u => assert.ok(!E.coachPour(e, u), 'coach pour ' + u));
  }
});
t('Preview coach-integre : base de test uniquement, Coach pour le compte fictif', () => {
  const e = E.preparer(loc('https://' + E.HOTE_PREVIEW + '/'));
  assert.ok(e.autorise && !e.production && e.config.url.includes(TEST_REF) && !JSON.stringify(e).includes(PROD_REF));
  assert.ok(E.coachPour(e, 'compte-fictif'));
});
t('toute autre adresse : aucune base', () => {
  ['https://tatankatraining-git-beta-closed-ddenis01480-1492s-projects.vercel.app/', 'https://tatankatraining-git-perso-coach-ddenis01480-1492s-projects.vercel.app/',
   'https://tatankatraining-abc123-ddenis01480-1492s-projects.vercel.app/', 'http://tatankatraining.vercel.app/', 'https://tatankatraining.vercel.app:8443/',
   'https://x.tatankatraining.vercel.app/', 'https://tatankatraining.vercel.app.evil.com/', 'https://localhost/']
    .forEach(h => { const e = E.preparer(loc(h)); assert.ok(!e.autorise && !e.config, h); assert.ok(!E.compteAutorise(e, DAVID) && !E.coachPour(e, DAVID), h); });
  assert.ok(!E.preparer(null).autorise);
});
t('SB_URL / SB_KEY viennent uniquement de TATANKA_ENV, sans valeur par defaut', () => {
  const i = SRC.indexOf('var SB_ENV = '), bloc = SRC.slice(i, SRC.indexOf('var STRIPE_MONTHLY', i));
  assert.ok(i > 0 && !/https?:|sb_publishable/.test(bloc));
  for (const env of [undefined, { autorise: false, config: null }, { autorise: true, config: null }]) {
    const c = { window: { TATANKA_ENV: env } }; vm.runInNewContext(bloc, c); assert.ok(c.SB_URL === null && c.SB_KEY === null);
  }
});
t('aucune connexion refusee en production (pas de renvoi pour les autres comptes)', () => {
  const e = E.preparer(loc('https://tatankatraining.vercel.app/'));
  const env = Object.assign({}, e, { compteAutorise: u => E.compteAutorise(e, u) });
  assert.ok(env.compteAutorise('nimporte-quel-compte'));
});
// La carte de propositions du Coach n'apparait que si _aLeCoach()
const fnSrc = SRC.slice(SRC.indexOf('function _aLeCoach()'), SRC.indexOf('\n', SRC.indexOf('function _aLeCoach()')));
const aLeCoach = (env, user) => { const c = { window: { TATANKA_ENV: env, currentUser: user } }; vm.runInNewContext(fnSrc + '\nr = _aLeCoach();', c); return c.r; };
t('Accueil : carte du Coach affichee seulement si _aLeCoach()', () => {
  assert.ok(/typeof CoachPropositions === "function" && _aLeCoach\(\) && <CoachPropositions/.test(SRC));
  assert.strictEqual((SRC.match(/<CoachPropositions/g) || []).length, 1);
});
t('_aLeCoach : David oui, autre compte non, personne connecte non, page coach.html oui', () => {
  const e = E.preparer(loc('https://tatankatraining.vercel.app/')); const env = Object.assign({}, e, { coachPour: u => E.coachPour(e, u) });
  assert.strictEqual(aLeCoach(env, { id: DAVID }), true);
  assert.strictEqual(aLeCoach(env, { id: 'autre' }), false);
  assert.strictEqual(aLeCoach(env, null), false);
  assert.strictEqual(aLeCoach({ autorise: true }, null), true, 'coach.html (sans coachPour)');
});
console.log('\n' + ok + '/' + (ok + ko) + ' tests OK');
process.exit(ko ? 1 : 0);
