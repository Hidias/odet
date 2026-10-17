import { requireUser } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
// api/parse-bank-statement.js
// Extraction des soldes d'un relevé bancaire (PDF) + contrôle arithmétique.
//
// PRINCIPE DE SÉCURITÉ : on n'enregistre JAMAIS un solde qui ne se vérifie pas.
// L'équation ancien solde − débits + crédits = nouveau solde doit tomber juste
// au centime. Sinon on renvoie arithmetic_ok = false et le front bascule sur la
// saisie manuelle. Un solde faux est pire que pas de solde du tout.
//
// PIÈGE CRITIQUE : sur la plupart des relevés français, le solde est libellé « CRÉDITEUR » ou
// « DÉBITEUR ». DÉBITEUR = compte à découvert = valeur NÉGATIVE. Une lecture
// naïve du nombre inverse le signe et fausse le solde du double du montant.
//
// La clé Anthropic ne quitte jamais le serveur (process.env.ANTHROPIC_API_KEY).

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '10mb' } }
}

const MODEL = 'claude-sonnet-4-6'

const EXTRACTION_PROMPT = `Tu analyses un relevé de compte bancaire français.

Extrais UNIQUEMENT les informations d'en-tête et de pied de relevé. N'extrais AUCUNE opération individuelle.

Réponds en JSON strict, sans markdown, sans texte autour :
{
  "statement_number": 7,
  "statement_year": 2026,
  "period_end": "2026-07-31",
  "opening_balance_raw": 2126.95,
  "opening_balance_sense": "CREDITEUR",
  "opening_balance_date": "2026-06-30",
  "closing_balance_raw": 3035.30,
  "closing_balance_sense": "DEBITEUR",
  "total_debits": 9889.05,
  "total_credits": 4726.80,
  "account_label": "Banque - 01234567 89"
}

Règles de lecture :
- Les libellés varient selon la banque : « ancien solde », « solde précédent », « solde au » ; « nouveau solde », « solde final » ; un solde négatif ou suivi de « D » / « DB » est DEBITEUR.
- "N° 7 - 2026" → statement_number = 7, statement_year = 2026
- "Arrêté au 31 juillet 2026" → period_end = "2026-07-31" (format ISO)
- "ANCIEN SOLDE CRÉDITEUR AU 30 JUIN 2026   2 126,95 €" →
    opening_balance_raw = 2126.95, opening_balance_sense = "CREDITEUR",
    opening_balance_date = "2026-06-30"
- "NOUVEAU SOLDE DÉBITEUR AU 31 JUILLET 2026   3 035,30 €" →
    closing_balance_raw = 3035.30, closing_balance_sense = "DEBITEUR"
- "TOTAL DES OPÉRATIONS DU RELEVÉ   9 889,05   4 726,80" →
    total_debits = 9889.05 (colonne Débit), total_credits = 4726.80 (colonne Crédit)
- account_label : nom court de la banque, " - ", puis le numéro de compte affiché sur le relevé

IMPÉRATIF :
- opening_balance_raw et closing_balance_raw sont TOUJOURS des nombres POSITIFS
  (la valeur absolue lue sur le relevé). C'est le champ "_sense" qui porte le signe.
- "_sense" vaut exactement "CREDITEUR" ou "DEBITEUR", jamais autre chose.
- Les nombres sont au format français (espace = milliers, virgule = décimales).
  Convertis-les en nombres JSON : "9 889,05" → 9889.05
- Si une valeur est introuvable, mets null. N'invente jamais un chiffre.`

// "1 234,56" → 1234.56
function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

// Applique le signe : DEBITEUR → négatif, CREDITEUR → positif
function signedBalance(raw, sense) {
  const n = toNumber(raw)
  if (n === null) return null
  const s = String(sense || '').toUpperCase()
  if (s.startsWith('DEB')) return -Math.abs(n)
  if (s.startsWith('CRED')) return Math.abs(n)
  return null // sens non reconnu → on refuse de deviner
}

const round2 = (n) => Math.round(n * 100) / 100

async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })
  }

  try {
    const { base64, fileName } = req.body || {}

    if (!base64) {
      return res.status(400).json({ error: 'PDF manquant (base64 requis)' })
    }

    // 1. Extraction par lecture du PDF
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ]
        }]
      })
    })

    if (!upstream.ok) {
      const detail = await upstream.text()
      console.error('parse-bank-statement — erreur Anthropic:', upstream.status, detail)
      return res.status(502).json({
        error: "Lecture automatique indisponible. Saisissez les soldes manuellement.",
        arithmetic_ok: false,
      })
    }

    const data = await upstream.json()
    const rawText = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim()

    let parsed
    try {
      parsed = JSON.parse(rawText)
    } catch {
      console.error('parse-bank-statement — JSON illisible:', rawText.slice(0, 300))
      return res.status(422).json({
        error: "Relevé illisible automatiquement. Saisissez les soldes manuellement.",
        arithmetic_ok: false,
      })
    }

    // 2. Normalisation + application des signes
    const opening = signedBalance(parsed.opening_balance_raw, parsed.opening_balance_sense)
    const closing = signedBalance(parsed.closing_balance_raw, parsed.closing_balance_sense)
    const debits = toNumber(parsed.total_debits)
    const credits = toNumber(parsed.total_credits)

    const missing = []
    if (opening === null) missing.push('ancien solde')
    if (closing === null) missing.push('nouveau solde')
    if (debits === null) missing.push('total des débits')
    if (credits === null) missing.push('total des crédits')

    if (missing.length) {
      return res.status(422).json({
        error: `Valeurs non lues : ${missing.join(', ')}. Saisissez les soldes manuellement.`,
        arithmetic_ok: false,
        partial: { opening, closing, debits, credits },
      })
    }

    // 3. CONTRÔLE ARITHMÉTIQUE — le garde-fou central
    //    ancien solde − débits + crédits = nouveau solde
    const expected = round2(opening - debits + credits)
    const delta = round2(expected - closing)
    const arithmeticOk = Math.abs(delta) < 0.01

    // 4. Cohérence du nom de fichier (RLV_007_00890689_40_20260731.pdf)
    let fileNameWarning = null
    if (fileName) {
      const m = String(fileName).match(/RLV_(\d+)_.*_(\d{4})(\d{2})(\d{2})/i)
      if (m) {
        const numFromName = parseInt(m[1], 10)
        const dateFromName = `${m[2]}-${m[3]}-${m[4]}`
        if (parsed.statement_number && numFromName !== parsed.statement_number) {
          fileNameWarning = `Le nom du fichier indique le relevé n°${numFromName} mais le contenu indique le n°${parsed.statement_number}.`
        } else if (parsed.period_end && dateFromName !== parsed.period_end) {
          fileNameWarning = `Le nom du fichier indique le ${dateFromName} mais le contenu indique le ${parsed.period_end}.`
        }
      }
    }

    return res.status(200).json({
      success: true,
      arithmetic_ok: arithmeticOk,
      arithmetic_delta: delta,
      arithmetic_detail: {
        opening,
        debits,
        credits,
        expected_closing: expected,
        declared_closing: closing,
      },
      statement: {
        statement_number: parsed.statement_number ?? null,
        statement_year: parsed.statement_year ?? null,
        period_start: parsed.opening_balance_date || null,
        period_end: parsed.period_end || null,
        account_label: parsed.account_label || null,
        opening_balance: opening,
        closing_balance: closing,
        total_debits: debits,
        total_credits: credits,
      },
      warning: fileNameWarning,
      message: arithmeticOk
        ? 'Relevé lu et vérifié.'
        : `Contrôle arithmétique en échec (écart de ${delta.toFixed(2)} €). Vérifiez les valeurs avant d'enregistrer.`,
    })

  } catch (error) {
    console.error('parse-bank-statement error:', error)
    return res.status(500).json({ error: error.message, arithmetic_ok: false })
  }
}

export default withErrorLog(handler, 'parse-bank-statement')
