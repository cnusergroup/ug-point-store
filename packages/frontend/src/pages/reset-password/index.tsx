import { useState, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { RequestError } from '../../utils/request';
import './index.scss';

/** 密码规则：至少 8 位，同时包含字母和数字 */
function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw);
}

/** 错误码 → 用户友好提示 */
function mapErrorMessage(code: string): string {
  switch (code) {
    case 'RESET_TOKEN_EXPIRED':
      return '重置链接已过期，请重新申请';
    case 'RESET_TOKEN_INVALID':
      return '重置链接无效或已被使用';
    case 'INVALID_PASSWORD_FORMAT':
      return '密码格式不正确，需至少 8 位且包含字母和数字';
    default:
      return '请求失败，请稍后重试';
  }
}

export default function ResetPasswordPage() {
  const token = Taro.getCurrentInstance().router?.params?.token || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pwError, setPwError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [success, setSuccess] = useState(false);

  const resetPassword = useAppStore((s) => s.resetPassword);

  const validateForm = useCallback((): boolean => {
    setPwError('');
    setConfirmError('');
    setError('');

    if (!newPassword) {
      setPwError('请输入新密码');
      return false;
    }
    if (!isValidPassword(newPassword)) {
      setPwError('密码需至少 8 位，且同时包含字母和数字');
      return false;
    }
    if (!confirmPassword) {
      setConfirmError('请确认新密码');
      return false;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError('两次输入的密码不一致');
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
        setError(mapErrorMessage(err.code));
      } else {
        setError('请求失败，请稍后重试');
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
            <Text className='reset-card__error-state-icon'>⚠️</Text>
            <Text className='reset-card__error-state-title'>链接无效</Text>
            <Text className='reset-card__error-state-msg'>
              缺少重置令牌，请通过邮件中的链接访问此页面
            </Text>
            <View className='reset-card__submit' onClick={goToLogin}>
              <Text>返回登录</Text>
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
            <Text className='reset-card__success-icon'>✅</Text>
            <Text className='reset-card__success-title'>密码重置成功</Text>
            <Text className='reset-card__success-msg'>
              您的密码已更新，请使用新密码登录
            </Text>
            <View className='reset-card__submit' onClick={goToLogin}>
              <Text>返回登录</Text>
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
          <Text className='reset-card__logo-icon'>🔐</Text>
          <Text className='reset-card__logo-text'>重置密码</Text>
          <Text className='reset-card__logo-sub'>请输入您的新密码</Text>
        </View>

        {error && (
          <View className='reset-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='reset-card__form'>
          <View className='reset-card__field'>
            <Text className='reset-card__label'>新密码</Text>
            <input
              className='reset-card__input'
              type='password'
              placeholder='至少 8 位，包含字母和数字'
              value={newPassword}
              onInput={(e: any) => setNewPassword(e.target.value || e.detail?.value || '')}
            />
            {pwError && <Text className='reset-card__field-error'>{pwError}</Text>}
          </View>

          <View className='reset-card__field'>
            <Text className='reset-card__label'>确认新密码</Text>
            <input
              className='reset-card__input'
              type='password'
              placeholder='再次输入新密码'
              value={confirmPassword}
              onInput={(e: any) => setConfirmPassword(e.target.value || e.detail?.value || '')}
            />
            {confirmError && <Text className='reset-card__field-error'>{confirmError}</Text>}
          </View>

          <View
            className={`reset-card__submit ${loading ? 'reset-card__submit--loading' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{loading ? '提交中...' : '重置密码'}</Text>
          </View>

          <View className='reset-card__footer'>
            <Text className='reset-card__footer-link' onClick={goToLogin}>返回登录</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
