import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Upload, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet, Banner } from '../../../ui'
import { CHAMPS_IMPORT, lireCsv, correspondanceAuto, construireSocietes, marquerDoublons, ligneClient } from '../lib/importCsv'

// Import générique de clients depuis un fichier CSV (B3, 05/11) : 1. correspondance des colonnes, 2. aperçu avec
// doublons par SIRET, 3. rapport. Rien n'est créé avant « Importer ». Les clients arrivent « À compléter ».
const ETATS = {
  nouveau: { label: 'Nouveau', cls: 'badge badge-success' },
  doublon: { label: 'Doublon', cls: 'badge badge-warning' },
  nom_connu: { label: 'Nom connu', cls: 'badge badge-warning' },
}

export default function ImportCsvClients({ texte, nomFichier, clients, onClose, onImporte }) {
  const { entetes, lignes } = useMemo(() => lireCsv(texte), [texte])
  const [corr, setCorr] = useState(() => correspondanceAuto(entetes))
  const [etape, setEtape] = useState('colonnes')
  const [apercu, setApercu] = useState(null)
  const [rapport, setRapport] = useState(null)
  const [enCours, setEnCours] = useState(false)

  const preparer = () => {
    if (corr.name == null) return toast.error('Choisissez la colonne du nom de la société')
    const { societes, ecartees } = construireSocietes(lignes, corr)
    setApercu({ societes: marquerDoublons(societes, clients), ecartees })
    setEtape('apercu')
  }
  const basculer = (i) => setApercu((a) => ({ ...a, societes: a.societes.map((s, k) => (k === i && s.etat !== 'doublon' ? { ...s, selected: !s.selected } : s)) }))

  const importer = async () => {
    const choisies = apercu.societes.filter((s) => s.selected)
    if (!choisies.length) return
    setEnCours(true)
    const crees = []; const erreurs = []
    for (const s of choisies) {
      const { data: client, error } = await supabase.from('clients').insert(ligneClient(s)).select('id').single()
      if (error) { erreurs.push({ nom: s.name, motif: error.message }); continue }
      if (s.contacts.length) {
        const { error: errC } = await supabase.from('client_contacts').insert(s.contacts.map((c) => ({
          client_id: client.id, name: c.name, first_name: c.first_name || null, last_name: c.last_name || null,
          email: c.email || null, phone: c.phone || null, role: c.role || null, is_primary: c.is_primary,
        })))
        if (errC) erreurs.push({ nom: s.name, motif: `client créé, contacts non créés : ${errC.message}` })
        await supabase.rpc('client_contact_sync_primary', { p_client_id: client.id }).then(() => {}, () => {})
      }
      crees.push(s.name)
    }
    setEnCours(false)
    setRapport({
      crees, erreurs,
      ignorees: apercu.societes.filter((s) => !s.selected).map((s) => ({ nom: s.name, motif: s.motif || 'Non cochée' })),
      ecartees: apercu.ecartees,
    })
    setEtape('rapport')
    if (crees.length) onImporte?.()
  }

  const nbChoisies = apercu?.societes.filter((s) => s.selected).length || 0
  const pied = etape === 'colonnes' ? (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className="btn btn-primary" onClick={preparer} disabled={!lignes.length}>Voir l&apos;aperçu</button>
    </div>
  ) : etape === 'apercu' ? (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn btn-secondary" onClick={() => setEtape('colonnes')} disabled={enCours}>Revoir les colonnes</button>
      <button type="button" className="btn btn-primary" onClick={importer} disabled={enCours || !nbChoisies}>
        {enCours ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" />}
        Importer {nbChoisies} société{nbChoisies > 1 ? 's' : ''}
      </button>
    </div>
  ) : (
    <div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={onClose}>Fermer</button></div>
  )

  return (
    <Sheet title={`Importer des clients : ${nomFichier || 'fichier CSV'}`} size="lg" onClose={() => !enCours && onClose()} footer={pied}>
      {etape === 'colonnes' && (
        <div className="space-y-3">
          {!lignes.length && <Banner tone="warning" title="Fichier vide">Aucune ligne de données sous l&apos;en-tête.</Banner>}
          <p className="text-ui text-gray-600">{lignes.length} ligne{lignes.length > 1 ? 's' : ''} lue{lignes.length > 1 ? 's' : ''}. Indiquez quelle colonne du fichier remplit chaque champ. Les champs laissés vides ne sont pas importés.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {CHAMPS_IMPORT.map((ch) => (
              <label key={ch.cle} className="block">
                <span className="text-ui-sm text-gray-600">{ch.label}{ch.requis ? ' (obligatoire)' : ''}</span>
                <select className="select w-full" value={corr[ch.cle] ?? ''} onChange={(e) => setCorr({ ...corr, [ch.cle]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">Ne pas importer</option>
                  {entetes.map((h, j) => <option key={j} value={j}>{h || `Colonne ${j + 1}`}{lignes[0]?.[j] ? ` (ex. ${lignes[0][j].slice(0, 30)})` : ''}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {etape === 'apercu' && apercu && (
        <div className="space-y-3">
          <p className="text-ui text-gray-600">
            {apercu.societes.filter((s) => s.etat === 'nouveau').length} nouvelle(s), {apercu.societes.filter((s) => s.etat === 'doublon').length} doublon(s) par SIRET, {apercu.societes.filter((s) => s.etat === 'nom_connu').length} nom(s) déjà connu(s), {apercu.ecartees.length} ligne(s) écartée(s).
          </p>
          {apercu.ecartees.length > 0 && (
            <Banner tone="warning" title="Lignes écartées">
              <ul className="list-disc pl-5">{apercu.ecartees.map((e) => <li key={e.ligne}>Ligne {e.ligne}{e.nom ? ` (${e.nom})` : ''} : {e.motif}</li>)}</ul>
            </Banner>
          )}
          <div className="overflow-x-auto"><table className="w-full text-ui">
            <thead className="bg-gray-50"><tr>
              <th className="w-10 py-2 px-2" aria-label="Importer" />
              <th className="text-left py-2 px-3 font-medium">Société</th>
              <th className="text-left py-2 px-3 font-medium">SIRET</th>
              <th className="text-left py-2 px-3 font-medium">Contacts</th>
              <th className="text-left py-2 px-3 font-medium">État</th>
            </tr></thead>
            <tbody className="divide-y">
              {apercu.societes.map((s, i) => (
                <tr key={s.cle}>
                  <td className="py-2 px-2 text-center"><input type="checkbox" checked={s.selected} disabled={s.etat === 'doublon' || enCours} onChange={() => basculer(i)} aria-label={`Importer ${s.name}`} /></td>
                  <td className="py-2 px-3"><div className="font-medium">{s.name}</div>{(s.postal_code || s.city) && <div className="text-ui-sm text-gray-500">{s.postal_code} {s.city}</div>}</td>
                  <td className="py-2 px-3 font-mono text-ui-sm">{s.siret || '-'}</td>
                  <td className="py-2 px-3 text-ui-sm">{s.contacts.length ? s.contacts.map((c) => c.name).join(', ') : '-'}</td>
                  <td className="py-2 px-3"><span className={ETATS[s.etat].cls}>{ETATS[s.etat].label}</span>{s.motif && <div className="text-ui-sm text-gray-500">{s.motif}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {etape === 'rapport' && rapport && (
        <div className="space-y-3">
          <Banner tone={rapport.erreurs.length ? 'warning' : 'success'} title="Rapport d'import">
            {rapport.crees.length} société(s) créée(s) avec le statut « À compléter », {rapport.ignorees.length} non importée(s), {rapport.ecartees.length} ligne(s) écartée(s), {rapport.erreurs.length} erreur(s).
          </Banner>
          {rapport.erreurs.length > 0 && <div><p className="font-medium">Erreurs</p><ul className="list-disc pl-5 text-ui">{rapport.erreurs.map((e, k) => <li key={k}>{e.nom} : {e.motif}</li>)}</ul></div>}
          {rapport.ignorees.length > 0 && <div><p className="font-medium">Non importées</p><ul className="list-disc pl-5 text-ui">{rapport.ignorees.map((e, k) => <li key={k}>{e.nom} : {e.motif}</li>)}</ul></div>}
          {rapport.ecartees.length > 0 && <div><p className="font-medium">Lignes écartées</p><ul className="list-disc pl-5 text-ui">{rapport.ecartees.map((e) => <li key={e.ligne}>Ligne {e.ligne}{e.nom ? ` (${e.nom})` : ''} : {e.motif}</li>)}</ul></div>}
        </div>
      )}
    </Sheet>
  )
}
