#!/usr/bin/env bash
# Sauvegarde complète de la base Supabase odet : rôles, schéma, données (y compris
# les comptes utilisateurs), fichiers du Storage. Le tout est compressé puis chiffré
# (GPG, AES-256) avant de quitter la machine.
#
# Variables attendues :
#   SUPABASE_DB_URL            connexion Postgres (pooler de session, port 5432)
#   SUPABASE_URL               https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY  clé service_role (lecture des fichiers du Storage)
#   BACKUP_PASSPHRASE          phrase de chiffrement
#   DOSSIER_SORTIE             où écrire le fichier .tar.gz.gpg (défaut : ./sortie)
# Outils : supabase (CLI, utilise Docker), psql, node, gpg, tar.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL manquant}"
: "${SUPABASE_URL:?SUPABASE_URL manquant}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY manquant}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquant}"
ICI="$(cd "$(dirname "$0")" && pwd)"
SORTIE="${DOSSIER_SORTIE:-./sortie}"
mkdir -p "$SORTIE"

HORODATAGE="$(TZ=Europe/Paris date +%Y-%m-%d_%H%M)"
NOM="odet-sauvegarde-$HORODATAGE"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT
D="$TRAVAIL/$NOM"
mkdir -p "$D"

echo "1/5 Rôles, schéma et données"
supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f "$D/roles.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$D/schema.sql"
# Comptage juste avant l'export des données : avec celui d'après, il encadre ce que l'application a pu écrire pendant
# l'export (journal d'audit, traces) ; la restauration doit retomber entre les deux.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' -f "$ICI/comptage.sql" > "$D/comptage_avant.tsv"
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --use-copy -f "$D/data.sql"
# Politiques du Storage et déclencheurs sur auth/storage : absents de l'export standard.
{
  echo "-- Objets d'odet dans les schémas auth et storage (généré par hors_public.sql)"
  psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -At -f "$ICI/hors_public.sql"
} > "$D/hors_public.sql"

echo "2/5 Comptage des lignes"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' -f "$ICI/comptage.sql" > "$D/comptage.tsv"
test -s "$D/comptage.tsv" || { echo "Comptage vide : connexion ou droits à vérifier"; exit 1; }

echo "3/5 Fichiers du Storage"
node "$ICI/storage.mjs" telecharger "$D/storage"

echo "4/5 Description"
{
  echo "Sauvegarde : $NOM"
  echo "Date (heure de Paris) : $(TZ=Europe/Paris date '+%d/%m/%Y %H:%M')"
  echo "Projet : $SUPABASE_URL"
  echo "Postgres : $(psql "$SUPABASE_DB_URL" -X -Atc 'show server_version')"
  echo "Tables comptées : $(wc -l < "$D/comptage.tsv")"
  echo "Comptes utilisateurs : $(awk -F'\t' '$1=="auth.users"{print $2}' "$D/comptage.tsv")"
  echo "Tailles :"
  du -sh "$D"/*.sql "$D/storage" | sed 's/^/  /'
} > "$D/LISEZMOI.txt"
cat "$D/LISEZMOI.txt"

echo "5/5 Compression et chiffrement"
tar -C "$TRAVAIL" -czf "$TRAVAIL/$NOM.tar.gz" "$NOM"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --output "$SORTIE/$NOM.tar.gz.gpg" "$TRAVAIL/$NOM.tar.gz" \
    3<<<"$BACKUP_PASSPHRASE"
( cd "$SORTIE" && sha256sum "$NOM.tar.gz.gpg" > "$NOM.tar.gz.gpg.sha256" )
echo "Fichier chiffré : $SORTIE/$NOM.tar.gz.gpg ($(du -h "$SORTIE/$NOM.tar.gz.gpg" | cut -f1))"
