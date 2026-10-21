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
