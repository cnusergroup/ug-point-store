import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Switch } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { Locale } from '../../i18n/types';
import { KeyIcon, LogoutIcon, AdminIcon, ChevronRightIcon, GlobeIcon, SettingsIcon, MailIcon, LockIcon, ProfileIcon } from '../../components/icons';
import PageToolbar from '../../components/PageToolbar';
import './index.scss';

/** 密码规则校验：≥8 位，包含字母和数字（与后端 validateQueryPasswordStrength 保持一致） */
function isValidQueryPassword(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

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
  const changeNickname = useAppStore((s) => s.changeNickname);
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
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Nickname change state
  const [showNicknameForm, setShowNicknameForm] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameSuccess, setNicknameSuccess] = useState(false);

  // Email subscription state
  const [emailSubs, setEmailSubs] = useState<{ newProduct: boolean; newContent: boolean }>({ newProduct: false, newContent: false });
  const [emailSubsLoading, setEmailSubsLoading] = useState(true);
  const [emailToggles, setEmailToggles] = useState<{ emailNewProductEnabled: boolean; emailNewContentEnabled: boolean }>({ emailNewProductEnabled: false, emailNewContentEnabled: false });

  const userRoles = user?.roles ?? [];
  const isAdmin = userRoles.includes('Admin') || userRoles.includes('SuperAdmin');
  const isSuperAdmin = userRoles.includes('SuperAdmin');

  // Query credential password management state (SuperAdmin only)
  const [showQueryPasswordForm, setShowQueryPasswordForm] = useState(false);
  const [queryNewPassword, setQueryNewPassword] = useState('');
  const [queryPasswordError, setQueryPasswordError] = useState('');
  const [queryPasswordLoading, setQueryPasswordLoading] = useState(false);
  const [queryPasswordSuccess, setQueryPasswordSuccess] = useState(false);
  const [showQueryNewPassword, setShowQueryNewPassword] = useState(false);

  // Fetch feature toggles and email subscriptions on mount
  const fetchEmailData = useCallback(async () => {
    setEmailSubsLoading(true);
    try {
      // Fetch admin feature toggles (public, no auth)
      const togglesRes = await request<{ emailNewProductEnabled?: boolean; emailNewContentEnabled?: boolean }>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      setEmailToggles({
        emailNewProductEnabled: togglesRes.emailNewProductEnabled ?? false,
        emailNewContentEnabled: togglesRes.emailNewContentEnabled ?? false,
      });

      // Only fetch user subscriptions if at least one toggle is enabled
      if (togglesRes.emailNewProductEnabled || togglesRes.emailNewContentEnabled) {
        const subsRes = await request<{ newProduct: boolean; newContent: boolean }>({
          url: '/api/user/email-subscriptions',
        });
        setEmailSubs({
          newProduct: subsRes?.newProduct ?? false,
          newContent: subsRes?.newContent ?? false,
        });
      }
    } catch {
      // Silently fail — section will just not show
    } finally {
      setEmailSubsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmailData();
  }, [fetchEmailData]);

  const handleEmailSubToggle = async (key: 'newProduct' | 'newContent', newValue: boolean) => {
    const prev = { ...emailSubs };
    setEmailSubs({ ...emailSubs, [key]: newValue });
    try {
      await request({
        url: '/api/user/email-subscriptions',
        method: 'PUT',
        data: { [key]: newValue },
      });
    } catch {
      // Revert on failure
      setEmailSubs(prev);
    }
  };

  const showEmailSection = !emailSubsLoading && (emailToggles.emailNewProductEnabled || emailToggles.emailNewContentEnabled);

  const handlePasswordToggle = () => {
    setShowPasswordForm((prev) => !prev);
    setPasswordError('');
    setPasswordSuccess(false);
    if (showPasswordForm) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
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

  const handleNicknameToggle = () => {
    setShowNicknameForm((prev) => !prev);
    setNicknameError('');
    setNicknameSuccess(false);
    if (showNicknameForm) {
      setNewNickname('');
    }
  };

  const handleNicknameSubmit = async () => {
    setNicknameError('');
    setNicknameSuccess(false);
    setNicknameLoading(true);
    try {
      const result = await changeNickname(newNickname);
      if (result.success) {
        setNicknameSuccess(true);
        setNewNickname('');
        setTimeout(() => setShowNicknameForm(false), 1500);
      } else {
        const code = result.error?.code || '';
        const errorMap: Record<string, string> = {
          NICKNAME_EMPTY: t('settings.nicknameEmpty'),
          NICKNAME_TOO_LONG: t('settings.nicknameTooLong'),
          NICKNAME_INVALID_CHARS: t('settings.nicknameInvalidChars'),
          NICKNAME_SAME_AS_CURRENT: t('settings.nicknameSameAsCurrent'),
          NICKNAME_ALREADY_TAKEN: t('settings.nicknameAlreadyTaken'),
          NICKNAME_CHANGE_TOO_FREQUENT: t('settings.nicknameTooFrequent'),
        };
        setNicknameError(errorMap[code] || result.error?.message || '');
      }
    } catch (err: any) {
      setNicknameError(err?.message || '');
    } finally {
      setNicknameLoading(false);
    }
  };

  const handleQueryPasswordToggle = () => {
    setShowQueryPasswordForm((prev) => !prev);
    setQueryPasswordError('');
    setQueryPasswordSuccess(false);
    if (showQueryPasswordForm) {
      setQueryNewPassword('');
      setShowQueryNewPassword(false);
    }
  };

  const handleQueryPasswordSubmit = async () => {
    setQueryPasswordError('');
    setQueryPasswordSuccess(false);

    if (!queryNewPassword || !isValidQueryPassword(queryNewPassword)) {
      setQueryPasswordError(t('settings.queryCredential.invalidFormatError'));
      return;
    }

    setQueryPasswordLoading(true);
    try {
      await request({
        url: '/api/admin/settings/query-credential-password',
        method: 'PUT',
        data: { newPassword: queryNewPassword },
      });
      setQueryPasswordSuccess(true);
      setQueryNewPassword('');
      setTimeout(() => setShowQueryPasswordForm(false), 1500);
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'FORBIDDEN') {
          setQueryPasswordError(t('settings.queryCredential.forbiddenError'));
        } else if (err.code === 'INVALID_PASSWORD_FORMAT') {
          setQueryPasswordError(t('settings.queryCredential.invalidFormatError'));
        } else {
          setQueryPasswordError(t('settings.queryCredential.genericError'));
        }
      } else {
        setQueryPasswordError(t('settings.queryCredential.genericError'));
      }
    } finally {
      setQueryPasswordLoading(false);
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
      <PageToolbar title={t('settings.title')} onBack={() => goBack('/pages/hub/index')} />

      <View className='settings-list'>
        {/* Change Nickname */}
        <View className='settings-item' onClick={handleNicknameToggle}>
          <View className='settings-item__left'>
            <View className='settings-item__icon'>
              <ProfileIcon size={20} color='var(--accent-primary)' />
            </View>
            <Text className='settings-item__label'>{t('settings.changeNickname')}</Text>
          </View>
          <View className={`settings-item__arrow ${showNicknameForm ? 'settings-item__arrow--expanded' : ''}`}>
            <ChevronRightIcon size={16} color='var(--text-tertiary)' />
          </View>
        </View>

        {showNicknameForm && (
          <View className='settings-password-form'>
            <Text className='settings-password-form__hint'>{`当前昵称: ${user?.nickname || ''}`}</Text>
            <View className='settings-password-form__field'>
              <Input
                className='settings-password-form__input'
                type='text'
                placeholder={t('settings.newNicknamePlaceholder')}
                value={newNickname}
                onInput={(e) => setNewNickname(e.detail.value)}
              />
            </View>
            {nicknameError && (
              <Text className='settings-password-form__error'>{nicknameError}</Text>
            )}
            {nicknameSuccess && (
              <Text className='settings-password-form__success'>{t('settings.nicknameChangeSuccess')}</Text>
            )}
            <View
              className={`settings-password-form__submit ${nicknameLoading ? 'settings-password-form__submit--loading' : ''}`}
              onClick={!nicknameLoading ? handleNicknameSubmit : undefined}
            >
              <Text>{nicknameLoading ? t('settings.submitting') : t('settings.confirmChange')}</Text>
            </View>
          </View>
        )}

        <View className='settings-divider' />

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
              <View className='password-field'>
                <Input
                  className='settings-password-form__input'
                  type='text'
                  password={!showCurrentPassword}
                  placeholder={t('settings.currentPasswordPlaceholder')}
                  value={currentPassword}
                  onInput={(e) => setCurrentPassword(e.detail.value)}
                />
                <Text className='password-field__toggle' onClick={() => setShowCurrentPassword(!showCurrentPassword)}>
                  {showCurrentPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </Text>
              </View>
            </View>
            <View className='settings-password-form__field'>
              <View className='password-field'>
                <Input
                  className='settings-password-form__input'
                  type='text'
                  password={!showNewPassword}
                  placeholder={t('settings.newPasswordPlaceholder')}
                  value={newPassword}
                  onInput={(e) => setNewPassword(e.detail.value)}
                />
                <Text className='password-field__toggle' onClick={() => setShowNewPassword(!showNewPassword)}>
                  {showNewPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </Text>
              </View>
            </View>
            <View className='settings-password-form__field'>
              <View className='password-field'>
                <Input
                  className='settings-password-form__input'
                  type='text'
                  password={!showConfirmPassword}
                  placeholder={t('settings.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onInput={(e) => setConfirmPassword(e.detail.value)}
                />
                <Text className='password-field__toggle' onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                  {showConfirmPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </Text>
              </View>
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

        {/* Email Subscriptions (conditional on admin toggles) */}
        {showEmailSection && (
          <>
            <View className='settings-email'>
              <View className='settings-email__header'>
                <View className='settings-item__left'>
                  <View className='settings-item__icon'>
                    <MailIcon size={20} color='var(--accent-primary)' />
                  </View>
                  <Text className='settings-item__label'>{t('settings.emailSubscriptions.sectionTitle')}</Text>
                </View>
              </View>
              <View className='settings-email__toggles'>
                {emailToggles.emailNewProductEnabled && (
                  <View className='settings-email__toggle-row'>
                    <View className='settings-email__toggle-info'>
                      <Text className='settings-email__toggle-label'>{t('settings.emailSubscriptions.newProductLabel')}</Text>
                      <Text className='settings-email__toggle-desc'>{t('settings.emailSubscriptions.newProductDesc')}</Text>
                    </View>
                    <Switch
                      checked={emailSubs.newProduct}
                      onChange={(e) => handleEmailSubToggle('newProduct', e.detail.value)}
                      color='var(--accent-primary)'
                    />
                  </View>
                )}
                {emailToggles.emailNewContentEnabled && (
                  <View className='settings-email__toggle-row'>
                    <View className='settings-email__toggle-info'>
                      <Text className='settings-email__toggle-label'>{t('settings.emailSubscriptions.newContentLabel')}</Text>
                      <Text className='settings-email__toggle-desc'>{t('settings.emailSubscriptions.newContentDesc')}</Text>
                    </View>
                    <Switch
                      checked={emailSubs.newContent}
                      onChange={(e) => handleEmailSubToggle('newContent', e.detail.value)}
                      color='var(--accent-primary)'
                    />
                  </View>
                )}
              </View>
            </View>
            <View className='settings-divider' />
          </>
        )}

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

        {/* Query System Password Management (SuperAdmin only) */}
        {isSuperAdmin && (
          <>
            <View className='settings-item' onClick={handleQueryPasswordToggle}>
              <View className='settings-item__left'>
                <View className='settings-item__icon'>
                  <LockIcon size={20} color='var(--accent-primary)' />
                </View>
                <Text className='settings-item__label'>{t('settings.queryCredential.sectionTitle')}</Text>
              </View>
              <View className={`settings-item__arrow ${showQueryPasswordForm ? 'settings-item__arrow--expanded' : ''}`}>
                <ChevronRightIcon size={16} color='var(--text-tertiary)' />
              </View>
            </View>

            {showQueryPasswordForm && (
              <View className='settings-password-form'>
                <View className='settings-password-form__field'>
                  <View className='password-field'>
                    <Input
                      className='settings-password-form__input'
                      type='text'
                      password={!showQueryNewPassword}
                      placeholder={t('settings.queryCredential.newPasswordPlaceholder')}
                      value={queryNewPassword}
                      onInput={(e) => setQueryNewPassword(e.detail.value)}
                    />
                    <Text className='password-field__toggle' onClick={() => setShowQueryNewPassword(!showQueryNewPassword)}>
                      {showQueryNewPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </Text>
                  </View>
                </View>
                <Text className='settings-password-form__hint'>{t('settings.queryCredential.hint')}</Text>
                {queryPasswordError && (
                  <Text className='settings-password-form__error'>{queryPasswordError}</Text>
                )}
                {queryPasswordSuccess && (
                  <Text className='settings-password-form__success'>{t('settings.queryCredential.success')}</Text>
                )}
                <View
                  className={`settings-password-form__submit ${queryPasswordLoading ? 'settings-password-form__submit--loading' : ''}`}
                  onClick={!queryPasswordLoading ? handleQueryPasswordSubmit : undefined}
                >
                  <Text>{queryPasswordLoading ? t('settings.submitting') : t('settings.confirmChange')}</Text>
                </View>
              </View>
            )}

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
