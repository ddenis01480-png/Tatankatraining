# Règle d'architecture n°1 — les données de l'utilisateur

> **Ma donnée reste ma donnée. Un import ajoute. Seul l'utilisateur décide de supprimer ou remplacer.**

Cette règle vaut pour tout le code de Tatanka Training, y compris les futurs développements
(Coach V2, bêta, Tatanka Morphologie → Training, toute source externe).

## Ce qu'elle impose

1. **Aucune donnée existante n'est jamais écrasée ou supprimée automatiquement** : programmes, routines, exercices,
   séances, historique, performances, mensurations. Un changement de version, une migration, une initialisation,
   une synchronisation ou un import ne sont pas des décisions de l'utilisateur.
2. **Un import ajoute.** Il ne remplace rien.
   - Doublon identique (même contenu) → ignoré.
   - Conflit d'identifiant (même id, contenu différent) → l'existant reste, l'entrée importée reçoit un **nouvel identifiant**.
   - Routine de même nom mais différente → ajoutée avec le suffixe « (import) ». Les routines existantes ne bougent pas.
   - État courant (fatigue, cycle) → renseigné seulement s'il est absent.
3. **Seul l'utilisateur supprime ou remplace**, par une action explicite et nommée (supprimer une routine, « Réparer l'app »…).
4. **Avant toute opération qui devrait écraser quelque chose d'inévitablement corrompu**, une copie de sécurité du contenu
   d'origine est conservée (`it3_routines_backup_<date>`).
5. **Le programme par défaut** n'est créé que si le compte n'a **aucune routine exploitable**. Le numéro de version
   (`it3_prog_version`) ne déclenche jamais un remplacement.

## Comment l'appliquer

- Toute source d'import passe par `applyImport()` / `mergeSessionsNonDestructive()` / `mergeRoutinesNonDestructive()` /
  `mergeSuppsNonDestructive()` (`index.html`, bloc « Règle d'architecture »). Ne pas écrire un nouveau chemin d'import à côté.
- Une nouvelle source (ex. Tatanka Morphologie) doit **proposer ou ajouter** son programme, sans toucher à l'existant,
  et laisser l'utilisateur décider de le garder, le supprimer ou le remplacer.
- Tout nouveau code qui écrit des données utilisateur doit être couvert par un test « avant/après » sur un compte existant
  (voir `tests/data-safety.test.js`).

## Tests de référence

`node tests/data-safety.test.js` — compte existant (6 routines, 108 séances) strictement intact avec une version normale,
absente, `imported-…` ou ancienne ; imports par ajout ; propriétés sur 600 cas aléatoires.
