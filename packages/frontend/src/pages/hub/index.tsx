import { useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { useTranslation } from '../../i18n';
import { GiftIcon, GlobeIcon, ProfileIcon, SettingsIcon, AdminIcon } from '../../components/icons';
import './index.scss';

/** Trophy icon (inline — no separate file) */
function TrophyIcon({ size = 24, color = 'currentColor', className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

/** Role display config */
const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

export default function HubPage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const fetchProfile = useAppStore((s) => s.fetchProfile);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchProfile();
  }, [isAuthenticated, fetchProfile]);

  const isAdmin = user?.roles?.some((r) => r === 'Admin' || r === 'SuperAdmin');

  const handleMall = () => {
    Taro.redirectTo({ url: '/pages/index/index' });
  };

  const handleContent = () => {
    Taro.redirectTo({ url: '/pages/content/index' });
  };

  const handleProfile = () => {
    Taro.navigateTo({ url: '/pages/profile/index' });
  };

  const handleSettings = () => {
    Taro.navigateTo({ url: '/pages/settings/index' });
  };

  const handleAdmin = () => {
    Taro.navigateTo({ url: '/pages/admin/index' });
  };

  return (
    <View className='hub-page'>
      {/* Welcome Header */}
      <View className='hub-header'>
        <View className='hub-header__left'>
          <View className='hub-header__avatar'>
            <Text className='hub-header__avatar-initial'>
              {(user?.nickname || t('hub.userFallback'))[0]?.toUpperCase()}
            </Text>
          </View>
          <View className='hub-header__info'>
            <Text className='hub-header__greeting'>
              {t('hub.greeting', { nickname: user?.nickname || t('hub.userFallback') })}
            </Text>
            {user?.roles && user.roles.length > 0 && (
              <View className='hub-header__roles'>
                {user.roles.slice(0, 3).map((role) => (
                  <Text key={role} className={`role-badge ${ROLE_CONFIG[role]?.className || ''}`}>
                    {ROLE_CONFIG[role]?.label || role}
                  </Text>
                ))}
                {user.roles.length > 3 && (
                  <Text className='hub-header__roles-overflow'>+{user.roles.length - 3}</Text>
                )}
              </View>
            )}
          </View>
        </View>
        <View className='hub-header__points'>
          <Text className='hub-header__points-diamond'>◆</Text>
          <Text className='hub-header__points-value'>{user?.points?.toLocaleString() || '0'}</Text>
          <Text className='hub-header__points-label'>{t('hub.pointsLabel')}</Text>
        </View>
      </View>

      {/* Bento Grid */}
      <View className='hub-grid'>
        {/* Content Card — spans 2 rows, featured */}
        <View
          className='hub-card hub-card--content'
          style={{ animationDelay: '0s' }}
          onClick={handleContent}
        >
          <Text className='hub-card__featured-label'>{t('hub.featured')}</Text>
          <View className='hub-card__icon'>
            <GlobeIcon size={52} color='var(--role-speaker)' />
          </View>
          <Text className='hub-card__title hub-card__title--featured'>{t('hub.contentTitle')}</Text>
          <Text className='hub-card__desc'>{t('hub.contentDesc')}</Text>
        </View>

        {/* Mall Card */}
        <View
          className='hub-card hub-card--mall'
          style={{ animationDelay: '0.08s' }}
          onClick={handleMall}
        >
          <View className='hub-card__icon'>
            <GiftIcon size={40} color='var(--accent-primary)' />
          </View>
          <Text className='hub-card__title'>{t('hub.mallTitle')}</Text>
          <Text className='hub-card__desc'>{t('hub.mallDesc')}</Text>
        </View>

        {/* Leaderboard Card — Coming Soon */}
        <View
          className='hub-card hub-card--leaderboard'
          style={{ animationDelay: '0.16s' }}
        >
          <Text className='hub-card__badge'>{t('hub.comingSoon')}</Text>
          <View className='hub-card__icon'>
            <TrophyIcon size={40} color='var(--role-leader)' />
          </View>
          <Text className='hub-card__title'>{t('hub.leaderboardTitle')}</Text>
          <Text className='hub-card__desc'>{t('hub.leaderboardDesc')}</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View className='hub-actions'>
        <View className='hub-actions__item' onClick={handleProfile}>
          <ProfileIcon size={20} color='var(--text-secondary)' />
          <Text className='hub-actions__label'>{t('hub.profileAction')}</Text>
        </View>
        <View className='hub-actions__item' onClick={handleSettings}>
          <SettingsIcon size={20} color='var(--text-secondary)' />
          <Text className='hub-actions__label'>{t('hub.settingsAction')}</Text>
        </View>
        {isAdmin && (
          <View className='hub-actions__item' onClick={handleAdmin}>
            <AdminIcon size={20} color='var(--text-secondary)' />
            <Text className='hub-actions__label'>{t('hub.adminAction')}</Text>
          </View>
        )}
      </View>

      {/* Footer */}
      <View className='hub-footer'>
        <View className='hub-footer__divider' />
        <Text className='hub-footer__line1'>🎨 Design by <Text className='hub-footer__accent'>Yanglin Liu</Text></Text>
        <Text className='hub-footer__line1'>Built with ❤️ by <Text className='hub-footer__accent'>Kiro</Text> & <Text className='hub-footer__accent'>Xiaofei Li</Text></Text>
        <Text className='hub-footer__line2'>Powered by Amazon Web Services</Text>
      </View>
    </View>
  );
}
