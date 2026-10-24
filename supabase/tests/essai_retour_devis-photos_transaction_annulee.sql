-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis-photos) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0445_devis_photos.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0445_devis_photos.sql =====
-- 0445 : photos des articles dans les devis (demande de l'équipe du 23/10, pilotage de H du 24/10).
--   1. stock_items : photo de l'article, fiche technique (PDF, jointe aux devis de vente), éco-participation
--      unitaire par défaut.
--   2. quote_items : article du catalogue d'où vient la ligne, photo de la ligne (celle de l'article, ou une photo
--      propre au devis : site, installation), case « photo dans le PDF ».
--   3. public.devis_articles() : articles actifs proposés dans les devis à qui prépare les devis (même sans le droit
--      de voir le stock), sans aucun prix d'achat.
--   4. Fichiers des articles dans le stockage privé « documents », sous articles/ : lus par qui voit le stock ou les
--      devis, déposés et retirés par qui gère les articles. Les photos propres à un devis suivent les règles
--      existantes du stockage « documents » (qui prépare les devis).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0445_devis_photos_retour.sql

-- ── 1. Articles ──
alter table public.stock_items add column if not exists photo_path text;
alter table public.stock_items add column if not exists fiche_technique_path text;
alter table public.stock_items add column if not exists eco_ht numeric;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_items_fichiers_0445_check') then
    alter table public.stock_items add constraint stock_items_fichiers_0445_check check (
      (photo_path is null or length(photo_path) <= 500) and (fiche_technique_path is null or length(fiche_technique_path) <= 500)
      and (eco_ht is null or eco_ht >= 0));
  end if;
end
$$;
comment on column public.stock_items.photo_path is 'Photo de l''article (stockage privé « documents », sous articles/), reprise dans les devis';
comment on column public.stock_items.fiche_technique_path is 'Fiche technique PDF de l''article, jointe aux devis de vente';
comment on column public.stock_items.eco_ht is 'Éco-participation unitaire HT comprise dans le prix de vente, reprise sur la ligne du devis';

-- ── 2. Lignes de devis ──
alter table public.quote_items add column if not exists stock_item_id uuid references public.stock_items(id) on delete set null;
alter table public.quote_items add column if not exists photo_path text;
alter table public.quote_items add column if not exists show_photo boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_items_photo_0445_check') then
    alter table public.quote_items add constraint quote_items_photo_0445_check check (photo_path is null or length(photo_path) <= 500);
  end if;
end
$$;
create index if not exists quote_items_stock_item_idx on public.quote_items (stock_item_id) where stock_item_id is not null;
comment on column public.quote_items.photo_path is 'Photo de la ligne : celle de l''article ou une photo propre au devis (stockage privé « documents »)';
comment on column public.quote_items.show_photo is 'Photo imprimée sous les lignes du devis';

-- ── 3. Articles proposés dans les devis ──
create or replace function public.devis_articles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'reference', i.reference, 'label', i.label, 'unit', i.unit, 'sale_price_ht', i.sale_price_ht,
      'photo_path', i.photo_path, 'fiche_technique_path', i.fiche_technique_path, 'eco_ht', i.eco_ht,
      'categorie', c.name) order by c.name nulls last, i.label), '[]'::jsonb)
  from public.stock_items i
  left join public.stock_categories c on c.id = i.category_id
  where i.is_active and not i.ppe
    and i.company_id in (select app.societes_avec_droit('commercial.devis.modifier'))
$$;
revoke all on function public.devis_articles() from public, anon;
grant execute on function public.devis_articles() to authenticated;

-- ── 4. Fichiers des articles ──
drop policy if exists odet_documents_articles_lire on storage.objects;
create policy odet_documents_articles_lire on storage.objects for select to authenticated
  using (bucket_id = 'documents' and name like 'articles/%'
         and (select app.un_des_droits(array['stock.voir', 'stock.articles.gerer', 'commercial.devis.voir'])));
drop policy if exists odet_documents_articles_creer on storage.objects;
create policy odet_documents_articles_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and name like 'articles/%' and (select app.un_des_droits(array['stock.articles.gerer'])));
drop policy if exists odet_documents_articles_supprimer on storage.objects;
create policy odet_documents_articles_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and name like 'articles/%' and (select app.un_des_droits(array['stock.articles.gerer'])));

insert into public.schema_migrations (version) values ('0445_devis_photos') on conflict (version) do nothing;

-- ===== supabase/rollback/0445_devis_photos_retour.sql =====
-- Retour arrière de 0445_devis_photos.sql. Idempotent. Les fichiers déposés restent dans le stockage « documents ».
drop policy if exists odet_documents_articles_supprimer on storage.objects;
drop policy if exists odet_documents_articles_creer on storage.objects;
drop policy if exists odet_documents_articles_lire on storage.objects;
drop function if exists public.devis_articles();
drop index if exists public.quote_items_stock_item_idx;
alter table public.quote_items drop constraint if exists quote_items_photo_0445_check;
alter table public.quote_items drop column if exists show_photo;
alter table public.quote_items drop column if exists photo_path;
alter table public.quote_items drop column if exists stock_item_id;
alter table public.stock_items drop constraint if exists stock_items_fichiers_0445_check;
alter table public.stock_items drop column if exists eco_ht;
alter table public.stock_items drop column if exists fiche_technique_path;
alter table public.stock_items drop column if exists photo_path;
delete from public.schema_migrations where version = '0445_devis_photos';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE devis-photos (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
