'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker, so the app works offline after first load — PRD §12.
 *
 * Only in production: the worker is generated from `out/`, which does not exist during
 * `pnpm dev`, and a stale worker caching a dev bundle is a genuinely annoying way to
 * lose an afternoon.
 *
 * The scope is the basePath, which is what a project page needs — a worker registered
 * at `/mufakat/` may only ever intercept requests beneath it, and cannot affect
 * anything else served from the same github.io origin.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
    navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
      // Offline support is an enhancement. A browser that refuses the registration —
      // private mode, a disabled setting, an insecure origin — should still get a
      // working app, so this failure is deliberately silent.
    })
  }, [])
  return null
}
