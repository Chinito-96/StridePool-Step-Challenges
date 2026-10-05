import { getGetComplianceStatusQueryKey, useGetComplianceStatus } from '@workspace/api-client-react';

const labels = {
  launch_enabled: 'Paid-play launch switch',
  counsel_approval: 'Legal review',
  approved_states: 'Approved states',
  stripe_provider: 'Payment provider',
  managed_webhook: 'Signed webhook delivery',
  provider_backfill: 'Provider event backfill',
  sandbox_reconciliation: 'Sandbox reconciliation',
};

export function LaunchControls() {
  const status = useGetComplianceStatus({
    query: {
      queryKey: getGetComplianceStatusQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchInterval: 60_000,
      retry: false,
    },
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" data-testid="panel-launch-controls">
      <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Paid-play readiness</p>
      <h2 className="mt-1 font-display text-xl font-bold">Launch controls</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Free community challenges do not require these checks. Money-based play stays locked while any required control is blocking.</p>
      {status.isLoading ? <p className="mt-4 text-xs text-muted-foreground" role="status">Checking current controls…</p> : status.isError ? (
        <div className="mt-4 text-xs" role="alert">
          <p>Readiness is unavailable. This does not authorize paid play.</p>
          <button className="mt-2 font-bold text-primary underline" onClick={() => void status.refetch()}>Try again</button>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {status.data?.launchControls.map((control) => (
            <li className="rounded-xl border border-border p-3" key={control.id} data-testid={`launch-control-${control.id}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-bold">{labels[control.id]}</p>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${control.status === 'ready' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{control.status === 'ready' ? 'Ready' : 'Blocking'}</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{control.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}