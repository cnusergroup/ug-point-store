import { useState, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { KeyIcon } from '../../components/icons';
import './index.scss';

/** 邮箱格式校验 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [success, setSuccess] = useState(false);

  const forgotPassword = useAppStore((s) => s.forgotPassword);

  const validateForm = useCallback((): boolean => {
    setEmailError('');
    setError('');

    if (!email.trim()) {
      setEmailError(t('forgotPassword.errorEmailRequired'));
      return false;
    }
    if (!isValidEmail(email)) {
      setEmailError(t('forgotPassword.errorEmailInvalid'));
      return false;
    }
    return true;
  }, [email]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      await forgotPassword(email);
      setSuccess(true);
    } catch (err) {
      if (err instanceof RequestError) {
        setError(err.message);
      } else {
        setError(t('forgotPassword.errorDefault'));
      }
    } finally {
      setLoading(false);
    }
  }, [email, forgotPassword, validateForm]);

  const goToLogin = useCallback(() => {
    goBack('/pages/login/index');
  }, []);

  if (success) {
    return (
      <View className='forgot-page'>
        <View className='forgot-page__bg-glow forgot-page__bg-glow--left' />
        <View className='forgot-page__bg-glow forgot-page__bg-glow--right' />
        <View className='forgot-card'>
          <View className='forgot-card__success'>
            <Text className='forgot-card__success-icon'>✓</Text>
            <Text className='forgot-card__success-title'>{t('forgotPassword.successTitle')}</Text>
            <Text className='forgot-card__success-msg'>
              {t('forgotPassword.successMessage')}
            </Text>
            <View className='forgot-card__submit' onClick={goToLogin}>
              <Text>{t('common.backToLogin')}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className='forgot-page'>
      <View className='forgot-page__bg-glow forgot-page__bg-glow--left' />
      <View className='forgot-page__bg-glow forgot-page__bg-glow--right' />

      <View className='forgot-card'>
        <View className='forgot-card__logo'>
          <Text className='forgot-card__logo-icon'><KeyIcon size={32} color='var(--accent-primary)' /></Text>
          <Text className='forgot-card__logo-text'>{t('forgotPassword.title')}</Text>
          <Text className='forgot-card__logo-sub'>{t('forgotPassword.subtitle')}</Text>
        </View>

        {error && (
          <View className='forgot-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='forgot-card__form'>
          <View className='forgot-card__field'>
            <Text className='forgot-card__label'>{t('forgotPassword.emailLabel')}</Text>
            <input
              className='forgot-card__input'
              type='text'
              placeholder={t('forgotPassword.emailPlaceholder')}
              value={email}
              onInput={(e: any) => setEmail(e.target.value || e.detail?.value || '')}
            />
            {emailError && <Text className='forgot-card__field-error'>{emailError}</Text>}
          </View>

          <View
            className={`forgot-card__submit ${loading ? 'forgot-card__submit--loading' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{loading ? t('forgotPassword.sending') : t('forgotPassword.submitButton')}</Text>
          </View>

          <View className='forgot-card__footer'>
            <Text className='forgot-card__footer-link' onClick={goToLogin}>{t('common.backToLogin')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
