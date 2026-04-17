import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { ClaimIcon } from '../../components/icons';
import './reservation-approvals.scss';

/** Reservation approval record returned by the admin API */
interface ReservationApprovalRecord {
  pk: string;
  userId: string;
  contentId: string;
  contentTitle: string;
  reserverNickname: string;
  activityId: string;
  activityType: string;
  activityUG: string;
  activityTopic: string;
  activityDate: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewerId?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** Status filter tab options */
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: 'reservationApprovals.statusPending', className: 'reservation-status--pending' },
  approved: { labelKey: 'reservationApprovals.statusApproved', className: 'reservation-status--approved' },
  rejected: { labelKey: 'reservationApprovals.statusRejected', className: 'reservation-status--rejected' },
};

export default function ReservationApprovalsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);
  const { t } = useTranslation();
  const isSuperAdmin = user?.roles?.includes('SuperAdmin') ?? false;

  // Determine mode from URL params: 'config' = points config only, default = approvals only
  const router = Taro.useRouter();
  const isConfigMode = router.params?.mode === 'config';

  const [reservations, setReservations] = useState<ReservationApprovalRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Reservation approval points config (SuperAdmin only)
  const [reservationApprovalPointsInput, setReservationApprovalPointsInput] = useState('10');
  const [currentPointsValue, setCurrentPointsValue] = useState(10);

  // Approve modal
  const [approveItem, setApproveItem] = useState<ReservationApprovalRecord | null>(null);
  const [approveError, setApproveError] = useState('');
  const [approving, setApproving] = useState(false);

  // Reject modal
  const [rejectItem, setRejectItem] = useState<ReservationApprovalRecord | null>(null);
  const [rejectError, setRejectError] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const fetchReservations = useCallback(async (filter: StatusFilter, append = false, cursor?: string | null) => {
    if (!append) setLoading(true);
    try {
      let url = '/api/admin/reservation-approvals?pageSize=20';
      if (filter !== 'all') url += `&status=${filter}`;
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

      const res = await request<{ reservations: ReservationApprovalRecord[]; lastKey?: string }>({ url });
      if (append) {
        setReservations((prev) => [...prev, ...(res.reservations || [])]);
      } else {
        setReservations(res.reservations || []);
      }
      setLastKey(res.lastKey || null);
    } catch {
      if (!append) setReservations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchReservations(statusFilter);

    // Fetch reservation approval points config (SuperAdmin only)
    if (isSuperAdmin) {
      request<{ reservationApprovalPoints?: number }>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      })
        .then((res) => {
          const val = res.reservationApprovalPoints ?? 10;
          setCurrentPointsValue(val);
          setReservationApprovalPointsInput(String(val));
        })
        .catch(() => {});
    }
  }, [isAuthenticated, fetchReservations, statusFilter, isSuperAdmin]);

  const isValidPositiveInteger = (val: string) => {
    const n = Number(val);
    return Number.isInteger(n) && n > 0;
  };

  const handleReservationApprovalPointsBlur = async () => {
    if (!isValidPositiveInteger(reservationApprovalPointsInput)) {
      Taro.showToast({ title: t('admin.settings.thresholdError'), icon: 'none' });
      setReservationApprovalPointsInput(currentPointsValue > 0 ? String(currentPointsValue) : '10');
      return;
    }
    const newValue = Number(reservationApprovalPointsInput);
    if (newValue !== currentPointsValue) {
      const prev = currentPointsValue;
      setCurrentPointsValue(newValue);
      try {
        // Read current toggles first, then update with new points value
        const current = await request<Record<string, unknown>>({
          url: '/api/settings/feature-toggles',
          skipAuth: true,
        });
        await request({
          url: '/api/admin/settings/feature-toggles',
          method: 'PUT',
          data: { ...current, reservationApprovalPoints: newValue },
        });
        Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
      } catch {
        setCurrentPointsValue(prev);
        setReservationApprovalPointsInput(prev > 0 ? String(prev) : '10');
        Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
      }
    }
  };

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
  };

  const handleLoadMore = () => {
    if (lastKey) {
      fetchReservations(statusFilter, true, lastKey);
    }
  };

  // Approve modal
  const openApprove = (item: ReservationApprovalRecord) => {
    setApproveItem(item);
    setApproveError('');
  };

  const closeApprove = () => {
    setApproveItem(null);
    setApproveError('');
  };

  const handleApprove = async () => {
    if (!approveItem) return;
    setApproving(true);
    setApproveError('');
    try {
      await request({
        url: `/api/admin/reservation-approvals/${encodeURIComponent(approveItem.pk)}/review`,
        method: 'PATCH',
        data: { action: 'approve' },
      });
      Taro.showToast({ title: t('reservationApprovals.approved'), icon: 'none' });
      closeApprove();
      fetchReservations(statusFilter);
    } catch (err) {
      setApproveError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setApproving(false);
    }
  };

  // Reject modal
  const openReject = (item: ReservationApprovalRecord) => {
    setRejectItem(item);
    setRejectError('');
  };

  const closeReject = () => {
    setRejectItem(null);
    setRejectError('');
  };

  const handleReject = async () => {
    if (!rejectItem) return;
    setRejecting(true);
    setRejectError('');
    try {
      await request({
        url: `/api/admin/reservation-approvals/${encodeURIComponent(rejectItem.pk)}/review`,
        method: 'PATCH',
        data: { action: 'reject' },
      });
      Taro.showToast({ title: t('reservationApprovals.rejected'), icon: 'none' });
      closeReject();
      fetchReservations(statusFilter);
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
    <View className='admin-reservation-approvals'>
      {/* Toolbar */}
      <View className='admin-reservation-approvals__toolbar'>
        <View className='admin-reservation-approvals__back' onClick={handleBack}>
          <Text>{t('reservationApprovals.backButton')}</Text>
        </View>
        <Text className='admin-reservation-approvals__title'>
          {isConfigMode ? t('admin.dashboard.reservationPointsConfigTitle') : t('reservationApprovals.title')}
        </Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Reservation Approval Points Config (config mode only) */}
      {isConfigMode && isSuperAdmin && (
        <View className='reservation-points-config'>
          <View className='reservation-points-config__info'>
            <Text className='reservation-points-config__label'>{t('settings.reservationApprovalPoints')}</Text>
            <Text className='reservation-points-config__desc'>{t('settings.reservationApprovalPointsDesc')}</Text>
          </View>
          <View className='reservation-points-config__input'>
            <Input
              type='number'
              value={reservationApprovalPointsInput}
              placeholder='10'
              onInput={(e) => setReservationApprovalPointsInput(e.detail.value)}
              onBlur={handleReservationApprovalPointsBlur}
              className='reservation-points-config__input-field'
            />
          </View>
        </View>
      )}

      {/* Approvals mode: Status Filter Tabs + Reservation List */}
      {!isConfigMode && (
        <>
      {/* Status Filter Tabs */}
      <View className='reservation-tabs'>
        {([
          { key: 'all' as StatusFilter, label: t('reservationApprovals.filterAll') },
          { key: 'pending' as StatusFilter, label: t('reservationApprovals.filterPending') },
          { key: 'approved' as StatusFilter, label: t('reservationApprovals.filterApproved') },
          { key: 'rejected' as StatusFilter, label: t('reservationApprovals.filterRejected') },
        ]).map((tab) => (
          <View
            key={tab.key}
            className={`reservation-tabs__item ${statusFilter === tab.key ? 'reservation-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Reservation List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('reservationApprovals.loading')}</Text></View>
      ) : reservations.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><ClaimIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('reservationApprovals.noRecords')}</Text>
        </View>
      ) : (
        <View className='reservation-list'>
          {reservations.map((item) => {
            const st = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
            return (
              <View key={item.pk} className='reservation-row'>
                {/* Header: content title + status */}
                <View className='reservation-row__header'>
                  <Text className='reservation-row__content-title'>{item.contentTitle}</Text>
                  <Text className={`reservation-status ${st.className}`}>{t(st.labelKey)}</Text>
                </View>

                {/* Activity info */}
                <View className='reservation-row__activity-info'>
                  <View className='reservation-row__activity-row'>
                    <Text className={`activity-type-badge ${item.activityType === '线上' ? 'activity-type-badge--online' : 'activity-type-badge--offline'}`}>
                      {item.activityType}
                    </Text>
                    <Text className='reservation-row__activity-value'>{item.activityUG}</Text>
                  </View>
                  <View className='reservation-row__activity-row'>
                    <Text className='reservation-row__activity-label'>{t('reservationApprovals.topicLabel')}</Text>
                    <Text className='reservation-row__activity-value'>{item.activityTopic}</Text>
                  </View>
                  <View className='reservation-row__activity-row'>
                    <Text className='reservation-row__activity-label'>{t('reservationApprovals.dateLabel')}</Text>
                    <Text className='reservation-row__activity-value'>{item.activityDate}</Text>
                  </View>
                </View>

                {/* Footer: reserver + time + actions */}
                <View className='reservation-row__footer'>
                  <View className='reservation-row__meta'>
                    <Text className='reservation-row__reserver'>{item.reserverNickname}</Text>
                    <Text className='reservation-row__time'>{formatTime(item.createdAt)}</Text>
                  </View>
                  {item.status === 'pending' && (
                    <View className='reservation-row__actions'>
                      <View
                        className='reservation-row__btn reservation-row__btn--approve'
                        onClick={() => openApprove(item)}
                      >
                        <Text>{t('reservationApprovals.approveButton')}</Text>
                      </View>
                      <View
                        className='reservation-row__btn reservation-row__btn--reject'
                        onClick={() => openReject(item)}
                      >
                        <Text>{t('reservationApprovals.rejectButton')}</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            );
          })}

          {/* Load More */}
          {lastKey && (
            <View className='reservation-list__load-more' onClick={handleLoadMore}>
              <Text>{t('reservationApprovals.loadMore')}</Text>
            </View>
          )}
        </View>
      )}
        </>
      )}

      {/* Approve Confirmation Modal */}
      {!isConfigMode && approveItem && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('reservationApprovals.approveTitle')}</Text>
              <View className='form-modal__close' onClick={closeApprove}><Text>✕</Text></View>
            </View>
            {approveError && (
              <View className='form-modal__error'><Text>{approveError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('reservationApprovals.approveConfirmText', {
                  reserver: approveItem.reserverNickname,
                  content: approveItem.contentTitle,
                })}
              </Text>
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('reservationApprovals.activityLabel')}</Text>
                <Text className='detail-section__value'>
                  {approveItem.activityUG} - {approveItem.activityTopic} ({approveItem.activityDate})
                </Text>
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeApprove}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${approving ? 'form-modal__submit--loading' : ''}`}
                onClick={handleApprove}
              >
                <Text>{approving ? t('reservationApprovals.approving') : t('reservationApprovals.confirmApprove')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Reject Confirmation Modal */}
      {!isConfigMode && rejectItem && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('reservationApprovals.rejectTitle')}</Text>
              <View className='form-modal__close' onClick={closeReject}><Text>✕</Text></View>
            </View>
            {rejectError && (
              <View className='form-modal__error'><Text>{rejectError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('reservationApprovals.rejectConfirmText', {
                  reserver: rejectItem.reserverNickname,
                  content: rejectItem.contentTitle,
                })}
              </Text>
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('reservationApprovals.activityLabel')}</Text>
                <Text className='detail-section__value'>
                  {rejectItem.activityUG} - {rejectItem.activityTopic} ({rejectItem.activityDate})
                </Text>
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
                <Text>{rejecting ? t('reservationApprovals.rejecting') : t('reservationApprovals.confirmReject')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
