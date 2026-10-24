-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis-photos) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0445_devis_photos.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0445_devis_photos_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

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
