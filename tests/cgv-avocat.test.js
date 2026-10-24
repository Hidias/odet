import { describe, it, expect } from 'vitest'
import { DOMParser as XmlDomParser } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { exportDocx, importDocx, comparerSections, diffMots, dossierAvocatDocx } from '../src/modules/qualite/richdocs/docxRichDoc'
import { loadTemplates, fromTemplate } from '../src/modules/qualite/richdocs/model'

globalThis.DOMParser = globalThis.DOMParser || XmlDomParser

const enBuf = async (blob) => (typeof blob.arrayBuffer === 'function' ? blob.arrayBuffer() : blob)

describe('Relecture des conditions générales par l’avocat', () => {
  it('export Word puis réimport : même contenu, mêmes articles, mêmes destinataires', async () => {
    const t = await loadTemplates()
    for (const id of ['cgv', 'cgv-maintenance', 'cgv-vente', 'cgv-installation', 'perimetre-maintenance']) {
      const content = fromTemplate(t[id])
      const blob = await exportDocx({ tpl: t[id], content, code: 'X' })
      const imp = await importDocx(await enBuf(blob), content.sections)
      const ch = comparerSections(content.sections, imp.sections)
      expect(ch.filter((c) => c.type !== 'identique').map((c) => c.title), id).toEqual([])
      expect(imp.sections.map((s) => s.cond || '')).toEqual(content.sections.map((s) => s.cond || ''))
    }
  })
  it('les changements de l’avocat (modifications suivies comprises) sont montrés mot à mot', async () => {
    const content = { sections: [{ id: 'a', title: 'Objet', blocks: [{ t: 'p', text: 'Le contrat dure un an.' }] }, { id: 'b', title: 'Prix', cond: 'particuliers', blocks: [{ t: 'ul', items: ['un', 'deux'] }] }] }
    const blob = await exportDocx({ tpl: { name: 'Essai' }, content })
    const zip = await JSZip.loadAsync(await enBuf(blob))
    let xml = await zip.file('word/document.xml').async('string')
    // L'avocat remplace « un an » par « deux ans » en modification suivie, et retire l'article Prix
    xml = xml.replace('Le contrat dure un an.', 'Le contrat dure </w:t></w:r><w:del><w:r><w:t>un an</w:t></w:r></w:del><w:ins><w:r><w:t>deux ans</w:t></w:r></w:ins><w:r><w:t>.')
    xml = xml.replace(/<w:p><w:pPr><w:pStyle w:val="Heading2"\/><\/w:pPr><w:r><w:t xml:space="preserve">Prix \[particuliers\][\s\S]*$/, '</w:body></w:document>')
    zip.file('word/document.xml', xml)
    const imp = await importDocx(await zip.generateAsync({ type: 'arraybuffer' }), content.sections)
    const ch = comparerSections(content.sections, imp.sections)
    expect(imp.sections[0].blocks[0].text).toBe('Le contrat dure deux ans.')
    expect(ch.find((c) => c.title === 'Objet').type).toBe('modif')
    expect(ch.find((c) => c.title === 'Prix').type).toBe('retrait')
  })
  it('différence mot à mot', () => {
    expect(diffMots('a b c', 'a x c').filter((d) => d.t !== '=')).toEqual([{ t: '-', s: 'b' }, { t: '+', s: 'x' }])
  })
  it('dossier pour l’avocat : points par métier, documents, mentions', async () => {
    const t = await loadTemplates()
    const blob = await dossierAvocatDocx({ docs: [{ tpl: t['cgv-vente'], content: fromTemplate(t['cgv-vente']) }], mentions: { distance: 'Texte {date}' } })
    const xml = await (await JSZip.loadAsync(await enBuf(blob))).file('word/document.xml').async('string')
    expect(xml).toContain('Points à valider, par métier')
    expect(xml).toContain('Réserve de propriété')
    expect(xml).toContain('Devis établi à distance')
  })
})
