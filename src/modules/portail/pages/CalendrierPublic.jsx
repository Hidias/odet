import { useEffect, useMemo, useState } from 'react'
import { Calendar, MapPin, Clock, Users, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import PublicLayout from '../../../app/PublicLayout'
import InscriptionEnLigne from '../components/InscriptionEnLigne'

// Calendrier public des sessions inter (0419, série du 21/10 n° 27) : formations à venir, dates, horaires, ville,
// places restantes et prix, avec les filtres formation, ville et mois. Page publique de l'outil (/calendrier) et bloc
// à intégrer dans le site de l'organisme (/integration/calendrier, sans en-tête). Aucune donnée personnelle.

const jour = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`)
const fmtJour = (d) => jour(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
const fmtMois = (cle) => new Date(`${cle}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
export const heure = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`
}
const euros = (n) => `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} € HT`

// Sessions filtrées (formation, ville, mois « AAAA-MM »)
export function filtrerSessions(sessions, { formation = '', ville = '', mois = '' } = {}) {
  return (sessions || []).filter((s) => (!formation || s.course_id === formation)
    && (!ville || (s.city || '').toLowerCase() === ville.toLowerCase())
    && (!mois || String(s.start_date).slice(0, 7) === mois))
}

export function placesTexte(places) {
  if (places == null) return 'Places disponibles'
  if (places <= 0) return 'Complet'
  return `${places} place${places > 1 ? 's' : ''} restante${places > 1 ? 's' : ''}`
}

function Contenu({ integre }) {
  const [data, setData] = useState(null)
  const [f, setF] = useState({ formation: '', ville: '', mois: '' })
  const [aInscrire, setAInscrire] = useState(null)

  useEffect(() => {
    supabase.rpc('public_calendrier').then(({ data: d, error }) => setData(error ? { publie: false } : d || { publie: false }))
  }, [])

  const sessions = useMemo(() => data?.sessions || [], [data])
  const formations = useMemo(() => [...new Map(sessions.map((s) => [s.course_id, s.title])).entries()].filter(([id]) => id).sort((a, b) => (a[1] || '').localeCompare(b[1] || '', 'fr')), [sessions])
  const villes = useMemo(() => [...new Set(sessions.map((s) => s.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [sessions])
  const moisListe = useMemo(() => [...new Set(sessions.map((s) => String(s.start_date).slice(0, 7)))].sort(), [sessions])
  const liste = filtrerSessions(sessions, f)

  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" aria-label="Chargement" /></div>
  if (!data.publie) return <p className="py-12 text-center text-gray-500">Le calendrier des formations n'est pas disponible pour le moment.</p>

  const o = data.organisme || {}
  return (
    <div className="space-y-4">
      {!integre && <h1 className="font-display text-xl font-semibold text-gray-900">Formations inter-entreprises</h1>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="search" aria-label="Filtrer les sessions">
        <select className="select" aria-label="Formation" value={f.formation} onChange={(e) => setF({ ...f, formation: e.target.value })}>
          <option value="">Toutes les formations</option>
          {formations.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select className="select" aria-label="Ville" value={f.ville} onChange={(e) => setF({ ...f, ville: e.target.value })}>
          <option value="">Toutes les villes</option>
          {villes.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="select" aria-label="Mois" value={f.mois} onChange={(e) => setF({ ...f, mois: e.target.value })}>
          <option value="">Toutes les dates</option>
          {moisListe.map((m) => <option key={m} value={m}>{fmtMois(m)}</option>)}
        </select>
      </div>

      {liste.length === 0 ? (
        <p className="py-8 text-center text-gray-500">{sessions.length === 0 ? 'Aucune session programmée pour le moment.' : 'Aucune session ne correspond à ces critères.'}</p>
      ) : (
        <ul className="space-y-3">
          {liste.map((s) => {
            const complet = s.places != null && s.places <= 0
            return (
              <li key={s.id} className="bg-white rounded-ui-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-display font-semibold text-gray-900">{s.title || 'Formation'}</h2>
                  <span className={`text-ui-sm font-medium px-2 py-0.5 rounded-full ${complet ? 'bg-gray-100 text-gray-500' : 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]'}`}>{placesTexte(s.places)}</span>
                </div>
                <div className="mt-2 grid gap-1 text-ui text-gray-700">
                  <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400" aria-hidden="true" />
                    {s.start_date === s.end_date ? fmtJour(s.start_date) : `Du ${fmtJour(s.start_date)} au ${fmtJour(s.end_date)}`}</span>
                  {(s.start_time || s.end_time) && <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-gray-400" aria-hidden="true" />{heure(s.start_time)} à {heure(s.end_time)}{s.duration_hours ? ` · ${String(s.duration_hours).replace('.', ',')} h de formation` : ''}</span>}
                  <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-gray-400" aria-hidden="true" />{s.is_remote ? 'À distance' : [s.postal_code, s.city].filter(Boolean).join(' ') || 'Lieu communiqué à l\'inscription'}</span>
                  <span className="flex items-center gap-1.5"><Users className="w-4 h-4 text-gray-400" aria-hidden="true" />{s.price_per_person != null ? `${euros(s.price_per_person)} par personne` : 'Prix sur demande'}</span>
                </div>
                {!complet && (
                  <div className="mt-3">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setAInscrire(s)}>S'inscrire</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {aInscrire && <InscriptionEnLigne session={aInscrire} mention={data.mention_maintien} onFermer={() => setAInscrire(null)} />}
      {data.mention_maintien && <p className="text-ui-sm text-gray-500">{data.mention_maintien}</p>}
      {(o.phone || o.email) && (
        <p className="text-ui-sm text-gray-600">Renseignements : {[o.phone && <a key="t" href={`tel:${o.phone}`} className="text-accent-700 underline">{o.phone}</a>, o.email && <a key="m" href={`mailto:${o.email}`} className="text-accent-700 underline">{o.email}</a>].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}</p>
      )}
    </div>
  )
}

export default function CalendrierPublic({ integre = false }) {
  if (integre) return <div className="p-3" style={{ background: 'rgb(var(--ground))' }}><Contenu integre /></div>
  return <PublicLayout title="Calendrier des formations"><Contenu /></PublicLayout>
}
