import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { WishStatus, MyWishListItem } from '@points-mall/shared';
import PageToolbar from '../../components/PageToolbar';
import './mine.scss';

/** API response for my wishes list */
interface MyWishesResponse {
  success: boolean;
  wishes: MyWishListItem[];
  remainingWishes: number;
  total: number;
  page: number;
  pageSize: number;
}

/** Status badge configuration */
const STATUS_CONFIG: Record<WishStatus, { labelKey: string; className: string }> = {
  pending: { labelKey: 'wishPool.statusPending', className: 'wish-mine-status--pending' },
  approved: { labelKey: 'wishPool.statusApproved', className: 'wish-mine-status--approved' },
  adopted: { labelKey: 'wishPool.statusAdopted', className: 'wish-mine-status--adopted' },
  fulfilled: { labelKey: 'wishPool.statusFulfilled', className: 'wish-mine-status--fulfilled' },
  closed: { labelKey: 'wishPool.statusClosed', className: 'wish-mine-status--closed' },
};

const PAGE_SIZE = 20;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MyWishesPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [wishes, setWishes] = useState<MyWishListItem[]>([]);
  const [remainingWishes, setRemainingWishes] = useState(3);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const hasMore = wishes.length < total;

  const fetchWishes = useCallback(async (p: number, reset = false) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const res = await request<MyWishesResponse>({
        url: `/api/wishes/mine?page=${p}&pageSize=${PAGE_SIZE}`,
      });
      const newWishes = res.wishes || [];

      if (reset) {
        setWishes(newWishes);
      } else {
        setWishes((prev) => [...prev, ...newWishes]);
      }

      setRemainingWishes(res.remainingWishes ?? 3);
      setTotal(res.total || 0);
      setPage(p);
    } catch {
      if (reset) setWishes([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchWishes(1, true);
  }, [isAuthenticated, fetchWishes]);

  const handleScrollToLower = () => {
    if (!loadingMore && hasMore) {
      fetchWishes(page + 1, false);
    }
  };

  const handleBack = () => {
    goBack('/pages/wishes/index');
  };

  /** Start editing a pending wish */
  const handleEditStart = (wish: MyWishListItem) => {
    setEditingId(wish.wishId);
    setEditTitle(wish.title);
    setEditDescription(wish.description);
  };

  /** Cancel editing */
  const handleEditCancel = () => {
    setEditingId(null);
    setEditTitle('');
    setEditDescription('');
  };

  /** Save edited wish */
  const handleEditSave = async (wishId: string) => {
    const trimmedTitle = editTitle.trim();
    const trimmedDesc = editDescription.trim();

    if (trimmedTitle.length < 1 || trimmedTitle.length > 50) {
      Taro.showToast({ title: t('wishPool.errorTitleLength'), icon: 'none' });
      return;
    }
    if (trimmedDesc.length < 1 || trimmedDesc.length > 500) {
      Taro.showToast({ title: t('wishPool.errorDescLength'), icon: 'none' });
      return;
    }

    try {
      await request({
        url: `/api/wishes/${wishId}`,
        method: 'PUT',
        data: { title: trimmedTitle, description: trimmedDesc },
      });
      Taro.showToast({ title: t('common.success'), icon: 'success' });
      setEditingId(null);
      // Update local state
      setWishes((prev) =>
        prev.map((w) =>
          w.wishId === wishId ? { ...w, title: trimmedTitle, description: trimmedDesc } : w,
        ),
      );
    } catch (err) {
      const msg = err instanceof RequestError ? err.message : t('common.failed');
      Taro.showToast({ title: msg, icon: 'none' });
    }
  };

  /** Delete a pending wish */
  const handleDelete = async (wishId: string) => {
    const confirmResult = await Taro.showModal({
      title: t('wishPool.deleteConfirmTitle'),
      content: t('wishPool.deleteConfirmContent'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });

    if (!confirmResult.confirm) return;

    try {
      await request({
        url: `/api/wishes/${wishId}`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('common.success'), icon: 'success' });
      // Remove from local state and update remaining count
      setWishes((prev) => prev.filter((w) => w.wishId !== wishId));
      setTotal((prev) => prev - 1);
      setRemainingWishes((prev) => Math.min(prev + 1, 3));
    } catch (err) {
      const msg = err instanceof RequestError ? err.message : t('common.failed');
      Taro.showToast({ title: msg, icon: 'none' });
    }
  };

  return (
    <View className='wish-mine-page'>
      {/* Header */}
      <PageToolbar title={t('wishPool.myWishesTitle')} onBack={handleBack} />

      {/* Remaining Wishes Count */}
      <View className='wish-mine-quota'>
        <Text className='wish-mine-quota__label'>{t('wishPool.remainingLabel')}</Text>
        <Text className='wish-mine-quota__value'>{remainingWishes}</Text>
        <Text className='wish-mine-quota__unit'>{t('wishPool.remainingUnit')}</Text>
      </View>

      {/* Content */}
      {loading ? (
        <View className='wish-mine-loading'>
          <Text className='wish-mine-loading__text'>{t('common.loading')}</Text>
        </View>
      ) : wishes.length === 0 ? (
        <View className='wish-mine-empty'>
          <Text className='wish-mine-empty__text'>{t('wishPool.myWishesEmpty')}</Text>
        </View>
      ) : (
        <ScrollView
          className='wish-mine-list'
          scrollY
          onScrollToLower={handleScrollToLower}
          lowerThreshold={100}
        >
          {wishes.map((wish) => {
            const st = STATUS_CONFIG[wish.status] || STATUS_CONFIG.pending;
            const isPending = wish.status === 'pending';
            const isEditing = editingId === wish.wishId;

            return (
              <View key={wish.wishId} className='wish-mine-card'>
                <View className='wish-mine-card__header'>
                  {isEditing ? (
                    <input
                      className='wish-mine-card__edit-title'
                      value={editTitle}
                      maxLength={50}
                      onChange={(e) => setEditTitle((e.target as HTMLInputElement).value)}
                    />
                  ) : (
                    <Text className='wish-mine-card__title'>{wish.title}</Text>
                  )}
                  <Text className={`wish-mine-status ${st.className}`}>{t(st.labelKey)}</Text>
                </View>

                {isEditing ? (
                  <textarea
                    className='wish-mine-card__edit-desc'
                    value={editDescription}
                    maxLength={500}
                    onChange={(e) => setEditDescription((e.target as HTMLTextAreaElement).value)}
                  />
                ) : (
                  <Text className='wish-mine-card__desc'>{wish.description}</Text>
                )}

                <View className='wish-mine-card__meta'>
                  <View className='wish-mine-card__stat'>
                    <Text className='wish-mine-card__stat-label'>{t('wishPool.voteCount')}</Text>
                    <Text className='wish-mine-card__stat-value'>{wish.voteCount}</Text>
                  </View>
                  {wish.closeReason && (
                    <View className='wish-mine-card__close-reason'>
                      <Text className='wish-mine-card__close-reason-label'>{t('wishPool.closeReasonLabel')}</Text>
                      <Text className='wish-mine-card__close-reason-text'>{wish.closeReason}</Text>
                    </View>
                  )}
                  <Text className='wish-mine-card__time'>{formatTime(wish.createdAt)}</Text>
                </View>

                {/* Action buttons for pending wishes */}
                {isPending && (
                  <View className='wish-mine-card__actions'>
                    {isEditing ? (
                      <>
                        <View
                          className='wish-mine-card__btn wish-mine-card__btn--save'
                          onClick={() => handleEditSave(wish.wishId)}
                        >
                          <Text>{t('common.save')}</Text>
                        </View>
                        <View
                          className='wish-mine-card__btn wish-mine-card__btn--cancel'
                          onClick={handleEditCancel}
                        >
                          <Text>{t('common.cancel')}</Text>
                        </View>
                      </>
                    ) : (
                      <>
                        <View
                          className='wish-mine-card__btn wish-mine-card__btn--edit'
                          onClick={() => handleEditStart(wish)}
                        >
                          <Text>{t('common.edit')}</Text>
                        </View>
                        <View
                          className='wish-mine-card__btn wish-mine-card__btn--delete'
                          onClick={() => handleDelete(wish.wishId)}
                        >
                          <Text>{t('common.delete')}</Text>
                        </View>
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {loadingMore && (
            <View className='wish-mine-loading-more'>
              <Text className='wish-mine-loading-more__text'>{t('common.loading')}</Text>
            </View>
          )}

          {!hasMore && wishes.length > 0 && (
            <View className='wish-mine-no-more'>
              <Text className='wish-mine-no-more__text'>{t('common.noData')}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
