import { useState } from 'react'
import toast from 'react-hot-toast'
import { RefreshCw, ExternalLink, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { lireEntreprise, ecartsFiche, photographie, pappers, annuaireOfficiel, libelleEtat } from '../lib/registry'

// « Actualiser depuis le répertoire » (lot 2, 0041) : lit l'entreprise dans le répertoire officiel, montre les écarts
// avec la fiche, ligne par ligne ; rien n'est écrit sans « Accepter ». La lecture elle-même (photographie, date,
// établissements ouverts) est gardée sur la fiche, sans toucher aux champs saisis.

export default function RepertoireClient({ client, peutModifier, onChange }) {
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [ent, setEnt] = useState(null)
  const [ecarts, setEcarts] = useState([])
  const [choix, setChoix] = useState({})
  const [adresseDuSiege, setAdresseDuSiege] = useState(true)
  const siren = String(client?.siren || client?.siret || '').replace(/\s/g, '').slice(0, 9)
  if (!client || client.client_type === 'particulier' || !/^\d{9}$/.test(siren)) return null

  const lire = async () => {
    setEnCours(true)
    try {
      const e = await lireEntreprise(siren)
      if (!e) { toast.error('Entreprise introuvable dans le répertoire'); return }
      // Adresse comparée au siège seulement si la fiche porte le SIRET du siège (sinon : adresse d'un établissement)
      const surSiege = !client.siret || client.siret === e.siege?.siret
      setAdresseDuSiege(surSiege)
      setEnt(e)
      setEcarts(ecartsFiche(client, e, { adresseDuSiege: surSiege }))
      setChoix({})
      setOuvert(true)
      // La lecture est notée sur la fiche (aucun champ saisi n'est modifié)
      if (peutModifier) {
        await supabase.from('clients').update({ registry_snapshot: photographie(e), registry_synced_at: new Date().toISOString() }).eq('id', client.id)
      }
    } catch (err) {
      toast.error(err.message || 'Répertoire injoignable')
    } finally {
      setEnCours(false)
    }
  }

  const enregistrer = async () => {
    const retenus = ecarts.filter((x) => choix[x.champ] === 'accepter')
    if (retenus.length === 0) { setOuvert(false); return }
    const maj = Object.assign({}, ...retenus.map((x) => x.valeur))
    setEnCours(true)
    const { error } = await supabase.from('clients').update(maj).eq('id', client.id)
    setEnCours(false)
    if (error) return toast.error(error.message)
    toast.success(`${retenus.length} information${retenus.length > 1 ? 's' : ''} reprise${retenus.length > 1 ? 's' : ''} du répertoire`)
    setOuvert(false)
    onChange?.()
  }

  const toutAccepter = () => setChoix(Object.fromEntries(ecarts.map((x) => [x.champ, 'accepter'])))

  return (
    <>
      <button type="button" onClick={lire} disabled={enCours} className="btn btn-ghost btn-sm mt-1 -ml-2">
        {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualiser depuis le répertoire
      </button>
      {client.registry_synced_at && (
        <span className="text-ui-sm text-gray-400 ml-1">lu le {new Date(client.registry_synced_at).toLocaleDateString('fr-FR')}</span>
      )}

      {ouvert && ent && (
        <Sheet title="Répertoire des entreprises" onClose={() => setOuvert(false)} size="lg"
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setOuvert(false)}>Fermer</button>
            {peutModifier && ecarts.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={enCours}>
                {enCours && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer les écarts acceptés
              </button>
            )}
          </>}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-sm text-gray-600">
            <span className="font-semibold text-gray-900">{ent.raison_sociale || ent.nom}</span>
            <span>SIREN {ent.siren}</span>
            <span className={`badge ${ent.etat === 'C' ? 'badge-danger' : 'badge-success'}`}>{libelleEtat(ent.etat)}</span>
            {ent.etablissements_ouverts != null && <span>{ent.etablissements_ouverts} établissement{ent.etablissements_ouverts > 1 ? 's' : ''} ouvert{ent.etablissements_ouverts > 1 ? 's' : ''}</span>}
            <a href={pappers(ent.siren)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-700 hover:underline">Pappers <ExternalLink className="w-3.5 h-3.5" /></a>
            <a href={annuaireOfficiel(ent.siren)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-700 hover:underline">Annuaire officiel <ExternalLink className="w-3.5 h-3.5" /></a>
          </div>
          {ent.etat === 'C' && <Banner tone="danger">L'entreprise est cessée au répertoire. Vérifiez avant de facturer.</Banner>}
          {!adresseDuSiege && (
            <Banner tone="info">La fiche porte l'adresse d'un établissement (SIRET {client.siret}) : l'adresse n'est pas comparée au siège. Les établissements se gèrent dans « Sites ».</Banner>
          )}
          {ecarts.length === 0 ? (
            <p className="text-ui text-gray-700">La fiche est à jour : aucun écart avec le répertoire.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-ui text-gray-700">{ecarts.length} écart{ecarts.length > 1 ? 's' : ''} : rien n'est repris sans votre accord.</p>
                {peutModifier && <button type="button" className="btn btn-ghost btn-sm" onClick={toutAccepter}>Tout accepter</button>}
              </div>
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-ui">
                {ecarts.map((x) => (
                  <li key={x.champ} className="p-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="text-ui-sm font-semibold text-gray-900">{x.libelle}</div>
                      <div className="text-ui-sm text-gray-500 break-words">Fiche : {x.actuel || <em>vide</em>}</div>
                      <div className="text-ui-sm text-gray-900 break-words">Répertoire : {x.propose}</div>
                    </div>
                    {peutModifier && (
                      <div className="flex gap-1.5" role="radiogroup" aria-label={x.libelle}>
                        {[['accepter', 'Accepter'], ['ignorer', 'Ignorer']].map(([v, l]) => (
                          <button key={v} type="button" role="radio" aria-checked={choix[x.champ] === v}
                            onClick={() => setChoix((c) => ({ ...c, [x.champ]: v }))}
                            className={`btn btn-sm ${choix[x.champ] === v ? (v === 'accepter' ? 'btn-primary' : 'btn-secondary') : 'btn-ghost'}`}>{l}</button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
