-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (completude_0489) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0489_completude_retrait.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0489_completude_retrait.sql =====
-- 0489 : retrait de public.detect_completude_blockers (décision de H, 05/11).
-- Fonction reprise de Campus, appelée par aucune tâche, aucun écran ni aucune fonction en production (vérifié le 05/11) ;
-- exécutable par tout compte connecté, elle parcourait les stagiaires, sessions et réclamations de toutes les sociétés,
-- écrivait des alertes sans société et effaçait des notifications. La page Complétude calcule ses points à l'écran ;
-- l'échantillon de « Préparer l'audit » lit désormais l'état de la convention (etatConvention.js) au lieu de la table
-- completude_alerts, restée vide. Les tables completude_alerts et completude_tracking sont laissées en place (vides).
-- Aucune donnée supprimée. Idempotente. Retour arrière : supabase/rollback/0489_completude_retrait_retour.sql

drop function if exists public.detect_completude_blockers();

insert into public.schema_migrations (version) values ('0489_completude_retrait') on conflict (version) do nothing;

-- ===== supabase/rollback/0489_completude_retrait_retour.sql =====
-- Retour arrière de 0489 : detect_completude_blockers remise telle qu'en production après 0488, mêmes droits.
CREATE OR REPLACE FUNCTION public.detect_completude_blockers()
 RETURNS TABLE(new_blockers_count integer, new_notifications_count integer, previous_count integer, current_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_blockers INTEGER := 0;
    v_new_notifications INTEGER := 0;
    v_row_count INTEGER;
    v_previous_count INTEGER;
    v_current_blocker_count INTEGER;
BEGIN
    -- ========================================
    -- STAGIAIRES : Numéro SS manquant (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'Numéro SS manquant',
        'bloquant',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE (t.refused_ssn = false OR t.refused_ssn IS NULL)
    AND NOT coalesce(t.ssn_present, false)
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'Numéro SS manquant' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- STAGIAIRES : Date de naissance manquante (IMPORTANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'Date de naissance manquante',
        'important',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE t.birth_date IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'Date de naissance manquante' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- STAGIAIRES : CSP manquante (IMPORTANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'CSP manquante',
        'important',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE (t.csp IS NULL OR t.csp = '')
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'CSP manquante' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- STAGIAIRES : Genre manquant (IMPORTANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'stagiaires',
        t.first_name || ' ' || t.last_name,
        'Genre manquant',
        'important',
        t.id,
        '/stagiaires/' || t.id
    FROM trainees t
    WHERE (t.gender IS NULL OR t.gender = '')
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'stagiaires' 
        AND ca.entity_id = t.id 
        AND ca.detail = 'Genre manquant' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- SESSIONS : Convention non envoyée (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'sessions',
        s.reference,
        'Convention non envoyée',
        'bloquant',
        s.id,
        '/sessions/' || s.id
    FROM sessions s
    WHERE s.status = 'completed'
    AND app.convention_etat(s.id) = 'a_envoyer'
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'sessions' 
        AND ca.entity_id = s.id 
        AND ca.detail = 'Convention non envoyée' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- SESSIONS : Convention non signée (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'sessions',
        s.reference,
        'Convention non signée',
        'bloquant',
        s.id,
        '/sessions/' || s.id
    FROM sessions s
    WHERE s.status = 'completed'
    AND app.convention_etat(s.id) = 'envoyee'
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'sessions' 
        AND ca.entity_id = s.id 
        AND ca.detail = 'Convention non signée' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- RÉCLAMATIONS : Non clôturées >5 jours (BLOQUANT)
    -- ========================================
    INSERT INTO completude_alerts (category, element, detail, priority, entity_id, link)
    SELECT 
        'qualite',
        nc.title,
        'Réclamation non clôturée (>' || EXTRACT(DAY FROM NOW() - nc.created_at) || ' jours)',
        'bloquant',
        nc.id,
        '/non-conformites'
    FROM non_conformites nc
    WHERE nc.source = 'reclamation'
    AND nc.status IN ('open', 'analyse', 'action')
    AND nc.created_at < NOW() - INTERVAL '5 days'
    AND NOT EXISTS (
        SELECT 1 FROM completude_alerts ca 
        WHERE ca.category = 'qualite' 
        AND ca.entity_id = nc.id 
        AND ca.detail LIKE 'Réclamation non clôturée%' 
        AND ca.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_new_blockers := v_new_blockers + v_row_count;
    
    -- ========================================
    -- RÉSOLUTION AUTOMATIQUE
    -- ========================================
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'Numéro SS manquant' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND (
            coalesce(t.ssn_present, false)
            OR t.refused_ssn = true
        )
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'Date de naissance manquante' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND t.birth_date IS NOT NULL
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'CSP manquante' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND t.csp IS NOT NULL
        AND t.csp != ''
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'stagiaires' 
    AND ca.detail = 'Genre manquant' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM trainees t 
        WHERE t.id = ca.entity_id 
        AND t.gender IS NOT NULL
        AND t.gender != ''
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'sessions' 
    AND ca.detail = 'Convention non envoyée' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.id = ca.entity_id 
        AND app.convention_etat(s.id) <> 'a_envoyer'
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'sessions' 
    AND ca.detail = 'Convention non signée' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM sessions s 
        WHERE s.id = ca.entity_id 
        AND app.convention_etat(s.id) in ('signee', 'sans_objet')
    );
    
    UPDATE completude_alerts ca SET resolved_at = NOW()
    WHERE ca.category = 'qualite' 
    AND ca.detail LIKE 'Réclamation non clôturée%' 
    AND ca.resolved_at IS NULL
    AND EXISTS (
        SELECT 1 FROM non_conformites nc 
        WHERE nc.id = ca.entity_id 
        AND nc.status = 'closed'
    );
    
    -- ========================================
    -- LOGIQUE INCRÉMENTALE : CRÉER NOTIFICATION UNIQUEMENT SI AUGMENTATION
    -- ========================================
    
    -- Récupérer le dernier comptage
    SELECT last_blocker_count INTO v_previous_count
    FROM completude_tracking
    WHERE id = 1;
    
    -- Compter les bloquants actuels (toutes priorités confondues)
    SELECT COUNT(*) INTO v_current_blocker_count
    FROM completude_alerts
    WHERE resolved_at IS NULL;
    
    -- SI le nombre a AUGMENTÉ → Créer notification
    IF v_current_blocker_count > v_previous_count THEN
        
        -- Supprimer l'ancienne notification
        DELETE FROM notifications 
        WHERE type = 'completude' 
        AND metadata->>'category' = 'completude_global';
        
        -- Créer la nouvelle notification
        WITH blocker_stats AS (
            SELECT 
                COUNT(*) FILTER (WHERE category = 'sessions') as sessions_count,
                COUNT(*) FILTER (WHERE category = 'stagiaires') as stagiaires_count,
                COUNT(*) FILTER (WHERE category = 'qualite') as qualite_count,
                COUNT(*) as total_count,
                CASE 
                    WHEN COUNT(*) FILTER (WHERE priority = 'bloquant') > 0 THEN 'bloquant'
                    WHEN COUNT(*) FILTER (WHERE priority = 'important') > 0 THEN 'important'
                    WHEN COUNT(*) FILTER (WHERE priority = 'mineur') > 0 THEN 'mineur'
                    ELSE 'mineur'
                END as highest_priority
            FROM completude_alerts
            WHERE resolved_at IS NULL
        )
        INSERT INTO notifications (type, title, message, link, metadata)
        SELECT 
            'completude',
            'Complétude à mettre à jour',
            CASE 
                WHEN sessions_count > 0 AND stagiaires_count > 0 AND qualite_count > 0 THEN 
                    sessions_count || ' sessions, ' || stagiaires_count || ' stagiaires, ' || qualite_count || ' réclamations'
                WHEN sessions_count > 0 AND stagiaires_count > 0 THEN 
                    sessions_count || ' sessions, ' || stagiaires_count || ' stagiaires'
                WHEN sessions_count > 0 AND qualite_count > 0 THEN 
                    sessions_count || ' sessions, ' || qualite_count || ' réclamations'
                WHEN stagiaires_count > 0 AND qualite_count > 0 THEN 
                    stagiaires_count || ' stagiaires, ' || qualite_count || ' réclamations'
                WHEN sessions_count > 0 THEN sessions_count || ' sessions'
                WHEN stagiaires_count > 0 THEN stagiaires_count || ' stagiaires'
                WHEN qualite_count > 0 THEN qualite_count || ' réclamations'
                ELSE 'Vérifiez la page Complétude'
            END,
            '/qualite/completude',
            jsonb_build_object(
                'category', 'completude_global',
                'priority', highest_priority,
                'sessions', sessions_count,
                'stagiaires', stagiaires_count,
                'qualite', qualite_count,
                'total', total_count,
                'previous_count', v_previous_count,
                'delta', total_count - v_previous_count
            )
        FROM blocker_stats
        WHERE total_count > 0;
        
        GET DIAGNOSTICS v_new_notifications = ROW_COUNT;
    END IF;
    
    -- Mettre à jour le tracking
    UPDATE completude_tracking
    SET last_blocker_count = v_current_blocker_count,
        last_check_at = NOW()
    WHERE id = 1;
    
    RETURN QUERY SELECT v_new_blockers, v_new_notifications, v_previous_count, v_current_blocker_count;
END;
$function$

;
revoke all on function public.detect_completude_blockers() from public, anon;
grant execute on function public.detect_completude_blockers() to authenticated, service_role;

delete from public.schema_migrations where version = '0489_completude_retrait';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE completude_0489 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
