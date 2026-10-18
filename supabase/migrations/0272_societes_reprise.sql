-- 0272_societes_reprise.sql : socle multi-sociétés (chantier C1a), reprise de l'existant et recopies.
--
-- 1. Société n° 1 créée à partir des réglages de l'organisme (organization_settings), sans ressaisie ni valeur en dur.
-- 2. Établissement siège depuis le SIRET de l'organisme.
-- 3. Chaque compte interne actif ou non (hors super administrateur, rôle de plateforme, et hors comptes externes)
--    reçoit une appartenance à la société n° 1 avec son rôle actuel ; vue groupe pour les administrateurs.
-- 4. Modules de la société n° 1 = modules actifs aujourd'hui.
-- 5. Recopies à sens unique, tant que les écrans de C3 n'existent pas (une seule source de saisie) :
--    organization_settings → société n° 1 (identité juridique, banque, préfixe) ;
--    profiles (rôle, actif) → appartenance à la société n° 1 ;
--    org_modules (actif) → modules de la société n° 1.
--    C2 et C3 retireront ces recopies quand les écrans liront et écriront la société directement.
--
-- Le mode d'accès de support reste celui du produit (à la demande) : le choix propre à une instance est posé à part
-- (pour GLD : supabase/instances/odet-gld/c1a_acces_support_permanent.sql, décision du 17/10).
-- Migration idempotente. Retour arrière : supabase/rollback/0270-0273_societes_retour.sql

-- Rôles internes qui reçoivent une appartenance
create or replace function app.member_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture')
              then p_role end
$$;

-- organization_settings → société n° 1 (créée si elle n'existe pas encore)
create or replace function app.copy_settings_to_owner(p_s public.organization_settings)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.companies c where c.is_instance_owner;
  if v_id is null then
    insert into public.companies (legal_name, is_instance_owner)
    values (coalesce(nullif(btrim(p_s.legal_name), ''), nullif(btrim(p_s.name), ''), 'Société'), true)
    returning id into v_id;
  end if;
  update public.companies c set
    legal_name = coalesce(nullif(btrim(p_s.legal_name), ''), nullif(btrim(p_s.name), ''), c.legal_name),
    short_name = nullif(btrim(p_s.name), ''),
    legal_form = nullif(btrim(p_s.forme_juridique), ''),
    capital = nullif(btrim(p_s.capital_social), ''),
    siren = coalesce(nullif(left(regexp_replace(coalesce(p_s.siren, ''), '\D', '', 'g'), 9), ''),
                     nullif(left(regexp_replace(coalesce(p_s.siret, ''), '\D', '', 'g'), 9), '')),
    vat_number = nullif(btrim(p_s.tva_intra), ''),
    vat_applicable = coalesce(p_s.tva_applicable, true),
    rcs = nullif(btrim(p_s.rcs), ''),
    naf = nullif(btrim(p_s.naf), ''),
    fiscal_year_start_month = coalesce(p_s.exercice_start_month, c.fiscal_year_start_month),
    is_training_org = coalesce(p_s.activity_kind in ('formation', 'mixte'), false) or coalesce(nullif(btrim(p_s.nda), ''), '') <> '',
    nda = nullif(btrim(p_s.nda), ''),
    address = p_s.address,
    postal_code = p_s.postal_code,
    city = p_s.city,
    phone = p_s.phone,
    email = p_s.email,
    website = p_s.website,
    bank_name = p_s.bank_name,
    iban = p_s.iban,
    bic = p_s.bic,
    logo_url = p_s.logo_url,
    doc_prefix = p_s.doc_prefix,
    updated_at = now()
  where c.id = v_id;
  -- Établissement siège (SIRET de l'organisme)
  if length(regexp_replace(coalesce(p_s.siret, ''), '\D', '', 'g')) = 14 then
    if exists (select 1 from public.company_establishments e where e.company_id = v_id and e.is_head_office) then
      update public.company_establishments e set
        siret = regexp_replace(p_s.siret, '\D', '', 'g'), name = nullif(btrim(p_s.name), ''),
        address = p_s.address, postal_code = p_s.postal_code, city = p_s.city, updated_at = now()
      where e.company_id = v_id and e.is_head_office;
    else
      insert into public.company_establishments (company_id, siret, name, address, postal_code, city, is_head_office)
      values (v_id, regexp_replace(p_s.siret, '\D', '', 'g'), nullif(btrim(p_s.name), ''), p_s.address, p_s.postal_code,
              p_s.city, true)
      on conflict do nothing;
    end if;
  end if;
end
$$;

create or replace function app.sync_owner_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.copy_settings_to_owner(new);
  return new;
end
$$;

-- profiles → appartenance à la société n° 1 (rôle et activité) ; super administrateur et comptes externes : aucune
create or replace function app.sync_profile_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_role text := app.member_role(new.role);
begin
  select c.id into v_company from public.companies c where c.is_instance_owner;
  if v_company is null then
    return new;
  end if;
  if v_role is null then
    update public.company_members m set is_active = false, updated_at = now()
     where m.company_id = v_company and m.profile_id = new.id and m.is_active;
    return new;
  end if;
  insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active)
  values (v_company, new.id, v_role, v_role = 'admin',
          not exists (select 1 from public.company_members d where d.profile_id = new.id and d.is_default),
          coalesce(new.is_active, true))
  on conflict (company_id, profile_id) do update
    set role = excluded.role, is_active = excluded.is_active, updated_at = now();
  return new;
end
$$;

-- org_modules → modules de la société n° 1
create or replace function app.sync_owner_modules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select c.id into v_company from public.companies c where c.is_instance_owner;
  if v_company is null then
    return new;
  end if;
  insert into public.company_modules (company_id, key, enabled)
  values (v_company, new.key, coalesce(new.enabled, false))
  on conflict (company_id, key) do update set enabled = excluded.enabled, updated_at = now();
  return new;
end
$$;

revoke all on function app.member_role(text), app.copy_settings_to_owner(public.organization_settings), app.sync_owner_company(), app.sync_profile_member(), app.sync_owner_modules()
  from public, anon, authenticated;

-- Reprise : société n° 1 depuis la fiche de l'organisme (la plus ancienne s'il y en avait plusieurs),
-- sans toucher à la fiche elle-même
select app.copy_settings_to_owner(o)
from public.organization_settings o
where not exists (select 1 from public.companies where is_instance_owner)
order by o.created_at nulls last, o.id
limit 1;

drop trigger if exists organization_settings_sync_company on public.organization_settings;
create trigger organization_settings_sync_company after insert or update on public.organization_settings
  for each row execute function app.sync_owner_company();

-- Appartenances des comptes existants
insert into public.company_members (company_id, profile_id, role, can_consolidate, is_default, is_active)
select c.id, p.id, app.member_role(p.role), p.role = 'admin', true, coalesce(p.is_active, true)
from public.profiles p
cross join public.companies c
where c.is_instance_owner and app.member_role(p.role) is not null
on conflict (company_id, profile_id) do nothing;

drop trigger if exists profiles_sync_company_member on public.profiles;
create trigger profiles_sync_company_member after insert or update of role, is_active on public.profiles
  for each row execute function app.sync_profile_member();

-- Modules de la société n° 1
insert into public.company_modules (company_id, key, enabled)
select c.id, m.key, coalesce(m.enabled, false)
from public.org_modules m cross join public.companies c
where c.is_instance_owner
on conflict (company_id, key) do nothing;

drop trigger if exists org_modules_sync_company on public.org_modules;
create trigger org_modules_sync_company after insert or update of enabled on public.org_modules
  for each row execute function app.sync_owner_modules();

insert into public.schema_migrations (version) values ('0272_societes_reprise') on conflict (version) do nothing;
