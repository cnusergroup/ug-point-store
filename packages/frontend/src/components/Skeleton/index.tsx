import { View } from '@tarojs/components';
import './index.scss';

/**
 * 商品列表骨架屏 — 4 个商品卡片占位块，2 列网格
 * 每个卡片：图片区域 + 标题行 + 价格行
 */
export function ProductSkeleton() {
  return (
    <View className='skeleton-product-grid'>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className='skeleton-product-card'>
          <View className='skeleton-block skeleton-product-card__image' />
          <View className='skeleton-product-card__body'>
            <View className='skeleton-block skeleton-product-card__title' />
            <View className='skeleton-block skeleton-product-card__price' />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * 个人中心骨架屏 — 用户卡片占位 + 2×2 快捷操作占位
 */
export function ProfileSkeleton() {
  return (
    <View className='skeleton-profile'>
      {/* User card placeholder */}
      <View className='skeleton-profile__card'>
        <View className='skeleton-block skeleton-profile__avatar' />
        <View className='skeleton-profile__info'>
          <View className='skeleton-block skeleton-profile__name' />
          <View className='skeleton-block skeleton-profile__points' />
        </View>
      </View>

      {/* 2×2 quick actions placeholder */}
      <View className='skeleton-profile__actions'>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className='skeleton-block skeleton-profile__action-item' />
        ))}
      </View>
    </View>
  );
}
