export type NotificationType = "daily_reminder" | "eliminated" | "group_member_joined" | "challenge_finished";

export type NotificationCandidate = {
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
};

export function buildParticipantNotificationCandidates(input: {
  userId: string;
  challengeId: string;
  challengeName: string;
  challengeType: "goal" | "elimination";
  startDate: string;
  endDate: string;
  today: string;
  missedDays: number;
  graceDays: number;
  status: "on_track" | "eliminated" | "finished";
  todayHasVerifiedRecord: boolean;
}): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];
  if (input.status === "eliminated") {
    candidates.push({
      type: "eliminated",
      title: `You were eliminated from ${input.challengeName}`,
      body: `Your missed days exceeded the ${input.graceDays}-day grace allowance. Review your source history if something arrived late.`,
      dedupeKey: `eliminated:${input.challengeId}:${input.userId}`,
    });
  }
  if (input.today > input.endDate) {
    candidates.push({
      type: "challenge_finished",
      title: `${input.challengeName} has finished`,
      body: "The challenge window is closed. Your final status is available in the community leaderboard.",
      dedupeKey: `finished:${input.challengeId}:${input.userId}`,
    });
  }
  const isActiveToday = input.today >= input.startDate && input.today <= input.endDate;
  const isAtRisk = input.missedDays + 1 > input.graceDays;
  if (isActiveToday && !input.todayHasVerifiedRecord && isAtRisk) {
    candidates.push({
      type: "daily_reminder",
      title: `Today could change your ${input.challengeName} status`,
      body: input.challengeType === "elimination"
        ? "You have used your grace allowance. Sync today's steps before the day closes to stay in the group."
        : "You are at the edge of your grace allowance. Sync today's steps so your finish stays on track.",
      dedupeKey: `daily-reminder:${input.challengeId}:${input.userId}:${input.today}`,
    });
  }
  return candidates;
}

export function buildGroupMemberJoinedCandidate(input: {
  challengeId: string;
  challengeName: string;
  actorUserId: string;
  recipientUserId: string;
  actorName: string;
}): NotificationCandidate {
  return {
    type: "group_member_joined",
    title: `${input.actorName} joined ${input.challengeName}`,
    body: "Your group has a new walker. Keep the shared rhythm going.",
    dedupeKey: `group-member-joined:${input.challengeId}:${input.actorUserId}:${input.recipientUserId}`,
  };
}