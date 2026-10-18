import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Euro, User, Search, RotateCcw, Copy } from 'lucide-react'
import { supabase } from '../../supabase'
import { useAuthStore } from '../../store'
import { DataTable, Sheet, Banner, useConfirm } from '../../../ui'
import { chargerCatalogue, chargerProfils, parDomaine } from './donnees'

// Paramètres › Profils de droits (droit parametres.profils.gerer, donc licence totale ou super administrateur).
// Les modèles sont fournis par la plateforme. « Personnaliser pour la société » crée une copie exacte du modèle
// (fonction de la base, en une fois) ; seule la copie se modifie, case par case. « Revenir au modèle » la supprime.

const PROFILS_TERRAIN = ['technicien', 'salarie', 'ecran']

function FicheProfil({ profil, catalogue, onClose, onChange }) {
  const confirm = useConfirm()
  const [filtre, setFiltre] = useState('')
  const [occupe, setOccupe] = useState(false)
  const actif = profil.actif
  const modifiable = !!profil.propre
  const domaines = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    return parDomaine(catalogue)
      .map((g) => ({ ...g, droits: g.droits.filter((d) => !f || d.label.toLowerCase().includes(f) || d.code.includes(f)) }))
      .filter((g) => g.droits.length > 0)
  }, [catalogue, filtre])

  const executer = async (fn, message) => {
    setOccupe(true)
    try {
      const r = await fn()
      if (r?.error) throw r.error
      toast.success(message)
      await onChange()
    } catch (e) {
      toast.error(e.message || 'Enregistrement refusé')
    } finally {
      setOccupe(false)
    }
  }

  const personnaliser = () => executer(() => supabase.rpc('permission_profile_customize', { p_key: profil.key }), 'Profil copié pour la société')
  const revenir = async () => {
    if (!await confirm({ title: 'Revenir au modèle ?', message: `Les changements faits sur « ${actif.label} » pour la société seront perdus. Les personnes qui ont ce profil reprendront les droits du modèle.`, confirmLabel: 'Revenir au modèle', danger: true })) return
    executer(() => supabase.rpc('permission_profile_reset', { p_key: profil.key }), 'Profil remis au modèle')
  }
  const basculer = async (d, coche) => {
    if (coche && d.shows_prices && PROFILS_TERRAIN.includes(profil.key)) {
      if (!await confirm({ title: 'Montrer des prix à un profil de terrain ?', message: `« ${d.label} » montre des prix ou des montants. Les personnes au profil « ${actif.label} » les verront.`, confirmLabel: 'Ajouter quand même' })) return
    }
    executer(() => (coche
      ? supabase.from('permission_profile_rights').insert({ profile_id: actif.id, right_code: d.code })
      : supabase.from('permission_profile_rights').delete().eq('profile_id', actif.id).eq('right_code', d.code)),
    coche ? 'Droit ajouté au profil' : 'Droit retiré du profil')
  }

  const ecart = (code) => {
    if (!profil.propre || !profil.modele) return null
    const dansModele = profil.modele.droits.has(code)
    const dansCopie = profil.propre.droits.has(code)
    if (dansModele === dansCopie) return null
    return dansCopie ? 'ajouté' : 'retiré'
  }

  return (
    <Sheet title={actif.label} size="lg" onClose={onClose}
      footer={<>
        {modifiable && profil.modele && <button type="button" className="btn btn-secondary" disabled={occupe} onClick={revenir}><RotateCcw className="w-4 h-4" />Revenir au modèle</button>}
        <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
      </>}>
      <p className="text-gray-700">{actif.description}</p>
      {!modifiable && (
        <Banner tone="info" title="Modèle de la plateforme"
          action={<button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={personnaliser}><Copy className="w-4 h-4" />Personnaliser</button>}>
          Pour changer ce profil dans votre société, faites-en d'abord une copie : elle part exactement des mêmes droits.
        </Banner>
      )}
      <label className="relative max-w-xs">
        <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input className="input pl-8" placeholder="Chercher un droit" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Chercher un droit" />
      </label>
      {domaines.map((g) => (
        <details key={g.cle} className="border hairline rounded-ui" open={!!filtre}>
          <summary className="cursor-pointer px-3 py-2 font-medium flex items-center gap-2">
            <span className="flex-1">{g.libelle}</span>
            <span className="text-ui-sm text-gray-500">{g.droits.filter((d) => actif.droits.has(d.code)).length} / {g.droits.length}</span>
          </summary>
          <ul className="divide-y hairline">
            {g.droits.map((d) => {
              const e = ecart(d.code)
              return (
                <li key={d.code} className="px-3 py-2">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1" checked={actif.droits.has(d.code)} disabled={!modifiable || occupe}
                      onChange={(ev) => basculer(d, ev.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.label}</span>
                        {d.shows_prices && <span className="inline-flex text-gray-500" title="Montre des prix ou des montants"><Euro className="w-3 h-3" aria-hidden="true" /><span className="sr-only">prix</span></span>}
                        {d.own_scope && <span className="inline-flex text-gray-500" title="Limité au périmètre de la personne"><User className="w-3 h-3" aria-hidden="true" /><span className="sr-only">son périmètre</span></span>}
                        {e && <span className={`badge ${e === 'ajouté' ? 'badge-info' : 'badge-warning'}`}>{e} par rapport au modèle</span>}
                      </span>
                      <span className="block text-ui-sm text-gray-500">{d.description}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </details>
      ))}
    </Sheet>
  )
}

export default function ProfilsDroits() {
  const rights = useAuthStore((s) => s.rights)
  const companyId = rights?.companyId || null
  const [catalogue, setCatalogue] = useState([])
  const [profils, setProfils] = useState(null)
  const [ouvert, setOuvert] = useState(null)

  const charger = async () => {
    if (!companyId) return
    try {
      const [c, p] = await Promise.all([chargerCatalogue(), chargerProfils(companyId)])
      setCatalogue(c); setProfils(p)
      setOuvert((o) => (o ? p.find((x) => x.key === o.key) || null : null))
    } catch (e) {
      toast.error(e.message)
      setProfils([])
    }
  }
  useEffect(() => { charger() }, [companyId])

  if (!companyId) return <Banner tone="info" title="Droits indisponibles">Les droits par société ne sont pas encore actifs sur cette base.</Banner>

  const colonnes = [
    { key: 'label', label: 'Profil', mobile: 'title', render: (p) => <span className="font-medium">{p.actif.label}</span> },
    { key: 'description', label: 'Contenu', mobile: 'subtitle', render: (p) => <span className="text-gray-600">{p.actif.description}</span> },
    { key: 'n', label: 'Droits', align: 'right', render: (p) => p.actif.droits.size },
    { key: 'source', label: 'Source', mobile: 'aside', render: (p) => (p.propre ? <span className="badge badge-brand">Personnalisé</span> : <span className="badge badge-neutral">Modèle</span>) },
  ]

  return (
    <>
      <h2 className="section-title">Profils de droits</h2>
      <p className="text-ui-sm text-gray-500">Un profil est une liste de droits. Les modèles conviennent à la plupart des sociétés ; une copie personnalisée remplace le modèle dans votre société seulement.</p>
      <DataTable columns={colonnes} rows={profils || []} rowKey="key" loading={profils === null} onRowClick={setOuvert} caption="Profils de droits" />
      {ouvert && <FicheProfil profil={ouvert} catalogue={catalogue} onClose={() => setOuvert(null)} onChange={charger} />}
    </>
  )
}
