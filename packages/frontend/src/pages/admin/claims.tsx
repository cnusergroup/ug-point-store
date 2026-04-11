import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { ClaimIcon } from '../../components/icons';
import './claims.scss';

/** Claim record returned by the admin API */
interface AdminClaimRecord {
  claimId: string;
  userId: string;
  applicantNickname: string;
  applicantRole: string;
  title: string;
  description: string;
  imageUrls: string[];
  activityUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  awardedPoints?: number;
  rejectReason?: string;
  reviewerId?: string;
  reviewerNickname?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** Status filter tab options */
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: 'admin.claims.statusPending', className: 'claim-status--pending' },
  approved: { labelKey: 'admin.claims.statusApproved', className: 'claim-status--approved' },
  rejected: { labelKey: 'admin.claims.statusRejected', className: 'claim-status--rejected' },
};

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

export default function AdminClaimsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  const [claims, setClaims] = useState<AdminClaimRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Detail modal
  const [detailClaim, setDetailClaim] = useState<AdminClaimRecord | null>(null);

  // Approve modal
  const [approveClaim, setApproveClaim] = useState<AdminClaimRecord | null>(null);
  const [approvePoints, setApprovePoints] = useState('');
  const [approveError, setApproveError] = useState('');
  const [approving, setApproving] = useState(false);

  // Reject modal
  const [rejectClaim, setRejectClaim] = useState<AdminClaimRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const fetchClaims = useCallback(async (filter: StatusFilter, append = false, cursor?: string | null) => {
    if (!append) setLoading(true);
    try {
      let url = '/api/admin/claims?pageSize=20';
      if (filter !== 'all') url += `&status=${filter}`;
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

      const res = await request<{ claims: AdminClaimRecord[]; lastKey?: string }>({ url });
      if (append) {
        setClaims((prev) => [...prev, ...(res.claims || [])]);
      } else {
        setClaims(res.claims || []);
      }
      setLastKey(res.lastKey || null);
    } catch {
      if (!append) setClaims([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchClaims(statusFilter);
  }, [isAuthenticated, fetchClaims, statusFilter]);

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
  };

  const handleLoadMore = () => {
    if (lastKey) {
      fetchClaims(statusFilter, true, lastKey);
    }
  };

  // Detail modal
  const openDetail = (claim: AdminClaimRecord) => {
    setDetailClaim(claim);
  };

  const closeDetail = () => {
    setDetailClaim(null);
  };

  // Approve modal
  const openApprove = (claim: AdminClaimRecord) => {
    setDetailClaim(null);
    setApproveClaim(claim);
    setApprovePoints('');
    setApproveError('');
  };

  const closeApprove = () => {
    setApproveClaim(null);
    setApproveError('');
  };

  const handleApprove = async () => {
    const pts = Number(approvePoints);
    if (!pts || pts < 1 || pts > 10000 || !Number.isInteger(pts)) {
      setApproveError(t('admin.claims.approvePointsError'));
      return;
    }
    if (!approveClaim) return;
    setApproving(true);
    setApproveError('');
    try {
      await request({
        url: `/api/admin/claims/${approveClaim.claimId}/review`,
        method: 'PATCH',
        data: { action: 'approve', awardedPoints: pts },
      });
      Taro.showToast({ title: t('admin.claims.approved'), icon: 'none' });
      closeApprove();
      fetchClaims(statusFilter);
    } catch (err) {
      setApproveError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setApproving(false);
    }
  };

  // Reject modal
  const openReject = (claim: AdminClaimRecord) => {
    setDetailClaim(null);
    setRejectClaim(claim);
    setRejectReason('');
    setRejectError('');
  };

  const closeReject = () => {
    setRejectClaim(null);
    setRejectError('');
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    if (!reason || reason.length > 500) {
      setRejectError(t('admin.claims.rejectReasonError'));
      return;
    }
    if (!rejectClaim) return;
    setRejecting(true);
    setRejectError('');
    try {
      await request({
        url: `/api/admin/claims/${rejectClaim.claimId}/review`,
        method: 'PATCH',
        data: { action: 'reject', rejectReason: reason },
      });
      Taro.showToast({ title: t('admin.claims.rejected'), icon: 'none' });
      closeReject();
      fetchClaims(statusFilter);
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
    <View className='admin-claims'>
      {/* Toolbar */}
      <View className='admin-claims__toolbar'>
        <View className='admin-claims__back' onClick={handleBack}>
          <Text>{t('admin.claims.backButton')}</Text>
        </View>
        <Text className='admin-claims__title'>{t('admin.claims.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Status Filter Tabs */}
      <View className='claim-tabs'>
        {([
          { key: 'all' as StatusFilter, label: t('admin.claims.filterAll') },
          { key: 'pending' as StatusFilter, label: t('admin.claims.filterPending') },
          { key: 'approved' as StatusFilter, label: t('admin.claims.filterApproved') },
          { key: 'rejected' as StatusFilter, label: t('admin.claims.filterRejected') },
        ]).map((tab) => (
          <View
            key={tab.key}
            className={`claim-tabs__item ${statusFilter === tab.key ? 'claim-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Claim List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('admin.claims.loading')}</Text></View>
      ) : claims.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><ClaimIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('admin.claims.noRecords')}</Text>
        </View>
      ) : (
        <View className='claim-list'>
          {claims.map((claim) => {
            const st = STATUS_CONFIG[claim.status] || STATUS_CONFIG.pending;
            const roleConfig = ROLE_CONFIG[claim.applicantRole];
            return (
              <View key={claim.claimId} className='claim-row' onClick={() => openDetail(claim)}>
                <View className='claim-row__main'>
                  <View className='claim-row__info'>
                    <View className='claim-row__top'>
                      <Text className='claim-row__nickname'>{claim.applicantNickname}</Text>
                      {roleConfig && (
                        <Text className={`role-badge ${roleConfig.className}`}>
                          {roleConfig.label}
                        </Text>
                      )}
                      <Text className={`claim-status ${st.className}`}>{t(st.labelKey)}</Text>
                    </View>
                    <Text className='claim-row__title'>{claim.title}</Text>
                    <Text className='claim-row__time'>{formatTime(claim.createdAt)}</Text>
                  </View>
                  <View className='claim-row__arrow'><Text>›</Text></View>
                </View>
              </View>
            );
          })}

          {/* Load More */}
          {lastKey && (
            <View className='claim-list__load-more' onClick={handleLoadMore}>
              <Text>{t('admin.claims.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Detail Modal */}
      {detailClaim && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.claims.detailTitle')}</Text>
              <View className='form-modal__close' onClick={closeDetail}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('admin.claims.applicantLabel')}</Text>
                <View className='detail-section__applicant'>
                  <Text className='detail-section__value'>{detailClaim.applicantNickname}</Text>
                  {ROLE_CONFIG[detailClaim.applicantRole] && (
                    <Text className={`role-badge ${ROLE_CONFIG[detailClaim.applicantRole].className}`}>
                      {ROLE_CONFIG[detailClaim.applicantRole].label}
                    </Text>
                  )}
                </View>
              </View>
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('admin.claims.titleLabel')}</Text>
                <Text className='detail-section__value'>{detailClaim.title}</Text>
              </View>
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('admin.claims.descriptionLabel')}</Text>
                <Text className='detail-section__value detail-section__value--desc'>{detailClaim.description}</Text>
              </View>
              {detailClaim.imageUrls && detailClaim.imageUrls.length > 0 && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>{t('admin.claims.imagesLabel')}</Text>
                  <View className='detail-images'>
                    {detailClaim.imageUrls.map((url, i) => (
                      <View key={i} className='detail-images__item' onClick={() => { if (url) Taro.previewImage({ current: url, urls: detailClaim.imageUrls }); }}>
                        <Image src={url} className='detail-images__img' mode='aspectFill' />
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {detailClaim.activityUrl && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>{t('admin.claims.activityLinkLabel')}</Text>
                  <Text className='detail-section__value detail-section__value--link'>{detailClaim.activityUrl}</Text>
                </View>
              )}
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('admin.claims.statusLabel')}</Text>
                <Text className={`claim-status ${STATUS_CONFIG[detailClaim.status]?.className || ''}`}>
                  {t(STATUS_CONFIG[detailClaim.status]?.labelKey || 'admin.claims.statusPending')}
                </Text>
              </View>
              {detailClaim.status === 'approved' && detailClaim.awardedPoints != null && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>{t('admin.claims.awardedPointsLabel')}</Text>
                  <Text className='detail-section__value detail-section__value--points'>+{detailClaim.awardedPoints}</Text>
                </View>
              )}
              {detailClaim.status === 'rejected' && detailClaim.rejectReason && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>{t('admin.claims.rejectReasonLabel')}</Text>
                  <Text className='detail-section__value detail-section__value--reject'>{detailClaim.rejectReason}</Text>
                </View>
              )}
              {detailClaim.reviewedAt && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>{t('admin.claims.reviewerLabel')}</Text>
                  <Text className='detail-section__value'>{detailClaim.reviewerNickname || detailClaim.reviewerId || '-'}</Text>
                </View>
              )}
              {detailClaim.reviewedAt && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>{t('admin.claims.reviewTimeLabel')}</Text>
                  <Text className='detail-section__value'>{formatTime(detailClaim.reviewedAt)}</Text>
                </View>
              )}
              <View className='detail-section'>
                <Text className='detail-section__label'>{t('admin.claims.submitTimeLabel')}</Text>
                <Text className='detail-section__value'>{formatTime(detailClaim.createdAt)}</Text>
              </View>
            </View>
            <View className='form-modal__actions'>
              {detailClaim.status === 'pending' ? (
                <>
                  <View className='form-modal__cancel' onClick={() => openReject(detailClaim)}>
                    <Text>{t('admin.claims.rejectButton')}</Text>
                  </View>
                  <View className='form-modal__submit' onClick={() => openApprove(detailClaim)}>
                    <Text>{t('admin.claims.approveButton')}</Text>
                  </View>
                </>
              ) : (
                <View className='form-modal__cancel' onClick={closeDetail} style={{ flex: 'unset', width: '100%' }}>
                  <Text>{t('common.close')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Approve Modal */}
      {approveClaim && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.claims.approveTitle')}</Text>
              <View className='form-modal__close' onClick={closeApprove}><Text>✕</Text></View>
            </View>
            {approveError && (
              <View className='form-modal__error'><Text>{approveError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('admin.claims.approveConfirmText', { applicant: approveClaim.applicantNickname, title: approveClaim.title })}
              </Text>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.claims.approvePointsLabel')}</Text>
                <Input
                  className='form-field__input'
                  type='number'
                  value={approvePoints}
                  onInput={(e) => setApprovePoints(e.detail.value)}
                  placeholder={t('admin.claims.approvePointsPlaceholder')}
                />
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
                <Text>{approving ? t('admin.claims.approving') : t('admin.claims.confirmApprove')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Reject Modal */}
      {rejectClaim && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.claims.rejectTitle')}</Text>
              <View className='form-modal__close' onClick={closeReject}><Text>✕</Text></View>
            </View>
            {rejectError && (
              <View className='form-modal__error'><Text>{rejectError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('admin.claims.rejectConfirmText', { applicant: rejectClaim.applicantNickname, title: rejectClaim.title })}
              </Text>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.claims.rejectReasonInputLabel')}</Text>
                <textarea
                  className='form-field__textarea'
                  value={rejectReason}
                  onChange={(e) => setRejectReason((e.target as HTMLTextAreaElement).value)}
                  placeholder={t('admin.claims.rejectReasonPlaceholder')}
                  maxLength={500}
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
                <Text>{rejecting ? t('admin.claims.rejecting') : t('admin.claims.confirmReject')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
