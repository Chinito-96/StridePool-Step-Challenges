import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { challengesTable, db, entriesTable, pool, sessionsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession } from "../lib/auth";

const runId = `privacy-${randomUUID()}`;
const actorId = `${runId}-actor`;
const targetId = `${runId}-target`;
const nameToken = `Walker${randomUUID().replaceAll("-", "")}`;
const emailToken = `private${randomUUID().replaceAll("-", "")}`;
const anonymousA = `anon_${randomUUID().replaceAll("-", "")}`;
const anonymousB = `anon_${randomUUID().replaceAll("-", "")}`;
const challengeId = `${runId}-community`;
let server: Server | undefined;
let baseUrl = "";
let session = "";

before(async () => {
  await db.insert(usersTable).values([
    { id: actorId, displayName: "Privacy test actor", email: `${actorId}@example.test` },
    { id: targetId, displayName: nameToken, email: `${emailToken}@example.test`, eligibilityIdentityStatus: "verified" },
    { id: anonymousA, displayName: "Anonymous fixture A", walletBalance: "0.00", walletPending: "0.00", totalEarned: "0.00" },
    { id: anonymousB, displayName: "Anonymous fixture B", walletBalance: "0.00", walletPending: "0.00", totalEarned: "0.00" },
  ]);
  await db.insert(challengesTable).values({
    id: challengeId, name: challengeId, theme: "Isolated membership fixture", level: "Community",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    days: 2, dailyGoal: 1000, color: "green", community: true, entryFee: "0.00",
  });
  await db.insert(entriesTable).values({ userId: anonymousA, challengeId });
  session = await createSession({
    user: { id: actorId, email: null, firstName: null, lastName: null, profileImageUrl: null },
    access_token: "fixture-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  try {
    await db.delete(sessionsTable).where(inArray(sessionsTable.sid, [session]));
    await db.delete(entriesTable).where(eq(entriesTable.challengeId, challengeId));
    await db.delete(challengesTable).where(eq(challengesTable.id, challengeId));
    await db.delete(usersTable).where(inArray(usersTable.id, [actorId, targetId, anonymousA, anonymousB]));
  } finally {
    await pool.end();
  }
});

test("public user search requires authentication", async () => {
  const response = await fetch(`${baseUrl}/stridepool/users/search?q=${nameToken}`);
  assert.equal(response.status, 401);
});

test("name search returns only an ID and display name, never an email", async () => {
  const response = await fetch(`${baseUrl}/stridepool/users/search?q=${nameToken}`, { headers: { cookie: `sid=${session}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { users: [{ id: targetId, displayName: nameToken }] });
});

test("email fragments cannot enumerate people", async () => {
  const response = await fetch(`${baseUrl}/stridepool/users/search?q=${emailToken}`, { headers: { cookie: `sid=${session}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { users: [] });
});

test("a profile update cannot self-verify identity", async () => {
  const response = await fetch(`${baseUrl}/stridepool/profile`, {
    method: "PATCH",
    headers: { cookie: `sid=${session}`, "content-type": "application/json" },
    body: JSON.stringify({ identityStatus: "verified" }),
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.match(body.error, /provider-managed/);
});

test("untrusted origins receive no credentialed CORS grant", async () => {
  const response = await fetch(`${baseUrl}/healthz`, { headers: { origin: "https://evil.example.test" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("community discovery preserves membership in one anonymous browser, never another", async () => {
  for (const [cookie, expectedJoined] of [
    [`stridepool_anon=${anonymousA}`, true],
    [`stridepool_anon=${anonymousB}`, false],
    ["", false],
    ["stridepool_anon=invalid", false],
  ] as const) {
    const response = await fetch(`${baseUrl}/stridepool/community-challenges?q=${challengeId}`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json() as { challenges: Array<{ id: string; joined: boolean }> };
    assert.equal(body.challenges.length, 1);
    assert.equal(body.challenges[0].id, challengeId);
    assert.equal(body.challenges[0].joined, expectedJoined);
  }
});