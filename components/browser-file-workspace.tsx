'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Clipboard, Download, FileArchive, RotateCcw, RotateCw, X } from 'lucide-react'
import type { Tool } from '@/lib/tools'
import { socialImagePresets } from '@/lib/image-presets'
import { BrandedFilePicker, formatFileSize } from '@/components/branded-file-picker'
import { addPdfPageNumbers, canEncode, compressPdf, countPdfPages, imageDimensions, imagesToPdf, inspectPdf, makeFavicons, mergePdfs, pdfToJpg, processImage, rotatePdf, splitPdf, watermarkPdf, zipOutputs, type ImageOperationOptions, type LocalOutput, type PdfPagePreview, type ProgressUpdate } from '@/lib/browser-file-processing'

const PDF_ACCEPT = '.pdf,application/pdf'
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif'
const PAGE_TOOLS = new Set(['split-pdf', 'pdf-to-jpg', 'rotate-pdf', 'add-page-numbers', 'pdf-watermark'])
const MULTI_TOOLS = new Set(['merge-pdf', 'jpg-to-pdf', 'image-compressor', 'image-converter'])
const FORMAT_NAMES: Record<string, string> = { original: 'Keep original', jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF' }
const MIME_TYPES: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }
const fileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`
const numberRange = (text: string, max: number) => {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Math.max(1, Number(range[1]))
      const end = Math.min(max, Number(range[2]))
      for (let value = start; value <= end; value += 1) values.add(value)
    } else if (/^\d+$/.test(part.trim())) {
      const page = Number(part.trim())
      if (page >= 1 && page <= max) values.add(page)
    }
  }
  return [...values].sort((a, b) => a - b)
}

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])
  return url
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function OutputCard({ output }: { output: LocalOutput }) {
  const url = useObjectUrl(output.blob)
  const [text, setText] = useState('')
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => { if (output.kind === 'text') void output.blob.text().then(setText) }, [output])
  return <article className="file-output-card">
    <div className="file-output-heading"><div><strong>{output.name}</strong><span>{formatFileSize(output.blob.size)}</span></div><a className="secondary-button" href={url || undefined} download={output.name} aria-disabled={!url}><Download size={16}/> Download</a></div>
    {output.kind === 'pdf' && url && <iframe className="pdf-result-frame" src={url} title={`Preview of ${output.name}`}/>}
    {output.kind === 'image' && url && <figure className="image-output-figure"><img className="image-result-preview" src={url} alt={`Processed result: ${output.name}`} onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}/>{dimensions && <figcaption>{dimensions.width} × {dimensions.height} px · {formatFileSize(output.blob.size)}</figcaption>}</figure>}
    {output.kind === 'text' && <pre className="base64-result">{text}</pre>}
  </article>
}

function PageGrid({ pages, selected, onToggle, rotations, onRotate, showSelection = true }: { pages: PdfPagePreview[]; selected: number[]; onToggle: (page: number) => void; rotations?: Record<number, number>; onRotate?: (page: number, direction: number) => void; showSelection?: boolean }) {
  return <div className="pdf-page-grid" aria-label="PDF pages">{pages.map(item => <article className={`pdf-page-card${selected.includes(item.page) ? ' pdf-page-selected' : ''}`} key={item.page}>
    {showSelection ? <label className="pdf-page-choice"><input type="checkbox" checked={selected.includes(item.page)} onChange={() => onToggle(item.page)} aria-label={`Select page ${item.page}`}/><span>Page {item.page}</span></label> : <span className="pdf-page-choice">Page {item.page}</span>}
    <div className="pdf-thumb-frame"><img src={item.src} alt={`Thumbnail of page ${item.page}`} style={{ transform: `rotate(${rotations?.[item.page] || 0}deg)` }}/></div>
    {onRotate && <div className="page-rotate-actions"><button type="button" aria-label={`Rotate page ${item.page} left`} onClick={() => onRotate(item.page, -90)}><RotateCcw size={15}/></button><button type="button" aria-label={`Rotate page ${item.page} right`} onClick={() => onRotate(item.page, 90)}><RotateCw size={15}/></button></div>}
  </article>)}</div>
}

function BeforeAfterPreview({ file, output }: { file: File; output: LocalOutput }) {
  const originalUrl = useObjectUrl(file)
  const outputUrl = useObjectUrl(output.blob)
  return <section className="before-after-preview"><div><span>Original</span>{originalUrl && <img src={originalUrl} alt={`Original image: ${file.name}`}/>}<small>{formatFileSize(file.size)}</small></div><div><span>Compressed preview</span>{outputUrl && <img src={outputUrl} alt={`Compressed image: ${output.name}`}/>}<small>{formatFileSize(output.blob.size)}</small></div></section>
}

function ResultPanel({ outputs, busy, onZip, zipBusy }: { outputs: LocalOutput[]; busy: boolean; onZip: () => void; zipBusy: boolean }) {
  if (!outputs.length && !busy) return null
  return <section className="file-result-section" aria-live="polite"><div className="file-result-header"><div><span className="eyebrow">PROCESSED LOCALLY</span><h3>Preview your result</h3><p>Review the generated output before downloading.</p></div>{outputs.length > 1 && <button type="button" className="secondary-button" disabled={zipBusy} onClick={onZip}><FileArchive size={16}/>{zipBusy ? 'Preparing ZIP…' : 'Download all as ZIP'}</button>}</div>{busy && <div className="file-skeleton" aria-hidden="true"><span/><span/><span/></div>}{outputs.map(output => <OutputCard key={output.name} output={output}/>)}</section>
}

export function BrowserFileWorkspace({ tool }: { tool: Tool }) {
  const slug = tool.route.split('/').filter(Boolean).at(-1) || ''
  const isPdf = tool.category === 'PDF Tools' && slug !== 'jpg-to-pdf'
  const isMulti = MULTI_TOOLS.has(slug)
  const accept = slug === 'jpg-to-pdf' ? '.jpg,.jpeg,.png,image/jpeg,image/png' : isPdf ? PDF_ACCEPT : IMAGE_ACCEPT
  const uploadLabel = slug === 'merge-pdf' ? 'Choose PDF Files' : slug === 'jpg-to-pdf' ? 'Choose Images' : isPdf ? 'Choose PDF File' : 'Choose Image'
  const uploadHelper = slug === 'merge-pdf' ? 'PDF files · up to 100 MB each' : slug === 'jpg-to-pdf' ? 'JPG, JPEG, or PNG · up to 100 MB each' : isPdf ? 'PDF files · up to 100 MB' : 'JPG, PNG, WebP, or AVIF where supported · up to 100 MB'
  const [files, setFiles] = useState<File[]>([])
  const [watermarkFile, setWatermarkFile] = useState<File[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [thumbnails, setThumbnails] = useState<PdfPagePreview[]>([])
  const [selectedPages, setSelectedPages] = useState<number[]>([])
  const [pageRange, setPageRange] = useState('')
  const [rotations, setRotations] = useState<Record<number, number>>({})
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number; pages?: number }>>({})
  const [outputs, setOutputs] = useState<LocalOutput[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [zipBusy, setZipBusy] = useState(false)
  const [quality, setQuality] = useState(0.78)
  const [compression, setCompression] = useState<'low' | 'medium' | 'high'>('medium')
  const [formats, setFormats] = useState<string[]>(['jpeg', 'png', 'webp'])
  const [outputFormat, setOutputFormat] = useState('webp')
  const [pageSize, setPageSize] = useState<'a4' | 'letter' | 'fit'>('a4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [margin, setMargin] = useState(10)
  const [scaling, setScaling] = useState<'fit' | 'fill'>('fit')
  const [resolution, setResolution] = useState(2)
  const [pageNumberStart, setPageNumberStart] = useState(1)
  const [numberPosition, setNumberPosition] = useState<'top' | 'bottom'>('bottom')
  const [numberAlign, setNumberAlign] = useState<'left' | 'center' | 'right'>('center')
  const [numberSize, setNumberSize] = useState(12)
  const [numberColor, setNumberColor] = useState('#25364a')
  const [watermarkType, setWatermarkType] = useState<'text' | 'image'>('text')
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL')
  const [watermarkX, setWatermarkX] = useState(50)
  const [watermarkY, setWatermarkY] = useState(50)
  const [watermarkSize, setWatermarkSize] = useState(36)
  const [watermarkColor, setWatermarkColor] = useState('#667085')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.2)
  const [watermarkRotation, setWatermarkRotation] = useState(-35)
  const [watermarkPosition, setWatermarkPosition] = useState<'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('center')
  const [rangeInput, setRangeInput] = useState('100')
  const [compressionTargetMode, setCompressionTargetMode] = useState<'percentage' | 'kilobytes'>('percentage')
  const [compressionReduction, setCompressionReduction] = useState('30')
  const [compressionTargetKb, setCompressionTargetKb] = useState('500')
  const [compressionMaxQuality, setCompressionMaxQuality] = useState(0.95)
  const [resizeWidth, setResizeWidth] = useState(1200)
  const [resizeHeight, setResizeHeight] = useState(800)
  const [keepRatio, setKeepRatio] = useState(true)
  const [resizeMode, setResizeMode] = useState<'dimensions' | 'percentage'>('dimensions')
  const [backgroundTolerance, setBackgroundTolerance] = useState(45)
  const [backgroundEdge, setBackgroundEdge] = useState(18)
  const [backgroundReplacement, setBackgroundReplacement] = useState('transparent')
  const [backgroundColor, setBackgroundColor] = useState('#ffffff')
  const [jpegBackground, setJpegBackground] = useState('#ffffff')
  const [base64Mode, setBase64Mode] = useState<'encode' | 'decode'>('encode')
  const [base64Input, setBase64Input] = useState('')
  const [copied, setCopied] = useState(false)
  const [faviconTags, setFaviconTags] = useState('')
  const [socialPreset, setSocialPreset] = useState(socialImagePresets[0].id)
  const [socialFit, setSocialFit] = useState<'fit' | 'fill'>('fill')
  const [socialX, setSocialX] = useState(50)
  const [socialY, setSocialY] = useState(50)
  const [cropAspect, setCropAspect] = useState('free')
  const [crop, setCrop] = useState({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 })
  const cropGesture = useRef<{ pointerId: number; mode: 'move' | 'resize'; handle?: string; startX: number; startY: number; initial: typeof crop } | null>(null)
  const cropStage = useRef<HTMLDivElement>(null)
  const cropWindowHandlers = useRef<{ move: (event: PointerEvent) => void; end: (event: PointerEvent) => void } | null>(null)
  useEffect(() => () => {
    const handlers = cropWindowHandlers.current
    if (!handlers) return
    window.removeEventListener('pointermove', handlers.move)
    window.removeEventListener('pointerup', handlers.end)
    window.removeEventListener('pointercancel', handlers.end)
  }, [])
  const sourceUrl = useObjectUrl(files[0])
  const imageMeta = files[0] ? dimensions[fileKey(files[0])] : undefined
  const activePreset = socialImagePresets.find(preset => preset.id === socialPreset) || socialImagePresets[0]
  const percentageValue = Math.max(1, Math.min(500, Number(rangeInput) || 100))
  const selectedCount = selectedPages.length
  const pageSelection = useMemo(() => selectedPages, [selectedPages])
  const progressUpdate: ProgressUpdate = useCallback((nextStatus, current, total) => {
    setStatus(nextStatus)
    setProgress(total > 0 ? Math.round(Math.max(0, Math.min(1, current / total)) * 100) : null)
  }, [])

  const resetOutput = () => { setOutputs([]); setError(''); setFaviconTags('') }

  async function updateFiles(nextFiles: File[]) {
    const next = isMulti ? nextFiles : nextFiles.slice(0, 1)
    setFiles(next)
    resetOutput()
    setThumbnails([])
    setPageCount(0)
    setSelectedPages([])
    setRotations({})
    if (slug === 'image-cropper') setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
    if (!next.length) { setStatus(''); setProgress(null); return }
    setBusy(true)
    setError('')
    setStatus('Reading file details')
    setProgress(null)
    try {
      const nextDimensions: Record<string, { width: number; height: number; pages?: number }> = {}
      if (isPdf) {
        if (slug === 'merge-pdf') {
          for (let index = 0; index < next.length; index += 1) {
            setStatus('Counting PDF pages')
            setProgress(next.length > 1 ? Math.round(index / next.length * 100) : null)
            nextDimensions[fileKey(next[index])] = { width: 0, height: 0, pages: await countPdfPages(next[index]) }
          }
          if (next.length > 1) setProgress(100)
        } else {
          const inspect = await inspectPdf(next[0], progressUpdate)
          setPageCount(inspect.pageCount)
          setThumbnails(inspect.thumbnails)
          setSelectedPages(Array.from({ length: inspect.pageCount }, (_, index) => index + 1))
          setPageRange(`1-${inspect.pageCount}`)
          nextDimensions[fileKey(next[0])] = { width: 0, height: 0, pages: inspect.pageCount }
        }
      } else {
        for (let index = 0; index < next.length; index += 1) {
          setStatus('Reading image dimensions')
          setProgress(next.length > 1 ? Math.round(index / next.length * 100) : null)
          const size = await imageDimensions(next[index])
          nextDimensions[fileKey(next[index])] = size
          if (index === 0 && slug === 'image-resizer') {
            setResizeWidth(size.width)
            setResizeHeight(size.height)
          }
        }
        const results = await Promise.all(['image/jpeg', 'image/png', 'image/webp', 'image/avif'].map(async type => [type.slice(6), await canEncode(type)] as const))
        const supportedFormats = results.filter(([, supported]) => supported).map(([format]) => format)
        setFormats(supportedFormats)
        if (outputFormat !== 'original' && !supportedFormats.includes(outputFormat) && supportedFormats[0]) setOutputFormat(supportedFormats[0])
      }
      setDimensions(current => ({ ...current, ...nextDimensions }))
      setStatus('')
      setProgress(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read. Try another file.')
      setStatus('')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  function addFiles(incoming: File[]) { void updateFiles(isMulti ? [...files, ...incoming] : incoming) }
  function removeFile(index: number) { void updateFiles(files.filter((_, fileIndex) => fileIndex !== index)) }
  function moveFile(from: number, to: number) {
    setFiles(current => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    resetOutput()
  }

  function togglePage(page: number) {
    setSelectedPages(current => current.includes(page) ? current.filter(item => item !== page) : [...current, page].sort((a, b) => a - b))
  }

  function rotatePage(page: number, direction: number) {
    setRotations(current => ({ ...current, [page]: ((current[page] || 0) + direction + 360) % 360 }))
  }

  function setMeasuredProgress(nextStatus: string, current: number, total: number) { progressUpdate(nextStatus, current, total) }

  async function process() {
    if (busy) return
    setError('')
    setOutputs([])
    setBusy(true)
    setProgress(null)
    setStatus('Preparing preview')
    try {
      let generated: LocalOutput[] = []
      if (slug === 'merge-pdf') {
        if (files.length < 2) throw new Error('Choose at least two PDF files to merge.')
        generated = [await mergePdfs(files, setMeasuredProgress)]
      } else if (slug === 'split-pdf') {
        const pages = selectedPages
        if (!pages.length) throw new Error('Select at least one page or enter a valid page range.')
        generated = await splitPdf(files[0], pages, setMeasuredProgress)
      } else if (slug === 'compress-pdf') {
        const result = await compressPdf(files[0], compression, setMeasuredProgress)
        generated = [result.output]
        const percent = result.originalSize ? Math.max(0, Math.round((1 - result.output.blob.size / result.originalSize) * 100)) : 0
        setStatus(result.output.blob.size < result.originalSize ? percent < 5 ? `Only a small reduction (${percent}%). This PDF may already be optimized, or its text and vector content may not compress much.` : `Compressed ${formatFileSize(result.originalSize - result.output.blob.size)} (${percent}% smaller).` : 'The generated PDF is not smaller; this source may already be optimized.')
      } else if (slug === 'jpg-to-pdf') {
        generated = [await imagesToPdf(files, { pageSize, orientation, margin, scaling }, setMeasuredProgress)]
      } else if (slug === 'pdf-to-jpg') {
        if (!selectedPages.length) throw new Error('Select at least one page to convert.')
        generated = await pdfToJpg(files[0], selectedPages, Number(resolution), quality, setMeasuredProgress)
      } else if (slug === 'rotate-pdf') {
        if (!Object.values(rotations).some(value => value !== 0)) throw new Error('Rotate one or more pages before previewing the result.')
        generated = [await rotatePdf(files[0], rotations, setMeasuredProgress)]
      } else if (slug === 'add-page-numbers') {
        if (!selectedPages.length) throw new Error('Select at least one page to number.')
        generated = [await addPdfPageNumbers(files[0], { start: pageNumberStart, pages: selectedPages, position: numberPosition, align: numberAlign, size: numberSize, color: numberColor }, setMeasuredProgress)]
      } else if (slug === 'pdf-watermark') {
        if (watermarkType === 'text' && !watermarkText.trim()) throw new Error('Enter watermark text.')
        if (watermarkType === 'image' && !watermarkFile.length) throw new Error('Choose an image watermark.')
        if (!selectedPages.length) throw new Error('Select at least one page to watermark.')
        generated = [await watermarkPdf(files[0], { text: watermarkType === 'text' ? watermarkText : '', size: watermarkSize, color: watermarkColor, opacity: watermarkOpacity, rotation: watermarkRotation, position: watermarkPosition, x: watermarkX, y: watermarkY, pages: selectedPages }, watermarkType === 'image' ? watermarkFile[0] || null : null, setMeasuredProgress)]
      } else if (slug === 'image-to-base64') {
        if (base64Mode === 'encode') {
          if (!files[0]) throw new Error('Choose an image to encode.')
          setStatus('Encoding image bytes')
          const data = new Uint8Array(await files[0].arrayBuffer())
          let binary = ''
          const chunkSize = 0x8000
          for (let index = 0; index < data.length; index += chunkSize) binary += String.fromCharCode(...data.subarray(index, index + chunkSize))
          const base64 = btoa(binary)
          const mime = files[0].type || 'application/octet-stream'
          const dataUrl = `data:${mime};base64,${base64}`
          setBase64Input(dataUrl)
          generated = [{ name: 'image-base64.txt', blob: new Blob([dataUrl], { type: 'text/plain' }), kind: 'text' }]
        } else {
          if (base64Input.length > 140 * 1024 * 1024) throw new Error('Base64 input is too large to decode safely in this browser.')
          const match = base64Input.trim().match(/^(?:data:(image\/(?:png|jpeg|webp|avif));base64,)?([A-Za-z0-9+/=\s]+)$/)
          if (!match) throw new Error('Enter a valid Base64 string or image data URL.')
          let binary: string
          try { binary = atob(match[2].replace(/\s/g, '')) } catch { throw new Error('The Base64 input is not valid.') }
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
          const blob = new Blob([bytes], { type: match[1] || 'image/png' })
          const bitmap = await createImageBitmap(blob).catch(() => null)
          if (!bitmap) throw new Error('The decoded data is not a supported image.')
          bitmap.close()
          generated = [{ name: `decoded-image.${blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1]}`, blob, kind: 'image' }]
        }
      } else if (slug === 'favicon-generator') {
        generated = await makeFavicons(files[0], setMeasuredProgress)
        setFaviconTags(generated.filter(item => item.name.endsWith('.png')).map(item => `<link rel="icon" type="image/png" sizes="${item.name.match(/\d+/)?.[0]}x${item.name.match(/\d+/)?.[0]}" href="/${item.name}">`).join('\n'))
      } else {
        const mode: ImageOperationOptions['mode'] = slug === 'image-compressor' ? 'compress' : slug === 'image-resizer' ? 'resize' : slug === 'image-converter' ? 'convert' : slug === 'image-cropper' ? 'crop' : slug === 'background-remover' ? 'remove-background' : 'social'
        const imageOutputs: LocalOutput[] = []
        const items = slug === 'image-compressor' || slug === 'image-converter' ? files : files.slice(0, 1)
        for (let index = 0; index < items.length; index += 1) {
          setMeasuredProgress(items.length > 1 ? `Processing image ${index + 1} of ${items.length}` : mode === 'compress' ? 'Compressing image' : mode === 'resize' ? 'Resizing image' : mode === 'crop' ? 'Cropping image' : mode === 'remove-background' ? 'Removing flat background color' : mode === 'social' ? 'Preparing social media image' : 'Converting image', 0, 0)
          const item = items[index]
          const selectedFormat = slug === 'background-remover' ? 'png' : outputFormat === 'original' ? (item.type.split('/')[1] === 'jpeg' ? 'jpeg' : item.type.split('/')[1] || 'png') : outputFormat
          if (selectedFormat !== 'jpeg' && selectedFormat !== 'png' && selectedFormat !== 'webp' && selectedFormat !== 'avif') throw new Error('Choose a supported image format.')
          if (formats.length && !formats.includes(selectedFormat)) throw new Error(`${FORMAT_NAMES[selectedFormat] || selectedFormat} is not supported by this browser.`)
          const original = dimensions[fileKey(item)] || await imageDimensions(item)
          const width = resizeMode === 'percentage' ? Math.max(1, Math.round(original.width * percentageValue / 100)) : resizeWidth
          const height = resizeMode === 'percentage' ? Math.max(1, Math.round(original.height * percentageValue / 100)) : resizeHeight
          const selectedCrop = crop
          const cropRect = { x: Math.round(selectedCrop.x * original.width), y: Math.round(selectedCrop.y * original.height), width: Math.max(1, Math.round(selectedCrop.width * original.width)), height: Math.max(1, Math.round(selectedCrop.height * original.height)) }
          const social = activePreset
          const output = await processImage(item, {
            mode,
            output: selectedFormat,
            quality: slug === 'image-compressor' ? compressionMaxQuality : quality,
            targetBytes: slug === 'image-compressor' && files[0] ? Math.min(
              compressionTargetMode === 'percentage'
                ? item.size * (1 - Number(compressionReduction) / 100)
                : Number(compressionTargetKb) * 1024,
              item.size,
            ) : undefined,
            onProgress: slug === 'image-compressor' ? setMeasuredProgress : undefined,
            width: slug === 'social-media-resizer' ? social.width : width,
            height: slug === 'social-media-resizer' ? social.height : height,
            crop: cropRect,
            background: slug === 'background-remover' ? backgroundReplacement === 'custom' ? backgroundColor : backgroundReplacement : slug === 'image-compressor' ? jpegBackground : '#ffffff',
            tolerance: backgroundTolerance,
            edge: backgroundEdge,
            fitMode: socialFit,
            offsetX: socialX,
            offsetY: socialY,
          })
          imageOutputs.push(output)
        }
        generated = imageOutputs
      }
      setOutputs(generated)
      setProgress(100)
      if (slug !== 'compress-pdf') setStatus('Preview is ready. Check the result before downloading.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be processed. Check the file and try again.')
      setStatus('')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  async function downloadZip() {
    if (zipBusy || !outputs.length) return
    setZipBusy(true)
    try { downloadBlob(await zipOutputs(outputs), `${slug}-outputs.zip`) }
    catch { setError('The ZIP could not be prepared. Download the output files individually instead.') }
    finally { setZipBusy(false) }
  }

  function applyRange() {
    const pages = numberRange(pageRange, pageCount)
    setSelectedPages(pages)
    if (!pages.length) setError('Enter a valid page number or range, such as 1-3, 5.')
    else setError('')
  }

  function updateCropSelection(next: typeof crop) {
    setCrop(next)
    if (outputs.length) { setOutputs([]); setStatus('') }
  }

  function beginCropGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropStage.current) return
    const rect = cropStage.current.getBoundingClientRect()
    const startX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const startY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const target = event.target as HTMLElement
    const explicitHandle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle
    const selection = target.closest<HTMLElement>('[data-crop-selection]')
    if (!selection) return

    const left = crop.x
    const top = crop.y
    const right = crop.x + crop.width
    const bottom = crop.y + crop.height
    const edgeToleranceX = Math.max(10 / rect.width, 0.012)
    const edgeToleranceY = Math.max(10 / rect.height, 0.012)
    const nearLeft = Math.abs(startX - left) <= edgeToleranceX
    const nearRight = Math.abs(startX - right) <= edgeToleranceX
    const nearTop = Math.abs(startY - top) <= edgeToleranceY
    const nearBottom = Math.abs(startY - bottom) <= edgeToleranceY
    const edgeHandle = `${nearTop ? 'n' : nearBottom ? 's' : ''}${nearLeft ? 'w' : nearRight ? 'e' : ''}`
    const handle = explicitHandle || edgeHandle || undefined

    cropWindowHandlers.current?.move && window.removeEventListener('pointermove', cropWindowHandlers.current.move)
    cropWindowHandlers.current?.end && window.removeEventListener('pointerup', cropWindowHandlers.current.end)
    cropWindowHandlers.current?.end && window.removeEventListener('pointercancel', cropWindowHandlers.current.end)
    cropGesture.current = { pointerId: event.pointerId, mode: handle ? 'resize' : 'move', handle, startX, startY, initial: crop }
    const move = (pointerEvent: PointerEvent) => moveCropGesture(pointerEvent)
    const end = (pointerEvent: PointerEvent) => endCropGesture(pointerEvent)
    cropWindowHandlers.current = { move, end }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    event.preventDefault()
  }

  function moveCropGesture(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>) {
    const gesture = cropGesture.current
    const stage = cropStage.current
    if (!gesture || !stage || gesture.pointerId !== event.pointerId) return
    const rect = stage.getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const py = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    const dx = px - gesture.startX
    const dy = py - gesture.startY
    const minW = Math.min(0.025, 24 / rect.width)
    const minH = Math.min(0.025, 24 / rect.height)
    let next = { ...gesture.initial }
    if (gesture.mode === 'move') {
      next.x = Math.max(0, Math.min(1 - next.width, gesture.initial.x + dx))
      next.y = Math.max(0, Math.min(1 - next.height, gesture.initial.y + dy))
    } else {
      const handle = gesture.handle || ''
      let left = gesture.initial.x
      let top = gesture.initial.y
      let right = left + gesture.initial.width
      let bottom = top + gesture.initial.height
      if (handle.includes('w')) left = Math.min(right - minW, Math.max(0, left + dx))
      if (handle.includes('e')) right = Math.max(left + minW, Math.min(1, right + dx))
      if (handle.includes('n')) top = Math.min(bottom - minH, Math.max(0, top + dy))
      if (handle.includes('s')) bottom = Math.max(top + minH, Math.min(1, bottom + dy))
      if (cropAspect !== 'free' && imageMeta) {
        const ratio = (cropAspect === '1:1' ? 1 : cropAspect === '4:3' ? 4 / 3 : cropAspect === '16:9' ? 16 / 9 : 3 / 2) * imageMeta.height / imageMeta.width
        let width = right - left
        let height = bottom - top
        if (handle === 'n' || handle === 's') {
          width = Math.min(ratio, height * ratio)
          height = width / ratio
          height = Math.min(height, handle === 'n' ? gesture.initial.y + gesture.initial.height : 1 - gesture.initial.y)
          width = height * ratio
          const center = gesture.initial.x + gesture.initial.width / 2
          left = Math.max(0, Math.min(1 - width, center - width / 2))
          right = left + width
          top = handle === 'n' ? gesture.initial.y + gesture.initial.height - height : gesture.initial.y
          bottom = top + height
        } else if (handle === 'e' || handle === 'w') {
          const anchor = handle === 'w' ? gesture.initial.x + gesture.initial.width : gesture.initial.x
          width = Math.min(width, ratio, handle === 'w' ? anchor : 1 - anchor)
          height = width / ratio
          const center = gesture.initial.y + gesture.initial.height / 2
          top = Math.max(0, Math.min(1 - height, center - height / 2))
          bottom = top + height
          left = handle === 'w' ? anchor - width : anchor
          right = left + width
        } else {
          if (Math.abs(dx) >= Math.abs(dy)) height = width / ratio
          else width = height * ratio
          const anchorX = handle.includes('w') ? gesture.initial.x + gesture.initial.width : gesture.initial.x
          const anchorY = handle.includes('n') ? gesture.initial.y + gesture.initial.height : gesture.initial.y
          width = Math.min(width, handle.includes('w') ? anchorX : 1 - anchorX)
          height = width / ratio
          if (height > (handle.includes('n') ? anchorY : 1 - anchorY)) { height = handle.includes('n') ? anchorY : 1 - anchorY; width = height * ratio }
          left = handle.includes('w') ? anchorX - width : anchorX
          right = left + width
          top = handle.includes('n') ? anchorY - height : anchorY
          bottom = top + height
        }
      }
      next = { x: left, y: top, width: right - left, height: bottom - top }
    }
    updateCropSelection(next)
  }

  function endCropGesture(event: Pick<PointerEvent, 'pointerId'>) {
    if (cropGesture.current?.pointerId !== event.pointerId) return
    cropGesture.current = null
    const handlers = cropWindowHandlers.current
    if (handlers) {
      window.removeEventListener('pointermove', handlers.move)
      window.removeEventListener('pointerup', handlers.end)
      window.removeEventListener('pointercancel', handlers.end)
      cropWindowHandlers.current = null
    }
  }

  function resetCropSelection() {
    updateCropSelection({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
  }

  function changeCropAspect(value: string) {
    setCropAspect(value)
    if (value === 'free' || !imageMeta) return
    const pixelRatio = value === '1:1' ? 1 : value === '4:3' ? 4 / 3 : value === '16:9' ? 16 / 9 : 3 / 2
    const normalizedRatio = pixelRatio * imageMeta.height / imageMeta.width
    let width = crop.width
    let height = width / normalizedRatio
    if (height > 1) { height = Math.min(1, crop.height); width = height * normalizedRatio }
    const x = Math.max(0, Math.min(1 - width, crop.x + crop.width / 2 - width / 2))
    const y = Math.max(0, Math.min(1 - height, crop.y + crop.height / 2 - height / 2))
    updateCropSelection({ x, y, width, height })
  }

  const sourceFormats = slug === 'jpg-to-pdf' ? 'JPG, JPEG, PNG' : isPdf ? 'PDF' : 'JPG, PNG, WebP, AVIF where supported'
  const pageTool = PAGE_TOOLS.has(slug)
  const selectedMeta = files.map(file => ({ file, detail: dimensions[fileKey(file)] }))
  const compressionStats = outputs.map((output, index) => {
    const original = files[index]
    const saved = original ? Math.max(0, original.size - output.blob.size) : 0
    const reduction = original?.size ? Math.max(0, (saved / original.size) * 100) : 0
    const size = original ? dimensions[fileKey(original)] : undefined
    const format = output.blob.type === 'image/jpeg' ? 'JPG' : output.blob.type === 'image/webp' ? 'WebP' : output.blob.type === 'image/png' ? 'PNG' : output.blob.type
    return { output, original, saved, reduction, size, format, retained: output.blob === original, compressionStatus: output.compressionStatus }
  })
  const validCompressionTarget = compressionTargetMode === 'percentage'
    ? Number.isFinite(Number(compressionReduction)) && Number(compressionReduction) >= 1 && Number(compressionReduction) <= 95
    : Number.isFinite(Number(compressionTargetKb)) && Number(compressionTargetKb) >= 1 && Number(compressionTargetKb) <= 1000000
  const canProcess = !busy && (slug === 'image-compressor' && !validCompressionTarget ? false : slug === 'image-to-base64' ? base64Mode === 'decode' ? Boolean(base64Input.trim()) : files.length > 0 : slug === 'merge-pdf' ? files.length >= 2 : files.length > 0)

  return <div className="file-tool-box">
    <div className="file-tool-heading"><div><span className="eyebrow">PRIVATE, IN-BROWSER PROCESSING</span><h2>Choose files and set options</h2><p>Your files stay on this device. Nothing is uploaded.</p></div></div>
    {slug === 'image-to-base64' && <fieldset className="file-mode-options"><legend>Choose a task</legend><label><input type="radio" name="base64Mode" checked={base64Mode === 'encode'} onChange={() => setBase64Mode('encode')}/> Image to Base64</label><label><input type="radio" name="base64Mode" checked={base64Mode === 'decode'} onChange={() => setBase64Mode('decode')}/> Decode Base64 image</label></fieldset>}
    {!(slug === 'image-to-base64' && base64Mode === 'decode') && <BrandedFilePicker files={files} onAdd={addFiles} onRemove={removeFile} onMove={isMulti && files.length > 1 ? moveFile : undefined} multiple={isMulti} accept={accept} label={uploadLabel} helper={uploadHelper} error={error && !files.length ? error : undefined}/>}
    {slug === 'image-to-base64' && base64Mode === 'decode' && <label className="file-field"><span>Paste an image data URL or Base64 string</span><textarea rows={5} value={base64Input} onChange={event => { setBase64Input(event.target.value); setError('') }} placeholder="data:image/png;base64,…" spellCheck={false}/><small>Supported image data URLs: PNG, JPG, WebP, and AVIF where supported.</small></label>}

    {selectedMeta.length > 0 && <div className="file-meta-grid">{selectedMeta.map(({ file, detail }) => <div className="file-meta-card" key={fileKey(file)}><span>{file.name}</span><strong>{formatFileSize(file.size)}</strong><small>{detail?.pages ? `${detail.pages} pages` : detail?.width ? `${detail.width} × ${detail.height} px` : isPdf ? 'Reading page count…' : 'Reading dimensions…'}</small></div>)}</div>}

    {isPdf && slug === 'merge-pdf' && <div className="file-settings-grid"><p className="file-hint full-span">Use the up and down controls beside each file to set the merge order. Page counts appear after each PDF is read.</p></div>}
    {isPdf && slug === 'split-pdf' && pageCount > 0 && <div className="file-settings-grid"><label className="file-field full-span"><span>Page range</span><div className="file-inline-control"><input value={pageRange} onChange={event => setPageRange(event.target.value)} placeholder="1-3, 5" aria-label="Page range to extract"/><button type="button" className="secondary-button" onClick={applyRange}>Use range</button></div><small>Enter pages like 1-3, 5. Or select pages in the preview below.</small></label><div className="file-action-row full-span"><button type="button" className="secondary-button" onClick={() => setSelectedPages(Array.from({ length: pageCount }, (_, index) => index + 1))}>Select all pages</button><button type="button" className="secondary-button" onClick={() => setSelectedPages([])}>Clear selection</button><span>{selectedCount} of {pageCount} pages selected</span></div></div>}
    {isPdf && slug === 'compress-pdf' && <div className="file-settings-grid"><label className="file-field"><span>Compression level</span><select value={compression} onChange={event => setCompression(event.target.value as typeof compression)}><option value="low">Low compression — higher quality</option><option value="medium">Medium compression — balanced</option><option value="high">High compression — smaller file</option></select></label><p className="file-hint">This browser-based method rasterizes page content to JPEG images. Text will no longer be selectable or searchable. Scanned documents may shrink more than already optimized PDFs.</p></div>}
    {isPdf && slug === 'jpg-to-pdf' && <div className="file-settings-grid"><label className="file-field"><span>Page size</span><select value={pageSize} onChange={event => setPageSize(event.target.value as typeof pageSize)}><option value="a4">A4</option><option value="letter">Letter</option><option value="fit">Fit to image</option></select></label><label className="file-field"><span>Orientation</span><select value={orientation} onChange={event => setOrientation(event.target.value as typeof orientation)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label className="file-field"><span>Margins (mm)</span><input type="number" min="0" max="40" value={margin} onChange={event => setMargin(Math.max(0, Math.min(40, Number(event.target.value) || 0)))}/></label><label className="file-field"><span>Image scaling</span><select value={scaling} onChange={event => setScaling(event.target.value as typeof scaling)}><option value="fit">Fit inside page</option><option value="fill">Fill page</option></select></label></div>}
    {isPdf && slug === 'pdf-to-jpg' && <div className="file-settings-grid"><label className="file-field"><span>Output resolution</span><select value={resolution} onChange={event => setResolution(Number(event.target.value))}><option value={1}>72 DPI</option><option value={2}>144 DPI</option><option value={3}>216 DPI</option></select></label><label className="file-field"><span>JPG quality · {Math.round(quality * 100)}%</span><input type="range" min="0.45" max="1" step="0.05" value={quality} onChange={event => setQuality(Number(event.target.value))}/></label><div className="file-action-row full-span"><span>{selectedCount} of {pageCount} pages selected</span><button type="button" className="secondary-button" onClick={() => setSelectedPages(Array.from({ length: pageCount }, (_, index) => index + 1))}>Select all</button><button type="button" className="secondary-button" onClick={() => setSelectedPages([])}>Clear</button></div></div>}
    {isPdf && slug === 'rotate-pdf' && <div className="file-settings-grid"><div className="file-action-row full-span"><button type="button" className="secondary-button" onClick={() => setRotations(Object.fromEntries(Array.from({ length: pageCount }, (_, index) => [index + 1, ((rotations[index + 1] || 0) + 270) % 360])))}><RotateCcw size={15}/> Rotate all left</button><button type="button" className="secondary-button" onClick={() => setRotations(Object.fromEntries(Array.from({ length: pageCount }, (_, index) => [index + 1, ((rotations[index + 1] || 0) + 90) % 360])))}><RotateCw size={15}/> Rotate all right</button></div></div>}
    {isPdf && slug === 'add-page-numbers' && <div className="file-settings-grid"><label className="file-field"><span>Starting number</span><input type="number" min="1" value={pageNumberStart} onChange={event => setPageNumberStart(Math.max(1, Number(event.target.value) || 1))}/></label><label className="file-field"><span>Font size</span><input type="number" min="6" max="48" value={numberSize} onChange={event => setNumberSize(Math.max(6, Math.min(48, Number(event.target.value) || 12)))}/></label><label className="file-field"><span>Placement</span><select value={numberPosition} onChange={event => setNumberPosition(event.target.value as typeof numberPosition)}><option value="top">Top</option><option value="bottom">Bottom</option></select></label><label className="file-field"><span>Alignment</span><select value={numberAlign} onChange={event => setNumberAlign(event.target.value as typeof numberAlign)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label className="file-field"><span>Text color</span><input type="color" value={numberColor} onChange={event => setNumberColor(event.target.value)}/></label><div className="file-action-row"><span>{selectedCount} of {pageCount} pages selected</span><button type="button" className="secondary-button" onClick={() => setSelectedPages(Array.from({ length: pageCount }, (_, index) => index + 1))}>Number all pages</button></div></div>}
    {isPdf && slug === 'pdf-watermark' && <><fieldset className="file-mode-options"><legend>Watermark type</legend><label><input type="radio" name="watermarkType" checked={watermarkType === 'text'} onChange={() => setWatermarkType('text')}/> Text watermark</label><label><input type="radio" name="watermarkType" checked={watermarkType === 'image'} onChange={() => setWatermarkType('image')}/> Image watermark</label></fieldset><div className="file-settings-grid">{watermarkType === 'text' && <label className="file-field"><span>Watermark text</span><input value={watermarkText} onChange={event => setWatermarkText(event.target.value)} placeholder="CONFIDENTIAL"/></label>}{watermarkType === 'text' && <label className="file-field"><span>Font size</span><input type="number" min="8" max="120" value={watermarkSize} onChange={event => setWatermarkSize(Math.max(8, Math.min(120, Number(event.target.value) || 36)))}/></label>}{watermarkType === 'text' && <label className="file-field"><span>Text color</span><input type="color" value={watermarkColor} onChange={event => setWatermarkColor(event.target.value)}/></label>}<label className="file-field"><span>Opacity · {Math.round(watermarkOpacity * 100)}%</span><input type="range" min="0.05" max="1" step="0.05" value={watermarkOpacity} onChange={event => setWatermarkOpacity(Number(event.target.value))}/></label><label className="file-field"><span>Rotation</span><input type="number" min="-180" max="180" value={watermarkRotation} onChange={event => setWatermarkRotation(Math.max(-180, Math.min(180, Number(event.target.value) || 0)))}/></label><label className="file-field"><span>Position preset</span><select value={watermarkPosition} onChange={event => { const value = event.target.value as typeof watermarkPosition; setWatermarkPosition(value); const points = { center: [50, 50], 'top-left': [20, 20], 'top-right': [80, 20], 'bottom-left': [20, 80], 'bottom-right': [80, 80] } as const; setWatermarkX(points[value][0]); setWatermarkY(points[value][1]) }}><option value="center">Center</option><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label><label className="file-field"><span>Horizontal position · {watermarkX}%</span><input type="range" min="0" max="100" value={watermarkX} onChange={event => setWatermarkX(Number(event.target.value))}/></label><label className="file-field"><span>Vertical position · {watermarkY}%</span><input type="range" min="0" max="100" value={watermarkY} onChange={event => setWatermarkY(Number(event.target.value))}/></label><div className="file-action-row full-span"><span>{selectedCount} of {pageCount} pages selected</span><button type="button" className="secondary-button" onClick={() => setSelectedPages(Array.from({ length: pageCount }, (_, index) => index + 1))}>Apply to all pages</button></div></div>{watermarkType === 'image' && <div className="optional-watermark-upload"><p className="file-hint">Choose one image watermark. It will be used instead of text.</p><BrandedFilePicker files={watermarkFile} onAdd={setWatermarkFile} onRemove={() => setWatermarkFile([])} accept=".png,.jpg,.jpeg,image/png,image/jpeg" label="Choose Watermark Image" helper="PNG or JPG · applied only when Image watermark is selected" maxBytes={20 * 1024 * 1024}/></div>}</>}

    {!isPdf && slug === 'image-compressor' && <div className="file-settings-grid"><label className="file-field"><span>Output format</span><select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}>{formats.filter(format => ['jpeg','webp'].includes(format)).map(format => <option value={format} key={format}>{FORMAT_NAMES[format]}</option>)}</select></label><div className="compression-target-mode full-span" role="group" aria-label="Compression target mode"><button type="button" className={compressionTargetMode === 'percentage' ? 'is-active' : ''} aria-pressed={compressionTargetMode === 'percentage'} onClick={() => setCompressionTargetMode('percentage')}>Reduce by percentage</button><button type="button" className={compressionTargetMode === 'kilobytes' ? 'is-active' : ''} aria-pressed={compressionTargetMode === 'kilobytes'} onClick={() => setCompressionTargetMode('kilobytes')}>Target file size</button></div>{compressionTargetMode === 'percentage' ? <label className="file-field"><span>Desired size reduction (%)</span><input type="number" min="1" max="95" step="1" value={compressionReduction} onChange={event => setCompressionReduction(event.target.value)} aria-invalid={!validCompressionTarget}/><small>Choose a reduction from 1% to 95% of each original file.</small></label> : <label className="file-field"><span>Target output size (KB)</span><input type="number" min="1" max="1000000" step="1" value={compressionTargetKb} onChange={event => setCompressionTargetKb(event.target.value)} aria-invalid={!validCompressionTarget}/><small>We&apos;ll choose the closest browser-encoded result at or below this target when possible.</small></label>}<label className="file-field"><span>Maximum encoding quality · {Math.round(compressionMaxQuality * 100)}%</span><input type="range" min="0.4" max="1" step="0.05" value={compressionMaxQuality} onChange={event => setCompressionMaxQuality(Number(event.target.value))}/><small>Quality is reduced only as much as needed to approach the selected target.</small></label>{outputFormat === 'jpeg' && <label className="file-field"><span>JPG background for transparent areas</span><input type="color" value={jpegBackground} onChange={event => setJpegBackground(event.target.value)}/></label>}<p className="file-hint full-span">JPG and WebP use iterative quality adjustment to approach your target without resizing. PNG output is not offered here because browser re-encoding can increase file size and no lossless PNG optimizer is available; choose WebP to preserve transparency.</p></div>}
    {!isPdf && slug === 'image-resizer' && <div className="file-settings-grid"><div className="file-field full-span"><span>Quick sizes</span><div className="file-action-row"><button type="button" className="secondary-button" onClick={() => { setResizeMode('dimensions'); setResizeWidth(600); setResizeHeight(600); setKeepRatio(false) }}>Passport size · 600 × 600 px</button><button type="button" className="secondary-button" onClick={() => { setResizeMode('dimensions'); setResizeWidth(300); setResizeHeight(300); setKeepRatio(false) }}>1 × 1 · 300 × 300 px</button></div><small>Passport photo dimensions vary by country. Check your application requirements before printing.</small></div><label className="file-field"><span>Resize mode</span><select value={resizeMode} onChange={event => setResizeMode(event.target.value as typeof resizeMode)}><option value="dimensions">Custom dimensions</option><option value="percentage">Percentage</option></select></label>{resizeMode === 'percentage' ? <label className="file-field"><span>Scale · {percentageValue}%</span><input type="range" min="10" max="300" step="5" value={percentageValue} onChange={event => setRangeInput(event.target.value)}/></label> : <><label className="file-field"><span>Width (px)</span><input type="number" min="1" max="12000" value={resizeWidth} onChange={event => { const width = Math.max(1, Math.min(12000, Number(event.target.value) || 1)); setResizeWidth(width); if (keepRatio && imageMeta) setResizeHeight(Math.round(width / imageMeta.width * imageMeta.height)) }}/></label><label className="file-field"><span>Height (px)</span><input type="number" min="1" max="12000" value={resizeHeight} onChange={event => { const height = Math.max(1, Math.min(12000, Number(event.target.value) || 1)); setResizeHeight(height); if (keepRatio && imageMeta) setResizeWidth(Math.round(height / imageMeta.height * imageMeta.width)) }}/></label><label className="file-field check-field"><input type="checkbox" checked={keepRatio} onChange={event => setKeepRatio(event.target.checked)}/> Maintain aspect ratio</label></>}<label className="file-field"><span>Output format</span><select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}><option value="original">Keep original</option>{formats.map(format => <option value={format} key={format}>{FORMAT_NAMES[format]}</option>)}</select></label><div className="file-action-row full-span"><span>Original: {imageMeta ? `${imageMeta.width} × ${imageMeta.height} px` : '—'}</span><button type="button" className="secondary-button" onClick={() => { if (imageMeta) { setResizeWidth(1080); setResizeHeight(Math.round(1080 / imageMeta.width * imageMeta.height)) } }}>1080 px wide</button><button type="button" className="secondary-button" onClick={() => { setResizeWidth(1200); setResizeHeight(630) }}>1200 × 630</button></div></div>}
    {!isPdf && slug === 'image-converter' && <div className="file-settings-grid"><label className="file-field"><span>Convert to</span><select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}>{formats.map(format => <option value={format} key={format}>{FORMAT_NAMES[format]}</option>)}</select></label><label className="file-field"><span>Quality · {Math.round(quality * 100)}%</span><input type="range" min="0.3" max="1" step="0.05" value={quality} onChange={event => setQuality(Number(event.target.value))}/></label><p className="file-hint full-span">JPEG does not support transparency; transparent areas are flattened onto white. Choose PNG or WebP to preserve transparency.</p></div>}
    {!isPdf && slug === 'image-cropper' && <><div className="file-settings-grid"><label className="file-field"><span>Aspect ratio</span><select value={cropAspect} onChange={event => changeCropAspect(event.target.value)}><option value="free">Freeform</option><option value="1:1">Square · 1:1</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="3:2">3:2</option></select></label><label className="file-field"><span>Output format</span><select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}><option value="original">Keep original</option>{formats.map(format => <option value={format} key={format}>{FORMAT_NAMES[format]}</option>)}</select></label><button type="button" className="secondary-button" onClick={resetCropSelection}>Reset Selection</button><span className="file-hint">Original: {imageMeta ? `${imageMeta.width} × ${imageMeta.height} px` : '—'} · Selection: {imageMeta ? `${Math.round(crop.width * imageMeta.width)} × ${Math.round(crop.height * imageMeta.height)} px` : '—'}</span></div>{sourceUrl && <div className="crop-instructions"><span>Drag inside the selection to move it; drag a handle to resize.</span><div ref={cropStage} className="crop-stage" onPointerDown={beginCropGesture}><img src={sourceUrl} alt="Image being cropped" draggable={false}/><div data-crop-selection="true" className="crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>{['nw','n','ne','e','se','s','sw','w'].map(handle => <button key={handle} type="button" data-crop-handle={handle} className={`crop-handle crop-handle-${handle}`} aria-label={`Resize crop ${handle}`} />)}</div></div></div>}</>}
    {!isPdf && slug === 'background-remover' && <div className="file-settings-grid"><label className="file-field"><span>Background tolerance · {backgroundTolerance}</span><input type="range" min="0" max="160" value={backgroundTolerance} onChange={event => setBackgroundTolerance(Number(event.target.value))}/></label><label className="file-field"><span>Edge softness · {backgroundEdge}</span><input type="range" min="1" max="80" value={backgroundEdge} onChange={event => setBackgroundEdge(Number(event.target.value))}/></label><label className="file-field"><span>Background output</span><select value={backgroundReplacement} onChange={event => setBackgroundReplacement(event.target.value)}><option value="transparent">Transparent PNG</option><option value="#ffffff">White</option><option value="#000000">Black</option><option value="#087e64">Digitalivez green</option><option value="custom">Choose a color…</option></select></label>{backgroundReplacement==='custom'&&<label className="file-field"><span>Custom replacement color</span><input type="color" value={backgroundColor} onChange={event=>setBackgroundColor(event.target.value)}/></label>}<p className="file-hint">Color-based removal estimates the background from the four corners. It works best on simple, evenly lit backgrounds and is not AI segmentation.</p></div>}
    {!isPdf && slug === 'favicon-generator' && <div className="file-settings-grid"><p className="file-hint full-span">PNG sizes: 16, 32, 48, 64, 128, 180, 192, and 512 px, plus an ICO bundle with 16–64 px images.</p></div>}
    {!isPdf && slug === 'social-media-resizer' && <div className="file-settings-grid"><label className="file-field full-span"><span>Platform preset</span><select value={socialPreset} onChange={event => setSocialPreset(event.target.value)}>{Array.from(new Set(socialImagePresets.map(item => item.platform))).map(platform => <optgroup key={platform} label={platform}>{socialImagePresets.filter(item => item.platform === platform).map(item => <option key={item.id} value={item.id}>{item.name} · {item.width} × {item.height}</option>)}</optgroup>)}</select></label><label className="file-field"><span>Image fit</span><select value={socialFit} onChange={event => setSocialFit(event.target.value as typeof socialFit)}><option value="fill">Fill and crop</option><option value="fit">Fit with background</option></select></label><label className="file-field"><span>Output format</span><select value={outputFormat} onChange={event => setOutputFormat(event.target.value)}><option value="original">Keep original</option>{formats.map(format => <option value={format} key={format}>{FORMAT_NAMES[format]}</option>)}</select></label>{socialFit === 'fill' && <><label className="file-field"><span>Horizontal crop position · {socialX}%</span><input type="range" min="0" max="100" value={socialX} onChange={event => setSocialX(Number(event.target.value))}/></label><label className="file-field"><span>Vertical crop position · {socialY}%</span><input type="range" min="0" max="100" value={socialY} onChange={event => setSocialY(Number(event.target.value))}/></label></>}<p className="file-hint full-span">Output dimensions: {activePreset.width} × {activePreset.height} px.</p></div>}
    {!isPdf && ['image-resizer', 'image-cropper', 'social-media-resizer'].includes(slug) && <div className="file-settings-grid"><label className="file-field"><span>Encoding quality · {Math.round(quality * 100)}%</span><input type="range" min="0.3" max="1" step="0.05" value={quality} onChange={event => setQuality(Number(event.target.value))}/></label></div>}

    {pageTool && busy && files.length > 0 && thumbnails.length === 0 && <section className="page-selection-section"><div className="file-section-heading"><div><h3>Preparing page thumbnails</h3><p>PDF pages are being read and rendered locally.</p></div></div><div className="file-skeleton" aria-hidden="true"><span/><span/><span/></div></section>}
    {pageTool && thumbnails.length > 0 && <section className="page-selection-section"><div className="file-section-heading"><div><h3>Page preview</h3><p>Select pages to include in the operation. Click page arrows to rotate pages.</p></div><span>{selectedCount}/{pageCount}</span></div><PageGrid pages={thumbnails} selected={pageSelection} onToggle={togglePage} rotations={slug === 'rotate-pdf' ? rotations : undefined} onRotate={slug === 'rotate-pdf' ? rotatePage : undefined} showSelection={slug !== 'rotate-pdf'}/></section>}

    {isPdf && slug === 'split-pdf' && <div className="file-action-row"><button type="button" className="secondary-button" onClick={() => setSelectedPages(Array.from({ length: pageCount }, (_, index) => index + 1))}>Split every page</button></div>}
    {slug === 'image-to-base64' && base64Mode === 'encode' && files[0] && <p className="file-hint">File size: {formatFileSize(files[0].size)}. Base64 output is approximately 33% larger than the source.</p>}

    {busy && <div className="processing-status" role="status" aria-live="polite"><div className="processing-label"><span>{status || 'Processing locally'}</span>{progress !== null && <strong>{progress}%</strong>}</div>{progress !== null ? <progress max={100} value={progress} aria-label={`${status}: ${progress}%`}/> : <span className="processing-indeterminate" aria-hidden="true"/>}</div>}
    {error && (files.length > 0 || slug === 'image-to-base64') && <p className="file-error" role="alert">{error}</p>}
    {status && !busy && <p className="processing-complete" role="status"><Check size={16}/>{status}</p>}
    <div className="file-tool-actions"><button type="button" className="primary-button" onClick={() => void process()} disabled={!canProcess}>{busy ? 'Processing…' : slug === 'image-compressor' ? 'Compress image' : slug === 'image-cropper' ? 'Crop image' : 'Preview result'}</button>{(files.length > 0 || base64Input) && <button type="button" className="secondary-button" onClick={() => { void updateFiles([]); setWatermarkFile([]); setBase64Input(''); setPageRange(''); setOutputs([]); setStatus(''); setError('') }} disabled={busy}><X size={15}/> Reset</button>}</div>

    {slug === 'compress-pdf' && outputs.length > 0 && files[0] && <div className="file-size-comparison"><span>Original<strong>{formatFileSize(files[0].size)}</strong></span><span>Compressed<strong>{formatFileSize(outputs[0].blob.size)}</strong></span><span>Change<strong>{outputs[0].blob.size < files[0].size ? `${formatFileSize(files[0].size - outputs[0].blob.size)} smaller` : 'No size reduction'}</strong></span></div>}
    {slug === 'image-to-base64' && base64Mode === 'encode' && outputs.length > 0 && files[0] && <div className="file-size-comparison"><span>Image<strong>{formatFileSize(files[0].size)}</strong></span><span>Base64 text<strong>{formatFileSize(outputs[0].blob.size)}</strong></span></div>}
    {slug === 'image-to-base64' && base64Mode === 'encode' && outputs.length > 0 && <button type="button" className="secondary-button" onClick={async () => { try { await navigator.clipboard.writeText(base64Input); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { setError('Clipboard access was unavailable. Select and copy the text preview instead.') } }}>{copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? 'Copied' : 'Copy Base64'}</button>}
    {slug === 'image-compressor' && outputs.length > 0 && files[0] && <BeforeAfterPreview file={files[0]} output={outputs[0]}/>}
    {slug === 'image-compressor' && compressionStats.length > 0 && <div className="file-size-comparison">{compressionStats.map(({ output, original, saved, reduction, size, format, retained, compressionStatus }) => <span key={output.name}>{original?.name || output.name}<strong>Original: {formatFileSize(original?.size || 0)} · Output: {formatFileSize(output.blob.size)} · {saved > 0 ? `Saved ${formatFileSize(saved)} (${reduction.toFixed(1)}%)` : 'No size reduction'} · {format} · {size ? `${size.width} × ${size.height} px` : 'dimensions unavailable'} · {compressionStatus || (retained ? 'Original file retained.' : 'Compression completed.')}</strong></span>)}</div>}
    <ResultPanel outputs={outputs} busy={busy} onZip={() => void downloadZip()} zipBusy={zipBusy}/>
    {slug === 'favicon-generator' && faviconTags && <div className="file-field favicon-tags"><span>HTML favicon tags</span><textarea rows={5} readOnly value={faviconTags}/><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(faviconTags)}><Clipboard size={15}/> Copy tags</button></div>}
    <aside className="local-processing-note"><strong>Your files are processed directly in your browser. They are not uploaded to Digitalivez servers.</strong><span>Most browsers allow local processing up to 100 MB per file. Processing time and memory use depend on device capabilities and document size.</span></aside>
  </div>
}
