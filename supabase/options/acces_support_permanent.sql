-- Réglage facultatif d'une instance, appliqué après 0270 à 0273, sur décision écrite de la direction de l'instance :
-- l'accès de support de l'éditeur aux données métier de la société n° 1 devient PERMANENT ET TRACÉ.
-- Le produit reste « à la demande » par défaut.
-- Sans compte connecté (éditeur SQL) : la garde de la table companies laisse passer ce changement ;
-- il est écrit au journal d'audit comme tout changement de mode.
-- Retour arrière : supabase/options/acces_support_permanent_retour.sql

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
