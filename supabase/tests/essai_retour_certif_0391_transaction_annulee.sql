-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (certif_0391) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0391_certif_referentiels.sql, retour arrière,
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

-- ===== supabase/migrations/0391_certif_referentiels.sql =====
-- 0391 : suivi et préparation de chaque certification au même endroit (décision de H du 21/10).
-- Jusqu'ici, les preuves et les écarts d'audit n'étaient rattachés qu'à un numéro d'indicateur Qualiopi : une
-- exigence APSAD ne pouvait recevoir ni preuve ni écart. Ils portent désormais leur référentiel.
--   1. cert_proofs.referential_code et cert_audit_findings.referential_code, remplis d'office par la base quand
--      l'écran ne les donne pas (référentiel Qualiopi suivi par la société) : un ancien écran continue de marcher.
--   2. Échéance d'un écart APSAD : réponse sous 3 semaines (référentiel général B0 du CNPP) ; Qualiopi inchangé
--      (3 mois pour une majeure, 6 pour une mineure).
--   3. Référentiels APSAD de service ajoutés (textes payants, aucune exigence livrée) : RIA et PIA, détection
--      incendie et CMSI, désenfumage naturel, cybersécurité des systèmes connectés (D32). Familles de matériel
--      rattachées à chaque référentiel, pour préparer l'audit à partir des visites.
-- Idempotent.

-- ── 1. Référentiel des preuves et des écarts ──
alter table public.cert_proofs add column if not exists referential_code text;
alter table public.cert_audit_findings add column if not exists referential_code text;
create index if not exists cert_proofs_ref_idx on public.cert_proofs (referential_code, indicator_number);
create index if not exists cert_audit_findings_ref_idx on public.cert_audit_findings (referential_code);

-- Familles de matériel (itv_equipment_types.family) concernées par un référentiel : comparaison sans casse
alter table public.cert_referentials add column if not exists equipment_families text[];

-- Les lignes existantes appartiennent au référentiel Qualiopi suivi par leur société
update public.cert_proofs p set referential_code = coalesce(
  (select s.referential_code from public.cert_settings s where s.company_id = p.company_id limit 1), 'rnq-2026')
where p.referential_code is null;
update public.cert_audit_findings f set referential_code = coalesce(
  (select s.referential_code from public.cert_settings s where s.company_id = f.company_id limit 1), 'rnq-2026')
where f.referential_code is null;

create or replace function app.cert_referentiel_par_defaut()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.referential_code is null then
    new.referential_code := coalesce(
      (select s.referential_code from public.cert_settings s where s.company_id = new.company_id limit 1),
      (select s.referential_code from public.cert_settings s order by s.id limit 1),
      'rnq-2026');
  end if;
  return new;
end
$$;
revoke all on function app.cert_referentiel_par_defaut() from public, anon, authenticated;

drop trigger if exists cert_proofs_referentiel on public.cert_proofs;
create trigger cert_proofs_referentiel before insert on public.cert_proofs
  for each row execute function app.cert_referentiel_par_defaut();
-- Nom en « a » : passe avant cert_findings_due, qui a besoin du référentiel pour l'échéance
drop trigger if exists a_cert_findings_referentiel on public.cert_audit_findings;
create trigger a_cert_findings_referentiel before insert on public.cert_audit_findings
  for each row execute function app.cert_referentiel_par_defaut();

-- ── 2. Échéance de réponse à un écart ──
create or replace function public.cert_findings_due()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.due_date is null and new.audit_date is not null then
    if exists (select 1 from public.cert_referentials r where r.code = new.referential_code and r.kind = 'apsad') then
      -- APSAD (référentiel général B0) : réponse aux écarts sous 3 semaines
      new.due_date := (new.audit_date + interval '21 days')::date;
    else
      new.due_date := (new.audit_date + case when new.severity = 'majeure' then interval '3 months' else interval '6 months' end)::date;
    end if;
  end if;
  return new;
end $function$;

-- Échéances du module : un écart APSAD porte le nom de son référentiel et mène à son suivi. Seul le passage des écarts
-- change dans cert_deadlines : le texte de la fonction est relu et modifié à cet endroit, sinon la migration s'arrête.
do $patch$
declare
  v_def text := pg_get_functiondef('public.cert_deadlines()'::regprocedure);
  v_anc text := $anc$  return query select 'nc_' || f.id::text, ('Non-conformité ' || f.severity || coalesce(', indicateur ' || f.indicator_number, ''))::text,
    left(f.description, 120)::text, f.due_date, '/certification/qualiopi'::text, 'action'::text
    from public.cert_audit_findings f where f.closed_at is null;$anc$;
  v_nouv text := $nouv$  return query select 'nc_' || f.id::text,
    (case when r.kind = 'apsad' then 'Écart ' || r.label || ', ' || f.severity || coalesce(', exigence ' || f.indicator_number, '')
          else 'Non-conformité ' || f.severity || coalesce(', indicateur ' || f.indicator_number, '') end)::text,
    left(f.description, 120)::text, f.due_date,
    (case when r.kind = 'apsad' then '/certification/suivi?ref=' || r.code else '/certification/qualiopi' end)::text, 'action'::text
    from public.cert_audit_findings f left join public.cert_referentials r on r.code = f.referential_code where f.closed_at is null;$nouv$;
begin
  if position(v_nouv in v_def) > 0 then return; end if;
  if position(v_anc in v_def) = 0 then
    raise exception 'cert_deadlines : passage des écarts introuvable, rien n''est modifié';
  end if;
  execute replace(v_def, v_anc, v_nouv);
end
$patch$;

-- ── 3. Référentiels APSAD de service ──
insert into public.cert_referentials (code, label, legal_ref, source_url, notes, sort_order, kind, issuer, text_source, equipment_families) values
  ('apsad-j5f5', 'APSAD J5 et F5 (RIA et PIA, validation et maintenance)', 'Règle APSAD R5, NF S 62-201',
   'https://www.cnpp.com/tester-certifier/certifier-prestations-service-apsad-incendie',
   'Texte payant : les exigences sont importées par la société depuis son exemplaire (aucune exigence livrée avec l''outil).',
   52, 'apsad', 'CNPP Cert.', 'a_saisir', array['RIA', 'PIA']),
  ('apsad-i7f7', 'APSAD I7 et F7 (détection incendie et CMSI, installation et maintenance)', 'Règle APSAD R7',
   'https://www.cnpp.com/tester-certifier/certifier-prestations-service-apsad-incendie',
   'Texte payant : les exigences sont importées par la société depuis son exemplaire. À vérifier : une alarme de type 4 sans détection relève-t-elle de F7 ?',
   54, 'apsad', 'CNPP Cert.', 'a_saisir', array['Alarme', 'Détection']),
  ('apsad-i17f17', 'APSAD I17 et F17 (désenfumage naturel, installation et maintenance)', 'Règle APSAD R17',
   'https://www.cnpp.com/tester-certifier/certifier-prestations-service-apsad-incendie',
   'Texte payant : les exigences sont importées par la société depuis son exemplaire (aucune exigence livrée avec l''outil).',
   56, 'apsad', 'CNPP Cert.', 'a_saisir', array['Désenfumage']),
  ('apsad-d32', 'APSAD D32 (cybersécurité des systèmes de sécurité connectés)', 'Document technique APSAD D32 (édition 2021)',
   'https://cybel.cnpp.com/livre-d32-apsad-standard-cybersecurity',
   'Référentiel technique de certification APSAD de service : analyse des risques, conception, réalisation et maintenance des systèmes reliés à un réseau. Texte payant, à importer depuis votre exemplaire.',
   58, 'apsad', 'CNPP Cert.', 'a_saisir', null)
on conflict (code) do nothing;

update public.cert_referentials set equipment_families = array['Extincteurs']
where code = 'apsad-i4nf285' and equipment_families is null;

insert into public.schema_migrations (version) values ('0391_certif_referentiels') on conflict (version) do nothing;

-- ===== supabase/rollback/0391_certif_referentiels_retour.sql =====
-- Retour arrière de 0391_certif_referentiels.sql : retire les référentiels APSAD ajoutés (s'ils n'ont ni copie ni
-- suivi), les familles de matériel, le référentiel des preuves et des écarts, et remet l'échéance d'origine. Idempotent.

drop trigger if exists cert_proofs_referentiel on public.cert_proofs;
drop trigger if exists a_cert_findings_referentiel on public.cert_audit_findings;
drop function if exists app.cert_referentiel_par_defaut();

create or replace function public.cert_findings_due()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.due_date is null and new.audit_date is not null then
    new.due_date := (new.audit_date + case when new.severity = 'majeure' then interval '3 months' else interval '6 months' end)::date;
  end if;
  return new;
end $function$;

-- Échéances : passage des écarts remis à l'identique
do $patch$
declare
  v_def text := pg_get_functiondef('public.cert_deadlines()'::regprocedure);
  v_anc text := $anc$  return query select 'nc_' || f.id::text, ('Non-conformité ' || f.severity || coalesce(', indicateur ' || f.indicator_number, ''))::text,
    left(f.description, 120)::text, f.due_date, '/certification/qualiopi'::text, 'action'::text
    from public.cert_audit_findings f where f.closed_at is null;$anc$;
  v_nouv text := $nouv$  return query select 'nc_' || f.id::text,
    (case when r.kind = 'apsad' then 'Écart ' || r.label || ', ' || f.severity || coalesce(', exigence ' || f.indicator_number, '')
          else 'Non-conformité ' || f.severity || coalesce(', indicateur ' || f.indicator_number, '') end)::text,
    left(f.description, 120)::text, f.due_date,
    (case when r.kind = 'apsad' then '/certification/suivi?ref=' || r.code else '/certification/qualiopi' end)::text, 'action'::text
    from public.cert_audit_findings f left join public.cert_referentials r on r.code = f.referential_code where f.closed_at is null;$nouv$;
begin
  if position(v_nouv in v_def) > 0 then execute replace(v_def, v_nouv, v_anc); end if;
end
$patch$;

delete from public.cert_referentials r
where r.code in ('apsad-j5f5', 'apsad-i7f7', 'apsad-i17f17', 'apsad-d32')
  and not exists (select 1 from public.cert_referentials c where c.code like r.code || '-%')
  and not exists (select 1 from public.cert_company_certifications c where c.referential_code = r.code)
  and not exists (select 1 from public.cert_pitfalls p where p.referential_code = r.code);

drop index if exists public.cert_proofs_ref_idx;
drop index if exists public.cert_audit_findings_ref_idx;
alter table public.cert_referentials drop column if exists equipment_families;
alter table public.cert_proofs drop column if exists referential_code;
alter table public.cert_audit_findings drop column if exists referential_code;

delete from public.schema_migrations where version = '0391_certif_referentiels';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE certif_0391 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
