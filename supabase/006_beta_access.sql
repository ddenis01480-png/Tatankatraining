-- 006 — Bêta fermée : accès individuel de 30 jours, prolongeable à la main, contrôlé par le serveur.
-- Additif et idempotent : ne supprime et ne remplace aucune donnée. Indépendant de 002 et 004 (ne les exige pas, ne les lance pas).
-- A executer dans Supabase > SQL Editor.
--
-- Principe : « bêta active » = beta_expires_at est dans le futur (heure du SERVEUR). Pas de booléen séparé.
-- Seul le serveur / l'administrateur (SQL Editor, service_role) peut écrire ces colonnes ; l'appli ne fait que lire le résultat de get_my_beta().

alter table public.profiles add column if not exists cohort text;
alter table public.profiles add column if not exists beta_started_at timestamptz;
alter table public.profiles add column if not exists beta_expires_at timestamptz;

-- 1) Protection : un utilisateur connecté ne peut jamais modifier ses colonnes bêta (navigateur, console, URL, JavaScript...).
create or replace function public.profiles_guard_beta() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;                                   -- serveur (service_role), dashboard (postgres), fonctions d'administration
  end if;
  if tg_op = 'INSERT' then
    new.beta_started_at := null;  new.beta_expires_at := null;
  else
    new.beta_started_at := old.beta_started_at;  new.beta_expires_at := old.beta_expires_at;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_beta on public.profiles;
create trigger profiles_guard_beta before insert or update on public.profiles
  for each row execute function public.profiles_guard_beta();

-- 2) Ce que l'appli lit : la décision est prise avec l'horloge du serveur (changer l'heure du téléphone ne change rien).
create or replace function public.get_my_beta() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('active', coalesce(p.beta_expires_at > now(), false), 'started_at', p.beta_started_at,
                               'expires_at', p.beta_expires_at, 'server_now', now())
       from public.profiles p where p.id = auth.uid()),
    jsonb_build_object('active', false, 'server_now', now()))
$$;
revoke all on function public.get_my_beta() from public, anon;
grant execute on function public.get_my_beta() to authenticated;

-- 3) Administration (exécutables uniquement par toi dans le SQL Editor, jamais par l'appli).
--    Le compte est retrouvé par l'e-mail d'AUTHENTIFICATION de Supabase, pas par l'e-mail écrit dans le profil.

-- beta_grant('mail')          -> 30 jours à partir de maintenant ; beta_grant('mail', 45) -> 45 jours.
create or replace function public.beta_grant(p_email text, p_days integer default 30) returns text
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid; v_exp timestamptz; v_new timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 3650 then raise exception 'Durée invalide (1 à 3650 jours)'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_id is null then raise exception 'Aucun compte avec cet e-mail : le testeur doit d''abord créer son compte'; end if;
  select p.beta_expires_at into v_exp from public.profiles p where p.id = v_id;
  if not found then raise exception 'Profil introuvable : le testeur doit ouvrir l''appli une première fois (connecté)'; end if;
  if v_exp is not null and v_exp > now() then
    return 'Déjà actif jusqu''au ' || to_char(v_exp at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC : utilise beta_extend pour prolonger';
  end if;
  v_new := now() + make_interval(days => p_days);
  update public.profiles set beta_started_at = now(), beta_expires_at = v_new,
         cohort = case when cohort = 'lab' then cohort else 'beta' end
   where id = v_id;
  return 'Bêta accordée : ' || p_days || ' jours, jusqu''au ' || to_char(v_new at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
end $$;

-- beta_extend('mail', 90)     -> fixe la DURÉE TOTALE à 90 jours depuis le début de la bêta (pas 90 jours de plus).
--                                Ne fonctionne que sur une bêta ACTIVE. Refuse de raccourcir, sauf beta_extend('mail', 10, true).
--                                Une bêta expirée ou révoquée n'est jamais réactivée ici : message -> utilise beta_grant.
create or replace function public.beta_extend(p_email text, p_total_days integer, p_allow_shorter boolean default false) returns text
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid; v_start timestamptz; v_exp timestamptz; v_new timestamptz;
begin
  if p_total_days is null or p_total_days < 1 or p_total_days > 3650 then raise exception 'Durée invalide (1 à 3650 jours)'; end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_id is null then raise exception 'Aucun compte avec cet e-mail'; end if;
  select p.beta_started_at, p.beta_expires_at into v_start, v_exp from public.profiles p where p.id = v_id;
  if not found then raise exception 'Profil introuvable'; end if;
  if v_start is null then raise exception 'Ce compte n''a jamais eu la bêta : utilise beta_grant d''abord'; end if;
  if v_exp is null or v_exp <= now() then
    raise exception 'Bêta expirée ou révoquée : beta_extend ne réactive jamais un accès. Utilise beta_grant pour réattribuer l''accès (30 jours à partir de maintenant)';
  end if;
  v_new := v_start + make_interval(days => p_total_days);
  if v_new <= now() then
    raise exception 'Cette durée serait déjà passée : beta_extend ne coupe pas l''accès. Pour retirer l''accès : beta_revoke';
  end if;
  if v_new < v_exp and not p_allow_shorter then
    raise exception 'Cette durée raccourcirait la bêta (actuellement jusqu''au % UTC). Pour raccourcir volontairement : beta_extend(mail, jours, true)', to_char(v_exp at time zone 'UTC', 'YYYY-MM-DD HH24:MI');
  end if;
  update public.profiles set beta_expires_at = v_new where id = v_id;
  return 'Durée totale : ' || p_total_days || ' jours, jusqu''au ' || to_char(v_new at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
end $$;

-- beta_revoke('mail')         -> retire l'accès tout de suite. Aucune donnée du testeur n'est touchée.
create or replace function public.beta_revoke(p_email text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid; v_exp timestamptz;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_id is null then raise exception 'Aucun compte avec cet e-mail'; end if;
  select p.beta_expires_at into v_exp from public.profiles p where p.id = v_id;
  if not found then raise exception 'Profil introuvable'; end if;
  if v_exp is null or v_exp <= now() then return 'Ce compte n''a pas de bêta active : rien à retirer'; end if;
  update public.profiles set beta_expires_at = now() where id = v_id;
  return 'Bêta retirée : l''accès s''arrête maintenant (données conservées)';
end $$;

revoke all on function public.beta_grant(text, integer) from public, anon, authenticated;
revoke all on function public.beta_extend(text, integer, boolean) from public, anon, authenticated;
revoke all on function public.beta_revoke(text) from public, anon, authenticated;

-- 4) Vue d'administration : select * from beta_testers;   (invisible pour l'appli)
create or replace view public.beta_testers as
select u.email                                   as email,
       p.cohort                                  as cohorte,
       p.beta_started_at                         as debut,
       p.beta_expires_at                         as expiration,
       case when p.beta_expires_at > now()
            then ceil(extract(epoch from (p.beta_expires_at - now())) / 86400)::int else 0 end as jours_restants,
       case when p.beta_expires_at is null then 'jamais'
            when p.beta_expires_at > now() then 'actif' else 'expiré' end                      as statut
  from public.profiles p join auth.users u on u.id = p.id
 where p.beta_started_at is not null or p.beta_expires_at is not null
 order by p.beta_expires_at desc;
revoke all on public.beta_testers from public, anon, authenticated;
