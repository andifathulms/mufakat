import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'
import { ServiceWorker } from '@/components/ServiceWorker'
import './globals.css'

/**
 * The content is numeric — terms, indices, node ids — so the log ledger is set in
 * JetBrains Mono with tabular figures. Source Serif 4 carries prose and headings, in
 * the register of a bound ledger; IBM Plex Sans carries controls and labels.
 */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
})

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})

/**
 * Asset URLs carry the basePath explicitly.
 *
 * Next rewrites `src` on components it controls, but the metadata block is emitted as
 * written — an icon at `/favicon.svg` would be looked for at the origin root, which on
 * a project page is somebody else's repository. `NEXT_PUBLIC_BASE_PATH` is the same
 * value the service worker registers under.
 */
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * Where the site actually lives. Open Graph images must be absolute URLs — a crawler
 * has no page to resolve a relative one against — and without a `metadataBase` Next
 * silently resolves them against `http://localhost:3000`, which ships a social preview
 * pointing at the developer's own machine.
 */
const SITE_ORIGIN = 'https://andifathulms.github.io'

const DESCRIPTION =
  'A Raft consensus simulator with deterministic simulation, continuous safety-invariant checking, and an ablation mode that turns individual Raft rules off so the guarantee they protect visibly fails.'

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_ORIGIN}${base}/`),
  title: 'Raft Simulator',
  description: DESCRIPTION,
  applicationName: 'Raft Simulator',
  // A static file rather than an `app/manifest.ts` route: Next emits the route's link
  // tag without the basePath, so on a project page the browser asks the origin root
  // for it and gets a 404. `scripts/generate-sw.mjs` asserts this file agrees with the
  // basePath, so a repository rename cannot leave it pointing at the old path.
  manifest: `${base}/manifest.webmanifest`,
  icons: {
    // The SVG is the small-size form of the mark — three nodes, no orbit ring —
    // because a favicon is never rendered above 32px and five nodes blur together
    // there. The PNG is for browsers that will not take an SVG icon.
    icon: [
      { url: `${base}/favicon.svg`, type: 'image/svg+xml' },
      { url: `${base}/raft-icon-32.png`, sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: `${base}/raft-icon-180.png`, sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'Raft Simulator',
    title: 'Raft Simulator',
    description: DESCRIPTION,
    // Relative to `metadataBase`, which already carries the basePath — an
    // absolute path here would be appended to it and produce it twice.
    images: [{ url: 'raft-og-1200x630.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Raft Simulator',
    description: DESCRIPTION,
    images: ['raft-og-1200x630.png'],
  },
}

/** The app's own paper, so the Android status bar matches the page rather than the icon tile. */
export const viewport: Viewport = {
  themeColor: '#E9EDE4',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable} ${sans.variable}`}>
      <body className="bg-stock text-ink font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
