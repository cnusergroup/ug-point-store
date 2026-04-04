import { useState, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { RequestError } from '../../utils/request';
import './index.scss';

/** 邮箱格式校验 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function ForgotPasswordPage() {
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
      setEmailError('请输入邮箱地址');
      return false;
    }
    if (!isValidEmail(email)) {
      setEmailError('邮箱格式不正确');
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
        setError('请求失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }, [email, forgotPassword, validateForm]);

  const goToLogin = useCallback(() => {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.redirectTo({ url: '/pages/login/index' });
    });
  }, []);

  if (success) {
    return (
      <View className='forgot-page'>
        <View className='forgot-page__bg-glow forgot-page__bg-glow--left' />
        <View className='forgot-page__bg-glow forgot-page__bg-glow--right' />
        <View className='forgot-card'>
          <View className='forgot-card__success'>
            <Text className='forgot-card__success-icon'>✉️</Text>
            <Text className='forgot-card__success-title'>邮件已发送</Text>
            <Text className='forgot-card__success-msg'>
              如果该邮箱已注册，重置邮件已发送
            </Text>
            <View className='forgot-card__submit' onClick={goToLogin}>
              <Text>返回登录</Text>
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
          <Text className='forgot-card__logo-icon'>🔑</Text>
          <Text className='forgot-card__logo-text'>忘记密码</Text>
          <Text className='forgot-card__logo-sub'>输入邮箱以重置密码</Text>
        </View>

        {error && (
          <View className='forgot-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='forgot-card__form'>
          <View className='forgot-card__field'>
            <Text className='forgot-card__label'>邮箱</Text>
            <input
              className='forgot-card__input'
              type='text'
              placeholder='请输入注册邮箱地址'
              value={email}
              onInput={(e: any) => setEmail(e.target.value || e.detail?.value || '')}
            />
            {emailError && <Text className='forgot-card__field-error'>{emailError}</Text>}
          </View>

          <View
            className={`forgot-card__submit ${loading ? 'forgot-card__submit--loading' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{loading ? '发送中...' : '发送重置邮件'}</Text>
          </View>

          <View className='forgot-card__footer'>
            <Text className='forgot-card__footer-link' onClick={goToLogin}>返回登录</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
