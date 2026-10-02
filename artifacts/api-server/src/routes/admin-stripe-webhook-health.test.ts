import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { GetAdminStripeWebhookHealthResponse } from "@workspace/api-zod";
import { db, pool, sessionsTable, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app";
import { createSession } from "../lib/auth";
import { getComplianceStatus } from "../services/ledger";

const prefix = `webhook-health-${crypto.randomUUID()}`;
const ids = [`${prefix}-user`, `${prefix}-admin`];
let server: Server;
let baseUrl: string;
const sessions: string[] = [];

before(async () => {
  await db.insert(usersTable).values(ids.map((id, index) => ({
    id, email: `${id}@example.test`, role: index === 1 ? "admin" : "user",
  })));
  for (const id of ids) {
    sessions.push(await createSession({
      user: { id, email: `${id}@example.test`, firstName: null, lastName: null, profileImageUrl: null },
      access_token: "test-only",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }));
  }
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api/admin/stripe-webhook-health`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (sessions.length) await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sessions));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
  await pool.end();
});

test("webhook health is not exposed to anonymous or ordinary users", async () => {
  const anonymous = await fetch(baseUrl);
  assert.equal(anonymous.status, 401);
  const ordinary = await fetch(baseUrl, { headers: { cookie: `sid=${sessions[0]}` } });
  assert.equal(ordinary.status, 403);
});

test("support review returns health evidence without changing launch controls", async () => {
  const before = getComplianceStatus();
  const response = await fetch(baseUrl, { headers: { cookie: `sid=${sessions[1]}` } });
  assert.equal(response.status, 200);
  const report = GetAdminStripeWebhookHealthResponse.parse(await response.json());
  assert.ok(report.checkedAt);
  assert.equal(Object.hasOwn(report, "secret"), false);
  assert.deepEqual(getComplianceStatus(), before);
});