/*
 * coach-engine.js — Moteur d'analyse du Coach Tatanka Training (Coach V2), version 0.7.0
 *
 * ROLE : lire les donnees qu'on lui transmet et retourner des analyses. RIEN D'AUTRE.
 *   - aucun acces a localStorage, Supabase, au reseau, au DOM ou a React ;
 *   - ne modifie jamais ce qu'on lui donne (seances, routines, programme, reponses de fatigue) :
 *     il travaille sur des copies normalisees ;
 *   - ne contient AUCUNE fonction « appliquer » : une adaptation future sera une PROPOSITION
 *     (objet de donnees) que l'application montrera a l'utilisateur, qui seul decide.
 *
 * BRANCHEMENT (op. 4), ecran par ecran : Seance en cours, Fin de seance, onglet Progres. Repli V1 si ce fichier ne charge pas.
 *
 * COUCHES
 *   1. normalisation  : dates, tri chronologique, lecture du RIR (et de sa fiabilite), fourchettes de repetitions, series valides
 *   2. mesures        : force estimee, tonnage, repetitions, series par muscle
 *   3. catalogue      : un seul classement exercice -> muscle principal / secondaires / type de mouvement
 *   4. diagnostics    : UNE definition de la progression, diagnostic par exercice, tendance de cycle, conseil de double progression,
 *                       et trois lectures distinctes : performance, volume de travail (series, tonnage), tendance generale
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

  var VERSION = "0.12.0";

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
    VOLUME_PCT: 0.02,              // volume de travail : tonnage a +-2 % = stable (meme seuil que le bilan V1)
    SERIE_SUSPECTE_FACTEUR: 3,     // serie ignoree par l'analyse si ses reps >= 3 x la mediane des autres series du meme exercice (>= 2 autres)
    SERIE_SUSPECTE_ECART: 20,      // ... et au moins 20 reps de plus que cette mediane (evite les faux positifs a 1-5 reps)
    INVERSION_REPS_FACTEUR: 2,     // saisie « probablement inversee » : reps > 2 x le haut de fourchette...
    INVERSION_MARGE: 3,            // ... ET charge qui, lue comme des reps, tombe dans la fourchette (+-3) : ex. 6 x 80 en 8-12 = 80 kg x 6
    RUPTURE_CHARGE_PCT: 0.2,       // comparaison non fiable si la charge change de >= 20 % d'une seance a l'autre...
    RUPTURE_REPS_MARGE: 1.5,       // ... avec des reps moyennes quasi identiques (+-1,5) : changement de machine ou de reglage probable
    DIAGNOSTIC_REPS_MAX: 15,       // perimetre V1 du diagnostic : fourchettes jusqu'a 15 reps
    SYNTHESE_SEANCES: 8,           // onglet Progres : tendance calculee sur les 8 dernieres seances (= liste affichee)
    RIR_DUR_MAX: 4,                // serie « dure » = RIR connu <= 4
    RIR_HAUT: 4,                   // V1 : RIR moyen >= 4 -> « pousse plus fort »
    RIR_BAS: 1,                    // V1 : RIR moyen <= 1 -> « sois prudent »
    JOURS_SANS_MUSCLE: 7,          // V1 : alerte muscle non travaille depuis plus de 7 jours
    FATIGUE_VALEUR_MAX: 3,         // questionnaire fatigue : chaque critere note de 0 a 3
    FATIGUE_SEUILS: [2, 5, 9],     // une seule echelle, sur 15 (5 criteres) : 0-2 bas, 3-5 modere, 6-9 eleve, 10-15 tres eleve
    // Etape 3 (0.10.0) : volume et performances par muscle. Aucun coefficient : direct et indirect sont deux compteurs separes.
    CHARGE_SUSPECTE_MAX: 1,        // R-P2 : charge <= 1 kg...
    CHARGE_SUSPECTE_REFERENCE: 10, // ... alors que l'exercice a deja ete enregistre avec >= 10 kg -> « charge probablement erronee »
    REFERENCE_CONSEIL_JOURS: 28,   // 0.12.0 regle 1 : conseil en seance et pre-remplissage = reference de 28 jours au plus (J-28 inclus)
    INTERRUPTION_ALERTE_JOURS: 28, // 0.12.0 : alertes calculees dans une periode sans interruption de plus de 28 jours entre deux seances
    PAUSE_JOURS: 7,                // pause = ecart >= 7 jours entre deux seances (toutes routines)
    FENETRE_JOURS: 28,             // fenetre principale glissante (J-27 a J)
    FENETRE_COURTE_JOURS: 14,      // detection des baisses (J-13 a J)
    SEMAINES_ACTIVES_MIN: 2,       // en dessous : « donnees insuffisantes »
    VOLUME_EVOLUTION_PCT: 0.2,     // R-V4 : ecart signale si >= 20 %...
    VOLUME_EVOLUTION_SERIES: 2,    // ... ET >= 2 series par semaine
    EFFICACE_RIR_MAX: 3,           // serie efficace = RIR reellement saisi <= 3...
    EFFICACE_PART_SAISIE: 0.5,     // ... calculee seulement si >= 50 % des series du muscle ont un RIR saisi...
    EFFICACE_MIN_SERIES: 8,        // ... et au moins 8 series au RIR saisi
    PERF_MIN_FIABLES: 4,           // R-P6 : >= 4 comparaisons fiables,
    PERF_MIN_SEANCES: 2,           //        >= 2 seances distinctes,
    PERF_MIN_BLOC: 3,              //        >= 1 exercice avec >= 3 seances dans son bloc comparable
    TENDANCE_HAUSSE_PCT: 0.6,      // R-P7 : hausse = P >= 60 % et B <= 10 %
    TENDANCE_HAUSSE_BAISSE_MAX: 0.1,
    TENDANCE_BAISSE_MIN: 2,        // baisse = B >= 2 sur >= 2 seances et B >= P
    CONFIANCE_FIABLES: 8,          // R-P8 : confiance haute = >= 8 fiables, >= 2 exercices, >= 4 seances, >= 3 semaines actives,
    CONFIANCE_EXERCICES: 2,
    CONFIANCE_SEANCES: 4,
    CONFIANCE_SEMAINES: 3,
    CONFIANCE_NON_INTERPRETEES_MAX: 0.3, //  <= 30 % de comparaisons non interpretees
    GENERALE_FIABLES: 10,          // R-D1 : >= 10 comparaisons fiables, >= 30 % de baisses, sur >= 3 muscles et >= 3 seances
    GENERALE_BAISSE_PCT: 0.3,
    GENERALE_MUSCLES: 3,
    GENERALE_SEANCES: 3,
    GENERALE_HAUTE_FIABLES: 20,    // confiance haute si >= 20 comparaisons et aucun retour de pause
    LOCALE_BAISSES: 2,             // R-D2 : >= 2 baisses sur >= 2 seances, B >= P...
    LOCALE_AUTRES_MAX: 0.2,        // ... et les autres muscles < 20 % de baisses
    ISOLEE_BAISSES: 2              // R-D4 : une seance avec >= 2 baisses, sans baisse ailleurs sur ces exercices
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
  // SEULE lecture de l'horloge du moteur : la date du jour par defaut (analyser, volumeMuscles, performanceMuscles, bilanEntrainement).
  function jourParDefaut() { return dateLocale(new Date()); }
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
    return { charge: w, reps: r, rir: lireRir(st.rir), statutRir: statutRir(st), rirCible: lireRir(st.rirCible), valide: !!(w && w > 0 && r && r > 0), fait: st.done !== false, type: st.setType || null };
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

  // PROTECTION ANALYTIQUE (lecture seule) : une serie dont les reps sont aberrantes par rapport aux autres series du meme exercice
  // dans la meme seance (ex. 6,8 kg x 112 entre deux 6,8 kg x 12) est marquee « suspecte » et ignoree par l'analyse
  // (valide: false). Meme traitement pour une saisie PROBABLEMENT INVERSEE (charge et reps permutees, voir REGLES.INVERSION_*).
  // La donnee enregistree n'est JAMAIS modifiee : seule la copie analysee porte la marque.
  // Ne s'applique pas aux series de 100 ni aux exercices en duree.
  // R-P2 (0.10.0) : « charge probablement erronee » (code charge_suspecte) = charge <= 1 kg alors que l'exercice a deja ete enregistre
  // avec au moins 10 kg (contexte.chargeMaxAvant = plus lourde charge analysable des seances PRECEDENTES). Ex. Mollets debout machine « 1 ».
  // Toute comparaison qui touche une seance portant cette marque est non fiable (voir comparabiliteEntre).
  // CHARGES CONVENTIONNELLES (0.11.0) : valeur saisie volontairement comme « unite » propre a un exercice, PAS des kilogrammes.
  //   Mollets debout machine : 1 = travail au poids du corps (valeur constante pour suivre la progression en repetitions).
  //   - une serie a cette valeur n'est jamais « charge probablement erronee » (R-P2 ne s'applique pas a elle) ;
  //   - entre deux seances a charge conventionnelle : progression lue en REPETITIONS a charge constante ;
  //   - jamais comparee directement a une charge en kg (raison « unite_charge ») ; elle n'entre pas dans la charge max en kg.
  //   Regle personnelle de l'utilisateur, a deplacer plus tard dans son profil (etape 8). Les donnees enregistrees ne changent pas :
  //   seule la copie analysee porte la marque « conventionnelle ».
  var CHARGES_CONVENTIONNELLES = Object.freeze({ "mollets debout machine": Object.freeze({ valeur: 1, nature: "poids_du_corps" }) });
  function chargeConventionnelle(nom) { return nom ? CHARGES_CONVENTIONNELLES[sansAccents(String(nom).trim())] || null : null; }
  function marquerConventionnelles(series, nom) {
    var cc = chargeConventionnelle(nom); if (!cc) return series;
    return (series || []).map(function (st) {
      if (!st || !st.valide || st.conventionnelle || st.charge !== cc.valeur) return st;
      var c = {}; Object.keys(st).forEach(function (k) { c[k] = st[k]; }); c.conventionnelle = cc.nature; return c;
    });
  }
  // Unite d'une entree d'historique (series valides) : "kg" | "conventionnelle" | "mixte" | null (aucune serie valide).
  function uniteEntree(h) {
    var v = seriesNorm(h && h.series).filter(function (st) { return st.valide; }); if (!v.length) return null;
    var c = v.filter(function (st) { return st.conventionnelle; }).length;
    return c === 0 ? "kg" : c === v.length ? "conventionnelle" : "mixte";
  }
  function mediane(a) { a = a.slice().sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function filtrerSuspectes(series, fourchette, contexte) {
    var f = fourchette || {}, nb = 0, ref = contexte && contexte.chargeMaxAvant;
    series = marquerConventionnelles(series, contexte && contexte.exercice);
    var marquer = function (st, code) { nb++; var c = {}; Object.keys(st).forEach(function (k) { c[k] = st[k]; }); c.valide = false; c.suspecte = code; return c; };
    var chargeSuspecte = function (st) { return st && st.valide && !st.conventionnelle && ref >= REGLES.CHARGE_SUSPECTE_REFERENCE && st.charge <= REGLES.CHARGE_SUSPECTE_MAX; };
    series = (series || []).map(function (st) { return chargeSuspecte(st) ? marquer(st, "charge_suspecte") : st; });
    if (f.type === "serie100" || f.type === "duree") return { series: series.slice(), nb: nb };
    var v = series.filter(function (st) { return st && st.valide; });
    var out = series.map(function (st) {
      if (!st || !st.valide) return st;
      // Saisie probablement inversee (charge <-> reps) : ex. Tractions 6 x 80 en 8-12 (en realite 80 kg x 6).
      if (f.type === "reps" && f.max && st.reps > REGLES.INVERSION_REPS_FACTEUR * f.max && st.charge >= f.min - REGLES.INVERSION_MARGE && st.charge <= f.max + REGLES.INVERSION_MARGE)
        return marquer(st, "inversion_probable");
      var autres = v.filter(function (x) { return x !== st; }).map(function (x) { return x.reps; });
      var md = autres.length >= 2 ? mediane(autres) : 0;
      if (autres.length >= 2 && st.reps >= REGLES.SERIE_SUSPECTE_FACTEUR * md && st.reps - md >= REGLES.SERIE_SUSPECTE_ECART) {
        return marquer(st, "reps_aberrantes");
      }
      return st;
    });
    return { series: out, nb: nb };
  }

  // Historique d'un exercice : UNE entree par seance ou il apparait (seances deja normalisees et triees).
  // Si l'exercice figure deux fois dans la meme seance (ex. un bloc lourd 10-15 et un bloc leger 15-20), seule la PREMIERE
  // occurrence est analysee, comme le V1 : regrouper deux blocs differents fausse les comparaisons (verifie sur donnees reelles).
  // « occurrences » indique combien de fois l'exercice figurait dans la seance.
  function historiqueExercice(seancesNorm, nom) {
    var out = [], chargeMaxAvant = 0;
    seancesNorm.forEach(function (s) {
      var entree = null;
      s.exercices.forEach(function (e) {
        if (e.nom !== nom) return;
        if (!entree) { var fs = filtrerSuspectes(e.series, e.fourchette, { chargeMaxAvant: chargeMaxAvant, exercice: nom }); entree = { date: s.date, id: s.id, fourchette: e.fourchette, series: fs.series, seriesSuspectes: fs.nb, occurrences: 1 }; out.push(entree); }
        else entree.occurrences++;
      });
      if (entree) chargeMaxAvant = Math.max(chargeMaxAvant, chargeMaxValide([entree]));
    });
    return out;
  }
  // Plus lourde charge ANALYSABLE en kg (serie valide, non suspecte, non conventionnelle) d'une liste d'entrees d'historique.
  function chargeMaxValide(entrees) {
    var m = 0; (entrees || []).forEach(function (h) { ((h && h.series) || []).forEach(function (st) { st = st && st.statutRir ? st : normaliserSerie(st); if (st.valide && !st.conventionnelle && st.charge > m) m = st.charge; }); });
    return m;
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
      forcePrecise: v.reduce(function (m, s) { return Math.max(m, s.charge * (1 + s.reps / 30)); }, 0),
      forceFiable: !!best && best.reps <= REGLES.FORCE_REPS_MAX,
      tonnage: round1(v.reduce(function (a, s) { return a + s.charge * s.reps; }, 0)),
      repsTotal: repsTotal,
      repsMoy: v.length ? repsTotal / v.length : 0,
      chargeMax: chargeMax,
      repsAChargeMax: v.filter(function (s) { return s.charge === chargeMax; }).reduce(function (a, s) { return a + s.reps; }, 0),
      seriesAChargeMax: v.filter(function (s) { return s.charge === chargeMax; }).length,
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
    // « Developpe » seul ne suffit pas (ex. developpe Arnold = epaules) : seules les variantes pectoraux connues sont classees.
    [["developpe", "couche"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["developpe", "incline"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["developpe", "decline"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["developpe", "convergent"], "Pectoraux", ["Triceps", "Épaules"], P],
    [["triceps"], "Triceps", [], I],
    [["dips"], "Triceps", ["Pectoraux", "Épaules"], P],
    [["pull-over"], "Dos", [], I],
    [["pullover"], "Dos", [], I],
    [["traction"], "Dos", ["Biceps"], P],
    [["tirage", "horizontal"], "Dos", ["Biceps", "Deltoïde post.", "Trapèzes"], P],
    [["tirage"], "Dos", ["Biceps"], P],
    [["rowing"], "Dos", ["Biceps", "Deltoïde post.", "Trapèzes"], P],
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
      repsTotal: cour.repsTotal - prec.repsTotal, force: cour.force - prec.force,
      forcePrecise: round1((cour.forcePrecise || 0) - (prec.forcePrecise || 0)), forceFiable: !!(prec.forceFiable && cour.forceFiable) };
  }

  // UNE definition de la progression entre deux seances d'un meme exercice (utilisee par tous les diagnostics).
  // Mode « force » (fourchette <= 12) :
  //   progression : la force estimee monte (calculee SANS arrondi : +1 rep a 22,5 kg = +0,75 kg, invisible une fois arrondi),
  //                 OU meme charge (ou plus) avec plus de repetitions au total ;
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
    var a = prec.forcePrecise !== undefined ? prec.forcePrecise : prec.force, b = cour.forcePrecise !== undefined ? cour.forcePrecise : cour.force;
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
      var cmpR = comparer(prev, last, mode, f);
      return cmpR === "progression" ? res(0, { nature: natureProgression(axes) }) : res(-1, { performance: cmpR });
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
    // Derniere etape (regle V1, sur la force ARRONDIE comme les seuils ci-dessus) : force en hausse, ou plus de reps a charge egale ou plus lourde.
    if (b > a || (last.repsTotal > prev.repsTotal && last.chargeMax >= prev.chargeMax)) return res(0, { nature: natureProgression(axes), repsGagnees: b > a ? 0 : last.repsTotal - prev.repsTotal });
    // Pas de diagnostic V1 (ni alerte, ni progression arrondie) : on dit quand meme si la derniere seance est stable, en baisse ou en
    // legere hausse (meme definition que la ligne Performance), pour ne jamais afficher « meme performance » a tort.
    return res(-1, { performance: comparer(prev, last, mode, f) });
  }

  // ── Fin de seance ──
  function seriesNorm(series) { return (series || []).map(function (st) { return st && st.statutRir ? st : normaliserSerie(st); }); }
  function trierHist(h) { return (h || []).slice().sort(function (x, y) { return (x.date || "") < (y.date || "") ? -1 : (x.date || "") > (y.date || "") ? 1 : 0; }); }

  // ═══ 0.12.0 : COMPARAISON DANS LA MEME PLAGE (decisions de l'utilisateur du 26/11/2026) ═══
  // Deux performances d'un meme exercice ne sont comparables que si leurs plages de repetitions sont STRICTEMENT identiques
  // (8-12 = 8-12 ; 10-12 != 10-15). Une plage differente n'est jamais comparee : ni conseil, ni bilan, ni record, ni tendance.
  // Entree sans plage (donnees anciennes) : plage par defaut, comme partout dans le moteur (FOURCHETTE_DEFAUT).
  function memePlage(fa, fb) {
    fa = fa || lireFourchette(""); fb = fb || lireFourchette("");
    if (fa.type !== fb.type) return false;
    if (fa.type === "inconnu") return String(fa.texte) === String(fb.texte);
    return fa.min === fb.min && fa.max === fb.max;
  }
  function enFourchette(f) { return typeof f === "string" ? lireFourchette(f) : (f || lireFourchette("")); }
  function aSeriesValides(h) { return !!h && mesuresSeance(seriesNorm(h.series)).seriesValides > 0; }
  function etendre(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }
  // Entrees d'historique dans la plage donnee (copie triee ; l'historique recu n'est pas modifie).
  function historiqueMemePlage(historique, fourchette) { var f = enFourchette(fourchette); return trierHist(historique).filter(function (h) { return memePlage(h.fourchette, f); }); }
  // Historique limite a la plage de sa DERNIERE entree (lecture d'un exercice « dans sa plage actuelle »).
  function plageDeLaDerniere(historique) { var t = trierHist(historique); return t.length ? t.filter(function (h) { return memePlage(h.fourchette, t[t.length - 1].fourchette); }) : t; }
  // REGLE 1 — conseil en seance et pre-remplissage des charges : derniere seance du meme exercice, plage identique, avec au moins
  // une serie valide, datant de REFERENCE_CONSEIL_JOURS jours au plus (J-28 inclus). Au-dela, ou sans seance : AUCUN chiffre.
  // options.aujourdhui : date du jour (defaut : horloge). Retour :
  //   { statut: "ok" | "premiere_dans_plage" | "reference_trop_ancienne", reference (entree ou null), date, ageJours, fourchette, autresPlages }
  function referenceConseil(historique, fourchette, options) {
    options = options || {};
    var f = enFourchette(fourchette), auj = options.aujourdhui !== undefined && options.aujourdhui !== null ? dateLocale(options.aujourdhui) : jourParDefaut();
    var valides = trierHist(historique).filter(function (h) { return h && h.date && h.date <= auj && aSeriesValides(h); });
    var meme = valides.filter(function (h) { return memePlage(h.fourchette, f); });
    var base = { fourchette: { type: f.type, min: f.min, max: f.max, texte: texteFourchette(f) }, autresPlages: valides.length > meme.length };
    if (!meme.length) return etendre(base, { statut: "premiere_dans_plage", reference: null, date: null, ageJours: null });
    var ref = meme[meme.length - 1], age = joursEntre(ref.date, auj);
    if (age > REGLES.REFERENCE_CONSEIL_JOURS) return etendre(base, { statut: "reference_trop_ancienne", reference: null, date: ref.date, ageJours: age });
    return etendre(base, { statut: "ok", reference: ref, date: ref.date, ageJours: age });
  }

  // Bilan d'un exercice a la fin d'une seance : la seance du jour contre la precedente, avec la MEME definition que comparer()
  // (celle de l'ecran Seance en cours). Retour :
  //   { verdict: "premiere" | "progression" | "stable" | "regression", nature?, mode, axes?, precedente?, jour }
  //   mode : "force" (<= 12), "reps" (> 12) ; series de 100 et gainage sont compares en charge puis en repetitions.
  //
  // R-P3 (0.10.0) SEANCE INCOMPLETE : la seance du jour a MOINS de series analysables que la precedente (k contre n).
  //   On compare alors le MEME nombre de series : les k meilleures series de la precedente contre les k series du jour, avec la
  //   meme definition (comparer), le meme mode et la meme fourchette. Meilleures series : mode force = force estimee (sans arrondi),
  //   puis charge ; mode repetitions = charge la plus lourde, puis le plus de reps.
  //   - si ces k series sont en baisse -> verdict "regression" (vraie baisse) ;
  //   - sinon -> verdict "seance_incomplete" : ni progression ni baisse (une comparaison incomplete n'est jamais une progression).
  //   Le detail est dans out.incomplete ; out.axes decrit la comparaison a nombre de series egal.
  function meilleuresSeries(series, k, mode) {
    var v = (series || []).filter(function (st) { return st.valide; }).slice();
    var fp = function (st) { return st.charge * (1 + st.reps / 30); };
    v.sort(mode === "force" ? function (a, b) { return fp(b) - fp(a) || b.charge - a.charge || b.reps - a.reps; }
      : function (a, b) { return b.charge - a.charge || b.reps - a.reps; });
    return v.slice(0, k);
  }
  // options.exercice (0.11.0) : nom de l'exercice, pour reconnaitre une charge conventionnelle dans des series du jour brutes.
  // 0.12.0 (regle 2, bilan) : la reference est la derniere seance de la MEME plage, quel que soit son age. options.date (date de la
  // seance analysee) permet d'indiquer l'anciennete : reference { date, ageJours, ancienne } — une comparaison « ancienne »
  // (> REFERENCE_CONSEIL_JOURS) est informative, jamais un conseil. premiereDansPlage : l'exercice existe dans d'autres plages seulement.
  function bilanExercice(historiqueAvant, seriesDuJour, fourchette, options) {
    options = options || {};
    var tousAvant = trierHist(historiqueAvant), f = enFourchette(fourchette);
    var hist = tousAvant.filter(function (h) { return memePlage(h.fourchette, f); });
    var cmAvant = options.chargeMaxAvant !== undefined ? options.chargeMaxAvant : chargeMaxValide(tousAvant);
    var jourSeries = filtrerSuspectes(seriesNorm(seriesDuJour), f, { chargeMaxAvant: cmAvant, exercice: options.exercice }).series;
    var cur = mesuresSeance(jourSeries), mode = modeMesure(f), modeCmp = mode === "aucun" ? "reps" : mode;
    var uJour = uniteEntree({ series: jourSeries });
    var resume = function (m, date, u) { return { date: date || null, chargeMax: m.chargeMax, repsAChargeMax: m.repsAChargeMax, repsTotal: m.repsTotal, force: m.force, forceFiable: m.forceFiable, series: m.seriesValides, unite: u || null }; };
    var iPrev = -1; for (var i = hist.length - 1; i >= 0; i--) { if (mesuresSeance(seriesNorm(hist[i].series)).seriesValides > 0) { iPrev = i; break; } }
    var prevEntry = iPrev >= 0 ? hist[iPrev] : null;
    if (!prevEntry || cur.seriesValides === 0) return { verdict: "premiere", mode: mode, jour: resume(cur, null, uJour),
      premiereDansPlage: !prevEntry && tousAvant.some(aSeriesValides), plage: texteFourchette(f) };
    var prev = mesuresSeance(seriesNorm(prevEntry.series)), fCmp = mode === "aucun" ? null : f, uPrev = uniteEntree(prevEntry);
    // Deux seances a charge conventionnelle (ex. poids du corps) : progression en repetitions a charge constante, jamais en force estimee.
    if (uJour === "conventionnelle" && uPrev === "conventionnelle") modeCmp = "reps";
    var verdict = comparer(prev, cur, modeCmp, fCmp), axes = axesProgression(prev, cur), incomplete = null;
    if (cur.seriesValides < prev.seriesValides) {
      var k = cur.seriesValides, prevK = mesuresSeance(meilleuresSeries(seriesNorm(prevEntry.series), k, modeCmp));
      var resK = comparer(prevK, cur, modeCmp, fCmp);
      incomplete = { seriesPrecedente: prev.seriesValides, seriesJour: k, seriesComparees: k, resultatMeilleuresSeries: resK, precedenteMeilleures: resume(prevK, prevEntry.date, uPrev) };
      verdict = resK === "regression" ? "regression" : "seance_incomplete";
      axes = axesProgression(prevK, cur);
    }
    var out = { verdict: verdict, mode: mode, axes: axes, precedente: resume(prev, prevEntry.date, uPrev), jour: resume(cur, null, uJour) };
    if (incomplete) out.incomplete = incomplete;
    if (verdict === "progression") out.nature = natureProgression(axes);
    lectureTravail(out, prev, cur);
    out.comparaison = comparabiliteEntre(hist.concat([{ date: null, fourchette: f, series: jourSeries }]), iPrev, hist.length);
    var age = options.date && prevEntry.date ? joursEntre(prevEntry.date, dateLocale(options.date)) : null;
    out.reference = { date: prevEntry.date, ageJours: age, ancienne: age !== null && age > REGLES.REFERENCE_CONSEIL_JOURS };
    out.plage = texteFourchette(f);
    return out;
  }

  // Records de la seance contre TOUT l'historique de l'exercice. Le critere d'affichage reste celui du V1 (force estimee
  // > meilleure force passee + 1 %), mais le moteur dit de quel record il s'agit :
  //   chargeMax : charge jamais soulevee ; reps : plus de reps que jamais a cette charge (ou plus lourde) ;
  //   force : force estimee, avec forceFiable (meilleure serie <= 12 reps) — au-dela, c'est une estimation peu fiable.
  // Charge conventionnelle (0.11.0, options.exercice) : les series du jour ne sont comparees qu'aux series passees de la MEME unite.
  //   Series en kg : regles ci-dessus, contre les seules series passees en kg. Seance uniquement a charge conventionnelle : seul le
  //   record de repetitions compte (reps, conventionnelle: true) ; ni charge max, ni force estimee (record = record de repetitions).
  // 0.12.0 (regle 2, records) : records SEPARES PAR PLAGE (fourchette donnee : seules les seances de la meme plage comptent),
  // sur TOUT l'historique de cette plage, sans limite d'age : un record ancien reste un record.
  function recordsExercice(historiqueAvant, seriesDuJour, fourchette, options) {
    var nom = options && options.exercice, tousPasse = [];
    var hRec = fourchette ? (historiqueAvant || []).filter(function (h) { return memePlage(h.fourchette, enFourchette(fourchette)); }) : (historiqueAvant || []);
    var res = recordsDansPlage(historiqueAvant, hRec, seriesDuJour, fourchette, nom, tousPasse);
    if (res) { res.plage = fourchette ? texteFourchette(enFourchette(fourchette)) : null; res.autresPlages = (historiqueAvant || []).length - hRec.length; }
    return res;
  }
  function recordsDansPlage(historiqueAvant, hRec, seriesDuJour, fourchette, nom, tousPasse) {
    hRec.forEach(function (h) { marquerConventionnelles(seriesNorm(h.series), nom).forEach(function (st) { if (st.valide) tousPasse.push(st); }); });
    var jourTous = (fourchette ? filtrerSuspectes(seriesNorm(seriesDuJour), fourchette, { chargeMaxAvant: chargeMaxValide(historiqueAvant), exercice: nom }).series : marquerConventionnelles(seriesNorm(seriesDuJour), nom)).filter(function (st) { return st.valide; });
    var jour = jourTous.filter(function (st) { return !st.conventionnelle; }), passe = tousPasse.filter(function (st) { return !st.conventionnelle; });
    if (!jour.length) {
      var jc = jourTous.filter(function (st) { return st.conventionnelle; }), pc = tousPasse.filter(function (st) { return st.conventionnelle; });
      if (!jc.length || !pc.length) return null;
      var maxP = Math.max.apply(null, pc.map(function (p) { return p.reps; })), bestJ = jc.reduce(function (m, st) { return !m || st.reps > m.reps ? st : m; }, null);
      var rc = bestJ.reps > maxP ? { reps: bestJ.reps, charge: bestJ.charge, avant: maxP, conventionnelle: bestJ.conventionnelle } : null;
      return { record: !!rc, conventionnelle: bestJ.conventionnelle, chargeMax: null, reps: rc, force: null };
    }
    if (!passe.length) return null;
    var fp = function (st) { return st.charge * (1 + st.reps / 30); };
    var forcePasse = Math.max.apply(null, passe.map(fp)), chargePasse = Math.max.apply(null, passe.map(function (st) { return st.charge; }));
    var meilleure = jour.reduce(function (m, st) { return !m || fp(st) > fp(m) ? st : m; }, null);
    var reps = null;
    jour.forEach(function (st) { var ref = passe.filter(function (p) { return p.charge >= st.charge; }); if (!ref.length) return;
      var maxR = Math.max.apply(null, ref.map(function (p) { return p.reps; })); if (st.reps > maxR && (!reps || st.charge > reps.charge || (st.charge === reps.charge && st.reps > reps.reps))) reps = { reps: st.reps, charge: st.charge, avant: maxR }; });
    var chargeJour = Math.max.apply(null, jour.map(function (st) { return st.charge; }));
    return {
      record: jour.some(function (st) { return fp(st) > forcePasse * 1.01; }), // regle V1 du badge « nouveau record »
      chargeMax: chargeJour > chargePasse ? { charge: chargeJour, avant: chargePasse } : null,
      reps: reps,
      force: { valeur: Math.round(fp(meilleure)), avant: Math.round(forcePasse), fiable: meilleure.reps <= REGLES.FORCE_REPS_MAX, enHausse: fp(meilleure) > forcePasse }
    };
  }

  // ── Trois lectures distinctes : PERFORMANCE, VOLUME DE TRAVAIL, TENDANCE GENERALE ──
  //   performance : le verdict de comparer() (meilleure serie, reps a charge egale, force estimee) — inchange ;
  //   volume      : nombre de series valides et tonnage (charge x reps) ;
  //   tendance    : lecture combinee qui ne confond pas « une meilleure serie » avec « plus de travail au total ».
  function volumeEntre(prec, cour) {
    var dT = round1(cour.tonnage - prec.tonnage), pct = prec.tonnage > 0 ? (cour.tonnage - prec.tonnage) / prec.tonnage : 0;
    return { series: cour.seriesValides - prec.seriesValides, seriesAvant: prec.seriesValides, seriesApres: cour.seriesValides,
      tonnage: dT, tonnagePct: round1(pct * 100), sens: pct > REGLES.VOLUME_PCT ? "hausse" : pct < -REGLES.VOLUME_PCT ? "baisse" : "stable" };
  }
  // Meilleure serie (force estimee sans arrondi) : "hausse" | "egale" | "baisse".
  function meilleureSerieEntre(prec, cour) { var d = (cour.forcePrecise || 0) - (prec.forcePrecise || 0); return Math.abs(d) < 1e-9 ? "egale" : d > 0 ? "hausse" : "baisse"; }
  // Une progression « seulement par des series en plus » : plus de series, mais ni meilleure serie, ni charge plus lourde,
  // ni plus de reps par serie a la charge de travail. Ce n'est pas une meilleure performance : c'est plus de travail.
  function gainParSeriesSeules(prec, cour) {
    var moy = function (m) { return m.seriesAChargeMax ? m.repsAChargeMax / m.seriesAChargeMax : 0; };
    return cour.seriesValides > prec.seriesValides && meilleureSerieEntre(prec, cour) !== "hausse" && cour.chargeMax <= prec.chargeMax && moy(cour) <= moy(prec) + 1e-9;
  }
  var TENDANCES = Object.freeze(["progression_globale", "progression_performance", "meilleure_serie_seule", "plus_de_travail", "stable", "moins_de_travail", "performance_en_baisse", "baisse_globale"]);
  // perf : "hausse" | "stable" | "baisse" ; vol : "hausse" | "stable" | "baisse" ; parSeries : gain explique seulement par des series en plus.
  function tendanceGenerale(perf, vol, parSeries) {
    if (!perf || !vol) return null;
    if (perf === "hausse") return parSeries ? "plus_de_travail" : vol === "hausse" ? "progression_globale" : vol === "baisse" ? "meilleure_serie_seule" : "progression_performance";
    if (perf === "baisse") return vol === "baisse" ? "baisse_globale" : "performance_en_baisse";
    return vol === "hausse" ? "plus_de_travail" : vol === "baisse" ? "moins_de_travail" : "stable";
  }
  var SENS_VERDICT = { progression: "hausse", stable: "stable", regression: "baisse" };
  function lectureTravail(out, prev, cur) {
    out.volume = volumeEntre(prev, cur);
    out.meilleureSerie = meilleureSerieEntre(prev, cur);
    out.gainParSeriesSeules = out.verdict === "progression" && gainParSeriesSeules(prev, cur);
    out.tendance = tendanceGenerale(SENS_VERDICT[out.verdict], out.volume.sens, out.gainParSeriesSeules);
    return out;
  }
  // Variation relative d'une droite des moindres carres (debut -> fin), ou null (< 2 points).
  // Variation relative de la droite des moindres carres, du premier au dernier point. xs (0.12.0) : abscisses reelles (jours) ;
  // absentes, invalides ou toutes egales -> points regulierement espaces (comportement d'avant).
  function variationDroite(ys, xs) {
    var n = ys.length; if (n < 2) return null;
    var ok = Array.isArray(xs) && xs.length === n && xs.every(function (x) { return typeof x === "number" && isFinite(x); }) && xs.some(function (x) { return x !== xs[0]; });
    var X = ok ? xs : ys.map(function (y, i) { return i; });
    var mx = X.reduce(function (s, x) { return s + x; }, 0) / n, my = ys.reduce(function (s, y) { return s + y; }, 0) / n, sxy = 0, sxx = 0;
    ys.forEach(function (y, i) { sxy += (X[i] - mx) * (y - my); sxx += (X[i] - mx) * (X[i] - mx); });
    var pente = sxy / sxx, debut = my + pente * (X[0] - mx), fin = my + pente * (X[n - 1] - mx);
    return debut > 0 ? (fin - debut) / debut : 0;
  }
  function sensDe(v, seuil) { return v > seuil ? "hausse" : v < -seuil ? "baisse" : "stable"; }

  // COMPARABILITE de deux seances (entrees d'historique). Une comparaison est signalee « non fiable » si :
  //   fourchette : la fourchette a change (ex. 8-12 -> 15-20 : la charge baisse volontairement, ce n'est pas une regression) ;
  //   unite_charge : l'une des seances est a charge conventionnelle (ex. poids du corps), l'autre en kg (ou melange les deux) ;
  //   rupture_charge : la charge change de >= 20 % avec les memes reps (+-1,5) — progression ou baisse invraisemblable
  //                    d'une seance a l'autre : changement de machine, de reglage ou de facon de noter la charge probable.
  // Rien n'est fusionne, renomme ni corrige : la comparaison est seulement marquee.
  function texteFourchette(f) { f = f || {}; return f.min === null || f.min === undefined ? (f.texte || "") : f.min === f.max ? String(f.min) : f.min + "-" + f.max; }
  function comparabilite(precEntree, courEntree) {
    var raisons = [];
    if (!precEntree || !courEntree) return { fiable: true, raisons: raisons };
    var fa = precEntree.fourchette, fb = courEntree.fourchette;
    if (fa && fb && !(fa.type === fb.type && fa.min === fb.min && fa.max === fb.max)) raisons.push({ code: "fourchette", avant: texteFourchette(fa), apres: texteFourchette(fb) });
    var a = mesuresSeance(seriesNorm(precEntree.series)), b = mesuresSeance(seriesNorm(courEntree.series));
    // 0.11.0 : une charge conventionnelle (ex. 1 = poids du corps) n'est jamais comparee a une charge en kg.
    var ua = uniteEntree(precEntree), ub = uniteEntree(courEntree);
    if (ua && ub && (ua !== ub || ua === "mixte")) raisons.push({ code: "unite_charge", avant: ua, apres: ub });
    else if (a.chargeMax > 0 && b.chargeMax > 0) {
      var pct = (b.chargeMax - a.chargeMax) / a.chargeMax;
      if (Math.abs(pct) >= REGLES.RUPTURE_CHARGE_PCT && Math.abs(b.repsMoy - a.repsMoy) <= REGLES.RUPTURE_REPS_MARGE)
        raisons.push({ code: "rupture_charge", avant: a.chargeMax, apres: b.chargeMax, pct: Math.round(pct * 100) });
    }
    return { fiable: raisons.length === 0, raisons: raisons };
  }
  // Comparabilite de tous[iPrec] et tous[iCour] (historique TRIE, entrees de historiqueExercice) : comparabilite() + R-P2.
  // La comparaison est non fiable (code charge_suspecte) si l'une des deux seances, ou une seance sautee entre les deux, porte une
  // charge probablement erronee : on ne compare jamais par-dessus une periode de charges non fiables.
  function aChargeSuspecte(h) { return ((h && h.series) || []).some(function (st) { return st && st.suspecte === "charge_suspecte"; }); }
  function comparabiliteEntre(tous, iPrec, iCour) {
    var c = comparabilite(tous[iPrec], tous[iCour]), dates = [];
    for (var k = Math.max(0, iPrec); k <= iCour && k < tous.length; k++) if (aChargeSuspecte(tous[k])) dates.push(tous[k].date);
    if (!dates.length) return c;
    return { fiable: false, raisons: c.raisons.concat([{ code: "charge_suspecte", dates: dates }]) };
  }
  // Dernier bloc comparable : les seances les plus recentes reliees entre elles par des comparaisons fiables.
  // 0.12.0 : options.interruptionJours (alertes) : le bloc est aussi coupe par un ecart de plus de N jours entre deux seances
  // comparables (raison « interruption ») : apres une interruption, une nouvelle periode commence, sans alerte tiree d'avant.
  function blocComparable(historique, options) {
    var tous = trierHist(historique), idx = [], lim = options && options.interruptionJours;
    tous.forEach(function (h, i) { if (mesuresSeance(seriesNorm(h.series)).seriesValides > 0) idx.push(i); });
    if (!idx.length) return { seances: [], rupture: null };
    var cmp = function (j) { return comparabiliteEntre(tous, idx[j - 1], idx[j]); };
    var ecart = function (j) { var a = tous[idx[j - 1]].date, b = tous[idx[j]].date; return a && b ? joursEntre(a, b) : 0; };
    var coupe = function (j) { return !!lim && ecart(j) > lim; };
    var i = idx.length - 1;
    while (i > 0 && !coupe(i) && cmp(i).fiable) i--;
    var raisons = i > 0 ? (coupe(i) ? [{ code: "interruption", jours: ecart(i) }] : []).concat(cmp(i).fiable ? [] : cmp(i).raisons) : null;
    return { seances: idx.slice(i).map(function (j) { return tous[j]; }), rupture: i > 0 ? { date: tous[idx[i]].date, avant: tous[idx[i - 1]].date, raisons: raisons } : null };
  }

  // Derniere seance sans AUCUNE serie analysable (toutes a charge suspecte, inversees, aberrantes ou sans charge) : bilan
  // « non comparable » avec la raison. Jamais le resultat d'une seance plus ancienne a sa place.
  function bilanNonAnalysable(dernierBrut, derniereAnalysable, f) {
    var codes = []; seriesNorm(dernierBrut.series).forEach(function (st) { if (st.suspecte && codes.indexOf(st.suspecte) === -1) codes.push(st.suspecte); });
    var raisons = codes.length ? codes.map(function (c) { return c === "charge_suspecte" ? { code: c, dates: [dernierBrut.date] } : { code: c }; }) : [{ code: "aucune_serie_analysable" }];
    return { verdict: "non_comparable", mode: modeMesure(f), jour: { date: dernierBrut.date, series: 0 }, precedente: { date: derniereAnalysable ? derniereAnalysable.date : null },
      comparaison: { fiable: false, raisons: raisons } };
  }

  // ANALYSE UNIQUE d'un exercice, utilisee par l'ecran Fin de seance ET par l'onglet Progres : memes seances = meme resultat.
  // historique : entrees de historiqueExercice, la seance analysee en DERNIER (la seance du jour en fin de seance).
  // Retour :
  //   performance : "premiere" | "progression" | "stable" | "regression" | "seance_incomplete" (R-P3) | "non_comparable"
  //                 (derniere seance vs la precedente). Si la DERNIERE seance n'a aucune serie analysable (ex. toutes a charge
  //                 suspecte, ou sans charge), performance = "non_comparable" avec la raison : jamais le resultat d'une seance plus ancienne.
  //   bilan       : bilanExercice (avec volume, tendance, comparaison { fiable, raisons })
  //   statut      : "ok" | "historique_insuffisant" | "non_comparable" | "hors_perimetre" (pour le diagnostic)
  //   diagnostic  : diagnostiquer() sur le DERNIER BLOC COMPARABLE seulement, ou null ;
  //                 plafond atteint alors que la derniere seance progresse -> diagnostic.enProgression = true (indication positive) ;
  //                 regression sur 3 seances alors que la derniere progresse -> pas de diagnostic (meme garde partout)
  //   alerte      : le diagnostic s'il faut ALERTER (trop rapide, vrai plafond, vraie regression), sinon null
  //   bloc        : { seances, rupture } (rupture = raisons de la derniere coupure)
  // Bilan « premiere » alors que l'exercice a deja ete fait dans une AUTRE plage : premiereDansPlage, comparaison non fiable
  // (raison « fourchette », avec la date de la derniere seance dans l'autre plage). Les deux plages ne sont jamais comparees.
  function marquerPremiereDansPlage(bilan, avant, f) {
    if (!bilan || bilan.verdict !== "premiere") return bilan;
    var autres = trierHist(avant).filter(function (h) { return !memePlage(h.fourchette, f) && aSeriesValides(h); });
    if (!autres.length) return bilan;
    var pa = autres[autres.length - 1];
    bilan.premiereDansPlage = true; bilan.precedenteAutrePlage = { date: pa.date, plage: texteFourchette(pa.fourchette) };
    bilan.comparaison = { fiable: false, raisons: [{ code: "fourchette", avant: texteFourchette(pa.fourchette), apres: texteFourchette(f), premiereDansPlage: true, dateAutrePlage: pa.date }] };
    return bilan;
  }
  // 0.12.0 : l'analyse ne lit que la PLAGE de la seance analysee (options.fourchette, sinon celle de la derniere seance) : les
  // seances d'une autre plage sont ignorees (jamais comparees). Bilan : derniere seance de la meme plage, sans limite d'age, avec
  // son anciennete. Diagnostic et alerte : dernier bloc comparable SANS interruption de plus de INTERRUPTION_ALERTE_JOURS jours.
  function analyseExercice(historique, options) {
    options = options || {};
    var tous0 = trierHist(historique);
    if (!tous0.length) return { performance: "premiere", statut: "historique_insuffisant", bilan: null, diagnostic: null, alerte: null, bloc: { seances: 0, rupture: null } };
    var fFiltre = options.fourchette ? enFourchette(options.fourchette) : tous0[tous0.length - 1].fourchette;
    var tous = tous0.filter(function (h, i) { return i === tous0.length - 1 || memePlage(h.fourchette, fFiltre); }), dernierBrut = tous[tous.length - 1];
    var valide = function (h) { return mesuresSeance(seriesNorm(h.series)).seriesValides > 0; };
    var hist = tous.filter(valide);
    // Derniere seance sans serie analysable : signalee comme avant 0.12.0, quelle que soit la plage des seances precedentes.
    var histToutes = tous0.filter(valide);
    if (!hist.length && histToutes.length && !valide(dernierBrut)) hist = [histToutes[histToutes.length - 1]];
    if (!hist.length) return { performance: "premiere", statut: "historique_insuffisant", bilan: null, diagnostic: null, alerte: null, bloc: { seances: 0, rupture: null } };
    var last = hist[hist.length - 1], f = options.fourchette || last.fourchette || lireFourchette("");
    if (dernierBrut !== last) {
      var bnc = bilanNonAnalysable(dernierBrut, last, f);
      return { fourchette: f, performance: "non_comparable", statut: "non_comparable", diagnostic: null, alerte: null,
        bloc: { seances: 0, rupture: { date: dernierBrut.date, avant: last.date, raisons: bnc.comparaison.raisons } }, bilan: bnc };
    }
    // Seances precedentes AVEC celles sans serie analysable : une periode de charges suspectes entre les deux rend la comparaison non fiable.
    var bilan = bilanExercice(tous.slice(0, -1), last.series, f, { date: last.date, chargeMaxAvant: chargeMaxValide(tous0.slice(0, -1)), exercice: options.exercice });
    // Premiere seance dans cette plage alors que l'exercice existe dans une autre plage : « non comparable », raison « fourchette »
    // (premiereDansPlage) — jamais comparee a l'autre plage, jamais lue comme une premiere seance de l'exercice.
    marquerPremiereDansPlage(bilan, tous0.slice(0, -1), f);
    var performance = bilan.premiereDansPlage ? "non_comparable" : bilan.verdict === "premiere" ? "premiere" : (bilan.comparaison && !bilan.comparaison.fiable) ? "non_comparable" : bilan.verdict;
    var bc = blocComparable(tous, { interruptionJours: REGLES.INTERRUPTION_ALERTE_JOURS }), bloc = bc.seances, diag = null, statut;
    if (bilan.premiereDansPlage) { statut = "non_comparable"; bc = { seances: bloc, rupture: { date: last.date, avant: bilan.precedenteAutrePlage.date, raisons: bilan.comparaison.raisons } }; }
    else if (!(f.type === "reps" && f.max <= REGLES.DIAGNOSTIC_REPS_MAX)) statut = "hors_perimetre";
    else if (hist.length < 2) statut = "historique_insuffisant";
    else if (bloc.length < 2) statut = "non_comparable";
    else {
      statut = "ok"; diag = diagnostiquer(bloc, f);
      if (diag && (diag.code === "plafond" || diag.code === "regression")) {
        var progresse = comparer(mesuresSeance(seriesNorm(bloc[bloc.length - 2].series)), mesuresSeance(seriesNorm(bloc[bloc.length - 1].series)), diag.mode, f) === "progression";
        if (progresse && diag.code === "regression") diag = null;
        else if (progresse && performance !== "seance_incomplete") diag.enProgression = true;
      }
      // R-P3 : une seance incomplete n'est ni une progression ni une baisse, pour le diagnostic aussi (meme definition partout) :
      // pas de « regression persistante » ni de « progression » fondee sur une seance incomplete ; la carte le dit.
      if (diag && performance === "seance_incomplete") {
        if (diag.code === "regression") diag = null;
        else if (diag.code === "progression" || diag.code === "stable") { diag.code = "stable"; diag.typeV1 = -1; diag.performance = "seance_incomplete"; diag.incomplete = bilan.incomplete; delete diag.nature; delete diag.repsGagnees; }
      }
      if (diag && diag.derniere) diag.derniere.unite = uniteEntree(bloc[bloc.length - 1]);
      // La carte « stable » suit la ligne Performance (une seule definition, R-P3 comprise).
      if (diag && diag.typeV1 === -1 && bilan.comparaison && bilan.comparaison.fiable && performance !== "premiere") diag.performance = performance;
    }
    return { fourchette: f, performance: performance, bilan: bilan, statut: statut, diagnostic: diag,
      alerte: diag && diag.typeV1 > 0 && !diag.enProgression ? diag : null, bloc: { seances: bloc.length, rupture: bc.rupture },
      plage: { texte: texteFourchette(f), seancesAutresPlages: tous0.length - tous.length } };
  }

  // Synthese d'un exercice pour l'onglet Progres (lecture seule).
  //   derniere : la derniere seance contre la precedente (bilanExercice : performance + volume + tendance) ;
  //   periode  : sur les N dernieres seances (defaut 8) : performance = meilleure serie (force estimee, « fiable » si toutes
  //              les meilleures series font <= 12 reps), volume = tonnage, et la tendance generale qui combine les deux ;
  //   pistes   : futures adaptations PREPAREES, statut "non_activee" : ni affichees, ni appliquees.
  // 0.12.0 (regle 2, tendances) : seances de la MEME plage uniquement, historique complet (aucune limite d'age), droite calculee
  // sur les VRAIES dates (un trou de 2 mois pese 2 mois) ; la periode indique du/au et l'age de la derniere performance.
  function syntheseExercice(historique, fourchette, options) {
    options = options || {};
    var tous0 = trierHist(historique);
    if (!tous0.length) return null;
    var fFiltre = fourchette ? enFourchette(fourchette) : tous0[tous0.length - 1].fourchette;
    var tous = tous0.filter(function (h, i) { return i === tous0.length - 1 || memePlage(h.fourchette, fFiltre); }), dernierBrut = tous[tous.length - 1];
    var hist = tous.filter(function (h) { return mesuresSeance(seriesNorm(h.series)).seriesValides > 0; });
    if (!hist.length) return null;
    var last = hist[hist.length - 1], f = fourchette || last.fourchette || lireFourchette("");
    var derniere = dernierBrut !== last ? bilanNonAnalysable(dernierBrut, last, f) : bilanExercice(tous.slice(0, -1), last.series, f, { date: last.date, chargeMaxAvant: chargeMaxValide(tous0.slice(0, -1)) });
    if (dernierBrut === last) marquerPremiereDansPlage(derniere, tous0.slice(0, -1), f);
    // Fenetre : les N dernieres seances du dernier BLOC COMPARABLE (meme fourchette, pas de rupture de charge) : un changement de
    // programme (ex. 8-12 -> 15-20 avec une charge plus legere) ou de machine n'est pas lu comme une baisse de performance.
    var bc = blocComparable(tous), bloc = bc.seances.length ? bc.seances : [last];
    var n = int(options.seances) || REGLES.SYNTHESE_SEANCES, fen = bloc.slice(-n), ms = fen.map(function (h) { return mesuresSeance(seriesNorm(h.series)); });
    var periode = null;
    if (fen.length >= 3) {
      var xs = fen.map(function (h) { return h.date ? joursEntre(fen[0].date, h.date) : null; });
      var vp = variationDroite(ms.map(function (m) { return m.forcePrecise; }), xs), vv = variationDroite(ms.map(function (m) { return m.tonnage; }), xs);
      var perf = { sens: sensDe(vp, REGLES.TENDANCE_PCT), variationPct: round1(vp * 100), fiable: ms.every(function (m) { return m.forceFiable; }),
        debut: Math.round(ms[0].forcePrecise), fin: Math.round(ms[ms.length - 1].forcePrecise) };
      var vol = { sens: sensDe(vv, REGLES.VOLUME_PCT), variationPct: round1(vv * 100),
        seriesDebut: ms[0].seriesValides, seriesFin: ms[ms.length - 1].seriesValides };
      var aujS = options.aujourdhui !== undefined ? dateLocale(options.aujourdhui) : jourParDefaut();
      periode = { seances: fen.length, fourchette: texteFourchette(f), du: fen[0].date, au: last.date, performance: perf, volume: vol, tendance: tendanceGenerale(perf.sens, vol.sens, false),
        joursCouverts: fen[0].date && last.date ? joursEntre(fen[0].date, last.date) : null, ageDerniereJours: last.date ? joursEntre(last.date, aujS) : null };
    }
    var out = { mode: modeMesure(f), derniere: derniere, periode: periode, rupture: bc.rupture, seancesComparables: bc.seances.length };
    out.pistes = pistesAdaptation(options.diagnostic || null, out);
    return out;
  }

  // FUTURES ADAPTATIONS (preparees, NON activees) : de simples objets de donnees. Le moteur ne les applique jamais ;
  // l'application ne les affiche pas encore. Plus tard, chacune sera proposee a l'utilisateur, qui seul decidera.
  function pistesAdaptation(diagnostic, synthese) {
    var p = [], add = function (code, raison) { p.push(Object.freeze({ code: code, raison: raison, statut: "non_activee" })); };
    var c = diagnostic && diagnostic.code;
    if (c === "plafond") add("monter_charge", "plafond");
    if (c === "progression_trop_rapide") add("consolider_charge", "progression_trop_rapide");
    if (c === "regression") add("alleger_charge", "regression");
    var d = synthese && synthese.derniere;
    if (d && d.volume && d.volume.series < 0 && (d.tendance === "meilleure_serie_seule" || d.tendance === "moins_de_travail")) add("retablir_series", d.tendance);
    if (synthese && synthese.periode && synthese.periode.tendance === "baisse_globale") add("verifier_recuperation", "baisse_globale");
    return Object.freeze(p);
  }

  // Tendance sur toutes les seances d'une periode (ex. un cycle) : droite des moindres carres sur la mesure principale.
  // Retour : { sens: "hausse" | "baisse" | "stable", variationPct, seances } ou null (< 2 seances mesurables).
  // 0.12.0 : seances de la MEME plage seulement (celle donnee, sinon celle de la derniere seance), toutes dates confondues,
  // abscisses = vraies dates. Retour enrichi de la periode (du, au).
  function tendance(historique, fourchette) {
    var tous = trierHist(historique);
    var f = fourchette || (tous.length && tous[tous.length - 1].fourchette) || lireFourchette("");
    var mode = modeMesure(f); if (mode === "aucun") return null;
    var pts = tous.filter(function (h) { return memePlage(h.fourchette, f); }).map(function (h) { return { d: h.date, y: metrique(mesuresSeance(h.series), mode) }; }).filter(function (p) { return p.y > 0; });
    var n = pts.length; if (n < 2) return null;
    var xs = pts.map(function (p) { return p.d && pts[0].d ? joursEntre(pts[0].d, p.d) : null; });
    var variation = variationDroite(pts.map(function (p) { return p.y; }), xs);
    return { sens: variation > REGLES.TENDANCE_PCT ? "hausse" : variation < -REGLES.TENDANCE_PCT ? "baisse" : "stable", variationPct: round1(variation * 100), mode: mode, seances: n,
      du: pts[0].d, au: pts[n - 1].d };
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
    // 0.12.0 REGLE 1 : sans series fournies par l'ecran, la reference est la derniere seance de la MEME plage, de 28 jours au plus.
    // Sinon : { action: "aucune_reference", raison } — aucun chiffre (jamais un conseil tire d'une autre plage ou d'une seance ancienne).
    var fOpt = typeof options.fourchette === "string" ? lireFourchette(options.fourchette) : (options.fourchette || dernier.fourchette || lireFourchette(""));
    if (fOpt.type !== "reps" && fOpt.type !== "serie100") return null; // gainage en secondes, fourchette illisible : jamais de conseil (inchange)
    if (!Array.isArray(options.dernieresSeries)) {
      var rc = referenceConseil(hist, options.fourchette !== undefined && options.fourchette !== null ? options.fourchette : dernier.fourchette, { aujourdhui: options.aujourdhui });
      if (rc.statut !== "ok") return rc.statut === "reference_trop_ancienne" || rc.autresPlages
        ? { action: "aucune_reference", raison: rc.statut, date: rc.date, ageJours: rc.ageJours, fourchette: rc.fourchette } : null;
      dernier = rc.reference;
    }
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
    // 0.11.0 : charge conventionnelle (ex. 1 = poids du corps) : jamais d'increment en kg calcule a partir de cette valeur.
    var conv = marquerConventionnelles(valides, options.exercice).every(function (s) { return !!s.conventionnelle; });
    if (maxR <= 15) { // perimetre V1 du diagnostic dans le conseil (fourchette haute <= 15)
      var diag = (hist.length >= 2) ? diagnostiquer(hist, f) : null;
      if (diag && diag.code === "regression") return avec({ action: "reduire_charge", pctMin: 5, pctMax: 10, rirMin: 4, diagnostic: diag.code });
      if (diag && diag.code === "progression_trop_rapide") return avec({ action: "consolider", charge: charge, diagnostic: diag.code });
    }
    if (reps.every(function (r) { return r >= maxR; })) {
      var inc = charge >= REGLES.SEUIL_CHARGE_LOURDE ? REGLES.INCREMENT_LOURD : REGLES.INCREMENT_LEGER;
      if (conv) return avec({ action: "augmenter_charge", charge: charge, chargeConventionnelle: true, increment: null, nouvelleCharge: null, repsCible: minR });
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
      return avec({ action: "ajouter_rep", serie: cible + 1, reps: suivant, charge: charge, chargeConventionnelle: conv || undefined, serieNonFaite: manquantes > 0 && cible >= premierFantome,
        ensuiteCharge: suivant >= maxR && reps.filter(function (r, j) { return j !== cible; }).every(function (r) { return r >= maxR; }) });
    }
    return avec({ action: "maintenir", charge: charge, chargeConventionnelle: conv || undefined, repsMin: minR });
  }

  // ═══════════════════════ 5. DOMAINES (fatigue, recuperation, volume, priorites, morphologie) ═══════════════════════

  // Fatigue ressentie : UN seul calcul, utilise par tous les ecrans.
  // Stockage (inchange) : la fiche hebdomadaire it3_fatigue = { sleep: 0-3, appetite: 0-3, ... }. La fiche par defaut et la
  // remise a zero du lundi ecrivent des 0 : un 0 stocke ne prouve donc PAS une reponse. Depuis la version 0.8.0, chaque reponse
  // donnee est marquee dans fiche._repondu[cle] = date. Lecture d'un critere :
  //   - marque + valeur 0-3            -> repondu (source « saisie ») ;
  //   - sans marque, valeur 1-3        -> repondu (ancienne fiche : seul un clic pouvait produire une valeur non nulle) ;
  //   - sans marque, 0 / vide / autre  -> NON repondu (0 par defaut, impossible a distinguer d'un vrai 0).
  // « repLoss » (perte de reps) n'est plus compte : la performance est mesuree par l'analyse objective des seances.
  // Le bonus RIR de l'onglet Bilan est supprime (RIR non verifies). Aucun niveau ne declenche de baisse de charge ou de volume.
  var FATIGUE_CRITERES = Object.freeze([
    { cle: "sleep", libelle: "Qualité du sommeil", aide: "0 = Excellent · 3 = Très mauvais" },
    { cle: "appetite", libelle: "Appétit", aide: "0 = Normal · 3 = Très diminué" },
    { cle: "motivation", libelle: "Motivation à l'entraînement", aide: "0 = Top · 3 = Aucune envie" },
    { cle: "techDegrades", libelle: "Technique qui se dégrade", aide: "0 = Stable · 3 = Beaucoup" },
    { cle: "heavyFeel", libelle: "Sensation de lourdeur", aide: "0 = Normal · 3 = Très lourd" }
  ].map(function (c) { return Object.freeze(c); }));
  var FATIGUE_NON_COMPTES = Object.freeze(["repLoss"]);
  var NIVEAUX_FATIGUE = Object.freeze(["bas", "modere", "eleve", "tres_eleve"]);
  function niveauFatigue(score) {
    var e = REGLES.FATIGUE_SEUILS;
    return score <= e[0] ? "bas" : score <= e[1] ? "modere" : score <= e[2] ? "eleve" : "tres_eleve";
  }
  function lireReponseFatigue(fiche, cle) {
    if (!fiche || typeof fiche !== "object") return null;
    var marques = fiche._repondu && typeof fiche._repondu === "object" ? fiche._repondu : null;
    var marque = !!(marques && Object.prototype.hasOwnProperty.call(marques, cle));
    var brut = fiche[cle];
    if (brut === null || brut === undefined || String(brut).trim() === "" || !/^\s*\d+\s*$/.test(String(brut))) return null;
    var v = parseInt(brut, 10);
    if (v < 0 || v > REGLES.FATIGUE_VALEUR_MAX) return null;
    if (marque) return { valeur: v, source: "saisie" };
    if (v > 0) return { valeur: v, source: "ancienne_fiche" };
    return null;
  }
  function scoreFatigue(fiche) {
    var reponses = {}, sources = {}, manquants = [], somme = 0, n = 0;
    FATIGUE_CRITERES.forEach(function (c) {
      var r = lireReponseFatigue(fiche, c.cle);
      reponses[c.cle] = r ? r.valeur : null; sources[c.cle] = r ? r.source : null;
      if (r) { somme += r.valeur; n++; } else manquants.push(c.cle);
    });
    var total = FATIGUE_CRITERES.length, statut = n === 0 ? "non_renseigne" : n < total ? "partiel" : "complet";
    var niveau = statut === "complet" ? niveauFatigue(somme) : null;
    // Questionnaire partiel : les reponses manquantes ne peuvent qu'augmenter le score -> le niveau atteint est un minimum certain.
    var niveauMinimum = statut === "non_renseigne" ? null : niveauFatigue(somme);
    return {
      statut: statut, score: n === 0 ? null : somme, max: total * REGLES.FATIGUE_VALEUR_MAX,
      repondus: n, total: total, manquants: manquants, niveau: niveau, niveauMinimum: niveauMinimum,
      fatigueElevee: niveauMinimum === "eleve" || niveauMinimum === "tres_eleve",
      reponses: reponses, sources: sources, nonComptes: FATIGUE_NON_COMPTES.slice(),
      bonusRir: 0, adaptationAutomatique: false
    };
  }
  // Nouvelle fiche apres une reponse (la fiche recue n'est jamais modifiee) : valeur + marque datee. Les autres champs
  // (dont l'ancien repLoss) sont conserves tels quels.
  function repondreFatigue(fiche, cle, valeur, date) {
    var v = parseInt(valeur, 10);
    if (!FATIGUE_CRITERES.some(function (c) { return c.cle === cle; })) throw new Error("critere fatigue inconnu : " + cle);
    if (isNaN(v) || v < 0 || v > REGLES.FATIGUE_VALEUR_MAX) throw new Error("valeur fatigue invalide : " + valeur);
    var src = fiche && typeof fiche === "object" ? fiche : {}, out = {};
    Object.keys(src).forEach(function (k) { out[k] = src[k]; });
    var marques = {}, ancien = src._repondu && typeof src._repondu === "object" ? src._repondu : {};
    Object.keys(ancien).forEach(function (k) { marques[k] = ancien[k]; });
    marques[cle] = date || null; out[cle] = v; out._repondu = marques;
    return out;
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

  // Volume musculaire sur [aujourdhui - jours + 1 ; aujourdhui] : series valides par muscle, dont series « dures » (RIR connu <= 4)
  // et series au RIR saisi. Depuis 0.10.0 : AUCUN coefficient. Le muscle principal compte dans series / seriesDures / seriesRirSaisi ;
  // un muscle secondaire compte a part, en nombres entiers, dans .indirect (jamais additionne au direct). Exercices non classes a part.
  function volume(seancesNorm, aujourdhui, jours, options) {
    var parMuscle = {}, nonClasses = {};
    var muscle = function (m) { return parMuscle[m] = parMuscle[m] || { series: 0, seriesDures: 0, seriesRirSaisi: 0, indirect: { series: 0, seriesDures: 0, seriesRirSaisi: 0 } }; };
    var add = function (m, k, v) { muscle(m)[k] += v; }, addIndirect = function (m, k, v) { muscle(m).indirect[k] += v; };
    seancesNorm.forEach(function (s) {
      if (!s.date) return; var d = joursEntre(s.date, aujourdhui); if (d < 0 || d >= jours) return;
      s.exercices.forEach(function (e) {
        var v = e.series.filter(function (st) { return st.valide; }); if (!v.length) return;
        var c = classerExercice(e.nom, options);
        if (!c.principal) { nonClasses[e.nom] = (nonClasses[e.nom] || 0) + v.length; return; }
        var dures = v.filter(function (st) { return st.rir !== null && st.rir <= REGLES.RIR_DUR_MAX; }).length, saisis = v.filter(function (st) { return st.statutRir === "saisi"; }).length;
        add(c.principal, "series", v.length); add(c.principal, "seriesDures", dures); add(c.principal, "seriesRirSaisi", saisis);
        c.secondaires.forEach(function (m) { addIndirect(m, "series", v.length); addIndirect(m, "seriesDures", dures); addIndirect(m, "seriesRirSaisi", saisis); });
      });
    });
    return { jours: jours, parMuscle: parMuscle, nonClasses: nonClasses };
  }

  // Heure d'enregistrement d'une seance. L'id d'une seance = Date.now() au moment du bouton « Terminer » (fin de seance), en
  // millisecondes UTC ; l'affichage la convertit en heure locale de l'appareil. Elle n'est retenue que si l'id est un horodatage
  // plausible ET que son jour (local ou UTC, car la date de seance est ecrite en UTC) = la date de la seance. Sinon : heure inconnue
  // (ex. id refait lors d'un import ou d'une reparation), jamais une heure fabriquee (pas de « minuit » fictif).
  var HORODATAGE_MIN = Date.UTC(2020, 0, 1);
  function heureSeance(s, maintenantMs) {
    var brut = s ? s.id : null;
    var id = typeof brut === "number" ? brut : (typeof brut === "string" && /^\d{12,14}$/.test(brut) ? Number(brut) : NaN);
    if (!isFinite(id) || id < HORODATAGE_MIN || (isFinite(maintenantMs) && id > maintenantMs + 3600000)) return { ms: null, fiable: false, raison: "id_non_horodatage" };
    var jour = s && s.date, x = new Date(id);
    if (!jour) return { ms: null, fiable: false, raison: "date_absente" };
    if (jour !== dateLocale(x) && jour !== x.toISOString().slice(0, 10)) return { ms: null, fiable: false, raison: "jour_different" };
    return { ms: id, fiable: true, raison: null };
  }

  // Derniere sollicitation de chaque groupe musculaire (principal OU secondaire), avec l'heure reelle quand elle est fiable.
  // Information DESCRIPTIVE uniquement : aucune conclusion « recupere / insuffisant » n'est produite (conclusion: null).
  // Un exercice non classe n'est rattache a aucun groupe : il est liste a part (« classification a definir ») et ne modifie aucun autre groupe.
  // options.exercices (facultatif) : ne garder que les groupes sollicites par ces exercices (ex. les exercices de la seance qui demarre).
  function dernieresSollicitations(seancesNorm, maintenantMs, options) {
    options = options || {};
    var maintenant = isFinite(maintenantMs) ? maintenantMs : Date.now(), aujourdhui = dateLocale(new Date(maintenant));
    var groupes = {}, nonClasses = {};
    seancesNorm.forEach(function (s) {
      if (!s.date || s.date > aujourdhui) return;
      var h = heureSeance(s, maintenant); if (h.fiable && h.ms > maintenant) return;
      var parMuscle = {};
      s.exercices.forEach(function (e) {
        var n = e.series.filter(function (st) { return st.valide; }).length; if (!n) return;
        var c = classerExercice(e.nom, options);
        if (!c.principal) { nonClasses[e.nom] = { nom: e.nom, derniereDate: s.date, series: n }; return; }
        [[c.principal, "principal"]].concat(c.secondaires.map(function (m) { return [m, "secondaire"]; })).forEach(function (mr) {
          var x = parMuscle[mr[0]] = parMuscle[mr[0]] || { exercices: [], principal: false };
          x.exercices.push({ nom: e.nom, role: mr[1], series: n }); if (mr[1] === "principal") x.principal = true;
        });
      });
      Object.keys(parMuscle).forEach(function (m) {
        var evt = { date: s.date, heureMs: h.ms, heureFiable: h.fiable, raisonHeure: h.raison, seanceId: s.id, routine: s.routine, exercices: parMuscle[m].exercices,
          role: parMuscle[m].principal ? "principal" : "secondaire" };
        var g = groupes[m] = groupes[m] || { muscle: m, derniere: null, dernierePrincipale: null };
        g.derniere = evt; if (evt.role === "principal") g.dernierePrincipale = evt;   // seances deja triees : la derniere ecrase
      });
    });
    var ecart = function (evt) { if (!evt) return null; return { heures: evt.heureFiable ? Math.floor((maintenant - evt.heureMs) / 3600000) : null,
      minutes: evt.heureFiable ? Math.floor((maintenant - evt.heureMs) / 60000) : null, jours: joursEntre(evt.date, aujourdhui) }; };
    var filtre = null;
    if (Array.isArray(options.exercices)) { filtre = {}; options.exercices.forEach(function (nom) { var c = classerExercice(nom, options);
      if (c.principal) [c.principal].concat(c.secondaires).forEach(function (m) { filtre[m] = true; }); }); }
    var out = {};
    GROUPES.forEach(function (m) {
      if (filtre && !filtre[m]) return;
      var g = groupes[m];
      out[m] = { muscle: m, derniere: g ? g.derniere : null, ecoule: g ? ecart(g.derniere) : null,
        dernierePrincipale: g ? g.dernierePrincipale : null, ecoulePrincipale: g ? ecart(g.dernierePrincipale) : null, conclusion: null };
    });
    var inconnusSeance = Array.isArray(options.exercices) ? options.exercices.filter(function (nom) { return !classerExercice(nom, options).principal; }) : [];
    return { maintenant: maintenant, aujourdhui: aujourdhui, groupes: out, nonClasses: Object.keys(nonClasses).map(function (k) { return nonClasses[k]; }),
      exercicesAClasser: inconnusSeance, conclusion: null };
  }

  // ═══════════════════════ 5 bis. VOLUME ET PERFORMANCES PAR MUSCLE (etape 3, lecture seule) ═══════════════════════
  // Trois fonctions de CONSTAT : aucune ne modifie les donnees, les routines ou le programme, aucune ne produit d'action
  // (actions: [], adaptationAutomatique: false). Seuils : REGLES (R-V, R-P, R-D de la specification de l'etape 3).
  //   serie effectuee  : enregistree, non marquee « non faite » (done:false), reps > 0 (ou duree > 0). Comptee meme si sa charge
  //                      est suspecte : elle a ete faite. -> VOLUME
  //   serie analysable : serie valide non suspecte (filtrerSuspectes). -> PERFORMANCE (via analyseExercice)
  //   direct / indirect: muscle principal / muscle secondaire de l'exercice. Deux compteurs separes, jamais additionnes, sans coefficient.
  function ajouterJours(d, n) { var p = d.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  // Date de fin de fenetre (J) : options.fin, sinon options.maintenant, sinon la date du jour (meme lecture d'horloge que analyser()).
  function dateFin(options) { return options && options.fin !== undefined ? dateLocale(options.fin) : options && options.maintenant !== undefined ? dateLocale(options.maintenant) : jourParDefaut(); }
  function serieEffectuee(st) { return !!st && st.fait !== false && st.reps !== null && st.reps > 0; }
  function datesSeances(seancesNorm, au) {
    var d = {}; seancesNorm.forEach(function (s) { if (s.date && s.date <= au && s.exercices.some(function (e) { return e.series.some(serieEffectuee); })) d[s.date] = true; });
    return Object.keys(d).sort();
  }
  // Pauses dans [du ; au] : ecart >= PAUSE_JOURS entre deux seances (jours sans seance entre les deux), pause en cours jusqu'a « au »,
  // et jours avant la toute premiere seance. Semaines actives = (jours de la fenetre - jours de pause) / 7.
  function fenetre(dates, du, au) {
    var jours = joursEntre(du, au) + 1, pauses = [];
    var ajoute = function (a, b, type) { // jours a..b inclus, coupes a la fenetre
      if (b < du || a > au) return; var x = a < du ? du : a, y = b > au ? au : b; var n = joursEntre(x, y) + 1; if (n > 0) pauses.push({ du: x, au: y, jours: n, type: type }); };
    if (!dates.length) ajoute(du, au, "aucune_seance");
    else {
      if (dates[0] > du) ajoute(du, ajouterJours(dates[0], -1), "avant_historique");
      for (var i = 1; i < dates.length; i++) if (joursEntre(dates[i - 1], dates[i]) >= REGLES.PAUSE_JOURS) ajoute(ajouterJours(dates[i - 1], 1), ajouterJours(dates[i], -1), "pause");
      var der = dates[dates.length - 1]; if (joursEntre(der, au) >= REGLES.PAUSE_JOURS) ajoute(ajouterJours(der, 1), au, "pause_en_cours");
    }
    var jp = pauses.reduce(function (a, p) { return a + p.jours; }, 0);
    return { du: du, au: au, jours: jours, pauses: pauses, joursPause: jp, joursActifs: jours - jp, semainesCalendaires: round1(jours / 7), semainesActives: round1((jours - jp) / 7),
      suffisante: (jours - jp) / 7 >= REGLES.SEMAINES_ACTIVES_MIN };
  }
  function parSemaine(n, semaines) { return semaines > 0 ? round1(n / semaines) : null; }

  // Comptage brut des series effectuees par muscle sur [du ; au].
  function compterVolume(seancesNorm, du, au, options) {
    var muscles = {}, nonClasses = {};
    var role = function (m, r) { var x = muscles[m] = muscles[m] || { direct: { series: 0, jours: {}, exercices: {}, rirSaisi: 0, efficaces: 0 }, indirect: { series: 0, jours: {}, exercices: {} } }; return x[r]; };
    seancesNorm.forEach(function (s) {
      if (!s.date || s.date < du || s.date > au) return;
      s.exercices.forEach(function (e) {
        var faites = e.series.filter(serieEffectuee); if (!faites.length) return;
        var c = classerExercice(e.nom, options);
        if (!c.principal) { nonClasses[e.nom] = (nonClasses[e.nom] || 0) + faites.length; return; }
        var d = role(c.principal, "direct"); d.series += faites.length; d.jours[s.date] = true; d.exercices[e.nom] = (d.exercices[e.nom] || 0) + faites.length;
        faites.forEach(function (st) { if (st.statutRir === "saisi") { d.rirSaisi++; if (st.rir !== null && st.rir <= REGLES.EFFICACE_RIR_MAX) d.efficaces++; } });
        c.secondaires.forEach(function (m) { var x = role(m, "indirect"); x.series += faites.length; x.jours[s.date] = true; x.exercices[e.nom] = (x.exercices[e.nom] || 0) + faites.length; });
      });
    });
    return { muscles: muscles, nonClasses: nonClasses };
  }
  var listeExercices = function (o) { return Object.keys(o).sort().map(function (n) { return { nom: n, series: o[n] }; }); };

  // VOLUME PAR MUSCLE sur 28 jours glissants (R-V1 a R-V6).
  // options : { fin (date du jour, defaut maintenant), jours (defaut 28), normaliserNom, classements }
  function volumeMuscles(seancesNorm, options) {
    options = options || {}; seancesNorm = seancesNorm || [];
    var n = int(options.jours) || REGLES.FENETRE_JOURS, au = dateFin(options), du = ajouterJours(au, -(n - 1));
    var auAvant = ajouterJours(du, -1), duAvant = ajouterJours(auAvant, -(n - 1));
    var dates = datesSeances(seancesNorm, au), fen = fenetre(dates, du, au), fenAvant = fenetre(dates.filter(function (d) { return d <= auAvant; }), duAvant, auAvant);
    var cour = compterVolume(seancesNorm, du, au, options), avant = compterVolume(seancesNorm, duAvant, auAvant, options);
    var resumeRole = function (r) {
      var nj = r ? Object.keys(r.jours).length : 0, ns = r ? r.series : 0;
      return { series: ns, parSemaineCalendaire: parSemaine(ns, n / 7), parSemaineActive: parSemaine(ns, fen.joursActifs / 7),
        jours: nj, frequenceCalendaire: parSemaine(nj, n / 7), frequenceActive: parSemaine(nj, fen.joursActifs / 7), exercices: r ? listeExercices(r.exercices) : [] };
    };
    var muscles = {};
    GROUPES.forEach(function (m) {
      var c = cour.muscles[m] || null, a = avant.muscles[m] || null, d = c ? c.direct : null;
      var direct = resumeRole(d), indirect = resumeRole(c ? c.indirect : null);
      // R-V6 : series efficaces seulement si les RIR sont reellement saisis (>= 50 % et >= 8 series).
      var saisis = d ? d.rirSaisi : 0, mesurable = direct.series > 0 && saisis >= REGLES.EFFICACE_MIN_SERIES && saisis / direct.series >= REGLES.EFFICACE_PART_SAISIE;
      var efficaces = { statut: mesurable ? "mesure" : "non_mesurable", raison: mesurable ? null : "rir_non_saisis", valeur: mesurable ? d.efficaces : null,
        seriesRirSaisi: saisis, series: direct.series, partRirSaisi: direct.series ? round1(saisis / direct.series * 100) : null };
      // R-V4 : evolution du volume direct contre les 28 jours precedents.
      var evolution;
      var exAvant = a ? Object.keys(a.direct.exercices).sort() : [], exApres = d ? Object.keys(d.exercices).sort() : [];
      if (!fen.suffisante || !fenAvant.suffisante) evolution = { statut: "non_calculable", raison: "semaines_actives_insuffisantes", avant: null, apres: null };
      else {
        var av = parSemaine(a ? a.direct.series : 0, fenAvant.joursActifs / 7), ap = direct.parSemaineActive, ecart = round1(ap - av), pct = av > 0 ? round1((ap - av) / av * 100) : null;
        var signale = Math.abs(ap - av) >= REGLES.VOLUME_EVOLUTION_SERIES && (av === 0 ? ap > 0 : Math.abs(ap - av) / av >= REGLES.VOLUME_EVOLUTION_PCT);
        var programme = exAvant.join("|") !== exApres.join("|");
        evolution = { statut: !signale ? "non_signale" : programme ? "volume_modifie_par_le_programme" : ap > av ? "hausse" : "baisse",
          avant: av, apres: ap, ecart: ecart, ecartPct: pct,
          exercicesAjoutes: exApres.filter(function (x) { return exAvant.indexOf(x) === -1; }), exercicesRetires: exAvant.filter(function (x) { return exApres.indexOf(x) === -1; }) };
      }
      muscles[m] = { muscle: m, statut: !fen.suffisante ? "donnees_insuffisantes" : direct.series || indirect.series ? "ok" : "aucune_serie",
        direct: direct, indirect: indirect, efficaces: efficaces, evolution: evolution };
    });
    return { periode: { du: du, au: au, jours: n }, fenetre: fen, precedente: { du: duAvant, au: auAvant, semainesActives: fenAvant.semainesActives, pauses: fenAvant.pauses },
      statut: fen.suffisante ? "ok" : "donnees_insuffisantes", muscles: muscles,
      nonClasses: Object.keys(cour.nonClasses).sort().map(function (k) { return { nom: k, series: cour.nonClasses[k], classification: "a_definir" }; }),
      actions: [], adaptationAutomatique: false };
  }

  // COMPARAISONS de toutes les seances d'exercices dans [du ; au], avec analyseExercice (R-P1) et le classement de la specification :
  //   fiables : "progression" | "stable" | "regression" ;
  //   non interpretees : "premiere" | "charge_suspecte" (R-P2) | "non_comparable" | "retour_pause" (R-P4) | "seance_incomplete" (R-P3).
  var NON_INTERPRETEES = Object.freeze(["premiere", "charge_suspecte", "non_comparable", "retour_pause", "seance_incomplete"]);
  var FIABLES = Object.freeze(["progression", "stable", "regression"]);
  function comparaisonsPeriode(seancesNorm, du, au, options) {
    var seances = seancesNorm.filter(function (s) { return s.date && s.date <= au; });
    var dates = datesSeances(seances, au), pauses = [];
    for (var i = 1; i < dates.length; i++) if (joursEntre(dates[i - 1], dates[i]) >= REGLES.PAUSE_JOURS) pauses.push([dates[i - 1], dates[i]]);
    var noms = []; seances.forEach(function (s) { s.exercices.forEach(function (e) { if (noms.indexOf(e.nom) === -1) noms.push(e.nom); }); });
    var out = [], parExercice = {};
    noms.forEach(function (nom) {
      var c = classerExercice(nom, options), hist = historiqueExercice(seances, nom);
      parExercice[nom] = { nom: nom, muscle: c.principal, secondaires: c.secondaires, historique: hist };
      hist.forEach(function (h, i) {
        if (h.date < du || h.date > au) return;
        var aSerie = h.series.some(function (st) { return st.valide || st.suspecte; }); if (!aSerie) return; // rien d'enregistre a analyser
        var a = analyseExercice(hist.slice(0, i + 1), { fourchette: h.fourchette }), b = a.bilan || {};
        var raisons = b.comparaison ? b.comparaison.raisons : [], prec = b.precedente ? b.precedente.date : null, res;
        if (a.performance === "premiere") res = "premiere";
        else if (raisons.some(function (r) { return r.code === "charge_suspecte"; })) res = "charge_suspecte";
        else if (a.performance === "non_comparable") res = "non_comparable";
        else if (prec && pauses.some(function (p) { return p[0] >= prec && p[1] <= h.date; })) res = "retour_pause";
        else res = a.performance;
        out.push({ exercice: nom, muscle: c.principal, date: h.date, precedente: prec, resultat: res, fiable: FIABLES.indexOf(res) !== -1, mode: b.mode || modeMesure(h.fourchette),
          raisons: raisons, incomplete: b.incomplete || null, jour: b.jour || null, avant: b.precedente || null });
      });
    });
    out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : x.exercice < y.exercice ? -1 : 1; });
    return { comparaisons: out, exercices: parExercice, dates: dates };
  }
  function compte(cs) {
    var o = { fiables: 0, progression: 0, stable: 0, regression: 0, nonInterpretees: 0, total: cs.length, detailNonInterpretees: {} };
    NON_INTERPRETEES.forEach(function (k) { o.detailNonInterpretees[k] = 0; });
    cs.forEach(function (c) { if (c.fiable) { o.fiables++; o[c.resultat]++; } else { o.nonInterpretees++; o.detailNonInterpretees[c.resultat] = (o.detailNonInterpretees[c.resultat] || 0) + 1; } });
    return o;
  }
  function distinctes(cs, k) { var d = {}; cs.forEach(function (c) { d[c[k]] = true; }); return Object.keys(d).sort(); }
  function resumeComparaison(c) { return { exercice: c.exercice, date: c.date, precedente: c.precedente, resultat: c.resultat }; }

  // Ampleur d'un exercice sur la fenetre (R-P5), dans son dernier bloc comparable.
  function ampleurExercice(hist, du) {
    var bloc = blocComparable(plageDeLaDerniere(hist)).seances.filter(function (h) { return h.date >= du; });
    if (bloc.length < 2) return { statut: "insuffisant", seances: bloc.length };
    var f = bloc[bloc.length - 1].fourchette, mode = modeMesure(f), ms = bloc.map(function (h) { return mesuresSeance(seriesNorm(h.series)); });
    var p = ms[0], d = ms[ms.length - 1], o = { statut: "ok", mode: mode, du: bloc[0].date, au: bloc[bloc.length - 1].date, seances: bloc.length };
    if (mode === "force") {
      o.forceFiable = ms.every(function (m) { return m.forceFiable; });
      o.forceDebut = round1(p.forcePrecise); o.forceFin = round1(d.forcePrecise);
      o.variationPct = o.forceFiable && p.forcePrecise > 0 ? round1((d.forcePrecise - p.forcePrecise) / p.forcePrecise * 100) : null; // jamais de % si la force n'est pas fiable
      return o;
    }
    if (mode !== "reps") return { statut: "non_applicable", mode: mode, seances: bloc.length };
    // Mode repetitions : aucun % de force ni de tonnage. Reps a charge egale + montees de charge.
    var montees = []; for (var i = 1; i < ms.length; i++) if (ms[i].chargeMax > ms[i - 1].chargeMax) montees.push({ date: bloc[i].date, avant: ms[i - 1].chargeMax, apres: ms[i].chargeMax });
    var k = 0; while (k < ms.length - 1 && ms[k].chargeMax !== d.chargeMax) k++;
    o.chargeDebut = p.chargeMax; o.chargeFin = d.chargeMax; o.monteesDeCharge = montees;
    if (uniteEntree(bloc[bloc.length - 1]) === "conventionnelle") o.chargeConventionnelle = true; // charge = valeur conventionnelle, pas des kg
    o.repsAChargeEgale = k < ms.length - 1 ? { charge: d.chargeMax, depuis: bloc[k].date, avant: ms[k].repsAChargeMax, apres: d.repsAChargeMax, ecart: d.repsAChargeMax - ms[k].repsAChargeMax } : null;
    return o;
  }

  // Performance d'un groupe a partir de ses comparaisons (R-P6 a R-P8).
  function evaluerMuscle(cs, fen, blocs) {
    var n = compte(cs), fiables = cs.filter(function (c) { return c.fiable; }), seances = distinctes(fiables, "date");
    var exercicesFiables = distinctes(fiables, "exercice"), blocMax = blocs.reduce(function (m, b) { return Math.max(m, b); }, 0);
    var conditions = { fiables: n.fiables, seances: seances.length, blocMax: blocMax, semainesActives: fen.semainesActives,
      minimum: { fiables: n.fiables >= REGLES.PERF_MIN_FIABLES, seances: seances.length >= REGLES.PERF_MIN_SEANCES, bloc: blocMax >= REGLES.PERF_MIN_BLOC, fenetre: fen.suffisante } };
    var ok = conditions.minimum.fiables && conditions.minimum.seances && conditions.minimum.bloc && conditions.minimum.fenetre;
    if (!ok) return { statut: "donnees_insuffisantes", tendance: null, confiance: null, compte: n, conditions: conditions,
      raison: n.detailNonInterpretees.charge_suspecte > 0 && n.fiables < REGLES.PERF_MIN_FIABLES ? "charge_non_fiable" : !fen.suffisante ? "semaines_actives_insuffisantes" : "minimum_non_atteint" };
    var P = n.progression, B = n.regression, F = n.fiables, seancesB = distinctes(fiables.filter(function (c) { return c.resultat === "regression"; }), "date").length;
    var tendance = P / F >= REGLES.TENDANCE_HAUSSE_PCT && B / F <= REGLES.TENDANCE_HAUSSE_BAISSE_MAX ? "hausse"
      : B >= REGLES.TENDANCE_BAISSE_MIN && seancesB >= 2 && B >= P ? "baisse"
      : B === 0 && P / F < REGLES.TENDANCE_HAUSSE_PCT ? "stable" : "mixte";
    var partNI = n.total ? n.nonInterpretees / n.total : 0;
    var haute = F >= REGLES.CONFIANCE_FIABLES && exercicesFiables.length >= REGLES.CONFIANCE_EXERCICES && seances.length >= REGLES.CONFIANCE_SEANCES
      && fen.semainesActives >= REGLES.CONFIANCE_SEMAINES && partNI <= REGLES.CONFIANCE_NON_INTERPRETEES_MAX;
    conditions.haute = { fiables: F >= REGLES.CONFIANCE_FIABLES, exercices: exercicesFiables.length >= REGLES.CONFIANCE_EXERCICES, seances: seances.length >= REGLES.CONFIANCE_SEANCES,
      semainesActives: fen.semainesActives >= REGLES.CONFIANCE_SEMAINES, nonInterpretees: partNI <= REGLES.CONFIANCE_NON_INTERPRETEES_MAX };
    return { statut: "ok", tendance: tendance, confiance: haute ? "haute" : "moyenne", compte: n, conditions: conditions, raison: null,
      partPct: { progression: round1(P / F * 100), stable: round1(n.stable / F * 100), regression: round1(B / F * 100), nonInterpretees: round1(partNI * 100) } };
  }

  // PERFORMANCES PAR MUSCLE sur 28 jours (R-P1 a R-P8). Seuls les exercices dont le muscle est le PRINCIPAL comptent.
  // Chaque resultat liste les comparaisons qui le justifient (exercice, date, resultat) et son niveau de confiance.
  function performanceMuscles(seancesNorm, options) {
    options = options || {}; seancesNorm = seancesNorm || [];
    var n = int(options.jours) || REGLES.FENETRE_JOURS, au = dateFin(options), du = ajouterJours(au, -(n - 1));
    var cp = comparaisonsPeriode(seancesNorm, du, au, options), fen = fenetre(cp.dates, du, au);
    var vol = compterVolume(seancesNorm, du, au, options), muscles = {};
    GROUPES.forEach(function (m) {
      var cs = cp.comparaisons.filter(function (c) { return c.muscle === m; });
      var exos = Object.keys(cp.exercices).filter(function (k) { return cp.exercices[k].muscle === m && cs.some(function (c) { return c.exercice === k; }); }).sort();
      if (!cs.length) {
        var v = vol.muscles[m];
        muscles[m] = { muscle: m, statut: v && v.indirect.series > 0 ? "secondaire_seulement" : "aucune_donnee", tendance: null, confiance: null, comparaisons: [], exercices: [],
          raison: v && v.indirect.series > 0 ? "sollicite_seulement_en_secondaire" : "aucune_serie" };
        return;
      }
      var blocs = exos.map(function (k) { return blocComparable(plageDeLaDerniere(cp.exercices[k].historique)).seances.length; });
      var ev = evaluerMuscle(cs, fen, blocs);
      muscles[m] = { muscle: m, statut: ev.statut, tendance: ev.tendance, confiance: ev.confiance, raison: ev.raison, compte: ev.compte, partPct: ev.partPct || null, conditions: ev.conditions,
        exercices: exos.map(function (k, i) { var ce = cs.filter(function (c) { return c.exercice === k; });
          return { nom: k, comparaisons: ce.length, fiables: ce.filter(function (c) { return c.fiable; }).length, blocSeances: blocs[i], ampleur: ampleurExercice(cp.exercices[k].historique, du) }; }),
        comparaisons: cs.map(resumeComparaison) };
    });
    var nonClasses = Object.keys(cp.exercices).filter(function (k) { return !cp.exercices[k].muscle && cp.comparaisons.some(function (c) { return c.exercice === k; }); }).sort();
    return { periode: { du: du, au: au, jours: n }, fenetre: fen, muscles: muscles, nonClasses: nonClasses, actions: [], adaptationAutomatique: false };
  }

  // BILAN D'ENTRAINEMENT sur 14 jours (R-D1 a R-D5) : CONSTATS seulement, jamais de decision ni d'action.
  // Chaque constat : { type, muscles, periode, comparaisons:[{exercice, date, precedente, resultat}], confiance, raisons }.
  function bilanEntrainement(seancesNorm, options) {
    options = options || {}; seancesNorm = seancesNorm || [];
    var n = int(options.jours) || REGLES.FENETRE_COURTE_JOURS, au = dateFin(options), du = ajouterJours(au, -(n - 1)), periode = { du: du, au: au, jours: n };
    var cp = comparaisonsPeriode(seancesNorm, du, au, options), cs = cp.comparaisons.filter(function (c) { return c.muscle; });
    var fiables = cs.filter(function (c) { return c.fiable; }), baisses = fiables.filter(function (c) { return c.resultat === "regression"; });
    var tot = compte(cs), constats = [], perf = null;
    var perfMuscles = function () { return perf = perf || performanceMuscles(seancesNorm, { fin: au, normaliserNom: options.normaliserNom, classements: options.classements }); };
    var musclesB = distinctes(baisses, "muscle"), seancesB = distinctes(baisses, "date"), retours = cs.filter(function (c) { return c.resultat === "retour_pause"; }).length;
    var partB = fiables.length ? baisses.length / fiables.length : 0;
    // R-D1 : baisse generale.
    if (fiables.length >= REGLES.GENERALE_FIABLES && partB >= REGLES.GENERALE_BAISSE_PCT && musclesB.length >= REGLES.GENERALE_MUSCLES && seancesB.length >= REGLES.GENERALE_SEANCES) {
      constats.push({ type: "baisse_generale", muscles: musclesB, periode: periode, comparaisons: fiables.map(resumeComparaison),
        confiance: fiables.length >= REGLES.GENERALE_HAUTE_FIABLES && retours === 0 ? "haute" : "moyenne",
        raisons: [{ code: "baisses", valeur: baisses.length, sur: fiables.length, pct: round1(partB * 100) }, { code: "muscles", valeur: musclesB.length }, { code: "seances", valeur: seancesB.length }, { code: "retours_de_pause", valeur: retours }] });
    } else {
      var couverts = {};
      GROUPES.forEach(function (m) {
        var fm = fiables.filter(function (c) { return c.muscle === m; }), bm = fm.filter(function (c) { return c.resultat === "regression"; });
        if (bm.length < REGLES.LOCALE_BAISSES || distinctes(bm, "date").length < 2 || bm.length < fm.filter(function (c) { return c.resultat === "progression"; }).length) return;
        var autres = fiables.filter(function (c) { return c.muscle !== m; }), bAutres = autres.filter(function (c) { return c.resultat === "regression"; }).length;
        var partAutres = autres.length ? bAutres / autres.length : 0;
        bm.forEach(function (c) { couverts[c.exercice + "|" + c.date] = true; });
        var raisons = [{ code: "baisses_muscle", valeur: bm.length, sur: fm.length, seances: distinctes(bm, "date").length }, { code: "baisses_autres_muscles", valeur: bAutres, sur: autres.length, pct: round1(partAutres * 100) }];
        // R-D2 : baisse localisee ; R-D3 : baisse etendue a surveiller (les autres muscles baissent aussi, sans atteindre R-D1).
        if (partAutres < REGLES.LOCALE_AUTRES_MAX) { var pm = perfMuscles().muscles[m];
          constats.push({ type: "baisse_localisee", muscles: [m], periode: periode, comparaisons: fm.map(resumeComparaison), confiance: pm && pm.confiance ? pm.confiance : "basse", raisons: raisons }); }
        else constats.push({ type: "baisse_etendue_a_surveiller", muscles: [m], periode: periode, comparaisons: fiables.map(resumeComparaison), confiance: "basse", raisons: raisons });
      });
      // R-D4 : seance isolee (>= 2 baisses, aucune autre baisse sur ces exercices dans la periode).
      seancesB.forEach(function (d) {
        var bd = baisses.filter(function (c) { return c.date === d && !couverts[c.exercice + "|" + c.date]; }); if (bd.length < REGLES.ISOLEE_BAISSES) return;
        var exos = distinctes(bd, "exercice");
        if (baisses.some(function (c) { return c.date !== d && exos.indexOf(c.exercice) !== -1; })) return;
        constats.push({ type: "seance_isolee", muscles: distinctes(bd, "muscle"), periode: { du: d, au: d, jours: 1 }, comparaisons: bd.map(resumeComparaison), confiance: "basse",
          raisons: [{ code: "baisses_seance", valeur: bd.length }, { code: "aucune_autre_baisse_sur_ces_exercices" }] });
      });
    }
    // R-D5 : rien a signaler.
    if (!constats.length) constats.push({ type: "rien_a_signaler", muscles: [], periode: periode, comparaisons: [], confiance: null,
      raisons: [{ code: "baisses", valeur: baisses.length, sur: fiables.length }] });
    return { periode: periode, compte: tot, comparaisons: cs.map(resumeComparaison), constats: constats, actions: [], adaptationAutomatique: false };
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
    var aujourdhui = options.maintenant !== undefined ? dateLocale(options.maintenant) : jourParDefaut();
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
        derniereMesure: mesuresSeance(dern.series), diagnostic: diagnostiquer(historiqueMemePlage(h, dern.fourchette), dern.fourchette), tendance: tendance(h, dern.fourchette),
        conseil: conseilProgression(h, { seriesPrevues: seriesPrevues[n], fourchette: dern.fourchette, aujourdhui: aujourdhui })
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
    CHARGES_CONVENTIONNELLES: CHARGES_CONVENTIONNELLES, chargeConventionnelle: chargeConventionnelle, uniteEntree: uniteEntree,
    lireRir: lireRir, statutRir: statutRir, lireFourchette: lireFourchette, dateSeance: dateSeance, dateLocale: dateLocale, joursEntre: joursEntre,
    trierSeances: trierSeances, normaliserSerie: normaliserSerie, normaliserSeances: normaliserSeances, historiqueExercice: historiqueExercice,
    // 2. mesures
    e1RM: e1RM, forceSerie: forceSerie, mesuresSeance: mesuresSeance,
    // 3. catalogue
    classerExercice: classerExercice,
    // 0.12.0 comparaison dans la meme plage
    memePlage: memePlage, historiqueMemePlage: historiqueMemePlage, referenceConseil: referenceConseil,
    // 4. diagnostics
    modeMesure: modeMesure, axesProgression: axesProgression, comparer: comparer, natureProgression: natureProgression, diagnostiquer: diagnostiquer, tendance: tendance, conseilProgression: conseilProgression,
    bilanExercice: bilanExercice, recordsExercice: recordsExercice,
    volumeEntre: volumeEntre, meilleureSerieEntre: meilleureSerieEntre, tendanceGenerale: tendanceGenerale, TENDANCES: TENDANCES,
    syntheseExercice: syntheseExercice, pistesAdaptation: pistesAdaptation, comparabilite: comparabilite, blocComparable: blocComparable, analyseExercice: analyseExercice, filtrerSuspectes: filtrerSuspectes,
    // 5. domaines
    FATIGUE_CRITERES: FATIGUE_CRITERES, NIVEAUX_FATIGUE: NIVEAUX_FATIGUE, scoreFatigue: scoreFatigue, repondreFatigue: repondreFatigue, heureSeance: heureSeance, dernieresSollicitations: dernieresSollicitations, rirRecent: rirRecent, recuperation: recuperation, volume: volume, priorites: priorites, morphologie: morphologie,
    // 5 bis. volume et performances par muscle (etape 3, constats seulement)
    volumeMuscles: volumeMuscles, performanceMuscles: performanceMuscles, bilanEntrainement: bilanEntrainement,
    // 6. analyse complete
    analyser: analyser
  });
});
