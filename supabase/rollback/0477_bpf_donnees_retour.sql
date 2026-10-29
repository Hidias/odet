-- Retour arrière de 0477 (BPF au format 10443*17)
-- Refuse s'il existe deux déclarations pour la même année (une par société) : l'ancienne contrainte « une par année »
-- ne pourrait pas être remise sans en supprimer une ; à décider avec H.
do $$
begin
  if exists (select 1 from public.bpf_declarations group by year having count(*) > 1) then
    raise exception 'Retour arrière 0477 refusé : plusieurs déclarations pour une même année';
  end if;
end $$;
drop function if exists public.bpf_calculer(integer, uuid);
drop index if exists public.bpf_declarations_societe_annee;
alter table public.bpf_declarations add constraint bpf_declarations_year_key unique (year);
alter table public.bpf_declarations drop constraint if exists bpf_declarations_saisies_check;
alter table public.bpf_declarations drop column if exists saisies;
alter table public.bpf_declarations drop column if exists calcul;
alter table public.bpf_declarations drop column if exists cerfa_version;
alter table public.session_trainees drop constraint if exists session_trainees_bpf_categorie_check;
alter table public.session_trainees drop column if exists bpf_categorie;
alter table public.courses drop constraint if exists courses_nsf_code_fkey;
alter table public.courses drop constraint if exists courses_bpf_fiche_check;
alter table public.courses drop constraint if exists courses_bpf_niveau_check;
alter table public.courses drop constraint if exists courses_bpf_objectif_check;
alter table public.courses drop column if exists nsf_code;
alter table public.courses drop column if exists bpf_fiche;
alter table public.courses drop column if exists bpf_rncp_niveau;
alter table public.courses drop column if exists bpf_objectif;
-- Règles d'avant 0477 (générées par 0373 : lire avec « voir les registres », créer avec « signaler »)
drop policy if exists bpf_declarations_lire on public.bpf_declarations;
create policy bpf_declarations_lire on public.bpf_declarations for select to authenticated
  using ((((select app.module_on('qualite')) and (select app.a_le_droit('qualite.registres.voir'))) or (select app.is_superadmin())));
drop policy if exists bpf_declarations_creer on public.bpf_declarations;
create policy bpf_declarations_creer on public.bpf_declarations for insert to authenticated
  with check (((select app.module_on('qualite')) and (select app.a_le_droit('qualite.registres.signaler'))));
drop table if exists public.bpf_specialites;
delete from app.tables_avant_societes where table_name = 'bpf_specialites';
delete from public.schema_migrations where version = '0477_bpf_donnees';
