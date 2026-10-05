-- 004 — A executer SEULEMENT APRES le deploiement du nouveau index.html (qui utilise apply_promo).
-- Ferme la lecture publique de la table des codes promo (l'ancien client la lisait avec la cle publique).
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;
