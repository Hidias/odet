-- Données de démonstration fictives (généré par generer_donnees_demo.py)
begin;
with c as (select id from invoices where status = 'paid' and due_date between date '2026-10-12' - 40 and date '2026-10-12' - 5 order by due_date desc limit 2)
, d as (delete from invoice_payments where invoice_id in (select id from c) returning invoice_id)
update invoices set status = 'sent', amount_paid = 0, amount_due = total_ttc where id in (select id from c);
insert into trainee_objectives (session_id, trainee_id, objective_index, objective_text, validated, validated_at, remediation_comment)
select st.session_id, st.trainee_id, o.n - 1, o.txt,
       st.result = 'acquired' or o.n > 1,
       case when st.result = 'acquired' or o.n > 1 then (s.end_date + time '16:30') at time zone 'Europe/Paris' end,
       case when st.result = 'not_acquired' and o.n = 1 then 'Gestes à consolider, nouvelle session proposée.' end
from session_trainees st
join sessions s on s.id = st.session_id
join demo_records d on d.tbl = 'sessions' and d.id = s.id
join courses c on c.id = s.course_id
cross join lateral (
  select trim(t) txt, row_number() over () n
  from unnest(string_to_array(coalesce(c.objectives, ''), E'
')) t
  where trim(t) <> ''
) o
where s.status = 'completed' and coalesce(st.absent, false) = false and st.result is not null
on conflict do nothing;
commit;
