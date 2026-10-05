// Teste les migrations supabase/*.sql sur un vrai Postgres (PGlite, WebAssembly) avec des roles anon/authenticated/service_role
// et une emulation de auth.uid()/auth.jwt(). Dev uniquement : `npm i @electric-sql/pglite --no-save` puis `node tests/sql-rights.test.js`.
// Limite : les regles RLS reelles de votre projet Supabase ne sont pas connues ; on emule une politique "chacun son profil".
const { PGlite } = require('@electric-sql/pglite'); const fs = require('fs'), assert = require('assert');
const sql = f => fs.readFileSync(__dirname + '/../supabase/' + f, 'utf8');
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
const tests = []; const t = (n, f) => tests.push([n, f]);

async function fresh(opts) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, email text, premium boolean default false, promo boolean default false, promo_expires_at timestamptz,
      lifetime boolean default false, blocked boolean default false, premium_training boolean default false, premium_nutrition boolean default false,
      premium_progress boolean default false, pack boolean default false, prefs jsonb, updated_at timestamptz);
    create table public.promo_codes (code text primary key, email text, active boolean default true, expires_at timestamptz);
    grant select, insert, update on public.profiles to authenticated; grant all on public.profiles to service_role;
    grant select on public.promo_codes to anon, authenticated; grant all on public.promo_codes to service_role;
    alter table public.profiles enable row level security;
    create policy own_select on public.profiles for select to authenticated using (id = auth.uid());
    create policy own_insert on public.profiles for insert to authenticated with check (id = auth.uid());
    create policy own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
    insert into public.profiles (id, email) values ('${U1}','u1@x.fr'), ('${U2}','u2@x.fr');
    insert into public.promo_codes values ('BETA1','u1@x.fr',true,null), ('OLD1','u1@x.fr',true, now() - interval '1 day'), ('OFF1','u1@x.fr',false,null), ('OTHER','u2@x.fr',true,null);
  `);
  for (const f of ['001_rights_columns_and_flags.sql', '002_profiles_guard.sql', '003_apply_promo.sql']) await db.exec(sql(f));
  if (opts && opts.lock) await db.exec(sql('004_lock_promo_codes.sql'));
  return db;
}
const as = async (db, uid, email, role) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(uid ? { sub: uid, email } : {})]); await db.exec('set role ' + (role || 'authenticated')); };
const row = async (db, id) => { await db.exec('reset role'); return (await db.query('select * from public.profiles where id=$1', [id])).rows[0]; };
const denied = async (p, m) => { try { await p; } catch (e) { return assert.ok(!m || e.message.includes(m), 'message inattendu: ' + e.message); } assert.fail('devait etre refuse'); };

t('migrations idempotentes (executees deux fois sans erreur)', async () => { const db = await fresh(); for (const f of ['001_rights_columns_and_flags.sql','002_profiles_guard.sql','003_apply_promo.sql','004_lock_promo_codes.sql']) await db.exec(sql(f)); });
t('utilisateur : ne peut PAS modifier premium, promo, promo_expires_at, lifetime, blocked, plan, coach_channel, cohort (ignore en silence)', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr');
  await db.exec("update public.profiles set premium=true, promo=true, promo_expires_at=now()+interval '9 years', lifetime=true, plan='premium_plus', coach_channel='lab', cohort='lab' where id='" + U1 + "'");
  const r = await row(db, U1); assert.deepStrictEqual([r.premium, r.promo, r.promo_expires_at, r.lifetime, r.plan, r.coach_channel, r.cohort], [false, false, null, false, 'free', 'stable', null]);
});
t('utilisateur : ne peut pas se debloquer (blocked) ni echapper a un blocage', async () => {
  const db = await fresh(); await db.exec("update public.profiles set blocked=true where id='" + U1 + "'"); await as(db, U1, 'u1@x.fr');
  await db.exec("update public.profiles set blocked=false where id='" + U1 + "'"); assert.strictEqual((await row(db, U1)).blocked, true);
});
t('utilisateur : les autres champs restent modifiables (email, prefs) — Nutrition/Progress/Training non casses', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr'); await db.exec(`update public.profiles set prefs='{"kcal":2500}', email='n@x.fr' where id='${U1}'`);
  const r = await row(db, U1); assert.strictEqual(r.email, 'n@x.fr'); assert.deepStrictEqual(r.prefs, { kcal: 2500 });
});
t('COMPORTEMENT CONSERVE : premium_training / premium_nutrition / premium_progress / pack restent ecrivables par l\'utilisateur (activation ?payment=success des 3 apps)', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr'); await db.exec(`update public.profiles set premium_training=true, premium_nutrition=true, premium_progress=true, pack=true where id='${U1}'`);
  const r = await row(db, U1); assert.deepStrictEqual([r.premium_training, r.premium_nutrition, r.premium_progress, r.pack], [true, true, true, true]);
});
t('creation de profil par le navigateur : champs sensibles forces aux valeurs par defaut ; champs des apps conserves', async () => {
  const db = await fresh(); await db.exec("delete from public.profiles where id='" + U1 + "'"); await as(db, U1, 'u1@x.fr');
  await db.exec(`insert into public.profiles (id,email,premium,promo,lifetime,blocked,plan,coach_channel,cohort,premium_training,pack) values ('${U1}','u1@x.fr',true,true,true,true,'premium_plus','lab','lab',false,false)`);
  const r = await row(db, U1); assert.deepStrictEqual([r.premium, r.promo, r.lifetime, r.blocked, r.plan, r.coach_channel, r.cohort], [false, false, false, false, 'free', 'stable', null]);
});
t('upsert du client (ancien chemin promo) : ne peut plus activer promo', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr');
  await db.exec(`insert into public.profiles (id,email,promo,promo_expires_at) values ('${U1}','u1@x.fr',true,null) on conflict (id) do update set promo=true, promo_expires_at=null`);
  assert.strictEqual((await row(db, U1)).promo, false);
});
t('serveur (service_role) et dashboard (postgres) peuvent ecrire les champs proteges', async () => {
  const db = await fresh(); await as(db, null, null, 'service_role'); await db.exec(`update public.profiles set plan='premium', coach_channel='lab', cohort='beta', premium=true where id='${U1}'`);
  let r = await row(db, U1); assert.deepStrictEqual([r.plan, r.coach_channel, r.cohort, r.premium], ['premium', 'lab', 'beta', true]);
  await db.exec(`update public.profiles set plan='premium_plus' where id='${U1}'`); assert.strictEqual((await row(db, U1)).plan, 'premium_plus');
});
t('contraintes : plan et coach_channel invalides refuses', async () => {
  const db = await fresh(); await denied(db.exec("update public.profiles set plan='gold' where id='" + U1 + "'"), 'profiles_plan_check');
  await denied(db.exec("update public.profiles set coach_channel='beta' where id='" + U1 + "'"), 'profiles_coach_channel_check');
});
t('apply_promo : code valide (casse ignoree) -> promo active pour soi uniquement ; fonctionne malgre la garde', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr'); const r = (await db.query("select public.apply_promo('beta1') as r")).rows[0].r;
  assert.strictEqual(r.promo, true); assert.strictEqual((await row(db, U1)).promo, true); assert.strictEqual((await row(db, U2)).promo, false);
});
t('apply_promo : mauvais email, expire, inactif, inconnu, non connecte -> erreurs avec les messages historiques', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr');
  await denied(db.query("select public.apply_promo('OTHER')"), "n'est pas lié à cet email"); await denied(db.query("select public.apply_promo('OLD1')"), 'Code expiré');
  await denied(db.query("select public.apply_promo('OFF1')"), 'Code invalide ou expiré'); await denied(db.query("select public.apply_promo('NOPE')"), 'Code invalide ou expiré');
  await as(db, null, null, 'authenticated'); await denied(db.query("select public.apply_promo('BETA1')"), 'Connecte-toi');
  assert.strictEqual((await row(db, U1)).promo, false);
});
t('apply_promo : anon ne peut pas l\'appeler', async () => { const db = await fresh(); await as(db, null, null, 'anon'); await denied(db.query("select public.apply_promo('BETA1')"), 'permission denied'); });
t('feature_flags : lisible par un utilisateur connecte, jamais modifiable ; anon sans acces ; coach_v2 initialise a "lab"', async () => {
  const db = await fresh(); await as(db, U1, 'u1@x.fr'); const f = (await db.query('select key,state from public.feature_flags')).rows; assert.deepStrictEqual(f, [{ key: 'coach_v2', state: 'lab' }]);
  await denied(db.exec("update public.feature_flags set state='published'"), 'permission denied'); await denied(db.exec("insert into public.feature_flags(key) values ('x')"), 'permission denied');
  await denied(db.exec('delete from public.feature_flags'), 'permission denied'); await as(db, null, null, 'anon'); await denied(db.query('select * from public.feature_flags'), 'permission denied');
});
t('004 : promo_codes ferme a anon/authenticated ; apply_promo continue de marcher', async () => {
  const db = await fresh({ lock: true }); await as(db, null, null, 'anon'); await denied(db.query('select * from public.promo_codes'), 'permission denied');
  await as(db, U1, 'u1@x.fr'); await denied(db.query('select * from public.promo_codes'), 'permission denied'); assert.strictEqual((await db.query("select public.apply_promo('BETA1') as r")).rows[0].r.promo, true);
});
t('005 : compte lab -> coach_channel=lab ; les autres restent stable', async () => {
  const db = await fresh(); await db.exec(sql('005_set_lab_account.sql').replace('00e6db68-34dd-4f97-afea-1a91eef02886', U1));
  assert.strictEqual((await row(db, U1)).coach_channel, 'lab'); assert.strictEqual((await row(db, U2)).coach_channel, 'stable');
});
(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
