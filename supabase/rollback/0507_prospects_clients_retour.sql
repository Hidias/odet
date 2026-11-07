-- Retour arrière de 0507 (prospects et clients). Les fiches passées « client » gardent leur type (sans effet sans 0507) ;
-- les fiches dont le statut « prospect » a été réécrit en « actif » restent « actif » (production le 07/11 : 0 fiche).
drop trigger if exists devis_client_signe on public.quotes;
drop trigger if exists facture_client_emise on public.invoices;
drop trigger if exists client_type_statut on public.clients;
drop trigger if exists inscription_client_confirmee on public.online_registrations;
drop function if exists app.inscription_client_confirmee();
drop function if exists app.devis_client_signe();
drop function if exists app.facture_client_emise();
drop function if exists app.client_type_statut();
drop function if exists app.devenir_client(uuid);
alter table public.clients drop constraint if exists clients_type_prospect_client;
alter table public.clients alter column type drop not null;

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
                    WHEN c.status::text = ANY (ARRAY['actif'::character varying::text, 'inactif'::character varying::text, 'archive'::character varying::text]) THEN 'client'::text
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

alter table public.clients drop column if exists client_since;

delete from public.schema_migrations where version = '0507_prospects_clients';
