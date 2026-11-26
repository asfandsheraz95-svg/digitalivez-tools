'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Calculator, ChevronDown, Menu, Search, X } from 'lucide-react'
import { tools } from '@/lib/tools'
import { openCookieSettings } from '@/components/cookie-consent'
import { SocialLinks } from '@/components/social-links'

export function Header() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const matches = query.trim() ? tools.filter(t => `${t.name} ${t.category} ${t.keywords.join(' ')}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : []

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); menuButtonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <header ref={headerRef} className="site-header"><div className="header-inner"><Link href="/" className="brand" aria-label="Digitalivez Tools home"><span className="brand-mark"><Calculator size={20}/></span><span>digitalivez<span className="brand-tools">tools</span></span></Link><nav id="primary-navigation" className={open?'nav-links nav-open':'nav-links'} aria-label="Main navigation" aria-hidden={!open} inert={!open}>{[['Home','/'],['All tools','/tools'],['Calculators','/calculators'],['Freelancer tools','/freelancer-tools'],['Business documents','/business-documents'],['PDF tools','/pdf-tools'],['Image tools','/image-tools'],['Video tools','/video-tools'],['Website & SEO tools','/website-tools'],['Marketing tools','/marketing-tools'],['Guides','/guides'],['About','/about']].map(([label, href])=><Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}</nav><div className="header-search"><Search size={18}/><input aria-label="Search tools" placeholder="Search all tools..." value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd>{matches.length>0&&<div className="search-results">{matches.map(t=><Link key={t.route} href={t.route} onClick={()=>setQuery('')}><span><strong>{t.name}</strong><small>{t.category}</small></span><ArrowRight size={15}/></Link>)}</div>}</div><button ref={menuButtonRef} type="button" className="mobile-menu" aria-label={open?'Close navigation':'Open navigation'} aria-controls="primary-navigation" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X size={21}/>:<Menu size={21}/>}</button></div></header>
}
export function Footer(){return <footer className="footer"><div className="footer-main"><div className="footer-about"><Link href="/" className="brand"><span className="brand-mark"><Calculator size={20}/></span><span>digitalivez<span className="brand-tools">tools</span></span></Link><p>Smarter tools. Better business decisions.</p><p className="muted">Free, practical tools for people building a business.</p><SocialLinks className="footer-social-links"/></div><div><h3>Explore</h3><Link href="/tools">All tools</Link><Link href="/calculators">Calculators</Link><Link href="/freelancer-tools">Freelancer tools</Link><Link href="/business-documents">Business documents</Link><Link href="/pdf-tools">PDF tools</Link><Link href="/image-tools">Image tools</Link><Link href="/video-tools">Video tools</Link><Link href="/website-tools">Website &amp; SEO tools</Link><Link href="/marketing-tools">Marketing tools</Link><Link href="/guides">Guides</Link></div><div><h3>Company</h3><Link href="/about">About</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of use</Link><Link href="/disclaimer">Disclaimer</Link><button type="button" className="cookie-settings-link" onClick={openCookieSettings}>Cookie settings</button></div><div className="footer-note"><span className="eyebrow">MADE FOR INDEPENDENTS</span><p>Useful, considered tools to help make the numbers a little clearer.</p><a href="https://digitalivez.com" target="_blank" rel="noreferrer">Visit Digitalivez <ArrowRight size={14}/></a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Digitalivez Tools</span><span>Free tools. Clearer decisions.</span></div></footer>}
