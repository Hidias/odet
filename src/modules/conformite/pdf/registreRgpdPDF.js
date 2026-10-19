// Registre des activités de traitement (art. 30 du RGPD) de la société courante, en PDF.
// Mise en page commune (core/pdf/layout.js). Seuls les traitements validés et à revoir figurent ; les archivés non.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument } from '../../../core/pdf/layout'

const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')
const liste = (a) => (Array.isArray(a) ? a.filter(Boolean).join(', ') : a || '')
const STATUTS = { valide: 'Validé', a_revoir: 'À revoir', archive: 'Archivé' }

export function buildRegistreRgpdPDF(ORG, traitements, sousTraitants) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Conformité RGPD', code: 'RGPD-REG',
    title: 'Registre des activités de traitement', subtitle: `Article 30 du RGPD  ·  État au ${fr(new Date())}`,
  })
  const nomST = Object.fromEntries((sousTraitants || []).map((s) => [s.cle, s.nom]))
  const actifs = (traitements || []).filter((t) => t.statut !== 'archive')
  f.section('1. Traitements')
  f.table(['Traitement', 'Finalité', 'Base légale', 'Statut'],
    actifs.map((t) => [t.nom_traitement, t.finalite || '', [t.base_legale, t.base_legale_article].filter(Boolean).join(' · '), STATUTS[t.statut] || t.statut]),
    { columnStyles: { 3: { cellWidth: 22 } } })
  actifs.forEach((t, i) => {
    f.section(`1.${i + 1} ${t.nom_traitement}`)
    f.table(['Rubrique', 'Contenu'], [
      ['Finalité', t.finalite || ''],
      ['Base légale', [t.base_legale, t.base_legale_article].filter(Boolean).join(' · ')],
      ['Personnes concernées', liste(t.categories_personnes)],
      ['Données', liste(t.categories_donnees)],
      ['Données sensibles', liste(t.donnees_sensibles) || 'Aucune'],
      ['Destinataires', liste(t.destinataires)],
      ['Sous-traitants', liste((t.sous_traitants || []).map((c) => nomST[c] || c))],
      ['Transfert hors UE', t.transfert_hors_ue ? `Oui${t.garanties_transfert ? ` (${t.garanties_transfert})` : ''}` : 'Non'],
      ['Durée de conservation', t.duree_conservation || ''],
      ['Mesures de sécurité', t.mesures_securite || ''],
      ['Analyse d\'impact', { requise: 'Requise', recommandee: 'Recommandée', non_requise: 'Non requise' }[t.aipd] || 'À évaluer'],
      ['Validé', t.valide_le ? `le ${fr(t.valide_le)}` : 'Non'],
    ], { columnStyles: { 0: { cellWidth: 46 } } })
  })
  f.section('2. Sous-traitants')
  f.table(['Sous-traitant', 'Rôle', 'Hébergement', 'Transfert', 'Contrat signé'],
    (sousTraitants || []).filter((s) => s.actif).map((s) => [s.nom, s.role || '', s.hebergement || '', s.transfert || '', fr(s.contrat_signe_le) || 'À signer']))
  f.finish()
  return doc
}
