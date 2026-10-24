-- 0456 : dernière connexion des comptes de l'espace formateur, stagiaire et entreprise (recette de H du 24/10 : un
-- formateur externe connecté restait « pas encore connecté » sur sa fiche). profiles.last_seen_at n'est jamais écrit ;
-- la date vient désormais de la dernière connexion du compte (auth.users.last_sign_in_at), lue par la base seule.
-- Migration additive (deux fonctions corrigées par remplacement exact). Idempotente.
-- Retour arrière : supabase/rollback/0456_derniere_connexion_retour.sql
do $do$
declare
  r record;
  v_def text;
  v_ancien text := '''last_seen_at'', p.last_seen_at';
  v_nouveau text := '''last_seen_at'', coalesce(p.last_seen_at, (select u.last_sign_in_at from auth.users u where u.id = p.id)) /* 0456 */';
begin
  for r in select * from (values ('public.acces_externe_etat(text, uuid)'), ('public.client_accounts_etat(uuid)')) as t(sig) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    continue when position('/* 0456 */' in v_def) > 0;
    if position(v_ancien in v_def) = 0 then
      raise exception 'Fonction % inattendue : rien n''est changé', r.sig;
    end if;
    execute replace(v_def, v_ancien, v_nouveau);
  end loop;
end
$do$;

insert into public.schema_migrations (version) values ('0456_derniere_connexion') on conflict (version) do nothing;
