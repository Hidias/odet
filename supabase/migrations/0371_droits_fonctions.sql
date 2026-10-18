-- 0371_droits_fonctions.sql : droits composés par société (chantier C1b), fonctions.
--
-- UNE SEULE FONCTION fait foi : app.a_le_droit(code) = « le compte connecté a le droit X dans la société courante ».
-- Toutes les règles d'accès générées par scripts/securite/regles.py (0373) l'appellent sous la forme
-- (select app.a_le_droit('...')) (évaluée une fois par requête) ; l'écran lit les mêmes droits par public.my_rights().
--
-- Calcul des droits d'une personne dans une société (app.rights_for) :
--   1. compte désactivé ou sans rôle : aucun droit ;
--   2. super administrateur (rôle de plateforme) : les droits du modèle « superadmin » (tous) ; son accès aux données
--      d'une société reste celui de l'accès de support de C1a (condition de société posée par C2) ;
--   3. sinon, profils de la personne dans la société (app.profiles_for) :
--      * profil de base = son rôle d'appartenance (company_members.role) ; « lecture » coché technicien actif avec le
--        module Interventions actif = « technicien » (même règle que app.role()) ;
--      * profils en plus attribués dans la société (company_member_roles) ;
--      chaque clé de profil prend le profil propre à la société s'il existe, sinon le modèle de plateforme ;
--   4. droits des profils + droits accordés à la personne − droits retirés à la personne ;
--   5. moins les droits réservés à la licence totale si la société ne l'a pas, moins les droits réservés à une offre
--      que la société n'a pas, moins les droits de plateforme.
-- Société courante : app.current_company() (C1a : en-tête contrôlé, sinon société par défaut). Sans société (aucune
-- appartenance), le profil de base est le rôle du compte, comme avant C1b.
--
-- Équivalence avec le chantier 2 : pour une société unique, le rôle d'appartenance est le rôle du compte (recopie de
-- C1a) ; les modèles qui reprennent un rôle contiennent exactement les droits que la matrice donnait à ce rôle (0372,
-- générée depuis la même matrice que 0082). Contrôlé par supabase/tests/droits_chantier2.sql (bloc C1b).
-- Migration idempotente. Retour arrière : supabase/rollback/0370-0375_droits_retour.sql

-- Rôle effectif d'un compte (même règle que app.role(), pour un compte donné)
create or replace function app.role_of(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.role = 'lecture'
     and exists (select 1 from public.itv_technicians t where t.profile_id = p.id and t.is_active)
     and exists (select 1 from public.org_modules m where m.key = 'interventions' and m.enabled)
    then 'technicien'
    else p.role
  end
  from public.profiles p
  where p.id = p_profile and p.is_active
$$;

-- Clés des profils d'un compte dans une société : profil de base d'abord, puis profils attribués
create or replace function app.profiles_for(p_profile uuid, p_company uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := app.role_of(p_profile);
  v_member uuid;
  v_mrole text;
  v_base text;
  v_out text[];
begin
  if v_role is null then
    return '{}'::text[];
  end if;
  if v_role = 'superadmin' then
    return array['superadmin'];
  end if;
  if p_company is null then
    return array[v_role];
  end if;
  select m.id, m.role into v_member, v_mrole
  from public.company_members m
  where m.company_id = p_company and m.profile_id = p_profile and m.is_active;
  if v_member is null then
    return '{}'::text[];
  end if;
  v_base := case when v_role = 'technicien' and v_mrole = 'lecture' then 'technicien' else v_mrole end;
  select array[v_base] || coalesce(array_agg(r.role_key order by r.role_key) filter (where r.role_key <> v_base), '{}'::text[])
    into v_out
  from public.company_member_roles r
  where r.member_id = v_member;
  return coalesce(v_out, array[v_base]);
end
$$;

-- Droits d'un compte dans une société (tableau trié de codes)
create or replace function app.rights_for(p_profile uuid, p_company uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := app.role_of(p_profile);
  v_keys text[];
  v_member uuid;
  v_full boolean := false;
  v_offer uuid;
  v_out text[];
begin
  if v_role is null then
    return '{}'::text[];
  end if;
  -- Super administrateur : modèle de plateforme « superadmin », sans filtre de société
  if v_role = 'superadmin' then
    select coalesce(array_agg(r.right_code order by r.right_code), '{}'::text[]) into v_out
    from public.permission_profile_rights r
    join public.permission_profiles p on p.id = r.profile_id
    where p.company_id is null and p.key = 'superadmin';
    return v_out;
  end if;
  v_keys := app.profiles_for(p_profile, p_company);
  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return '{}'::text[];
  end if;
  if p_company is not null then
    select m.id into v_member from public.company_members m
    where m.company_id = p_company and m.profile_id = p_profile and m.is_active;
    select c.full_license, c.offer_id into v_full, v_offer from public.companies c where c.id = p_company;
  end if;
  with profils as (
    select distinct on (p.key) p.id
    from public.permission_profiles p
    where p.key = any (v_keys) and (p.company_id = p_company or p.company_id is null)
    order by p.key, (p.company_id is null)
  ), bruts as (
    select pr.right_code as code from public.permission_profile_rights pr where pr.profile_id in (select id from profils)
    union
    select g.right_code from public.company_member_rights g where g.member_id = v_member and g.effect = 'grant'
    except
    select g.right_code from public.company_member_rights g where g.member_id = v_member and g.effect = 'revoke'
  )
  select coalesce(array_agg(b.code order by b.code), '{}'::text[]) into v_out
  from bruts b
  join public.permissions d on d.code = b.code
  where not d.platform_only
    and (not d.full_license_only or coalesce(v_full, false))
    and (not exists (select 1 from public.offer_restrictions o where o.kind = 'right' and o.item_key = b.code)
         or exists (select 1 from public.offer_items i where i.offer_id = v_offer and i.kind = 'right' and i.item_key = b.code));
  return v_out;
end
$$;

-- Droits du compte connecté dans la société courante
create or replace function app.rights()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select app.rights_for((select auth.uid()), app.current_company())
$$;

-- LA fonction des règles d'accès : le compte connecté a-t-il le droit X dans la société courante ?
create or replace function app.a_le_droit(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_code = any (app.rights()), false)
$$;

-- Le compte connecté a-t-il le droit X dans une société donnée (lignes rattachées à une société) ?
create or replace function app.a_le_droit_dans(p_company uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_company in (select app.visible_companies())
                  and p_code = any (app.rights_for((select auth.uid()), p_company)), false)
$$;

-- Sociétés où le compte connecté a le droit X (pour les règles des tables rattachées à une société)
create or replace function app.societes_avec_droit(p_code text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v from app.visible_companies() v
  where p_code = any (app.rights_for((select auth.uid()), v))
$$;

-- Module ou droit disponible dans l'offre d'une société (aucune restriction posée = disponible partout)
create or replace function app.offer_allows(p_company uuid, p_kind text, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.offer_restrictions o where o.kind = p_kind and o.item_key = p_key)
      or exists (select 1 from public.offer_items i
                 join public.companies c on c.offer_id = i.offer_id
                 where c.id = p_company and i.kind = p_kind and i.item_key = p_key)
$$;

-- Le compte connecté peut-il décider d'une demande de validation (droit de l'étape en cours dans la société, ou
-- délégation en cours d'une personne qui a ce droit) ? Jamais sur sa propre demande.
create or replace function app.approval_can_decide(p_company uuid, p_scope text, p_right text, p_requested_by uuid,
                                                   p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_status = 'pending'
    and p_requested_by is distinct from (select auth.uid())
    and (app.a_le_droit_dans(p_company, p_right)
         or exists (select 1 from public.approval_delegations d
                    where d.company_id = p_company and d.to_profile = (select auth.uid()) and d.revoked_at is null
                      and now() >= d.starts_at and now() < d.ends_at and (d.scope is null or d.scope = p_scope)
                      and d.from_profile is distinct from p_requested_by
                      and p_right = any (app.rights_for(d.from_profile, p_company)))),
    false)
$$;

-- Droits du compte connecté, lus par l'application (une seule source avec les règles d'accès)
create or replace function public.my_rights()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company_id', app.current_company(),
    'role', app.role(),
    'profiles', to_jsonb(app.profiles_for((select auth.uid()), app.current_company())),
    'rights', to_jsonb(app.rights()),
    'full_license', coalesce((select c.full_license from public.companies c where c.id = app.current_company()), false)
  )
  where app.role() is not null
$$;

-- Choix de la direction (décision du 17/10) : devis visibles ou non du comptable externe de la société courante.
-- Crée au besoin le profil propre à la société (copie du modèle « comptable_externe »), puis ajoute ou retire
-- « Voir les devis ». Aucun accès aux Paramètres n'est nécessaire.
create or replace function public.external_accountant_set_quotes(p_visible boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid := app.current_company();
  v_prof uuid;
begin
  if v_company is null or not app.a_le_droit('facturation.comptable_externe.regler') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select p.id into v_prof from public.permission_profiles p where p.company_id = v_company and p.key = 'comptable_externe';
  if v_prof is null then
    insert into public.permission_profiles (company_id, key, label, description, base_role, position, created_by)
    select v_company, p.key, p.label, p.description, p.base_role, p.position, (select auth.uid())
    from public.permission_profiles p where p.company_id is null and p.key = 'comptable_externe'
    returning id into v_prof;
    if v_prof is null then
      raise exception 'Modèle « comptable externe » absent' using errcode = '22023';
    end if;
    insert into public.permission_profile_rights (profile_id, right_code)
    select v_prof, r.right_code from public.permission_profile_rights r
    join public.permission_profiles p on p.id = r.profile_id
    where p.company_id is null and p.key = 'comptable_externe';
  end if;
  if p_visible then
    insert into public.permission_profile_rights (profile_id, right_code) values (v_prof, 'commercial.devis.voir')
    on conflict do nothing;
  else
    delete from public.permission_profile_rights where profile_id = v_prof and right_code = 'commercial.devis.voir';
  end if;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'system', 'Devis du comptable externe',
          jsonb_build_object('company_id', v_company, 'visible', p_visible));
  return p_visible;
end
$$;

-- Rôle de base « membre » : reçoit une appartenance comme les autres rôles internes (recopie de C1a)
create or replace function app.member_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_role in ('admin', 'direction', 'gestionnaire', 'formateur', 'commercial', 'comptable', 'lecture', 'membre')
              then p_role end
$$;

-- Garde des champs sensibles d'une société (C1a) : l'offre rejoint la licence totale et la société n° 1,
-- réservées au super administrateur.
create or replace function app.companies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if (new.support_access_mode, new.support_access_hours) is distinct from (old.support_access_mode, old.support_access_hours)
       and coalesce(current_setting('odet.changement_acces_support', true), '') <> 'oui' then
      raise exception 'Le mode d''accès de support ne se change que par l''administrateur de la société'
        using errcode = '42501';
    end if;
    if (new.full_license, new.is_instance_owner, new.offer_id) is distinct from (old.full_license, old.is_instance_owner, old.offer_id)
       and not app.is_superadmin() then
      raise exception 'Licence, offre et société n° 1 : réservées au super administrateur' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Recopies et contrôles des tables de droits
create or replace function app.profile_rights_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.company_id into new.company_id from public.permission_profiles p where p.id = new.profile_id;
  return new;
end
$$;

drop trigger if exists permission_profile_rights_company on public.permission_profile_rights;
create trigger permission_profile_rights_company before insert or update on public.permission_profile_rights
  for each row execute function app.profile_rights_company();

-- Profils de plateforme : la clé et le rôle repris d'un modèle fourni ne changent pas ; le profil « superadmin »
-- n'existe qu'en modèle de plateforme ; un droit de plateforme ne va que dans le modèle « superadmin ».
create or replace function app.permission_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.is_system and (new.key, new.base_role, new.company_id, new.is_system)
     is distinct from (old.key, old.base_role, old.company_id, old.is_system) then
    raise exception 'Modèle fourni : sa clé et son rôle repris ne changent pas' using errcode = '42501';
  end if;
  if new.company_id is not null and new.key = 'superadmin' then
    raise exception 'Le profil super administrateur n''existe qu''au niveau de la plateforme' using errcode = '22023';
  end if;
  if new.company_id is not null then
    new.is_system := false;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists permission_profiles_guard on public.permission_profiles;
create trigger permission_profiles_guard before insert or update on public.permission_profiles
  for each row execute function app.permission_profiles_guard();

create or replace function app.profile_rights_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.permissions d where d.code = new.right_code and d.platform_only)
     and not exists (select 1 from public.permission_profiles p where p.id = new.profile_id
                     and p.company_id is null and p.key = 'superadmin') then
    raise exception 'Droit réservé à la plateforme : %', new.right_code using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists permission_profile_rights_guard on public.permission_profile_rights;
create trigger permission_profile_rights_guard before insert or update on public.permission_profile_rights
  for each row execute function app.profile_rights_guard();

-- Ajustements individuels : société de l'appartenance ; jamais un droit de plateforme
create or replace function app.member_rights_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select m.company_id into new.company_id from public.company_members m where m.id = new.member_id;
  if exists (select 1 from public.permissions d where d.code = new.right_code and d.platform_only) then
    raise exception 'Droit réservé à la plateforme : %', new.right_code using errcode = '42501';
  end if;
  new.granted_by := coalesce(new.granted_by, (select auth.uid()));
  return new;
end
$$;

drop trigger if exists company_member_rights_guard on public.company_member_rights;
create trigger company_member_rights_guard before insert or update on public.company_member_rights
  for each row execute function app.member_rights_guard();

-- Profils attribués (company_member_roles, C1a) : clé d'un profil existant (de la société ou modèle), jamais
-- « superadmin » ni « membre »
create or replace function app.member_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select m.company_id into v_company from public.company_members m where m.id = new.member_id;
  if new.role_key in ('superadmin', 'membre')
     or not exists (select 1 from public.permission_profiles p
                    where p.key = new.role_key and (p.company_id is null or p.company_id = v_company)) then
    raise exception 'Profil inconnu ou non attribuable : %', new.role_key using errcode = '22023';
  end if;
  new.granted_by := coalesce(new.granted_by, (select auth.uid()));
  return new;
end
$$;

drop trigger if exists company_member_roles_guard on public.company_member_roles;
create trigger company_member_roles_guard before insert or update on public.company_member_roles
  for each row execute function app.member_roles_guard();

revoke all on function app.role_of(uuid), app.profiles_for(uuid, uuid), app.rights_for(uuid, uuid), app.rights(),
  app.a_le_droit(text), app.a_le_droit_dans(uuid, text), app.societes_avec_droit(text), app.offer_allows(uuid, text, text),
  app.approval_can_decide(uuid, text, text, uuid, text)
  from public, anon;
grant execute on function app.role_of(uuid), app.profiles_for(uuid, uuid), app.rights_for(uuid, uuid), app.rights(),
  app.a_le_droit(text), app.a_le_droit_dans(uuid, text), app.societes_avec_droit(text), app.offer_allows(uuid, text, text),
  app.approval_can_decide(uuid, text, text, uuid, text)
  to authenticated, service_role;
revoke all on function app.profile_rights_company(), app.permission_profiles_guard(), app.profile_rights_guard(),
  app.member_rights_guard(), app.member_roles_guard() from public, anon, authenticated;
revoke all on function public.my_rights(), public.external_accountant_set_quotes(boolean) from public, anon;
grant execute on function public.my_rights(), public.external_accountant_set_quotes(boolean) to authenticated, service_role;

insert into public.schema_migrations (version) values ('0371_droits_fonctions') on conflict (version) do nothing;
