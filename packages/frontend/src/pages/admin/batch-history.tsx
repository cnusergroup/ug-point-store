import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input } from '@tarojs/components';
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
};

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

  // Expanded record detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailCache, setDetailCache] = useState<Record<string, DistributionRecord>>({});

  const fetchHistory = useCallback(async (append = false, cursor?: string | null) => {
    if (!append) setLoading(true);
    try {
      let url = '/api/admin/batch-points/history?pageSize=20';
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

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
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    if (!isAdmin) {
      Taro.redirectTo({ url: '/pages/admin/index' });
      return;
    }
    fetchHistory();
  }, [isAuthenticated, isAdmin, fetchHistory]);

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

  const handleLoadMore = () => {
    if (lastKey) {
      fetchHistory(true, lastKey);
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
      ) : loading ? (
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
                            <Text className={`bh-activity-badge bh-activity-badge--${record.activityType === '线上活动' ? 'online' : 'offline'}`}>
                              {record.activityType}
                            </Text>
                          )}
                          {record.activityUG && (
                            <Text className='bh-activity-summary__ug'>{record.activityUG}</Text>
                          )}
                          <Text className='bh-activity-summary__topic'>{record.activityTopic}</Text>
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
                                <Text className={`bh-activity-badge bh-activity-badge--${record.activityType === '线上活动' ? 'online' : 'offline'}`}>
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
    </View>
  );
}
