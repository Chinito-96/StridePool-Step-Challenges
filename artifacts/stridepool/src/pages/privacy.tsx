import { useEffect } from 'react';
import { Link } from 'wouter';
import { PRIVACY_DRAFT_UPDATED, PRIVACY_DRAFT_UPDATED_ISO, privacyReviewItems, privacySections } from '@/lib/privacy-policy';

export default function PrivacyPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Privacy Policy Draft | StridePool';
    return () => { document.title = previous; };
  }, []);

  return (
    <div id="top-of-privacy" className="mx-auto max-w-[1100px]" data-testid="page-privacy">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">StridePool privacy</p>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-[1.02] tracking-[-.06em]">Your information, in plain language.</h1>
        <div role="note" className="mt-5 rounded-2xl border-2 border-destructive/60 bg-destructive/10 p-4" data-testid="status-privacy-draft">
          <p className="font-display text-lg font-bold">Privacy notice draft — not in effect</p>
          <p className="mt-1 text-sm leading-6">This original StridePool draft has no effective date and is pending legal and product review. It is not an operative notice or a request to change your settings or consent.</p>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Draft last revised{' '}
          <time dateTime={PRIVACY_DRAFT_UPDATED_ISO} className="font-bold text-foreground" data-testid="text-privacy-draft-date">{PRIVACY_DRAFT_UPDATED}</time>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <Link href="/profile" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-privacy-profile">Profile &amp; settings</Link>
          <Link href="/safety" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-privacy-safety">Safety and eligibility</Link>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Privacy policy sections" className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]" data-testid="nav-privacy-sections">
            <p className="mb-2 px-2 font-mono-app text-[10px] uppercase tracking-[.16em] text-muted-foreground">On this page</p>
            <ol className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
              {privacySections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-xs leading-5 hover:bg-muted" data-testid={`link-privacy-toc-${section.id}`}>
                    <span className="font-mono-app text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
              <li>
                <a href="#privacy-review" className="flex gap-2 rounded-lg px-2 py-1.5 text-xs leading-5 hover:bg-muted" data-testid="link-privacy-toc-review">
                  <span className="font-mono-app text-muted-foreground">--</span>
                  <span>Items to confirm before adoption</span>
                </a>
              </li>
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {privacySections.map((section, index) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7" data-testid={`section-privacy-${section.id}`}>
              <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Draft section {String(index + 1).padStart(2, '0')}</p>
              <h2 id={`${section.id}-title`} className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">{section.title}</h2>
              <div className="mt-4 max-w-[68ch] space-y-3 text-[15px] leading-7">
                {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
              </div>
              <a href="#top-of-privacy" className="mt-4 inline-block text-xs font-bold text-primary underline-offset-4 hover:underline" data-testid={`link-privacy-top-${section.id}`}>Back to top</a>
            </section>
          ))}

          <section id="privacy-review" aria-labelledby="privacy-review-title" className="scroll-mt-24 rounded-2xl border border-border bg-muted p-5 sm:p-7" data-testid="section-privacy-review">
            <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Pending</p>
            <h2 id="privacy-review-title" className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">Items to confirm before adoption</h2>
            <ul className="mt-4 max-w-[68ch] list-disc space-y-2 pl-5 text-[15px] leading-7">
              {privacyReviewItems.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <a href="#top-of-privacy" className="mt-4 inline-block text-xs font-bold text-primary underline-offset-4 hover:underline" data-testid="link-privacy-top-review">Back to top</a>
          </section>
          <p className="text-xs leading-5 text-muted-foreground">
            This is an original StridePool draft based on the application's currently verified data flows. Legal obligations and actual provider practices must be reviewed before publication as an operative privacy notice.
          </p>
        </div>
      </div>
    </div>
  );
}
