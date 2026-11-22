'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Analytics } from '@vercel/analytics/next'
import { MetaPixel } from '@/components/meta-pixel'

type ConsentChoice = 'accepted' | 'rejected' | 'unset' | 'loading'

const consentCookie = 'digitalivez_optional_tracking_consent'
const legacyConsentCookie = 'digitalivez_analytics_consent'
const cookieSettingsEvent = 'digitalivez:open-cookie-settings'

function readConsent(): ConsentChoice {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${consentCookie}=(accepted|rejected)(?:;|$)`))
  const value = match?.[1]
  return value === 'accepted' ? 'accepted' : value === 'rejected' ? 'rejected' : 'unset'
}

function saveConsent(choice: Exclude<ConsentChoice, 'unset' | 'loading'>) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${consentCookie}=${choice}; Max-Age=${60 * 60 * 24 * 180}; Path=/; SameSite=Lax${secure}`
  document.cookie = `${legacyConsentCookie}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
}

export function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice>('loading')

  useEffect(() => {
    setChoice(readConsent())
    const reopen = () => setChoice('unset')
    window.addEventListener(cookieSettingsEvent, reopen)
    return () => window.removeEventListener(cookieSettingsEvent, reopen)
  }, [])

  function choose(nextChoice: 'accepted' | 'rejected') {
    saveConsent(nextChoice)
    if (nextChoice === 'rejected' && process.env.NODE_ENV === 'production') {
      window.location.reload()
      return
    }
    setChoice(nextChoice)
  }

  return (
    <>
      {process.env.NODE_ENV === 'production' && choice === 'accepted' && <>
        <Analytics />
        <MetaPixel />
      </>}
      {choice === 'unset' && (
        <aside className="cookie-consent" aria-label="Analytics and cookie preferences" aria-live="polite">
          <div className="cookie-consent-copy">
            <strong>Choose your Analytics and Cookies preferences</strong>
            <p>Allow Analytics and Cookies? If you accept, analytics tools and Meta Pixel cookies help us understand site visits. Meta may receive page-view information and browser/device identifiers. <Link href="/privacy">Read our privacy policy</Link>.</p>
            <small>Your choice is saved in a first-party cookie for 6 months. You can change it any time in Cookie settings.</small>
          </div>
          <div className="cookie-consent-actions">
            <button type="button" className="cookie-reject" onClick={() => choose('rejected')}>Reject Analytics &amp; Cookies</button>
            <button type="button" className="cookie-accept" onClick={() => choose('accepted')}>Accept Analytics &amp; Cookies</button>
          </div>
        </aside>
      )}
    </>
  )
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(cookieSettingsEvent))
}
