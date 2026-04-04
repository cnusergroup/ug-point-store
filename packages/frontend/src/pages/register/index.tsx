import { useState, useCallback, useEffect } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
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
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
};

/** 邀请验证状态 */
type InviteState =
  | { status: 'loading' }
  | { status: 'valid'; role: string }
  | { status: 'invalid'; reason: 'INVITE_TOKEN_INVALID' | 'INVITE_TOKEN_USED' | 'INVITE_TOKEN_EXPIRED' | 'MISSING' };

export default function RegisterPage() {
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

    request<{ valid: boolean; role: string }>({
      url: '/api/auth/validate-invite',
      method: 'POST',
      data: { token },
      skipAuth: true,
    })
      .then((result) => {
        setInviteState({ status: 'valid', role: result.role });
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

    if (!nickname.trim()) {
      setNicknameError('请输入昵称');
      valid = false;
    }

    if (!email.trim()) {
      setEmailError('请输入邮箱地址');
      valid = false;
    } else if (!isValidEmail(email)) {
      setEmailError('邮箱格式不正确');
      valid = false;
    }

    if (!password) {
      setPasswordError('请输入密码');
      valid = false;
    } else if (!isValidPassword(password)) {
      setPasswordError('密码需至少 8 位，包含字母和数字');
      valid = false;
    }

    if (!confirmPassword) {
      setConfirmPasswordError('请再次输入密码');
      valid = false;
    } else if (confirmPassword !== password) {
      setConfirmPasswordError('两次输入的密码不一致');
      valid = false;
    }

    return valid;
  }, [email, password, confirmPassword, nickname]);

  const handleRegister = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      await register(email, password, nickname, inviteToken);
      // Registration auto-logs in — redirect to home
      Taro.showToast({ title: '注册成功', icon: 'success', duration: 1500 });
      setTimeout(() => {
        Taro.reLaunch({ url: '/pages/index/index' });
      }, 1000);
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'EMAIL_ALREADY_EXISTS') {
          setError('该邮箱已被注册');
        } else if (err.code === 'INVALID_PASSWORD_FORMAT') {
          setError('密码格式不符合要求');
        } else if (err.code === 'INVITE_TOKEN_INVALID') {
          setError('邀请链接无效');
        } else if (err.code === 'INVITE_TOKEN_USED') {
          setError('邀请链接已被使用');
        } else if (err.code === 'INVITE_TOKEN_EXPIRED') {
          setError('邀请链接已过期');
        } else {
          setError(err.message);
        }
      } else {
        setError('注册失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, nickname, inviteToken, register, validateForm]);

  const goToLogin = useCallback(() => {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.redirectTo({ url: '/pages/login/index' });
    });
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
            <Text className='register-card__loading-text'>验证邀请链接中...</Text>
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
            <Text className='register-card__invalid-icon'>🔒</Text>
            <Text className='register-card__invalid-title'>邀请链接无效</Text>
            <Text className='register-card__invalid-desc'>
              {inviteState.reason === 'INVITE_TOKEN_USED'
                ? '该邀请链接已被使用，每个邀请链接只能使用一次。'
                : inviteState.reason === 'INVITE_TOKEN_EXPIRED'
                ? '该邀请链接已过期，邀请链接有效期为 24 小时。'
                : '该邀请链接不存在或已失效，请联系管理员获取新的邀请链接。'}
            </Text>
            <View className='register-card__invalid-action btn-primary' onClick={goToLogin}>
              <Text>返回登录</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Valid invite — show registration form
  const roleConfig = ROLE_CONFIG[inviteState.role];

  return (
    <View className='register-page'>
      <View className='register-page__bg-glow register-page__bg-glow--left' />
      <View className='register-page__bg-glow register-page__bg-glow--right' />

      <View className='register-card'>
        <View className='register-card__logo'>
          <Image className='register-card__logo-mascot' src={mascotImg} mode='aspectFit' />
          <Text className='register-card__logo-text'>创建账号</Text>
          <Text className='register-card__logo-sub'>加入积分商城</Text>
        </View>

        {/* Role badge */}
        <View className='register-card__role-row'>
          <Text className='register-card__role-label'>邀请身份</Text>
          <Text className={`role-badge ${roleConfig?.className || ''}`}>
            {roleConfig?.label || inviteState.role}
          </Text>
        </View>

        {error && (
          <View className='register-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='register-card__form'>
          <View className='register-card__field'>
            <Text className='register-card__label'>昵称</Text>
            <input
              className='register-card__input'
              type='text'
              placeholder='请输入昵称'
              value={nickname}
              onInput={(e: any) => setNickname(e.target.value || e.detail?.value || '')}
            />
            {nicknameError && <Text className='register-card__field-error'>{nicknameError}</Text>}
          </View>

          <View className='register-card__field'>
            <Text className='register-card__label'>邮箱</Text>
            <input
              className='register-card__input'
              type='text'
              placeholder='请输入邮箱地址'
              value={email}
              onInput={(e: any) => setEmail(e.target.value || e.detail?.value || '')}
            />
            {emailError && <Text className='register-card__field-error'>{emailError}</Text>}
          </View>

          <View className='register-card__field'>
            <Text className='register-card__label'>密码</Text>
            <input
              className='register-card__input'
              type='password'
              placeholder='请输入密码'
              value={password}
              onInput={(e: any) => setPassword(e.target.value || e.detail?.value || '')}
            />
            {passwordError && <Text className='register-card__field-error'>{passwordError}</Text>}
            {password.length > 0 && (
              <View className='register-card__hints'>
                <Text className={`register-card__hint ${hasMinLength ? 'register-card__hint--pass' : ''}`}>
                  {hasMinLength ? '✓' : '○'} 至少 8 个字符
                </Text>
                <Text className={`register-card__hint ${hasLetter ? 'register-card__hint--pass' : ''}`}>
                  {hasLetter ? '✓' : '○'} 包含字母
                </Text>
                <Text className={`register-card__hint ${hasDigit ? 'register-card__hint--pass' : ''}`}>
                  {hasDigit ? '✓' : '○'} 包含数字
                </Text>
              </View>
            )}
          </View>

          <View className='register-card__field'>
            <Text className='register-card__label'>确认密码</Text>
            <input
              className='register-card__input'
              type='password'
              placeholder='请再次输入密码'
              value={confirmPassword}
              onInput={(e: any) => setConfirmPassword(e.target.value || e.detail?.value || '')}
            />
            {confirmPasswordError && <Text className='register-card__field-error'>{confirmPasswordError}</Text>}
          </View>

          <View
            className={`register-card__submit ${loading ? 'register-card__submit--loading' : ''}`}
            onClick={handleRegister}
          >
            <Text>{loading ? '注册中...' : '注 册'}</Text>
          </View>

          <View className='register-card__footer'>
            <Text className='register-card__footer-text'>已有账号？</Text>
            <Text className='register-card__footer-link' onClick={goToLogin}>登录</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
