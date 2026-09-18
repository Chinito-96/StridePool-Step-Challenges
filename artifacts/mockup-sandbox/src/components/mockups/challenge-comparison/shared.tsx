import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Search, SlidersHorizontal, Target, Users, UsersRound } from 'lucide-react';

export const challenges = [
  { name: 'Sunrise Steps', theme: 'Start soft, finish proud.', level: 'Gentle', goal: '6,500', days: '7', walkers: '82', pool: '$640', color: '#ff8a65', progress: 73 },
  { name: 'Weekend Step Podium', theme: 'See who can cover the most ground.', level: 'Podium', goal: '60% / 25% / 15%', days: '3', walkers: '28', pool: '$280', color: '#0f9b8e', progress: 48 },
  { name: 'Long Way Home', theme: 'A steady pace with your people.', level: 'Steady', goal: '8,000', days: '14', walkers: '116', pool: '$920', color: '#d9ef62', progress: 61 },
];

export function LaceMark({ size = 42 }: { size?: number }) {
  return <svg className="lace-mark" style={{ width: size, height: size * .76 }} viewBox="0 0 96 80" aria-label="Shoelace mascot" role="img">
    <path d="M22 23C9 37 18 59 38 63c19 4 39-8 40-27 1-9-4-15-10-14-7 1-7 9 0 12 9 4 17-2 19-11" />
    <path d="M22 23c8 7 15 9 23 8 8-1 13-6 18-13" />
    <rect x="15" y="17" width="14" height="9" rx="4.5" transform="rotate(-30 15 17)" />
    <rect x="67" y="13" width="14" height="9" rx="4.5" transform="rotate(26 67 13)" />
    <path d="M41 47c4 4 8 4 12 0" stroke="hsl(var(--foreground))" strokeWidth="2.5" />
  </svg>;
}

export function PreviewHeader({ proposed = false }: { proposed?: boolean }) {
  return <header className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/.84)] px-5 py-4 backdrop-blur">
    <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--primary)/.1)]"><LaceMark size={32} /></span><span className="display text-[18px] font-bold tracking-[-.04em]">stride<span className="text-[hsl(var(--primary))]">pool</span></span></div>
    {proposed ? <span className="preview-label mono rounded-full px-2.5 py-1 text-[9px] uppercase tracking-[.14em]">Reference-informed</span> : <span className="mono text-[9px] uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">Current baseline</span>}
  </header>;
}

export function Shell({ children, proposed = false }: { children: ReactNode; proposed?: boolean }) {
  return <div className="comparison-shell"><PreviewHeader proposed={proposed} /><main className="mx-auto max-w-[620px] px-5 pb-10 pt-7">{children}</main></div>;
}

export function CurrentFilters() {
  return <div className="mt-6 grid gap-2.5"><div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-3 text-sm text-[hsl(var(--muted-foreground))]"><Search size={16} /> Search challenges</div><div className="grid grid-cols-2 gap-2.5"><div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-3 text-sm">All levels <ChevronDown size={15} className="text-[hsl(var(--muted-foreground))]" /></div><div className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-3 text-sm">Recommended <SlidersHorizontal size={15} className="text-[hsl(var(--muted-foreground))]" /></div></div></div>;
}

export function CurrentChallengeCard({ challenge, index }: { challenge: typeof challenges[number]; index: number }) {
  return <article className="preview-rise overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_8px_24px_rgba(20,43,52,.07)]" style={{ animationDelay: `${index * 70}ms` }}><div className="h-2" style={{ background: challenge.color }} /><div className="p-5"><div className="flex items-start justify-between"><span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 mono text-[9px] uppercase tracking-[.08em] text-[hsl(var(--secondary-foreground))]">{challenge.level}</span><span className="mono text-[9px] uppercase text-[hsl(var(--muted-foreground))]">Jun 18</span></div><h2 className="display mt-5 text-[21px] font-bold tracking-[-.04em]">{challenge.name}</h2><p className="mt-1.5 text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">{challenge.theme}</p><div className="mt-5 grid grid-cols-2 gap-3 border-y border-[hsl(var(--border)/.7)] py-4"><div><p className="mono text-[9px] uppercase text-[hsl(var(--muted-foreground))]">Daily goal</p><p className="mt-1 text-sm font-bold">{challenge.goal} <span className="font-normal text-[hsl(var(--muted-foreground))]">{challenge.level === 'Podium' ? '' : 'steps'}</span></p></div><div><p className="mono text-[9px] uppercase text-[hsl(var(--muted-foreground))]">Entry</p><p className="mt-1 text-sm font-bold">{challenge.pool === '$640' ? '$8' : '$10'}</p></div></div><div className="mt-4 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]"><span className="flex items-center gap-1.5"><Users size={14} /> {challenge.walkers} walkers</span><span className="font-bold text-[hsl(var(--foreground))]">{challenge.pool} pool</span></div><button className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--foreground))] py-2.5 text-sm font-bold text-[hsl(var(--background))]">See the details <ChevronRight size={15} /></button></div></article>;
}

export function ProposedChallengeCard({ challenge, index }: { challenge: typeof challenges[number]; index: number }) {
  return <article className="preview-rise rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 proposed-glow" style={{ animationDelay: `${index * 70}ms` }}><div className="flex items-start gap-3"><span className="mt-0.5 h-3 w-3 rounded-full" style={{ background: challenge.color }} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{challenge.level} pace · {challenge.days} days</p><h2 className="display mt-1 text-[19px] font-bold tracking-[-.035em]">{challenge.name}</h2></div><span className="rounded-full bg-[hsl(var(--primary)/.1)] px-2 py-1 mono text-[9px] font-bold uppercase tracking-[.08em] text-[hsl(var(--primary))]">{challenge.walkers} in</span></div><p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">{challenge.theme}</p></div></div><div className="mt-4 flex items-center justify-between text-[11px] font-semibold"><span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]"><Target size={14} className="text-[hsl(var(--primary))]" /> {challenge.goal}{challenge.level === 'Podium' ? '' : ' steps/day'}</span><span>{challenge.pool} pool</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="proposed-progress h-full rounded-full" style={{ width: `${challenge.progress}%` }} /></div><div className="mt-3 flex items-center justify-between text-[10px] text-[hsl(var(--muted-foreground))]"><span>{challenge.progress}% of the group is on track</span><button className="font-bold text-[hsl(var(--primary))]">View challenge <ArrowUpRight size={12} className="inline" /></button></div></article>;
}

export function StatsStrip() {
  return <div className="grid grid-cols-3 gap-2.5 border-y border-[hsl(var(--border))] py-4 text-center"><div><p className="display text-xl font-bold">7</p><p className="mono mt-1 text-[9px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">days</p></div><div><p className="display text-xl font-bold">6,500</p><p className="mono mt-1 text-[9px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">steps/day</p></div><div><p className="display text-xl font-bold">82</p><p className="mono mt-1 text-[9px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">walkers</p></div></div>;
}

export function Leaderboard({ proposed = false }: { proposed?: boolean }) {
  const rows = [['01', 'Maya R.', '8,940'], ['02', 'Jordan K.', '8,120'], ['03', 'Alex M.', '7,284'], ['04', 'Priya S.', '6,920']];
  return <section className={`rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] ${proposed ? 'p-4' : 'p-5'}`}><div className="flex items-center justify-between"><div><p className="mono text-[9px] uppercase tracking-[.15em] text-[hsl(var(--primary))]">Live standings</p><h2 className="display mt-1 text-lg font-bold">Finish line</h2></div><UsersRound size={18} className="text-[hsl(var(--muted-foreground))]" /></div><div className="mt-4 space-y-2">{rows.map(([rank, name, steps], index) => <div className={`flex items-center gap-3 rounded-xl ${proposed && index === 2 ? 'bg-[hsl(var(--primary)/.1)]' : 'bg-[hsl(var(--background))]'} px-3 py-2.5`} key={rank}><span className="mono w-5 text-[10px] text-[hsl(var(--muted-foreground))]">{rank}</span><span className="h-7 w-7 rounded-full bg-[hsl(var(--secondary))]" /><span className="flex-1 text-xs font-bold">{name}{index === 2 && <span className="ml-1 text-[10px] font-normal text-[hsl(var(--primary))]">you</span>}</span><span className="mono text-[10px] font-bold">{steps}</span></div>)}</div></section>;
}