/**
 * One diagram, showing the one idea everything else rests on: a record is settled
 * when *more than half* of the computers hold it — not all of them.
 *
 * That is the whole reason Raft survives a machine dying, and it is the thing a
 * newcomer most often has backwards. Three columns, aligned on row number, exactly as
 * the log ledger in the simulator draws them — so the diagram teaches how to read the
 * real view as well as the idea.
 *
 * Decorative: the caption beneath it states the same thing in words.
 */

export function MajorityDiagram({ locale }: { locale: 'id' | 'en' }) {
  const id = locale === 'id'
  const columns = [
    { label: 'n0', role: id ? 'leader' : 'leader', rows: ['1', '1', '2'] },
    { label: 'n1', role: id ? 'anggota' : 'member', rows: ['1', '1', '2'] },
    { label: 'n2', role: id ? 'mati' : 'down', rows: ['1', '1', null] },
  ]

  return (
    <figure className="card p-4">
      <div className="flex items-start justify-center gap-4 sm:gap-8">
        {columns.map((column) => (
          <div key={column.label} className="flex flex-col items-center gap-1.5">
            <span className="font-mono text-data font-bold">{column.label}</span>
            <span className="field-label normal-case tracking-normal">{column.role}</span>
            <ul className="mt-1 flex w-16 flex-col-reverse border border-ink-rule">
              {column.rows.map((term, row) => (
                <li
                  key={row}
                  className={[
                    'flex items-center justify-between border-t border-ink-rule px-2 py-1 font-mono text-micro tabular first:border-t-0',
                    term === null ? 'bg-stock-deep/50' : 'bg-stock-pale',
                  ].join(' ')}
                >
                  <span className="text-ink-faint">{row + 1}</span>
                  {term === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <span className="inline-block w-4 border border-committed text-center font-bold text-committed">
                      {term}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <figcaption className="mx-auto mt-4 max-w-prose text-center font-sans text-label leading-relaxed text-ink-soft">
        {id
          ? 'Baris 3 hanya ada di dua dari tiga komputer — dan itu sudah cukup. Dua dari tiga adalah mayoritas, jadi baris itu sah (committed) meski n2 sedang mati. Begitu n2 hidup lagi, ia akan menyusul sendiri.'
          : 'Row 3 is held by only two of the three computers — and that is enough. Two of three is a majority, so the row is settled even though n2 is down. When n2 comes back, it catches itself up.'}
      </figcaption>
    </figure>
  )
}
