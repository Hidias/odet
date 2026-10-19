import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Sparkles, StickyNote } from 'lucide-react'
import { supabase } from '../supabase'
import { useAuthStore } from '../store'
import { PageHeader } from '../../ui/PageHeader'
import { EmptyState, Spinner } from '../../ui/EmptyState'
import { Banner } from '../../ui/Banner'
import { useNotices, ouvrirPostIt } from './notices'

// Page « Quoi de neuf » (module optionnel « nouveautes ») : changements publiés, du plus récent au plus ancien,
// en français simple. Ouvrir la page retire la pastille « nouveau » du lien.
export default function QuoiDeNeuf() {
  const modules = useAuthStore((s) => s.modules)
  const { disponible, charge, marquerVu } = useNotices()
  const [items, setItems] = useState(null)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    let annule = false
    ;(async () => {
      const { data, error } = await supabase.from('platform_notices')
        .select('id, title, body, published_at')
        .eq('kind', 'nouveaute').eq('status', 'publie')
        .order('published_at', { ascending: false })
        .limit(200)
      if (annule) return
      if (error) { setErreur('Les nouveautés ne sont pas encore disponibles sur cette instance.'); setItems([]) }
      else setItems(data || [])
    })()
    return () => { annule = true }
  }, [])

  useEffect(() => { if (disponible) marquerVu() }, [disponible, marquerVu])

  const retours = (modules || []).includes('retours')

  if (charge && disponible && !(modules || []).includes('nouveautes')) {
    return (
      <div className="space-y-4">
        <PageHeader title="Quoi de neuf" />
        <Banner tone="info">La page des nouveautés n'est pas activée sur cette instance.</Banner>
      </div>
    )
  }

  // Regroupement par mois de publication
  const groupes = []
  for (const it of items || []) {
    const mois = it.published_at ? format(new Date(it.published_at), 'MMMM yyyy', { locale: fr }) : 'Sans date'
    const g = groupes[groupes.length - 1]
    if (g && g.mois === mois) g.items.push(it)
    else groupes.push({ mois, items: [it] })
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto w-full">
      <PageHeader
        title="Quoi de neuf"
        meta={<span>Les changements de l'application, expliqués simplement.</span>}
        actions={retours ? (
          <button type="button" className="btn btn-secondary" onClick={() => ouvrirPostIt('idee')}>
            <StickyNote className="w-4 h-4" aria-hidden="true" /> Proposer une idée
          </button>
        ) : null}
      />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      {items === null ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon={Sparkles} title="Aucune nouveauté publiée pour l'instant">
          Les prochains changements apparaîtront ici.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <section key={g.mois} className="space-y-3">
              <h2 className="eyebrow first-letter:uppercase">{g.mois}</h2>
              {g.items.map((it) => (
                <article key={it.id} className="card space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="section-title">{it.title || 'Mise à jour'}</h3>
                    {it.published_at && (
                      <time dateTime={it.published_at} className="text-ui-sm text-gray-500">
                        {format(new Date(it.published_at), "d MMMM yyyy 'à' HH'h'mm", { locale: fr })}
                      </time>
                    )}
                  </div>
                  {it.body && <p className="text-ui text-gray-700 whitespace-pre-line">{it.body}</p>}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
