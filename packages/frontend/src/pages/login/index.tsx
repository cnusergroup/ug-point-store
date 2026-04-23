import { useState, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { RequestError } from '../../utils/request';
import { useTranslation } from '../../i18n';
import mascotImg from '../../assets/mascot.png';
import './index.scss';

/** 邮箱格式校验 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 密码规则校验：≥8 位，包含字母和数字 */
function isValidPassword(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [wechatQrUrl, setWechatQrUrl] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loginByEmail = useAppStore((s) => s.loginByEmail);
  const wechatLogin = useAppStore((s) => s.wechatLogin);

  const isWeapp = Taro.getEnv() === Taro.ENV_TYPE.WEAPP;

  const validateForm = useCallback((): boolean => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setError('');

    if (!email.trim()) {
      setEmailError(t('login.errorEmailRequired'));
      valid = false;
    } else if (!isValidEmail(email)) {
      setEmailError(t('login.errorEmailInvalid'));
      valid = false;
    }

    if (!password) {
      setPasswordError(t('login.errorPasswordRequired'));
      valid = false;
    } else if (!isValidPassword(password)) {
      setPasswordError(t('login.errorPasswordInvalid'));
      valid = false;
    }

    return valid;
  }, [email, password]);

  const handleLogin = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      await loginByEmail(email, password);
      Taro.redirectTo({ url: '/pages/hub/index' });
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'ACCOUNT_LOCKED') {
          const lockRemainingMs = err.data?.lockRemainingMs as number | undefined;
          if (lockRemainingMs && lockRemainingMs > 0) {
            const minutes = Math.ceil(lockRemainingMs / 60000);
            setError(t('login.errorAccountLockedWithTime', { minutes }));
          } else {
            setError(t('login.errorAccountLocked'));
          }
        } else if (err.code === 'INVALID_CREDENTIALS') {
          setError(t('login.errorInvalidCredentials'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('login.errorDefault'));
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, loginByEmail, validateForm]);

  const handleWechatLogin = useCallback(async () => {
    setError('');
    try {
      if (isWeapp) {
        setLoading(true);
        await wechatLogin();
        Taro.redirectTo({ url: '/pages/hub/index' });
      } else {
        // H5: show QR code
        setShowQr(true);
        const { qrcodeUrl } = await (await import('../../utils/request')).request<{ qrcodeUrl: string }>({
          url: '/api/auth/wechat/qrcode',
          method: 'POST',
          skipAuth: true,
        });
        setWechatQrUrl(qrcodeUrl);
      }
    } catch (err) {
      setError(err instanceof RequestError ? err.message : t('login.wechatLoginFailed'));
    } finally {
      setLoading(false);
    }
  }, [isWeapp, wechatLogin]);

  const goToRegister = useCallback(() => {
    Taro.navigateTo({ url: '/pages/register/index' });
  }, []);

  const goToForgotPassword = useCallback(() => {
    Taro.navigateTo({ url: '/pages/forgot-password/index' });
  }, []);

  return (
    <View className='login-page'>
      <View className='login-page__bg-glow login-page__bg-glow--left' />
      <View className='login-page__bg-glow login-page__bg-glow--right' />

      <View className='login-card'>
        <View className='login-card__logo'>
          <Image className='login-card__logo-mascot' src={mascotImg} mode='aspectFit' />
          <Text className='login-card__logo-text'>
            <Text className='login-card__logo-accent'>{t('login.titleAccent')}</Text>{t('login.titleSuffix')}
          </Text>
          <Text className='login-card__logo-sub'>{t('login.subtitle')}</Text>
        </View>

        {/* WeChat Login Section - hidden for now */}
        {/* {!showQr && (
          <View className='login-card__wechat' onClick={handleWechatLogin}>
            <View className='login-card__wechat-btn'>
              <Text className='login-card__wechat-icon'>💬</Text>
              <Text>{isWeapp ? t('login.wechatLoginWeapp') : t('login.wechatLoginH5')}</Text>
            </View>
          </View>
        )}

        {showQr && wechatQrUrl && (
          <View className='login-card__qr'>
            <Image className='login-card__qr-img' src={wechatQrUrl} mode='aspectFit' />
            <Text className='login-card__qr-tip'>{t('login.wechatQrTip')}</Text>
            <Text className='login-card__qr-back' onClick={() => setShowQr(false)}>{t('login.backToEmailLogin')}</Text>
          </View>
        )} */}

        {!showQr && (
          <>
            {error && (
              <View className='login-card__error'>
                <Text>{error}</Text>
              </View>
            )}

            <View className='login-card__form'>
              <View className='login-card__field'>
                <Text className='login-card__label'>{t('login.emailLabel')}</Text>
                <input
                  className='login-card__input'
                  type='text'
                  placeholder={t('login.emailPlaceholder')}
                  value={email}
                  onInput={(e: any) => setEmail(e.target.value || e.detail?.value || '')}
                />
                {emailError && <Text className='login-card__field-error'>{emailError}</Text>}
              </View>

              <View className='login-card__field'>
                <Text className='login-card__label'>{t('login.passwordLabel')}</Text>
                <View className='password-field'>
                  <input
                    className='login-card__input'
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('login.passwordPlaceholder')}
                    value={password}
                    onInput={(e: any) => setPassword(e.target.value || e.detail?.value || '')}
                  />
                  <Text className='password-field__toggle' onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? (
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
                {passwordError && <Text className='login-card__field-error'>{passwordError}</Text>}
              </View>

              <View
                className={`login-card__submit ${loading ? 'login-card__submit--loading' : ''}`}
                onClick={handleLogin}
              >
                <Text>{loading ? t('login.loggingIn') : t('login.loginButton')}</Text>
              </View>

              <View className='login-card__forgot'>
                <Text className='login-card__forgot-link' onClick={goToForgotPassword}>{t('login.forgotPassword')}</Text>
              </View>

              {/* Registration is invite-only, hide self-registration link */}
              {/* <View className='login-card__footer'>
                <Text className='login-card__footer-text'>{t('login.noAccount')}</Text>
                <Text className='login-card__footer-link' onClick={goToRegister}>{t('login.registerLink')}</Text>
              </View> */}
            </View>
          </>
        )}
      </View>
    </View>
  );
}
