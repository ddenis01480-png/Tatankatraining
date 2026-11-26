// Lancer : node tests/synchro-classements.test.js
//
// Etape 2b-2 (moteur 0.17.0) : synchronisation cloud des choix de muscles. Tests du MOTEUR (fonctions pures + deroulement complet)
// avec une FAUSSE BASE qui applique exactement les regles du SQL (docs/sql/exercise_classements_v1.sql) :
//   - declencheur : date > maintenant + 5 min ramenee ; plus ancienne -> ligne en place gardee + journal ; meme date et contenu different ->
//     la premiere enregistree reste + journal ; sinon remplacement ;
//   - archivage : statut par ligne (archivee / deja_archivee si contenu exactement identique / cle_en_conflit / refusee), jamais de modification.
// Tout est deterministe (graine fixe).
const path = require('path'), assert = require('assert');
const E = require(path.join(__dirname, '..', 'coach-engine.js'));

const T = s => new Date(s);
const ISO = ms => new Date(ms).toISOString();
const pgIso = ms => ISO(ms).replace('Z', '+00:00');               // forme renvoyee par Supabase
let graine = 12345; const alea = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
const choisir = a => a[Math.floor(alea() * a.length)];
let compteurCle = 0; const nouvelleCle = () => 'k' + (++compteurCle);
const copie = o => JSON.parse(JSON.stringify(o));
const G = E.GROUPES;

// ── Fausse base : memes regles que le SQL ──
function fausseBase() {
  const lignes = new Map(), journal = [], archives = new Map(); let horloge = Date.parse('2026-11-26T12:00:00Z');
  const contenu = l => JSON.stringify([l.catalogue, l.principal, l.secondaires]);
  const stable = v => v === undefined || v === null ? 'null' : typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return {
    lignes, journal, archives,
    avancer(ms) { horloge += ms; }, maintenant: () => horloge,
    lire() { return [...lignes.values()].map(l => Object.assign({}, l, { modifie_le: pgIso(l._t) })).map(l => { delete l._t; return l; }); },
    envoyer(lot) {
      return lot.map(env => {
        const n = copie(env); let t = Date.parse(n.modifie_le);
        if (t > horloge + 5 * 60000) { journal.push({ raison: 'date_future_ramenee', ecartee: copie(n) }); t = horloge; }
        n._t = t; const old = lignes.get(n.nom);
        if (old && (t < old._t || (t === old._t && contenu(n) !== contenu(old)))) {
          journal.push({ raison: t < old._t ? 'plus_ancienne_ecartee' : 'meme_date_contenu_different', gardee: copie(old), ecartee: copie(n) });
        } else lignes.set(n.nom, { nom: n.nom, catalogue: n.catalogue, principal: n.principal, secondaires: n.secondaires.slice(), _t: t });
        const r = Object.assign({}, lignes.get(n.nom), { modifie_le: pgIso(lignes.get(n.nom)._t) }); delete r._t; return r;
      });
    },
    archiver(lot) {
      if (!Array.isArray(lot) || lot.length > 500) throw new Error('lot invalide');
      return lot.map((l, i) => {
        const t = Date.parse(l.survenu_le), r = { indice: i, cle: l.cle_locale };
        if (!l.nom || !l.cle_locale || !l.ecartee || typeof l.ecartee !== 'object' || !isFinite(t)) return Object.assign(r, { statut: 'refusee' });
        const ex = archives.get(l.cle_locale), val = { nom: l.nom, gardee: stable(l.gardee), ecartee: stable(l.ecartee), t };
        if (!ex) { archives.set(l.cle_locale, val); return Object.assign(r, { statut: 'archivee' }); }
        return Object.assign(r, { statut: ex.nom === val.nom && ex.gardee === val.gardee && ex.ecartee === val.ecartee && ex.t === val.t ? 'deja_archivee' : 'cle_en_conflit' });
      });
    }
  };
}

// ── Faux appareil : stockage local en memoire, pannes injectables ──
function appareil(nom, base, opts) {
  opts = opts || {};
  const a = { nom, stock: E.classementsVides(), journal: E.journalVide(), compte: 'A', reseau: true, perteReponse: 0, journalPlein: false, stockPlein: false };
  a.io = {
    compte: () => a.compte,
    lireStock: () => copie(a.stock), ecrireStock: s => { if (a.stockPlein) return false; a.stock = copie(s); return true; },
    lireJournal: () => copie(a.journal), ecrireJournal: j => { if (a.journalPlein) return false; a.journal = copie(j); return true; },
    lireCloud: () => { if (!a.reseau) return Promise.reject(new Error('hors connexion')); if (a.lecturePerimee) { const r = a.lecturePerimee; a.lecturePerimee = null; return Promise.resolve(r); } return Promise.resolve(base.lire()); },
    envoyer: l => { if (!a.reseau) return Promise.reject(new Error('hors connexion')); const r = base.envoyer(l); return alea() < a.perteReponse ? Promise.reject(new Error('reponse perdue')) : Promise.resolve(r); },
    archiver: l => { if (!a.reseau) return Promise.reject(new Error('hors connexion')); const r = base.archiver(l); return alea() < a.perteReponse ? Promise.reject(new Error('reponse perdue')) : Promise.resolve(r); }
  };
  a.choisir = (ex, choix, ms) => { const s = E.choisirClassement(a.stock, ex, choix, ms); if (s) a.stock = s; return !!s; };
  a.synchro = () => E.synchroniserClassements(a.io, { nouvelleCle, horloge: base.maintenant, appareil: nom });
  return a;
}

const sig = (nom, c) => JSON.stringify([nom, c.catalogue ? 'C' : c.principal, c.catalogue ? [] : [...c.secondaires].sort(), Date.parse(c.modifieLe || 0)]);

const tests = []; const t = (n, f) => tests.push([n, f]);
const DBG = process.env.DEBUG_S ? +process.env.DEBUG_S : -1;

// ═════════ 1. Conversions et controles (memes regles que le SQL) ═════════
t('Controles identiques a la base : groupe inconnu, secondaire = principal, doublon, non texte, plus de 14, par defaut avec muscle -> refuses', () => {
  const L = (p, s, extra) => Object.assign({ nom: 'X', catalogue: false, principal: p, secondaires: s, modifie_le: '2026-11-20T10:00:00+00:00' }, extra || {});
  [L('Epaules', []), L('Pectoraux', ['Epaules']), L('Pectoraux', ['Pectoraux']), L('Pectoraux', ['Triceps', 'Triceps']), L('Pectoraux', [3]), L('Pectoraux', [null]), L('Pectoraux', [{}]),
   L('Pectoraux', G.filter(g => g !== 'Pectoraux').concat(['Triceps'])), L('Pectoraux', 'Triceps'), L(null, [], { catalogue: true, principal: 'Dos' }), L(null, ['Dos'], { catalogue: true }), L(null, []),
   L('Pectoraux', [], { modifie_le: 'pas une date' }), L('Pectoraux', [], { nom: '' })]
    .forEach((l, i) => assert.strictEqual(E.choixDepuisLigne(l), null, 'ligne ' + i));
  assert.deepStrictEqual(E.choixDepuisLigne(L('Pectoraux', G.filter(g => g !== 'Pectoraux'))).secondaires.length, 14);
  assert.deepStrictEqual(E.choixDepuisLigne(L(null, [], { catalogue: true })), { catalogue: true, modifieLe: '2026-11-20T10:00:00.000Z' });
  assert.strictEqual(E.ligneCloud('X', { principal: 'Pectoraux', secondaires: ['Pectoraux'], modifieLe: null }), null, 'choix local invalide jamais envoye');
  assert.strictEqual(E.ligneCloud('X', { principal: 'Épaules', secondaires: [], modifieLe: null }), null, 'ancien groupe jamais envoye');
  assert.deepStrictEqual(E.ligneCloud('X', { principal: 'Dos', secondaires: ['Trapèzes', 'Biceps'], modifieLe: '2026-11-20T10:00:00.000Z' }, 'tel'),
    { nom: 'X', catalogue: false, principal: 'Dos', secondaires: ['Biceps', 'Trapèzes'], modifie_le: '2026-11-20T10:00:00.000Z', appareil: 'tel' }); });

// ═════════ 2. Reception, cas par cas ═════════
const C = (p, s, iso, conf) => Object.assign({ principal: p, secondaires: s, modifieLe: iso }, conf ? { confirmeLe: conf } : {});
const LC = (nom, p, s, iso) => ({ nom, catalogue: p === null, principal: p, secondaires: s, modifie_le: iso });
const R = (local, lignes) => E.fusionnerCloud({ version: 1, exercices: local }, lignes, { maintenant: T('2026-11-26T12:00:00Z'), nouvelleCle });
t('Reception : appareil seul -> garde, en attente ; cloud seul -> ajoute et confirme ; identiques -> confirme', () => {
  let r = R({ A: C('Dos', [], '2026-11-20T10:00:00.000Z') }, []);
  assert.deepStrictEqual(r.classements.exercices.A, C('Dos', [], '2026-11-20T10:00:00.000Z')); assert.deepStrictEqual(r.aEnvoyer, ['A']); assert.deepStrictEqual(r.journal, []);
  r = R({}, [LC('B', 'Biceps', [], '2026-11-20T10:00:00+00:00')]);
  assert.deepStrictEqual(r.classements.exercices.B, C('Biceps', [], '2026-11-20T10:00:00.000Z', '2026-11-26T12:00:00.000Z')); assert.deepStrictEqual(r.ajoutes, ['B']);
  r = R({ A: C('Dos', ['Biceps'], '2026-11-20T10:00:00.000Z') }, [LC('A', 'Dos', ['Biceps'], '2026-11-20T10:00:00+00:00')]);
  assert.strictEqual(r.classements.exercices.A.confirmeLe, '2026-11-26T12:00:00.000Z'); assert.deepStrictEqual(r.journal, []); assert.deepStrictEqual(r.aEnvoyer, []); });
t('Reception : appareil plus recent -> garde et renvoye ; cloud plus recent -> cloud garde, ancienne version au journal', () => {
  let r = R({ A: C('Dos', [], '2026-11-21T10:00:00.000Z', 'x') }, [LC('A', 'Biceps', [], '2026-11-20T10:00:00+00:00')]);
  assert.deepStrictEqual(r.classements.exercices.A, C('Dos', [], '2026-11-21T10:00:00.000Z')); assert.deepStrictEqual(r.aEnvoyer, ['A']); assert.deepStrictEqual(r.journal, []);
  r = R({ A: C('Dos', [], '2026-11-20T10:00:00.000Z') }, [LC('A', 'Biceps', ['Dos'], '2026-11-21T10:00:00+00:00')]);
  assert.strictEqual(r.classements.exercices.A.principal, 'Biceps'); assert.deepStrictEqual(r.remplaces, ['A']);
  assert.strictEqual(r.journal.length, 1); assert.deepStrictEqual(r.journal[0].ancienne, { nom: 'A', principal: 'Dos', secondaires: [], modifieLe: '2026-11-20T10:00:00.000Z' });
  assert.deepStrictEqual(r.journal[0].nouvelle, { nom: 'A', principal: 'Biceps', secondaires: ['Dos'], modifieLe: '2026-11-21T10:00:00.000Z' }); });
t('Reception : meme date exacte, contenus differents -> le cloud (premiere version enregistree) gagne, la locale va au journal', () => {
  const r = R({ A: C('Dos', [], '2026-11-20T10:00:00.000Z') }, [LC('A', 'Biceps', [], '2026-11-20T10:00:00+00:00')]);
  assert.strictEqual(r.classements.exercices.A.principal, 'Biceps'); assert.strictEqual(r.journal[0].raison, 'meme_date_cloud_garde'); assert.strictEqual(r.journal[0].ancienne.principal, 'Dos'); });
t('Reception : ligne illisible ignoree, jamais a la place d\'un choix local valide ; choix sans date = le plus ancien ; « par defaut » des deux cotes', () => {
  let r = R({ A: C('Dos', [], '2026-11-20T10:00:00.000Z') }, [LC('A', 'Epaules', [], '2030-01-01T00:00:00+00:00'), { nom: 'A' }, null, 7]);
  assert.deepStrictEqual(r.classements.exercices.A, C('Dos', [], '2026-11-20T10:00:00.000Z')); assert.strictEqual(r.ignores.length, 4);
  r = R({ A: C('Dos', [], null) }, [LC('A', 'Biceps', [], '2000-01-01T00:00:00+00:00')]);
  assert.strictEqual(r.classements.exercices.A.principal, 'Biceps', 'sans date = plus ancien'); assert.strictEqual(r.journal.length, 1);
  r = R({ A: { catalogue: true, modifieLe: '2026-11-21T00:00:00.000Z' } }, [LC('A', null, [], '2026-11-21T00:00:00+00:00')]);
  assert.deepStrictEqual(r.journal, []); assert.ok(r.classements.exercices.A.catalogue && r.classements.exercices.A.confirmeLe);
  r = R({ A: { catalogue: true, modifieLe: '2026-11-22T00:00:00.000Z' } }, [LC('A', 'Dos', [], '2026-11-21T00:00:00+00:00')]);
  assert.ok(r.classements.exercices.A.catalogue, '« par defaut » plus recent garde : un vieux choix ne revient pas'); });
t('Reception : le stockage et le journal recus ne sont jamais modifies', () => {
  const local = { version: 1, exercices: { A: C('Dos', [], '2026-11-20T10:00:00.000Z') } }, avant = JSON.stringify(local);
  E.fusionnerCloud(local, [LC('A', 'Biceps', [], '2026-11-21T10:00:00+00:00')], { nouvelleCle }); assert.strictEqual(JSON.stringify(local), avant); });

// ═════════ 3. Confirmation d'envoi ═════════
t('Confirmation : seulement si la ligne renvoyee est identique ; vide, partielle, differente ou ambigue -> en attente', () => {
  const st = { version: 1, exercices: { A: C('Dos', [], '2026-11-20T10:00:00.000Z'), B: C('Biceps', [], '2026-11-20T10:00:00.000Z') } };
  const lot = E.aEnvoyer(st); assert.strictEqual(lot.length, 2);
  const opt = { maintenant: T('2026-11-26T12:00:00Z'), nouvelleCle };
  assert.deepStrictEqual(E.confirmerEnvoi(st, lot, [], opt).confirmes, []);
  assert.deepStrictEqual(E.confirmerEnvoi(st, lot, null, opt).confirmes, []);
  const ok = E.confirmerEnvoi(st, lot, [LC('A', 'Dos', [], '2026-11-20T10:00:00+00:00')], opt);
  assert.deepStrictEqual(ok.confirmes, ['A']); assert.ok(!ok.classements.exercices.B.confirmeLe, 'B absent : en attente');
  assert.deepStrictEqual(E.confirmerEnvoi(st, lot, [LC('A', 'Dos', [], '2026-11-20T10:00:00+00:00'), LC('A', 'Dos', [], '2026-11-20T10:00:00+00:00')], opt).confirmes, [], 'reponse ambigue');
  const diff = E.confirmerEnvoi(st, lot, [LC('A', 'Trapèzes', [], '2026-11-21T10:00:00+00:00')], opt);
  assert.deepStrictEqual(diff.confirmes, []); assert.deepStrictEqual(diff.remplaces, ['A'], 'la base avait mieux : adoptee via la regle de reception'); assert.strictEqual(diff.journal.length, 1);
  // L'utilisateur a change son choix pendant l'envoi : rien n'est confirme ni remplace.
  const change = E.choisirClassement(st, 'A', { principal: 'Mollets', secondaires: [] }, T('2026-11-26T11:00:00Z'));
  const r = E.confirmerEnvoi(change, lot, [LC('A', 'Dos', [], '2026-11-20T10:00:00+00:00')], opt);
  assert.deepStrictEqual(r.confirmes, []); assert.strictEqual(r.classements.exercices.A.principal, 'Mollets'); });
t('Confirmation : date future ramenee par la base -> meme contenu, l\'appareil adopte la date de la base et ne renvoie plus', () => {
  const st = { version: 1, exercices: { A: C('Dos', [], '2030-01-01T00:00:00.000Z') } }, lot = E.aEnvoyer(st);
  const r = E.confirmerEnvoi(st, lot, [LC('A', 'Dos', [], '2026-11-26T12:00:00+00:00')], { maintenant: T('2026-11-26T12:00:01Z'), nouvelleCle });
  assert.deepStrictEqual(r.confirmes, ['A']); assert.strictEqual(r.classements.exercices.A.modifieLe, '2026-11-26T12:00:00.000Z'); assert.deepStrictEqual(E.aEnvoyer(r.classements), []); });

// ═════════ 4. Journal local et archivage ═════════
const entree = (cle, extra) => Object.assign({ cle, clesPrecedentes: [], nom: 'A', ancienne: { nom: 'A', principal: 'Dos', secondaires: [], modifieLe: null }, nouvelle: { nom: 'A', principal: 'Biceps', secondaires: [], modifieLe: '2026-11-20T10:00:00.000Z' }, raison: 'cloud_plus_recent', survenuLe: '2026-11-20T10:00:00.000Z' }, extra || {});
t('Journal local : 10 000 entrees non archivees -> aucune retiree ; purge = seulement des archivees, au-dela de 200, les plus anciennes d\'abord', () => {
  const j = { version: 1, entrees: Array.from({ length: 10000 }, (_, i) => entree('c' + i)) };
  assert.strictEqual(E.purgerJournal(j).retirees, 0); assert.strictEqual(E.purgerJournal(j).journal.entrees.length, 10000);
  const j2 = { version: 1, entrees: Array.from({ length: 300 }, (_, i) => entree('c' + i, i % 2 ? { archiveeLe: 'x' } : {})) };
  const p = E.purgerJournal(j2); assert.strictEqual(p.retirees, 100); assert.strictEqual(p.journal.entrees.length, 200);
  assert.strictEqual(p.journal.entrees.filter(e => !e.archiveeLe).length, 150, 'toutes les non archivees restent');
  assert.strictEqual(p.journal.entrees.filter(e => e.archiveeLe)[0].cle, 'c201', 'les plus anciennes archivees sont parties');
  assert.strictEqual(E.purgerJournal({ version: 1, entrees: Array.from({ length: 150 }, (_, i) => entree('c' + i, { archiveeLe: 'x' })) }).retirees, 0, 'sous 200 : rien'); });
t('Journal local : une entree abimee est gardee, jamais envoyee, jamais purgee', () => {
  const j = { version: 1, entrees: [{ bizarre: true }, entree('c1')].concat(Array.from({ length: 250 }, (_, i) => entree('z' + i, { archiveeLe: 'x' }))) };
  assert.deepStrictEqual(E.aArchiver(j).map(x => x.cle), ['c1']); const p = E.purgerJournal(j); assert.ok(p.journal.entrees.some(e => e.bizarre)); });
t('Confirmation d\'archivage, ligne par ligne : archivee / deja_archivee confirment ; tout le reste ne confirme rien', () => {
  const j = { version: 1, entrees: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map(c => entree(c)) };
  const lot = E.aArchiver(j); assert.deepStrictEqual(lot.map(x => x.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  const rep = [{ indice: 0, cle: 'c0', statut: 'archivee' }, { indice: 1, cle: 'c1', statut: 'deja_archivee' }, { indice: 2, cle: 'c2', statut: 'cle_en_conflit' },
    { indice: 3, cle: 'c3', statut: 'refusee' }, { indice: 4, cle: 'c4', statut: 'bizarre' }, { indice: 5, cle: 'AUTRE', statut: 'archivee' },
    { indice: 6, cle: 'c6', statut: 'archivee' }, { indice: 6, cle: 'c6', statut: 'archivee' }, { indice: 99, cle: 'c7', statut: 'archivee' }];
  const r = E.confirmerArchivage(j, lot, rep, { nouvelleCle, maintenant: T('2026-11-26T12:00:00Z') });
  assert.deepStrictEqual(r.archivees, ['c0', 'c1']); assert.deepStrictEqual(r.conflits, ['c2']); assert.deepStrictEqual(r.refusees, ['c3']);
  assert.deepStrictEqual(r.sansReponse.sort(), ['c4', 'c5', 'c6', 'c7']);
  assert.strictEqual(r.journal.entrees.filter(e => e.archiveeLe).length, 2);
  [null, undefined, 'x', {}, [{}]].forEach(bad => assert.deepStrictEqual(E.confirmerArchivage(j, lot, bad, { nouvelleCle }).archivees, [], String(bad))); });
t('Conflit de cle : entree gardee a l\'identique, nouvelle cle unique, ancienne conservee ; au tour suivant elle est archivee', () => {
  const base = fausseBase(); base.archiver([{ nom: 'Z', cle_locale: 'c1', survenu_le: '2026-01-01T00:00:00Z', ecartee: { autre: 1 } }]);  // cle deja prise par autre chose
  let j = { version: 1, entrees: [entree('c1'), entree('c2')] }; const contenuAvant = JSON.stringify(j.entrees[0].ancienne);
  let lot = E.aArchiver(j), r = E.confirmerArchivage(j, lot, base.archiver(lot.map(x => x.ligne)), { nouvelleCle });
  assert.deepStrictEqual(r.conflits, ['c1']); assert.deepStrictEqual(r.archivees, ['c2']);
  const e = r.journal.entrees[0]; assert.notStrictEqual(e.cle, 'c1'); assert.deepStrictEqual(e.clesPrecedentes, ['c1']); assert.strictEqual(JSON.stringify(e.ancienne), contenuAvant); assert.ok(!e.archiveeLe);
  lot = E.aArchiver(r.journal); r = E.confirmerArchivage(r.journal, lot, base.archiver(lot.map(x => x.ligne)), { nouvelleCle });
  assert.deepStrictEqual(r.archivees, [e.cle]); assert.strictEqual(base.archives.get('c1').nom, 'Z', 'la ligne deja en base n\'a pas bouge'); });
t('Idempotence de l\'archivage : meme lot renvoye 10 fois avec reponses perdues -> une seule ligne par entree, toutes confirmees', () => {
  const base = fausseBase(); let j = { version: 1, entrees: Array.from({ length: 30 }, (_, i) => entree('i' + i)) };
  for (let k = 0; k < 10; k++) { const lot = E.aArchiver(j), rep = base.archiver(lot.map(x => x.ligne)); if (k % 3 !== 2) continue; j = E.confirmerArchivage(j, lot, rep, { nouvelleCle }).journal; }
  // Renvoi du meme lot apres confirmation : rien a envoyer
  assert.strictEqual(E.aArchiver(j).length, 0); assert.strictEqual(base.archives.size, 30); assert.ok(j.entrees.every(e => e.archiveeLe)); });

// ═════════ 5. Deroulement complet : appareils + fausse base ═════════
const run = async fn => { await fn(); };
t('Hors connexion, erreur, reponse vide : choix et journal locaux identiques octet pour octet, rien de retire', async () => {
  const base = fausseBase(), a = appareil('tel', base); a.choisir('A', { principal: 'Dos', secondaires: ['Biceps'] }, base.maintenant());
  a.reseau = false; const avant = JSON.stringify([a.stock, a.journal]); const r = await a.synchro();
  assert.strictEqual(JSON.stringify([a.stock, a.journal]), avant); assert.ok(r.erreurs.length > 0);
  a.reseau = true; a.io.lireCloud = () => Promise.resolve('n\'importe quoi'); await a.synchro(); assert.strictEqual(JSON.stringify([a.stock, a.journal]), avant);
  a.io.lireCloud = () => { throw new Error('plantage'); }; await a.synchro(); assert.strictEqual(JSON.stringify([a.stock, a.journal]), avant); });
t('Echec d\'ecriture du journal (memoire pleine) : aucun remplacement, le choix local reste identique octet pour octet', async () => {
  const base = fausseBase(), a = appareil('tel', base), b = appareil('pc', base);
  a.choisir('A', { principal: 'Dos', secondaires: [] }, base.maintenant()); await a.synchro();
  base.avancer(60000); b.choisir('A', { principal: 'Biceps', secondaires: [] }, base.maintenant()); await b.synchro();
  a.journalPlein = true; const avant = JSON.stringify(a.stock); const r = await a.synchro();
  assert.strictEqual(JSON.stringify(a.stock), avant); assert.ok(r.erreurs.includes('journal_non_ecrit'));
  a.journalPlein = false; await a.synchro(); assert.strictEqual(a.stock.exercices.A.principal, 'Biceps'); assert.strictEqual(a.journal.entrees.length, 1); assert.strictEqual(a.journal.entrees[0].ancienne.principal, 'Dos'); });
t('Echec d\'ecriture des choix apres journal : choix local inchange, le journal a juste une trace de plus (rien perdu)', async () => {
  const base = fausseBase(), a = appareil('tel', base), b = appareil('pc', base);
  a.choisir('A', { principal: 'Dos', secondaires: [] }, base.maintenant()); await a.synchro(); base.avancer(1000);
  b.choisir('A', { principal: 'Biceps', secondaires: [] }, base.maintenant()); await b.synchro();
  a.stockPlein = true; const avant = JSON.stringify(a.stock); await a.synchro(); assert.strictEqual(JSON.stringify(a.stock), avant);
  a.stockPlein = false; await a.synchro(); assert.strictEqual(a.stock.exercices.A.principal, 'Biceps'); assert.strictEqual(a.journal.entrees.filter(e => e.ancienne.principal === 'Dos').length, 1, 'pas de doublon'); });
t('Changement de compte pendant un appel reseau : reponse ignoree, rien ecrit', async () => {
  const base = fausseBase(), a = appareil('tel', base); a.choisir('A', { principal: 'Dos', secondaires: [] }, base.maintenant());
  const lc = a.io.lireCloud; a.io.lireCloud = () => { a.compte = 'B'; return lc(); }; const avant = JSON.stringify([a.stock, a.journal]);
  const r = await a.synchro(); assert.ok(r.interrompu); assert.strictEqual(JSON.stringify([a.stock, a.journal]), avant); assert.strictEqual(base.lignes.size, 0); });
t('Choix modifie par l\'utilisateur pendant l\'envoi : jamais ecrase, reste en attente', async () => {
  const base = fausseBase(), a = appareil('tel', base); a.choisir('A', { principal: 'Dos', secondaires: [] }, base.maintenant());
  const env = a.io.envoyer; a.io.envoyer = l => { const p = env(l); a.choisir('A', { principal: 'Mollets', secondaires: [] }, base.maintenant() + 5); return p; };
  await a.synchro(); assert.strictEqual(a.stock.exercices.A.principal, 'Mollets'); assert.ok(!a.stock.exercices.A.confirmeLe);
  a.io.envoyer = env; await a.synchro(); assert.ok(a.stock.exercices.A.confirmeLe); assert.strictEqual(base.lignes.get('A').principal, 'Mollets'); });
t('Meme date exacte sur deux appareils, dans les deux ordres : la base garde la premiere arrivee, l\'autre appareil l\'adopte, l\'autre version est journalisee', async () => {
  for (const premier of ['tel', 'pc']) for (const simultane of [false, true]) {
    const base = fausseBase(), a = appareil('tel', base), b = appareil('pc', base), ms = base.maintenant();
    a.choisir('A', { principal: 'Dos', secondaires: [] }, ms); b.choisir('A', { principal: 'Biceps', secondaires: [] }, ms);
    const [x, y] = premier === 'tel' ? [a, b] : [b, a], perdu = y === a ? 'Dos' : 'Biceps', gagnant = y === a ? 'Biceps' : 'Dos';
    // simultane : y a lu le cloud AVANT que x n'ecrive, puis envoie apres -> c'est la base qui tranche (declencheur).
    if (simultane) { const lc = y.io.lireCloud; y.io.lireCloud = () => { const vide = Promise.resolve([]); y.io.lireCloud = lc; return vide.then(r => x.synchro().then(() => r)); }; }
    else await x.synchro();
    await y.synchro(); await x.synchro(); await y.synchro();
    const cas = premier + (simultane ? ' simultane' : '');
    assert.strictEqual(base.lignes.get('A').principal, gagnant, cas); [a, b].forEach(d => assert.strictEqual(d.stock.exercices.A.principal, gagnant, cas));
    if (simultane) assert.ok(base.journal.some(j => j.raison === 'meme_date_contenu_different' && j.ecartee.principal === perdu), cas + ' journal base');
    assert.ok(y.journal.entrees.some(e => e.ancienne.principal === perdu && e.archiveeLe), cas + ' journal local du perdant, archive');
    assert.ok([...base.archives.values()].some(v => v.ecartee.includes(perdu)), cas + ' archivee en base'); } });
t('Idempotence : synchroniser deux fois de suite ne change rien', async () => {
  const base = fausseBase(), a = appareil('tel', base); a.choisir('A', { principal: 'Dos', secondaires: [] }, base.maintenant()); a.choisir('B', { catalogue: true }, base.maintenant());
  await a.synchro(); const s1 = JSON.stringify([a.stock, a.journal, [...base.lignes], [...base.archives], base.journal]);
  await a.synchro(); assert.strictEqual(JSON.stringify([a.stock, a.journal, [...base.lignes], [...base.archives], base.journal]), s1); });

// Invariant « rien ne se perd » d'une synchro : toute version presente sur l'appareil avant la synchro et absente apres
// (contenu different) est dans le journal local, a l'identique. (Un choix remplace par l'utilisateur lui-meme est une decision de l'utilisateur.)
async function synchroVerifiee(d, s) {
  const avant = copie(d.stock.exercices); await d.synchro();
  Object.keys(avant).forEach(n => { const ap = d.stock.exercices[n];
    assert.ok(ap, 's' + s + ' ' + n + ' disparu de l\'appareil');
    if (E.memeContenu(avant[n], ap)) return;
    const v = JSON.stringify(Object.assign({ nom: n }, avant[n].catalogue ? { catalogue: true } : { principal: avant[n].principal, secondaires: avant[n].secondaires }, { modifieLe: avant[n].modifieLe }));
    assert.ok(d.journal.entrees.some(e => JSON.stringify(e.ancienne) === v), 's' + s + ' version remplacee sans trace : ' + v); }); }
t('Convergence et invariant « rien ne se perd » : 10 000 scenarios aleatoires (2 appareils, coupures, reponses perdues, collisions de cles, memes dates)', async () => {
  const NOMS = ['A', 'B', 'C'], choixAlea = () => alea() < 0.15 ? { catalogue: true } : (p => ({ principal: p, secondaires: G.filter(g => g !== p && alea() < 0.15).slice(0, 3) }))(choisir(G));
  const stats = { scenarios: 0, remplacementsTraces: 0, conflitsCle: 0, rejetsBase: 0, archivees: 0 };
  for (let s = 0; s < 10000; s++) { stats.scenarios++;
    const base = fausseBase(), devs = [appareil('tel', base), appareil('pc', base)];
    if (alea() < 0.2) base.archiver([{ nom: 'X', cle_locale: 'k' + (compteurCle + 1), survenu_le: '2026-01-01T00:00:00Z', ecartee: { piege: 1 } }]); // collision de cle injectee
    const pas = 3 + Math.floor(alea() * 6); let vieux = base.lire();
    for (let p = 0; p < pas; p++) {
      if (alea() < 0.5) vieux = base.lire();
      const d = choisir(devs); d.reseau = alea() > 0.25; d.perteReponse = alea() < 0.3 ? 0.5 : 0;
      if (alea() < 0.6) { const n = choisir(NOMS), c = choixAlea(), ms = alea() < 0.2 ? base.maintenant() - (base.maintenant() % 1000) : base.maintenant() + Math.floor(alea() * 3000);
        d.choisir(n, c, ms); if (DBG === s) console.log('choix', d.nom, n, JSON.stringify(d.stock.exercices[n])); }
      if (DBG === s) console.log('etat', d.nom, 'reseau', d.reseau, 'perte', d.perteReponse);
      if (alea() < 0.7) { if (alea() < 0.4) d.lecturePerimee = vieux; /* lecture faite avant l'envoi d'un autre appareil : envois concurrents */
        if (DBG === s) console.log('synchro', d.nom); await synchroVerifiee(d, s); }
      base.avancer(Math.floor(alea() * 2000));
    }
    // Fin : reseau stable, plusieurs tours pour converger.
    for (let k = 0; k < 4; k++) for (const d of devs) { d.reseau = true; d.perteReponse = 0; await synchroVerifiee(d, s); }
    // Convergence : les deux appareils et la base ont la meme version de chaque exercice.
    for (const n of NOMS) {
      const bl = base.lignes.get(n), va = devs[0].stock.exercices[n], vb = devs[1].stock.exercices[n];
      if (!bl) { assert.ok(!va && !vb, 's' + s + ' ' + n + ' absent de la base mais present sur un appareil'); continue; }
      [va, vb].forEach((v, i) => { assert.ok(v, 's' + s + ' ' + n + ' appareil ' + i);
        assert.ok(E.memeContenu(v, { catalogue: bl.catalogue, principal: bl.principal, secondaires: bl.secondaires }), 's' + s + ' ' + n + ' contenu');
        assert.strictEqual(Date.parse(v.modifieLe), bl._t, 's' + s + ' ' + n + ' date'); assert.ok(v.confirmeLe, 's' + s + ' confirme'); }); }
    // Base : chaque envoi non retenu est dans le journal de la base (fausse base = regle du declencheur, verifiee en SQL a part).
    assert.ok(base.journal.every(j => j.ecartee), 's' + s);
    // Archivage : chaque entree locale archivee l'est en base avec un contenu identique ; aucune non archivee n'a ete purgee.
    devs.forEach(d => d.journal.entrees.forEach(e => { if (!e.archiveeLe) return; const v = base.archives.get(e.cle);
      assert.ok(v && v.nom === e.nom && Date.parse(e.survenuLe) === v.t, 's' + s + ' archive ' + e.cle); }));
    devs.forEach(d => d.journal.entrees.forEach(e => { stats.remplacementsTraces++; if (e.archiveeLe) stats.archivees++; if ((e.clesPrecedentes || []).length) stats.conflitsCle++; }));
    stats.rejetsBase += base.journal.length;
  }
  assert.strictEqual(stats.scenarios, 10000);
  assert.ok(stats.remplacementsTraces > 1000 && stats.conflitsCle > 100 && stats.rejetsBase > 100, JSON.stringify(stats));
  console.log('     ' + JSON.stringify(stats)); });

(async () => { let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n     -> ' + String(e.message).split('\n').slice(0, 6).join('\n        ')); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
