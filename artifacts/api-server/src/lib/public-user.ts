type PublicUserFields = {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
};

/** Social responses deliberately contain no email or private account fields. */
export function publicUser(user: PublicUserFields) {
  return {
    id: user.id,
    displayName: user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "StridePool walker",
  };
}