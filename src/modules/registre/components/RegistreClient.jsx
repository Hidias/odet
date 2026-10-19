import { useState } from 'react'
import { ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import RegistreVue from './RegistreVue'

// Registre de sécurité du client (fonction 11, 0140) sur sa fiche : même vue que l'espace entreprise, ouverte à la
// demande, avec ce qui manque au dossier de contrôle.

export default function RegistreClient({ client }) {
  const [ouvert, setOuvert] = useState(false)
  if (!client || client.client_type === 'particulier') return null
  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <button type="button" className="w-full flex items-center gap-2 px-5 py-3.5 text-left" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert}>
        <ShieldCheck className="w-5 h-5 text-primary-600" />
        <h2 className="font-semibold text-gray-900 flex-1">Registre de sécurité</h2>
        {ouvert ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {ouvert && (
        <div className="px-5 pb-4">
          <RegistreVue mode="organisme" clientId={client.id} companyId={client.company_id}
            charger={async (site) => { const { data, error } = await supabase.rpc('registre_client', { p_client: client.id, p_site: site }); if (error) throw error; return data }}
            orgPourPdf={() => loadPdfOrg()} />
        </div>
      )}
    </div>
  )
}
