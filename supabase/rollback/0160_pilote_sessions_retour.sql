-- Retour arrière de 0160_pilote_sessions.sql : retire la génération des étapes de session, le module « pilote », les
-- colonnes session_id et blocked_reason et les nouveaux types de relances. Idempotent.
-- Refusé si une étape du pilote a déjà été validée, envoyée ou ignorée ; celles encore à valider sont retirées.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scheduled_actions' and column_name = 'session_id') then
    if exists (select 1 from public.scheduled_actions
               where (session_id is not null or kind in ('emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon')
                      or dedup_key like 'impaye:%') and status <> 'a_valider') then
      raise exception 'Retour arrière refusé : des étapes du pilote ont été traitées';
    end if;
    delete from public.scheduled_actions
    where session_id is not null or kind in ('emargement_manquant', 'eval_chaud', 'attestations', 'facture_brouillon') or dedup_key like 'impaye:%';
  end if;
end $$;

drop function if exists public.pilote_generate();
drop trigger if exists scheduled_actions_session_garde on public.scheduled_actions;
drop function if exists app.scheduled_actions_session_garde();
drop index if exists public.scheduled_actions_session_idx;
alter table public.scheduled_actions drop column if exists blocked_reason;
alter table public.scheduled_actions drop column if exists session_id;

alter table public.scheduled_actions drop constraint if exists scheduled_actions_kind_check;
alter table public.scheduled_actions add constraint scheduled_actions_kind_check check (kind in ('relance_recyclage', 'justificatif_prestataire',
  'convocation', 'rappel', 'evaluation_froid', 'relance_impaye', 'autre', 'renouvellement_contrat', 'visite_hors_contrat'));

delete from public.company_modules where key = 'pilote';
delete from public.org_modules where key = 'pilote';

delete from public.schema_migrations where version = '0160_pilote_sessions';
