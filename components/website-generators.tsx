'use client'

import { useMemo, useState } from 'react'
import type { Tool } from '@/lib/tools'

const schemaTypes = ['Organization', 'Person', 'LocalBusiness', 'WebSite', 'WebPage', 'Article', 'BlogPosting', 'Product', 'Service', 'BreadcrumbList', 'FAQPage'] as const
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!)
const validUrl = (value: string) => { try { const parsed = new URL(value); return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password } catch { return false } }
const escapeRegex = (value: string) => [...value].map(character => character === String.fromCharCode(92) || '^$+?.()[]{}|'.includes(character) ? String.fromCharCode(92) + character : character).join('')
const markdownText = (value: string) => value.replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const parseCsvFirstColumn = (text: string) => {
  const rows: string[] = []
  let firstCell = ''
  let cellIndex = 0
  let quoted = false
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index] ?? '\n'
    if (character === '"' && quoted && text[index + 1] === '"') { if (cellIndex === 0) firstCell += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) cellIndex += 1
    else if ((character === '\n' || character === '\r') && !quoted) { if (firstCell.trim()) rows.push(firstCell.trim()); firstCell = ''; cellIndex = 0; if (character === '\r' && text[index + 1] === '\n') index += 1 }
    else if (cellIndex === 0) firstCell += character
  }
  return rows.filter((value, index) => !(index === 0 && /^(url|loc|link)$/i.test(value)))
}
const evaluateRobots = (text: string, path: string, userAgent: string) => {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = []
  let group = { agents: [] as string[], rules: [] as { allow: boolean; pattern: string }[] }
  const saveGroup = () => { if (group.agents.length) groups.push(group); group = { agents: [], rules: [] } }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) { if (group.rules.length) saveGroup(); continue }
    const [rawName, ...rest] = line.split(':')
    const name = rawName.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (name === 'user-agent' && value) { if (group.rules.length) saveGroup(); group.agents.push(value.toLowerCase()) }
    else if ((name === 'allow' || name === 'disallow') && value) group.rules.push({ allow: name === 'allow', pattern: value })
  }
  saveGroup()
  const normalizedAgent = userAgent.toLowerCase()
  const specific = groups.filter(item => item.agents.some(agent => agent !== '*' && normalizedAgent.includes(agent)))
  const applicable = specific.length ? specific : groups.filter(item => item.agents.includes('*'))
  const matches = applicable.flatMap(item => item.rules).filter(rule => {
    const anchored = rule.pattern.endsWith('$')
    const rawPattern = rule.pattern.slice(0, anchored ? -1 : undefined)
    const pattern = rawPattern.split('*').map(escapeRegex).join('.*')
    try { return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path) } catch { return false }
  }).sort((left, right) => right.pattern.replace(/[\\*$]/g, '').length - left.pattern.replace(/[\\*$]/g, '').length || Number(right.allow) - Number(left.allow))
  return matches.length ? !matches[0].allow : null
}

export function WebsiteGenerator({ tool }: { tool: Tool }) {
  const slug = tool.route.split('/').at(-1)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [schemaType, setSchemaType] = useState<(typeof schemaTypes)[number]>('Organization')
  const [schemaName, setSchemaName] = useState('')
  const [schemaUrl, setSchemaUrl] = useState('')
  const [schemaDescription, setSchemaDescription] = useState('')
  const [schemaAuthor, setSchemaAuthor] = useState('')
  const [schemaImage, setSchemaImage] = useState('')
  const [schemaBrand, setSchemaBrand] = useState('')
  const [schemaTelephone, setSchemaTelephone] = useState('')
  const [schemaAddress, setSchemaAddress] = useState('')
  const [schemaPrice, setSchemaPrice] = useState('')
  const [schemaCurrency, setSchemaCurrency] = useState('USD')
  const [schemaAvailability, setSchemaAvailability] = useState('https://schema.org/InStock')
  const [schemaServiceType, setSchemaServiceType] = useState('')
  const [schemaFaq, setSchemaFaq] = useState('')
  const [schemaBreadcrumbs, setSchemaBreadcrumbs] = useState('')
  const [schemaPublished, setSchemaPublished] = useState('')
  const [llmsEditedOutput, setLlmsEditedOutput] = useState<string | null>(null)
  const [robotsRules, setRobotsRules] = useState('User-agent: *\nDisallow: /admin/')
  const [sitemapUrl, setSitemapUrl] = useState('')
  const [samplePath, setSamplePath] = useState('/admin/settings')
  const [sampleAgent, setSampleAgent] = useState('Googlebot')
  const [sitemapInput, setSitemapInput] = useState('')
  const [llmsName, setLlmsName] = useState('')
  const [llmsUrl, setLlmsUrl] = useState('')
  const [llmsDescription, setLlmsDescription] = useState('')
  const [llmsPurpose, setLlmsPurpose] = useState('')
  const [llmsPages, setLlmsPages] = useState('')
  const [llmsResources, setLlmsResources] = useState('')
  const [lastModified, setLastModified] = useState('')

  const schemaOutput = useMemo(() => {
    const schema: Record<string, unknown> = { '@context': 'https://schema.org', '@type': schemaType }
    if (schemaType === 'FAQPage') {
      schema.mainEntity = schemaFaq.split('\n').map(line => line.split('|').map(value => value.trim())).filter(parts => parts.length >= 2 && parts[0] && parts.slice(1).join('|').trim()).map(([question, ...answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer.join('|').trim() } }))
    } else if (schemaType === 'BreadcrumbList') {
      schema.itemListElement = schemaBreadcrumbs.split('\n').map(line => line.split('|').map(value => value.trim())).filter(parts => parts.length >= 2 && parts[0] && validUrl(parts[1])).map(([name, item], index) => ({ '@type': 'ListItem', position: index + 1, name, item }))
    } else {
      if (schemaName.trim()) schema[schemaType === 'Article' || schemaType === 'BlogPosting' ? 'headline' : 'name'] = schemaName.trim()
      if (schemaUrl.trim()) schema.url = schemaUrl.trim()
      if (schemaDescription.trim()) schema.description = schemaDescription.trim()
      if (schemaImage.trim()) schema.image = schemaImage.trim()
      if (schemaAuthor.trim() && ['Article', 'BlogPosting'].includes(schemaType)) schema.author = { '@type': 'Person', name: schemaAuthor.trim() }
      if (schemaPublished && ['Article', 'BlogPosting'].includes(schemaType)) schema.datePublished = schemaPublished
      if (schemaType === 'Product') {
        if (schemaBrand.trim()) schema.brand = { '@type': 'Brand', name: schemaBrand.trim() }
        if (schemaPrice.trim() && Number.isFinite(Number(schemaPrice)) && Number(schemaPrice) >= 0) schema.offers = { '@type': 'Offer', price: Number(schemaPrice), priceCurrency: schemaCurrency.trim().toUpperCase(), availability: schemaAvailability, ...(schemaUrl.trim() ? { url: schemaUrl.trim() } : {}) }
      }
      if (schemaType === 'LocalBusiness') {
        if (schemaTelephone.trim()) schema.telephone = schemaTelephone.trim()
        const [streetAddress, addressLocality, addressRegion, postalCode, addressCountry] = schemaAddress.split('|').map(value => value.trim())
        const address: Record<string, string> = {}
        if (streetAddress) address.streetAddress = streetAddress
        if (addressLocality) address.addressLocality = addressLocality
        if (addressRegion) address.addressRegion = addressRegion
        if (postalCode) address.postalCode = postalCode
        if (addressCountry) address.addressCountry = addressCountry
        if (Object.keys(address).length) schema.address = { '@type': 'PostalAddress', ...address }
      }
      if (schemaType === 'Service') {
        if (schemaServiceType.trim()) schema.serviceType = schemaServiceType.trim()
        if (schemaAuthor.trim()) schema.provider = { '@type': 'Organization', name: schemaAuthor.trim() }
      }
    }
    return JSON.stringify(schema, null, 2)
  }, [schemaType, schemaName, schemaUrl, schemaDescription, schemaImage, schemaAuthor, schemaBrand, schemaPrice, schemaCurrency, schemaAvailability, schemaTelephone, schemaAddress, schemaServiceType, schemaFaq, schemaBreadcrumbs, schemaPublished])

  const schemaWarning = useMemo(() => {
    if (schemaUrl && !validUrl(schemaUrl)) return 'The page URL must be a valid HTTP or HTTPS URL.'
    if (schemaImage && !validUrl(schemaImage)) return 'The image URL must be a valid HTTP or HTTPS URL.'
    if (schemaType === 'FAQPage' && !schemaOutput.includes('"@type": "Question"')) return 'Add at least one question and answer using Question | Answer on each line.'
    if (schemaType === 'BreadcrumbList' && !schemaOutput.includes('"@type": "ListItem"')) return 'Add at least one breadcrumb with a valid URL using Label | URL on each line.'
    if (['Article', 'BlogPosting'].includes(schemaType) && !schemaName.trim()) return 'Add an accurate article headline before using this markup.'
    if (schemaType === 'Product' && (!schemaName.trim() || !schemaImage.trim() || !schemaPrice.trim() || !Number.isFinite(Number(schemaPrice)) || Number(schemaPrice) < 0 || !/^[A-Za-z]{3}$/.test(schemaCurrency))) return 'Product markup needs an accurate name, image URL, non-negative price, and three-letter currency code.'
    if (schemaType === 'LocalBusiness' && !schemaName.trim()) return 'Add the actual business name before using this markup.'
    return ''
  }, [schemaOutput, schemaType, schemaName, schemaUrl, schemaImage, schemaPrice, schemaCurrency])

  const sitemapOutput = useMemo(() => {
    const entries = sitemapInput.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    const validEntries = entries.filter(validUrl)
    const urls = [...new Set(validEntries.map(value => { const url = new URL(value); url.hash = ''; return url.href }))]
    const header = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    const footer = '\n</urlset>'
    const encoder = new TextEncoder()
    let bytes = encoder.encode(header + footer).length
    const included: string[] = []
    for (const url of urls) {
      const entry = `  <url>\n    <loc>${escapeXml(url)}</loc>${lastModified ? `\n    <lastmod>${lastModified}</lastmod>` : ''}\n  </url>\n`
      const entryBytes = encoder.encode(entry).length
      if (included.length >= 50000 || bytes + entryBytes > 50 * 1024 * 1024) break
      included.push(entry)
      bytes += entryBytes
    }
    return { invalid: entries.length - validEntries.length, duplicates: validEntries.length - urls.length, count: included.length, omitted: urls.length - included.length, text: `${header}${included.join('')}${footer}` }
  }, [sitemapInput, lastModified])

  const importSitemapCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setMessage('Choose a CSV file under 5 MB.'); input.value = ''; return }
    try {
      const urls = parseCsvFirstColumn(await file.text())
      setSitemapInput(current => [...current.split(/\r?\n/).map(value => value.trim()).filter(Boolean), ...urls].join('\n'))
      setMessage(`${urls.length} URL entr${urls.length === 1 ? 'y' : 'ies'} imported from CSV.`)
    } catch { setMessage('The selected CSV file could not be read.') }
    input.value = ''
  }

  const llmsOutput = useMemo(() => {
    const pages = llmsPages.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [url, ...description] = line.split('|').map(part => part.trim())
      return validUrl(url) ? `- [${markdownText(url)}](${url})${description.length ? `: ${description.map(markdownText).join(' | ')}` : ''}` : `- ${markdownText(url)}${description.length ? `: ${description.map(markdownText).join(' | ')}` : ''}`
    })
    const resources = llmsResources.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [label, url] = line.split('|').map(part => part.trim())
      return url && validUrl(url) ? `- [${markdownText(label)}](${url})` : `- ${markdownText(label)}${url ? `: ${markdownText(url)}` : ''}`
    })
    return [`# ${markdownText(llmsName.trim() || 'Website name')}`, llmsDescription.trim(), llmsUrl.trim() && `Website: ${llmsUrl.trim()}`, llmsPurpose.trim() && `## Purpose\n\n${llmsPurpose.trim()}`, pages.length > 0 && `## Important pages\n\n${pages.join('\n')}`, resources.length > 0 && `## Resources\n\n${resources.join('\n')}`].filter(Boolean).join('\n\n')
  }, [llmsName, llmsUrl, llmsDescription, llmsPurpose, llmsPages, llmsResources])

  const robotsOutput = useMemo(() => {
    const rules = robotsRules.split(/\r?\n/).filter(line => !/^\s*sitemap\s*:/i.test(line)).join('\n').trim()
    const sitemapLine = sitemapUrl.trim() && validUrl(sitemapUrl.trim()) ? `Sitemap: ${sitemapUrl.trim()}` : ''
    return [rules, sitemapLine].filter(Boolean).join('\n\n')
  }, [robotsRules, sitemapUrl])
  const output = slug === 'schema-markup-generator' ? schemaOutput : slug === 'robots-txt-generator' ? robotsOutput : slug === 'sitemap-xml-generator' ? sitemapOutput.text : llmsEditedOutput ?? llmsOutput
  const copyOutput = async () => {
    try { await navigator.clipboard.writeText(output); setCopied(true); setMessage('Copied to clipboard.'); window.setTimeout(() => setCopied(false), 1800) }
    catch { setMessage('Clipboard access is unavailable. Select and copy the output instead.') }
  }
  const download = () => {
    const mimeType = slug === 'sitemap-xml-generator' ? 'application/xml' : slug === 'schema-markup-generator' ? 'application/ld+json' : 'text/plain'
    const file = new Blob([output], { type: `${mimeType};charset=utf-8` })
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = slug === 'robots-txt-generator' ? 'robots.txt' : slug === 'sitemap-xml-generator' ? 'sitemap.xml' : slug === 'llms-txt-generator' ? 'llms.txt' : 'schema.json'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('File downloaded.')
  }
  const reset = () => {
    setMessage('')
    setCopied(false)
    if (slug === 'schema-markup-generator') {
      setSchemaType('Organization'); setSchemaName(''); setSchemaUrl(''); setSchemaDescription(''); setSchemaAuthor(''); setSchemaBrand(''); setSchemaImage(''); setSchemaTelephone(''); setSchemaAddress(''); setSchemaPrice(''); setSchemaCurrency('USD'); setSchemaAvailability('https://schema.org/InStock'); setSchemaServiceType(''); setSchemaFaq(''); setSchemaBreadcrumbs(''); setSchemaPublished('')
    } else if (slug === 'robots-txt-generator') { setRobotsRules('User-agent: *\nDisallow: /admin/'); setSitemapUrl(''); setSamplePath('/admin/settings'); setSampleAgent('Googlebot') }
    else if (slug === 'sitemap-xml-generator') { setSitemapInput(''); setLastModified('') }
    else { setLlmsName(''); setLlmsUrl(''); setLlmsDescription(''); setLlmsPurpose(''); setLlmsPages(''); setLlmsResources(''); setLlmsEditedOutput(null) }
  }
  const deniedSample = useMemo(() => {
    try {
      const url = samplePath.trim().startsWith('http') ? new URL(samplePath.trim()) : new URL(samplePath.trim().startsWith('/') ? samplePath.trim() : `/${samplePath.trim()}`, 'https://example.com')
      if (!['http:', 'https:'].includes(url.protocol)) return null
      return evaluateRobots(robotsRules, url.pathname + url.search, sampleAgent)
    } catch { return null }
  }, [robotsRules, samplePath, sampleAgent])

  return <section className="calculator-box website-generator" aria-labelledby="generator-title">
    <div className="calc-head"><div><span className="eyebrow">LOCAL WEBSITE TOOL</span><h2 id="generator-title">{tool.name}</h2><p>Generate and preview your file in this browser. Nothing is uploaded.</p></div></div>
    <div className="calc-body">
      {slug === 'schema-markup-generator' && <div className="generator-fields">
        <label className="field"><span>Schema type</span><select value={schemaType} onChange={event => setSchemaType(event.target.value as (typeof schemaTypes)[number])}>{schemaTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        {!['FAQPage', 'BreadcrumbList'].includes(schemaType) && <>
          <label className="field"><span>{['Article', 'BlogPosting'].includes(schemaType) ? 'Article headline' : 'Name'}</span><input maxLength={200} value={schemaName} onChange={event => setSchemaName(event.target.value)} placeholder="Use the exact name shown on your website" /></label>
          <label className="field"><span>Website or page URL (optional)</span><input type="url" value={schemaUrl} onChange={event => setSchemaUrl(event.target.value)} placeholder="https://example.com" /></label>
          <label className="field"><span>Description (optional)</span><textarea maxLength={1000} value={schemaDescription} onChange={event => setSchemaDescription(event.target.value)} rows={3} placeholder="A concise, accurate description" /></label>
        </>}
        {['Article', 'BlogPosting'].includes(schemaType) && <>
          <label className="field"><span>Author name (optional)</span><input maxLength={200} value={schemaAuthor} onChange={event => setSchemaAuthor(event.target.value)} /></label>
          <label className="field"><span>Publication date (optional)</span><input type="date" value={schemaPublished} onChange={event => setSchemaPublished(event.target.value)} /></label>
        </>}
        {['Article', 'BlogPosting', 'Product', 'LocalBusiness'].includes(schemaType) && <label className="field"><span>{schemaType === 'Product' ? 'Product image URL' : 'Image URL (optional)'}</span><input type="url" value={schemaImage} onChange={event => setSchemaImage(event.target.value)} placeholder="https://example.com/image.jpg" /></label>}
        {schemaType === 'Product' && <>
          <label className="field"><span>Brand (optional)</span><input maxLength={200} value={schemaBrand} onChange={event => setSchemaBrand(event.target.value)} /></label>
          <label className="field"><span>Price</span><input type="number" min="0" step="any" value={schemaPrice} onChange={event => setSchemaPrice(event.target.value)} placeholder="49.99" /></label>
          <label className="field"><span>Currency (ISO 4217)</span><input maxLength={3} value={schemaCurrency} onChange={event => setSchemaCurrency(event.target.value.toUpperCase())} placeholder="USD" /></label>
          <label className="field"><span>Availability</span><select value={schemaAvailability} onChange={event => setSchemaAvailability(event.target.value)}>{['InStock', 'OutOfStock', 'PreOrder', 'BackOrder', 'Discontinued'].map(value => <option key={value} value={`https://schema.org/${value}`}>{value.replace(/([A-Z])/g, ' $1').trim()}</option>)}</select></label>
        </>}
        {schemaType === 'LocalBusiness' && <>
          <label className="field"><span>Telephone (optional)</span><input type="tel" maxLength={40} value={schemaTelephone} onChange={event => setSchemaTelephone(event.target.value)} /></label>
          <label className="field"><span>Address (optional: street | city | region | postal code | country)</span><input maxLength={500} value={schemaAddress} onChange={event => setSchemaAddress(event.target.value)} placeholder="123 Main St | Austin | TX | 78701 | US" /></label>
        </>}
        {schemaType === 'Service' && <>
          <label className="field"><span>Service type (optional)</span><input maxLength={200} value={schemaServiceType} onChange={event => setSchemaServiceType(event.target.value)} placeholder="Consulting" /></label>
          <label className="field"><span>Provider organization (optional)</span><input maxLength={200} value={schemaAuthor} onChange={event => setSchemaAuthor(event.target.value)} /></label>
        </>}
        {schemaType === 'FAQPage' && <label className="field"><span>Questions and answers (one per line: Question | Answer)</span><textarea maxLength={10000} value={schemaFaq} onChange={event => setSchemaFaq(event.target.value)} rows={6} placeholder={'What are your hours? | We are open Monday to Friday.'} /></label>}
        {schemaType === 'BreadcrumbList' && <label className="field"><span>Breadcrumbs (one per line: label | absolute URL)</span><textarea maxLength={5000} value={schemaBreadcrumbs} onChange={event => setSchemaBreadcrumbs(event.target.value)} rows={5} placeholder={'Home | https://example.com/\nProducts | https://example.com/products/'} /></label>}
        <p className={schemaWarning ? 'generator-warning' : 'generator-note'} role={schemaWarning ? 'alert' : 'status'}>{schemaWarning || 'Only supplied information is included. Valid structured data does not guarantee search rich results.'}</p>
      </div>}
      {slug === 'robots-txt-generator' && <div className="generator-fields">
        <label className="field"><span>Start from a preset</span><select defaultValue="custom" onChange={event => { if (event.target.value === 'allow') setRobotsRules(['User-agent: *', 'Allow: /'].join('\n')); if (event.target.value === 'private') setRobotsRules(['User-agent: *', 'Disallow: /admin/', 'Disallow: /private/'].join('\n')); if (event.target.value === 'block') setRobotsRules(['User-agent: *', 'Disallow: /'].join('\n')) }}><option value="custom">Keep current rules</option><option value="allow">Allow all paths</option><option value="private">Block common private paths</option><option value="block">Block the whole site</option></select></label>
        <label className="field"><span>Robots rules</span><textarea maxLength={20000} value={robotsRules} onChange={event => setRobotsRules(event.target.value)} rows={7} spellCheck={false} /></label>
        <label className="field"><span>Sitemap URL (optional)</span><input type="url" value={sitemapUrl} onChange={event => setSitemapUrl(event.target.value)} placeholder="https://example.com/sitemap.xml" /></label>
        {sitemapUrl && !validUrl(sitemapUrl) && <p className="generator-warning" role="alert">Enter an absolute HTTP or HTTPS sitemap URL, or clear the field.</p>}
        <label className="field"><span>Test user-agent</span><input maxLength={128} value={sampleAgent} onChange={event => setSampleAgent(event.target.value)} placeholder="Googlebot" /></label>
        <label className="field"><span>Test a path</span><input maxLength={2048} value={samplePath} onChange={event => setSamplePath(event.target.value)} placeholder="/admin/" /></label>
        {robotsRules.split('\n').some(line => line.trim().toLowerCase() === 'disallow: /') && <p className="generator-warning" role="alert">Warning: this rule blocks crawling of the entire site for the matching user-agent.</p>}
        <p className="generator-note" role="status">{deniedSample === null ? 'No matching rule was found for this user-agent and path.' : deniedSample ? 'The most-specific matching rule disallows this path.' : 'The most-specific matching rule allows this path.'} Rules are crawler hints, not access control. This preview handles common wildcards and Allow precedence, but crawler implementations can differ.</p>
      </div>}
      {slug === 'sitemap-xml-generator' && <div className="generator-fields">
        <label className="field"><span>Page URLs (one absolute URL per line)</span><textarea maxLength={2000000} value={sitemapInput} onChange={event => setSitemapInput(event.target.value)} rows={7} placeholder={'https://example.com/\nhttps://example.com/about'} spellCheck={false} /></label>
        <label className="field"><span>Import URL CSV (first column)</span><input type="file" accept=".csv,text/csv" onChange={importSitemapCsv} /></label>
        <label className="field"><span>Last modified date (optional, shared by all URLs)</span><input type="date" value={lastModified} onChange={event => setLastModified(event.target.value)} /></label>
        <p className={sitemapOutput.invalid || sitemapOutput.omitted ? 'generator-warning' : 'generator-note'} role={sitemapOutput.invalid || sitemapOutput.omitted ? 'alert' : 'status'}>{sitemapOutput.count} unique valid URLs included; {sitemapOutput.duplicates} duplicate URL{sitemapOutput.duplicates === 1 ? '' : 's'} removed; {sitemapOutput.invalid} invalid URL{sitemapOutput.invalid === 1 ? '' : 's'} ignored; {sitemapOutput.omitted} valid URL{sitemapOutput.omitted === 1 ? '' : 's'} omitted to respect sitemap limits. This tool does not crawl your website. Larger sites need multiple sitemap files and an index.</p>
      </div>}
      {slug === 'llms-txt-generator' && <div className="generator-fields">
        <label className="field"><span>Website name</span><input value={llmsName} onChange={event => setLlmsName(event.target.value)} placeholder="Example Studio" /></label>
        <label className="field"><span>Website URL (optional)</span><input type="url" value={llmsUrl} onChange={event => setLlmsUrl(event.target.value)} placeholder="https://example.com" /></label>
        <label className="field"><span>Website description</span><textarea value={llmsDescription} onChange={event => setLlmsDescription(event.target.value)} rows={2} placeholder="What visitors can find on this website" /></label>
        <label className="field"><span>Main purpose</span><textarea value={llmsPurpose} onChange={event => setLlmsPurpose(event.target.value)} rows={2} placeholder="Describe the website purpose accurately" /></label>
        <label className="field"><span>Important pages (one per line: URL | description)</span><textarea value={llmsPages} onChange={event => setLlmsPages(event.target.value)} rows={4} placeholder={'https://example.com/about | About our team'} /></label>
        <label className="field"><span>Resources (one per line: title | URL)</span><textarea value={llmsResources} onChange={event => setLlmsResources(event.target.value)} rows={3} placeholder={'Documentation | https://example.com/docs'} /></label>
        {((llmsUrl && !validUrl(llmsUrl)) || llmsPages.split('\\n').some(line => line.trim() && !validUrl(line.split('|')[0].trim())) || llmsResources.split('\\n').some(line => { const url = line.split('|')[1]?.trim(); return Boolean(url && !validUrl(url)) })) ? <p className="generator-warning" role="alert">Use absolute HTTP or HTTPS URLs for the website, important pages, and linked resources. Invalid entries are shown as plain text rather than links.</p> : <p className="generator-note" role="status">This file is generated only from the information you enter. Edit the preview below before downloading if needed; it does not guarantee search rankings or AI search visibility.</p>}
        {llmsEditedOutput !== null && <button type="button" className="text-button" onClick={() => setLlmsEditedOutput(null)}>Reset generated draft</button>}
      </div>}
      <div className="generator-actions"><button type="button" className="primary-button" onClick={copyOutput}>{copied ? 'Copied' : 'Copy output'}</button><button type="button" className="secondary-button" onClick={download}>Download file</button><button type="button" className="text-button" onClick={reset}>Reset</button></div>
      {message && <p className="generator-note" role="status">{message}</p>}
      <label className="field generator-output-label"><span>{slug === 'llms-txt-generator' ? 'Editable llms.txt preview' : 'Live output preview'}</span><textarea aria-label="Generated output" value={output} readOnly={slug !== 'llms-txt-generator'} onChange={event => setLlmsEditedOutput(event.target.value)} rows={Math.min(16, Math.max(8, output.split('\n').length))} spellCheck={false} /></label>
    </div>
  </section>
}
