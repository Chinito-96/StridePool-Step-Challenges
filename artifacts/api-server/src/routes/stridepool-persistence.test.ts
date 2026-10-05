import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import app from "../app";
import { createSession, type SessionData } from "../lib/auth";
import {
  activateProviderChallengeEntry,
  challengesTable,
  db,
  pool,
  sessionsTable,
  usersTable,
  walletLedgerEntriesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const runId = `persistence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${runId}-user`;
const otherUserId = `${runId}-other`;
const challengeId = `${runId}-challenge`;
const decoyLedgerId = `${runId}-decoy-ledger`;

type ApiResult = {
  status: number;
  body: unknown;
};

let server: Server | undefined;
let baseUrl = "";
let firstSession = "";
let secondSession = "";
const expiredSessions: string[] = [];

async function request(
  path: string,
  options: RequestInit & { session?: string } = {},
): Promise<ApiResult> {
  const { session, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  if (session) requestHeaders.set("cookie", `sid=${session}`);
  if (init.body && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: requestHeaders,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function createTestSession(
  id: string,
  email: string,
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
) {
  return createSession({
    user: {
      id,
      email,
      firstName: "Persistence",
      lastName: "Test",
      profileImageUrl: null,
    },
    access_token: "test-access-token",
    expires_at: expiresAt,
  });
}

describe("StridePool authenticated persistence across sessions", () => {
  before(async () => {
    await db.insert(usersTable).values([
      {
        id: userId,
        email: `${userId}@example.test`,
        displayName: "Initial Walker",
        walletBalance: "50.00",
        walletPending: "3.00",
        totalEarned: "7.00",
        goalBaseline: "8000",
      },
      {
        id: otherUserId,
        email: `${otherUserId}@example.test`,
        displayName: "Decoy Walker",
        walletBalance: "25.00",
        walletPending: "0.00",
        totalEarned: "0.00",
      },
    ]);
    await db.insert(challengesTable).values({
      id: challengeId,
      name: "Persistence Check",
      theme: "Test",
      level: "Open",
      startDate: "2099-01-01",
      endDate: "2099-01-03",
      days: 3,
      dailyGoal: 8000,
      entryFee: "5.00",
      prizePool: "0.00",
      participantCount: 0,
      finishers: 0,
      settlementStatus: "open",
      color: "#000000",
      challengeType: "goal",
      goalType: "fixed",
      community: false,
    });
    await db.insert(walletLedgerEntriesTable).values({
      id: decoyLedgerId,
      userId: otherUserId,
      eventType: "decoy_event",
      status: "recorded",
      amountCents: 999,
      currency: "usd",
      providerEventId: null,
      idempotencyKey: `${runId}-decoy-key`,
      challengeId: null,
      metadata: { test: true },
    });

    firstSession = await createTestSession(userId, `${userId}@example.test`);
    secondSession = await createTestSession(userId, `${userId}@example.test`);

    const listeningServer = app.listen(0);
    server = listeningServer;
    await new Promise<void>((resolve, reject) => {
      listeningServer.once("listening", resolve);
      listeningServer.once("error", reject);
    });
    const address = listeningServer.address();
    if (!address || typeof address === "string") {
      throw new Error("The test API server did not expose a TCP address.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    const activeServer = server;
    if (activeServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        activeServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await db.delete(sessionsTable).where(inArray(sessionsTable.sid, [firstSession, secondSession, ...expiredSessions]));
    await db.delete(challengesTable).where(eq(challengesTable.id, challengeId));
    await db.delete(usersTable).where(inArray(usersTable.id, [userId, otherUserId]));
    await db.delete(walletLedgerEntriesTable).where(eq(walletLedgerEntriesTable.id, decoyLedgerId));
    await pool.end();
  });

  it("keeps profile, membership, steps, wallet, and history in a second session", async () => {
    const unauthenticatedLedger = await request(`/money/ledger?userId=${userId}`);
    assert.equal(unauthenticatedLedger.status, 401);

    const unauthenticatedCheckout = await request("/money/checkout", {
      method: "POST",
      body: JSON.stringify({
        challengeId,
        amountCents: 500,
        currency: "usd",
        idempotencyKey: `${runId}-checkout`,
        userId: otherUserId,
      }),
    });
    assert.equal(unauthenticatedCheckout.status, 401);

    const unauthenticatedPayout = await request("/money/payout-onboarding", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `${runId}-payout`,
        userId: otherUserId,
      }),
    });
    assert.equal(unauthenticatedPayout.status, 401);

    const profile = await request("/stridepool/profile", {
      method: "PATCH",
      session: firstSession,
      body: JSON.stringify({
        displayName: "Saved Walker",
        reminders: false,
        weeklyDigest: false,
        publicProgress: true,
        healthConnected: false,
        eligibilityAge: 34,
        eligibilityState: "NY",
        acceptedTerms: true,
      }),
    });
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.body, {
      displayName: "Saved Walker",
      reminders: false,
      weeklyDigest: false,
      publicProgress: true,
      healthConnected: false,
      goalBaseline: 8000,
      eligibilityAge: 34,
      eligibilityState: "NY",
      identityStatus: "not_started",
      acceptedTerms: true,
    });

    await activateProviderChallengeEntry(userId, challengeId, 500, 200, 700, `${runId}-payment`, new Date());
    await db.insert(walletLedgerEntriesTable).values({
      id: `${runId}-payment-ledger`,
      userId,
      eventType: "payment_succeeded",
      status: "recorded",
      amountCents: 200,
      currency: "usd",
      providerEventId: `${runId}-provider-event`,
      idempotencyKey: `${runId}-payment`,
      challengeId,
      metadata: { test: true },
    });

    const today = new Date().toISOString().slice(0, 10);
    const sync = await request("/stridepool/sources/apple_health/samples", {
      method: "POST",
      session: firstSession,
      body: JSON.stringify({
        samples: [{
          sourceSampleId: `${runId}-steps`,
          recordDate: today,
          steps: 4321,
          startTime: `${today}T08:00:00.000Z`,
          endTime: `${today}T09:00:00.000Z`,
          recordedAt: `${today}T09:00:01.000Z`,
          rawPayload: { source: "apple_health", device: "test" },
        }],
      }),
    });
    assert.equal(sync.status, 200);
    assert.equal((sync.body as { steps: number }).steps, 4321);
    assert.equal((sync.body as { samples: Array<{ verificationStatus: string }> }).samples[0]?.verificationStatus, "verified");

    const firstBootstrap = await request("/stridepool/bootstrap", { session: firstSession });
    assert.equal(firstBootstrap.status, 200);
    const first = firstBootstrap.body as {
      user: { id: string };
      joinedIds: string[];
      steps: number;
      wallet: { balance: number; pending: number; totalEarned: number };
      profile: Record<string, unknown>;
      activities: Array<{ type: string; meta: string }>;
      challenges: Array<{ id: string; joined: boolean }>;
    };
    assert.equal(first.user.id, userId);
    assert.deepEqual(first.profile, profile.body);
    assert.deepEqual(first.wallet, { balance: 50, pending: 3, totalEarned: 7 });
    assert.equal(first.steps, 4321);
    assert.ok(first.joinedIds.includes(challengeId));
    assert.equal(first.challenges.find((challenge) => challenge.id === challengeId)?.joined, true);
    assert.ok(first.activities.some((activity) => activity.type === "sync" && activity.meta.includes("persisted to your account")));
    assert.ok(first.activities.some((activity) => activity.type === "challenge"));

    const anonymousBootstrap = await request("/stridepool/bootstrap");
    assert.equal(anonymousBootstrap.status, 200);
    const anonymous = anonymousBootstrap.body as typeof first;

    for (const expiration of ["database", "access-token"] as const) {
      // Fresh sessions ensure every endpoint exercises expiration, rather than
      // merely rejecting the session deleted by a previous request.
      async function createExpiredSession() {
        const sid = await createTestSession(
          userId,
          `${userId}@example.test`,
          expiration === "access-token"
            ? Math.floor(Date.now() / 1000) - 60
            : undefined,
        );
        expiredSessions.push(sid);
        if (expiration === "database") {
          await db.update(sessionsTable).set({
            expire: new Date(Date.now() - 60_000),
          }).where(eq(sessionsTable.sid, sid));
        }
        const [stored] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
        assert.ok(stored);
        const sessionData = stored.sess as SessionData;
        assert.equal(sessionData.refresh_token, undefined);
        if (expiration === "database") {
          assert.ok(stored.expire.getTime() < Date.now());
        } else {
          assert.ok(stored.expire.getTime() > Date.now());
          assert.ok(Number(sessionData.expires_at) < Math.floor(Date.now() / 1000));
        }
        return sid;
      }

      const expiredBootstrapSession = await createExpiredSession();
      const expiredBootstrap = await request("/stridepool/bootstrap", {
        session: expiredBootstrapSession,
      });
      assert.equal(expiredBootstrap.status, 200, expiration);
      const expired = expiredBootstrap.body as typeof first;
      assert.equal(expired.user, null, expiration);
      assert.deepEqual(expired.profile, anonymous.profile, expiration);
      assert.deepEqual(expired.wallet, { balance: 0, pending: 0, totalEarned: 0 }, expiration);
      assert.deepEqual(expired.joinedIds, [], expiration);
      assert.notEqual(expired.steps, first.steps, expiration);
      assert.deepEqual(expired.activities, [], expiration);
      assert.equal(expired.challenges.find((challenge) => challenge.id === challengeId)?.joined, false, expiration);
      assert.deepEqual(
        await db.select().from(sessionsTable).where(eq(sessionsTable.sid, expiredBootstrapSession)),
        [],
        `${expiration} session should be deleted`,
      );

      const expiredLedger = await request(`/money/ledger?userId=${userId}`, {
        session: await createExpiredSession(),
      });
      assert.equal(expiredLedger.status, 401, expiration);

      const expiredCheckout = await request("/money/checkout", {
        method: "POST",
        session: await createExpiredSession(),
        body: JSON.stringify({
          challengeId,
          amountCents: 500,
          currency: "usd",
          idempotencyKey: `${runId}-${expiration}-checkout`,
          userId,
        }),
      });
      assert.equal(expiredCheckout.status, 401, expiration);

      const expiredPayout = await request("/money/payout-onboarding", {
        method: "POST",
        session: await createExpiredSession(),
        body: JSON.stringify({
          idempotencyKey: `${runId}-${expiration}-payout`,
          userId,
        }),
      });
      assert.equal(expiredPayout.status, 401, expiration);
    }

    await db.delete(sessionsTable).where(eq(sessionsTable.sid, firstSession));

    const revokedBootstrap = await request("/stridepool/bootstrap", { session: firstSession });
    assert.equal(revokedBootstrap.status, 200);
    const revoked = revokedBootstrap.body as {
      user: null;
      wallet: { balance: number; pending: number; totalEarned: number };
      profile: Record<string, unknown>;
      joinedIds: string[];
      steps: number;
      activities: unknown[];
    };
    assert.equal(revoked.user, null);
    assert.deepEqual(revoked.wallet, { balance: 0, pending: 0, totalEarned: 0 });
    assert.deepEqual(revoked.profile, {
      displayName: "Alex Morgan",
      reminders: true,
      weeklyDigest: true,
      publicProgress: false,
      healthConnected: true,
      goalBaseline: 7500,
      eligibilityAge: 0,
      eligibilityState: "",
      identityStatus: "not_started",
      acceptedTerms: false,
    });
    assert.deepEqual(revoked.joinedIds, []);
    assert.notEqual(revoked.steps, first.steps);
    assert.equal(revoked.activities.length, 0);

    const revokedLedger = await request(`/money/ledger?userId=${userId}`, {
      session: firstSession,
    });
    assert.equal(revokedLedger.status, 401);

    const revokedCheckout = await request("/money/checkout", {
      method: "POST",
      session: firstSession,
      body: JSON.stringify({
        challengeId,
        amountCents: 500,
        currency: "usd",
        idempotencyKey: `${runId}-revoked-checkout`,
        userId,
      }),
    });
    assert.equal(revokedCheckout.status, 401);

    const revokedPayout = await request("/money/payout-onboarding", {
      method: "POST",
      session: firstSession,
      body: JSON.stringify({
        idempotencyKey: `${runId}-revoked-payout`,
        userId,
      }),
    });
    assert.equal(revokedPayout.status, 401);

    const secondBootstrap = await request("/stridepool/bootstrap", { session: secondSession });
    assert.equal(secondBootstrap.status, 200);
    const second = secondBootstrap.body as typeof first;
    assert.equal(second.user.id, userId);
    assert.deepEqual(second.profile, first.profile);
    assert.deepEqual(second.wallet, first.wallet);
    assert.equal(second.steps, first.steps);
    assert.deepEqual(second.joinedIds, first.joinedIds);
    assert.equal(second.challenges.find((challenge) => challenge.id === challengeId)?.joined, true);
    assert.deepEqual(second.activities, first.activities);

    const ownLedgerWithBrowserAccountId = await request(`/money/ledger?userId=${otherUserId}`, {
      session: secondSession,
    });
    assert.equal(ownLedgerWithBrowserAccountId.status, 200);
    const ledger = ownLedgerWithBrowserAccountId.body as Array<{ userId: string; amountCents: number }>;
    assert.ok(ledger.length > 0);
    assert.ok(ledger.every((entry) => entry.userId === userId));
    assert.ok(ledger.some((entry) => entry.amountCents === 200));
    assert.ok(!ledger.some((entry) => entry.amountCents === 999));
  });
});