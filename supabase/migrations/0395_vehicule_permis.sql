-- 0395 : permis vérifié à l'attribution d'un véhicule (liste unique A5).
-- L'employeur qui confie un véhicule doit s'assurer que le conducteur détient un permis valable. Quand le module RH
-- est actif pour la société du véhicule et que le conducteur a une fiche du personnel, l'attribution est refusée
-- sans titre « Permis de conduire » en cours (non archivé, non suspendu, non échu à la date de début).
-- Sans fiche du personnel, rien n'est bloqué (rien à vérifier) : l'écran le signale. Les attributions déjà
-- enregistrées ne sont pas touchées. Idempotent.

create or replace function app.permis_motif(p_company uuid, p_profile uuid, p_person uuid, p_date date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := p_person;
begin
  if not exists (select 1 from public.company_modules m where m.company_id = p_company and m.key = 'rh' and m.enabled) then
    return null;
  end if;
  if v_person is null and p_profile is not null then
    select p.id into v_person from public.hr_people p
    where p.profile_id = p_profile and p.archived_at is null and p.company_id = p_company limit 1;
  end if;
  if v_person is null then return null; end if;
  if exists (select 1 from public.hr_qualifications q
             where q.person_id = v_person and q.kind = 'permis' and q.archived_at is null and q.suspended_at is null
               and (q.expires_on is null or q.expires_on >= coalesce(p_date, current_date))) then
    return null;
  end if;
  return 'Permis de conduire absent, échu ou suspendu dans le dossier du personnel';
end
$$;
revoke all on function app.permis_motif(uuid, uuid, uuid, date) from public, anon, authenticated;

-- Vérification pour l'écran, avant d'attribuer : null si tout va bien, sinon le motif ; « sans_fiche » si le
-- conducteur n'a pas de fiche du personnel (rien n'a pu être vérifié)
create or replace function public.vehicule_permis_verifier(p_vehicle uuid, p_profile uuid, p_date date default current_date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_co uuid;
begin
  select v.company_id into v_co from public.vehicles v where v.id = p_vehicle;
  if v_co is null or not (v_co in (select app.societes_avec_droit('vehicules.parc.gerer'))) then
    raise exception 'Véhicule introuvable ou non accessible' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_modules m where m.company_id = v_co and m.key = 'rh' and m.enabled)
     and not exists (select 1 from public.hr_people p where p.profile_id = p_profile and p.archived_at is null and p.company_id = v_co) then
    return 'sans_fiche';
  end if;
  return app.permis_motif(v_co, p_profile, null, p_date);
end
$$;
revoke all on function public.vehicule_permis_verifier(uuid, uuid, date) from public, anon;
grant execute on function public.vehicule_permis_verifier(uuid, uuid, date) to authenticated;

create or replace function app.vehicule_attribution_permis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motif text;
begin
  if new.end_on is not null then return new; end if;
  if tg_op = 'UPDATE' and new.profile_id is not distinct from old.profile_id and new.person_id is not distinct from old.person_id
     and new.start_on is not distinct from old.start_on then
    return new;
  end if;
  v_motif := app.permis_motif(new.company_id, new.profile_id, new.person_id, new.start_on);
  if v_motif is not null then
    raise exception '%', v_motif using errcode = '23514',
      hint = 'Ajoutez le permis dans Personnel, fiche de la personne, Habilitations et titres.';
  end if;
  return new;
end
$$;
revoke all on function app.vehicule_attribution_permis() from public, anon, authenticated;
drop trigger if exists vehicle_assignments_permis on public.vehicle_assignments;
create trigger vehicle_assignments_permis before insert or update of profile_id, person_id, start_on on public.vehicle_assignments
  for each row execute function app.vehicule_attribution_permis();

insert into public.schema_migrations (version) values ('0395_vehicule_permis') on conflict (version) do nothing;
