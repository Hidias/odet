-- 0012_org_modules_description.sql : description courte des modules (assistant de configuration, console)

alter table public.org_modules add column if not exists description text;

update public.org_modules set description = v.d from (values
  ('formation', 'Catalogue, sessions, stagiaires, formateurs, documents, tests et quiz'),
  ('portail', 'Émargement par signature, fiches, positionnement, évaluations en ligne'),
  ('prevention', 'Certifications SST, FORPREV, habilitations'),
  ('qualite', 'Processus Qualiopi, indicateurs, non-conformités, BPF, veille'),
  ('commercial', 'Clients, contacts, devis, factures, avoirs'),
  ('prospection', 'Base de prospects, suivi commercial, rendez-vous'),
  ('mailing', 'Campagnes email et désinscriptions'),
  ('finance', 'Relevés bancaires, catégories, justificatifs, trésorerie'),
  ('comptabilite', 'Accès dédié au cabinet comptable'),
  ('duerp', 'Document unique : unités, risques, plan d''action'),
  ('social', 'Publications programmées sur les réseaux'),
  ('interventions', 'Interventions, tournées de techniciens (à venir)'),
  ('rh', 'Collaborateurs, habilitations, visites médicales (à venir)'),
  ('frais', 'Notes de frais des collaborateurs (à venir)')
) as v(k, d) where org_modules.key = v.k;

insert into public.schema_migrations (version) values ('0012_org_modules_description') on conflict (version) do nothing;
