'use client'

import { useEffect } from 'react'
import type { Locale } from '@/lib/i18n'

/**
 * Keeps `<html lang>` in step with the route's locale.
 *
 * The App Router allows exactly one `<html>` element and it lives in the root layout,
 * which sits above the `[locale]` segment and so cannot see the param. The exported
 * HTML therefore ships with the default `lang`, and this corrects it on mount — which
 * matters because a screen reader picks its pronunciation rules from this attribute,
 * and Indonesian prose read with English phonetics is close to unintelligible.
 */
export function DocumentLanguage({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return null
}
