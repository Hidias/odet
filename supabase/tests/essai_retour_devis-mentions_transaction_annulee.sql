-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (devis-mentions) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0444_devis_mentions.sql, retour arrière,
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

-- ===== supabase/migrations/0444_devis_mentions.sql =====
-- 0444 : mentions des devis selon le métier et le client, devis établi à distance, acceptation des conditions
-- générales (demandes de l'équipe du 23/10, pilotage de H du 24/10).
--   1. quotes : devis établi à distance (date et informations reçues du client), contrat conclu hors établissement
--      ou à distance (particulier : rétractation de 14 jours et formulaire joint), délai de livraison ou
--      d'intervention, acompte à la commande (pourcentage, vide tant que la règle n'est pas décidée), déchets de
--      chantier (travaux) ; conditions générales jointes au devis mis à disposition, et conditions acceptées.
--   2. quote_items.eco_ht : éco-participation unitaire comprise dans le prix (matériel électrique, extincteurs).
--   3. billing_settings : textes des mentions des devis, réglables (aucune phrase légale figée dans le code).
--   4. Acceptation : quand le devis passe en « accepté » ou « partiel » (signature en ligne, dépôt validé, signature
--      sur place), la liste des conditions générales jointes est figée avec le devis (version, variante, date).
--      Ensuite elle ne change plus. Un nouveau devis (nouvelle version comprise) part sans conditions héritées.
--   5. Signature en ligne : si des conditions générales sont jointes au devis, l'accord du signataire doit dire qu'il
--      les a lues et acceptées (case obligatoire de l'espace client).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0444_devis_mentions_retour.sql

-- ── 1. Devis ──
alter table public.quotes add column if not exists a_distance boolean not null default false;
alter table public.quotes add column if not exists a_distance_le date;
alter table public.quotes add column if not exists a_distance_infos jsonb not null default '[]'::jsonb;
alter table public.quotes add column if not exists hors_etablissement boolean not null default false;
alter table public.quotes add column if not exists delai_execution text;
alter table public.quotes add column if not exists acompte_pct numeric;
alter table public.quotes add column if not exists dechets text;
alter table public.quotes add column if not exists conditions_jointes jsonb;
alter table public.quotes add column if not exists conditions_acceptees jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_mentions_0444_check') then
    alter table public.quotes add constraint quotes_mentions_0444_check check (
      jsonb_typeof(a_distance_infos) = 'array' and octet_length(a_distance_infos::text) <= 2000
      and (delai_execution is null or length(delai_execution) <= 200)
      and (acompte_pct is null or (acompte_pct > 0 and acompte_pct <= 100))
      and (dechets is null or length(dechets) <= 1000)
      and (conditions_jointes is null or jsonb_typeof(conditions_jointes) = 'array')
      and (conditions_acceptees is null or jsonb_typeof(conditions_acceptees) = 'object'));
  end if;
end
$$;
comment on column public.quotes.a_distance is 'Devis établi sur la base des informations transmises par le client, sous réserve de vérification (mention et avenant)';
comment on column public.quotes.a_distance_infos is 'Informations reçues du client pour un devis établi à distance (photos, nombre d''appareils, plans…)';
comment on column public.quotes.hors_etablissement is 'Contrat conclu hors établissement ou à distance avec un particulier : rétractation de 14 jours, formulaire joint';
comment on column public.quotes.acompte_pct is 'Acompte à la commande en % (vide : aucun acompte annoncé sur le devis)';
comment on column public.quotes.conditions_jointes is 'Conditions générales jointes au devis mis à disposition : [{doc, label, version, audience, validated_at}]';
comment on column public.quotes.conditions_acceptees is 'Conditions générales acceptées avec le devis, figées à l''acceptation : {conditions: [...], acceptees_le}';

-- ── 2. Éco-participation ──
alter table public.quote_items add column if not exists eco_ht numeric;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_items_eco_ht_check') then
    alter table public.quote_items add constraint quote_items_eco_ht_check check (eco_ht is null or eco_ht >= 0);
  end if;
end
$$;
comment on column public.quote_items.eco_ht is 'Éco-participation unitaire HT comprise dans le prix de la ligne (affichée en mention)';

-- ── 3. Textes des mentions ──
alter table public.billing_settings add column if not exists mentions_devis jsonb not null default $j${
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
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_settings_mentions_devis_check') then
    alter table public.billing_settings add constraint billing_settings_mentions_devis_check
      check (jsonb_typeof(mentions_devis) = 'object' and octet_length(mentions_devis::text) <= 20000);
  end if;
end
$$;
comment on column public.billing_settings.mentions_devis is 'Textes des mentions des devis par cas (cgv, distance, materiel, acompte, delai, eco, retractation, garanties, tva_reduite, decennale, rc_pro, dechets), modifiables dans Paramètres';

-- ── 4. Conditions figées à l'acceptation ──
create or replace function app.devis_conditions_figees()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nouveau devis (dont une nouvelle version, copiée de l'ancienne par devis_nouvelle_version) : ses conditions sont
  -- celles qui lui seront jointes, jamais celles d'un autre devis
  if tg_op = 'INSERT' then
    new.conditions_acceptees := null;
    new.conditions_jointes := null;
    return new;
  end if;
  -- Déjà acceptées : la liste ne change plus (ni les conditions jointes)
  if old.conditions_acceptees is not null then
    if new.conditions_acceptees is distinct from old.conditions_acceptees or new.conditions_jointes is distinct from old.conditions_jointes then
      raise exception 'Conditions générales acceptées avec le devis : elles ne changent plus. Créez une nouvelle version.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status in ('accepted', 'partial') and coalesce(old.status, '') not in ('accepted', 'partial')
     and new.conditions_jointes is not null and jsonb_array_length(new.conditions_jointes) > 0 then
    new.conditions_acceptees := jsonb_build_object('conditions', new.conditions_jointes, 'acceptees_le', now());
  elsif new.conditions_acceptees is distinct from old.conditions_acceptees then
    -- Écrite seulement par ce déclencheur
    new.conditions_acceptees := old.conditions_acceptees;
  end if;
  return new;
end
$$;
revoke all on function app.devis_conditions_figees() from public, anon, authenticated;
drop trigger if exists quotes_conditions_figees on public.quotes;
create trigger quotes_conditions_figees before insert or update on public.quotes
  for each row execute function app.devis_conditions_figees();

-- ── 5. Signature en ligne : conditions générales lues et acceptées ──
do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  v_ancre text := $a$  if d.kind = 'devis' and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in ('refused', 'expired')) then$a$;
  v_ajout text := $b$  -- Conditions générales jointes au devis (0444) : le signataire déclare les avoir lues et acceptées
  if d.kind = 'devis' and d.object_type = 'quote' and exists (select 1 from public.quotes q where q.id = d.object_id
       and q.conditions_jointes is not null and jsonb_array_length(q.conditions_jointes) > 0)
     and coalesce(p_consent, '') !~* 'conditions g[ée]n[ée]rales' then
    raise exception 'Cochez « J''ai lu et j''accepte les conditions générales » pour signer ce devis' using errcode = '22023';
  end if;
$b$;
begin
  if position('(0444)' in v_def) > 0 then return; end if;
  if position(v_ancre in v_def) = 0 then raise exception 'Fonction portail_signer_document inattendue : rien n''est changé'; end if;
  execute replace(v_def, v_ancre, v_ajout || v_ancre);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0444_devis_mentions') on conflict (version) do nothing;

-- ===== supabase/rollback/0444_devis_mentions_retour.sql =====
-- Retour arrière de 0444_devis_mentions.sql. Idempotent. Les mentions saisies sur les devis sont perdues.
do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  v_debut int := position('  -- Conditions générales jointes au devis (0444)' in v_def);
  v_fin int;
begin
  if v_debut = 0 then return; end if;
  v_fin := position('  if d.kind = ''devis'' and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in (''refused'', ''expired'')) then' in v_def);
  execute substr(v_def, 1, v_debut - 1) || substr(v_def, v_fin);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
drop trigger if exists quotes_conditions_figees on public.quotes;
drop function if exists app.devis_conditions_figees();
alter table public.billing_settings drop constraint if exists billing_settings_mentions_devis_check;
alter table public.billing_settings drop column if exists mentions_devis;
alter table public.quote_items drop constraint if exists quote_items_eco_ht_check;
alter table public.quote_items drop column if exists eco_ht;
alter table public.quotes drop constraint if exists quotes_mentions_0444_check;
alter table public.quotes drop column if exists conditions_acceptees;
alter table public.quotes drop column if exists conditions_jointes;
alter table public.quotes drop column if exists dechets;
alter table public.quotes drop column if exists acompte_pct;
alter table public.quotes drop column if exists delai_execution;
alter table public.quotes drop column if exists hors_etablissement;
alter table public.quotes drop column if exists a_distance_infos;
alter table public.quotes drop column if exists a_distance_le;
alter table public.quotes drop column if exists a_distance;
delete from public.schema_migrations where version = '0444_devis_mentions';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE devis-mentions (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
