import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { ClaimIcon } from '../../components/icons';
import {
  ShippingStatus,
  SHIPPING_STATUS_ORDER,
  validateStatusTransition,
  maskPhone,
} from '@points-mall/shared';
import type { OrderResponse, OrderListItem, OrderStats, ShippingEvent } from '@points-mall/shared';
import './orders.scss';

export default function AdminOrdersPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const isOrderAdmin = userRoles.includes('OrderAdmin');
  const { t } = useTranslation();

  const STATUS_LABELS: Record<ShippingStatus, string> = {
    pending: t('admin.orders.statusPending'),
    shipped: t('admin.orders.statusShipped'),
    cancelled: t('admin.orders.statusCancelled'),
  };

  const STATUS_TABS: { key: ShippingStatus | 'all'; label: string }[] = [
    { key: 'all', label: t('admin.orders.filterAll') },
    { key: 'pending', label: t('admin.orders.statusPending') },
    { key: 'shipped', label: t('admin.orders.statusShipped') },
    { key: 'cancelled', label: t('admin.orders.statusCancelled') },
  ];

  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ShippingStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Expanded order detail
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Shipping update form
  const [showShipForm, setShowShipForm] = useState(false);
  const [shipTargetStatus, setShipTargetStatus] = useState<ShippingStatus | ''>('');
  const [shipTrackingNumber, setShipTrackingNumber] = useState('');
  const [shipRemark, setShipRemark] = useState('');
  const [shipSubmitting, setShipSubmitting] = useState(false);
  const [shipError, setShipError] = useState('');

  // Cancel order dialog
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const PAGE_SIZE = 10;

  const fetchStats = useCallback(async () => {
    try {
      const res = await request<OrderStats>({ url: '/api/admin/orders/stats' });
      setStats(res);
    } catch {
      setStats(null);
    }
  }, []);

  const fetchOrders = useCallback(async (status: ShippingStatus | 'all', p: number, append = false) => {
    setLoading(!append);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      params.set('page', String(p));
      params.set('pageSize', String(PAGE_SIZE));
      const res = await request<{ orders: OrderListItem[]; total: number }>({
        url: `/api/admin/orders?${params.toString()}`,
      });
      if (append) {
        setOrders((prev) => [...prev, ...res.orders]);
      } else {
        setOrders(res.orders);
      }
      setHasMore(res.orders.length >= PAGE_SIZE);
    } catch {
      if (!append) setOrders([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    // SuperAdmin and OrderAdmin always have access; only check toggle for Admin
    if (!isSuperAdmin && !isOrderAdmin) {
      request<{ adminOrdersEnabled: boolean }>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      })
        .then((res) => {
          if (!res.adminOrdersEnabled) {
            Taro.redirectTo({ url: '/pages/admin/index' });
          } else {
            fetchStats();
            fetchOrders(activeTab, 1);
          }
        })
        .catch(() => {
          fetchStats();
          fetchOrders(activeTab, 1);
        });
    } else {
      fetchStats();
      fetchOrders(activeTab, 1);
    }
  }, [isAuthenticated, isSuperAdmin, isOrderAdmin, fetchStats, fetchOrders, activeTab]);

  const handleTabChange = (tab: ShippingStatus | 'all') => {
    setActiveTab(tab);
    setPage(1);
    setExpandedOrderId(null);
    setOrderDetail(null);
    setShowShipForm(false);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchOrders(activeTab, nextPage, true);
  };

  const handleExpandOrder = async (orderId: string) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      setOrderDetail(null);
      setShowShipForm(false);
      return;
    }
    setExpandedOrderId(orderId);
    setShowShipForm(false);
    setDetailLoading(true);
    try {
      const res = await request<OrderResponse>({ url: `/api/admin/orders/${orderId}` });
      setOrderDetail(res);
    } catch {
      setOrderDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openShipForm = () => {
    if (!orderDetail) return;
    const currentIdx = SHIPPING_STATUS_ORDER.indexOf(orderDetail.shippingStatus);
    const nextStatus = currentIdx < SHIPPING_STATUS_ORDER.length - 1
      ? SHIPPING_STATUS_ORDER[currentIdx + 1]
      : '';
    setShipTargetStatus(nextStatus as ShippingStatus | '');
    setShipTrackingNumber(orderDetail.trackingNumber || '');
    setShipRemark('');
    setShipError('');
    setShowShipForm(true);
  };

  const handleShipSubmit = async () => {
    if (!orderDetail || !shipTargetStatus) return;

    const validation = validateStatusTransition(orderDetail.shippingStatus, shipTargetStatus as ShippingStatus);
    if (!validation.valid) {
      setShipError(validation.message || t('admin.orders.statusTransitionInvalid'));
      return;
    }

    if (shipTargetStatus === 'shipped' && !shipTrackingNumber.trim()) {
      setShipError(t('admin.orders.trackingNumberRequired'));
      return;
    }

    setShipSubmitting(true);
    setShipError('');
    try {
      await request({
        url: `/api/admin/orders/${orderDetail.orderId}/shipping`,
        method: 'PATCH',
        data: {
          status: shipTargetStatus,
          trackingNumber: shipTrackingNumber.trim() || undefined,
          remark: shipRemark.trim() || undefined,
        },
      });
      Taro.showToast({ title: t('admin.orders.shippingUpdated'), icon: 'none' });
      setShowShipForm(false);
      // Refresh detail and list
      const res = await request<OrderResponse>({ url: `/api/admin/orders/${orderDetail.orderId}` });
      setOrderDetail(res);
      fetchStats();
      fetchOrders(activeTab, 1);
      setPage(1);
    } catch (err) {
      setShipError(err instanceof RequestError ? err.message : t('admin.orders.updateFailed'));
    } finally {
      setShipSubmitting(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!orderDetail) return;
    setCancelSubmitting(true);
    try {
      const res = await request<{ message: string; userDeleted?: boolean }>({
        url: `/api/admin/orders/${orderDetail.orderId}/cancel`,
        method: 'POST',
      });
      if (res.userDeleted) {
        Taro.showToast({ title: t('admin.orders.cancelSuccessUserDeleted'), icon: 'none', duration: 3000 });
      } else {
        Taro.showToast({ title: t('admin.orders.cancelSuccess'), icon: 'none' });
      }
      setShowCancelDialog(false);
      // Refresh detail, list, and stats
      const detail = await request<OrderResponse>({ url: `/api/admin/orders/${orderDetail.orderId}` });
      setOrderDetail(detail);
      fetchStats();
      fetchOrders(activeTab, 1);
      setPage(1);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('common.operationFailed'),
        icon: 'none',
      });
    } finally {
      setCancelSubmitting(false);
    }
  };

  const handleBack = () => {
    if (isOrderAdmin) {
      goBack('/pages/settings/index');
    } else {
      goBack('/pages/admin/index');
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const getNextStatusLabel = (current: ShippingStatus): string | null => {
    const idx = SHIPPING_STATUS_ORDER.indexOf(current);
    if (idx < SHIPPING_STATUS_ORDER.length - 1) {
      return STATUS_LABELS[SHIPPING_STATUS_ORDER[idx + 1]];
    }
    return null;
  };

  return (
    <View className='admin-orders'>
      <View className='admin-orders__toolbar'>
        <View className='admin-orders__back' onClick={handleBack}>
          <Text>{t('admin.orders.backButton')}</Text>
        </View>
        <Text className='admin-orders__title'>{t('admin.orders.title')}</Text>
        <View className='admin-orders__spacer' />
      </View>

      {/* Stats Cards */}
      {stats && (
        <View className='order-stats'>
          <View className='order-stats__card order-stats__card--warning'>
            <Text className='order-stats__num'>{stats.pending}</Text>
            <Text className='order-stats__label'>{t('admin.orders.statsPending')}</Text>
          </View>
          <View className='order-stats__card order-stats__card--info'>
            <Text className='order-stats__num'>{stats.shipped}</Text>
            <Text className='order-stats__label'>{t('admin.orders.statsShipped')}</Text>
          </View>
          <View className='order-stats__card order-stats__card--error'>
            <Text className='order-stats__num'>{stats.cancelled}</Text>
            <Text className='order-stats__label'>{t('admin.orders.statsCancelled')}</Text>
          </View>
        </View>
      )}

      {/* Status Filter Tabs */}
      <View className='order-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`order-tabs__item ${activeTab === tab.key ? 'order-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Order List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('admin.orders.loading')}</Text></View>
      ) : orders.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><ClaimIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('admin.orders.noOrders')}</Text>
        </View>
      ) : (
        <View className='order-list'>
          {orders.map((order) => (
            <View key={order.orderId} className='order-card'>
              <View className='order-card__header' onClick={() => handleExpandOrder(order.orderId)}>
                <View className='order-card__info'>
                  <Text className='order-card__id'>#{order.orderId.slice(0, 12)}</Text>
                  <Text className='order-card__time'>{formatTime(order.createdAt)}</Text>
                </View>
                <View className='order-card__right'>
                  <Text className={`order-card__status order-card__status--${order.shippingStatus}`}>
                    {STATUS_LABELS[order.shippingStatus]}
                  </Text>
                  <Text className='order-card__arrow'>
                    {expandedOrderId === order.orderId ? '▾' : '›'}
                  </Text>
                </View>
              </View>
              <View className='order-card__summary'>
                <Text className='order-card__meta'>{t('admin.orders.itemsCount', { count: order.itemCount })}</Text>
                <Text className='order-card__points'>◆ {order.totalPoints}</Text>
              </View>

              {/* Expanded Detail */}
              {expandedOrderId === order.orderId && (
                <View className='order-detail'>
                  {detailLoading ? (
                    <View className='order-detail__loading'><Text>{t('admin.orders.loadingDetail')}</Text></View>
                  ) : orderDetail ? (
                    <>
                      {/* Items */}
                      <View className='order-detail__section'>
                        <Text className='order-detail__section-title'>{t('admin.orders.productListTitle')}</Text>
                        {orderDetail.items.map((item, idx) => (
                          <View key={idx} className='order-detail__item'>
                            <View className='order-detail__item-info'>
                              <Text className='order-detail__item-name'>{item.productName}</Text>
                              <Text className='order-detail__item-qty'>×{item.quantity}</Text>
                            </View>
                            <Text className='order-detail__item-points'>◆ {item.subtotal}</Text>
                          </View>
                        ))}
                      </View>

                      {/* Shipping Address */}
                      <View className='order-detail__section'>
                        <Text className='order-detail__section-title'>{t('admin.orders.shippingInfoTitle')}</Text>
                        <View className='order-detail__address'>
                          <Text className='order-detail__addr-line'>
                            {orderDetail.shippingAddress.recipientName}　{maskPhone(orderDetail.shippingAddress.phone)}
                          </Text>
                          <Text className='order-detail__addr-detail'>
                            {orderDetail.shippingAddress.detailAddress}
                          </Text>
                        </View>
                      </View>

                      {/* Tracking Number */}
                      {orderDetail.trackingNumber && (
                        <View className='order-detail__section'>
                          <Text className='order-detail__section-title'>{t('admin.orders.trackingNumberTitle')}</Text>
                          <Text className='order-detail__tracking'>{orderDetail.trackingNumber}</Text>
                        </View>
                      )}

                      {/* Shipping Timeline */}
                      <View className='order-detail__section'>
                        <Text className='order-detail__section-title'>{t('admin.orders.shippingTimelineTitle')}</Text>
                        <View className='shipping-timeline'>
                          {orderDetail.shippingEvents.map((evt: ShippingEvent, idx: number) => (
                            <View key={idx} className={`shipping-timeline__item shipping-timeline__item--${evt.status}`}>
                              <View className='shipping-timeline__dot' />
                              <View className='shipping-timeline__content'>
                                <Text className='shipping-timeline__status'>
                                  {STATUS_LABELS[evt.status]}
                                </Text>
                                <Text className='shipping-timeline__time'>{formatTime(evt.timestamp)}</Text>
                                {evt.remark && (
                                  <Text className='shipping-timeline__remark'>{evt.remark}</Text>
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Update Shipping Action */}
                      {orderDetail.shippingStatus !== 'shipped' && orderDetail.shippingStatus !== 'cancelled' && !showShipForm && (
                        <View className='order-detail__action'>
                          <View className='order-detail__update-btn' onClick={openShipForm}>
                            <Text>{t('admin.orders.updateToStatus', { status: getNextStatusLabel(orderDetail.shippingStatus) ?? '' })}</Text>
                          </View>
                        </View>
                      )}

                      {/* Cancel Order Button — only for pending orders */}
                      {orderDetail.shippingStatus === 'pending' && !showShipForm && (
                        <View className='order-detail__action'>
                          <View className='btn-danger order-detail__cancel-btn' onClick={() => setShowCancelDialog(true)}>
                            <Text>{t('admin.orders.cancelButton')}</Text>
                          </View>
                        </View>
                      )}

                      {/* Shipping Update Form */}
                      {showShipForm && (
                        <View className='ship-form'>
                          <Text className='ship-form__title'>{t('admin.orders.updateShippingTitle')}</Text>
                          {shipError && (
                            <View className='ship-form__error'><Text>{shipError}</Text></View>
                          )}
                          <View className='ship-form__field'>
                            <Text className='ship-form__label'>{t('admin.orders.targetStatusLabel')}</Text>
                            <View className='ship-form__status-options'>
                              {SHIPPING_STATUS_ORDER.map((s) => {
                                const v = validateStatusTransition(orderDetail.shippingStatus, s);
                                return (
                                  <View
                                    key={s}
                                    className={`ship-form__status-opt ${shipTargetStatus === s ? 'ship-form__status-opt--active' : ''} ${!v.valid ? 'ship-form__status-opt--disabled' : ''}`}
                                    onClick={() => v.valid && setShipTargetStatus(s)}
                                  >
                                    <Text>{STATUS_LABELS[s]}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          </View>
                          {shipTargetStatus === 'shipped' && (
                            <View className='ship-form__field'>
                              <Text className='ship-form__label'>{t('admin.orders.trackingNumberLabel')}</Text>
                              <Input
                                className='ship-form__input'
                                value={shipTrackingNumber}
                                onInput={(e) => setShipTrackingNumber(e.detail.value)}
                                placeholder={t('admin.orders.trackingNumberPlaceholder')}
                              />
                            </View>
                          )}
                          <View className='ship-form__field'>
                            <Text className='ship-form__label'>{t('admin.orders.remarkLabel')}</Text>
                            <textarea
                              className='ship-form__textarea'
                              value={shipRemark}
                              onChange={(e) => setShipRemark((e.target as HTMLTextAreaElement).value)}
                              placeholder={t('admin.orders.remarkPlaceholder')}
                            />
                          </View>
                          <View className='ship-form__actions'>
                            <View className='ship-form__cancel' onClick={() => setShowShipForm(false)}>
                              <Text>{t('common.cancel')}</Text>
                            </View>
                            <View
                              className={`ship-form__submit ${shipSubmitting ? 'ship-form__submit--loading' : ''}`}
                              onClick={handleShipSubmit}
                            >
                              <Text>{shipSubmitting ? t('admin.orders.submitting') : t('admin.orders.confirmUpdate')}</Text>
                            </View>
                          </View>
                        </View>
                      )}
                    </>
                  ) : (
                    <View className='order-detail__loading'><Text>{t('admin.orders.loadFailed')}</Text></View>
                  )}
                </View>
              )}
            </View>
          ))}

          {hasMore && !loading && (
            <View className='order-list__more' onClick={handleLoadMore}>
              <Text>{t('admin.orders.loadMore')}</Text>
            </View>
          )}
        </View>
      )}
      {/* Cancel Order Confirmation Dialog */}
      {showCancelDialog && orderDetail && (
        <View className='cancel-confirm-dialog' onClick={() => !cancelSubmitting && setShowCancelDialog(false)}>
          <View className='cancel-confirm-dialog__content' onClick={(e) => e.stopPropagation()}>
            <Text className='cancel-confirm-dialog__title'>{t('admin.orders.cancelDialogTitle')}</Text>
            <Text className='cancel-confirm-dialog__message'>
              {t('admin.orders.cancelDialogMessage', {
                orderId: orderDetail.orderId.slice(0, 12),
                points: String(orderDetail.totalPoints),
              })}
            </Text>
            <View className='cancel-confirm-dialog__actions'>
              <View
                className='cancel-confirm-dialog__cancel-btn'
                onClick={() => !cancelSubmitting && setShowCancelDialog(false)}
              >
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`btn-danger cancel-confirm-dialog__confirm-btn ${cancelSubmitting ? 'cancel-confirm-dialog__confirm-btn--loading' : ''}`}
                onClick={() => !cancelSubmitting && handleCancelOrder()}
              >
                <Text>{cancelSubmitting ? t('admin.orders.submitting') : t('admin.orders.cancelConfirmButton')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
