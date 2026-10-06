import { useEffect } from 'react';
import { Link } from 'wouter';
import { TERMS_DRAFT_UPDATED, TERMS_DRAFT_UPDATED_ISO, termsReviewItems, termsSections } from '@/lib/terms-and-conditions';

export default function TermsPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Terms & Conditions | StridePool';
    return () => { document.title = previous; };
  }, []);

  return (
    <div id="top-of-terms" className="mx-auto max-w-[1100px]" data-testid="page-terms">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Terms &amp; Conditions</p>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-[1.02] tracking-[-.06em]">Proposed agreement, in plain view.</h1>
        <div role="note" className="mt-5 rounded-2xl border-2 border-destructive/60 bg-destructive/10 p-4" data-testid="status-terms-draft">
          <p className="font-display text-lg font-bold">Draft — not in effect</p>
          <p className="mt-1 text-sm leading-6">This document has no effective date, is pending legal review, and is not an agreement you can accept or be bound by. Viewing it is not acceptance.</p>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Draft last revised{' '}
          <time dateTime={TERMS_DRAFT_UPDATED_ISO} className="font-bold text-foreground" data-testid="text-terms-draft-date">{TERMS_DRAFT_UPDATED}</time>{' '}
          (<span className="font-mono-app text-xs">{TERMS_DRAFT_UPDATED_ISO}</span>).
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <Link href="/rules" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-terms-rules">Challenge rules</Link>
          <Link href="/safety" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-terms-safety">Safety and eligibility</Link>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Terms sections" className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]" data-testid="nav-terms-sections">
            <p className="mb-2 px-2 font-mono-app text-[10px] uppercase tracking-[.16em] text-muted-foreground">On this page</p>
            <ol className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
              {termsSections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-xs leading-5 hover:bg-muted" data-testid={`link-terms-toc-${s.id}`}>
                    <span className="font-mono-app text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
              <li>
                <a href="#legal-review" className="flex gap-2 rounded-lg px-2 py-1.5 text-xs leading-5 hover:bg-muted" data-testid="link-terms-toc-legal-review">
                  <span className="font-mono-app text-muted-foreground">--</span>
                  <span>Open items for legal review</span>
                </a>
              </li>
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {termsSections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7" data-testid={`section-terms-${s.id}`}>
              <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Draft section {String(i + 1).padStart(2, '0')}</p>
              <h2 id={`${s.id}-title`} className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">{s.title}</h2>
              <div className="mt-4 max-w-[68ch] space-y-3 text-[15px] leading-7">
                {s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}
              </div>
              <a href="#top-of-terms" className="mt-4 inline-block text-xs font-bold text-primary underline-offset-4 hover:underline" data-testid={`link-terms-top-${s.id}`}>Back to top</a>
            </section>
          ))}

          <section id="legal-review" aria-labelledby="legal-review-title" className="scroll-mt-24 rounded-2xl border border-border bg-muted p-5 sm:p-7" data-testid="section-terms-legal-review">
            <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Pending</p>
            <h2 id="legal-review-title" className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">Open items for legal review</h2>
            <ul className="mt-4 max-w-[68ch] list-disc space-y-2 pl-5 text-[15px] leading-7">
              {termsReviewItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <a href="#top-of-terms" className="mt-4 inline-block text-xs font-bold text-primary underline-offset-4 hover:underline" data-testid="link-terms-top-legal-review">Back to top</a>
          </section>
        </div>
      </div>
    </div>
  );
}
