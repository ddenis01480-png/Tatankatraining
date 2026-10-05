-- 003 — Validation des codes promo cote serveur. A executer AVANT de deployer le nouveau index.html.
-- Les messages d'erreur sont ceux de l'ancien code client.
create or replace function public.apply_promo(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_promo record;
  v_exp   timestamptz;
begin
  if v_uid is null then raise exception 'Connecte-toi d abord'; end if;
  select * into v_promo from public.promo_codes where code = upper(btrim(p_code)) and active = true limit 1;
  if not found then raise exception 'Code invalide ou expiré'; end if;
  if lower(coalesce(v_promo.email, '')) <> v_email then raise exception 'Ce code n''est pas lié à cet email'; end if;
  v_exp := v_promo.expires_at::timestamptz;
  if v_exp is not null and v_exp < now() then raise exception 'Code expiré'; end if;
  insert into public.profiles (id, email, promo, promo_expires_at) values (v_uid, v_email, true, v_exp)
    on conflict (id) do update set promo = true, promo_expires_at = v_exp;
  return jsonb_build_object('promo', true, 'promo_expires_at', v_exp);
end $$;
revoke all on function public.apply_promo(text) from public, anon;
grant execute on function public.apply_promo(text) to authenticated;
