-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis-avenant) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0446_devis_avenant.sql, retour arrière,
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

-- ===== supabase/migrations/0446_devis_avenant.sql =====
-- 0446 : avenant au devis signé (pilotage de H du 24/10). Un écart constaté (devis établi à distance, visite préalable,
-- jour de l'intervention) ou toute modification après signature passe par un avenant : document numéroté, rattaché au
-- devis signé, qui ne porte que l'écart chiffré (lignes en plus, ou en moins avec une quantité négative), signé en
-- ligne comme un devis (même preuve, même espace client) et tracé.
--   1. quotes : amendment_of (devis signé de rattachement), amendment_number (1, 2…), amendment_reason (motif).
--   2. public.devis_avenant(devis, motif) : prépare l'avenant suivant (référence du devis + « -AV1 », même client,
--      même métier, aucune ligne : l'équipe saisit l'écart), seulement pour un devis signé par le client.
--   3. La signature d'un avenant ne prépare pas de session (seul le devis le fait).
--   4. Mention réglable : les conditions générales acceptées avec le devis s'appliquent à l'avenant.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0446_devis_avenant_retour.sql

-- ── 1. Rattachement ──
alter table public.quotes add column if not exists amendment_of uuid references public.quotes(id) on delete restrict;
alter table public.quotes add column if not exists amendment_number int;
alter table public.quotes add column if not exists amendment_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_avenant_check') then
    alter table public.quotes add constraint quotes_avenant_check check (
      (amendment_of is null and amendment_number is null)
      or (amendment_of is not null and amendment_number > 0 and amendment_of <> id))
      ;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_avenant_motif_check') then
    alter table public.quotes add constraint quotes_avenant_motif_check check (amendment_reason is null or length(amendment_reason) <= 1000);
  end if;
end
$$;
create index if not exists quotes_amendment_of_idx on public.quotes (amendment_of) where amendment_of is not null;
comment on column public.quotes.amendment_of is 'Avenant : devis signé auquel il se rattache (l''avenant ne porte que l''écart)';
comment on column public.quotes.amendment_number is 'Numéro de l''avenant pour ce devis (1, 2…)';

-- ── 2. Préparer un avenant ──
create or replace function public.devis_avenant(p_quote uuid, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_base public.quotes;
  v_n int;
  v_id uuid := gen_random_uuid();
  v_motif text := left(btrim(coalesce(p_motif, '')), 1000);
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null then raise exception 'Devis introuvable' using errcode = 'P0002'; end if;
  if not app.a_le_droit_dans(q.company_id, 'commercial.devis.modifier') then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  -- Un avenant se rattache au devis, jamais à un autre avenant
  if q.amendment_of is not null then select * into v_base from public.quotes where id = q.amendment_of; else v_base := q; end if;
  if not app.devis_signe(v_base.id) then
    raise exception 'Un avenant se fait sur un devis signé par le client. Avant la signature, modifiez le devis.' using errcode = '22023';
  end if;
  if v_base.status = 'replaced' then raise exception 'Ce devis est remplacé par une version plus récente : faites l''avenant sur la dernière version' using errcode = '22023'; end if;
  if length(v_motif) < 5 then raise exception 'Indiquez le motif de l''avenant (écart constaté, modification demandée…)' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('devis_avenant:' || v_base.id::text));
  select coalesce(max(amendment_number), 0) + 1 into v_n from public.quotes where amendment_of = v_base.id;
  insert into public.quotes (id, reference, client_id, contact_id, quote_date, validity_date, object, client_reference, status,
    payment_method, payment_terms, tva_rate, tva_applicable, total_ht, total_tva, total_ttc, created_by, company_id, metier,
    amendment_of, amendment_number, amendment_reason, notes)
  values (v_id, regexp_replace(coalesce(v_base.reference, ''), '-V[0-9]+$', '') || '-AV' || v_n, v_base.client_id, v_base.contact_id,
    current_date, current_date + 30,
    'Avenant n° ' || v_n || ' au devis ' || coalesce(v_base.reference, '') || ' : ' || v_motif,
    v_base.client_reference, 'draft', v_base.payment_method, v_base.payment_terms, v_base.tva_rate, v_base.tva_applicable,
    0, 0, 0, v_base.created_by, v_base.company_id, v_base.metier, v_base.id, v_n, v_motif, null);
  insert into public.notifications (company_id, type, title, message, link, metadata)
  values (v_base.company_id, 'devis_avenant', 'Avenant préparé',
    'Avenant n° ' || v_n || ' au devis ' || coalesce(v_base.reference, '') || ' : ' || v_motif,
    '/devis?open=' || v_id, jsonb_build_object('quote_id', v_id, 'devis_id', v_base.id));
  return v_id;
end
$$;
revoke all on function public.devis_avenant(uuid, text) from public, anon;
grant execute on function public.devis_avenant(uuid, text) to authenticated;

-- ── 3. La signature d'un avenant ne prépare pas de session ──
do $do$
declare
  v_def text := pg_get_functiondef('app.devis_signe_sessions()'::regprocedure);
  v_ancre text := $a$  if new.status in ('accepted', 'partial') and coalesce(old.status, '') not in ('accepted', 'partial')$a$;
begin
  if position('amendment_of is null' in v_def) > 0 then return; end if;
  if position(v_ancre in v_def) = 0 then raise exception 'Fonction devis_signe_sessions inattendue : rien n''est changé'; end if;
  execute replace(v_def, v_ancre, $b$  -- Un avenant (0446) ne prépare pas de session : seul le devis le fait
  if new.amendment_of is null and new.status in ('accepted', 'partial') and coalesce(old.status, '') not in ('accepted', 'partial')$b$);
end
$do$;
revoke all on function app.devis_signe_sessions() from public, anon, authenticated;

-- ── 4. Mention de l'avenant ──
update public.billing_settings
   set mentions_devis = mentions_devis || jsonb_build_object('avenant',
     'Avenant au devis {devis} signé le {signe_le}. Les conditions générales acceptées avec ce devis s''appliquent au présent avenant. Montant du devis : {montant_devis} HT ; avenants déjà acceptés : {avenants} HT ; écart du présent avenant : {ecart} HT ; nouveau total : {nouveau_total} HT.')
 where not (mentions_devis ? 'avenant');
-- Réglages des sociétés créées ensuite : mêmes textes, avenant compris
alter table public.billing_settings alter column mentions_devis set default $j${
  "cgv": "L'acceptation du devis vaut acceptation des conditions générales jointes.",
  "distance": "Devis établi sur la base des informations transmises par le client le {date} ({infos}), sous réserve de vérification lors d'une visite préalable ou le jour de l'intervention. Tout écart fera l'objet d'un avenant soumis à votre accord avant exécution.",
  "materiel": "Prix du matériel sous réserve de disponibilité et de variation des tarifs du fournisseur au-delà de la durée de validité du devis.",
  "acompte": "Acompte de {pct} % à la commande, solde à la livraison ou à la réception des travaux.",
  "delai": "Délai de livraison ou d'intervention : {delai}.",
  "eco": "Dont éco-participation : {montant} HT.",
  "retractation": "Contrat conclu hors établissement ou à distance : vous disposez d'un délai de rétractation de 14 jours (article L221-18 du Code de la consommation). Un formulaire de rétractation est joint au devis.",
  "garanties": "Le matériel vendu bénéficie de la garantie légale de conformité de deux ans (articles L217-3 et suivants du Code de la consommation) et de la garantie des vices cachés (articles 1641 et suivants du Code civil).",
  "tva_reduite": "En qualité de preneur de la prestation, j'atteste que les travaux se rapportent à des locaux à usage d'habitation achevés depuis plus de deux ans et qu'ils respectent les conditions prévues par les articles 279-0 bis et 278-0 bis A du code général des impôts.",
  "decennale": "Assurance responsabilité civile décennale : {assureur}, contrat n° {contrat}, couverture géographique : {couverture}.",
  "rc_pro": "Assurance responsabilité civile professionnelle : {assureur}, contrat n° {contrat}, couverture géographique : {couverture}.",
  "dechets": "Déchets de chantier : {dechets}.",
  "avenant": "Avenant au devis {devis} signé le {signe_le}. Les conditions générales acceptées avec ce devis s'appliquent au présent avenant. Montant du devis : {montant_devis} HT ; avenants déjà acceptés : {avenants} HT ; écart du présent avenant : {ecart} HT ; nouveau total : {nouveau_total} HT."
}$j$::jsonb;

insert into public.schema_migrations (version) values ('0446_devis_avenant') on conflict (version) do nothing;

-- ===== supabase/rollback/0446_devis_avenant_retour.sql =====
-- Retour arrière de 0446_devis_avenant.sql. Idempotent. Refusé s'il existe déjà des avenants (ce seraient des devis
-- sans rattachement) : les retirer d'abord.
do $do$
declare
  v_def text := pg_get_functiondef('app.devis_signe_sessions()'::regprocedure);
begin
  if to_regclass('public.quotes') is not null and exists (select 1 from information_schema.columns where table_name = 'quotes' and column_name = 'amendment_of')
     and exists (select 1 from public.quotes where amendment_of is not null) then
    raise exception 'Des avenants existent : retour arrière refusé';
  end if;
  if position('amendment_of is null' in v_def) > 0 then
    execute replace(replace(v_def, $b$  -- Un avenant (0446) ne prépare pas de session : seul le devis le fait
$b$, ''), 'if new.amendment_of is null and new.status in', 'if new.status in');
  end if;
end
$do$;
revoke all on function app.devis_signe_sessions() from public, anon, authenticated;
drop function if exists public.devis_avenant(uuid, text);
update public.billing_settings set mentions_devis = mentions_devis - 'avenant';
alter table public.billing_settings alter column mentions_devis set default $j${
  "cgv": "L'acceptation du devis vaut acceptation des conditions générales jointes.",
  "distance": "Devis établi sur la base des informations transmises par le client le {date} ({infos}), sous réserve de vérification lors d'une visite préalable ou le jour de l'intervention. Tout écart fera l'objet d'un avenant soumis à votre accord avant exécution.",
  "materiel": "Prix du matériel sous réserve de disponibilité et de variation des tarifs du fournisseur au-delà de la durée de validité du devis.",
  "acompte": "Acompte de {pct} % à la commande, solde à la livraison ou à la réception des travaux.",
  "delai": "Délai de livraison ou d'intervention : {delai}.",
  "eco": "Dont éco-participation : {montant} HT.",
  "retractation": "Contrat conclu hors établissement ou à distance : vous disposez d'un délai de rétractation de 14 jours (article L221-18 du Code de la consommation). Un formulaire de rétractation est joint au devis.",
  "garanties": "Le matériel vendu bénéficie de la garantie légale de conformité de deux ans (articles L217-3 et suivants du Code de la consommation) et de la garantie des vices cachés (articles 1641 et suivants du Code civil).",
  "tva_reduite": "En qualité de preneur de la prestation, j'atteste que les travaux se rapportent à des locaux à usage d'habitation achevés depuis plus de deux ans et qu'ils respectent les conditions prévues par les articles 279-0 bis et 278-0 bis A du code général des impôts.",
  "decennale": "Assurance responsabilité civile décennale : {assureur}, contrat n° {contrat}, couverture géographique : {couverture}.",
  "rc_pro": "Assurance responsabilité civile professionnelle : {assureur}, contrat n° {contrat}, couverture géographique : {couverture}.",
  "dechets": "Déchets de chantier : {dechets}."
}$j$::jsonb;
drop index if exists public.quotes_amendment_of_idx;
alter table public.quotes drop constraint if exists quotes_avenant_motif_check;
alter table public.quotes drop constraint if exists quotes_avenant_check;
alter table public.quotes drop column if exists amendment_reason;
alter table public.quotes drop column if exists amendment_number;
alter table public.quotes drop column if exists amendment_of;
delete from public.schema_migrations where version = '0446_devis_avenant';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE devis-avenant (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
