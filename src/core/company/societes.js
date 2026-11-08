import { getCurrentCompanyId, setCurrentCompanyId } from './companyContext'

// Contexte multi-sociétés de l'écran (chantier C3) : sociétés du compte, société courante, vue groupe, modules actifs.
// Lu en base par my_company_context ; null si la fonction n'existe pas encore (rien ne change alors).
export async function chargerContexteSocietes(supabase) {
  try {
    const { data, error } = await supabase.rpc('my_company_context')
    if (error || !data || !Array.isArray(data.societes)) return null
    return data
  } catch {
    return null
  }
}

// Identité de la société courante quand ce n'est pas celle de l'instance (PDF, emails, en-têtes)
export async function chargerIdentiteSociete(supabase, ctx) {
  if (!ctx || ctx.vue_groupe) return null
  const courante = (ctx.societes || []).find((s) => s.id === ctx.current)
  if (!courante || courante.is_instance_owner) return null
  try {
    const { data, error } = await supabase.rpc('company_identity')
    return error ? null : data
  } catch {
    return null
  }
}

// Choix explicite d'une société (ou de la vue groupe) dans cet onglet, puis rechargement complet : toutes les
// données en mémoire changent de société d'un coup, rien ne se mélange.
export function choisirSociete(id) {
  setCurrentCompanyId(id || null)
  try {
    window.location.reload()
  } catch {
    /* hors navigateur */
  }
}

export const VUE_GROUPE = 'groupe'

// Refus de la vue groupe (0516) : même phrase que la base, qui refuse toute écriture faite en vue groupe
export const MESSAGE_VUE_GROUPE = 'Vue groupe : lecture seule. Pour créer ou modifier, choisissez une société dans l\'en-tête.'
export const estRefusVueGroupe = (err) => String(err?.message || '').startsWith('Vue groupe : lecture seule')

/** Société choisie, ou null en vue groupe et sans choix (instance à une seule société : la base pose la sienne) */
export const societeEnCours = () => { const c = getCurrentCompanyId(); return c && c !== VUE_GROUPE ? c : null }
/** Vue groupe choisie dans cet onglet (plusieurs sociétés à la fois) */
export const enVueGroupe = () => getCurrentCompanyId() === VUE_GROUPE

export function societeChoisie() {
  return getCurrentCompanyId()
}

export function nomSociete(s) {
  return s ? (s.short_name || s.legal_name || '') : ''
}

// Plusieurs sociétés, ou la vue groupe possible : le sélecteur s'affiche
export function multiSocietes(ctx) {
  return !!ctx && (ctx.societes || []).length > 1
}
