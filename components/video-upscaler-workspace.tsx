'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Download, FileVideo2, LoaderCircle, MonitorX, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { Conversion, Input, Output } from 'mediabunny'
import { cancelUpscale, createUpscalerWorker, runUpscale } from '@/components/upscaler-worker-client'

type OutputFormat = 'mp4' | 'webm'
type VideoMetadata = { duration: number; width: number; height: number; hasAudio: boolean; mimeType: string; codec: string; frameRate: number | null }
type FileHandle = { createWritable(): Promise<FileSystemWritableFileStream>; getFile(): Promise<File> }
type SaveWindow = Window & { showSaveFilePicker?: (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle> }

const MODEL_NAME = 'Real-ESRGAN x4v3'
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_DURATION = 12
const MAX_INPUT_PIXELS = 1920 * 1080
const MAX_OUTPUT_PIXELS = 16_000_000
const MAX_FRAMES = 300
const MAX_BUFFER_BYTES = 120 * 1024 * 1024

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function isMobileOrTablet() {
  const userAgent = navigator.userAgent
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(userAgent) || touchMac
}

export function VideoUpscalerWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const conversionRef = useRef<Conversion | null>(null)
  const sourceUrlRef = useRef('')
  const resultUrlRef = useRef('')
  const currentJobRef = useRef<string | null>(null)
  const processedFramesRef = useRef(0)
  const cancelRef = useRef(false)
  const [device, setDevice] = useState<'checking' | 'desktop' | 'unsupported'>('checking')
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [factor, setFactor] = useState<2 | 4>(2)
  const [format, setFormat] = useState<OutputFormat>('mp4')
  const [formats, setFormats] = useState<OutputFormat[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Choose a supported video to begin. Processing stays on this device.')
  const [engineStatus, setEngineStatus] = useState('The AI model loads only when processing starts.')
  const [modelProgress, setModelProgress] = useState<{ loaded: number; total: number | null } | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processedFrames, setProcessedFrames] = useState(0)
  const [resultUrl, setResultUrl] = useState('')
  const [resultName, setResultName] = useState('')
  const [resultBytes, setResultBytes] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [directSaved, setDirectSaved] = useState(false)

  useEffect(() => {
    setDevice(isMobileOrTablet() ? 'unsupported' : 'desktop')
  }, [])

  useEffect(() => () => {
    void conversionRef.current?.cancel()
    workerRef.current?.terminate()
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
  }, [])

  const supportedFactor = (value: 2 | 4) => Boolean(metadata && metadata.width * metadata.height * value * value <= MAX_OUTPUT_PIXELS)

  const releaseResult = () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = ''
    setResultUrl('')
    setResultName('')
    setResultBytes(0)
    setElapsed(0)
    setDirectSaved(false)
  }

  const loadVideo = async (nextFile: File) => {
    if (device !== 'desktop') return
    setError('')
    releaseResult()
    if (nextFile.size > MAX_FILE_SIZE) {
      setError('This video is larger than the 100 MB safety limit. Choose a smaller file.')
      return
    }
    if (!/\.(mp4|mov|webm|m4v|mkv)$/i.test(nextFile.name) && !nextFile.type.startsWith('video/')) {
      setError('Choose a supported MP4, WebM, or compatible MOV video.')
      return
    }

    setStatus('Checking local video decoding and output encoders…')
    let input: Input | null = null
    try {
      const { ALL_FORMATS, BlobSource, Input: MediaInput, canEncodeAudio, canEncodeVideo } = await import('mediabunny')
      input = new MediaInput({ formats: ALL_FORMATS, source: new BlobSource(nextFile) })
      if (!(await input.canRead())) throw new Error('This file container is not supported. Try an MP4 or WebM file.')
      const videoTrack = await input.getPrimaryVideoTrack()
      if (!videoTrack) throw new Error('No video track was found in this file.')
      if (!(await videoTrack.canDecode())) throw new Error('This browser cannot decode the video codec in this file. Try a compatible H.264 MP4 or VP8/VP9 WebM.')
      const durationValue = await input.getDurationFromMetadata([videoTrack])
      const duration = durationValue && durationValue > 0 ? durationValue : await input.computeDuration([videoTrack])
      const [width, height, mimeType, codec, audioTrack] = await Promise.all([
        videoTrack.getDisplayWidth(),
        videoTrack.getDisplayHeight(),
        input.getMimeType(),
        videoTrack.getCodecParameterString(),
        input.getPrimaryAudioTrack(),
      ])
      let frameRate: number | null = null
      try {
        const metrics = await videoTrack.computeFrameRateMetrics({ targetPacketCount: 24 })
        if (metrics.bestGuessFrameRate > 0 && Number.isFinite(metrics.bestGuessFrameRate)) frameRate = metrics.bestGuessFrameRate
      } catch {
        frameRate = null
      }
      if (duration > MAX_DURATION) throw new Error(`Videos are limited to ${MAX_DURATION} seconds to keep browser memory use bounded. Trim the source first and try again.`)
      if (width * height > MAX_INPUT_PIXELS) throw new Error('This video exceeds the 1080p input-resolution safety limit.')
      if (frameRate && frameRate > 30) throw new Error('Videos above 30 frames per second exceed the current frame-processing limit.')
      if (frameRate && duration * frameRate > MAX_FRAMES) throw new Error(`This video is estimated to contain more than ${MAX_FRAMES} frames. Choose a shorter clip or a lower frame-rate source.`)

      const [mp4Video, mp4Audio, webmVideo, webmAudio] = await Promise.all([
        canEncodeVideo('avc'),
        audioTrack ? canEncodeAudio('aac') : Promise.resolve(true),
        canEncodeVideo('vp8'),
        audioTrack ? canEncodeAudio('opus') : Promise.resolve(true),
      ])
      const available: OutputFormat[] = []
      if (mp4Video && mp4Audio) available.push('mp4')
      if (webmVideo && webmAudio) available.push('webm')
      if (!available.length) throw new Error('This browser cannot encode a supported output while preserving the detected audio track. Try current desktop Chrome or Edge.')

      const details = { duration, width, height, hasAudio: Boolean(audioTrack), mimeType, codec: codec || 'Unknown', frameRate }
      setMetadata(details)
      setFormats(available)
      setFormat(available.includes('mp4') ? 'mp4' : 'webm')
      setFactor(2)
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
      const url = URL.createObjectURL(nextFile)
      sourceUrlRef.current = url
      setSourceUrl(url)
      setFile(nextFile)
      setProcessedFrames(0)
      processedFramesRef.current = 0
      setStatus('Video ready. Choose a supported enlargement factor and process the clip.')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'This video could not be prepared for local processing.'
      setError(message)
      setStatus('Video compatibility checks did not pass.')
    } finally {
      input?.dispose()
    }
  }

  const clearVideo = async () => {
    cancelRef.current = true
    if (currentJobRef.current) cancelUpscale(workerRef.current, currentJobRef.current)
    await conversionRef.current?.cancel().catch(() => undefined)
    conversionRef.current = null
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current)
    sourceUrlRef.current = ''
    setSourceUrl('')
    setFile(null)
    setMetadata(null)
    setFormats([])
    setProcessing(false)
    setProgress(0)
    setProcessedFrames(0)
    processedFramesRef.current = 0
    setModelProgress(null)
    setError('')
    setEngineStatus('The AI model loads only when processing starts.')
    setStatus('Choose a supported video to begin. Processing stays on this device.')
    releaseResult()
  }

  const startProcessing = async () => {
    if (!file || !metadata || processing || !supportedFactor(factor)) return
    setError('')
    releaseResult()
    setProcessing(true)
    setProgress(0)
    setProcessedFrames(0)
    processedFramesRef.current = 0
    setModelProgress(null)
    setEngineStatus('Preparing the local AI model…')
    setStatus('Preparing the source video and checking export compatibility…')
    const started = performance.now()
    const jobId = crypto.randomUUID()
    currentJobRef.current = jobId
    cancelRef.current = false

    const saveWindow = window as SaveWindow
    const predictedSize = file.size * factor * factor
    const directToDisk = predictedSize > MAX_BUFFER_BYTES && typeof saveWindow.showSaveFilePicker === 'function'
    if (predictedSize > MAX_BUFFER_BYTES && !directToDisk) {
      setError('This export is likely to use too much browser memory. Try a smaller source or a current desktop Chrome/Edge browser with direct-to-disk saving.')
      setStatus('Export was stopped before processing to protect browser memory.')
      setProcessing(false)
      currentJobRef.current = null
      return
    }

    let writable: FileSystemWritableFileStream | null = null
    let input: Input | null = null
    let conversion: Conversion | null = null
    let output: Output | null = null

    try {
      const extension = format === 'mp4' ? 'mp4' : 'webm'
      const outputName = `digitalivez-upscaled-video-${factor}x.${extension}`
      let target: import('mediabunny').BufferTarget | import('mediabunny').StreamTarget
      let handle: FileHandle | null = null
      if (directToDisk && saveWindow.showSaveFilePicker) {
        handle = await saveWindow.showSaveFilePicker({
          suggestedName: outputName,
          types: [{ description: `${format.toUpperCase()} video`, accept: { [format === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${extension}`] } }],
        })
        writable = await handle.createWritable()
        const { StreamTarget } = await import('mediabunny')
        target = new StreamTarget(writable as unknown as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true })
      } else {
        const { BufferTarget } = await import('mediabunny')
        target = new BufferTarget()
      }

      const { ALL_FORMATS, BlobSource, BufferTarget, Conversion: MediaConversion, Input: MediaInput, Mp4OutputFormat, Output: MediaOutput, Quality, WebMOutputFormat } = await import('mediabunny')
      input = new MediaInput({ formats: ALL_FORMATS, source: new BlobSource(file) })
      if (!(await input.canRead())) throw new Error('The selected video could not be read. Choose another supported file.')
      const videoTrack = await input.getPrimaryVideoTrack()
      const audioTrack = metadata.hasAudio ? await input.getPrimaryAudioTrack() : null
      if (!videoTrack || !(await videoTrack.canDecode())) throw new Error('The source video codec is no longer available for decoding in this browser.')
      workerRef.current ??= createUpscalerWorker()
      const modelWorker = workerRef.current
      let lastFrameTimestamp = Number.NEGATIVE_INFINITY
      let queue = Promise.resolve<void>(undefined)
      const processFrame = (sample: import('mediabunny').VideoSample) => {
        const work = queue.then(async () => {
          if (cancelRef.current) throw new Error('Processing cancelled.')
          if (processedFramesRef.current >= MAX_FRAMES) throw new Error(`The video exceeded the ${MAX_FRAMES}-frame safety limit. Use a shorter clip.`)
          if (!Number.isFinite(sample.timestamp) || sample.timestamp < lastFrameTimestamp) throw new Error(`Frame ${processedFramesRef.current + 1} had an invalid or out-of-order timestamp. Export was stopped rather than silently changing video timing.`)
          lastFrameTimestamp = sample.timestamp
          if (!Number.isSafeInteger(sample.displayWidth) || !Number.isSafeInteger(sample.displayHeight) || sample.displayWidth < 1 || sample.displayHeight < 1) throw new Error(`Frame ${processedFramesRef.current + 1} has invalid dimensions; export was stopped.`)
          const frameCanvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight)
          const frameContext = frameCanvas.getContext('2d')
          if (!frameContext) throw new Error('This browser could not prepare a video frame for enhancement.')
          sample.draw(frameContext, 0, 0)
          const frame = frameCanvas.transferToImageBitmap()
          const frameId = `${jobId}-${processedFramesRef.current + 1}`
          const enhanced = await runUpscale(modelWorker, frameId, frame, factor, message => {
            if (message.type === 'status') setEngineStatus(message.message)
            if (message.type === 'model-progress') {
              setModelProgress({ loaded: message.loaded, total: message.total })
              setEngineStatus('Downloading the AI model. Your video frames remain on this device.')
            }
          })
          if (cancelRef.current) {
            enhanced.image.close()
            throw new Error('Processing cancelled.')
          }
          const expectedWidth = sample.displayWidth * factor
          const expectedHeight = sample.displayHeight * factor
          if (enhanced.width !== expectedWidth || enhanced.height !== expectedHeight || enhanced.image.width !== expectedWidth || enhanced.image.height !== expectedHeight) {
            enhanced.image.close()
            throw new Error(`Frame ${processedFramesRef.current + 1} did not produce the expected ${expectedWidth} × ${expectedHeight} output. The export was stopped rather than including an incomplete frame.`)
          }
          processedFramesRef.current++
          if (processedFramesRef.current % 2 === 0 || processedFramesRef.current === 1) setProcessedFrames(processedFramesRef.current)
          return enhanced.image
        })
        queue = work.then(() => undefined, () => undefined)
        return work
      }
      const outputFormat = format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
      output = new MediaOutput({ format: outputFormat, target })
      conversion = await MediaConversion.init({
        input,
        output,
        tracks: 'primary',
        copy: false,
        video: {
          codec: format === 'mp4' ? 'avc' : 'vp8',
          quality: new Quality('high'),
          processedWidth: metadata.width * factor,
          processedHeight: metadata.height * factor,
          maximumPacketCount: 1,
          process: processFrame,
        },
        ...(audioTrack ? { audio: { codec: format === 'mp4' ? 'aac' as const : 'opus' as const, quality: new Quality('high') } } : {}),
      })
      conversionRef.current = conversion
      if (!conversion.isValid) throw new Error('The selected output format cannot encode all required tracks.')
      const discardedRequiredTrack = conversion.discardedTracks.some(({ track }) => track === videoTrack || (audioTrack && track === audioTrack))
      if (!conversion.utilizedTracks.includes(videoTrack) || (audioTrack && !conversion.utilizedTracks.includes(audioTrack)) || discardedRequiredTrack) {
        throw new Error('The browser could not keep the video and detected audio tracks in the selected output. Choose another format or desktop browser.')
      }
      if (cancelRef.current) throw new Error('Processing cancelled.')
      conversion.onProgress = value => {
        const percent = Math.max(0, Math.min(99, Math.floor(value * 100)))
        setProgress(percent)
        setStatus(`Enhancing and encoding video frames… ${percent}%`)
      }
      setStatus(`Processing with ${MODEL_NAME}. This can take several minutes on some computers.`)
      await conversion.execute()
      if (cancelRef.current) throw new Error('Processing cancelled.')
      if (processedFramesRef.current < 1) throw new Error('The conversion produced no successfully enhanced frames. No export was created.')
      setProgress(100)
      setProcessedFrames(processedFramesRef.current)

      let result: File
      if (handle) {
        result = await handle.getFile()
        setDirectSaved(true)
      } else {
        const buffer = (target as InstanceType<typeof BufferTarget>).buffer
        if (!buffer) throw new Error('The conversion finished but no video file was produced.')
        if (buffer.byteLength > MAX_BUFFER_BYTES) throw new Error('The output exceeded the browser memory limit. Use direct-to-disk saving in desktop Chrome or Edge.')
        result = new File([buffer], outputName, { type: format === 'mp4' ? 'video/mp4' : 'video/webm' })
      }
      const nextUrl = URL.createObjectURL(result)
      resultUrlRef.current = nextUrl
      setResultUrl(nextUrl)
      setResultName(outputName)
      setResultBytes(result.size)
      setElapsed((performance.now() - started) / 1000)
      setStatus(`Video enhancement complete. ${processedFramesRef.current} frames were processed and the file is ready.`)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setStatus('Save dialog cancelled. No video was processed.')
      } else if (cancelRef.current || (cause instanceof Error && cause.message.toLowerCase().includes('cancel'))) {
        setStatus('Processing cancelled. The original video is unchanged.')
      } else {
        const message = cause instanceof Error ? cause.message : 'The video could not be enhanced on this device.'
        setError(message)
        setStatus('Video upscaling could not be completed.')
        await writable?.abort().catch(() => undefined)
      }
    } finally {
      conversionRef.current = null
      input?.dispose()
        output = null
      setProcessing(false)
      currentJobRef.current = null
      cancelRef.current = false
    }
  }

  const cancelProcessing = async () => {
    cancelRef.current = true
    if (currentJobRef.current) cancelUpscale(workerRef.current, `${currentJobRef.current}-${processedFramesRef.current + 1}`)
    setStatus('Stopping frame enhancement and video encoding…')
    await conversionRef.current?.cancel().catch(() => undefined)
  }

  const downloadResult = () => {
    if (!resultUrl || directSaved) return
    const anchor = document.createElement('a')
    anchor.href = resultUrl
    anchor.download = resultName
    anchor.click()
  }

  if (device === 'checking') return <div className="upscale-device-check" role="status"><LoaderCircle size={18} className="upscale-spinner" /> Checking device support…</div>
  if (device === 'unsupported') return <section className="upscale-device-block" role="alert"><MonitorX size={30} aria-hidden="true" /><div><h2>Video upscaling is not available on this device</h2><p>PC ONLY — The Digitalivez Video Upscaler is a browser-based video processing tool designed for desktop and laptop computers. It currently does not support mobile phones or tablets. Please open this page on a PC to upscale your videos.</p></div></section>

  const progressValue = modelProgress?.total ? Math.min(100, (modelProgress.loaded / modelProgress.total) * 100) : null

  return <section className="upscale-workspace video-upscale-workspace" aria-label="Desktop AI video upscaler workspace">
    <header className="upscale-workspace-head"><div className="upscale-workspace-title"><span className="upscale-icon"><Sparkles size={19} aria-hidden="true" /></span><div><span className="eyebrow">LOCAL AI VIDEO ENHANCEMENT</span><h2>Upscale your video</h2><p>Real-ESRGAN enhances each decoded frame. Your video is never uploaded.</p></div></div><span className="upscale-privacy"><ShieldCheck size={15} aria-hidden="true" /> On-device processing</span></header>
    {error && <p className="upscale-error" role="alert">{error}</p>}
    {!file ? <div className="upscale-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const dropped = event.dataTransfer.files[0]; if (dropped) void loadVideo(dropped) }}>
      <input ref={inputRef} className="upscale-file-input" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm,.m4v,.mkv" onChange={event => { const selected = event.target.files?.[0]; if (selected) void loadVideo(selected); event.currentTarget.value = '' }} aria-label="Choose a video to upscale" />
      <span className="upscale-upload-icon"><FileVideo2 size={28} aria-hidden="true" /></span><h3>Drop a video here</h3><p>MP4, WebM, or compatible MOV · up to 100 MB</p><button type="button" className="upscale-primary-button" onClick={() => inputRef.current?.click()}>Browse video</button><small>Limits: 12 seconds, 1080p input, 30 fps, and 300 frames. Model download is about 5 MB.</small>
    </div> : <div className="video-upscale-editor">
      <div className="upscale-source-summary"><div className="upscale-file-details"><span className="upscale-video-file-icon"><FileVideo2 size={22} /></span><div><strong>{file.name}</strong><span>{metadata ? `${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()} px · ${metadata.frameRate ? `${metadata.frameRate.toFixed(1)} fps` : 'frame rate not reported'} · ${formatTime(metadata.duration)} · ${formatBytes(file.size)} · ${metadata.hasAudio ? 'audio track detected' : 'no audio track'}` : 'Reading video details…'}</span></div></div><button type="button" className="upscale-icon-button" onClick={() => void clearVideo()} disabled={processing} aria-label="Remove video"><X size={17} /></button></div>
      <div className="video-upscale-preview-grid"><div><span className="upscale-preview-label">ORIGINAL</span><video src={sourceUrl} controls playsInline preload="metadata" aria-label="Original video preview" /></div>{resultUrl && <div><span className="upscale-preview-label">ENHANCED</span><video src={resultUrl} controls playsInline preload="metadata" aria-label="Enhanced video preview" />{directSaved && <span className="upscale-saved-note"><Check size={14} /> Saved to the selected location</span>}</div>}</div>
      {!resultUrl && <div className="upscale-settings"><fieldset className="upscale-factor-field"><legend>Upscaling factor</legend><div className="upscale-choice-row">{([2, 4] as const).map(value => <button key={value} type="button" className={`upscale-choice${factor === value ? ' is-selected' : ''}`} aria-pressed={factor === value} disabled={!supportedFactor(value) || processing} onClick={() => setFactor(value)}><strong>{value}×</strong><span>{value === 4 ? 'Native model output' : 'Model output, downsampled'}</span></button>)}</div><small>Maximum output: 16 megapixels. Unsupported output sizes are disabled; no frame-rate increase is applied.</small></fieldset>
        <div className="video-upscale-format"><label htmlFor="video-upscale-format">Output format</label><select id="video-upscale-format" value={format} onChange={event => setFormat(event.target.value as OutputFormat)} disabled={processing}>{formats.map(item => <option value={item} key={item}>{item.toUpperCase()} {item === 'mp4' ? '(H.264 video, AAC audio)' : '(VP8 video, Opus audio)'}</option>)}</select><small>Audio is re-encoded and included when present and when the selected browser encoders support it.</small></div>
        <div className="upscale-action-row"><button type="button" className="upscale-primary-button" onClick={() => void startProcessing()} disabled={processing || !supportedFactor(factor) || !metadata}><Sparkles size={16} aria-hidden="true" /> Upscale video {factor}×</button><span>Output: {metadata ? `${(metadata.width * factor).toLocaleString()} × ${(metadata.height * factor).toLocaleString()} px` : '—'} · actual file size depends on the source and encoder</span></div>
      </div>}
      {processing && <div className="upscale-progress" role="status" aria-live="polite"><div className="upscale-progress-heading"><LoaderCircle size={17} className="upscale-spinner" aria-hidden="true" /><span>{status}</span></div><p>{engineStatus}</p>{modelProgress && <div className="upscale-progress-track"><progress max="100" value={progressValue ?? undefined} aria-label="AI model download progress" /><small>{modelProgress.total ? `${formatBytes(modelProgress.loaded)} / ${formatBytes(modelProgress.total)}` : `${formatBytes(modelProgress.loaded)} downloaded`}</small></div>}<div className="upscale-progress-track"><progress max="100" value={progress} aria-label="Video processing progress" /><small>{progress}% · {processedFrames} frames processed{metadata?.frameRate ? ` · estimated ${Math.ceil(metadata.duration * metadata.frameRate)} total frames` : ''}</small></div><button type="button" className="upscale-secondary-button" onClick={() => void cancelProcessing()}>Cancel processing</button></div>}
      {resultUrl && metadata && <div className="upscale-result"><dl className="upscale-stats"><div><dt>Original</dt><dd>{metadata.width.toLocaleString()} × {metadata.height.toLocaleString()} px</dd><dd>{formatBytes(file.size)} · {formatTime(metadata.duration)}</dd></div><div><dt>Enhanced</dt><dd>{(metadata.width * factor).toLocaleString()} × {(metadata.height * factor).toLocaleString()} px · {factor}×</dd><dd>{formatBytes(resultBytes)} · {formatTime(metadata.duration)}</dd></div><div><dt>Processing</dt><dd>{elapsed.toFixed(1)} sec · {processedFrames} frames</dd><dd>{metadata.hasAudio ? 'Audio track retained' : 'No source audio track'}</dd></div></dl><div className="upscale-result-actions">{!directSaved && <button type="button" className="upscale-primary-button" onClick={downloadResult}><Download size={16} aria-hidden="true" /> Download enhanced video</button>}<button type="button" className="upscale-secondary-button" onClick={() => void clearVideo()}><Check size={16} aria-hidden="true" /> Process another video</button></div></div>}
    </div>}
    <p className="upscale-status" aria-live="polite">{status}</p>
  </section>
}
