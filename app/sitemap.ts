import type { MetadataRoute } from 'next'
import { guides, tools } from '@/lib/tools'

const siteUrl = 'https://tools.digitalivez.com'
const collectionRoutes = [
  '/tools',
  '/calculators',
  '/pricing-calculators',
  '/freelancer-tools',
  '/business-documents',
  '/marketing-tools',
  '/video-tools',
  '/website-tools',
  '/pdf-tools',
  '/image-tools',
  '/guides',
]
const informationalRoutes = ['/about', '/contact', '/privacy', '/terms', '/disclaimer']

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = new Set([
    '/',
    ...collectionRoutes,
    ...informationalRoutes,
    ...tools.map(tool => tool.route),
    ...guides.map(guide => guide.href),
  ])

  return [...routes].map(path => ({ url: new URL(path, siteUrl).toString() }))
}
