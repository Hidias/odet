-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (l2_0041) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0041_clients_sites.sql, retour arrière,
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

-- ===== supabase/migrations/0041_clients_sites.sql =====
-- 0041_clients_sites.sql : clients et sites, une seule source pour chaque information (lot 2, branche clients-sites).
--
-- Spec : odet-lot2-spec.md v2, section 2. Déjà fait avant : TVA calculée depuis le SIREN et particuliers (0040),
-- coordonnées du client figées à l'émission (0361, invoices.buyer_snapshot), contrôle de l'annuaire (0365).
-- 1. clients : raison sociale du répertoire, pays, dirigeant, date de création, état administratif, dernière
--    lecture du répertoire et sa photographie (jamais écrites sans l'accord de l'utilisateur, écart par écart).
-- 2. sites : SIRET, siège au répertoire, état administratif, photographie du répertoire ; un seul site
--    « adresse de la fiche » (is_default) par client.
-- 3. client_contacts.site_id, trainees.site_id (facultatifs) : rattacher un interlocuteur ou un salarié à un site.
-- 4. Adresse de la fiche = site par défaut, synchronisés dans les deux sens (déclencheurs, sans boucle) ; un
--    client professionnel créé reçoit son site par défaut ; les clients professionnels qui n'en ont pas le
--    reçoivent ici (données de démonstration). Un particulier n'a pas de site.
-- 5. public.tva_from_siren(siren) : même calcul que l'application (src/core/org/tva.js), pour le serveur.
-- Classes multi-sociétés : sites hérite des sociétés du client (company_id, company_ids) à la création automatique.
-- Migration additive : aucune colonne retirée. Idempotente.
-- Retour arrière : supabase/rollback/0041_clients_sites_retour.sql

-- ── 1. clients ──
alter table public.clients add column if not exists legal_name text;
alter table public.clients add column if not exists country char(2) not null default 'FR';
alter table public.clients add column if not exists dirigeant_nom text;
alter table public.clients add column if not exists dirigeant_qualite text;
alter table public.clients add column if not exists date_creation date;
alter table public.clients add column if not exists etat_administratif text;
alter table public.clients add column if not exists registry_synced_at timestamptz;
alter table public.clients add column if not exists registry_snapshot jsonb;

comment on column public.clients.legal_name is 'Raison sociale au répertoire (le nom d''usage reste dans name)';
comment on column public.clients.etat_administratif is 'État au répertoire : A actif, C cessé (lu, jamais saisi)';
comment on column public.clients.registry_snapshot is 'Dernière réponse normalisée du répertoire des entreprises (écarts proposés, jamais écrits d''office)';

-- ── 2. sites ──
alter table public.sites add column if not exists siret varchar(14);
alter table public.sites add column if not exists is_head_office boolean not null default false;
alter table public.sites add column if not exists etat_administratif text;
alter table public.sites add column if not exists registry_snapshot jsonb;

comment on column public.sites.is_default is 'Site « adresse de la fiche » du client, synchronisé avec l''adresse de clients';
comment on column public.sites.is_head_office is 'Siège au répertoire (indépendant de is_default)';

create unique index if not exists sites_client_default_key on public.sites (client_id) where is_default and client_id is not null;
create index if not exists sites_siret_idx on public.sites (siret) where siret is not null;

-- ── 3. Rattachements facultatifs ──
alter table public.client_contacts add column if not exists site_id uuid references public.sites(id) on delete set null;
alter table public.trainees add column if not exists site_id uuid references public.sites(id) on delete set null;
create index if not exists client_contacts_site_idx on public.client_contacts (site_id) where site_id is not null;
create index if not exists trainees_site_idx on public.trainees (site_id) where site_id is not null;

-- ── 4. Adresse de la fiche = site par défaut ──
-- Création du client professionnel : site par défaut avec l'adresse de la fiche (droits du propriétaire : un compte
-- qui peut créer un client n'a pas forcément le droit d'écrire un site, et la création ne doit pas échouer pour cela)
create or replace function app.client_site_defaut()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.client_type, 'entreprise') = 'particulier' then
    return new;
  end if;
  if not exists (select 1 from public.sites s where s.client_id = new.id and s.is_default) then
    insert into public.sites (kind, name, address, postal_code, city, client_id, is_default, is_active, company_id, company_ids)
    values ('client', 'Adresse de la fiche', new.address, new.postal_code, new.city, new.id, true, true,
            new.company_id, new.company_ids);
  end if;
  return new;
end
$$;

-- Adresse de la fiche modifiée : le site par défaut suit (position effacée : recalculée au prochain enregistrement)
create or replace function app.client_adresse_vers_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sites s
     set address = new.address, postal_code = new.postal_code, city = new.city,
         latitude = null, longitude = null, updated_at = now()
   where s.client_id = new.id and s.is_default
     and (s.address is distinct from new.address or s.postal_code is distinct from new.postal_code
          or s.city is distinct from new.city);
  return new;
end
$$;

-- Site par défaut modifié : l'adresse de la fiche suit (aucune boucle : rien ne change si les valeurs sont égales)
create or replace function app.site_adresse_vers_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_default and new.client_id is not null then
    update public.clients c
       set address = new.address, postal_code = new.postal_code, city = new.city, updated_at = now()
     where c.id = new.client_id
       and (c.address is distinct from new.address or c.postal_code is distinct from new.postal_code
            or c.city is distinct from new.city);
  end if;
  return new;
end
$$;

revoke all on function app.client_site_defaut(), app.client_adresse_vers_site(), app.site_adresse_vers_client()
  from public, anon, authenticated;

drop trigger if exists clients_site_defaut on public.clients;
create trigger clients_site_defaut after insert on public.clients
  for each row execute function app.client_site_defaut();

drop trigger if exists clients_adresse_site on public.clients;
create trigger clients_adresse_site after update of address, postal_code, city on public.clients
  for each row execute function app.client_adresse_vers_site();

drop trigger if exists sites_adresse_client on public.sites;
create trigger sites_adresse_client after insert or update of address, postal_code, city, is_default on public.sites
  for each row execute function app.site_adresse_vers_client();

-- Clients professionnels sans site par défaut : on le crée depuis l'adresse de la fiche
insert into public.sites (kind, name, address, postal_code, city, client_id, is_default, is_active, company_id, company_ids)
select 'client', 'Adresse de la fiche', c.address, c.postal_code, c.city, c.id, true, true, c.company_id, c.company_ids
from public.clients c
where coalesce(c.client_type, 'entreprise') <> 'particulier'
  and not exists (select 1 from public.sites s where s.client_id = c.id and s.is_default);

-- ── 5. TVA depuis le SIREN ──
create or replace function public.tva_from_siren(p_siren text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_siren ~ '^\d{9}' then
    'FR' || lpad(((12 + 3 * (left(p_siren, 9)::bigint % 97)) % 97)::text, 2, '0') || left(p_siren, 9)
  end
$$;
grant execute on function public.tva_from_siren(text) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0041_clients_sites') on conflict (version) do nothing;

-- ===== supabase/rollback/0041_clients_sites_retour.sql =====
-- Retour arrière de 0041_clients_sites.sql : retire la synchronisation adresse de la fiche / site par défaut et
-- les colonnes ajoutées. Idempotent.
-- Refusé si une colonne ajoutée porte déjà une valeur (lecture du répertoire, SIRET d'un site, rattachement d'un
-- contact ou d'un salarié à un site) : ce sont des données saisies, jamais effacées par un retour arrière.
-- Les sites « adresse de la fiche » créés par 0041 restent (ce sont des sites ordinaires, sans effet sans les
-- déclencheurs).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sites' and column_name = 'is_head_office') then
    if exists (select 1 from public.clients where legal_name is not null or dirigeant_nom is not null or dirigeant_qualite is not null
                 or date_creation is not null or etat_administratif is not null or registry_synced_at is not null
                 or registry_snapshot is not null or country is distinct from 'FR')
       or exists (select 1 from public.sites where siret is not null or is_head_office or etat_administratif is not null or registry_snapshot is not null)
       or exists (select 1 from public.client_contacts where site_id is not null)
       or exists (select 1 from public.trainees where site_id is not null) then
      raise exception 'Retour arrière refusé : des valeurs ont été saisies dans les colonnes de 0041';
    end if;
  end if;
end $$;

drop trigger if exists clients_site_defaut on public.clients;
drop trigger if exists clients_adresse_site on public.clients;
drop trigger if exists sites_adresse_client on public.sites;
drop function if exists app.client_site_defaut();
drop function if exists app.client_adresse_vers_site();
drop function if exists app.site_adresse_vers_client();
drop function if exists public.tva_from_siren(text);

drop index if exists public.sites_client_default_key;
drop index if exists public.sites_siret_idx;
drop index if exists public.client_contacts_site_idx;
drop index if exists public.trainees_site_idx;

alter table public.trainees drop column if exists site_id;
alter table public.client_contacts drop column if exists site_id;
alter table public.sites drop column if exists registry_snapshot;
alter table public.sites drop column if exists etat_administratif;
alter table public.sites drop column if exists is_head_office;
alter table public.sites drop column if exists siret;
alter table public.clients drop column if exists registry_snapshot;
alter table public.clients drop column if exists registry_synced_at;
alter table public.clients drop column if exists etat_administratif;
alter table public.clients drop column if exists date_creation;
alter table public.clients drop column if exists dirigeant_qualite;
alter table public.clients drop column if exists dirigeant_nom;
alter table public.clients drop column if exists country;
alter table public.clients drop column if exists legal_name;

delete from public.schema_migrations where version = '0041_clients_sites';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE l2_0041 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
