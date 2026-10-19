# Journal d'audit commun (chantier F, migration 0345)

Spec : `odet-conformite-rgpd-certifications.md` § 5.7.

- La base pose l'auteur (compte, email, rôle), l'adresse IP et le navigateur de chaque ligne du journal : aucune ligne
  ne peut être écrite au nom d'un autre compte (`log_audit` ignore l'utilisateur passé par l'application).
- Déclencheur `app.audit_row()` sur les tables sensibles : stagiaires, handicap, Passeport (NIR), formateurs, comptes et
  appartenances, sociétés, réglages (organisme, facturation, certification), modules, factures, RGPD. Il écrit
  l'action, la table, l'identifiant et **la liste des champs modifiés, jamais leurs valeurs**.
- Les écritures sans compte (tâches de nuit, service) et les champs techniques seuls (dates de mise à jour,
  préférences d'affichage) ne sont pas tracés.
- Lecture inchangée : `conformite.journal.voir` (administrateurs). Les changements de modules sont désormais tracés.
- Reste : purge du journal à un an (avec les purges, 0344).
