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

/** A single row of the SuperAdmin-facing Awaiting_Reminder_List (mirrors backend `AwaitingReminderRecord`). */
interface AwaitingReminderRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  quarter: string;
  recordedAt: string;
}

interface AwaitingReminderListResponse {
  items: AwaitingReminderRecord[];
}

/** Summary returned by the Send_Reminder_Action endpoint (mirrors backend `SendReminderActionSummary`). */
interface SendReminderActionSummary {
  sentCount: number;
  alreadySentCount: number;
  sendFailedCount: number;
  errors: number;
}

type ReviewAction = 'confirm-exit' | 'restore-tracking';
type ExitReviewTab = 'awaiting' | 'pending';

export default function AdminUGLExitReviewPage() {
  const { isSuperAdmin, ready } = useSuperAdminGuard();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<ExitReviewTab>('awaiting');

  /* ─── Tab 1: Awaiting_Reminder_List state ─── */
  const [awaitingRecords, setAwaitingRecords] = useState<AwaitingReminderRecord[]>([]);
  const [awaitingLoading, setAwaitingLoading] = useState(true);
  const [awaitingForbidden, setAwaitingForbidden] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [sendSubmitting, setSendSubmitting] = useState(false);

  /* ─── Tab 2: Pending_Exit_List state ─── */
  const [pendingRecords, setPendingRecords] = useState<PendingExitRecord[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingForbidden, setPendingForbidden] = useState(false);

  // Review confirmation dialog state
  const [reviewTarget, setReviewTarget] = useState<PendingExitRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction>('confirm-exit');
  const [reviewError, setReviewError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  /* ─── Tab 1: Awaiting_Reminder_List data fetch ─── */
  const fetchAwaitingList = useCallback(async () => {
    setAwaitingLoading(true);
    try {
      const res = await request<AwaitingReminderListResponse>({
        url: '/api/admin/ugl-exit/awaiting-reminder',
      });
      setAwaitingRecords(res.items || []);
      // Drop any stale selections that are no longer present in the refreshed list.
      const nextIds = new Set((res.items || []).map((r) => r.userId));
      setSelectedIds((prev) => prev.filter((id) => nextIds.has(id)));
    } catch (err) {
      if (err instanceof RequestError && err.statusCode === 403) {
        // Backend 403 is authoritative — hide ONLY this tab.
        setAwaitingForbidden(true);
      }
      setAwaitingRecords([]);
      setSelectedIds([]);
    } finally {
      setAwaitingLoading(false);
    }
  }, []);

  /* ─── Tab 2: Pending_Exit_List data fetch ─── */
  const fetchPendingList = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await request<PendingExitListResponse>({
        url: '/api/admin/ugl-exit/pending',
      });
      setPendingRecords(res.records || []);
    } catch (err) {
      if (err instanceof RequestError && err.statusCode === 403) {
        // Backend 403 is authoritative — hide ONLY this tab.
        setPendingForbidden(true);
      }
      setPendingRecords([]);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!isSuperAdmin) return;
    if (activeTab === 'awaiting' && !awaitingForbidden) {
      fetchAwaitingList();
    } else if (activeTab === 'pending' && !pendingForbidden) {
      fetchPendingList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isSuperAdmin, activeTab]);

  const handleBack = () => goBack('/pages/admin/index');

  const formatTime = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /* ─── Tab 1: selection handling ─── */
  const allSelected = awaitingRecords.length > 0 && selectedIds.length === awaitingRecords.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(awaitingRecords.map((r) => r.userId));
    }
  };

  const toggleRow = (userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const openSendConfirm = () => {
    if (selectedIds.length === 0) {
      Taro.showToast({ title: t('admin.uglExitReview.sendReminderNoneSelected'), icon: 'none' });
      return;
    }
    setSendConfirmOpen(true);
  };

  const closeSendConfirm = () => {
    if (sendSubmitting) return;
    setSendConfirmOpen(false);
  };

  const handleSendReminders = async () => {
    if (selectedIds.length === 0) return;
    setSendSubmitting(true);
    try {
      const summary = await request<SendReminderActionSummary>({
        url: '/api/admin/ugl-exit/send-reminder',
        method: 'POST',
        data: { userIds: selectedIds },
      });
      setSendConfirmOpen(false);
      setSelectedIds([]);
      Taro.showToast({
        title: t('admin.uglExitReview.sendReminderSuccessToast', {
          sent: summary.sentCount,
          failed: summary.sendFailedCount,
        }),
        icon: 'none',
      });
      fetchAwaitingList();
    } catch (err) {
      if (err instanceof RequestError && err.statusCode === 403) {
        // Backend 403 is authoritative — hide ONLY this tab.
        setSendConfirmOpen(false);
        setAwaitingForbidden(true);
        setAwaitingRecords([]);
        setSelectedIds([]);
      } else {
        Taro.showToast({
          title: err instanceof RequestError ? err.message : t('common.operationFailed'),
          icon: 'none',
        });
      }
    } finally {
      setSendSubmitting(false);
    }
  };

  /* ─── Tab 2: Review dialog actions ─── */
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
        // Backend 403 is authoritative — hide ONLY this tab rather than render partial data.
        setPendingForbidden(true);
        setPendingRecords([]);
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

  if (!isSuperAdmin) {
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

      {/* Tab switcher */}
      <View className='ugl-exit-tabs'>
        <View
          className={`ugl-exit-tabs__tab${activeTab === 'awaiting' ? ' ugl-exit-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('awaiting')}
        >
          <Text className='ugl-exit-tabs__tab-text'>{t('admin.uglExitReview.tabAwaitingReminder')}</Text>
        </View>
        <View
          className={`ugl-exit-tabs__tab${activeTab === 'pending' ? ' ugl-exit-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          <Text className='ugl-exit-tabs__tab-text'>{t('admin.uglExitReview.tabPendingExit')}</Text>
        </View>
      </View>

      {/* Tab 1: Awaiting_Reminder_List */}
      {activeTab === 'awaiting' && !awaitingForbidden && (
        <View className='ugl-exit-tabpanel'>
          {awaitingLoading ? (
            <View className='admin-wishes-loading'><Text>{t('common.loading')}</Text></View>
          ) : awaitingRecords.length === 0 ? (
            <View className='admin-wishes-empty'>
              <Text className='admin-wishes-empty__text'>{t('admin.uglExitReview.awaitingReminderEmptyState')}</Text>
            </View>
          ) : (
            <View className='ugl-await'>
              {/* Header: select-all + send button */}
              <View className='ugl-await__header'>
                <View className='ugl-await__select-all' onClick={toggleSelectAll}>
                  <View className={`ugl-checkbox${allSelected ? ' ugl-checkbox--checked' : ''}`}>
                    {allSelected && <Text className='ugl-checkbox__mark'>✓</Text>}
                  </View>
                  <Text className='ugl-await__select-all-label'>{t('admin.uglExitReview.selectAllLabel')}</Text>
                </View>
                <View
                  className={`ugl-await__send-btn${selectedIds.length === 0 ? ' ugl-await__send-btn--disabled' : ''}`}
                  onClick={selectedIds.length === 0 ? undefined : openSendConfirm}
                >
                  <Text>{t('admin.uglExitReview.sendReminderButton')}</Text>
                </View>
              </View>

              {/* Rows */}
              {awaitingRecords.map((record) => {
                const checked = selectedIds.includes(record.userId);
                return (
                  <View
                    key={record.userId}
                    className={`ugl-await-row${checked ? ' ugl-await-row--checked' : ''}`}
                    onClick={() => toggleRow(record.userId)}
                  >
                    <View className={`ugl-checkbox${checked ? ' ugl-checkbox--checked' : ''}`}>
                      {checked && <Text className='ugl-checkbox__mark'>✓</Text>}
                    </View>
                    <View className='ugl-await-row__info'>
                      <Text className='ugl-await-row__nickname'>{record.nickname}</Text>
                      <Text className='ugl-await-row__meta'>
                        {t('admin.uglExitReview.emailLabel')}: {record.email}
                      </Text>
                      <Text className='ugl-await-row__meta'>
                        {t('admin.uglExitReview.ugNameLabel')}: {record.ugName}
                      </Text>
                      <View className='ugl-await-row__bottom'>
                        <Text className='ugl-await-row__quarter'>
                          {t('admin.uglExitReview.quarterLabel')}: {record.quarter}
                        </Text>
                        <Text className='ugl-await-row__time'>
                          {t('admin.uglExitReview.recordedAtLabel')}: {formatTime(record.recordedAt)}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Tab 2: Pending_Exit_List */}
      {activeTab === 'pending' && !pendingForbidden && (
        <View className='ugl-exit-tabpanel'>
          {pendingLoading ? (
            <View className='admin-wishes-loading'><Text>{t('common.loading')}</Text></View>
          ) : pendingRecords.length === 0 ? (
            <View className='admin-wishes-empty'>
              <Text className='admin-wishes-empty__text'>{t('common.noData')}</Text>
            </View>
          ) : (
            <View className='ugl-exit-list'>
              {pendingRecords.map((record) => (
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
        </View>
      )}

      {/* Send reminder confirmation dialog */}
      {sendConfirmOpen && (
        <View className='wish-form-overlay'>
          <View className='wish-form-modal'>
            <View className='wish-form-modal__header'>
              <Text className='wish-form-modal__title'>{t('admin.uglExitReview.sendReminderConfirmTitle')}</Text>
              <View className='wish-form-modal__close' onClick={closeSendConfirm}><Text>✕</Text></View>
            </View>
            <View className='wish-form-modal__body'>
              <Text className='wish-confirm-text'>
                {t('admin.uglExitReview.sendReminderConfirmText', { count: selectedIds.length })}
              </Text>
            </View>
            <View className='wish-form-modal__actions'>
              <View className='wish-form-modal__cancel' onClick={closeSendConfirm}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`wish-form-modal__submit ${sendSubmitting ? 'wish-form-modal__submit--loading' : ''}`}
                onClick={sendSubmitting ? undefined : handleSendReminders}
              >
                <Text>
                  {sendSubmitting ? t('common.submitting') : t('admin.uglExitReview.sendReminderButton')}
                </Text>
              </View>
            </View>
          </View>
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
