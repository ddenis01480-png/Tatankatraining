// ============================================================
// ENVIRONNEMENT DE LA PAGE COACH (coach.html)
// - Adresse de production exacte : base de production, UN SEUL compte
//   autorise (celui de David). Tout autre compte repart vers « / ».
// - Adresse exacte de la Preview perso-coach : base tatanka-test
//   (compte fictif), aucune donnee reelle.
// - Toute autre adresse : aucune base, connexion bloquee.
// - Aucune donnee locale n'est deplacee, renommee ni effacee ici.
// - Phase de test : echanges / deplacements d'exercices et synchro
//   des choix de muscles desactives ; bouton de retour a la version normale.
// ============================================================
(function () {
  var HOTE_PROD = "tatankatraining.vercel.app";
  var HOTE_PREVIEW = "tatankatraining-git-perso-coach-ddenis01480-1492s-projects.vercel.app";
  var CONFIG_PROD = { nom: "production", url: "https://ogkrgsnnoebsvbgsngvm.supabase.co", key: "sb_publishable_KvM3k3gwBAArOFyUEd1a7A_oY0RTIom" };
  var CONFIG_TEST = { nom: "tatanka-test", url: "https://syfrtspfsevkbnnaispu.supabase.co", key: "sb_publishable_Ln5a2USE1kEL2Ep-HPQG4A_cIT1NCja" };
  var COMPTES_PROD = ["00e6db68-34dd-4f97-afea-1a91eef02886"];
  var COACH = { sansDeplacements: true, sansSynchroClassements: true, retourVersionNormale: true };

  function adresseValide(loc) { return !!loc && loc.protocol === "https:" && loc.hostname === loc.host && (loc.port === "" || loc.port === undefined); }

  function preparer(loc) {
    if (!adresseValide(loc)) return { autorise: false, raison: "adresse", hote: loc ? loc.hostname : "", config: null, production: false, comptes: [] };
    if (loc.host === HOTE_PROD) return { autorise: true, raison: "", hote: loc.host, config: CONFIG_PROD, production: true, comptes: COMPTES_PROD.slice() };
    if (loc.host === HOTE_PREVIEW) return { autorise: true, raison: "", hote: loc.host, config: CONFIG_TEST, production: false, comptes: null };
    return { autorise: false, raison: "adresse", hote: loc.hostname, config: null, production: false, comptes: [] };
  }
  // Production : seul un compte de la liste. Preview (base de test) : le compte fictif de tatanka-test.
  function compteAutorise(env, uid) {
    if (!env || !env.autorise || !uid) return false;
    return env.comptes === null ? true : env.comptes.indexOf(uid) >= 0;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { preparer: preparer, compteAutorise: compteAutorise, HOTE_PROD: HOTE_PROD, HOTE_PREVIEW: HOTE_PREVIEW, COMPTES_PROD: COMPTES_PROD, COACH: COACH };
    return;
  }

  var env = preparer(window.location);
  if (env.config) Object.freeze(env.config);
  env.coach = Object.freeze(COACH);
  env.compteAutorise = function (uid) { return compteAutorise(env, uid); };
  window.TATANKA_ENV = Object.freeze(env);

  document.addEventListener("DOMContentLoaded", function () {
    var d = document.createElement("div");
    if (env.autorise) {
      d.textContent = env.production ? "COACH" : "TEST COACH · base tatanka-test · données fictives";
      d.setAttribute("style", env.production
        ? "position:fixed;top:4px;right:6px;z-index:2147483647;background:#ff660022;color:#ff8c40;font:700 9px/16px sans-serif;padding:0 6px;border-radius:8px;letter-spacing:1px;pointer-events:none"
        : "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c0392b;color:#fff;font:700 12px/22px sans-serif;text-align:center;letter-spacing:1px;pointer-events:none");
    } else {
      d.innerHTML = "<div style='max-width:420px;padding:24px'><div style='font-size:20px;font-weight:800;margin-bottom:12px'>Adresse non autorisée</div>" +
        "<div>Cette page ne fonctionne que sur son adresse prévue. La connexion est bloquée.</div></div>";
      d.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;background:#111;color:#fff;font:15px/1.5 sans-serif;display:flex;align-items:center;justify-content:center;text-align:center");
    }
    d.id = "tatanka-env-bandeau";
    document.body.appendChild(d);
  });
})();
