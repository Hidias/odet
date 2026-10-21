#!/usr/bin/env python3
# Lit la description d'une pull request fusionnée et en tire ce que l'action « Nouveautés » doit faire.
#
# Consigne d'écriture (description de chaque PR) : UNE des deux sections, en français simple.
#
#   ## Quoi de neuf
#   Titre : Vos clients et leurs sites
#   Un client peut avoir plusieurs sites. ...
#   (une phrase ou deux : les lignes sont réunies en un seul paragraphe de 800 caractères au plus)
#
#     -> une entrée « Quoi de neuf » en BROUILLON (titre et texte tels quels), à publier dans Console › Quoi de neuf.
#        Réservé à ce qui se voit à l'écran avec les modules actifs.
#
#   ## Avancées techniques
#   Sauvegardes vérifiées chaque nuit.
#
#     -> une phrase ajoutée à l'entrée publiée « Avancées techniques » (pas de nouvelle entrée).
#
# Sans aucune des deux sections : rien n'est proposé (l'ancienne section « Ce qui change » n'est plus lue : elle
# produisait des brouillons techniques à réécrire).
#
# Règles d'écriture vérifiées : vouvoiement attendu, aucun code (accent grave), aucun numéro de migration, aucun
# tiret long, aucun émoji. Une phrase « Avancées techniques » qui ne les respecte pas n'est pas ajoutée ; un brouillon
# est créé quand même (il sera relu) avec un avertissement.
#
# Entrée : variable d'environnement PR_TEXTE. Sortie : fichiers titre.txt, texte.txt, ligne.txt et alertes.txt dans
# le dossier passé en argument (vides si rien à faire).

import os
import re
import sys

TITRE_MAX = 200
TEXTE_MAX = 800  # la base garde un seul paragraphe de 800 caractères au plus
LIGNE_MAX = 200

EMOJI = re.compile('[\U0001F000-\U0001FAFF☀-➿️]')


# Pied de description ajouté par l'outil de développement (ligne de tirets, mention de génération, lien de session) :
# jamais repris dans le Quoi de neuf, ni rien de ce qui le suit
PIED = re.compile(r'^\s*(-{2,}|_{2,}|\*{3,})\s*$|generated (by|with)|claude\.(ai|com)|claude code|\U0001F916', re.I)


def section(texte, nom):
    m = re.search(r'^#+\s*' + nom + r'\s*$(.*?)(?=^#+\s|\Z)', texte, re.M | re.S | re.I)
    if not m:
        return None
    garde = []
    for l in m.group(1).splitlines():
        if PIED.search(l):
            break
        garde.append(l)
    return '\n'.join(garde).strip()


def nettoyer(ligne):
    ligne = re.sub(r'^\s*[-*]\s*', '', ligne)
    ligne = re.sub(r'\*\*(.+?)\*\*', r'\1', ligne)
    return ligne.strip()


def fautes(texte):
    f = []
    if '`' in texte:
        f.append('code (accent grave)')
    if re.search(r'\b0\d{3}\b', texte):
        f.append('numéro de migration')
    if '—' in texte or '–' in texte:
        f.append('tiret long')
    if EMOJI.search(texte):
        f.append('émoji')
    if re.search(r'\btu\b|\btes\b|\bta\b', texte, re.I):
        f.append('tutoiement')
    return f


def lire(texte):
    texte = (texte or '').replace('\r', '')
    titre, corps, ligne, alertes = '', '', '', []

    qdn = section(texte, 'Quoi de neuf')
    if qdn:
        lignes = [nettoyer(l) for l in qdn.splitlines()]
        lignes = [l for l in lignes if l]
        if lignes:
            premiere = re.sub(r'^titre\s*:\s*', '', lignes[0], flags=re.I).strip()
            titre = premiere[:TITRE_MAX]
            corps = ' '.join(lignes[1:])[:TEXTE_MAX]
            if not corps:
                alertes.append('Quoi de neuf : texte vide sous le titre')
            f = fautes(titre + ' ' + corps)
            if f:
                alertes.append('Quoi de neuf (brouillon à relire) : ' + ', '.join(f))

    tech = section(texte, 'Avancées techniques')
    if tech:
        phrase = ' '.join(l for l in (nettoyer(x) for x in tech.splitlines()) if l)
        if phrase and not phrase.endswith(('.', '!', '?')):
            phrase += '.'
        f = fautes(phrase)
        if len(phrase) > LIGNE_MAX:
            f.append('plus de %d caractères' % LIGNE_MAX)
        if f:
            alertes.append('Avancées techniques : phrase non ajoutée (' + ', '.join(f) + ')')
        else:
            ligne = phrase

    return titre, corps, ligne, alertes


def main():
    dossier = sys.argv[1]
    titre, corps, ligne, alertes = lire(os.environ.get('PR_TEXTE', ''))
    for nom, valeur in (('titre', titre), ('texte', corps), ('ligne', ligne), ('alertes', '\n'.join(alertes))):
        with open(os.path.join(dossier, nom + '.txt'), 'w', encoding='utf-8') as fh:
            fh.write(valeur)


if __name__ == '__main__':
    main()
