import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { DistributionRecord } from '@points-mall/shared';
import './batch-history.scss';

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { labelKey: string; className: string }> = {
  UserGroupLeader: { labelKey: 'batchPoints.page.roleLeader', className: 'role-badge--leader' },
  Speaker: { labelKey: 'batchPoints.page.roleSpeaker', className: 'role-badge--speaker' },
  Volunteer: { labelKey: 'batchPoints.page.roleVolunteer', className: 'role-badge--volunteer' },
  SpecialActivity: { labelKey: 'batchPoints.history.roleSpecialActivity', className: 'role-badge--special-activity' },
  SpecialReward: { labelKey: 'batchPoints.history.roleSpecialReward', className: 'role-badge--special-reward' },
};

/** activityType filter options. Empty string '' means "all". */
const ACTIVITY_TYPE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'batchPoints.history.activityTypeAll' },
  { value: '线上活动', labelKey: 'batchPoints.history.activityTypeOnline' },
  { value: '线下活动', labelKey: 'batchPoints.history.activityTypeOffline' },
  { value: '季度贡献奖', labelKey: 'batchPoints.history.activityTypeQuarterly' },
  { value: '特殊活动', labelKey: 'batchPoints.history.activityTypeSpecial' },
  { value: '特殊奖励', labelKey: 'batchPoints.history.activityTypeSpecialReward' },
];

export default function BatchHistoryPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const isAdmin = userRoles.includes('Admin') || isSuperAdmin;
  const { t } = useTranslation();

  const [records, setRecords] = useState<DistributionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Search filter for activity topic / UG name
  const [searchQuery, setSearchQuery] = useState('');

  // ActivityType server-side filter ('' = all)
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>('');

  // Secondary awardTagName filter (only shown when activityTypeFilter === '特殊活动')
  const [awardTagFilter, setAwardTagFilter] = useState<string>('');

  // Secondary rewardTagName filter (only shown when activityTypeFilter === '特殊奖励')
  const [rewardTagFilter, setRewardTagFilter] = useState<string>('');

  // Expanded record detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailCache, setDetailCache] = useState<Record<string, DistributionRecord>>({});

  const fetchHistory = useCallback(
    async (
      append = false,
      cursor?: string | null,
      filters?: { activityType?: string; awardTagName?: string; rewardTagName?: string },
    ) => {
      if (!append) setLoading(true);
      try {
        let url = '/api/admin/batch-points/history?pageSize=20';
        if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;
        if (filters?.activityType) url += `&activityType=${encodeURIComponent(filters.activityType)}`;
        if (filters?.awardTagName) url += `&awardTagName=${encodeURIComponent(filters.awardTagName)}`;
        if (filters?.rewardTagName) url += `&rewardTagName=${encodeURIComponent(filters.rewardTagName)}`;

        const res = await request<{ distributions: DistributionRecord[]; lastKey?: string }>({ url });
        if (append) {
          setRecords((prev) => [...prev, ...(res.distributions || [])]);
        } else {
          setRecords(res.distributions || []);
        }
        setLastKey(res.lastKey || null);
      } catch {
        if (!append) setRecords([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    if (!isAdmin) {
      Taro.redirectTo({ url: '/pages/admin/index' });
      return;
    }
    // Initial load: no filters applied (matches previous behavior).
    fetchHistory(false, null, {});
  }, [isAuthenticated, isAdmin, fetchHistory]);

  // Re-fetch from page 1 whenever the activityType or awardTag filter changes.
  // We skip the initial render path (handled above) by only re-fetching when
  // either filter has a non-default value OR was previously non-default.
  useEffect(() => {
    if (!isAdmin) return;
    fetchHistory(false, null, {
      activityType: activityTypeFilter || undefined,
      awardTagName: awardTagFilter.trim() || undefined,
      rewardTagName: rewardTagFilter.trim() || undefined,
    });
    // Reset expanded state when filters change so users see consistent results
    setExpandedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityTypeFilter, awardTagFilter, rewardTagFilter]);

  // Client-side filter by activity topic or UG name
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.trim().toLowerCase();
    return records.filter((r) => {
      const topicMatch = r.activityTopic?.toLowerCase().includes(q);
      const ugMatch = r.activityUG?.toLowerCase().includes(q);
      return topicMatch || ugMatch;
    });
  }, [records, searchQuery]);

  // Auto-load more pages when search query filters out most records
  // so the user sees enough results without manually clicking "Load More"
  useEffect(() => {
    if (!searchQuery.trim()) return;
    if (loading) return;
    if (!lastKey) return;
    // Auto-load next page if we have a search query but very few visible results
    if (filteredRecords.length < 10) {
      fetchHistory(true, lastKey, {
        activityType: activityTypeFilter || undefined,
        awardTagName: awardTagFilter.trim() || undefined,
        rewardTagName: rewardTagFilter.trim() || undefined,
      });
    }
  }, [searchQuery, filteredRecords.length, lastKey, loading, fetchHistory, activityTypeFilter, awardTagFilter, rewardTagFilter]);

  const handleLoadMore = () => {
    if (lastKey) {
      fetchHistory(true, lastKey, {
        activityType: activityTypeFilter || undefined,
        awardTagName: awardTagFilter.trim() || undefined,
        rewardTagName: rewardTagFilter.trim() || undefined,
      });
    }
  };

  const handleToggleDetail = async (distributionId: string) => {
    // Collapse if already expanded
    if (expandedId === distributionId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(distributionId);
    setDetailError('');

    // Use cache if available
    if (detailCache[distributionId]) return;

    setDetailLoading(true);
    try {
      const res = await request<{ distribution: DistributionRecord }>({
        url: `/api/admin/batch-points/history/${distributionId}`,
      });
      setDetailCache((prev) => ({ ...prev, [distributionId]: res.distribution }));
    } catch (err) {
      setDetailError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setDetailLoading(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleBack = () => goBack('/pages/admin/index');

  // Picker range labels — translated at render time
  const activityTypeLabels = ACTIVITY_TYPE_OPTIONS.map((opt) => t(opt.labelKey));
  const activityTypeValues = ACTIVITY_TYPE_OPTIONS.map((opt) => opt.value);
  const selectedActivityTypeIndex = Math.max(0, activityTypeValues.indexOf(activityTypeFilter));

  const showAwardTagFilter = activityTypeFilter === '特殊活动';
  const showRewardTagFilter = activityTypeFilter === '特殊奖励';

  return (
    <View className='batch-history'>
      {/* Toolbar */}
      <View className='batch-history__toolbar'>
        <View className='batch-history__back' onClick={handleBack}>
          <Text>{t('batchPoints.history.backButton')}</Text>
        </View>
        <Text className='batch-history__title'>{t('batchPoints.history.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Permission check */}
      {!isAdmin ? (
        <View className='bh-denied'>
          <Text className='bh-denied__icon'>{t('batchPoints.history.permissionDeniedIcon')}</Text>
          <Text className='bh-denied__text'>{t('batchPoints.history.permissionDenied')}</Text>
        </View>
      ) : (
        <>
          {/* ActivityType filter dropdown + secondary awardTagName filter */}
          <View className='bh-filter'>
            <View className='bh-filter__group'>
              <Text className='bh-filter__label'>
                {t('batchPoints.history.activityTypeFilterLabel')}
              </Text>
              <Picker
                mode='selector'
                range={activityTypeLabels}
                value={selectedActivityTypeIndex}
                onChange={(e) => {
                  const idx = Number(e.detail.value);
                  const newValue = activityTypeValues[idx];
                  setActivityTypeFilter(newValue);
                  // Clear awardTag filter when switching away from "特殊活动"
                  if (newValue !== '特殊活动') {
                    setAwardTagFilter('');
                  }
                  // Clear rewardTag filter when switching away from "特殊奖励"
                  if (newValue !== '特殊奖励') {
                    setRewardTagFilter('');
                  }
                }}
              >
                <View className='bh-filter__select'>
                  {activityTypeLabels[selectedActivityTypeIndex] ||
                    t('batchPoints.history.activityTypeAll')}
                </View>
              </Picker>
            </View>

            {/* Secondary filter: awardTagName, only when "特殊活动" is selected */}
            {showAwardTagFilter && (
              <View className='bh-filter__group'>
                <Text className='bh-filter__label'>
                  {t('batchPoints.history.awardTagLabel')}
                </Text>
                <Input
                  className='bh-filter__input'
                  value={awardTagFilter}
                  onInput={(e) => setAwardTagFilter(e.detail.value)}
                  placeholder={t('batchPoints.history.awardTagFilterPlaceholder')}
                />
              </View>
            )}

            {/* Secondary filter: rewardTagName, only when "特殊奖励" is selected */}
            {showRewardTagFilter && (
              <View className='bh-filter__group'>
                <Text className='bh-filter__label'>
                  {t('batchPoints.history.rewardTagLabel')}
                </Text>
                <Input
                  className='bh-filter__input'
                  value={rewardTagFilter}
                  onInput={(e) => setRewardTagFilter(e.detail.value)}
                  placeholder={t('batchPoints.history.rewardTagFilterPlaceholder')}
                />
              </View>
            )}
          </View>

          {loading ? (
            <View className='bh-loading'><Text>{t('batchPoints.history.loading')}</Text></View>
          ) : records.length === 0 ? (
            <View className='bh-empty'>
              <Text className='bh-empty__icon'>{t('batchPoints.history.emptyIcon')}</Text>
              <Text className='bh-empty__text'>{t('batchPoints.history.empty')}</Text>
            </View>
          ) : (
            <>
              {/* Search bar for activity topic / UG name */}
              <View className='bh-search'>
                <Input
                  className='bh-search__input'
                  value={searchQuery}
                  onInput={(e) => setSearchQuery(e.detail.value)}
                  placeholder={t('batchPoints.history.searchPlaceholder' as any)}
                />
              </View>

              {filteredRecords.length === 0 ? (
                <View className='bh-empty'>
                  <Text className='bh-empty__icon'>🔍</Text>
                  <Text className='bh-empty__text'>{t('batchPoints.history.noSearchResults' as any)}</Text>
                </View>
              ) : (
                <View className='bh-list'>
                  {filteredRecords.map((record) => {
                    const roleConfig = ROLE_CONFIG[record.targetRole];
                    const isExpanded = expandedId === record.distributionId;
                    const detail = detailCache[record.distributionId];
                    // Prefer the more detailed record (cached detail) for awardTag display
                    const awardTagDisplay =
                      detail?.awardTagDisplayName ?? record.awardTagDisplayName;
                    // Reward tag display (SpecialReward records only)
                    const rewardTagDisplay =
                      detail?.rewardTagDisplayName ?? record.rewardTagDisplayName;

                    return (
                      <View
                        key={record.distributionId}
                        className={`bh-record ${isExpanded ? 'bh-record--expanded' : ''}`}
                        onClick={() => handleToggleDetail(record.distributionId)}
                      >
                        <View className='bh-record__summary'>
                          {/* Top: distributor + role badge + adjusted badge */}
                          <View className='bh-record__top'>
                            <Text className='bh-record__distributor'>{record.distributorNickname}</Text>
                            <Text className={`role-badge ${roleConfig?.className || ''}`}>
                              {roleConfig ? t(roleConfig.labelKey) : record.targetRole}
                            </Text>
                            {record.adjustedAt && (
                              <Text className='bh-adjusted-badge'>
                                {t('batchPoints.history.adjustedBadge' as any)}
                              </Text>
                            )}
                          </View>

                          {/* Activity summary: type badge + UG + topic */}
                          {record.activityTopic && (
                            <View className='bh-activity-summary'>
                              {record.activityType && (
                                <Text className={`bh-activity-badge bh-activity-badge--${record.activityType === '线上活动' ? 'online' : record.activityType === '特殊活动' ? 'special' : record.activityType === '特殊奖励' ? 'special-reward' : 'offline'}`}>
                                  {record.activityType}
                                </Text>
                              )}
                              {record.activityUG && (
                                <Text className='bh-activity-summary__ug'>{record.activityUG}</Text>
                              )}
                              <Text className='bh-activity-summary__topic'>{record.activityTopic}</Text>
                            </View>
                          )}

                          {/* Award tag inline pill (SpecialActivity only) */}
                          {awardTagDisplay && (
                            <View className='bh-award-tag-row'>
                              <Text className='bh-award-tag-row__label'>
                                {t('batchPoints.history.awardTagLabel')}:
                              </Text>
                              <Text className='bh-award-tag-row__value'>{awardTagDisplay}</Text>
                            </View>
                          )}

                          {/* Reward tag inline pill (SpecialReward only) */}
                          {rewardTagDisplay && (
                            <View className='bh-award-tag-row'>
                              <Text className='bh-award-tag-row__label'>
                                {t('batchPoints.history.rewardTagLabel')}:
                              </Text>
                              <Text className='bh-award-tag-row__value'>{rewardTagDisplay}</Text>
                            </View>
                          )}

                          {/* Meta: recipient count + points per person */}
                          <View className='bh-record__meta'>
                            <Text className='bh-record__meta-item'>
                              {t('batchPoints.history.recipientCount')}: <Text className='bh-record__meta-value'>{record.recipientIds.length}</Text>
                            </Text>
                            <Text className='bh-record__meta-item'>
                              {t('batchPoints.history.pointsPerPerson')}: <Text className='bh-record__meta-highlight'>{record.points}</Text>
                            </Text>
                          </View>

                          {/* Reason */}
                          <View className='bh-record__reason-row'>
                            <Text className='bh-record__reason-label'>{t('batchPoints.history.reason')}:</Text>
                            <Text className='bh-record__reason-text'>{record.reason}</Text>
                          </View>

                          {/* Time */}
                          <Text className='bh-record__time'>{formatTime(record.createdAt)}</Text>

                          {/* Expand hint */}
                          <Text className='bh-record__expand-hint'>
                            {isExpanded ? t('batchPoints.history.collapseDetail') : t('batchPoints.history.expandDetail')}
                          </Text>
                        </View>

                        {/* Expanded Detail */}
                        {isExpanded && (
                          <View className='bh-detail' onClick={(e) => e.stopPropagation()}>
                            {/* Full activity info in detail view */}
                            {record.activityTopic && (
                              <View className='bh-activity-detail'>
                                <Text className='bh-activity-detail__title'>{t('batchPoints.history.activityLabel' as any)}</Text>
                                <View className='bh-activity-detail__grid'>
                                  <View className='bh-activity-detail__row'>
                                    <Text className='bh-activity-detail__label'>{t('batchPoints.history.activityTypeLabel' as any)}</Text>
                                    <Text className={`bh-activity-badge bh-activity-badge--${record.activityType === '线上活动' ? 'online' : record.activityType === '特殊活动' ? 'special' : record.activityType === '特殊奖励' ? 'special-reward' : 'offline'}`}>
                                      {record.activityType || '-'}
                                    </Text>
                                  </View>
                                  <View className='bh-activity-detail__row'>
                                    <Text className='bh-activity-detail__label'>{t('batchPoints.history.activityUGLabel' as any)}</Text>
                                    <Text className='bh-activity-detail__value'>{record.activityUG || '-'}</Text>
                                  </View>
                                  <View className='bh-activity-detail__row'>
                                    <Text className='bh-activity-detail__label'>{t('batchPoints.history.activityTopicLabel' as any)}</Text>
                                    <Text className='bh-activity-detail__value'>{record.activityTopic}</Text>
                                  </View>
                                  <View className='bh-activity-detail__row'>
                                    <Text className='bh-activity-detail__label'>{t('batchPoints.history.activityDateLabel' as any)}</Text>
                                    <Text className='bh-activity-detail__value'>{record.activityDate || '-'}</Text>
                                  </View>
                                  {/* AwardTag row in detail (only when present) */}
                                  {awardTagDisplay && (
                                    <View className='bh-activity-detail__row'>
                                      <Text className='bh-activity-detail__label'>
                                        {t('batchPoints.history.awardTagLabel')}
                                      </Text>
                                      <Text className='bh-activity-detail__value'>{awardTagDisplay}</Text>
                                    </View>
                                  )}
                                  {/* RewardTag row in detail (only when present) */}
                                  {rewardTagDisplay && (
                                    <View className='bh-activity-detail__row'>
                                      <Text className='bh-activity-detail__label'>
                                        {t('batchPoints.history.rewardTagLabel')}
                                      </Text>
                                      <Text className='bh-activity-detail__value'>{rewardTagDisplay}</Text>
                                    </View>
                                  )}
                                </View>
                              </View>
                            )}

                            <Text className='bh-detail__header'>
                              {t('batchPoints.history.detailHeader')} ({detail?.recipientDetails?.length || record.recipientIds.length})
                            </Text>

                            {detailLoading && !detail && (
                              <Text className='bh-detail__loading'>{t('batchPoints.history.detailLoading')}</Text>
                            )}

                            {detailError && !detail && (
                              <Text className='bh-detail__error'>{detailError}</Text>
                            )}

                            {detail?.recipientDetails?.map((recipient) => (
                              <View key={recipient.userId} className='bh-recipient'>
                                <View>
                                  <Text className='bh-recipient__nickname'>{recipient.nickname}</Text>
                                  <Text className='bh-recipient__email'>{recipient.email}</Text>
                                </View>
                              </View>
                            ))}

                            {/* Skill Claims Detail */}
                            {(detail || record).skillClaims && (detail || record).skillClaims!.length > 0 && (
                              <View className='bh-skill-claims'>
                                <Text className='bh-skill-claims__header'>
                                  {t('skillClaims.history.skillDetailHeader')}
                                </Text>
                                {(detail || record).skillClaims!.map((claim) => (
                                  <View key={`${claim.skill}-${claim.userId}`} className='bh-skill-claims__item'>
                                    <Text className='bh-skill-claims__skill'>
                                      {t(`skillClaims.skillName.${claim.skill}` as any)}
                                    </Text>
                                    <Text className='bh-skill-claims__nickname'>{claim.userNickname}</Text>
                                    <Text className='bh-skill-claims__points'>
                                      +{claim.pointsAwarded} {t('skillClaims.history.pointsUnit')}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}

                            {/* Adjustment metadata */}
                            {(detail || record).adjustedAt && (
                              <View className='bh-adjusted-meta'>
                                <View className='bh-adjusted-meta__row'>
                                  <Text className='bh-adjusted-meta__label'>
                                    {t('batchPoints.history.adjustedAt' as any)}
                                  </Text>
                                  <Text className='bh-adjusted-meta__value'>
                                    {formatTime((detail || record).adjustedAt!)}
                                  </Text>
                                </View>
                                <View className='bh-adjusted-meta__row'>
                                  <Text className='bh-adjusted-meta__label'>
                                    {t('batchPoints.history.adjustedBy' as any)}
                                  </Text>
                                  <Text className='bh-adjusted-meta__value'>
                                    {(detail || record).adjustedBy}
                                  </Text>
                                </View>
                              </View>
                            )}

                            {/* Adjust button - SuperAdmin only */}
                            {isSuperAdmin && (
                              <View
                                className='bh-adjust-button'
                                onClick={(e) => {
                                  e.stopPropagation();
                                  Taro.navigateTo({
                                    url: `/pages/admin/batch-adjust?distributionId=${record.distributionId}`,
                                  });
                                }}
                              >
                                <Text>{t('batchPoints.history.adjustButton' as any)}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* Load More */}
                  {lastKey && (
                    <View className='bh-list__load-more' onClick={handleLoadMore}>
                      <Text>{t('batchPoints.history.loadMore')}</Text>
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
