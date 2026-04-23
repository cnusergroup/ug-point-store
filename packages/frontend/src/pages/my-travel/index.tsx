import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { GlobeIcon } from '../../components/icons';
import PageToolbar from '../../components/PageToolbar';
import type { TravelApplication, TravelQuota } from '@points-mall/shared';
import './index.scss';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_TABS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'travel.myTravel.filterAll' },
  { key: 'pending', labelKey: 'travel.myTravel.filterPending' },
  { key: 'approved', labelKey: 'travel.myTravel.filterApproved' },
  { key: 'rejected', labelKey: 'travel.myTravel.filterRejected' },
];

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: 'travel.myTravel.statusPending', className: 'travel-status--pending' },
  approved: { labelKey: 'travel.myTravel.statusApproved', className: 'travel-status--approved' },
  rejected: { labelKey: 'travel.myTravel.statusRejected', className: 'travel-status--rejected' },
};

export default function MyTravelPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [quota, setQuota] = useState<TravelQuota | null>(null);
  const [applications, setApplications] = useState<TravelApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<{ domesticThreshold: number; internationalThreshold: number } | null>(null);

  const fetchQuota = useCallback(async () => {
    try {
      const res = await request<TravelQuota>({ url: '/api/travel/quota' });
      setQuota(res);
    } catch {
      // silently fail
    }
  }, []);

  const fetchThresholds = useCallback(async () => {
    try {
      const res = await request<{ travelSponsorshipEnabled: boolean; domesticThreshold: number; internationalThreshold: number }>({
        url: '/api/settings/travel-sponsorship',
        skipAuth: true,
      });
      setThresholds({ domesticThreshold: res.domesticThreshold, internationalThreshold: res.internationalThreshold });
    } catch {
      // silently fail
    }
  }, []);

  const fetchApplications = useCallback(
    async (filter: StatusFilter, append = false, cursor?: string | null) => {
      if (!append) setLoading(true);
      try {
        let url = '/api/travel/my-applications?pageSize=20';
        if (filter !== 'all') url += `&status=${filter}`;
        if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

        const res = await request<{ applications: TravelApplication[]; lastKey?: string }>({
          url,
        });
        if (append) {
          setApplications((prev) => [...prev, ...(res.applications || [])]);
        } else {
          setApplications(res.applications || []);
        }
        setLastKey(res.lastKey || null);
      } catch {
        if (!append) setApplications([]);
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
    fetchQuota();
    fetchThresholds();
    fetchApplications(statusFilter);
  }, [isAuthenticated, fetchQuota, fetchThresholds, fetchApplications, statusFilter]);

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
    setExpandedId(null);
  };

  const handleLoadMore = () => {
    if (lastKey) {
      fetchApplications(statusFilter, true, lastKey);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleEditResubmit = (applicationId: string) => {
    Taro.navigateTo({
      url: `/pages/travel-apply/index?applicationId=${applicationId}`,
    });
  };

  const handleBack = () => goBack('/pages/profile/index');

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <View className='my-travel-page'>
      {/* Toolbar */}
      <PageToolbar title={t('travel.myTravel.title')} onBack={handleBack} />

      {/* Speaker Points Detail Cards */}
      <View className='travel-points-detail'>
        <View className='travel-points-detail__row'>
          <View className='travel-points-detail__card travel-points-detail__card--full'>
            <Text className='travel-points-detail__label'>{t('travel.myTravel.speakerEarnTotal')}</Text>
            <Text className='travel-points-detail__value travel-points-detail__value--earn'>
              {quota ? quota.speakerEarnTotal : '-'}
              <Text className='travel-points-detail__unit'> {t('travel.myTravel.pointsUnit')}</Text>
            </Text>
          </View>
        </View>
        {/* Threshold info */}
        {thresholds && (
          <View className='travel-points-detail__threshold-info'>
            <Text className='travel-points-detail__threshold-text'>
              {t('travel.myTravel.thresholdInfo')
                .replace('{domestic}', thresholds.domesticThreshold.toLocaleString())
                .replace('{international}', thresholds.internationalThreshold.toLocaleString())}
            </Text>
          </View>
        )}
        <View className='travel-points-detail__row'>
          <View className='travel-points-detail__card'>
            <Text className='travel-points-detail__label'>{t('travel.myTravel.domesticAvailableLabel')}</Text>
            <Text className='travel-points-detail__value travel-points-detail__value--threshold'>
              {quota ? quota.domesticAvailable : '-'}
              <Text className='travel-points-detail__unit'>{t('travel.myTravel.quotaUnit')}</Text>
            </Text>
          </View>
          <View className='travel-points-detail__card'>
            <Text className='travel-points-detail__label'>{t('travel.myTravel.internationalAvailableLabel')}</Text>
            <Text className='travel-points-detail__value travel-points-detail__value--threshold'>
              {quota ? quota.internationalAvailable : '-'}
              <Text className='travel-points-detail__unit'>{t('travel.myTravel.quotaUnit')}</Text>
            </Text>
          </View>
        </View>
        <View className='travel-points-detail__row'>
          <View className='travel-points-detail__card'>
            <Text className='travel-points-detail__label'>{t('travel.myTravel.domesticUsedLabel')}</Text>
            <Text className='travel-points-detail__value travel-points-detail__value--used'>
              {quota ? quota.domesticUsedCount : '-'}
              <Text className='travel-points-detail__unit'>{t('travel.myTravel.quotaUnit')}</Text>
            </Text>
          </View>
          <View className='travel-points-detail__card'>
            <Text className='travel-points-detail__label'>{t('travel.myTravel.internationalUsedLabel')}</Text>
            <Text className='travel-points-detail__value travel-points-detail__value--used'>
              {quota ? quota.internationalUsedCount : '-'}
              <Text className='travel-points-detail__unit'>{t('travel.myTravel.quotaUnit')}</Text>
            </Text>
          </View>
        </View>
      </View>

      {/* Notice Banner */}
      <View className='travel-notice-banner'>
        <Text className='travel-notice-banner__text'>{t('travel.myTravel.notice')}</Text>
      </View>

      {/* Status Filter Tabs */}
      <View className='travel-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`travel-tabs__item ${statusFilter === tab.key ? 'travel-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Application List */}
      {loading ? (
        <View className='admin-loading'>
          <Text>{t('travel.myTravel.loading')}</Text>
        </View>
      ) : applications.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>
            <GlobeIcon size={48} color='var(--text-tertiary)' />
          </Text>
          <Text className='admin-empty__text'>{t('travel.myTravel.empty')}</Text>
        </View>
      ) : (
        <View className='travel-list'>
          {applications.map((app) => {
            const st = STATUS_CONFIG[app.status] || STATUS_CONFIG.pending;
            const isExpanded = expandedId === app.applicationId;
            const categoryKey =
              app.category === 'domestic'
                ? 'travel.myTravel.categoryDomestic'
                : 'travel.myTravel.categoryInternational';

            return (
              <View
                key={app.applicationId}
                className={`travel-row ${isExpanded ? 'travel-row--expanded' : ''}`}
              >
                {/* Summary row */}
                <View
                  className='travel-row__summary'
                  onClick={() => toggleExpand(app.applicationId)}
                >
                  <View className='travel-row__info'>
                    <View className='travel-row__top'>
                      <Text
                        className={`travel-category-tag travel-category-tag--${app.category}`}
                      >
                        {t(categoryKey)}
                      </Text>
                      <Text className='travel-row__cost'>
                        {app.totalCost.toLocaleString()} {t('travel.myTravel.costUnit')}
                      </Text>
                      <Text className={`travel-status ${st.className}`}>
                        {t(st.labelKey)}
                      </Text>
                    </View>
                    <Text className='travel-row__time'>{formatTime(app.createdAt)}</Text>
                  </View>
                  <View className='travel-row__arrow'>
                    <Text>›</Text>
                  </View>
                </View>

                {/* Expanded detail */}
                {isExpanded && (
                  <View className='travel-detail'>
                    <View className='travel-detail__section'>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.communityRoleLabel')}
                        </Text>
                        <Text className='travel-detail__value'>{app.communityRole}</Text>
                      </View>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.eventLinkLabel')}
                        </Text>
                        <Text className='travel-detail__link'>{app.eventLink}</Text>
                      </View>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.cfpScreenshotLabel')}
                        </Text>
                        {app.cfpScreenshotUrl && (
                          <Image
                            src={app.cfpScreenshotUrl}
                            className='travel-detail__cfp-img'
                            mode='aspectFill'
                            onClick={() =>
                              Taro.previewImage({
                                current: app.cfpScreenshotUrl,
                                urls: [app.cfpScreenshotUrl],
                              })
                            }
                          />
                        )}
                      </View>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.flightCostLabel')}
                        </Text>
                        <Text className='travel-detail__value'>
                          {app.flightCost.toLocaleString()} {t('travel.myTravel.costUnit')}
                        </Text>
                      </View>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.hotelCostLabel')}
                        </Text>
                        <Text className='travel-detail__value'>
                          {app.hotelCost.toLocaleString()} {t('travel.myTravel.costUnit')}
                        </Text>
                      </View>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.totalCostLabel')}
                        </Text>
                        <Text className='travel-detail__value'>
                          {app.totalCost.toLocaleString()} {t('travel.myTravel.costUnit')}
                        </Text>
                      </View>
                      <View className='travel-detail__row'>
                        <Text className='travel-detail__label'>
                          {t('travel.myTravel.submittedAt')}
                        </Text>
                        <Text className='travel-detail__value'>
                          {formatTime(app.createdAt)}
                        </Text>
                      </View>
                    </View>

                    {/* Reject reason */}
                    {app.status === 'rejected' && app.rejectReason && (
                      <View className='travel-detail__reject-banner'>
                        <Text className='travel-detail__reject-label'>
                          {t('travel.myTravel.rejectReasonLabel')}
                        </Text>
                        <Text className='travel-detail__reject-reason'>
                          {app.rejectReason}
                        </Text>
                      </View>
                    )}

                    {/* Review info */}
                    {app.reviewedAt && (
                      <View className='travel-detail__review'>
                        {app.reviewerNickname && (
                          <View className='travel-detail__row'>
                            <Text className='travel-detail__label'>
                              {t('travel.myTravel.reviewerLabel')}
                            </Text>
                            <Text className='travel-detail__value'>
                              {app.reviewerNickname}
                            </Text>
                          </View>
                        )}
                        <View className='travel-detail__row'>
                          <Text className='travel-detail__label'>
                            {t('travel.myTravel.reviewTimeLabel')}
                          </Text>
                          <Text className='travel-detail__value'>
                            {formatTime(app.reviewedAt)}
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Edit & Resubmit button for rejected */}
                    {app.status === 'rejected' && (
                      <View className='travel-detail__actions'>
                        <View
                          className='btn-primary'
                          style={{
                            width: '100%',
                            padding: 'var(--space-3)',
                            textAlign: 'center',
                          }}
                          onClick={() => handleEditResubmit(app.applicationId)}
                        >
                          <Text>{t('travel.myTravel.editResubmit')}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Load More */}
          {lastKey && (
            <View className='travel-list__load-more' onClick={handleLoadMore}>
              <Text>{t('travel.myTravel.loadMore')}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
