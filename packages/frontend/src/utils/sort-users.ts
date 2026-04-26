/**
 * User item with the fields needed for invite-priority sorting.
 * Compatible with the UserListItem interfaces in batch-points.tsx and batch-adjust.tsx.
 */
export interface SortableUser {
  invitedBy?: string;
  createdAt: string;
}

/**
 * Sort users so that those invited by the current admin appear first,
 * followed by all other users. Within each group, users are sorted
 * by `createdAt` in descending order (newest first).
 *
 * Users without an `invitedBy` field are placed in the "others" group.
 *
 * @param users - The user list to sort (not mutated)
 * @param currentUserId - The current admin's userId
 * @returns A new sorted array
 */
export function sortUsersWithInvitePriority<T extends SortableUser>(
  users: T[],
  currentUserId: string,
): T[] {
  const invited: T[] = [];
  const others: T[] = [];

  for (const user of users) {
    if (user.invitedBy === currentUserId) {
      invited.push(user);
    } else {
      others.push(user);
    }
  }

  const byCreatedAtDesc = (a: SortableUser, b: SortableUser) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '');

  invited.sort(byCreatedAtDesc);
  others.sort(byCreatedAtDesc);

  return [...invited, ...others];
}
