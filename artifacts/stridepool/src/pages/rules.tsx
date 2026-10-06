import { getGetComplianceStatusQueryKey, useGetComplianceStatus } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useEffect } from 'react';
import { RULES_UPDATED, RULES_UPDATED_ISO, challengeRules } from '@/lib/challenge-rules';

function StatusPanel() {
  const status = useGetComplianceStatus({
    query: { queryKey: getGetComplianceStatusQueryKey(), staleTime: 0, refetchOnMount: 'always', retry: false },
  });
  const data = status.data;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" aria-labelledby="rules-status-title" data-testid="panel-rules-status">
      <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Live paid-play status</p>
      <h2 id="rules-status-title" className="mt-1 font-display text-xl font-bold">Current launch controls</h2>
      {status.isLoading ? (
        <div role="status" className="mt-4 space-y-2" data-testid="status-rules-loading">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <span className="sr-only">Checking current paid-play status</span>
        </div>
      ) : status.isError || !data ? (
        <div role="alert" className="mt-4 text-sm" data-testid="status-rules-error">
          <p className="leading-6">Current status is unavailable. Nothing here should be read as approval of paid play or of any state.</p>
          <button onClick={() => status.refetch()} className="mt-3 rounded-xl bg-foreground px-3 py-2 text-xs font-bold text-background" data-testid="button-rules-retry">Try again</button>
        </div>
      ) : (
        <div className="mt-4 space-y-4 text-sm" data-testid="status-rules-loaded">
          <p className="leading-6">
            <span className="font-bold">{data.paidPlayEnabled ? 'Paid play is enabled by current controls.' : 'Paid play is not available right now.'}</span>{' '}
            {data.paidPlayEnabled ? 'Entry still depends on each participant passing every required check.' : 'One or more required launch controls are not complete.'}
          </p>
          <div>
            <p className="font-bold">{data.counselReviewRequired ? 'State review still required' : 'Approved states'}</p>
            <p className="mt-1 leading-6 text-muted-foreground" data-testid="text-rules-approved-states">
              {data.counselReviewRequired
                ? 'No state availability is confirmed by these controls while counsel review is pending.'
                : data.approvedStates.length ? data.approvedStates.join(', ') : 'None approved yet.'}
            </p>
          </div>
        </div>
      )}
      <p className="mt-4 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
        This page is current operating guidance pending counsel-approved paid-play terms. It is not an assertion of legal compliance.
      </p>
    </section>
  );
}

export default function RulesPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Challenge Rules | StridePool';
    return () => { document.title = previousTitle; };
  }, []);
  return (
    <div id="top-of-rules" className="mx-auto max-w-[1100px] scroll-mt-24" data-testid="page-rules">
      <header className="mb-8 max-w-3xl">
        <p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Challenge rules</p>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-[1.02] tracking-[-.06em]">How StridePool challenges work.</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Plain-language operating guidance for walkers. Last updated{' '}
          <time dateTime={RULES_UPDATED_ISO} className="font-bold text-foreground" data-testid="text-rules-updated">{RULES_UPDATED}</time>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <Link href="/safety" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-rules-safety">Safety and eligibility</Link>
          <Link href="/challenges" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-rules-challenges">Challenges</Link>
          <Link href="/wallet" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-rules-wallet">Wallet</Link>
          <Link href="/terms" className="rounded-xl border border-border bg-card px-3 py-2 hover:border-primary" data-testid="link-rules-terms">Terms &amp; Conditions draft</Link>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Rules sections" className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]" data-testid="nav-rules-sections">
            <p className="mb-2 px-2 font-mono-app text-[10px] uppercase tracking-[.16em] text-muted-foreground">On this page</p>
            <ol className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
              {challengeRules.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-xs leading-5 hover:bg-muted" data-testid={`link-rules-toc-${s.id}`}>
                    <span className="font-mono-app text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <StatusPanel />
          {challengeRules.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7" data-testid={`section-rules-${s.id}`}>
              <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Section {String(i + 1).padStart(2, '0')}</p>
              <h2 id={`${s.id}-title`} className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">{s.title}</h2>
              <p className="mt-2 text-sm font-semibold text-accent-text">{s.summary}</p>
              <div className="mt-4 max-w-[68ch] space-y-3 text-[15px] leading-7">
                {s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}
              </div>
               <a href="#top-of-rules" className="mt-4 inline-block text-xs font-bold text-primary underline-offset-4 hover:underline" data-testid={`link-rules-top-${s.id}`}>Back to top</a>
            </section>
          ))}
          <p className="text-xs leading-5 text-muted-foreground">
            Current operating guidance pending counsel-approved paid-play terms. Not legal advice and not an assertion of legal compliance.
          </p>
        </div>
      </div>
    </div>
  );
}
