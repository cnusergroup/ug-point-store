import { useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import './index.scss';

const ADMIN_LINKS = [
  {
    key: 'products',
    icon: '📦',
    title: '商品管理',
    desc: '创建、编辑、上架/下架商品',
    url: '/pages/admin/products',
  },
  {
    key: 'codes',
    icon: '🎟️',
    title: 'Code 管理',
    desc: '批量生成积分码、商品专属码、禁用管理',
    url: '/pages/admin/codes',
  },
  {
    key: 'users',
    icon: '👥',
    title: '用户角色管理',
    desc: '分配或撤销用户身份角色',
    url: '/pages/admin/users',
  },
  {
    key: 'orders',
    icon: '📦',
    title: '订单管理',
    desc: '查看和管理所有订单，更新物流状态',
    url: '/pages/admin/orders',
  },
  {
    key: 'invites',
    icon: '✉️',
    title: '邀请管理',
    desc: '生成邀请链接，管理邀请记录',
    url: '/pages/admin/invites',
  },
  {
    key: 'claims',
    icon: '📝',
    title: '积分审批',
    desc: '审核社区成员的积分申请',
    url: '/pages/admin/claims',
  },
];

export default function AdminDashboard() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const hasAdminAccess = user?.roles?.some(r => r === 'Admin' || r === 'SuperAdmin');
    if (!hasAdminAccess) {
      Taro.redirectTo({ url: '/pages/index/index' });
    }
  }, [isAuthenticated, user]);

  const goTo = (url: string) => {
    Taro.navigateTo({ url });
  };

  const goHome = () => {
    Taro.redirectTo({ url: '/pages/index/index' });
  };

  return (
    <View className='admin-page'>
      <View className='admin-header'>
        <View className='admin-header__info'>
          <Text className='admin-header__title'>管理后台</Text>
          <Text className='admin-header__sub'>
            {user?.nickname || '管理员'}，欢迎回来
          </Text>
        </View>
        <View className='admin-header__home' onClick={goHome}>
          <Text>🏪 商城首页</Text>
        </View>
      </View>

      <View className='admin-nav'>
        {ADMIN_LINKS.map((link) => (
          <View
            key={link.key}
            className='admin-nav__card'
            onClick={() => goTo(link.url)}
          >
            <Text className='admin-nav__card-icon'>{link.icon}</Text>
            <View className='admin-nav__card-body'>
              <Text className='admin-nav__card-title'>{link.title}</Text>
              <Text className='admin-nav__card-desc'>{link.desc}</Text>
            </View>
            <Text className='admin-nav__card-arrow'>›</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
