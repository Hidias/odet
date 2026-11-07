-- Essai de 0499 : financement « Autre financeur » repris sur la session préparée, documents métier publiés lisibles.
-- Rouge sans 0499 (session en none, document métier lu vide). Données d'essai créées ici (une société existante
-- seulement), tout est annulé.
begin;
set local client_min_messages = warning;

do $$
declare
  v_cie uuid; v_a uuid; v_co uuid; v_q uuid; v_q2 uuid; v_n int; v_f text; v_r jsonb; d text;
begin
  select id into v_cie from public.companies limit 1;
  insert into public.clients (name, company_id) values ('Alpha essai 0499', v_cie) returning id into v_a;
  insert into public.courses (title, duration_hours, duration_days, company_id) values ('Formation essai 0499', 7, 1, v_cie) returning id into v_co;

  -- 1. Devis « Autre financeur » signé : session en other
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type)
    values ('ESSAI-0499-1', v_a, v_cie, 'accepted', 'Formation', 'autre') returning id into v_q;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q, 1, v_co, 1, 100);
  v_n := app.devis_prepare_sessions(v_q);
  if v_n <> 1 then raise exception '1. % session(s) préparée(s)', v_n; end if;
  select funding_type into v_f from public.sessions where quote_id = v_q;
  if v_f is distinct from 'other' then raise exception '2. financement % au lieu de other', v_f; end if;

  -- 2. Les autres cas inchangés : OPCO reste opco, sans financeur reste none
  insert into public.quotes (reference, client_id, company_id, status, object, funding_type)
    values ('ESSAI-0499-2', v_a, v_cie, 'accepted', 'Formation', 'opco') returning id into v_q2;
  insert into public.quote_items (quote_id, position, course_id, quantity, unit_price_ht) values (v_q2, 1, v_co, 1, 100);
  perform app.devis_prepare_sessions(v_q2);
  select funding_type into v_f from public.sessions where quote_id = v_q2;
  if v_f is distinct from 'opco' then raise exception '3. OPCO devenu %', v_f; end if;
  update public.quotes set funding_type = null where id = v_q2;
  delete from public.sessions where quote_id = v_q2;
  perform app.devis_prepare_sessions(v_q2);
  select funding_type into v_f from public.sessions where quote_id = v_q2;
  if v_f is distinct from 'none' then raise exception '4. sans financeur devenu %', v_f; end if;

  -- 3. Documents joints par métier : dernière version validée lisible, procédure interne toujours fermée
  foreach d in array array['cgv-maintenance', 'cgv-vente', 'cgv-installation', 'perimetre-maintenance', 'garantie-vente', 'procedure-essai-0499'] loop
    insert into public.quality_doc_versions (doc_id, version, content, company_id, company_ids)
      values (d, 1, jsonb_build_object('sections', '[]'::jsonb), v_cie, array[v_cie]),
             (d, 2, jsonb_build_object('sections', '[]'::jsonb, 'essai', d), v_cie, array[v_cie]);
  end loop;
  foreach d in array array['cgv-maintenance', 'cgv-vente', 'cgv-installation', 'perimetre-maintenance', 'garantie-vente'] loop
    v_r := public.published_quality_doc(d);
    if v_r is null or (v_r ->> 'version')::int <> 2 or v_r -> 'content' ->> 'essai' <> d then
      raise exception '5. % non lu en version 2 (%)', d, v_r; end if;
  end loop;
  if public.published_quality_doc('procedure-essai-0499') is not null then raise exception '6. document interne exposé'; end if;
  if public.published_quality_doc('cgv') is distinct from (
       select jsonb_build_object('content', v.content, 'version', v.version, 'validated_at', v.validated_at)
         from public.quality_doc_versions v where v.doc_id = 'cgv' order by v.version desc limit 1) then
    raise exception '7. CGV de formation changées'; end if;

  -- 4. Droits : lisible par le portail (anon) comme avant, préparation de session toujours interne
  if not has_function_privilege('anon', 'public.published_quality_doc(text)', 'execute') then raise exception '8. portail sans accès'; end if;
  if has_function_privilege('authenticated', 'app.devis_prepare_sessions(uuid)', 'execute')
     or has_function_privilege('anon', 'app.devis_prepare_sessions(uuid)', 'execute') then raise exception '9. fonction interne ouverte'; end if;
end
$$;

rollback;
