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
