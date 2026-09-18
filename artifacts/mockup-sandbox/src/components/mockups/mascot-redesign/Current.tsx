import './_group.css';

function CurrentMascot({ size = 180, label }: { size?: number; label?: string }) {
  return <svg width={size} height={size} viewBox="0 0 96 80" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="mascot-mark">
    <ellipse cx="48" cy="70" rx="25" ry="3.5" fill="currentColor" opacity=".12" />
    <g stroke="var(--mascot-emerald)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M48 52c-8-12-20-12-23-4 8 8 15 8 23 4Z" fill="rgba(11,61,46,.22)" />
      <path d="M48 52c8-12 20-12 23-4-8 8-15 8-23 4Z" fill="rgba(11,61,46,.22)" />
      <path d="M48 49v9" />
    </g>
    <g stroke="var(--mascot-emerald)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 23C9 37 18 59 38 63c19 4 39-8 40-27 1-9-4-15-10-14-7 1-7 9 0 12 9 4 17-2 19-11" />
      <path d="M22 23c8 7 15 9 23 8 8-1 13-6 18-13" />
    </g>
    <g fill="var(--mascot-gold)" stroke="var(--mascot-charcoal)" strokeWidth="2">
      <rect x="15" y="17" width="14" height="9" rx="4.5" transform="rotate(-30 15 17)" />
      <rect x="67" y="13" width="14" height="9" rx="4.5" transform="rotate(26 67 13)" />
    </g>
    <path d="M41 47c4 4 8 4 12 0" stroke="var(--mascot-charcoal)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>;
}

export function Current() {
  return <div className="mascot-shell"><div className="mascot-card mx-auto max-w-[440px] rounded-[28px] p-7"><div className="flex items-center justify-between"><div><p className="mascot-mono text-[10px] uppercase tracking-[.2em] text-[var(--mascot-muted)]">Current reference</p><h1 className="mascot-display mt-2 text-2xl font-bold tracking-[-.05em]">Shoelace mascot</h1></div><span className="rounded-full bg-[rgba(11,61,46,.09)] px-2.5 py-1 mascot-mono text-[9px] uppercase tracking-[.1em] text-[var(--mascot-emerald)]">Before</span></div><div className="mt-8 flex min-h-[240px] items-center justify-center rounded-[22px] bg-[rgba(11,61,46,.06)]"><CurrentMascot size={210} label="Current StridePool shoelace mascot" /></div><div className="mt-5 flex items-start gap-3"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--mascot-gold)]" /><p className="text-sm leading-6 text-[var(--mascot-muted)]">A friendly looped lace with bow, smile, and gold aglets. It reads as a character first and a stride mark second.</p></div></div></div>;
}