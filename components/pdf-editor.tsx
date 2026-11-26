'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Download, FileText, ImagePlus, LoaderCircle, Redo2, Trash2, Undo2, Upload, X } from 'lucide-react'

type FontFamily = 'Helvetica' | 'TimesRoman' | 'Courier'
type Mark = { id: string; page: number; kind: 'text' | 'highlight' | 'rectangle' | 'line' | 'signature' | 'image'; x: number; y: number; w: number; h: number; text: string; color: string; fillColor: string; fontFamily: FontFamily; size: number; opacity: number; weight: number; fill: boolean; textBackground: boolean; bold: boolean; italic: boolean; rotation: number; watermark?: boolean; src?: string }
type EditorTool = Mark['kind'] | 'eraser' | 'select' | 'watermark'
type PageImage = { page: number; src: string; width: number; height: number; rotation: number }
type EditorState = { marks: Mark[]; selected: string | null }

const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_PAGES = 200
const colors = ['#087e64', '#172b3c', '#c24c3c', '#275fc3', '#e9bd37']

export function PdfEditor() {
  const inputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [imageSource, setImageSource] = useState('')
  const [imageAspect, setImageAspect] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState<PageImage[]>([])
  const [viewerSrc, setViewerSrc] = useState('')
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState<EditorTool>('text')
  const [text, setText] = useState('')
  const [watermarkType, setWatermarkType] = useState<'text' | 'image'>('text')
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL')
  const [watermarkRotation, setWatermarkRotation] = useState(-35)
  const [color, setColor] = useState(colors[0])
  const [fontSize, setFontSize] = useState(18)
  const [weight, setWeight] = useState(2)
  const [fill, setFill] = useState(true)
  const [fillColor, setFillColor] = useState('#ffffff')
  const [fontFamily, setFontFamily] = useState<FontFamily>('Helvetica')
  const [signatureFontFamily, setSignatureFontFamily] = useState<FontFamily>('TimesRoman')
  const [textBackground, setTextBackground] = useState(false)
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [state, setState] = useState<EditorState>({ marks: [], selected: null })
  const [history, setHistory] = useState<EditorState[]>([])
  const [future, setFuture] = useState<EditorState[]>([])
  const pageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; x: number; y: number; mark: Mark; base: EditorState; mode: 'move' | 'resize'; handle?: string } | null>(null)
  const currentPage = pages[page - 1]
  const hasMarkup = state.marks.length > 0

  const update = (next: EditorState) => {
    setHistory(items => [...items.slice(-39), state])
    setFuture([])
    setState(next)
  }

  useEffect(() => {
    setViewerSrc('')
    if (!file) return
    let active = true
    let loadingTask: { destroy: () => Promise<void> } | undefined
    const renderCurrentPage = async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
        const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
        loadingTask = task
        const pdf = await task.promise
        const sourcePage = await pdf.getPage(page)
        const baseViewport = sourcePage.getViewport({ scale: 1 })
        const scaleLimit = Math.sqrt(12_000_000 / (baseViewport.width * baseViewport.height))
        const renderScale = Math.min(2, window.devicePixelRatio || 1, scaleLimit)
        const viewport = sourcePage.getViewport({ scale: renderScale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Your browser could not render the selected PDF page.')
        await sourcePage.render({ canvas, canvasContext: context, viewport }).promise
        if (active) setViewerSrc(canvas.toDataURL('image/png'))
        sourcePage.cleanup()
        canvas.width = 0
        canvas.height = 0
        await task.destroy()
        if (loadingTask === task) loadingTask = undefined
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The selected PDF page could not be rendered.')
      }
    }
    void renderCurrentPage()
    return () => { active = false; if (loadingTask) void loadingTask.destroy() }
  }, [file, page])

  const loadFile = async (nextFile: File) => {
    setError('')
    if (nextFile.type !== 'application/pdf' && !nextFile.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF document.'); return }
    if (nextFile.size > MAX_FILE_SIZE) { setError('This PDF is larger than the 50 MB browser-processing limit.'); return }
    setBusy(true)
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
      const loading = pdfjs.getDocument({ data: new Uint8Array(await nextFile.arrayBuffer()) })
      const pdf = await loading.promise
      if (pdf.numPages > MAX_PAGES) { await loading.destroy(); throw new Error(`This editor supports PDFs with up to ${MAX_PAGES} pages.`) }
      const rendered: PageImage[] = []
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const sourcePage = await pdf.getPage(index)
        const viewport = sourcePage.getViewport({ scale: 0.32 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Your browser could not render the PDF preview.')
        await sourcePage.render({ canvas, canvasContext: context, viewport }).promise
        rendered.push({ page: index, src: canvas.toDataURL('image/jpeg', 0.72), width: sourcePage.getViewport({ scale: 1 }).width, height: sourcePage.getViewport({ scale: 1 }).height, rotation: sourcePage.rotate })
        sourcePage.cleanup()
        canvas.width = 0
        canvas.height = 0
      }
      await loading.destroy()
      setFile(nextFile)
      setPages(rendered)
      setPage(1)
      setState({ marks: [], selected: null })
      setHistory([])
      setFuture([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The PDF could not be opened. It may be damaged, encrypted, or unsupported.')
    } finally { setBusy(false) }
  }

  const clear = () => { setFile(null); setPages([]); setPage(1); setState({ marks: [], selected: null }); setHistory([]); setFuture([]); setError(''); setImageSource(''); if (inputRef.current) inputRef.current.value = '' }

  const loadImage = async (imageFile: File) => {
    setError('')
    if (imageFile.size > 12 * 1024 * 1024 || !/\.(jpe?g|png|webp)$/i.test(imageFile.name)) { setError('Choose a JPG, PNG, or WebP image up to 12 MB.'); return }
    try {
      const bitmap = await createImageBitmap(imageFile)
      if (bitmap.width * bitmap.height > 16_000_000) { bitmap.close(); setError('This image exceeds the 16-megapixel safety limit.'); return }
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) { bitmap.close(); throw new Error('Your browser could not prepare the image.') }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      setImageSource(canvas.toDataURL('image/png'))
      setImageAspect(canvas.height / canvas.width)
      setTool(current => current === 'watermark' ? 'watermark' : 'image')
      canvas.width = 0
      canvas.height = 0
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The image could not be decoded by this browser.') }
  }

  const addMark = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!currentPage || tool === 'eraser') return
    if (tool === 'select') { setState(current => ({ ...current, selected: null })); return }
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = (event.clientX - bounds.left) / bounds.width
    const pointerY = (event.clientY - bounds.top) / bounds.height
    if (tool === 'image' && !imageSource) { setError('Upload an image before placing it on the PDF page.'); return }
    const markKind = tool === 'watermark' ? watermarkType : tool
    const markWidth = markKind === 'text' || markKind === 'signature' ? 0.34 : markKind === 'image' ? 0.28 : 0.22
    const markHeight = markKind === 'image' ? Math.min(0.5, markWidth * imageAspect * currentPage.width / currentPage.height) : markKind === 'text' || markKind === 'signature' ? 0.06 : 0.08
    const x = Math.max(0, Math.min(1 - markWidth, pointerX))
    const y = Math.max(0, Math.min(1 - markHeight, pointerY))
    const isWatermark = tool === 'watermark'
    const mark: Mark = { id: crypto.randomUUID(), page, kind: markKind as Mark['kind'], x, y, w: markWidth, h: markHeight, text: isWatermark && watermarkType === 'text' ? watermarkText : tool === 'signature' ? (text || 'Your signature') : text, color, fillColor, fontFamily: tool === 'signature' ? signatureFontFamily : fontFamily, size: fontSize, opacity: tool === 'highlight' ? 0.32 : 1, weight, fill, textBackground, bold, italic, rotation: isWatermark ? watermarkRotation : 0, watermark: isWatermark, ...(markKind === 'image' ? { src: imageSource } : {}) }
    if ((markKind === 'text' || markKind === 'signature') && !mark.text.trim()) { setError('Enter text before placing it on the page.'); return }
    if (markKind === 'image' && !imageSource) { setError('Upload a watermark image before placing it on the page.'); return }
    update({ marks: [...state.marks, mark], selected: mark.id })
    setError('')
  }

  const patchMark = (id: string, patch: Partial<Mark>) => update({ marks: state.marks.map(mark => mark.id === id ? { ...mark, ...patch } : mark), selected: id })
  const applySelected = (patch: Partial<Mark>) => { if (state.selected) patchMark(state.selected, patch) }
  const selectedMark = state.marks.find(mark => mark.id === state.selected)
  const editingKind = selectedMark?.kind ?? (tool === 'watermark' ? watermarkType : tool)
  const startGesture = (event: React.PointerEvent<HTMLElement>, mark: Mark, mode: 'move' | 'resize', handle?: string) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: mark.id, x: event.clientX, y: event.clientY, mark, base: state, mode, handle }
    setState(current => ({ ...current, selected: mark.id }))
  }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const bounds = pageRef.current?.getBoundingClientRect()
    if (!drag || !bounds) return
    const dx = (event.clientX - drag.x) / bounds.width
    const dy = (event.clientY - drag.y) / bounds.height
    let { x, y, w, h } = drag.mark
    if (drag.mode === 'move') {
      x = Math.max(0, Math.min(1 - w, x + dx))
      y = Math.max(0, Math.min(1 - h, y + dy))
    } else {
      const handle = drag.handle || ''
      const preferredMinWidth = (drag.mark.kind === 'text' || drag.mark.kind === 'signature' ? 48 : 24) / bounds.width
      const minWidth = Math.min(drag.mark.w, Math.max(0.025, preferredMinWidth))
      const preferredMinHeight = (drag.mark.kind === 'text' || drag.mark.kind === 'signature' ? drag.mark.size * 2.3 : 24) / bounds.height
      const minHeight = Math.min(drag.mark.h, Math.max(0.02, preferredMinHeight))
      if (handle.includes('e')) w = Math.max(minWidth, Math.min(1 - x, drag.mark.w + dx))
      if (handle.includes('s')) h = Math.max(minHeight, Math.min(1 - y, drag.mark.h + dy))
      if (handle.includes('w')) {
        const right = drag.mark.x + drag.mark.w
        w = Math.max(minWidth, Math.min(right, drag.mark.w - dx))
        x = right - w
      }
      if (handle.includes('n')) {
        const bottom = drag.mark.y + drag.mark.h
        h = Math.max(minHeight, Math.min(bottom, drag.mark.h - dy))
        y = bottom - h
      }
    }
    setState(current => ({ ...current, marks: current.marks.map(mark => mark.id === drag.id ? { ...mark, x, y, w, h } : mark) }))
  }
  const endDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    setHistory(items => [...items.slice(-39), drag.base])
    setFuture([])
    dragRef.current = null
  }
  const removeSelected = () => { if (state.selected) update({ marks: state.marks.filter(mark => mark.id !== state.selected), selected: null }) }
  const duplicateSelected = () => {
    const selected = state.marks.find(mark => mark.id === state.selected)
    if (!selected) return
    const duplicate = { ...selected, id: crypto.randomUUID(), x: Math.min(1 - selected.w, selected.x + 0.025), y: Math.min(1 - selected.h, selected.y + 0.025) }
    update({ marks: [...state.marks, duplicate], selected: duplicate.id })
  }
  const clearCurrentPage = () => {
    if (!state.marks.some(mark => mark.page === page)) return
    if (window.confirm(`Remove all additions from page ${page}?`)) update({ marks: state.marks.filter(mark => mark.page !== page), selected: null })
  }
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture(items => [state, ...items]); setHistory(items => items.slice(0, -1)); setState(previous) }
  const redo = () => { const next = future[0]; if (!next) return; setHistory(items => [...items, state]); setFuture(items => items.slice(1)); setState(next) }

  const exportPdf = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib')
      const pdfDocument = await PDFDocument.load(await file.arrayBuffer())
      const fonts = {
        Helvetica: {
          regular: await pdfDocument.embedFont(StandardFonts.Helvetica),
          bold: await pdfDocument.embedFont(StandardFonts.HelveticaBold),
          italic: await pdfDocument.embedFont(StandardFonts.HelveticaOblique),
          boldItalic: await pdfDocument.embedFont(StandardFonts.HelveticaBoldOblique),
        },
        TimesRoman: {
          regular: await pdfDocument.embedFont(StandardFonts.TimesRoman),
          bold: await pdfDocument.embedFont(StandardFonts.TimesRomanBold),
          italic: await pdfDocument.embedFont(StandardFonts.TimesRomanItalic),
          boldItalic: await pdfDocument.embedFont(StandardFonts.TimesRomanBoldItalic),
        },
        Courier: {
          regular: await pdfDocument.embedFont(StandardFonts.Courier),
          bold: await pdfDocument.embedFont(StandardFonts.CourierBold),
          italic: await pdfDocument.embedFont(StandardFonts.CourierOblique),
          boldItalic: await pdfDocument.embedFont(StandardFonts.CourierBoldOblique),
        },
      }
      const pagesOut = pdfDocument.getPages()
      if (pagesOut.some(outputPage => Math.abs(outputPage.getRotation().angle % 360) > 0)) throw new Error('This PDF contains rotated pages. To keep annotation placement accurate, rotate the pages upright in a PDF tool and upload the corrected copy before adding edits.')
      for (const mark of state.marks) {
        const outputPage = pagesOut[mark.page - 1]
        const { width, height } = outputPage.getSize()
        const x = mark.x * width
        const y = height - mark.y * height
        const ink = rgb(parseInt(mark.color.slice(1, 3), 16) / 255, parseInt(mark.color.slice(3, 5), 16) / 255, parseInt(mark.color.slice(5, 7), 16) / 255)
        if (mark.kind === 'image') {
          if (!mark.src) throw new Error('An inserted image could not be found. Remove it and try adding it again.')
          const encoded = mark.src.split(',')[1]
          const imageBytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
          const image = await pdfDocument.embedPng(imageBytes)
          outputPage.drawImage(image, { x, y: y - mark.h * height, width: mark.w * width, height: mark.h * height, opacity: mark.opacity, rotate: degrees(mark.rotation) })
        } else if (mark.kind === 'text' || mark.kind === 'signature') {
          if (mark.textBackground) {
            const fillInk = rgb(parseInt(mark.fillColor.slice(1, 3), 16) / 255, parseInt(mark.fillColor.slice(3, 5), 16) / 255, parseInt(mark.fillColor.slice(5, 7), 16) / 255)
            outputPage.drawRectangle({ x, y: y - mark.size * 1.25, width: mark.w * width, height: mark.size * 1.5, color: fillInk, borderWidth: 0 })
          }
          const family = fonts[mark.fontFamily]
          const font = mark.bold && mark.italic ? family.boldItalic : mark.bold ? family.bold : mark.italic ? family.italic : family.regular
          outputPage.drawText(mark.text, { x, y: y - mark.size, size: mark.size, font, color: ink, maxWidth: mark.w * width, opacity: mark.opacity, rotate: degrees(mark.rotation) })
        } else if (mark.kind === 'highlight') {
          outputPage.drawRectangle({ x, y: y - mark.h * height, width: mark.w * width, height: mark.h * height, color: ink, opacity: mark.opacity, borderWidth: 0 })
        } else if (mark.kind === 'rectangle') {
          const fillInk = rgb(parseInt(mark.fillColor.slice(1, 3), 16) / 255, parseInt(mark.fillColor.slice(3, 5), 16) / 255, parseInt(mark.fillColor.slice(5, 7), 16) / 255)
          outputPage.drawRectangle({ x, y: y - mark.h * height, width: mark.w * width, height: mark.h * height, ...(mark.fill ? { color: fillInk } : {}), borderColor: ink, borderWidth: mark.weight, opacity: mark.opacity })
        } else {
          outputPage.drawLine({ start: { x, y }, end: { x: x + mark.w * width, y: y - mark.h * height }, thickness: mark.weight, color: ink, opacity: mark.opacity })
        }
      }
      const bytes = await pdfDocument.save({ useObjectStreams: true })
      const exported = await PDFDocument.load(bytes)
      if (exported.getPageCount() !== pagesOut.length) throw new Error('The exported PDF did not preserve its original page count.')
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${file.name.replace(/\.pdf$/i, '')}-edited.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The PDF could not be exported. The original document is unchanged.')
    } finally { setBusy(false) }
  }

  return <section className="pdf-editor" aria-label="PDF editor">
    <div className="pdf-editor-header"><div><span className="eyebrow">PRIVATE · BROWSER-BASED EDITOR</span><h2>Edit PDF Online</h2><p>Add text, signatures, shapes, images, or text and image watermarks to your PDF.</p></div>{file && <button type="button" className="pdf-editor-icon-button" onClick={clear} aria-label="Remove and replace PDF"><X/></button>}</div>
    {error && <p className="pdf-editor-error" role="alert">{error}</p>}
    {!file ? <div className="pdf-editor-upload"><input ref={inputRef} type="file" accept="application/pdf,.pdf" aria-label="Choose a PDF file" onChange={event => { const selected = event.target.files?.[0]; if (selected) void loadFile(selected) }}/> {busy ? <><LoaderCircle className="pdf-editor-spin"/><strong>Opening PDF locally…</strong></> : <><FileText size={32}/><strong>Choose a PDF to edit</strong><span>Up to 50 MB · max 200 pages · processed in this browser</span><button type="button" className="pdf-editor-primary" onClick={() => inputRef.current?.click()}><Upload size={16}/> Browse PDF</button></>}</div> : <>
      <div className="pdf-editor-file"><FileText size={18}/><span>{file.name}</span><small>{pages.length} {pages.length === 1 ? 'page' : 'pages'} · {(file.size / 1024 / 1024).toFixed(2)} MB</small></div>
      {pages.some(item => Math.abs(item.rotation % 360) > 0) && <p className="pdf-editor-error" role="alert">This PDF contains rotated pages. Annotation export is disabled until you rotate the pages upright and upload the corrected copy.</p>}
      <div className="pdf-editor-toolbar" role="toolbar" aria-label="PDF annotation tools">
        <label>Tool<select value={tool} onChange={event => setTool(event.target.value as EditorTool)}><option value="select">Select</option><option value="text">Text</option><option value="signature">Typed signature</option><option value="highlight">Highlight</option><option value="rectangle">Rectangle</option><option value="line">Line</option><option value="image">Image</option><option value="watermark">Watermark</option><option value="eraser">Eraser</option></select></label>
        {tool === 'watermark' && <fieldset className="pdf-editor-watermark-type"><legend>Watermark type</legend><label><input type="radio" name="pdf-editor-watermark-type" checked={watermarkType === 'text'} onChange={() => setWatermarkType('text')}/> Text</label><label><input type="radio" name="pdf-editor-watermark-type" checked={watermarkType === 'image'} onChange={() => setWatermarkType('image')}/> Image</label></fieldset>}
        <input ref={imageInputRef} className="pdf-editor-image-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="Upload an image for the PDF" onChange={event => { const chosen = event.currentTarget.files?.[0]; if (chosen) void loadImage(chosen); event.currentTarget.value = '' }}/>
        <button className="pdf-editor-icon-button" type="button" onClick={() => imageInputRef.current?.click()}><ImagePlus/> {tool === 'watermark' ? 'Upload watermark image' : 'Add image'}</button>
        {(editingKind === 'text' || editingKind === 'signature') && <label>Text<input value={selectedMark && (selectedMark.kind === 'text' || selectedMark.kind === 'signature') ? selectedMark.text : tool === 'watermark' ? watermarkText : text} onChange={event => { if (tool === 'watermark' && !selectedMark) setWatermarkText(event.target.value); else setText(event.target.value); applySelected({ text: event.target.value }) }} placeholder={editingKind === 'signature' ? 'Your name' : tool === 'watermark' ? 'CONFIDENTIAL' : 'Enter text'} aria-label="Text to add"/></label>}
        {(editingKind === 'text' || editingKind === 'signature') && <label>{editingKind === 'signature' ? 'Signature font' : 'Font family'}<select value={selectedMark?.fontFamily ?? (editingKind === 'signature' ? signatureFontFamily : fontFamily)} onChange={event => { const value = event.target.value as FontFamily; if (editingKind === 'signature') setSignatureFontFamily(value); else setFontFamily(value); applySelected({ fontFamily: value }) }}><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times New Roman</option><option value="Courier">Courier</option></select></label>}
        <label>Size<input type="number" min="8" max="72" value={selectedMark?.size ?? fontSize} onChange={event => { const size = Math.max(8, Math.min(72, Number(event.target.value) || 18)); setFontSize(size); applySelected({ size }) }} aria-label="Text size"/></label>
        {tool === 'watermark' && <label>Watermark rotation · {watermarkRotation}°<input type="range" min="-180" max="180" value={watermarkRotation} onChange={event => setWatermarkRotation(Number(event.target.value))} aria-label="Watermark rotation"/></label>}
        {selectedMark?.watermark && <label>Rotate watermark · {selectedMark.rotation}°<input type="range" min="-180" max="180" value={selectedMark.rotation} onChange={event => applySelected({ rotation: Number(event.target.value) })} aria-label="Rotate selected watermark"/></label>}
        {selectedMark && <label>Opacity<input type="range" min="0.05" max="1" step="0.05" value={selectedMark.opacity} onChange={event => applySelected({ opacity: Number(event.target.value) })} aria-label="Selected element opacity"/><span>{Math.round(selectedMark.opacity * 100)}%</span></label>}
        <fieldset className="pdf-editor-color-picker"><legend>Color</legend><div className="pdf-editor-swatches" style={{ display: 'flex', gap: 7, padding: '5px 0' }}>{colors.map((value, index) => <button key={value} type="button" aria-label={`Color ${index + 1}`} aria-pressed={(selectedMark?.color ?? color) === value} onClick={() => { setColor(value); applySelected({ color: value }) }} style={{ width: 24, height: 24, padding: 0, borderRadius: 99, border: '1px solid #dfe8e4', backgroundColor: value, outline: (selectedMark?.color ?? color) === value ? '2px solid #172b3c' : undefined }}/>)}</div><label className="pdf-editor-custom-color">Custom color<input type="color" value={selectedMark?.color ?? color} onChange={event => { setColor(event.target.value); applySelected({ color: event.target.value }) }} aria-label="Choose custom annotation color"/></label></fieldset>
        {(editingKind === 'rectangle' || editingKind === 'line') && <><label>Weight<input type="range" min="1" max="12" value={selectedMark?.weight ?? weight} onChange={event => { const value = Number(event.target.value); setWeight(value); applySelected({ weight: value }) }} aria-label="Line weight"/><span>{selectedMark?.weight ?? weight} pt</span></label>{editingKind === 'rectangle' && <><label>Fill<select value={(selectedMark?.fill ?? fill) ? 'fill' : 'none'} onChange={event => { const value = event.target.value === 'fill'; setFill(value); applySelected({ fill: value }) }}><option value="none">Transparent</option><option value="fill">Solid fill</option></select></label><label>Fill color<input type="color" value={selectedMark?.fillColor ?? fillColor} onChange={event => { setFillColor(event.target.value); applySelected({ fillColor: event.target.value }) }} aria-label="Choose shape fill color"/></label></>}</>}
        {(editingKind === 'text' || editingKind === 'signature') && <><label className="pdf-editor-check"><input type="checkbox" checked={selectedMark?.bold ?? bold} onChange={event => { setBold(event.target.checked); applySelected({ bold: event.target.checked }) }}/> Bold</label><label className="pdf-editor-check"><input type="checkbox" checked={selectedMark?.italic ?? italic} onChange={event => { setItalic(event.target.checked); applySelected({ italic: event.target.checked }) }}/> Italic</label><label>Text background<select value={(selectedMark?.textBackground ?? textBackground) ? 'solid' : 'transparent'} onChange={event => { const value = event.target.value === 'solid'; setTextBackground(value); applySelected({ textBackground: value }) }}><option value="transparent">Transparent</option><option value="solid">Solid color</option></select></label><label>Background color<input type="color" value={selectedMark?.fillColor ?? fillColor} onChange={event => { setFillColor(event.target.value); applySelected({ fillColor: event.target.value }) }} aria-label="Choose text background color"/></label></>}
        <div className="pdf-editor-actions"><button type="button" onClick={undo} disabled={!history.length} aria-label="Undo"><Undo2/></button><button type="button" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2/></button><button type="button" onClick={duplicateSelected} disabled={!state.selected} aria-label="Duplicate selected annotation"><Copy/></button><button type="button" onClick={removeSelected} disabled={!state.selected} aria-label="Delete selected annotation"><Trash2/></button><button type="button" onClick={clearCurrentPage} disabled={!state.marks.some(mark => mark.page === page)} aria-label="Clear additions on this page"><Trash2/></button></div>
      </div>
      <div className="pdf-editor-workspace"><nav className="pdf-editor-thumbnails" aria-label="PDF pages">{pages.map(item => <button type="button" key={item.page} className={page === item.page ? 'is-active' : ''} onClick={() => setPage(item.page)} aria-current={page === item.page ? 'page' : undefined}><img src={item.src} alt={`Page ${item.page} preview`}/><span>Page {item.page}</span></button>)}</nav>
        <div className="pdf-editor-canvas-area"><div className="pdf-editor-nav"><button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><span>Page {page} of {pages.length}</span><button type="button" onClick={() => setPage(value => Math.min(pages.length, value + 1))} disabled={page >= pages.length}>Next</button><button type="button" onClick={() => setScale(value => Math.max(0.6, value - 0.1))} aria-label="Zoom out">−</button><span>{Math.round(scale * 100)}%</span><button type="button" onClick={() => setScale(value => Math.min(1.4, value + 0.1))} aria-label="Zoom in">+</button></div>
          {currentPage && <div className="pdf-editor-page-wrap" style={{ width: `${Math.min(100, currentPage.width * scale / 8)}%`, maxWidth: `${currentPage.width * scale}px` }}><div ref={pageRef} className="pdf-editor-page" onClick={addMark} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}`, cursor: tool === 'select' ? 'default' : 'crosshair' }}><img src={viewerSrc || currentPage.src} alt={`PDF page ${page}`} /><div className="pdf-editor-mark-layer">{state.marks.filter(mark => mark.page === page).map(mark => <div key={mark.id} className={`pdf-editor-mark pdf-editor-mark-${mark.kind}${state.selected === mark.id ? ' is-selected' : ''}`} style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.w * 100}%`, height: `${mark.h * 100}%`, color: mark.color, backgroundColor: mark.kind === 'highlight' ? `${mark.color}52` : mark.kind === 'rectangle' && mark.fill ? mark.fillColor : (mark.kind === 'text' || mark.kind === 'signature') && mark.textBackground ? mark.fillColor : undefined, border: mark.kind === 'rectangle' ? `${Math.max(1, mark.weight * scale)}px solid ${mark.color}` : undefined, borderTop: mark.kind === 'line' ? `${Math.max(1, mark.weight * scale)}px solid ${mark.color}` : undefined, fontFamily: mark.fontFamily === 'TimesRoman' ? 'Georgia, "Times New Roman", serif' : mark.fontFamily === 'Courier' ? 'Courier New, monospace' : 'Arial, Helvetica, sans-serif', fontSize: `${Math.max(8, mark.size * scale)}px`, transform: mark.rotation ? `rotate(${mark.rotation}deg)` : undefined, fontWeight: mark.bold ? 'bold' : undefined, fontStyle: mark.italic ? 'italic' : undefined, opacity: mark.opacity }} onPointerDown={event => { if (tool !== 'eraser') startGesture(event, mark, 'move') }} onClick={event => { event.stopPropagation(); if (tool === 'eraser') update({ marks: state.marks.filter(item => item.id !== mark.id), selected: state.selected === mark.id ? null : state.selected }); else setState(current => ({ ...current, selected: mark.id })) }} onDoubleClick={event => { event.stopPropagation(); if (mark.kind === 'text' || mark.kind === 'signature') { const revised = window.prompt('Edit annotation text', mark.text); if (revised !== null) patchMark(mark.id, { text: revised }) } }} title="Select annotation; double-click text to edit">{mark.kind === 'text' || mark.kind === 'signature' ? <span className="pdf-editor-mark-content">{mark.text}</span> : mark.kind === 'image' && mark.src ? <img src={mark.src} alt="Inserted PDF image" draggable={false}/> : null}{state.selected === mark.id && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => <button key={handle} type="button" className={`pdf-editor-resize-handle is-${handle}`} aria-label={`Resize ${mark.kind} ${handle}`} onPointerDown={event => startGesture(event, mark, 'resize', handle)} onClick={event => event.stopPropagation()}/>)}</div>)}</div></div></div>}
          <p className="pdf-editor-hint">Choose a tool, then click on the page to place it. For watermarks, choose Text or Image; drag the watermark freely to position it, and adjust its rotation in the toolbar. Drag any addition to move it or use a border handle to resize. Double-click text to edit.</p>
        </div>
      </div>
      <div className="pdf-editor-footer"><span>{hasMarkup ? `${state.marks.length} addition${state.marks.length === 1 ? '' : 's'} · original PDF content is preserved` : 'Add content to the page, then download your edited PDF.'}</span><button type="button" className="pdf-editor-primary" onClick={() => void exportPdf()} disabled={busy || !hasMarkup || pages.some(item => Math.abs(item.rotation % 360) > 0)}>{busy ? <LoaderCircle className="pdf-editor-spin"/> : <Download size={16}/>} {busy ? 'Preparing…' : 'Download edited PDF'}</button></div>
    </>}
    <p className="pdf-editor-privacy">Your PDF files and edits are processed locally in your browser. Your documents are not uploaded to our servers.</p>
  </section>
}
