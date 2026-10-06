import { useEffect } from 'react';
import { Link } from 'wouter';
import { PAID_PLAY_TERMS_UPDATED, PAID_PLAY_TERMS_UPDATED_ISO, PAID_PLAY_TERMS_VERSION, paidPlayTermsIntro, paidPlayTermsSections } from '@/lib/paid-play-terms';

// Official rules for Paid Challenges, available in the app at all times
// (Paid Play Terms §14.2; Apple App Store Review Guideline 5.3.2).
export default function PaidPlayTermsPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Paid Play Terms | StridePool';
    return () => { document.title = previous; };
  }, []);
  return (
    <div id="top-of-paid-play-terms" className="mx-auto max-w-[1100px]" data-testid="page-paid-play-terms">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Official rules</p>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-[1.02] tracking-[-.06em]">StridePool Paid Play Terms</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Last updated <time dateTime={PAID_PLAY_TERMS_UPDATED_ISO} className="font-bold text-foreground">{PAID_PLAY_TERMS_UPDATED}</time>.
          Version <span className="font-mono-app text-xs" data-testid="text-paid-play-terms-version">{PAID_PLAY_TERMS_VERSION}</span>.
          Paid Challenges open only on the effective date shown on the Safety page.
        </p>
        <div role="note" className="mt-4 rounded-2xl border border-border bg-muted p-4 text-sm leading-6">Apple Inc. and Google LLC are not sponsors of, and are not involved in any manner with, Paid Challenges or any contest on StridePool.</div>
        <div className="mt-4 space-y-3 text-[15px] leading-7">{paidPlayTermsIntro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <Link href="/safety" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-paid-play-terms-safety">Accept and check eligibility</Link>
          <Link href="/biometric-policy" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-paid-play-terms-biometric">Biometric Information Policy</Link>
        </div>
      </header>
      <div className="min-w-0 space-y-6">
        {paidPlayTermsSections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7" data-testid={`section-paid-play-terms-${section.id}`}>
            <h2 id={`${section.id}-title`} className="font-display text-2xl font-bold tracking-[-.04em]">{section.title}</h2>
            <div className="mt-4 max-w-[72ch] space-y-3 text-[15px] leading-7">
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets && <ul className="list-disc space-y-1 pl-6">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
              {section.table && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-sm">
                    <thead><tr>{section.table.headers.map((header) => <th key={header} className="border-b border-border py-2 pr-3 text-left font-bold">{header}</th>)}</tr></thead>
                    <tbody>{section.table.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index} className="border-b border-border/60 py-2 pr-3 align-top">{cell}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ))}
        <a href="#top-of-paid-play-terms" className="inline-block text-xs font-bold text-primary underline-offset-4 hover:underline">Back to top</a>
      </div>
    </div>
  );
}
