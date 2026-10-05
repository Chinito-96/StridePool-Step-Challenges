import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  challengesTable,
  db,
  dailyStepRecordsTable,
  entriesTable,
  pool,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  initializeWithCleanup,
  launchRequiredChromium,
  stopProcess,
  waitForHttp,
  type CleanupStack,
} from "./stridepool-browser-harness";

const runId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${runId}-user`;
const challengeId = `${runId}-challenge`;
const anonymousChallengeId = `${runId}-anonymous-challenge`;
const today = new Date().toISOString().slice(0, 10);
const displayName = "Reload Walker";
const syncedSteps = 4321;
const wallet = {
  balance: 12.34,
  pending: 5.67,
  totalEarned: 8.9,
};

let apiProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;
let sessionId = "";
let webBaseUrl = "";
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let anonymousContext: BrowserContext | undefined;
let anonymousUserId = "";
let cleanupStack: CleanupStack | undefined;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a test port."));
        return;
      }
      listener.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForText(page: Page, testId: string, expected: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastText: string | null = null;
  while (Date.now() < deadline) {
    lastText = await page.getByTestId(testId).textContent();
    if (lastText === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${testId} to equal "${expected}", got "${lastText}"`);
}

async function cleanupFixtureRows(): Promise<void> {
  await db.transaction(async (tx) => {
    // Discover the identity through our unique challenge too, so cleanup
    // still works if an assertion fails before the cookie is captured.
    const anonymousEntries = await tx.select({ userId: entriesTable.userId })
      .from(entriesTable).where(eq(entriesTable.challengeId, anonymousChallengeId));
    const ownedAnonymousIds = new Set(anonymousEntries.map((entry) => entry.userId));
    if (anonymousUserId) ownedAnonymousIds.add(anonymousUserId);
    for (const id of ownedAnonymousIds) {
      assert.match(id, /^anon_[a-f0-9]{32}$/);
      await tx.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, id));
      await tx.delete(entriesTable).where(eq(entriesTable.userId, id));
      await tx.delete(usersTable).where(eq(usersTable.id, id));
    }
    await tx.delete(challengesTable).where(eq(challengesTable.id, anonymousChallengeId));
    await tx.delete(sessionsTable).where(eq(sessionsTable.sid, sessionId));
    await tx.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, userId));
    await tx.delete(entriesTable).where(eq(entriesTable.userId, userId));
    await tx.delete(challengesTable).where(eq(challengesTable.id, challengeId));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
  });
}

describe("StridePool browser persistence", () => {
  before(async () => {
    const executablePath = process.env.CHROMIUM_PATH
      ?? (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);
    const initialized = await initializeWithCleanup(async (cleanup) => {
      // Register shared-state cleanup before creating any fixtures so partial
      // setup failures still remove every row and release the DB connection.
      cleanup.defer(() => pool.end());
      cleanup.defer(cleanupFixtureRows);

      browser = await launchRequiredChromium(() => chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      }));
      cleanup.defer(async () => {
        try {
          // Capture even a failed join's new identity before closing its browser.
          if (anonymousContext && !anonymousUserId) {
            anonymousUserId = (await anonymousContext.cookies())
              .find((cookie) => cookie.name === "stridepool_anon")?.value ?? "";
          }
        } finally {
          try {
            await context?.close();
          } finally {
            try {
              await anonymousContext?.close();
            } finally {
              await browser?.close();
            }
          }
        }
      });

      const apiPort = await getFreePort();
      const webPort = await getFreePort();

      await db.insert(usersTable).values({
        id: userId,
        email: `${userId}@example.test`,
        firstName: "Browser",
        lastName: "Walker",
        displayName: "Initial Walker",
        walletBalance: wallet.balance.toFixed(2),
        walletPending: wallet.pending.toFixed(2),
        totalEarned: wallet.totalEarned.toFixed(2),
        goalBaseline: "8000",
      });
      await db.insert(challengesTable).values({
        id: challengeId,
        name: "Browser Reload Check",
        theme: "A unique browser persistence challenge",
        level: "Open",
        startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        days: 5,
        dailyGoal: 8000,
        entryFee: "0.00",
        prizePool: "0.00",
        participantCount: 0,
        finishers: 0,
        settlementStatus: "open",
        color: "#7f9f56",
        challengeType: "goal",
        goalType: "fixed",
        community: true,
      });
      await db.insert(dailyStepRecordsTable).values({
        userId,
        challengeId: null,
        recordDate: new Date().toISOString().slice(0, 10),
        steps: syncedSteps,
        source: "apple_health",
        verified: true,
      });
      await db.insert(challengesTable).values({
        id: anonymousChallengeId,
        name: "Anonymous Reload Check",
        theme: "An isolated anonymous community persistence challenge",
        level: "Open",
        startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        days: 5,
        dailyGoal: 8000,
        entryFee: "0.00",
        prizePool: "0.00",
        participantCount: 0,
        finishers: 0,
        settlementStatus: "open",
        color: "#7f9f56",
        challengeType: "goal",
        goalType: "fixed",
        community: true,
      });

      sessionId = crypto.randomBytes(32).toString("hex");
      await db.insert(sessionsTable).values({
        sid: sessionId,
        sess: {
          user: {
            id: userId,
            email: `${userId}@example.test`,
            firstName: "Browser",
            lastName: "Walker",
            profileImageUrl: null,
          },
          access_token: "browser-test-access-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
        expire: new Date(Date.now() + 3600000),
      });

      const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
      apiProcess = spawn(
        "pnpm",
        ["exec", "tsx", "../artifacts/api-server/src/browser-test-server.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, PORT: String(apiPort), NODE_ENV: "test" },
          stdio: "inherit",
          detached: process.platform !== "win32",
        },
      );
      cleanup.defer(() => stopProcess(apiProcess));
      await waitForHttp(`${apiBaseUrl}/api/healthz`, apiProcess);

      webProcess = spawn(
        "pnpm",
        ["--filter", "@workspace/stridepool", "run", "dev"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PORT: String(webPort),
            BASE_PATH: "/",
            API_PROXY_TARGET: apiBaseUrl,
            NODE_ENV: "test",
          },
          stdio: "inherit",
          detached: process.platform !== "win32",
        },
      );
      cleanup.defer(() => stopProcess(webProcess));
      webBaseUrl = `http://127.0.0.1:${webPort}`;
      await waitForHttp(webBaseUrl, webProcess);
      context = await browser!.newContext();
      await context.addCookies([{
        name: "sid",
        value: sessionId,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
      }]);
    });
    cleanupStack = initialized.cleanup;
  });

  after(async () => {
    await cleanupStack?.close();
  });

  it("keeps profile, membership, wallet, steps, and history after a full reload", async () => {
    assert.ok(context);
    const page = await context.newPage();

    await page.goto(`${webBaseUrl}/profile`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Profile & settings" }).waitFor();
    await page.getByTestId("button-edit-profile").click();
    await page.getByTestId("input-profile-name").fill(displayName);
    const profileResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/stridepool/profile") && response.status() === 200,
    );
    await page.getByTestId("button-save-profile").click();
    await profileResponse;

    await page.goto(`${webBaseUrl}/community`, { waitUntil: "domcontentloaded" });
    const challengeCard = page.getByTestId(`card-community-${challengeId}`);
    await challengeCard.waitFor();
    await challengeCard.getByTestId(`button-community-join-${challengeId}`).click();
    await page.getByTestId(`button-open-join-${challengeId}`).waitFor();
    await page.getByTestId(`button-open-join-${challengeId}`).click();
    await page.getByTestId("button-confirm-join").waitFor();
    const joinResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/stridepool/challenges/${challengeId}/join`) && response.status() === 200,
    );
    await page.getByTestId("button-confirm-join").click();
    await joinResponse;

    await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
    await waitForText(page, "text-todays-steps", syncedSteps.toLocaleString());

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForText(page, "text-todays-steps", syncedSteps.toLocaleString());
    await page.goto(`${webBaseUrl}/challenge/${challengeId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("You are in this pool", { exact: true }).waitFor();
    await page.getByTestId("link-header-profile").click();
    await page.getByRole("heading", { name: displayName, exact: true }).waitFor();

    await page.goto(`${webBaseUrl}/wallet`, { waitUntil: "domcontentloaded" });
    await waitForText(page, "text-wallet-balance", "$12.34");
    await page.getByText("$5.67", { exact: true }).waitFor();
    await page.getByText("$8.90", { exact: true }).waitFor();

    await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
    await page.getByText(`You joined Browser Reload Check`, { exact: true }).waitFor();
    await page.getByText(`${syncedSteps.toLocaleString()} steps today · persisted to your account`, { exact: true }).waitFor();
  });

  it("keeps an anonymous free join and updated community progress after reload", async () => {
    assert.ok(browser);
    // A fresh context must not inherit the authenticated test's sid or storage.
    anonymousContext = await browser.newContext();
    const page = await anonymousContext.newPage();
    await page.goto(`${webBaseUrl}/community`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(`button-community-join-${anonymousChallengeId}`).click();
    await page.getByTestId(`button-open-join-${anonymousChallengeId}`).click();
    const joinResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/stridepool/challenges/${anonymousChallengeId}/join`)
      && response.request().method() === "POST",
    );
    await page.getByTestId("button-confirm-join").click();
    const response = await joinResponse;
    const cookies = await anonymousContext.cookies();
    const identity = cookies.find((cookie) => cookie.name === "stridepool_anon");
    assert.ok(identity, "The free join must create a browser identity.");
    anonymousUserId = identity.value;
    assert.equal(response.status(), 200, await response.text());
    await page.getByText("You are in this pool", { exact: true }).waitFor();
    assert.match(anonymousUserId, /^anon_[a-f0-9]{32}$/);
    assert.equal(identity.httpOnly, true);
    assert.ok(!cookies.some((cookie) => cookie.name === "sid"));

    const readBootstrap = async () => {
      const response = await anonymousContext!.request.get(`${webBaseUrl}/api/stridepool/bootstrap`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const beforeReload = await readBootstrap();
    assert.equal(beforeReload.user, null);
    assert.ok(beforeReload.joinedIds.includes(anonymousChallengeId));

    // Native uploads and personal history intentionally require an account.
    // Apply a verified source update to this fixture's challenge record instead
    // of weakening that boundary or mocking the browser's API responses.
    const deniedUpload = await anonymousContext.request.post(
      `${webBaseUrl}/api/stridepool/sources/apple_health/samples`,
      { data: { samples: [] } },
    );
    assert.equal(deniedUpload.status(), 401);
    // Registration closes at the start date. Move only our challenge into its
    // active window after joining, without changing the server clock or jobs.
    await db.update(challengesTable).set({
      startDate: today,
      endDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    }).where(eq(challengesTable.id, anonymousChallengeId));
    const [record] = await db.insert(dailyStepRecordsTable).values({
      userId: anonymousUserId,
      challengeId: anonymousChallengeId,
      recordDate: today,
      steps: 1000,
      source: "apple_health",
      verified: true,
    }).returning({ id: dailyStepRecordsTable.id });
    assert.ok(record);
    await page.reload({ waitUntil: "domcontentloaded" });
    const leaderboard = page.getByTestId("panel-community-leaderboard");
    await leaderboard.getByText("1,000", { exact: true }).waitFor();
    await db.update(dailyStepRecordsTable).set({ steps: 8765 })
      .where(eq(dailyStepRecordsTable.id, record.id));

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("You are in this pool", { exact: true }).waitFor();
    await leaderboard.getByText("8,765", { exact: true }).waitFor();
    await leaderboard.getByText("1/5 days", { exact: true }).waitFor();
    const afterReload = await readBootstrap();
    assert.equal(afterReload.user, null);
    assert.ok(afterReload.joinedIds.includes(anonymousChallengeId));
    assert.deepEqual(afterReload.activities, []);
    const reloadedCookies = await anonymousContext.cookies();
    assert.equal(reloadedCookies.find((cookie) => cookie.name === "stridepool_anon")?.value, anonymousUserId);
    assert.ok(!reloadedCookies.some((cookie) => cookie.name === "sid"));
    const savedRecords = await db.select().from(dailyStepRecordsTable)
      .where(eq(dailyStepRecordsTable.userId, anonymousUserId));
    assert.equal(savedRecords.length, 1);
    assert.equal(savedRecords[0].steps, 8765);
    const savedEntries = await db.select().from(entriesTable)
      .where(eq(entriesTable.userId, anonymousUserId));
    assert.equal(savedEntries.length, 1, "Reload must not create another membership.");
    assert.equal(savedEntries[0].challengeId, anonymousChallengeId);
  });
});