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
