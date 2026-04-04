import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Textarea, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
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

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '已批准' },
  { key: 'rejected', label: '已驳回' },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: '待审批', className: 'claim-status--pending' },
  approved: { label: '已批准', className: 'claim-status--approved' },
  rejected: { label: '已驳回', className: 'claim-status--rejected' },
};

/** Roles allowed to submit claims */
const CLAIM_ALLOWED_ROLES = ['Speaker', 'UserGroupLeader', 'CommunityBuilder', 'Volunteer'];

const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
};

export default function ClaimsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);

  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

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
      Taro.showToast({ title: '最多上传 5 张图片', icon: 'none' });
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
          Taro.showToast({ title: '图片上传失败', icon: 'none' });
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
      setFormError('请输入申请标题');
      return;
    }
    if (!formDesc.trim()) {
      setFormError('请输入申请描述');
      return;
    }
    if (eligibleRoles.length > 1 && !formSelectedRole) {
      setFormError('请选择提交身份');
      return;
    }
    if (formImages.some((img) => img.uploading)) {
      setFormError('请等待图片上传完成');
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
      Taro.showToast({ title: '申请已提交', icon: 'none' });
      closeForm();
      fetchClaims(statusFilter);
    } catch (err) {
      setFormError(err instanceof RequestError ? err.message : '提交失败');
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
          <Text>‹ 返回</Text>
        </View>
        <Text className='claims-page__title'>积分申请</Text>
        <View className='claims-page__new-btn' onClick={openForm}>
          <Text>+ 新建申请</Text>
        </View>
      </View>

      {/* Status Filter Tabs */}
      <View className='claim-tabs'>
        {STATUS_TABS.map((tab) => (
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
        <View className='admin-loading'><Text>加载中...</Text></View>
      ) : claims.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>📋</Text>
          <Text className='admin-empty__text'>暂无申请记录</Text>
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
                      <Text className={`claim-status ${st.className}`}>{st.label}</Text>
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
              <Text>加载更多</Text>
            </View>
          )}
        </View>
      )}

      {/* Detail Modal */}
      {detailClaim && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>申请详情</Text>
              <View className='form-modal__close' onClick={closeDetail}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <View className='detail-section'>
                <Text className='detail-section__label'>标题</Text>
                <Text className='detail-section__value'>{detailClaim.title}</Text>
              </View>
              <View className='detail-section'>
                <Text className='detail-section__label'>描述</Text>
                <Text className='detail-section__value detail-section__value--desc'>{detailClaim.description}</Text>
              </View>
              {detailClaim.imageUrls && detailClaim.imageUrls.length > 0 && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>图片</Text>
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
                  <Text className='detail-section__label'>活动链接</Text>
                  <Text className='detail-section__value detail-section__value--link'>{detailClaim.activityUrl}</Text>
                </View>
              )}
              <View className='detail-section'>
                <Text className='detail-section__label'>状态</Text>
                <Text className={`claim-status ${STATUS_CONFIG[detailClaim.status]?.className || ''}`}>
                  {STATUS_CONFIG[detailClaim.status]?.label || detailClaim.status}
                </Text>
              </View>
              {detailClaim.status === 'approved' && detailClaim.awardedPoints != null && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>奖励积分</Text>
                  <Text className='detail-section__value detail-section__value--points'>+{detailClaim.awardedPoints}</Text>
                </View>
              )}
              {detailClaim.status === 'rejected' && detailClaim.rejectReason && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>驳回原因</Text>
                  <Text className='detail-section__value detail-section__value--reject'>{detailClaim.rejectReason}</Text>
                </View>
              )}
              {detailClaim.reviewedAt && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>审批人</Text>
                  <Text className='detail-section__value'>{detailClaim.reviewerNickname || detailClaim.reviewerId || '-'}</Text>
                </View>
              )}
              {detailClaim.reviewedAt && (
                <View className='detail-section'>
                  <Text className='detail-section__label'>审批时间</Text>
                  <Text className='detail-section__value'>{formatTime(detailClaim.reviewedAt)}</Text>
                </View>
              )}
              <View className='detail-section'>
                <Text className='detail-section__label'>提交时间</Text>
                <Text className='detail-section__value'>{formatTime(detailClaim.createdAt)}</Text>
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeDetail} style={{ flex: 'unset', width: '100%' }}>
                <Text>关闭</Text>
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
              <Text className='form-modal__title'>新建积分申请</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {formError && (
              <View className='form-modal__error'><Text>{formError}</Text></View>
            )}
            <View className='form-modal__body'>
              {/* Role selector - only show if user has multiple eligible roles */}
              {eligibleRoles.length > 1 && (
                <View className='form-field'>
                  <Text className='form-field__label'>提交身份</Text>
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
                  <Text className='form-field__label'>提交身份</Text>
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
                <Text className='form-field__label'>申请标题（1~100 字符）</Text>
                <Input
                  className='form-field__input'
                  value={formTitle}
                  onInput={(e) => setFormTitle(e.detail.value)}
                  placeholder='请输入申请标题'
                  maxlength={100}
                />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>申请描述（1~1000 字符）</Text>
                <Textarea
                  className='form-field__textarea'
                  value={formDesc}
                  onInput={(e) => setFormDesc(e.detail.value)}
                  placeholder='请描述您的社区贡献...'
                  maxlength={1000}
                />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>活动图片（最多 5 张，可选）</Text>
                <View className='image-upload-grid'>
                  {formImages.map((img, i) => (
                    <View key={i} className='image-upload-item'>
                      {img.uploading ? (
                        <View className='image-upload-item__loading'><Text>上传中...</Text></View>
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
                      <Text className='image-upload-add__text'>上传图片</Text>
                    </View>
                  )}
                </View>
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>活动链接（可选）</Text>
                <Input
                  className='form-field__input'
                  value={formActivityUrl}
                  onInput={(e) => setFormActivityUrl(e.detail.value)}
                  placeholder='https://...'
                />
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeForm}>
                <Text>取消</Text>
              </View>
              <View
                className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmitClaim}
              >
                <Text>{submitting ? '提交中...' : '提交申请'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
