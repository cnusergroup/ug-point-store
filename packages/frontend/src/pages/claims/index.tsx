import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { ClaimIcon } from '../../components/icons';
import './index.scss';

/** Claim record returned by the API */
interface ClaimRecord {
  claimId: string;
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

const STATUS_TABS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'claims.filterAll' },
  { key: 'pending', labelKey: 'claims.filterPending' },
  { key: 'approved', labelKey: 'claims.filterApproved' },
  { key: 'rejected', labelKey: 'claims.filterRejected' },
];

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: 'claims.statusPending', className: 'claim-status--pending' },
  approved: { labelKey: 'claims.statusApproved', className: 'claim-status--approved' },
  rejected: { labelKey: 'claims.statusRejected', className: 'claim-status--rejected' },
};

/** Roles allowed to submit claims */
const CLAIM_ALLOWED_ROLES = [
  'Speaker',
  'UserGroupLeader',
  // [DISABLED] CommunityBuilder
  // 'CommunityBuilder',
  'Volunteer',
];

const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
};

export default function ClaimsPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);

  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Feature toggle state
  const [featureDisabled, setFeatureDisabled] = useState(false);

  // Detail modal
  const [detailClaim, setDetailClaim] = useState<ClaimRecord | null>(null);

  // New claim form
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formImages, setFormImages] = useState<{ url: string; uploading: boolean }[]>([]);
  const [formActivityUrl, setFormActivityUrl] = useState('');
  const [formSelectedRole, setFormSelectedRole] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Compute eligible roles for the current user
  const eligibleRoles = userRoles.filter((r) => CLAIM_ALLOWED_ROLES.includes(r));

  const fetchClaims = useCallback(async (filter: StatusFilter, append = false, cursor?: string | null) => {
    if (!append) setLoading(true);
    try {
      let url = '/api/claims?pageSize=20';
      if (filter !== 'all') url += `&status=${filter}`;
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

      const res = await request<{ claims: ClaimRecord[]; lastKey?: string }>({ url });
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

  // Check feature toggle on mount
  useEffect(() => {
    request<{ pointsClaimEnabled: boolean }>({
      url: '/api/settings/feature-toggles',
      skipAuth: true,
    })
      .then((res) => {
        setFeatureDisabled(!res.pointsClaimEnabled);
      })
      .catch(() => {
        // Frontend degradation: default to showing all functionality on failure
        setFeatureDisabled(false);
      });
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
  const openDetail = (claim: ClaimRecord) => {
    setDetailClaim(claim);
  };

  const closeDetail = () => {
    setDetailClaim(null);
  };

  // New claim form
  const openForm = () => {
    setFormTitle('');
    setFormDesc('');
    setFormImages([]);
    setFormActivityUrl('');
    setFormSelectedRole(eligibleRoles.length === 1 ? eligibleRoles[0] : '');
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError('');
  };

  const handleChooseImage = async () => {
    if (formImages.length >= 5) {
      Taro.showToast({ title: t('claims.maxImagesReached'), icon: 'none' });
      return;
    }
    try {
      const chooseRes = await Taro.chooseImage({ count: 5 - formImages.length, sizeType: ['compressed'], sourceType: ['album', 'camera'] });
      const files = chooseRes.tempFilePaths || [];
      for (let fi = 0; fi < files.length; fi++) {
        const filePath = files[fi];
        // Add placeholder at current length
        const currentLen = formImages.length + fi;
        if (currentLen >= 5) break;
        setFormImages((prev) => [...prev, { url: '', uploading: true }]);
        try {
          // Determine file name and content type
          let fileName = 'image.jpg';
          let contentType = 'image/jpeg';
          const tempFile = (chooseRes as any).tempFiles?.[fi];
          if (tempFile?.originalFileObj?.name) {
            fileName = tempFile.originalFileObj.name;
          } else if (tempFile?.type) {
            const typeExtMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
            const ext = typeExtMap[tempFile.type] || 'jpg';
            fileName = `image.${ext}`;
            contentType = tempFile.type;
          } else {
            const pathName = filePath.split('/').pop() || '';
            if (pathName.includes('.')) fileName = pathName;
          }
          const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
          const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
          contentType = mimeMap[ext] || contentType;

          // Get presigned URL
          const uploadRes = await request<{ uploadUrl: string; key: string; url: string }>({
            url: '/api/claims/upload-url',
            method: 'POST',
            data: { fileName, contentType },
          });

          // Upload to S3 — use fetch PUT for H5, Taro.uploadFile for mini-program
          const env = Taro.getEnv();
          if (env === Taro.ENV_TYPE.WEB) {
            const resp = await fetch(filePath);
            const blob = await resp.blob();
            await fetch(uploadRes.uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': contentType },
              body: blob,
            });
          } else {
            await Taro.uploadFile({ url: uploadRes.uploadUrl, filePath, name: 'file', header: { 'Content-Type': contentType } });
          }

          setFormImages((prev) => {
            const updated = [...prev];
            const placeholderIdx = updated.findIndex((img) => img.uploading && img.url === '');
            if (placeholderIdx !== -1) {
              updated[placeholderIdx] = { url: uploadRes.url, uploading: false };
            }
            return updated;
          });
        } catch {
          // Remove the uploading placeholder
          setFormImages((prev) => {
            const idx = prev.findIndex((img) => img.uploading && img.url === '');
            if (idx !== -1) return prev.filter((_, i) => i !== idx);
            return prev;
          });
          Taro.showToast({ title: t('claims.imageUploadFailed'), icon: 'none' });
        }
      }
    } catch {
      // User cancelled
    }
  };

  const removeImage = (index: number) => {
    setFormImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitClaim = async () => {
    if (!formTitle.trim()) {
      setFormError(t('claims.errorTitleRequired'));
      return;
    }
    if (!formDesc.trim()) {
      setFormError(t('claims.errorDescRequired'));
      return;
    }
    if (eligibleRoles.length > 1 && !formSelectedRole) {
      setFormError(t('claims.errorSelectRole'));
      return;
    }
    if (formImages.some((img) => img.uploading)) {
      setFormError(t('claims.errorWaitUpload'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const imageUrls = formImages.map((img) => img.url).filter(Boolean);
      const data: Record<string, unknown> = {
        title: formTitle.trim(),
        description: formDesc.trim(),
      };
      if (imageUrls.length > 0) data.imageUrls = imageUrls;
      if (formActivityUrl.trim()) data.activityUrl = formActivityUrl.trim();
      if (formSelectedRole) data.selectedRole = formSelectedRole;

      await request({ url: '/api/claims', method: 'POST', data });
      Taro.showToast({ title: t('claims.claimSubmitted'), icon: 'none' });
      closeForm();
      fetchClaims(statusFilter);
    } catch (err) {
      setFormError(err instanceof RequestError ? err.message : t('claims.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleBack = () => goBack('/pages/profile/index');

  return (
    <View className='claims-page'>
      {/* Toolbar */}
      <View className='claims-page__toolbar'>
        <View className='claims-page__back' onClick={handleBack}>
          <Text>{t('claims.backButton')}</Text>
        </View>
        <Text className='claims-page__title'>{t('claims.title')}</Text>
        {!featureDisabled ? (
          <View className='claims-page__new-btn' onClick={openForm}>
            <Text>{t('claims.newClaim')}</Text>
          </View>
        ) : (
          <View className='claims-page__new-btn' style={{ visibility: 'hidden' }}>
            <Text>{t('claims.newClaim')}</Text>
          </View>
        )}
      </View>

      {/* Feature disabled message */}
      {featureDisabled && (
        <View style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-48) var(--space-24)',
          textAlign: 'center',
        }}>
          <Text style={{
            fontSize: '48px',
            marginBottom: 'var(--space-16)',
            opacity: 0.5,
          }}>🔒</Text>
          <Text style={{
            fontFamily: 'var(--font-display)',
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-8)',
          }}>{t('featureToggle.featureDisabled')}</Text>
          <Text style={{
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-32)',
            lineHeight: 1.5,
          }}>{t('featureToggle.featureDisabledDesc')}</Text>
          <View
            className='btn-secondary'
            style={{ padding: 'var(--space-12) var(--space-32)', cursor: 'pointer' }}
            onClick={handleBack}
          >
            <Text>{t('featureToggle.backButton')}</Text>
          </View>
        </View>
      )}

      {/* Status Filter Tabs */}
      <View className='claim-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`claim-tabs__item ${statusFilter === tab.key ? 'claim-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Claim List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('claims.loading')}</Text></View>
      ) : claims.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><ClaimIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('claims.noRecords')}</Text>
        </View>
      ) : (
        <View className='claim-list'>
          {claims.map((claim) => {
            const st = STATUS_CONFIG[claim.status] || STATUS_CONFIG.pending;
            return (
              <View key={claim.claimId} className='claim-row' onClick={() => openDetail(claim)}>
                <View className='claim-row__main'>
                  <View className='claim-row__info'>
                    <View className='claim-row__top'>
                      <Text className='claim-row__title'>{claim.title}</Text>
                      <Text className={`claim-status ${st.className}`}>{t(st.labelKey)}</Text>
                    </View>
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
              <Text>{t('claims.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Detail Modal */}
      {detailClaim && (
        <View className='form-overlay' onClick={closeDetail}>
          <View className='claim-detail' onClick={(e) => e.stopPropagation()}>
            {/* Header with status banner */}
            <View className={`claim-detail__banner claim-detail__banner--${detailClaim.status}`}>
              <View className='claim-detail__banner-top'>
                <Text className='claim-detail__banner-status'>
                  {detailClaim.status === 'pending' && '○'}
                  {detailClaim.status === 'approved' && '✓'}
                  {detailClaim.status === 'rejected' && '✗'}
                  {' '}{STATUS_CONFIG[detailClaim.status]?.labelKey ? t(STATUS_CONFIG[detailClaim.status].labelKey) : detailClaim.status}
                </Text>
                <View className='claim-detail__close' onClick={closeDetail}><Text>✕</Text></View>
              </View>
              {detailClaim.status === 'approved' && detailClaim.awardedPoints != null && (
                <Text className='claim-detail__banner-points'>{t('claims.awardedPoints', { count: detailClaim.awardedPoints })}</Text>
              )}
              {detailClaim.status === 'rejected' && detailClaim.rejectReason && (
                <Text className='claim-detail__banner-reason'>{detailClaim.rejectReason}</Text>
              )}
            </View>

            {/* Content */}
            <View className='claim-detail__body'>
              {/* Title */}
              <Text className='claim-detail__title'>{detailClaim.title}</Text>

              {/* Description */}
              <View className='claim-detail__desc-wrap'>
                <Text className='claim-detail__desc'>{detailClaim.description}</Text>
              </View>

              {/* Images */}
              {detailClaim.imageUrls && detailClaim.imageUrls.length > 0 && (
                <View className='claim-detail__images'>
                  {detailClaim.imageUrls.map((url, i) => (
                    <View key={i} className='claim-detail__img-item' onClick={() => { if (url) Taro.previewImage({ current: url, urls: detailClaim.imageUrls }); }}>
                      <Image src={url} className='claim-detail__img' mode='aspectFill' />
                    </View>
                  ))}
                </View>
              )}

              {/* Activity URL */}
              {detailClaim.activityUrl && (
                <View className='claim-detail__link-wrap'>
                  <Text className='claim-detail__link-label'>{t('claims.activityLinkLabel')}</Text>
                  <Text className='claim-detail__link'>{detailClaim.activityUrl}</Text>
                </View>
              )}

              {/* Meta info */}
              <View className='claim-detail__meta'>
                <View className='claim-detail__meta-row'>
                  <Text className='claim-detail__meta-label'>{t('claims.submitTimeLabel')}</Text>
                  <Text className='claim-detail__meta-value'>{formatTime(detailClaim.createdAt)}</Text>
                </View>
                {detailClaim.reviewedAt && (
                  <>
                    <View className='claim-detail__meta-row'>
                      <Text className='claim-detail__meta-label'>{t('claims.reviewerLabel')}</Text>
                      <Text className='claim-detail__meta-value'>{detailClaim.reviewerNickname || detailClaim.reviewerId || '-'}</Text>
                    </View>
                    <View className='claim-detail__meta-row'>
                      <Text className='claim-detail__meta-label'>{t('claims.reviewTimeLabel')}</Text>
                      <Text className='claim-detail__meta-value'>{formatTime(detailClaim.reviewedAt)}</Text>
                    </View>
                  </>
                )}
              </View>
            </View>

            {/* Footer */}
            <View className='claim-detail__footer'>
              <View className='claim-detail__close-btn' onClick={closeDetail}>
                <Text>{t('claims.closeButton')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* New Claim Form Modal */}
      {showForm && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('claims.newClaimTitle')}</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {formError && (
              <View className='form-modal__error'><Text>{formError}</Text></View>
            )}
            <View className='form-modal__body'>
              {/* Role selector - only show if user has multiple eligible roles */}
              {eligibleRoles.length > 1 && (
                <View className='form-field'>
                  <Text className='form-field__label'>{t('claims.roleLabel')}</Text>
                  <View className='role-selector'>
                    {eligibleRoles.map((role) => {
                      const rc = ROLE_CONFIG[role];
                      return (
                        <View
                          key={role}
                          className={`role-selector__item ${formSelectedRole === role ? 'role-selector__item--active' : ''}`}
                          onClick={() => setFormSelectedRole(role)}
                        >
                          <Text className={`role-badge ${rc?.className || ''}`}>{rc?.label || role}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
              {eligibleRoles.length === 1 && (
                <View className='form-field'>
                  <Text className='form-field__label'>{t('claims.roleLabel')}</Text>
                  <View className='role-selector'>
                    <View className='role-selector__item role-selector__item--active'>
                      <Text className={`role-badge ${ROLE_CONFIG[eligibleRoles[0]]?.className || ''}`}>
                        {ROLE_CONFIG[eligibleRoles[0]]?.label || eligibleRoles[0]}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
              <View className='form-field'>
                <Text className='form-field__label'>{t('claims.titleLabel')}</Text>
                <Input
                  className='form-field__input'
                  value={formTitle}
                  onInput={(e) => setFormTitle(e.detail.value)}
                  placeholder={t('claims.titlePlaceholder')}
                  maxlength={100}
                />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('claims.descriptionLabel')}</Text>
                <textarea
                  className='form-field__textarea'
                  value={formDesc}
                  onChange={(e) => setFormDesc((e.target as HTMLTextAreaElement).value)}
                  placeholder={t('claims.descriptionPlaceholder')}
                  maxLength={1000}
                  rows={4}
                />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('claims.imagesLabel')}</Text>
                <View className='image-upload-grid'>
                  {formImages.map((img, i) => (
                    <View key={i} className='image-upload-item'>
                      {img.uploading ? (
                        <View className='image-upload-item__loading'><Text>{t('claims.uploading')}</Text></View>
                      ) : (
                        <>
                          <Image src={img.url} className='image-upload-item__img' mode='aspectFill' />
                          <View className='image-upload-item__remove' onClick={() => removeImage(i)}><Text>✕</Text></View>
                        </>
                      )}
                    </View>
                  ))}
                  {formImages.length < 5 && (
                    <View className='image-upload-add' onClick={handleChooseImage}>
                      <Text className='image-upload-add__icon'>+</Text>
                      <Text className='image-upload-add__text'>{t('claims.uploadImage')}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('claims.activityUrlLabel')}</Text>
                <Input
                  className='form-field__input'
                  value={formActivityUrl}
                  onInput={(e) => setFormActivityUrl(e.detail.value)}
                  placeholder={t('claims.activityUrlPlaceholder')}
                />
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeForm}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmitClaim}
              >
                <Text>{submitting ? t('claims.submitting') : t('claims.submitClaim')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
