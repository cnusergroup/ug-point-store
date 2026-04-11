import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { ContentItemSummary, ContentCategory } from '@points-mall/shared';
import './index.scss';

interface ContentListResponse {
  success: boolean;
  items: ContentItemSummary[];
  lastKey?: string;
}

interface CategoriesResponse {
  success: boolean;
  categories: ContentCategory[];
}

export default function ContentListPage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [items, setItems] = useState<ContentItemSummary[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastKeyRef = useRef<string | undefined>(undefined);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await request<CategoriesResponse>({ url: '/api/content/categories' });
      setCategories(res.categories || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const fetchContent = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      lastKeyRef.current = undefined;
    } else {
      setLoadingMore(true);
    }

    try {
      let url = '/api/content?pageSize=20';
      if (selectedCategory) url += `&categoryId=${selectedCategory}`;
      if (!reset && lastKeyRef.current) url += `&lastKey=${encodeURIComponent(lastKeyRef.current)}`;

      const res = await request<ContentListResponse>({ url });
      const newItems = res.items || [];

      if (reset) {
        setItems(newItems);
      } else {
        setItems((prev) => [...prev, ...newItems]);
      }

      lastKeyRef.current = res.lastKey;
      setHasMore(!!res.lastKey);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchCategories();
  }, [isAuthenticated, fetchCategories]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchContent(true);
    }
  }, [isAuthenticated, selectedCategory, fetchContent]);

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategory(categoryId);
  };

  const handleScrollToLower = () => {
    if (!loadingMore && hasMore) {
      fetchContent(false);
    }
  };

  const handleItemClick = (contentId: string) => {
    Taro.navigateTo({ url: `/pages/content/detail?id=${contentId}` });
  };

  const handleUploadClick = () => {
    Taro.navigateTo({ url: '/pages/content/upload' });
  };

  const handleBack = () => {
    goBack('/pages/index/index');
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  };

  return (
    <View className='content-page'>
      {/* Header */}
      <View className='content-header'>
        <View className='content-header__left'>
          <Text className='content-header__back' onClick={handleBack}>{t('contentHub.list.backButton')}</Text>
        </View>
        <Text className='content-header__title'>{t('contentHub.list.title')}</Text>
        <View className='content-header__right'>
          {user && (
            <View className='content-header__upload-btn' onClick={handleUploadClick}>
              <Text className='content-header__upload-icon'>+</Text>
              <Text className='content-header__upload-text'>{t('contentHub.list.uploadButton')}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Category Filter */}
      <ScrollView className='content-filter' scrollX enableFlex>
        <View className='content-filter__inner'>
          <View
            className={`content-filter__tab ${selectedCategory === '' ? 'content-filter__tab--active' : ''}`}
            onClick={() => handleCategoryChange('')}
          >
            <Text>{t('contentHub.list.filterAll')}</Text>
          </View>
          {categories.map((cat) => (
            <View
              key={cat.categoryId}
              className={`content-filter__tab ${selectedCategory === cat.categoryId ? 'content-filter__tab--active' : ''}`}
              onClick={() => handleCategoryChange(cat.categoryId)}
            >
              <Text>{cat.name}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Content List */}
      {loading ? (
        <View className='content-loading'>
          <Text className='content-loading__text'>{t('contentHub.list.loading')}</Text>
        </View>
      ) : items.length === 0 ? (
        <View className='content-empty'>
          <Text className='content-empty__icon'>{t('contentHub.list.emptyIcon')}</Text>
          <Text className='content-empty__text'>{t('contentHub.list.empty')}</Text>
        </View>
      ) : (
        <ScrollView
          className='content-list'
          scrollY
          onScrollToLower={handleScrollToLower}
          lowerThreshold={100}
        >
          {items.map((item) => (
            <View
              key={item.contentId}
              className='content-card'
              onClick={() => handleItemClick(item.contentId)}
            >
              <View className='content-card__body'>
                <Text className='content-card__title'>{item.title}</Text>
                <View className='content-card__meta'>
                  <Text className='content-card__category'>{item.categoryName}</Text>
                  <Text className='content-card__uploader'>{item.uploaderNickname}</Text>
                  <Text className='content-card__time'>{formatTime(item.createdAt)}</Text>
                </View>
                <View className='content-card__stats'>
                  <View className='content-card__stat'>
                    <Text className='content-card__stat-icon'>♡</Text>
                    <Text className='content-card__stat-value'>{item.likeCount}</Text>
                  </View>
                  <View className='content-card__stat'>
                    <Text className='content-card__stat-icon'>✎</Text>
                    <Text className='content-card__stat-value'>{item.commentCount}</Text>
                  </View>
                  <View className='content-card__stat'>
                    <Text className='content-card__stat-icon'>⊞</Text>
                    <Text className='content-card__stat-value'>{item.reservationCount}</Text>
                  </View>
                </View>
              </View>
              <View className='content-card__arrow'>
                <Text className='content-card__arrow-icon'>›</Text>
              </View>
            </View>
          ))}

          {loadingMore && (
            <View className='content-loading-more'>
              <Text className='content-loading-more__text'>{t('contentHub.list.loadingMore')}</Text>
            </View>
          )}

          {!hasMore && items.length > 0 && (
            <View className='content-no-more'>
              <Text className='content-no-more__text'>{t('contentHub.list.noMore')}</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Floating Upload Button (FAB) — visible when scrolling through content */}
      {user && !loading && items.length > 0 && (
        <View className='content-fab' onClick={handleUploadClick}>
          <Text className='content-fab__icon'>+</Text>
        </View>
      )}
    </View>
  );
}
