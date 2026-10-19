// ═══════════════════════════════════════════════════════════════
// useRelanceIA.js - Hook pour relances de devis personnalisées par IA
// Utilisation : WeeklyPlanner, Quotes.jsx, ou tout composant avec relance
// ═══════════════════════════════════════════════════════════════

import { orgName, currentUserName, currentUserFirstName } from '../../../core/org/currentOrg'
import { apiFetch } from '../../../core/api'
import { useState } from 'react'
import { supabase } from '../../../core/supabase'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { chargerCapacites } from '../../../core/capacites'
import { modeleRelanceDevis } from '../../../core/emails/modeles'

/**
 * Hook pour gérer les relances de devis avec génération IA
 * 
 * Usage :
 *   const { relanceQuote, sending, previewData, confirmSend, cancelPreview } = useRelanceIA()
 *   
 *   // Clic sur "Relancer" → génère le brouillon IA
 *   onClick={() => relanceQuote(quote)}
 *   
 *   // previewData contient { quote, subject, body, tone, relanceNum } quand prêt
 *   // confirmSend() pour envoyer, cancelPreview() pour annuler
 */
export function useRelanceIA() {
  const [sending, setSending] = useState(null) // quote.id en cours
  const [generating, setGenerating] = useState(null) // quote.id en génération IA
  const [previewData, setPreviewData] = useState(null)

  const relanceQuote = async (quote, options = {}) => {
    const clientEmail = quote.clients?.contact_email
    if (!clientEmail) {
      toast.error('Pas d\'email - ajouter dans la fiche client')
      return
    }

    const relanceNum = (quote.relance_count || 0) + 1
    if (relanceNum >= 4) {
      toast.error('3 relances déjà envoyées - appeler le client directement')
      return
    }

    setGenerating(quote.id)

    // Sans assistant de rédaction : texte modèle directement, sans message d'erreur (décision de H du 19/10)
    const modele = () => {
      const m = modeleRelanceDevis({ quote, contactName: quote.clients?.contact_name || '', org: orgName(), numero: relanceNum })
      setPreviewData({ quote, clientEmail, subject: m.subject, body: m.body, tone: 'courtois', relanceNum, isFallback: true })
    }
    const { ia } = await chargerCapacites()
    if (!ia) { modele(); setGenerating(null); return }

    try {
      // Charger le contexte enrichi
      const [itemsRes, interactionsRes, rdvRes] = await Promise.all([
        supabase.from('quote_items').select('description_title, quantity, unit_price_ht').eq('quote_id', quote.id),
        supabase.from('client_interactions').select('type, title, content, interaction_date')
          .eq('client_id', quote.client_id).order('interaction_date', { ascending: false }).limit(5),
        supabase.from('prospect_rdv').select('rdv_date, notes')
          .eq('client_id', quote.client_id).order('rdv_date', { ascending: false }).limit(1),
      ])

      const daysSinceQuote = Math.floor((new Date() - new Date(quote.quote_date)) / 86400000)

      // Appel API IA
      const res = await apiFetch('/api/generate-relance-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote: {
            reference: quote.reference,
            quote_date: quote.quote_date,
            total_ht: quote.total_ht,
            total_ttc: quote.total_ttc,
            object: quote.object,
            relance_count: quote.relance_count,
            notes: quote.notes,
          },
          client: {
            name: quote.clients?.name,
            contact_name: quote.clients?.contact_name,
            contact_email: clientEmail,
          },
          items: itemsRes.data || [],
          senderName: options.senderName || currentUserName(),
          daysSinceQuote,
          interactions: interactionsRes.data || [],
          rdvContext: rdvRes.data?.[0] || null,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Erreur API ${res.status}`)
      }

      const aiResult = await res.json()

      // Afficher le preview pour validation
      setPreviewData({
        quote,
        clientEmail,
        subject: aiResult.subject,
        body: aiResult.body,
        tone: aiResult.tone,
        relanceNum: aiResult.relanceNum || relanceNum,
      })
    } catch (err) {
      console.error('Relance IA error:', err)
      toast.error("L'assistant n'a pas répondu : le texte modèle est proposé à la place.")
      modele()
    } finally {
      setGenerating(null)
    }
  }

  const confirmSend = async (editedSubject, editedBody) => {
    if (!previewData) return

    const { quote, clientEmail, relanceNum } = previewData
    const subject = editedSubject || previewData.subject
    const body = editedBody || previewData.body

    setSending(quote.id)

    try {
      // Convertir le body texte en HTML
      const htmlBody = body.split('\n').map(line => line.trim() ? `<p>${line}</p>` : '').join('')

      const res = await apiFetch('/api/send-prospect-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: clientEmail,
          subject,
          body: htmlBody,
          caller: currentUserFirstName(),
          clientId: quote.client_id,
          prospectName: quote.clients?.name,
          templateType: 'relance_devis',
        }),
      })

      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur serveur')

      // Mettre à jour le devis
      const noteDate = new Date().toLocaleDateString('fr-FR')
      const relanceLabel = relanceNum === 1 ? '1ère' : relanceNum === 2 ? '2ème' : '3ème'

      await supabase.from('quotes').update({
        relance_count: relanceNum,
        last_relance_date: format(new Date(), 'yyyy-MM-dd'),
        notes: (quote.notes ? quote.notes + '\n' : '') + ` ${relanceLabel} relance envoyée le ${noteDate} à ${clientEmail}`,
        updated_at: new Date().toISOString(),
      }).eq('id', quote.id)

      // Logger l'interaction (silencieux si échec)
      try {
        await supabase.from('client_interactions').insert({
          client_id: quote.client_id,
          type: 'email',
          title: `Relance devis ${quote.reference} (${relanceLabel})`,
          content: `Email IA envoyé à ${clientEmail}\nObjet: ${subject}`,
          author: currentUserFirstName(),
          interaction_date: new Date().toISOString(),
        })
      } catch {} // eslint-disable-line no-empty

      toast.success(`${relanceLabel} relance envoyée `)
      setPreviewData(null)
      return true // Indique le succès pour le composant parent
    } catch (err) {
      console.error('Send relance error:', err)
      toast.error('Erreur envoi: ' + err.message)
      return false
    } finally {
      setSending(null)
    }
  }

  const cancelPreview = () => {
    setPreviewData(null)
  }

  const updatePreview = (field, value) => {
    if (!previewData) return
    setPreviewData(prev => ({ ...prev, [field]: value }))
  }

  return {
    relanceQuote,
    sending,
    generating,
    previewData,
    confirmSend,
    cancelPreview,
    updatePreview,
  }
}
