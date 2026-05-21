import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { WishStatus, WishRecord } from '@points-mall/shared';
import './wishes.scss';

type StatusFilter = 'all' | WishStatus;

interface AdminWishListResponse {
  wishes: WishRecord[];
  total: number;
}

/** Lightweight product item for the fulfill picker */
interface ProductOption {
  productId: string;
  name: string;
  imageUrl?: string;
  pointsCost?: number;
  status?: string;
}

const PAGE_SIZE = 20;

export default function AdminWishesPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  const [wishes, setWishes] = useState<WishRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Review modal (approve/reject for pending wishes)
  const [reviewTarget, setReviewTarget] = useState<WishRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [closeReason, setCloseReason] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  // Status management modal (adopt/fulfill/close)
  const [statusTarget, setStatusTarget] = useState<WishRecord | null>(null);
  const [statusAction, setStatusAction] = useState<'adopt' | 'fulfill' | 'close'>('adopt');
  const [fulfillProductId, setFulfillProductId] = useState('');
  const [statusCloseReason, setStatusCloseReason] = useState('');
  const [statusError, setStatusError] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  // Product picker state (for fulfill action)
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('admin.wishes.filterAll') },
    { key: 'pending', label: t('admin.wishes.statusPending') },
    { key: 'approved', label: t('admin.wishes.statusApproved') },
    { key: 'adopted', label: t('admin.wishes.statusAdopted') },
    { key: 'fulfilled', label: t('admin.wishes.statusFulfilled') },
    { key: 'closed', label: t('admin.wishes.statusClosed') },
  ];

  const STATUS_LABELS: Record<WishStatus, string> = {
    pending: t('admin.wishes.statusPending'),
    approved: t('admin.wishes.statusApproved'),
    adopted: t('admin.wishes.statusAdopted'),
    fulfilled: t('admin.wishes.statusFulfilled'),
    closed: t('admin.wishes.statusClosed'),
  };

  const fetchWishes = useCallback(async (status: StatusFilter, p: number, append = false) => {
    if (!append) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      params.set('page', String(p));
      params.set('pageSize', String(PAGE_SIZE));
      const res = await request<AdminWishListResponse>({
        url: `/api/admin/wishes?${params.toString()}`,
      });
      if (append) {
        setWishes((prev) => [...prev, ...res.wishes]);
      } else {
        setWishes(res.wishes);
      }
      setHasMore(res.wishes.length >= PAGE_SIZE);
    } catch {
      if (!append) setWishes([]);
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
    fetchWishes(activeTab, 1);
  }, [isAuthenticated, fetchWishes, activeTab]);

  const handleTabChange = (tab: StatusFilter) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchWishes(activeTab, nextPage, true);
  };

  // --- Review actions (pending wishes) ---
  const openReview = (wish: WishRecord, action: 'approve' | 'reject') => {
    setReviewTarget(wish);
    setReviewAction(action);
    setCloseReason('');
    setReviewError('');
  };

  const closeReview = () => {
    setReviewTarget(null);
    setReviewError('');
  };

  const handleReviewSubmit = async () => {
    if (!reviewTarget) return;
    if (reviewAction === 'reject' && !closeReason.trim()) {
      setReviewError(t('admin.wishes.closeReasonRequired'));
      return;
    }
    setReviewSubmitting(true);
    setReviewError('');
    try {
      await request({
        url: `/api/admin/wishes/${reviewTarget.wishId}/review`,
        method: 'PATCH',
        data: {
          action: reviewAction,
          closeReason: reviewAction === 'reject' ? closeReason.trim() : undefined,
        },
      });
      Taro.showToast({
        title: reviewAction === 'approve'
          ? t('admin.wishes.approveSuccess')
          : t('admin.wishes.rejectSuccess'),
        icon: 'none',
      });
      closeReview();
      fetchWishes(activeTab, 1);
      setPage(1);
    } catch (err) {
      setReviewError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setReviewSubmitting(false);
    }
  };

  // --- Status management actions (adopt/fulfill/close) ---
  const fetchProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await request<{ items: ProductOption[] }>({
        url: '/api/products?pageSize=200&includeInactive=true',
      });
      setProductOptions(res.items || []);
    } catch {
      setProductOptions([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const openStatusAction = (wish: WishRecord, action: 'adopt' | 'fulfill' | 'close') => {
    setStatusTarget(wish);
    setStatusAction(action);
    setFulfillProductId('');
    setStatusCloseReason('');
    setStatusError('');
    setProductSearch('');
    // Load products when opening the fulfill dialog
    if (action === 'fulfill' && productOptions.length === 0) {
      fetchProducts();
    }
  };

  const closeStatusAction = () => {
    setStatusTarget(null);
    setStatusError('');
  };

  const handleStatusSubmit = async () => {
    if (!statusTarget) return;
    if (statusAction === 'fulfill' && !fulfillProductId.trim()) {
      setStatusError(t('admin.wishes.productIdRequired'));
      return;
    }
    if (statusAction === 'close' && !statusCloseReason.trim()) {
      setStatusError(t('admin.wishes.closeReasonRequired'));
      return;
    }
    setStatusSubmitting(true);
    setStatusError('');
    try {
      const targetStatus: WishStatus = statusAction === 'adopt' ? 'adopted'
        : statusAction === 'fulfill' ? 'fulfilled'
        : 'closed';
      await request({
        url: `/api/admin/wishes/${statusTarget.wishId}/status`,
        method: 'PATCH',
        data: {
          targetStatus,
          productId: statusAction === 'fulfill' ? fulfillProductId.trim() : undefined,
          closeReason: statusAction === 'close' ? statusCloseReason.trim() : undefined,
        },
      });
      Taro.showToast({ title: t('admin.wishes.statusUpdateSuccess'), icon: 'none' });
      closeStatusAction();
      fetchWishes(activeTab, 1);
      setPage(1);
    } catch (err) {
      setStatusError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setStatusSubmitting(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** Determine which actions are available for a wish based on its status */
  const getAvailableActions = (wish: WishRecord) => {
    const actions: { key: string; label: string; type: 'primary' | 'danger' | 'secondary'; handler: () => void }[] = [];
    switch (wish.status) {
      case 'pending':
        actions.push({ key: 'approve', label: t('admin.wishes.approveButton'), type: 'primary', handler: () => openReview(wish, 'approve') });
        actions.push({ key: 'reject', label: t('admin.wishes.rejectButton'), type: 'danger', handler: () => openReview(wish, 'reject') });
        break;
      case 'approved':
        actions.push({ key: 'adopt', label: t('admin.wishes.adoptButton'), type: 'primary', handler: () => openStatusAction(wish, 'adopt') });
        actions.push({ key: 'close', label: t('admin.wishes.closeButton'), type: 'danger', handler: () => openStatusAction(wish, 'close') });
        break;
      case 'adopted':
        actions.push({ key: 'fulfill', label: t('admin.wishes.fulfillButton'), type: 'primary', handler: () => openStatusAction(wish, 'fulfill') });
        actions.push({ key: 'close', label: t('admin.wishes.closeButton'), type: 'danger', handler: () => openStatusAction(wish, 'close') });
        break;
      default:
        break;
    }
    return actions;
  };

  return (
    <View className='admin-wishes'>
      {/* Toolbar */}
      <View className='admin-wishes__toolbar'>
        <View className='admin-wishes__back' onClick={handleBack}>
          <Text>{t('common.goBack')}</Text>
        </View>
        <Text className='admin-wishes__title'>{t('admin.wishes.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Status Filter Tabs */}
      <View className='wish-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`wish-tabs__item ${activeTab === tab.key ? 'wish-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Wish List */}
      {loading ? (
        <View className='admin-wishes-loading'><Text>{t('common.loading')}</Text></View>
      ) : wishes.length === 0 ? (
        <View className='admin-wishes-empty'>
          <Text className='admin-wishes-empty__text'>{t('common.noData')}</Text>
        </View>
      ) : (
        <View className='wish-mgmt-list'>
          {wishes.map((wish) => {
            const actions = getAvailableActions(wish);
            return (
              <View key={wish.wishId} className='wish-row'>
                <View className='wish-row__main'>
                  {wish.imageUrl && (
                    <Image className='wish-row__image' src={wish.imageUrl} mode='aspectFill' />
                  )}
                  <View className='wish-row__info'>
                    <View className='wish-row__top'>
                      <Text className='wish-row__title-text'>{wish.title}</Text>
                      <Text className={`wish-status wish-status--${wish.status}`}>
                        {STATUS_LABELS[wish.status]}
                      </Text>
                    </View>
                    <Text className='wish-row__desc'>{wish.description}</Text>
                    <View className='wish-row__meta'>
                      <Text className='wish-row__votes'>🔥 {wish.voteCount}</Text>
                      <Text className='wish-row__time'>{formatTime(wish.createdAt)}</Text>
                      {wish.closeReason && (
                        <Text className='wish-row__close-reason'>
                          {t('admin.wishes.closeReasonLabel')}: {wish.closeReason}
                        </Text>
                      )}
                      {wish.productId && (
                        <Text className='wish-row__product-id'>
                          {t('admin.wishes.productIdLabel')}: {wish.productId}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
                {actions.length > 0 && (
                  <View className='wish-row__actions'>
                    {actions.map((action) => (
                      <View
                        key={action.key}
                        className={`wish-row__action-btn wish-row__action-btn--${action.type}`}
                        onClick={action.handler}
                      >
                        <Text>{action.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {hasMore && !loading && (
            <View className='wish-mgmt-list__load-more' onClick={handleLoadMore}>
              <Text>{t('common.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Review Modal (approve/reject for pending) */}
      {reviewTarget && (
        <View className='wish-form-overlay'>
          <View className='wish-form-modal'>
            <View className='wish-form-modal__header'>
              <Text className='wish-form-modal__title'>
                {reviewAction === 'approve'
                  ? t('admin.wishes.approveTitle')
                  : t('admin.wishes.rejectTitle')}
              </Text>
              <View className='wish-form-modal__close' onClick={closeReview}><Text>✕</Text></View>
            </View>
            {reviewError && (
              <View className='wish-form-modal__error'><Text>{reviewError}</Text></View>
            )}
            <View className='wish-form-modal__body'>
              <Text className='wish-confirm-text'>
                {reviewAction === 'approve'
                  ? t('admin.wishes.approveConfirmText', { title: reviewTarget.title })
                  : t('admin.wishes.rejectConfirmText', { title: reviewTarget.title })}
              </Text>
              {reviewAction === 'reject' && (
                <View className='wish-form-field'>
                  <Text className='wish-form-field__label'>{t('admin.wishes.closeReasonLabel')}</Text>
                  <textarea
                    className='wish-form-field__textarea'
                    value={closeReason}
                    onInput={(e: any) => setCloseReason(e.target.value || e.detail?.value || '')}
                    placeholder={t('admin.wishes.closeReasonPlaceholder')}
                    maxLength={200}
                  />
                </View>
              )}
            </View>
            <View className='wish-form-modal__actions'>
              <View className='wish-form-modal__cancel' onClick={closeReview}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`wish-form-modal__submit ${reviewAction === 'reject' ? 'wish-form-modal__submit--danger' : ''} ${reviewSubmitting ? 'wish-form-modal__submit--loading' : ''}`}
                onClick={handleReviewSubmit}
              >
                <Text>
                  {reviewSubmitting
                    ? t('common.submitting')
                    : reviewAction === 'approve'
                      ? t('admin.wishes.approveButton')
                      : t('admin.wishes.rejectButton')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Status Management Modal (adopt/fulfill/close) */}
      {statusTarget && (
        <View className='wish-form-overlay'>
          <View className='wish-form-modal'>
            <View className='wish-form-modal__header'>
              <Text className='wish-form-modal__title'>
                {statusAction === 'adopt'
                  ? t('admin.wishes.adoptTitle')
                  : statusAction === 'fulfill'
                    ? t('admin.wishes.fulfillTitle')
                    : t('admin.wishes.closeTitle')}
              </Text>
              <View className='wish-form-modal__close' onClick={closeStatusAction}><Text>✕</Text></View>
            </View>
            {statusError && (
              <View className='wish-form-modal__error'><Text>{statusError}</Text></View>
            )}
            <View className='wish-form-modal__body'>
              <Text className='wish-confirm-text'>
                {statusAction === 'adopt'
                  ? t('admin.wishes.adoptConfirmText', { title: statusTarget.title })
                  : statusAction === 'fulfill'
                    ? t('admin.wishes.fulfillConfirmText', { title: statusTarget.title })
                    : t('admin.wishes.closeConfirmText', { title: statusTarget.title })}
              </Text>
              {statusAction === 'fulfill' && (
                <View className='wish-form-field'>
                  <Text className='wish-form-field__label'>{t('admin.wishes.productIdLabel')}</Text>

                  {/* Search input */}
                  <Input
                    className='wish-form-field__input'
                    value={productSearch}
                    onInput={(e) => setProductSearch(e.detail.value)}
                    placeholder={t('admin.wishes.productSearchPlaceholder')}
                  />

                  {/* Product list picker */}
                  <View className='wish-product-picker'>
                    {productsLoading ? (
                      <View className='wish-product-picker__loading'>
                        <Text>{t('common.loading')}</Text>
                      </View>
                    ) : productOptions.length === 0 ? (
                      <View className='wish-product-picker__empty'>
                        <Text>{t('admin.wishes.productPickerEmpty')}</Text>
                      </View>
                    ) : (
                      <View className='wish-product-picker__list'>
                        {productOptions
                          .filter((p) => {
                            const q = productSearch.trim().toLowerCase();
                            if (!q) return true;
                            return p.name.toLowerCase().includes(q) || p.productId.toLowerCase().includes(q);
                          })
                          .slice(0, 50)
                          .map((product) => {
                            const isSelected = fulfillProductId === product.productId;
                            return (
                              <View
                                key={product.productId}
                                className={`wish-product-picker__item ${isSelected ? 'wish-product-picker__item--selected' : ''}`}
                                onClick={() => setFulfillProductId(product.productId)}
                              >
                                {product.imageUrl && (
                                  <Image src={product.imageUrl} className='wish-product-picker__img' mode='aspectFill' />
                                )}
                                <View className='wish-product-picker__info'>
                                  <Text className='wish-product-picker__name'>{product.name}</Text>
                                  <Text className='wish-product-picker__meta'>
                                    {product.pointsCost !== undefined ? `${product.pointsCost} pts` : product.productId}
                                  </Text>
                                </View>
                                {isSelected && (
                                  <Text className='wish-product-picker__check'>✓</Text>
                                )}
                              </View>
                            );
                          })}
                      </View>
                    )}
                  </View>

                  {fulfillProductId && (
                    <Text className='wish-product-picker__selected-id'>
                      {t('admin.wishes.productSelected')}: {fulfillProductId}
                    </Text>
                  )}
                </View>
              )}
              {statusAction === 'close' && (
                <View className='wish-form-field'>
                  <Text className='wish-form-field__label'>{t('admin.wishes.closeReasonLabel')}</Text>
                  <textarea
                    className='wish-form-field__textarea'
                    value={statusCloseReason}
                    onInput={(e: any) => setStatusCloseReason(e.target.value || e.detail?.value || '')}
                    placeholder={t('admin.wishes.closeReasonPlaceholder')}
                    maxLength={200}
                  />
                </View>
              )}
            </View>
            <View className='wish-form-modal__actions'>
              <View className='wish-form-modal__cancel' onClick={closeStatusAction}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`wish-form-modal__submit ${statusAction === 'close' ? 'wish-form-modal__submit--danger' : ''} ${statusSubmitting ? 'wish-form-modal__submit--loading' : ''}`}
                onClick={handleStatusSubmit}
              >
                <Text>
                  {statusSubmitting
                    ? t('common.submitting')
                    : statusAction === 'adopt'
                      ? t('admin.wishes.adoptButton')
                      : statusAction === 'fulfill'
                        ? t('admin.wishes.fulfillButton')
                        : t('admin.wishes.closeButton')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
