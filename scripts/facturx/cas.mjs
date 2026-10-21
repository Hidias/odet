// Cas fictifs de Factur-X (EN 16931), validés par Mustang dans la vérification automatique.
// Utilisation : node scripts/facturx/cas.mjs <dossier de sortie>
// Écrit un fichier XML CII par cas. Aucune donnée réelle : organisme, clients et montants inventés.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCIIXML, buildSeller } from '../../api/generate-facturx.js'

const out = process.argv[2] || 'facturx-cas'
mkdirSync(out, { recursive: true })

const org = {
  legal_name: 'Organisme Essai SARL', name: 'Organisme Essai', siren: '123456782', siret: '12345678200017',
  address: '1 rue de la Recette', postal_code: '29200', city: 'Brest', tva_intra: 'FR32123456782',
  iban: 'FR1712345987650001234567806', bic: 'AGRIFRPPXXX', forme_juridique: 'SARL', capital_social: '10000',
  rcs: 'RCS Brest 123 456 782', tva_applicable: true, app_name: 'Outil essai',
}
const pro = { name: 'Client Pro Essai', siren: '552100554', siret: '55210055400013', tva: 'FR40552100554', address: '2 avenue du Test', postal_code: '35000', city: 'Rennes', client_type: 'entreprise' }
const publicClient = { name: 'Commune Essai', siren: '212900468', siret: '21290046800018', address: 'Place de la Mairie', postal_code: '29100', city: 'Douarnenez', client_type: 'public', chorus_service_code: 'SERVICE-FIN' }
const particulier = { name: 'Jeanne Essai', address: '3 impasse Fictive', postal_code: '29600', city: 'Morlaix', client_type: 'particulier' }

const mentionsPro = [
  'Escompte pour paiement anticipé : néant.',
  'Pénalités de retard : taux directeur de la Banque centrale européenne majoré de 10 points (art. L441-10 du code de commerce).',
  'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (art. D441-5 du code de commerce).',
]
const base = {
  type: 'invoice', invoice_date: '2026-10-19', due_date: '2026-11-18', payment_method: 'virement bancaire',
  payment_terms: 'à 30 jours', service_start_date: '2026-10-14', service_end_date: '2026-10-15', tva_applicable: true,
  issued_at: '2026-10-19T08:00:00Z', nature_operation: 'services', legal_mentions: mentionsPro,
}
const ligne = (o) => ({ description_title: 'Formation Sauveteur Secouriste du Travail', quantity: 1, unit: 'unité', unit_price_ht: 690, tva_rate: 20, nature: 'service', vat_regime: 'normal', ...o })

const cas = {
  'facture-20': [{ ...base, reference: 'FACT-20261019-00001' }, [ligne()], pro],
  'facture-remise-deux-taux': [{ ...base, reference: 'FACT-20261019-00002', discount_percent: 10, discount_label: 'Remise fidélité', nature_operation: 'mixte' },
    [ligne(), ligne({ description_title: 'Extincteur CO2 2 kg', quantity: 3, unit_price_ht: 59.9, tva_rate: 5.5, nature: 'bien' })], pro],
  'avoir-partiel': [{ ...base, type: 'credit_note', reference: 'AVR-20261019-00001', parent_reference: 'FACT-20261019-00001', parent_invoice_date: '2026-10-19', legal_mentions: [] },
    [ligne({ description_title: 'Remboursement partiel', unit_price_ht: 100 })], pro],
  'client-public-chorus': [{ ...base, reference: 'FACT-20261019-00003', chorus_service_code: 'SERVICE-FIN', chorus_engagement: 'EJ-2026-0042', client_reference: 'BC-778' }, [ligne()], publicClient],
  'particulier': [{ ...base, reference: 'FACT-20261019-00004', nature_operation: 'biens', legal_mentions: [] },
    [ligne({ description_title: 'Extincteur eau 6 L', unit_price_ht: 80, nature: 'bien' })], particulier],
  'ligne-exoneree': [{ ...base, reference: 'FACT-20261019-00005', legal_mentions: [...mentionsPro, 'Exonération de TVA, article 261-4-4° a du CGI. Attestation 53-2026-001 du 01/09/2026.'] },
    [ligne({ vat_regime: 'exonere', tva_rate: 0 }), ligne({ description_title: 'Livret stagiaire', quantity: 8, unit_price_ht: 6, nature: 'bien' })], pro],
  'autoliquidation': [{ ...base, reference: 'FACT-20261019-00006', legal_mentions: [...mentionsPro, 'Autoliquidation.'] },
    [ligne({ description_title: 'Pose de détecteurs (sous-traitance BTP)', vat_regime: 'autoliquidation', tva_rate: 0, unit_price_ht: 1200 })], pro],
  'facture-acompte': [{ ...base, reference: 'FACT-20261019-00008', invoice_kind: 'acompte', service_start_date: null, service_end_date: null },
    [ligne({ description_title: 'Acompte de 30 % sur le devis DEV-20261001-00001', description_detail: 'Part au taux de 20 %', unit: 'forfait', unit_price_ht: 270 }),
      ligne({ description_title: 'Acompte de 30 % sur le devis DEV-20261001-00001', description_detail: 'Part au taux de 5,5 %', unit: 'forfait', unit_price_ht: 13.5, tva_rate: 5.5 })], pro],
  'facture-solde': [{ ...base, reference: 'FACT-20261019-00009', invoice_kind: 'solde',
    deposit_refs: [{ reference: 'FACT-20261019-00008', invoice_date: '2026-10-01' }, { reference: 'FACT-20261019-00010', invoice_date: '2026-10-05' }] },
    [ligne({ quantity: 2, unit_price_ht: 500 }), ligne({ description_title: 'Livret', quantity: 10, unit_price_ht: 5, tva_rate: 5.5 }),
      ligne({ description_title: 'Remise fidélité (10 %)', unit: 'forfait', unit_price_ht: -100 }),
      ligne({ description_title: 'Remise fidélité (10 %)', unit: 'forfait', unit_price_ht: -5, tva_rate: 5.5 }),
      ligne({ description_title: "Reprise de l'acompte FACT-20261019-00008 du 01/10/2026", unit: 'forfait', unit_price_ht: -270 }),
      ligne({ description_title: "Reprise de l'acompte FACT-20261019-00008 du 01/10/2026", unit: 'forfait', unit_price_ht: -13.5, tva_rate: 5.5 }),
      ligne({ description_title: "Reprise de l'acompte FACT-20261019-00010 du 05/10/2026", unit: 'forfait', unit_price_ht: -100 })], pro],
}

const franchise = buildSeller({ ...org, tva_applicable: false }, { needsIban: true })
const seller = buildSeller(org, { needsIban: true })
for (const [nom, [inv, items, client]] of Object.entries(cas)) {
  writeFileSync(join(out, `${nom}.xml`), generateCIIXML(inv, items, client, seller))
}
writeFileSync(join(out, 'franchise.xml'), generateCIIXML({ ...base, reference: 'FACT-20261019-00007', tva_applicable: true, legal_mentions: [...mentionsPro, 'TVA non applicable, art. 293 B du CGI.'] },
  [ligne({ tva_rate: 0 })], pro, franchise))
console.log(`${Object.keys(cas).length + 1} cas écrits dans ${out}`)
