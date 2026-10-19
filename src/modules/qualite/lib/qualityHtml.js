import { ligneNda } from '../../../core/org/orgUtils'
// Mise en forme commune des documents qualité rédigés en HTML (CGV, livret, politique qualité,
// procédures, règlement…) : à l'affichage et à l'impression, on retire les styles d'origine
// (dégradés, émojis, couleurs propres à un ancien organisme) et on applique la même identité
// que les PDF générés (core/pdf/layout.js) : bandeau logo + identité, titre avec trait d'accent,
// sections sobres, pied de page légal. Le contenu enregistré n'est pas modifié.

const hex = (c) => '#' + (c || [0, 0, 0]).map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu

function css(t) {
  return `
  :root { --primary: ${hex(t.primary)}; --accent: ${hex(t.accent)}; --highlight: ${hex(t.highlight)}; --text: ${hex(t.text)}; --muted: ${hex(t.muted)}; --line: ${hex(t.line)}; --surface: ${hex(t.surface)}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html { background: #e9ebee; }
  body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: var(--text); font-size: 10.5pt; line-height: 1.55; background: #e9ebee; }
  .odet-page { max-width: 210mm; margin: 24px auto; background: #fff; padding: 14mm 15mm 12mm; box-shadow: 0 2px 18px rgba(0,0,0,.08); }
  .odet-band { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--highlight); }
  .odet-band img { max-height: 16mm; max-width: 45mm; object-fit: contain; }
  .odet-band .logo-text { font-weight: 700; font-size: 15pt; color: var(--primary); }
  .odet-id { text-align: right; font-size: 7.5pt; color: var(--muted); line-height: 1.45; }
  .odet-id strong { display: block; color: var(--primary); font-size: 8.5pt; text-transform: uppercase; letter-spacing: .02em; }
  .odet-label { display: flex; justify-content: space-between; margin: 6px 0 14px; font-size: 7pt; color: var(--muted); letter-spacing: .12em; text-transform: uppercase; }
  .odet-label b { color: var(--accent); letter-spacing: 0; }
  .odet-title { border-left: 4px solid var(--accent); padding-left: 10px; margin: 0 0 18px; }
  .odet-title h1 { margin: 0; font-size: 18pt; line-height: 1.2; color: var(--primary); }
  .odet-title div { font-size: 8.5pt; color: var(--muted); margin-top: 3px; }
  .odet-body h1 { font-size: 14pt; color: var(--primary); }
  .odet-body h2, .odet-body .section-title { font-size: 12pt; color: var(--primary); margin: 20px 0 10px; padding: 0 0 4px; border: 0; background: none; display: block; position: relative; }
  .odet-body h2::after, .odet-body .section-title::after { content: ''; display: block; width: 14mm; height: 2px; background: var(--highlight); margin-top: 4px; }
  .odet-body h3 { font-size: 10.5pt; color: var(--primary); margin: 12px 0 6px; }
  .odet-body h4 { font-size: 10pt; color: var(--text); margin: 8px 0 4px; }
  .odet-body p { margin: 0 0 7px; }
  .odet-body ul, .odet-body ol { margin: 6px 0 10px 20px; padding: 0; }
  .odet-body li { margin: 3px 0; }
  .odet-body ul li::marker { color: var(--highlight); }
  .odet-body .section, .odet-body section { margin-bottom: 18px; }
  .odet-body .icon, .odet-body .check { display: none; }
  .odet-body .objectives-list { list-style: disc; margin-left: 20px; }
  .odet-body .objectives-list li { display: list-item; padding: 0; background: none; }
  /* Encadrés : fond de surface et liseré d'accent, comme les encadrés des PDF */
  .odet-body .intro-text, .odet-body .intro-box, .odet-body .card, .odet-body .info-box, .odet-body .engagement-box,
  .odet-body .process-section, .odet-body .highlight-box, .odet-body .warning-box, .odet-body .alert, .odet-body .note,
  .odet-body .box, .odet-body .notice, .odet-body .important, .odet-body .step-content, .odet-body .article, .odet-body .contact-box {
    background: var(--surface) !important; color: var(--text) !important; border: 0 !important; border-left: 3px solid var(--accent) !important;
    border-radius: 0 !important; padding: 10px 14px !important; margin: 10px 0 !important; box-shadow: none !important; }
  .odet-body .engagement-box h3, .odet-body .card h3 { color: var(--primary) !important; text-align: left; }
  /* Grilles de cartes */
  .odet-body .values-grid, .odet-body .contact-methods, .odet-body .engagement-list, .odet-body .grid, .odet-body .cards {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(48mm, 1fr)); gap: 8px; margin: 10px 0; }
  .odet-body .value-card, .odet-body .contact-card, .odet-body .engagement-item {
    background: var(--surface) !important; color: var(--text) !important; border: 0 !important; border-top: 2px solid var(--accent) !important;
    border-radius: 0 !important; padding: 9px 11px !important; text-align: left !important; transform: none !important; box-shadow: none !important; }
  .odet-body .engagement-item .number { font-size: 14pt; font-weight: 700; color: var(--primary); }
  .odet-body .engagement-item .label { font-size: 8pt; color: var(--muted); }
  .odet-body .value-card h3, .odet-body .contact-card h4 { margin-top: 0; color: var(--primary) !important; }
  /* Étapes */
  .odet-body .step { display: flex; gap: 10px; align-items: flex-start; margin: 8px 0; }
  .odet-body .step-number { flex: 0 0 auto; width: 7mm; height: 7mm; border-radius: 50%; background: var(--primary) !important; color: #fff !important;
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 9pt; }
  .odet-body .step-content { flex: 1; margin: 0 !important; }
  .odet-body .timeline { color: var(--accent); font-size: 8.5pt; font-weight: 700; margin-top: 4px; }
  /* Tableaux : en-tête couleur principale, lignes alternées */
  .odet-body table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9pt; }
  .odet-body th { background: var(--primary) !important; color: #fff !important; text-align: left; font-size: 8pt; padding: 6px 8px; }
  .odet-body td { padding: 6px 8px; border-bottom: 1px solid var(--line); background: none; }
  .odet-body tr:nth-child(even) td { background: var(--surface); }
  .odet-body .target { color: var(--accent); font-weight: 700; }
  /* Signatures */
  .odet-body .signature-box { background: none !important; color: var(--text) !important; border: 1px solid var(--line) !important; border-radius: 0 !important; padding: 12px 14px !important; margin-top: 18px; }
  .odet-body .signature-box h3 { color: var(--primary) !important; }
  .odet-body .signatures { display: flex; gap: 20px; justify-content: flex-start; flex-wrap: wrap; }
  .odet-body .signature { min-width: 60mm; text-align: left; }
  .odet-body .signature .name { font-weight: 700; }
  .odet-body .signature .role { color: var(--muted); font-size: 9pt; }
  .odet-body .formation-item { background: var(--surface); border-left: 3px solid var(--accent); padding: 6px 10px; margin: 6px 0; }
  .odet-body .formation-item h4 { margin: 0; }
  .odet-foot { margin-top: 22px; padding-top: 6px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 12px; font-size: 6.8pt; color: var(--muted); line-height: 1.5; }
  .odet-foot .code { white-space: nowrap; align-self: flex-end; }
  .odet-toolbar { position: fixed; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 10; }
  .odet-toolbar button { background: var(--primary); color: #fff; border: 0; padding: 10px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,.18); }
  @page { size: A4; margin: 12mm 0; }
  @media print {
    html, body { background: #fff; }
    .odet-page { margin: 0 auto; box-shadow: none; padding: 0 15mm; }
    .odet-toolbar { display: none; }
    .odet-body .section, .odet-body section, .odet-body .card, .odet-body .step, .odet-body table, .odet-body .signature-box { break-inside: avoid; }
    .odet-body h2, .odet-body .section-title, .odet-body h3 { break-after: avoid; }
  }`
}

/** Retire couleurs et fonds des styles en ligne (on garde marges, alignements, tailles) */
function cleanInlineStyles(root) {
  root.querySelectorAll('[style]').forEach(el => {
    const kept = el.getAttribute('style').split(';').map(s => s.trim()).filter(Boolean)
      .filter(d => !/^(background|color|border|box-shadow|border-radius|opacity|font-family)\b/i.test(d))
    if (kept.length) el.setAttribute('style', kept.join('; ')); else el.removeAttribute('style')
  })
}

/**
 * @param {string} html document déjà complété (fillTemplate) : HTML complet ou texte brut
 * @param {object} ORG identité (loadPdfOrg : logo_base64, theme, name, nameFull, address…)
 * @param {object} opts { title, version, code, toolbar, docLabel }
 * @returns {string} page HTML complète
 */
export function brandQualityHtml(html, ORG, { title = '', version = '', code = 'QUAL', toolbar = true, docLabel = 'Système qualité' } = {}) {
  const t = ORG.theme
  const raw = String(html || '')
  const isHtml = /<!doctype|<html|<body|<div|<p[\s>]/i.test(raw)
  let docTitle = title
  let subtitle = ''
  let bodyHtml = ''

  if (isHtml && typeof DOMParser !== 'undefined') {
    const dom = new DOMParser().parseFromString(raw, 'text/html')
    dom.querySelectorAll('style, script, link, meta, title, .toolbar').forEach(n => n.remove())
    const header = dom.querySelector('.header')
    if (header) {
      const h1 = header.querySelector('h1')
      if (h1 && h1.textContent.trim()) docTitle = h1.textContent
      subtitle = [...header.querySelectorAll('.version')].map(n => n.textContent.trim()).filter(Boolean).join(' · ')
      header.remove()
    }
    dom.querySelectorAll('.footer').forEach(n => n.remove())
    cleanInlineStyles(dom.body)
    const container = dom.querySelector('.container') || dom.body
    const content = container.querySelector('.content') || container
    bodyHtml = content.innerHTML
  } else {
    bodyHtml = esc(raw).replace(/\n/g, '<br>')
  }
  docTitle = String(docTitle || '').replace(EMOJI, '').trim()
  bodyHtml = bodyHtml.replace(EMOJI, '')
  subtitle = subtitle.replace(EMOJI, '').replace(/\s*\|\s*NDA\s*:\s*[^·]*$/i, '').trim()
  if (version && !subtitle) subtitle = `Version ${version}`

  const logo = ORG.logo_base64 || ORG.logo_url
  const ident = [
    `<strong>${esc(ORG.nameFull || ORG.name || '')}</strong>`,
    esc(ORG.adressePrincipale || ORG.address || ''),
    esc([ORG.phone, ORG.email].filter(Boolean).join('   ')),
    esc([ORG.siret ? `SIRET ${ORG.siret}` : '', ligneNda(ORG)].filter(Boolean).join('   ')),
  ].filter(Boolean).join('<br>')
  const foot1 = [ORG.nameFull || ORG.name, ORG.adressePrincipale || ORG.addressFull, ORG.siegeMention].filter(Boolean).join('  ·  ')
  const foot2 = [ORG.siret ? `SIRET ${ORG.siret}` : '', ORG.naf ? `NAF ${ORG.naf}` : '', ORG.tva ? `TVA ${ORG.tva}` : '', ligneNda(ORG, { complet: true })].filter(Boolean).join('  ·  ')
  const docRef = `${ORG.doc_prefix ? ORG.doc_prefix + '-' : ''}${code}`

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}${ORG.name ? ' - ' + esc(ORG.name) : ''}</title><style>${css(t)}</style></head><body>
${toolbar ? '<div class="odet-toolbar"><button onclick="window.print()">Imprimer ou enregistrer en PDF</button><button onclick="window.close()">Fermer</button></div>' : ''}
<div class="odet-page">
  <div class="odet-band">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="logo-text">${esc(ORG.name || '')}</span>`}<div class="odet-id">${ident}</div></div>
  <div class="odet-label"><span>${esc(docLabel)}</span><b>${esc(docRef)}</b></div>
  <div class="odet-title"><h1>${esc(docTitle)}</h1>${subtitle ? `<div>${esc(subtitle)}</div>` : ''}</div>
  <div class="odet-body">${bodyHtml}</div>
  <div class="odet-foot"><div>${esc(foot1)}<br>${esc(foot2)}</div><div class="code">${esc(docRef)}</div></div>
</div></body></html>`
}
