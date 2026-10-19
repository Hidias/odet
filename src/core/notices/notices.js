import { create } from 'zustand'
import { supabase } from '../supabase'

// Bandeau d'information et « Quoi de neuf » (chantier A, migration 0262).
// État lu par la base (notices_state) : bandeau à afficher, date de la dernière nouveauté publiée, pastille.
// Avant la migration (fonction absente), `disponible` reste faux : rien ne s'affiche et le post-it garde sa
// forme simple.

export const useNotices = create((set, get) => ({
  charge: false,
  disponible: false,
  banner: null,
  unseen: false,
  lastPublishedAt: null,

  async charger() {
    const { data, error } = await supabase.rpc('notices_state')
    if (error) {
      set({ charge: true, disponible: false, banner: null, unseen: false })
      return
    }
    set({
      charge: true,
      disponible: true,
      banner: data?.banner || null,
      unseen: !!data?.unseen,
      lastPublishedAt: data?.last_published_at || null,
    })
  },

  async marquerVu() {
    if (!get().disponible) return
    const { error } = await supabase.rpc('notices_mark_seen')
    if (!error) set({ unseen: false })
  },

  vider() {
    set({ charge: false, disponible: false, banner: null, unseen: false, lastPublishedAt: null })
  },
}))

// Fermeture du bandeau pour la journée : la clé dépend du texte, il réapparaît dès que le texte change
export function cleBandeau(banner) {
  if (!banner) return null
  const texte = `${banner.body || ''}|${banner.demo ? 1 : 0}`
  let h = 0
  for (let i = 0; i < texte.length; i += 1) h = ((h << 5) - h + texte.charCodeAt(i)) | 0
  return `odet.bandeau.ferme.${(h >>> 0).toString(36)}`
}

export function aujourdhui() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function bandeauFermeAujourdhui(banner) {
  const cle = cleBandeau(banner)
  if (!cle) return false
  try { return window.localStorage.getItem(cle) === aujourdhui() } catch { return false }
}

export function fermerBandeau(banner) {
  const cle = cleBandeau(banner)
  if (!cle) return
  try { window.localStorage.setItem(cle, aujourdhui()) } catch { /* stockage indisponible : fermé jusqu'au rechargement */ }
}

// Ouvre le post-it depuis n'importe quel écran (lien « Signaler un problème ou une idée »)
export const EVENEMENT_POSTIT = 'odet:postit-ouvrir'
export function ouvrirPostIt(kind = null) {
  window.dispatchEvent(new CustomEvent(EVENEMENT_POSTIT, { detail: { kind } }))
}

export const PHRASE_DEMO = 'Une partie des données affichées est fictive (démonstration).'
