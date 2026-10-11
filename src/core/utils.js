// ═══════════════════════════════════════════════════════════════
// src/lib/utils.js — Fonctions utilitaires partagées Access Campus
// ═══════════════════════════════════════════════════════════════
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

/**
 * Formater un montant en euros
 * @param {number|string} v - Montant
 * @returns {string} Ex: "1 200,00 €"
 */
export const money = (v) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v || 0)

/**
 * Formater une date courte : 14/02/2026
 */
export const fmtDate = (d) => {
  if (!d) return ''
  try { return format(new Date(d), 'dd/MM/yyyy') } catch { return '' }
}

/**
 * Formater une date longue : 14 février 2026
 */
export const fmtDateLong = (d) => {
  if (!d) return ''
  try { return format(new Date(d), 'd MMMM yyyy', { locale: fr }) } catch { return '' }
}

/**
 * Calculer le total HT d'une ligne de devis/facture
 */
export const calcLineTotal = (item) =>
  (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price_ht) || 0)

/**
 * Tronquer un texte avec "..."
 */
export const truncate = (str, max = 50) => {
  if (!str) return ''
  return str.length > max ? str.substring(0, max) + '…' : str
}
