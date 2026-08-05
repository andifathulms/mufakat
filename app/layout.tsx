import type { Metadata } from 'next'
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

export const metadata: Metadata = {
  title: 'Raft Simulator',
  description:
    'A Raft consensus simulator with deterministic simulation, continuous safety-invariant checking, and an ablation mode that turns individual Raft rules off so the guarantee they protect visibly fails.',
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
