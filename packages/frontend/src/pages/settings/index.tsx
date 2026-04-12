import { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { Locale } from '../../i18n/types';
import { KeyIcon, LogoutIcon, AdminIcon, ChevronRightIcon, ArrowLeftIcon, GlobeIcon, SettingsIcon } from '../../components/icons';
import './index.scss';

const LOCALE_OPTIONS: { key: Locale; label: string }[] = [
  { key: 'zh', label: '中文' },
  { key: 'zh-TW', label: '繁體中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const changePassword = useAppStore((s) => s.changePassword);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const userRoles = user?.roles ?? [];
  const isAdmin = userRoles.includes('Admin') || userRoles.includes('SuperAdmin');

  const handlePasswordToggle = () => {
    setShowPasswordForm((prev) => !prev);
    setPasswordError('');
    setPasswordSuccess(false);
    if (showPasswordForm) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const handlePasswordSubmit = async () => {
    setPasswordError('');
    setPasswordSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('settings.passwordAllFieldsRequired'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.passwordMismatch'));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t('settings.passwordTooShort'));
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setShowPasswordForm(false), 1500);
    } catch (err: any) {
      setPasswordError(err?.message || t('settings.passwordChangeFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleLogout = () => {
    Taro.showModal({
      title: t('settings.logoutConfirmTitle'),
      content: t('settings.logoutConfirmContent'),
      confirmText: t('settings.logoutConfirmButton'),
      confirmColor: '#ef4444',
      cancelText: t('common.cancel'),
      success: (res) => {
        if (res.confirm) {
          logout();
        }
      },
    });
  };

  const handleAdminNavigate = () => {
    Taro.navigateTo({ url: '/pages/admin/index' });
  };

  return (
    <View className='settings-page'>
      <View className='settings-header'>
        <View className='settings-header__back' onClick={() => goBack('/pages/hub/index')}>
          <ArrowLeftIcon size={20} color='var(--text-primary)' />
        </View>
        <Text className='settings-header__title'>{t('settings.title')}</Text>
        <View className='settings-header__placeholder' />
      </View>

      <View className='settings-list'>
        {/* Change Password */}
        <View className='settings-item' onClick={handlePasswordToggle}>
          <View className='settings-item__left'>
            <View className='settings-item__icon'>
              <KeyIcon size={20} color='var(--accent-primary)' />
            </View>
            <Text className='settings-item__label'>{t('settings.changePassword')}</Text>
          </View>
          <View className={`settings-item__arrow ${showPasswordForm ? 'settings-item__arrow--expanded' : ''}`}>
            <ChevronRightIcon size={16} color='var(--text-tertiary)' />
          </View>
        </View>

        {showPasswordForm && (
          <View className='settings-password-form'>
            <View className='settings-password-form__field'>
              <Input
                className='settings-password-form__input'
                type='text'
                password
                placeholder={t('settings.currentPasswordPlaceholder')}
                value={currentPassword}
                onInput={(e) => setCurrentPassword(e.detail.value)}
              />
            </View>
            <View className='settings-password-form__field'>
              <Input
                className='settings-password-form__input'
                type='text'
                password
                placeholder={t('settings.newPasswordPlaceholder')}
                value={newPassword}
                onInput={(e) => setNewPassword(e.detail.value)}
              />
            </View>
            <View className='settings-password-form__field'>
              <Input
                className='settings-password-form__input'
                type='text'
                password
                placeholder={t('settings.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onInput={(e) => setConfirmPassword(e.detail.value)}
              />
            </View>
            {passwordError && (
              <Text className='settings-password-form__error'>{passwordError}</Text>
            )}
            {passwordSuccess && (
              <Text className='settings-password-form__success'>{t('settings.passwordChangeSuccess')}</Text>
            )}
            <View
              className={`settings-password-form__submit ${passwordLoading ? 'settings-password-form__submit--loading' : ''}`}
              onClick={!passwordLoading ? handlePasswordSubmit : undefined}
            >
              <Text>{passwordLoading ? t('settings.submitting') : t('settings.confirmChange')}</Text>
            </View>
          </View>
        )}

        <View className='settings-divider' />

        {/* Theme Switcher */}
        <View className='settings-language'>
          <View className='settings-language__header'>
            <View className='settings-item__left'>
              <View className='settings-item__icon'>
                <SettingsIcon size={20} color='var(--accent-primary)' />
              </View>
              <Text className='settings-item__label'>{t('profile.themeLabel')}</Text>
            </View>
          </View>
          <View className='settings-language__options'>
            <View
              className={`settings-language__opt ${theme === 'default' ? 'settings-language__opt--active' : ''}`}
              onClick={() => setTheme('default')}
            >
              <Text>{t('profile.themeDefault')}</Text>
            </View>
            <View
              className={`settings-language__opt ${theme === 'warm' ? 'settings-language__opt--active' : ''}`}
              onClick={() => setTheme('warm')}
            >
              <Text>{t('profile.themeWarm')}</Text>
            </View>
          </View>
        </View>

        <View className='settings-divider' />

        {/* Language Switcher */}
        <View className='settings-language'>
          <View className='settings-language__header'>
            <View className='settings-item__left'>
              <View className='settings-item__icon'>
                <GlobeIcon size={20} color='var(--accent-primary)' />
              </View>
              <Text className='settings-item__label'>{t('settings.languageLabel')}</Text>
            </View>
          </View>
          <View className='settings-language__options'>
            {LOCALE_OPTIONS.map((opt) => (
              <View
                key={opt.key}
                className={`settings-language__opt ${locale === opt.key ? 'settings-language__opt--active' : ''}`}
                onClick={() => setLocale(opt.key)}
              >
                <Text>{opt.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='settings-divider' />

        {/* Admin Entry (conditional) */}
        {isAdmin && (
          <>
            <View className='settings-item' onClick={handleAdminNavigate}>
              <View className='settings-item__left'>
                <View className='settings-item__icon'>
                  <AdminIcon size={20} color='var(--accent-primary)' />
                </View>
                <Text className='settings-item__label'>{t('settings.adminPanel')}</Text>
              </View>
              <View className='settings-item__arrow'>
                <ChevronRightIcon size={16} color='var(--text-tertiary)' />
              </View>
            </View>
            <View className='settings-divider' />
          </>
        )}

        {/* Logout */}
        <View className='settings-item' onClick={handleLogout}>
          <View className='settings-item__left'>
            <View className='settings-item__icon'>
              <LogoutIcon size={20} color='var(--error)' />
            </View>
            <Text className='settings-item__label settings-item__label--danger'>{t('settings.logout')}</Text>
          </View>
          <View className='settings-item__arrow'>
            <ChevronRightIcon size={16} color='var(--text-tertiary)' />
          </View>
        </View>
      </View>
    </View>
  );
}
