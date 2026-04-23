import { useState, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { RequestError } from '../../utils/request';
import { useTranslation } from '../../i18n';
import { WarningIcon, LockIcon } from '../../components/icons';
import './index.scss';

/** 密码规则：至少 8 位，同时包含字母和数字 */
function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw);
}

/** 错误码 → 用户友好提示 */
function mapErrorMessage(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'RESET_TOKEN_EXPIRED':
      return t('resetPassword.errorTokenExpired');
    case 'RESET_TOKEN_INVALID':
      return t('resetPassword.errorTokenInvalid');
    case 'INVALID_PASSWORD_FORMAT':
      return t('resetPassword.errorInvalidPasswordFormat');
    default:
      return t('resetPassword.errorDefault');
  }
}

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const token = Taro.getCurrentInstance().router?.params?.token || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pwError, setPwError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const resetPassword = useAppStore((s) => s.resetPassword);

  const validateForm = useCallback((): boolean => {
    setPwError('');
    setConfirmError('');
    setError('');

    if (!newPassword) {
      setPwError(t('resetPassword.errorPasswordRequired'));
      return false;
    }
    if (!isValidPassword(newPassword)) {
      setPwError(t('resetPassword.errorPasswordInvalid'));
      return false;
    }
    if (!confirmPassword) {
      setConfirmError(t('resetPassword.errorConfirmRequired'));
      return false;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError(t('resetPassword.errorConfirmMismatch'));
      return false;
    }
    return true;
  }, [newPassword, confirmPassword]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
      if (err instanceof RequestError) {
        setError(mapErrorMessage(err.code, t));
      } else {
        setError(t('resetPassword.errorDefault'));
      }
    } finally {
      setLoading(false);
    }
  }, [token, newPassword, resetPassword, validateForm]);

  const goToLogin = useCallback(() => {
    Taro.redirectTo({ url: '/pages/login/index' });
  }, []);

  /* ── Token 缺失 ── */
  if (!token) {
    return (
      <View className='reset-page'>
        <View className='reset-page__bg-glow reset-page__bg-glow--left' />
        <View className='reset-page__bg-glow reset-page__bg-glow--right' />
        <View className='reset-card'>
          <View className='reset-card__error-state'>
            <Text className='reset-card__error-state-icon'><WarningIcon size={32} color='var(--warning)' /></Text>
            <Text className='reset-card__error-state-title'>{t('resetPassword.invalidLinkTitle')}</Text>
            <Text className='reset-card__error-state-msg'>
              {t('resetPassword.invalidLinkMessage')}
            </Text>
            <View className='reset-card__submit' onClick={goToLogin}>
              <Text>{t('common.backToLogin')}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  /* ── 重置成功 ── */
  if (success) {
    return (
      <View className='reset-page'>
        <View className='reset-page__bg-glow reset-page__bg-glow--left' />
        <View className='reset-page__bg-glow reset-page__bg-glow--right' />
        <View className='reset-card'>
          <View className='reset-card__success'>
            <Text className='reset-card__success-icon'>✓</Text>
            <Text className='reset-card__success-title'>{t('resetPassword.successTitle')}</Text>
            <Text className='reset-card__success-msg'>
              {t('resetPassword.successMessage')}
            </Text>
            <View className='reset-card__submit' onClick={goToLogin}>
              <Text>{t('common.backToLogin')}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  /* ── 表单 ── */
  return (
    <View className='reset-page'>
      <View className='reset-page__bg-glow reset-page__bg-glow--left' />
      <View className='reset-page__bg-glow reset-page__bg-glow--right' />

      <View className='reset-card'>
        <View className='reset-card__logo'>
          <Text className='reset-card__logo-icon'><LockIcon size={32} color='var(--accent-primary)' /></Text>
          <Text className='reset-card__logo-text'>{t('resetPassword.title')}</Text>
          <Text className='reset-card__logo-sub'>{t('resetPassword.subtitle')}</Text>
        </View>

        {error && (
          <View className='reset-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='reset-card__form'>
          <View className='reset-card__field'>
            <Text className='reset-card__label'>{t('resetPassword.newPasswordLabel')}</Text>
            <View className='password-field'>
              <input
                className='reset-card__input'
                type={showNewPassword ? 'text' : 'password'}
                placeholder={t('resetPassword.newPasswordPlaceholder')}
                value={newPassword}
                onInput={(e: any) => setNewPassword(e.target.value || e.detail?.value || '')}
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
            {pwError && <Text className='reset-card__field-error'>{pwError}</Text>}
          </View>

          <View className='reset-card__field'>
            <Text className='reset-card__label'>{t('resetPassword.confirmPasswordLabel')}</Text>
            <View className='password-field'>
              <input
                className='reset-card__input'
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onInput={(e: any) => setConfirmPassword(e.target.value || e.detail?.value || '')}
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
            {confirmError && <Text className='reset-card__field-error'>{confirmError}</Text>}
          </View>

          <View
            className={`reset-card__submit ${loading ? 'reset-card__submit--loading' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{loading ? t('resetPassword.submitting') : t('resetPassword.submitButton')}</Text>
          </View>

          <View className='reset-card__footer'>
            <Text className='reset-card__footer-link' onClick={goToLogin}>{t('common.backToLogin')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
