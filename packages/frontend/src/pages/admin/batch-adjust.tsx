import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { sortUsersWithInvitePriority } from '../../utils/sort-users';
import type { DistributionRecord } from '@points-mall/shared';
import './batch-adjust.scss';

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

/** Points rule config from settings */
interface PointsRuleConfig {
  uglPointsPerEvent: number;
  volunteerPointsPerEvent: number;
  volunteerMaxPerEvent: number;
  speakerTypeAPoints: number;
  speakerTypeBPoints: number;
  speakerRoundtablePoints: number;
}

/** Target role options */
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

export default function BatchAdjustPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const currentUserId = useAppStore((s) => s.user?.userId || '');
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  // Route param
  const distributionId = Taro.getCurrentInstance().router?.params?.distributionId || '';

  // Points rule config
  const [pointsRuleConfig, setPointsRuleConfig] = useState<PointsRuleConfig>(DEFAULT_POINTS_RULE_CONFIG);

  // Original distribution data
  const [originalRecord, setOriginalRecord] = useState<DistributionRecord | null>(null);
  const [distributionLoading, setDistributionLoading] = useState(true);
  const [distributionError, setDistributionError] = useState('');

  // Role filter
  const [targetRole, setTargetRole] = useState<TargetRole>('UserGroupLeader');

  // Speaker type
  const [speakerType, setSpeakerType] = useState<SpeakerType | null>(null);

  // User list
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Confirm modal
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Computed points values
  const autoPoints = useMemo(() => {
    if (targetRole === 'Speaker' && !speakerType) return 0;
    return getPointsForRole(pointsRuleConfig, targetRole, speakerType ?? undefined);
  }, [pointsRuleConfig, targetRole, speakerType]);

  const originalPoints = useMemo(() => {
    return originalRecord?.points || 0;
  }, [originalRecord]);

  // Original recipient IDs set
  const originalRecipientIds = useMemo(() => {
    return new Set(originalRecord?.recipientIds || []);
  }, [originalRecord]);

  // Diff computation
  const addedUserIds = useMemo(() => {
    return new Set([...selectedIds].filter((id) => !originalRecipientIds.has(id)));
  }, [selectedIds, originalRecipientIds]);

  const removedUserIds = useMemo(() => {
    return new Set([...originalRecipientIds].filter((id) => !selectedIds.has(id)));
  }, [selectedIds, originalRecipientIds]);

  const retainedUserIds = useMemo(() => {
    return new Set([...selectedIds].filter((id) => originalRecipientIds.has(id)));
  }, [selectedIds, originalRecipientIds]);

  // Total points delta
  const totalDelta = useMemo(() => {
    const addedDelta = addedUserIds.size * autoPoints;
    const removedDelta = -(removedUserIds.size * originalPoints);
    const retainedDelta = retainedUserIds.size * (autoPoints - originalPoints);
    return addedDelta + removedDelta + retainedDelta;
  }, [addedUserIds, removedUserIds, retainedUserIds, autoPoints, originalPoints]);

  // Has changes?
  const hasChanges = useMemo(() => {
    if (!originalRecord) return false;
    if (addedUserIds.size > 0 || removedUserIds.size > 0) return true;
    if (targetRole !== originalRecord.targetRole) return true;
    if (targetRole === 'Speaker' && speakerType !== originalRecord.speakerType) return true;
    return false;
  }, [originalRecord, addedUserIds, removedUserIds, targetRole, speakerType]);

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

  // Fetch original distribution record
  const fetchDistribution = useCallback(async () => {
    if (!distributionId) {
      setDistributionError('发放记录不存在');
      setDistributionLoading(false);
      return;
    }
    setDistributionLoading(true);
    try {
      const res = await request<{ distribution: DistributionRecord }>({
        url: `/api/admin/batch-points/history/${distributionId}`,
      });
      const record = res.distribution;
      setOriginalRecord(record);
      setTargetRole(record.targetRole);
      setSpeakerType(record.speakerType || null);
      setSelectedIds(new Set(record.recipientIds));
    } catch (err) {
      setDistributionError(
        err instanceof RequestError ? err.message : '发放记录不存在',
      );
    } finally {
      setDistributionLoading(false);
    }
  }, [distributionId]);

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

  // Auth + SuperAdmin gate + initial data load
  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    if (!isSuperAdmin) {
      Taro.redirectTo({ url: '/pages/admin/batch-history' });
      return;
    }
    fetchDistribution();
    fetchPointsRuleConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch users when original record first loads
  const initialLoadDone = useMemo(() => !!originalRecord, [originalRecord]);

  useEffect(() => {
    if (!initialLoadDone) return;
    fetchUsers(targetRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadDone]);

  // When user manually changes role tab (not initial load)
  const handleTabChange = (role: TargetRole) => {
    setTargetRole(role);
    setSearchQuery('');
    fetchUsers(role);
    if (role !== 'Speaker') {
      setSpeakerType(null);
    } else if (originalRecord?.targetRole === 'Speaker' && originalRecord?.speakerType) {
      setSpeakerType(originalRecord.speakerType);
    } else {
      setSpeakerType(null);
    }
    // Update selection based on role
    if (originalRecord && role === originalRecord.targetRole) {
      setSelectedIds(new Set(originalRecord.recipientIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  // Client-side search filter
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.trim().toLowerCase();
    return users.filter(
      (u) => u.nickname.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  const handleLoadMore = () => {
    // No longer needed — all users loaded at once
  };

  // Selection handlers
  const toggleUser = (userId: string) => {
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

  const isAllSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.has(u.userId));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.delete(u.userId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.add(u.userId));
        return next;
      });
    }
  };

  // Volunteer limit check
  const volunteerLimitExceeded = targetRole === 'Volunteer' && selectedIds.size > pointsRuleConfig.volunteerMaxPerEvent;

  // Speaker type valid
  const isSpeakerTypeValid = targetRole !== 'Speaker' || !!speakerType;

  // Validation
  const canSubmit = !!originalRecord && selectedIds.size > 0 && autoPoints > 0 && hasChanges && !volunteerLimitExceeded && isSpeakerTypeValid;

  const handleOpenConfirm = () => {
    if (!canSubmit) return;
    setShowConfirm(true);
  };

  const handleCloseConfirm = () => {
    setShowConfirm(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting || !originalRecord) return;
    setSubmitting(true);
    try {
      await request({
        url: `/api/admin/batch-points/${distributionId}/adjust`,
        method: 'POST',
        data: {
          recipientIds: Array.from(selectedIds),
          targetRole,
          ...(targetRole === 'Speaker' && speakerType ? { speakerType } : {}),
        },
      });
      Taro.showToast({ title: t('batchPoints.adjust.successToast' as any), icon: 'none' });
      setShowConfirm(false);
      setTimeout(() => {
        goBack('/pages/admin/batch-history');
      }, 1000);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('batchPoints.adjust.errorToast' as any),
        icon: 'none',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/batch-history');

  const currentRoleTab = ROLE_TABS.find((rt) => rt.key === targetRole);
  const originalRoleTab = ROLE_TABS.find((rt) => rt.key === originalRecord?.targetRole);

  // Get nicknames for added/removed users from the user list
  const addedUsers = useMemo(
    () => users.filter((u) => addedUserIds.has(u.userId)),
    [users, addedUserIds],
  );
  const removedUsers = useMemo(() => {
    // Removed users might not be in current user list (different role), use recipientDetails
    const details = originalRecord?.recipientDetails || [];
    return details.filter((d) => removedUserIds.has(d.userId));
  }, [originalRecord, removedUserIds]);

  // Speaker type label
  const speakerTypeLabel = speakerType
    ? SPEAKER_TYPES.find((st) => st.key === speakerType)?.labelKey
    : null;
  const originalSpeakerTypeLabel = originalRecord?.speakerType
    ? SPEAKER_TYPES.find((st) => st.key === originalRecord.speakerType)?.labelKey
    : null;

  // Format delta with sign
  const formatDelta = (delta: number) => {
    if (delta > 0) return `+${delta}`;
    return String(delta);
  };

  return (
    <View className='batch-adjust'>
      {/* Toolbar */}
      <View className='batch-adjust__toolbar'>
        <View className='batch-adjust__back' onClick={handleBack}>
          <Text>{t('batchPoints.adjust.backButton' as any)}</Text>
        </View>
        <Text className='batch-adjust__title'>{t('batchPoints.adjust.title' as any)}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Loading / Error states */}
      {distributionLoading ? (
        <View className='admin-loading'>
          <Text>{t('batchPoints.adjust.loadingDistribution' as any)}</Text>
        </View>
      ) : distributionError ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>⚠️</Text>
          <Text className='admin-empty__text'>{distributionError}</Text>
        </View>
      ) : originalRecord ? (
        <>
          {/* Read-only Activity Context */}
          <View className='ba-activity-context'>
            <Text className='ba-activity-context__label'>{t('batchPoints.adjust.activityLabel' as any)}</Text>
            <View className='ba-activity-context__card'>
              <View className='ba-activity-context__row'>
                <Text className={`bp-activity-badge bp-activity-badge--${originalRecord.activityType === '线上活动' ? 'online' : 'offline'}`}>
                  {originalRecord.activityType || '-'}
                </Text>
                <Text className='ba-activity-context__ug'>{originalRecord.activityUG || '-'}</Text>
              </View>
              <Text className='ba-activity-context__topic'>{originalRecord.activityTopic || '-'}</Text>
              <Text className='ba-activity-context__date'>{originalRecord.activityDate || '-'}</Text>
            </View>
          </View>

          {/* Original info row */}
          <View className='ba-original-info'>
            <View className='ba-original-info__item'>
              <Text className='ba-original-info__label'>{t('batchPoints.adjust.originalRole' as any)}</Text>
              <Text className={`role-badge ${originalRoleTab?.className || ''}`}>
                {originalRoleTab ? t(originalRoleTab.labelKey) : originalRecord.targetRole}
              </Text>
            </View>
            {originalRecord.targetRole === 'Speaker' && originalSpeakerTypeLabel && (
              <View className='ba-original-info__item'>
                <Text className='ba-original-info__label'>{t('batchPoints.adjust.originalSpeakerType' as any)}</Text>
                <Text className='ba-original-info__value'>{t(originalSpeakerTypeLabel as any)}</Text>
              </View>
            )}
            <View className='ba-original-info__item'>
              <Text className='ba-original-info__label'>{t('batchPoints.adjust.originalPoints' as any)}</Text>
              <Text className='ba-original-info__value'>{originalPoints} {t('batchPoints.page.pointsUnit')}</Text>
            </View>
          </View>

          {/* Role Filter Tabs */}
          <View className='bp-tabs'>
            {ROLE_TABS.map((tab) => (
              <View
                key={tab.key}
                className={`bp-tabs__item ${targetRole === tab.key ? 'bp-tabs__item--active' : ''}`}
                onClick={() => handleTabChange(tab.key)}
              >
                <Text>{t(tab.labelKey)}</Text>
              </View>
            ))}
          </View>

          {/* Speaker Type Selector */}
          {targetRole === 'Speaker' && (
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
          {(targetRole !== 'Speaker' || speakerType) && (
            <View className='bp-auto-points'>
              <Text className='bp-auto-points__label'>{t('batchPoints.adjust.newPoints' as any)}</Text>
              <Text className='bp-auto-points__value'>{autoPoints} {t('batchPoints.page.pointsUnit')}</Text>
            </View>
          )}

          {/* Diff Summary Panel */}
          {originalRecord && (
            <View className='ba-diff-summary'>
              <Text className='ba-diff-summary__title'>{t('batchPoints.adjust.diffSummaryTitle' as any)}</Text>
              <View className='ba-diff-summary__grid'>
                <View className='ba-diff-summary__item ba-diff-summary__item--added'>
                  <Text className='ba-diff-summary__count'>+{addedUserIds.size}</Text>
                  <Text className='ba-diff-summary__label'>{t('batchPoints.adjust.addedCount' as any, { count: addedUserIds.size })}</Text>
                </View>
                <View className='ba-diff-summary__item ba-diff-summary__item--removed'>
                  <Text className='ba-diff-summary__count'>-{removedUserIds.size}</Text>
                  <Text className='ba-diff-summary__label'>{t('batchPoints.adjust.removedCount' as any, { count: removedUserIds.size })}</Text>
                </View>
                <View className='ba-diff-summary__item ba-diff-summary__item--retained'>
                  <Text className='ba-diff-summary__count'>{retainedUserIds.size}</Text>
                  <Text className='ba-diff-summary__label'>{t('batchPoints.adjust.retainedCount' as any, { count: retainedUserIds.size })}</Text>
                </View>
              </View>
              <View className='ba-diff-summary__delta'>
                <Text className='ba-diff-summary__delta-label'>{t('batchPoints.adjust.totalDelta' as any)}</Text>
                <Text className={`ba-diff-summary__delta-value ${totalDelta > 0 ? 'ba-diff-summary__delta-value--positive' : totalDelta < 0 ? 'ba-diff-summary__delta-value--negative' : ''}`}>
                  {formatDelta(totalDelta)} {t('batchPoints.page.pointsUnit')}
                </Text>
              </View>
              {!hasChanges && (
                <Text className='ba-diff-summary__no-changes'>{t('batchPoints.adjust.noChanges' as any)}</Text>
              )}
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

          {/* Search Box */}
          <View className='bp-search'>
            <Input
              className='bp-search__input'
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.detail.value)}
              placeholder={t('batchPoints.page.searchPlaceholder')}
            />
          </View>

          {/* Select All Bar */}
          {!loading && filteredUsers.length > 0 && (
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

          {/* Speaker type not selected hint */}
          {targetRole === 'Speaker' && !speakerType ? (
            <View className='admin-empty'>
              <Text className='admin-empty__icon'>🎤</Text>
              <Text className='admin-empty__text'>{t('batchPoints.page.selectSpeakerTypeFirst' as any)}</Text>
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
                const isSelected = selectedIds.has(user.userId);
                const isOriginal = originalRecipientIds.has(user.userId);
                return (
                  <View
                    key={user.userId}
                    className={`bp-user-row ${isSelected ? 'bp-user-row--selected' : ''} ${isOriginal && !isSelected ? 'bp-user-row--removed' : ''}`}
                    onClick={() => toggleUser(user.userId)}
                  >
                    <View className={`bp-checkbox ${isSelected ? 'bp-checkbox--checked' : ''}`}>
                      <Text>{isSelected ? '✓' : ''}</Text>
                    </View>
                    <View className='bp-user-row__info'>
                      <View className='bp-user-row__top'>
                        <Text className='bp-user-row__nickname'>{user.nickname}</Text>
                        {isOriginal && (
                          <Text className='ba-user-original-tag'>
                            {isSelected ? '✦' : '✕'}
                          </Text>
                        )}
                      </View>
                      <Text className='bp-user-row__email'>{user.email}</Text>
                    </View>
                    <Text className='bp-user-row__points'>{user.points} {t('batchPoints.page.pointsUnit')}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Reason Display (read-only) */}
          <View className='ba-reason'>
            <Text className='ba-reason__label'>{t('batchPoints.page.reasonLabel')}</Text>
            <Text className='ba-reason__text'>{originalRecord.reason}</Text>
          </View>

          {/* Submit Button */}
          <View className='ba-submit-area'>
            <View
              className={`bp-form__submit ${!canSubmit ? 'bp-form__submit--disabled' : ''}`}
              onClick={handleOpenConfirm}
            >
              <Text>{t('batchPoints.adjust.submitButton' as any)}</Text>
            </View>
          </View>
        </>
      ) : null}

      {/* Confirmation Dialog with Diff Summary */}
      {showConfirm && originalRecord && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('batchPoints.adjust.confirmTitle' as any)}</Text>
              <View className='form-modal__close' onClick={handleCloseConfirm}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              {/* Diff counts */}
              <View className='ba-confirm__diff-row'>
                <Text className='ba-confirm__diff-label'>{t('batchPoints.adjust.confirmAddedUsers' as any)}</Text>
                <Text className='ba-confirm__diff-value ba-confirm__diff-value--added'>+{addedUserIds.size}</Text>
              </View>
              <View className='ba-confirm__diff-row'>
                <Text className='ba-confirm__diff-label'>{t('batchPoints.adjust.confirmRemovedUsers' as any)}</Text>
                <Text className='ba-confirm__diff-value ba-confirm__diff-value--removed'>-{removedUserIds.size}</Text>
              </View>

              {/* Added user nicknames */}
              {addedUsers.length > 0 && (
                <View className='ba-confirm__names-section'>
                  <Text className='ba-confirm__names-label'>{t('batchPoints.adjust.confirmAddedUsers' as any)}</Text>
                  <View className='ba-confirm__names'>
                    {addedUsers.map((u) => (
                      <Text key={u.userId} className='ba-confirm__name-tag ba-confirm__name-tag--added'>{u.nickname}</Text>
                    ))}
                  </View>
                </View>
              )}

              {/* Removed user nicknames */}
              {removedUsers.length > 0 && (
                <View className='ba-confirm__names-section'>
                  <Text className='ba-confirm__names-label'>{t('batchPoints.adjust.confirmRemovedUsers' as any)}</Text>
                  <View className='ba-confirm__names'>
                    {removedUsers.map((d) => (
                      <Text key={d.userId} className='ba-confirm__name-tag ba-confirm__name-tag--removed'>{d.nickname}</Text>
                    ))}
                  </View>
                </View>
              )}

              {/* Points comparison */}
              <View className='ba-confirm__diff-row'>
                <Text className='ba-confirm__diff-label'>{t('batchPoints.adjust.confirmOriginalPointsPerPerson' as any)}</Text>
                <Text className='ba-confirm__diff-value'>{originalPoints} {t('batchPoints.page.pointsUnit')}</Text>
              </View>
              <View className='ba-confirm__diff-row'>
                <Text className='ba-confirm__diff-label'>{t('batchPoints.adjust.confirmNewPointsPerPerson' as any)}</Text>
                <Text className='ba-confirm__diff-value'>{autoPoints} {t('batchPoints.page.pointsUnit')}</Text>
              </View>

              {/* Total delta */}
              <View className='ba-confirm__diff-row ba-confirm__diff-row--highlight'>
                <Text className='ba-confirm__diff-label'>{t('batchPoints.adjust.confirmTotalDelta' as any)}</Text>
                <Text className={`ba-confirm__diff-value ${totalDelta > 0 ? 'ba-confirm__diff-value--added' : totalDelta < 0 ? 'ba-confirm__diff-value--removed' : ''}`}>
                  {formatDelta(totalDelta)} {t('batchPoints.page.pointsUnit')}
                </Text>
              </View>

              {/* Role info */}
              <View className='ba-confirm__diff-row'>
                <Text className='ba-confirm__diff-label'>{t('batchPoints.page.confirmTargetRole')}</Text>
                <Text className={`role-badge ${currentRoleTab?.className || ''}`}>
                  {currentRoleTab ? t(currentRoleTab.labelKey) : targetRole}
                </Text>
              </View>
              {targetRole === 'Speaker' && speakerTypeLabel && (
                <View className='ba-confirm__diff-row'>
                  <Text className='ba-confirm__diff-label'>{t('batchPoints.page.confirmSpeakerType' as any)}</Text>
                  <Text className='ba-confirm__diff-value'>{t(speakerTypeLabel as any)}</Text>
                </View>
              )}
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={handleCloseConfirm}>
                <Text>{t('batchPoints.adjust.confirmCancel' as any)}</Text>
              </View>
              <View
                className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmit}
              >
                <Text>{submitting ? t('batchPoints.adjust.submitting' as any) : t('batchPoints.adjust.confirmSubmit' as any)}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
