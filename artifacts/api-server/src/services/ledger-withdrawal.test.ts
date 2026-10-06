import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { withdrawAvailableBalance } from "./ledger.js";

const runId = `withdrawal-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let nextUser = 0;

async function withWallet(balance: string, run: (userId: string) => Promise<void>) {
  const userId = `${runId}-${++nextUser}`;
  await db.insert(usersTable).values({
    id: userId,
    email: `${userId}@example.test`,
    firstName: "Test",
    lastName: "Walker",
    walletBalance: balance,
    walletPending: "0.00",
    totalEarned: "0.00",
    goalBaseline: "8000",
    stripeConnectAccountId: "acct_withdrawal_test",
  });
  try {
    await run(userId);
  } finally {
    await db.delete(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.userId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
}

async function walletBalance(userId: string) {
  const [user] = await db.select({ balance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.balance;
}

function mockProvider(createWithdrawal: (amountCents: number) => Promise<{ transferId: string; payoutId: string }>) {
  return {
    getPayoutAccount: async () => ({ linked: true, payoutsEnabled: true }),
    createWithdrawal: async (_user: unknown, amountCents: number) => createWithdrawal(amountCents),
  };
}

after(async () => {
  await pool.end();
});

describe("specified wallet withdrawals", () => {
  it("withdraws only the requested amount and leaves the remainder available", async () => {
    await withWallet("42.50", async (userId) => {
      const providerAmounts: number[] = [];
      const provider = mockProvider(async (amountCents) => {
        providerAmounts.push(amountCents);
        return { transferId: "tr_partial", payoutId: "po_partial" };
      });
      const input = { amountCents: 2_000, idempotencyKey: `${runId}-partial` };

      const result = await withdrawAvailableBalance(userId, input, provider);
      assert.equal(result.amountCents, 2_000);
      assert.equal(await walletBalance(userId), "22.50");
      assert.deepEqual(providerAmounts, [2_000]);

      const [entry] = await db.select().from(walletLedgerEntriesTable).where(and(
        eq(walletLedgerEntriesTable.userId, userId),
        eq(walletLedgerEntriesTable.idempotencyKey, input.idempotencyKey),
      ));
      assert.equal(entry?.amountCents, 2_000);

      const retry = await withdrawAvailableBalance(userId, input, provider);
      assert.equal(retry.amountCents, 2_000);
      assert.equal(await walletBalance(userId), "22.50");
      assert.deepEqual(providerAmounts, [2_000], "an idempotent retry must not create a second payout");
    });
  });

  it("rejects amounts below $20 and amounts above the available balance without calling Stripe", async () => {
    await withWallet("42.50", async (userId) => {
      let providerCalls = 0;
      const provider = mockProvider(async () => {
        providerCalls += 1;
        return { transferId: "tr_unexpected", payoutId: "po_unexpected" };
      });

      await assert.rejects(
        () => withdrawAvailableBalance(userId, { amountCents: 1_999, idempotencyKey: `${runId}-under-min` }, provider),
        /at least \$20\.00/,
      );
      await assert.rejects(
        () => withdrawAvailableBalance(userId, { amountCents: 4_251, idempotencyKey: `${runId}-over-balance` }, provider),
        /exceeds your available wallet balance/,
      );
      assert.equal(await walletBalance(userId), "42.50");
      assert.equal(providerCalls, 0);
    });
  });

  it("restores only the requested amount when the provider rejects the payout", async () => {
    await withWallet("42.50", async (userId) => {
      const provider = mockProvider(async () => {
        throw new Error("Sandbox payout unavailable.");
      });
      const idempotencyKey = `${runId}-provider-failure`;

      await assert.rejects(
        () => withdrawAvailableBalance(userId, { amountCents: 3_000, idempotencyKey }, provider),
        /Sandbox payout unavailable/,
      );
      assert.equal(await walletBalance(userId), "42.50");
      const [entry] = await db.select().from(walletLedgerEntriesTable).where(and(
        eq(walletLedgerEntriesTable.userId, userId),
        eq(walletLedgerEntriesTable.idempotencyKey, idempotencyKey),
      ));
      assert.equal(entry?.amountCents, 3_000);
      assert.equal(entry?.status, "provider_failed");
    });
  });

  it("reserves funds atomically when two withdrawals compete for the same balance", async () => {
    await withWallet("42.50", async (userId) => {
      const providerAmounts: number[] = [];
      const provider = mockProvider(async (amountCents) => {
        providerAmounts.push(amountCents);
        return { transferId: "tr_concurrent", payoutId: "po_concurrent" };
      });
      const results = await Promise.allSettled([
        withdrawAvailableBalance(userId, { amountCents: 3_000, idempotencyKey: `${runId}-concurrent-a` }, provider),
        withdrawAvailableBalance(userId, { amountCents: 3_000, idempotencyKey: `${runId}-concurrent-b` }, provider),
      ]);

      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.equal(await walletBalance(userId), "12.50");
      assert.deepEqual(providerAmounts, [3_000]);
    });
  });
});
