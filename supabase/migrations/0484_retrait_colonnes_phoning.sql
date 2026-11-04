-- 0484 : retrait des colonnes du briefing phoning de l'ancien outil (B2, retraits acceptés par H le 04/11).
-- mailing_campaigns.phoning_message, phoning_notes, phoning_active, phoning_active_until : plus aucun écran ni
-- aucune tâche ne les lit ou ne les écrit depuis #274 (briefing de Mailing et contexte d'appel retirés).
-- Export préalable : au 04/11 en production, 0 campagne, donc rien à exporter. Garde-fou : la migration s'arrête
-- si une campagne porte encore un briefing, pour ne jamais effacer de contenu sans export.
-- La table phoning_sessions (vide) reste : elle figure dans les règles de droits, son retrait est un chantier à part.
-- Aucune vue ni fonction ne dépend de ces colonnes (pg_depend vérifié le 04/11).
-- Idempotente. Retour arrière : supabase/rollback/0484_retrait_colonnes_phoning_retour.sql (colonnes recréées vides).

do $$
declare
  n integer := 0;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'mailing_campaigns' and column_name = 'phoning_message') then
    execute $q$
      select count(*) from public.mailing_campaigns
      where coalesce(btrim(phoning_message), '') <> ''
         or coalesce(phoning_active, false)
         or phoning_active_until is not null
         or coalesce(jsonb_array_length(case when jsonb_typeof(phoning_notes) = 'array' then phoning_notes end), 0) > 0
         or (phoning_notes is not null and jsonb_typeof(phoning_notes) <> 'array')
    $q$ into n;
  end if;
  if n > 0 then
    raise exception '0484 : % campagne(s) portent encore un briefing phoning : exporter leur contenu avant de retirer les colonnes', n;
  end if;
end
$$;

alter table public.mailing_campaigns
  drop column if exists phoning_message,
  drop column if exists phoning_notes,
  drop column if exists phoning_active,
  drop column if exists phoning_active_until;
