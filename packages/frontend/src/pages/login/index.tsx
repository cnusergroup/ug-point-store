import { useState, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { RequestError } from '../../utils/request';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [wechatQrUrl, setWechatQrUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  const loginByEmail = useAppStore((s) => s.loginByEmail);
  const wechatLogin = useAppStore((s) => s.wechatLogin);

  const isWeapp = Taro.getEnv() === Taro.ENV_TYPE.WEAPP;

  const validateForm = useCallback((): boolean => {
    let valid = true;
    setEmailError('');
    setPasswordError('');
    setError('');

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

    return valid;
  }, [email, password]);

  const handleLogin = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      await loginByEmail(email, password);
      Taro.switchTab({ url: '/pages/index/index' });
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'ACCOUNT_LOCKED') {
          setError('账号已锁定，请 15 分钟后再试');
        } else if (err.code === 'INVALID_CREDENTIALS') {
          setError('邮箱或密码错误');
        } else {
          setError(err.message);
        }
      } else {
        setError('登录失败，请稍后重试');
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
        Taro.switchTab({ url: '/pages/index/index' });
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
      setError(err instanceof RequestError ? err.message : '微信登录失败');
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
            <Text className='login-card__logo-accent'>积分</Text>商城
          </Text>
          <Text className='login-card__logo-sub'>Points Mall</Text>
        </View>

        {/* WeChat Login Section - hidden for now */}
        {/* {!showQr && (
          <View className='login-card__wechat' onClick={handleWechatLogin}>
            <View className='login-card__wechat-btn'>
              <Text className='login-card__wechat-icon'>💬</Text>
              <Text>{isWeapp ? '微信一键登录' : '微信扫码登录'}</Text>
            </View>
          </View>
        )}

        {showQr && wechatQrUrl && (
          <View className='login-card__qr'>
            <Image className='login-card__qr-img' src={wechatQrUrl} mode='aspectFit' />
            <Text className='login-card__qr-tip'>请使用微信扫描二维码登录</Text>
            <Text className='login-card__qr-back' onClick={() => setShowQr(false)}>返回邮箱登录</Text>
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
                <Text className='login-card__label'>邮箱</Text>
                <input
                  className='login-card__input'
                  type='text'
                  placeholder='请输入邮箱地址'
                  value={email}
                  onInput={(e: any) => setEmail(e.target.value || e.detail?.value || '')}
                />
                {emailError && <Text className='login-card__field-error'>{emailError}</Text>}
              </View>

              <View className='login-card__field'>
                <Text className='login-card__label'>密码</Text>
                <input
                  className='login-card__input'
                  type='password'
                  placeholder='请输入密码'
                  value={password}
                  onInput={(e: any) => setPassword(e.target.value || e.detail?.value || '')}
                />
                {passwordError && <Text className='login-card__field-error'>{passwordError}</Text>}
              </View>

              <View
                className={`login-card__submit ${loading ? 'login-card__submit--loading' : ''}`}
                onClick={handleLogin}
              >
                <Text>{loading ? '登录中...' : '登 录'}</Text>
              </View>

              <View className='login-card__forgot'>
                <Text className='login-card__forgot-link' onClick={goToForgotPassword}>忘记密码？</Text>
              </View>

              {/* Registration is invite-only, hide self-registration link */}
              {/* <View className='login-card__footer'>
                <Text className='login-card__footer-text'>还没有账号？</Text>
                <Text className='login-card__footer-link' onClick={goToRegister}>注册</Text>
              </View> */}
            </View>
          </>
        )}
      </View>
    </View>
  );
}
