'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowUp, Check, Copy, Share2, X } from 'lucide-react'
import { SocialMark } from '@/components/social-mark'
import { socialPlatforms } from '@/lib/social-platforms'

export function FloatingActions() {
  const [showTop, setShowTop] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const pathname = usePathname()
  const pageUrl = `https://tools.digitalivez.com${pathname}`

  useEffect(() => {
    const updateScrollState = () => setShowTop(window.scrollY > 320)
    updateScrollState()
    window.addEventListener('scroll', updateScrollState, { passive: true })
    return () => window.removeEventListener('scroll', updateScrollState)
  }, [])

  async function copyPageLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyStatus('Page link copied')
    } catch {
      setCopyStatus('Copy is unavailable in this browser')
    }
  }

  return (
    <div className="floating-actions">
      {showTop && (
        <button
          type="button"
          className="floating-action-button floating-top-button"
          aria-label="Scroll to top"
          title="Scroll to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp aria-hidden="true" size={20} />
        </button>
      )}
      <button
        type="button"
        className="floating-action-button floating-share-button"
        aria-label={shareOpen ? 'Close sharing options' : 'Share Digitalivez'}
        aria-expanded={shareOpen}
        aria-controls="floating-share-panel"
        title="Share Digitalivez"
        onClick={() => {
          setShareOpen(open => !open)
          setCopyStatus('')
        }}
      >
        {shareOpen ? <X aria-hidden="true" size={20} /> : <Share2 aria-hidden="true" size={20} />}
      </button>
      {shareOpen && (
        <section id="floating-share-panel" className="floating-share-panel" aria-label="Share Digitalivez">
          <div className="floating-share-heading">
            <strong>Share</strong>
            <button type="button" aria-label="Close sharing options" onClick={() => setShareOpen(false)}>
              <X aria-hidden="true" size={17} />
            </button>
          </div>
          <div className="floating-share-links">
            {socialPlatforms.filter(platform => platform.shareUrl).map(platform => (
              <a key={platform.id} href={platform.shareUrl!(pageUrl)} target="_blank" rel="noopener noreferrer" onClick={() => setShareOpen(false)}>
                <SocialMark id={platform.id} name={platform.name} size={19} />
                <span>Share on {platform.name}</span>
              </a>
            ))}
            <button type="button" className="floating-copy-link" onClick={copyPageLink}>
              {copyStatus === 'Page link copied' ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
              <span>{copyStatus === 'Page link copied' ? 'Link copied' : 'Copy page link'}</span>
            </button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">{copyStatus}</p>
        </section>
      )}
    </div>
  )
}
