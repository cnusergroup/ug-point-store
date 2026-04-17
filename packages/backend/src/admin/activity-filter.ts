/**
 * Pure activity filtering logic extracted from the frontend batch-points page.
 * Filters activities by active UG membership and optional search query.
 */

export interface ActivityItem {
  activityId: string;
  activityType: '线上活动' | '线下活动';
  ugName: string;
  topic: string;
  activityDate: string;
  syncedAt: string;
  sourceUrl: string;
}

/**
 * Filter activities by active UG names and an optional search query.
 *
 * 1. Only activities whose ugName is in the activeUGNames set are included.
 * 2. If searchQuery is non-empty (after trimming), only activities where
 *    ugName, topic, or activityDate contains the query (case-insensitive)
 *    are included.
 *
 * @param activities - The full list of activities
 * @param activeUGNames - Set of UG names that are currently active
 * @param searchQuery - Optional search string
 * @returns Filtered activities
 */
export function filterActivities(
  activities: ActivityItem[],
  activeUGNames: Set<string>,
  searchQuery: string,
): ActivityItem[] {
  let result = activities.filter((a) => activeUGNames.has(a.ugName));

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    result = result.filter(
      (a) =>
        a.ugName.toLowerCase().includes(q) ||
        a.topic.toLowerCase().includes(q) ||
        a.activityDate.includes(q),
    );
  }

  return result;
}
