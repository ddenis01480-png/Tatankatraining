-- Migration exercise_classements_v1 (etape 2b-2, architecture validee par David le 26/11/2026)
-- A appliquer UNIQUEMENT sur tatanka-test (syfrtspfsevkbnnaispu). Jamais sur tatanka-nutrition (production).
-- Ne modifie aucune table existante. Retour arriere : docs/sql/exercise_classements_v1_retour.sql (non execute).

-- 1. Liste des 15 groupes (une seule reference) et controle des muscles secondaires
create function public.groupes_musculaires()
returns text[] language sql immutable security invoker set search_path = ''
as $$ select array['Pectoraux','Deltoïde ant.','Deltoïde lat.','Deltoïde post.','Triceps','Dos','Biceps',
  'Trapèzes','Quadriceps','Ischio-jambiers','Fessiers','Adducteurs','Mollets','Abdominaux','Lombaires']::text[] $$;

-- Vrai seulement si : tableau de 14 elements au plus ; chaque element est un texte, fait partie des 15 groupes,
-- est different du muscle principal ; aucun doublon.
create function public.secondaires_valides(p_principal text, p_secondaires jsonb)
returns boolean language sql immutable security invoker set search_path = ''
as $$
  select case when jsonb_typeof(p_secondaires) is distinct from 'array' then false
    else jsonb_array_length(p_secondaires) <= 14
     and not exists (
       select 1 from jsonb_array_elements(p_secondaires) as e(v)
       where jsonb_typeof(e.v) <> 'string'
          or not ((e.v #>> '{}') = any (public.groupes_musculaires()))
          or (e.v #>> '{}') is not distinct from p_principal)
     and (select count(*) from jsonb_array_elements(p_secondaires))
       = (select count(distinct e.v) from jsonb_array_elements(p_secondaires) as e(v))
    end
$$;

-- 2. Table des choix
create table public.exercise_classements (
  user_id     uuid        not null references auth.users(id),
  nom         text        not null check (char_length(nom) between 1 and 200),
  catalogue   boolean     not null default false,
  principal   text,
  secondaires jsonb       not null default '[]'::jsonb,
  modifie_le  timestamptz not null,
  appareil    text        check (char_length(appareil) <= 200),
  recu_le     timestamptz not null default now(),
  primary key (user_id, nom),
  constraint choix_coherent check (coalesce(
    case when catalogue then principal is null and secondaires = '[]'::jsonb
         else principal = any (public.groupes_musculaires())
              and public.secondaires_valides(principal, secondaires)
    end, false))
);

-- 3. Journal unique et durable des versions ecartees
create table public.exercise_classements_conflits (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id),
  nom         text not null,
  origine     text not null check (origine in ('base', 'appareil')),
  raison      text not null check (raison in ('plus_ancienne_ecartee', 'meme_date_contenu_different',
                                              'date_future_ramenee', 'remplacee_par_cloud')),
  gardee      jsonb,
  ecartee     jsonb not null,
  cle_locale  text,
  survenu_le  timestamptz,
  cree_le     timestamptz not null default now(),
  unique (user_id, cle_locale),
  check ((origine = 'appareil') = (cle_locale is not null))
);

-- 4. Declencheur « la plus recente gagne » ; a date egale, la premiere version enregistree reste
create function public.exercise_classements_garde()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.recu_le := now();
  if new.modifie_le > now() + interval '5 minutes' then
    insert into public.exercise_classements_conflits (user_id, nom, origine, raison, gardee, ecartee)
    values (new.user_id, new.nom, 'base', 'date_future_ramenee', null, to_jsonb(new));
    new.modifie_le := now();
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.nom <> old.nom then
      raise exception 'changement de compte ou de nom interdit';
    end if;
    if new.modifie_le < old.modifie_le
       or (new.modifie_le = old.modifie_le
           and (new.catalogue, new.principal, new.secondaires) is distinct from (old.catalogue, old.principal, old.secondaires)) then
      insert into public.exercise_classements_conflits (user_id, nom, origine, raison, gardee, ecartee)
      values (old.user_id, old.nom, 'base',
              case when new.modifie_le < old.modifie_le then 'plus_ancienne_ecartee' else 'meme_date_contenu_different' end,
              to_jsonb(old), to_jsonb(new));
      return old;
    end if;
  end if;
  return new;
end $$;

create trigger exercise_classements_garde before insert or update on public.exercise_classements
  for each row execute function public.exercise_classements_garde();

-- 5. Archivage durable du journal de l'appareil (statut par ligne envoyee)
create function public.archiver_versions_ecartees(p_lignes jsonb)
returns table (indice integer, cle text, statut text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_l       jsonb;
  v_n       bigint;
  v_survenu timestamptz;
  v_id      bigint;
  v_exist   public.exercise_classements_conflits%rowtype;
begin
  if v_uid is null then raise exception 'non connecté'; end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) > 500 then
    raise exception 'lot invalide';
  end if;

  for v_l, v_n in select e.ligne, e.pos from jsonb_array_elements(p_lignes) with ordinality as e(ligne, pos) loop
    indice := v_n - 1;
    cle    := v_l->>'cle_locale';
    v_id   := null;

    begin
      v_survenu := (v_l->>'survenu_le')::timestamptz;
    exception when others then
      v_survenu := null;
    end;
    if coalesce(char_length(v_l->>'nom') between 1 and 200, false) is false
       or coalesce(char_length(cle) between 1 and 100, false) is false
       or jsonb_typeof(v_l->'ecartee') is distinct from 'object'
       or v_survenu is null
       or pg_column_size(v_l) > 20000 then
      statut := 'refusee';
      return next; continue;
    end if;

    insert into public.exercise_classements_conflits
      (user_id, nom, origine, raison, gardee, ecartee, cle_locale, survenu_le)
    values (v_uid, v_l->>'nom', 'appareil', 'remplacee_par_cloud', v_l->'gardee', v_l->'ecartee', cle, v_survenu)
    on conflict (user_id, cle_locale) do nothing
    returning id into v_id;

    if v_id is not null then
      statut := 'archivee';
    else
      select * into v_exist from public.exercise_classements_conflits as c
       where c.user_id = v_uid and c.cle_locale = cle;
      if v_exist.origine = 'appareil'
         and v_exist.raison = 'remplacee_par_cloud'
         and v_exist.nom = v_l->>'nom'
         and v_exist.gardee is not distinct from v_l->'gardee'
         and v_exist.ecartee = v_l->'ecartee'
         and v_exist.survenu_le = v_survenu then
        statut := 'deja_archivee';
      else
        statut := 'cle_en_conflit';
      end if;
    end if;
    return next;
  end loop;
end $$;

-- 6. Droits et RLS
alter table public.exercise_classements enable row level security;
alter table public.exercise_classements_conflits enable row level security;
revoke all on public.exercise_classements, public.exercise_classements_conflits from public, anon, authenticated;
revoke all on sequence public.exercise_classements_conflits_id_seq from public, anon, authenticated;
grant select, insert, update on public.exercise_classements to authenticated;
grant select on public.exercise_classements_conflits to authenticated;

create policy classements_lecture on public.exercise_classements for select to authenticated
  using (user_id = (select auth.uid()));
create policy classements_ajout on public.exercise_classements for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy classements_maj on public.exercise_classements for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy conflits_lecture on public.exercise_classements_conflits for select to authenticated
  using (user_id = (select auth.uid()));

alter function public.exercise_classements_garde() owner to postgres;
alter function public.archiver_versions_ecartees(jsonb) owner to postgres;
revoke all on function public.exercise_classements_garde() from public, anon, authenticated;
revoke all on function public.archiver_versions_ecartees(jsonb) from public, anon, authenticated;
grant execute on function public.archiver_versions_ecartees(jsonb) to authenticated;
revoke all on function public.groupes_musculaires(), public.secondaires_valides(text, jsonb) from public, anon;
grant execute on function public.groupes_musculaires(), public.secondaires_valides(text, jsonb) to authenticated;
