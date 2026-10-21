-- Données de la base locale d'essai (scripts/securite/base_locale.py) : quelques lignes et des comptes
-- répartis comme en production (constat du 18/10/2026 : 1 superadmin, 4 admin dont un inactif, 2 direction,
-- 1 gestionnaire, 1 formateur, 1 comptable, 5 lecture dont 3 cochés techniciens ; 17 modules).
-- Tout est fictif. Jamais lancé sur la production.

update public.org_modules set enabled = key in ('certification', 'commercial', 'duerp', 'formation', 'interventions',
  'passeport', 'portail', 'prevention', 'qualite', 'suivi_formatif');

insert into auth.users (id, email, aud, role)
select x.id::uuid, x.email, 'authenticated', 'authenticated' from (values
  ('00000000-0000-4000-8000-000000000001', 'local.sa@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'local.ad1@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000003', 'local.ad2@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000004', 'local.ad3@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000005', 'local.ad4@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000006', 'local.dir1@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000007', 'local.dir2@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000008', 'local.ges@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000009', 'local.for@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000010', 'local.cpt@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000011', 'local.lec1@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000012', 'local.lec2@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000013', 'local.tech1@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000014', 'local.tech2@exemple.invalid'),
  ('00000000-0000-4000-8000-000000000015', 'local.tech3@exemple.invalid')) x(id, email)
on conflict (id) do nothing;

alter table public.profiles disable trigger user;
insert into public.profiles (id, email, role, is_active, display_name, fonction)
select x.id::uuid, x.email, x.role, x.actif, x.nom, x.fonction from (values
  ('00000000-0000-4000-8000-000000000001', 'local.sa@exemple.invalid', 'superadmin', true, 'Local SA', null),
  ('00000000-0000-4000-8000-000000000002', 'local.ad1@exemple.invalid', 'admin', true, 'Local Admin 1', 'Associé'),
  ('00000000-0000-4000-8000-000000000003', 'local.ad2@exemple.invalid', 'admin', true, 'Local Admin 2', 'Associé'),
  ('00000000-0000-4000-8000-000000000004', 'local.ad3@exemple.invalid', 'admin', true, 'Essai Admin', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000005', 'local.ad4@exemple.invalid', 'admin', false, 'Ancien', null),
  ('00000000-0000-4000-8000-000000000006', 'local.dir1@exemple.invalid', 'direction', true, 'Local Direction', 'Ressources humaines'),
  ('00000000-0000-4000-8000-000000000007', 'local.dir2@exemple.invalid', 'direction', false, 'Essai Direction', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000008', 'local.ges@exemple.invalid', 'gestionnaire', false, 'Essai Gestionnaire', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000009', 'local.for@exemple.invalid', 'formateur', false, 'Essai Formateur', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000010', 'local.cpt@exemple.invalid', 'comptable', false, 'Essai Comptable', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000011', 'local.lec1@exemple.invalid', 'lecture', false, 'Essai Lecture', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000012', 'local.lec2@exemple.invalid', 'lecture', false, 'Essai Lecture 2', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000013', 'local.tech1@exemple.invalid', 'lecture', false, 'Essai Technicien', 'Compte d''essai (recette)'),
  ('00000000-0000-4000-8000-000000000014', 'local.tech2@exemple.invalid', 'lecture', true, 'Technicien fictif 1', null),
  ('00000000-0000-4000-8000-000000000015', 'local.tech3@exemple.invalid', 'lecture', true, 'Technicien fictif 2', null)) x(id, email, role, actif, nom, fonction)
on conflict (id) do nothing;
alter table public.profiles enable trigger user;

insert into public.itv_technicians (profile_id, is_active) values
  ('00000000-0000-4000-8000-000000000013', true), ('00000000-0000-4000-8000-000000000014', true),
  ('00000000-0000-4000-8000-000000000015', true)
on conflict (profile_id) do nothing;

insert into public.clients (name, city) values ('Local client A', 'Morlaix'), ('Local client B', 'Brest');
insert into public.quotes (reference, client_id, status, total_ht)
select 'DEV-LOCAL-0001', id, 'sent', 100 from public.clients where name = 'Local client A';
insert into public.invoices (reference, client_id, status, total_ht, total_ttc)
select 'FACT-LOCAL-0001', id, 'due', 100, 120 from public.clients where name = 'Local client A';
insert into public.invoices (reference, client_id, status, total_ht, total_ttc)
select 'FACT-LOCAL-0002', id, 'draft', 50, 60 from public.clients where name = 'Local client B';
insert into public.prospection_massive (siren, name, city) values ('123456789', 'Local prospect', 'Vannes');
insert into public.budget_categories (name, direction, type) values ('Local catégorie', 'depense', 'variable');
insert into public.notifications (type, title) values ('info', 'Local notification');
insert into public.itv_parts (name, unit, price_ht) values ('Local pièce', 'unité', 12.5);
