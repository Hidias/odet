-- 0111_parametres_complements.sql : réglages qui étaient écrits en dur dans le code.
--
-- 1. email_sync_ignored : adresses (ou « @domaine ») à ne jamais signaler dans le suivi des emails envoyés.
-- 2. bank_overdraft : découvert autorisé sur le compte professionnel (module Budget), 0 = aucun.
-- 3. ai_profile : objet jsonb (déjà présent) ; on garantit un objet vide plutôt que null.
-- Migration additive : aucune donnée existante n'est modifiée.

alter table public.organization_settings add column if not exists email_sync_ignored text;
comment on column public.organization_settings.email_sync_ignored is 'Adresses ou @domaines ignorés par le suivi des emails envoyés (séparés par virgule, espace ou point-virgule)';

alter table public.organization_settings add column if not exists bank_overdraft numeric(12,2) not null default 0;
comment on column public.organization_settings.bank_overdraft is 'Découvert autorisé du compte professionnel, en euros (0 = aucun)';

alter table public.organization_settings alter column ai_profile set default '{}'::jsonb;

insert into public.schema_migrations (version) values ('0111_parametres_complements') on conflict (version) do nothing;
