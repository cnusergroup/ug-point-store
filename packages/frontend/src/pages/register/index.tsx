import { useState, useCallback, useEffect } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { useTranslation } from '../../i18n';
import { LockIcon } from '../../components/icons';
import mascotImg from '../../assets/mascot.png';
import './index.scss';

/** 邮箱格式校验 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 密码规则校验 */
function isValidPassword(password: string): boolean {
  return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

/** 角色显示配置 */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
};

/** 邀请验证状态 */
type InviteState =
  | { status: 'loading' }
  | { status: 'valid'; roles: string[] }
  | { status: 'invalid'; reason: 'INVITE_TOKEN_INVALID' | 'INVITE_TOKEN_USED' | 'INVITE_TOKEN_EXPIRED' | 'MISSING' };

export default function RegisterPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [privacyError, setPrivacyError] = useState('');
  const [inviteState, setInviteState] = useState<InviteState>({ status: 'loading' });
  const [inviteToken, setInviteToken] = useState('');

  const register = useAppStore((s) => s.register);

  // Validate invite token on mount
  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params;
    const token = params?.token as string | undefined;

    if (!token) {
      setInviteState({ status: 'invalid', reason: 'MISSING' });
      return;
    }

    setInviteToken(token);

    request<{ valid: boolean; roles: string[] }>({
      url: '/api/auth/validate-invite',
      method: 'POST',
      data: { token },
      skipAuth: true,
    })
      .then((result) => {
        setInviteState({ status: 'valid', roles: result.roles });
      })
      .catch((err) => {
        if (err instanceof RequestError) {
          const reason = (
            err.code === 'INVITE_TOKEN_USED' ||
            err.code === 'INVITE_TOKEN_EXPIRED' ||
            err.code === 'INVITE_TOKEN_INVALID'
          ) ? err.code : 'INVITE_TOKEN_INVALID';
          setInviteState({ status: 'invalid', reason });
        } else {
          setInviteState({ status: 'invalid', reason: 'INVITE_TOKEN_INVALID' });
        }
      });
  }, []);

  const validateForm = useCallback((): boolean => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');
    setNicknameError('');
    setError('');
    setPrivacyError('');

    if (!nickname.trim()) {
      setNicknameError(t('register.errorNicknameRequired'));
      valid = false;
    }

    if (!email.trim()) {
      setEmailError(t('register.errorEmailRequired'));
      valid = false;
    } else if (!isValidEmail(email)) {
      setEmailError(t('register.errorEmailInvalid'));
      valid = false;
    }

    if (!password) {
      setPasswordError(t('register.errorPasswordRequired'));
      valid = false;
    } else if (!isValidPassword(password)) {
      setPasswordError(t('register.errorPasswordInvalid'));
      valid = false;
    }

    if (!confirmPassword) {
      setConfirmPasswordError(t('register.errorConfirmRequired'));
      valid = false;
    } else if (confirmPassword !== password) {
      setConfirmPasswordError(t('register.errorConfirmMismatch'));
      valid = false;
    }

    if (!agreedToPrivacy) {
      setPrivacyError(t('register.errorPrivacyRequired'));
      valid = false;
    }

    return valid;
  }, [email, password, confirmPassword, nickname, agreedToPrivacy]);

  const handleRegister = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      await register(email, password, nickname, inviteToken);
      // Registration auto-logs in — redirect to home
      Taro.showToast({ title: t('register.registerSuccess'), icon: 'success', duration: 1500 });
      setTimeout(() => {
        Taro.reLaunch({ url: '/pages/hub/index' });
      }, 1000);
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'EMAIL_ALREADY_EXISTS') {
          setError(t('register.errorEmailExists'));
        } else if (err.code === 'INVALID_PASSWORD_FORMAT') {
          setError(t('register.errorInvalidPasswordFormat'));
        } else if (err.code === 'INVITE_TOKEN_INVALID') {
          setError(t('register.errorInviteInvalid'));
        } else if (err.code === 'INVITE_TOKEN_USED') {
          setError(t('register.errorInviteUsed'));
        } else if (err.code === 'INVITE_TOKEN_EXPIRED') {
          setError(t('register.errorInviteExpired'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('register.errorDefault'));
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, nickname, inviteToken, register, validateForm, agreedToPrivacy]);

  const goToLogin = useCallback(() => {
    Taro.redirectTo({ url: '/pages/login/index' });
  }, []);

  const goToPrivacy = useCallback(() => {
    Taro.navigateTo({ url: '/pages/privacy/index' });
  }, []);

  // Password strength hints
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);

  // Loading state
  if (inviteState.status === 'loading') {
    return (
      <View className='register-page'>
        <View className='register-page__bg-glow register-page__bg-glow--left' />
        <View className='register-page__bg-glow register-page__bg-glow--right' />
        <View className='register-card'>
          <View className='register-card__loading'>
            <Text className='register-card__loading-text'>{t('register.validatingInvite')}</Text>
          </View>
        </View>
      </View>
    );
  }

  // Invalid invite state
  if (inviteState.status === 'invalid') {
    return (
      <View className='register-page'>
        <View className='register-page__bg-glow register-page__bg-glow--left' />
        <View className='register-page__bg-glow register-page__bg-glow--right' />
        <View className='register-card'>
          <View className='register-card__invalid'>
            <Text className='register-card__invalid-icon'><LockIcon size={32} color='var(--error)' /></Text>
            <Text className='register-card__invalid-title'>{t('register.inviteInvalidTitle')}</Text>
            <Text className='register-card__invalid-desc'>
              {inviteState.reason === 'INVITE_TOKEN_USED'
                ? t('register.inviteUsedDesc')
                : inviteState.reason === 'INVITE_TOKEN_EXPIRED'
                ? t('register.inviteExpiredDesc')
                : t('register.inviteInvalidDesc')}
            </Text>
            <View className='register-card__invalid-action btn-primary' onClick={goToLogin}>
              <Text>{t('common.backToLogin')}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Valid invite — show registration form
  return (
    <View className='register-page'>
      <View className='register-page__bg-glow register-page__bg-glow--left' />
      <View className='register-page__bg-glow register-page__bg-glow--right' />

      <View className='register-card'>
        <View className='register-card__logo'>
          <Image className='register-card__logo-mascot' src={mascotImg} mode='aspectFit' />
          <Text className='register-card__logo-text'>{t('register.title')}</Text>
          <Text className='register-card__logo-sub'>{t('register.subtitle')}</Text>
        </View>

        {/* Role badges */}
        <View className='register-card__role-row'>
          <Text className='register-card__role-label'>{t('register.inviteRoleLabel')}</Text>
          {inviteState.roles.map((role) => {
            const config = ROLE_CONFIG[role];
            return (
              <Text key={role} className={`role-badge ${config?.className || ''}`}>
                {config?.label || role}
              </Text>
            );
          })}
        </View>

        {error && (
          <View className='register-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='register-card__form'>
          <View className='register-card__field'>
            <Text className='register-card__label'>{t('register.nicknameLabel')}</Text>
            <input
              className='register-card__input'
              type='text'
              placeholder={t('register.nicknamePlaceholder')}
              value={nickname}
              onInput={(e: any) => setNickname(e.target.value || e.detail?.value || '')}
            />
            {nicknameError && <Text className='register-card__field-error'>{nicknameError}</Text>}
          </View>

          <View className='register-card__field'>
            <Text className='register-card__label'>{t('register.emailLabel')}</Text>
            <input
              className='register-card__input'
              type='text'
              placeholder={t('register.emailPlaceholder')}
              value={email}
              onInput={(e: any) => setEmail(e.target.value || e.detail?.value || '')}
            />
            {emailError && <Text className='register-card__field-error'>{emailError}</Text>}
          </View>

          <View className='register-card__field'>
            <Text className='register-card__label'>{t('register.passwordLabel')}</Text>
            <input
              className='register-card__input'
              type='password'
              placeholder={t('register.passwordPlaceholder')}
              value={password}
              onInput={(e: any) => setPassword(e.target.value || e.detail?.value || '')}
            />
            {passwordError && <Text className='register-card__field-error'>{passwordError}</Text>}
            {password.length > 0 && (
              <View className='register-card__hints'>
                <Text className={`register-card__hint ${hasMinLength ? 'register-card__hint--pass' : ''}`}>
                  {hasMinLength ? '✓' : '○'} {t('register.hintMinLength')}
                </Text>
                <Text className={`register-card__hint ${hasLetter ? 'register-card__hint--pass' : ''}`}>
                  {hasLetter ? '✓' : '○'} {t('register.hintHasLetter')}
                </Text>
                <Text className={`register-card__hint ${hasDigit ? 'register-card__hint--pass' : ''}`}>
                  {hasDigit ? '✓' : '○'} {t('register.hintHasDigit')}
                </Text>
              </View>
            )}
          </View>

          <View className='register-card__field'>
            <Text className='register-card__label'>{t('register.confirmPasswordLabel')}</Text>
            <input
              className='register-card__input'
              type='password'
              placeholder={t('register.confirmPasswordPlaceholder')}
              value={confirmPassword}
              onInput={(e: any) => setConfirmPassword(e.target.value || e.detail?.value || '')}
            />
            {confirmPasswordError && <Text className='register-card__field-error'>{confirmPasswordError}</Text>}
          </View>

          {/* Privacy agreement checkbox */}
          <View className='register-card__agreement'>
            <View
              className={`register-card__checkbox ${agreedToPrivacy ? 'register-card__checkbox--checked' : ''}`}
              onClick={() => { setAgreedToPrivacy(!agreedToPrivacy); setPrivacyError(''); }}
            >
              {agreedToPrivacy && <Text className='register-card__checkbox-icon'>✓</Text>}
            </View>
            <Text className='register-card__agreement-text'>
              {t('register.agreePrefix')}
              <Text className='register-card__agreement-link' onClick={goToPrivacy}>{t('register.privacyLink')}</Text>
            </Text>
          </View>
          {privacyError && <Text className='register-card__field-error'>{privacyError}</Text>}

          <View
            className={`register-card__submit ${loading ? 'register-card__submit--loading' : ''}`}
            onClick={handleRegister}
          >
            <Text>{loading ? t('register.registering') : t('register.registerButton')}</Text>
          </View>

          <View className='register-card__footer'>
            <Text className='register-card__footer-text'>{t('register.hasAccount')}</Text>
            <Text className='register-card__footer-link' onClick={goToLogin}>{t('register.loginLink')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
