import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { CreateStridePoolChallengeBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import app from "../app";

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

for (const body of [
  {},
  { groupName: "Legacy circle", memberUserIds: ["walker"], name: "Free challenge", theme: "Walking", startDate: "2026-10-05", endDate: "2026-10-11", dailyGoal: 7500, challengeType: "goal", goalType: "fixed", color: "#7f9f56" },
]) {
  test(`the legacy free creation endpoint rejects ${Object.keys(body).length ? "a complete request" : "an empty request"} without writing records`, async () => {
    const response = await fetch(`${baseUrl}/stridepool/groups/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Free challenge creation is no longer available." });
  });
}

test("paid challenge creation cannot accept a zero entry fee", () => {
  const input = { name: "Walking", theme: "Daily steps", startDate: "2026-10-05", endDate: "2026-10-11", days: 7, dailyGoal: 7500, challengeType: "goal", color: "#7f9f56", entryFee: 1 };
  assert.equal(CreateStridePoolChallengeBody.safeParse(input).success, true);
  assert.equal(CreateStridePoolChallengeBody.safeParse({ ...input, entryFee: 0 }).success, false);
});
