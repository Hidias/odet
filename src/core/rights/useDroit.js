import { useAuthStore } from '../store'

// Garde d'un bouton ou d'une action d'écriture (branche ecrans/gardes).
// Droits connus (my_rights) : le droit décide, comme la règle de la base qui refuserait l'écriture.
// Droits inconnus : `rolesDeRepli` s'il est donné, sinon le bouton reste affiché comme avant (la base refuse de
// toute façon ce qui n'est pas permis).
// `codes` : un code ou une liste (il suffit d'en avoir un).
export function peut(can, role, codes, rolesDeRepli) {
  const liste = Array.isArray(codes) ? codes : [codes]
  const verdicts = liste.map((c) => (typeof can === 'function' ? can(c) : null))
  if (verdicts.length > 0 && verdicts.every((v) => v === true || v === false)) return verdicts.some((v) => v === true)
  if (rolesDeRepli) return rolesDeRepli.includes(role)
  return true
}

export function useDroit(codes, rolesDeRepli) {
  const can = useAuthStore((s) => s.can)
  const role = useAuthStore((s) => s.userRole)
  useAuthStore((s) => s.rights)
  return peut(can, role, codes, rolesDeRepli)
}

// Plusieurs droits d'un coup : const d = useDroits({ creer: 'formation.sessions.creer', ... }) → d.creer
export function useDroits(table) {
  const can = useAuthStore((s) => s.can)
  const role = useAuthStore((s) => s.userRole)
  useAuthStore((s) => s.rights)
  const out = {}
  for (const [cle, val] of Object.entries(table)) {
    out[cle] = Array.isArray(val) && val.length === 2 && Array.isArray(val[1]) ? peut(can, role, val[0], val[1]) : peut(can, role, val)
  }
  return out
}
