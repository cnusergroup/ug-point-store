import { useState, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request, RequestError } from '../../utils/request';
import './index.scss';

/** 独立本地存储 key，与商城 access_token 区分 */
const QUERY_TOKEN_KEY = 'queryToken';

/** 用户名/密码前端长度上限，与后端 Requirement 3.2 一致 */
const MAX_FIELD_LENGTH = 64;

/**
 * 独立查询登录页。
 *
 * 完全独立于商城用户登录体系：不 import `pages/login` 下任何组件，
 * 不调用 `useAppStore` 中商城登录 action，登录成功后使用独立本地存储
 * key `queryToken`（区别于商城的 `access_token`）。
 */
export default function QueryLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validateForm = useCallback((): boolean => {
    setError('');

    if (!username.trim()) {
      setError('请输入用户名');
      return false;
    }
    if (username.length > MAX_FIELD_LENGTH) {
      setError(`用户名长度不能超过 ${MAX_FIELD_LENGTH} 个字符`);
      return false;
    }
    if (!password) {
      setError('请输入密码');
      return false;
    }
    if (password.length > MAX_FIELD_LENGTH) {
      setError(`密码长度不能超过 ${MAX_FIELD_LENGTH} 个字符`);
      return false;
    }
    return true;
  }, [username, password]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await request<{ token: string }>({
        url: '/api/query/login',
        method: 'POST',
        data: { username, password },
        skipAuth: true,
      });

      Taro.setStorageSync(QUERY_TOKEN_KEY, token);
      Taro.redirectTo({ url: '/pages/query-dashboard/index' });
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'QUERY_LOGIN_LOCKED') {
          const remainingMs = err.data?.remainingMs as number | undefined;
          if (remainingMs && remainingMs > 0) {
            const minutes = Math.ceil(remainingMs / 60000);
            setError(`登录尝试次数过多，请在 ${minutes} 分钟后重试`);
          } else {
            setError('登录尝试次数过多，账号已被临时锁定，请稍后重试');
          }
        } else {
          // QUERY_INVALID_CREDENTIALS 及其他所有错误统一展示通用提示，不区分用户名/密码
          setError('用户名或密码错误');
        }
      } else {
        setError('登录失败，请检查网络后重试');
      }
    } finally {
      setLoading(false);
    }
  }, [username, password, validateForm]);

  return (
    <View className='query-login-page'>
      <View className='query-login-card'>
        <View className='query-login-card__header'>
          <Text className='query-login-card__title'>员工活动参与度查询</Text>
          <Text className='query-login-card__subtitle'>QUERY LOGIN</Text>
        </View>

        {error && (
          <View className='query-login-card__error'>
            <Text>{error}</Text>
          </View>
        )}

        <View className='query-login-card__form'>
          <View className='query-login-card__field'>
            <Text className='query-login-card__label'>用户名</Text>
            <input
              className='query-login-card__input'
              type='text'
              placeholder='请输入用户名'
              value={username}
              maxLength={MAX_FIELD_LENGTH}
              onInput={(e: any) => setUsername(e.target.value || e.detail?.value || '')}
            />
          </View>

          <View className='query-login-card__field'>
            <Text className='query-login-card__label'>密码</Text>
            <input
              className='query-login-card__input'
              type='password'
              placeholder='请输入密码'
              value={password}
              maxLength={MAX_FIELD_LENGTH}
              onInput={(e: any) => setPassword(e.target.value || e.detail?.value || '')}
            />
          </View>

          <View
            className={`query-login-card__submit ${loading ? 'query-login-card__submit--loading' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{loading ? '登录中...' : '登录'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
