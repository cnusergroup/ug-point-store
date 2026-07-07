import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { useSuperAdminGuard } from '../../hooks/useSuperAdminGuard';
import './ugl-exit-review.scss';

/** A single row of the SuperAdmin-facing Pending_Exit_List (mirrors backend `PendingExitRecord`). */
interface PendingExitRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  triggeredQuarter: string;
  markedAt: string;
}

interface PendingExitListResponse {
  records: PendingExitRecord[];
}

type ReviewAction = 'confirm-exit' | 'restore-tracking';

export default function AdminUGLExitReviewPage() {
  const { isSuperAdmin, ready } = useSuperAdminGuard();
  const { t } = useTranslation();

  const [records, setRecords] = useState<PendingExitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // Review confirmation dialog state
  const [reviewTarget, setReviewTarget] = useState<PendingExitRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction>('confirm-exit');
  const [reviewError, setReviewError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const fetchPendingList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<PendingExitListResponse>({
        url: '/api/admin/ugl-exit/pending',
      });
      setRecords(res.records || []);
    } catch (err) {
      if (err instanceof RequestError && err.statusCode === 403) {
        setForbidden(true);
      }
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!isSuperAdmin) return;
    fetchPendingList();
  }, [ready, isSuperAdmin, fetchPendingList]);

  const handleBack = () => goBack('/pages/admin/index');

  const formatTime = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // --- Review dialog actions ---
  const openReview = (record: PendingExitRecord, action: ReviewAction) => {
    setReviewTarget(record);
    setReviewAction(action);
    setReviewError('');
  };

  const closeReview = () => {
    setReviewTarget(null);
    setReviewError('');
  };

  const handleReviewSubmit = async () => {
    if (!reviewTarget) return;
    setReviewSubmitting(true);
    setReviewError('');
    try {
      const endpoint = reviewAction === 'confirm-exit'
        ? `/api/admin/ugl-exit/${reviewTarget.userId}/confirm-exit`
        : `/api/admin/ugl-exit/${reviewTarget.userId}/restore-tracking`;
      await request({
        url: endpoint,
        method: 'POST',
      });
      Taro.showToast({
        title: reviewAction === 'confirm-exit'
          ? t('admin.uglExitReview.confirmExitSuccess')
          : t('admin.uglExitReview.restoreTrackingSuccess'),
        icon: 'none',
      });
      closeReview();
      fetchPendingList();
    } catch (err) {
      if (err instanceof RequestError && err.statusCode === 403) {
        // Backend 403 is authoritative — hide the page rather than render partial data.
        setForbidden(true);
        setRecords([]);
        closeReview();
      } else if (err instanceof RequestError && (err.code === 'NOT_PENDING_EXIT' || err.code === 'FORBIDDEN')) {
        setReviewError(err.message || t('common.operationFailed'));
      } else {
        setReviewError(err instanceof RequestError ? err.message : t('common.operationFailed'));
      }
    } finally {
      setReviewSubmitting(false);
    }
  };

  /* ─── Auth guard ─── */
  if (!ready) {
    return <View className='admin-loading'><Text>{t('common.loading')}</Text></View>;
  }

  if (!isSuperAdmin || forbidden) {
    return (
      <View className='admin-forbidden'>
        <Text className='admin-forbidden__text'>{t('common.forbidden') || 'Access denied'}</Text>
        <Text className='admin-forbidden__link' onClick={() => Taro.redirectTo({ url: '/pages/admin/index' })}>
          {t('admin.uglExitReview.backButton')}
        </Text>
      </View>
    );
  }

  return (
    <View className='ugl-exit-review'>
      {/* Toolbar */}
      <View className='ugl-exit-review__toolbar'>
        <View className='ugl-exit-review__back' onClick={handleBack}>
          <Text>{t('admin.uglExitReview.backButton')}</Text>
        </View>
        <Text className='ugl-exit-review__title'>{t('admin.uglExitReview.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Pending Exit List */}
      {loading ? (
        <View className='admin-wishes-loading'><Text>{t('common.loading')}</Text></View>
      ) : records.length === 0 ? (
        <View className='admin-wishes-empty'>
          <Text className='admin-wishes-empty__text'>{t('common.noData')}</Text>
        </View>
      ) : (
        <View className='ugl-exit-list'>
          {records.map((record) => (
            <View key={record.userId} className='ugl-exit-row'>
              <View className='ugl-exit-row__info'>
                <Text className='ugl-exit-row__nickname'>{record.nickname}</Text>
                <Text className='ugl-exit-row__meta'>{record.email}</Text>
                <Text className='ugl-exit-row__meta'>{record.ugName}</Text>
                <View className='ugl-exit-row__bottom'>
                  <Text className='ugl-exit-row__quarter'>
                    {t('admin.uglExitReview.triggeredQuarterLabel')}: {record.triggeredQuarter}
                  </Text>
                  <Text className='ugl-exit-row__time'>{formatTime(record.markedAt)}</Text>
                </View>
              </View>
              <View className='ugl-exit-row__actions'>
                <View
                  className='ugl-exit-row__action-btn ugl-exit-row__action-btn--danger'
                  onClick={() => openReview(record, 'confirm-exit')}
                >
                  <Text>{t('admin.uglExitReview.confirmExitButton')}</Text>
                </View>
                <View
                  className='ugl-exit-row__action-btn ugl-exit-row__action-btn--secondary'
                  onClick={() => openReview(record, 'restore-tracking')}
                >
                  <Text>{t('admin.uglExitReview.restoreTrackingButton')}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Review confirmation dialog */}
      {reviewTarget && (
        <View className='wish-form-overlay'>
          <View className='wish-form-modal'>
            <View className='wish-form-modal__header'>
              <Text className='wish-form-modal__title'>
                {reviewAction === 'confirm-exit'
                  ? t('admin.uglExitReview.confirmExitTitle')
                  : t('admin.uglExitReview.restoreTrackingTitle')}
              </Text>
              <View className='wish-form-modal__close' onClick={closeReview}><Text>✕</Text></View>
            </View>
            {reviewError && (
              <View className='wish-form-modal__error'><Text>{reviewError}</Text></View>
            )}
            <View className='wish-form-modal__body'>
              <Text className='wish-confirm-text'>
                {reviewAction === 'confirm-exit'
                  ? t('admin.uglExitReview.confirmExitConfirmText', { nickname: reviewTarget.nickname })
                  : t('admin.uglExitReview.restoreTrackingConfirmText', { nickname: reviewTarget.nickname })}
              </Text>
            </View>
            <View className='wish-form-modal__actions'>
              <View className='wish-form-modal__cancel' onClick={closeReview}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`wish-form-modal__submit ${reviewAction === 'confirm-exit' ? 'wish-form-modal__submit--danger' : ''} ${reviewSubmitting ? 'wish-form-modal__submit--loading' : ''}`}
                onClick={handleReviewSubmit}
              >
                <Text>
                  {reviewSubmitting
                    ? t('common.submitting')
                    : reviewAction === 'confirm-exit'
                      ? t('admin.uglExitReview.confirmExitButton')
                      : t('admin.uglExitReview.restoreTrackingButton')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
