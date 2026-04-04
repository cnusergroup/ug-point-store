import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Textarea, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
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

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

export default function AdminClaimsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

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
      setApproveError('请输入 1~10000 之间的整数积分');
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
      Taro.showToast({ title: '已批准', icon: 'none' });
      closeApprove();
      fetchClaims(statusFilter);
    } catch (err) {
      setApproveError(err instanceof RequestError ? err.message : '操作失败');
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
      setRejectError('请输入 1~500 字符的驳回原因');
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
      Taro.showToast({ title: '已驳回', icon: 'none' });
      closeReject();
      fetchClaims(statusFilter);
    } catch (err) {
      setRejectError(err instanceof RequestError ? err.message : '操作失败');
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
          <Text>‹ 返回</Text>
        </View>
        <Text className='admin-claims__title'>积分审批</Text>
        <View style={{ width: '60px' }} />
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
                      <Text className={`claim-status ${st.className}`}>{st.label}</Text>
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
                <Text className='detail-section__label'>申请人</Text>
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
              {detailClaim.status === 'pending' ? (
                <>
                  <View className='form-modal__cancel' onClick={() => openReject(detailClaim)}>
                    <Text>驳回</Text>
                  </View>
                  <View className='form-modal__submit' onClick={() => openApprove(detailClaim)}>
                    <Text>批准</Text>
                  </View>
                </>
              ) : (
                <View className='form-modal__cancel' onClick={closeDetail} style={{ flex: 'unset', width: '100%' }}>
                  <Text>关闭</Text>
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
              <Text className='form-modal__title'>批准申请</Text>
              <View className='form-modal__close' onClick={closeApprove}><Text>✕</Text></View>
            </View>
            {approveError && (
              <View className='form-modal__error'><Text>{approveError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                批准「{approveClaim.applicantNickname}」的申请「{approveClaim.title}」
              </Text>
              <View className='form-field'>
                <Text className='form-field__label'>奖励积分（1~10000）</Text>
                <Input
                  className='form-field__input'
                  type='number'
                  value={approvePoints}
                  onInput={(e) => setApprovePoints(e.detail.value)}
                  placeholder='请输入奖励积分数值'
                />
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeApprove}>
                <Text>取消</Text>
              </View>
              <View
                className={`form-modal__submit ${approving ? 'form-modal__submit--loading' : ''}`}
                onClick={handleApprove}
              >
                <Text>{approving ? '提交中...' : '确认批准'}</Text>
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
              <Text className='form-modal__title'>驳回申请</Text>
              <View className='form-modal__close' onClick={closeReject}><Text>✕</Text></View>
            </View>
            {rejectError && (
              <View className='form-modal__error'><Text>{rejectError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                驳回「{rejectClaim.applicantNickname}」的申请「{rejectClaim.title}」
              </Text>
              <View className='form-field'>
                <Text className='form-field__label'>驳回原因（1~500 字符）</Text>
                <Textarea
                  className='form-field__textarea'
                  value={rejectReason}
                  onInput={(e) => setRejectReason(e.detail.value)}
                  placeholder='请输入驳回原因'
                  maxlength={500}
                />
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeReject}>
                <Text>取消</Text>
              </View>
              <View
                className={`form-modal__submit form-modal__submit--danger ${rejecting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleReject}
              >
                <Text>{rejecting ? '提交中...' : '确认驳回'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
