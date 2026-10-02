import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupMemberJoinedCandidate, buildParticipantNotificationCandidates } from "./stridepool-notifications";

const base = {
  userId: "user-1",
  challengeId: "challenge-1",
  challengeName: "Seven steady days",
  challengeType: "elimination" as const,
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  today: "2026-09-03",
  missedDays: 1,
  status: "on_track" as const,
};

test("daily reminder is created when today's verified record is absent", () => {
  const candidates = buildParticipantNotificationCandidates({ ...base, todayHasVerifiedRecord: false });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.type, "daily_reminder");
  assert.equal(candidates[0]?.dedupeKey, "daily-reminder:challenge-1:user-1:2026-09-03");
  assert.match(candidates[0]?.body ?? "", /daily goal/);
  assert.deepEqual(buildParticipantNotificationCandidates({ ...base, todayHasVerifiedRecord: true }), []);
});

test("daily reminder dedupe key stays stable for repeated fetches", () => {
  const first = buildParticipantNotificationCandidates({ ...base, todayHasVerifiedRecord: false });
  const second = buildParticipantNotificationCandidates({ ...base, todayHasVerifiedRecord: false });
  assert.equal(first[0]?.dedupeKey, second[0]?.dedupeKey);
});

test("elimination and completion notices are durable single candidates", () => {
  const eliminated = buildParticipantNotificationCandidates({ ...base, today: "2026-09-03", status: "eliminated", todayHasVerifiedRecord: true });
  assert.equal(eliminated[0]?.type, "eliminated");
  assert.match(eliminated[0]?.body ?? "", /missed a required daily goal/);
  const finished = buildParticipantNotificationCandidates({ ...base, today: "2026-09-08", status: "finished", todayHasVerifiedRecord: true });
  assert.equal(finished.length, 1);
  assert.equal(finished[0]?.type, "challenge_finished");
  assert.equal(finished[0]?.dedupeKey, "finished:challenge-1:user-1");
});

test("group join notice is addressed to the other participant and deduplicates by actor", () => {
  const candidate = buildGroupMemberJoinedCandidate({
    challengeId: "challenge-1",
    challengeName: "Seven steady days",
    actorUserId: "user-2",
    recipientUserId: "user-1",
    actorName: "Taylor",
  });
  assert.equal(candidate.type, "group_member_joined");
  assert.equal(candidate.title, "Taylor joined Seven steady days");
  assert.equal(candidate.dedupeKey, "group-member-joined:challenge-1:user-2:user-1");
});