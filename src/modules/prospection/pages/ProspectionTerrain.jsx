// ═══════════════════════════════════════════════════════════════
// ProspectionTerrain.jsx — Prospection terrain géolocalisée
// Saisie d'une ville + rayon → liste de prospects à fort potentiel
// Actions : appel loggué, rappel, RDV, email — comme MarinePhoning
// ═══════════════════════════════════════════════════════════════

import { teamFirstNames, teamFirstNameByEmail } from '../../../core/org/currentOrg'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import {
  Search, MapPin, Navigation, Phone, Mail, Clock,
  ChevronRight, X, Check, Loader2, AlertTriangle,
  Building2, RefreshCw, ExternalLink, Flame
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'

// ─── Constantes ──────────────────────────────────────────────
const CALL_RESULTS = [
  { id: 'chaud',        label: '🔥 Intéressé',      sublabel: 'Veut un RDV',  color: 'bg-green-100 border-green-400 text-green-700' },
  { id: 'tiede',        label: '🟡 Tiède',           sublabel: 'À rappeler',   color: 'bg-amber-100 border-amber-400 text-amber-700' },
  { id: 'froid',        label: '❄️ Pas intéressé',  sublabel: 'Archiver',     color: 'bg-blue-100 border-blue-400 text-blue-700' },
  { id: 'no_answer',    label: '📞 Pas de réponse',  sublabel: 'Répondeur',    color: 'bg-gray-100 border-gray-300 text-gray-600' },
  { id: 'blocked',      label: '⚠️ Barrage',         sublabel: 'Secrétariat',  color: 'bg-red-100 border-red-300 text-red-600' },
  { id: 'wrong_number', label: '❌ Faux numéro',     sublabel: 'Supprimer',    color: 'bg-purple-100 border-purple-300 text-purple-600' },
]


function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getCallerFromEmail(email) {
  return teamFirstNameByEmail(email)
}

// ═══════════════════════════════════════════════════════════════
export default function ProspectionTerrain() {
  const { user } = useAuthStore()
  const [searchParams] = useSearchParams()

  // Config recherche
  const [city, setCity] = useState(searchParams.get('city') || '')
  const [cityLat, setCityLat] = useState(parseFloat(searchParams.get('lat')) || null)
  const [cityLng, setCityLng] = useState(parseFloat(searchParams.get('lng')) || null)
  const [radius, setRadius] = useState(parseInt(searchParams.get('radius')) || 30)
  const [statusFilter, setStatusFilter] = useState('all') // all | new | callback
  const [callerName, setCallerName] = useState(getCallerFromEmail(user?.email))

  // Autocomplete ville
  const [citySuggestions, setCitySuggestions] = useState([])
  const [cityLoading, setCityLoading] = useState(false)
  const citySearchRef = useRef(null)

  // Résultats
  const [prospects, setProspects] = useState([])
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  // Panel prospect sélectionné
  const [selectedProspect, setSelectedProspect] = useState(null)
  const [callResult, setCallResult] = useState('')
  const [callNotes, setCallNotes] = useState('')
  const [needsCallback, setNeedsCallback] = useState(false)
  const [callbackDate, setCallbackDate] = useState('')
  const [callbackTime, setCallbackTime] = useState('10:00')
  const [saving, setSaving] = useState(false)
  const [contactName, setContactName] = useState('')

  // ─── Autocomplete ville ─────────────────────────────────────
  const searchCity = useCallback(async (query) => {
    if (!query || query.length < 2) { setCitySuggestions([]); return }
    setCityLoading(true)
    try {
      const { data } = await supabase
        .from('prospection_massive')
        .select('city, departement, latitude, longitude')
        .ilike('city', `${query.toUpperCase()}%`)
        .not('latitude', 'is', null)
        .limit(200)
      if (data) {
        const seen = new Map()
        data.forEach(p => {
          if (!seen.has(p.city)) {
            seen.set(p.city, { city: p.city, departement: p.departement, lat: p.latitude, lng: p.longitude, count: 1 })
          } else {
            seen.get(p.city).count++
          }
        })
        setCitySuggestions([...seen.values()].sort((a, b) => b.count - a.count).slice(0, 8))
      }
    } catch (err) { console.error('City search error:', err) }
    finally { setCityLoading(false) }
  }, [])

  useEffect(() => {
    if (citySearchRef.current) clearTimeout(citySearchRef.current)
    if (city && !cityLat) {
      citySearchRef.current = setTimeout(() => searchCity(city), 300)
    } else {
      setCitySuggestions([])
    }
    return () => { if (citySearchRef.current) clearTimeout(citySearchRef.current) }
  }, [city, cityLat, searchCity])

  // ─── Déclencher auto si params URL ─────────────────────────
  useEffect(() => {
    if (searchParams.get('city') && searchParams.get('lat') && searchParams.get('lng')) {
      handleGenerate(
        searchParams.get('city'),
        parseFloat(searchParams.get('lat')),
        parseFloat(searchParams.get('lng')),
        parseInt(searchParams.get('radius')) || 30
      )
    }
  }, [])

  // ─── Générer la liste ───────────────────────────────────────
  const handleGenerate = async (overrideCity, overrideLat, overrideLng, overrideRadius) => {
    const useLat = overrideLat ?? cityLat
    const useLng = overrideLng ?? cityLng
    const useRadius = overrideRadius ?? radius
    const useCity = overrideCity ?? city

    if (!useLat || !useLng) { toast.error('Sélectionnez une ville depuis la liste'); return }

    setLoading(true)
    setGenerated(false)
    setSelectedProspect(null)

    try {
      // Requête sur prospection_massive avec filtre géo approximatif (boîte englobante)
      const latDelta = useRadius / 111
      const lngDelta = useRadius / (111 * Math.cos(useLat * Math.PI / 180))

      const { data } = await supabase
        .from('prospection_massive')
        .select('id, name, city, departement, phone, email, naf, effectif, latitude, longitude, prospection_status, contacted, contacted_at, quality_score, suggested_formations, do_not_call, dirigeant_nom, dirigeant_prenom, enrichment_notes')
        .gte('latitude', useLat - latDelta)
        .lte('latitude', useLat + latDelta)
        .gte('longitude', useLng - lngDelta)
        .lte('longitude', useLng + lngDelta)
        .eq('do_not_call', false)
        .not('phone', 'is', null)
        .limit(500)

      if (!data) { setLoading(false); return }

      // Filtrage précis par distance + calcul
      let results = data
        .map(p => ({
          ...p,
          distance: distanceKm(useLat, useLng, p.latitude, p.longitude),
          dirigeant: [p.dirigeant_prenom, p.dirigeant_nom].filter(Boolean).join(' ') || null,
        }))
        .filter(p => p.distance <= useRadius)

      // Filtre statut
      if (statusFilter === 'new') {
        results = results.filter(p => !p.contacted && (!p.prospection_status || p.prospection_status === 'a_appeler'))
      } else if (statusFilter === 'callback') {
        results = results.filter(p => p.prospection_status === 'a_rappeler')
      }

      // Tri : à rappeler d'abord, puis non contactés par quality_score
      results.sort((a, b) => {
        const scoreA = (a.prospection_status === 'a_rappeler' ? 1000 : 0) + (a.quality_score || 0)
        const scoreB = (b.prospection_status === 'a_rappeler' ? 1000 : 0) + (b.quality_score || 0)
        if (scoreB !== scoreA) return scoreB - scoreA
        return a.distance - b.distance
      })

      setProspects(results.slice(0, 100)) // Max 100
      setGenerated(true)

      if (results.length === 0) toast('Aucun prospect trouvé dans cette zone', { icon: '📍' })
      else toast.success(`${results.length} prospect${results.length > 1 ? 's' : ''} trouvé${results.length > 1 ? 's' : ''} dans ${useRadius}km de ${useCity}`)

    } catch (err) {
      console.error('Terrain generate error:', err)
      toast.error('Erreur: ' + err.message)
    } finally { setLoading(false) }
  }

  // ─── Sélectionner un prospect ───────────────────────────────
  const openProspect = (p) => {
    setSelectedProspect(p)
    setCallResult('')
    setCallNotes('')
    setNeedsCallback(false)
    setCallbackDate('')
    setCallbackTime('10:00')
    setContactName(p.dirigeant || '')
  }

  // ─── Logger un appel ───────────────────────────────────────
  const handleSaveCall = async () => {
    if (!callResult) { toast.error('Sélectionnez un résultat'); return }
    if (!selectedProspect) return
    setSaving(true)

    try {
      // Trouver ou créer le client
      let clientId = null
      if (selectedProspect.siren) {
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('siren', selectedProspect.siren)
          .limit(1)
        if (existing?.length) clientId = existing[0].id
      }
      if (!clientId) {
        const { data: nc } = await supabase
          .from('clients')
          .insert({
            name: selectedProspect.name,
            city: selectedProspect.city,
            phone: selectedProspect.phone,
            email: selectedProspect.email,
            siret: selectedProspect.id,
            siren: selectedProspect.siren,
            type: 'prospect',
            status: 'actif',
            proprietaire: callerName,
          })
          .select('id')
          .single()
        if (nc) clientId = nc.id
      }

      // Enregistrer l'appel
      const cbDate = needsCallback && callbackDate ? callbackDate : null
      await supabase.from('prospect_calls').insert({
        client_id: clientId,
        called_by: callerName,
        called_at: new Date().toISOString(),
        call_result: callResult,
        contact_name: contactName || null,
        notes: callNotes.trim() || null,
        needs_callback: !!cbDate,
        callback_date: cbDate,
        callback_time: needsCallback && callbackTime ? callbackTime : null,
        call_number: 1,
      })

      // Mettre à jour le statut dans prospection_massive
      const newStatus = callResult === 'chaud' ? 'rdv_pris'
        : callResult === 'tiede' ? 'a_rappeler'
        : callResult === 'froid' ? 'pas_interesse'
        : callResult === 'no_answer' ? 'a_rappeler'
        : callResult === 'wrong_number' ? 'numero_errone'
        : 'a_appeler'

      await supabase.from('prospection_massive').update({
        prospection_status: newStatus,
        contacted: true,
        contacted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', selectedProspect.id)

      // Mettre à jour localement
      setProspects(prev => prev.map(p =>
        p.id === selectedProspect.id ? { ...p, prospection_status: newStatus, contacted: true } : p
      ))

      toast.success(`Appel enregistré — ${CALL_RESULTS.find(r => r.id === callResult)?.label}`)
      setSelectedProspect(null)

    } catch (err) {
      toast.error('Erreur: ' + err.message)
    } finally { setSaving(false) }
  }

  // ─── Helpers ───────────────────────────────────────────────
  const getNafLabel = (naf) => {
    if (!naf) return null
    const code = naf.replace(/\./g, '').substring(0, 2)
    const labels = {
      '41': 'Construction', '42': 'Génie civil', '43': 'Travaux spécialisés',
      '45': 'Auto', '46': 'Commerce gros', '47': 'Commerce détail',
      '49': 'Transport', '55': 'Hébergement', '56': 'Restauration',
      '62': 'Informatique', '68': 'Immobilier', '69': 'Juridique/Compta',
      '70': 'Conseil', '71': 'Architecture', '78': 'Intérim',
      '80': 'Sécurité', '81': 'Services bâtiments', '85': 'Enseignement',
      '86': 'Santé', '87': 'Médico-social', '88': 'Action sociale',
    }
    return labels[code] || naf
  }

  const getStatusBadge = (p) => {
    if (p.prospection_status === 'a_rappeler') return { label: 'À rappeler', color: 'bg-amber-100 text-amber-700' }
    if (p.prospection_status === 'rdv_pris') return { label: 'RDV pris', color: 'bg-green-100 text-green-700' }
    if (p.prospection_status === 'pas_interesse') return { label: 'Pas intéressé', color: 'bg-gray-100 text-gray-500' }
    if (!p.contacted) return { label: 'Jamais contacté', color: 'bg-blue-50 text-blue-600' }
    return { label: 'Contacté', color: 'bg-gray-100 text-gray-500' }
  }

  const nextWorkday = (daysAhead = 1) => {
    const d = new Date()
    d.setDate(d.getDate() + daysAhead)
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
    return format(d, 'yyyy-MM-dd')
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="flex gap-4 h-[calc(100vh-12rem)]">

      {/* ── Colonne gauche : config + liste ── */}
      <div className={`flex flex-col ${selectedProspect ? 'w-1/2' : 'w-full'} transition-all duration-200`}>

        {/* Header config */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Champ ville */}
            <div className="relative flex-1 min-w-[180px]">
              <Navigation className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={city}
                onChange={e => { setCity(e.target.value); setCityLat(null); setCityLng(null) }}
                placeholder="Ville de départ..."
                className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 outline-none"
              />
              {cityLoading && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-orange-400" />}
              {cityLat && <Check className="absolute right-3 top-2.5 w-4 h-4 text-green-500" />}
              {citySuggestions.length > 0 && !cityLat && (
                <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {citySuggestions.map(s => (
                    <button key={s.city} onClick={() => { setCity(s.city); setCityLat(s.lat); setCityLng(s.lng); setCitySuggestions([]) }}
                      className="w-full text-left px-3 py-2 hover:bg-orange-50 border-b border-gray-50 last:border-0 transition-colors">
                      <span className="text-sm font-medium">{s.city}</span>
                      <span className="text-[10px] text-gray-400 ml-2">({s.departement}) · {s.count} prospects</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Rayon */}
            <div className="flex gap-1.5">
              {[15, 30, 60, 100].map(r => (
                <button key={r} onClick={() => setRadius(r)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${radius === r ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
                  {r}km
                </button>
              ))}
            </div>

            {/* Filtre statut */}
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-orange-300">
              <option value="all">Tous</option>
              <option value="new">Jamais contactés</option>
              <option value="callback">À rappeler</option>
            </select>

            {/* Caller */}
            <select value={callerName} onChange={e => setCallerName(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-orange-300">
              {teamFirstNames().map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Bouton générer */}
            <button onClick={() => handleGenerate()} disabled={loading || !cityLat}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
              {loading ? 'Génération...' : 'Générer'}
            </button>
          </div>

          {/* Stats rapides */}
          {generated && (
            <div className="flex gap-3 text-[11px] text-gray-500 border-t pt-2">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-orange-400" /> {city} · {radius}km</span>
              <span className="font-semibold text-gray-700">{prospects.length} prospects</span>
              <span className="text-amber-600">{prospects.filter(p => p.prospection_status === 'a_rappeler').length} à rappeler</span>
              <span className="text-blue-600">{prospects.filter(p => !p.contacted).length} jamais contactés</span>
            </div>
          )}
        </div>

        {/* Liste prospects */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {!generated && !loading && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Navigation className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm font-medium">Configurez une zone et cliquez sur Générer</p>
              <p className="text-xs mt-1">Prospects triés par pertinence — à rappeler en premier</p>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
              <span className="ml-2 text-sm text-gray-500">Recherche en cours...</span>
            </div>
          )}
          {generated && prospects.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Search className="w-10 h-10 mb-3 text-gray-300" />
              <p className="text-sm font-medium">Aucun prospect dans cette zone</p>
              <p className="text-xs mt-1">Essayez un rayon plus grand ou une autre ville</p>
            </div>
          )}
          {prospects.map(p => {
            const badge = getStatusBadge(p)
            const isSelected = selectedProspect?.id === p.id
            const isCallbackPriority = p.prospection_status === 'a_rappeler'
            return (
              <button key={p.id}
                onClick={() => openProspect(p)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                  isSelected ? 'border-orange-400 bg-orange-50 shadow-sm' :
                  isCallbackPriority ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300' :
                  'border-gray-200 bg-white hover:border-orange-200 hover:bg-orange-50/30'
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900 truncate">{p.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.label}</span>
                      {isCallbackPriority && <Flame className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-500 flex-wrap">
                      <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{p.city} · {p.distance?.toFixed(1)}km</span>
                      {p.naf && <span>{getNafLabel(p.naf)}</span>}
                      {p.effectif && <span>👥 {p.effectif}</span>}
                      {p.dirigeant && <span>👤 {p.dirigeant}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.phone && <span className="text-[11px] font-medium text-gray-700">{p.phone}</span>}
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Panneau droit : détail prospect + log appel ── */}
      {selectedProspect && (
        <div className="w-1/2 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-start justify-between p-4 border-b bg-gray-50">
            <div>
              <h3 className="font-bold text-gray-900 text-sm">{selectedProspect.name}</h3>
              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 flex-wrap">
                <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{selectedProspect.city} · {selectedProspect.distance?.toFixed(1)}km</span>
                {selectedProspect.naf && <span>{getNafLabel(selectedProspect.naf)}</span>}
                {selectedProspect.effectif && <span>👥 {selectedProspect.effectif}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedProspect.siret && !selectedProspect.siret.startsWith('MANUAL_') && (
                <Link to={`/clients/${selectedProspect.id}`} target="_blank"
                  className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors" title="Ouvrir la fiche">
                  <ExternalLink className="w-4 h-4 text-gray-500" />
                </Link>
              )}
              <button onClick={() => setSelectedProspect(null)} className="p-1.5 hover:bg-gray-200 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Infos contact */}
          <div className="p-4 space-y-3 overflow-y-auto flex-1">

            {/* Téléphone en grand */}
            {selectedProspect.phone && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-orange-500" />
                  <span className="font-bold text-lg text-gray-900 tracking-wide">{selectedProspect.phone}</span>
                </div>
                <a href={`tel:${selectedProspect.phone}`}
                  className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 transition-colors">
                  Appeler
                </a>
              </div>
            )}

            {/* Contact name */}
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Interlocuteur</label>
              <input type="text" value={contactName} onChange={e => setContactName(e.target.value)}
                placeholder="Nom du contact..."
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 outline-none" />
            </div>

            {/* Infos enrichies */}
            {(selectedProspect.dirigeant || selectedProspect.email || selectedProspect.enrichment_notes) && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-xs text-gray-600">
                {selectedProspect.dirigeant && <p>👤 Dirigeant : <strong>{selectedProspect.dirigeant}</strong></p>}
                {selectedProspect.email && <p>✉️ {selectedProspect.email}</p>}
                {selectedProspect.enrichment_notes && <p className="text-gray-400 italic">{selectedProspect.enrichment_notes}</p>}
              </div>
            )}

            {/* Résultat appel */}
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Résultat de l'appel</label>
              <div className="grid grid-cols-2 gap-2">
                {CALL_RESULTS.map(r => (
                  <button key={r.id} onClick={() => {
                    setCallResult(r.id)
                    if (r.id === 'tiede' || r.id === 'no_answer') {
                      setNeedsCallback(true)
                      setCallbackDate(nextWorkday(r.id === 'no_answer' ? 2 : 7))
                    } else {
                      setNeedsCallback(false)
                    }
                  }}
                    className={`p-2.5 rounded-lg border-2 text-left transition-colors ${callResult === r.id ? r.color + ' border-current' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                    <p className="text-xs font-semibold">{r.label}</p>
                    <p className="text-[10px] opacity-70">{r.sublabel}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Notes</label>
              <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)}
                placeholder="Notes sur l'échange..." rows={3}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 outline-none resize-none" />
            </div>

            {/* Rappel */}
            {needsCallback && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-amber-700">📅 Programmer un rappel</p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-300 outline-none" />
                  <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-300 outline-none" />
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { l: 'Demain', d: 1 },
                    { l: 'Mardi', d: null, getDate: () => { const d = new Date(); const day = d.getDay(); const diff = day < 2 ? 2 - day : 9 - day; d.setDate(d.getDate() + diff); return format(d, 'yyyy-MM-dd') }},
                    { l: 'Jeudi', d: null, getDate: () => { const d = new Date(); const day = d.getDay(); const diff = day < 4 ? 4 - day : 11 - day; d.setDate(d.getDate() + diff); return format(d, 'yyyy-MM-dd') }},
                    { l: '+1 sem', d: 7 },
                  ].map(q => (
                    <button key={q.l} onClick={() => setCallbackDate(q.getDate ? q.getDate() : nextWorkday(q.d))}
                      className="px-2 py-1 text-[10px] bg-white border border-amber-200 hover:bg-amber-50 rounded-full">{q.l}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Toggle rappel si non auto */}
            {!needsCallback && callResult && (
              <button onClick={() => { setNeedsCallback(true); setCallbackDate(nextWorkday(3)) }}
                className="text-xs text-gray-400 hover:text-amber-600 flex items-center gap-1 transition-colors">
                <Clock className="w-3 h-3" /> + Ajouter un rappel
              </button>
            )}
          </div>

          {/* Footer actions */}
          <div className="p-4 border-t bg-gray-50 flex gap-2">
            <button onClick={() => setSelectedProspect(null)}
              className="flex-1 py-2.5 text-sm border rounded-lg hover:bg-gray-100 font-medium text-gray-600">
              Annuler
            </button>
            <button onClick={handleSaveCall} disabled={saving || !callResult}
              className="flex-1 py-2.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
