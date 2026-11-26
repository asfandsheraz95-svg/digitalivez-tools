import { socialPlatforms } from '@/lib/social-platforms'

const siteUrl = 'https://tools.digitalivez.com'

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      name: 'Digitalivez Tools',
      url: siteUrl,
      logo: `${siteUrl}/icon.svg`,
      image: `${siteUrl}/og-image.png`,
      email: 'contact@digitalivez.com',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'contact@digitalivez.com',
        url: `${siteUrl}/contact`,
      },
      sameAs: socialPlatforms.map(platform => platform.profileUrl),

    },
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      name: 'Digitalivez Tools',
      url: siteUrl,
      description: 'Free business calculators, PDF utilities, document builders, image tools, video tools, and website tools for freelancers and small businesses.',
      publisher: { '@id': `${siteUrl}/#organization` },
      inLanguage: 'en',
    },
    {
      '@type': 'WebApplication',
      '@id': `${siteUrl}/#application`,
      name: 'Digitalivez Tools',
      url: siteUrl,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': `${siteUrl}/#organization` },
    },
  ],
}

export function SiteSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
    />
  )
}
