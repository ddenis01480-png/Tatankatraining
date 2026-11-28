// ============================================================
// ENVIRONNEMENT DE L'APPLI (index.html, Coach integre)
// - Adresse de production (et son alias de branche main) : base de
//   production, TOUS les comptes acceptes comme aujourd'hui. Le Coach
//   (propositions d'adaptation) n'est allume que pour les comptes de
//   COMPTES_COACH (phase d'essai : David seul).
// - Adresse exacte de la Preview coach-integre : base tatanka-test
//   (compte fictif), Coach allume, bandeau TEST.
// - Toute autre adresse : aucune base, connexion bloquee.
// - Aucune donnee locale n'est deplacee, renommee ni effacee ici.
// ============================================================
(function () {
  var HOTES_PROD = ["tatankatraining.vercel.app", "tatankatraining-git-main-ddenis01480-1492s-projects.vercel.app"];
  var HOTE_PREVIEW = "tatankatraining-git-coach-integre-ddenis01480-1492s-projects.vercel.app";
  var CONFIG_PROD = { nom: "production", url: "https://ogkrgsnnoebsvbgsngvm.supabase.co", key: "sb_publishable_KvM3k3gwBAArOFyUEd1a7A_oY0RTIom" };
  var CONFIG_TEST = { nom: "tatanka-test", url: "https://syfrtspfsevkbnnaispu.supabase.co", key: "sb_publishable_Ln5a2USE1kEL2Ep-HPQG4A_cIT1NCja" };
  // Regle unique « qui a le Coach » en production. Plus tard : droit lie a l'abonnement.
  var COMPTES_COACH = ["00e6db68-34dd-4f97-afea-1a91eef02886"];
  var COACH = { sansDeplacements: true, sansSynchroClassements: true, retourVersionNormale: false };

  function adresseValide(loc) { return !!loc && loc.protocol === "https:" && loc.hostname === loc.host && (loc.port === "" || loc.port === undefined); }

  function preparer(loc) {
    if (!adresseValide(loc)) return { autorise: false, raison: "adresse", hote: loc ? loc.hostname : "", config: null, production: false, comptesCoach: [] };
    if (HOTES_PROD.indexOf(loc.host) >= 0) return { autorise: true, raison: "", hote: loc.host, config: CONFIG_PROD, production: true, comptesCoach: COMPTES_COACH.slice() };
    if (loc.host === HOTE_PREVIEW) return { autorise: true, raison: "", hote: loc.host, config: CONFIG_TEST, production: false, comptesCoach: null };
    return { autorise: false, raison: "adresse", hote: loc.hostname, config: null, production: false, comptesCoach: [] };
  }
  // Tous les comptes peuvent se connecter (comme l'appli actuelle).
  function compteAutorise(env, uid) { return !!(env && env.autorise && uid); }
  // Coach : production = comptes de la liste ; Preview (base de test) = tous.
  function coachPour(env, uid) {
    if (!env || !env.autorise || !uid) return false;
    return env.comptesCoach === null ? true : env.comptesCoach.indexOf(uid) >= 0;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { preparer: preparer, compteAutorise: compteAutorise, coachPour: coachPour, HOTES_PROD: HOTES_PROD, HOTE_PREVIEW: HOTE_PREVIEW, COMPTES_COACH: COMPTES_COACH, COACH: COACH };
    return;
  }

  var env = preparer(window.location);
  if (env.config) Object.freeze(env.config);
  env.coach = Object.freeze(COACH);
  env.compteAutorise = function (uid) { return compteAutorise(env, uid); };
  env.coachPour = function (uid) { return coachPour(env, uid); };
  window.TATANKA_ENV = Object.freeze(env);

  document.addEventListener("DOMContentLoaded", function () {
    if (env.production) return; // production : aucun bandeau, c'est l'appli normale
    var d = document.createElement("div");
    if (env.autorise) {
      d.textContent = "TEST · base tatanka-test · données fictives uniquement";
      d.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c0392b;color:#fff;font:700 12px/22px sans-serif;text-align:center;letter-spacing:1px;pointer-events:none");
    } else {
      d.innerHTML = "<div style='max-width:420px;padding:24px'><div style='font-size:20px;font-weight:800;margin-bottom:12px'>Adresse non autorisée</div>" +
        "<div>Cette page ne fonctionne que sur son adresse prévue. La connexion est bloquée.</div></div>";
      d.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;background:#111;color:#fff;font:15px/1.5 sans-serif;display:flex;align-items:center;justify-content:center;text-align:center");
    }
    d.id = "tatanka-env-bandeau";
    document.body.appendChild(d);
  });
})();
