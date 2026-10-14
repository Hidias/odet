// Bandeau « ENVIRONNEMENT DE TEST » : affiché quand l'application n'est pas branchée sur la base de production.
// Comparaison par variables (aucune adresse écrite en dur) : VITE_SUPABASE_PROD_URL n'est définie que sur les
// préversions. En production elle est absente, donc le bandeau ne s'affiche jamais.

const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase()
const prodUrl = norm(import.meta.env.VITE_SUPABASE_PROD_URL)
const currentUrl = norm(import.meta.env.VITE_SUPABASE_URL)

export const isTestDatabase = !!prodUrl && currentUrl !== prodUrl

export default function TestBanner() {
  if (!isTestDatabase) return null
  let host = ''
  try { host = new URL(currentUrl).host.split('.')[0] } catch { /* adresse illisible : on n'affiche pas l'hôte */ }
  return (
    <div
      role="status"
      className="w-full text-center text-[12px] font-semibold tracking-wide py-1 px-4"
      style={{ background: 'rgb(var(--c-danger))', color: '#fff' }}
    >
      ENVIRONNEMENT DE TEST{host ? ` · base ${host}` : ''} · les emails partent vers l'adresse de test
    </div>
  )
}
