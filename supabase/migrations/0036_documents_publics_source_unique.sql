-- 0036_documents_publics_source_unique.sql : règlement intérieur, livrets, CGV et charte égalité
-- remis aux stagiaires et aux clients viennent de Documents qualité (une seule source).
--
-- published_quality_doc(doc_id) : dernière version validée d'un document public, lisible aussi depuis
-- le portail stagiaire et l'espace entreprise (convocation, convention). Liste fermée de documents :
-- les procédures internes ne sont pas exposées.
-- Les anciens textes de Paramètres (organization_settings.reglement_interieur, livret_accueil,
-- conditions_annulation, cgv_url) et de la page Qualiopi (qualiopi_documents) ne sont plus lus ni
-- modifiables ; ils restent en base, intacts, pour mémoire.

create or replace function public.published_quality_doc(p_doc_id text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('content', v.content, 'version', v.version, 'validated_at', v.validated_at)
    from public.quality_doc_versions v
   where v.doc_id = p_doc_id
     and p_doc_id in ('reglement', 'livret-court', 'livret-complet', 'cgv', 'charte-egalite')
   order by v.version desc
   limit 1
$$;
grant execute on function public.published_quality_doc(text) to anon, authenticated;

insert into public.schema_migrations (version) values ('0036_documents_publics_source_unique') on conflict (version) do nothing;
