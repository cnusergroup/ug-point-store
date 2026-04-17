export interface AdminUser {
  userId: string;
  nickname: string;
  email: string;
}

/**
 * Filter Admin users by search query.
 * Matches on nickname or email (case-insensitive).
 * Returns all users when query is empty or whitespace-only.
 */
export function filterAdminUsers(users: AdminUser[], query: string): AdminUser[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return users;
  return users.filter(
    (u) =>
      u.nickname.toLowerCase().includes(keyword) ||
      u.email.toLowerCase().includes(keyword),
  );
}
