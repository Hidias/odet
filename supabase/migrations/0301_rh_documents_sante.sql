-- 0301_rh_documents_sante.sql : chantier 12, module RH, documents et santé au travail (spec odet-spec-rh.md § 2, 3.3,
-- 4 et 5, branche rh/documents-sante).
--
-- Documents du personnel (hr_documents) rangés dans le bucket PRIVÉ « rh », servis seulement par liens signés.
-- Chemin d'un fichier : <société>/<personne>/<fichier>. Confidentialité :
--   - normal (contrat, avenant, fiche de poste, attestation, titre) : « Voir les dossiers du personnel » ;
--   - restreint (justificatif d'absence, document de santé au travail) : « Voir les documents restreints » ;
--   - privé (bulletin de paie) : « Voir les documents restreints » ;
--   - la personne voit toujours les siens et dépose ses justificatifs (restreint).
-- Ouverture par public.hr_document_ouvrir() : contrôle les droits, écrit au journal d'audit chaque consultation d'un
-- document restreint ou privé par quelqu'un d'autre que la personne, rend le chemin du fichier (lien signé ensuite).
-- Habilitations et titres du personnel (hr_qualifications) : échéance, organisme, document, règle d'obligation (lot 2)
-- et session de l'organisme facultatives.
-- Suivi de santé au travail ADMINISTRATIF seulement (hr_medical_followups) : type de visite, date, prochaine
-- échéance, conclusion, aménagement à respecter (texte court). Jamais de diagnostic, de motif ni de traitement.
-- Échéances (vue v_hr_echeances, droits de la personne qui lit) : habilitations, visites, fins de CDD et d'essai.
-- Droits (build_suite('0301')) : voir regles.py, chantier 12, RH documents et santé ; isolement par société.
-- Journal : tables tracées par app.audit_row (champs modifiés, jamais les valeurs).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0301_rh_documents_sante_retour.sql

create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  employment_id uuid references public.hr_employments(id) on delete set null,
  category text not null default 'autre'
    check (category in ('contrat', 'avenant', 'fiche_poste', 'attestation', 'titre', 'justificatif', 'sante', 'bulletin', 'autre')),
  confidentiality text not null default 'normal' check (confidentiality in ('normal', 'restreint', 'prive')),
  title text not null check (length(btrim(title)) > 0),
  doc_date date,
  file_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes bigint,
  retention_until date,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Justificatifs et santé jamais « normal », bulletins toujours « privé »
  constraint hr_documents_confidentialite check (
    (category not in ('justificatif', 'sante') or confidentiality <> 'normal')
    and (category <> 'bulletin' or confidentiality = 'prive')),
  constraint hr_documents_chemin check (file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/.+')
);
create index if not exists hr_documents_company_idx on public.hr_documents (company_id);
create index if not exists hr_documents_person_idx on public.hr_documents (person_id);
comment on table public.hr_documents is 'Documents du personnel (bucket privé rh, liens signés) ; confidentialité normal, restreint, privé';

create table if not exists public.hr_qualifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  kind text not null default 'autre'
    check (kind in ('habilitation_electrique', 'autorisation_conduite', 'sst', 'incendie', 'apsad', 'permis', 'autre')),
  label text not null check (length(btrim(label)) > 0),
  obtained_on date,
  expires_on date,
  issuer text,
  document_id uuid references public.hr_documents(id) on delete set null,
  obligation_rule_id uuid references public.obligation_rules(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_qualifications_dates check (expires_on is null or obtained_on is null or expires_on >= obtained_on)
);
create index if not exists hr_qualifications_company_idx on public.hr_qualifications (company_id);
create index if not exists hr_qualifications_person_idx on public.hr_qualifications (person_id);
create index if not exists hr_qualifications_echeance_idx on public.hr_qualifications (company_id, expires_on) where archived_at is null;
comment on table public.hr_qualifications is 'Habilitations et titres du personnel : obtention, échéance, organisme, document';

create table if not exists public.hr_medical_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.company_default() references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  visit_type text not null default 'periodique'
    check (visit_type in ('information_prevention', 'embauche', 'periodique', 'reprise', 'prereprise', 'mi_carriere', 'demande')),
  visit_on date,
  next_due_on date,
  conclusion text check (conclusion is null or conclusion in ('apte', 'apte_amenagements', 'inapte', 'sans_avis')),
  accommodation text check (accommodation is null or length(accommodation) <= 300),
  document_id uuid references public.hr_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_medical_followups_date check (visit_on is not null or next_due_on is not null)
);
create index if not exists hr_medical_followups_company_idx on public.hr_medical_followups (company_id);
create index if not exists hr_medical_followups_person_idx on public.hr_medical_followups (person_id);
comment on table public.hr_medical_followups is 'Suivi de santé au travail, administratif seulement (aucun élément médical)';
comment on column public.hr_medical_followups.accommodation is 'Aménagement à respecter, sans aucun élément médical (300 caractères au plus)';

do $$
declare t text;
begin
  foreach t in array array['hr_documents', 'hr_qualifications', 'hr_medical_followups'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_maj', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_h_maj()', t || '_maj', t);
  end loop;
end $$;

-- Même société que la personne ; document joint de la même personne ; document « santé » joint au suivi
create or replace function app.hr_ds_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.hr_documents;
begin
  if not exists (select 1 from public.hr_people p where p.id = new.person_id and p.company_id = new.company_id) then
    raise exception 'RH : la personne appartient à une autre société' using errcode = '23514';
  end if;
  if tg_table_name = 'hr_documents' then
    if new.employment_id is not null and not exists (select 1 from public.hr_employments e where e.id = new.employment_id and e.person_id = new.person_id) then
      raise exception 'Document : le contrat est celui d''une autre personne' using errcode = '23514';
    end if;
    if split_part(new.file_path, '/', 1) <> new.company_id::text or split_part(new.file_path, '/', 2) <> new.person_id::text then
      raise exception 'Document : le fichier n''est pas rangé dans le dossier de la personne' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.file_path <> old.file_path then
      raise exception 'Document : le fichier ne se remplace pas (déposez un nouveau document)' using errcode = '23514';
    end if;
  else
    if new.document_id is not null then
      select * into v_doc from public.hr_documents d where d.id = new.document_id;
      if v_doc.person_id is distinct from new.person_id then
        raise exception 'Le document joint est celui d''une autre personne' using errcode = '23514';
      end if;
      if tg_table_name = 'hr_medical_followups' and v_doc.confidentiality = 'normal' then
        raise exception 'Santé au travail : le document joint doit être restreint' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.hr_ds_garde() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['hr_documents', 'hr_qualifications', 'hr_medical_followups'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_garde', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.hr_ds_garde()', t || '_garde', t);
  end loop;
end $$;

-- Ouvrir un document : contrôle des droits (mêmes conditions que la règle de lecture), journal des consultations
-- d'un document restreint ou privé par quelqu'un d'autre que la personne, chemin du fichier pour le lien signé
create or replace function public.hr_document_ouvrir(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.hr_documents;
  v_moi boolean;
begin
  select * into v_d from public.hr_documents d where d.id = p_doc;
  if v_d.id is null then raise exception 'Document introuvable' using errcode = 'P0002'; end if;
  v_moi := v_d.person_id in (select app.hr_mes_personnes());
  if not (v_moi
          or (v_d.confidentiality = 'normal' and v_d.company_id in (select app.societes_avec_droit('rh.dossiers.voir')))
          or (v_d.confidentiality <> 'normal' and v_d.company_id in (select app.societes_avec_droit('rh.documents.restreints')))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if v_d.confidentiality <> 'normal' and not v_moi then
    insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
    values ('view', 'document_rh', v_d.id, null,
            jsonb_build_object('table', 'hr_documents', 'confidentialite', v_d.confidentiality, 'categorie', v_d.category),
            v_d.company_id, 'base');
  end if;
  return v_d.file_path;
end
$$;
revoke all on function public.hr_document_ouvrir(uuid) from public, anon;
grant execute on function public.hr_document_ouvrir(uuid) to authenticated;

-- Bucket privé « rh » : lecture d'un fichier si la ligne du document est lisible (règles de hr_documents) ; dépôt
-- dans le dossier d'une société où l'on tient les dossiers, ou dans son propre dossier ; suppression par qui tient
-- les dossiers (les documents restreints et privés : avec « Voir les documents restreints »)
create or replace function app.hr_fichier_supprimable(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(p_path, '/', 1) in (select x::text from app.societes_avec_droit('rh.dossiers.gerer') x)
     and (not exists (select 1 from public.hr_documents d where d.file_path = p_path and d.confidentiality <> 'normal')
          or split_part(p_path, '/', 1) in (select x::text from app.societes_avec_droit('rh.documents.restreints') x))
$$;
revoke all on function app.hr_fichier_supprimable(text) from public, anon;
grant execute on function app.hr_fichier_supprimable(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rh', 'rh', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists rh_lire on storage.objects;
drop policy if exists rh_creer on storage.objects;
drop policy if exists rh_supprimer on storage.objects;
create policy rh_lire on storage.objects for select to authenticated
  using (bucket_id = 'rh' and exists (select 1 from public.hr_documents d where d.file_path = objects.name));
create policy rh_creer on storage.objects for insert to authenticated
  with check (bucket_id = 'rh' and (
    (storage.foldername(name))[1] in (select x::text from app.societes_avec_droit('rh.dossiers.gerer') x)
    or (storage.foldername(name))[2] in (select x::text from app.hr_mes_personnes() x)));
create policy rh_supprimer on storage.objects for delete to authenticated
  using (bucket_id = 'rh' and (select app.hr_fichier_supprimable(objects.name)));

-- Échéances à venir et dépassées : habilitations, visites de santé au travail, fins de CDD et de période d'essai.
-- Vue aux droits de la personne qui lit (security_invoker) : chacun ne voit que ce que les règles lui montrent.
create or replace view public.v_hr_echeances with (security_invoker = true) as
  select q.company_id, q.person_id, 'habilitation'::text as kind, q.label, q.expires_on as due_on, q.id as source_id
  from public.hr_qualifications q
  where q.archived_at is null and q.expires_on is not null
  union all
  select m.company_id, m.person_id, 'visite', 'Visite de santé au travail', m.next_due_on, m.id
  from public.hr_medical_followups m
  where m.next_due_on is not null
    and not exists (select 1 from public.hr_medical_followups m2
                    where m2.person_id = m.person_id and m2.visit_on is not null and m2.visit_on >= m.next_due_on)
  union all
  select e.company_id, e.person_id, 'fin_contrat', 'Fin de contrat', e.end_on, e.id
  from public.hr_employments e
  where e.end_on is not null and e.end_on >= current_date - 30
  union all
  select e.company_id, e.person_id, 'fin_essai', 'Fin de la période d''essai', e.trial_end_on, e.id
  from public.hr_employments e
  where e.trial_end_on is not null and e.trial_end_on >= current_date - 30;
comment on view public.v_hr_echeances is 'Échéances RH (habilitations, visites, fins de CDD et d''essai), aux droits du lecteur';
revoke all on public.v_hr_echeances from public, anon;
grant select on public.v_hr_echeances to authenticated;

-- Journal : documents, habilitations, suivi de santé (champs modifiés, jamais les valeurs)
do $$
declare r record;
begin
  for r in select * from (values ('hr_documents', 'document_rh'), ('hr_qualifications', 'personnel'), ('hr_medical_followups', 'sante_travail')) as t(nom, type) loop
    execute format('drop trigger if exists zz_audit_row on public.%I', r.nom);
    execute format('create trigger zz_audit_row after insert or update or delete on public.%I for each row execute function app.audit_row(%L)', r.nom, r.type);
  end loop;
end $$;

-- ── Droits des tables ──
alter table public.hr_documents enable row level security;
alter table public.hr_qualifications enable row level security;
alter table public.hr_medical_followups enable row level security;
revoke all on table public.hr_documents, public.hr_qualifications, public.hr_medical_followups from public, anon;
grant select, insert, update, delete on table public.hr_documents, public.hr_qualifications, public.hr_medical_followups to authenticated;
grant all on table public.hr_documents, public.hr_qualifications, public.hr_medical_followups to service_role;

-- ── Règles (générées par scripts/securite/regles.py, build_suite('0301')) ──


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['hr_documents', 'hr_medical_followups', 'hr_qualifications'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- hr_documents
select pg_temp.regles(array['hr_documents'], null,
  $r$(person_id in (select app.hr_mes_personnes()) or (confidentiality = 'normal' and company_id in (select app.societes_avec_droit('rh.dossiers.voir'))) or (confidentiality <> 'normal' and company_id in (select app.societes_avec_droit('rh.documents.restreints'))))$r$,
  $r$((company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints')))) or (person_id in (select app.hr_mes_personnes()) and category = 'justificatif' and confidentiality = 'restreint'))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints'))))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and (confidentiality = 'normal' or company_id in (select app.societes_avec_droit('rh.documents.restreints'))))$r$);

-- hr_medical_followups
select pg_temp.regles(array['hr_medical_followups'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.documents.restreints')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints')))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints')))$r$,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.gerer')) and company_id in (select app.societes_avec_droit('rh.documents.restreints')))$r$);

-- hr_qualifications
select pg_temp.regles(array['hr_qualifications'], null,
  $r$(company_id in (select app.societes_avec_droit('rh.dossiers.voir')) or person_id in (select app.hr_mes_personnes()))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$,
  $r$company_id in (select app.societes_avec_droit('rh.dossiers.gerer'))$r$);


do $$
declare t text;
begin
  foreach t in array array['hr_documents', 'hr_qualifications', 'hr_medical_followups'] loop
    execute format('drop policy if exists %I on public.%I', t || '_societe_lire', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_creer', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_modifier', t);
    execute format('drop policy if exists %I on public.%I', t || '_societe_supprimer', t);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (company_id in (select app.societes_lisibles()))', t || '_societe_lire', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (company_id in (select app.societes_ecriture()))', t || '_societe_creer', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (company_id in (select app.societes_ecriture())) with check (company_id in (select app.societes_ecriture()))', t || '_societe_modifier', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (company_id in (select app.societes_ecriture()))', t || '_societe_supprimer', t);
  end loop;
end $$;

insert into public.schema_migrations (version) values ('0301_rh_documents_sante') on conflict (version) do nothing;
