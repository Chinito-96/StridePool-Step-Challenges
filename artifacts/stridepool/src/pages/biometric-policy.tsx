import { useEffect } from 'react';
import { BIOMETRIC_NOTICE_VERSION, BIOMETRIC_POLICY_UPDATED, BIOMETRIC_POLICY_UPDATED_ISO, biometricPolicySections } from '@/lib/biometric-policy';

// Publicly available retention schedule and destruction guidelines
// (Paid Play Terms §9.6; Illinois BIPA 740 ILCS 14/15(a)).
export default function BiometricPolicyPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Biometric Information Policy | StridePool';
    return () => { document.title = previous; };
  }, []);
  return (
    <div className="mx-auto max-w-[900px]" data-testid="page-biometric-policy">
      <header className="mb-8">
        <p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Privacy</p>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.25rem)] font-bold leading-[1.02] tracking-[-.06em]">Biometric Information Retention and Destruction Policy</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Last updated <time dateTime={BIOMETRIC_POLICY_UPDATED_ISO} className="font-bold text-foreground">{BIOMETRIC_POLICY_UPDATED}</time>.
          Notice version <span className="font-mono-app text-xs">{BIOMETRIC_NOTICE_VERSION}</span>.
        </p>
      </header>
      <div className="space-y-6">
        {biometricPolicySections.map((section) => (
          <section key={section.id} id={section.id} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7" data-testid={`section-biometric-${section.id}`}>
            <h2 className="font-display text-2xl font-bold tracking-[-.04em]">{section.title}</h2>
            <div className="mt-4 max-w-[70ch] space-y-3 text-[15px] leading-7">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
