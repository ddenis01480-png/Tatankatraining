-- 002 — Protection des champs sensibles de profiles contre les ecritures venant du navigateur.
-- A executer APRES 001. Ne protege PAS premium_training / premium_nutrition / premium_progress / pack :
-- les 3 apps les ecrivent encore depuis le navigateur (retour Stripe ?payment=success). Les bloquer
-- maintenant casserait l'activation Premium. Ils seront proteges a l'etape finale (voir le resume).
create or replace function public.profiles_guard_sensitive() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Seuls les appels d'un utilisateur final (PostgREST : roles anon / authenticated) sont controles.
  -- Le serveur (service_role), le dashboard (postgres) et les fonctions SECURITY DEFINER passent.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.premium := false;  new.promo := false;  new.promo_expires_at := null;
    new.lifetime := false; new.blocked := false;
    new.plan := 'free';    new.coach_channel := 'stable'; new.cohort := null;
  else
    new.premium := old.premium;  new.promo := old.promo;  new.promo_expires_at := old.promo_expires_at;
    new.lifetime := old.lifetime; new.blocked := old.blocked;
    new.plan := old.plan;  new.coach_channel := old.coach_channel;  new.cohort := old.cohort;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_sensitive on public.profiles;
create trigger profiles_guard_sensitive before insert or update on public.profiles
  for each row execute function public.profiles_guard_sensitive();
