-- 005 — A executer manuellement (SQL Editor) : met le compte de David en canal "lab".
-- Les beta-testeurs restent en canal "stable" (defaut) ; seule la cohorte les distingue.
update public.profiles set coach_channel = 'lab', cohort = 'lab' where id = '00e6db68-34dd-4f97-afea-1a91eef02886';
-- Exemple pour un beta-testeur (reste sur Coach V1) :
-- update public.profiles set cohort = 'beta' where email = 'testeur@exemple.fr';
