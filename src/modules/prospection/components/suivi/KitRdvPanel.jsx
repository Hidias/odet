// ════════════════════════════════════════════════════════════════
// KitRdvPanel.jsx - Documents à présenter le jour du RDV
// Fichiers rangés dans le bucket "documents", dossier rdv-kit/.
// Aucun envoi par mail (décision : on verra plus tard).
// ════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { Download, Upload, Loader2, Archive, RotateCcw, Trash2, FolderDown } from 'lucide-react'
import toast from 'react-hot-toast'
import JSZip from 'jszip'
import { supabase } from '../../../../core/supabase'
import { buildStorageFileName } from '../../../../core/storageUtils'
import { KIT_CATEGORIES, kitCategoryLabel } from './suiviUtils'

const BUCKET = 'documents'
const FOLDER = 'rdv-kit'

export default function KitRdvPanel({ author }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('toujours')
  const [uploading, setUploading] = useState(false)
  const [zipping, setZipping] = useState(false)
  const fileRef = useRef(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('rdv_kit_documents')
      .select('*')
      .order('category')
      .order('sort_order')
      .order('title')
    if (error) toast.error('Kit RDV : chargement impossible')
    setDocs(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { toast.error('Choisissez un fichier'); return }
    if (!title.trim()) { toast.error('Donnez un titre au document'); return }
    setUploading(true)
    try {
      const path = `${FOLDER}/${buildStorageFileName(file.name)}`
      const { error: upError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
      if (upError) throw upError
      const { error } = await supabase.from('rdv_kit_documents').insert({
        title: title.trim(),
        category,
        file_name: file.name,
        file_path: path,
        file_type: file.type || null,
        file_size: file.size || null,
        created_by: author,
        updated_by: author,
      })
      if (error) {
        await supabase.storage.from(BUCKET).remove([path])
        throw error
      }
      toast.success('Document ajouté au kit')
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (err) {
      toast.error('Ajout impossible : ' + err.message)
    } finally { setUploading(false) }
  }

  const download = async (doc) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 300)
    if (error || !data?.signedUrl) { toast.error('Téléchargement impossible'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const downloadAll = async () => {
    const active = docs.filter(d => d.is_active)
    if (active.length === 0) { toast.error('Le kit est vide'); return }
    setZipping(true)
    try {
      const zip = new JSZip()
      for (const d of active) {
        const { data, error } = await supabase.storage.from(BUCKET).download(d.file_path)
        if (error || !data) { toast.error(`Fichier introuvable : ${d.file_name}`); continue }
        const folder = kitCategoryLabel(d.category).replace(/[\\/:*?"<>|]/g, '-')
        zip.file(`${folder}/${d.file_name}`, data)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Kit_RDV_Access_Formation.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Création du zip impossible : ' + err.message)
    } finally { setZipping(false) }
  }

  const toggleActive = async (doc) => {
    const { error } = await supabase.from('rdv_kit_documents')
      .update({ is_active: !doc.is_active, updated_by: author })
      .eq('id', doc.id)
    if (error) { toast.error('Action impossible'); return }
    toast.success(doc.is_active ? 'Document archivé' : 'Document réactivé')
    load()
  }

  const remove = async (doc) => {
    if (!confirm(`Supprimer définitivement « ${doc.title} » ?`)) return
    const { error } = await supabase.from('rdv_kit_documents').delete().eq('id', doc.id)
    if (error) { toast.error('Suppression impossible'); return }
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    toast.success('Document supprimé')
    load()
  }

  const visible = docs.filter(d => showArchived || d.is_active)
  const byCategory = KIT_CATEGORIES
    .map(c => ({ ...c, items: visible.filter(d => d.category === c.value) }))
    .filter(c => c.items.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-ui text-gray-600 flex-1 min-w-[200px]">
          Les documents à présenter le jour du RDV. Téléchargez tout le kit sur votre téléphone avant d'y aller.
        </p>
        <button onClick={downloadAll} disabled={zipping}
          className="flex items-center gap-1.5 px-3 py-2 text-ui font-medium bg-gray-900 text-white rounded-ui-sm hover:bg-gray-700 disabled:opacity-50">
          {zipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderDown className="w-4 h-4" />}
          Télécharger tout le kit
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ui text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Chargement</div>
      ) : byCategory.length === 0 ? (
        <p className="text-ui text-gray-500">Le kit est vide. Ajoutez vos premiers documents ci-dessous.</p>
      ) : (
        <div className="space-y-3">
          {byCategory.map(c => (
            <div key={c.value}>
              <p className="text-ui-sm font-semibold text-gray-500 mb-1">{c.label}</p>
              <div className="border border-gray-200 rounded-ui-sm divide-y divide-gray-100">
                {c.items.map(d => (
                  <div key={d.id} className={`flex items-center gap-2 px-3 py-2 ${d.is_active ? '' : 'opacity-60'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-ui text-gray-900 truncate">{d.title}</p>
                      <p className="text-ui-sm text-gray-500 truncate">{d.file_name}</p>
                    </div>
                    <button onClick={() => download(d)} className="p-1.5 text-gray-500 hover:text-gray-900" aria-label="Télécharger" title="Télécharger">
                      <Download className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleActive(d)} className="p-1.5 text-gray-500 hover:text-gray-900"
                      aria-label={d.is_active ? 'Archiver' : 'Réactiver'} title={d.is_active ? 'Archiver' : 'Réactiver'}>
                      {d.is_active ? <Archive className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                    </button>
                    {!d.is_active && (
                      <button onClick={() => remove(d)} className="p-1.5 text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))]" aria-label="Supprimer" title="Supprimer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-ui-sm text-gray-600">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
        Afficher les documents archivés
      </label>

      <div className="border border-dashed border-gray-300 rounded-ui-sm p-3 space-y-2">
        <p className="text-ui font-medium text-gray-800">Ajouter un document</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titre, ex. Programme SST"
            className="px-3 py-2 border border-gray-300 rounded-ui-sm text-ui" />
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-ui-sm text-ui">
            {KIT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" className="text-ui flex-1 min-w-[200px]" />
          <button onClick={upload} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 text-ui font-medium bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 disabled:opacity-50">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Ajouter
          </button>
        </div>
      </div>
    </div>
  )
}
