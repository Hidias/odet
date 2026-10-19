-- Retour arrière de 0313_rh_registre.sql : retire les colonnes du registre. Idempotent.
-- Refusé si l'une d'elles a été remplie (données du personnel : à exporter d'abord).

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_people' and column_name = 'nationality')
     and exists (select 1 from public.hr_people where nationality is not null or gender is not null or work_permit_type is not null or work_permit_ref is not null) then
    raise exception 'Retour arrière refusé : des fiches portent nationalité, sexe ou autorisation de travail (à exporter d''abord)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_employments' and column_name = 'agency_name')
     and exists (select 1 from public.hr_employments where agency_name is not null or agency_address is not null or authorization_on is not null) then
    raise exception 'Retour arrière refusé : des contrats portent une entreprise de travail temporaire ou une autorisation (à exporter d''abord)';
  end if;
end $$;

alter table public.hr_people drop constraint if exists hr_people_gender_check;
alter table public.hr_people drop column if exists work_permit_ref;
alter table public.hr_people drop column if exists work_permit_type;
alter table public.hr_people drop column if exists gender;
alter table public.hr_people drop column if exists nationality;
alter table public.hr_employments drop column if exists authorization_on;
alter table public.hr_employments drop column if exists agency_address;
alter table public.hr_employments drop column if exists agency_name;

delete from public.schema_migrations where version = '0313_rh_registre';
