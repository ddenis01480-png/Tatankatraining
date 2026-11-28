// ============================================================
// STOCKAGE DURABLE (copie de securite immediate sur le disque)
// ------------------------------------------------------------
// Probleme mesure : le navigateur recopie localStorage sur le disque
// en differe. Si l'appli est fermee brutalement (balayee), les
// dernieres ecritures peuvent etre perdues.
// Solution : chaque ecriture importante est AUSSI faite dans IndexedDB,
// en mode « durabilite stricte » (le navigateur confirme l'ecriture
// sur le disque). localStorage reste la source lue par l'appli.
// Au demarrage, avant l'affichage, on compare les deux :
//  - si localStorage contient une version que NOUS avons ecrite avant
//    (ou celle qui precedait notre ecriture), la derniere ecriture a ete
//    perdue : on la remet ;
//  - si localStorage contient autre chose (ecrit par une autre version
//    de l'appli, un import...), on n'y touche JAMAIS : la donnee la plus
//    recente reste toujours gagnante.
// Rien n'est jamais efface par ce module en dehors de ce rattrapage.
// ============================================================
(function (racine) {
  "use strict";
  var NOM_BASE = "tatanka_durable", MAGASIN = "cles", VERSION_BASE = 1;
  var MAX_VERSIONS_CONNUES = 60;
  // Cles protegees (prefixe de base, avec ou sans « _u_<compte> »).
  var BASES = ["it3_current_session", "it3_sessions", "it3_routines", "it3_coach_decisions", "it3_routines_historique", "it3_fatigue"];

  function estProtegee(cle) {
    if (typeof cle !== "string") return false;
    for (var i = 0; i < BASES.length; i++) {
      if (cle === BASES[i] || cle.indexOf(BASES[i] + "_u_") === 0) return true;
    }
    return false;
  }

  // Empreinte courte d'une valeur (FNV-1a 32 bits + longueur). null = cle absente.
  function empreinte(v) {
    if (v === null || v === undefined) return "nul";
    var s = String(v), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return s.length + ":" + h.toString(16);
  }

  // Nouvel enregistrement apres une ecriture. precedent = enregistrement connu (ou null),
  // avant = valeur localStorage juste avant l'ecriture.
  function nouvelEnregistrement(precedent, avant, valeur, heure) {
    var connus = (precedent && Array.isArray(precedent.connus)) ? precedent.connus.slice() : [];
    var ajouts = [precedent && precedent.h, empreinte(avant)];
    for (var i = 0; i < ajouts.length; i++) {
      var a = ajouts[i];
      if (a && connus.indexOf(a) < 0) connus.push(a);
    }
    var h = empreinte(valeur);
    connus = connus.filter(function (x) { return x !== h; });
    if (connus.length > MAX_VERSIONS_CONNUES) connus = connus.slice(connus.length - MAX_VERSIONS_CONNUES);
    return { v: (valeur === null || valeur === undefined) ? null : String(valeur), h: h, connus: connus, t: heure };
  }

  // Decision au demarrage pour une cle : "rien", "restaurer" ou "retirer".
  function decider(valeurLocale, enreg) {
    if (!enreg || typeof enreg.h !== "string") return "rien";
    var hl = empreinte(valeurLocale);
    if (hl === enreg.h) return "rien";                        // deja a jour
    if (!Array.isArray(enreg.connus) || enreg.connus.indexOf(hl) < 0) return "rien"; // autre ecriture : on garde
    return enreg.v === null ? "retirer" : "restaurer";        // notre derniere ecriture a ete perdue
  }

  var memo = {};          // cle -> dernier enregistrement connu
  var dbPromesse = null;
  var actif = typeof indexedDB !== "undefined";

  function ouvrir() {
    if (!actif) return Promise.reject(new Error("indexedDB absent"));
    if (dbPromesse) return dbPromesse;
    dbPromesse = new Promise(function (ok, ko) {
      var req;
      try { req = indexedDB.open(NOM_BASE, VERSION_BASE); } catch (e) { ko(e); return; }
      req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains(MAGASIN)) db.createObjectStore(MAGASIN); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { ko(req.error); };
      req.onblocked = function () { ko(new Error("bloque")); };
    });
    dbPromesse.catch(function () { dbPromesse = null; });
    return dbPromesse;
  }

  function transaction(db, mode) {
    try { return db.transaction(MAGASIN, mode, { durability: "strict" }); }
    catch (e) { return db.transaction(MAGASIN, mode); }
  }

  // Ecriture : appelee juste apres chaque localStorage.setItem/removeItem d'une cle protegee.
  var fileEcriture = Promise.resolve();
  function ecrire(cle, valeur, avant) {
    if (!actif || !estProtegee(cle)) return Promise.resolve(false);
    var enreg = nouvelEnregistrement(memo[cle] || null, avant, valeur, Date.now());
    if (memo[cle] && memo[cle].h === enreg.h) return Promise.resolve(true); // valeur identique, rien a faire
    memo[cle] = enreg;
    fileEcriture = fileEcriture.then(function () {
      return ouvrir().then(function (db) {
        return new Promise(function (ok) {
          var tx = transaction(db, "readwrite");
          tx.objectStore(MAGASIN).put(enreg, cle);
          tx.oncomplete = function () { ok(true); };
          tx.onerror = tx.onabort = function () { ok(false); };
        });
      });
    }).catch(function () { return false; });
    return fileEcriture;
  }

  function toutLire(db) {
    return new Promise(function (ok, ko) {
      var res = {}, tx = transaction(db, "readonly"), st = tx.objectStore(MAGASIN);
      var req = st.openCursor();
      req.onsuccess = function () { var c = req.result; if (c) { res[c.key] = c.value; c.continue(); } };
      tx.oncomplete = function () { ok(res); };
      tx.onerror = tx.onabort = function () { ko(tx.error); };
    });
  }

  // Demarrage : lit IndexedDB, rattrape les ecritures perdues dans localStorage.
  // delaiMax : au-dela, l'appli s'affiche sans attendre (le rattrapage n'est alors PAS applique).
  var bilan = { etat: "non lance", restaurees: [], retirees: [], gardees: [] };
  function restaurer(ls, delaiMax) {
    if (!actif) { bilan.etat = "indisponible"; return Promise.resolve(bilan); }
    var fini = false;
    var travail = ouvrir().then(toutLire).then(function (tout) {
      Object.keys(tout).forEach(function (cle) {
        if (!estProtegee(cle)) return;
        var enreg = tout[cle];
        if (!memo[cle]) memo[cle] = enreg;
        if (fini) return;
        var locale = null;
        try { locale = ls.getItem(cle); } catch (e) { return; }
        var d = decider(locale, enreg);
        try {
          if (d === "restaurer") { ls.setItem(cle, enreg.v); bilan.restaurees.push(cle); }
          else if (d === "retirer") { ls.removeItem(cle); bilan.retirees.push(cle); }
          else if (empreinte(locale) !== enreg.h) bilan.gardees.push(cle);
        } catch (e) {}
      });
      if (!fini) bilan.etat = "fait";
      return bilan;
    }).catch(function () { bilan.etat = "erreur"; return bilan; });
    var attente = new Promise(function (ok) { setTimeout(function () { ok(null); }, delaiMax || 2500); });
    return Promise.race([travail, attente]).then(function (r) {
      if (r === null) { fini = true; bilan.etat = "delai depasse"; }
      return bilan;
    });
  }

  var api = {
    estProtegee: estProtegee, empreinte: empreinte, nouvelEnregistrement: nouvelEnregistrement, decider: decider,
    ecrire: ecrire, restaurer: restaurer, bilan: function () { return bilan; },
    attendreEcritures: function () { return fileEcriture; }, BASES: BASES.slice()
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.TatankaDurable = api;
})(typeof window !== "undefined" ? window : this);
