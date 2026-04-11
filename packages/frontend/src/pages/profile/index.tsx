import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import { TicketIcon, LocationIcon, ClaimIcon, SettingsIcon, VoucherIcon, ShoppingBagIcon } from '../../components/icons';
import { ProfileSkeleton } from '../../components/Skeleton';
import TabBar from '../../components/TabBar';
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
        <ProfileErrorContent />
      );
    }
    return this.props.children;
  }
}

function ProfileErrorContent() {
  const { t } = useTranslation();
  return (
    <View className='profile-page' style={{ padding: '40px 20px', textAlign: 'center' }}>
      <Text style={{ color: '#ef4444', fontSize: '16px' }}>{t('profile.pageError')}</Text>
      <View style={{ marginTop: '16px', cursor: 'pointer', color: '#7c6df0' }}
        onClick={() => { window.location.hash = '#/pages/login/index'; window.location.reload(); }}>
        <Text>{t('profile.backToLogin')}</Text>
      </View>
    </View>
  );
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
  productId: string;
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
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

/** Quick action items for 2×2 grid */
const QUICK_ACTIONS = [
  { key: 'redeem', labelKey: 'profile.quickActionRedeem', icon: TicketIcon, url: '/pages/redeem/index?type=points-code' },
  { key: 'address', labelKey: 'profile.quickActionAddress', icon: LocationIcon, url: '/pages/address/index' },
  { key: 'claims', labelKey: 'profile.quickActionClaims', icon: ClaimIcon, url: '/pages/claims/index' },
  { key: 'settings', labelKey: 'profile.quickActionSettings', icon: SettingsIcon, url: '/pages/settings/index' },
] as const;

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
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const fetchProfile = useAppStore((s) => s.fetchProfile);

  const [activeTab, setActiveTab] = useState<ActiveTab>('points');

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

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** Format points record source to user-friendly text */
  const formatSource = (source: string, type: 'earn' | 'spend'): string => {
    if (!source) return type === 'earn' ? t('profile.sourceEarn') : t('profile.sourceSpend');
    if (source.startsWith('积分申请审批:')) {
      return t('profile.sourceClaimApproval');
    }
    if (type === 'earn' && /^[A-Z0-9_-]+$/i.test(source)) {
      return t('profile.sourceRedeemCode', { code: source });
    }
    if (type === 'spend') {
      return t('profile.sourceRedeemProduct', { name: source });
    }
    return source;
  };

  const statusLabel: Record<string, { text: string; className: string }> = {
    success: { text: t('profile.statusSuccess'), className: 'status--success' },
    pending: { text: t('profile.statusPending'), className: 'status--pending' },
    failed: { text: t('profile.statusFailed'), className: 'status--failed' },
  };

  const shippingLabel: Record<string, { text: string; className: string }> = {
    pending: { text: t('profile.shippingPending'), className: 'shipping-tag--pending' },
    shipped: { text: t('profile.shippingShipped'), className: 'shipping-tag--shipped' },
    in_transit: { text: t('profile.shippingInTransit'), className: 'shipping-tag--in-transit' },
    delivered: { text: t('profile.shippingDelivered'), className: 'shipping-tag--delivered' },
  };

  const handleRedemptionClick = (record: RedemptionRecord) => {
    if (record.orderId) {
      Taro.navigateTo({ url: `/pages/order-detail/index?id=${record.orderId}` });
    } else if (record.productId) {
      Taro.navigateTo({ url: `/pages/product/index?id=${record.productId}` });
    }
  };

  const hasMorePoints = pointsRecords.length < pointsTotal;
  const hasMoreRedemptions = redemptionRecords.length < redemptionsTotal;

  // Safely access user roles (may be undefined from API)
  const userRoles = user?.roles ?? [];

  const profileLoading = !user;

  return (
    <View className='profile-page'>
      {/* Skeleton while user data is loading */}
      {profileLoading ? (
        <ProfileSkeleton />
      ) : (
        <View className='profile-content profile-content--loaded'>
          {/* User Card */}
          <View className='profile-card'>
            <View className='profile-card__avatar'>
              <Text className='profile-card__avatar-text'>
                {user.nickname?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
            <View className='profile-card__info'>
              <Text className='profile-card__nickname'>{user.nickname || t('profile.userFallback')}</Text>
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
                {user.points?.toLocaleString() || '0'}
              </Text>
              <Text className='profile-card__points-label'>{t('profile.pointsLabel')}</Text>
            </View>
          </View>

          {/* Quick Actions Grid (2×2) */}
          <View className='profile-actions-grid'>
            {QUICK_ACTIONS.map((action) => {
              const IconComponent = action.icon;
              return (
                <View
                  key={action.key}
                  className='profile-actions-grid__item'
                  onClick={() => Taro.navigateTo({ url: action.url })}
                >
                  <View className='profile-actions-grid__icon'>
                    <IconComponent size={24} color='var(--accent-primary)' />
                  </View>
                  <Text className='profile-actions-grid__label'>{t(action.labelKey)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Tab Switcher */}
      <View className='profile-tabs'>
        <View
          className={`profile-tabs__item ${activeTab === 'points' ? 'profile-tabs__item--active' : ''}`}
          onClick={() => handleTabSwitch('points')}
        >
          <Text>{t('profile.tabPoints')}</Text>
        </View>
        <View
          className={`profile-tabs__item ${activeTab === 'redemptions' ? 'profile-tabs__item--active' : ''}`}
          onClick={() => handleTabSwitch('redemptions')}
        >
          <Text>{t('profile.tabRedemptions')}</Text>
        </View>
      </View>

      {/* Points Records Tab */}
      {activeTab === 'points' && (
        <View className='record-list'>
          {pointsRecords.length === 0 && !pointsLoading ? (
            <View className='record-list__empty'>
              <View className='record-list__empty-icon'>
                <VoucherIcon size={40} color='var(--text-tertiary)' />
              </View>
              <Text className='record-list__empty-text'>{t('profile.noPointsRecords')}</Text>
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
                  <Text>{pointsLoading ? t('profile.loading') : t('profile.loadMore')}</Text>
                </View>
              )}
            </>
          )}
          {pointsLoading && pointsRecords.length === 0 && (
            <View className='record-list__loading'>
              <Text>{t('profile.loading')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Redemption Records Tab */}
      {activeTab === 'redemptions' && (
        <View className='record-list'>
          {redemptionRecords.length === 0 && !redemptionsLoading ? (
            <View className='record-list__empty'>
              <View className='record-list__empty-icon'>
                <ShoppingBagIcon size={40} color='var(--text-tertiary)' />
              </View>
              <Text className='record-list__empty-text'>{t('profile.noRedemptionRecords')}</Text>
            </View>
          ) : (
            <>
              {redemptionRecords.map((record) => {
                const st = statusLabel[record.status] || statusLabel.pending;
                const shipping = record.shippingStatus ? shippingLabel[record.shippingStatus] : null;
                return (
                  <View
                    key={record.redemptionId}
                    className={`record-item ${record.orderId || record.productId ? 'record-item--clickable' : ''}`}
                    onClick={() => handleRedemptionClick(record)}
                  >
                    <View className='record-item__left'>
                      <View className={`record-item__icon ${record.method === 'points' ? 'record-item__icon--spend' : 'record-item__icon--code'}`}>
                        {record.method === 'points' ? '◆' : <VoucherIcon size={18} />}
                      </View>
                      <View className='record-item__info'>
                        <Text className='record-item__source'>{record.productName}</Text>
                        <View className='record-item__meta'>
                          <Text className='record-item__time'>{formatTime(record.createdAt)}</Text>
                          <Text className='record-item__method'>
                            {record.method === 'points' ? t('profile.methodPoints') : t('profile.methodCode')}
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
                  <Text>{redemptionsLoading ? t('profile.loading') : t('profile.loadMore')}</Text>
                </View>
              )}
            </>
          )}
          {redemptionsLoading && redemptionRecords.length === 0 && (
            <View className='record-list__loading'>
              <Text>{t('profile.loading')}</Text>
            </View>
          )}
        </View>
      )}

      <TabBar current='/pages/profile/index' />
    </View>
  );
}
