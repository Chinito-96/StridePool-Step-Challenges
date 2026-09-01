import { db, entriesTable, challengesTable, dailyStepRecordsTable, pool, usersTable, stridePoolChallengeSeeds } from "@workspace/db";

async function seed() {
  await db.delete(usersTable);
  await db.delete(challengesTable);
  await db.insert(challengesTable).values(stridePoolChallengeSeeds.map((seed) => ({ ...seed })));
  await db.insert(usersTable).values({
    id: "demo-user",
    email: "demo@stridepool.local",
    firstName: "Alex",
    lastName: "Morgan",
    displayName: "Alex Morgan",
    walletBalance: "42.50",
    walletPending: "18.00",
    totalEarned: "156.75",
    goalBaseline: "7500",
  });
  await db.insert(entriesTable).values({
    userId: "demo-user",
    challengeId: "sunrise-steps",
    entryFee: "8.00",
    status: "active",
  });
  await db.insert(dailyStepRecordsTable).values({
    userId: "demo-user",
    recordDate: new Date().toISOString().slice(0, 10),
    steps: 7284,
    source: "demo-verified",
    verified: true,
  });
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