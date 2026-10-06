import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  ClosePaidPlayAccountBody,
  GetPaidPlayAccountResponse,
  RecordBiometricConsentBody,
  RequestPaidPlaySelfExclusionBody,
  SetPaidPlayEntryLimitBody,
} from "@workspace/api-zod";
import {
  BIOMETRIC_CONSENT_VERSION,
  challengesTable,
  db,
  entriesTable,
  hasCurrentBiometricConsent,
  hasCurrentPaidPlayTermsAcceptance,
  isSelfExcluded,
  PAID_PLAY_TERMS_VERSION,
  paidEntryBlocks,
  RESTRICTED_PAID_PLAY_STATES,
  usersTable,
  walletLedgerEntriesTable,
  type User,
} from "@workspace/db";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { getPayoutAccount, withdrawAvailableBalance } from "../services/ledger";

const router: IRouter = Router();

function requireUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Login required." });
    return null;
  }
  return req.user.id;
}

export function paidPlayAccountFor(user: User, now = new Date()) {
  return GetPaidPlayAccountResponse.parse({
    termsVersion: PAID_PLAY_TERMS_VERSION,
    termsAccepted: hasCurrentPaidPlayTermsAcceptance(user),
    biometricNoticeVersion: BIOMETRIC_CONSENT_VERSION,
    biometricConsentRecorded: hasCurrentBiometricConsent(user),
    selfExcluded: isSelfExcluded(user, now),
    selfExcludedUntil: user.paidPlaySelfExcludedUntil,
    selfExcludedPermanently: user.paidPlaySelfExcludedPermanently,
    weeklyEntryLimitCents: user.paidPlayWeeklyEntryLimitCents,
    restrictedStates: [...RESTRICTED_PAID_PLAY_STATES],
    entryBlocks: paidEntryBlocks(user, now),
    accountClosed: user.accountClosedAt !== null,
  });
}

async function loadUser(userId: string): Promise<User | undefined> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

router.get("/paid-play/account", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const user = await loadUser(userId);
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(paidPlayAccountFor(user));
});

// Paid Play Terms §12.3: exclusions apply immediately and can only be
// lengthened through this endpoint; shortening one requires support.
router.post("/paid-play/self-exclusion", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = RequestPaidPlaySelfExclusionBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.permanent && !parsed.data.days)) {
    res.status(400).json({ error: "Choose a number of days (1-3650) or a permanent exclusion." });
    return;
  }
  const user = await loadUser(userId);
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  const now = new Date();
  const requestedUntil = parsed.data.days ? new Date(now.getTime() + parsed.data.days * 24 * 60 * 60 * 1000) : null;
  const currentUntil = user.paidPlaySelfExcludedUntil && user.paidPlaySelfExcludedUntil > now ? user.paidPlaySelfExcludedUntil : null;
  const until = requestedUntil && (!currentUntil || requestedUntil > currentUntil) ? requestedUntil : currentUntil;
  const [updated] = await db.update(usersTable).set({
    paidPlaySelfExcludedUntil: until,
    paidPlaySelfExcludedPermanently: user.paidPlaySelfExcludedPermanently || parsed.data.permanent === true,
    updatedAt: now,
  }).where(eq(usersTable.id, userId)).returning();
  req.log.info({ userId, permanent: parsed.data.permanent === true, until }, "Paid-play self-exclusion applied");
  res.json(paidPlayAccountFor(updated!));
});

router.put("/paid-play/entry-limit", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = SetPaidPlayEntryLimitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a weekly limit in whole cents, or clear it." });
    return;
  }
  const [updated] = await db.update(usersTable).set({
    paidPlayWeeklyEntryLimitCents: parsed.data.weeklyLimitCents ?? null,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json(paidPlayAccountFor(updated));
});

// Paid Play Terms §9.6 / Illinois BIPA: a written release must be recorded
// for the current notice version before any face-geometry verification.
router.post("/paid-play/biometric-consent", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = RecordBiometricConsentBody.safeParse(req.body);
  if (!parsed.success || parsed.data.noticeVersion !== BIOMETRIC_CONSENT_VERSION) {
    res.status(400).json({ error: "Review the current biometric notice before giving consent." });
    return;
  }
  const [updated] = await db.update(usersTable).set({
    biometricConsentAt: new Date(),
    biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json(paidPlayAccountFor(updated));
});

// Paid Play Terms §6.4: closure pays out the entire available balance,
// regardless of the $20 minimum, to the verified payout account.
router.post("/paid-play/account-closure", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const parsed = ClosePaidPlayAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Confirm the account closure." });
    return;
  }
  const user = await loadUser(userId);
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  const activePaid = await db.select({ id: entriesTable.id })
    .from(entriesTable)
    .innerJoin(challengesTable, eq(entriesTable.challengeId, challengesTable.id))
    .where(and(
      eq(entriesTable.userId, userId),
      eq(entriesTable.status, "active"),
      isNotNull(entriesTable.paymentReference),
      ne(challengesTable.settlementStatus, "settled"),
    ));
  if (activePaid.length) {
    res.status(409).json({ error: "You have paid entries that have not settled yet. Close your account after they settle, or leave them before their join deadline." });
    return;
  }
  const balanceCents = Math.round(Number(user.walletBalance) * 100);
  let payoutStatus: "none" | "pending" | "needs_payout_account" = "none";
  if (balanceCents > 0) {
    const account = await getPayoutAccount(userId).catch(() => null);
    if (account?.linked && account.payoutsEnabled) {
      try {
        await withdrawAvailableBalance(userId, {
          amountCents: balanceCents,
          idempotencyKey: parsed.data.idempotencyKey,
          purpose: "account_closure",
        });
        payoutStatus = "pending";
      } catch (error) {
        res.status(409).json({ error: error instanceof Error ? error.message : "The closure payout could not be started." });
        return;
      }
    } else {
      // No verified payout account: support returns the balance to the
      // original payment method (§6.4). Record the obligation in the ledger.
      await db.insert(walletLedgerEntriesTable).values({
        id: `ledger_closure_${randomUUID()}`,
        userId,
        eventType: "closure_payout_owed",
        status: "pending_support",
        amountCents: balanceCents,
        currency: "usd",
        idempotencyKey: `account_closure:${parsed.data.idempotencyKey}`,
        metadata: { auditRule: "closure balance returned to original payment method by support", source: "account_closure" },
      }).onConflictDoNothing();
      payoutStatus = "needs_payout_account";
    }
  }
  await db.update(usersTable).set({ accountClosedAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  req.log.info({ userId, balanceCents, payoutStatus }, "Account closed");
  res.json({ closed: true, payoutCents: balanceCents, payoutStatus });
});

export default router;
