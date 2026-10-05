-- 001 — Colonnes de droits + feature flags. Idempotent, additif : ne supprime et ne change rien d'existant.
-- A executer dans Supabase > SQL Editor (projet partage par les 3 apps Tatanka).

-- Colonnes lues/ecrites par les triggers ci-dessous (add ... if not exists = sans effet si deja presentes).
alter table public.profiles add column if not exists premium boolean not null default false;
alter table public.profiles add column if not exists promo boolean not null default false;
alter table public.profiles add column if not exists promo_expires_at timestamptz;
alter table public.profiles add column if not exists lifetime boolean not null default false;
alter table public.profiles add column if not exists blocked boolean not null default false;

-- Nouveaux droits : le plan commercial et le canal du Coach sont deux notions distinctes.
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists coach_channel text not null default 'stable';
alter table public.profiles add column if not exists cohort text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_plan_check') then
    alter table public.profiles add constraint profiles_plan_check check (plan in ('free','premium','premium_plus'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_coach_channel_check') then
    alter table public.profiles add constraint profiles_coach_channel_check check (coach_channel in ('stable','lab'));
  end if;
end $$;

-- Feature flags : lecture seule pour l'appli, ecriture reservee au serveur / dashboard.
create table if not exists public.feature_flags (
  key        text primary key,
  state      text not null default 'off' check (state in ('off','lab','published')),
  min_plan   text not null default 'premium_plus' check (min_plan in ('free','premium','premium_plus')),
  note       text,
  updated_at timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to authenticated;
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags for select to authenticated using (true);

-- Etat initial : Coach V2 reserve au canal "lab". Aucun code V2 n'existe encore.
insert into public.feature_flags (key, state, min_plan, note)
values ('coach_v2', 'lab', 'premium_plus', 'Coach V2 : canal lab uniquement tant que non publie')
on conflict (key) do nothing;
