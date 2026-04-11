import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { ContentItem, ContentStatus } from '@points-mall/shared';
import './content.scss';

/** Status filter tab options */
type StatusFilter = 'all' | ContentStatus;

const STATUS_CLASS: Record<string, string> = {
  pending: 'content-status--pending',
  approved: 'content-status--approved',
  rejected: 'content-status--rejected',
};

const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

export default function AdminContentPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const STATUS_LABELS: Record<string, string> = {
    pending: t('contentHub.admin.statusPending'),
    approved: t('contentHub.admin.statusApproved'),
    rejected: t('contentHub.admin.statusRejected'),
  };

  const [items, setItems] = useState<ContentItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Detail modal
  const [detailItem, setDetailItem] = useState<ContentItem | null>(null);

  // Reject modal
  const [rejectItem, setRejectItem] = useState<ContentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Delete confirm modal
  const [deleteItem, setDeleteItem] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Approve loading
  const [approving, setApproving] = useState(false);

  const fetchContent = useCallback(
    async (filter: StatusFilter, append = false, cursor?: string | null) => {
      if (!append) setLoading(true);
      try {
        let url = '/api/admin/content?pageSize=20';
        if (filter !== 'all') url += `&status=${filter}`;
        if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

        const res = await request<{ items: ContentItem[]; lastKey?: string }>({ url });
        if (append) {
          setItems((prev) => [...prev, ...(res.items || [])]);
        } else {
          setItems(res.items || []);
        }
        setLastKey(res.lastKey || null);
      } catch {
        if (!append) setItems([]);
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
    fetchContent(statusFilter);
  }, [isAuthenticated, fetchContent, statusFilter]);

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
  };

  const handleLoadMore = () => {
    if (lastKey) {
      fetchContent(statusFilter, true, lastKey);
    }
  };

  // Detail modal
  const openDetail = (item: ContentItem) => {
    setDetailItem(item);
  };

  const closeDetail = () => {
    setDetailItem(null);
  };

  // Approve action
  const handleApprove = async (item: ContentItem) => {
    setApproving(true);
    try {
      await request({
        url: `/api/admin/content/${item.contentId}/review`,
        method: 'PATCH',
        data: { action: 'approve' },
      });
      Taro.showToast({ title: t('contentHub.admin.approved'), icon: 'none' });
      closeDetail();
      fetchContent(statusFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('contentHub.admin.operationFailed'),
        icon: 'none',
      });
    } finally {
      setApproving(false);
    }
  };

  // Reject modal
  const openReject = (item: ContentItem) => {
    setDetailItem(null);
    setRejectItem(item);
    setRejectReason('');
    setRejectError('');
  };

  const closeReject = () => {
    setRejectItem(null);
    setRejectError('');
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    if (!reason || reason.length > 500) {
      setRejectError(t('contentHub.admin.rejectReasonLabel'));
      return;
    }
    if (!rejectItem) return;
    setRejecting(true);
    setRejectError('');
    try {
      await request({
        url: `/api/admin/content/${rejectItem.contentId}/review`,
        method: 'PATCH',
        data: { action: 'reject', rejectReason: reason },
      });
      Taro.showToast({ title: t('contentHub.admin.rejected'), icon: 'none' });
      closeReject();
      fetchContent(statusFilter);
    } catch (err) {
      setRejectError(err instanceof RequestError ? err.message : t('contentHub.admin.operationFailed'));
    } finally {
      setRejecting(false);
    }
  };

  // Delete action
  const openDelete = (item: ContentItem) => {
    setDetailItem(null);
    setDeleteItem(item);
  };

  const closeDelete = () => {
    setDeleteItem(null);
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setDeleting(true);
    try {
      await request({
        url: `/api/admin/content/${deleteItem.contentId}`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('contentHub.admin.deleted'), icon: 'none' });
      closeDelete();
      fetchContent(statusFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('contentHub.admin.deleteFailed'),
        icon: 'none',
      });
    } finally {
      setDeleting(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getPreviewUrl = (item: ContentItem) => {
    const baseUrl = process.env.TARO_APP_API_BASE_URL || '';
    const fileUrl = `${baseUrl}/images/${item.fileKey}`;
    const ext = item.fileName.toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      return fileUrl;
    }
    // Office Online Viewer for PPT/DOC
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-content'>
      {/* Toolbar */}
      <View className='admin-content__toolbar'>
        <View className='admin-content__back' onClick={handleBack}>
          <Text>{t('contentHub.admin.backButton')}</Text>
        </View>
        <Text className='admin-content__title'>{t('contentHub.admin.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Status Filter Tabs */}
      <View className='content-tabs'>
        {([
          { key: 'all' as StatusFilter, label: t('contentHub.admin.filterAll') },
          { key: 'pending' as StatusFilter, label: t('contentHub.admin.filterPending') },
          { key: 'approved' as StatusFilter, label: t('contentHub.admin.filterApproved') },
          { key: 'rejected' as StatusFilter, label: t('contentHub.admin.filterRejected') },
        ]).map((tab) => (
          <View
            key={tab.key}
            className={`content-tabs__item ${statusFilter === tab.key ? 'content-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Content List */}
      {loading ? (
        <View className='admin-content-loading'><Text>{t('contentHub.admin.loading')}</Text></View>
      ) : items.length === 0 ? (
        <View className='admin-content-empty'>
          <Text className='admin-content-empty__icon'>📄</Text>
          <Text className='admin-content-empty__text'>{t('contentHub.admin.empty')}</Text>
        </View>
      ) : (
        <View className='content-mgmt-list'>
          {items.map((item) => (
            <View key={item.contentId} className='content-row' onClick={() => openDetail(item)}>
              <View className='content-row__main'>
                <View className='content-row__info'>
                  <View className='content-row__top'>
                    <Text className='content-row__title-text'>{item.title}</Text>
                    <Text className='content-category-tag'>{item.categoryName}</Text>
                    <Text className={`content-status ${STATUS_CLASS[item.status] || ''}`}>
                      {STATUS_LABELS[item.status] || item.status}
                    </Text>
                  </View>
                  <Text className='content-row__uploader'>{item.uploaderNickname}</Text>
                  <Text className='content-row__time'>{formatTime(item.createdAt)}</Text>
                </View>
                <View className='content-row__arrow'><Text>›</Text></View>
              </View>
            </View>
          ))}

          {lastKey && (
            <View className='content-mgmt-list__load-more' onClick={handleLoadMore}>
              <Text>{t('contentHub.admin.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Detail Modal */}
      {detailItem && (
        <View className='content-form-overlay'>
          <View className='content-form-modal'>
            <View className='content-form-modal__header'>
              <Text className='content-form-modal__title'>{t('contentHub.admin.detailTitle')}</Text>
              <View className='content-form-modal__close' onClick={closeDetail}><Text>✕</Text></View>
            </View>
            <View className='content-form-modal__body'>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailTitleLabel')}</Text>
                <Text className='content-detail-section__value'>{detailItem.title}</Text>
              </View>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailDescriptionLabel')}</Text>
                <Text className='content-detail-section__value content-detail-section__value--desc'>
                  {detailItem.description}
                </Text>
              </View>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailUploaderLabel')}</Text>
                <View className='content-detail-section__uploader'>
                  <Text className='content-detail-section__value'>{detailItem.uploaderNickname}</Text>
                  {ROLE_CONFIG[detailItem.uploaderRole] && (
                    <Text className={`role-badge ${ROLE_CONFIG[detailItem.uploaderRole].className}`}>
                      {ROLE_CONFIG[detailItem.uploaderRole].label}
                    </Text>
                  )}
                </View>
              </View>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailCategoryLabel')}</Text>
                <Text className='content-category-tag'>{detailItem.categoryName}</Text>
              </View>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailFileLabel')}</Text>
                <Text className='content-detail-section__value'>
                  {detailItem.fileName} ({formatFileSize(detailItem.fileSize)})
                </Text>
              </View>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailPreviewLabel')}</Text>
                <Text
                  className='content-detail-section__value content-detail-section__value--link'
                  onClick={() => {
                    const url = getPreviewUrl(detailItem);
                    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
                      window.open(url, '_blank');
                    }
                  }}
                >
                  {t('contentHub.admin.detailPreviewLink')}
                </Text>
              </View>
              {detailItem.videoUrl && (
                <View className='content-detail-section'>
                  <Text className='content-detail-section__label'>{t('contentHub.admin.detailVideoLabel')}</Text>
                  <Text
                    className='content-detail-section__value content-detail-section__value--link'
                    onClick={() => {
                      if (Taro.getEnv() === Taro.ENV_TYPE.WEB && detailItem.videoUrl) {
                        window.open(detailItem.videoUrl, '_blank');
                      }
                    }}
                  >
                    {detailItem.videoUrl}
                  </Text>
                </View>
              )}
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailStatusLabel')}</Text>
                <Text className={`content-status ${STATUS_CLASS[detailItem.status] || ''}`}>
                  {STATUS_LABELS[detailItem.status] || detailItem.status}
                </Text>
              </View>
              {detailItem.status === 'rejected' && detailItem.rejectReason && (
                <View className='content-detail-section'>
                  <Text className='content-detail-section__label'>{t('contentHub.admin.detailRejectReasonLabel')}</Text>
                  <Text className='content-detail-section__value content-detail-section__value--reject'>
                    {detailItem.rejectReason}
                  </Text>
                </View>
              )}
              {detailItem.reviewedAt && (
                <View className='content-detail-section'>
                  <Text className='content-detail-section__label'>{t('contentHub.admin.detailReviewTimeLabel')}</Text>
                  <Text className='content-detail-section__value'>{formatTime(detailItem.reviewedAt)}</Text>
                </View>
              )}
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailUploadTimeLabel')}</Text>
                <Text className='content-detail-section__value'>{formatTime(detailItem.createdAt)}</Text>
              </View>
              <View className='content-detail-section'>
                <Text className='content-detail-section__label'>{t('contentHub.admin.detailStatsLabel')}</Text>
                <Text className='content-detail-section__value'>
                  {t('contentHub.admin.detailStatsLikes')} {detailItem.likeCount} · {t('contentHub.admin.detailStatsComments')} {detailItem.commentCount} · {t('contentHub.admin.detailStatsReservations')} {detailItem.reservationCount}
                </Text>
              </View>
            </View>
            <View className='content-form-modal__actions'>
              {detailItem.status === 'pending' ? (
                <>
                  <View className='content-form-modal__cancel' onClick={() => openReject(detailItem)}>
                    <Text>{t('contentHub.admin.rejectButton')}</Text>
                  </View>
                  <View
                    className={`content-form-modal__submit ${approving ? 'content-form-modal__submit--loading' : ''}`}
                    onClick={() => handleApprove(detailItem)}
                  >
                    <Text>{approving ? t('contentHub.admin.approving') : t('contentHub.admin.approveButton')}</Text>
                  </View>
                </>
              ) : (
                <>
                  <View
                    className='content-form-modal__submit content-form-modal__submit--danger'
                    onClick={() => openDelete(detailItem)}
                  >
                    <Text>{t('contentHub.admin.deleteButton')}</Text>
                  </View>
                  <View className='content-form-modal__cancel' onClick={closeDetail}>
                    <Text>{t('contentHub.admin.closeButton')}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Reject Modal */}
      {rejectItem && (
        <View className='content-form-overlay'>
          <View className='content-form-modal'>
            <View className='content-form-modal__header'>
              <Text className='content-form-modal__title'>{t('contentHub.admin.rejectTitle')}</Text>
              <View className='content-form-modal__close' onClick={closeReject}><Text>✕</Text></View>
            </View>
            {rejectError && (
              <View className='content-form-modal__error'><Text>{rejectError}</Text></View>
            )}
            <View className='content-form-modal__body'>
              <Text className='content-confirm-text'>
                {t('contentHub.admin.rejectConfirmText')}
              </Text>
              <View className='content-form-field'>
                <Text className='content-form-field__label'>{t('contentHub.admin.rejectReasonLabel')}</Text>
                <textarea
                  className='content-form-field__textarea'
                  value={rejectReason}
                  onInput={(e: any) => setRejectReason(e.target.value || e.detail?.value || '')}
                  placeholder={t('contentHub.admin.rejectReasonPlaceholder')}
                  maxLength={500}
                />
              </View>
            </View>
            <View className='content-form-modal__actions'>
              <View className='content-form-modal__cancel' onClick={closeReject}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`content-form-modal__submit content-form-modal__submit--danger ${rejecting ? 'content-form-modal__submit--loading' : ''}`}
                onClick={handleReject}
              >
                <Text>{rejecting ? t('contentHub.admin.rejecting') : t('contentHub.admin.confirmReject')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Delete Confirm Modal */}
      {deleteItem && (
        <View className='content-form-overlay'>
          <View className='content-form-modal'>
            <View className='content-form-modal__header'>
              <Text className='content-form-modal__title'>{t('contentHub.admin.deleteTitle')}</Text>
              <View className='content-form-modal__close' onClick={closeDelete}><Text>✕</Text></View>
            </View>
            <View className='content-form-modal__body'>
              <Text className='content-confirm-text'>
                {t('contentHub.admin.deleteConfirmText')}
              </Text>
            </View>
            <View className='content-form-modal__actions'>
              <View className='content-form-modal__cancel' onClick={closeDelete}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`content-form-modal__submit content-form-modal__submit--danger ${deleting ? 'content-form-modal__submit--loading' : ''}`}
                onClick={handleDelete}
              >
                <Text>{deleting ? t('contentHub.admin.deleting') : t('contentHub.admin.deleteButton')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
