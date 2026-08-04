'use client'

import { useState } from 'react'
import { AblationPanel } from '@/components/ablation/AblationPanel'
import { UNMODIFIED_RAFT, type AblationFlags, type AblationFlagName } from '@/lib/raft/rules'
import { dictionary, type Locale } from '@/lib/i18n'

/**
 * The ablation page's interactive half. Toggling here is a preview of the panel; the
 * run itself lives on the simulation page, which each rule links to with the rule
 * already switched off and the scenario that breaks without it already loaded.
 */
export function AblationExplorer({ locale }: { locale: Locale }) {
  const dict = dictionary(locale)
  const [flags, setFlags] = useState<AblationFlags>(UNMODIFIED_RAFT)

  return (
    <AblationPanel
      flags={flags}
      onToggle={(flag: AblationFlagName, enabled: boolean) =>
        setFlags((current) => ({ ...current, [flag]: enabled }))
      }
      onReset={() => setFlags(UNMODIFIED_RAFT)}
      dict={dict}
      locale={locale}
    />
  )
}
