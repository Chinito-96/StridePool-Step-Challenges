import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  challengeChatMessagesTable,
  challengesTable,
  db,
  entriesTable,
  pool,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession } from "../lib/auth";

const runId = `challenge-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const participantId = `${runId}-participant`;
const secondParticipantId = `${runId}-second`;
const anonymousId = `anon_${"a".repeat(32)}`;
const outsiderId = `${runId}-outsider`;
const activeChallengeId = `${runId}-active`;
const futureChallengeId = `${runId}-future`;
const communityChallengeId = `${runId}-community`;

type ApiResult = { status: number; body: unknown };

let server: Server | undefined;
let baseUrl = "";
let participantSession = "";
let secondSession = "";
let outsiderSession = "";

async function request(
  path: string,
  options: RequestInit & { session?: string; walkerCookie?: string } = {},
): Promise<ApiResult> {
  const { session, walkerCookie, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  const cookie = [
    session ? `sid=${session}` : "",
    walkerCookie ? `stridepool_anon=${walkerCookie}` : "",
  ].filter(Boolean).join("; ");
  if (cookie) requestHeaders.set("cookie", cookie);
  if (init.body && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  const response = await fetch(`${baseUrl}/api${path}`, { ...init, headers: requestHeaders });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function testSession(id: string, email: string) {
  return createSession({
    user: { id, email, firstName: "Chat", lastName: "Participant", profileImageUrl: null },
    access_token: "chat-test-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}

const utcDate = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

describe("StridePool challenge chat access", () => {
  before(async () => {
    await db.insert(usersTable).values([
      { id: participantId, email: `${participantId}@example.test`, displayName: "First Walker" },
      { id: secondParticipantId, email: `${secondParticipantId}@example.test`, displayName: "Second Walker" },
      { id: anonymousId, displayName: "Anonymous walker" },
      { id: outsiderId, email: `${outsiderId}@example.test`, displayName: "Outside Walker" },
    ]);
    const today = utcDate(0);
    const tomorrow = utcDate(1);
    await db.insert(challengesTable).values([
      {
        id: activeChallengeId,
        name: "Chat Today",
        theme: "Support",
        level: "Open",
        startDate: today,
        endDate: today,
        days: 1,
        dailyGoal: 5000,
        entryFee: "5.00",
        color: "#174833",
        challengeType: "goal",
        goalType: "fixed",
        community: false,
      },
      {
        id: futureChallengeId,
        name: "Chat Tomorrow",
        theme: "Support",
        level: "Open",
        startDate: tomorrow,
        endDate: tomorrow,
        days: 1,
        dailyGoal: 5000,
        entryFee: "5.00",
        color: "#174833",
        challengeType: "goal",
        goalType: "fixed",
        community: false,
      },
      {
        id: communityChallengeId,
        name: "Free Anonymous Chat",
        theme: "Support",
        level: "Open",
        startDate: today,
        endDate: today,
        days: 1,
        dailyGoal: 5000,
        entryFee: "0.00",
        color: "#174833",
        challengeType: "goal",
        goalType: "fixed",
        community: true,
      },
    ]);
    await db.insert(entriesTable).values([
      { userId: participantId, challengeId: activeChallengeId, status: "active", entryFee: "5.00" },
      { userId: secondParticipantId, challengeId: activeChallengeId, status: "active", entryFee: "5.00" },
      { userId: outsiderId, challengeId: futureChallengeId, status: "active", entryFee: "5.00" },
      { userId: anonymousId, challengeId: communityChallengeId, status: "active", entryFee: "0.00" },
    ]);
    participantSession = await testSession(participantId, `${participantId}@example.test`);
    secondSession = await testSession(secondParticipantId, `${secondParticipantId}@example.test`);
    outsiderSession = await testSession(outsiderId, `${outsiderId}@example.test`);

    const listeningServer = app.listen(0);
    server = listeningServer;
    await new Promise<void>((resolve, reject) => {
      listeningServer.once("listening", resolve);
      listeningServer.once("error", reject);
    });
    const address = listeningServer.address();
    if (!address || typeof address === "string") throw new Error("The test API did not expose a TCP address.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    await db.delete(sessionsTable).where(inArray(sessionsTable.sid, [participantSession, secondSession, outsiderSession]));
    await db.delete(challengeChatMessagesTable).where(inArray(challengeChatMessagesTable.challengeId, [activeChallengeId, futureChallengeId, communityChallengeId]));
    await db.delete(entriesTable).where(inArray(entriesTable.challengeId, [activeChallengeId, futureChallengeId, communityChallengeId]));
    await db.delete(challengesTable).where(inArray(challengesTable.id, [activeChallengeId, futureChallengeId, communityChallengeId]));
    await db.delete(usersTable).where(inArray(usersTable.id, [participantId, secondParticipantId, anonymousId, outsiderId]));
    await pool.end();
  });

  it("allows active participants to send and read plain-text messages", async () => {
    const posted = await request(`/stridepool/challenges/${activeChallengeId}/chat`, {
      method: "POST",
      session: participantSession,
      body: JSON.stringify({ content: "  <b>Keep going!</b>  " }),
    });
    assert.equal(posted.status, 201);
    assert.equal((posted.body as { content: string }).content, "<b>Keep going!</b>");
    assert.equal((posted.body as { isMine: boolean }).isMine, true);

    const readByOther = await request(`/stridepool/challenges/${activeChallengeId}/chat`, { session: secondSession });
    assert.equal(readByOther.status, 200);
    const messages = (readByOther.body as { messages: Array<{ authorName: string; content: string; isMine: boolean }> }).messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.authorName, "First Walker");
    assert.equal(messages[0]?.content, "<b>Keep going!</b>");
    assert.equal(messages[0]?.isMine, false);

    const blank = await request(`/stridepool/challenges/${activeChallengeId}/chat`, {
      method: "POST",
      session: participantSession,
      body: JSON.stringify({ content: "   " }),
    });
    assert.equal(blank.status, 400);
  });

  it("denies reads and sends to nonparticipants, inactive entries, and out-of-window participants", async () => {
    const read = await request(`/stridepool/challenges/${activeChallengeId}/chat`, { session: outsiderSession });
    assert.equal(read.status, 403);
    const send = await request(`/stridepool/challenges/${activeChallengeId}/chat`, {
      method: "POST",
      session: outsiderSession,
      body: JSON.stringify({ content: "Not enrolled" }),
    });
    assert.equal(send.status, 403);

    const futureRead = await request(`/stridepool/challenges/${futureChallengeId}/chat`, { session: outsiderSession });
    assert.equal(futureRead.status, 403);
    const futureSend = await request(`/stridepool/challenges/${futureChallengeId}/chat`, {
      method: "POST",
      session: outsiderSession,
      body: JSON.stringify({ content: "Too early" }),
    });
    assert.equal(futureSend.status, 403);

    await db.update(entriesTable).set({ status: "left" }).where(and(
      eq(entriesTable.userId, participantId),
      eq(entriesTable.challengeId, activeChallengeId),
    ));
    const leftRead = await request(`/stridepool/challenges/${activeChallengeId}/chat`, { session: participantSession });
    assert.equal(leftRead.status, 403);
    const leftSend = await request(`/stridepool/challenges/${activeChallengeId}/chat`, {
      method: "POST",
      session: participantSession,
      body: JSON.stringify({ content: "I left" }),
    });
    assert.equal(leftSend.status, 403);
  });

  it("supports anonymous identities only for active free community participants", async () => {
    const cookieRead = await request(`/stridepool/challenges/${communityChallengeId}/chat`, { walkerCookie: anonymousId });
    assert.equal(cookieRead.status, 200);

    const anonymousPaidChallenge = await request(`/stridepool/challenges/${activeChallengeId}/chat`, { walkerCookie: anonymousId });
    assert.equal(anonymousPaidChallenge.status, 403);
  });
});
