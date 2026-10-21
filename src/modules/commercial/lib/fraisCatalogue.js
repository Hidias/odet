// Lignes prêtes à l'emploi des devis (bouton « Matériel et frais ») : matériel de formation et forfaits de
// déplacement. Zones 2 et 3 à fixer (le prix reste modifiable sur la ligne). Les codes de déplacement servent aussi
// aux tarifs par client (0418).
export const FRAIS_CATALOGUE = [
  { code: 'DEP-Z1', description_title: 'Forfait frais de déplacement zone 1', description_detail: '', unit_price_ht: 30, unit: 'forfait', nature: 'service' },
  { code: 'DEP-Z2', description_title: 'Forfait frais de déplacement zone 2', description_detail: 'Tarif à fixer', unit_price_ht: 0, unit: 'forfait', nature: 'service' },
  { code: 'DEP-Z3', description_title: 'Forfait frais de déplacement zone 3', description_detail: 'Tarif à fixer', unit_price_ht: 0, unit: 'forfait', nature: 'service' },
  { code: 'MAT-EXT-EAU', description_title: 'Extincteur de formation à eau', description_detail: '1 pour 3 personnes', unit_price_ht: 20, unit: 'unité' },
  { code: 'MAT-EXT-CO2', description_title: 'Extincteur CO2', description_detail: '1 pour 2 personnes', unit_price_ht: 20, unit: 'unité' },
]
export const CODES_DEPLACEMENT = FRAIS_CATALOGUE.filter((f) => f.code.startsWith('DEP-'))
