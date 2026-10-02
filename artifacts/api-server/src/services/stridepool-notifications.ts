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
  status: "on_track" | "eliminated" | "finished";
  todayHasVerifiedRecord: boolean;
}): NotificationCandidate[] {
  const candidates: NotificationCandidate[] = [];
  if (input.status === "eliminated") {
    candidates.push({
      type: "eliminated",
      title: `You were eliminated from ${input.challengeName}`,
      body: "You missed a required daily goal. Review your source history if verified steps arrived late.",
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
  if (isActiveToday && !input.todayHasVerifiedRecord) {
    candidates.push({
      type: "daily_reminder",
      title: `Today could change your ${input.challengeName} status`,
      body: input.challengeType === "elimination"
        ? "Sync today's verified steps to meet the daily goal before the day closes and stay in the group."
        : "Sync today's verified steps before the day closes to meet the daily goal.",
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