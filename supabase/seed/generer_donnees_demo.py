#!/usr/bin/env python3
"""Génère le jeu de données de démonstration de GLD Formation (données fictives, effaçables).

Sortie : supabase/seed/donnees_demo/*.sql, à appliquer dans l'ordre (00_..., 01_..., ...).
Chaque enregistrement racine est inscrit dans demo_records ; purge_demo_data() efface tout d'un coup.

Règles :
- Noms d'entreprises et de personnes inventés. SIREN commençant par 000 (aucun SIREN réel ne commence ainsi).
- Téléphones dans les plages réservées à la fiction par l'ARCEP (01 99 00 xx xx, 06 39 98 xx xx).
- Emails sur des domaines inventés ; en mode démonstration, aucun email ne part de toute façon.
- Aucun chiffre réel d'Access Formation n'est repris.
Rejouable : génération déterministe (graine fixe). Avant de rejouer, appeler purge_demo_data().
"""
import json, math, os, random, uuid
from datetime import date, datetime, timedelta

random.seed(20261012)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'donnees_demo')
SIGS = json.load(open(os.path.join(HERE, 'donnees_demo_signatures.json')))
TODAY = date(2026, 10, 12)

def uid():
    return str(uuid.UUID(int=random.getrandbits(128), version=4))

def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if isinstance(v, float) else str(v)
    if isinstance(v, (date, datetime)):
        return "'" + v.isoformat() + "'"
    if isinstance(v, (list, dict)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"

def ins(table, row):
    cols = ', '.join(row.keys())
    vals = ', '.join(q(v) for v in row.values())
    return f'insert into {table} ({cols}) values ({vals});'

def track(table, rid):
    return f"insert into demo_records (tbl, id) values ('{table}', '{rid}') on conflict do nothing;"

def tva(siren):
    return 'FR%02d%s' % ((12 + 3 * (int(siren) % 97)) % 97, siren)

phone_n = [0]
def tel_fixe():
    phone_n[0] += 1
    n = phone_n[0]
    return '01 99 00 %02d %02d' % (n // 100 % 100, n % 100)
def tel_mobile():
    phone_n[0] += 1
    n = phone_n[0]
    return '06 39 98 %02d %02d' % (n // 100 % 100, n % 100)

ORG = {'address': '33 ZA de Penhoad Braz', 'postal_code': '29700', 'city': 'Plomelin'}
HICHAM = 'ddf1ec18-c1c1-4fc5-8095-af85ffbf4ee1'

COURSES = {
    'IGPS': ('ecff7f51-f201-4fc2-a4bb-b12e387ea5d0', 350, 7, 1),
    'INC-EXT': ('ad0c939a-b589-4f2a-b28c-ab741807a721', 345, 2, 1),
    'B0H0V': ('76108a3a-235f-4941-b459-a3c6289f654d', 775, 7, 1),
    'BSBEM': ('1c2d671f-4fc6-4ee3-ae6e-03b1f636348e', 1175, 14, 2),
    'INC-EPI': ('b80d61b3-7bba-43ae-9f45-3472405fd90a', 690, 4, 1),
    'SST-MAC': ('4e5b3ca8-e3b3-42f7-8a4c-188b40e7b176', 695, 7, 1),
    'ERG-GP': ('6c9e9bda-bf29-4c16-b7ce-92d16fa63b2a', 550, 4, 1),
    'R485': ('110ce8a9-a11a-4401-84d8-9c68f2db2dc6', 785, 7, 1),
    'R489': ('53884cc6-6887-42e1-b280-d1c8f10fcfa6', 785, 7, 1),
    'DUERP': ('f4bf6fa6-f416-4fbd-8693-9c40ba42784c', 895, 7, 1),
    'SST-FI': ('eb5d0ae2-2104-45a0-b6c6-2813495a20ce', 1175, 14, 2),
}
COURSE_TITLES = {
    'IGPS': 'Initiation aux gestes de premiers secours', 'INC-EXT': "Manipulation d'extincteurs",
    'B0H0V': "Préparation à l'habilitation électrique B0H0V", 'BSBEM': "Préparation à l'habilitation électrique BS BE Manoeuvre",
    'INC-EPI': 'Equipier de Première Intervention', 'SST-MAC': 'Maintien et Actualisation des Compétences de Sauveteur Secouriste du Travail',
    'ERG-GP': 'Formation Gestes et Postures', 'R485': 'Formation interne R485', 'R489': 'Formation interne R489',
    'DUERP': 'Construire une démarche de prévention via le DUERP', 'SST-FI': 'Formation initiale de Sauveteur Secouriste du Travail',
}

# Formateurs fictifs (Hicham existe déjà)
TRAINERS = {
    'hicham': {'id': HICHAM},
    'yannick': {'id': uid(), 'first_name': 'Yannick', 'last_name': 'Le Dréau', 'email': 'yannick.ledreau@gld-demo.fr',
                'phone': tel_mobile(), 'specialties': 'Sécurité incendie, évacuation, manipulation d\'extincteurs',
                'is_internal': True, 'qualifications': 'Technicien de maintenance incendie, formateur EPI'},
    'sophie': {'id': uid(), 'first_name': 'Sophie', 'last_name': 'Kerhervé', 'email': 'sophie.kerherve@formelec-demo.fr',
               'phone': tel_mobile(), 'specialties': 'Habilitation électrique, prévention des risques électriques',
               'is_internal': False, 'qualifications': 'Formatrice habilitation électrique (NF C 18-510)'},
}
TRAINER_FOR = {'INC-EXT': 'yannick', 'INC-EPI': 'yannick', 'B0H0V': 'sophie', 'BSBEM': 'sophie'}

# Entreprises fictives : nom, adresse, CP, ville, NAF, libellé NAF, effectif, forme, formations typiques, postes
CLIENTS = [
    ('Menuiserie Kerbriant', '14 rue des Charpentiers', '29500', 'Ergué-Gabéric', '16.23Z', 'Fabrication de charpentes et d\'autres menuiseries', '20-49', 'SARL',
     ['SST-MAC', 'SST-FI', 'ERG-GP', 'INC-EXT'], ['Menuisier', 'Menuisière', 'Poseur', 'Chef d\'atelier', 'Apprenti menuisier']),
    ('Transports Le Bihannic', 'ZA de Lumunoch', '29510', 'Briec', '49.41A', 'Transports routiers de fret interurbains', '50-99', 'SAS',
     ['SST-MAC', 'R489', 'INC-EPI', 'ERG-GP'], ['Chauffeur poids lourd', 'Cariste', 'Agent de quai', 'Exploitant transport']),
    ('Résidence Ar Steredenn', '2 allée des Hortensias', '29170', 'Fouesnant', '87.10A', 'Hébergement médicalisé pour personnes âgées', '50-99', 'Association',
     ['SST-MAC', 'INC-EPI', 'ERG-GP', 'IGPS'], ['Aide-soignante', 'Aide-soignant', 'Agent de service hospitalier', 'Infirmière', 'Agent d\'entretien']),
    ('Cornouaille Usinage', '7 rue de la Forge', '29120', 'Pont-l\'Abbé', '25.62B', 'Mécanique industrielle', '20-49', 'SAS',
     ['SST-FI', 'SST-MAC', 'B0H0V', 'R485', 'INC-EXT'], ['Tourneur', 'Fraiseur', 'Opérateur CN', 'Technicien maintenance', 'Magasinier']),
    ('Coopérative Maraîchère de l\'Aven', 'Route de Kerdruc', '29340', 'Riec-sur-Bélon', '46.31Z', 'Commerce de gros de fruits et légumes', '20-49', 'SCA',
     ['R489', 'ERG-GP', 'SST-MAC', 'INC-EXT'], ['Préparateur de commandes', 'Cariste', 'Agent de conditionnement', 'Chef d\'équipe']),
    ('Supermarché Ty Marc\'had', '1 avenue de la Plage', '29950', 'Bénodet', '47.11F', 'Hypermarchés et supermarchés', '50-99', 'SAS',
     ['SST-MAC', 'INC-EPI', 'ERG-GP', 'R485'], ['Employé libre-service', 'Hôtesse de caisse', 'Boucher', 'Responsable de rayon', 'Réceptionnaire']),
    ('Glenan Marine', 'Port de plaisance', '29750', 'Loctudy', '33.15Z', 'Réparation et maintenance navale', '10-19', 'SARL',
     ['SST-FI', 'B0H0V', 'INC-EXT'], ['Mécanicien marine', 'Électricien de bord', 'Gréeur', 'Chef de chantier']),
    ('Garage Kerdévot Automobiles', '22 route de Coray', '29500', 'Ergué-Gabéric', '45.20A', 'Entretien et réparation de véhicules', '10-19', 'SARL',
     ['SST-MAC', 'B0H0V', 'INC-EXT'], ['Mécanicien automobile', 'Carrossier', 'Réceptionnaire après-vente', 'Apprenti mécanicien']),
    ('Fromagerie Ker Laëz', 'Zone de Penn ar Roz', '29150', 'Châteaulin', '10.51C', 'Fabrication de fromage', '20-49', 'SAS',
     ['SST-FI', 'SST-MAC', 'ERG-GP', 'INC-EPI'], ['Opérateur de production', 'Fromager', 'Agent de conditionnement', 'Responsable qualité']),
    ('Clinique vétérinaire Ar Gwez', '5 rue de Lorient', '29300', 'Quimperlé', '75.00Z', 'Activités vétérinaires', '10-19', 'SELARL',
     ['IGPS', 'SST-FI', 'INC-EXT'], ['Vétérinaire', 'Auxiliaire vétérinaire', 'Secrétaire', 'ASV']),
    ('Maçonnerie Le Corre et Fils', '9 hent ar Vilin', '29710', 'Plogastel-Saint-Germain', '43.99C', 'Travaux de maçonnerie générale', '20-49', 'SARL',
     ['SST-MAC', 'SST-FI', 'ERG-GP', 'R485'], ['Maçon', 'Chef de chantier', 'Manoeuvre', 'Coffreur', 'Conducteur d\'engins']),
    ('Moal Électricité Services', '18 rue Jean Jaurès', '29100', 'Douarnenez', '43.21A', 'Travaux d\'installation électrique', '10-19', 'SARL',
     ['BSBEM', 'B0H0V', 'SST-MAC'], ['Électricien', 'Électricienne', 'Apprenti électricien', 'Chef d\'équipe']),
    ('Hôtel Kastell Mor', '3 corniche de la Mer', '29950', 'Bénodet', '55.10Z', 'Hôtels et hébergement similaire', '20-49', 'SAS',
     ['INC-EPI', 'SST-MAC', 'IGPS'], ['Réceptionniste', 'Femme de chambre', 'Cuisinier', 'Serveur', 'Veilleur de nuit']),
    ('Kervéguen Logistique', 'ZI de Kerdroniou', '29000', 'Quimper', '52.10B', 'Entreposage et stockage non frigorifique', '50-99', 'SAS',
     ['R489', 'R485', 'SST-MAC', 'INC-EPI', 'ERG-GP'], ['Cariste', 'Préparateur de commandes', 'Chef de quai', 'Gestionnaire de stock']),
    ('Agri-Équipements du Pays Bigouden', 'Route de Pont-l\'Abbé', '29720', 'Plonéour-Lanvern', '46.61Z', 'Commerce de gros de matériel agricole', '10-19', 'SARL',
     ['SST-MAC', 'R489', 'B0H0V'], ['Technicien SAV', 'Magasinier', 'Commercial itinérant', 'Mécanicien agricole']),
    ('Mareyage Ty Ar Mor', 'Port de pêche', '29760', 'Penmarch', '46.38A', 'Commerce de gros de produits de la mer', '20-49', 'SAS',
     ['SST-FI', 'ERG-GP', 'R485', 'INC-EXT'], ['Fileteur', 'Agent de marée', 'Préparateur', 'Chauffeur livreur']),
    ('Imprimerie Kemper Graphik', '11 rue de Brest', '29000', 'Quimper', '18.12Z', 'Autre imprimerie', '20-49', 'SARL',
     ['SST-MAC', 'INC-EPI', 'B0H0V'], ['Conducteur offset', 'Infographiste', 'Façonnier', 'Responsable de fabrication']),
    ('Micro-crèche Bugale Mad', '4 rue des Écoles', '29700', 'Plomelin', '88.91A', 'Accueil de jeunes enfants', '6-9', 'SAS',
     ['IGPS', 'SST-FI', 'INC-EXT'], ['Auxiliaire de puériculture', 'Éducatrice de jeunes enfants', 'Agent petite enfance']),
    ('Scierie du Steïr', 'Moulin du Steïr', '29000', 'Quimper', '16.10A', 'Sciage et rabotage du bois', '20-49', 'SARL',
     ['SST-MAC', 'R489', 'INC-EPI', 'ERG-GP'], ['Scieur', 'Cariste', 'Affûteur', 'Opérateur de ligne']),
    ('Plasturgie de l\'Isole', 'ZA de Kervidanou', '29300', 'Quimperlé', '22.29A', 'Fabrication d\'autres articles en matières plastiques', '50-99', 'SAS',
     ['SST-FI', 'SST-MAC', 'B0H0V', 'INC-EPI', 'ERG-GP'], ['Régleur', 'Opérateur de production', 'Technicien qualité', 'Cariste']),
]
FORMES = {'SARL': 'Société à responsabilité limitée', 'SAS': 'Société par actions simplifiée', 'SCA': 'Société coopérative agricole',
          'SELARL': "Société d'exercice libéral à responsabilité limitée", 'Association': 'Association déclarée'}

PRENOMS_F = ['Anaïs', 'Gwenola', 'Nolwenn', 'Morgane', 'Camille', 'Léa', 'Maëlle', 'Sophie', 'Élodie', 'Katell', 'Laura', 'Julie',
             'Aurélie', 'Émilie', 'Soizic', 'Marion', 'Chloé', 'Céline', 'Typhaine', 'Mélanie', 'Claire', 'Sandrine', 'Annaïg', 'Lucie']
PRENOMS_H = ['Yann', 'Erwan', 'Gaël', 'Ronan', 'Loïc', 'Kévin', 'Mathieu', 'Thomas', 'Nicolas', 'Julien', 'Goulven', 'Tanguy',
             'Maël', 'Bastien', 'Antoine', 'Pierre', 'Florian', 'Corentin', 'Brendan', 'Alan', 'Jérôme', 'Sébastien', 'Hugo', 'Malo']
NOMS = ['Le Gall', 'Le Goff', 'Kerjean', 'Le Floch', 'Morvan', 'Tanguy', 'Le Bihan', 'Guéguen', 'Quéméner', 'Le Roux', 'Cariou',
        'Le Bris', 'Jaouen', 'Le Meur', 'Calvez', 'Kervella', 'Le Berre', 'Guillou', 'Le Moal', 'Riou', 'Pennec', 'Hascoët',
        'Le Cam', 'Nédélec', 'Bothorel', 'Le Pape', 'Corre', 'Salaün', 'Le Dû', 'Daniel', 'Coïc', 'Moysan', 'Le Lay', 'Toullec',
        'Gourmelen', 'Le Grand', 'Jézéquel', 'Abgrall', 'Le Saux', 'Pérennou', 'Kerboul', 'Le Quéré', 'Thépaut', 'Le Hir']
FONCTIONS_CONTACT = [('Responsable des ressources humaines', 'RH'), ('Responsable QSE', 'QSE'), ('Gérant', 'Direction'),
                     ('Assistante de direction', 'Direction'), ('Directrice', 'Direction'), ('Responsable de production', 'Production')]

used_names = set()
def person(gender=None):
    for _ in range(200):
        g = gender or random.choice(['female', 'male'])
        fn = random.choice(PRENOMS_F if g == 'female' else PRENOMS_H)
        ln = random.choice(NOMS)
        if (fn, ln) not in used_names:
            used_names.add((fn, ln))
            return g, fn, ln
    return g, fn, ln

def slug(s):
    import unicodedata
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower()
    return ''.join(c if c.isalnum() else '-' for c in s).strip('-').replace('--', '-')

files = {}
def emit(name, line):
    files.setdefault(name, []).append(line)

# ---------------------------------------------------------------- formateurs
for key, t in TRAINERS.items():
    if key == 'hicham':
        continue
    emit('01_referentiel', ins('trainers', {k: v for k, v in t.items()}))
    emit('01_referentiel', track('trainers', t['id']))

# ---------------------------------------------------------------- clients, contacts, salariés
clients = []
for i, (name, addr, cp, city, naf, naf_label, eff, forme, formations, jobs) in enumerate(CLIENTS):
    cid = uid()
    siren = '000' + ''.join(random.choice('0123456789') for _ in range(6))
    domain = slug(name).replace('-', '')[:18] + '-demo.fr'
    g, fn, ln = person()
    fonction, _ = random.choice(FONCTIONS_CONTACT)
    contact_email = f'{slug(fn)}.{slug(ln)}@{domain}'.replace('-', '')
    contact_email = contact_email.replace(domain.replace('-', ''), domain)
    phone = tel_fixe()
    c = {'id': cid, 'name': name, 'address': addr, 'postal_code': cp, 'city': city, 'siren': siren, 'siret': siren + '00018',
         'tva': tva(siren), 'naf': naf, 'naf_code': naf, 'naf_label': naf_label, 'effectif': eff, 'forme_juridique': FORMES[forme],
         'contact_name': f'{fn} {ln}', 'contact_function': fonction, 'contact_email': contact_email, 'contact_phone': phone,
         'email': f'contact@{domain}', 'type': 'client', 'client_type': 'entreprise', 'status': 'actif',
         'billing_email': f'comptabilite@{domain}', 'default_payment_terms': random.choice(['à 30 jours', 'à 30 jours', 'à 45 jours fin de mois']),
         'created_at': datetime(2026, 3, 2) + timedelta(days=random.randint(0, 40), hours=random.randint(8, 17))}
    emit('02_clients', ins('clients', c))
    emit('02_clients', track('clients', cid))
    contacts = []
    k = {'id': uid(), 'client_id': cid, 'name': f'{fn} {ln}', 'first_name': fn, 'last_name': ln, 'civilite': 'Mme' if g == 'female' else 'M',
         'role': fonction, 'fonction': fonction, 'email': contact_email, 'phone': phone, 'mobile': tel_mobile(),
         'is_primary': True, 'is_document_contact': True, 'is_billing': random.random() < 0.5, 'is_followup': True}
    emit('02_clients', ins('client_contacts', k)); contacts.append(k)
    if random.random() < 0.55:
        g2, fn2, ln2 = person()
        f2 = random.choice([f for f, _ in FONCTIONS_CONTACT if f != fonction])
        k2 = {'id': uid(), 'client_id': cid, 'name': f'{fn2} {ln2}', 'first_name': fn2, 'last_name': ln2,
              'civilite': 'Mme' if g2 == 'female' else 'M', 'role': f2, 'fonction': f2,
              'email': f'{slug(fn2)}.{slug(ln2)}@{domain}', 'phone': phone, 'mobile': tel_mobile(),
              'is_primary': False, 'is_document_contact': False, 'is_billing': not k['is_billing'], 'is_followup': False}
        emit('02_clients', ins('client_contacts', k2)); contacts.append(k2)
    n_emp = {'6-9': 7, '10-19': 10, '20-49': 16, '50-99': 22}[eff]
    employees = []
    for _ in range(n_emp):
        g, fn, ln = person()
        age = random.choices([22, 28, 35, 42, 50, 58], weights=[2, 4, 5, 5, 4, 2])[0] + random.randint(-3, 4)
        tid = uid()
        e = {'id': tid, 'first_name': fn, 'last_name': ln.upper(), 'gender': g, 'client_id': cid, 'job_title': random.choice(jobs),
             'birth_date': date(2026 - age, random.randint(1, 12), random.randint(1, 28)),
             'email': f'{slug(fn)}.{slug(ln)}@{domain}' if random.random() < 0.6 else None,
             'csp': random.choices(['Ouvriers', 'Employés', 'Agents de maîtrise', 'Cadres'], weights=[5, 4, 2, 1])[0],
             'refused_ssn': True}
        emit('02_clients', ins('trainees', e))
        emit('02_clients', track('trainees', tid))
        employees.append(e)
    clients.append({'c': c, 'contacts': contacts, 'employees': employees, 'formations': formations, 'name': name,
                    'domain': domain})

# ---------------------------------------------------------------- planning des sessions
def workdays(start, end):
    d = start
    while d <= end:
        if d.weekday() < 5 and not (d.month == 5 and d.day in (1, 8, 14, 25)) and not (d.month == 7 and d.day == 14) and not (d.month == 8 and d.day == 15):
            yield d
        d += timedelta(days=1)

past_days = [d for d in workdays(date(2026, 4, 13), date(2026, 10, 9)) if not (date(2026, 7, 27) <= d <= date(2026, 8, 21))]
future_days = [d for d in workdays(date(2026, 10, 19), date(2026, 12, 11)) if d != date(2026, 11, 11)]
random.shuffle(past_days)
plan = []
busy = set()
for d in sorted(past_days[:40]):
    plan.append(('past', d))
for d in sorted(random.sample(future_days, 9)):
    plan.append(('future', d))

def hours_for(code, d):
    h = COURSES[code][2]
    if h == 2:
        return ('09:00', '11:00', 'half')
    if h == 4:
        return random.choice([('08:30', '12:30', 'half'), ('13:30', '17:30', 'half')])
    return ('09:00', '17:00', 'full')

sessions = []
quote_seq = {}
inv_seq = [0]
for when, d in plan:
    cl = random.choice(clients)
    code = random.choice(cl['formations'])
    cid_course, price, hours, ndays = COURSES[code]
    if code in ('SST-FI', 'BSBEM'):
        ndays = 2
    days = [d]
    while len(days) < ndays:
        nd = days[-1] + timedelta(days=1)
        while nd.weekday() >= 5:
            nd += timedelta(days=1)
        days.append(nd)
    trainer_key = TRAINER_FOR.get(code, 'hicham')
    if any((x, trainer_key) in busy for x in days):
        continue
    for x in days:
        busy.add((x, trainer_key))
    start_t, end_t, day_type = hours_for(code, d)
    intra_site = random.random() < 0.7
    maxp = 10 if code in ('SST-FI', 'SST-MAC') else 12
    nb = min(len(cl['employees']), random.randint(4, 9 if code.startswith('SST') else 10))
    trainees = random.sample(cl['employees'], nb)
    group_price = price * (ndays if hours >= 7 and ndays > 1 and code not in ('SST-FI', 'BSBEM') else 1)
    total = round(group_price * (1 + (0.15 if nb > 8 else 0)), 0)
    sid = uid()
    contact = cl['contacts'][0]
    s = {'id': sid, 'course_id': cid_course, 'client_id': cl['c']['id'], 'trainer_id': TRAINERS[trainer_key]['id'],
         'start_date': days[0], 'end_date': days[-1], 'start_time': start_t, 'end_time': end_t, 'day_type': day_type,
         'is_intra': True, 'session_type': 'intra', 'min_participants': 4, 'max_participants': maxp,
         'location_name': 'Dans les locaux du client' if intra_site else 'Salle de formation GLD',
         'location_address': cl['c']['address'] if intra_site else ORG['address'],
         'location_postal_code': cl['c']['postal_code'] if intra_site else ORG['postal_code'],
         'location_city': cl['c']['city'] if intra_site else ORG['city'],
         'contact_id': contact['id'], 'signatory_name': contact['name'], 'signatory_role': contact['fonction'],
         'total_price': total, 'funding_type': random.choice(['none', 'none', 'opco']),
         'signature_mode': 'auto', 'requires_forprev': False, 'location_type': 'client_site' if intra_site else None,
         'created_at': datetime.combine(days[0] - timedelta(days=random.randint(25, 45)), datetime.min.time()) + timedelta(hours=10)}
    if when == 'past':
        s.update({'status': 'completed', 'convention_sent': True, 'convention_sent_date': s['created_at'] + timedelta(days=2),
                  'convention_signed': True, 'convention_signed_date': s['created_at'] + timedelta(days=random.randint(5, 12))})
    else:
        lead = (days[0] - TODAY).days
        signed = lead < 30 and random.random() < 0.7
        s.update({'status': 'planned', 'convention_sent': lead < 40, 'convention_sent_date': (s['created_at'] + timedelta(days=2)) if lead < 40 else None,
                  'convention_signed': signed, 'convention_signed_date': (s['created_at'] + timedelta(days=8)) if signed else None})
        if s['created_at'].date() > TODAY:
            s['created_at'] = datetime.combine(TODAY - timedelta(days=random.randint(1, 10)), datetime.min.time()) + timedelta(hours=9)
    sessions.append({'s': s, 'when': when, 'code': code, 'days': days, 'cl': cl, 'trainees': trainees, 'trainer': trainer_key,
                     'hours': hours, 'ndays': ndays, 'day_type': day_type, 'start_t': start_t, 'end_t': end_t})

POSITIFS = ['Formateur très pédagogue, exemples concrets liés à notre activité.', 'Beaucoup de pratique, mises en situation réalistes.',
            'Bonne ambiance, on ose poser des questions.', 'Très clair, adapté à notre poste de travail.',
            'Les exercices sur le terrain étaient très utiles.', 'Formation dynamique, le temps passe vite.',
            'Contenu complet et bien expliqué.', 'Le formateur connaît bien le terrain.']
AMELIOR = ['Un peu plus de temps pour la pratique.', 'Salle un peu petite pour les exercices.', 'Prévoir un support à emporter.',
           'Rythme soutenu l\'après-midi.', None, None, None, None]
PROJETS = ['Appliquer les consignes dans mon atelier.', 'Mieux réagir en cas d\'accident sur le site.', 'Partager avec mon équipe.', None, None]

def score(base=4.6):
    return max(3, min(5, round(random.gauss(base, 0.5))))

# ---------------------------------------------------------------- sessions, inscriptions, émargements, évaluations
for n, se in enumerate(sessions):
    s = se['s']
    f = '03_sessions_%02d' % (n // 8)
    emit(f, ins('sessions', s))
    emit(f, track('sessions', s['id']))
    past = se['when'] == 'past'
    absent_idx = random.randrange(len(se['trainees'])) if past and random.random() < 0.18 else None
    late_idx = random.randrange(len(se['trainees'])) if past and se['day_type'] == 'full' and random.random() < 0.15 else None
    for i, t in enumerate(se['trainees']):
        stid = uid()
        absent = i == absent_idx
        failed = past and not absent and random.random() < 0.04
        st = {'id': stid, 'session_id': s['id'], 'trainee_id': t['id'], 'registration_date': s['created_at'] + timedelta(days=1),
              'trainee_status': 'registered', 'convocation_sent_at': s['created_at'] + timedelta(days=random.randint(3, 10))}
        if past:
            st.update({'result': None if absent else ('non_acquis' if failed else 'acquis'), 'presence_complete': not absent,
                       'absent': absent, 'absent_reason': 'Arrêt maladie' if absent else None,
                       'info_sheet_completed': True, 'evaluation_completed': not absent,
                       'evaluation_completed_at': datetime.combine(se['days'][-1], datetime.min.time()) + timedelta(hours=16, minutes=random.randint(30, 55)) if not absent else None})
            if failed:
                st['remediation_proposal'] = 'Proposer une nouvelle session pour valider les gestes pratiques.'
            if i == late_idx:
                st.update({'arrival_date': se['days'][0], 'arrival_time': '10:15', 'presence_hours': se['hours'] - 1.25})
        emit(f, ins('session_trainees', st))
        # Fiche de renseignement (créée automatiquement à l'inscription) : complétée
        if past or random.random() < 0.4:
            emit(f, "update trainee_info_sheets set ssn_refused = true, highest_diploma = %s, csp = %s, job_title = %s, training_expectations = %s, rgpd_consent = true, rgpd_consent_date = %s, filled_at = %s, filled_online = true where session_id = '%s' and trainee_id = '%s';" % (
                q(random.choice(['CAP/BEP', 'CAP/BEP', 'Baccalauréat', 'BTS/DUT', 'Licence', 'Sans diplôme'])), q(t['csp']), q(t['job_title']),
                q(random.choice(['Savoir réagir en cas d\'accident', 'Mettre à jour mes connaissances', 'Être plus à l\'aise en situation réelle', 'Obligation pour mon poste', None])),
                q(s['created_at'] + timedelta(days=12)), q(s['created_at'] + timedelta(days=12)), s['id'], t['id']))
        if not past or absent:
            continue
        # Émargement par demi-journée, signatures
        sig = SIGS[random.randrange(len(SIGS))]
        for d in se['days']:
            morning = se['day_type'] == 'full' or se['start_t'] < '12:00'
            afternoon = se['day_type'] == 'full' or se['start_t'] >= '12:00'
            if i == late_idx and d == se['days'][0]:
                morning = True
            row = {'session_id': s['id'], 'trainee_id': t['id'], 'date': d, 'morning': morning, 'afternoon': afternoon,
                   'validated_by': 'portail', 'validated_at': datetime.combine(d, datetime.min.time()) + timedelta(hours=17)}
            if morning:
                hh, mm = map(int, se['start_t'].split(':'))
                extra = 75 if i == late_idx and d == se['days'][0] else 0
                row['signed_morning_at'] = datetime.combine(d, datetime.min.time()) + timedelta(hours=hh - 2, minutes=mm + random.randint(0, 12) + extra)
                row['signature_morning'] = sig
            if afternoon:
                hh = 13 if se['day_type'] == 'full' else int(se['start_t'][:2])
                row['signed_afternoon_at'] = datetime.combine(d, datetime.min.time()) + timedelta(hours=hh - 2, minutes=30 + random.randint(0, 12))
                row['signature_afternoon'] = sig
            emit(f, ins('attendance_halfdays', row))
        # Satisfaction à chaud
        base = random.choice([4.5, 4.7, 4.8, 4.9])
        ev = {'session_id': s['id'], 'trainee_id': t['id'], 'questionnaire_submitted': True, 'submitted_online': True,
              'submitted_at': st['evaluation_completed_at'], 'would_recommend': random.random() < 0.95}
        for col in ['q_org_documents', 'q_org_accueil', 'q_org_locaux', 'q_org_materiel', 'q_contenu_organisation', 'q_contenu_supports',
                    'q_contenu_duree', 'q_contenu_programme', 'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression',
                    'q_formateur_moyens', 'q_global_adequation', 'q_global_competences']:
            ev[col] = score(base - (0.3 if col in ('q_org_locaux', 'q_contenu_duree') else 0))
        ev['comment_general'] = random.choice(POSITIFS) if random.random() < 0.6 else None
        ev['improvements'] = random.choice(AMELIOR)
        ev['comment_projet'] = random.choice(PROJETS)
        emit(f, ins('trainee_evaluations', ev))
        # Évaluation à froid (sessions de plus de deux mois, environ 60 % de réponses)
        if (TODAY - se['days'][-1]).days > 60:
            sent = datetime.combine(se['days'][-1] + timedelta(days=60), datetime.min.time()) + timedelta(hours=9)
            row = {'session_id': s['id'], 'trainee_id': t['id'], 'sent_at': sent}
            if random.random() < 0.6:
                row.update({'skills_applied': score(4.4), 'knowledge_retained': score(4.3), 'job_impact': score(4.1), 'objectives_met': score(4.5),
                            'would_recommend': True, 'needs_met': True, 'completed_at': sent + timedelta(days=random.randint(1, 9)),
                            'concrete_examples': random.choice(['J\'ai pu intervenir lors d\'un malaise d\'un collègue.', 'Nous avons revu l\'organisation du poste.', 'Les consignes sont mieux appliquées dans l\'équipe.', None])})
            emit(f, ins('evaluations_cold', row))
        # Certificat SST
        if se['code'] in ('SST-FI', 'SST-MAC') and st['result'] == 'acquis':
            cert = {'session_id': s['id'], 'trainee_id': t['id'], 'formation_type': 'FI' if se['code'] == 'SST-FI' else 'MAC',
                    'date_certification': se['days'][-1], 'formateur_id': TRAINERS[se['trainer']]['id'],
                    'formateur_nom': 'Saidi', 'formateur_prenom': 'Hicham', 'candidat_certifie': True}
            for c_ in ['c1_ind1', 'c2_ind1', 'c2_ind2', 'c2_ind3', 'c2_ind4', 'c2_ind5', 'c3_ind1', 'c3_ind2', 'c4_ind1', 'c4_ind2',
                       'c5_ind1', 'c5_ind2', 'c5_ind3', 'c6_ind1', 'c7_ind1', 'c8_ind1', 'c8_ind2']:
                cert[c_] = True
            for k in range(1, 9):
                cert[f'c{k}_acquis'] = True
            emit(f, ins('sst_certifications', cert))
    if past:
        emit(f, ins('trainer_evaluations', {'session_id': s['id'], 'trainer_id': TRAINERS[se['trainer']]['id'],
             'group_motivation': score(4.4), 'group_level': score(4.0), 'material_conditions': score(4.2), 'organization': score(4.5),
             'documentation': score(4.4), 'overall_score': score(4.5),
             'successes': random.choice(['Groupe impliqué, bonnes questions.', 'Mises en situation réussies.', 'Bonne dynamique de groupe.']),
             'difficulties': random.choice([None, None, 'Salle exiguë pour les exercices pratiques.', 'Un participant arrivé en retard.']),
             'created_at': datetime.combine(se['days'][-1], datetime.min.time()) + timedelta(hours=18)}))

# ---------------------------------------------------------------- devis et factures
def ref(prefix, d, seqd):
    seqd[d] = seqd.get(d, 0) + 1
    return f'{prefix}-{d.strftime("%Y%m%d")}-{seqd[d]:05d}'

inv_by_day = {}
for se in sessions:
    s, cl = se['s'], se['cl']
    qd = (s['created_at'] - timedelta(days=random.randint(4, 12))).date()
    qid = uid()
    total_ht = s['total_price']
    title = COURSE_TITLES[se['code']]
    detail = f"Formation intra-entreprise, {len(se['trainees'])} participants, {se['hours']} heures"
    qt = {'id': qid, 'reference': ref('DEV', qd, quote_seq), 'client_id': cl['c']['id'], 'contact_id': s['contact_id'], 'session_id': s['id'],
          'quote_date': qd, 'validity_date': qd + timedelta(days=30), 'object': title, 'status': 'accepted',
          'tva_rate': 20, 'tva_applicable': True, 'total_ht': total_ht, 'total_tva': round(total_ht * 0.2, 2), 'total_ttc': round(total_ht * 1.2, 2),
          'created_by': 'Hicham Saidi', 'created_at': datetime.combine(qd, datetime.min.time()) + timedelta(hours=11)}
    emit('04_devis_factures', ins('quotes', qt))
    emit('04_devis_factures', track('quotes', qid))
    emit('04_devis_factures', ins('quote_items', {'quote_id': qid, 'position': 0, 'code': se['code'], 'description_title': title,
         'description_detail': detail, 'quantity': 1, 'unit': 'session', 'unit_price_ht': total_ht, 'tva_rate': 20, 'total_ht': total_ht,
         'course_id': s['course_id']}))
    emit('04_devis_factures', f"update sessions set quote_id = '{qid}' where id = '{s['id']}';")
    if se['when'] != 'past':
        continue
    idate = se['days'][-1] + timedelta(days=random.randint(0, 3))
    terms = cl['c']['default_payment_terms']
    due = idate + timedelta(days=30)
    if 'fin de mois' in terms:
        due = (idate + timedelta(days=45)).replace(day=28) + timedelta(days=4)
        due = due - timedelta(days=due.day)
    iid = uid()
    ttc = round(total_ht * 1.2, 2)
    age = (TODAY - due).days
    if age > 0 and random.random() < 0.9 or (TODAY - idate).days > 75:
        status, paid = 'paid', ttc
    elif age > 0:
        status, paid = 'sent', 0
    else:
        status, paid = 'sent', 0
    inv = {'id': iid, 'reference': ref('FACT', idate, inv_by_day), 'type': 'invoice', 'client_id': cl['c']['id'], 'contact_id': s['contact_id'],
           'quote_id': qid, 'session_id': s['id'], 'invoice_date': idate, 'service_start_date': se['days'][0], 'service_end_date': se['days'][-1],
           'due_date': due, 'object': title, 'payment_method': 'virement bancaire', 'payment_terms': terms, 'tva_applicable': True,
           'total_ht': total_ht, 'total_discount': 0, 'total_net_ht': total_ht, 'total_tva': round(total_ht * 0.2, 2), 'total_ttc': ttc,
           'amount_paid': paid, 'amount_due': round(ttc - paid, 2), 'status': status, 'created_by': 'Hicham Saidi', 'is_formation_pro': True,
           'created_at': datetime.combine(idate, datetime.min.time()) + timedelta(hours=15)}
    emit('04_devis_factures', ins('invoices', inv))
    emit('04_devis_factures', track('invoices', iid))
    emit('04_devis_factures', ins('invoice_items', {'invoice_id': iid, 'position': 0, 'code': se['code'], 'description_title': title,
         'description_detail': detail + f", du {se['days'][0].strftime('%d/%m/%Y')} au {se['days'][-1].strftime('%d/%m/%Y')}", 'quantity': 1,
         'unit': 'session', 'unit_price_ht': total_ht, 'tva_rate': 20, 'total_ht': total_ht, 'course_id': s['course_id']}))
    if status == 'paid':
        pdate = min(TODAY - timedelta(days=1), due - timedelta(days=random.randint(-6, 12)))
        emit('04_devis_factures', ins('invoice_payments', {'invoice_id': iid, 'amount': ttc, 'payment_date': pdate,
             'payment_method': 'virement bancaire', 'payment_reference': f'VIR {cl["name"].upper()[:20]}', 'created_by': 'Hicham Saidi'}))

# Devis en cours, refusés, brouillon (sans session)
OPEN = [('sent', 'SST-MAC', 12), ('sent', 'INC-EPI', 6), ('sent', 'B0H0V', 3), ('sent', 'R489', 9), ('refused', 'ERG-GP', 40),
        ('refused', 'SST-FI', 55), ('draft', 'BSBEM', 1), ('sent', 'DUERP', 20)]
for status, code, ago in OPEN:
    cl = random.choice(clients)
    qd = TODAY - timedelta(days=ago)
    price = COURSES[code][1]
    qid = uid()
    qt = {'id': qid, 'reference': ref('DEV', qd, quote_seq), 'client_id': cl['c']['id'], 'contact_id': cl['contacts'][0]['id'], 'quote_date': qd,
          'validity_date': qd + timedelta(days=30), 'object': COURSE_TITLES[code], 'status': status, 'tva_rate': 20, 'tva_applicable': True,
          'total_ht': price, 'total_tva': round(price * 0.2, 2), 'total_ttc': round(price * 1.2, 2), 'created_by': 'Hicham Saidi',
          'relance_count': 1 if status == 'sent' and ago > 10 else 0, 'last_relance_date': (qd + timedelta(days=8)) if status == 'sent' and ago > 10 else None,
          'lost_reason': 'Budget reporté à l\'an prochain' if status == 'refused' else None,
          'created_at': datetime.combine(qd, datetime.min.time()) + timedelta(hours=10)}
    emit('04_devis_factures', ins('quotes', qt))
    emit('04_devis_factures', track('quotes', qid))
    emit('04_devis_factures', ins('quote_items', {'quote_id': qid, 'position': 0, 'code': code, 'description_title': COURSE_TITLES[code],
         'description_detail': 'Formation intra-entreprise', 'quantity': 1, 'unit': 'session', 'unit_price_ht': price, 'tva_rate': 20,
         'total_ht': price, 'course_id': COURSES[code][0]}))

# ---------------------------------------------------------------- relation client
RDV = [(-21, 'realise', 'suivi', 'leurs_locaux', 'Point annuel sur le plan de formation'), (-9, 'realise', 'suivi', 'telephone', 'Besoin de recyclage SST pour 2027'),
       (-3, 'realise', 'decouverte', 'visio', 'Présentation des formations incendie'), (3, 'prevu', 'decouverte', 'leurs_locaux', 'Visite du site et analyse du besoin'),
       (8, 'prevu', 'relance', 'telephone', 'Relance devis habilitation électrique'), (15, 'prevu', 'suivi', 'leurs_locaux', 'Préparation des sessions du premier trimestre')]
for delta, status, kind, loc, note in RDV:
    cl = random.choice(clients)
    rid = uid()
    k = cl['contacts'][0]
    emit('05_relation', ins('prospect_rdv', {'id': rid, 'client_id': cl['c']['id'], 'rdv_date': TODAY + timedelta(days=delta),
         'rdv_time': random.choice(['09:30', '10:00', '14:00', '15:30']), 'rdv_type': kind, 'rdv_location': loc,
         'rdv_address': f"{cl['c']['address']}, {cl['c']['postal_code']} {cl['c']['city']}" if loc == 'leurs_locaux' else None,
         'contact_id': k['id'], 'contact_name': k['name'], 'contact_email': k['email'], 'contact_phone': k['phone'], 'conducted_by': 'Hicham',
         'status': status, 'notes': note, 'temperature': random.choice(['chaud', 'tiede']), 'source': 'client_existant'}))
    emit('05_relation', track('prospect_rdv', rid))
for cl in clients:
    for _ in range(random.randint(1, 3)):
        d = datetime(2026, 4, 1) + timedelta(days=random.randint(0, 190), hours=random.randint(8, 17))
        kind, title = random.choice([('call', 'Appel de suivi'), ('email', 'Envoi du programme et du devis'), ('note', 'Besoin exprimé'),
                                     ('meeting', 'Rendez-vous sur site')])
        emit('05_relation', ins('client_interactions', {'client_id': cl['c']['id'], 'type': kind, 'title': title,
             'content': random.choice(['Échange cordial, besoin confirmé pour le prochain trimestre.', 'Demande de dates pour une nouvelle session.',
                                       'Retour positif sur la dernière formation.', 'À rappeler après validation du budget.']),
             'author': 'Hicham Saidi', 'interaction_date': d}))

# ---------------------------------------------------------------- veille (rédigée par l'OF, sans contenu réglementaire inventé)
VEILLE = [('pedagogique', date(2026, 5, 4), 'INRS', 'Relecture des supports SST', 'Relecture annuelle des supports de formation SST au regard du document de référence en vigueur.', 'Supports vérifiés, aucune modification nécessaire.', 'traite'),
          ('metiers', date(2026, 6, 15), 'Interne', 'Retours terrain des techniciens incendie', 'Synthèse des remarques des techniciens sur les situations rencontrées en entreprise.', 'Deux exemples ajoutés au module EPI.', 'traite'),
          ('pedagogique', date(2026, 7, 2), 'Interne', 'Accueil des personnes en situation de handicap', 'Revue des aménagements possibles en salle et sur site client.', 'Fiche d\'accueil mise à jour.', 'traite'),
          ('legale', date(2026, 9, 7), 'Interne', 'Point sur les obligations de formation incendie', 'Revue interne des obligations de formation à communiquer aux clients.', None, 'en_cours'),
          ('metiers', date(2026, 9, 28), 'Interne', 'Émargement dématérialisé', 'Généralisation de l\'émargement par QR code sur toutes les sessions.', 'Déployé sur toutes les sessions.', 'traite'),
          ('pedagogique', date(2026, 10, 6), 'Interne', 'Quiz d\'évaluation des acquis', 'Ajout de questions de niveau moyen et difficile pour mieux distinguer les niveaux.', None, 'en_cours')]
for typ, d, src, sujet, desc, action, statut in VEILLE:
    vid = uid()
    emit('05_relation', ins('veille_qualiopi', {'id': vid, 'type': typ, 'date': d, 'source': src, 'sujet': sujet, 'description': desc,
         'action_menee': action, 'statut': statut, 'responsable': 'Hicham Saidi', 'date_traitement': d + timedelta(days=7) if action else None}))
    emit('05_relation', track('veille_qualiopi', vid))

# ---------------------------------------------------------------- ajustements : deux factures échues restées impayées
emit('06_ajustements', """with c as (select id from invoices where status = 'paid' and due_date between date '2026-10-12' - 40 and date '2026-10-12' - 5 order by due_date desc limit 2)
, d as (delete from invoice_payments where invoice_id in (select id from c) returning invoice_id)
update invoices set status = 'sent', amount_paid = 0, amount_due = total_ttc where id in (select id from c);""")

# ---------------------------------------------------------------- écriture
os.makedirs(OUT, exist_ok=True)
for old in os.listdir(OUT):
    os.remove(os.path.join(OUT, old))
for name, lines in sorted(files.items()):
    with open(os.path.join(OUT, name + '.sql'), 'w', encoding='utf-8') as fh:
        fh.write('-- Données de démonstration fictives (généré par generer_donnees_demo.py)\nbegin;\n')
        fh.write('\n'.join(lines))
        fh.write('\ncommit;\n')
print('sessions', len(sessions), 'passées', sum(1 for s in sessions if s['when'] == 'past'),
      'clients', len(clients), 'stagiaires', sum(len(c['employees']) for c in clients))
