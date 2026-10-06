import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  getGetPaidPlayAccountQueryKey,
  useClosePaidPlayAccount,
  useGetPaidPlayAccount,
  useRecordBiometricConsent,
  useRequestPaidPlaySelfExclusion,
  useSetPaidPlayEntryLimit,
} from '@workspace/api-client-react';
import { BIOMETRIC_NOTICE_VERSION } from '@/lib/biometric-policy';

const buttonClass = 'inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-bold transition hover:border-primary disabled:opacity-50';
const inputClass = 'h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary';

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === 'string' ? data.error : fallback;
}

/**
 * Paid Play Terms controls: biometric notice consent (§9.6), entry limits and
 * self-exclusion (§12.3), and account closure with full payout (§6.4).
 */
export function PaidPlayAccountPanel({ signedIn }: { signedIn: boolean }) {
  const queryClient = useQueryClient();
  const account = useGetPaidPlayAccount({ query: { queryKey: getGetPaidPlayAccountQueryKey(), enabled: signedIn, retry: false, staleTime: 0 } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetPaidPlayAccountQueryKey() });
  const consent = useRecordBiometricConsent();
  const exclusion = useRequestPaidPlaySelfExclusion();
  const limit = useSetPaidPlayEntryLimit();
  const closure = useClosePaidPlayAccount();
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [exclusionDays, setExclusionDays] = useState('30');
  const [limitDollars, setLimitDollars] = useState('');
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [message, setMessage] = useState('');

  if (!signedIn) {
    return <div className="rounded-2xl border border-border bg-card p-5 text-xs leading-5 text-muted-foreground shadow-[var(--shadow-card)]" data-testid="panel-paid-play-account">Sign in to manage biometric consent, entry limits, and self-exclusion.</div>;
  }
  const data = account.data;
  const done = (text: string) => () => { setMessage(text); void refresh(); };
  const failed = (fallback: string) => (error: unknown) => setMessage(errorMessage(error, fallback));

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" data-testid="panel-paid-play-account">
      <p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Your paid-play controls</p>
      <h2 className="mt-1 font-display text-xl font-bold">Limits, exclusion, and consent</h2>
      {account.isError && <p className="mt-3 text-xs text-muted-foreground">These controls are unavailable right now.</p>}
      {data && (
        <div className="mt-4 space-y-5 text-xs leading-5">
          {data.entryBlocks.length > 0 && (
            <ul className="list-disc space-y-1 rounded-xl bg-muted p-3 pl-6" data-testid="list-paid-entry-blocks">
              {data.entryBlocks.map((block) => <li key={block}>{block}</li>)}
            </ul>
          )}

          <section aria-labelledby="biometric-consent-title">
            <h3 id="biometric-consent-title" className="text-sm font-bold">Biometric notice</h3>
            {data.biometricConsentRecorded
              ? <p className="mt-1 text-muted-foreground" data-testid="status-biometric-consent">Consent recorded for the current notice.</p>
              : <>
                  <label className="mt-2 flex items-start gap-2">
                    <input type="checkbox" checked={biometricChecked} onChange={(event) => setBiometricChecked(event.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-biometric-consent" />
                    <span>I have read the <Link href="/biometric-policy" className="font-bold text-primary underline underline-offset-4">Biometric Information Policy</Link> and consent to StridePool's verification provider collecting a scan of my face geometry only to verify my identity, kept and destroyed as that policy describes.</span>
                  </label>
                  <button type="button" className={`${buttonClass} mt-2`} disabled={!biometricChecked || consent.isPending} data-testid="button-biometric-consent"
                    onClick={() => consent.mutate({ data: { consent: true, noticeVersion: BIOMETRIC_NOTICE_VERSION } }, { onSuccess: done('Biometric consent recorded.'), onError: failed('Consent could not be recorded.') })}>
                    Record my consent
                  </button>
                  <p className="mt-2 text-muted-foreground">Prefer not to? Email support@stridepool.com for a verification method that does not use biometrics.</p>
                </>}
          </section>

          <section aria-labelledby="entry-limit-title">
            <h3 id="entry-limit-title" className="text-sm font-bold">Weekly entry limit</h3>
            <p className="mt-1 text-muted-foreground" data-testid="text-entry-limit">{data.weeklyEntryLimitCents === null ? 'No limit set.' : `Current limit: $${(data.weeklyEntryLimitCents / 100).toFixed(2)} per 7 days, including platform fees.`}</p>
            <div className="mt-2 flex gap-2">
              <input inputMode="decimal" placeholder="e.g. 25" value={limitDollars} onChange={(event) => setLimitDollars(event.target.value)} className={inputClass} aria-label="Weekly limit in dollars" data-testid="input-entry-limit" />
              <button type="button" className={buttonClass} disabled={limit.isPending || !(Number(limitDollars) >= 0) || limitDollars === ''} data-testid="button-save-entry-limit"
                onClick={() => limit.mutate({ data: { weeklyLimitCents: Math.round(Number(limitDollars) * 100) } }, { onSuccess: done('Weekly limit saved.'), onError: failed('The limit could not be saved.') })}>Save</button>
              {data.weeklyEntryLimitCents !== null && <button type="button" className={buttonClass} disabled={limit.isPending} data-testid="button-clear-entry-limit"
                onClick={() => limit.mutate({ data: { weeklyLimitCents: null } }, { onSuccess: done('Weekly limit removed.'), onError: failed('The limit could not be removed.') })}>Clear</button>}
            </div>
          </section>

          <section aria-labelledby="self-exclusion-title">
            <h3 id="self-exclusion-title" className="text-sm font-bold">Take a break from Paid Challenges</h3>
            {data.selfExcluded
              ? <p className="mt-1 text-muted-foreground" data-testid="status-self-excluded">{data.selfExcludedPermanently ? 'You are permanently excluded from Paid Challenges.' : `You are excluded until ${new Date(data.selfExcludedUntil ?? '').toLocaleDateString()}.`} Free challenges stay open. To end an exclusion early, contact support.</p>
              : <p className="mt-1 text-muted-foreground">Takes effect immediately. Free challenges stay open.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={exclusionDays} onChange={(event) => setExclusionDays(event.target.value)} className={`${inputClass} w-auto`} aria-label="Exclusion length" data-testid="select-self-exclusion-days">
                <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option>
              </select>
              <button type="button" className={buttonClass} disabled={exclusion.isPending} data-testid="button-self-exclude"
                onClick={() => exclusion.mutate({ data: { days: Number(exclusionDays) } }, { onSuccess: done('Exclusion applied.'), onError: failed('The exclusion could not be applied.') })}>Exclude me</button>
              <button type="button" className={buttonClass} disabled={exclusion.isPending || data.selfExcludedPermanently} data-testid="button-self-exclude-permanent"
                onClick={() => { if (window.confirm('Permanently exclude this account from Paid Challenges? Only support can reverse this.')) exclusion.mutate({ data: { permanent: true } }, { onSuccess: done('Permanent exclusion applied.'), onError: failed('The exclusion could not be applied.') }); }}>Permanently</button>
            </div>
            <p className="mt-2 text-muted-foreground">Free, confidential support: National Problem Gambling Helpline, 1-800-GAMBLER (1-800-522-4700).</p>
          </section>

          <section aria-labelledby="account-closure-title">
            <h3 id="account-closure-title" className="text-sm font-bold">Close account</h3>
            {data.accountClosed
              ? <p className="mt-1 text-muted-foreground" data-testid="status-account-closed">This account is closed.</p>
              : <>
                  <p className="mt-1 text-muted-foreground">Your full available balance is paid out, with no $20 minimum. Paid entries must settle first.</p>
                  <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={closeConfirm} onChange={(event) => setCloseConfirm(event.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-close-account" /><span>I understand closing my account cannot be undone here.</span></label>
                  <button type="button" className={`${buttonClass} mt-2`} disabled={!closeConfirm || closure.isPending} data-testid="button-close-account"
                    onClick={() => closure.mutate({ data: { confirm: true, idempotencyKey: `close-${crypto.randomUUID()}` } }, {
                      onSuccess: (result) => { setMessage(result.payoutStatus === 'pending' ? `Account closed. $${(result.payoutCents / 100).toFixed(2)} is on its way to your payout account.` : result.payoutStatus === 'needs_payout_account' ? `Account closed. Support will return $${(result.payoutCents / 100).toFixed(2)} to your original payment method.` : 'Account closed.'); void refresh(); },
                      onError: failed('The account could not be closed.'),
                    })}>Close my account</button>
                </>}
          </section>
        </div>
      )}
      {message && <p className="mt-4 rounded-xl bg-muted p-3 text-xs leading-5" role="status" data-testid="status-paid-play-account">{message}</p>}
      <Link href="/paid-play-terms" className="mt-4 inline-block text-xs font-bold text-primary underline underline-offset-4" data-testid="link-paid-play-terms-from-controls">Read the Paid Play Terms</Link>
    </div>
  );
}
