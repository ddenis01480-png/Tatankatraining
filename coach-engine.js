/*
 * coach-engine.js — Moteur d'analyse du Coach Tatanka Training (Coach V2), version 0.2.0
 *
 * ROLE : lire les donnees qu'on lui transmet et retourner des analyses. RIEN D'AUTRE.
 *   - aucun acces a localStorage, Supabase, au reseau, au DOM ou a React ;
 *   - ne modifie jamais ce qu'on lui donne (seances, routines, programme, reponses de fatigue) :
 *     il travaille sur des copies normalisees ;
 *   - ne contient AUCUNE fonction « appliquer » : une adaptation future sera une PROPOSITION
 *     (objet de donnees) que l'application montrera a l'utilisateur, qui seul decide.
 *
 * NON BRANCHE (op. 3) : index.html ne charge pas encore ce fichier. Le branchement se fera ecran par ecran (op. 4).
 *
 * COUCHES
 *   1. normalisation  : dates, tri chronologique, lecture du RIR (et de sa fiabilite), fourchettes de repetitions, series valides
 *   2. mesures        : force estimee, tonnage, repetitions, series par muscle
 *   3. catalogue      : un seul classement exercice -> muscle principal / secondaires / type de mouvement
 *   4. diagnostics    : UNE definition de la progression, diagnostic par exercice, tendance de cycle, conseil de double progression
 *   5. domaines       : fatigue, recuperation, volume musculaire, priorites, morphologie (prepares pour les futures adaptations)
 *   6. propositions   : format reserve (liste vide pour l'instant), jamais appliquees par le moteur
 *
 * Comportements V1 conserves (verifies par tests/coach-engine.test.js contre le vrai code V1) :
 *   formule de force (Epley arrondie), double progression (derniere serie d'abord), increment de charge 2,5 / 1,25 kg,
 *   seuils du diagnostic (+7 % et +3 kg = trop rapide ; plafond a 97 % ; regression > 4 % sur 3 seances), series de 100, gainage.
 * Incoherences V1 corrigees ici (et seulement ici, tant que l'appli n'est pas branchee) :
 *   historique trie par date ; une seule formule et un seul seuil de force (12 reps) ; une seule definition de la progression ;
 *   tendance de cycle sur toutes les seances ; un seul catalogue muscles ; un seul score de fatigue ; series prevues lues dans
 *   la routine de l'utilisateur (plus dans le programme code en dur) ; dates locales.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoachEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "0.2.0";

  // Reglages centralises (une seule valeur par regle).
  var REGLES = Object.freeze({
    FORCE_REPS_MAX: 12,            // au-dela, la force estimee reste calculee (non plafonnee) mais est marquee « non fiable » ;
                                   // c'est aussi la limite entre fourchettes « force » (<= 12) et « repetitions » (> 12)
    FOURCHETTE_DEFAUT: "8-12",     // fourchette utilisee quand l'exercice n'en a pas (comportement V1)
    SERIES_PREVUES_DEFAUT: 3,      // nombre de series prevues si la routine ne le dit pas (comportement V1)
    INCREMENT_LOURD: 2.5,          // charge >= 20 kg (V1)
    INCREMENT_LEGER: 1.25,         // charge < 20 kg (V1)
    SEUIL_CHARGE_LOURDE: 20,
    TROP_RAPIDE_PCT: 0.07,         // V1
    TROP_RAPIDE_KG: 3,             // V1
    PLAFOND_PCT: 0.97,             // V1
    PLAFOND_MARGE_REPS: 1.5,       // V1 : moyenne >= 10,5 pour 8-12 (= haut de fourchette - 1,5)
    REGRESSION_PCT: 0.04,          // V1
    TENDANCE_PCT: 0.01,            // tendance de cycle : +-1 % sur la droite = stable
    RIR_DUR_MAX: 4,                // serie « dure » = RIR connu <= 4
    RIR_HAUT: 4,                   // V1 : RIR moyen >= 4 -> « pousse plus fort »
    RIR_BAS: 1,                    // V1 : RIR moyen <= 1 -> « sois prudent »
    JOURS_SANS_MUSCLE: 7,          // V1 : alerte muscle non travaille depuis plus de 7 jours
    FATIGUE_ECHELLE: [3, 7, 12],   // une seule echelle (celle de l'onglet fatigue V1) : <=3 optimal, <=7 correct, <=12 eleve, au-dela critique
    VOLUME_SECONDAIRE: 0.5         // une serie compte 1 pour le muscle principal, 0,5 pour chaque muscle secondaire
  });

  // ─────────────────────────── outils internes (purs) ───────────────────────────
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function int(v) { var n = num(v); return n === null ? null : Math.trunc(n); }
  function round1(x) { return Math.round(x * 10) / 10; }
  function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  // ═══════════════════════ 1. NORMALISATION ═══════════════════════

  // RIR : 0 est une vraie valeur (serie a l'echec). Absent, vide, illisible ou hors 0-10 = inconnu (null). Meme regle que parseRir d'index.html.
  function lireRir(v) { if (v === null || v === undefined || v === "") return null; var n = parseInt(v, 10); return (isNaN(n) || n < 0 || n > 10) ? null : n; }

  // Fiabilite du RIR d'une serie enregistree :
  //   "saisi"       valeur choisie explicitement (rirSaisi:true)
  //   "prerempli"   valeur non choisie par l'utilisateur (rirSaisi:false avec une valeur)
  //   "non_verifie" series anciennes (pas de champ rirSaisi) : impossible de savoir si la valeur a ete saisie
  //   "inconnu"     pas de RIR
  function statutRir(serie) {
    var r = lireRir(serie && serie.rir);
    if (r === null) return "inconnu";
    if (serie.rirSaisi === true) return "saisi";
    if (serie.rirSaisi === false) return "prerempli";
    return "non_verifie";
  }

  // Fourchette de repetitions. Formats rencontres : "8-12", "10- 15", "20", "100" (serie de 100), "45-60s" (secondes).
  function lireFourchette(txt) {
    var brut = (txt === null || txt === undefined) ? "" : String(txt).trim();
    var defaut = brut === "";
    var t = defaut ? REGLES.FOURCHETTE_DEFAUT : brut.replace(/\s+/g, "");
    if (t === "100") return { type: "serie100", min: 100, max: 100, texte: brut, defaut: false };
    var m = /^(\d+)(?:-(\d+))?(s|sec)?$/i.exec(t);
    if (!m) return { type: "inconnu", min: null, max: null, texte: brut, defaut: false };
    var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    if (b < a) { var x = a; a = b; b = x; }
    return { type: m[3] ? "duree" : "reps", min: a, max: b, texte: brut, defaut: defaut };
  }

  // Date « AAAA-MM-JJ » d'une seance, ou null. Date du jour en heure LOCALE (pas UTC).
  function dateSeance(s) { var d = s && s.date; return (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) ? d.slice(0, 10) : null; }
  function dateLocale(d) { if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d; var x = d instanceof Date ? d : new Date(d); var p = function (n) { return (n < 10 ? "0" : "") + n; }; return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate()); }
  function joursEntre(a, b) { // a, b : "AAAA-MM-JJ" ; nombre de jours calendaires de a a b
    var pa = a.split("-").map(Number), pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  // Tri chronologique unique : date, puis id (les id sont l'horodatage d'enregistrement), puis ordre d'origine.
  // Les seances sans date lisible sont placees a la fin. Retourne un NOUVEAU tableau ; l'ordre stocke n'est pas touche.
  function trierSeances(sessions) {
    return (Array.isArray(sessions) ? sessions : []).map(function (s, i) { return { s: s, i: i, d: dateSeance(s), id: num(s && s.id) }; })
      .sort(function (x, y) {
        if (x.d !== y.d) { if (x.d === null) return 1; if (y.d === null) return -1; return x.d < y.d ? -1 : 1; }
        if (x.id !== null && y.id !== null && x.id !== y.id) return x.id - y.id;
        return x.i - y.i;
      }).map(function (x) { return x.s; });
  }

  // Serie normalisee (copie). Valide = charge > 0 et reps > 0 (regle V1 « weight && reps »).
  function normaliserSerie(st) {
    st = st || {};
    var w = num(st.weight), r = int(st.reps);
    return { charge: w, reps: r, rir: lireRir(st.rir), statutRir: statutRir(st), rirCible: lireRir(st.rirCible), valide: !!(w && w > 0 && r && r > 0), type: st.setType || null };
  }

  function nomParDefaut(n) { return String(n || "").trim(); }

  // Seances normalisees, triees. options.normaliserNom : fonction de correction des noms (ex. normalizeExName de l'appli).
  function normaliserSeances(sessions, options) {
    var fnNom = (options && typeof options.normaliserNom === "function") ? options.normaliserNom : nomParDefaut;
    return trierSeances(sessions).map(function (s) {
      return {
        id: s && s.id !== undefined ? s.id : null, date: dateSeance(s), routineId: s && s.routineId !== undefined ? s.routineId : null,
        routine: (s && s.routineName) || null,
        exercices: ((s && s.exercises) || []).filter(Boolean).map(function (e) {
          return { nom: fnNom(e.name), fourchette: lireFourchette(e.repsTarget), series: (e.sets || []).map(normaliserSerie) };
        })
      };
    });
  }

  // Historique d'un exercice : UNE entree par seance ou il apparait (seances deja normalisees et triees).
  // Si l'exercice figure deux fois dans la meme seance, ses series sont regroupees (le V1 ne lisait que la premiere occurrence).
  function historiqueExercice(seancesNorm, nom) {
    var out = [];
    seancesNorm.forEach(function (s) {
      var entree = null;
      s.exercices.forEach(function (e) {
        if (e.nom !== nom) return;
        if (!entree) { entree = { date: s.date, id: s.id, fourchette: e.fourchette, series: e.series.slice(), occurrences: 1 }; out.push(entree); }
        else { entree.series = entree.series.concat(e.series); entree.occurrences++; }
      });
    });
    return out;
  }

  // ═══════════════════════ 2. MESURES ═══════════════════════

  // Formule de force V1 (Epley, arrondie) — identique a e1RM() d'index.html, entrees invalides = 0.
  function e1RM(w, r) { var _w = parseFloat(w), _r = parseInt(r, 10); if (!_w || isNaN(_w) || !_r || isNaN(_r) || _r <= 0) return 0; return Math.round(_w * (1 + _r / 30)); }
  // Force estimee d'une serie : formule V1, NON plafonnee. Au-dela de 12 reps elle est peu fiable : la mesure de la seance
  // l'indique (forceFiable:false) et la progression en repetitions est suivie a part.
  function forceSerie(serie) { return serie && serie.valide ? e1RM(serie.charge, serie.reps) : 0; }

  // Mesures d'une seance d'un exercice. Trois axes distincts :
  //   charge  : chargeMax ;  repetitions : repsTotal et repsAChargeMax (reps faites a la charge la plus lourde) ;
  //   force   : force estimee (meilleure serie) + forceFiable (meilleure serie <= 12 reps).
  function mesuresSeance(series) {
    var v = (series || []).filter(function (s) { return s.valide; });
    var rir = { saisi: 0, prerempli: 0, non_verifie: 0, inconnu: 0 };
    v.forEach(function (s) { rir[s.statutRir]++; });
    var chargeMax = v.reduce(function (m, s) { return Math.max(m, s.charge); }, 0), best = null;
    v.forEach(function (s) { var fs = forceSerie(s); if (!best || fs > best.f) best = { f: fs, reps: s.reps }; });
    var repsTotal = v.reduce(function (a, s) { return a + s.reps; }, 0);
    return {
      seriesValides: v.length,
      force: best ? best.f : 0,
      forceFiable: !!best && best.reps <= REGLES.FORCE_REPS_MAX,
      tonnage: round1(v.reduce(function (a, s) { return a + s.charge * s.reps; }, 0)),
      repsTotal: repsTotal,
      repsMoy: v.length ? repsTotal / v.length : 0,
      chargeMax: chargeMax,
      repsAChargeMax: v.filter(function (s) { return s.charge === chargeMax; }).reduce(function (a, s) { return a + s.reps; }, 0),
      seriesDures: v.filter(function (s) { return s.rir !== null && s.rir <= REGLES.RIR_DUR_MAX; }).length,
      rir: rir
    };
  }

  // ═══════════════════════ 3. CATALOGUE EXERCICES ═══════════════════════
  // Un seul classement (remplace MUSCLE_MAP et MUSCLE_GROUPS). Mots-cles sans accents, en minuscules ; tous les mots d'une
  // regle doivent etre presents dans le nom. La PREMIERE regle qui correspond gagne (les plus precises d'abord).
  // Noms des groupes : ceux du V1, plus Fessiers, Trapezes, Abdominaux, Lombaires.
  var P = "polyarticulaire", I = "isolation", G = "gainage";
  var CATALOGUE = [
    [["butterfly", "invers"], "Deltoïde post.", ["Trapèzes"], I],
    [["reverse", "pec"], "Deltoïde post.", ["Trapèzes"], I],
    [["oiseau"], "Deltoïde post.", ["Trapèzes"], I],
    [["face", "pull"], "Deltoïde post.", ["Trapèzes"], I],
    [["elevation", "lateral"], "Épaules", [], I],
    [["elevation", "frontal"], "Épaules", [], I],
    [["developpe", "militaire"], "Épaules", ["Triceps"], P],
    [["developpe", "epaule"], "Épaules", ["Triceps"], P],
    [["pec", "deck"], "Pectoraux", [], I],
    [["butterfly"], "Pectoraux", [], I],
    [["ecarte"], "Pectoraux", [], I],
    [["fly"], "Pectoraux", [], I],
    [["chest", "press"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["pompe"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["developpe"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["triceps"], "Triceps", [], I],
    [["dips"], "Triceps", ["Pectoraux", "Épaules"], P],
    [["pull-over"], "Dos", [], I],
    [["pullover"], "Dos", [], I],
    [["traction"], "Dos", ["Biceps"], P],
    [["tirage"], "Dos", ["Biceps"], P],
    [["rowing"], "Dos", ["Biceps", "Deltoïde post."], P],
    [["shrug"], "Trapèzes", [], I],
    [["leg", "curl"], "Ischio-jambiers", [], I],
    [["curl"], "Biceps", [], I],
    [["leg", "extension"], "Quadriceps", [], I],
    [["hip", "thrust"], "Fessiers", ["Ischio-jambiers"], P],
    [["glute", "bridge"], "Fessiers", ["Ischio-jambiers"], P],
    [["abducteur"], "Fessiers", [], I],
    [["adducteur"], "Adducteurs", [], I],
    [["deadlift", "roumain"], "Ischio-jambiers", ["Fessiers", "Lombaires"], P],
    [["romanian"], "Ischio-jambiers", ["Fessiers", "Lombaires"], P],
    [["good", "morning"], "Ischio-jambiers", ["Fessiers", "Lombaires"], P],
    [["sumo", "deadlift"], "Fessiers", ["Quadriceps", "Adducteurs", "Lombaires"], P],
    [["deadlift"], "Ischio-jambiers", ["Fessiers", "Lombaires", "Dos"], P],
    [["lower", "back"], "Lombaires", [], I],
    [["mollet"], "Mollets", [], I],
    [["calf"], "Mollets", [], I],
    [["squat"], "Quadriceps", ["Fessiers", "Adducteurs"], P],
    [["leg", "press"], "Quadriceps", ["Fessiers"], P],
    [["fente"], "Quadriceps", ["Fessiers"], P],
    [["crunch"], "Abdominaux", [], I],
    [["sit-up"], "Abdominaux", [], I],
    [["releve", "jambe"], "Abdominaux", [], I],
    [["planche"], "Abdominaux", [], G],
    [["gainage"], "Abdominaux", [], G]
  ].map(function (r) { return Object.freeze({ mots: Object.freeze(r[0]), principal: r[1], secondaires: Object.freeze(r[2]), mouvement: r[3] }); });
  var GROUPES = Object.freeze(["Pectoraux", "Épaules", "Deltoïde post.", "Triceps", "Dos", "Biceps", "Trapèzes", "Quadriceps", "Ischio-jambiers", "Fessiers", "Adducteurs", "Mollets", "Abdominaux", "Lombaires"]);
  // Les 10 groupes suivis par l'alerte « muscle non travaille » du V1.
  var GROUPES_SUIVIS_V1 = Object.freeze(["Épaules", "Pectoraux", "Triceps", "Deltoïde post.", "Dos", "Biceps", "Quadriceps", "Ischio-jambiers", "Mollets", "Adducteurs"]);

  // Classement d'un exercice. options.classements : { "Nom exact": { principal, secondaires, mouvement } } choisis par l'utilisateur (prioritaires).
  // Exercice inconnu (ex. exercice perso) -> principal null, source "non_classe" : jamais devine au hasard.
  function classerExercice(nom, options) {
    var perso = options && options.classements && Object.prototype.hasOwnProperty.call(options.classements, nom) ? options.classements[nom] : null;
    if (perso && perso.principal) return { principal: perso.principal, secondaires: (perso.secondaires || []).slice(), mouvement: perso.mouvement || null, source: "utilisateur" };
    var n = sansAccents(nom);
    for (var i = 0; i < CATALOGUE.length; i++) {
      var r = CATALOGUE[i];
      if (r.mots.every(function (m) { return n.indexOf(m) !== -1; })) return { principal: r.principal, secondaires: r.secondaires.slice(), mouvement: r.mouvement, source: "catalogue" };
    }
    return { principal: null, secondaires: [], mouvement: null, source: "non_classe" };
  }

  // ═══════════════════════ 4. DIAGNOSTICS ═══════════════════════

  // Mode de mesure d'un exercice selon sa fourchette :
  //   "force" : fourchette haute <= 12 -> force estimee ; "reps" : series longues (> 12) -> travail total (tonnage) ;
  //   "aucun" : series de 100, gainage en secondes, fourchette illisible.
  function modeMesure(f) {
    if (!f || f.type !== "reps") return "aucun";
    return f.max <= REGLES.FORCE_REPS_MAX ? "force" : "reps";
  }
  function metrique(m, mode) { return mode === "force" ? m.force : m.tonnage; }

  // Ecarts entre deux seances sur les trois axes, sans les melanger.
  function axesProgression(prec, cour) {
    var memeCharge = cour.chargeMax === prec.chargeMax;
    return { charge: round1(cour.chargeMax - prec.chargeMax), reps: memeCharge ? cour.repsAChargeMax - prec.repsAChargeMax : null,
      repsTotal: cour.repsTotal - prec.repsTotal, force: cour.force - prec.force, forceFiable: !!(prec.forceFiable && cour.forceFiable) };
  }

  // UNE definition de la progression entre deux seances d'un meme exercice (utilisee par tous les diagnostics).
  // Mode « force » (fourchette <= 12, comportement V1) :
  //   progression : la force estimee monte, OU meme charge (ou plus) avec plus de repetitions au total ;
  //   regression  : la force baisse, sans hausse de charge ni de repetitions ; stable : le reste.
  // Mode « reps » (fourchette > 12, ex. 10-15, 15-20) : la force estimee n'est PAS le critere.
  //   progression en charge : charge plus lourde avec des repetitions dans la fourchette (moyenne >= bas de fourchette) ;
  //   progression en repetitions : meme charge, plus de repetitions a cette charge (aucun plafond a 12) ;
  //   regression : meme charge et moins de repetitions, ou charge plus legere et moins de travail total ; stable : le reste.
  function comparer(prec, cour, mode, fourchette) {
    if (mode === "reps") {
      var dansFourchette = !fourchette || fourchette.min === null || fourchette.min === undefined || cour.repsMoy >= fourchette.min;
      if (cour.chargeMax > prec.chargeMax) return dansFourchette ? "progression" : "stable";
      if (cour.chargeMax === prec.chargeMax) return cour.repsAChargeMax > prec.repsAChargeMax ? "progression" : cour.repsAChargeMax < prec.repsAChargeMax ? "regression" : "stable";
      return cour.tonnage < prec.tonnage ? "regression" : "stable";
    }
    var a = metrique(prec, mode), b = metrique(cour, mode);
    var plusDeReps = cour.repsTotal > prec.repsTotal && cour.chargeMax >= prec.chargeMax;
    if (b > a || plusDeReps) return "progression";
    if (b < a && cour.chargeMax <= prec.chargeMax && cour.repsTotal <= prec.repsTotal) return "regression";
    return "stable";
  }
  // Nature d'une progression : "charge", "reps" ou "force" (force estimee en hausse sans hausse de charge ni de reps).
  function natureProgression(axes) { return axes.charge > 0 ? "charge" : (axes.reps !== null ? axes.reps > 0 : axes.repsTotal > 0) ? "reps" : "force"; }

  var CODES = { "0": "progression", "1": "progression_trop_rapide", "2": "plafond", "3": "regression", "-1": "stable" };

  // Diagnostic d'un exercice sur son historique (trie ici, quel que soit l'ordre recu).
  // Retour : null (moins de 2 seances mesurables) ou
  //   { code, typeV1, mode, mesure:{precedente, derniere}, ecart, ecartRatio, ecartPct, seances, axes, nature?, derniere:{...}, perte?, seancesAuPlafond? }
  //   mesure = force estimee (mode force) ou tonnage (mode reps). Les textes et couleurs restent a l'affichage.
  function diagnostiquer(historique, fourchette) {
    var hist = (historique || []).slice().sort(function (x, y) { return (x.date || "9999") < (y.date || "9999") ? -1 : (x.date || "9999") > (y.date || "9999") ? 1 : 0; });
    var f = fourchette || (hist.length && hist[hist.length - 1].fourchette) || lireFourchette("");
    var mode = modeMesure(f);
    if (mode === "aucun") return { code: "non_applicable", typeV1: null, mode: mode, raison: f && f.type === "serie100" ? "serie_de_100" : f && f.type === "duree" ? "duree" : "fourchette_illisible" };
    var pts = hist.map(function (h) { var m = mesuresSeance(h.series); m.date = h.date; return m; }).filter(function (p) { return metrique(p, mode) > 0; });
    if (pts.length < 2) return null;
    var l = pts.length, last = pts[l - 1], prev = pts[l - 2], last3 = pts.slice(-3);
    var a = metrique(prev, mode), b = metrique(last, mode), jump = b - a, pct = jump / (a || 1), axes = axesProgression(prev, last);
    var res = function (type, extra) {
      var o = { code: CODES[String(type)], typeV1: type, mode: mode, mesure: { precedente: a, derniere: b }, ecart: round1(jump), ecartRatio: pct, ecartPct: round1(pct * 100), seances: l, axes: axes,
        derniere: { chargeMax: last.chargeMax, repsAChargeMax: last.repsAChargeMax, repsTotal: last.repsTotal, repsMoy: round1(last.repsMoy), force: last.force, forceFiable: last.forceFiable } };
      if (extra) for (var k in extra) o[k] = extra[k]; return o; };
    if (mode === "reps") {
      if (last3.length >= 3) {
        if (last3.every(function (p) { return p.chargeMax === last.chargeMax; }) && last.repsMoy >= f.max - REGLES.PLAFOND_MARGE_REPS) return res(2, { seancesAuPlafond: last3.length });
        var baisse = last3.every(function (p, i) { return i === 0 || comparer(last3[i - 1], p, mode, f) === "regression"; });
        var perteT = last3[0].tonnage - last.tonnage;
        if (baisse && perteT > last3[0].tonnage * REGLES.REGRESSION_PCT) return res(3, { perte: round1(perteT) });
      }
      return comparer(prev, last, mode, f) === "progression" ? res(0, { nature: natureProgression(axes) }) : res(-1);
    }
    // Mode force : regles et seuils du V1.
    if (pct > REGLES.TROP_RAPIDE_PCT && jump > REGLES.TROP_RAPIDE_KG) return res(1);
    if (last3.length >= 3) {
      var maxM = Math.max.apply(null, pts.map(function (p) { return metrique(p, mode); }));
      if (last3.every(function (p) { return metrique(p, mode) >= maxM * REGLES.PLAFOND_PCT; }) && last.repsMoy >= f.max - REGLES.PLAFOND_MARGE_REPS && last.repsMoy < 20)
        return res(2, { seancesAuPlafond: last3.length });
      var enBaisse = last3.every(function (p, i) { return i === 0 || metrique(p, mode) <= metrique(last3[i - 1], mode); });
      var perte = metrique(last3[0], mode) - b;
      if (enBaisse && perte > metrique(last3[0], mode) * REGLES.REGRESSION_PCT && last.chargeMax <= prev.chargeMax && last.repsTotal <= prev.repsTotal)
        return res(3, { perte: round1(perte) });
    }
    if (comparer(prev, last, mode, f) === "progression") return res(0, { nature: natureProgression(axes), repsGagnees: b > a ? 0 : last.repsTotal - prev.repsTotal });
    return res(-1);
  }

  // Tendance sur toutes les seances d'une periode (ex. un cycle) : droite des moindres carres sur la mesure principale.
  // Retour : { sens: "hausse" | "baisse" | "stable", variationPct, seances } ou null (< 2 seances mesurables).
  function tendance(historique, fourchette) {
    var hist = (historique || []).slice().sort(function (x, y) { return (x.date || "") < (y.date || "") ? -1 : (x.date || "") > (y.date || "") ? 1 : 0; });
    var f = fourchette || (hist.length && hist[hist.length - 1].fourchette) || lireFourchette("");
    var mode = modeMesure(f); if (mode === "aucun") return null;
    var ys = hist.map(function (h) { return metrique(mesuresSeance(h.series), mode); }).filter(function (y) { return y > 0; });
    var n = ys.length; if (n < 2) return null;
    var mx = (n - 1) / 2, my = ys.reduce(function (s, y) { return s + y; }, 0) / n, sxy = 0, sxx = 0;
    ys.forEach(function (y, x) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); });
    var pente = sxy / sxx, debut = my - pente * mx, fin = my + pente * mx;
    var variation = debut > 0 ? (fin - debut) / debut : 0;
    return { sens: variation > REGLES.TENDANCE_PCT ? "hausse" : variation < -REGLES.TENDANCE_PCT ? "baisse" : "stable", variationPct: round1(variation * 100), mode: mode, seances: n };
  }

  // Conseil de double progression pour la PROCHAINE seance (port fidele de getProgressionTip du V1, sans texte).
  // historique : entrees de historiqueExercice ; options.seriesPrevues : series de la ROUTINE de l'utilisateur (defaut 3) ;
  // options.fourchette : texte ou objet (defaut : celle de la derniere seance).
  // Retour : null ou { action, ... , rir:{ moyen, note, fiable, statuts } }. Actions :
  //   "serie100" | "augmenter_charge" {charge, increment, nouvelleCharge, repsCible} | "ajouter_rep" {serie, reps, charge, serieNonFaite, ensuiteCharge}
  //   | "maintenir" {charge, repsMin} | "reduire_charge" {pctMin:5, pctMax:10, rirMin:4} | "consolider" {charge}
  function conseilProgression(historique, options) {
    options = options || {};
    var hist = (historique || []).slice().sort(function (x, y) { return (x.date || "") < (y.date || "") ? -1 : (x.date || "") > (y.date || "") ? 1 : 0; });
    if (!hist.length && !Array.isArray(options.dernieresSeries)) return null;
    var dernier = hist.length ? hist[hist.length - 1] : { date: null, fourchette: null, series: [] };
    // L'ecran peut fournir les series de reference (comportement V1 : « lastSets » de la seance en cours).
    if (Array.isArray(options.dernieresSeries)) dernier = { date: dernier.date, fourchette: dernier.fourchette, series: options.dernieresSeries.map(function (st) { return st && st.statutRir ? st : normaliserSerie(st); }) };
    var f = typeof options.fourchette === "string" ? lireFourchette(options.fourchette) : (options.fourchette || dernier.fourchette || lireFourchette(""));
    var valides = (dernier.series || []).filter(function (s) { return s.valide; });
    if (!valides.length) return null;
    var connus = valides.filter(function (s) { return s.rir !== null; });
    var moyen = connus.length ? Math.round(connus.reduce(function (a, s) { return a + s.rir; }, 0) / connus.length) : null;
    var statuts = { saisi: 0, prerempli: 0, non_verifie: 0, inconnu: 0 }; valides.forEach(function (s) { statuts[s.statutRir]++; });
    var rir = { moyen: moyen, note: moyen === null ? null : moyen >= REGLES.RIR_HAUT ? "pousser" : moyen <= REGLES.RIR_BAS ? "prudence" : null,
      fiable: connus.length > 0 && statuts.saisi === connus.length, statuts: statuts };
    var avec = function (o) { o.rir = rir; o.fourchette = { min: f.min, max: f.max, type: f.type }; return o; };
    if (f.type === "serie100") return avec({ action: "serie100" });
    if (f.type !== "reps") return null;
    var minR = f.min, maxR = f.max;
    var prevues = int(options.seriesPrevues) || REGLES.SERIES_PREVUES_DEFAUT;
    var manquantes = Math.max(0, prevues - valides.length), premierFantome = valides.length;
    var reps = valides.map(function (s) { return s.reps; });
    for (var k = 0; k < manquantes; k++) reps.push(valides[valides.length - 1].reps);
    var charge = valides[0].charge, nb = reps.length;
    if (maxR <= 15) { // perimetre V1 du diagnostic dans le conseil (fourchette haute <= 15)
      var diag = (hist.length >= 2) ? diagnostiquer(hist, f) : null;
      if (diag && diag.code === "regression") return avec({ action: "reduire_charge", pctMin: 5, pctMax: 10, rirMin: 4, diagnostic: diag.code });
      if (diag && diag.code === "progression_trop_rapide") return avec({ action: "consolider", charge: charge, diagnostic: diag.code });
    }
    if (reps.every(function (r) { return r >= maxR; })) {
      var inc = charge >= REGLES.SEUIL_CHARGE_LOURDE ? REGLES.INCREMENT_LOURD : REGLES.INCREMENT_LEGER;
      return avec({ action: "augmenter_charge", charge: charge, increment: inc, nouvelleCharge: Math.round((charge + inc) / inc) * inc, repsCible: minR });
    }
    var cible = -1;
    if (manquantes > 0) cible = premierFantome;
    else {
      for (var i = nb - 2; i >= 0; i--) { if (reps[i] < reps[i + 1]) { cible = i; break; } }
      if (cible === -1 && reps[nb - 1] < maxR) cible = nb - 1;
    }
    if (cible !== -1) {
      var suivant = reps[cible] + 1;
      return avec({ action: "ajouter_rep", serie: cible + 1, reps: suivant, charge: charge, serieNonFaite: manquantes > 0 && cible >= premierFantome,
        ensuiteCharge: suivant >= maxR && reps.filter(function (r, j) { return j !== cible; }).every(function (r) { return r >= maxR; }) });
    }
    return avec({ action: "maintenir", charge: charge, repsMin: minR });
  }

  // ═══════════════════════ 5. DOMAINES (fatigue, recuperation, volume, priorites, morphologie) ═══════════════════════

  // Fatigue : un seul score (somme des reponses du questionnaire) et une seule echelle.
  function scoreFatigue(reponses) {
    var vals = reponses && typeof reponses === "object" ? Object.keys(reponses).map(function (k) { return parseInt(reponses[k], 10) || 0; }) : [];
    var score = vals.reduce(function (a, b) { return a + b; }, 0), e = REGLES.FATIGUE_ECHELLE;
    return { score: score, niveau: vals.length === 0 ? "inconnu" : score <= e[0] ? "optimal" : score <= e[1] ? "correct" : score <= e[2] ? "eleve" : "critique", reponses: vals.length };
  }

  // RIR moyen des series valides sur les N derniers jours, avec sa fiabilite (combien de RIR ont vraiment ete saisis).
  function rirRecent(seancesNorm, aujourdhui, jours) {
    var sets = [];
    seancesNorm.forEach(function (s) { if (s.date && joursEntre(s.date, aujourdhui) >= 0 && joursEntre(s.date, aujourdhui) < jours) s.exercices.forEach(function (e) { e.series.forEach(function (st) { if (st.valide) sets.push(st); }); }); });
    var connus = sets.filter(function (s) { return s.rir !== null; }), saisis = connus.filter(function (s) { return s.statutRir === "saisi"; });
    var moy = function (a) { return a.length ? round1(a.reduce(function (x, s) { return x + s.rir; }, 0) / a.length) : null; };
    return { jours: jours, series: sets.length, rirConnus: connus.length, rirSaisis: saisis.length, moyen: moy(connus), moyenSaisis: moy(saisis) };
  }

  // Recuperation : par muscle principal, derniere date travaillee et jours ecoules (dates locales, jours calendaires).
  function recuperation(seancesNorm, aujourdhui, options) {
    var der = {};
    seancesNorm.forEach(function (s) { if (!s.date) return; s.exercices.forEach(function (e) {
      if (!e.series.some(function (st) { return st.valide; })) return;
      var c = classerExercice(e.nom, options); if (!c.principal) return;
      if (!der[c.principal] || s.date > der[c.principal]) der[c.principal] = s.date; }); });
    var out = {}; Object.keys(der).forEach(function (m) { out[m] = { derniereDate: der[m], jours: joursEntre(der[m], aujourdhui) }; });
    return out;
  }

  // Volume musculaire sur [aujourdhui - jours + 1 ; aujourdhui] : series valides par muscle (1 principal, 0,5 secondaire),
  // dont series « dures » (RIR connu <= 4) et series au RIR saisi. Les exercices non classes sont listes a part.
  function volume(seancesNorm, aujourdhui, jours, options) {
    var parMuscle = {}, nonClasses = {};
    var add = function (m, k, v) { parMuscle[m] = parMuscle[m] || { series: 0, seriesDures: 0, seriesRirSaisi: 0 }; parMuscle[m][k] += v; };
    seancesNorm.forEach(function (s) {
      if (!s.date) return; var d = joursEntre(s.date, aujourdhui); if (d < 0 || d >= jours) return;
      s.exercices.forEach(function (e) {
        var v = e.series.filter(function (st) { return st.valide; }); if (!v.length) return;
        var c = classerExercice(e.nom, options);
        if (!c.principal) { nonClasses[e.nom] = (nonClasses[e.nom] || 0) + v.length; return; }
        var dures = v.filter(function (st) { return st.rir !== null && st.rir <= REGLES.RIR_DUR_MAX; }).length, saisis = v.filter(function (st) { return st.statutRir === "saisi"; }).length;
        add(c.principal, "series", v.length); add(c.principal, "seriesDures", dures); add(c.principal, "seriesRirSaisi", saisis);
        c.secondaires.forEach(function (m) { add(m, "series", v.length * REGLES.VOLUME_SECONDAIRE); add(m, "seriesDures", dures * REGLES.VOLUME_SECONDAIRE); add(m, "seriesRirSaisi", saisis * REGLES.VOLUME_SECONDAIRE); });
      });
    });
    return { jours: jours, parMuscle: parMuscle, nonClasses: nonClasses };
  }

  // Priorites : muscles suivis non travailles depuis plus de 7 jours (regle V1), du plus ancien au plus recent ; jamais travaille = en tete.
  function priorites(recup, options) {
    var suivis = (options && options.musclesSuivis) || GROUPES_SUIVIS_V1;
    return suivis.map(function (m) { var r = recup[m]; return { muscle: m, jours: r ? r.jours : null, derniereDate: r ? r.derniereDate : null }; })
      .filter(function (x) { return x.jours === null || x.jours > REGLES.JOURS_SANS_MUSCLE; })
      .sort(function (a, b) { return (b.jours === null ? Infinity : b.jours) - (a.jours === null ? Infinity : a.jours); })
      .map(function (x) { x.raison = x.jours === null ? "jamais_travaille" : "plus_de_7_jours"; return x; });
  }

  // Morphologie : aucune donnee aujourd'hui. Le moteur ne devine rien ; il indique ce qui manque.
  var CHAMPS_MORPHO = Object.freeze(["taille", "poids", "age", "longueurBras", "longueurFemur", "limitationsArticulaires"]);
  function morphologie(profil) {
    var fournis = profil && typeof profil === "object" ? CHAMPS_MORPHO.filter(function (k) { return profil[k] !== undefined && profil[k] !== null && profil[k] !== ""; }) : [];
    return { disponible: fournis.length > 0, champsFournis: fournis, champsManquants: CHAMPS_MORPHO.filter(function (k) { return fournis.indexOf(k) === -1; }), regles: [] };
  }

  // ═══════════════════════ 6. ANALYSE COMPLETE ═══════════════════════
  // donnees : { sessions, routines?, fatigue? (reponses du questionnaire), profil? }
  // options : { maintenant (Date ou texte, defaut : maintenant), normaliserNom, classements, musclesSuivis }
  // Retour : un objet NEUF ; les donnees recues ne sont jamais modifiees.
  //
  // Format reserve aux futures propositions (aucune n'est produite en op. 3) :
  //   { id, domaine: "progression"|"fatigue"|"recuperation"|"volume"|"priorites"|"morphologie", cible: { exercice?, muscle?, routineId? },
  //     avant: {...}, apres: {...}, raison: "...", donneesUtilisees: {...}, statut: "proposee" }
  // Seule l'application, apres validation explicite de l'utilisateur, pourra en tenir compte.
  function analyser(donnees, options) {
    donnees = donnees || {}; options = options || {};
    var aujourdhui = dateLocale(options.maintenant !== undefined ? options.maintenant : new Date());
    var brutes = Array.isArray(donnees.sessions) ? donnees.sessions : [];
    var seances = normaliserSeances(brutes, options);
    // Qualite des donnees (aucune correction, seulement un constat).
    var horsOrdre = 0; for (var i = 1; i < brutes.length; i++) { var a = dateSeance(brutes[i - 1]), b = dateSeance(brutes[i]); if (a && b && b < a) horsOrdre++; }
    var ids = {}, doublonsId = 0; brutes.forEach(function (s) { if (s && s.id !== undefined && s.id !== null) { if (ids[s.id]) doublonsId++; ids[s.id] = 1; } });
    var rir = { saisi: 0, prerempli: 0, non_verifie: 0, inconnu: 0 }, nbSeries = 0, nbValides = 0, fourchettesIllisibles = {};
    seances.forEach(function (s) { s.exercices.forEach(function (e) {
      if (e.fourchette.type === "inconnu") fourchettesIllisibles[e.fourchette.texte] = true;
      e.series.forEach(function (st) { nbSeries++; if (st.valide) { nbValides++; rir[st.statutRir]++; } }); }); });
    // Par exercice.
    var noms = []; seances.forEach(function (s) { s.exercices.forEach(function (e) { if (noms.indexOf(e.nom) === -1) noms.push(e.nom); }); });
    var seriesPrevues = {};
    (Array.isArray(donnees.routines) ? donnees.routines : []).forEach(function (r) { ((r && r.exercises) || []).forEach(function (e) {
      var n = (typeof options.normaliserNom === "function" ? options.normaliserNom : nomParDefaut)(e && e.name); var k = int(e && e.sets); if (n && k && !(n in seriesPrevues)) seriesPrevues[n] = k; }); });
    var exercices = {};
    noms.forEach(function (n) {
      var h = historiqueExercice(seances, n), dern = h[h.length - 1];
      exercices[n] = {
        catalogue: classerExercice(n, options), seances: h.length, derniereDate: dern.date, fourchette: dern.fourchette, mode: modeMesure(dern.fourchette),
        derniereMesure: mesuresSeance(dern.series), diagnostic: diagnostiquer(h, dern.fourchette), tendance: tendance(h, dern.fourchette),
        conseil: conseilProgression(h, { seriesPrevues: seriesPrevues[n], fourchette: dern.fourchette })
      };
    });
    var recup = recuperation(seances, aujourdhui, options);
    return {
      version: VERSION, aujourdhui: aujourdhui,
      donnees: { seances: seances.length, series: nbSeries, seriesValides: nbValides, rir: rir, seancesHorsOrdre: horsOrdre, idsEnDouble: doublonsId,
        seancesSansDate: seances.filter(function (s) { return !s.date; }).length, fourchettesIllisibles: Object.keys(fourchettesIllisibles),
        exercicesNonClasses: noms.filter(function (n) { return exercices[n].catalogue.source === "non_classe"; }) },
      exercices: exercices,
      fatigue: { questionnaire: scoreFatigue(donnees.fatigue), rir7j: rirRecent(seances, aujourdhui, 7) },
      recuperation: recup,
      volume: volume(seances, aujourdhui, 7, options),
      priorites: priorites(recup, options),
      morphologie: morphologie(donnees.profil),
      propositions: []
    };
  }

  return Object.freeze({
    VERSION: VERSION, REGLES: REGLES, GROUPES: GROUPES, GROUPES_SUIVIS_V1: GROUPES_SUIVIS_V1,
    CATALOGUE: Object.freeze(CATALOGUE.slice()), CHAMPS_MORPHO: CHAMPS_MORPHO,
    // 1. normalisation
    lireRir: lireRir, statutRir: statutRir, lireFourchette: lireFourchette, dateSeance: dateSeance, dateLocale: dateLocale, joursEntre: joursEntre,
    trierSeances: trierSeances, normaliserSerie: normaliserSerie, normaliserSeances: normaliserSeances, historiqueExercice: historiqueExercice,
    // 2. mesures
    e1RM: e1RM, forceSerie: forceSerie, mesuresSeance: mesuresSeance,
    // 3. catalogue
    classerExercice: classerExercice,
    // 4. diagnostics
    modeMesure: modeMesure, axesProgression: axesProgression, comparer: comparer, natureProgression: natureProgression, diagnostiquer: diagnostiquer, tendance: tendance, conseilProgression: conseilProgression,
    // 5. domaines
    scoreFatigue: scoreFatigue, rirRecent: rirRecent, recuperation: recuperation, volume: volume, priorites: priorites, morphologie: morphologie,
    // 6. analyse complete
    analyser: analyser
  });
});
