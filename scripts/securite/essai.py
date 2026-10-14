#!/usr/bin/env python3
"""Fabrique le script d'essai du chantier 2 en transaction annulée.

Lancer `python3 scripts/securite/essai.py` réécrit
supabase/tests/essai_chantier2_transaction_annulee.sql : les migrations 0080 à 0086 à la suite,
puis les tests de droits. Le script se termine toujours par une erreur volontaire (fin des tests) :
toute l'exécution est annulée, rien n'est enregistré. Ne pas modifier le fichier produit à la main.
"""
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
mig = sorted((root / 'supabase' / 'migrations').glob('008[0-6]_*.sql'))
tests = root / 'supabase' / 'tests' / 'droits_chantier2.sql'

parts = ["""-- FICHIER GÉNÉRÉ par scripts/securite/essai.py : ne pas modifier à la main.
-- Essai du chantier 2 en transaction annulée : migrations 0080 à 0086, puis tests de droits.
-- Le script se termine TOUJOURS par une erreur volontaire « RÉSULTAT DES TESTS DE DROITS » :
-- tout est annulé, rien n'est enregistré. Il ne contient aucune validation de transaction.

-- Pas de BEGIN : l'éditeur envoie le texte en un seul message, exécuté dans une seule transaction implicite ;
-- l'erreur finale l'annule entièrement et la connexion reste propre.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '180s', true);
"""]
for f in mig:
    parts.append(f"\n-- ===== {f.name} =====\n")
    parts.append(f.read_text(encoding='utf-8'))
parts.append(f"\n-- ===== {tests.name} =====\n")
parts.append(tests.read_text(encoding='utf-8'))

out = root / 'supabase' / 'tests' / 'essai_chantier2_transaction_annulee.sql'
text = "".join(parts)
assert not re.search(r'^\s*commit\s*;', text, re.I | re.M), 'COMMIT interdit dans le script d\'essai'
out.write_text(text, encoding='utf-8')
print(f"{out.relative_to(root)} : {len(mig)} migrations + tests, {len(text)} caractères")
