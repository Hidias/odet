#!/usr/bin/env python3
"""Génère les données fictives du module Interventions (parc, contrats, visites, deux techniciens).

Sortie : supabase/seed/demo_interventions.sql, à appliquer après les migrations 0050 et 0051 et après le jeu
fictif principal (clients fictifs inscrits dans demo_records).

Effacement : tout part avec Console > Données de démonstration (purge_demo_data) :
- sites, appareils, contrats et visites sont rattachés aux clients fictifs, effacés avec eux ;
- les deux comptes de techniciens sont inscrits dans demo_records (tbl = 'auth_users') et supprimés par le
  déclencheur itv_demo_record_deleted (migration 0050).
Rejouable une fois le jeu purgé (graine fixe). Le mot de passe des comptes de démonstration est passé en
argument (jamais écrit dans le dépôt) : python3 generer_demo_interventions.py MOT_DE_PASSE
"""
import json, os, random, sys, uuid
from datetime import date, datetime, timedelta, time

random.seed(20261016)
HERE = os.path.dirname(os.path.abspath(__file__))
SIGS = json.load(open(os.path.join(HERE, 'donnees_demo_signatures.json')))
TODAY = date(2026, 10, 12)
DEMO_DAY = date(2026, 10, 16)
PASSWORD = sys.argv[1] if len(sys.argv) > 1 else None
if not PASSWORD:
    sys.exit('Usage : generer_demo_interventions.py MOT_DE_PASSE_DES_COMPTES_DE_DEMO')


def uid():
    return str(uuid.UUID(int=random.getrandbits(128), version=4))


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (date, datetime, time)):
        return "'" + v.isoformat() + "'"
    if isinstance(v, (list, dict)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


OUT = []
def emit(s):
    OUT.append(s)


def ins(table, row):
    cols = ', '.join(row.keys())
    vals = ', '.join(v if isinstance(v, Raw) else q(v) for v in row.values())
    emit(f'insert into public.{table} ({cols}) values ({vals});')


class Raw(str):
    pass


def client_ref(name):
    n = name.replace("'", "''")
    return Raw(f"(select c.id from public.clients c join public.demo_records d on d.id = c.id and d.tbl = 'clients' where c.name = '{n}')")


def type_ref(name):
    return Raw(f"(select id from public.itv_equipment_types where name = '{name.replace(chr(39), chr(39) * 2)}' limit 1)")


def tech_ref(email):
    return Raw(f"(select id from auth.users where email = '{email}')")


# ─── Techniciens fictifs (comptes du personnel, rôle « lecture » + technicien dans le module) ───
TECHS = [
    {'id': uid(), 'email': 'ronan.gourmelen@gld-demo.fr', 'first': 'Ronan', 'last': 'GOURMELEN', 'phone': '06 39 98 20 31', 'color': '#C8102E'},
    {'id': uid(), 'email': 'loic.prigent@gld-demo.fr', 'first': 'Loïc', 'last': 'PRIGENT', 'phone': '06 39 98 20 32', 'color': '#1D4ED8'},
]

# ─── Sites (clients fictifs du jeu principal), positions approchées des communes ───
TOWNS = {
    'Bénodet': (47.875, -4.106), 'Fouesnant': (47.894, -4.012), 'Quimper': (47.996, -4.102), 'Briec': (48.102, -3.997),
    'Loctudy': (47.834, -4.170), 'Penmarch': (47.812, -4.338), 'Plonéour-Lanvern': (47.904, -4.285), "Pont-l'Abbé": (47.866, -4.222),
    'Quimperlé': (47.873, -3.549), 'Châteaulin': (48.197, -4.090), 'Plomelin': (47.932, -4.150), 'Ergué-Gabéric': (47.997, -4.023),
}
CLIENTS = [
    # nom, ville, code postal, sites [(nom, profil)], contrat (prix, mois) ou None, mois de la dernière visite 2025, technicien
    ('Hôtel Kastell Mor', 'Bénodet', '29950', [('Bâtiment principal', 'hotel'), ('Annexe piscine', 'small')], (640, [10]), 10, 0),
    ("Supermarché Ty Marc'had", 'Bénodet', '29950', [('Magasin et réserve', 'shop')], None, 10, 0),
    ('Résidence Ar Steredenn', 'Fouesnant', '29170', [('Tous bâtiments', 'ehpad')], (980, [3, 9]), 9, 0),
    ('Transports Le Bihannic', 'Briec', '29510', [('Dépôt et ateliers', 'warehouse')], (520, [9]), 9, 1),
    ('Scierie du Steïr', 'Quimper', '29000', [('Scierie', 'industry')], None, 9, 1),
    ('Glenan Marine', 'Loctudy', '29750', [('Atelier naval', 'industry_small')], None, 8, 1),
    ('Mareyage Ty Ar Mor', 'Penmarch', '29760', [('Halle de mareyage', 'warehouse')], (450, [10]), 10, 1),
    ('Cornouaille Usinage', "Pont-l'Abbé", '29120', [('Usine', 'industry')], None, 11, 0),
    ('Agri-Équipements du Pays Bigouden', 'Plonéour-Lanvern', '29720', [('Magasin et atelier', 'shop_small')], None, 10, 1),
    ('Kervéguen Logistique', 'Quimper', '29000', [('Entrepôt A', 'warehouse'), ('Entrepôt B', 'warehouse_small')], (1150, [4, 11]), 11, 0),
    ('Imprimerie Kemper Graphik', 'Quimper', '29000', [('Imprimerie', 'industry_small')], None, 3, 0),
    ("Plasturgie de l'Isole", 'Quimperlé', '29300', [('Usine', 'industry')], (890, [6]), 6, 1),
    ('Micro-crèche Bugale Mad', 'Plomelin', '29700', [('Crèche', 'small')], None, 5, 0),
    ('Fromagerie Ker Laëz', 'Châteaulin', '29150', [('Fromagerie', 'industry_small')], None, 2, 1),
]
STREETS = ['rue de la Gare', 'route de Quimper', 'ZA de Kerourvois', 'rue du Port', 'impasse des Ajoncs', 'rue Jean Jaurès', 'ZI de Kergonan', 'chemin de Lestonan']

PROFILES = {
    'hotel': {'eau': 9, 'poudre': 2, 'co2': 3, 'baes': 12, 'alarme': 1, 'desenf': 1},
    'ehpad': {'eau': 8, 'poudre': 1, 'co2': 2, 'baes': 14, 'alarme': 1, 'desenf': 2},
    'shop': {'eau': 6, 'poudre': 2, 'co2': 2, 'baes': 8, 'ria': 1},
    'shop_small': {'eau': 3, 'poudre': 1, 'co2': 1, 'baes': 4},
    'warehouse': {'eau': 6, 'poudre': 4, 'co2': 2, 'baes': 6, 'ria': 2, 'desenf': 1},
    'warehouse_small': {'eau': 3, 'poudre': 2, 'co2': 1, 'baes': 3},
    'industry': {'eau': 5, 'poudre': 4, 'co2': 3, 'baes': 7, 'alarme': 1, 'ria': 1},
    'industry_small': {'eau': 3, 'poudre': 2, 'co2': 2, 'baes': 4},
    'small': {'eau': 3, 'co2': 1, 'baes': 4},
}
TYPES = {
    'eau': ('Extincteur à eau pulvérisée', ['6 L', '9 L'], ['Sicli', 'Desautel', 'Eurofeu']),
    'poudre': ('Extincteur à poudre', ['6 kg', '9 kg'], ['Sicli', 'Eurofeu', 'Desautel']),
    'co2': ('Extincteur CO2', ['2 kg', '5 kg'], ['Sicli', 'Desautel']),
    'baes': ('Bloc autonome d\'éclairage de sécurité (BAES)', [None], ['Legrand', 'Kaufel', 'Luminox']),
    'alarme': ('Équipement d\'alarme incendie', [None], ['Nugelec', 'Legrand']),
    'desenf': ('Désenfumage (exutoire, ouvrant, commande)', [None], ['Souchier', 'Madrid']),
    'ria': ('Robinet d\'incendie armé (RIA)', [None], ['Desautel', 'Sicli']),
}
PLACES = {
    'eau': ['Accueil', 'Couloir rez-de-chaussée', 'Couloir 1er étage', 'Bureau', 'Salle de pause', 'Escalier principal', 'Vestiaires', 'Réserve', 'Atelier, entrée', 'Quai de chargement'],
    'poudre': ['Local technique', 'Chaufferie', 'Garage', 'Atelier, machine', 'Local poubelles', 'Zone de stockage'],
    'co2': ['Cuisine', 'Local électrique', 'Tableau général', 'Salle serveur', 'Atelier, armoire électrique'],
    'baes': ['Sortie principale', 'Sortie de secours', 'Couloir', 'Escalier', 'Dégagement', 'Salle commune', 'Réserve'],
    'alarme': ['Accueil, centrale'],
    'desenf': ['Cage d\'escalier', 'Toiture, exutoire'],
    'ria': ['Hall', 'Atelier'],
}
DEFECTS = {
    'eau': ['Manomètre hors zone verte', 'Scellé ou goupille manquant', 'Inaccessible, non visible ou non signalé'],
    'poudre': ['Poudre mottée', 'Manomètre hors zone verte', 'Chocs, corrosion ou sérigraphie dégradée'],
    'co2': ['Pesée hors tolérance', 'Diffuseur ou flexible détérioré'],
    'baes': ['Autonomie inférieure à 1 heure', 'Lampe ou LED défectueuse', 'Voyant de défaut allumé'],
    'alarme': ['Batterie défaillante'],
    'desenf': ['Cartouche percutée, vide ou périmée'],
    'ria': ['Tuyau craquelé ou poreux, fuite'],
}

prefix_sql = "(select coalesce(nullif(trim(doc_prefix), ''), 'APP') from public.organization_settings limit 1)"
label_n = [0]
def next_label():
    label_n[0] += 1
    return Raw(f"({prefix_sql} || '-' || lpad('{label_n[0]}', 5, '0'))")


def summer(d):
    return 4 <= d.month <= 9 or (d.month == 10 and d.day < 25) or (d.month == 3 and d.day >= 29)


def ts(d, h, m=0):
    return datetime(d.year, d.month, d.day, h, m).isoformat() + ('+02:00' if summer(d) else '+01:00')


emit('-- Données fictives du module Interventions (généré par generer_demo_interventions.py). Effaçables avec le reste.')
emit('begin;')

# ─── Comptes des techniciens fictifs ───
for t in TECHS:
    meta = {'display_name': f"{t['first']} {t['last'].title()}", 'first_name': t['first'], 'last_name': t['last'], 'role': 'lecture'}
    emit(f"""insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
values ('00000000-0000-0000-0000-000000000000', '{t['id']}', 'authenticated', 'authenticated', '{t['email']}', extensions.crypt({q(PASSWORD)}, extensions.gen_salt('bf')), now(), '{{"provider":"email","providers":["email"]}}'::jsonb, {q(meta)}, now(), now(), '', '', '', '');""")
    emit(f"""insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '{t['id']}', '{t['id']}', '{{"sub":"{t['id']}","email":"{t['email']}","email_verified":true}}'::jsonb, 'email', now(), now(), now());""")
    emit(f"update public.profiles set role = 'lecture', first_name = {q(t['first'])}, last_name = {q(t['last'])}, display_name = {q(t['first'] + ' ' + t['last'].title())}, phone = {q(t['phone'])}, fonction = 'Technicien', is_active = true where id = '{t['id']}';")
    ins('itv_technicians', {'profile_id': t['id'], 'color': t['color'], 'is_active': True})
    ins('demo_records', {'tbl': 'auth_users', 'id': t['id']})

# ─── Sites, appareils, contrats, visites ───
visit_n = [0]
def visit_ref(d):
    visit_n[0] += 1
    return f"ITV-{d.year}-{visit_n[0]:04d}"

late_quote_items = 0
plan_16 = {0: [], 1: []}
for ci, (name, town, cp, sites, contract, last_month, tech_i) in enumerate(CLIENTS):
    cref = client_ref(name)
    tech = TECHS[tech_i]
    contract_id = None
    if contract:
        contract_id = uid()
        ins('itv_contracts', {'id': contract_id, 'client_id': cref, 'reference': f'CM-2025-{ci + 1:03d}', 'label': 'Contrat de maintenance annuel',
                              'start_on': date(2025, 1, 1), 'annual_price_ht': contract[0], 'visit_months': Raw("'{" + ','.join(map(str, contract[1])) + "}'::int[]"), 'status': 'actif'})
    for si, (sname, profile) in enumerate(sites):
        site_id = uid()
        lat, lng = TOWNS[town]
        lat += random.uniform(-0.012, 0.012); lng += random.uniform(-0.016, 0.016)
        ins('sites', {'id': site_id, 'kind': 'client', 'name': sname, 'address': f'{random.randint(2, 48)} {random.choice(STREETS)}', 'postal_code': cp, 'city': town,
                      'client_id': cref, 'is_active': True, 'is_default': si == 0, 'latitude': round(lat, 5), 'longitude': round(lng, 5),
                      'access_notes': random.choice([None, 'Se présenter à l\'accueil', 'Clés au poste de garde', 'Accès par le portail arrière, code donné par le client'])})
        # Appareils
        equipment = []
        for key, count in PROFILES[profile].items():
            tname, caps, brands = TYPES[key]
            places = PLACES[key]
            for k in range(count):
                year = random.choice([2014, 2016, 2016, 2018, 2019, 2020, 2021, 2021, 2022, 2023, 2024])
                if key in ('eau', 'poudre') and random.random() < 0.06:
                    year = 2006
                place = places[k % len(places)] + ('' if k < len(places) else f' {k // len(places) + 1}')
                eid = uid()
                cap = random.choice(caps)
                equipment.append({'id': eid, 'key': key, 'year': year})
                ins('itv_equipment', {'id': eid, 'client_id': cref, 'site_id': site_id, 'type_id': type_ref(tname), 'label_code': next_label(),
                                      'location': place, 'brand': random.choice(brands), 'manufactured_year': year, 'installed_on': date(year, random.randint(1, 12), 1) if year > 2010 else None,
                                      'details': {'Capacité': cap} if cap else {}, 'status': 'en_service'})
        # Historique : visite de l'an dernier (mois du contrat ou de la dernière visite), puis visite de 2026 si déjà passée
        months_done = []
        m25 = last_month
        months_done.append(date(2025, m25, random.randint(8, 24)))
        if contract and len(contract[1]) > 1:
            for m in contract[1]:
                if m <= 7:
                    months_done.append(date(2026, m, random.randint(6, 22)))
        elif m25 <= 7:
            months_done.append(date(2026, m25, random.randint(6, 22)))
        last_done = None
        for vi, d in enumerate(sorted(months_done)):
            vid = uid()
            final = vi == len(months_done) - 1
            h0, m0 = random.choice([8, 9, 10, 14]), random.choice([0, 15, 30])
            start, end = ts(d, h0, m0), ts(d, h0 + 2, m0 + random.choice([0, 10, 20]))
            ins('itv_visits', {'id': vid, 'reference': visit_ref(d), 'client_id': cref, 'site_id': site_id, 'contract_id': contract_id,
                               'technician_id': tech_ref(TECHS[(tech_i + vi) % 2]['email']), 'due_on': date(d.year, d.month, 1), 'planned_on': d, 'route_order': 1,
                               'status': 'terminee', 'started_at': start, 'finished_at': end,
                               'signer_name': random.choice(['Gaëlle Le Floc\'h, responsable technique', 'Yannick Cariou, directeur', 'Morgane Tanguy, responsable sécurité', 'Erwan Le Goff, chef d\'atelier']),
                               'client_signature': random.choice(SIGS), 'observations': random.choice([None, None, 'Accès au local technique encombré, signalé au responsable.', 'RAS.']),
                               'site_observations': random.choice([[], [], ['Signalétique de sécurité manquante ou dégradée'], ['Plan d\'évacuation absent ou à mettre à jour']])})
            for e in equipment:
                result, defect = 'conforme', None
                if final and d.year == 2026 and random.random() < 0.05 and e['key'] in DEFECTS:
                    result, defect = 'a_remplacer', random.choice(DEFECTS[e['key']])
                    late_quote_items += 1
                elif random.random() < 0.03 and e['key'] in DEFECTS:
                    result, defect = 'remplace', random.choice(DEFECTS[e['key']])
                ins('itv_visit_items', {'visit_id': vid, 'equipment_id': e['id'], 'operation': 'verification', 'result': result, 'defect': defect, 'checked_at': start})
            if random.random() < 0.5:
                ins('itv_visit_parts', {'visit_id': vid, 'label': 'Goupille et scellé', 'quantity': random.randint(1, 4), 'unit_price_ht': 4.5})
            last_done = d
        # Dernière et prochaine vérification de chaque appareil, statut « à remplacer » repris de la dernière visite
        emit(f"""update public.itv_equipment e set last_check_on = {q(last_done)}, next_check_on = ({q(last_done)}::date + make_interval(months => t.verification_months))::date
  from public.itv_equipment_types t where t.id = e.type_id and e.site_id = '{site_id}';""")
        emit(f"""update public.itv_equipment e set status = 'a_remplacer' from public.itv_visit_items i join public.itv_visits v on v.id = i.visit_id
  where i.equipment_id = e.id and v.site_id = '{site_id}' and v.planned_on = {q(last_done)} and i.result = 'a_remplacer';""")
        # Tournées du vendredi 16 octobre : visites planifiées
        nxt = date(last_done.year + 1, last_done.month, 1)
        if contract and len(contract[1]) > 1:
            # Contrat à plusieurs visites par an : la visite manquée de l'année (mois du contrat déjà passé) est due
            missed = [m for m in contract[1] if 7 < m < TODAY.month]
            if missed:
                nxt = date(2026, missed[0], 1)
        if (ci, si) in [(0, 0), (1, 0), (2, 0)]:
            plan_16[0].append((cref, site_id, contract_id, nxt))
        elif (ci, si) in [(8, 0), (6, 0)]:
            plan_16[1].append((cref, site_id, contract_id, nxt))
        elif contract:
            # Visites de contrat de la fin d'année, à planifier (comme le bouton « Visites 2026 » du contrat)
            for m in contract[1]:
                if m > TODAY.month:
                    ins('itv_visits', {'client_id': cref, 'site_id': site_id, 'contract_id': contract_id, 'due_on': date(2026, m, 1), 'status': 'a_planifier'})

for ti, lst in plan_16.items():
    for order, (cref, site_id, contract_id, nxt) in enumerate(lst, start=1):
        ins('itv_visits', {'client_id': cref, 'site_id': site_id, 'contract_id': contract_id, 'technician_id': tech_ref(TECHS[ti]['email']),
                           'due_on': nxt, 'planned_on': DEMO_DAY, 'planned_time': ['08:30', '11:00', '14:00'][order - 1], 'route_order': order, 'status': 'planifiee'})


# Numérotation : compteur d'étiquettes après les codes de démonstration ; prix d'exemple des pièces et forfait
emit(f"update public.itv_settings set label_next = greatest(label_next, {label_n[0] + 1}) where id = 1;")
emit("update public.itv_parts set price_ht = v.p from (values ('Goupille et scellé', 4.5), ('Joint de tête', 6), ('Étiquette de maintenance', 1.5), ('Batterie de BAES', 24), ('Lampe ou module LED de BAES', 18), ('Cartouche de CO2 pour désenfumage', 32)) as v(n, p) where itv_parts.name = v.n and itv_parts.price_ht = 0;")
emit("update public.itv_settings set visit_fee_ht = 85 where id = 1 and visit_fee_ht = 0;")
emit("update public.org_modules set enabled = true where key = 'interventions';")
emit('commit;')

with open(os.path.join(HERE, 'demo_interventions.sql'), 'w') as fh:
    fh.write('\n'.join(OUT).replace(PASSWORD, '[MOT_DE_PASSE]') + '\n')
with open(os.environ.get('DEMO_SQL_WITH_PASSWORD', '/tmp/demo_interventions_with_password.sql'), 'w') as fh:
    fh.write('\n'.join(OUT) + '\n')
print(f'{label_n[0]} appareils, {visit_n[0]} visites passées, {late_quote_items} appareils à remplacer, {sum(len(v) for v in plan_16.values())} visites le 16/10')
