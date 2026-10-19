import { orgName, appName } from '../../../core/org/currentOrg'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../../core/supabase'
import { 
  Plus, Edit2, Trash2, Save, Download, FileText,
  ZoomIn, ZoomOut, Link2, X, Loader2, Printer, Image,
  Maximize, Move, GripVertical
} from 'lucide-react'
import toast from 'react-hot-toast'

import { confirmer } from '../../../ui/Confirm'
// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const SHAPE_TYPES = {
  start: { label: 'Début', color: '#22C55E' },
  end: { label: 'Fin', color: '#EF4444' },
  action: { label: 'Action', color: '#3B82F6' },
  decision: { label: 'Décision', color: '#F59E0B' },
  document: { label: 'Document', color: '#8B5CF6' },
  subprocess: { label: 'Sous-process', color: '#06B6D4' },
}

const SHAPE_WIDTH = 160
const SHAPE_HEIGHT = 60
const DECISION_SIZE = 80

// ═══════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export default function ProcessEditor() {
  const [processes, setProcesses] = useState([])
  const [selectedProcess, setSelectedProcess] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [steps, setSteps] = useState([])
  const [connections, setConnections] = useState([])
  const [selectedStep, setSelectedStep] = useState(null)
  const [editingStep, setEditingStep] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectFrom, setConnectFrom] = useState(null)
  
  const [zoom, setZoom] = useState(0.6)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  
  const [responsibles, setResponsibles] = useState([])
  const [allProcesses, setAllProcesses] = useState([])
  
  const [showNewProcessModal, setShowNewProcessModal] = useState(false)
  const [newProcessForm, setNewProcessForm] = useState({ title: '', description: '' })
  
  const [dragging, setDragging] = useState(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  const canvasRef = useRef(null)

  // ═══════════════════════════════════════════════════════════════════
  // CHARGEMENT
  // ═══════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    fetchData()
  }, [])
  
  const fetchData = async () => {
    setLoading(true)
    try {
      const { data: processesData } = await supabase
        .from('processes')
        .select('*')
        .order('code')
      
      setProcesses(processesData || [])
      setAllProcesses(processesData || [])
      
      const { data: responsiblesData } = await supabase
        .from('process_responsibles')
        .select('*')
        .order('name')
      
      // Dédupliquer côté client si besoin
      const uniqueResponsibles = []
      const seen = new Set()
      for (const r of (responsiblesData || [])) {
        if (!seen.has(r.name)) {
          seen.add(r.name)
          uniqueResponsibles.push(r)
        }
      }
      setResponsibles(uniqueResponsibles)
      
    } catch (err) {
      console.error('Erreur:', err)
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }
  
  const loadProcess = async (process) => {
    setSelectedProcess(process)
    setSelectedStep(null)
    setEditingStep(null)
    
    const { data: stepsData } = await supabase
      .from('process_steps')
      .select('*')
      .eq('process_id', process.id)
    setSteps(stepsData || [])
    
    const { data: connectionsData } = await supabase
      .from('process_connections')
      .select('*')
      .eq('process_id', process.id)
    setConnections(connectionsData || [])
    
    // Auto-recentrer après chargement
    setTimeout(() => handleRecenter(stepsData || []), 100)
  }

  // ═══════════════════════════════════════════════════════════════════
  // RECENTRER LA VUE
  // ═══════════════════════════════════════════════════════════════════
  
  const handleRecenter = (stepsToUse = steps) => {
    if (!stepsToUse || stepsToUse.length === 0) {
      setZoom(0.8)
      setPan({ x: 50, y: 50 })
      return
    }
    
    const minX = Math.min(...stepsToUse.map(s => s.position_x)) - 50
    const maxX = Math.max(...stepsToUse.map(s => s.position_x + SHAPE_WIDTH)) + 50
    const minY = Math.min(...stepsToUse.map(s => s.position_y)) - 50
    const maxY = Math.max(...stepsToUse.map(s => s.position_y + 120)) + 50
    
    const contentWidth = maxX - minX
    const contentHeight = maxY - minY
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const canvasWidth = canvas.clientWidth
    const canvasHeight = canvas.clientHeight
    
    // Zoom pour tout voir
    const zoomX = canvasWidth / contentWidth
    const zoomY = canvasHeight / contentHeight
    const finalZoom = Math.max(0.15, Math.min(0.8, Math.min(zoomX, zoomY) * 0.85))
    
    // Pan pour positionner le contenu en haut à gauche avec marge
    setZoom(finalZoom)
    setPan({
      x: -minX * finalZoom + 20,
      y: -minY * finalZoom + 20
    })
  }

  // ═══════════════════════════════════════════════════════════════════
  // GESTION PROCESS
  // ═══════════════════════════════════════════════════════════════════
  
  const generateProcessCode = () => {
    const maxCode = processes.reduce((max, p) => {
      const num = parseInt(p.code?.replace('PR-', '') || '0')
      return num > max ? num : max
    }, 0)
    return `PR-${String(maxCode + 1).padStart(3, '0')}`
  }
  
  const handleCreateProcess = async () => {
    if (!newProcessForm.title.trim()) {
      toast.error('Le titre est requis')
      return
    }
    
    const code = generateProcessCode()
    const { data, error } = await supabase
      .from('processes')
      .insert({
        code,
        title: newProcessForm.title,
        description: newProcessForm.description,
        version: 1,
        status: 'active',
      })
      .select()
      .single()
    
    if (error) {
      toast.error('Erreur lors de la création')
      return
    }
    
    toast.success(`Process ${code} créé`)
    setShowNewProcessModal(false)
    setNewProcessForm({ title: '', description: '' })
    await fetchData()
    loadProcess(data)
  }

  // ═══════════════════════════════════════════════════════════════════
  // GESTION ÉTAPES
  // ═══════════════════════════════════════════════════════════════════
  
  const handleAddStep = async (type) => {
    if (!selectedProcess) {
      toast.error('Sélectionnez d\'abord un process')
      return
    }
    
    // Position pour nouvelle étape
    const newX = 300 + (steps.length % 3) * 200
    const newY = 100 + Math.floor(steps.length / 3) * 100
    
    const { data, error } = await supabase
      .from('process_steps')
      .insert({
        process_id: selectedProcess.id,
        type,
        title: SHAPE_TYPES[type].label,
        description: '',
        position_x: centerX - SHAPE_WIDTH / 2,
        position_y: centerY - SHAPE_HEIGHT / 2,
      })
      .select()
      .single()
    
    if (error) {
      toast.error('Erreur lors de l\'ajout')
      return
    }
    
    setSteps([...steps, data])
    setSelectedStep(data)
    setEditingStep(data)
    toast.success('Étape ajoutée - double-cliquez pour éditer')
  }
  
  const handleUpdateStep = async (stepId, updates) => {
    const { error } = await supabase
      .from('process_steps')
      .update(updates)
      .eq('id', stepId)
    
    if (error) {
      toast.error('Erreur')
      return
    }
    
    setSteps(steps.map(s => s.id === stepId ? { ...s, ...updates } : s))
    if (editingStep?.id === stepId) {
      setEditingStep({ ...editingStep, ...updates })
    }
  }
  
  const handleDeleteStep = async (stepId) => {
    if (!await confirmer('Supprimer cette étape ?')) return
    
    await supabase
      .from('process_connections')
      .delete()
      .or(`from_step_id.eq.${stepId},to_step_id.eq.${stepId}`)
    
    await supabase
      .from('process_steps')
      .delete()
      .eq('id', stepId)
    
    setSteps(steps.filter(s => s.id !== stepId))
    setConnections(connections.filter(c => c.from_step_id !== stepId && c.to_step_id !== stepId))
    setSelectedStep(null)
    setEditingStep(null)
    toast.success('Étape supprimée')
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONNEXIONS
  // ═══════════════════════════════════════════════════════════════════
  
  const startConnection = () => {
    if (!selectedStep) {
      toast.error('Sélectionnez d\'abord une étape')
      return
    }
    setIsConnecting(true)
    setConnectFrom(selectedStep.id)
    toast('Cliquez sur l\'étape de destination', { icon: '' })
  }
  
  const handleAddConnection = async (fromId, toId) => {
    if (fromId === toId) {
      setIsConnecting(false)
      setConnectFrom(null)
      return
    }
    
    if (connections.some(c => c.from_step_id === fromId && c.to_step_id === toId)) {
      toast.error('Connexion existante')
      setIsConnecting(false)
      setConnectFrom(null)
      return
    }
    
    const fromStep = steps.find(s => s.id === fromId)
    let label = ''
    if (fromStep?.type === 'decision') {
      label = prompt('Label (Oui/Non) :') || ''
    }
    
    const { data, error } = await supabase
      .from('process_connections')
      .insert({
        process_id: selectedProcess.id,
        from_step_id: fromId,
        to_step_id: toId,
        label,
      })
      .select()
      .single()
    
    if (!error) {
      setConnections([...connections, data])
      toast.success('Connexion créée')
    }
    
    setIsConnecting(false)
    setConnectFrom(null)
  }
  
  const handleDeleteConnection = async (connId) => {
    await supabase.from('process_connections').delete().eq('id', connId)
    setConnections(connections.filter(c => c.id !== connId))
  }

  // ═══════════════════════════════════════════════════════════════════
  // DRAG & DROP
  // ═══════════════════════════════════════════════════════════════════
  
  const handleStepMouseDown = (e, step) => {
    e.stopPropagation()
    
    if (isConnecting && connectFrom) {
      handleAddConnection(connectFrom, step.id)
      return
    }
    
    setSelectedStep(step)
    setDragging(step.id)
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      stepX: step.position_x,
      stepY: step.position_y
    })
  }
  
  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      
      setSteps(prev => prev.map(s => 
        s.id === dragging 
          ? { ...s, position_x: Math.max(0, dragStart.stepX + dx), position_y: Math.max(0, dragStart.stepY + dy) }
          : s
      ))
    }
  }, [dragging, dragStart])
  
  const handleMouseUp = useCallback(async () => {
    if (dragging) {
      const step = steps.find(s => s.id === dragging)
      if (step) {
        await supabase
          .from('process_steps')
          .update({ position_x: step.position_x, position_y: step.position_y })
          .eq('id', dragging)
      }
      setDragging(null)
    }
  }, [dragging, steps])
  
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // ═══════════════════════════════════════════════════════════════════
  // SAUVEGARDE
  // ═══════════════════════════════════════════════════════════════════
  
  const handleSaveVersion = async () => {
    if (!selectedProcess) return
    
    setSaving(true)
    try {
      const snapshot = { process: selectedProcess, steps, connections }
      
      await supabase
        .from('process_versions')
        .insert({
          process_id: selectedProcess.id,
          version: selectedProcess.version,
          data: snapshot,
        })
      
      const newVersion = selectedProcess.version + 1
      await supabase
        .from('processes')
        .update({ version: newVersion, updated_at: new Date().toISOString() })
        .eq('id', selectedProcess.id)
      
      setSelectedProcess({ ...selectedProcess, version: newVersion })
      toast.success(`Version ${newVersion} sauvegardée`)
      
    } catch (err) {
      toast.error('Erreur')
    } finally {
      setSaving(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════════════
  
  const handleExportPNG = async () => {
    if (!selectedProcess || steps.length === 0) {
      toast.error('Aucun process à exporter')
      return
    }
    
    toast.loading('Génération...')
    
    try {
      const minX = Math.min(...steps.map(s => s.position_x)) - 30
      const minY = Math.min(...steps.map(s => s.position_y)) - 30
      const maxX = Math.max(...steps.map(s => s.position_x + SHAPE_WIDTH)) + 30
      const maxY = Math.max(...steps.map(s => s.position_y + SHAPE_HEIGHT + 20)) + 30
      
      const width = maxX - minX + 200
      const height = maxY - minY + 120
      
      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(scale, scale)
      
      // Header
      ctx.fillStyle = '#1F2937'
      ctx.font = 'bold 20px Arial'
      ctx.fillText(`${selectedProcess.code}-V${selectedProcess.version} : ${selectedProcess.title}`, 20, 30)
      ctx.font = '11px Arial'
      ctx.fillStyle = '#6B7280'
      ctx.fillText(`Généré le ${new Date().toLocaleDateString('fr-FR')} - ${orgName()}`, 20, 48)
      
      const offsetX = -minX + 20
      const offsetY = -minY + 70
      
      // Connexions
      ctx.strokeStyle = '#6B7280'
      ctx.lineWidth = 2
      connections.forEach(conn => {
        const from = steps.find(s => s.id === conn.from_step_id)
        const to = steps.find(s => s.id === conn.to_step_id)
        if (!from || !to) return
        
        const fromH = from.type === 'decision' ? DECISION_SIZE : SHAPE_HEIGHT
        const fromX = from.position_x + offsetX + SHAPE_WIDTH / 2
        const fromY = from.position_y + offsetY + fromH
        const toX = to.position_x + offsetX + SHAPE_WIDTH / 2
        const toY = to.position_y + offsetY
        
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        
        // Ligne avec coude si nécessaire
        if (Math.abs(fromX - toX) > 50) {
          const midY = fromY + 20
          ctx.lineTo(fromX, midY)
          ctx.lineTo(toX, midY)
          ctx.lineTo(toX, toY)
        } else {
          ctx.lineTo(toX, toY)
        }
        ctx.stroke()
        
        // Flèche
        const angle = Math.atan2(toY - (fromY + 20), toX - toX) || Math.PI / 2
        ctx.beginPath()
        ctx.moveTo(toX, toY)
        ctx.lineTo(toX - 8, toY - 8)
        ctx.lineTo(toX + 8, toY - 8)
        ctx.closePath()
        ctx.fillStyle = '#6B7280'
        ctx.fill()
        
        if (conn.label) {
          ctx.fillStyle = '#1F2937'
          ctx.font = 'bold 10px Arial'
          ctx.fillText(conn.label, (fromX + toX) / 2 + 5, (fromY + toY) / 2)
        }
      })
      
      // Étapes
      steps.forEach(step => {
        const x = step.position_x + offsetX
        const y = step.position_y + offsetY
        const h = step.type === 'decision' ? DECISION_SIZE : SHAPE_HEIGHT
        const color = SHAPE_TYPES[step.type]?.color || '#3B82F6'
        
        ctx.fillStyle = color
        ctx.strokeStyle = '#374151'
        ctx.lineWidth = 1.5
        
        if (step.type === 'start' || step.type === 'end') {
          ctx.beginPath()
          ctx.ellipse(x + SHAPE_WIDTH / 2, y + h / 2, SHAPE_WIDTH / 2 - 5, h / 2 - 5, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        } else if (step.type === 'decision') {
          ctx.beginPath()
          ctx.moveTo(x + SHAPE_WIDTH / 2, y)
          ctx.lineTo(x + SHAPE_WIDTH - 10, y + h / 2)
          ctx.lineTo(x + SHAPE_WIDTH / 2, y + h)
          ctx.lineTo(x + 10, y + h / 2)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        } else if (step.type === 'subprocess') {
          ctx.beginPath()
          ctx.roundRect(x, y, SHAPE_WIDTH, h, 12)
          ctx.fill()
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.rect(x, y, SHAPE_WIDTH, h)
          ctx.fill()
          ctx.stroke()
        }
        
        // Texte
        ctx.fillStyle = 'white'
        ctx.font = 'bold 11px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        
        const title = step.title || ''
        const maxWidth = SHAPE_WIDTH - 16
        if (ctx.measureText(title).width > maxWidth) {
          // 2 lignes
          const words = title.split(' ')
          let line1 = ''
          let line2 = ''
          for (const word of words) {
            if (ctx.measureText(line1 + ' ' + word).width < maxWidth) {
              line1 += (line1 ? ' ' : '') + word
            } else {
              line2 += (line2 ? ' ' : '') + word
            }
          }
          ctx.fillText(line1, x + SHAPE_WIDTH / 2, y + h / 2 - 7)
          ctx.fillText(line2.substring(0, 20), x + SHAPE_WIDTH / 2, y + h / 2 + 7)
        } else {
          ctx.fillText(title, x + SHAPE_WIDTH / 2, y + h / 2)
        }
      })
      
      ctx.textAlign = 'left'
      
      // Légende
      const legendX = width - 140
      let legendY = 70
      ctx.fillStyle = '#1F2937'
      ctx.font = 'bold 11px Arial'
      ctx.fillText('Légende', legendX, legendY)
      legendY += 18
      
      Object.entries(SHAPE_TYPES).forEach(([, { label, color }]) => {
        ctx.fillStyle = color
        ctx.fillRect(legendX, legendY - 8, 14, 12)
        ctx.fillStyle = '#374151'
        ctx.font = '10px Arial'
        ctx.fillText(label, legendX + 20, legendY)
        legendY += 16
      })
      
      const link = document.createElement('a')
      link.download = `${selectedProcess.code}-V${selectedProcess.version}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      
      toast.dismiss()
      toast.success('PNG exporté !')
      
    } catch (err) {
      console.error(err)
      toast.dismiss()
      toast.error('Erreur export')
    }
  }
  
  const handleExportDocument = () => {
    if (!selectedProcess || steps.length === 0) {
      toast.error('Aucun process')
      return
    }
    
    const sortedSteps = [...steps].sort((a, b) => {
      if (Math.abs(a.position_y - b.position_y) < 40) return a.position_x - b.position_x
      return a.position_y - b.position_y
    })
    
    let html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>${selectedProcess.code} - ${selectedProcess.title}</title>
  <style>
    @page { size: A4; margin: 1.5cm; }
    body { font-family: Arial, sans-serif; line-height: 1.5; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; font-size: 12px; }
    .header { border-bottom: 3px solid #3B82F6; padding-bottom: 15px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 5px 0; font-size: 22px; }
    .header .code { color: #3B82F6; font-size: 14px; }
    .header .meta { color: #666; font-size: 11px; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; font-weight: bold; font-size: 11px; }
    tr:nth-child(even) { background: #fafafa; }
    .type { display: inline-block; padding: 2px 6px; border-radius: 3px; color: white; font-size: 10px; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; color: #666; font-size: 10px; text-align: center; }
    h2 { font-size: 14px; color: #1F2937; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 25px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${selectedProcess.title}</h1>
    <div class="code">${selectedProcess.code} - Version ${selectedProcess.version}</div>
    <div class="meta">Généré le ${new Date().toLocaleDateString('fr-FR')} | ${orgName()}</div>
  </div>
  
  <h2>Description des étapes</h2>
  <table>
    <thead><tr><th>N°</th><th>Type</th><th>Étape</th><th>Description</th><th>Responsable</th><th>Délai</th><th>Outil</th></tr></thead>
    <tbody>`
    
    sortedSteps.forEach((step, i) => {
      const resp = responsibles.find(r => r.id === step.responsible_id)
      const type = SHAPE_TYPES[step.type]
      html += `<tr>
        <td>${i + 1}</td>
        <td><span class="type" style="background:${type?.color}">${type?.label}</span></td>
        <td><strong>${step.title || '-'}</strong></td>
        <td>${step.description || '-'}</td>
        <td>${resp?.name || '-'}</td>
        <td>${step.delay || '-'}</td>
        <td>${step.tool || '-'}</td>
      </tr>`
    })
    
    html += `</tbody></table>
  
  <h2>Flux (connexions)</h2>
  <table>
    <thead><tr><th>De</th><th>Vers</th><th>Condition</th></tr></thead>
    <tbody>`
    
    connections.forEach(c => {
      const from = steps.find(s => s.id === c.from_step_id)
      const to = steps.find(s => s.id === c.to_step_id)
      html += `<tr><td>${from?.title || '-'}</td><td>${to?.title || '-'}</td><td>${c.label || '-'}</td></tr>`
    })
    
    html += `</tbody></table>
  <div class="footer">Document généré par ${appName()} | ${selectedProcess.code}-V${selectedProcess.version}</div>
</body></html>`
    
    const blob = new Blob([html], { type: 'text/html' })
    const link = document.createElement('a')
    link.download = `${selectedProcess.code}-V${selectedProcess.version}.html`
    link.href = URL.createObjectURL(blob)
    link.click()
    
    toast.success('Document exporté - ouvrez-le et faites Ctrl+P pour imprimer en PDF')
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDU SVG
  // ═══════════════════════════════════════════════════════════════════
  
  const renderShape = (step) => {
    const { type, position_x: x, position_y: y, title } = step
    const isSelected = selectedStep?.id === step.id
    const isConnectSource = connectFrom === step.id
    const h = type === 'decision' ? DECISION_SIZE : SHAPE_HEIGHT
    const color = SHAPE_TYPES[type]?.color || '#3B82F6'
    
    let shape
    switch (type) {
      case 'start':
      case 'end':
        shape = <ellipse cx={x + SHAPE_WIDTH / 2} cy={y + h / 2} rx={SHAPE_WIDTH / 2 - 3} ry={h / 2 - 3} fill={color} stroke={isSelected ? '#000' : '#374151'} strokeWidth={isSelected ? 3 : 1.5} />
        break
      case 'decision':
        shape = <polygon points={`${x + SHAPE_WIDTH / 2},${y} ${x + SHAPE_WIDTH - 8},${y + h / 2} ${x + SHAPE_WIDTH / 2},${y + h} ${x + 8},${y + h / 2}`} fill={color} stroke={isSelected ? '#000' : '#374151'} strokeWidth={isSelected ? 3 : 1.5} />
        break
      case 'subprocess':
        shape = <rect x={x} y={y} width={SHAPE_WIDTH} height={h} rx={10} fill={color} stroke={isSelected ? '#000' : '#374151'} strokeWidth={isSelected ? 3 : 1.5} />
        break
      default:
        shape = <rect x={x} y={y} width={SHAPE_WIDTH} height={h} fill={color} stroke={isSelected ? '#000' : '#374151'} strokeWidth={isSelected ? 3 : 1.5} />
    }
    
    // Texte sur 2 lignes si besoin
    let displayTitle = title || ''
    let line1 = displayTitle
    let line2 = ''
    if (displayTitle.length > 18) {
      const words = displayTitle.split(' ')
      line1 = ''
      for (const word of words) {
        if ((line1 + ' ' + word).length < 18) {
          line1 += (line1 ? ' ' : '') + word
        } else {
          line2 += (line2 ? ' ' : '') + word
        }
      }
      if (line2.length > 18) line2 = line2.substring(0, 16) + '...'
    }
    
    return (
      <g
        key={step.id}
        className={`cursor-move ${isConnectSource ? 'opacity-50' : ''}`}
        onMouseDown={(e) => handleStepMouseDown(e, step)}
        onDoubleClick={() => setEditingStep(step)}
      >
        {shape}
        {line2 ? (
          <>
            <text x={x + SHAPE_WIDTH / 2} y={y + h / 2 - 8} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="11" fontWeight="bold" style={{ pointerEvents: 'none' }}>{line1}</text>
            <text x={x + SHAPE_WIDTH / 2} y={y + h / 2 + 8} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="11" fontWeight="bold" style={{ pointerEvents: 'none' }}>{line2}</text>
          </>
        ) : (
          <text x={x + SHAPE_WIDTH / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="11" fontWeight="bold" style={{ pointerEvents: 'none' }}>{line1}</text>
        )}
        <title>{title}{step.description ? '\n' + step.description : ''}</title>
      </g>
    )
  }
  
  const renderConnection = (conn) => {
    const from = steps.find(s => s.id === conn.from_step_id)
    const to = steps.find(s => s.id === conn.to_step_id)
    if (!from || !to) return null
    
    const fromH = from.type === 'decision' ? DECISION_SIZE : SHAPE_HEIGHT
    const toH = to.type === 'decision' ? DECISION_SIZE : SHAPE_HEIGHT
    
    // Points de connexion
    let fromX = from.position_x + SHAPE_WIDTH / 2
    let fromY = from.position_y + fromH
    let toX = to.position_x + SHAPE_WIDTH / 2
    let toY = to.position_y
    
    // Ajuster pour les décisions (sortie latérale)
    if (from.type === 'decision' && conn.label) {
      if (conn.label.toLowerCase() === 'non') {
        fromX = from.position_x
        fromY = from.position_y + fromH / 2
      } else if (conn.label.toLowerCase() === 'oui') {
        fromX = from.position_x + SHAPE_WIDTH
        fromY = from.position_y + fromH / 2
      }
    }
    
    // Chemin avec coudes
    let path
    if (Math.abs(fromX - toX) < 20 && fromY < toY) {
      // Connexion directe verticale
      path = `M${fromX},${fromY} L${toX},${toY}`
    } else {
      // Connexion avec coudes
      const midY = fromY + 25
      path = `M${fromX},${fromY} L${fromX},${midY} L${toX},${midY} L${toX},${toY}`
    }
    
    return (
      <g key={conn.id}>
        <path d={path} fill="none" stroke="#6B7280" strokeWidth={2} markerEnd="url(#arrow)" className="cursor-pointer hover:stroke-[rgb(var(--c-danger))]" onClick={async () => { if (await confirmer('Supprimer ?')) handleDeleteConnection(conn.id) }} />
        {conn.label && (
          <text x={fromX + (conn.label.toLowerCase() === 'non' ? -15 : 15)} y={fromY + 15} fontSize="10" fontWeight="bold" fill="#374151" textAnchor={conn.label.toLowerCase() === 'non' ? 'end' : 'start'}>{conn.label}</text>
        )}
      </g>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDU
  // ═══════════════════════════════════════════════════════════════════
  
  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /><span className="ml-2">Chargement...</span></div>
  }
  
  return (
    <div className="h-full flex bg-white rounded-ui-sm overflow-hidden">
      {/* SIDEBAR */}
      <div className="w-52 bg-gray-50 border-r flex flex-col">
        <div className="p-3 border-b">
          <h3 className="font-bold text-ui mb-2">Process</h3>
          <button onClick={() => setShowNewProcessModal(true)} className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 text-ui-sm">
            <Plus className="w-3 h-3" /> Nouveau
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {processes.map(p => (
            <button key={p.id} onClick={() => loadProcess(p)} className={`w-full text-left p-2 rounded text-ui-sm transition ${selectedProcess?.id === p.id ? 'bg-primary-100 border border-primary-300' : 'hover:bg-gray-100'}`}>
              <div className="font-bold">{p.code}</div>
              <div className="text-gray-500 truncate">{p.title}</div>
              <span className={`text-ui-sm px-1 rounded ${p.status === 'active' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-200'}`}>V{p.version}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* MAIN */}
      <div className="flex-1 flex flex-col">
        {selectedProcess ? (
          <>
            {/* TOOLBAR */}
            <div className="bg-gray-50 border-b px-3 py-2 flex items-center justify-between">
              <div>
                <span className="font-bold">{selectedProcess.code}-V{selectedProcess.version}</span>
                <span className="text-gray-500 text-ui ml-2">{selectedProcess.title}</span>
              </div>
              
              <div className="flex items-center gap-1">
                <button onClick={handleSaveVersion} disabled={saving} className="flex items-center gap-1 btn btn-secondary text-ui-sm hover:bg-[rgb(var(--c-success))] disabled:opacity-50">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Sauver
                </button>
                
                <button onClick={handleExportPNG} className="flex items-center gap-1 btn btn-secondary text-ui-sm hover:bg-[rgb(var(--c-info))]">
                  <Image className="w-3 h-3" /> PNG
                </button>
                
                <button onClick={handleExportDocument} className="flex items-center gap-1 px-2 py-1 bg-gray-700 text-white rounded text-ui-sm hover:bg-gray-700">
                  <Printer className="w-3 h-3" /> Doc
                </button>
              </div>
            </div>
            
            <div className="flex-1 flex overflow-hidden">
              {/* PALETTE */}
              <div className="w-36 bg-gray-50 border-r p-2 overflow-y-auto text-ui-sm">
                <p className="font-bold text-gray-500 uppercase text-ui-sm mb-1">Formes</p>
                <div className="space-y-1 mb-3">
                  {Object.entries(SHAPE_TYPES).map(([type, { label, color }]) => (
                    <button key={type} onClick={() => handleAddStep(type)} className="w-full flex items-center gap-2 p-1.5 bg-white rounded border hover:border-primary-500 hover:shadow-sm">
                      <div className={`w-4 h-3 ${type === 'start' || type === 'end' ? 'rounded-full' : type === 'subprocess' ? 'rounded' : ''}`} style={{ backgroundColor: color }} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                
                <p className="font-bold text-gray-500 uppercase text-ui-sm mb-1">Actions</p>
                <button onClick={startConnection} disabled={!selectedStep} className={`w-full flex items-center gap-1 p-1.5 rounded border mb-1 ${isConnecting ? 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)]' : 'bg-white hover:border-primary-500'} disabled:opacity-40`}>
                  <Link2 className="w-3 h-3" /> {isConnecting ? 'Cliquez cible' : 'Connecter'}
                </button>
                
                {selectedStep && (
                  <>
                    <button onClick={() => setEditingStep(selectedStep)} className="w-full flex items-center gap-1 p-1.5 bg-white rounded border hover:border-[rgb(var(--c-info)/0.3)] text-[rgb(var(--c-info))] mb-1">
                      <Edit2 className="w-3 h-3" /> Modifier
                    </button>
                    <button onClick={() => handleDeleteStep(selectedStep.id)} className="w-full flex items-center gap-1 p-1.5 bg-white rounded border hover:border-[rgb(var(--c-danger)/0.3)] text-[rgb(var(--c-danger))]">
                      <Trash2 className="w-3 h-3" /> Supprimer
                    </button>
                  </>
                )}
              </div>
              
              {/* CANVAS */}
              <div ref={canvasRef} className="flex-1 overflow-auto bg-gray-100 relative" onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedStep(null)
                  if (isConnecting) { setIsConnecting(false); setConnectFrom(null) }
                }
              }}>
                <svg 
                  width={Math.max(1200, steps.length > 0 ? Math.max(...steps.map(s => s.position_x)) + 300 : 1200)} 
                  height={Math.max(800, steps.length > 0 ? Math.max(...steps.map(s => s.position_y)) + 200 : 800)}
                  style={{ minWidth: '100%', minHeight: '100%' }}
                >
                  <defs>
                    <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="#6B7280" /></marker>
                    <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" strokeWidth="0.5" /></pattern>
                  </defs>
                  <rect className="grid-bg" width="100%" height="100%" fill="url(#smallGrid)" />
                  {connections.map(renderConnection)}
                  {steps.map(renderShape)}
                </svg>
                
                {steps.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
                    <div className="text-center">
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                      <p className="text-ui">Ajoutez des étapes depuis la palette</p>
                    </div>
                  </div>
                )}
              </div>
              
              {/* EDIT PANEL */}
              {editingStep && (
                <div className="w-64 bg-white border-l p-3 overflow-y-auto text-ui">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold">Modifier</h3>
                    <button onClick={() => setEditingStep(null)} className="p-1 hover:bg-gray-100 rounded"><X className="w-4 h-4" /></button>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="block text-ui-sm font-medium text-gray-600 mb-1">Titre</label>
                      <input type="text" value={editingStep.title || ''} onChange={(e) => { setEditingStep({ ...editingStep, title: e.target.value }); handleUpdateStep(editingStep.id, { title: e.target.value }) }} className="w-full px-2 py-1.5 border rounded text-ui focus:ring-1 focus:ring-primary-500" />
                    </div>
                    
                    <div>
                      <label className="block text-ui-sm font-medium text-gray-600 mb-1">Description</label>
                      <textarea value={editingStep.description || ''} onChange={(e) => { setEditingStep({ ...editingStep, description: e.target.value }); handleUpdateStep(editingStep.id, { description: e.target.value }) }} rows={2} className="w-full px-2 py-1.5 border rounded text-ui focus:ring-1 focus:ring-primary-500" />
                    </div>
                    
                    <div>
                      <label className="block text-ui-sm font-medium text-gray-600 mb-1">Responsable</label>
                      <select value={editingStep.responsible_id || ''} onChange={(e) => { setEditingStep({ ...editingStep, responsible_id: e.target.value || null }); handleUpdateStep(editingStep.id, { responsible_id: e.target.value || null }) }} className="w-full px-2 py-1.5 border rounded text-ui focus:ring-1 focus:ring-primary-500">
                        <option value="">--</option>
                        {responsibles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-ui-sm font-medium text-gray-600 mb-1">Délai</label>
                      <input type="text" placeholder="J+1, 48h..." value={editingStep.delay || ''} onChange={(e) => { setEditingStep({ ...editingStep, delay: e.target.value }); handleUpdateStep(editingStep.id, { delay: e.target.value }) }} className="w-full px-2 py-1.5 border rounded text-ui focus:ring-1 focus:ring-primary-500" />
                    </div>
                    
                    <div>
                      <label className="block text-ui-sm font-medium text-gray-600 mb-1">Outil</label>
                      <input type="text" placeholder="Logiciel, tableur..." value={editingStep.tool || ''} onChange={(e) => { setEditingStep({ ...editingStep, tool: e.target.value }); handleUpdateStep(editingStep.id, { tool: e.target.value }) }} className="w-full px-2 py-1.5 border rounded text-ui focus:ring-1 focus:ring-primary-500" />
                    </div>
                    
                    {editingStep.type === 'subprocess' && (
                      <div>
                        <label className="block text-ui-sm font-medium text-gray-600 mb-1">Process lié</label>
                        <select value={editingStep.linked_process_id || ''} onChange={(e) => { setEditingStep({ ...editingStep, linked_process_id: e.target.value || null }); handleUpdateStep(editingStep.id, { linked_process_id: e.target.value || null }) }} className="w-full px-2 py-1.5 border rounded text-ui focus:ring-1 focus:ring-primary-500">
                          <option value="">--</option>
                          {allProcesses.filter(p => p.id !== selectedProcess?.id).map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>Sélectionnez un process</p>
            </div>
          </div>
        )}
      </div>
      
      {/* MODAL NEW PROCESS */}
      {showNewProcessModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-ui-sm p-5 w-full max-w-sm shadow-md">
            <h3 className="text-lg font-bold mb-4">Nouveau Process</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-ui font-medium mb-1">Code</label>
                <input type="text" value={generateProcessCode()} disabled className="w-full px-3 py-2 bg-gray-100 border rounded" />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Titre *</label>
                <input type="text" value={newProcessForm.title} onChange={(e) => setNewProcessForm({ ...newProcessForm, title: e.target.value })} className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500" placeholder="Process formation..." />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Description</label>
                <textarea value={newProcessForm.description} onChange={(e) => setNewProcessForm({ ...newProcessForm, description: e.target.value })} className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-primary-500" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNewProcessModal(false)} className="px-4 py-2 border rounded hover:bg-gray-50">Annuler</button>
              <button onClick={handleCreateProcess} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700">Créer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
