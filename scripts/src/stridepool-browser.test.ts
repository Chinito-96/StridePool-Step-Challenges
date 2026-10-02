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

const runId = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${runId}-user`;
const challengeId = `${runId}-challenge`;
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

async function stopProcess(processHandle: ChildProcess | undefined): Promise<void> {
  if (!processHandle || processHandle.exitCode !== null) return;
  const sendSignal = (signal: NodeJS.Signals) => {
    if (processHandle.pid && process.platform !== "win32") {
      try {
        process.kill(-processHandle.pid, signal);
        return;
      } catch {
        // The process group may already have exited.
      }
    }
    processHandle.kill(signal);
  };
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      sendSignal("SIGKILL");
      resolve();
    }, 5_000);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    sendSignal("SIGTERM");
  });
}

async function waitForHttp(url: string, processHandle: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error(`Test server exited before serving ${url} (code ${processHandle.exitCode}, signal ${processHandle.signalCode}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
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

describe("StridePool browser persistence", () => {
  before(async () => {
    const executablePath = process.env.CHROMIUM_PATH
      ?? (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);
    try {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (cause) {
      throw new Error(
        "Browser persistence validation requires Chromium. Set CHROMIUM_PATH or run pnpm --filter @workspace/scripts exec playwright install --with-deps chromium.",
        { cause },
      );
    }
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
      graceDays: 1,
    });
    await db.insert(dailyStepRecordsTable).values({
      userId,
      challengeId: null,
      recordDate: new Date().toISOString().slice(0, 10),
      steps: syncedSteps,
      source: "apple_health",
      verified: true,
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
    webBaseUrl = `http://127.0.0.1:${webPort}`;
    await waitForHttp(webBaseUrl, webProcess);
    context = await browser.newContext();
    await context.addCookies([{
      name: "sid",
      value: sessionId,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
    }]);
  });

  after(async () => {
    try {
      try {
        await context?.close();
      } finally {
        await browser?.close();
      }
    } finally {
      await Promise.all([stopProcess(apiProcess), stopProcess(webProcess)]);
      try {
        await db.transaction(async (tx) => {
          await tx.delete(sessionsTable).where(eq(sessionsTable.sid, sessionId));
          await tx.delete(dailyStepRecordsTable).where(eq(dailyStepRecordsTable.userId, userId));
          await tx.delete(entriesTable).where(eq(entriesTable.userId, userId));
          await tx.delete(challengesTable).where(eq(challengesTable.id, challengeId));
          await tx.delete(usersTable).where(eq(usersTable.id, userId));
        });
      } finally {
        await pool.end();
      }
    }
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
});