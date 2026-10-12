-- Comptes des deux techniciens fictifs (rôle « lecture », cochés techniciens dans le module). Effacés avec les données
-- de démonstration (demo_records, tbl = 'auth_users'). Remplacer [MOT_DE_PASSE] avant de l'appliquer ; le mot de passe
-- n'est jamais écrit dans le dépôt.
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
values ('00000000-0000-0000-0000-000000000000', '83c9e5db-8f89-497f-ba6d-d33e22266a0b', 'authenticated', 'authenticated', 'ronan.gourmelen@gld-demo.fr', extensions.crypt('[MOT_DE_PASSE]', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name": "Ronan Gourmelen", "first_name": "Ronan", "last_name": "GOURMELEN", "role": "lecture"}'::jsonb, now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '83c9e5db-8f89-497f-ba6d-d33e22266a0b', '83c9e5db-8f89-497f-ba6d-d33e22266a0b', '{"sub":"83c9e5db-8f89-497f-ba6d-d33e22266a0b","email":"ronan.gourmelen@gld-demo.fr","email_verified":true}'::jsonb, 'email', now(), now(), now());
update public.profiles set role = 'lecture', first_name = 'Ronan', last_name = 'GOURMELEN', display_name = 'Ronan Gourmelen', phone = '06 39 98 20 31', fonction = 'Technicien', is_active = true where id = '83c9e5db-8f89-497f-ba6d-d33e22266a0b';
insert into public.itv_technicians (profile_id, color, is_active) values ('83c9e5db-8f89-497f-ba6d-d33e22266a0b', '#C8102E', true);
insert into public.demo_records (tbl, id) values ('auth_users', '83c9e5db-8f89-497f-ba6d-d33e22266a0b');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
values ('00000000-0000-0000-0000-000000000000', '8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c', 'authenticated', 'authenticated', 'loic.prigent@gld-demo.fr', extensions.crypt('[MOT_DE_PASSE]', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name": "Loïc Prigent", "first_name": "Loïc", "last_name": "PRIGENT", "role": "lecture"}'::jsonb, now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c', '8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c', '{"sub":"8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c","email":"loic.prigent@gld-demo.fr","email_verified":true}'::jsonb, 'email', now(), now(), now());
update public.profiles set role = 'lecture', first_name = 'Loïc', last_name = 'PRIGENT', display_name = 'Loïc Prigent', phone = '06 39 98 20 32', fonction = 'Technicien', is_active = true where id = '8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c';
insert into public.itv_technicians (profile_id, color, is_active) values ('8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c', '#1D4ED8', true);
insert into public.demo_records (tbl, id) values ('auth_users', '8c39d2ee-6903-43a8-ae5b-7a7da9f7e03c');
commit;
