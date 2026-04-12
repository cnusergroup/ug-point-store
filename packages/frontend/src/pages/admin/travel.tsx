import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { GlobeIcon } from '../../components/icons';
import type { TravelApplication } from '@points-mall/shared';
import './travel.scss';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_TABS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'travel.review.filterAll' },
  { key: 'pending', labelKey: 'travel.review.filterPending' },
  { key: 'approved', labelKey: 'travel.review.filterApproved' },
  { key: 'rejected', labelKey: 'travel.review.filterRejected' },
];

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: 'travel.review.statusPending', className: 'travel-status--pending' },
  approved: { labelKey: 'travel.review.statusApproved', className: 'travel-status--approved' },
  rejected: { labelKey: 'travel.review.statusRejected', className: 'travel-status--rejected' },
};

export default function AdminTravelPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  const [applications, setApplications] = useState<TravelApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reject modal state
  const [rejectApp, setRejectApp] = useState<TravelApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Approve modal state
  const [approveApp, setApproveApp] = useState<TravelApplication | null>(null);
  const [approving, setApproving] = useState(false);

  const fetchApplications = useCallback(
    async (filter: StatusFilter, append = false, cursor?: string | null) => {
      if (!append) setLoading(true);
      try {
        let url = '/api/admin/travel/applications?pageSize=20';
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
    fetchApplications(statusFilter);
  }, [isAuthenticated, fetchApplications, statusFilter]);

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

  // Approve modal handlers
  const openApprove = (app: TravelApplication) => setApproveApp(app);
  const closeApprove = () => setApproveApp(null);

  const handleApprove = async () => {
    if (!approveApp || approving) return;
    setApproving(true);
    try {
      await request({
        url: `/api/admin/travel/${approveApp.applicationId}/review`,
        method: 'PATCH',
        data: { action: 'approve' },
      });
      Taro.showToast({ title: t('travel.review.approved'), icon: 'none' });
      closeApprove();
      setExpandedId(null);
      fetchApplications(statusFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('common.operationFailed'),
        icon: 'none',
      });
    } finally {
      setApproving(false);
    }
  };

  // Reject modal handlers
  const openReject = (app: TravelApplication) => {
    setRejectApp(app);
    setRejectReason('');
    setRejectError('');
  };

  const closeReject = () => {
    setRejectApp(null);
    setRejectError('');
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    if (reason && reason.length > 500) {
      setRejectError(t('travel.review.rejectReasonError'));
      return;
    }
    if (!rejectApp) return;
    setRejecting(true);
    setRejectError('');
    try {
      await request({
        url: `/api/admin/travel/${rejectApp.applicationId}/review`,
        method: 'PATCH',
        data: { action: 'reject', ...(reason ? { rejectReason: reason } : {}) },
      });
      Taro.showToast({ title: t('travel.review.rejected'), icon: 'none' });
      closeReject();
      setExpandedId(null);
      fetchApplications(statusFilter);
    } catch (err) {
      setRejectError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setRejecting(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-travel'>
      {/* Toolbar */}
      <View className='admin-travel__toolbar'>
        <View className='admin-travel__back' onClick={handleBack}>
          <Text>{t('travel.review.backButton')}</Text>
        </View>
        <Text className='admin-travel__title'>{t('travel.review.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Status Filter Tabs */}
      <View className='travel-review-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`travel-review-tabs__item ${statusFilter === tab.key ? 'travel-review-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Application List */}
      {loading ? (
        <View className='admin-loading'>
          <Text>{t('travel.review.loading')}</Text>
        </View>
      ) : applications.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>
            <GlobeIcon size={48} color='var(--text-tertiary)' />
          </Text>
          <Text className='admin-empty__text'>{t('travel.review.noRecords')}</Text>
        </View>
      ) : (
        <View className='travel-review-list'>
          {applications.map((app) => {
            const st = STATUS_CONFIG[app.status] || STATUS_CONFIG.pending;
            const isExpanded = expandedId === app.applicationId;
            const categoryKey =
              app.category === 'domestic'
                ? 'travel.review.categoryDomestic'
                : 'travel.review.categoryInternational';

            return (
              <View
                key={app.applicationId}
                className={`travel-review-row ${isExpanded ? 'travel-review-row--expanded' : ''}`}
              >
                {/* Summary row */}
                <View
                  className='travel-review-row__summary'
                  onClick={() => toggleExpand(app.applicationId)}
                >
                  <View className='travel-review-row__info'>
                    <View className='travel-review-row__top'>
                      <Text className='travel-review-row__nickname'>
                        {app.applicantNickname}
                      </Text>
                      <Text
                        className={`travel-category-tag travel-category-tag--${app.category}`}
                      >
                        {t(categoryKey)}
                      </Text>
                      <Text className='travel-review-row__cost'>
                        {app.totalCost.toLocaleString()} {t('travel.review.costUnit')}
                      </Text>
                      <Text className={`travel-status ${st.className}`}>
                        {t(st.labelKey)}
                      </Text>
                    </View>
                    <Text className='travel-review-row__time'>
                      {formatTime(app.createdAt)}
                    </Text>
                  </View>
                  <View className='travel-review-row__arrow'>
                    <Text>›</Text>
                  </View>
                </View>

                {/* Expanded detail */}
                {isExpanded && (
                  <View className='travel-review-detail'>
                    <View className='travel-review-detail__section'>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.applicantLabel')}
                        </Text>
                        <Text className='travel-review-detail__value'>
                          {app.applicantNickname}
                        </Text>
                      </View>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.communityRoleLabel')}
                        </Text>
                        <Text className='travel-review-detail__value'>
                          {app.communityRole}
                        </Text>
                      </View>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.eventLinkLabel')}
                        </Text>
                        <Text className='travel-review-detail__link'>{app.eventLink}</Text>
                      </View>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.cfpScreenshotLabel')}
                        </Text>
                        {app.cfpScreenshotUrl && (
                          <Image
                            src={app.cfpScreenshotUrl}
                            className='travel-review-detail__cfp-img'
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
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.flightCostLabel')}
                        </Text>
                        <Text className='travel-review-detail__value'>
                          {app.flightCost.toLocaleString()} {t('travel.review.costUnit')}
                        </Text>
                      </View>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.hotelCostLabel')}
                        </Text>
                        <Text className='travel-review-detail__value'>
                          {app.hotelCost.toLocaleString()} {t('travel.review.costUnit')}
                        </Text>
                      </View>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.totalCostLabel')}
                        </Text>
                        <Text className='travel-review-detail__value'>
                          {app.totalCost.toLocaleString()} {t('travel.review.costUnit')}
                        </Text>
                      </View>
                      <View className='travel-review-detail__row'>
                        <Text className='travel-review-detail__label'>
                          {t('travel.review.submitTimeLabel')}
                        </Text>
                        <Text className='travel-review-detail__value'>
                          {formatTime(app.createdAt)}
                        </Text>
                      </View>
                    </View>

                    {/* Reject reason */}
                    {app.status === 'rejected' && app.rejectReason && (
                      <View className='travel-review-detail__reject-banner'>
                        <Text className='travel-review-detail__reject-label'>
                          {t('travel.review.rejectReasonLabel')}
                        </Text>
                        <Text className='travel-review-detail__reject-reason'>
                          {app.rejectReason}
                        </Text>
                      </View>
                    )}

                    {/* Review info */}
                    {app.reviewedAt && (
                      <View className='travel-review-detail__review'>
                        {app.reviewerNickname && (
                          <View className='travel-review-detail__row'>
                            <Text className='travel-review-detail__label'>
                              {t('travel.review.reviewerLabel')}
                            </Text>
                            <Text className='travel-review-detail__value'>
                              {app.reviewerNickname}
                            </Text>
                          </View>
                        )}
                        <View className='travel-review-detail__row'>
                          <Text className='travel-review-detail__label'>
                            {t('travel.review.reviewTimeLabel')}
                          </Text>
                          <Text className='travel-review-detail__value'>
                            {formatTime(app.reviewedAt)}
                          </Text>
                        </View>
                      </View>
                    )}

                    {/* Action buttons for pending */}
                    {app.status === 'pending' && (
                      <View className='travel-review-detail__actions'>
                        <View
                          className='btn-danger'
                          style={{ flex: 1, padding: 'var(--space-3)', textAlign: 'center' }}
                          onClick={(e) => { e.stopPropagation(); openReject(app); }}
                        >
                          <Text>{t('travel.review.rejectButton')}</Text>
                        </View>
                        <View
                          className='btn-primary'
                          style={{ flex: 1, padding: 'var(--space-3)', textAlign: 'center' }}
                          onClick={(e) => { e.stopPropagation(); openApprove(app); }}                        >
                          <Text>{t('travel.review.approveButton')}</Text>
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
            <View className='travel-review-list__load-more' onClick={handleLoadMore}>
              <Text>{t('travel.review.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Approve Confirm Modal */}
      {approveApp && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('travel.review.approveTitle')}</Text>
              <View className='form-modal__close' onClick={closeApprove}>
                <Text>✕</Text>
              </View>
            </View>
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('travel.review.approveConfirmText', { applicant: approveApp.applicantNickname })}
              </Text>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeApprove}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${approving ? 'form-modal__submit--loading' : ''}`}
                onClick={handleApprove}
              >
                <Text>{approving ? t('travel.review.approving') : t('travel.review.confirmApprove')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Reject Reason Modal */}
      {rejectApp && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('travel.review.rejectTitle')}</Text>
              <View className='form-modal__close' onClick={closeReject}>
                <Text>✕</Text>
              </View>
            </View>
            {rejectError && (
              <View className='form-modal__error'>
                <Text>{rejectError}</Text>
              </View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('travel.review.rejectConfirmText', {
                  applicant: rejectApp.applicantNickname,
                })}
              </Text>
              <View className='form-field'>
                <Text className='form-field__label'>
                  {t('travel.review.rejectReasonInputLabel')}
                </Text>
                <Input
                  className='form-field__input'
                  value={rejectReason}
                  onInput={(e) => setRejectReason(e.detail.value)}
                  placeholder={t('travel.review.rejectReasonPlaceholder')}
                  maxlength={500}
                />
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeReject}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit form-modal__submit--danger ${rejecting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleReject}
              >
                <Text>
                  {rejecting
                    ? t('travel.review.rejecting')
                    : t('travel.review.confirmReject')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
