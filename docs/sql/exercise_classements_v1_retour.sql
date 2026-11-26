-- Retour arriere de exercise_classements_v1 (tatanka-test uniquement). PREPARE, NON EXECUTE.
-- ATTENTION : supprime les choix synchronises et le journal de la base de test. A n'executer qu'avec l'accord explicite de David,
-- apres avoir copie le contenu des deux tables.
drop trigger if exists exercise_classements_garde on public.exercise_classements;
drop function if exists public.archiver_versions_ecartees(jsonb);
drop function if exists public.exercise_classements_garde();
drop table if exists public.exercise_classements_conflits;
drop table if exists public.exercise_classements;
drop function if exists public.secondaires_valides(text, jsonb);
drop function if exists public.groupes_musculaires();
