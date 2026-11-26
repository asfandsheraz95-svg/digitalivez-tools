export type LocalOutput = { name: string; blob: Blob; kind: 'pdf' | 'image' | 'text'; compressionStatus?: string }
export type ProgressUpdate = (status: string, current: number, total: number) => void
export type PdfPagePreview = { page: number; src: string }

async function pdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  return pdfjs
}

async function openPdf(file: File) {
  const pdfjs = await pdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data })
  return { document: await loadingTask.promise, destroy: () => loadingTask.destroy() }
}

export async function countPdfPages(file: File) {
  const { document: pdf, destroy } = await openPdf(file)
  const pageCount = pdf.numPages
  await destroy()
  return pageCount
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This browser could not create the requested image format.')), type, quality))
}

export async function inspectPdf(file: File, onProgress?: ProgressUpdate): Promise<{ pageCount: number; thumbnails: PdfPagePreview[] }> {
  const { document: pdf, destroy } = await openPdf(file)
  const thumbnails: PdfPagePreview[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: Math.min(0.34, 260 / page.getViewport({ scale: 1 }).width) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not render this PDF page.')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    thumbnails.push({ page: pageNumber, src: canvas.toDataURL('image/jpeg', 0.72) })
    onProgress?.('Rendering page thumbnails', pageNumber, pdf.numPages)
    page.cleanup()
  }
  const pageCount = pdf.numPages
  await destroy()
  return { pageCount, thumbnails }
}

export async function mergePdfs(files: File[], onProgress: ProgressUpdate): Promise<LocalOutput> {
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()
  for (let index = 0; index < files.length; index += 1) {
    const source = await PDFDocument.load(await files[index].arrayBuffer())
    const pages = await merged.copyPages(source, source.getPageIndices())
    pages.forEach(page => merged.addPage(page))
    onProgress('Merging documents', index + 1, files.length)
  }
  return { name: 'merged-document.pdf', blob: new Blob([await merged.save({ useObjectStreams: true })], { type: 'application/pdf' }), kind: 'pdf' }
}

export async function splitPdf(file: File, selectedPages: number[], onProgress: ProgressUpdate): Promise<LocalOutput[]> {
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(await file.arrayBuffer())
  const results: LocalOutput[] = []
  for (let index = 0; index < selectedPages.length; index += 1) {
    const pageNumber = selectedPages[index]
    const output = await PDFDocument.create()
    const [page] = await output.copyPages(source, [pageNumber - 1])
    output.addPage(page)
    results.push({ name: `page-${String(pageNumber).padStart(3, '0')}.pdf`, blob: new Blob([await output.save({ useObjectStreams: true })], { type: 'application/pdf' }), kind: 'pdf' })
    onProgress('Extracting selected pages', index + 1, selectedPages.length)
  }
  return results
}

export async function compressPdf(file: File, quality: 'low' | 'medium' | 'high', onProgress: ProgressUpdate): Promise<{ output: LocalOutput; originalSize: number }> {
  const { PDFDocument } = await import('pdf-lib')
  const { document: source, destroy } = await openPdf(file)
  const scale = quality === 'low' ? 2 : quality === 'medium' ? 1.4 : 1.05
  const jpegQuality = quality === 'low' ? 0.84 : quality === 'medium' ? 0.66 : 0.46
  const result = await PDFDocument.create()
  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    const page = await source.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Your browser could not render this PDF page.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise
    const jpeg = await canvasBlob(canvas, 'image/jpeg', jpegQuality)
    const image = await result.embedJpg(await jpeg.arrayBuffer())
    const outputPage = result.addPage([viewport.width / scale, viewport.height / scale])
    outputPage.drawImage(image, { x: 0, y: 0, width: viewport.width / scale, height: viewport.height / scale })
    onProgress('Rendering and compressing pages', pageNumber, source.numPages)
    page.cleanup()
    canvas.width = 0
    canvas.height = 0
  }
  await destroy()
  const bytes = await result.save({ useObjectStreams: true })
  return { output: { name: 'compressed-document.pdf', blob: new Blob([bytes], { type: 'application/pdf' }), kind: 'pdf' }, originalSize: file.size }
}

export type ImagePdfOptions = { pageSize: 'a4' | 'letter' | 'fit'; orientation: 'portrait' | 'landscape'; margin: number; scaling: 'fit' | 'fill' }
export async function imagesToPdf(files: File[], options: ImagePdfOptions, onProgress: ProgressUpdate): Promise<LocalOutput> {
  const { PDFDocument } = await import('pdf-lib')
  const document = await PDFDocument.create()
  const a4: [number, number] = [595.28, 841.89]
  const letter: [number, number] = [612, 792]
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const bytes = await file.arrayBuffer()
    const image = file.type === 'image/png' || /\.png$/i.test(file.name) ? await document.embedPng(bytes) : await document.embedJpg(bytes)
    let [pageWidth, pageHeight] = options.pageSize === 'a4' ? a4 : options.pageSize === 'letter' ? letter : [image.width, image.height]
    if (options.pageSize !== 'fit' && options.orientation === 'landscape') [pageWidth, pageHeight] = [pageHeight, pageWidth]
    const page = document.addPage([pageWidth, pageHeight])
    const margin = Math.max(0, options.margin) * 72 / 25.4
    const boxWidth = Math.max(1, pageWidth - margin * 2)
    const boxHeight = Math.max(1, pageHeight - margin * 2)
    const scale = options.scaling === 'fill' ? Math.max(boxWidth / image.width, boxHeight / image.height) : Math.min(boxWidth / image.width, boxHeight / image.height)
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height })
    onProgress('Placing images on PDF pages', index + 1, files.length)
  }
  return { name: 'images-to-pdf.pdf', blob: new Blob([await document.save({ useObjectStreams: true })], { type: 'application/pdf' }), kind: 'pdf' }
}

export async function pdfToJpg(file: File, selectedPages: number[], scale: number, quality: number, onProgress: ProgressUpdate): Promise<LocalOutput[]> {
  const { document: pdf, destroy } = await openPdf(file)
  const results: LocalOutput[] = []
  for (let index = 0; index < selectedPages.length; index += 1) {
    const pageNumber = selectedPages[index]
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Your browser could not render this PDF page.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise
    results.push({ name: `page-${String(pageNumber).padStart(3, '0')}.jpg`, blob: await canvasBlob(canvas, 'image/jpeg', quality), kind: 'image' })
    onProgress('Converting PDF pages to JPG', index + 1, selectedPages.length)
    page.cleanup()
    canvas.width = 0
    canvas.height = 0
  }
  await destroy()
  return results
}

export async function rotatePdf(file: File, rotations: Record<number, number>, onProgress: ProgressUpdate): Promise<LocalOutput> {
  const { PDFDocument, degrees } = await import('pdf-lib')
  const document = await PDFDocument.load(await file.arrayBuffer())
  document.getPages().forEach((page, index) => {
    const current = page.getRotation().angle
    page.setRotation(degrees((current + (rotations[index + 1] || 0) + 360) % 360))
    onProgress('Rotating PDF pages', index + 1, document.getPageCount())
  })
  return { name: 'rotated-document.pdf', blob: new Blob([await document.save({ useObjectStreams: true })], { type: 'application/pdf' }), kind: 'pdf' }
}

export type PageNumberOptions = { start: number; pages: number[]; position: 'top' | 'bottom'; align: 'left' | 'center' | 'right'; size: number; color: string }
export async function addPdfPageNumbers(file: File, options: PageNumberOptions, onProgress: ProgressUpdate): Promise<LocalOutput> {
  const { PDFDocument, rgb } = await import('pdf-lib')
  const document = await PDFDocument.load(await file.arrayBuffer())
  const pages = document.getPages()
  const chosen = new Set(options.pages)
  let number = options.start
  for (let index = 0; index < pages.length; index += 1) {
    if (!chosen.has(index + 1)) { onProgress('Adding page numbers', index + 1, pages.length); continue }
    const page = pages[index]
    const { width, height } = page.getSize()
    const text = String(number++)
    const textWidth = text.length * options.size * 0.55
    const x = options.align === 'left' ? 28 : options.align === 'right' ? width - textWidth - 28 : (width - textWidth) / 2
    const y = options.position === 'top' ? height - options.size - 24 : 24
    const color = parseHexColor(options.color)
    page.drawText(text, { x, y, size: options.size, color: rgb(color.r / 255, color.g / 255, color.b / 255) })
    onProgress('Adding page numbers', index + 1, pages.length)
  }
  return { name: 'numbered-document.pdf', blob: new Blob([await document.save({ useObjectStreams: true })], { type: 'application/pdf' }), kind: 'pdf' }
}

export type WatermarkOptions = { text: string; size: number; color: string; opacity: number; rotation: number; position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; x?: number; y?: number; pages: number[] }
export async function watermarkPdf(file: File, options: WatermarkOptions, imageFile: File | null, onProgress: ProgressUpdate): Promise<LocalOutput> {
  const { PDFDocument, rgb, degrees } = await import('pdf-lib')
  const document = await PDFDocument.load(await file.arrayBuffer())
  const pages = document.getPages()
  const chosen = new Set(options.pages)
  const color = parseHexColor(options.color)
  const imageBytes = imageFile ? await imageFile.arrayBuffer() : null
  const image = imageBytes ? imageFile?.type === 'image/png' || imageFile?.name.toLowerCase().endsWith('.png') ? await document.embedPng(imageBytes) : await document.embedJpg(imageBytes) : null
  for (let index = 0; index < pages.length; index += 1) {
    if (!chosen.has(index + 1)) { onProgress('Applying watermark', index + 1, pages.length); continue }
    const page = pages[index]
    const { width, height } = page.getSize()
    if (image) {
      const drawWidth = Math.min(width * 0.45, image.width)
      const drawHeight = drawWidth * image.height / image.width
      const x = options.x !== undefined ? Math.max(0, Math.min(width - drawWidth, (options.x / 100) * width - drawWidth / 2)) : options.position.includes('left') ? 28 : options.position.includes('right') ? width - drawWidth - 28 : (width - drawWidth) / 2
      const y = options.y !== undefined ? Math.max(0, Math.min(height - drawHeight, height - (options.y / 100) * height - drawHeight / 2)) : options.position.includes('top') ? height - drawHeight - 28 : options.position.includes('bottom') ? 28 : (height - drawHeight) / 2
      page.drawImage(image, { x, y, width: drawWidth, height: drawHeight, opacity: options.opacity, rotate: degrees(options.rotation) })
    } else if (options.text.trim()) {
      const textWidth = options.text.length * options.size * 0.56
      const x = options.x !== undefined ? Math.max(0, Math.min(width - textWidth, (options.x / 100) * width - textWidth / 2)) : options.position.includes('left') ? 28 : options.position.includes('right') ? width - textWidth - 28 : (width - textWidth) / 2
      const y = options.y !== undefined ? Math.max(options.size, Math.min(height - 28, height - (options.y / 100) * height - options.size / 2)) : options.position.includes('top') ? height - options.size - 28 : options.position.includes('bottom') ? 28 : height / 2
      page.drawText(options.text, { x, y, size: options.size, color: rgb(color.r / 255, color.g / 255, color.b / 255), opacity: options.opacity, rotate: degrees(options.rotation) })
    }
    onProgress('Applying watermark', index + 1, pages.length)
  }
  return { name: 'watermarked-document.pdf', blob: new Blob([await document.save({ useObjectStreams: true })], { type: 'application/pdf' }), kind: 'pdf' }
}

export type ImageOperationOptions = { output: string; quality: number; targetBytes?: number; onProgress?: ProgressUpdate; width?: number; height?: number; crop?: { x: number; y: number; width: number; height: number }; background?: string; tolerance?: number; edge?: number; fitMode?: 'fit' | 'fill'; offsetX?: number; offsetY?: number; mode?: 'compress' | 'resize' | 'convert' | 'crop' | 'remove-background' | 'social' }

export async function processImage(file: File, options: ImageOperationOptions): Promise<LocalOutput> {
  const image = await decodeImage(file)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: options.mode === 'remove-background' })
  if (!context) throw new Error('Your browser could not process this image.')
  const crop = options.crop
  if (options.mode === 'crop' && crop) {
    canvas.width = Math.max(1, Math.round(crop.width))
    canvas.height = Math.max(1, Math.round(crop.height))
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
  } else if (options.mode === 'resize') {
    canvas.width = Math.max(1, Math.round(options.width || image.width))
    canvas.height = Math.max(1, Math.round(options.height || image.height))
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
  } else if (options.mode === 'social' && options.width && options.height) {
    canvas.width = options.width
    canvas.height = options.height
    context.fillStyle = options.background || '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const scale = options.fitMode === 'fit' ? Math.min(canvas.width / image.width, canvas.height / image.height) : Math.max(canvas.width / image.width, canvas.height / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const rangeX = canvas.width - drawWidth
    const rangeY = canvas.height - drawHeight
    const offsetX = Math.max(0, Math.min(100, options.offsetX ?? 50)) / 100
    const offsetY = Math.max(0, Math.min(100, options.offsetY ?? 50)) / 100
    context.drawImage(image, rangeX * offsetX, rangeY * offsetY, drawWidth, drawHeight)
  } else {
    canvas.width = image.width
    canvas.height = image.height
    context.drawImage(image, 0, 0)
  }
  if (options.mode === 'remove-background') removeBackground(context, canvas.width, canvas.height, options.tolerance || 40, options.edge || 12, options.background || 'transparent')
  const format = options.output === 'jpeg' ? 'image/jpeg' : options.output === 'png' ? 'image/png' : options.output === 'webp' ? 'image/webp' : options.output === 'avif' ? 'image/avif' : file.type || 'image/png'
  let outputCanvas = canvas
  if (format === 'image/jpeg') {
    const flattened = document.createElement('canvas')
    flattened.width = canvas.width
    flattened.height = canvas.height
    const flattenedContext = flattened.getContext('2d')
    if (!flattenedContext) throw new Error('Your browser could not flatten transparent pixels for JPG output.')
    flattenedContext.fillStyle = options.background || '#ffffff'
    flattenedContext.fillRect(0, 0, flattened.width, flattened.height)
    flattenedContext.drawImage(canvas, 0, 0)
    outputCanvas = flattened
  }
  const encode = (quality: number) => canvasBlob(outputCanvas, format, quality)
  let blob: Blob
  let compressionStatus: string | undefined
  if (options.mode === 'compress' && (format === 'image/jpeg' || format === 'image/webp') && options.targetBytes) {
    let low = 0.08
    let high = Math.max(low, Math.min(1, options.quality))
    let best: Blob | null = null
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidateQuality = (low + high) / 2
      options.onProgress?.('Adjusting image quality to approach the requested size', attempt + 1, 10)
      const candidate = await encode(candidateQuality)
      if (!best || Math.abs(candidate.size - options.targetBytes) < Math.abs(best.size - options.targetBytes)) best = candidate
      if (candidate.size > options.targetBytes) high = candidateQuality
      else low = candidateQuality
    }
    blob = best || await encode(0.08)
    if (blob.size > options.targetBytes) compressionStatus = 'The requested file size could not be achieved with this format. Showing the best available result.'
    else compressionStatus = 'The requested file-size target was reached.'
  } else {
    blob = await encode(options.quality)
  }
  if (options.mode === 'compress' && blob.size > file.size) {
    blob = file
    compressionStatus = 'No reduction was achieved. The original file is kept because encoding would make it larger.'
  } else if (options.mode === 'compress' && !compressionStatus) {
    compressionStatus = blob.size < file.size ? 'Compression completed.' : 'No size reduction was achieved; the original-size result is retained.'
  }
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png'
  const stem = file.name.replace(/\.[^.]+$/, '')
  const retainedOriginal = blob === file
  image.close()
  canvas.width = 0
  canvas.height = 0
  if (outputCanvas !== canvas) { outputCanvas.width = 0; outputCanvas.height = 0 }
  return { name: retainedOriginal ? file.name : `${stem}-${options.mode || 'processed'}.${extension}`, blob, kind: 'image', compressionStatus }
}

function removeBackground(context: CanvasRenderingContext2D, width: number, height: number, tolerance: number, edge: number, background: string) {
  const pixels = context.getImageData(0, 0, width, height)
  const data = pixels.data
  const corners = [[0, 0], [Math.max(0, width - 1), 0], [0, Math.max(0, height - 1)], [Math.max(0, width - 1), Math.max(0, height - 1)]]
  const sample = corners.map(([x, y]) => { const index = (y * width + x) * 4; return [data[index], data[index + 1], data[index + 2]] })
  const bg = [0, 1, 2].map(channel => Math.round(sample.reduce((sum, color) => sum + color[channel], 0) / sample.length))
  const replacement = background === 'transparent' ? null : parseHexColor(background)
  const softness = Math.max(1, edge)
  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.hypot(data[index] - bg[0], data[index + 1] - bg[1], data[index + 2] - bg[2])
    const alpha = Math.max(0, Math.min(255, Math.round(((distance - tolerance) / softness) * 255)))
    if (replacement) {
      const blend = alpha / 255
      data[index] = Math.round(replacement.r * (1 - blend) + data[index] * blend)
      data[index + 1] = Math.round(replacement.g * (1 - blend) + data[index + 1] * blend)
      data[index + 2] = Math.round(replacement.b * (1 - blend) + data[index + 2] * blend)
      data[index + 3] = 255
    } else data[index + 3] = Math.min(data[index + 3], alpha)
  }
  context.putImageData(pixels, 0, 0)
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('This image format could not be decoded by your browser.') }
}

function parseHexColor(value: string) {
  const hex = value.replace('#', '')
  const normalized = hex.length === 3 ? hex.split('').map(character => character + character).join('') : hex
  const parsed = Number.parseInt(normalized, 16)
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 }
}

export async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const image = await decodeImage(file)
  const size = { width: image.width, height: image.height }
  image.close()
  return size
}

export async function canEncode(type: string): Promise<boolean> {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  try { return (await canvasBlob(canvas, type)).type === type }
  catch { return false }
}

export async function makeFavicons(file: File, onProgress: ProgressUpdate): Promise<LocalOutput[]> {
  const image = await decodeImage(file)
  const sizes = [16, 32, 48, 64, 128, 180, 192, 512]
  const results: LocalOutput[] = []
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index]
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not generate favicon previews.')
    context.drawImage(image, 0, 0, size, size)
    results.push({ name: `favicon-${size}.png`, blob: await canvasBlob(canvas, 'image/png'), kind: 'image' })
    onProgress('Generating favicon sizes', index + 1, sizes.length)
  }
  results.push({ name: 'favicon.ico', blob: await pngsToIco(results.slice(0, 4).map(result => result.blob)), kind: 'image' })
  image.close()
  return results
}

async function pngsToIco(pngs: Blob[]) {
  const images = await Promise.all(pngs.map(blob => blob.arrayBuffer()))
  const headerSize = 6 + images.length * 16
  const totalSize = images.reduce((sum, image) => sum + image.byteLength, headerSize)
  const output = new ArrayBuffer(totalSize)
  const view = new DataView(output)
  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  let offset = headerSize
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    const size = [16, 32, 48, 64][index]
    view.setUint8(entry, size === 256 ? 0 : size)
    view.setUint8(entry + 1, size === 256 ? 0 : size)
    view.setUint8(entry + 2, 0)
    view.setUint8(entry + 3, 0)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, image.byteLength, true)
    view.setUint32(entry + 12, offset, true)
    new Uint8Array(output, offset, image.byteLength).set(new Uint8Array(image))
    offset += image.byteLength
  })
  return new Blob([output], { type: 'image/x-icon' })
}

export async function zipOutputs(outputs: LocalOutput[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  outputs.forEach(output => zip.file(output.name, output.blob))
  return zip.generateAsync({ type: 'blob' })
}
