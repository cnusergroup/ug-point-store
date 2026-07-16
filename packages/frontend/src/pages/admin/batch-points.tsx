import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { sortUsersWithInvitePriority } from '../../utils/sort-users';
import './batch-points.scss';

/** User list item returned by the admin users API */
interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: 'active' | 'disabled';
  createdAt: string;
  invitedBy?: string;
}

/** Activity record from the admin activities API */
interface ActivityItem {
  activityId: string;
  activityType: '线上活动' | '线下活动';
  ugName: string;
  topic: string;
  activityDate: string;
  syncedAt: string;
  sourceUrl: string;
}

/** UG record for filtering activities by active UGs */
interface UGItem {
  ugId: string;
  name: string;
  status: 'active' | 'inactive';
}

/** Existing skill claim record from the server */
interface ExistingSkillClaim {
  skill: 'liveSupport' | 'posterDesign' | 'articleEditing';
  userId: string;
  userNickname: string;
  claimedAt: string;
  claimedBy: string;
  distributionId: string;
  pointsAwarded: number;
}

/** Points rule config from settings */
interface PointsRuleConfig {
  uglPointsPerEvent: number;
  volunteerPointsPerEvent: number;
  volunteerMaxPerEvent: number;
  speakerTypeAPoints: number;
  speakerTypeBPoints: number;
  speakerRoundtablePoints: number;
  liveSupportPoints?: number;
  posterDesignPoints?: number;
  articleEditingPoints?: number;
}

/** Skill type for UGL skill claims */
type SkillType = 'liveSupport' | 'posterDesign' | 'articleEditing';

/** Skill claim lock from server (existing occupation) */
interface SkillClaimLock {
  skill: SkillType;
  userId: string;
  userNickname: string;
}

/** Target role options for batch distribution */
type TargetRole = 'UserGroupLeader' | 'Speaker' | 'Volunteer';
type SpeakerType = 'typeA' | 'typeB' | 'roundtable';

const ROLE_TABS: { key: TargetRole; labelKey: string; className: string }[] = [
  { key: 'UserGroupLeader', labelKey: 'batchPoints.page.roleLeader', className: 'role-badge--leader' },
  { key: 'Speaker', labelKey: 'batchPoints.page.roleSpeaker', className: 'role-badge--speaker' },
  { key: 'Volunteer', labelKey: 'batchPoints.page.roleVolunteer', className: 'role-badge--volunteer' },
];

const SPEAKER_TYPES: { key: SpeakerType; labelKey: string }[] = [
  { key: 'typeA', labelKey: 'batchPoints.page.speakerTypeA' },
  { key: 'typeB', labelKey: 'batchPoints.page.speakerTypeB' },
  { key: 'roundtable', labelKey: 'batchPoints.page.speakerTypeRoundtable' },
];

const DEFAULT_POINTS_RULE_CONFIG: PointsRuleConfig = {
  uglPointsPerEvent: 50,
  volunteerPointsPerEvent: 30,
  volunteerMaxPerEvent: 10,
  speakerTypeAPoints: 100,
  speakerTypeBPoints: 50,
  speakerRoundtablePoints: 50,
};

function getPointsForRole(
  config: PointsRuleConfig,
  role: TargetRole,
  speakerType?: SpeakerType,
): number {
  switch (role) {
    case 'UserGroupLeader': return config.uglPointsPerEvent;
    case 'Volunteer': return config.volunteerPointsPerEvent;
    case 'Speaker':
      switch (speakerType) {
        case 'typeA': return config.speakerTypeAPoints;
        case 'typeB': return config.speakerTypeBPoints;
        case 'roundtable': return config.speakerRoundtablePoints;
        default: return 0;
      }
    default: return 0;
  }
}

export default function BatchPointsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const currentUserId = useAppStore((s) => s.user?.userId || '');
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  // Points rule config
  const [pointsRuleConfig, setPointsRuleConfig] = useState<PointsRuleConfig>(DEFAULT_POINTS_RULE_CONFIG);

  // Activity selection
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activeUGNames, setActiveUGNames] = useState<Set<string>>(new Set());
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesLastKey, setActivitiesLastKey] = useState<string | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);

  // Role filter
  const [targetRole, setTargetRole] = useState<TargetRole>('UserGroupLeader');

  // Speaker type
  const [speakerType, setSpeakerType] = useState<SpeakerType | null>(null);

  // User list
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Awarded users (already received points for this activity+role)
  const [awardedUserIds, setAwardedUserIds] = useState<Set<string>>(new Set());

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Form
  const [reasonInput, setReasonInput] = useState('');

  // Confirm modal
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Whether the Admin user has no responsible UGs
  const [noResponsibleUGs, setNoResponsibleUGs] = useState(false);

  // Skill claims state: tracks which userId has selected each skill in current session
  // Key: SkillType, Value: userId that selected it
  const EMPTY_SKILLS: Record<SkillType, string | null> = {
    liveSupport: null,
    posterDesign: null,
    articleEditing: null,
  };
  const [selectedSkills, setSelectedSkills] = useState<Record<SkillType, string | null>>({ ...EMPTY_SKILLS });

  // Server-side skill locks (existing occupations from other distributions)
  const [serverSkillLocks, setServerSkillLocks] = useState<SkillClaimLock[]>([]);

  // Computed points value from config
  const autoPoints = useMemo(() => {
    if (targetRole === 'Speaker' && !speakerType) return 0;
    return getPointsForRole(pointsRuleConfig, targetRole, speakerType ?? undefined);
  }, [pointsRuleConfig, targetRole, speakerType]);

  // Fetch points rule config
  const fetchPointsRuleConfig = useCallback(async () => {
    try {
      const res = await request<{ pointsRuleConfig?: PointsRuleConfig }>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      if (res.pointsRuleConfig) {
        setPointsRuleConfig(res.pointsRuleConfig);
      }
    } catch {
      // Keep defaults
    }
  }, []);

  // Fetch active UG names for filtering activities
  const fetchActiveUGs = useCallback(async () => {
    try {
      if (isSuperAdmin) {
        const res = await request<{ ugs: UGItem[] }>({ url: '/api/admin/ugs?status=active' });
        const names = new Set((res.ugs || []).map((ug) => ug.name));
        setActiveUGNames(names);
        setNoResponsibleUGs(false);
      } else {
        const res = await request<{ ugs: UGItem[] }>({ url: '/api/admin/ugs/my-ugs' });
        const ugs = res.ugs || [];
        const names = new Set(ugs.map((ug) => ug.name));
        setActiveUGNames(names);
        setNoResponsibleUGs(ugs.length === 0);
      }
    } catch {
      setActiveUGNames(new Set());
      setNoResponsibleUGs(!isSuperAdmin);
    }
  }, [isSuperAdmin]);

  // Fetch activities list
  const fetchActivities = useCallback(async (append = false, cursor?: string | null) => {
    if (!append) setActivitiesLoading(true);
    try {
      let url = '/api/admin/activities?pageSize=50';
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;
      const res = await request<{ activities: ActivityItem[]; lastKey?: string }>({ url });
      if (append) {
        setActivities((prev) => {
          const existingIds = new Set(prev.map(a => a.activityId));
          const newItems = (res.activities || []).filter(a => !existingIds.has(a.activityId));
          return [...prev, ...newItems];
        });
      } else {
        setActivities(res.activities || []);
      }
      setActivitiesLastKey(res.lastKey || null);
    } catch {
      if (!append) setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  // Fetch users for the selected role (fetch all, no pagination)
  const fetchUsers = useCallback(async (role: TargetRole) => {
    setLoading(true);
    try {
      const url = `/api/admin/users?role=${role}`;
      const res = await request<{ users: UserListItem[] }>({ url });
      const activeUsers = (res.users || []).filter(
        (u) => u.status === 'active' && !u.roles?.includes('SuperAdmin') && !u.roles?.includes('OrderAdmin'),
      );
      setUsers(sortUsersWithInvitePriority(activeUsers, currentUserId));
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  // Fetch awarded users for the selected activity + role
  const fetchAwardedUsers = useCallback(async (activityId: string, role: TargetRole) => {
    try {
      const res = await request<{ userIds: string[] }>({
        url: `/api/admin/batch-points/awarded?activityId=${encodeURIComponent(activityId)}&targetRole=${encodeURIComponent(role)}`,
      });
      setAwardedUserIds(new Set(res.userIds || []));
    } catch {
      setAwardedUserIds(new Set());
    }
  }, []);

  // Fetch existing skill claims for the selected activity
  const fetchExistingSkillClaims = useCallback(async (activityId: string) => {
    try {
      const res = await request<ExistingSkillClaim[]>({
        url: `/api/admin/skill-claims?activityId=${encodeURIComponent(activityId)}`,
      });
      const claims = Array.isArray(res) ? res : [];
      // Populate serverSkillLocks for UI rendering (occupied state)
      setServerSkillLocks(
        claims.map((c) => ({ skill: c.skill, userId: c.userId, userNickname: c.userNickname })),
      );
    } catch {
      setServerSkillLocks([]);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchActiveUGs();
    fetchActivities();
    fetchPointsRuleConfig();
  }, [isAuthenticated, fetchActiveUGs, fetchActivities, fetchPointsRuleConfig]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setSelectedIds(new Set());
    setSearchQuery('');
    // Reset skill selections when role or activity changes
    setSelectedSkills({ ...EMPTY_SKILLS });
    setServerSkillLocks([]);
    fetchUsers(targetRole);
    // Fetch awarded users when activity + role changes
    if (selectedActivity) {
      fetchAwardedUsers(selectedActivity.activityId, targetRole);
    }
  }, [isAuthenticated, fetchUsers, targetRole, selectedActivity, fetchAwardedUsers]);

  // Fetch existing skill claims when activityId changes (for any role)
  useEffect(() => {
    if (!isAuthenticated) return;
    if (selectedActivity) {
      fetchExistingSkillClaims(selectedActivity.activityId);
    } else {
      setServerSkillLocks([]);
    }
  }, [isAuthenticated, selectedActivity, fetchExistingSkillClaims]);

  // Filter activities: only active UG + client-side search + dedup by activityId
  const filteredActivities = useMemo(() => {
    // Deduplicate by activityId first (guard against pagination boundary duplication)
    const seen = new Set<string>();
    const deduped = activities.filter((a) => {
      if (seen.has(a.activityId)) return false;
      seen.add(a.activityId);
      return true;
    });
    let result = deduped.filter((a) => activeUGNames.has(a.ugName));
    if (activitySearch.trim()) {
      const q = activitySearch.trim().toLowerCase();
      result = result.filter(
        (a) =>
          a.ugName.toLowerCase().includes(q) ||
          a.topic.toLowerCase().includes(q) ||
          a.activityDate.includes(q),
      );
    }
    return result;
  }, [activities, activeUGNames, activitySearch]);

  // Client-side fuzzy search filter for users (exclude awarded users from selectable list)
  const filteredUsers = useMemo(() => {
    let result = users;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (u) => u.nickname.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    return result;
  }, [users, searchQuery]);

  const handleSelectActivity = (activity: ActivityItem) => {
    setSelectedActivity(activity);
  };

  const handleChangeActivity = () => {
    setSelectedActivity(null);
    setActivitySearch('');
    setSelectedIds(new Set());
    setSpeakerType(null);
    setSelectedSkills({ ...EMPTY_SKILLS });
    setServerSkillLocks([]);
  };

  const handleLoadMoreActivities = () => {
    if (activitiesLastKey) fetchActivities(true, activitiesLastKey);
  };

  const handleTabChange = (role: TargetRole) => {
    setTargetRole(role);
    setSpeakerType(null);
  };

  // Selection handlers — skip awarded users
  const toggleUser = (userId: string) => {
    if (awardedUserIds.has(userId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const selectableUsers = useMemo(
    () => filteredUsers.filter((u) => !awardedUserIds.has(u.userId)),
    [filteredUsers, awardedUserIds],
  );

  const isAllSelected = selectableUsers.length > 0 && selectableUsers.every((u) => selectedIds.has(u.userId));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableUsers.forEach((u) => next.delete(u.userId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableUsers.forEach((u) => next.add(u.userId));
        return next;
      });
    }
  };

  // Skill icon click handler with mutex logic
  const handleSkillClick = (userId: string, skill: SkillType, e: any) => {
    // Stop propagation to prevent triggering the row's onClick (checkbox toggle)
    e.stopPropagation();

    // Check if occupied by server (another user from a previous distribution)
    const serverLock = serverSkillLocks.find((lock) => lock.skill === skill);
    if (serverLock) {
      // Occupied by server data �?do nothing
      return;
    }

    const currentHolder = selectedSkills[skill];

    if (currentHolder === userId) {
      // Already selected by this user �?deselect
      setSelectedSkills((prev) => ({ ...prev, [skill]: null }));
    } else if (currentHolder === null) {
      // Not selected by anyone �?select it
      setSelectedSkills((prev) => ({ ...prev, [skill]: userId }));
    }
    // If occupied by another user in current session (mutex) �?do nothing
  };

  // Helper to determine skill icon state for a given user and skill
  const getSkillIconState = (userId: string, skill: SkillType): 'normal' | 'selected' | 'occupied' | 'disabled' => {
    // Check server-side occupation first
    const serverLock = serverSkillLocks.find((lock) => lock.skill === skill);
    if (serverLock) {
      return 'occupied';
    }

    // Check current session selection
    const currentHolder = selectedSkills[skill];
    if (currentHolder === userId) {
      return 'selected';
    }
    if (currentHolder !== null && currentHolder !== userId) {
      return 'disabled'; // mutex: another user selected this skill in current session
    }

    return 'normal';
  };

  // Get tooltip text for occupied/disabled skill icons
  const getSkillTooltip = (userId: string, skill: SkillType): string => {
    const skillPoints =
      skill === 'liveSupport' ? (pointsRuleConfig.liveSupportPoints ?? 30)
      : skill === 'posterDesign' ? (pointsRuleConfig.posterDesignPoints ?? 30)
      : (pointsRuleConfig.articleEditingPoints ?? 30);
    const skillName = (t(`skillClaims.skillIcon.${skill}.tooltip` as any) as string);

    const serverLock = serverSkillLocks.find((lock) => lock.skill === skill);
    if (serverLock) {
      return `${skillName} · +${skillPoints}分 · 每场1人\n已被 ${serverLock.userNickname} 占用`;
    }

    const currentHolder = selectedSkills[skill];
    if (currentHolder !== null && currentHolder !== userId) {
      const holder = users.find((u) => u.userId === currentHolder);
      const nickname = holder?.nickname || currentHolder;
      return `${skillName} · +${skillPoints}分 · 每场1人\n已被 ${nickname} 占用`;
    }

    // Normal or selected — show skill name + points + limit
    return `${skillName} · +${skillPoints}分 · 每场1人`;
  };

  // Volunteer limit check
  const volunteerLimitExceeded = targetRole === 'Volunteer' && selectedIds.size > pointsRuleConfig.volunteerMaxPerEvent;

  // Check if any skill is selected (for skill-only submission scenario)
  const hasSkillSelection = selectedSkills.liveSupport !== null || selectedSkills.posterDesign !== null || selectedSkills.articleEditing !== null;

  // Validation
  const isReasonValid = reasonInput.trim().length >= 1 && reasonInput.trim().length <= 200;
  const isSpeakerTypeValid = targetRole !== 'Speaker' || !!speakerType;
  const canSubmit = !!selectedActivity && (selectedIds.size > 0 || hasSkillSelection) && (autoPoints > 0 || hasSkillSelection) && isReasonValid && !volunteerLimitExceeded && isSpeakerTypeValid;

  const handleOpenConfirm = () => {
    if (!canSubmit) return;
    setShowConfirm(true);
  };

  const handleCloseConfirm = () => {
    setShowConfirm(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting || !selectedActivity) return;
    setSubmitting(true);
    try {
      // Build skillClaims array from selected skill icons
      const skillClaims = Object.entries(selectedSkills)
        .filter(([_, userId]) => userId !== null)
        .map(([skill, userId]) => ({ skill, userId }));

      await request({
        url: '/api/admin/batch-points',
        method: 'POST',
        data: {
          userIds: Array.from(selectedIds),
          points: autoPoints,
          reason: reasonInput.trim(),
          targetRole,
          ...(targetRole === 'Speaker' && speakerType ? { speakerType } : {}),
          activityId: selectedActivity.activityId,
          activityType: selectedActivity.activityType,
          activityUG: selectedActivity.ugName,
          activityTopic: selectedActivity.topic,
          activityDate: selectedActivity.activityDate,
          ...(skillClaims.length > 0 ? { skillClaims } : {}),
        },
      });
      Taro.showToast({ title: t('batchPoints.page.successToast'), icon: 'none' });
      setSelectedIds(new Set());
      setReasonInput('');
      setShowConfirm(false);
      // Reset skill selections on success
      setSelectedSkills({ ...EMPTY_SKILLS });
      // Refresh skill locks from server
      fetchExistingSkillClaims(selectedActivity.activityId);
      fetchUsers(targetRole);
      if (selectedActivity) {
        fetchAwardedUsers(selectedActivity.activityId, targetRole);
      }
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'SKILL_ALREADY_CLAIMED') {
          Taro.showToast({
            title: t('skillClaims.batchPoints.skillAlreadyClaimed' as any),
            icon: 'none',
          });
          // Refresh locks to show updated occupation state
          fetchExistingSkillClaims(selectedActivity.activityId);
          // Reset local skill selections since they may be stale
          setSelectedSkills({ ...EMPTY_SKILLS });
        } else if (err.code === 'BATCH_TOO_LARGE') {
          Taro.showToast({
            title: t('skillClaims.batchPoints.batchTooLarge' as any),
            icon: 'none',
          });
        } else {
          Taro.showToast({ title: err.message, icon: 'none' });
        }
      } else {
        Taro.showToast({ title: t('batchPoints.page.errorToast'), icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  const currentRoleTab = ROLE_TABS.find((rt) => rt.key === targetRole);
  const activitySelected = !!selectedActivity;

  // Speaker type label for confirm dialog
  const speakerTypeLabel = speakerType
    ? SPEAKER_TYPES.find((st) => st.key === speakerType)?.labelKey
    : null;

  return (
    <View className='batch-points'>
      {/* Toolbar */}
      <View className='batch-points__toolbar'>
        <View className='batch-points__back' onClick={handleBack}>
          <Text>{t('batchPoints.page.backButton')}</Text>
        </View>
        <Text className='batch-points__title'>{t('batchPoints.page.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Activity Selector */}
      {noResponsibleUGs ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>📋</Text>
          <Text className='admin-empty__text'>
            {t('batchPoints.page.noResponsibleUGs' as any)}
          </Text>
        </View>
      ) : selectedActivity ? (
        <View className='bp-activity-summary'>
          <View className='bp-activity-summary__header'>
            <Text className='bp-activity-summary__title'>{t('activitySelector.selectedTitle' as any)}</Text>
            <View className='bp-activity-summary__change' onClick={handleChangeActivity}>
              <Text>{t('activitySelector.changeButton' as any)}</Text>
            </View>
          </View>
          <View className='bp-activity-summary__card'>
            <View className='bp-activity-summary__row'>
              <Text className={`bp-activity-badge bp-activity-badge--${selectedActivity.activityType === '线上活动' ? 'online' : 'offline'}`}>
                {selectedActivity.activityType}
              </Text>
              <Text className='bp-activity-summary__ug'>{selectedActivity.ugName}</Text>
            </View>
            <Text className='bp-activity-summary__topic'>{selectedActivity.topic}</Text>
            <Text className='bp-activity-summary__date'>{selectedActivity.activityDate}</Text>
          </View>
        </View>
      ) : (
        <View className='bp-activity-selector'>
          <View className='bp-activity-selector__header'>
            <Text className='bp-activity-selector__title'>{t('activitySelector.title' as any)}</Text>
            <Text className='bp-activity-selector__hint'>{t('activitySelector.hint' as any)}</Text>
          </View>
          <View className='bp-activity-selector__search'>
            <Input
              className='bp-activity-selector__search-input'
              value={activitySearch}
              onInput={(e) => setActivitySearch(e.detail.value)}
              placeholder={t('activitySelector.searchPlaceholder' as any)}
            />
          </View>
          {activitiesLoading ? (
            <View className='admin-loading'><Text>{t('activitySelector.loadingActivities' as any)}</Text></View>
          ) : filteredActivities.length === 0 ? (
            <View className='admin-empty'>
              <Text className='admin-empty__icon'>📋</Text>
              <Text className='admin-empty__text'>
                {activitySearch.trim() ? t('activitySelector.noMatchingActivities' as any) : t('activitySelector.noAvailableActivities' as any)}
              </Text>
            </View>
          ) : (
            <View className='bp-activity-selector__list'>
              {filteredActivities.map((activity) => (
                <View
                  key={activity.activityId}
                  className='bp-activity-item'
                  onClick={() => handleSelectActivity(activity)}
                >
                  <View className='bp-activity-item__top'>
                    <Text className={`bp-activity-badge bp-activity-badge--${activity.activityType === '线上活动' ? 'online' : 'offline'}`}>
                      {activity.activityType}
                    </Text>
                    <Text className='bp-activity-item__ug'>{activity.ugName}</Text>
                    <Text className='bp-activity-item__date'>{activity.activityDate}</Text>
                  </View>
                  <Text className='bp-activity-item__topic'>{activity.topic}</Text>
                </View>
              ))}
              {activitiesLastKey && (
                <View className='bp-activity-selector__load-more' onClick={handleLoadMoreActivities}>
                  <Text>{t('activitySelector.loadMoreActivities' as any)}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* Role Filter Tabs */}
      <View className={`bp-tabs ${!activitySelected ? 'bp-tabs--disabled' : ''}`}>
        {ROLE_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`bp-tabs__item ${targetRole === tab.key ? 'bp-tabs__item--active' : ''}`}
            onClick={() => activitySelected && handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Speaker Type Selector */}
      {activitySelected && targetRole === 'Speaker' && (
        <View className='bp-speaker-type'>
          <Text className='bp-speaker-type__label'>{t('batchPoints.page.speakerTypeLabel' as any)}</Text>
          <View className='bp-speaker-type__options'>
            {SPEAKER_TYPES.map((st) => (
              <View
                key={st.key}
                className={`bp-speaker-type__option ${speakerType === st.key ? 'bp-speaker-type__option--active' : ''}`}
                onClick={() => setSpeakerType(st.key)}
              >
                <Text>{t(st.labelKey as any)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Auto Points Display */}
      {activitySelected && (targetRole !== 'Speaker' || speakerType) && (
        <View className='bp-auto-points'>
          <Text className='bp-auto-points__label'>{t('batchPoints.page.autoPointsLabel' as any)}</Text>
          <Text className='bp-auto-points__value'>{autoPoints} {t('batchPoints.page.pointsUnit')}</Text>
        </View>
      )}

      {/* Search Box */}
      <View className={`bp-search ${!activitySelected ? 'bp-search--disabled' : ''}`}>
        <Input
          className='bp-search__input'
          value={searchQuery}
          onInput={(e) => activitySelected && setSearchQuery(e.detail.value)}
          placeholder={t('batchPoints.page.searchPlaceholder')}
          disabled={!activitySelected}
        />
      </View>

      {/* Select All Bar */}
      {activitySelected && !loading && selectableUsers.length > 0 && (
        <View className='bp-select-bar'>
          <View className='bp-select-bar__left' onClick={toggleSelectAll}>
            <View className={`bp-checkbox ${isAllSelected ? 'bp-checkbox--checked' : ''}`}>
              <Text>{isAllSelected ? '✓' : ''}</Text>
            </View>
            <Text className='bp-select-bar__label'>{t('batchPoints.page.selectAll')}</Text>
          </View>
          <Text className='bp-select-bar__count'>
            {t('batchPoints.page.selectedCount', { count: selectedIds.size })}
          </Text>
        </View>
      )}

      {/* Volunteer Limit Warning */}
      {volunteerLimitExceeded && (
        <View className='bp-warning'>
          <Text className='bp-warning__text'>
            {t('batchPoints.page.volunteerLimitError' as any, { max: pointsRuleConfig.volunteerMaxPerEvent })}
          </Text>
        </View>
      )}

      {/* Speaker type not selected hint */}
      {activitySelected && targetRole === 'Speaker' && !speakerType ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>🎤</Text>
          <Text className='admin-empty__text'>{t('batchPoints.page.selectSpeakerTypeFirst' as any)}</Text>
        </View>
      ) : !activitySelected ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>🔒</Text>
          <Text className='admin-empty__text'>{t('batchPoints.page.selectActivityFirst' as any)}</Text>
        </View>
      ) : loading ? (
        <View className='admin-loading'><Text>{t('batchPoints.page.loading')}</Text></View>
      ) : filteredUsers.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>👤</Text>
          <Text className='admin-empty__text'>
            {searchQuery.trim() ? t('batchPoints.page.noUsersSearch') : t('batchPoints.page.noUsersRole')}
          </Text>
        </View>
      ) : (
        <View className='bp-user-list'>
          {filteredUsers.map((user) => {
            const isAwarded = awardedUserIds.has(user.userId);
            const isSelected = selectedIds.has(user.userId);
            const showSkillIcons = activitySelected && user.status === 'active';
            return (
              <View
                key={user.userId}
                className={`bp-user-row ${isSelected ? 'bp-user-row--selected' : ''} ${isAwarded ? 'bp-user-row--awarded' : ''}`}
                onClick={() => toggleUser(user.userId)}
              >
                <View className={`bp-checkbox ${isSelected ? 'bp-checkbox--checked' : ''} ${isAwarded ? 'bp-checkbox--disabled' : ''}`}>
                  <Text>{isSelected ? '✓' : isAwarded ? '✓' : ''}</Text>
                </View>
                <View className='bp-user-row__info'>
                  <View className='bp-user-row__top'>
                    <Text className='bp-user-row__nickname'>{user.nickname}</Text>
                    {isAwarded && (
                      <Text className='bp-user-row__awarded-tag'>{t('batchPoints.page.userAlreadyAwarded' as any)}</Text>
                    )}
                  </View>
                  <Text className='bp-user-row__email'>{user.email}</Text>
                </View>
                <Text className='bp-user-row__points'>{user.points} {t('batchPoints.page.pointsUnit')}</Text>
                {showSkillIcons && (
                  <View className='bp-skill-icons'>
                    {/* video-camera (liveSupport) - Heroicons outline 24×24 */}
                    <View
                      className={`bp-skill-icons__icon bp-skill-icons__icon--${getSkillIconState(user.userId, 'liveSupport')}`}
                      // @ts-ignore - title works in H5 mode
                      title={getSkillTooltip(user.userId, 'liveSupport')}
                      aria-label={getSkillTooltip(user.userId, 'liveSupport')}
                      onClick={(e) => handleSkillClick(user.userId, 'liveSupport', e)}
                    >
                      <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' strokeWidth={1.5} stroke='currentColor' width={24} height={24}>
                        <path strokeLinecap='round' strokeLinejoin='round' d='m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z' />
                      </svg>
                    </View>
                    {/* photo (posterDesign) - Heroicons outline 24×24 */}
                    <View
                      className={`bp-skill-icons__icon bp-skill-icons__icon--${getSkillIconState(user.userId, 'posterDesign')}`}
                      // @ts-ignore - title works in H5 mode
                      title={getSkillTooltip(user.userId, 'posterDesign')}
                      aria-label={getSkillTooltip(user.userId, 'posterDesign')}
                      onClick={(e) => handleSkillClick(user.userId, 'posterDesign', e)}
                    >
                      <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' strokeWidth={1.5} stroke='currentColor' width={24} height={24}>
                        <path strokeLinecap='round' strokeLinejoin='round' d='m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z' />
                      </svg>
                    </View>
                    {/* pencil-square (articleEditing) - Heroicons outline 24×24 */}
                    <View
                      className={`bp-skill-icons__icon bp-skill-icons__icon--${getSkillIconState(user.userId, 'articleEditing')}`}
                      // @ts-ignore - title works in H5 mode
                      title={getSkillTooltip(user.userId, 'articleEditing')}
                      aria-label={getSkillTooltip(user.userId, 'articleEditing')}
                      onClick={(e) => handleSkillClick(user.userId, 'articleEditing', e)}
                    >
                      <svg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' strokeWidth={1.5} stroke='currentColor' width={24} height={24}>
                        <path strokeLinecap='round' strokeLinejoin='round' d='m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10' />
                      </svg>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Form Section �?reason only, points are auto-filled */}
      <View className={`bp-form ${!activitySelected ? 'bp-form--disabled' : ''}`}>
        <View className='bp-form__field'>
          <Text className='bp-form__label'>{t('batchPoints.page.reasonLabel')}</Text>
          <Input
            className='bp-form__input'
            value={reasonInput}
            onInput={(e) => {
              if (activitySelected && e.detail.value.length <= 200) {
                setReasonInput(e.detail.value);
              }
            }}
            placeholder={t('batchPoints.page.reasonPlaceholder')}
            maxlength={200}
            disabled={!activitySelected}
          />
          <Text className='bp-form__char-count'>{reasonInput.length}/200</Text>
        </View>
        <View
          className={`bp-form__submit ${!canSubmit ? 'bp-form__submit--disabled' : ''}`}
          onClick={handleOpenConfirm}
        >
          <Text>{t('batchPoints.page.submitButton')}</Text>
        </View>
      </View>

      {/* Confirm Modal */}
      {showConfirm && selectedActivity && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('batchPoints.page.confirmTitle')}</Text>
              <View className='form-modal__close' onClick={handleCloseConfirm}><Text>×</Text></View>
            </View>
            <View className='form-modal__body'>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmActivity' as any)}</Text>
                <Text className='bp-confirm__value'>{selectedActivity.topic}</Text>
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmActivityUG' as any)}</Text>
                <Text className='bp-confirm__value'>{selectedActivity.ugName}</Text>
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmTargetRole')}</Text>
                <Text className={`role-badge ${currentRoleTab?.className || ''}`}>
                  {currentRoleTab ? t(currentRoleTab.labelKey) : targetRole}
                </Text>
              </View>
              {targetRole === 'Speaker' && speakerTypeLabel && (
                <View className='bp-confirm__row'>
                  <Text className='bp-confirm__label'>{t('batchPoints.page.confirmSpeakerType' as any)}</Text>
                  <Text className='bp-confirm__value'>{t(speakerTypeLabel as any)}</Text>
                </View>
              )}
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmSelectedCount')}</Text>
                <Text className='bp-confirm__value'>{selectedIds.size}</Text>
              </View>
              <View className='bp-confirm__names'>
                {filteredUsers
                  .filter((u) => selectedIds.has(u.userId))
                  .map((u) => (
                    <Text key={u.userId} className='bp-confirm__name-tag'>{u.nickname}</Text>
                  ))}
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmPointsPerPerson')}</Text>
                <Text className='bp-confirm__value bp-confirm__value--highlight'>{autoPoints}</Text>
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmTotalPoints')}</Text>
                <Text className='bp-confirm__value bp-confirm__value--highlight'>
                  {selectedIds.size * autoPoints}
                </Text>
              </View>
              {/* Skill Claims Summary */}
              {hasSkillSelection && (() => {
                const skillPointsMap: Record<SkillType, number> = {
                  liveSupport: pointsRuleConfig.liveSupportPoints ?? 30,
                  posterDesign: pointsRuleConfig.posterDesignPoints ?? 30,
                  articleEditing: pointsRuleConfig.articleEditingPoints ?? 30,
                };
                const orderedSkills: SkillType[] = ['liveSupport', 'posterDesign', 'articleEditing'];
                const total = orderedSkills.reduce(
                  (sum, sk) => sum + (selectedSkills[sk] ? skillPointsMap[sk] : 0),
                  0,
                );
                return (
                  <View className='bp-confirm__skill-section'>
                    <View className='bp-confirm__row'>
                      <Text className='bp-confirm__label'>技能分</Text>
                      <Text className='bp-confirm__value bp-confirm__value--highlight'>+{total}</Text>
                    </View>
                    {orderedSkills.map((sk) =>
                      selectedSkills[sk] ? (
                        <View key={sk} className='bp-confirm__skill-item'>
                          <Text className='bp-confirm__skill-name'>{t(`skillClaims.skillIcon.${sk}.tooltip` as any)}</Text>
                          <Text className='bp-confirm__skill-user'>
                            {users.find(u => u.userId === selectedSkills[sk])?.nickname || selectedSkills[sk]}
                          </Text>
                          <Text className='bp-confirm__skill-pts'>+{skillPointsMap[sk]}</Text>
                        </View>
                      ) : null,
                    )}
                  </View>
                );
              })()}
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmPointsRule' as any)}</Text>
                <Text className='bp-confirm__value'>
                  {currentRoleTab ? t(currentRoleTab.labelKey) : targetRole}
                  {speakerTypeLabel ? ` · ${t(speakerTypeLabel as any)}` : ''}
                  {` : ${autoPoints} ${t('batchPoints.page.pointsUnit')}`}
                </Text>
              </View>
              <View className='bp-confirm__reason'>{reasonInput.trim()}</View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={handleCloseConfirm}>
                <Text>{t('batchPoints.page.confirmCancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmit}
              >
                <Text>{submitting ? t('batchPoints.page.submitting') : t('batchPoints.page.confirmSubmit')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
