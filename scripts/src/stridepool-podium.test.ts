import assert from "node:assert/strict";
import test from "node:test";
import { calculatePodiumPayouts } from "@workspace/db";

test("splits a ranking pool 50/30/20", () => {
  assert.deepEqual(calculatePodiumPayouts([
    { entryId: 1, steps: 300 },
    { entryId: 2, steps: 200 },
    { entryId: 3, steps: 100 },
  ], 10000), [
    { entryId: 1, rank: 1, payoutCents: 5000 },
    { entryId: 2, rank: 2, payoutCents: 3000 },
    { entryId: 3, rank: 3, payoutCents: 2000 },
  ]);
});

test("tied contestants split the occupied podium shares", () => {
  assert.deepEqual(calculatePodiumPayouts([
    { entryId: 1, steps: 300 },
    { entryId: 2, steps: 300 },
    { entryId: 3, steps: 100 },
  ], 10000), [
    { entryId: 1, rank: 1, payoutCents: 4000 },
    { entryId: 2, rank: 1, payoutCents: 4000 },
    { entryId: 3, rank: 3, payoutCents: 2000 },
  ]);
});

test("available places receive the entire pool", () => {
  assert.deepEqual(calculatePodiumPayouts([{ entryId: 1, steps: 100 }], 10000), [
    { entryId: 1, rank: 1, payoutCents: 10000 },
  ]);
});