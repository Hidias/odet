-- 0027_referents_qualite.sql : responsables et référents désignés par un compte utilisateur,
-- textes des documents qualité sans identité écrite en dur.
--
-- 1. Table quality_roles : chaque rôle qualité (responsable qualité, référents handicap, réclamations,
--    RGPD, déontologie, amélioration continue, veille, validation des programmes) pointe vers un profil.
--    Par défaut : le premier superadmin actif (sinon admin). Modifiable dans Paramètres > Qualité.
-- 2. Les textes (documents Qualiopi, désignations, organigramme, arguments d'appel) contiennent des
--    champs {{org.*}}, {{role.*}}, {{app.nom}}, {{catalogue}} remplis au moment de l'affichage
--    (src/core/org/templateContext.js). Si le nom ou l'adresse change dans Paramètres, tout suit.
-- 3. Reprise des données héritées de l'outil d'origine (faite en production le 13/10) : valeurs par défaut
--    nominatives supprimées.
-- Les mises à jour de données ne touchent que les lignes concernées : sans effet sur une base vierge.

-- ── 1. Rôles qualité ──
create table if not exists public.quality_roles (
  code text primary key,
  label text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.quality_roles enable row level security;
drop policy if exists quality_roles_select on public.quality_roles;
drop policy if exists quality_roles_write on public.quality_roles;
create policy quality_roles_select on public.quality_roles for select to authenticated using (true);
create policy quality_roles_write on public.quality_roles for all to authenticated using (true) with check (true);
revoke all on public.quality_roles from anon;
grant select, insert, update, delete on public.quality_roles to authenticated;

insert into public.quality_roles (code, label, sort_order, profile_id)
select v.code, v.label, v.sort_order,
       (select id from public.profiles
         where coalesce(is_active, true) and role in ('superadmin', 'admin')
         order by case role when 'superadmin' then 0 else 1 end, created_at
         limit 1)
  from (values
    ('responsable_qualite',   'Responsable qualité',                      10),
    ('referent_handicap',     'Référent handicap',                        20),
    ('referent_reclamations', 'Référent réclamations',                    30),
    ('referent_rgpd',         'Délégué à la protection des données (RGPD)', 40),
    ('referent_deontologie',  'Référent déontologie',                     50),
    ('referent_amelioration', 'Référent amélioration continue',           60),
    ('referent_veille',       'Référent veille',                          70),
    ('validation_programmes', 'Validation des programmes',                80)
  ) as v(code, label, sort_order)
on conflict (code) do nothing;

-- Nom affiché du titulaire d'un rôle (vide si non désigné)
create or replace function public.quality_role_name(p_code text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(nullif(trim(concat_ws(' ', p.first_name, upper(p.last_name))), ''), nullif(trim(p.display_name), ''), p.email, '')
    from public.quality_roles r
    left join public.profiles p on p.id = r.profile_id
   where r.code = p_code;
$function$;
revoke all on function public.quality_role_name(text) from public, anon;
grant execute on function public.quality_role_name(text) to authenticated;

-- Réclamation sans responsable : le référent réclamations
create or replace function public.reclamations_default_responsable()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.responsable is null or trim(new.responsable) = '' then
    new.responsable := nullif(public.quality_role_name('referent_reclamations'), '');
  end if;
  return new;
end;
$function$;
create or replace trigger trg_reclamations_default_responsable
  before insert on public.reclamations
  for each row execute function public.reclamations_default_responsable();

-- ── 2. Valeurs par défaut nominatives ──
alter table public.invoices alter column created_by drop default;
alter table public.quotes alter column created_by drop default;
alter table public.invoice_payments alter column created_by drop default;
alter table public.reclamations alter column responsable drop default;
alter table public.prospect_calls alter column called_by drop default;
alter table public.org_settings alter column name drop default;
alter table public.organization_settings alter column name set default '';
alter table public.mailing_campaigns alter column signature_caller set default '';
alter table public.mailing_templates alter column signature_caller set default '';
alter table public.budget_transaction_invoices alter column reconciled_by drop default;
alter table public.bpf_declarations alter column org_name drop default;
alter table public.bpf_declarations alter column org_siret drop default;
alter table public.bpf_declarations alter column org_nda drop default;
alter table public.bpf_declarations alter column org_address drop default;
alter table public.bpf_declarations alter column org_dirigeant drop default;

-- ── 3. Documents Qualiopi (HTML) : champs remplis à l'affichage ──
-- La reprise des textes de l'outil d'origine a été faite en production le 13/10 ; sans objet pour une nouvelle
-- instance (les modèles livrés contiennent déjà les champs).


-- Livret : catalogue de l'organisme lu dans les formations
update public.qualiopi_documents
   set content = substring(content from 1 for position('<div class="formation-list">' in content) - 1)
              || E'<div class="formation-list">{{catalogue}}</div>\n            </div>\n\n            '
              || substring(content from position('<!-- INFORMATIONS PRATIQUES -->' in content)),
       updated_at = now()
 where type = 'livret'
   and position('<div class="formation-list">' in content) > 0
   and position('<!-- INFORMATIONS PRATIQUES -->' in content) > position('<div class="formation-list">' in content)
   and content not like '%{{catalogue}}%';

-- ── 4. Documents qualité éditables : désignations et organigramme ──
update public.quality_documents
   set content = jsonb_set(content, '{personne}', to_jsonb(
         case doc_id
           when 'des-qual' then '{{role.responsable_qualite}}'
           when 'des-hand' then '{{role.referent_handicap}}'
           when 'des-recl' then '{{role.referent_reclamations}}'
           when 'des-rgpd' then '{{role.referent_rgpd}}'
           when 'des-deon' then '{{role.referent_deontologie}}'
           when 'des-amel' then '{{role.referent_amelioration}}'
           when 'des-veil' then '{{role.referent_veille}}'
         end)),
       updated_at = now()
 where doc_id in ('des-qual', 'des-hand', 'des-recl', 'des-rgpd', 'des-deon', 'des-amel', 'des-veil')
   and content ? 'personne'
   and content->>'personne' not like '{{%';

update public.quality_documents
   set content = jsonb_build_object(
         'direction', jsonb_build_array(jsonb_build_object(
           'nom', '{{org.dirigeant}}',
           'roles', (select coalesce(jsonb_agg(distinct r), '[]'::jsonb)
                       from jsonb_array_elements(content->'direction') d, jsonb_array_elements_text(d->'roles') r))),
         'formateurs', (select coalesce(jsonb_agg(jsonb_build_object(
                           'nom', concat_ws(' ', t.first_name, upper(t.last_name)),
                           'specialites', coalesce(to_jsonb(t.qualifications_list), '[]'::jsonb))), '[]'::jsonb)
                          from public.trainers t)),
       updated_at = now()
 where doc_id = 'organigramme'
   and content::text not like '%{{org.dirigeant}}%';


-- ── 5. Registres et historiques ──



-- Lien d'inscription personnel (email et clé dans l'adresse) : adresse réduite à la page publique
update public.veille_qualiopi
   set description = regexp_replace(description, '(https://app\.livestorm\.co/[^\s?]*)\?[^\s]*email=[^\s]*', '\1', 'g'),
       updated_at = now()
 where description ~ 'livestorm\.co/[^\s]*email=';






-- Référent handicap des paramètres (portail, PDF) : titulaire du rôle s'il n'est pas renseigné
update public.organization_settings
   set referent_handicap_nom = nullif(public.quality_role_name('referent_handicap'), '')
 where coalesce(trim(referent_handicap_nom), '') = '';

insert into public.schema_migrations (version) values ('0027_referents_qualite') on conflict (version) do nothing;
