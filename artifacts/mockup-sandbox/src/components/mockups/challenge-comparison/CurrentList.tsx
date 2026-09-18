import './_group.css';
import { CurrentChallengeCard, CurrentFilters, Shell, challenges } from './shared';

export function CurrentList() {
  return <Shell><div className="preview-rise"><p className="mono text-[9px] uppercase tracking-[.2em] text-[hsl(var(--primary))]">Open invitations</p><h1 className="display mt-2 text-[38px] font-bold leading-none tracking-[-.06em]">Find your people.</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Every pool has a pace. Pick one that feels like yours.</p></div><CurrentFilters /><div className="mt-7 space-y-4">{[...challenges].map((challenge, index) => <CurrentChallengeCard challenge={challenge} index={index} key={challenge.name} />)}</div></Shell>;
}