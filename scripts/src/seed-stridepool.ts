import { db, entriesTable, challengesTable, dailyStepRecordsTable, pool, usersTable, stridePoolChallengeSeeds } from "@workspace/db";

async function seed() {
  await db.delete(usersTable);
  await db.delete(challengesTable);
  await db.insert(challengesTable).values(stridePoolChallengeSeeds.map((seed) => ({ ...seed })));
  await db.insert(usersTable).values([
    {
      id: "demo-user",
      email: "demo@stridepool.local",
      firstName: "Alex",
      lastName: "Morgan",
      displayName: "Alex Morgan",
      walletBalance: "42.50",
      walletPending: "18.00",
      totalEarned: "156.75",
      goalBaseline: "7500",
    },
    {
      id: "demo-finished",
      email: "finished@stridepool.local",
      firstName: "Jordan",
      lastName: "Lee",
      displayName: "Jordan Lee",
      goalBaseline: "8000",
    },
    {
      id: "demo-eliminated",
      email: "eliminated@stridepool.local",
      firstName: "Taylor",
      lastName: "Reed",
      displayName: "Taylor Reed",
      goalBaseline: "8000",
    },
  ]);
  await db.insert(entriesTable).values([
    { userId: "demo-user", challengeId: "sunrise-steps", entryFee: "8.00", status: "active" },
    { userId: "demo-user", challengeId: "streak-or-step-out", entryFee: "0.00", status: "active" },
    { userId: "demo-finished", challengeId: "park-loop-social", entryFee: "0.00", status: "active" },
    { userId: "demo-eliminated", challengeId: "streak-or-step-out", entryFee: "0.00", status: "active" },
  ]);
  await db.insert(dailyStepRecordsTable).values([
    { userId: "demo-user", recordDate: new Date().toISOString().slice(0, 10), steps: 7284, source: "demo-verified", verified: true },
    { userId: "demo-user", challengeId: "streak-or-step-out", recordDate: "2026-09-02", steps: 8420, source: "demo-verified", verified: true },
    { userId: "demo-finished", challengeId: "park-loop-social", recordDate: "2026-07-02", steps: 8200, source: "demo-verified", verified: true },
    { userId: "demo-finished", challengeId: "park-loop-social", recordDate: "2026-07-03", steps: 7900, source: "demo-verified", verified: true },
    { userId: "demo-finished", challengeId: "park-loop-social", recordDate: "2026-07-04", steps: 9100, source: "demo-verified", verified: true },
    { userId: "demo-finished", challengeId: "park-loop-social", recordDate: "2026-07-05", steps: 7600, source: "demo-verified", verified: true },
    { userId: "demo-finished", challengeId: "park-loop-social", recordDate: "2026-07-06", steps: 8400, source: "demo-verified", verified: true },
  ]);
}

seed()
  .then(async () => {
    console.log("StridePool sample data seeded.");
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });