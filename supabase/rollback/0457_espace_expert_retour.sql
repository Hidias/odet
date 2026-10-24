-- Retour arrière de 0457_espace_expert.sql. Idempotent. Refusé s'il existe une invitation d'expert (ses avis et la
-- trace de sa relecture seraient perdus).
do $do$
begin
  if to_regclass('public.doc_review_experts') is not null and exists (select 1 from public.doc_review_experts) then
    raise exception 'Des experts ont été invités : retour arrière refusé';
  end if;
end
$do$;

-- Gardes d'avant 0457
do $do$
declare
  v_def text;
  b1 text := $b$      if not (r.status = 'expert' and (app.peut_gerer_docs(r.company_id) or current_setting('app.expert_review', true) = r.id::text)) /* 0457 */ then$b$;
  a1 text := $a$      if not (r.status = 'expert' and app.peut_gerer_docs(r.company_id)) then$a$;
  b2 text := $b$      if old.author_id is distinct from v_uid and not (old.expert_id is not null and current_setting('app.expert_id', true) = old.expert_id::text) /* 0457 */ then raise exception 'Seul son auteur retire un avis' using errcode = '42501'; end if;$b$;
  a2 text := $a$      if old.author_id <> v_uid then raise exception 'Seul son auteur retire un avis' using errcode = '42501'; end if;$a$;
  b3 text := $b$  if (new.review_id, new.round, new.section_id, new.parent_id, new.kind, new.author_id, new.author_name, new.author_quality, new.author_label,
      new.text, new.proposed, new.base, new.choices, new.created_at, new.company_id, new.expert_id) /* 0457 */$b$;
  a3 text := $a$  if (new.review_id, new.round, new.section_id, new.parent_id, new.kind, new.author_id, new.author_name, new.author_quality, new.author_label,
      new.text, new.proposed, new.base, new.choices, new.created_at, new.company_id)$a$;
  b4 text := $b$     is distinct from (old.review_id, old.round, old.section_id, old.parent_id, old.kind, old.author_id, old.author_name, old.author_quality, old.author_label,
      old.text, old.proposed, old.base, old.choices, old.created_at, old.company_id, old.expert_id) then$b$;
  a4 text := $a$     is distinct from (old.review_id, old.round, old.section_id, old.parent_id, old.kind, old.author_id, old.author_name, old.author_quality, old.author_label,
      old.text, old.proposed, old.base, old.choices, old.created_at, old.company_id) then$a$;
  b5 text := $b$    new.decided_by := null; new.decided_name := null; new.decided_at := null; new.decision_note := null;
    if current_setting('app.expert_review', true) is distinct from r.id::text then new.expert_id := null; end if;$b$;
  a5 text := $a$    new.decided_by := null; new.decided_name := null; new.decided_at := null; new.decision_note := null;$a$;
  b6 text := $b$      if not (app.peut_gerer_docs(old.company_id) or current_setting('app.expert_review', true) = old.id::text) /* 0457 */ then raise exception 'Le retour de l''expert est enregistré par l''équipe qui gère les documents' using errcode = '42501'; end if;$b$;
  a6 text := $a$      if not app.peut_gerer_docs(old.company_id) then raise exception 'Le retour de l''expert est enregistré par l''équipe qui gère les documents' using errcode = '42501'; end if;$a$;
begin
  v_def := pg_get_functiondef('app.doc_review_item_garde()'::regprocedure);
  if position('/* 0457 */' in v_def) > 0 then
    execute replace(replace(replace(replace(replace(v_def, b1, a1), b2, a2), b3, a3), b4, a4), b5, a5);
  end if;
  v_def := pg_get_functiondef('app.doc_review_garde()'::regprocedure);
  if position('/* 0457 */' in v_def) > 0 then
    execute replace(v_def, b6, a6);
  end if;
end
$do$;

drop function if exists public.expert_terminer(text, text, text);
drop function if exists public.expert_retirer(text, text, uuid);
drop function if exists public.expert_deposer(text, text, text, text, text, jsonb);
drop function if exists public.expert_ouvrir(text, text);
drop function if exists app.expert_qualite(text);
drop function if exists app.expert_verifier(text, text);
alter table public.doc_review_items drop column if exists expert_id;
alter table public.doc_reviews drop column if exists expert_view;
drop table if exists public.doc_review_experts;
drop function if exists app.doc_review_expert_garde();
delete from public.schema_migrations where version = '0457_espace_expert';
