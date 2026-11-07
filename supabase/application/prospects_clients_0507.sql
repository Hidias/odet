-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (prospects_clients_0507) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0507_prospects_clients.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0507_prospects_clients_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0507_prospects_clients.sql =====
-- 0507 : prospects et clients séparés (décisions de H du 07/11 au soir, V34).
-- Constat : clients.type (« prospect » par défaut) n'était écrit que par inscription_confirmer (« client ») et jamais lu par les
-- plus un statut « prospect » (pastille de la liste), deux notions pour la même chose.
-- Règle :
--   1. Une fiche passe « client » d'elle-même, et ne revient jamais « prospect » :
--      - au premier devis accepté, accepté en partie ou facturé (la signature en ligne passe le devis en « accepté ») ;
--      - à la première facture émise (issued_at renseignée, avoirs exclus), pour le client et pour le client facturé.
--      Un brouillon de facture ne compte pas (il peut être supprimé ; décision de H du 07/11).
--      - à la confirmation d'une inscription en ligne (décision de H du 07/11 à 21 h 30), que la fiche soit créée par
--        inscription_confirmer (qui écrivait déjà « client ») ou retrouvée (qui restait « prospect »).
--      Le type n'est jamais écrit à la main : une écriture d'un compte (authenticated, anon) garde l'ancien type ; seuls les
--      déclencheurs ci-dessous (SECURITY DEFINER) le changent. Toute fiche cliente reçoit sa date de passage.
--   2. clients.type ne vaut plus que « prospect » ou « client », jamais vide (défaut « prospect » : import CSV, création
--      à l'écran, fiche venue de la prospection).
--   3. Statut « prospect » retiré (décision de H du 07/11) : réécrit en « actif » à l'écriture (les anciens écrans qui
--      l'envoient encore restent valides pendant le déploiement) ; la contrainte de statut garde la valeur, sans usage.
--   4. clients.client_since : date du passage en client (premier devis accepté ou première facture émise), pour compter
--      les nouveaux clients du mois au tableau de bord (created_at est la date de création de la fiche, souvent prospect).
--   5. Audience des mailings (mailing_audience_v) : une adresse de fiche est « client » quand la fiche est cliente
--      (clients.type), et non plus quand son statut est « actif » : sinon, le statut « prospect » retiré, tous les
--      prospects seraient comptés comme clients dans les envois groupés. Seule la règle de ce « case » change.
--   6. Reprise des fiches existantes par la même règle (production le 07/11 : 2 fiches, le lycée a un devis accepté).
-- Les cinq anciens déclencheurs qui passent le statut à « actif » (devis accepté, facture, session) ne lisent ni
-- n'écrivent clients.type : ils restent tels quels. L'espace client, les contrats, les relances et les actions
-- planifiées ne lisent que « archive » et « inactif » : rien ne change pour eux.
-- Les déclencheurs ne mettent à jour que la fiche concernée, en SECURITY DEFINER (accepter un devis n'exige pas le droit
-- de modifier la fiche client) ; aucun déclencheur des fiches clients n'écrit dans les devis ni dans les factures.
-- Retour arrière : supabase/rollback/0507_prospects_clients_retour.sql (les fiches passées « client » le restent).

alter table public.clients add column if not exists client_since timestamptz;

create or replace function app.devenir_client(p_client uuid)
 returns void
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  update public.clients set type = 'client', client_since = coalesce(client_since, now())
   where id = p_client and (type is distinct from 'client' or client_since is null);
$function$;

revoke all on function app.devenir_client(uuid) from public, anon, authenticated;

create or replace function app.devis_client_signe()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.client_id is not null and new.status in ('accepted', 'partial', 'invoiced')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.client_id is distinct from new.client_id) then
    perform app.devenir_client(new.client_id);
  end if;
  return null;
end;
$function$;

create or replace function app.facture_client_emise()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.issued_at is not null and coalesce(new.type, 'invoice') <> 'credit_note'
     and (tg_op = 'INSERT' or old.issued_at is null
          or old.client_id is distinct from new.client_id or old.billing_client_id is distinct from new.billing_client_id) then
    if new.client_id is not null then perform app.devenir_client(new.client_id); end if;
    if new.billing_client_id is not null then perform app.devenir_client(new.billing_client_id); end if;
  end if;
  return null;
end;
$function$;

create or replace function app.client_type_statut()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'prospect' then new.status := 'actif'; end if;
  -- Type jamais écrit par un compte : il garde l'ancien (création : prospect) ; les règles passent en SECURITY DEFINER
  if current_user in ('authenticated', 'anon') then
    new.type := case when tg_op = 'UPDATE' then old.type else 'prospect' end;
    if tg_op = 'UPDATE' then new.client_since := old.client_since; else new.client_since := null; end if;
  end if;
  if new.type is null or new.type not in ('prospect', 'client') then
    new.type := case when tg_op = 'UPDATE' and old.type = 'client' then 'client' else 'prospect' end;
  end if;
  -- Une fiche client ne redevient jamais prospect, et porte toujours sa date de passage
  if tg_op = 'UPDATE' and old.type = 'client' then new.type := 'client'; end if;
  if new.type = 'client' and new.client_since is null then
    new.client_since := case when tg_op = 'UPDATE' then coalesce(old.client_since, now()) else now() end;
  end if;
  return new;
end;
$function$;

create or replace function app.inscription_client_confirmee()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'confirmee' and new.client_id is not null
     and (old.status is distinct from new.status or old.client_id is distinct from new.client_id) then
    perform app.devenir_client(new.client_id);
  end if;
  return null;
end;
$function$;

drop trigger if exists inscription_client_confirmee on public.online_registrations;
create trigger inscription_client_confirmee after update of status, client_id on public.online_registrations
  for each row execute function app.inscription_client_confirmee();

drop trigger if exists devis_client_signe on public.quotes;
create trigger devis_client_signe after insert or update of status, client_id on public.quotes
  for each row execute function app.devis_client_signe();

drop trigger if exists facture_client_emise on public.invoices;
create trigger facture_client_emise after insert or update of issued_at, client_id, billing_client_id on public.invoices
  for each row execute function app.facture_client_emise();

drop trigger if exists client_type_statut on public.clients;
create trigger client_type_statut before insert or update on public.clients
  for each row execute function app.client_type_statut();

update public.clients set status = 'actif' where status = 'prospect';

-- Reprise : date du premier devis accepté (date d'acceptation si connue), de la première facture émise ou de la première
-- inscription confirmée ; seules les fiches dont le type ou la date change sont réécrites (updated_at des autres gardé)
with dates as (
  select c.id, (select min(d) from (
           select coalesce((q.conditions_acceptees ->> 'acceptees_le')::timestamptz, q.updated_at) d from public.quotes q
            where q.client_id = c.id and q.status in ('accepted', 'partial', 'invoiced')
           union all
           select i.issued_at from public.invoices i
            where (i.client_id = c.id or i.billing_client_id = c.id) and i.issued_at is not null and coalesce(i.type, 'invoice') <> 'credit_note'
           union all
           select coalesce(o.handled_at, o.created_at) from public.online_registrations o
            where o.client_id = c.id and o.status = 'confirmee') x) premier
    from public.clients c
)
update public.clients c
   set type = 'client', client_since = coalesce(c.client_since, d.premier, now())
  from dates d
 where d.id = c.id
   and (d.premier is not null or c.type = 'client')
   and (c.type is distinct from 'client' or c.client_since is null);

update public.clients set type = 'prospect' where type is null or type not in ('prospect', 'client');

alter table public.clients alter column type set default 'prospect';
alter table public.clients alter column type set not null;
alter table public.clients drop constraint if exists clients_type_prospect_client;
alter table public.clients add constraint clients_type_prospect_client check (type in ('prospect', 'client'));

create or replace view public.mailing_audience_v with (security_invoker = true) as
 WITH rows AS (
         SELECT lower(TRIM(BOTH FROM p.email)) AS email,
            'prospect'::text AS source_type,
            'prospection_massive'::text AS send_source,
            p.id AS source_id,
            p.name,
            NULLIF(TRIM(BOTH FROM p.groupe), ''::text) AS groupe,
            p.city,
            "left"(regexp_replace(COALESCE(p.postal_code, ''::text), '\s'::text, ''::text, 'g'::text), 2) AS dep,
            upper(replace(COALESCE(p.naf, ''::text), '.'::text, ''::text)) AS naf,
            p.effectif,
            NULLIF(TRIM(BOTH FROM p.mailing_groupe), ''::text) AS etiquette,
            p.prospection_status,
            COALESCE(p.is_siege, false) AS is_siege,
            NULL::text AS client_status,
            NULL::text AS client_type,
            false AS do_not_mail,
            NULLIF(TRIM(BOTH FROM p.dirigeant_prenom), ''::text) AS prenom,
            NULLIF(TRIM(BOTH FROM p.dirigeant_nom), ''::text) AS nom,
            NULL::text AS civilite,
            3 AS rank_src
           FROM prospection_massive p
          WHERE p.email IS NOT NULL AND TRIM(BOTH FROM p.email) <> ''::text
        UNION ALL
         SELECT lower(TRIM(BOTH FROM x.em)) AS lower,
                CASE
                    WHEN c.type = 'client'::text THEN 'client'::text
                    ELSE 'crm'::text
                END AS "case",
            'clients'::text AS text,
            c.id,
            c.name,
            NULLIF(TRIM(BOTH FROM c.group_name), ''::text) AS "nullif",
            c.city,
            "left"(regexp_replace(COALESCE(c.postal_code, ''::character varying)::text, '\s'::text, ''::text, 'g'::text), 2) AS "left",
            upper(replace(COALESCE(c.naf_code, c.naf, ''::character varying)::text, '.'::text, ''::text)) AS upper,
            c.effectif,
            NULL::text AS text,
            NULL::text AS text,
            false,
            c.status,
            c.client_type,
            COALESCE(c.do_not_mail, false) AS "coalesce",
            NULL::text AS text,
            NULL::text AS text,
            NULL::text AS text,
            1
           FROM clients c
             CROSS JOIN LATERAL ( VALUES (c.contact_email), (c.email)) x(em)
          WHERE x.em IS NOT NULL AND TRIM(BOTH FROM x.em) <> ''::text
        UNION ALL
         SELECT lower(TRIM(BOTH FROM cc.email)) AS lower,
            'contact'::text AS text,
            'client_contacts'::text AS text,
            cc.id,
            c.name,
            NULLIF(TRIM(BOTH FROM c.group_name), ''::text) AS "nullif",
            c.city,
            "left"(regexp_replace(COALESCE(c.postal_code, ''::character varying)::text, '\s'::text, ''::text, 'g'::text), 2) AS "left",
            upper(replace(COALESCE(c.naf_code, c.naf, ''::character varying)::text, '.'::text, ''::text)) AS upper,
            c.effectif,
            NULL::text AS text,
            NULL::text AS text,
            false,
            c.status,
            c.client_type,
            COALESCE(c.do_not_mail, false) AS "coalesce",
            NULLIF(TRIM(BOTH FROM cc.first_name), ''::text) AS "nullif",
            NULLIF(TRIM(BOTH FROM cc.last_name), ''::text) AS "nullif",
            NULLIF(TRIM(BOTH FROM cc.civilite), ''::text) AS "nullif",
            2
           FROM client_contacts cc
             JOIN clients c ON c.id = cc.client_id
          WHERE cc.email IS NOT NULL AND TRIM(BOTH FROM cc.email) <> ''::text
        ), agg AS (
         SELECT rows.email,
            COALESCE((array_agg(rows.groupe ORDER BY rows.rank_src, rows.is_siege DESC) FILTER (WHERE rows.groupe IS NOT NULL))[1], (array_agg(rows.name ORDER BY rows.rank_src, rows.is_siege DESC) FILTER (WHERE rows.name IS NOT NULL))[1], rows.email) AS display_name,
            (array_agg(rows.send_source ORDER BY rows.rank_src, rows.is_siege DESC))[1] AS send_source,
            (array_agg(rows.source_id ORDER BY rows.rank_src, rows.is_siege DESC))[1] AS source_id,
            (array_agg(rows.city ORDER BY rows.rank_src, rows.is_siege DESC) FILTER (WHERE rows.city IS NOT NULL))[1] AS city,
            count(*)::integer AS nb_lignes,
            array_agg(DISTINCT rows.source_type) AS source_types,
            array_agg(DISTINCT rows.name) FILTER (WHERE rows.name IS NOT NULL) AS noms,
            array_agg(DISTINCT rows.city) FILTER (WHERE rows.city IS NOT NULL) AS villes,
            array_agg(DISTINCT rows.dep) FILTER (WHERE rows.dep ~ '^[0-9][0-9AB]$'::text) AS departements,
            array_agg(DISTINCT rows.naf) FILTER (WHERE rows.naf <> ''::text) AS nafs,
            array_agg(DISTINCT rows.effectif) FILTER (WHERE rows.effectif IS NOT NULL AND rows.effectif <> ''::text) AS effectifs,
            array_agg(DISTINCT rows.etiquette) FILTER (WHERE rows.etiquette IS NOT NULL) AS etiquettes,
            array_agg(DISTINCT rows.prospection_status) FILTER (WHERE rows.prospection_status IS NOT NULL) AS statuts_prospection,
            array_agg(DISTINCT rows.client_status) FILTER (WHERE rows.client_status IS NOT NULL) AS statuts_client,
            array_agg(DISTINCT rows.client_type) FILTER (WHERE rows.client_type IS NOT NULL) AS types_client,
            bool_or(rows.do_not_mail) AS do_not_mail,
            (array_agg(rows.prenom ORDER BY rows.rank_src) FILTER (WHERE rows.prenom IS NOT NULL))[1] AS prenom,
            (array_agg(rows.nom ORDER BY rows.rank_src) FILTER (WHERE rows.nom IS NOT NULL))[1] AS nom,
            (array_agg(rows.civilite ORDER BY rows.rank_src) FILTER (WHERE rows.civilite IS NOT NULL))[1] AS civilite
           FROM rows
          GROUP BY rows.email
        ), sends AS (
         SELECT lower(TRIM(BOTH FROM mailing_sends.email)) AS email,
            max(mailing_sends.sent_at) AS last_sent_at,
            count(DISTINCT mailing_sends.campaign_id)::integer AS nb_campagnes,
            array_agg(DISTINCT mailing_sends.campaign_id) AS campagnes,
            max(mailing_sends.replied_at) AS last_replied_at
           FROM mailing_sends
          WHERE mailing_sends.status = 'sent'::text AND mailing_sends.campaign_id IS NOT NULL
          GROUP BY (lower(TRIM(BOTH FROM mailing_sends.email)))
        )
 SELECT a.email,
    a.display_name,
    a.send_source,
    a.source_id,
    a.city,
    a.nb_lignes,
    a.source_types,
    a.noms,
    a.villes,
    a.departements,
    a.nafs,
    a.effectifs,
    a.etiquettes,
    a.statuts_prospection,
    a.statuts_client,
    a.types_client,
    a.do_not_mail,
    a.prenom,
    a.nom,
    a.civilite,
    COALESCE(st.status, 'ok'::text) AS email_status,
    COALESCE(st.flags, '{}'::text[]) AS email_flags,
    bl.category AS blocage,
    s.last_sent_at,
    COALESCE(s.nb_campagnes, 0) AS nb_campagnes,
    COALESCE(s.campagnes, '{}'::uuid[]) AS campagnes,
    s.last_replied_at
   FROM agg a
     LEFT JOIN mailing_email_status st ON st.email = a.email
     LEFT JOIN LATERAL ( SELECT b.category
           FROM mailing_blocklist b
          WHERE b.kind = 'email'::text AND b.value = a.email OR b.kind = 'domaine'::text AND b.value = split_part(a.email, '@'::text, 2)
          ORDER BY (
                CASE b.category
                    WHEN 'concurrent'::text THEN 0
                    WHEN 'desabonne'::text THEN 1
                    ELSE 2
                END)
         LIMIT 1) bl ON true
     LEFT JOIN sends s ON s.email = a.email;

insert into public.schema_migrations (version) values ('0507_prospects_clients') on conflict (version) do nothing;
