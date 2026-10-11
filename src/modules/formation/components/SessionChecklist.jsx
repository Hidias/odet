import { orgName } from '../../../core/org/currentOrg'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { Printer, FileCheck, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

// Liste complète des contrôles
const CHECKLIST_ITEMS = {
  avant: [
    { code: 'analyse_besoin', label: 'Analyse du besoin réalisée', sst: false },
    { code: 'convention_envoyee', label: 'Convention envoyée', sst: false },
    { code: 'convention_signee', label: 'Convention signée', sst: false },
    { code: 'convocations_envoyees', label: 'Convocations envoyées', sst: false },
    { code: 'test_positionnement_prepare', label: 'Test de positionnement préparé', sst: false },
    { code: 'forprev_created', label: 'Session FORPREV créée', sst: true },
  ],
  pendant: [
    { code: 'presences_validees', label: 'Présences validées', sst: false },
    { code: 'attentes_recueillies', label: 'Attentes stagiaires recueillies', sst: false },
    { code: 'test_positionnement_realise', label: 'Test de positionnement réalisé', sst: false },
    { code: 'fiches_stagiaires', label: 'Fiches stagiaires remplies', sst: false },
    { code: 'evaluations_chaud', label: 'Évaluations à chaud renseignées', sst: false },
  ],
  apres: [
    { code: 'forprev_renseigne', label: 'FORPREV renseigné', sst: true },
    { code: 'certificats_generes', label: 'Certificats de réalisation générés', sst: false },
    { code: 'certificats_envoyes', label: 'Certificats envoyés', sst: false },
    { code: 'facture_envoyee', label: 'Facture envoyée', sst: false },
    { code: 'evaluation_froid_programmee', label: 'Évaluation à froid programmée (1-3 mois)', sst: false },
    { code: 'archive_drive', label: 'Documents archivés (Drive)', sst: false },
    { code: 'archive_papier', label: 'Documents archivés (Papier)', sst: false },
    { code: 'cartes_sst_envoyees', label: 'Cartes SST envoyées', sst: true },
  ]
}

export default function SessionChecklist({ session }) {
  const [checklistData, setChecklistData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isSST, setIsSST] = useState(false)
  const [traineeCount, setTraineeCount] = useState(0)
  const [editingComments, setEditingComments] = useState({})
  const [editingDates, setEditingDates] = useState({})

  useEffect(() => {
    if (session) {
      loadChecklist()
      checkIfSST()
      loadTraineeCount()
    }
  }, [session])

  const checkIfSST = () => {
    const title = session.courses?.title?.toLowerCase() || ''
    setIsSST(title.includes('sst') || title.includes('secouriste'))
  }

  const loadTraineeCount = async () => {
    try {
      const { count, error } = await supabase
        .from('session_trainees')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session.id)

      if (error) throw error
      setTraineeCount(count || 0)
    } catch (error) {
      console.error('Erreur comptage stagiaires:', error)
      setTraineeCount(0)
    }
  }

  // Convertir date ISO (yyyy-mm-dd) vers format français (dd/mm/yyyy)
  const formatDateToFrench = (isoDate) => {
    if (!isoDate) return ''
    const [year, month, day] = isoDate.split('-')
    return `${day}/${month}/${year}`
  }

  // Convertir format français (dd/mm/yyyy) vers ISO (yyyy-mm-dd)
  const parseFrenchDate = (frenchDate) => {
    if (!frenchDate || frenchDate.length < 10) return null
    const parts = frenchDate.split('/')
    if (parts.length !== 3) return null
    const [day, month, year] = parts
    // Validation basique
    const d = parseInt(day)
    const m = parseInt(month)
    const y = parseInt(year)
    if (isNaN(d) || isNaN(m) || isNaN(y)) return null
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return null
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const loadChecklist = async () => {
    try {
      const { data, error } = await supabase
        .from('session_checklists')
        .select('*')
        .eq('session_id', session.id)

      if (error) throw error

      // Convertir en map pour accès facile
      const map = {}
      data?.forEach(item => {
        map[item.item_code] = item
      })
      setChecklistData(map)
    } catch (error) {
      console.error('Erreur chargement checklist:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCheck = async (itemCode, field, value) => {
    setSaving(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const existingItem = checklistData[itemCode]

      // Convertir les chaînes vides en null pour PostgreSQL
      const cleanValue = value === '' ? null : value

      const itemData = {
        session_id: session.id,
        item_code: itemCode,
        [field]: cleanValue,
        checked_by: userData?.user?.id,
        checked_at: field === 'is_checked' && value ? new Date().toISOString() : existingItem?.checked_at,
      }

      if (existingItem) {
        // Update
        const { error } = await supabase
          .from('session_checklists')
          .update(itemData)
          .eq('id', existingItem.id)

        if (error) throw error
      } else {
        // Insert
        const { error } = await supabase
          .from('session_checklists')
          .insert([itemData])

        if (error) throw error
      }

      await loadChecklist()
      toast.success('Enregistré')
    } catch (error) {
      console.error('Erreur sauvegarde:', error)
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  const handlePrint = (blank = false) => {
    const printWindow = window.open('', '_blank')
    printWindow.document.write(generatePrintHTML(blank))
    printWindow.document.close()
    setTimeout(() => {
      printWindow.print()
    }, 500)
  }

  const generatePrintHTML = (blank = false) => {
    const data = blank ? {} : checklistData
    const formatDate = (date) => date ? new Date(date).toLocaleDateString('fr-FR') : ''
    
    // Construire l'adresse complète du lieu
    const getLocation = () => {
      // 1. Si location_name est rempli, l'utiliser (adresse complète)
      if (session.location_name) {
        return session.location_name
      }
      
      // 2. Sinon construire depuis location_address + postal_code + city
      const parts = [
        session.location_address,
        session.location_postal_code,
        session.location_city
      ].filter(Boolean)
      
      if (parts.length > 0) {
        return parts.join(', ')
      }
      
      // 3. Fallback sur adresse client
      if (session.clients?.address) {
        return session.clients.address
      }
      
      return 'N/A'
    }

    const renderItem = (item) => {
      const itemData = data[item.code] || {}
      const checked = blank ? false : itemData.is_checked
      const dateRealized = blank ? '' : formatDate(itemData.date_realized)
      const comment = blank ? '' : itemData.comment || ''

      return `
        <div style="margin-bottom: 5px; page-break-inside: avoid; display: flex; align-items: center; font-size: 8.5pt; line-height: 1.2;">
          <span style="font-size: 12px; margin-right: 4px;">${checked ? '' : ''}</span>
          <span style="font-weight: 500; min-width: 200px; max-width: 200px;">${item.label}${item.sst ? ' [SST]' : ''}</span>
          <span style="margin: 0 8px;">|</span>
          <span style="min-width: 100px;">Date: ${dateRealized || '_________'}</span>
          <span style="margin: 0 8px;">|</span>
          <span style="flex: 1;">Commentaire: ${comment || '___________________________'}</span>
        </div>
      `
    }

    const renderSection = (title, items) => {
      const filteredItems = items.filter(item => !item.sst || isSST)
      if (filteredItems.length === 0) return ''

      return `
        <div style="margin-top: 8px;">
          <h3 style="background: #f3f4f6; padding: 4px 8px; margin: 0; font-size: 10px; font-weight: bold; border-left: 3px solid #3b82f6;">
            ${title} (${filteredItems.length} contrôles)
          </h3>
          <div style="padding: 4px 0;">
            ${filteredItems.map(renderItem).join('')}
          </div>
        </div>
      `
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Fiche de contrôle - ${session.reference}</title>
        <style>
          @media print {
            @page {
              size: A4 portrait;
              margin: 0.5cm;
            }
            body { margin: 0; }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 8.5pt;
            line-height: 1.2;
            color: #000;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #000;
            padding-bottom: 4px;
            margin-bottom: 8px;
          }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2px 12px;
            margin-bottom: 8px;
            font-size: 9.5px;
          }
          .info-label {
            font-weight: bold;
          }
          .footer {
            margin-top: 8px;
            padding-top: 4px;
            border-top: 2px solid #000;
            font-size: 8.5px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="margin: 0; font-size: 14px; font-weight: bold;">FICHE DE CONTRÔLE FORMATION</h1>
          <p style="margin: 2px 0; font-size: 9.5px;">${orgName()} - Archivage papier</p>
        </div>

        <div class="info-grid">
          <div><span class="info-label">Session :</span> ${session.reference}</div>
          <div><span class="info-label">Formateur :</span> ${session.trainers?.first_name} ${session.trainers?.last_name}</div>
          <div><span class="info-label">Formation :</span> ${session.courses?.title}</div>
          <div><span class="info-label">Stagiaires :</span> ${traineeCount}</div>
          <div><span class="info-label">Date :</span> ${formatDate(session.start_date)}${session.end_date && session.end_date !== session.start_date ? ' au ' + formatDate(session.end_date) : ''}</div>
          <div><span class="info-label">Lieu :</span> ${getLocation()}</div>
          <div style="grid-column: 1 / -1;"><span class="info-label">Client :</span> ${session.clients?.name || 'N/A'}</div>
        </div>

        ${renderSection('AVANT LA FORMATION', CHECKLIST_ITEMS.avant)}
        ${renderSection('PENDANT LA FORMATION', CHECKLIST_ITEMS.pendant)}
        ${renderSection('APRÈS LA FORMATION', CHECKLIST_ITEMS.apres)}

        <div class="footer">
          <div style="margin-bottom: 4px;">
            <strong>Date d'impression :</strong> ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px;">
            <div>
              <div>Vérifié par : ___________________________</div>
            </div>
            <div>
              <div>Signature : ___________________________</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
  }

  const getUncheckedCount = (phase) => {
    const items = CHECKLIST_ITEMS[phase].filter(item => !item.sst || isSST)
    return items.filter(item => !checklistData[item.code]?.is_checked).length
  }

  const getTotalUnchecked = () => {
    return getUncheckedCount('avant') + getUncheckedCount('pendant') + getUncheckedCount('apres')
  }

  const getDaysUntilSession = () => {
    if (!session.start_date) return null
    const today = new Date()
    const sessionDate = new Date(session.start_date)
    const diff = Math.ceil((sessionDate - today) / (1000 * 60 * 60 * 24))
    return diff
  }

  const daysUntil = getDaysUntilSession()
  const uncheckedBefore = getUncheckedCount('avant')
  const showAlert = daysUntil !== null && daysUntil <= 3 && daysUntil >= 0 && uncheckedBefore > 0

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Chargement...</div>
  }

  const renderCheckItem = (item, phase) => {
    if (item.sst && !isSST) return null

    const itemData = checklistData[item.code] || {}

    return (
      <div key={item.code} className="bg-gray-50 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={itemData.is_checked || false}
            onChange={(e) => handleCheck(item.code, 'is_checked', e.target.checked)}
            disabled={saving}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <label className="flex-1 font-medium text-sm">
            {item.label}
            {item.sst && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">SST</span>}
          </label>
        </div>
        <div className="ml-6 grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-gray-600">Date réalisation</label>
            <input
              type="text"
              placeholder="jj/mm/aaaa"
              value={editingDates[item.code] !== undefined 
                ? editingDates[item.code] 
                : formatDateToFrench(itemData.date_realized || '')}
              onChange={(e) => {
                // Mettre à jour seulement le state local pendant la saisie
                setEditingDates(prev => ({ ...prev, [item.code]: e.target.value }))
              }}
              onBlur={(e) => {
                // Convertir le format français vers ISO et sauvegarder
                const isoDate = parseFrenchDate(e.target.value)
                handleCheck(item.code, 'date_realized', isoDate)
                // Nettoyer le state local
                setEditingDates(prev => {
                  const newState = { ...prev }
                  delete newState[item.code]
                  return newState
                })
              }}
              disabled={saving}
              className="w-full px-2 py-1 border rounded text-xs"
            />
          </div>
          <div>
            <label className="text-gray-600">Commentaire</label>
            <input
              type="text"
              value={editingComments[item.code] !== undefined ? editingComments[item.code] : (itemData.comment || '')}
              onChange={(e) => {
                // Mettre à jour seulement le state local pendant la saisie
                setEditingComments(prev => ({ ...prev, [item.code]: e.target.value }))
              }}
              onBlur={(e) => {
                // Sauvegarder en base seulement quand on quitte le champ
                handleCheck(item.code, 'comment', e.target.value)
                // Nettoyer le state local
                setEditingComments(prev => {
                  const newState = { ...prev }
                  delete newState[item.code]
                  return newState
                })
              }}
              disabled={saving}
              placeholder="Optionnel"
              className="w-full px-2 py-1 border rounded text-xs"
            />
          </div>
        </div>
      </div>
    )
  }

  const renderSection = (title, phase, items) => {
    const filtered = items.filter(item => !item.sst || isSST)
    if (filtered.length === 0) return null

    const unchecked = getUncheckedCount(phase)

    return (
      <div className="mb-6">
        <h4 className="flex items-center justify-between bg-gray-100 px-4 py-2 rounded-t-lg border-l-4 border-blue-500">
          <span className="font-semibold text-gray-900">{title}</span>
          <span className={`text-sm ${unchecked === 0 ? 'text-green-600' : 'text-orange-600'}`}>
            {filtered.length - unchecked}/{filtered.length} validés
          </span>
        </h4>
        <div className="space-y-2 p-4 border border-t-0 rounded-b-lg">
          {filtered.map(item => renderCheckItem(item, phase))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Alerte J-3 */}
      {showAlert && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h5 className="font-semibold text-orange-900">
              Session dans {daysUntil} jour{daysUntil > 1 ? 's' : ''}
            </h5>
            <p className="text-sm text-orange-800 mt-1">
              Il reste {uncheckedBefore} contrôle{uncheckedBefore > 1 ? 's' : ''} "Avant la formation" non validé{uncheckedBefore > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Boutons impression */}
      <div className="flex gap-3">
        <button
          onClick={() => handlePrint(false)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <FileCheck className="w-5 h-5" />
          <span> Imprimer fiche (état actuel)</span>
        </button>
        <button
          onClick={() => handlePrint(true)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          <Printer className="w-5 h-5" />
          <span> Imprimer vierge</span>
        </button>
      </div>

      {/* Sections */}
      {renderSection('AVANT LA FORMATION', 'avant', CHECKLIST_ITEMS.avant)}
      {renderSection('PENDANT LA FORMATION', 'pendant', CHECKLIST_ITEMS.pendant)}
      {renderSection('APRÈS LA FORMATION', 'apres', CHECKLIST_ITEMS.apres)}

      {/* Note */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong> Note :</strong> Cette fiche de contrôle facilite le suivi et l'archivage papier pour la conformité Qualiopi.
        Les modifications sont sauvegardées automatiquement.
      </div>
    </div>
  )
}
