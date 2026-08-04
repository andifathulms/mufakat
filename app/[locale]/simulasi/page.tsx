import { notFound } from 'next/navigation'
import { Simulator } from '@/components/Simulator'
import { LOCALES, isLocale, type Locale } from '@/lib/i18n'

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }))
}

export default function SimulationPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  return <Simulator locale={params.locale} />
}
