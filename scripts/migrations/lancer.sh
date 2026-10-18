#!/usr/bin/env bash
# Application d'un lot de migrations sur la production, appelé par .github/workflows/migrations.yml.
#
# Un lot est décrit par un fichier supabase/lots/<lot>.conf (lignes CLE=chemin, sans espace) :
#   ESSAI=        essai en transaction annulée (se termine par « N test(s), M échec(s) »)
#   RETOUR_ESSAI= essai du retour arrière en transaction annulée (se termine par « N écart(s) »)
#   APPLICATION=  fichier d'application réelle (vide = lot d'essai seul, jamais appliqué)
#   RETOUR=       retour arrière réel, joué automatiquement si les tests échouent après application
#   TESTS=        tests rejoués après application (défaut : supabase/tests/droits_chantier2.sql)
#
# Étapes : 1 essai, 2 essai du retour arrière, 3 application si MODE=appliquer et 1 et 2 verts (0 échec, 0 écart),
# 4 tests rejoués, retour arrière immédiat s'ils échouent. La sauvegarde de nuit est vérifiée par le workflow avant.
# Variables : SUPABASE_DB_URL (secret), LOT, MODE (essai | appliquer), RAPPORT (fichier markdown à écrire).
# Le secret n'est jamais affiché : psql le lit dans l'environnement (PGDATABASE ne s'affiche pas dans les erreurs).
set -uo pipefail

: "${SUPABASE_DB_URL:?secret SUPABASE_DB_URL absent}"
: "${LOT:?lot absent}"
MODE="${MODE:-essai}"
RAPPORT="${RAPPORT:-rapport.md}"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
CONF="$RACINE/supabase/lots/$LOT.conf"

[[ "$LOT" =~ ^[a-z0-9_-]+$ ]] || { echo "::error::Nom de lot invalide : $LOT"; exit 1; }
[ -f "$CONF" ] || { echo "::error::Lot introuvable : supabase/lots/$LOT.conf"; exit 1; }
[[ "$MODE" = essai || "$MODE" = appliquer ]] || { echo "::error::Mode invalide : $MODE"; exit 1; }

lire() { # lire CLE : valeur de la clé dans le fichier du lot, sans l'exécuter
  sed -n "s/^$1=\(.*\)$/\1/p" "$CONF" | tail -1 | tr -d '\r'
}
ESSAI="$(lire ESSAI)"; RETOUR_ESSAI="$(lire RETOUR_ESSAI)"; APPLICATION="$(lire APPLICATION)"
RETOUR="$(lire RETOUR)"; TESTS="$(lire TESTS)"; TESTS="${TESTS:-supabase/tests/droits_chantier2.sql}"

for f in "$ESSAI" "$RETOUR_ESSAI" "$TESTS" ${APPLICATION:+"$APPLICATION"} ${RETOUR:+"$RETOUR"}; do
  [[ "$f" =~ ^supabase/[A-Za-z0-9_./-]+\.sql$ && "$f" != *..* ]] || { echo "::error::Chemin refusé dans le lot : $f"; exit 1; }
  [ -f "$RACINE/$f" ] || { echo "::error::Fichier absent : $f"; exit 1; }
done
[ -n "$ESSAI" ] && [ -n "$RETOUR_ESSAI" ] || { echo "::error::ESSAI et RETOUR_ESSAI sont obligatoires"; exit 1; }
if [ -n "$APPLICATION" ]; then
  [ -n "$RETOUR" ] || { echo "::error::Un lot appliqué doit avoir son RETOUR"; exit 1; }
  grep -qiE '^\s*(begin|commit)\s*;' "$RACINE/$APPLICATION" && { echo "::error::BEGIN/COMMIT interdits dans $APPLICATION"; exit 1; }
fi

TMP="$(mktemp -d)"
: > "$RAPPORT"
ecrire() { printf '%s\n' "$*" >> "$RAPPORT"; }
ecrire "### Lot \`$LOT\`, mode $MODE"
ecrire ""

# Lance un fichier en une seule transaction ; sortie (sans le secret) dans $TMP/<nom>.txt
jouer() { # jouer nom fichier
  PGCONNECT_TIMEOUT=20 psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$RACINE/$2" \
    > "$TMP/$1.txt" 2>&1
  local rc=$?
  sed -i -E 's#postgres(ql)?://[^ ]+#[adresse masquée]#g' "$TMP/$1.txt"
  return $rc
}
extrait() { # extrait nom : fin utile du résultat pour le journal et la PR
  grep -v '^psql:.*NOTICE' "$TMP/$1.txt" | tail -c 20000
}
publier() { # publier titre nom
  echo "::group::$1"; cat "$TMP/$2.txt"; echo "::endgroup::"
  ecrire "<details><summary>$1</summary>"; ecrire ""; ecrire '```'; extrait "$2" >> "$RAPPORT"; ecrire '```'; ecrire "</details>"; ecrire ""
}
bilan_tests() { # bilan_tests nom → « total échecs » ou rien si le résultat volontaire est absent
  grep -oE '[0-9]+ test\(s\), [0-9]+ échec\(s\)' "$TMP/$1.txt" | tail -1 | sed -E 's/([0-9]+) test\(s\), ([0-9]+) échec\(s\)/\1 \2/'
}
bilan_ecarts() {
  grep -oE '[0-9]+ écart\(s\)' "$TMP/$1.txt" | head -1 | grep -oE '^[0-9]+'
}
tests_verts() { # tests_verts nom
  local b; b="$(bilan_tests "$1")"
  [ -n "$b" ] || return 1
  set -- $b
  [ "$1" -gt 0 ] && [ "$2" -eq 0 ]
}

# 1. Essai en transaction annulée (l'erreur volontaire finale est attendue)
jouer essai "$ESSAI"
publier "1. Essai en transaction annulée ($ESSAI)" essai
if tests_verts essai; then ESSAI_OK=1; ecrire "1. Essai : **vert** ($(bilan_tests essai | awk '{print $1" tests, "$2" échec"}'))"
else ESSAI_OK=0; ecrire "1. Essai : **ROUGE** ($(bilan_tests essai || true))"; fi

# 2. Essai du retour arrière en transaction annulée
jouer retour_essai "$RETOUR_ESSAI"
publier "2. Essai du retour arrière ($RETOUR_ESSAI)" retour_essai
N="$(bilan_ecarts retour_essai)"
if [ -n "$N" ] && [ "$N" -eq 0 ]; then RETOUR_OK=1; ecrire "2. Retour arrière : **vert** (0 écart)"
else RETOUR_OK=0; ecrire "2. Retour arrière : **ROUGE** (${N:-résultat absent} écart(s))"; fi

if [ "$ESSAI_OK" -ne 1 ] || [ "$RETOUR_OK" -ne 1 ]; then
  ecrire ""; ecrire "Rien n'est appliqué : un des essais n'est pas vert."
  echo "::error::Essais non verts, rien n'est appliqué"; exit 1
fi

if [ "$MODE" != appliquer ]; then
  ecrire ""; ecrire "Mode essai : rien n'est appliqué."; exit 0
fi
if [ -z "$APPLICATION" ]; then
  ecrire ""; ecrire "Ce lot n'a pas de fichier d'application (lot d'essai seul)."; exit 0
fi

# 3. Application réelle, une seule transaction
if ! jouer application "$APPLICATION"; then
  publier "3. Application ($APPLICATION)" application
  ecrire "3. Application : **ÉCHEC**, transaction annulée, rien n'est appliqué."
  echo "::error::Application en échec, rien n'est appliqué"; exit 1
fi
publier "3. Application ($APPLICATION)" application
ecrire "3. Application : **faite**"

# 4. Tests rejoués ; retour arrière immédiat s'ils ne sont pas verts
jouer tests "$TESTS"
publier "4. Tests rejoués ($TESTS)" tests
if tests_verts tests; then
  ecrire "4. Tests après application : **verts** ($(bilan_tests tests | awk '{print $1" tests, "$2" échec"}'))"
  exit 0
fi
ecrire "4. Tests après application : **ROUGES** ($(bilan_tests tests || echo 'résultat absent')) : retour arrière immédiat"
if jouer retour "$RETOUR"; then
  publier "5. Retour arrière ($RETOUR)" retour
  ecrire "5. Retour arrière : **fait**"
else
  publier "5. Retour arrière ($RETOUR)" retour
  ecrire "5. Retour arrière : **ÉCHEC, intervention nécessaire**"
fi
echo "::error::Tests rouges après application, retour arrière joué"; exit 1
