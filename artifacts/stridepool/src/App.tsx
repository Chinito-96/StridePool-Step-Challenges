import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetAdminChallengesQueryKey, getGetAdminFlaggedStepRecordsQueryKey, getGetAdminSettlementHistoryQueryKey, getGetAdminUserQueryKey, getSearchAdminUsersQueryKey, getGetLedgerQueryKey, getGetPayoutAccountQueryKey, getGetStridePoolBootstrapQueryKey, getGetStridePoolChallengeLeaderboardQueryKey, getGetStridePoolCommunityChallengesQueryKey, getGetStridePoolLifetimeLeaderboardQueryKey, getGetStridePoolPendingInvitesQueryKey, getGetStridePoolInviteQueryKey, getGetStridePoolNotificationsQueryKey, getGetStridePoolReferralSummaryQueryKey, getGetStridePoolReferralPreviewQueryKey, getSearchStridePoolUsersQueryKey, useGetAdminChallenges, useGetAdminFlaggedStepRecords, useGetAdminSettlementHistory, useGetAdminUser, useSearchAdminUsers, useOverrideAdminChallengeParticipant, useAcceptStridePoolInvite, useCheckEligibility, useCreateCheckout, useCreateProSubscriptionCheckout, useCreateStridePoolChallenge, useCreateStridePoolChallengeInvite, useCreateWithdrawal, useGetComplianceStatus, useGetLedger, useGetPayoutAccount, useGetStridePoolBootstrap, useGetStridePoolChallengeLeaderboard, useGetStridePoolCommunityChallenges, useGetStridePoolLifetimeLeaderboard, useGetStridePoolInvite, useGetStridePoolPendingInvites, useGetStridePoolNotifications, useGetStridePoolReferralSummary, useGetStridePoolReferralPreview, useClaimStridePoolReferral, useJoinStridePoolChallenge, useLeaveStridePoolChallenge, useMarkAllStridePoolNotificationsRead, useMarkStridePoolNotificationRead, useSearchStridePoolUsers, useStartPayoutOnboarding, useUpdateStridePoolProfile, useUpdateStridePoolHealthSourceConnection, useIngestStridePoolSourceSamples, useCreateStridePoolGroupChallenge, type AdminChallenge, type AdminFlaggedStepRecord, type AdminParticipantOverride, type AdminSettlement, type AdminUserChallenge, type Challenge as ApiChallenge, type ComplianceStatus, type EligibilityInput, type FreeStreak, type HealthSource, type LifetimeLeaderboardEntry, type MembershipSummary, type Notification as ApiNotification, type PendingInvite, type ProfileSettings as ApiProfileSettings, type StepReview, type UserSearchResult } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { ArrowLeft, ArrowUpRight, Award, Bell, CalendarDays, Check, ChevronDown, ChevronRight, CircleAlert, CircleHelp, CircleUserRound, Clock3, Compass, Copy, CreditCard, ExternalLink, Flame, Footprints, Gift, HeartPulse, Home, Info, ListFilter, LockKeyhole, Menu, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, TrendingUp, Trophy, UserCheck, UserPlus, Users, UsersRound, WalletCards, X, type LucideIcon } from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { useAuth, type AuthUser } from '@workspace/replit-auth-web';
import type { ProfileUpdate } from '@workspace/api-client-react';
import { normalizeAppleHealthSamples, normalizeHealthConnectSamples, type NormalizedStepSample } from '@/step-sources';
import { ShoelaceMascot } from '@/components/shoelace-mascot';

type Challenge = ApiChallenge;
type Activity = { id: string; type: string; title: string; meta: string; timestamp: string };
type WalletSummary = { balance: number; pending: number; totalEarned: number };
type ProfileSettings = ApiProfileSettings;
type EligibilityProfile = EligibilityInput;
type AppState = {
  challenges: Challenge[];
  joinedIds: string[];
  steps: number;
  activities: Activity[];
  wallet: WalletSummary;
  profile: ProfileSettings;
  membership: MembershipSummary;
  eligibility: EligibilityProfile;
  compliance: ComplianceStatus;
  complianceLoading: boolean;
  healthSources: HealthSource[];
  nativeSourceMessages: Partial<Record<'apple_health' | 'health_connect', string>>;
  stepReviews: StepReview[];
  freeStreak: FreeStreak;
  pendingInvites: PendingInvite[];
  joinChallenge: (id: string) => boolean;
  leaveChallenge: (id: string) => boolean;
  updateEligibility: (eligibility: EligibilityProfile) => void;
  syncNativeSource: (source: 'apple_health' | 'health_connect') => void;
  addFunds: () => void;
  toggleSetting: (key: keyof Pick<ProfileSettings, 'reminders' | 'weeklyDigest' | 'publicProgress' | 'healthConnected'> | 'weekly-digest') => void;
  updateProfile: (updates: ProfileUpdate) => void;
  auth: { user: AuthUser | null; isLoading: boolean; isAuthenticated: boolean; login: () => void; logout: () => void };
};

const queryClient = new QueryClient();
const today = new Date();
const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const AppContext = createContext<AppState | null>(null);
function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('StridePool context is missing');
  return context;
}

function AppProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { data: complianceData, isLoading: complianceLoading } = useGetComplianceStatus();
  const bootstrapQuery = useGetStridePoolBootstrap();
  const entryCheckout = useCreateCheckout();
  const leaveMutation = useLeaveStridePoolChallenge();
  const sourceMutation = useIngestStridePoolSourceSamples();
  const connectionMutation = useUpdateStridePoolHealthSourceConnection();
  const profileMutation = useUpdateStridePoolProfile();
  const pendingInvitesQuery = useGetStridePoolPendingInvites({ query: { queryKey: getGetStridePoolPendingInvitesQueryKey(), enabled: auth.isAuthenticated, staleTime: 30_000 } });
  const bootstrap = bootstrapQuery.data;
  const defaultProfile: ProfileSettings = { displayName: auth.user ? [auth.user.firstName, auth.user.lastName].filter(Boolean).join(' ') || 'Your profile' : 'Alex Morgan', reminders: true, weeklyDigest: true, publicProgress: false, healthConnected: false, goalBaseline: 7500, eligibilityAge: 0, eligibilityState: '', identityStatus: 'not_started', acceptedTerms: false };
  const challenges = bootstrap?.challenges ?? [];
  const joinedIds = bootstrap?.joinedIds ?? [];
  const steps = bootstrap?.steps ?? 0;
  const activities = bootstrap?.activities ?? [];
  const wallet = bootstrap?.wallet ?? { balance: 0, pending: 0, totalEarned: 0 };
  const profile = bootstrap?.profile ?? defaultProfile;
  const membership = bootstrap?.membership ?? { plan: 'free', status: 'inactive', monthlyPrice: 0, challengeJoinPrice: 2, activeChallengeLimit: 1, activeChallengeCount: 0, challengeCreationLimit: 0, activeCreatedChallengeCount: 0 };
  const healthSources = bootstrap?.healthSources ?? [];
  const stepReviews = bootstrap?.stepReviews ?? [];
  const freeStreak = bootstrap?.freeStreak ?? { current: 0, best: 0, lastGoalDate: null };
  const pendingInvites = pendingInvitesQuery.data?.invites ?? bootstrap?.pendingInvites ?? [];
  const [nativeSourceMessages, setNativeSourceMessages] = useState<Partial<Record<'apple_health' | 'health_connect', string>>>({});
  const eligibility: EligibilityProfile = { age: profile.eligibilityAge, state: profile.eligibilityState, identityStatus: profile.identityStatus, acceptedTerms: profile.acceptedTerms };
  const compliance = complianceData ?? { paidPlayEnabled: false, providerConfigured: false, providerName: 'Stripe', webhookReady: false, sandboxReconciliationPassed: false, counselReviewRequired: true, minAge: 18, approvedStates: [], requirements: ['18 or older', 'Identity verified by the payment provider', 'State eligibility confirmed after counsel review', 'Paid-challenge terms and refund policy accepted'], settlementPolicy: ['Integer cents only', 'Deterministic pool rounding', 'Explicit refund and dispute events', 'Auditable payout retries'] };
  const invalidateBootstrap = () => queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() });
  const invalidateCommunity = () => { queryClient.invalidateQueries({ queryKey: getGetStridePoolCommunityChallengesQueryKey() }); queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].includes('/leaderboard') }); };
  const invalidateSocial = () => { invalidateBootstrap(); invalidateCommunity(); queryClient.invalidateQueries({ queryKey: getGetStridePoolReferralSummaryQueryKey() }); };
  const loginIfNeeded = () => { if (!auth.isAuthenticated) auth.login(); };

  const joinChallenge = (id: string) => {
    if (joinedIds.includes(id)) return false;
    if (!auth.isAuthenticated) { loginIfNeeded(); return false; }
    const challenge = challenges.find((item) => item.id === id);
    if (!challenge || membership.activeChallengeCount >= membership.activeChallengeLimit) return false;
    entryCheckout.mutate({ data: { challengeId: id, amountCents: Math.round((challenge.entryFee + membership.challengeJoinPrice) * 100), currency: 'usd', idempotencyKey: `entry-${id}-${Date.now()}` } }, {
      onSuccess: (result) => window.location.assign(result.checkoutUrl),
    });
    return false;
  };
  const leaveChallenge = (id: string) => {
    if (!joinedIds.includes(id)) return false;
    const challenge = challenges.find((item) => item.id === id);
    if (!auth.isAuthenticated && challenge && !challenge.community) { loginIfNeeded(); return false; }
    leaveMutation.mutate({ id }, { onSuccess: invalidateSocial });
    return true;
  };
  const syncNativeSource = async (source: 'apple_health' | 'health_connect') => {
    if (!auth.isAuthenticated) { loginIfNeeded(); return; }
    const bridge = window.StridePoolHealth;
    if (!bridge) {
      setNativeSourceMessages((current) => ({ ...current, [source]: 'Open StridePool from the iOS or Android companion app to request health permissions.' }));
      return;
    }
    try {
      const permission = await bridge.requestPermissions(source);
      connectionMutation.mutate({ source, data: { status: permission } }, { onSuccess: invalidateBootstrap });
      if (permission !== 'connected') {
        setNativeSourceMessages((current) => ({ ...current, [source]: permission === 'denied' ? 'Permission was denied. You can allow step access in your device settings.' : 'Health access was revoked. Re-enable it in your device settings.' }));
        return;
      }
      const nativeSamples = await bridge.readStepSamples(source, new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
      const samples: NormalizedStepSample[] = source === 'apple_health' ? normalizeAppleHealthSamples(nativeSamples) : normalizeHealthConnectSamples(nativeSamples);
      if (!samples.length) {
        setNativeSourceMessages((current) => ({ ...current, [source]: 'Permission is active, but the companion returned no step samples from the last 48 hours.' }));
        return;
      }
      sourceMutation.mutate({ source, data: { samples } }, {
        onSuccess: (result) => {
          setNativeSourceMessages((current) => ({ ...current, [source]: `${result.acceptedCount} sample${result.acceptedCount === 1 ? '' : 's'} received${result.pendingReviewCount ? ` · ${result.pendingReviewCount} held for review` : ''}.` }));
          invalidateBootstrap();
        },
        onError: () => setNativeSourceMessages((current) => ({ ...current, [source]: 'The samples could not be saved. Permission remains connected; try syncing again.' })),
      });
    } catch {
      setNativeSourceMessages((current) => ({ ...current, [source]: 'The companion could not complete the permission request. Try again from the mobile app.' }));
    }
  };
  const updateEligibility = (next: EligibilityProfile) => updateProfile({ eligibilityAge: next.age, eligibilityState: next.state, identityStatus: next.identityStatus, acceptedTerms: next.acceptedTerms });
  const addFunds = () => {
    if (!auth.isAuthenticated) loginIfNeeded();
  };
  const updateProfile = (updates: ProfileUpdate) => {
    if (!auth.isAuthenticated) { loginIfNeeded(); return; }
    profileMutation.mutate({ data: updates }, { onSuccess: invalidateBootstrap });
  };
  const toggleSetting = (key: keyof Pick<ProfileSettings, 'reminders' | 'weeklyDigest' | 'publicProgress' | 'healthConnected'> | 'weekly-digest') => { const actualKey = key === 'weekly-digest' ? 'weeklyDigest' : key; if (actualKey === 'healthConnected') { void syncNativeSource('apple_health'); return; } updateProfile({ [actualKey]: !profile[actualKey] }); };
  const value = useMemo(() => ({ challenges, joinedIds, steps, activities, wallet, profile, membership, eligibility, compliance, complianceLoading, healthSources, nativeSourceMessages, stepReviews, freeStreak, pendingInvites, joinChallenge, leaveChallenge, updateEligibility, syncNativeSource, addFunds, toggleSetting, updateProfile, auth }), [auth, challenges, joinedIds, steps, activities, wallet, profile, membership, eligibility, compliance, complianceLoading, healthSources, nativeSourceMessages, stepReviews, freeStreak, pendingInvites]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Today', icon: Home },
  { href: '/challenges', label: 'Challenges', icon: Compass },
  { href: '/community', label: 'Community', icon: UsersRound },
  { href: '/wallet', label: 'Wallet', icon: WalletCards },
  { href: '/safety', label: 'Safety', icon: ShieldCheck },
  { href: '/profile', label: 'Profile', icon: CircleUserRound },
];

function Logo() {
  return <Link href="/" className="flex items-center gap-2.5" data-testid="link-logo">
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] bg-primary/10">
      <ShoelaceMascot size={44} mood="happy" label="StridePool logo" />
    </span>
    <span className="font-display text-[20px] font-bold tracking-[-.04em] text-primary">StridePool</span>
  </Link>;
}

function AppShell({ children }: { children: ReactNode }) {
  const { auth } = useApp();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notificationsQuery = useGetStridePoolNotifications({ query: { queryKey: [...getGetStridePoolNotificationsQueryKey(), auth.user?.id ?? 'logged-out'], enabled: auth.isAuthenticated, staleTime: 15_000 } });
  const markRead = useMarkStridePoolNotificationRead();
  const markAllRead = useMarkAllStridePoolNotificationsRead();
  const notifications = auth.isAuthenticated ? notificationsQuery.data?.notifications ?? [] : [];
  const unreadCount = auth.isAuthenticated ? notificationsQuery.data?.unreadCount ?? 0 : 0;
  const invalidateNotifications = () => queryClient.invalidateQueries({ queryKey: getGetStridePoolNotificationsQueryKey() });
   const pageName = location === '/' ? 'Today' : location.startsWith('/challenge/') ? 'Challenge details' : location.startsWith('/invite/') ? 'Invite' : location.startsWith('/referral') ? 'Referrals' : location.startsWith('/admin') ? 'Admin' : navItems.find((item) => item.href === location)?.label ?? 'StridePool';
   return <div className="app-noise app-shell min-h-[100dvh] bg-background">
     <aside className="shell-sidebar fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col justify-between border-r border-sidebar-border bg-sidebar px-5 py-6 text-sidebar-foreground lg:flex">
      <div>
        <Logo />
        <div className="mt-12">
          <p className="mb-3 px-3 font-mono-app text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/45">Your rhythm</p>
          <nav className="space-y-1" aria-label="Primary navigation">
            {navItems.map((item) => <NavItem key={item.href} item={item} active={item.href === '/' ? location === '/' : location.startsWith(item.href)} dark />)}
          </nav>
        </div>
        <div className="mt-10 rounded-2xl border border-sidebar-border bg-sidebar-foreground/[.05] p-4">
          <div className="mb-3 flex items-center justify-between"><span className="font-mono-app text-[10px] uppercase tracking-[.15em] text-sidebar-foreground/50">This week</span><TrendingUp size={15} className="text-accent" /></div>
          <p className="font-display text-2xl font-bold">42,318</p>
          <p className="mt-1 text-xs text-sidebar-foreground/55">steps across 6 days</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sidebar-foreground/10"><div className="h-full w-[76%] rounded-full bg-accent" /></div>
        </div>
      </div>
      <div className="space-y-1">
        <NavItem item={{ href: '/profile', label: 'Settings', icon: Settings2 }} active={location === '/profile'} dark />
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-sidebar-foreground/55 transition hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground" data-testid="button-help"><CircleHelp size={18} /> Help center</button>
      </div>
    </aside>
     <div className="lg:pl-[244px]">
        <header className="shell-header sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md sm:px-8 lg:px-12">
        <div className="flex items-center gap-3 lg:hidden"><button className="icon-button rounded-lg p-2 hover:bg-muted" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={21} /></button><Logo /></div>
        <div className="hidden lg:block"><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-muted-foreground">StridePool / {pageName}</p></div>
          <div className="flex items-center gap-2.5"><Link href="/referrals" className="icon-button rounded-lg p-2.5 text-primary transition hover:bg-primary/10" aria-label="Open referrals" title="Referrals" data-testid="button-referrals"><Gift size={19} /></Link><div className="relative"><button onClick={() => setNotificationOpen((value) => !value)} className="icon-button relative rounded-lg p-2.5 hover:bg-muted" aria-label="View notifications" aria-expanded={notificationOpen} data-testid="button-notifications"><Bell size={19} />{unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono-app text-[9px] font-bold text-primary-foreground" data-testid="text-notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>{notificationOpen && <NotificationPanel authenticated={auth.isAuthenticated} notifications={notifications} unreadCount={unreadCount} onClose={() => setNotificationOpen(false)} onMarkRead={(id) => markRead.mutate({ id }, { onSuccess: invalidateNotifications })} onMarkAllRead={() => markAllRead.mutate(undefined, { onSuccess: invalidateNotifications })} onLogin={auth.login} />}</div>{auth.isAuthenticated ? <><Link href="/profile" className="flex items-center gap-2.5 rounded-xl p-1.5 pr-2 transition hover:bg-muted" data-testid="link-header-profile"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-display text-xs font-bold text-secondary-foreground">{(auth.user?.firstName?.[0] ?? 'A')}{(auth.user?.lastName?.[0] ?? 'M')}</span><span className="hidden max-w-[130px] truncate text-sm font-semibold sm:block">{[auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(' ') || 'Your profile'}</span><ChevronDown size={15} className="hidden text-muted-foreground sm:block" /></Link><button onClick={auth.logout} className="hidden text-xs font-bold text-muted-foreground hover:text-foreground sm:block" data-testid="button-logout">Log out</button></> : <button onClick={auth.login} className="rounded-xl bg-foreground px-3 py-2 text-xs font-bold text-background transition hover:bg-primary hover:text-primary-foreground" data-testid="button-login">Log in</button>}</div>
      </header>
       <main className="shell-main page-enter min-h-[calc(100dvh-72px)] px-5 pb-28 pt-8 sm:px-8 lg:px-12 lg:pb-12">{children}</main>
    </div>
     <nav className="mobile-nav fixed bottom-0 left-0 right-0 z-30 flex border-t border-border bg-card/95 px-3 py-2 backdrop-blur-md lg:hidden" aria-label="Mobile navigation">
      {navItems.map((item) => <NavItem key={item.href} item={item} active={item.href === '/' ? location === '/' : location.startsWith(item.href)} />)}
    </nav>
    {mobileOpen && <div className="fixed inset-0 z-40 lg:hidden"><button className="absolute inset-0 bg-foreground/35" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-close-navigation-overlay" /><aside className="relative flex h-full w-[280px] flex-col justify-between bg-sidebar px-5 py-6 text-sidebar-foreground shadow-2xl"><div><div className="flex items-center justify-between"><Logo /><button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 hover:bg-sidebar-foreground/10" aria-label="Close navigation" data-testid="button-close-navigation"><X size={18} /></button></div><nav className="mt-12 space-y-1">{navItems.map((item) => <NavItem key={item.href} item={item} active={item.href === '/' ? location === '/' : location.startsWith(item.href)} dark onNavigate={() => setMobileOpen(false)} />)}</nav></div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/40">Small steps, shared momentum.</p></aside></div>}
  </div>;
}

function NotificationPanel({ authenticated, notifications, unreadCount, onClose, onMarkRead, onMarkAllRead, onLogin }: {
  authenticated: boolean;
  notifications: ApiNotification[];
  unreadCount: number;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onLogin: () => void;
}) {
  return <div className="absolute right-0 top-12 z-40 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" role="status" data-testid="panel-notifications">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div><p className="font-display text-sm font-bold">Your rhythm notes</p><p className="mt-0.5 text-[10px] text-muted-foreground">{unreadCount ? `${unreadCount} unread` : 'All caught up'}</p></div>
      <div className="flex items-center gap-1">
        {authenticated && unreadCount > 0 && <button onClick={onMarkAllRead} className="rounded-md px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/10" data-testid="button-mark-all-notifications-read">Mark all read</button>}
        <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close notifications" data-testid="button-close-notifications"><X size={14} /></button>
      </div>
    </div>
    {!authenticated ? <div className="p-5"><p className="text-xs leading-5 text-muted-foreground">Log in to keep reminders, group updates, and finish-line notes with your account.</p><Button variant="secondary" className="mt-4 w-full text-xs" onClick={onLogin} data-testid="button-login-notifications">Log in to see your notes</Button></div>
      : notifications.length === 0 ? <div className="p-6 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-primary"><Bell size={17} /></div><p className="mt-3 text-sm font-bold">Nothing new yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Your notes will appear here as your challenges move.</p></div>
      : <div className="max-h-[min(60vh,420px)] overflow-y-auto">{notifications.map((notification) => <div key={notification.id} className={`border-b border-border/70 px-4 py-3 last:border-0 ${notification.readAt ? 'bg-card' : 'bg-accent/10'}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${notification.type === 'eliminated' ? 'bg-primary/15 text-primary' : notification.type === 'challenge_finished' ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-primary'}`}><Bell size={14} /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="text-xs font-bold">{notification.title}</p>{!notification.readAt && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{notification.body}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="font-mono-app text-[9px] uppercase tracking-wide text-muted-foreground">{new Date(notification.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>{!notification.readAt && <button onClick={() => onMarkRead(notification.id)} className="text-[10px] font-bold text-primary hover:underline" data-testid={`button-mark-notification-read-${notification.id}`}>Mark read</button>}</div></div></div></div>)}</div>}
  </div>;
}

function NavItem({ item, active, dark, onNavigate }: { item: { href: string; label: string; icon: LucideIcon }; active: boolean; dark?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return <Link href={item.href} onClick={onNavigate} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? (dark ? 'bg-secondary text-secondary-foreground shadow-[3px_3px_0_hsl(var(--primary))]' : 'bg-foreground text-background') : (dark ? 'text-sidebar-foreground/55 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}`} data-testid={`link-nav-${item.label.toLowerCase()}`}><Icon size={18} strokeWidth={active ? 2.4 : 1.8} /><span className="lg:inline">{item.label}</span>{active && <ChevronRight size={14} className="ml-auto hidden lg:block" />}</Link>;
}

function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="mb-5 flex items-end justify-between gap-4"><div>{eyebrow && <p className="mb-1.5 font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">{eyebrow}</p>}<h2 className="font-display text-xl font-bold tracking-[-.035em] sm:text-2xl">{title}</h2></div>{action}</div>;
}

function Button({ children, variant = 'primary', className = '', ...props }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = { primary: 'bg-primary text-primary-foreground shadow-[3px_3px_0_hsl(var(--foreground))] hover:-translate-y-0.5 hover:shadow-[4px_4px_0_hsl(var(--foreground))]', secondary: 'border border-border bg-card text-foreground hover:bg-muted', quiet: 'text-muted-foreground hover:bg-muted hover:text-foreground', danger: 'border border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15' };
  return <button className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`} {...props}>{children}</button>;
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'coral' | 'teal' | 'lime' }) {
  const tones = { neutral: 'bg-muted text-muted-foreground', coral: 'bg-primary/10 text-primary', teal: 'bg-secondary text-secondary-foreground', lime: 'bg-secondary text-secondary-foreground' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono-app text-[10px] uppercase tracking-[.08em] ${tones[tone]}`}>{children}</span>;
}

function Dashboard() {
  const { challenges, steps, activities, wallet, freeStreak } = useApp();
  const [showAllActivity, setShowAllActivity] = useState(false);
  const goal = 10_000;
  const percent = Math.min(100, Math.round((steps / goal) * 100));
  const spotlight = challenges.find((item) => item.joined) ?? challenges[0];
  const upcoming = challenges.find((item) => !item.joined);
  if (!spotlight) return <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center"><div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-primary/10 text-primary shadow-sm"><ShoelaceMascot size={68} mood="calm" label="Shoelace mascot loading" /></div><h1 className="mt-6 font-display text-3xl font-extrabold tracking-[-.02em]">Your rhythm is loading</h1><p className="mt-3 text-base text-muted-foreground font-medium">We’re syncing your step data and verifying live prize pools.</p></div>;
  
  return <div className="mx-auto max-w-[1280px]">
    {/* Header section with date and greeting */}
    <div className="mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end lg:mb-9">
      <div className="rise-in">
        <p className="mb-3 font-mono-app text-[10px] font-bold uppercase tracking-[.22em] text-primary/80">{dateLabel}</p>
        <h1 className="font-display text-[clamp(2.35rem,6vw,4rem)] font-extrabold leading-[.94] tracking-[-.05em]">
          Keep your <span className="relative inline-block text-primary">rhythm.<span className="absolute -bottom-2 left-0 -z-10 h-3 w-full rounded-full bg-primary/20" /></span>
        </h1>
        <p className="mt-4 max-w-md text-sm font-medium leading-6 text-muted-foreground sm:text-base">Every step verified. Every pool secured. A little movement today keeps tomorrow feeling lighter.</p>
      </div>
      
      {/* Wallet mini-summary at the top right as a trust cue */}
      <div className="rise-in delay-1 flex flex-col sm:items-end">
        <Link href="/wallet" className="lift-card group flex min-w-[220px] items-center justify-between gap-5 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]" data-testid="link-wallet">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono-app text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Verified wallet</span>
              <ArrowUpRight size={13} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-display text-2xl font-bold tracking-[-.02em] text-foreground">${wallet.balance.toFixed(2)}</span>
              <span className="text-[11px] font-medium text-muted-foreground">available</span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">{wallet.pending > 0 ? `$${wallet.pending.toFixed(2)} pending` : 'No pending funds'}</p>
          </div>
        </Link>
      </div>
    </div>

    <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr] xl:grid-cols-[1.18fr_1fr]">
      {/* Left: Huge Step Progress Card */}
      <div className="rise-in delay-2 relative flex flex-col justify-between overflow-hidden rounded-[28px] bg-foreground p-6 shadow-[var(--shadow-soft)] sm:p-8 lg:min-h-[390px]">
        <div className="pointer-events-none absolute -right-20 -top-28 h-[360px] w-[360px] rounded-full bg-gradient-to-br from-primary/30 to-accent/30 opacity-60 blur-[75px]" />
        
        <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:gap-6">
          <div className="flex flex-col justify-center">
            <div className="mb-6 flex w-fit items-center gap-2.5 rounded-full border border-background/10 bg-background/10 px-3 py-2 text-background/80 backdrop-blur-sm">
              <span className="pulse-dot h-2 w-2 rounded-full bg-accent" />
              <span className="font-mono-app text-[10px] font-bold uppercase tracking-[.18em]">Live progress</span>
            </div>
            
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[clamp(4.25rem,8vw,6.7rem)] font-black leading-none tracking-[-.08em] text-background" data-testid="text-todays-steps">
                {steps.toLocaleString()}
              </span>
              <span className="font-mono-app text-xs font-bold tracking-wider text-background/50 sm:text-sm">/ {goal.toLocaleString()}</span>
            </div>
            
            <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-background/70 sm:text-base">
              {goal - steps > 0 ? <><strong className="text-background">{`${(goal - steps).toLocaleString()}`}</strong> verified steps to hit your daily goal.</> : 'Daily goal met — beautifully done.'}
            </p>
            
            <div className="mt-8 flex flex-wrap gap-2.5 text-xs text-background/70 sm:text-sm">
              <span className="streak-pulse flex items-center gap-2 rounded-xl border border-background/10 bg-background/5 px-3.5 py-2.5 backdrop-blur-sm">
                <Flame size={17} className="text-primary" />
                <strong className="text-background">{freeStreak.current} day{freeStreak.current === 1 ? '' : 's'}</strong> streak
              </span>
              <span className="flex items-center gap-2 rounded-xl border border-background/10 bg-background/5 px-3.5 py-2.5 backdrop-blur-sm">
                <ShieldCheck size={17} className="text-accent" />
                <strong className="text-background">Verified</strong> before scoring
              </span>
            </div>
          </div>
          
              <div className="relative flex shrink-0 items-center justify-center self-center">
            <div className="relative flex h-44 w-44 items-center justify-center rounded-full border border-background/10 bg-background/5 backdrop-blur-sm sm:h-52 sm:w-52">
              <svg className="absolute inset-0 h-full w-full -rotate-90 drop-shadow-[0_0_15px_rgba(115,201,94,0.3)]" viewBox="0 0 100 100" aria-label={`${percent}% of daily goal complete`}>
                <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="8" className="text-background/10" />
                <circle 
                  cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="8" 
                  className="progress-ring text-accent transition-all duration-1000 ease-out" 
                  strokeDasharray="276.46" 
                  strokeDashoffset={276.46 - (276.46 * percent) / 100}
                  strokeLinecap="round"
                />
              </svg>
              <div className="flex flex-col items-center justify-center">
                  <span className="font-display text-5xl font-extrabold tracking-[-.04em] text-background">{percent}%</span>
                <span className="mt-2 font-mono-app text-[10px] font-bold uppercase tracking-widest text-background/60">Complete</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Active Spotlight Challenge */}
      <div className="rise-in delay-3 relative flex flex-col justify-between overflow-hidden rounded-[28px] border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-bl-full bg-primary/5" />
        
        <div>
          <div className="mb-7 flex items-center justify-between">
            <Badge tone="coral">Active Pool</Badge>
            <RadioDot />
          </div>
          
          <h2 className="mb-3 pr-4 font-display text-2xl font-extrabold leading-[1.1] tracking-[-.04em] sm:text-3xl">{spotlight.name}</h2>
          <p className="mb-8 line-clamp-2 text-sm font-medium leading-relaxed text-muted-foreground">{spotlight.theme}</p>
          
          <div className="space-y-4 rounded-[20px] border border-border/60 bg-muted/40 p-4 sm:p-5">
            <StatLine icon={<Target size={18} strokeWidth={2.5} />} label={spotlight.goalType === 'personalized' ? 'Your target' : 'Daily target'} value={`${spotlight.dailyGoal.toLocaleString()} steps`} />
            <StatLine icon={<Users size={18} strokeWidth={2.5} />} label="Verified walkers" value={`${spotlight.participantCount} people`} />
            <div className="my-2 h-px bg-border/60" />
            <StatLine icon={<Award size={18} strokeWidth={2.5} className="text-accent-foreground" />} label="Secured pool" value={spotlight.community ? 'Free entry' : `$${spotlight.prizePool.toLocaleString()}`} />
          </div>
        </div>
        
        <Link href={`/challenge/${spotlight.id}`} className="group mt-7 flex w-full items-center justify-between rounded-xl bg-foreground px-5 py-3.5 text-sm font-bold text-background shadow-md transition-all hover:scale-[1.01] hover:bg-primary hover:shadow-lg" data-testid={`link-spotlight-${spotlight.id}`}>
          <span>View live standings</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/20 transition-colors group-hover:bg-background/30">
            <ArrowUpRight size={18} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </Link>
      </div>
    </section>

    {/* Row 2: Secondary Content */}
    <section className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
      {/* Active Challenges */}
      <div className="rise-in delay-4 flex flex-col">
        <SectionHeading eyebrow="Your circle" title="Challenges in motion" action={<Link href="/challenges" className="group flex items-center gap-1.5 text-sm font-bold text-primary hover:text-primary/80 transition-colors bg-primary/10 px-3 py-1.5 rounded-full" data-testid="link-see-all-challenges">See all <ChevronRight size={16} className="transition-transform group-hover:translate-x-1" /></Link>} />
        
        <div className="grid gap-4 sm:grid-cols-2">
          {challenges.filter((item) => item.joined && item.id !== spotlight.id).slice(0, 3).map((challenge) => (
            <div className={`challenge-stagger rise-in`} key={challenge.id}>
              <ChallengeMiniCard challenge={challenge} />
            </div>
          ))}
          
          <Link href="/challenges" className="lift-card group flex min-h-[210px] flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-border/80 bg-card/50 p-6 text-center transition-all hover:border-primary/40 hover:bg-muted/50 sm:p-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-accent-foreground shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:bg-accent/30">
              <Plus size={24} strokeWidth={2.5} />
            </div>
            <p className="font-extrabold tracking-[-.02em] text-foreground">Find your next rhythm</p>
            <p className="mt-2 text-xs font-medium text-muted-foreground">Browse verified open pools</p>
          </Link>
        </div>
      </div>

      {/* Activity & Upcoming */}
      <div className="rise-in delay-5 flex flex-col gap-8">
        {/* Upcoming Card */}
        <div>
          <SectionHeading eyebrow="On deck" title="Coming up next" />
          {upcoming ? <div className="lift-card group/upcoming relative rounded-[24px] border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-border bg-card shadow-sm" style={{ color: upcoming.color }}>
                  <CalendarDays size={24} strokeWidth={2} />
                </div>
                <Badge tone="teal">Starts {upcoming.startDate}</Badge>
              </div>
              <h3 className="font-display text-xl font-extrabold tracking-[-.03em] sm:text-2xl">{upcoming.name}</h3>
              <p className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px] font-medium leading-relaxed text-muted-foreground">
                <span className="flex items-center gap-1.5"><Clock3 size={15} /> {upcoming.days}d</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="flex items-center gap-1.5"><Footprints size={15} /> {upcoming.dailyGoal.toLocaleString()}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="flex items-center gap-1.5"><Award size={15} /> ${upcoming.entryFee}</span>
              </p>
              <Link href={`/challenge/${upcoming.id}`} className="mt-6 flex w-full items-center justify-center rounded-xl border-2 border-border/80 bg-transparent py-3 text-sm font-bold text-foreground transition-all hover:border-primary hover:text-primary group-hover/upcoming:border-border" data-testid={`link-upcoming-${upcoming.id}`}>
                View details <ArrowUpRight size={16} className="ml-2 transition-transform group-hover/upcoming:translate-x-0.5 group-hover/upcoming:-translate-y-0.5" />
              </Link>
            </div> : <div className="flex min-h-[214px] flex-col justify-between rounded-[24px] border border-dashed border-border bg-card/60 p-6 shadow-[var(--shadow-card)] sm:p-7">
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-accent/25 text-accent-foreground"><Compass size={23} /></div>
                <h3 className="mt-6 font-display text-xl font-extrabold tracking-[-.03em]">Make room for the next one</h3>
                <p className="mt-2 text-sm font-medium leading-5 text-muted-foreground">Browse verified pools and choose a challenge that fits your week.</p>
              </div>
              <Link href="/challenges" className="mt-6 flex w-full items-center justify-center rounded-xl bg-foreground py-3 text-sm font-bold text-background transition hover:bg-primary hover:text-primary-foreground" data-testid="link-upcoming-browse">
                Browse challenges <ArrowUpRight size={16} className="ml-2" />
              </Link>
            </div>}
        </div>
        
        {/* Activity Feed */}
        <div className="flex flex-col flex-1">
          <SectionHeading 
            eyebrow="Recent movement" 
            title="Verified Activity" 
            action={
              <button onClick={() => setShowAllActivity(!showAllActivity)} className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors group bg-muted/50 px-3 py-1.5 rounded-full" data-testid="button-view-activity">
                {showAllActivity ? 'Show less' : 'View all'} 
                <ChevronRight size={16} className={`transition-transform ${showAllActivity ? 'rotate-90' : 'group-hover:translate-x-1'}`} />
              </button>
            } 
          />
          <div className="rounded-[24px] border border-border bg-card shadow-[var(--shadow-card)] flex-1 overflow-hidden p-2">
            {activities.slice(0, showAllActivity ? 15 : 4).map((activity) => (
              <ActivityRow activity={activity} key={activity.id} />
            ))}
          </div>
        </div>
      </div>
    </section>
  </div>;
}

function HealthSourcesPanel({ sources }: { sources: HealthSource[] }) {
  const { stepReviews } = useApp();
  return <section className="grid gap-5" data-testid="panel-source-trust">
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">Verified movement</p><h2 className="mt-1 font-display text-xl font-bold">Your health sources</h2><p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">All challenge steps must come from Apple Health on iPhone or Health Connect on Android. StridePool checks every uploaded sample before it can affect progress or payouts.</p></div><ShieldCheck size={20} className="shrink-0 text-primary" /></div>
      <div className="mt-5 rounded-xl border border-secondary/70 bg-secondary/35 p-4"><div className="flex items-start gap-3"><HeartPulse size={17} className="mt-0.5 shrink-0 text-secondary-foreground" /><div><p className="text-sm font-bold text-secondary-foreground">Native health data stays permissioned</p><p className="mt-1 text-[11px] leading-5 text-secondary-foreground/75">StridePool never asks the browser for health data. The iOS and Android companion requests the platform permission, reads step records, and sends only normalized samples for server-side verification.</p></div></div></div>
      <NativeSourceCards sources={sources} />
      {stepReviews.length > 0 && <div className="mt-5 rounded-xl border border-primary/25 bg-primary/10 p-4" data-testid="panel-step-reviews"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-primary">Records held for review</p><Badge tone="coral">{stepReviews.length} flagged</Badge></div><div className="mt-3 space-y-2">{stepReviews.slice(0, 5).map((review) => <div className="rounded-lg bg-background/70 p-3" key={review.id}><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold">{review.steps.toLocaleString()} steps · {review.recordDate}</p><span className="font-mono-app text-[9px] uppercase text-primary">not counted</span></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{review.reviewFlags.map((flag) => flag.replaceAll('_', ' ')).join(' · ')} · {review.source.replaceAll('_', ' ')}</p></div>)}</div></div>}
     </div>
   </section>;
}

function NativeSourceCards({ sources }: { sources: HealthSource[] }) {
  const { syncNativeSource, nativeSourceMessages } = useApp();
  const [busySource, setBusySource] = useState<string | null>(null);
  const statusLabels: Record<HealthSource['status'], string> = {
    available: 'Permission not requested',
    connected: 'Connected',
    denied: 'Permission denied',
    stale: 'Sync is stale',
    revoked: 'Permission revoked',
  };
  const statusStyles: Record<HealthSource['status'], string> = {
    available: 'bg-muted-foreground/35',
    connected: 'bg-primary',
    denied: 'bg-destructive',
    stale: 'bg-accent-foreground',
    revoked: 'bg-destructive',
  };
  const actionLabels: Record<HealthSource['status'], string> = {
    available: 'Connect in mobile app',
    connected: 'Sync now',
    denied: 'Try permission again',
    stale: 'Sync now',
    revoked: 'Open device settings',
  };
  return <div className="mt-5 grid gap-3 sm:grid-cols-2">{sources.map((source) => {
    const isBusy = busySource === source.source;
    const message = nativeSourceMessages[source.source as 'apple_health' | 'health_connect'];
    const canSync = source.source === 'apple_health' || source.source === 'health_connect';
    return <div key={source.source} className="rounded-xl border border-border/80 bg-background p-4" data-testid={`card-source-${source.source}`}>
      <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><HeartPulse size={17} /></span><div className="min-w-0"><p className="text-sm font-bold">{source.label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{statusLabels[source.status]}{source.lastSyncedAt ? ` · last sync ${new Date(source.lastSyncedAt).toLocaleString()}` : ''}</p></div><span className={`ml-auto h-2 w-2 rounded-full ${statusStyles[source.status]}`} aria-label={statusLabels[source.status]} /></div>
      {source.status === 'connected' && <p className="mt-3 text-[11px] text-muted-foreground">{source.verifiedSamples} verified samples · {source.pendingReview} pending review</p>}
      {source.status === 'stale' && <p className="mt-3 rounded-lg bg-accent/30 p-2 text-[11px] leading-4 text-accent-foreground">No successful delivery has arrived in more than 36 hours. Your existing verified totals remain unchanged.</p>}
      {(source.status === 'denied' || source.status === 'revoked') && <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-[11px] leading-4 text-destructive">{source.status === 'denied' ? 'Permission was denied. Allow step access in device settings before trying again.' : 'Permission was revoked. Re-enable step access in device settings before syncing.'}</p>}
      {message && <p className="mt-3 rounded-lg bg-primary/10 p-2 text-[11px] leading-4 text-primary" role="status">{message}</p>}
      {canSync && <Button variant="secondary" className="mt-3 w-full px-3 py-2 text-xs" disabled={isBusy} onClick={async () => { setBusySource(source.source); await syncNativeSource(source.source as 'apple_health' | 'health_connect'); setBusySource(null); }} data-testid={`button-connect-${source.source}`}>{isBusy ? 'Checking permission…' : actionLabels[source.status]}</Button>}
    </div>;
  })}</div>;
}

function RadioDot() { return <span className="flex items-center gap-2 font-mono-app text-[10px] uppercase tracking-widest text-muted-foreground font-bold"><span className="pulse-dot h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" /> updates live</span>; }
function StatLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { const isValue = label === 'Est. finisher share' || label === 'Secured pool'; return <div className="flex items-center gap-3.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-background border border-border/50 text-primary shadow-sm">{icon}</span><span className="text-[13px] font-medium text-muted-foreground">{label === 'Est. finisher share' ? 'Payout if you finish' : label}</span><span className={`ml-auto text-sm font-bold ${isValue ? 'text-accent-text' : 'text-foreground'}`}>{label === 'Est. finisher share' ? value.replace(/^~/, '') : value}</span></div>; }
function ChallengeMiniCard({ challenge }: { challenge: Challenge }) { const progress = Math.round((challenge.finishers / challenge.participantCount) * 100); return <Link href={`/challenge/${challenge.id}`} className="lift-card group block rounded-[24px] border border-border bg-card p-6 shadow-[var(--shadow-card)] relative overflow-hidden" data-testid={`card-joined-challenge-${challenge.id}`}><div className="absolute top-0 right-0 w-16 h-16 opacity-10 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110" style={{ backgroundColor: challenge.color }} /><div className="flex items-start justify-between"><span className="h-4 w-4 rounded-full shadow-sm" style={{ backgroundColor: challenge.color }} /><Badge tone="lime">Joined</Badge></div><h3 className="mt-6 font-display text-xl font-bold tracking-[-.02em]">{challenge.name}</h3><div className="mt-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Clock3 size={14} /> {challenge.days} day challenge <span className="text-border">/</span> ends {challenge.endDate}</div><div className="mt-6"><div className="mb-2.5 flex justify-between font-mono-app text-[10px] uppercase tracking-wider text-muted-foreground font-bold"><span>Group progress</span><span>{progress}%</span></div><div className="h-2 rounded-full bg-muted/50 overflow-hidden"><div className="progress-fill h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: challenge.color }} /></div></div></Link>; }
function ActivityRow({ activity }: { activity: Activity }) { const Icon = activity.type === 'sync' ? RefreshCw : activity.type === 'milestone' ? Trophy : Footprints; return <div className="flex items-center gap-4 border-b border-border/60 px-5 py-4.5 last:border-0 hover:bg-muted/30 transition-colors"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-background border border-border/50 text-primary shadow-sm"><Icon size={18} strokeWidth={2} /></span><div className="min-w-0 flex-1"><p className="truncate text-[15px] font-bold tracking-[-.01em]">{activity.title}</p><p className="mt-1 truncate text-[13px] font-medium text-muted-foreground">{activity.meta}</p></div><span className="shrink-0 font-mono-app text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{activity.timestamp}</span></div>; }

function RankingChallengeCreator() {
  const { auth, eligibility, compliance, membership } = useApp();
  const [challengeType, setChallengeType] = useState<'goal' | 'ranking'>('goal');
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('');
  const [entryFee, setEntryFee] = useState('10');
  const [startDate, setStartDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [days, setDays] = useState('7');
  const [dailyGoal, setDailyGoal] = useState('7500');
  const [message, setMessage] = useState('');
  const createChallenge = useCreateStridePoolChallenge();
  const checkout = useCreateCheckout();
  const paidAllowed = eligibility.age >= compliance.minAge && eligibility.state.length === 2 && eligibility.identityStatus === 'verified' && eligibility.acceptedTerms && compliance.paidPlayEnabled && compliance.providerConfigured;
  const canCreate = membership.plan === 'pro' && membership.activeCreatedChallengeCount < membership.challengeCreationLimit && membership.activeChallengeCount < membership.activeChallengeLimit;
  const daysAmount = Number(days);
  const endDate = useMemo(() => {
    if (!Number.isInteger(daysAmount) || daysAmount < 1) return '';
    const date = new Date(`${startDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + daysAmount - 1);
    return date.toISOString().slice(0, 10);
  }, [days, startDate]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth.isAuthenticated) { auth.login(); return; }
    if (!name.trim() || !theme.trim()) { setMessage('Add a name and a short description.'); return; }
    const entryFeeAmount = Number(entryFee);
    if (!Number.isFinite(entryFeeAmount) || entryFeeAmount < 1 || entryFeeAmount > 500) { setMessage('Choose an entry fee from $1 to $500.'); return; }
    const dailyGoalAmount = Number(dailyGoal);
    if (!endDate || !Number.isInteger(daysAmount) || daysAmount < 1 || daysAmount > 90) { setMessage('Choose a challenge length from 1 to 90 days.'); return; }
    if (challengeType === 'goal' && (!Number.isInteger(dailyGoalAmount) || dailyGoalAmount < 1 || dailyGoalAmount > 100000)) { setMessage('Choose a daily target from 1 to 100,000 steps.'); return; }
    createChallenge.mutate({ data: { name: name.trim(), theme: theme.trim(), startDate, endDate, days: daysAmount, dailyGoal: challengeType === 'goal' ? dailyGoalAmount : 0, challengeType, entryFee: entryFeeAmount, color: '#d9ef62' } }, {
      onSuccess: (challenge) => {
        setMessage(`Challenge created. Opening checkout for the $${entryFeeAmount.toFixed(2)} entry plus your $${membership.challengeJoinPrice.toFixed(2)} platform fee.`);
        setName('');
        setTheme('');
        queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStridePoolCommunityChallengesQueryKey() });
        checkout.mutate({ data: { challengeId: challenge.id, amountCents: Math.round((challenge.entryFee + membership.challengeJoinPrice) * 100), currency: 'usd', idempotencyKey: `creator-entry-${challenge.id}-${Date.now()}` } }, {
          onSuccess: (result) => window.location.assign(result.checkoutUrl),
          onError: () => setMessage('Challenge created, but checkout could not open. Enter it from the challenge details page.'),
        });
      },
      onError: () => setMessage('We could not create that challenge. Check the dates and paid-play requirements.'),
    });
  };
  return <section className="mb-8 rounded-[22px] border border-accent bg-accent/20 p-5 sm:p-7" data-testid="panel-create-challenge">
    <div className="flex items-start justify-between gap-4"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-accent-foreground">Create a paid challenge</p><h2 className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">{challengeType === 'goal' ? 'Show up every day.' : 'Most verified steps wins.'}</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">{challengeType === 'goal' ? 'Set a daily step target and a fixed number of days. Everyone who completes every day shares the pool.' : 'Set the entry fee and challenge length. The top three total verified step counts split the pot 60% / 25% / 15%.'}</p></div>{challengeType === 'goal' ? <Target className="hidden shrink-0 text-accent-foreground sm:block" size={23} /> : <Trophy className="hidden shrink-0 text-accent-foreground sm:block" size={23} />}</div>
    {!auth.isAuthenticated ? <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Log in and upgrade to Pro to create a challenge.</p><Button variant="secondary" onClick={auth.login}>Log in to create</Button></div> : membership.plan !== 'pro' ? <div className="mt-5 rounded-xl border border-border bg-card p-4"><p className="text-sm font-bold">Challenge creation is a Pro feature</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Pro is $5/month and includes one active challenge you create, participation in up to five challenges, and a $1 platform fee per paid entry.</p><Link href="/profile" className="mt-3 inline-flex text-xs font-bold text-primary">See Pro membership <ArrowUpRight size={13} /></Link></div> : <form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={submit}>
      <div className="grid gap-3 lg:col-span-2 sm:grid-cols-2"><button type="button" onClick={() => setChallengeType('goal')} className={`rounded-xl border p-4 text-left transition ${challengeType === 'goal' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'}`} aria-pressed={challengeType === 'goal'} data-testid="button-select-goal-challenge"><span className="flex items-center gap-2 text-sm font-bold"><Target size={16} /> Daily goal</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Complete the target every day to share the pool.</span></button><button type="button" onClick={() => setChallengeType('ranking')} className={`rounded-xl border p-4 text-left transition ${challengeType === 'ranking' ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'}`} aria-pressed={challengeType === 'ranking'} data-testid="button-select-ranking-challenge"><span className="flex items-center gap-2 text-sm font-bold"><Trophy size={16} /> Top-three podium</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">The most verified steps earn 60% / 25% / 15%.</span></button></div>
      <label className="text-xs font-bold">Challenge name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={challengeType === 'goal' ? 'Seven steady days' : 'Weekend step podium'} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-challenge-name" /></label>
      <label className="text-xs font-bold">What is it for?<input value={theme} onChange={(event) => setTheme(event.target.value)} maxLength={240} placeholder={challengeType === 'goal' ? 'A shared reason to keep showing up' : 'See who can cover the most ground'} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-challenge-theme" /></label>
      <label className="text-xs font-bold">Challenge entry fee<input type="number" min="1" max="500" step="0.01" value={entryFee} onChange={(event) => setEntryFee(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-challenge-entry-fee" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">Starts<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-xs" data-testid="input-challenge-start-date" /></label><label className="text-xs font-bold">Number of days<input type="number" min="1" max="90" value={days} onChange={(event) => setDays(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-challenge-days" /></label></div>
      {challengeType === 'goal' ? <label className="text-xs font-bold">Steps required each day<input type="number" min="1" max="100000" value={dailyGoal} onChange={(event) => setDailyGoal(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-challenge-daily-goal" /><span className="mt-1 block text-[10px] font-normal text-muted-foreground">Every day must meet this target. There are no grace days.</span></label> : <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-bold">Podium payout</p><div className="mt-2 flex gap-4 text-xs"><span><strong className="text-primary">60%</strong> first</span><span><strong className="text-primary">25%</strong> second</span><span><strong className="text-primary">15%</strong> third</span></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">Total verified steps after {days || '—'} days determine the final ranking.</p></div>}
      <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs font-bold">${Number(entryFee || 0).toFixed(2)} entry + ${membership.challengeJoinPrice.toFixed(2)} platform fee</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">The entry goes into the prize pool. The platform fee is paid to StridePool. You also occupy one active challenge place.</p></div>
      <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-4 lg:col-span-2"><p className="text-[11px] leading-5 text-muted-foreground">{membership.activeCreatedChallengeCount}/{membership.challengeCreationLimit} created · {membership.activeChallengeCount}/{membership.activeChallengeLimit} active places used{endDate ? ` · ends ${endDate}` : ''}</p><Button type="submit" disabled={createChallenge.isPending || checkout.isPending || !paidAllowed || !canCreate} data-testid="button-create-challenge">{createChallenge.isPending ? 'Creating…' : 'Create and enter challenge'}</Button></div>
      {message && <p className="text-[11px] font-semibold text-primary lg:col-span-2" role="status">{message}</p>}
    </form>}
  </section>;
}

function ChallengesPage() {
  const { challenges, joinChallenge } = useApp();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('All levels');
  const [sort, setSort] = useState('Recommended');
  const [showJoined, setShowJoined] = useState(false);
  const filtered = useMemo(() => challenges.filter((item) => (!showJoined || item.joined) && (level === 'All levels' || item.level === level) && `${item.name} ${item.theme}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'Lowest entry' ? a.entryFee - b.entryFee : sort === 'Most people' ? b.participantCount - a.participantCount : a.joined === b.joined ? 0 : a.joined ? -1 : 1), [challenges, query, level, sort, showJoined]);
    return <div className="mx-auto max-w-[1280px]"><div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Open invitations</p><h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-.06em]">Find your people.</h1><p className="mt-3 text-sm text-muted-foreground">Every pool has a pace. Pick one that feels like yours.</p></div><div className="flex flex-wrap gap-2"><Link href="/community" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold transition hover:bg-muted" data-testid="link-community-discovery"><UsersRound size={16} /> Community</Link><Button variant="secondary" onClick={() => setShowJoined((value) => !value)} data-testid="button-toggle-joined-filter"><ListFilter size={16} /> {showJoined ? 'Show all' : 'Joined only'}</Button></div></div>
     <RankingChallengeCreator />
    <div className="mb-7 grid gap-3 md:grid-cols-[1fr_170px_180px]"><label className="relative block"><Search className="absolute left-3.5 top-3.5 text-muted-foreground" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search challenges" aria-label="Search challenges" className="h-11 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none transition focus:border-primary" data-testid="input-search-challenges" /></label><label className="relative"><select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Filter by level" className="h-11 w-full appearance-none rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-primary" data-testid="select-level-filter"><option>All levels</option><option>Gentle</option><option>Steady</option><option>Brisk</option></select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground" /></label><label className="relative"><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort challenges" className="h-11 w-full appearance-none rounded-xl border border-border bg-card px-4 text-sm outline-none focus:border-primary" data-testid="select-sort-challenges"><option>Recommended</option><option>Lowest entry</option><option>Most people</option></select><SlidersHorizontal size={16} className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground" /></label></div>
    {filtered.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((challenge, index) => <ChallengeCard challenge={challenge} index={index} onJoin={() => joinChallenge(challenge.id)} key={challenge.id} />)}</div> : <EmptyChallenges clear={() => { setQuery(''); setLevel('All levels'); setShowJoined(false); }} />}</div>;
}

function ChallengeCard({ challenge, index, onJoin }: { challenge: Challenge; index: number; onJoin: () => void; }) {
  return <article className={`challenge-stagger lift-card rise-in delay-${Math.min(index + 1, 4)} overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]`} data-testid={`card-challenge-${challenge.id}`}><div className="h-2" style={{ backgroundColor: challenge.color }} /><div className="p-5 sm:p-6"><div className="flex items-start justify-between"><Badge tone={challenge.community ? 'teal' : challenge.level === 'Gentle' ? 'teal' : challenge.level === 'Brisk' ? 'lime' : 'coral'}>{challenge.visibility === 'private_group' ? 'Private group' : challenge.community ? (challenge.challengeType === 'elimination' ? 'Elimination' : 'Community') : challenge.challengeType === 'ranking' ? 'Podium' : challenge.level}</Badge>{challenge.joined ? <Badge tone="lime">Joined</Badge> : <span className="font-mono-app text-[10px] uppercase text-muted-foreground">{challenge.startDate}</span>}</div><Link href={`/challenge/${challenge.id}`} className="mt-5 block" data-testid={`link-challenge-title-${challenge.id}`}><h2 className="font-display text-[22px] font-bold tracking-[-.045em]">{challenge.name}</h2><p className="mt-1.5 text-sm leading-5 text-muted-foreground">{challenge.theme}</p></Link><div className="mt-6 grid grid-cols-2 gap-3 border-y border-border/70 py-4"><div><p className="font-mono-app text-[10px] uppercase text-muted-foreground">{challenge.challengeType === 'ranking' ? 'Payout' : challenge.goalType === 'personalized' ? 'Your daily goal' : 'Daily goal'}</p><p className="mt-1 text-sm font-bold">{challenge.challengeType === 'ranking' ? '60% / 25% / 15%' : <>{challenge.dailyGoal.toLocaleString()} <span className="font-normal text-muted-foreground">steps</span></>}</p></div><div><p className="font-mono-app text-[10px] uppercase text-muted-foreground">Entry</p><p className="mt-1 text-sm font-bold">{challenge.entryFee ? `$${challenge.entryFee}` : 'Free'}</p></div></div><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Users size={14} /> {challenge.participantCount} walkers</span><span className="font-bold text-accent-text">{challenge.community ? 'No pool' : `$${challenge.prizePool.toLocaleString()} pool`}</span></div>{challenge.joined ? <Link href={`/challenge/${challenge.id}`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-bold hover:bg-muted" data-testid={`button-view-joined-${challenge.id}`}>View your progress <ArrowUpRight size={15} /></Link> : <Link href={`/challenge/${challenge.id}`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-2.5 text-sm font-bold text-background transition hover:bg-primary hover:text-primary-foreground" data-testid={`button-join-${challenge.id}`}>{challenge.community ? 'Join for free' : 'See the details'} <ChevronRight size={15} /></Link>}</div></article>;
}
function EmptyChallenges({ clear }: { clear: () => void }) { return <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShoelaceMascot size={58} mood="calm" label="Shoelace mascot for an empty challenge list" /></div><h2 className="mt-4 font-display text-xl font-bold">No matching pools</h2><p className="mt-2 text-sm text-muted-foreground">Try a different pace, level, or search term.</p><Button variant="secondary" className="mt-5" onClick={clear} data-testid="button-clear-challenge-filters">Clear filters</Button></div>; }

function PrivateGroupChallengeCreator() {
  const { auth } = useApp();
  const [groupName, setGroupName] = useState('');
  const [challengeName, setChallengeName] = useState('');
  const [theme, setTheme] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10));
  const [dailyGoal, setDailyGoal] = useState('7500');
  const [challengeType, setChallengeType] = useState<'goal' | 'elimination'>('goal');
  const [graceDays, setGraceDays] = useState('1');
  const [userQuery, setUserQuery] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<UserSearchResult[]>([]);
  const [message, setMessage] = useState('');
  const searchParams = useMemo(() => ({ q: userQuery.trim() }), [userQuery]);
  const userSearch = useSearchStridePoolUsers(searchParams, { query: { queryKey: getSearchStridePoolUsersQueryKey(searchParams), enabled: auth.isAuthenticated && userQuery.trim().length >= 2, staleTime: 30_000 } });
  const createGroupChallenge = useCreateStridePoolGroupChallenge();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth.isAuthenticated) {
      auth.login();
      return;
    }
    if (!groupName.trim() || !challengeName.trim() || !theme.trim() || selectedMembers.length === 0) {
      setMessage('Add a circle name, challenge details, and at least one member.');
      return;
    }
    createGroupChallenge.mutate({
      data: {
        groupName: groupName.trim(),
        memberUserIds: selectedMembers.map((member) => member.id),
        name: challengeName.trim(),
        theme: theme.trim(),
        startDate,
        endDate,
        dailyGoal: Number(dailyGoal),
        challengeType,
        goalType: 'fixed',
        graceDays: Number(graceDays),
        color: '#7f9f56',
      },
    }, {
      onSuccess: () => {
        setMessage('Private circle created. Your members can now find it in the free lane.');
        setGroupName('');
        setChallengeName('');
        setTheme('');
        setSelectedMembers([]);
        queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStridePoolCommunityChallengesQueryKey() });
      },
      onError: () => setMessage('We could not create that private circle. Check the dates and try again.'),
    });
  };
  const addMember = (member: UserSearchResult) => {
    if (!selectedMembers.some((item) => item.id === member.id) && selectedMembers.length < 20) {
      setSelectedMembers((items) => [...items, member]);
    }
    setUserQuery('');
  };

  return <section className="mb-8 rounded-[22px] border border-primary/25 bg-primary/5 p-5 sm:p-7" data-testid="panel-create-group-challenge">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">Private lane</p><h2 className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">Make a circle for your people.</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">Create a free challenge that only invited members can discover. Members still choose when to join; no public search or wallet is involved.</p></div>
      <UsersRound className="hidden shrink-0 text-primary sm:block" size={23} />
    </div>
    {!auth.isAuthenticated ? <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"><p className="text-xs leading-5 text-muted-foreground">Log in to search for walkers and start an invite-only group.</p><Button variant="secondary" className="shrink-0 text-xs" onClick={auth.login} data-testid="button-login-create-group">Log in to create a group</Button></div>
      : <form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={submit}>
        <label className="block text-xs font-bold">Group name<input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={80} placeholder="e.g. Sunday walkers" className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-group-name" /></label>
        <label className="block text-xs font-bold">Challenge name<input value={challengeName} onChange={(event) => setChallengeName(event.target.value)} maxLength={120} placeholder="e.g. Seven steady days" className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-group-challenge-name" /></label>
        <label className="block text-xs font-bold lg:col-span-2">Shared theme<input value={theme} onChange={(event) => setTheme(event.target.value)} maxLength={240} placeholder="A gentle reason to keep showing up" className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-group-theme" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold">Starts<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" data-testid="input-group-start-date" /></label><label className="block text-xs font-bold">Ends<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-primary" data-testid="input-group-end-date" /></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold">Daily goal<input type="number" min="1" max="100000" value={dailyGoal} onChange={(event) => setDailyGoal(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-group-daily-goal" /></label><label className="block text-xs font-bold">Grace days<input type="number" min="0" max="30" value={graceDays} onChange={(event) => setGraceDays(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-group-grace-days" /></label></div>
        <label className="block text-xs font-bold">Format<select value={challengeType} onChange={(event) => setChallengeType(event.target.value as 'goal' | 'elimination')} className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="select-group-challenge-type"><option value="goal">Keep the goal</option><option value="elimination">Step or step out</option></select></label>
        <div className="relative"><label className="block text-xs font-bold">Invite members<input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search by name or email" className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary" data-testid="input-group-member-search" /></label>{userSearch.data?.users?.length ? <div className="absolute left-0 right-0 top-[4.25rem] z-10 overflow-hidden rounded-xl border border-border bg-card shadow-xl">{userSearch.data.users.filter((member) => !selectedMembers.some((selected) => selected.id === member.id)).map((member) => <button type="button" onClick={() => addMember(member)} className="flex w-full items-center gap-3 border-b border-border/70 px-3 py-2.5 text-left last:border-0 hover:bg-muted" key={member.id}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground">{member.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-xs font-bold">{member.displayName}</span><span className="block truncate text-[10px] text-muted-foreground">{member.email ?? 'StridePool walker'}</span></span><UserPlus className="ml-auto text-primary" size={14} /></button>)}</div> : null}</div>
        <div className="flex flex-wrap gap-2 lg:col-span-2">{selectedMembers.length ? selectedMembers.map((member) => <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold text-secondary-foreground" key={member.id}>{member.displayName}<button type="button" onClick={() => setSelectedMembers((items) => items.filter((item) => item.id !== member.id))} aria-label={`Remove ${member.displayName}`} className="rounded-full hover:bg-secondary-foreground/10"><X size={13} /></button></span>) : <p className="text-[11px] text-muted-foreground">Add at least one member. You will be included automatically.</p>}</div>
        <div className="flex flex-col justify-between gap-3 border-t border-border/70 pt-4 lg:col-span-2 sm:flex-row sm:items-center"><p className="max-w-xl text-[11px] leading-5 text-muted-foreground">Private challenges never appear in public discovery. Only members of this group can open the challenge or leaderboard.</p><Button type="submit" disabled={createGroupChallenge.isPending} className="shrink-0" data-testid="button-create-group-challenge"><UsersRound size={16} /> {createGroupChallenge.isPending ? 'Creating…' : 'Create private circle'}</Button></div>
        {message && <p className="text-[11px] font-semibold text-primary lg:col-span-2" role="status" data-testid="status-create-group-challenge">{message}</p>}
      </form>}
  </section>;
}

function CommunityPage() {
  const [query, setQuery] = useState('');
  const params = useMemo(() => query.trim() ? { q: query.trim() } : undefined, [query]);
  const community = useGetStridePoolCommunityChallenges(params, { query: { queryKey: getGetStridePoolCommunityChallengesQueryKey(params), staleTime: 30_000 } });
  const challenges = community.data?.challenges ?? [];
  const lifetime = useGetStridePoolLifetimeLeaderboard({ query: { queryKey: getGetStridePoolLifetimeLeaderboardQueryKey(), staleTime: 15_000 } });
  return <div className="mx-auto max-w-[1180px]">
    <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
      <div><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Community lane</p><h1 className="font-display text-[clamp(2.35rem,5vw,4.3rem)] font-bold leading-[.95] tracking-[-.07em]">Walk with a wider circle.</h1><p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">Open challenges for the days you want a little more company. Paid challenges use the creator-set entry plus the applicable Free or Pro platform fee; free community challenges stay free.</p></div>
      <div className="rounded-2xl border border-secondary/70 bg-secondary/35 p-5"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><UsersRound size={19} /></span><div><p className="text-sm font-bold text-secondary-foreground">A good kind of public</p><p className="mt-1 text-xs leading-5 text-secondary-foreground/75">See who is keeping pace, invite a friend, and keep your exact route private.</p></div></div></div>
    </div>
     <PrivateGroupChallengeCreator />
    <label className="relative mb-7 block max-w-2xl"><Search className="absolute left-3.5 top-3.5 text-muted-foreground" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search community challenges" aria-label="Search community challenges" className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none transition focus:border-primary" data-testid="input-search-community" /></label>
    {community.isLoading ? <CommunitySkeleton /> : community.isError ? <CommunityError retry={() => community.refetch()} /> : challenges.length === 0 ? <CommunityEmpty query={query} clear={() => setQuery('')} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{challenges.map((challenge, index) => <CommunityCard challenge={challenge} index={index} key={challenge.id} />)}</div>}
    <LifetimeLeaderboard leaderboard={lifetime.data?.leaderboard ?? []} loading={lifetime.isLoading} />
  </div>;
}

function CommunitySkeleton() {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading community challenges">{[1, 2, 3].map((item) => <div className="animate-pulse rounded-2xl border border-border bg-card p-6" key={item}><div className="h-2 w-20 rounded bg-muted" /><div className="mt-7 h-6 w-3/4 rounded bg-muted" /><div className="mt-3 h-4 w-full rounded bg-muted" /><div className="mt-8 grid grid-cols-2 gap-3 border-y border-border/70 py-5"><div className="h-10 rounded bg-muted" /><div className="h-10 rounded bg-muted" /></div><div className="mt-6 h-10 rounded-xl bg-muted" /></div>)}</div>;
}

function CommunityError({ retry }: { retry: () => void }) {
  return <div className="rounded-2xl border border-primary/25 bg-primary/10 p-10 text-center" role="alert"><CircleAlert size={24} className="mx-auto text-primary" /><h2 className="mt-4 font-display text-xl font-bold">The community is taking a breather</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">We could not load open challenges right now. Your existing joins are safe.</p><Button variant="secondary" className="mt-5" onClick={retry} data-testid="button-retry-community">Try again</Button></div>;
}

function CommunityEmpty({ query, clear }: { query: string; clear: () => void }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-primary"><Compass size={21} /></div><h2 className="mt-4 font-display text-xl font-bold">{query ? 'No free circles match that' : 'The next circle is forming'}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{query ? 'Try a broader search or clear the filter to see every open community challenge.' : 'There are no open community challenges just yet. Check back soon, or browse your joined challenges.'}</p>{query && <Button variant="secondary" className="mt-5" onClick={clear} data-testid="button-clear-community-search">Clear search</Button>}</div>;
}

function CommunityCard({ challenge, index }: { challenge: Challenge; index: number }) {
  return <article className={`lift-card rise-in delay-${Math.min(index + 1, 4)} overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]`} data-testid={`card-community-${challenge.id}`}><div className="h-2" style={{ backgroundColor: challenge.color }} /><div className="p-5 sm:p-6"><div className="flex items-start justify-between"><Badge tone="teal">{challenge.visibility === 'private_group' ? 'Private group' : challenge.challengeType === 'elimination' ? 'Elimination format' : 'Free community'}</Badge><span className="font-mono-app text-[10px] uppercase text-muted-foreground">{challenge.startDate}</span></div><Link href={`/challenge/${challenge.id}`} className="mt-5 block" data-testid={`link-community-title-${challenge.id}`}><h2 className="font-display text-[22px] font-bold tracking-[-.045em]">{challenge.name}</h2><p className="mt-1.5 text-sm leading-5 text-muted-foreground">{challenge.theme}</p></Link><div className="mt-6 grid grid-cols-2 gap-3 border-y border-border/70 py-4"><div><p className="font-mono-app text-[10px] uppercase text-muted-foreground">Daily goal</p><p className="mt-1 text-sm font-bold">{challenge.dailyGoal.toLocaleString()} <span className="font-normal text-muted-foreground">steps</span></p></div><div><p className="font-mono-app text-[10px] uppercase text-muted-foreground">Length</p><p className="mt-1 text-sm font-bold">{challenge.days} <span className="font-normal text-muted-foreground">days</span></p></div></div><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Users size={14} /> {challenge.participantCount} walkers</span><span className="font-bold text-secondary-foreground">{challenge.visibility === 'private_group' ? 'Invite-only group' : 'Open to all'}</span></div><Link href={`/challenge/${challenge.id}`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-2.5 text-sm font-bold text-background transition hover:bg-primary hover:text-primary-foreground" data-testid={`button-community-join-${challenge.id}`}>View and join <ArrowUpRight size={15} /></Link></div></article>;
}

function LifetimeLeaderboard({ leaderboard, loading }: { leaderboard: LifetimeLeaderboardEntry[]; loading: boolean }) {
  return <section className="mt-10 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8" data-testid="panel-lifetime-leaderboard">
    <div className="flex items-start justify-between gap-4"><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Free lane, all time</p><h2 className="mt-1 font-display text-xl font-bold">Lifetime step leaderboard</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Verified steps across every free community challenge, counted once per walker per day.</p></div><Trophy size={20} className="shrink-0 text-primary" /></div>
    {loading ? <div className="mt-5 space-y-3">{[1, 2, 3].map((item) => <div className="h-12 animate-pulse rounded-xl bg-muted" key={item} />)}</div> : leaderboard.length ? <div className="mt-5 overflow-hidden rounded-xl border border-border/80">{leaderboard.slice(0, 10).map((entry) => <div className={`flex items-center gap-3 border-b border-border/70 px-3 py-3 last:border-0 ${entry.isCurrentUser ? 'bg-accent/20' : 'bg-background'}`} key={entry.userId}><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted font-mono-app text-[10px] font-bold text-muted-foreground">{entry.rank}</span><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">{entry.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-sm font-bold">{entry.displayName}{entry.isCurrentUser && <span className="ml-2 font-mono-app text-[9px] uppercase tracking-wide text-primary">You</span>}</span><span className="text-right"><span className="block font-mono-app text-xs font-bold">{entry.steps.toLocaleString()} steps</span><span className="block text-[10px] text-muted-foreground">{entry.daysLogged} days logged</span></span></div>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Verified free-lane steps will appear here as the community gets moving.</div>}
  </section>;
}

function ChallengeDetail() {
  const { id } = useParams<{ id: string }>();
  const { challenges, leaveChallenge, eligibility, compliance, membership, auth } = useApp();
  const communityQuery = useGetStridePoolCommunityChallenges(undefined, { query: { queryKey: getGetStridePoolCommunityChallengesQueryKey(), staleTime: 30_000 } });
  const challenge = challenges.find((item) => item.id === id) ?? communityQuery.data?.challenges.find((item) => item.id === id);
  const leaderboard = useGetStridePoolChallengeLeaderboard(id ?? '', { query: { queryKey: getGetStridePoolChallengeLeaderboardQueryKey(id ?? ''), enabled: Boolean(id && challenge), staleTime: 15_000, refetchInterval: 60_000 } });
  const [confirming, setConfirming] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const checkout = useCreateCheckout();
  const freeJoin = useJoinStridePoolChallenge();
   if (!challenge) return communityQuery.isLoading ? <DetailLoading /> : <NotFound />;
  const feeTotal = challenge.entryFee * challenge.participantCount;
  const platformFee = challenge.entryFee > 0 ? membership.challengeJoinPrice : 0;
  const joinTotal = challenge.entryFee + platformFee;
  const joinLabel = challenge.community ? 'Join for free' : `Join for $${joinTotal.toFixed(2)}`;
  const currentProjection = leaderboard.data?.leaderboard.find((entry) => entry.isCurrentUser)?.projectedPayout ?? leaderboard.data?.leaderboard.find((entry) => entry.status !== 'eliminated')?.projectedPayout ?? 0;
  const winnerShare = `${currentProjection.toFixed(2)} · ${leaderboard.data?.disqualifiedCount ?? 0} disqualified`;
  const paidEligible = eligibility.age >= 18 && eligibility.state.length === 2 && eligibility.identityStatus === 'verified' && eligibility.acceptedTerms && compliance.paidPlayEnabled;
  const joinChallenge = (challengeId: string) => {
    if (!auth.isAuthenticated) { auth.login(); return false; }
    if (membership.activeChallengeCount >= membership.activeChallengeLimit) {
      setCheckoutMessage(`${membership.plan === 'pro' ? 'Pro' : 'Free'} includes ${membership.activeChallengeLimit} active challenge${membership.activeChallengeLimit === 1 ? '' : 's'} at a time.`);
      return false;
    }
    if (challenge.community || challenge.entryFee === 0) {
      freeJoin.mutate({ id: challengeId }, {
        onSuccess: () => {
          setCheckoutMessage('You are in this free community challenge.');
          queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStridePoolCommunityChallengesQueryKey() });
           queryClient.invalidateQueries({ queryKey: getGetStridePoolChallengeLeaderboardQueryKey(challengeId) });
           queryClient.invalidateQueries({ queryKey: getGetStridePoolReferralSummaryQueryKey() });
        },
        onError: () => setCheckoutMessage('We could not join this free challenge. Please try again.'),
      });
      return false;
    }
    checkout.mutate({ data: { challengeId, amountCents: Math.round((challenge.entryFee + membership.challengeJoinPrice) * 100), currency: 'usd', idempotencyKey: `entry-${challengeId}-${Date.now()}` } }, {
      onSuccess: (result) => {
        setCheckoutMessage('Opening Stripe checkout. The challenge will appear only after a signed payment event is reconciled.');
        window.location.assign(result.checkoutUrl);
      },
      onError: () => setCheckoutMessage('Secure checkout is unavailable. No money was moved and the challenge was not joined.')
    });
    return false;
  };
   const isRankingChallenge = challenge.challengeType === 'ranking';
   const goalLabel = isRankingChallenge ? 'Podium payout' : challenge.goalType === 'personalized' ? 'Your daily goal' : 'Daily target';
   const goalValue = isRankingChallenge ? '60% / 25% / 15%' : `${challenge.dailyGoal.toLocaleString()} steps`;
   const poolLabel = 'Shared prize pool';
  return <div className="mx-auto max-w-[1050px]"><Link href={challenge.community ? "/community" : "/challenges"} className="mb-7 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground" data-testid="link-back-challenges"><ArrowLeft size={16} /> {challenge.community ? 'Community challenges' : 'All challenges'}</Link><div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]"><section><div className="relative overflow-hidden rounded-[24px] p-7 sm:p-10" style={{ backgroundColor: challenge.color }}><div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[32px] border-foreground/10" /><div className="absolute bottom-[-72px] left-[-30px] h-48 w-48 rounded-full border-[22px] border-background/20" /><div className="relative"><div className="flex items-center justify-between"><Badge tone="neutral">{challenge.community ? (challenge.challengeType === 'elimination' ? 'Elimination community pace' : 'Community pace') : isRankingChallenge ? 'Podium challenge' : `${challenge.level} pace`}</Badge><span className="font-mono-app text-[10px] uppercase tracking-widest text-foreground/55">{challenge.startDate} — {challenge.endDate}</span></div><h1 className="mt-12 max-w-lg font-display text-[clamp(2.5rem,6vw,5.2rem)] font-bold leading-[.92] tracking-[-.08em]">{challenge.name}</h1><p className="mt-5 max-w-md text-base leading-7 text-foreground/70">{challenge.theme} {isRankingChallenge ? 'The most verified steps earn the podium.' : 'The point is to show up every day, not to be perfect once.'}</p></div></div><div className="mt-6 rounded-2xl border border-border bg-card p-6 sm:p-8"><SectionHeading eyebrow="The agreement" title="Simple rules, clear finish line" /><div className="grid gap-5 sm:grid-cols-2"><Rule icon={isRankingChallenge ? <Trophy size={18} /> : <Target size={18} />} title={isRankingChallenge ? 'Total verified steps' : `${challenge.dailyGoal.toLocaleString()} steps each day`} text={isRankingChallenge ? 'Your verified steps across the full challenge window determine your place on the podium.' : challenge.goalType === 'personalized' ? 'Your target is calibrated from your baseline, so the finish line fits your real life.' : 'Every configured day must meet the target. There are no grace days in this creator challenge.'} /><Rule icon={<CalendarDays size={18} />} title={`${challenge.days} days together${challenge.graceDays ? ` · ${challenge.graceDays} grace day${challenge.graceDays === 1 ? '' : 's'}` : ''}`} text={challenge.challengeType === 'elimination' ? `Missed days beyond your ${challenge.graceDays} grace day${challenge.graceDays === 1 ? '' : 's'} remove you from the active field.` : `Runs from ${challenge.startDate} through ${challenge.endDate}.`} /><Rule icon={<ShieldCheck size={18} />} title="Verified movement only" text="We check for implausible bursts and keep the original source record for review." /><Rule icon={<Users size={18} />} title="A shared pool" text={challenge.community ? 'Free community challenges have no entry or platform fee.' : `The creator sets the $${challenge.entryFee.toFixed(2)} challenge entry for the pool. StridePool adds a separate $${membership.challengeJoinPrice.toFixed(2)} platform fee.`} /></div></div>{challenge.community && <FreeChallengeSocial challenge={challenge} leaderboard={leaderboard} />}</section><aside className="space-y-5"><div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"><div className="flex items-center justify-between"><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-muted-foreground">{poolLabel}</p><Sparkles size={17} className="text-primary" /></div><div className="mt-5 flex items-end justify-between"><div><p className="font-display text-4xl font-bold tracking-[-.06em]">${challenge.prizePool.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">current prize pool</p></div><div className="text-right"><p className="font-display text-2xl font-bold">{challenge.participantCount}</p><p className="text-xs text-muted-foreground">walking together</p></div></div><div className="mt-6 h-2 rounded-full bg-muted"><div className="h-full w-[68%] rounded-full" style={{ backgroundColor: challenge.color }} /></div><div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{challenge.finishers || 0} finished so far</span><span>{membership.activeChallengeCount}/{membership.activeChallengeLimit} active places used</span></div><div className="mt-6 space-y-3 border-t border-border pt-5"><StatLine icon={isRankingChallenge ? <Trophy size={16} /> : <Target size={16} />} label={goalLabel} value={isRankingChallenge ? goalValue : `${challenge.dailyGoal.toLocaleString()} steps`} /><StatLine icon={<CreditCard size={16} />} label="Challenge entry" value={challenge.community ? 'Free' : `$${challenge.entryFee.toFixed(2)}`} />{!challenge.community && <StatLine icon={<CreditCard size={16} />} label="StridePool platform fee" value={`$${platformFee.toFixed(2)}`} />}<StatLine icon={<Award size={16} />} label="Est. finisher share" value={`~$${winnerShare}`} /><StatLine icon={<Info size={16} />} label="Pool at capacity" value={`$${feeTotal.toLocaleString()}`} /></div>{challenge.joined ? <div className="mt-6 space-y-2"><div className="flex items-center justify-center gap-2 rounded-xl bg-accent/35 py-3 text-sm font-bold text-accent-foreground"><Check size={16} /> You are in this pool</div><Button variant="quiet" className="w-full text-xs" onClick={() => setConfirming(true)} data-testid={`button-leave-${challenge.id}`}>Leave challenge</Button></div> : <Button className="mt-6 w-full py-3" onClick={() => setConfirming(true)} data-testid={`button-open-join-${challenge.id}`}>{joinLabel} <ArrowUpRight size={16} /></Button>}{checkoutMessage && <p className="mt-3 text-xs leading-5 text-primary" role="status">{checkoutMessage}</p>}</div><div className="rounded-2xl border border-border bg-accent/20 p-5"><div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-accent-foreground" /><div><p className="text-sm font-bold text-accent-foreground">No-finisher promise</p><p className="mt-1 text-xs leading-5 text-accent-foreground/75">If nobody finishes, every entry is refunded. No surprise rollover, donation, or house win.</p></div></div></div><div className="rounded-2xl border border-border bg-secondary/55 p-5"><div className="flex gap-3"><HeartPulse size={19} className="mt-0.5 shrink-0 text-secondary-foreground" /><div><p className="text-sm font-bold text-secondary-foreground">A kinder kind of competition</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Your progress is yours. The pool simply gives the walk a little more company.</p></div></div></div></aside></div>{confirming && <JoinDialog challenge={challenge} onClose={() => setConfirming(false)} onConfirm={() => { if (challenge.joined) leaveChallenge(challenge.id); else joinChallenge(challenge.id); setConfirming(false); }} />}</div>;
}
function DetailLoading() {
  return <div className="mx-auto max-w-[1050px] animate-pulse"><div className="mb-7 h-5 w-40 rounded bg-muted" /><div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]"><div><div className="h-[360px] rounded-[24px] bg-muted" /><div className="mt-6 h-56 rounded-2xl bg-muted" /></div><div className="h-[420px] rounded-2xl bg-muted" /></div></div>;
}

function FreeChallengeSocial({ challenge, leaderboard }: { challenge: Challenge; leaderboard: ReturnType<typeof useGetStridePoolChallengeLeaderboard> }) {
  const { auth } = useApp();
  const [userQuery, setUserQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [message, setMessage] = useState('');
  const searchParams = useMemo(() => ({ q: userQuery.trim() || 'walk' }), [userQuery]);
  const userSearch = useSearchStridePoolUsers(searchParams, { query: { queryKey: getSearchStridePoolUsersQueryKey(searchParams), enabled: auth.isAuthenticated && userQuery.trim().length >= 2, staleTime: 30_000 } });
  const createInvite = useCreateStridePoolChallengeInvite();
  const leaderboardData = leaderboard.data as { leaderboard: Array<{ rank: number; userId: string; displayName: string; steps: number; completedDays: number; completionPercent: number; status: 'on_track' | 'eliminated' | 'finished'; isCurrentUser: boolean }>; days: number } | undefined;
  const rows = leaderboardData?.leaderboard ?? [];
  const copyInvite = async () => {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); setMessage('Invite link copied.'); } catch { setMessage('Invite link ready to copy from the field.'); }
  };
  const makeInvite = () => {
    if (!auth.isAuthenticated) { auth.login(); return; }
    setMessage('');
    createInvite.mutate({ id: challenge.id, data: selectedUser ? { inviteeUserId: selectedUser.id } : {} }, {
      onSuccess: (result) => { setInviteUrl(result.inviteUrl); setMessage(selectedUser ? `Invite ready for ${selectedUser.displayName}.` : 'Invite link created.'); queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetStridePoolCommunityChallengesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetStridePoolChallengeLeaderboardQueryKey(challenge.id) }); },
      onError: () => setMessage('We could not create that invite. Please try again.')
    });
  };
  return <div className="mt-6 space-y-5"><section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8" data-testid="panel-community-leaderboard"><div className="flex items-start justify-between gap-4"><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Shared momentum</p><h2 className="mt-1 font-display text-xl font-bold">Community leaderboard</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">A view of verified progress, not a measure of worth. Names and completion stay inside this challenge.</p></div><Trophy size={20} className="shrink-0 text-primary" /></div>{leaderboard.isLoading ? <div className="mt-5 space-y-3">{[1, 2, 3].map((item) => <div className="h-12 animate-pulse rounded-xl bg-muted" key={item} />)}</div> : leaderboard.isError ? <div className="mt-5 rounded-xl border border-primary/20 bg-primary/10 p-4 text-xs text-primary" role="alert"><p className="font-bold">Leaderboard unavailable right now.</p><button className="mt-2 font-bold underline" onClick={() => leaderboard.refetch()} data-testid="button-retry-leaderboard">Try again</button></div> : rows.length ? <div className="mt-5 overflow-hidden rounded-xl border border-border/80">{rows.slice(0, 8).map((entry) => <div className={`flex flex-col gap-2 border-b border-border/70 px-3 py-3 last:border-0 sm:flex-row sm:items-center ${entry.isCurrentUser ? 'bg-accent/20' : 'bg-background'}`} key={entry.userId}><span className="flex items-center gap-3 sm:contents"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted font-mono-app text-[10px] font-bold text-muted-foreground">{entry.rank}</span><span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">{entry.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-sm font-bold">{entry.displayName}{entry.isCurrentUser && <span className="ml-2 font-mono-app text-[9px] uppercase tracking-wide text-primary">You</span>}</span></span><div className="flex items-center justify-between gap-3 pl-10 sm:pl-0"><StatusPill status={entry.status} /><span className="text-right"><span className="block font-mono-app text-xs font-bold">{entry.steps.toLocaleString()}</span><span className="block text-[10px] text-muted-foreground">{entry.completedDays}/{leaderboardData?.days ?? challenge.days} days</span></span></div></div>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Progress will appear here as walkers check in.</div>}</section><section className="rounded-2xl border border-border bg-secondary/35 p-6 sm:p-8" data-testid="panel-friend-invite"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><UserPlus size={19} /></span><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-secondary-foreground">Bring a friend</p><h2 className="mt-1 font-display text-xl font-bold text-secondary-foreground">Make the walk easier to keep</h2><p className="mt-2 text-xs leading-5 text-secondary-foreground/75">Invite one person by name or make a link you can share anywhere. Invitations are only available when you are signed in.</p></div></div>{auth.isAuthenticated ? <><label className="relative mt-5 block"><Search className="absolute left-3 top-3 text-muted-foreground" size={16} /><input value={userQuery} onChange={(event) => { setUserQuery(event.target.value); setSelectedUser(null); }} placeholder="Find a StridePool friend" aria-label="Search users to invite" className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" data-testid="input-search-invite-users" /></label>{userSearch.isLoading && <p className="mt-2 text-[11px] text-muted-foreground">Searching your community…</p>}{userQuery.trim().length >= 2 && !userSearch.isLoading && userSearch.data?.users?.length ? <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">{userSearch.data.users.slice(0, 5).map((user) => <button type="button" className="flex w-full items-center gap-3 border-b border-border/70 px-3 py-2.5 text-left last:border-0 hover:bg-muted" onClick={() => { setSelectedUser(user); setUserQuery(user.displayName); }} key={user.id} data-testid={`button-select-invite-user-${user.id}`}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">{user.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block text-xs font-bold">{user.displayName}</span><span className="block truncate text-[10px] text-muted-foreground">{user.email}</span></span>{selectedUser?.id === user.id && <UserCheck size={15} className="ml-auto text-primary" />}</button>)}</div> : userQuery.trim().length >= 2 && !userSearch.isLoading ? <p className="mt-2 text-[11px] text-muted-foreground">No matching walkers yet. You can still make a shareable link.</p> : null}<div className="mt-4 flex flex-wrap gap-2"><Button onClick={makeInvite} disabled={createInvite.isPending} data-testid="button-create-community-invite"><Send size={15} /> {createInvite.isPending ? 'Making invite…' : selectedUser ? `Invite ${selectedUser.displayName}` : 'Create invite link'}</Button>{selectedUser && <Button variant="quiet" onClick={() => { setSelectedUser(null); setUserQuery(''); }} data-testid="button-clear-invite-user">Clear person</Button>}</div>{inviteUrl && <div className="mt-4 flex gap-2"><input readOnly value={inviteUrl} aria-label="Shareable invite link" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs" data-testid="input-community-invite-link" /><Button variant="secondary" className="px-3" onClick={copyInvite} aria-label="Copy invite link" data-testid="button-copy-community-invite"><Copy size={15} /></Button></div>}{message && <p className="mt-3 text-xs font-semibold text-secondary-foreground" role="status" data-testid="status-community-invite">{message}</p>}</> : <div className="mt-5 rounded-xl border border-secondary-foreground/15 bg-background/65 p-4"><p className="text-sm font-bold text-secondary-foreground">Sign in to invite friends</p><p className="mt-1 text-xs leading-5 text-secondary-foreground/75">Browsing and joining stays open to everyone. Friend search and invite links need an account so they stay attached to the right person.</p><Button className="mt-4" onClick={auth.login} data-testid="button-login-to-invite">Log in to invite</Button></div>}</section></div>;
}

function StatusPill({ status }: { status: 'on_track' | 'eliminated' | 'finished' }) {
  const tone = status === 'finished' ? 'lime' : status === 'eliminated' ? 'coral' : 'teal';
  const label = status === 'on_track' ? 'On track' : status === 'eliminated' ? 'Eliminated' : 'Finished';
  return <Badge tone={tone}><span aria-label={`Participant status: ${label}`}>{label}</span></Badge>;
}

function Rule({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">{icon}</span><div><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>; }
function JoinDialog({ challenge, onClose, onConfirm }: { challenge: Challenge; onClose: () => void; onConfirm: () => void }) {
  const { eligibility, compliance, membership } = useApp();
  const leaving = challenge.joined;
  const free = challenge.entryFee === 0;
  const platformFee = free ? 0 : membership.challengeJoinPrice;
  const totalBeforeAdditionalFees = challenge.entryFee + platformFee;
  const paidEligible = eligibility.age >= compliance.minAge && eligibility.state.length === 2 && eligibility.identityStatus === 'verified' && eligibility.acceptedTerms && compliance.paidPlayEnabled && compliance.providerConfigured;
  const blocked = !leaving && !free && !paidEligible;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="join-title"><div className="w-full max-w-md rounded-t-[24px] bg-card p-6 shadow-2xl sm:rounded-[24px] sm:p-7"><div className="flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">{leaving ? 'One last check' : free ? 'No wallet needed' : 'Safety check first'}</p><h2 id="join-title" className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">{leaving ? `Leave ${challenge.name}?` : `Join ${challenge.name}?`}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close dialog" data-testid="button-close-join-dialog"><X size={18} /></button></div>{leaving ? <p className="mt-5 text-sm leading-6 text-muted-foreground">{challenge.entryFee ? 'Paid entries can only be refunded through a provider-confirmed event.' : 'This free challenge can be left while registration is open.'}</p> : <><p className="mt-5 text-sm leading-6 text-muted-foreground">{free ? 'A free community challenge for showing up together.' : 'No money is moved from this screen. The creator sets the challenge entry; StridePool adds its separate platform fee before secure checkout.'}</p><div className="mt-5 rounded-xl bg-muted p-4"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Challenge entry</span><span className="font-bold">{free ? 'Free' : `$${challenge.entryFee.toFixed(2)}`}</span></div>{!free && <><div className="my-3 border-t border-border/80" /><div className="flex justify-between text-sm"><span className="text-muted-foreground">StridePool platform fee</span><span className="font-bold text-primary">${platformFee.toFixed(2)}</span></div><div className="my-3 border-t border-border/80" /><div className="flex justify-between text-sm"><span className="text-muted-foreground">Total before taxes or card fees</span><span className="font-bold">${totalBeforeAdditionalFees.toFixed(2)}</span></div><div className="my-3 border-t border-border/80" /><div className="flex justify-between text-sm"><span className="text-muted-foreground">Current pool</span><span className="font-bold">${challenge.prizePool.toLocaleString()}</span></div><p className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-muted-foreground"><LockKeyhole size={13} className="mt-0.5 shrink-0" /> The challenge entry funds the pool. Finishers share it; no-finisher refunds are recorded as provider events.</p></>}</div>{blocked && <p className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs leading-5 text-primary">Paid entry is locked until every eligibility check passes and the provider is connected. <Link href="/safety" onClick={onClose} className="font-bold underline underline-offset-2" data-testid="link-join-safety">Review safety checks</Link></p>}</>}<div className="mt-6 flex gap-3"><Button variant="secondary" className="flex-1" onClick={onClose} data-testid="button-cancel-join">Not yet</Button><Button variant={leaving ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} disabled={blocked} data-testid="button-confirm-join">{leaving ? 'Leave pool' : free ? 'Join for free' : 'Continue to checkout'}</Button></div></div></div>;
}

function LegacyJoinDialog({ challenge, onClose, onConfirm }: { challenge: Challenge; onClose: () => void; onConfirm: () => void }) { const leaving = challenge.joined; const free = challenge.entryFee === 0; return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="join-title"><div className="w-full max-w-md rounded-t-[24px] bg-card p-6 shadow-2xl sm:rounded-[24px] sm:p-7"><div className="flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">{leaving ? 'One last check' : free ? 'No wallet needed' : 'You are almost in'}</p><h2 id="join-title" className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">{leaving ? `Leave ${challenge.name}?` : `Join ${challenge.name}?`}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close dialog" data-testid="button-close-join-dialog"><X size={18} /></button></div>{leaving ? <p className="mt-5 text-sm leading-6 text-muted-foreground">Your ${challenge.entryFee} entry will return to your balance. You can rejoin while registration is open.</p> : <><p className="mt-5 text-sm leading-6 text-muted-foreground">{free ? 'A free community challenge for showing up together. No payment method or payout rules—just a shared rhythm.' : `A transparent commitment for ${challenge.days} days of showing up. Nothing is charged beyond the entry below.`}</p><div className="mt-5 rounded-xl bg-muted p-4"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Entry commitment</span><span className="font-bold">{free ? 'Free' : `$${challenge.entryFee}.00`}</span></div>{!free && <><div className="my-3 border-t border-border/80" /><div className="flex justify-between text-sm"><span className="text-muted-foreground">Platform fee</span><span className="font-bold text-primary">$0.00</span></div><div className="my-3 border-t border-border/80" /><div className="flex justify-between text-sm"><span className="text-muted-foreground">Current pool</span><span className="font-bold">${challenge.prizePool.toLocaleString()}</span></div><p className="mt-3 flex items-start gap-2 text-[11px] leading-4 text-muted-foreground"><LockKeyhole size={13} className="mt-0.5 shrink-0" /> Your entry stays held until the challenge finishes. Finishers share the pool.</p></>}</div></>}<div className="mt-6 flex gap-3"><Button variant="secondary" className="flex-1" onClick={onClose} data-testid="button-cancel-join">Not yet</Button><Button variant={leaving ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} data-testid="button-confirm-join">{leaving ? 'Leave pool' : free ? 'Join for free' : 'Confirm entry'}</Button></div></div></div>; }

function WalletPage() {
  const { wallet, compliance, auth } = useApp();
  const { data: ledger = [] } = useGetLedger({ query: { queryKey: getGetLedgerQueryKey(), enabled: auth.isAuthenticated, staleTime: 30_000 } });
  const payoutOnboarding = useStartPayoutOnboarding();
  const payoutAccount = useGetPayoutAccount({ query: { queryKey: getGetPayoutAccountQueryKey(), enabled: auth.isAuthenticated && compliance.providerConfigured, staleTime: 30_000 } });
  const withdrawal = useCreateWithdrawal();
  const [message, setMessage] = useState('');
  const startPayoutOnboarding = () => {
    setMessage('');
    payoutOnboarding.mutate({ data: { idempotencyKey: `payout-${Date.now()}` } }, {
      onSuccess: (result) => {
        setMessage('Opening Stripe onboarding. Withdrawals remain locked until provider verification is complete.');
        queryClient.invalidateQueries({ queryKey: getGetLedgerQueryKey() });
        window.location.assign(result.onboardingUrl);
      },
      onError: () => setMessage('Payout onboarding is unavailable. No withdrawal was requested and no money moved.')
    });
  };
  const withdraw = () => {
    setMessage('');
    withdrawal.mutate({ data: { idempotencyKey: `withdrawal-${Date.now()}` } }, {
      onSuccess: (result) => {
        setMessage(`$${(result.amountCents / 100).toFixed(2)} withdrawal submitted to your linked bank account.`);
        queryClient.invalidateQueries({ queryKey: getGetLedgerQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() });
      },
      onError: () => setMessage('Withdrawal could not be submitted. Your available wallet balance was not changed.'),
    });
  };
  return <div className="mx-auto max-w-[1100px]"><div className="mb-8"><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Provider-backed money</p><h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-.06em]">Wallet</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Link a bank account through Stripe, then withdraw once your available balance reaches $20.</p></div><section className="grid gap-4 md:grid-cols-[1.4fr_.8fr_.8fr]"><div className="rounded-2xl bg-foreground p-6 text-background shadow-[var(--shadow-soft)]"><div className="flex items-center justify-between text-background/55"><span className="font-mono-app text-[10px] uppercase tracking-[.16em]">Available balance</span><WalletCards size={18} /></div><p className="mt-8 font-display text-5xl font-bold tracking-[-.07em]" data-testid="text-wallet-balance">${wallet.balance.toFixed(2)}</p><p className="mt-2 text-xs text-background/55">{wallet.balance >= 20 ? 'Eligible to withdraw after bank verification' : `$${(20 - wallet.balance).toFixed(2)} more needed to withdraw`}</p></div><WalletStat label="Pending in pools" value={`$${wallet.pending.toFixed(2)}`} detail="Released only after settlement" icon={<Clock3 size={17} />} /><WalletStat label="Total earned" value={`$${wallet.totalEarned.toFixed(2)}`} detail="Audited provider credits" icon={<TrendingUp size={17} />} /></section><section className="mt-10 grid gap-8 lg:grid-cols-[1fr_330px]"><div><SectionHeading eyebrow="Immutable event history" title="Money ledger" /><div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">{ledger.length ? ledger.map((entry) => <div className="flex items-center gap-3 border-b border-border/70 px-4 py-4 last:border-0" key={entry.id} data-testid={`ledger-entry-${entry.id}`}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-primary"><ShieldCheck size={16} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{entry.eventType.replaceAll('_', ' ')}</p><p className="mt-0.5 text-xs text-muted-foreground">{entry.status} · {new Date(entry.createdAt).toLocaleString()}</p></div><span className="font-mono-app text-sm font-bold">${(entry.amountCents / 100).toFixed(2)}</span></div>) : <div className="p-10 text-center"><ShieldCheck size={21} className="mx-auto text-primary" /><p className="mt-3 text-sm font-bold">No provider events yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Payment, refund, dispute, and payout events will appear here with their provider reference.</p></div>}</div></div><div><SectionHeading eyebrow="Payouts" title="Linked bank account" /><div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><CreditCard size={19} /></span><div><p className="text-sm font-bold">{payoutAccount.data?.linked ? 'Bank account linked' : 'No verified bank account'}</p><p className="text-xs leading-5 text-muted-foreground">{payoutAccount.data?.payoutsEnabled ? 'Stripe has enabled payouts.' : 'Complete secure Stripe onboarding to link and verify your bank.'}</p></div>{payoutAccount.data?.payoutsEnabled && <Check size={16} className="ml-auto text-primary" />}</div><Button variant="secondary" className="mt-5 w-full" onClick={startPayoutOnboarding} disabled={payoutOnboarding.isPending} data-testid="button-start-payout-onboarding">{payoutOnboarding.isPending ? 'Opening…' : payoutAccount.data?.linked ? 'Manage bank account' : 'Link bank account'} <ChevronRight size={15} /></Button><Button className="mt-3 w-full" onClick={withdraw} disabled={withdrawal.isPending || wallet.balance < 20 || !payoutAccount.data?.payoutsEnabled} data-testid="button-withdraw-wallet">{withdrawal.isPending ? 'Submitting…' : `Withdraw $${wallet.balance.toFixed(2)}`}</Button>{message && <p className="mt-4 rounded-xl bg-muted p-3 text-[11px] leading-5" role="status" data-testid="status-payout-onboarding">{message}</p>}<p className="mt-4 flex gap-2 text-[11px] leading-4 text-muted-foreground"><ShieldCheck size={14} className="shrink-0 text-primary" /> Minimum available balance: $20. Bank details stay with Stripe.</p></div></div></section></div>;
}

function LegacyWalletPage() {
  const { wallet, activities, addFunds } = useApp();
  const [tab, setTab] = useState('All activity');
  const walletActivities = activities.filter((item) => tab === 'All activity' || (tab === 'Entries' ? item.title.includes('joined') || item.title.includes('left') : item.type === 'milestone'));
  return <div className="mx-auto max-w-[1100px]"><div className="mb-8"><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Your money, plainly</p><h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-.06em]">Wallet</h1><p className="mt-3 text-sm text-muted-foreground">Every commitment and every return, easy to follow.</p></div><section className="grid gap-4 md:grid-cols-[1.4fr_.8fr_.8fr]"><div className="rounded-2xl bg-foreground p-6 text-background shadow-[var(--shadow-soft)]"><div className="flex items-center justify-between text-background/55"><span className="font-mono-app text-[10px] uppercase tracking-[.16em]">Available balance</span><WalletCards size={18} /></div><p className="mt-8 font-display text-5xl font-bold tracking-[-.07em]" data-testid="text-wallet-balance">${wallet.balance.toFixed(2)}</p><p className="mt-2 text-xs text-background/55">Ready for your next challenge</p><button onClick={addFunds} className="mt-7 flex items-center gap-2 text-xs font-bold text-accent hover:underline" data-testid="button-add-funds"><Plus size={14} /> Add $25 demo funds</button></div><WalletStat label="Pending in pools" value={`$${wallet.pending.toFixed(2)}`} detail="Released after finish" icon={<Clock3 size={17} />} /><WalletStat label="Total earned" value={`$${wallet.totalEarned.toFixed(2)}`} detail="Since joining StridePool" icon={<TrendingUp size={17} />} /></section><section className="mt-10 grid gap-8 lg:grid-cols-[1fr_330px]"><div><SectionHeading eyebrow="Ledger" title="Earnings history" action={<div className="flex rounded-xl border border-border bg-card p-1">{['All activity', 'Entries', 'Earnings'].map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${tab === item ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`button-wallet-tab-${item.toLowerCase()}`}>{item}</button>)}</div>} /><div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">{walletActivities.length ? walletActivities.map((activity) => <WalletRow key={activity.id} activity={activity} />) : <div className="p-10 text-center text-sm text-muted-foreground">No activity in this view yet.</div>}</div></div><div><SectionHeading eyebrow="Payouts" title="Payout method" /><div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><CreditCard size={19} /></span><div><p className="text-sm font-bold">Visa ending 1842</p><p className="text-xs text-muted-foreground">Primary payout method</p></div><Check size={16} className="ml-auto text-primary" /></div><button onClick={() => addFunds()} className="mt-5 flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-xs font-bold hover:bg-muted" data-testid="button-manage-payout">Manage payout method <ChevronRight size={15} /></button><p className="mt-4 flex gap-2 text-[11px] leading-4 text-muted-foreground"><ShieldCheck size={14} className="shrink-0" /> Demo wallet: $25 is added when you manage this method.</p></div></div></section></div>;
}
function WalletStat({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) { return <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"><div className="flex items-center gap-2 text-muted-foreground"><span className="text-primary">{icon}</span><span className="font-mono-app text-[10px] uppercase tracking-[.12em]">{label}</span></div><p className="mt-7 font-display text-3xl font-bold tracking-[-.06em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
function WalletRow({ activity }: { activity: Activity }) { const positive = activity.type === 'milestone'; return <div className="flex items-center gap-3 border-b border-border/70 px-4 py-4 last:border-0"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${positive ? 'bg-accent/35 text-accent-foreground' : 'bg-muted text-primary'}`}>{positive ? <Award size={16} /> : <ArrowUpRight size={16} />}</span><div className="flex-1"><p className="text-sm font-bold">{positive ? 'Earnings credited' : activity.title.replace('You ', '')}</p><p className="mt-0.5 text-xs text-muted-foreground">{activity.timestamp}</p></div><span className={`font-mono-app text-sm font-bold ${positive ? 'text-primary' : 'text-foreground'}`}>{positive ? '+$12.50' : `-$${activity.title.includes('Sunrise') ? '8.00' : '0.00'}`}</span></div>; }

function ProfilePage() {
  const { profile, toggleSetting, updateProfile, freeStreak, pendingInvites, membership, auth, healthSources } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.displayName);
  useEffect(() => { if (!editing && name.trim() && name.trim() !== profile.displayName) updateProfile({ displayName: name.trim() }); }, [editing]);
  return <div className="mx-auto max-w-[1000px]"><div className="mb-8"><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Your space</p><h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-.06em]">Profile & settings</h1><p className="mt-3 text-sm text-muted-foreground">Keep StridePool useful, comfortable, and yours.</p></div><div className="grid gap-6 lg:grid-cols-[.78fr_1.22fr]"><section className="rounded-2xl bg-secondary p-6 sm:p-8"><div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-foreground font-display text-2xl font-bold text-background shadow-[4px_4px_0_hsl(var(--primary))]">AM</div>{editing ? <div className="mt-6 flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} aria-label="Profile name" className="min-w-0 flex-1 rounded-xl border border-secondary-foreground/20 bg-secondary/40 px-3 py-2 text-lg font-bold outline-none focus:border-primary" data-testid="input-profile-name" /><button onClick={() => setEditing(false)} className="rounded-xl bg-foreground px-3 text-xs font-bold text-background" data-testid="button-save-profile">Save</button></div> : <h2 className="mt-6 font-display text-2xl font-bold tracking-[-.04em]">{name}</h2>}<p className="mt-1 text-sm text-secondary-foreground/70">Walking since March 2024</p><div className="mt-8 space-y-4 border-t border-secondary-foreground/15 pt-6"><div className="flex justify-between text-xs"><span className="text-secondary-foreground/65">Active challenges</span><span className="font-bold">{membership.activeChallengeCount}/{membership.activeChallengeLimit}</span></div><div className="flex justify-between text-xs"><span className="text-secondary-foreground/65">StridePool platform fee</span><span className="font-bold">${membership.challengeJoinPrice.toFixed(2)}</span></div><div className="flex justify-between text-xs"><span className="text-secondary-foreground/65">Membership</span><span className="font-bold capitalize">{membership.plan}</span></div></div>{!editing && <button onClick={() => setEditing(true)} className="mt-8 flex items-center gap-2 text-xs font-bold text-secondary-foreground underline underline-offset-4" data-testid="button-edit-profile">Edit profile <ExternalLink size={13} /></button>}</section><section className="space-y-5">{auth.isAuthenticated && <MembershipCard membership={membership} />}{auth.isAuthenticated && pendingInvites.length > 0 && <PendingInvitesPanel invites={pendingInvites} />}<HealthSourcesPanel sources={healthSources} /><div className="rounded-2xl border border-border bg-accent/20 p-5"><div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-accent-foreground" /><div><p className="text-sm font-bold text-accent-foreground">Your steps stay trustworthy</p><p className="mt-1 text-xs leading-5 text-accent-foreground/75">We look for impossible bursts and unusually large totals, then keep the original source record for review. Your exact route is never shared.</p></div></div></div><SettingsGroup eyebrow="Nudges, not noise" title="Notifications"><ToggleRow label="Daily rhythm reminder" description="A gentle note when your daily goal is still open." checked={profile.reminders} onToggle={() => toggleSetting('reminders')} testId="toggle-daily-reminder" /><ToggleRow label="Weekly walking digest" description="A Sunday look at your consistency and pool history." checked={profile.weeklyDigest} onToggle={() => toggleSetting('weekly-digest')} testId="toggle-weekly-digest" /></SettingsGroup><SettingsGroup eyebrow="Your visibility" title="Privacy"><ToggleRow label="Show progress to challenge members" description="Members can see your completion status, never your exact route." checked={profile.publicProgress} onToggle={() => toggleSetting('publicProgress')} testId="toggle-public-progress" /></SettingsGroup></section></div></div>;
}

function ReferralCard() {
  const { auth } = useApp();
  const referral = useGetStridePoolReferralSummary({ query: { queryKey: getGetStridePoolReferralSummaryQueryKey(), enabled: auth.isAuthenticated, staleTime: 30_000 } });
  const [message, setMessage] = useState('');
  const summary = referral.data;
  const referralUrl = summary ? `${window.location.origin}${import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')}/referral/${summary.code}` : '';
  const share = async () => {
    if (!referralUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join me on StridePool', text: 'Join StridePool and we both get one free month of Pro after you join a challenge.', url: referralUrl });
        setMessage('Referral link shared.');
      } else {
        await navigator.clipboard.writeText(referralUrl);
        setMessage('Referral link copied.');
      }
    } catch {
      setMessage('Referral link ready to copy.');
    }
  };
  if (!auth.isAuthenticated || referral.isLoading || !summary) return null;
  return <section className="rounded-2xl border border-primary/25 bg-primary/10 p-5 shadow-[var(--shadow-card)]" data-testid="panel-referrals">
    <div className="flex items-start justify-between gap-4">
      <div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Pass it on</p><h2 className="mt-1 font-display text-xl font-bold">Give a friend a free Pro month</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Share your link. When a new walker signs up and joins a challenge, you both get Pro free for 30 days.</p></div>
      <Sparkles size={20} className="shrink-0 text-primary" />
    </div>
    <div className="mt-4 flex gap-2">
      <input readOnly value={referralUrl} aria-label="Your referral link" className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-xs" data-testid="input-referral-link" />
      <Button variant="secondary" className="shrink-0 px-3" onClick={share} aria-label="Share referral link" data-testid="button-share-referral"><Send size={15} /></Button>
    </div>
    <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span><strong className="text-foreground">{summary.qualifiedCount}</strong> friend{summary.qualifiedCount === 1 ? '' : 's'} qualified</span>
      <span><strong className="text-foreground">{summary.pendingCount}</strong> waiting to join</span>
    </div>
    {summary.proTrialEndsAt && <p className="mt-3 rounded-xl bg-card/70 p-3 text-xs font-semibold text-primary">Your free Pro is active through {new Date(summary.proTrialEndsAt).toLocaleDateString()}.</p>}
    {message && <p className="mt-3 text-xs font-semibold text-primary" role="status" data-testid="status-share-referral">{message}</p>}
  </section>;
}

function ReferralsPage() {
  const { auth } = useApp();
  return <div className="mx-auto max-w-[840px]">
    <div className="mb-8">
      <p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Bring your people</p>
      <h1 className="font-display text-[clamp(2.2rem,5vw,4rem)] font-extrabold leading-[.95] tracking-[-.07em]">Referrals</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">Share a little momentum. When a new walker signs up through your link and joins a challenge, you both get Pro free for 30 days.</p>
    </div>
    {auth.isAuthenticated ? <ReferralCard /> : <section className="rounded-[28px] border border-primary/25 bg-primary/10 p-7 shadow-[var(--shadow-card)] sm:p-10" data-testid="panel-referrals-login">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[3px_3px_0_hsl(var(--foreground))]"><Gift size={25} /></div>
      <h2 className="mt-6 font-display text-2xl font-bold tracking-[-.04em]">Your referral link is waiting</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Log in to create your personal link and start giving friends a free month of StridePool Pro.</p>
      <Button className="mt-6" onClick={auth.login} data-testid="button-referrals-login">Log in to get your link <ArrowUpRight size={16} /></Button>
    </section>}
  </div>;
}

function MembershipCard({ membership }: { membership: MembershipSummary }) {
  const checkout = useCreateProSubscriptionCheckout();
  const [message, setMessage] = useState('');
  const upgrade = () => {
    setMessage('');
    checkout.mutate(undefined, {
      onSuccess: (result) => window.location.assign(result.checkoutUrl),
      onError: () => setMessage('Pro checkout is unavailable right now. Your plan has not changed.'),
    });
  };
  return <section className="rounded-2xl border border-primary/25 bg-primary/10 p-5 shadow-[var(--shadow-card)]" data-testid="card-membership"><div className="flex items-start justify-between gap-4"><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Membership</p><h2 className="mt-1 font-display text-xl font-bold">{membership.plan === 'pro' ? 'StridePool Pro' : 'StridePool Free'}</h2></div><Badge tone={membership.plan === 'pro' ? 'lime' : 'neutral'}>{membership.status.replaceAll('_', ' ')}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-card p-3"><p className="font-display text-2xl font-bold">${membership.challengeJoinPrice.toFixed(2)}</p><p className="text-[10px] text-muted-foreground">platform fee per paid challenge</p></div><div className="rounded-xl bg-card p-3"><p className="font-display text-2xl font-bold">{membership.activeChallengeLimit}</p><p className="text-[10px] text-muted-foreground">active at once</p></div></div>{membership.plan === 'pro' ? <p className="mt-4 text-xs leading-5 text-muted-foreground">$5/month · create one active challenge and participate in it. The platform fee is separate from the creator-set challenge entry.</p> : <><p className="mt-4 text-xs leading-5 text-muted-foreground">Upgrade for $5/month to join up to five challenges, create one active challenge, and pay $1 platform fee per paid entry.</p><Button className="mt-4 w-full" onClick={upgrade} disabled={checkout.isPending} data-testid="button-upgrade-pro">{checkout.isPending ? 'Opening checkout…' : 'Upgrade to Pro — $5/month'}</Button></>}{message && <p className="mt-3 text-xs text-primary" role="status">{message}</p>}</section>;
}

function PendingInvitesPanel({ invites }: { invites: PendingInvite[] }) {
  return <section className="rounded-2xl border border-primary/25 bg-primary/10 p-5" data-testid="panel-pending-invites"><div className="flex items-center justify-between gap-3"><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Waiting for you</p><h2 className="mt-1 font-display text-xl font-bold">Friend invitations</h2></div><Badge tone="coral">{invites.length} open</Badge></div><div className="mt-4 space-y-2">{invites.slice(0, 3).map((invite) => <Link href={`/invite/${invite.token}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition hover:bg-muted" key={invite.id} data-testid={`link-pending-invite-${invite.id}`}><span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">{invite.inviter.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{invite.inviter.displayName} invited you</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{invite.challenge.name}</span></span><ChevronRight size={15} className="text-primary" /></Link>)}</div></section>;
}
function SettingsGroup({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) { return <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6"><p className="font-mono-app text-[10px] uppercase tracking-[.17em] text-primary">{eyebrow}</p><h2 className="mt-1 font-display text-xl font-bold tracking-[-.035em]">{title}</h2><div className="mt-5">{children}</div></div>; }
function ToggleRow({ label, description, checked, onToggle, testId }: { label: string; description: string; checked: boolean; onToggle: () => void; testId: string }) { return <button onClick={onToggle} className="flex w-full items-center gap-4 border-b border-border/70 py-4 text-left last:border-0 last:pb-0 first:pt-0" role="switch" aria-checked={checked} data-testid={testId}><span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-primary' : 'bg-muted'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} /></span><span><span className="block text-sm font-bold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span></button>; }

function EligibilityNotice({ eligibility, compliance }: { eligibility: EligibilityProfile; compliance: ComplianceStatus }) {
  const checks = [
    { label: '18+ age check', pass: eligibility.age >= compliance.minAge },
    { label: 'State availability', pass: Boolean(eligibility.state) && compliance.approvedStates.includes(eligibility.state.toUpperCase()) },
    { label: 'Identity verification', pass: eligibility.identityStatus === 'verified' },
    { label: 'Terms and refund policy', pass: eligibility.acceptedTerms },
  ];
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" data-testid="card-paid-play-eligibility"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-primary"><ShieldCheck size={18} /></span><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Before paid entry</p><h2 className="mt-1 font-display text-xl font-bold">Eligibility is checked first</h2></div></div><div className="mt-4 space-y-2.5">{checks.map((check) => <div className="flex items-center gap-2 text-xs" key={check.label}><span className={`h-2 w-2 rounded-full ${check.pass ? 'bg-primary' : 'bg-muted-foreground/35'}`} /><span className={check.pass ? 'font-semibold' : 'text-muted-foreground'}>{check.label}</span>{check.pass && <Check size={13} className="text-primary" />}</div>)}</div><p className="mt-4 border-t border-border/70 pt-4 text-[11px] leading-5 text-muted-foreground">{compliance.counselReviewRequired ? 'Paid play is paused until qualified counsel confirms state availability and the challenge/refund model.' : 'Paid play is available only after every check passes.'}</p><Link href="/safety" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary" data-testid="link-complete-eligibility">Review eligibility <ArrowUpRight size={13} /></Link></div>;
}

function SafetyPage() {
  const { eligibility, compliance, updateEligibility } = useApp();
  const checkEligibility = useCheckEligibility();
  const [draft, setDraft] = useState<EligibilityProfile>(eligibility);
  const [serviceMessage, setServiceMessage] = useState('');
  const update = <K extends keyof EligibilityProfile>(key: K, value: EligibilityProfile[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServiceMessage('');
    checkEligibility.mutate({ data: { ...draft, age: Number(draft.age), state: draft.state.toUpperCase() } }, {
      onSuccess: (result) => { updateEligibility({ ...draft, age: Number(draft.age), state: draft.state.toUpperCase() }); setServiceMessage(result.eligible ? 'All checks passed. Paid entry can continue when provider checkout is connected.' : result.reasons.join(' ')); },
      onError: () => setServiceMessage('Eligibility service is unavailable. No paid entry can be accepted until it responds.')
    });
  };
  return <div className="mx-auto max-w-[1050px]"><div className="mb-8"><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Money with guardrails</p><h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-.06em]">Paid play, on purpose.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">StridePool does not accept real-money entries in this build. We will only open paid play after counsel review, identity checks, state eligibility, and provider onboarding are complete.</p></div><div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]"><section className="space-y-5"><div className="rounded-2xl border border-primary/25 bg-primary/10 p-5" role="status" data-testid="status-paid-play"><div className="flex gap-3"><LockKeyhole size={19} className="mt-0.5 shrink-0 text-primary" /><div><p className="font-bold text-primary">{compliance.paidPlayEnabled ? 'Paid play is gated by eligibility' : 'Paid play is currently unavailable'}</p><p className="mt-1 text-xs leading-5 text-primary/80">{compliance.providerConfigured ? 'Provider connection detected, but every participant still needs a successful eligibility decision.' : 'No payment or payout provider is connected. Nothing in the browser can move money.'}</p></div></div></div><div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"><SectionHeading eyebrow="Your checks" title="Tell us what applies" /><form className="space-y-4" onSubmit={handleSubmit}><label className="block text-sm font-bold">Age<input type="number" min="0" value={draft.age || ''} onChange={(event) => update('age', Number(event.target.value))} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" data-testid="input-eligibility-age" /></label><label className="block text-sm font-bold">State or territory<input maxLength={2} value={draft.state} onChange={(event) => update('state', event.target.value.toUpperCase())} placeholder="e.g. CA" className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm uppercase outline-none focus:border-primary" data-testid="input-eligibility-state" /></label><label className="block text-sm font-bold">Identity status<select value={draft.identityStatus} onChange={(event) => update('identityStatus', event.target.value as EligibilityProfile['identityStatus'])} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" data-testid="select-identity-status"><option value="not_started">Not started</option><option value="pending">Pending review</option><option value="verified">Verified by provider</option></select></label><label className="flex items-start gap-3 text-xs leading-5 text-muted-foreground"><input type="checkbox" checked={draft.acceptedTerms} onChange={(event) => update('acceptedTerms', event.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-paid-terms" /><span>I accept the paid-challenge terms and published no-finisher refund policy. This records consent; it does not enable paid entry on its own.</span></label><Button type="submit" disabled={checkEligibility.isPending} data-testid="button-check-eligibility">{checkEligibility.isPending ? 'Checking…' : 'Check eligibility'}</Button>{serviceMessage && <p className="rounded-xl bg-muted p-3 text-xs leading-5" role="status" data-testid="status-eligibility-result">{serviceMessage}</p>}</form></div></section><aside className="space-y-5"><EligibilityNotice eligibility={eligibility} compliance={compliance} /><div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">Required before launch</p><h2 className="mt-1 font-display text-xl font-bold">Counsel and controls</h2><ul className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">{compliance.requirements.map((requirement) => <li className="flex gap-2" key={requirement}><Check size={14} className="mt-0.5 shrink-0 text-primary" />{requirement}</li>)}</ul><div className="mt-5 border-t border-border/70 pt-4 text-xs leading-5"><p className="font-bold">Approved states</p><p className="mt-1 text-muted-foreground">{compliance.approvedStates.length ? compliance.approvedStates.join(', ') : 'None yet — qualified counsel review required.'}</p></div></div></aside></div></div>;
}

function ReferralPage() {
  const { code } = useParams<{ code: string }>();
  const { auth } = useApp();
  const normalizedCode = (code ?? '').trim().toUpperCase();
  const preview = useGetStridePoolReferralPreview(normalizedCode, { query: { queryKey: getGetStridePoolReferralPreviewQueryKey(normalizedCode), enabled: normalizedCode.length >= 6, staleTime: 60_000 } });
  const claim = useClaimStridePoolReferral();
  const attemptedCode = useRef('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (normalizedCode) window.localStorage.setItem('stridepool-referral-code', normalizedCode);
  }, [normalizedCode]);

  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated && preview.data && attemptedCode.current !== normalizedCode) {
      attemptedCode.current = normalizedCode;
      claim.mutate({ data: { code: normalizedCode } }, {
        onSuccess: (result) => {
          window.localStorage.removeItem('stridepool-referral-code');
          setMessage(result.status === 'qualified' ? 'This referral is already qualified.' : 'Referral saved. Join a challenge to unlock your free Pro month.');
          queryClient.invalidateQueries({ queryKey: getGetStridePoolReferralSummaryQueryKey() });
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : 'This referral could not be saved.'),
      });
    }
  }, [auth.isAuthenticated, auth.isLoading, claim, normalizedCode, preview.data]);

  if (preview.isLoading || auth.isLoading) return <div className="mx-auto flex min-h-[55vh] max-w-md items-center justify-center"><div className="h-12 w-12 animate-pulse rounded-2xl bg-muted" /></div>;
  if (preview.isError || !preview.data) return <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-primary"><UsersRound size={25} /></div><h1 className="mt-5 font-display text-3xl font-bold">This referral link wandered off.</h1><p className="mt-2 text-sm text-muted-foreground">Ask your friend for a fresh StridePool link.</p><Link href="/" className="mt-6 rounded-xl bg-foreground px-5 py-3 text-sm font-bold text-background">Back to StridePool</Link></div>;
  return <div className="mx-auto flex min-h-[65vh] max-w-lg items-center justify-center"><section className="w-full rounded-[28px] border border-primary/25 bg-primary/10 p-7 text-center shadow-[var(--shadow-soft)] sm:p-10"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-primary text-primary-foreground shadow-lg"><Sparkles size={28} /></div><p className="mt-7 font-mono-app text-[10px] font-bold uppercase tracking-[.2em] text-primary">A better reason to walk together</p><h1 className="mt-3 font-display text-4xl font-extrabold leading-[.95] tracking-[-.06em]">You’re invited by {preview.data.referrerDisplayName}.</h1><p className="mx-auto mt-5 max-w-sm text-sm leading-6 text-muted-foreground">Sign up, join any StridePool challenge, and you both get Pro free for one month. No payment method is needed for the reward.</p>{auth.isAuthenticated ? <><div className="mt-6 rounded-2xl bg-card p-4 text-left"><p className="text-sm font-bold">Your referral is ready</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{claim.isPending ? 'Saving your referral…' : message || 'Join a challenge to activate both free Pro months.'}</p></div><Link href="/challenges" className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3.5 text-sm font-bold text-background transition hover:bg-primary" data-testid="link-referral-challenges">Browse challenges <ArrowUpRight size={16} /></Link></> : <><Button className="mt-6 w-full py-3.5" onClick={auth.login} data-testid="button-referral-signup">Sign up and join</Button><p className="mt-3 text-[11px] text-muted-foreground">Your link will stay attached while you create your account.</p></>}{message && !auth.isAuthenticated && <p className="mt-4 text-xs text-primary" role="status">{message}</p>}</section></div>;
}

function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { auth } = useApp();
  const [, setLocation] = useLocation();
  const inviteQuery = useGetStridePoolInvite(token ?? '', { query: { queryKey: getGetStridePoolInviteQueryKey(token ?? ''), enabled: Boolean(token), staleTime: 30_000 } });
  const acceptInvite = useAcceptStridePoolInvite();
  const [message, setMessage] = useState('');
  const preview = inviteQuery.data;
  const accept = () => {
    if (!token) return;
    if (!auth.isAuthenticated) { auth.login(); return; }
    setMessage('');
    acceptInvite.mutate({ token }, {
      onSuccess: (result) => { queryClient.invalidateQueries({ queryKey: getGetStridePoolBootstrapQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetStridePoolCommunityChallengesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetStridePoolPendingInvitesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetStridePoolChallengeLeaderboardQueryKey(result.challenge.id) }); setLocation(`/challenge/${result.challenge.id}`); },
      onError: () => setMessage('This invite could not be accepted. It may have already been used or expired.')
    });
  };
  if (inviteQuery.isLoading) return <InviteLoading />;
  if (inviteQuery.isError || !preview) return <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"><CircleAlert size={26} className="text-primary" /><h1 className="mt-5 font-display text-3xl font-bold">This invite has wandered off</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">The link may have expired. Ask your friend to make a fresh one.</p><Link href="/community" className="mt-6 rounded-xl bg-foreground px-5 py-3 text-sm font-bold text-background" data-testid="link-back-community-from-invite">Browse free challenges</Link></div>;
  const challenge = preview.challenge;
  return <div className="mx-auto flex min-h-[65vh] max-w-[620px] items-center justify-center"><section className="w-full overflow-hidden rounded-[26px] border border-border bg-card shadow-[var(--shadow-soft)]"><div className="relative overflow-hidden p-8 sm:p-10" style={{ backgroundColor: challenge.color }}><div className="absolute -right-14 -top-16 h-52 w-52 rounded-full border-[28px] border-foreground/10" /><div className="relative"><Badge tone="neutral">Free community invite</Badge><p className="mt-8 text-sm font-semibold text-foreground/70">{preview.inviter.displayName} saved you a place in</p><h1 className="mt-2 max-w-lg font-display text-[clamp(2.5rem,7vw,4.7rem)] font-bold leading-[.9] tracking-[-.08em]">{challenge.name}</h1><p className="mt-5 max-w-md text-sm leading-6 text-foreground/70">{challenge.theme} A small invitation to keep a good rhythm with other walkers.</p></div></div><div className="p-6 sm:p-8"><div className="grid grid-cols-3 gap-3 border-y border-border/70 py-4 text-center"><div><p className="font-display text-xl font-bold">{challenge.days}</p><p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">days</p></div><div><p className="font-display text-xl font-bold">{challenge.dailyGoal.toLocaleString()}</p><p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">steps/day</p></div><div><p className="font-display text-xl font-bold">{challenge.participantCount}</p><p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">walkers</p></div></div>{auth.isAuthenticated ? <><Button className="mt-6 w-full py-3" onClick={accept} disabled={acceptInvite.isPending} data-testid="button-accept-invite">{acceptInvite.isPending ? 'Joining community…' : 'Accept invite and join'} <ArrowUpRight size={16} /></Button><p className="mt-3 text-center text-[11px] text-muted-foreground">You can leave a free challenge while registration is open.</p></> : <><div className="mt-6 rounded-xl border border-secondary/70 bg-secondary/35 p-4"><p className="text-sm font-bold text-secondary-foreground">Log in to accept this invite</p><p className="mt-1 text-xs leading-5 text-secondary-foreground/75">Anyone can preview the free lane. Joining from an invite needs a profile so your place and streak are saved.</p></div><Button className="mt-4 w-full" onClick={auth.login} data-testid="button-login-to-accept-invite">Log in to join</Button></>}{message && <p className="mt-4 rounded-xl bg-primary/10 p-3 text-xs leading-5 text-primary" role="alert" data-testid="status-accept-invite">{message}</p>}<Link href={`/challenge/${challenge.id}`} className="mt-5 flex items-center justify-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground" data-testid="link-view-invite-challenge">View challenge details <ChevronRight size={14} /></Link></div></section></div>;
}

function InviteLoading() {
  return <div className="mx-auto flex min-h-[60vh] max-w-[620px] items-center justify-center animate-pulse"><div className="w-full overflow-hidden rounded-[26px] border border-border bg-card"><div className="h-72 bg-muted" /><div className="space-y-4 p-8"><div className="h-5 w-2/3 rounded bg-muted" /><div className="h-12 w-full rounded bg-muted" /><div className="h-12 w-full rounded-xl bg-muted" /></div></div></div>;
}

function adminErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function adminMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function adminDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function AdminPage() {
  const { auth } = useApp();
  const [userQuery, setUserQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const flagged = useGetAdminFlaggedStepRecords({ query: { queryKey: getGetAdminFlaggedStepRecordsQueryKey(), enabled: auth.isAuthenticated, staleTime: 15_000 } });
  const challenges = useGetAdminChallenges({ query: { queryKey: getGetAdminChallengesQueryKey(), enabled: auth.isAuthenticated, staleTime: 15_000 } });
  const settlements = useGetAdminSettlementHistory({ query: { queryKey: getGetAdminSettlementHistoryQueryKey(), enabled: auth.isAuthenticated, staleTime: 15_000 } });
  const users = useSearchAdminUsers(userQuery.trim().length >= 2 ? { q: userQuery.trim() } : undefined, { query: { queryKey: getSearchAdminUsersQueryKey(userQuery.trim().length >= 2 ? { q: userQuery.trim() } : undefined), enabled: auth.isAuthenticated && userQuery.trim().length >= 2, staleTime: 10_000 } });
  const user = useGetAdminUser(selectedUserId, { query: { queryKey: getGetAdminUserQueryKey(selectedUserId), enabled: auth.isAuthenticated && Boolean(selectedUserId), staleTime: 15_000 } });
  const requests = [flagged, challenges, settlements];
  const forbidden = requests.find((request) => adminErrorStatus(request.error) === 403) || (users.error && adminErrorStatus(users.error) === 403 ? users : null) || (user.error && adminErrorStatus(user.error) === 403 ? user : null);
  const unauthenticated = !auth.isLoading && !auth.isAuthenticated;

  if (unauthenticated) {
    return <AdminGate title="Admin sign-in required" text="This workspace is restricted to authorized operations staff." action={<Button onClick={auth.login} data-testid="button-admin-login">Log in</Button>} />;
  }
  if (forbidden) {
    return <AdminGate title="Admin access required" text="Your account is signed in, but it does not have the admin role. No internal records were returned." />;
  }

  const flaggedRecords = flagged.data?.records ?? [];
  const challengeRows = challenges.data?.challenges ?? [];
  const settlementRows = settlements.data?.settlements ?? [];
  const searchUsers = users.data?.users ?? [];
  const selected = user.data;

  return <div className="mx-auto max-w-[1380px]">
    <div className="mb-8 flex flex-col gap-4 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="mb-2 font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Internal operations</p><h1 className="font-display text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-.06em]">Admin console</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">A read-only view for anti-cheat review, challenge operations, settlement history, and support lookups.</p></div>
      <Badge tone="teal">Admin only</Badge>
    </div>

     <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <AdminMetric label="Flagged records" value={flagged.isLoading ? '…' : String(flaggedRecords.length)} detail="Unverified daily totals" />
      <AdminMetric label="Challenges" value={challenges.isLoading ? '…' : String(challengeRows.length)} detail="Current status overview" />
      <AdminMetric label="Settlements" value={settlements.isLoading ? '…' : String(settlementRows.length)} detail="Recorded settlement runs" />
    </section>

    <div className="grid gap-8">
      <AdminPanel eyebrow="Anti-cheat queue" title="Flagged step records" count={flaggedRecords.length}>
        {flagged.isLoading ? <AdminLoading /> : flaggedRecords.length === 0 ? <AdminEmpty text="No suspicious daily records are waiting for review." /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="border-b border-border bg-muted/45 font-mono-app text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Walker</th><th className="px-4 py-3">Challenge</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Steps</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Flag reason</th></tr></thead><tbody>{flaggedRecords.map((record: AdminFlaggedStepRecord) => <tr className="border-b border-border/70 last:border-0" key={record.id}><td className="px-4 py-3"><button className="text-left font-bold hover:text-primary" onClick={() => { setSelectedUserId(record.userId); setUserQuery(record.userEmail || record.userName); }} data-testid={`button-admin-record-user-${record.id}`}>{record.userName}<span className="mt-0.5 block font-normal text-muted-foreground">{record.userEmail || record.userId}</span></button></td><td className="px-4 py-3 font-semibold">{record.challengeName}</td><td className="px-4 py-3 whitespace-nowrap">{record.recordDate}</td><td className="px-4 py-3 font-mono-app font-bold">{record.steps.toLocaleString()}</td><td className="px-4 py-3 text-muted-foreground">{record.source.replaceAll('_', ' ')}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">{record.flagReasons.map((reason) => <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary" key={reason}>{reason.replaceAll('_', ' ')}</span>)}</div></td></tr>)}</tbody></table></div>}
      </AdminPanel>

      <AdminPanel eyebrow="Pool operations" title="Challenge status overview" count={challengeRows.length}>
        {challenges.isLoading ? <AdminLoading /> : challengeRows.length === 0 ? <AdminEmpty text="No challenges found." /> : <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="border-b border-border bg-muted/45 font-mono-app text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Challenge</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Participants</th><th className="px-4 py-3">Pool total</th><th className="px-4 py-3">Window</th></tr></thead><tbody>{challengeRows.map((challenge: AdminChallenge) => <tr className="border-b border-border/70 last:border-0" key={challenge.id}><td className="px-4 py-3"><p className="font-bold">{challenge.name}</p><p className="mt-0.5 text-muted-foreground">{challenge.community ? 'Free community' : `$${challenge.entryFee.toFixed(2)} entry`}</p></td><td className="px-4 py-3"><AdminStatus status={challenge.status} /></td><td className="px-4 py-3 font-mono-app font-bold">{challenge.participantCount}</td><td className="px-4 py-3 font-mono-app font-bold">${challenge.poolTotal.toFixed(2)}</td><td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{challenge.startDate} → {challenge.endDate}</td></tr>)}</tbody></table></div>}
      </AdminPanel>

      <AdminPanel eyebrow="Money audit" title="Settlement history" count={settlementRows.length}>
        {settlements.isLoading ? <AdminLoading /> : settlementRows.length === 0 ? <AdminEmpty text="No settled challenge runs have been recorded yet." /> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-xs"><thead className="border-b border-border bg-muted/45 font-mono-app text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Challenge</th><th className="px-4 py-3">Settled</th><th className="px-4 py-3">Finishers</th><th className="px-4 py-3">Per-finisher payout</th><th className="px-4 py-3">Payout events</th><th className="px-4 py-3">No-finisher refunds</th></tr></thead><tbody>{settlementRows.map((settlement: AdminSettlement) => <tr className="border-b border-border/70 last:border-0" key={settlement.challengeId}><td className="px-4 py-3 font-bold">{settlement.challengeName}</td><td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{adminDate(settlement.settledAt)}</td><td className="px-4 py-3 font-mono-app font-bold">{settlement.finisherCount}</td><td className="px-4 py-3 font-mono-app font-bold">{settlement.finisherCount ? adminMoney(settlement.perFinisherPayoutCents) : '—'}</td><td className="px-4 py-3">{settlement.payoutAmountsCents.length ? <span title={settlement.payoutAmountsCents.map(adminMoney).join(', ')}>{settlement.payoutAmountsCents.length} · {settlement.payoutAmountsCents.map(adminMoney).join(', ')}</span> : '—'}</td><td className="px-4 py-3">{settlement.noFinisherRefundCount ? <span className="font-semibold text-primary">{settlement.noFinisherRefundCount} · {adminMoney(settlement.noFinisherRefundCents)}</span> : '—'}</td></tr>)}</tbody></table></div>}
      </AdminPanel>

      <AdminPanel eyebrow="Support tools" title="User lookup">
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <div><label className="block text-xs font-bold" htmlFor="admin-user-search">Search email, ID, or name</label><div className="relative mt-2"><Search className="absolute left-3 top-3 text-muted-foreground" size={16} /><input id="admin-user-search" value={userQuery} onChange={(event) => { setUserQuery(event.target.value); setSelectedUserId(''); }} placeholder="Start with two characters" className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" data-testid="input-admin-user-search" /></div>{users.isLoading && <p className="mt-2 text-[11px] text-muted-foreground">Searching users…</p>}{searchUsers.length > 0 && <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">{searchUsers.map((result) => <button type="button" className="flex w-full items-center gap-3 border-b border-border/70 px-3 py-3 text-left last:border-0 hover:bg-muted" onClick={() => { setSelectedUserId(result.id); setUserQuery(result.email || result.displayName); }} key={result.id} data-testid={`button-admin-select-user-${result.id}`}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">{result.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-xs font-bold">{result.displayName}</span><span className="block truncate text-[10px] text-muted-foreground">{result.email || result.id}</span></span></button>)}</div>}{userQuery.trim().length >= 2 && !users.isLoading && searchUsers.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">No users matched that query.</p>}</div>
          <div className="min-h-[180px] rounded-xl border border-border bg-background p-5">{!selectedUserId ? <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center"><UserPlus size={22} className="text-primary" /><p className="mt-3 text-sm font-bold">Select a walker to inspect</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Support can review wallet state and every challenge entry without exposing this data publicly.</p></div> : user.isLoading ? <AdminLoading /> : selected ? <AdminUserDetail user={selected.user} challenges={selected.challenges} overrides={selected.overrides} /> : user.isError ? <AdminEmpty text="That user could not be loaded." /> : null}</div>
        </div>
      </AdminPanel>
      {selected && <AdminOverridePanel userId={selected.user.id} challenges={selected.challenges} overrides={selected.overrides} availableChallenges={challengeRows} />}
    </div>
  </div>;
}

function AdminGate({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck size={26} /></div><h1 className="mt-5 font-display text-2xl font-bold">{title}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function AdminMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"><p className="font-mono-app text-[10px] uppercase tracking-[.14em] text-muted-foreground">{label}</p><p className="mt-4 font-display text-3xl font-bold tracking-[-.05em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function AdminPanel({ eyebrow, title, count, children }: { eyebrow: string; title: string; count?: number; children: ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"><div className="flex items-end justify-between gap-4 border-b border-border/70 p-5 sm:p-6"><div><p className="font-mono-app text-[10px] uppercase tracking-[.16em] text-primary">{eyebrow}</p><h2 className="mt-1 font-display text-xl font-bold">{title}</h2></div>{count !== undefined && <Badge tone="neutral">{count} records</Badge>}</div><div className="p-0">{children}</div></section>;
}

function AdminLoading() {
  return <div className="space-y-3 p-6"><div className="h-4 animate-pulse rounded bg-muted" /><div className="h-4 animate-pulse rounded bg-muted" /><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /></div>;
}

function AdminEmpty({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm text-muted-foreground"><ShoelaceMascot size={44} mood="calm" label="Shoelace mascot empty state" /><p className="mt-3">{text}</p></div>;
}

function AdminStatus({ status }: { status: AdminChallenge['status'] }) {
  const tone = status === 'settled' ? 'lime' : status === 'settling' ? 'coral' : status === 'active' ? 'teal' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

function AdminUserDetail({ user, challenges, overrides }: { user: { id: string; email: string; displayName: string; role: string; walletBalance: number; walletPending: number; totalEarned: number; createdAt: string }; challenges: AdminUserChallenge[]; overrides: AdminParticipantOverride[] }) {
  return <div><div className="flex flex-col justify-between gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start"><div><p className="font-display text-lg font-bold">{user.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{user.email || 'No email'} · {user.id}</p></div><Badge tone={user.role === 'admin' ? 'coral' : 'neutral'}>{user.role}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div><p className="text-[10px] uppercase text-muted-foreground">Balance</p><p className="mt-1 font-mono-app text-lg font-bold">${user.walletBalance.toFixed(2)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Pending</p><p className="mt-1 font-mono-app text-lg font-bold">${user.walletPending.toFixed(2)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Total earned</p><p className="mt-1 font-mono-app text-lg font-bold">${user.totalEarned.toFixed(2)}</p></div></div><div className="mt-6"><p className="mb-3 text-xs font-bold">Challenge history · {challenges.length}</p>{challenges.length ? <div className="overflow-x-auto rounded-xl border border-border/80"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-muted/45 font-mono-app text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2.5">Challenge</th><th className="px-3 py-2.5">Entry</th><th className="px-3 py-2.5">Entry status</th><th className="px-3 py-2.5">Settlement</th><th className="px-3 py-2.5">Joined</th></tr></thead><tbody>{challenges.map((challenge) => <tr className="border-t border-border/70" key={`${challenge.challengeId}-${challenge.joinedAt}`}><td className="px-3 py-3 font-semibold">{challenge.challengeName}</td><td className="px-3 py-3 font-mono-app">{challenge.entryFee ? `$${challenge.entryFee.toFixed(2)}` : 'Free'}</td><td className="px-3 py-3">{challenge.entryStatus}</td><td className="px-3 py-3">{challenge.settlementStatus}{challenge.settlementAmount !== null && <span className="ml-1 font-mono-app">· ${challenge.settlementAmount.toFixed(2)}</span>}</td><td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{adminDate(challenge.joinedAt)}</td></tr>)}</tbody></table></div> : <AdminEmpty text="This user has no challenge entries." />}</div>{overrides.length > 0 && <div className="mt-6 border-t border-border/70 pt-5"><p className="mb-3 text-xs font-bold">Status override audit · {overrides.length}</p><div className="space-y-2">{overrides.slice(0, 5).map((override) => <div className="rounded-xl bg-muted/50 p-3" key={override.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">{override.challengeName} · <StatusPill status={override.status} /></p><span className="text-[10px] text-muted-foreground">{adminDate(override.createdAt)}</span></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{override.reason}</p></div>)}</div></div>}</div>;
}

function AdminOverridePanel({ userId, challenges, overrides, availableChallenges }: { userId: string; challenges: AdminUserChallenge[]; overrides: AdminParticipantOverride[]; availableChallenges: AdminChallenge[] }) {
  const eligible = challenges.filter((history) => availableChallenges.some((challenge) => challenge.id === history.challengeId && challenge.community && challenge.entryFee === 0));
  const [challengeId, setChallengeId] = useState(eligible[0]?.challengeId ?? '');
  const [status, setStatus] = useState<'on_track' | 'finished'>('on_track');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const mutation = useOverrideAdminChallengeParticipant();
  useEffect(() => { if (!eligible.some((item) => item.challengeId === challengeId)) setChallengeId(eligible[0]?.challengeId ?? ''); }, [eligible.map((item) => item.challengeId).join(','), challengeId]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challengeId || reason.trim().length < 8) return;
    setMessage('');
    mutation.mutate({ challengeId, userId, data: { status, reason: reason.trim() } }, {
      onSuccess: (result) => { setReason(''); setMessage(`Override logged: ${result.override.status.replaceAll('_', ' ')}. The reason is now in the audit history.`); queryClient.invalidateQueries({ queryKey: getGetAdminUserQueryKey(userId) }); queryClient.invalidateQueries({ queryKey: getGetStridePoolChallengeLeaderboardQueryKey(challengeId) }); },
      onError: () => setMessage('That override could not be saved. No participant status changed.')
    });
  };
  return <AdminPanel eyebrow="Dispute resolution" title="Manual participant override"><div className="p-5 sm:p-6">{eligible.length ? <form className="grid gap-4 lg:grid-cols-[1.2fr_.8fr_1.6fr_auto]" onSubmit={submit}><label className="text-xs font-bold">Free challenge<select value={challengeId} onChange={(event) => setChallengeId(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal outline-none focus:border-primary" data-testid="select-admin-override-challenge">{eligible.map((item) => <option value={item.challengeId} key={item.challengeId}>{item.challengeName}</option>)}</select></label><label className="text-xs font-bold">Set status<select value={status} onChange={(event) => setStatus(event.target.value as 'on_track' | 'finished')} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal outline-none focus:border-primary" data-testid="select-admin-override-status"><option value="on_track">Reinstate · On track</option><option value="finished">Credit · Finished</option></select></label><label className="text-xs font-bold">Required reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} maxLength={1000} rows={2} placeholder="Explain the sync failure or support decision…" className="mt-2 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm font-normal outline-none focus:border-primary" data-testid="textarea-admin-override-reason" /></label><Button type="submit" disabled={mutation.isPending || reason.trim().length < 8} data-testid="button-submit-admin-override">{mutation.isPending ? 'Saving…' : 'Save override'}</Button>{message && <p className="text-xs leading-5 text-primary lg:col-span-4" role="status" data-testid="status-admin-override">{message}</p>}</form> : <AdminEmpty text="This user has no free community entries available for override." />}</div></AdminPanel>;
}

function NotFound() { return <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center"><div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-primary/10 text-primary"><ShoelaceMascot size={68} mood="calm" label="Shoelace mascot for missing page" /></div><h1 className="mt-5 font-display text-3xl font-bold">This path wandered off.</h1><p className="mt-2 text-sm text-muted-foreground">That page is not part of today's route.</p><Link href="/" className="mt-6 rounded-xl bg-foreground px-5 py-3 text-sm font-bold text-background" data-testid="link-back-home">Back to today</Link></div>; }

function Router() { const [location] = useLocation(); return <ErrorBoundary resetKey={location}><AppShell><Switch><Route path="/" component={Dashboard} /><Route path="/challenges" component={ChallengesPage} /><Route path="/community" component={CommunityPage} /><Route path="/challenge/:id" component={ChallengeDetail} /><Route path="/invite/:token" component={InvitePage} /><Route path="/referrals" component={ReferralsPage} /><Route path="/referral/:code" component={ReferralPage} /><Route path="/wallet" component={WalletPage} /><Route path="/safety" component={SafetyPage} /><Route path="/profile" component={ProfilePage} /><Route path="/admin" component={AdminPage} /><Route component={NotFound} /></Switch></AppShell></ErrorBoundary>; }
function App() { return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppProvider><Router /></AppProvider></WouterRouter></QueryClientProvider>; }
export default App;
