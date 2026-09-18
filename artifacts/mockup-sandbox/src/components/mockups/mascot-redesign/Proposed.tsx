import './_group.css';

function StepForwardMark({ size = 220, label }: { size?: number; label?: string }) {
  return <svg width={size} height={size} viewBox="0 0 128 128" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="mascot-mark">
    <ellipse cx="65" cy="111" rx="42" ry="4" fill="var(--mascot-emerald)" opacity=".12" />
    <g transform="rotate(-13 64 64)" stroke="var(--mascot-emerald)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M58 61c-7-8-20-10-29-4-10 7-7 17 5 21l13 4c12 4 13 14 2 20-15 8-32 1-37-10" />
      <path d="M77 83V25h21c14 0 23 8 23 19s-9 19-23 19H77" />
    </g>
    <g stroke="var(--mascot-gold)" strokeWidth="5" strokeLinecap="round">
      <path d="M58 72 78 52" />
      <path d="M7 76 22 71" opacity=".95" />
      <path d="M4 89 20 85" opacity=".72" />
      <path d="M7 102 21 99" opacity=".48" />
    </g>
    <circle cx="78" cy="52" r="3.5" fill="var(--mascot-gold)" />
  </svg>;
}

export function Proposed() {
  return <div className="mascot-shell"><div className="mascot-card mx-auto max-w-[440px] rounded-[28px] p-7"><div className="flex items-center justify-between"><div><p className="mascot-mono text-[10px] uppercase tracking-[.2em] text-[var(--mascot-emerald)]">Proposed direction</p><h1 className="mascot-display mt-2 text-2xl font-bold tracking-[-.05em]">Step-forward mark</h1></div><span className="rounded-full bg-[rgba(212,165,55,.18)] px-2.5 py-1 mascot-mono text-[9px] uppercase tracking-[.1em] text-[var(--mascot-brass)]">After</span></div><div className="mt-8 flex min-h-[240px] items-center justify-center rounded-[22px] bg-[var(--mascot-emerald)]"><StepForwardMark size={230} label="Proposed staggered step and forward lean mascot mark" /></div><div className="mt-5 grid grid-cols-[1fr_auto] items-center gap-4"><p className="text-sm leading-6 text-[var(--mascot-muted)]">The S sits lower-left, the P is ahead and above, and the gold connector makes the step explicit.</p><span className="mascot-mono text-[10px] uppercase tracking-[.14em] text-[var(--mascot-brass)]">-13° lean</span></div><div className="mt-6 rounded-2xl border border-[var(--mascot-border)] bg-[rgba(11,61,46,.04)] p-4"><p className="mascot-mono text-[9px] uppercase tracking-[.16em] text-[var(--mascot-muted)]">Tiny-size check</p><div className="mt-4 flex items-end justify-between px-2"><div className="text-center"><StepForwardMark size={28} /><p className="mt-2 text-[9px] text-[var(--mascot-muted)]">16</p></div><div className="text-center"><StepForwardMark size={42} /><p className="mt-2 text-[9px] text-[var(--mascot-muted)]">24</p></div><div className="text-center"><StepForwardMark size={58} /><p className="mt-2 text-[9px] text-[var(--mascot-muted)]">32</p></div><div className="text-center"><StepForwardMark size={78} /><p className="mt-2 text-[9px] text-[var(--mascot-muted)]">48</p></div></div></div></div></div>;
}