import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import TagCloud from '../../components/TagCloud';
import type { ContentItemSummary, ContentCategory } from '@points-mall/shared';
import './index.scss';

interface RolePermissions {
  canAccess: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canReserve: boolean;
}

interface ContentRolePermissions {
  Speaker: RolePermissions;
  UserGroupLeader: RolePermissions;
  Volunteer: RolePermissions;
}

interface FeatureTogglesResponse {
  contentRolePermissions?: ContentRolePermissions;
}

const CONTENT_ROLES = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
type ContentRole = typeof CONTENT_ROLES[number];

function computePermission(
  userRoles: string[],
  permission: keyof RolePermissions,
  crp: ContentRolePermissions,
): boolean {
  if (userRoles.includes('SuperAdmin')) return true;
  const contentRoles = userRoles.filter((r): r is ContentRole =>
    (CONTENT_ROLES as readonly string[]).includes(r),
  );
  if (contentRoles.length === 0) return false;
  return contentRoles.some((role) => crp[role][permission]);
}

function HomeIcon({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

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

  const [canAccess, setCanAccess] = useState<boolean | null>(null); // null = loading
  const [canUpload, setCanUpload] = useState(true); // default true (conservative)

  const [items, setItems] = useState<ContentItemSummary[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastKeyRef = useRef<string | undefined>(undefined);

  const fetchPermissions = useCallback(async () => {
    if (!user) return;
    try {
      const res = await request<FeatureTogglesResponse>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      const crp = res.contentRolePermissions;
      if (!crp) {
        // No permissions data — default to allow
        setCanAccess(true);
        setCanUpload(true);
        return;
      }
      const roles = user.roles || [];
      setCanAccess(computePermission(roles, 'canAccess', crp));
      setCanUpload(computePermission(roles, 'canUpload', crp));
    } catch {
      // On fetch failure, degrade conservatively: hide upload button but do NOT show no-access page
      setCanAccess(true); // don't block access on network error
      setCanUpload(false); // hide upload button
    }
  }, [user]);

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
      if (selectedTag) url += `&tag=${encodeURIComponent(selectedTag)}`;
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
  }, [selectedCategory, selectedTag]);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchCategories();
    fetchPermissions();
  }, [isAuthenticated, fetchCategories, fetchPermissions]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchContent(true);
    }
  }, [isAuthenticated, selectedCategory, selectedTag, fetchContent]);

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
    Taro.redirectTo({ url: '/pages/hub/index' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  };

  // ---- Render ----

  if (canAccess === false) {
    return (
      <View className='content-page'>
        <View className='content-header'>
          <View className='content-header__inner'>
            <View className='content-header__left'>
              <View className='content-header__home' onClick={handleBack}>
                <HomeIcon size={20} color='var(--text-secondary)' />
              </View>
            </View>
            <Text className='content-header__title'>{t('contentHub.list.title')}</Text>
            <View className='content-header__right' />
          </View>
        </View>
        <View className='content-no-access'>
          <Text className='content-no-access__title'>{t('contentHub.noAccessTitle')}</Text>
          <Text className='content-no-access__desc'>{t('contentHub.noAccessDesc')}</Text>
          <View className='content-no-access__btn btn-secondary' onClick={handleBack}>
            <Text>{t('contentHub.noAccessBack')}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className='content-page'>
      {/* Header — full-width edge-to-edge */}
      <View className='content-header'>
        <View className='content-header__inner'>
          <View className='content-header__left'>
            <View className='content-header__home' onClick={handleBack}>
              <HomeIcon size={20} color='var(--text-secondary)' />
            </View>
          </View>
          <Text className='content-header__title'>{t('contentHub.list.title')}</Text>
          <View className='content-header__right'>
            {user && canUpload && (
              <View className='content-header__upload-btn' onClick={handleUploadClick}>
                <Text className='content-header__upload-text'>{t('contentHub.list.uploadButton')}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Content container — centered, aligns filter + tags + list */}
      <View className='content-container'>
        {/* Category Filter — underline tabs */}
        <ScrollView className='content-filter' scrollX enableFlex>
          <View className='content-filter__inner'>
            <View
              className={`content-filter__tab ${selectedCategory === '' ? 'content-filter__tab--active' : ''}`}
              onClick={() => handleCategoryChange('')}
            >
              <Text className='content-filter__tab-text'>{t('contentHub.list.filterAll')}</Text>
              {selectedCategory === '' && <View className='content-filter__indicator' />}
            </View>
            {categories.map((cat) => (
              <View
                key={cat.categoryId}
                className={`content-filter__tab ${selectedCategory === cat.categoryId ? 'content-filter__tab--active' : ''}`}
                onClick={() => handleCategoryChange(cat.categoryId)}
              >
                <Text className='content-filter__tab-text'>{cat.name}</Text>
                {selectedCategory === cat.categoryId && <View className='content-filter__indicator' />}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Tag Cloud Filter */}
        <TagCloud selectedTag={selectedTag} onTagSelect={setSelectedTag} />

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
            <View className='content-grid'>
              {items.map((item) => {
                const isNew = item.createdAt
                  ? (Date.now() - new Date(item.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000
                  : false;
                return (
                <View
                  key={item.contentId}
                  className='content-card'
                  onClick={() => handleItemClick(item.contentId)}
                >
                  {isNew && <View className='content-card__new-badge'><Text className='content-card__new-badge-text'>NEW</Text></View>}
                  <View className='content-card__body'>
                    <Text className='content-card__title'>{item.title}</Text>
                    <View className='content-card__meta'>
                      <Text className='content-card__category'>{item.categoryName}</Text>
                      {item.tags && item.tags.length > 0 && item.tags.slice(0, 3).map((tag) => (
                        <Text key={tag} className='content-card__tag'>{tag}</Text>
                      ))}
                    </View>
                    <View className='content-card__footer'>
                      <Text className='content-card__uploader'>{item.uploaderNickname}</Text>
                      <Text className='content-card__dot'>·</Text>
                      <Text className='content-card__time'>{formatTime(item.createdAt)}</Text>
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
                  </View>
                </View>
                );
              })}
            </View>

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
      </View>

      {/* Floating Upload Button (FAB) */}
      {user && canUpload && !loading && items.length > 0 && (
        <View className='content-fab' onClick={handleUploadClick}>
          <Text className='content-fab__icon'>+</Text>
        </View>
      )}
    </View>
  );
}
