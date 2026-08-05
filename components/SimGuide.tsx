'use client'

/**
 * "What am I looking at."
 *
 * The workbench is dense on purpose, and dense is fine once you know the vocabulary.
 * This is where the vocabulary lives: the four node states and the eight message
 * labels, each said in a sentence rather than defined by a key.
 *
 * Collapsed by default after the first visit would be nicer still, but that needs
 * storage and a hydration dance for one line of copy. Open on arrival, shut with one
 * click, and it stays shut for the session.
 */

import { useState } from 'react'
import { RoleGlyph } from '@/components/cluster/glyph'
import type { Dictionary } from '@/lib/i18n'
import type { Role } from '@/lib/raft/types'

export function SimGuide({ dict }: { dict: Dictionary }) {
  const [open, setOpen] = useState(true)

  const roles: { role: Role; crashed?: boolean; name: string; body: string }[] = [
    { role: 'leader', name: dict.roles.leader, body: dict.plain.roles.leader },
    { role: 'follower', name: dict.roles.follower, body: dict.plain.roles.follower },
    { role: 'candidate', name: dict.roles.candidate, body: dict.plain.roles.candidate },
    { role: 'follower', crashed: true, name: dict.roles.crashed, body: dict.plain.roles.crashed },
  ]

  return (
    <section className="card">
      <div className="panel-head">
        <h2 className="panel-title">{dict.plain.newHere}</h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="ml-auto font-sans text-micro text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          {open ? dict.plain.hide : dict.plain.guide}
        </button>
      </div>

      {open && (
        <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h3 className="field-label">{dict.plain.legendTitle}</h3>
            <p className="mt-2 max-w-prose font-sans text-label leading-relaxed text-ink-soft">
              {dict.plain.clusterHelp}
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {roles.map((entry) => (
                <li key={entry.name} className="flex items-start gap-2.5">
                  <RoleGlyph role={entry.role} crashed={entry.crashed} size={24} />
                  <div className="min-w-0">
                    <p className="font-mono text-micro font-bold">{entry.name}</p>
                    <p className="mt-0.5 font-sans text-micro leading-relaxed text-ink-soft">
                      {entry.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="field-label">{dict.plain.messagesTitle}</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {dict.plain.messages.map((message) => (
                <li key={message.code} className="flex items-baseline gap-2.5">
                  <span className="chip w-14 shrink-0 justify-center text-ink">{message.code}</span>
                  <span className="font-sans text-micro leading-relaxed text-ink-soft">
                    {message.body}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
