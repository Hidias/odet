-- Instance odet-gld (GLD Solutions) : réglage propre à cette instance, appliqué après 0270 à 0273.
-- Décision du 17/10/2026 (Hicham, acceptée par les associés, mention prévue au pacte d'associé) :
-- l'accès de support de l'éditeur aux données métier de la société n° 1 est PERMANENT ET TRACÉ.
-- Le produit reste « à la demande » par défaut pour les autres instances.
-- Sans compte connecté (éditeur SQL) : la garde de la table companies laisse passer ce changement ;
-- il est écrit au journal d'audit comme tout changement de mode.
-- Retour arrière : supabase/instances/odet-gld/c1a_acces_support_permanent_retour.sql

update public.companies set support_access_mode = 'permanent'
 where is_instance_owner and support_access_mode <> 'permanent';

insert into public.audit_logs (action, entity_type, entity_name, details)
select 'update', 'system', 'Mode d''accès de support modifié',
       jsonb_build_object('support', true, 'company_id', c.id, 'avant', 'on_demand', 'apres', 'permanent',
                          'motif', 'Décision du 17/10/2026, réglage de l''instance')
from public.companies c
where c.is_instance_owner
  and not exists (select 1 from public.audit_logs a
                  where a.details ->> 'company_id' = c.id::text and a.details ->> 'apres' = 'permanent');
