import { notFound } from 'next/navigation'
import { AblationExplorer } from '@/components/ablation/AblationExplorer'
import { LOCALES, dictionary, isLocale, type Locale } from '@/lib/i18n'
import type { SafetyProperty } from '@/lib/invariants/types'
import { PROPERTY_STATEMENTS } from '@/lib/invariants/types'
import { RULE_DESCRIPTORS, type AblationFlagName } from '@/lib/raft/rules'

/** Each property once, with the rules that defend it. Order follows the rule list. */
const defended: { property: SafetyProperty; flags: AblationFlagName[] }[] = []
for (const rule of RULE_DESCRIPTORS) {
  const existing = defended.find((entry) => entry.property === rule.protects)
  if (existing === undefined) defended.push({ property: rule.protects, flags: [rule.flag] })
  else existing.flags.push(rule.flag)
}

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }))
}

export default function AblationPage({ params }: { params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound()
  const locale = params.locale
  const dict = dictionary(locale)

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl">{dict.nav.ablation}</h1>
        <p className="mt-2 font-serif text-lg leading-relaxed">{dict.ablation.lede}</p>
        <p className="mt-3 font-sans text-xs leading-relaxed text-ink-faint">
          {locale === 'id'
            ? 'Setiap guard hidup di lib/raft/rules.ts dan dikonsultasikan di tepat satu tempat. Itulah yang membuat sakelar ini jujur dan bukan sekadar label: tidak ada tempat kedua yang diam-diam masih menegakkan aturannya. Setiap sakelar juga punya tes yang membuktikan pelanggarannya benar-benar terjadi.'
            : 'Each guard lives in lib/raft/rules.ts and is consulted in exactly one place. That is what makes these switches honest rather than cosmetic: there is no second site quietly still enforcing the rule. Every switch also has a test proving the violation actually occurs.'}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <AblationExplorer locale={locale} />

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="border-b border-ink font-serif text-lg">
              {locale === 'id' ? 'Properti yang dijaga' : 'Properties defended'}
            </h2>
            <ul className="ruled mt-2">
              {/* Three of the six rules defend Election Safety, so the properties are
                  deduplicated and each names the rules that stand behind it. */}
              {defended.map(({ property, flags }) => (
                <li key={property} className="py-2">
                  <p className="font-mono text-xs">{dict.invariants.names[property]}</p>
                  <p className="mt-0.5 font-sans text-[11px] leading-relaxed text-ink-soft">
                    {PROPERTY_STATEMENTS[property]}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">
                    {flags.map((flag) => dict.ablation.rules[flag]?.title ?? flag).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-ink-rule bg-stock-pale p-3">
            <h2 className="font-serif text-base">
              {locale === 'id' ? 'Kenapa ablasi' : 'Why ablation'}
            </h2>
            <p className="mt-2 font-sans text-xs leading-relaxed text-ink-soft">
              {locale === 'id'
                ? 'Figure 8 di makalah persis argumen ini, disajikan sebagai diagram statis yang jarang benar-benar diserap pembaca. Di sini ia sebuah tombol.'
                : "The paper's Figure 8 is precisely this argument, presented as a static diagram that most readers do not fully absorb. Here it is a button."}
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
