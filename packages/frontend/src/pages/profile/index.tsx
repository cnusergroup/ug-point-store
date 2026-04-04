import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request, RequestError } from '../../utils/request';
import './index.scss';

/** Error boundary to prevent white screen */
class ProfileErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error('ProfilePage error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View className='profile-page' style={{ padding: '40px 20px', textAlign: 'center' }}>
          <Text style={{ color: '#ef4444', fontSize: '16px' }}>页面加载出错</Text>
          <View style={{ marginTop: '16px', cursor: 'pointer', color: '#7c6df0' }}
            onClick={() => { window.location.hash = '#/pages/login/index'; window.location.reload(); }}>
            <Text>返回登录</Text>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Points record from API */
interface PointsRecord {
  recordId: string;
  type: 'earn' | 'spend';
  amount: number;
  source: string;
  balanceAfter: number;
  createdAt: string;
}

/** Redemption record from API */
interface RedemptionRecord {
  redemptionId: string;
  productName: string;
  method: 'points' | 'code';
  pointsSpent?: number;
  status: 'success' | 'pending' | 'failed';
  orderId?: string;
  shippingStatus?: string;
  createdAt: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Role display config */
const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

type ActiveTab = 'points' | 'redemptions';

const PAGE_SIZE = 20;

export default function ProfilePageWrapper() {
  return (
    <ProfileErrorBoundary>
      <ProfilePage />
    </ProfileErrorBoundary>
  );
}

function ProfilePage() {
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const logout = useAppStore((s) => s.logout);
  const changePassword = useAppStore((s) => s.changePassword);
  const fetchProfile = useAppStore((s) => s.fetchProfile);

  const [activeTab, setActiveTab] = useState<ActiveTab>('points');

  // Change password modal state
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  // Points records state
  const [pointsRecords, setPointsRecords] = useState<PointsRecord[]>([]);
  const [pointsPage, setPointsPage] = useState(1);
  const [pointsTotal, setPointsTotal] = useState(0);
  const [pointsLoading, setPointsLoading] = useState(false);

  // Redemption records state
  const [redemptionRecords, setRedemptionRecords] = useState<RedemptionRecord[]>([]);
  const [redemptionsPage, setRedemptionsPage] = useState(1);
  const [redemptionsTotal, setRedemptionsTotal] = useState(0);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);

  // Refresh state
  const [refreshing, setRefreshing] = useState(false);

  const fetchPointsRecords = useCallback(async (page: number, reset = false) => {
    setPointsLoading(true);
    try {
      const res = await request<PaginatedResponse<PointsRecord>>({
        url: `/api/points/records?page=${page}&pageSize=${PAGE_SIZE}`,
      });
      if (res && res.items) {
        setPointsRecords((prev) => (reset ? res.items : [...prev, ...res.items]));
        setPointsTotal(res.total ?? 0);
        setPointsPage(page);
      }
    } catch {
      // silently fail — token expiry will trigger redirect via handleTokenExpired
    } finally {
      setPointsLoading(false);
    }
  }, []);

  const fetchRedemptionRecords = useCallback(async (page: number, reset = false) => {
    setRedemptionsLoading(true);
    try {
      const res = await request<PaginatedResponse<RedemptionRecord>>({
        url: `/api/redemptions/history?page=${page}&pageSize=${PAGE_SIZE}`,
      });
      if (res && res.items) {
        setRedemptionRecords((prev) => (reset ? res.items : [...prev, ...res.items]));
        setRedemptionsTotal(res.total ?? 0);
        setRedemptionsPage(page);
      }
    } catch {
      // silently fail
    } finally {
      setRedemptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchProfile();
    fetchPointsRecords(1, true);
    fetchRedemptionRecords(1, true);
  }, [isAuthenticated, fetchProfile, fetchPointsRecords, fetchRedemptionRecords]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      fetchPointsRecords(1, true),
      fetchRedemptionRecords(1, true),
    ]);
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (activeTab === 'points') {
      if (pointsLoading || pointsRecords.length >= pointsTotal) return;
      fetchPointsRecords(pointsPage + 1);
    } else {
      if (redemptionsLoading || redemptionRecords.length >= redemptionsTotal) return;
      fetchRedemptionRecords(redemptionsPage + 1);
    }
  };

  const handleTabSwitch = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handleLogout = () => {
    logout();
  };

  const goToRedeemCode = () => {
    Taro.navigateTo({ url: '/pages/redeem/index?type=points-code' });
  };

  const goToHome = () => {
    Taro.redirectTo({ url: '/pages/index/index' });
  };

  const openChangePwd = () => {
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setPwdError('');
    setPwdSuccess('');
    setShowChangePwd(true);
  };

  const closeChangePwd = () => {
    setShowChangePwd(false);
  };

  const validateNewPassword = (pwd: string): string => {
    if (pwd.length < 8) return '新密码至少需要 8 个字符';
    if (!/[a-zA-Z]/.test(pwd)) return '新密码需要包含字母';
    if (!/[0-9]/.test(pwd)) return '新密码需要包含数字';
    return '';
  };

  const handleChangePwd = async () => {
    setPwdError('');
    setPwdSuccess('');

    if (!currentPwd) {
      setPwdError('请输入当前密码');
      return;
    }
    const validationErr = validateNewPassword(newPwd);
    if (validationErr) {
      setPwdError(validationErr);
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('两次输入的新密码不一致');
      return;
    }

    setPwdSubmitting(true);
    try {
      await changePassword(currentPwd, newPwd);
      setPwdSuccess('密码修改成功');
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err: any) {
      const msg = err?.data?.message || err?.message || '密码修改失败，请重试';
      setPwdError(msg);
    } finally {
      setPwdSubmitting(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** Format points record source to user-friendly Chinese */
  const formatSource = (source: string, type: 'earn' | 'spend'): string => {
    if (!source) return type === 'earn' ? '积分获取' : '积分消费';
    // Claim approval: "积分申请审批:claimId"
    if (source.startsWith('积分申请审批:')) {
      return '积分申请审批';
    }
    // Earn from code: source is the code value (e.g. "EARN-500")
    if (type === 'earn' && /^[A-Z0-9_-]+$/i.test(source)) {
      return `兑换积分码 ${source}`;
    }
    // Spend on product: source is the product name (already Chinese)
    if (type === 'spend') {
      return `兑换商品「${source}」`;
    }
    return source;
  };

  const statusLabel: Record<string, { text: string; className: string }> = {
    success: { text: '成功', className: 'status--success' },
    pending: { text: '处理中', className: 'status--pending' },
    failed: { text: '失败', className: 'status--failed' },
  };

  const shippingLabel: Record<string, { text: string; className: string }> = {
    pending: { text: '待发货', className: 'shipping-tag--pending' },
    shipped: { text: '已发货', className: 'shipping-tag--shipped' },
    in_transit: { text: '运输中', className: 'shipping-tag--in-transit' },
    delivered: { text: '已签收', className: 'shipping-tag--delivered' },
  };

  const handleRedemptionClick = (record: RedemptionRecord) => {
    if (record.orderId) {
      Taro.navigateTo({ url: `/pages/order-detail/index?id=${record.orderId}` });
    }
  };

  const hasMorePoints = pointsRecords.length < pointsTotal;
  const hasMoreRedemptions = redemptionRecords.length < redemptionsTotal;

  // Safely access user roles (may be undefined from API)
  const userRoles = user?.roles ?? [];

  return (
    <View className='profile-page'>
      {/* User Info Card */}
      <View className='profile-card'>
        <View className='profile-card__avatar'>
          <Text className='profile-card__avatar-text'>
            {user?.nickname?.charAt(0)?.toUpperCase() || '?'}
          </Text>
        </View>
        <View className='profile-card__info'>
          <Text className='profile-card__nickname'>{user?.nickname || '用户'}</Text>
          {user?.email && (
            <Text className='profile-card__email'>{user.email}</Text>
          )}
          {userRoles.length > 0 && (
            <View className='profile-card__roles'>
              {userRoles.map((role) => (
                <Text key={role} className={`role-badge ${ROLE_CONFIG[role]?.className || ''}`}>
                  {ROLE_CONFIG[role]?.label || role}
                </Text>
              ))}
            </View>
          )}
        </View>
        <View className='profile-card__points'>
          <Text className='profile-card__points-diamond'>◆</Text>
          <Text className='profile-card__points-value'>
            {user?.points?.toLocaleString() || '0'}
          </Text>
          <Text className='profile-card__points-label'>积分</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View className='profile-actions'>
        <View className='profile-actions__btn' onClick={goToRedeemCode}>
          <Text className='profile-actions__btn-icon'>🎟️</Text>
          <Text className='profile-actions__btn-text'>兑换积分码</Text>
        </View>
        <View className='profile-actions__btn' onClick={goToHome}>
          <Text className='profile-actions__btn-icon'>🏪</Text>
          <Text className='profile-actions__btn-text'>商品列表</Text>
        </View>
        <View className='profile-actions__btn' onClick={() => Taro.navigateTo({ url: '/pages/address/index' })}>
          <Text className='profile-actions__btn-icon'>📍</Text>
          <Text className='profile-actions__btn-text'>收货地址</Text>
        </View>
        <View className='profile-actions__btn' onClick={() => Taro.navigateTo({ url: '/pages/orders/index' })}>
          <Text className='profile-actions__btn-icon'>📋</Text>
          <Text className='profile-actions__btn-text'>我的订单</Text>
        </View>
        <View className='profile-actions__btn' onClick={() => Taro.navigateTo({ url: '/pages/claims/index' })}>
          <Text className='profile-actions__btn-icon'>📝</Text>
          <Text className='profile-actions__btn-text'>积分申请</Text>
        </View>
        <View className='profile-actions__btn profile-actions__btn--refresh' onClick={handleRefresh}>
          <Text className='profile-actions__btn-icon'>{refreshing ? '⏳' : '🔄'}</Text>
          <Text className='profile-actions__btn-text'>刷新</Text>
        </View>
        <View className='profile-actions__btn' onClick={openChangePwd}>
          <Text className='profile-actions__btn-icon'>🔑</Text>
          <Text className='profile-actions__btn-text'>修改密码</Text>
        </View>
      </View>

      {/* Tab Switcher */}
      <View className='profile-tabs'>
        <View
          className={`profile-tabs__item ${activeTab === 'points' ? 'profile-tabs__item--active' : ''}`}
          onClick={() => handleTabSwitch('points')}
        >
          <Text>积分记录</Text>
        </View>
        <View
          className={`profile-tabs__item ${activeTab === 'redemptions' ? 'profile-tabs__item--active' : ''}`}
          onClick={() => handleTabSwitch('redemptions')}
        >
          <Text>兑换记录</Text>
        </View>
      </View>

      {/* Points Records Tab */}
      {activeTab === 'points' && (
        <View className='record-list'>
          {pointsRecords.length === 0 && !pointsLoading ? (
            <View className='record-list__empty'>
              <Text className='record-list__empty-icon'>📋</Text>
              <Text className='record-list__empty-text'>暂无积分记录</Text>
            </View>
          ) : (
            <>
              {pointsRecords.map((record) => (
                <View key={record.recordId} className='record-item'>
                  <View className='record-item__left'>
                    <Text className={`record-item__icon ${record.type === 'earn' ? 'record-item__icon--earn' : 'record-item__icon--spend'}`}>
                      {record.type === 'earn' ? '↑' : '↓'}
                    </Text>
                    <View className='record-item__info'>
                      <Text className='record-item__source'>{formatSource(record.source, record.type)}</Text>
                      <Text className='record-item__time'>{formatTime(record.createdAt)}</Text>
                    </View>
                  </View>
                  <Text className={`record-item__amount ${record.type === 'earn' ? 'record-item__amount--earn' : 'record-item__amount--spend'}`}>
                    {record.amount > 0 ? '+' : ''}{record.amount.toLocaleString()}
                  </Text>
                </View>
              ))}
              {hasMorePoints && (
                <View className='record-list__load-more' onClick={handleLoadMore}>
                  <Text>{pointsLoading ? '加载中...' : '加载更多'}</Text>
                </View>
              )}
            </>
          )}
          {pointsLoading && pointsRecords.length === 0 && (
            <View className='record-list__loading'>
              <Text>加载中...</Text>
            </View>
          )}
        </View>
      )}

      {/* Redemption Records Tab */}
      {activeTab === 'redemptions' && (
        <View className='record-list'>
          {redemptionRecords.length === 0 && !redemptionsLoading ? (
            <View className='record-list__empty'>
              <Text className='record-list__empty-icon'>🛍️</Text>
              <Text className='record-list__empty-text'>暂无兑换记录</Text>
            </View>
          ) : (
            <>
              {redemptionRecords.map((record) => {
                const st = statusLabel[record.status] || statusLabel.pending;
                const shipping = record.shippingStatus ? shippingLabel[record.shippingStatus] : null;
                return (
                  <View
                    key={record.redemptionId}
                    className={`record-item ${record.orderId ? 'record-item--clickable' : ''}`}
                    onClick={() => handleRedemptionClick(record)}
                  >
                    <View className='record-item__left'>
                      <Text className={`record-item__icon ${record.method === 'points' ? 'record-item__icon--spend' : 'record-item__icon--code'}`}>
                        {record.method === 'points' ? '◆' : '🎫'}
                      </Text>
                      <View className='record-item__info'>
                        <Text className='record-item__source'>{record.productName}</Text>
                        <View className='record-item__meta'>
                          <Text className='record-item__time'>{formatTime(record.createdAt)}</Text>
                          <Text className='record-item__method'>
                            {record.method === 'points' ? '积分兑换' : 'Code 兑换'}
                          </Text>
                        </View>
                      </View>
                    </View>
                    {shipping ? (
                      <Text className={`shipping-tag ${shipping.className}`}>{shipping.text}</Text>
                    ) : (
                      <Text className={`record-item__status ${st.className}`}>{st.text}</Text>
                    )}
                  </View>
                );
              })}
              {hasMoreRedemptions && (
                <View className='record-list__load-more' onClick={handleLoadMore}>
                  <Text>{redemptionsLoading ? '加载中...' : '加载更多'}</Text>
                </View>
              )}
            </>
          )}
          {redemptionsLoading && redemptionRecords.length === 0 && (
            <View className='record-list__loading'>
              <Text>加载中...</Text>
            </View>
          )}
        </View>
      )}

      {/* Logout */}
      <View className='profile-logout' onClick={handleLogout}>
        <Text>退出登录</Text>
      </View>

      {/* Change Password Modal */}
      {showChangePwd && (
        <View className='pwd-modal-overlay' onClick={closeChangePwd}>
          <View className='pwd-modal' onClick={(e) => e.stopPropagation()}>
            <Text className='pwd-modal__title'>修改密码</Text>

            {pwdSuccess && (
              <View className='pwd-modal__feedback pwd-modal__feedback--success'>
                <Text>{pwdSuccess}</Text>
              </View>
            )}
            {pwdError && (
              <View className='pwd-modal__feedback pwd-modal__feedback--error'>
                <Text>{pwdError}</Text>
              </View>
            )}

            <View className='pwd-modal__field'>
              <Text className='pwd-modal__label'>当前密码</Text>
              <input
                className='pwd-modal__input'
                type='password'
                placeholder='请输入当前密码'
                value={currentPwd}
                onInput={(e: any) => setCurrentPwd(e.target.value || e.detail?.value || '')}
              />
            </View>

            <View className='pwd-modal__field'>
              <Text className='pwd-modal__label'>新密码</Text>
              <input
                className='pwd-modal__input'
                type='password'
                placeholder='至少 8 位，包含字母和数字'
                value={newPwd}
                onInput={(e: any) => setNewPwd(e.target.value || e.detail?.value || '')}
              />
            </View>

            <View className='pwd-modal__field'>
              <Text className='pwd-modal__label'>确认新密码</Text>
              <input
                className='pwd-modal__input'
                type='password'
                placeholder='再次输入新密码'
                value={confirmPwd}
                onInput={(e: any) => setConfirmPwd(e.target.value || e.detail?.value || '')}
              />
            </View>

            <View className='pwd-modal__actions'>
              <View className='btn-secondary pwd-modal__btn' onClick={closeChangePwd}>
                <Text>取消</Text>
              </View>
              <View
                className={`btn-primary pwd-modal__btn ${pwdSubmitting ? 'btn-primary--disabled' : ''}`}
                onClick={pwdSubmitting ? undefined : handleChangePwd}
              >
                <Text>{pwdSubmitting ? '提交中...' : '确认修改'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
