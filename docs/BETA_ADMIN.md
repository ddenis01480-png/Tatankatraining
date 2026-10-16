# Bêta fermée Tatanka Training V1 — administration

> **Ma donnée reste ma donnée. Un import ajoute. Seul l'utilisateur décide de supprimer ou remplacer.**

Principe : un testeur crée son compte normalement (e-mail), puis **tu l'autorises toi-même**. Il n'existe aucun code bêta,
et le QR code ne contient que l'adresse de l'appli : il ne donne aucun droit. L'accès est une date d'expiration stockée
dans Supabase (`profiles.beta_expires_at`), que seul le serveur / toi pouvez écrire.

## Mise en place (une seule fois)
Dans Supabase → **SQL Editor** : exécuter `supabase/006_beta_access.sql`. (Indépendant de 001–005 ; ne lance ni 002 ni 004.)

## Gérer les testeurs (SQL Editor)
Le testeur doit avoir **créé son compte et ouvert l'appli une fois** (connecté).

| Action | Commande |
|---|---|
| Donner 30 jours **à partir de maintenant** | `select beta_grant('testeur@mail.fr');` |
| Donner une autre durée (ex. 45 jours) | `select beta_grant('testeur@mail.fr', 45);` |
| Prolonger une bêta **active** : fixer la durée **totale** à 60 / 90 jours depuis le début | `select beta_extend('testeur@mail.fr', 90);` |
| Raccourcir volontairement une bêta active (la nouvelle date doit rester dans le futur) | `select beta_extend('testeur@mail.fr', 60, true);` |
| Retirer l'accès tout de suite (aucune donnée supprimée) | `select beta_revoke('testeur@mail.fr');` |
| Réattribuer l'accès après expiration ou révocation (30 jours **à partir de maintenant**) | `select beta_grant('testeur@mail.fr');` |
| Voir tous les testeurs | `select * from beta_testers;` |

Règles à retenir :
- `beta_extend` ne marche **que sur une bêta active**. Sur une bêta **expirée ou révoquée**, il refuse et affiche un message te renvoyant vers `beta_grant` : il ne réactive jamais un accès.
- `beta_extend` refuse de **raccourcir** la durée déjà accordée (sauf avec `true`), et ne sert jamais à couper l'accès : pour cela, `beta_revoke`.
- `beta_grant` sur un compte **déjà actif** ne change rien (utilise `beta_extend`). Sur un compte expiré ou révoqué, il repart de maintenant pour 30 jours (ou la durée donnée).
- `beta_revoke` ne supprime ni ne masque aucune donnée du testeur : séances, routines, suppléments, historique et export restent intacts.

`beta_testers` affiche : e-mail, cohorte, début, expiration, **jours restants**, statut (actif / expiré / jamais).
Modifier directement `beta_expires_at` dans Table Editor reste possible pour du dépannage, sans être nécessaire.

## Ce que voit le testeur
- **Pendant la bêta** : toutes les fonctions Premium de Training V1 (limite de séances levée, Progrès, Bilan, records, conseils de progression et de stagnation). Il reste sur le **Coach V1 stable** (jamais V2).
- **À l'expiration** : retour au mode gratuit (limite de 30 séances pour **en enregistrer de nouvelles**). **Aucune donnée n'est supprimée ni masquée** : séances, routines, suppléments, exercices personnalisés, historique restent intacts, et l'export reste possible.
- **Prolongation** : après `beta_extend`, le testeur retrouve l'accès à la prochaine ouverture de l'appli (ou au prochain renouvellement de session, environ une heure).

## Sécurité (résumé)
- Les colonnes bêta sont protégées par un déclencheur : modifier le navigateur, le localStorage, l'URL ou le JavaScript ne les change pas.
- La décision « bêta active ? » est prise par `get_my_beta()` avec **l'horloge du serveur** : changer l'heure du téléphone ne change rien.
- Le compte est identifié par l'e-mail d'**authentification** Supabase, pas par l'e-mail du profil (falsifiable).
- Les fonctions d'administration et la vue ne sont pas appelables par l'appli.
- Si le serveur ne répond pas, l'appli ne donne **pas** la bêta (mode gratuit), sans rien supprimer.

## Programme exemple (facultatif)
Un compte **sans aucune routine** voit une carte « Programme exemple Tatanka » : **Charger** (6 routines marquées EXEMPLE, aucune séance ni
donnée créée) ou **Ignorer**. Un compte qui a déjà des routines ne le voit jamais. Modifier une routine exemple en fait une routine personnelle.
Un bouton unique supprime tout le programme exemple (tes autres routines et toutes tes séances restent intactes).

## Limite connue (hors périmètre de la bêta)
Tant que `002` et le durcissement des paiements ne sont pas faits, `premium_training`, `pack` et `promo` restent modifiables depuis le navigateur
(astuce `?payment=success`). C'est connu et accepté pour 5 à 10 testeurs de confiance ; ne partage pas l'astuce.
