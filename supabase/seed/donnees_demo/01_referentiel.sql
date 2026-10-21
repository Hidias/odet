-- Données de démonstration fictives (généré par generer_donnees_demo.py)
begin;
insert into trainers (id, first_name, last_name, email, phone, specialties, is_internal, qualifications) values ('0ce98e8d-ca00-4ab0-8205-cd156818f096', 'Marc', 'Le Roux', 'formateur1@exemple.fr', '06 39 98 00 01', 'Sécurité incendie, évacuation, manipulation d''extincteurs', true, 'Technicien de maintenance incendie, formateur EPI');
insert into demo_records (tbl, id) values ('trainers', '0ce98e8d-ca00-4ab0-8205-cd156818f096') on conflict do nothing;
insert into trainers (id, first_name, last_name, email, phone, specialties, is_internal, qualifications) values ('8fd7fa69-0b0b-4cf8-b897-127c005d3def', 'Sophie', 'Kerhervé', 'sophie.kerherve@formelec-demo.fr', '06 39 98 00 02', 'Habilitation électrique, prévention des risques électriques', false, 'Formatrice habilitation électrique (NF C 18-510)');
insert into demo_records (tbl, id) values ('trainers', '8fd7fa69-0b0b-4cf8-b897-127c005d3def') on conflict do nothing;
commit;
