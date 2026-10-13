// Teste supabase/006_beta_access.sql sur un vrai Postgres (PGlite) avec roles anon/authenticated/service_role et auth.users/auth.uid().
// Dev uniquement : `npm i @electric-sql/pglite --no-save` puis `node tests/sql-beta.test.js`.
// Limite : les regles RLS reelles du projet Supabase ne sont pas connues ; on emule « chacun son profil ».
const { PGlite } = require('@electric-sql/pglite'); const fs = require('fs'), assert = require('assert');
const sql = f => fs.readFileSync(__dirname + '/../supabase/' + f, 'utf8');
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', C = '33333333-3333-3333-3333-333333333333';
const tests = []; const t = (n, f) => tests.push([n, f]);
async function fresh(files) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, email text, premium_training boolean default false, pack boolean default false, prefs jsonb);
    grant select, insert, update on public.profiles to authenticated; grant all on public.profiles to service_role;
    alter table public.profiles enable row level security;
    create policy own_select on public.profiles for select to authenticated using (id = auth.uid());
    create policy own_insert on public.profiles for insert to authenticated with check (id = auth.uid());
    create policy own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
    insert into auth.users values ('${A}','Alice@Test.fr'), ('${B}','bob@test.fr'), ('${C}','carol@test.fr');
    insert into public.profiles (id, email, prefs) values ('${A}','alice@test.fr','{"kcal":2500}'), ('${B}','bob@test.fr', null);   -- C : compte sans profil
  `);
  for (const f of (files || ['006_beta_access.sql'])) await db.exec(sql(f));
  return db;
}
const as = async (db, uid, role) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(uid ? { sub: uid } : {})]); await db.exec('set role ' + (role || 'authenticated')); };
const adm = async db => { await db.exec('reset role'); };
const one = async (db, q, p) => (await db.query(q, p)).rows[0];
const prof = async (db, id) => { await adm(db); return one(db, 'select * from public.profiles where id=$1', [id]); };
const beta = async (db, uid) => { await as(db, uid); return (await one(db, 'select public.get_my_beta() as b')).b; };
const denied = async (p, m) => { try { await p; } catch (e) { return assert.ok(!m || e.message.includes(m), 'message inattendu: ' + e.message); } assert.fail('devait etre refuse'); };
const secs = (a, b) => Math.abs((new Date(a) - new Date(b)) / 1000);

t('migration idempotente (deux executions) et utilisable seule, sans 001/002/003/004', async () => { const db = await fresh(); await db.exec(sql('006_beta_access.sql')); await db.exec(sql('006_beta_access.sql')); });
t('1-2. un utilisateur ne peut PAS s\'attribuer la bêta ni modifier / prolonger sa date (UPDATE ignoré en silence)', async () => {
  const db = await fresh(); await as(db, A);
  await db.exec(`update public.profiles set beta_started_at = now(), beta_expires_at = now() + interval '9 years' where id = '${A}'`);
  let p = await prof(db, A); assert.strictEqual(p.beta_expires_at, null); assert.strictEqual(p.beta_started_at, null);
  await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`); const before = await prof(db, A);
  await as(db, A); await db.exec(`update public.profiles set beta_expires_at = now() + interval '9 years', beta_started_at = now() - interval '1 year' where id = '${A}'`);
  p = await prof(db, A); assert.deepStrictEqual([p.beta_expires_at, p.beta_started_at], [before.beta_expires_at, before.beta_started_at], 'prolongation refusee');
});
t('auto-attribution par creation de profil (INSERT) : colonnes bêta forcées à NULL', async () => {
  const db = await fresh(); await adm(db); await db.exec(`delete from public.profiles where id='${B}'`); await as(db, B);
  await db.exec(`insert into public.profiles (id, email, beta_started_at, beta_expires_at) values ('${B}','bob@test.fr', now(), now() + interval '5 years')`);
  const p = await prof(db, B); assert.deepStrictEqual([p.beta_started_at, p.beta_expires_at], [null, null]);
});
t('upsert du client (ON CONFLICT DO UPDATE) ne peut pas non plus activer la bêta', async () => {
  const db = await fresh(); await as(db, A);
  await db.exec(`insert into public.profiles (id,email,beta_expires_at) values ('${A}','alice@test.fr', now() + interval '5 years') on conflict (id) do update set beta_expires_at = excluded.beta_expires_at`);
  assert.strictEqual((await prof(db, A)).beta_expires_at, null);
});
t('les autres champs du profil restent modifiables par l\'utilisateur (Nutrition / Progress / Training non casses)', async () => {
  const db = await fresh(); await as(db, A); await db.exec(`update public.profiles set prefs='{"kcal":3000}', premium_training = true where id='${A}'`);
  const p = await prof(db, A); assert.deepStrictEqual(p.prefs, { kcal: 3000 }); assert.strictEqual(p.premium_training, true);
});
t('3. beta_grant donne 30 jours à partir de maintenant, cohorte « beta », get_my_beta actif (heure serveur)', async () => {
  const db = await fresh(); await adm(db); const msg = (await one(db, `select public.beta_grant('alice@test.fr') as m`)).m; assert.ok(msg.includes('30 jours'), msg);
  const p = await prof(db, A); const now = (await one(db, 'select now() as n')).n;
  assert.ok(secs(p.beta_started_at, now) < 5); assert.ok(Math.abs((new Date(p.beta_expires_at) - new Date(p.beta_started_at)) / 86400000 - 30) < 0.001, '30 jours exactement'); assert.strictEqual(p.cohort, 'beta');
  const b = await beta(db, A); assert.strictEqual(b.active, true); assert.ok(secs(b.server_now, now) < 5);
});
t('beta_grant sur un compte déjà actif : aucun changement (message), jamais de remise à zéro de la durée', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr', 60)`); const before = await prof(db, A);
  const msg = (await one(db, `select public.beta_grant('alice@test.fr', 10) as m`)).m; assert.ok(msg.includes('Déjà actif'), msg);
  const after = await prof(db, A); assert.deepStrictEqual([after.beta_started_at, after.beta_expires_at], [before.beta_started_at, before.beta_expires_at]);
});
t('4. beta_extend : durée TOTALE depuis le début (60 puis 90), refuse de raccourcir sauf demande explicite', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`); const p0 = await prof(db, A);
  await db.exec(`select public.beta_extend('alice@test.fr', 90)`); let p = await prof(db, A); assert.ok(Math.abs((new Date(p.beta_expires_at) - new Date(p0.beta_started_at)) / 86400000 - 90) < 0.001, '90 jours depuis le debut, pas 120');
  await denied(db.query(`select public.beta_extend('alice@test.fr', 45)`), 'raccourcirait');
  await db.exec(`select public.beta_extend('alice@test.fr', 45, true)`); p = await prof(db, A); assert.ok(Math.abs((new Date(p.beta_expires_at) - new Date(p0.beta_started_at)) / 86400000 - 45) < 0.001);
  await denied(db.query(`select public.beta_extend('bob@test.fr', 60)`), 'jamais eu la bêta');
});
t('5. beta_revoke : accès coupé tout de suite, début conservé, autres données du profil intactes ; relancer ne casse rien', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`); assert.strictEqual((await beta(db, A)).active, true);
  await adm(db); const m1 = (await one(db, `select public.beta_revoke('alice@test.fr') as m`)).m; assert.ok(m1.includes('retirée'), m1);
  assert.strictEqual((await beta(db, A)).active, false); const p = await prof(db, A); assert.ok(p.beta_started_at !== null); assert.deepStrictEqual(p.prefs, { kcal: 2500 });
  await adm(db); assert.ok((await one(db, `select public.beta_revoke('alice@test.fr') as m`)).m.includes('rien à retirer'));
});
t('6. la bêta expire réellement à la date prévue (test en temps réel : expiration dans 1 s)', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`); await db.exec(`update public.profiles set beta_expires_at = now() + interval '1 second' where id='${A}'`);
  assert.strictEqual((await beta(db, A)).active, true); await new Promise(r => setTimeout(r, 1500)); assert.strictEqual((await beta(db, A)).active, false);
  await adm(db); assert.strictEqual((await one(db, `select statut from public.beta_testers where email='Alice@Test.fr'`)).statut, 'expiré');
});
t('7. l\'heure du téléphone / le fuseau de la session ne changent rien : seule l\'horloge du serveur compte', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`); await db.exec(`update public.profiles set beta_expires_at = now() - interval '1 minute' where id='${A}'`);
  await as(db, A); for (const tz of ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12']) { await db.exec(`set time zone '${tz}'`); assert.strictEqual((await one(db, 'select public.get_my_beta() as b')).b.active, false, tz); }
  const call = await one(db, `select pronargs from pg_proc where proname='get_my_beta'`); assert.strictEqual(Number(call.pronargs), 0, 'get_my_beta n\'accepte aucun argument (pas de date fournie par le client)');
});
t('get_my_beta : compte sans profil => inactif ; anonyme refusé ; la décision ne dépend que du compte connecté', async () => {
  const db = await fresh(); assert.strictEqual((await beta(db, C)).active, false); await as(db, null, 'anon'); await denied(db.query('select public.get_my_beta()'), 'permission denied');
  await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`); assert.strictEqual((await beta(db, A)).active, true); assert.strictEqual((await beta(db, B)).active, false, 'Bob n\'est pas Alice');
});
t('les fonctions d\'administration et la vue sont INACCESSIBLES à l\'appli (authenticated / anon)', async () => {
  const db = await fresh(); for (const role of ['authenticated', 'anon']) { await as(db, A, role);
    await denied(db.query(`select public.beta_grant('alice@test.fr')`), 'permission denied'); await denied(db.query(`select public.beta_extend('alice@test.fr', 999)`), 'permission denied');
    await denied(db.query(`select public.beta_revoke('bob@test.fr')`), 'permission denied'); await denied(db.query('select * from public.beta_testers'), 'permission denied'); }
});
t('e-mail d\'AUTHENTIFICATION : un profil dont l\'e-mail est falsifié ne reçoit jamais la bêta d\'un autre', async () => {
  const db = await fresh(); await as(db, B); await db.exec(`update public.profiles set email = 'alice@test.fr' where id='${B}'`);   // Bob usurpe l'e-mail d'Alice dans SON profil
  await adm(db); await db.exec(`select public.beta_grant('alice@test.fr')`);
  assert.strictEqual((await prof(db, A)).beta_expires_at !== null, true); assert.strictEqual((await prof(db, B)).beta_expires_at, null, 'Bob n\'a rien reçu'); assert.strictEqual((await beta(db, B)).active, false);
});
t('e-mail insensible à la casse et aux espaces ; erreurs claires (compte inconnu, sans profil, durée invalide)', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('  ALICE@test.FR ')`); assert.strictEqual((await prof(db, A)).cohort, 'beta');
  await denied(db.query(`select public.beta_grant('inconnu@x.fr')`), 'Aucun compte'); await denied(db.query(`select public.beta_grant('carol@test.fr')`), 'Profil introuvable');
  await denied(db.query(`select public.beta_grant('bob@test.fr', 0)`), 'Durée invalide'); await denied(db.query(`select public.beta_grant('bob@test.fr', 99999)`), 'Durée invalide'); await denied(db.query(`select public.beta_grant('bob@test.fr', null)`), 'Durée invalide');
});
t('beta_grant ne remplace jamais la cohorte « lab » (compte laboratoire)', async () => { const db = await fresh(); await adm(db); await db.exec(`alter table public.profiles add column if not exists cohort text; update public.profiles set cohort='lab' where id='${A}'`);
  await db.exec(`select public.beta_grant('alice@test.fr')`); assert.strictEqual((await prof(db, A)).cohort, 'lab'); });
t('13. isolation : deux comptes bêta indépendants (prolonger / retirer l\'un ne touche pas l\'autre)', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr'); select public.beta_grant('bob@test.fr', 10);`); const b0 = await prof(db, B);
  await db.exec(`select public.beta_extend('alice@test.fr', 90); select public.beta_revoke('alice@test.fr');`);
  const b1 = await prof(db, B); assert.deepStrictEqual([b1.beta_started_at, b1.beta_expires_at], [b0.beta_started_at, b0.beta_expires_at]); assert.strictEqual((await beta(db, B)).active, true); assert.strictEqual((await beta(db, A)).active, false);
});
t('vue beta_testers : e-mail, début, expiration, jours restants, statut — pour tous les comptes concernés', async () => {
  const db = await fresh(); await adm(db); await db.exec(`select public.beta_grant('alice@test.fr', 30); select public.beta_grant('bob@test.fr', 10); select public.beta_revoke('bob@test.fr');`);
  const rows = (await db.query('select * from public.beta_testers')).rows; assert.strictEqual(rows.length, 2); const a = rows.find(r => r.email === 'Alice@Test.fr'), b = rows.find(r => r.email === 'bob@test.fr');
  assert.deepStrictEqual([a.statut, a.jours_restants, a.cohorte], ['actif', 30, 'beta']); assert.deepStrictEqual([b.statut, b.jours_restants], ['expiré', 0]);
});
t('coexistence future avec 001+002+003 : la garde bêta et la garde générale cohabitent, le serveur reste autorisé', async () => {
  const db = new PGlite(); const base = (await fresh(['006_beta_access.sql']));   // base déjà prête avec 006
  await base.exec(sql('001_rights_columns_and_flags.sql')); await base.exec(sql('002_profiles_guard.sql'));
  await as(base, A); await base.exec(`update public.profiles set beta_expires_at = now() + interval '9 years', plan='premium_plus' where id='${A}'`); let p = await prof(base, A);
  assert.deepStrictEqual([p.beta_expires_at, p.plan], [null, 'free']); await adm(base); await base.exec(`select public.beta_grant('alice@test.fr')`); p = await prof(base, A); assert.ok(p.beta_expires_at !== null);
  assert.strictEqual((await beta(base, A)).active, true); await adm(base); await base.exec(sql('006_beta_access.sql'));
});
(async () => { let fail = 0; for (const [n, f] of tests) { try { await f(); console.log('OK   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n       -> ' + String(e.message).split('\n')[0]); } }
  console.log(`\n${tests.length - fail}/${tests.length} tests passes`); process.exit(fail ? 1 : 0); })();
