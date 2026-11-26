'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Download, ImagePlus, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react'
import type QRCodeStyling from 'qr-code-styling'
import type { Gradient, Options } from 'qr-code-styling'

type ContentKind = 'website' | 'text' | 'email' | 'phone' | 'sms' | 'wifi' | 'contact' | 'whatsapp' | 'location' | 'social'
type Fields = Record<string, string>
type Palette = { foreground: string; background: string; corner: string; dots: string; gradient: boolean; pattern: string; corners: string }

const contentKinds: { value: ContentKind; label: string }[] = [
  { value: 'website', label: 'Website URL' }, { value: 'text', label: 'Plain text' }, { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone number' }, { value: 'sms', label: 'SMS' }, { value: 'wifi', label: 'Wi-Fi' },
  { value: 'contact', label: 'Contact card' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'location', label: 'Location' }, { value: 'social', label: 'Social profile' },
]
const presets: Record<string, Palette> = {
  'Digitalivez Navy': { foreground: '#17354b', background: '#ffffff', corner: '#087e64', dots: '#17354b', gradient: false, pattern: 'square', corners: 'square' },
  'Minimal Black': { foreground: '#151515', background: '#ffffff', corner: '#151515', dots: '#151515', gradient: false, pattern: 'square', corners: 'square' },
  'Modern Blue': { foreground: '#1452a4', background: '#ffffff', corner: '#0a367a', dots: '#1452a4', gradient: false, pattern: 'rounded', corners: 'extra-rounded' },
  'Luxury Gold': { foreground: '#8a641c', background: '#fffaf0', corner: '#66470d', dots: '#8a641c', gradient: false, pattern: 'classy', corners: 'square' },
  'Soft Gradient': { foreground: '#087e64', background: '#ffffff', corner: '#17354b', dots: '#087e64', gradient: true, pattern: 'rounded', corners: 'extra-rounded' },
  'Monochrome': { foreground: '#30343b', background: '#f3f5f7', corner: '#30343b', dots: '#30343b', gradient: false, pattern: 'classy-rounded', corners: 'square' },
}

const safeUrl = (value: string) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '' } catch { return '' }
}
const cleanLine = (value: string) => value.replace(/[\r\n]/g, ' ').trim()
const escapeVCard = (value: string) => cleanLine(value).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;')
const escapeXml = (value: string) => value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!)

function makePayload(kind: ContentKind, fields: Fields) {
  const required = (key: string) => (fields[key] || '').trim()
  const phone = (value: string) => value.replace(/[\s().-]/g, '')
  const validPhone = (value: string) => /^\+?[1-9]\d{4,14}$/.test(phone(value))
  switch (kind) {
    case 'website': case 'social': {
      const url = safeUrl(required('url'))
      return url ? { value: url } : { value: '', error: 'Enter a complete HTTP or HTTPS URL.' }
    }
    case 'text': return required('text') ? { value: required('text') } : { value: '', error: 'Enter the text to encode.' }
    case 'email': {
      const address = required('email')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { value: '', error: 'Enter a valid email address.' }
      const query = new URLSearchParams()
      if (required('subject')) query.set('subject', cleanLine(fields.subject))
      if (required('body')) query.set('body', cleanLine(fields.body))
      return { value: `mailto:${address}${query.size ? `?${query.toString()}` : ''}` }
    }
    case 'phone': return validPhone(required('phone')) ? { value: `tel:${phone(required('phone'))}` } : { value: '', error: 'Enter a phone number with country code, for example +14155550123.' }
    case 'sms': return validPhone(required('phone')) && required('message') ? { value: `SMSTO:${phone(required('phone'))}:${cleanLine(fields.message)}` } : { value: '', error: 'Enter a valid phone number and a message.' }
    case 'whatsapp': return validPhone(required('phone')) ? { value: `https://wa.me/${phone(required('phone'))}${required('message') ? `?text=${encodeURIComponent(cleanLine(fields.message))}` : ''}` } : { value: '', error: 'Enter a valid phone number including its country code.' }
    case 'wifi': {
      const ssid = required('ssid')
      if (!ssid) return { value: '', error: 'Enter the Wi-Fi network name (SSID).' }
      const escapeWifi = (value: string) => value.replace(/[\\;,:\"]/g, char => `\\${char}`)
      const security = fields.security || 'WPA'
      if (security !== 'nopass' && !required('password')) return { value: '', error: 'Enter the Wi-Fi password, or choose No password for an open network.' }
      return { value: `WIFI:T:${security};S:${escapeWifi(ssid)};${security === 'nopass' ? '' : `P:${escapeWifi(fields.password || '')};`}H:${fields.hidden === 'true' ? 'true' : 'false'};;` }
    }
    case 'contact': {
      const name = required('name')
      if (!name) return { value: '', error: 'Enter a contact name.' }
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVCard(name)}`]
      if (required('phone')) lines.push(`TEL;TYPE=CELL:${escapeVCard(fields.phone)}`)
      if (required('email')) lines.push(`EMAIL:${escapeVCard(fields.email)}`)
      if (required('organization')) lines.push(`ORG:${escapeVCard(fields.organization)}`)
      if (required('url')) { const url = safeUrl(required('url')); if (!url) return { value: '', error: 'Enter a valid HTTP or HTTPS website.' }; lines.push(`URL:${url}`) }
      lines.push('END:VCARD')
      return { value: lines.join('\r\n') }
    }
    case 'location': {
      const latitude = Number(required('latitude')); const longitude = Number(required('longitude'))
      if (!required('latitude') || !required('longitude') || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return { value: '', error: 'Enter a latitude from −90 to 90 and longitude from −180 to 180.' }
      return { value: `https://maps.google.com/?q=${latitude},${longitude}` }
    }
  }
}

function inputField(label: string, key: string, fields: Fields, setFields: (value: Fields) => void, type = 'text', placeholder = '') {
  return <label className="qr-field" key={key}>{label}<input type={type} value={fields[key] || ''} placeholder={placeholder} onChange={event => setFields({ ...fields, [key]: event.target.value })}/></label>
}

export function QrCodeGenerator() {
  const mountRef = useRef<HTMLDivElement>(null)
  const qrRef = useRef<QRCodeStyling | null>(null)
  const [kind, setKind] = useState<ContentKind>('website')
  const [fields, setFields] = useState<Fields>({ url: 'https://digitalivez.com' })
  const [palette, setPalette] = useState<Palette>(presets['Minimal Black'])
  const [template, setTemplate] = useState('Minimal Black')
  const [margin, setMargin] = useState(48)
  const [logo, setLogo] = useState('')
  const [logoSize, setLogoSize] = useState(18)
  const [frameLabel, setFrameLabel] = useState('Scan me')
  const [frameColor, setFrameColor] = useState('#087e64')
  const [format, setFormat] = useState<'png' | 'jpeg' | 'svg'>('png')
  const [qrReady, setQrReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const payload = useMemo(() => makePayload(kind, fields), [kind, fields])

  const options = useMemo<Partial<Options>>(() => {
    const foreground = palette.gradient ? undefined : palette.foreground
    const gradient: Gradient | undefined = palette.gradient ? { type: 'linear', rotation: 45, colorStops: [{ offset: 0, color: '#087e64' }, { offset: 1, color: '#275fc3' }] } : undefined
    const background = palette.background === 'transparent' ? 'rgba(255,255,255,0)' : palette.background
    return {
      type: 'svg', width: 720, height: 720, data: payload.value || ' ', margin,
      qrOptions: { errorCorrectionLevel: 'H' },
      image: logo || undefined,
      imageOptions: { imageSize: logo ? Math.min(22, logoSize) / 100 : 0, hideBackgroundDots: true, margin: 6, crossOrigin: 'anonymous' },
      dotsOptions: { type: palette.pattern as Options['dotsOptions'] extends { type?: infer T } ? T : never, color: foreground, gradient },
      cornersSquareOptions: { type: palette.corners as Options['cornersSquareOptions'] extends { type?: infer T } ? T : never, color: palette.corner },
      cornersDotOptions: { type: 'dot', color: palette.corner },
      backgroundOptions: { color: background, round: 0 },
    }
  }, [payload.value, palette, margin, logo, logoSize])
  useEffect(() => {
    let active = true
    setQrReady(false)
    void import('qr-code-styling').then(({ default: QRCode }) => {
      if (!active || !mountRef.current) return
      mountRef.current.replaceChildren()
      const instance = new QRCode(options)
      instance.append(mountRef.current)
      qrRef.current = instance
      setError('')
      setQrReady(true)
    }).catch(() => { if (active) setError('The QR renderer could not be loaded. Refresh the page and try again.') })
    return () => { active = false; qrRef.current = null }
  }, [options])

  useEffect(() => {
    let cancelled = false
    setScanMessage('Checking scan reliability…')
    const verify = async () => {
      if (!payload.value) { setScanMessage('Complete the required fields to generate a QR code.'); return }
      if (!qrReady) { setScanMessage('Preparing the local QR preview…'); return }
      try {
        await new Promise(resolve => setTimeout(resolve, 300))
        const instance = qrRef.current
        if (!instance) throw new Error('QR renderer is still loading')
        await instance._svgDrawingPromise
        const blob = await instance.getRawData('png')
        if (!(blob instanceof Blob)) throw new Error('QR output unavailable')
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Local QR scan is unavailable')
        context.drawImage(bitmap, 0, 0)
        const decoded = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })
        bitmap.close()
        canvas.width = 0
        canvas.height = 0
        if (!cancelled) setScanMessage(decoded?.data === payload.value ? 'Local scan check passed: the QR resolves to the exact entered content.' : 'The current design did not pass the local scan check. Switch to the Minimal Black preset, reduce the logo, or remove it.')
      } catch { if (!cancelled) setScanMessage('The QR is generated, but this browser could not complete the local scan check. Use a simple, high-contrast design for best results.') }
    }
    void verify()
    return () => { cancelled = true }
  }, [payload.value, options, qrReady])

  const chooseTemplate = (name: string) => { setTemplate(name); setPalette(presets[name]) }
  const updatePalette = (patch: Partial<Palette>) => { setPalette(current => ({ ...current, ...patch })); setTemplate('Custom') }
  const reset = () => { setKind('website'); setFields({ url: 'https://digitalivez.com' }); setPalette(presets['Minimal Black']); setTemplate('Minimal Black'); setMargin(48); setLogo(''); setLogoSize(18); setFrameLabel('Scan me'); setFrameColor('#087e64'); setFormat('png'); setError(''); setScanMessage('') }
  const loadLogo = (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('Choose a PNG, JPG, or WebP image up to 2 MB for the center logo.'); return }
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') setLogo(reader.result) }
    reader.onerror = () => setError('The logo image could not be read.')
    reader.readAsDataURL(file)
  }

  const download = async () => {
    if (!payload.value || !qrRef.current) return
    setBusy(true); setError('')
    try {
      await qrRef.current._svgDrawingPromise
      const result = await qrRef.current.getRawData(format)
      if (!(result instanceof Blob)) throw new Error('The selected export format is unavailable in this browser.')
      let blob: Blob
      if (format === 'svg') {
        const source = await result.text()
        const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
        if (parsed.querySelector('parsererror')) throw new Error('The QR vector could not be generated.')
        const inner = parsed.documentElement.innerHTML
        const framed = frameLabel.trim() ? `<rect width="720" height="840" rx="40" fill="${palette.background === 'transparent' ? '#fff' : palette.background}"/><text x="360" y="84" text-anchor="middle" font-family="Arial,sans-serif" font-size="40" font-weight="700" fill="${frameColor}">${escapeXml(frameLabel.trim())}</text><svg x="0" y="120" width="720" height="720" viewBox="0 0 720 720">${inner}</svg>` : inner
        blob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${frameLabel.trim() ? 840 : 720}" viewBox="0 0 720 ${frameLabel.trim() ? 840 : 720}">${framed}</svg>`], { type: 'image/svg+xml;charset=utf-8' })
      } else {
        const bitmap = await createImageBitmap(result)
        const hasFrame = Boolean(frameLabel.trim())
        const qrSize = bitmap.width
        const framePadding = Math.round(qrSize / 6)
        const height = hasFrame ? qrSize + framePadding : qrSize
        const canvas = document.createElement('canvas'); canvas.width = qrSize; canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) { bitmap.close(); throw new Error('Your browser could not prepare the QR download.') }
        if (format === 'jpeg' || palette.background !== 'transparent') { context.fillStyle = palette.background === 'transparent' ? '#ffffff' : palette.background; context.fillRect(0, 0, canvas.width, canvas.height) }
        if (hasFrame) { context.fillStyle = frameColor; context.font = `700 ${Math.round(qrSize / 18)}px Arial, sans-serif`; context.textAlign = 'center'; context.fillText(frameLabel.trim(), qrSize / 2, Math.round(qrSize / 8), qrSize * 0.88) }
        context.drawImage(bitmap, 0, hasFrame ? framePadding : 0, qrSize, qrSize); bitmap.close()
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The QR image could not be encoded.')), format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.96))
        canvas.width = 0; canvas.height = 0
      }
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `digitalivez-qr-code.${format === 'jpeg' ? 'jpg' : format}`; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The QR download could not be created.') }
    finally { setBusy(false) }
  }

  const changeKind = (value: ContentKind) => { setKind(value); setFields(value === 'website' ? { url: 'https://digitalivez.com' } : {}) }
  const contentFields = (() => {
    if (kind === 'website' || kind === 'social') return inputField(kind === 'website' ? 'Website URL' : 'Social profile URL', 'url', fields, setFields, 'url', 'https://example.com')
    if (kind === 'text') return <label className="qr-field qr-field-wide">Text<textarea value={fields.text || ''} onChange={event => setFields({ ...fields, text: event.target.value })} rows={4} maxLength={1800} placeholder="Write the text you want to share"/></label>
    if (kind === 'email') return <>{inputField('Email address', 'email', fields, setFields, 'email', 'name@example.com')}{inputField('Subject (optional)', 'subject', fields, setFields)}<label className="qr-field qr-field-wide">Message (optional)<textarea value={fields.body || ''} onChange={event => setFields({ ...fields, body: event.target.value })} rows={3}/></label></>
    if (kind === 'phone') return inputField('Phone number with country code', 'phone', fields, setFields, 'tel', '+14155550123')
    if (kind === 'sms' || kind === 'whatsapp') return <>{inputField('Phone number with country code', 'phone', fields, setFields, 'tel', '+14155550123')}<label className="qr-field qr-field-wide">Message (optional)<textarea value={fields.message || ''} onChange={event => setFields({ ...fields, message: event.target.value })} rows={3}/></label></>
    if (kind === 'wifi') return <>{inputField('Network name (SSID)', 'ssid', fields, setFields)}<label className="qr-field">Security<select value={fields.security || 'WPA'} onChange={event => setFields({ ...fields, security: event.target.value })}><option value="WPA">WPA / WPA2</option><option value="WEP">WEP</option><option value="nopass">No password</option></select></label>{fields.security !== 'nopass' && inputField('Password', 'password', fields, setFields, 'password')}<label className="qr-field qr-checkbox"><input type="checkbox" checked={fields.hidden === 'true'} onChange={event => setFields({ ...fields, hidden: String(event.target.checked) })}/> Hidden network</label></>
    if (kind === 'contact') return <>{inputField('Full name', 'name', fields, setFields)}{inputField('Phone (optional)', 'phone', fields, setFields, 'tel')}{inputField('Email (optional)', 'email', fields, setFields, 'email')}{inputField('Organization (optional)', 'organization', fields, setFields)}{inputField('Website (optional)', 'url', fields, setFields, 'url', 'https://example.com')}</>
    return <>{inputField('Latitude', 'latitude', fields, setFields, 'number', '37.7749')}{inputField('Longitude', 'longitude', fields, setFields, 'number', '-122.4194')}</>
  })()

  return <section className="qr-tool" aria-label="QR code generator">
    <div className="qr-tool-head"><div><span className="eyebrow">FREE · STATIC · BROWSER-BASED</span><h2>Customize your QR code</h2><p>Encode a direct link or information payload. No tracking service or account required.</p></div><button type="button" className="qr-reset" onClick={reset}><RotateCcw size={15}/> Reset design</button></div>
    <div className="qr-layout"><div className="qr-controls">
      <div className="qr-panel"><h3>1. What should the QR contain?</h3><label className="qr-field">Content type<select value={kind} onChange={event => changeKind(event.target.value as ContentKind)}>{contentKinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="qr-input-grid">{contentFields}</div>{payload.error && <p className="qr-error" role="alert">{payload.error}</p>}</div>
      <div className="qr-panel"><h3>2. Choose a design</h3><label className="qr-field">Preset<select value={template} onChange={event => chooseTemplate(event.target.value)}>{template === 'Custom' && <option value="Custom" disabled>Custom design</option>}{Object.keys(presets).map(name => <option key={name}>{name}</option>)}</select></label><div className="qr-input-grid"><label className="qr-field">Pattern<select value={palette.pattern} onChange={event => updatePalette({ pattern: event.target.value })}>{['square','rounded','dots','classy','classy-rounded','extra-rounded'].map(value => <option value={value} key={value}>{value.replace('-', ' ')}</option>)}</select></label><label className="qr-field">Foreground color<input type="color" value={palette.foreground} onChange={event => updatePalette({ foreground: event.target.value, gradient: false })}/></label><label className="qr-field">Background color<select value={palette.background} onChange={event => updatePalette({ background: event.target.value })}><option value="#ffffff">White</option><option value="#f3f5f7">Soft grey</option><option value="#fffaf0">Warm ivory</option><option value="transparent">Transparent</option></select></label><label className="qr-field">Corner color<input type="color" value={palette.corner} onChange={event => updatePalette({ corner: event.target.value })}/></label><label className="qr-field">Corner style<select value={palette.corners} onChange={event => updatePalette({ corners: event.target.value })}>{['square','dot','extra-rounded','classy-rounded'].map(value => <option value={value} key={value}>{value.replace('-', ' ')}</option>)}</select></label><label className="qr-field">Quiet zone <span>{margin}px</span><input type="range" min="24" max="80" value={margin} onChange={event => setMargin(Number(event.target.value))}/></label><label className="qr-field qr-checkbox"><input type="checkbox" checked={palette.gradient} onChange={event => updatePalette({ gradient: event.target.checked })}/> Use teal-to-blue gradient</label></div></div>
      <div className="qr-panel"><h3>3. Optional logo and frame</h3><input ref={fileRef} className="qr-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a logo" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) loadLogo(file); event.currentTarget.value = '' }}/><div className="qr-logo-controls"><button type="button" className="qr-upload" onClick={() => fileRef.current?.click()}><ImagePlus size={16}/> {logo ? 'Replace logo' : 'Add logo'}</button>{logo && <button type="button" className="qr-remove-logo" onClick={() => setLogo('')} aria-label="Remove logo"><X size={15}/></button>}<label className="qr-field">Logo size <span>{logoSize}%</span><input type="range" min="8" max="22" value={logoSize} onChange={event => setLogoSize(Number(event.target.value))} disabled={!logo}/></label></div><p className="qr-help">Logo stays below 22% of the code area. High error correction is enabled; always scan-test before printing.</p><div className="qr-input-grid"><label className="qr-field">Frame label<select value={frameLabel} onChange={event => setFrameLabel(event.target.value)}><option value="">No frame</option>{['Scan me','Visit website','Follow us','Contact us','Connect with us'].map(label => <option key={label}>{label}</option>)}</select></label><label className="qr-field">Frame color<input type="color" value={frameColor} onChange={event => setFrameColor(event.target.value)}/></label></div></div>
      <div className="qr-panel"><h3>4. Download</h3><div className="qr-download-row"><label className="qr-field">Format<select value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="png">PNG</option><option value="jpeg">JPG</option><option value="svg">SVG vector</option></select></label><button type="button" className="qr-download" onClick={() => void download()} disabled={!payload.value || busy}>{busy ? <LoaderCircle className="qr-spinner"/> : <Download size={17}/>} Download QR</button></div></div>
    </div><aside className="qr-preview-panel"><span className="eyebrow">LIVE PREVIEW</span><div className="qr-preview-frame" style={{ background: palette.background === 'transparent' ? '#fff' : palette.background }}><div className="qr-frame-label" style={{ color: frameColor, display: frameLabel ? 'block' : 'none' }}>{frameLabel}</div><div className="qr-preview-code" ref={mountRef} aria-label="Generated QR code preview"/><small>Static QR · error correction high</small></div><p className="qr-scan-status" role="status"><ShieldCheck size={16}/>{scanMessage}</p><p className="qr-warning">Always scan the exported QR with a second device before printing or sharing, especially when using a logo, gradient, or unusual background.</p></aside></div>
    {error && <p className="qr-error" role="alert">{error}</p>}
  </section>
}
