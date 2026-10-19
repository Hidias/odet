import { useEffect, useState } from 'react'
import { supabase } from '../../../core/supabase'

// Session intra : lieu choisi parmi les sites du client (lot 2, 0041). Le choix remplit le nom et l'adresse du lieu
// de la session (repris par les documents) et sessions.site_id. « Adresse de la fiche » par défaut.
export default function ChoixSiteSession({ clientId, siteId, onChoisir }) {
  const [sites, setSites] = useState([])

  useEffect(() => {
    if (!clientId) { setSites([]); return }
    supabase.from('sites').select('id, name, address, postal_code, city, is_default, is_active')
      .eq('client_id', clientId).neq('is_active', false)
      .order('is_default', { ascending: false }).order('name')
      .then(({ data }) => setSites(data || []))
  }, [clientId])

  if (sites.length < 2) return null

  const choisir = (id) => {
    const s = sites.find((x) => x.id === id) || null
    onChoisir?.(s)
  }

  return (
    <div>
      <label className="label" htmlFor="session-site">Site du client</label>
      <select id="session-site" className="input" value={siteId || ''} onChange={(e) => choisir(e.target.value)}>
        <option value="">Adresse de la fiche client</option>
        {sites.filter((s) => !s.is_default).map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}</option>
        ))}
      </select>
      <p className="text-ui-sm text-gray-400 mt-1">Le lieu des documents suit le site choisi.</p>
    </div>
  )
}
