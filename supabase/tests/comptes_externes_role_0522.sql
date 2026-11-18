-- Essai de 0522 : un compte extérieur ne devient pas un compte de l'équipe (ni l'inverse), même par un super
-- administrateur ; un changement de rôle dans l'équipe reste possible ; aucun profil relié à un compte de l'espace
-- client ne garde un autre rôle que « entreprise ». Rouge sans 0522. Données d'essai créées ici, tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_sa uuid := 'e0522000-0000-4000-8000-000000000001';
  v_ent uuid := 'e0522000-0000-4000-8000-000000000002';
  v_eq uuid := 'e0522000-0000-4000-8000-000000000003';
  v_ok boolean;
begin
  insert into auth.users (id, email, aud, role) values
    (v_sa, 'sa-0522@exemple.invalid', 'authenticated', 'authenticated'),
    (v_ent, 'ent-0522@exemple.invalid', 'authenticated', 'authenticated'),
    (v_eq, 'eq-0522@exemple.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, email) values (v_sa, 'sa-0522@exemple.invalid'), (v_ent, 'ent-0522@exemple.invalid'),
    (v_eq, 'eq-0522@exemple.invalid') on conflict (id) do nothing;
  alter table public.profiles disable trigger profiles_protect_role;
  update public.profiles set role = 'superadmin', is_active = true where id = v_sa;
  update public.profiles set role = 'entreprise', is_active = true where id = v_ent;
  update public.profiles set role = 'gestionnaire', is_active = true where id = v_eq;
  alter table public.profiles enable trigger profiles_protect_role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sa, 'role', 'authenticated')::text, true);

  -- 1. Client vers équipe : refusé, même pour le super administrateur
  v_ok := false;
  begin update public.profiles set role = 'lecture' where id = v_ent; exception when others then v_ok := true; end;
  if not v_ok then raise exception '1. un compte de l''espace client est passé en « Lecture seule »'; end if;
  -- 2. Équipe vers extérieur : refusé
  v_ok := false;
  begin update public.profiles set role = 'stagiaire' where id = v_eq; exception when others then v_ok := true; end;
  if not v_ok then raise exception '2. un compte de l''équipe est passé en stagiaire'; end if;
  -- 3. Changement dans l'équipe : accepté
  update public.profiles set role = 'direction' where id = v_eq;
  if (select role from public.profiles where id = v_eq) <> 'direction' then raise exception '3. changement dans l''équipe bloqué'; end if;

  -- 4. Reprise : aucun profil relié à un compte de l'espace client avec un autre rôle
  if exists (select 1 from public.client_accounts a join public.profiles p on p.id = a.profile_id where p.role <> 'entreprise') then
    raise exception '4. compte de l''espace client avec un rôle de l''équipe';
  end if;
  perform set_config('request.jwt.claims', '', true);
end $$;

rollback;
