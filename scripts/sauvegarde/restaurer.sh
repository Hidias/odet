#!/usr/bin/env bash
# Restauration d'une sauvegarde odet dans un projet Supabase VIERGE.
# Refuse de toucher une base qui contient déjà des tables (protection de la production).
#
#   restaurer.sh <fichier .tar.gz.gpg>
#
# Variables attendues :
#   RESTORE_DB_URL            connexion Postgres du projet cible
#   RESTORE_SUPABASE_URL      https://<ref>.supabase.co du projet cible
#   RESTORE_SERVICE_ROLE_KEY  clé service_role du projet cible (envoi des fichiers)
#   BACKUP_PASSPHRASE         phrase de chiffrement de la sauvegarde
# Outils : psql, node, gpg, tar.
set -euo pipefail

ARCHIVE="${1:?Usage : restaurer.sh <fichier .tar.gz.gpg>}"
: "${RESTORE_DB_URL:?RESTORE_DB_URL manquant}"
: "${RESTORE_SUPABASE_URL:?RESTORE_SUPABASE_URL manquant}"
: "${RESTORE_SERVICE_ROLE_KEY:?RESTORE_SERVICE_ROLE_KEY manquant}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquant}"
ICI="$(cd "$(dirname "$0")" && pwd)"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

echo "1/5 Contrôle de la base cible"
EXISTANTES="$(psql "$RESTORE_DB_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$EXISTANTES" != "0" ]; then
  echo "ARRÊT : la base cible contient déjà $EXISTANTES tables dans public."
  echo "La restauration se fait uniquement dans un projet Supabase neuf."
  exit 1
fi

echo "2/5 Déchiffrement"
if [ -f "$ARCHIVE.sha256" ]; then
  ( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" )
fi
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --decrypt --output "$TRAVAIL/sauvegarde.tar.gz" "$ARCHIVE" 3<<<"$BACKUP_PASSPHRASE"
tar -C "$TRAVAIL" -xzf "$TRAVAIL/sauvegarde.tar.gz"
D="$(find "$TRAVAIL" -maxdepth 1 -type d -name 'odet-sauvegarde-*' | head -1)"
test -n "$D" || { echo "Archive illisible : dossier odet-sauvegarde-* absent"; exit 1; }
cat "$D/LISEZMOI.txt"

echo "3/5 Rôles, puis schéma et données (une seule transaction : tout ou rien)"
# Les rôles Supabase (anon, authenticated...) existent déjà dans un projet neuf :
# roles.sql ne fait que reprendre leurs réglages. Certaines lignes réservées à la
# plateforme sont refusées ; ce n'est pas bloquant, on les signale seulement.
psql "$RESTORE_DB_URL" -X -q -v ON_ERROR_STOP=0 -f "$D/roles.sql" 2> "$TRAVAIL/roles.err" || true
if [ -s "$TRAVAIL/roles.err" ]; then
  echo "Réglages de rôles ignorés (réservés à la plateforme) :"
  sed 's/^/  /' "$TRAVAIL/roles.err"
fi
# Les blocs COPY vides (tables internes de Supabase sans aucune ligne, dont certaines
# ne sont pas modifiables par l'utilisateur postgres) sont retirés : ils n'apportent rien.
awk '
  /^COPY / { bloc = $0; n = 0; dedans = 1; next }
  dedans && /^\\\.$/ { if (n > 0) { print bloc; print tampon; print "\\." } dedans = 0; tampon = ""; next }
  dedans { tampon = (n ? tampon "\n" : "") $0; n++; next }
  { print }
' "$D/data.sql" > "$TRAVAIL/data_utile.sql"
# Droits : un projet neuf donne par défaut tous les droits à anon et authenticated sur
# chaque table créée. L'export ne contient que les GRANT de la production, pas les
# retraits : sans la ligne ci-dessous, une table fermée au public (ex. trainees)
# redeviendrait lisible par anon. On neutralise ces droits par défaut le temps de
# recréer le schéma ; schema.sql remet ensuite les droits par défaut de la production.
cat > "$TRAVAIL/avant_schema.sql" <<'SQL'
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
SQL
PGOPTIONS='-c client_min_messages=warning' \
psql "$RESTORE_DB_URL" -X --single-transaction -v ON_ERROR_STOP=1 -q \
  -f "$TRAVAIL/avant_schema.sql" \
  -f "$D/schema.sql" \
  -c 'SET session_replication_role = replica' \
  -f "$TRAVAIL/data_utile.sql" \
  -c 'SET session_replication_role = origin' \
  -f "$D/hors_public.sql" > /dev/null

echo "4/5 Fichiers du Storage"
node "$ICI/storage.mjs" envoyer "$D/storage"

echo "5/5 Comparaison des lignes avec la sauvegarde"
psql "$RESTORE_DB_URL" -X -v ON_ERROR_STOP=1 -At -F $'\t' -f "$ICI/comptage.sql" > "$TRAVAIL/apres.tsv"
if diff <(sort "$D/comptage.tsv") <(sort "$TRAVAIL/apres.tsv") > "$TRAVAIL/ecarts.txt"; then
  echo "OK : $(wc -l < "$D/comptage.tsv") tables identiques ligne pour ligne (comptes utilisateurs : $(awk -F'\t' '$1=="auth.users"{print $2}' "$TRAVAIL/apres.tsv"))"
else
  echo "ÉCARTS (< sauvegarde, > base restaurée) :"
  cat "$TRAVAIL/ecarts.txt"
  exit 1
fi
