import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { db, dailyStepRecordsTable, pool, sessionsTable, usersTable, walletLedgerEntriesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const runId = `auth-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${runId}-user`;
const issuer = "https://identity-provider.invalid/";
const providerOrigin = new URL(issuer).origin;
const providerRefreshRequests: string[] = [];
const providerRequests: string[] = [];
const sessionIds: string[] = [];

type ApiResult = {
  status: number;
  body: unknown;
};

let server: Server | undefined;
let baseUrl = "";
let originalFetch: typeof fetch;
let previousIssuer: string | undefined;
let previousReplId: string | undefined;
let createSession: typeof import("../lib/auth").createSession;

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

  const response = await originalFetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: requestHeaders,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function createExpiredSession(refreshToken: string): Promise<string> {
  const sid = await createSession({
    user: {
      id: userId,
      email: `${userId}@example.test`,
      firstName: "Renewal",
      lastName: "Test",
      profileImageUrl: null,
    },
    access_token: "expired-access-token",
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) - 60,
  });
  sessionIds.push(sid);
  return sid;
}

describe("expired sign-in renewal", () => {
  before(async () => {
    previousIssuer = process.env.ISSUER_URL;
    previousReplId = process.env.REPL_ID;
    process.env.ISSUER_URL = issuer;
    process.env.REPL_ID = "stridepool-auth-refresh-test";

    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.origin !== providerOrigin) return originalFetch(input, init);
      providerRequests.push(`${init?.method ?? "GET"} ${url.pathname}`);

      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer,
          authorization_endpoint: `${providerOrigin}/authorize`,
          token_endpoint: `${providerOrigin}/token`,
          jwks_uri: `${providerOrigin}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }

      if (url.pathname === "/token") {
        const body = init?.body instanceof URLSearchParams
          ? init.body
          : new URLSearchParams(typeof init?.body === "string" ? init.body : "");
        const refreshToken = body.get("refresh_token") ?? "";
        providerRefreshRequests.push(refreshToken);
        if (refreshToken === "provider-rejects-refresh") {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        if (refreshToken !== "valid-refresh-token") {
          return Response.json({ error: "unexpected_refresh_token" }, { status: 400 });
        }
        return Response.json({
          access_token: "replacement-access-token",
          refresh_token: "replacement-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }

      return new Response("Unexpected identity-provider request", { status: 404 });
    };

    const auth = await import("../lib/auth");
    createSession = auth.createSession;
    const { default: app } = await import("../app");

    await db.insert(usersTable).values({
      id: userId,
      email: `${userId}@example.test`,
      firstName: "Saved",
      lastName: "Walker",
      displayName: "Renewed Account",
      walletBalance: "64.25",
      walletPending: "5.50",
      totalEarned: "20.00",
    });
    await db.insert(dailyStepRecordsTable).values({
      userId,
      challengeId: null,
      recordDate: new Date().toISOString().slice(0, 10),
      steps: 6123,
      source: "auth-refresh-test",
      verified: true,
    });
    await db.insert(walletLedgerEntriesTable).values({
      id: `${runId}-ledger`,
      userId,
      eventType: "renewal_test_credit",
      status: "recorded",
      amountCents: 1250,
      currency: "usd",
      providerEventId: null,
      idempotencyKey: `${runId}-ledger-key`,
      challengeId: null,
      metadata: { test: true },
    });

    const listeningServer = app.listen(0);
    server = listeningServer;
    await new Promise<void>((resolve, reject) => {
      listeningServer.once("listening", resolve);
      listeningServer.once("error", reject);
    });
    const address = listeningServer.address();
    if (!address || typeof address === "string") {
      throw new Error("The auth renewal test server did not expose a TCP address.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessionIds));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
    if (originalFetch) globalThis.fetch = originalFetch;
    if (previousIssuer === undefined) delete process.env.ISSUER_URL;
    else process.env.ISSUER_URL = previousIssuer;
    if (previousReplId === undefined) delete process.env.REPL_ID;
    else process.env.REPL_ID = previousReplId;
  });

  it("renews an expired session, persists rotated tokens, and preserves account and money access", async () => {
    const sid = await createExpiredSession("valid-refresh-token");
    const bootstrapResponse = await request("/stridepool/bootstrap", { session: sid });
    assert.equal(bootstrapResponse.status, 200);

    const bootstrap = bootstrapResponse.body as {
      user: { id: string } | null;
      profile: { displayName: string };
      steps: number;
      wallet: { balance: number; pending: number; totalEarned: number };
    };
    assert.equal(bootstrap.user?.id, userId);
    assert.equal(bootstrap.profile.displayName, "Renewed Account");
    assert.equal(bootstrap.steps, 6123);
    assert.deepEqual(bootstrap.wallet, { balance: 64.25, pending: 5.5, totalEarned: 20 });

    const ledgerResponse = await request("/money/ledger", { session: sid });
    assert.equal(ledgerResponse.status, 200);
    assert.ok(
      Array.isArray(ledgerResponse.body)
      && ledgerResponse.body.some((entry: { eventType?: string }) => entry.eventType === "renewal_test_credit"),
      "the renewed account should retain access to its ledger",
    );

    const [stored] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
    assert.ok(stored, "renewed session should remain persisted");
    const sessionData = stored.sess as {
      access_token: string;
      refresh_token?: string;
      expires_at?: number;
    };
    assert.equal(sessionData.access_token, "replacement-access-token");
    assert.equal(sessionData.refresh_token, "replacement-refresh-token");
    assert.ok(Number(sessionData.expires_at) > Math.floor(Date.now() / 1000));
    assert.ok(
      providerRefreshRequests.includes("valid-refresh-token"),
      `provider requests: ${providerRequests.join(", ") || "none"}`,
    );
  });

  it("deletes a session when the provider rejects renewal and exposes no saved progress or money access", async () => {
    const sid = await createExpiredSession("provider-rejects-refresh");
    const bootstrapResponse = await request("/stridepool/bootstrap", { session: sid });
    assert.equal(bootstrapResponse.status, 200);

    const bootstrap = bootstrapResponse.body as {
      user: { id: string } | null;
      profile: { displayName: string };
      steps: number;
      joinedIds: string[];
      activities: unknown[];
      wallet: { balance: number; pending: number; totalEarned: number };
    };
    assert.equal(bootstrap.user, null);
    assert.notEqual(bootstrap.profile.displayName, "Renewed Account");
    assert.notEqual(bootstrap.steps, 6123);
    assert.deepEqual(bootstrap.joinedIds, []);
    assert.deepEqual(bootstrap.activities, []);
    assert.deepEqual(bootstrap.wallet, { balance: 0, pending: 0, totalEarned: 0 });

    for (const [path, options] of [
      ["/money/ledger", {}],
      ["/money/checkout", {
        method: "POST",
        body: JSON.stringify({
          challengeId: `${runId}-unused-challenge`,
          amountCents: 500,
          currency: "usd",
          idempotencyKey: `${runId}-checkout`,
          userId,
        }),
      }],
      ["/money/payout-onboarding", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: `${runId}-payout`, userId }),
      }],
    ] as const) {
      const response = await request(path, { ...options, session: sid });
      assert.equal(response.status, 401, path);
    }

    assert.deepEqual(
      await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid)),
      [],
      "rejected renewal should delete the persisted session",
    );
    assert.ok(
      providerRefreshRequests.includes("provider-rejects-refresh"),
      `provider requests: ${providerRequests.join(", ") || "none"}`,
    );
  });
});