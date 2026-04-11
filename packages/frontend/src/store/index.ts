import Taro from '@tarojs/taro';
import { create } from 'zustand';
import { request, getToken, setToken, clearToken } from '../utils/request';
import type {
  CartResponse,
  AddressRequest,
  AddressResponse,
  OrderResponse,
  OrderListItem,
} from '@points-mall/shared';
import type { Locale } from '../i18n/types';

const USER_KEY = 'user_info';

function getSavedUser(): UserState | null {
  try {
    const raw = Taro.getStorageSync(USER_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveUser(user: UserState | null): void {
  try {
    if (user) {
      Taro.setStorageSync(USER_KEY, JSON.stringify(user));
    } else {
      Taro.removeStorageSync(USER_KEY);
    }
  } catch { /* ignore */ }
}

/** 用户角色（与后端 UserRole 保持一致） */
export type UserRole = 'UserGroupLeader' | 'Speaker' | 'Volunteer' | 'Admin' | 'SuperAdmin';

/** 用户状态 */
export interface UserState {
  userId: string;
  nickname: string;
  email?: string;
  roles: UserRole[];
  points: number;
}

/** 登录响应 */
interface AuthResponse {
  accessToken: string;
  user: UserState;
}

/** 主题类型 */
export type ThemeType = 'default' | 'warm';

/** Store 状态 */
interface AppState {
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 当前用户信息 */
  user: UserState | null;

  /** 当前主题 */
  theme: ThemeType;
  /** 设置主题 */
  setTheme: (theme: ThemeType) => void;

  /** 当前语言 */
  locale: Locale;
  /** 设置语言 */
  setLocale: (locale: Locale) => void;

  /** 购物车可用商品数量（用于 Tab Bar 徽标） */
  cartCount: number;
  /** 获取购物车数量 */
  fetchCartCount: () => Promise<void>;
  /** 更新购物车数量（本地更新，用于操作后即时反馈） */
  setCartCount: (count: number) => void;

  /** 邮箱密码登录 */
  loginByEmail: (email: string, password: string) => Promise<void>;
  /** 邮箱注册 */
  register: (email: string, password: string, nickname: string, inviteToken: string) => Promise<void>;
  /** 微信登录 */
  wechatLogin: () => Promise<void>;
  /** 登出：调用 logout API，清除 Token 和用户信息，跳转登录页 */
  logout: () => Promise<void>;
  /** 刷新 Token */
  refreshToken: () => Promise<void>;
  /** 直接设置登录态（内部使用） */
  setAuth: (token: string, user: UserState) => void;
  /** 更新用户信息 */
  updateUser: (partial: Partial<UserState>) => void;
  /** 更新积分余额 */
  updatePoints: (points: number) => void;
  /** 修改密码 */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** 忘记密码（请求重置） */
  forgotPassword: (email: string) => Promise<void>;
  /** 重置密码（执行重置） */
  resetPassword: (token: string, newPassword: string) => Promise<void>;

  // ── 购物车 ──
  /** 添加商品到购物车 */
  addToCart: (productId: string, quantity?: number, selectedSize?: string) => Promise<void>;
  /** 获取购物车 */
  getCart: () => Promise<CartResponse>;
  /** 更新购物车项数量 */
  updateCartItem: (productId: string, quantity: number) => Promise<void>;
  /** 删除购物车项 */
  deleteCartItem: (productId: string) => Promise<void>;

  // ── 收货地址 ──
  /** 获取用户所有收货地址 */
  getAddresses: () => Promise<AddressResponse[]>;
  /** 添加收货地址 */
  createAddress: (data: AddressRequest) => Promise<AddressResponse>;
  /** 编辑收货地址 */
  updateAddress: (addressId: string, data: AddressRequest) => Promise<AddressResponse>;
  /** 删除收货地址 */
  deleteAddress: (addressId: string) => Promise<void>;
  /** 设为默认地址 */
  setDefaultAddress: (addressId: string) => Promise<void>;

  // ── 订单 ──
  /** 创建订单（购物车批量兑换） */
  createOrder: (items: { productId: string; quantity: number }[], addressId: string) => Promise<OrderResponse>;
  /** 直接下单（单件商品） */
  createDirectOrder: (productId: string, quantity: number, addressId: string) => Promise<OrderResponse>;
  /** 获取订单列表 */
  getOrders: (page?: number, pageSize?: number) => Promise<{ orders: OrderListItem[]; total: number }>;
  /** 获取订单详情 */
  getOrderDetail: (orderId: string) => Promise<OrderResponse>;

  /** 从后端刷新用户信息 */
  fetchProfile: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  isAuthenticated: !!getToken(),
  user: getSavedUser(),
  cartCount: 0,
  theme: ((): ThemeType => {
    try {
      const saved = Taro.getStorageSync('app_theme');
      return saved === 'warm' ? 'warm' : 'default';
    } catch { return 'default'; }
  })(),

  setTheme: (theme) => {
    try { Taro.setStorageSync('app_theme', theme); } catch { /* ignore */ }
    set({ theme });
  },

  locale: ((): Locale => {
    try {
      const saved = Taro.getStorageSync('app_locale');
      if (['zh', 'en', 'ja', 'ko', 'zh-TW'].includes(saved)) return saved as Locale;
    } catch { /* ignore */ }
    return 'zh';
  })(),

  setLocale: (locale) => {
    try { Taro.setStorageSync('app_locale', locale); } catch { /* ignore */ }
    set({ locale });
  },

  fetchCartCount: async () => {
    try {
      const res = await request<CartResponse>({ url: '/api/cart' });
      const count = res.items.filter((item) => item.available).length;
      set({ cartCount: count });
    } catch {
      // on error keep cartCount at 0
    }
  },

  setCartCount: (count) => set({ cartCount: count }),

  loginByEmail: async (email, password) => {
    const res = await request<AuthResponse>({
      url: '/api/auth/login',
      method: 'POST',
      data: { email, password },
      skipAuth: true,
    });
    setToken(res.accessToken);
    saveUser(res.user);
    set({ isAuthenticated: true, user: res.user });
  },

  register: async (email, password, nickname, inviteToken) => {
    const res = await request<AuthResponse>({
      url: '/api/auth/register',
      method: 'POST',
      data: { email, password, nickname, inviteToken },
      skipAuth: true,
    });
    setToken(res.accessToken);
    saveUser(res.user);
    set({ isAuthenticated: true, user: res.user });
  },

  wechatLogin: async () => {
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEAPP) {
      // 小程序端：调用 wx.login 获取 code
      const { code } = await Taro.login();
      const res = await request<AuthResponse>({
        url: '/api/auth/wechat/callback',
        method: 'POST',
        data: { code },
        skipAuth: true,
      });
      setToken(res.accessToken);
      saveUser(res.user);
      set({ isAuthenticated: true, user: res.user });
    } else {
      // PC/H5 端：获取二维码 URL，由页面组件展示
      const { qrcodeUrl } = await request<{ qrcodeUrl: string }>({
        url: '/api/auth/wechat/qrcode',
        method: 'POST',
        skipAuth: true,
      });
      // 在 H5 端打开微信授权页面
      if (qrcodeUrl) {
        window.location.href = qrcodeUrl;
      }
    }
  },

  logout: async () => {
    // Notify server (best-effort; JWT is stateless so server doesn't need to do anything)
    try {
      await request({ url: '/api/auth/logout', method: 'POST' });
    } catch {
      // ignore errors — we always clear locally
    }
    clearToken();
    saveUser(null);
    set({ isAuthenticated: false, user: null });
    // In H5 mode, Taro.redirectTo may not reliably navigate; use location as fallback
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEB) {
      window.location.hash = '#/pages/login/index';
      window.location.reload();
    } else {
      Taro.redirectTo({ url: '/pages/login/index' });
    }
  },

  refreshToken: async () => {
    try {
      const res = await request<AuthResponse>({
        url: '/api/auth/refresh',
        method: 'POST',
      });
      setToken(res.accessToken);
      set({ isAuthenticated: true, user: res.user });
    } catch {
      clearToken();
      set({ isAuthenticated: false, user: null });
      Taro.redirectTo({ url: '/pages/login/index' });
    }
  },

  setAuth: (token, user) => {
    setToken(token);
    set({ isAuthenticated: true, user });
  },

  updateUser: (partial) =>
    set((state) => {
      const updated = state.user ? { ...state.user, ...partial } : null;
      saveUser(updated);
      return { user: updated };
    }),

  updatePoints: (points) =>
    set((state) => {
      const updated = state.user ? { ...state.user, points } : null;
      saveUser(updated);
      return { user: updated };
    }),

  changePassword: async (currentPassword, newPassword) => {
    await request<{ message: string }>({
      url: '/api/auth/change-password',
      method: 'POST',
      data: { currentPassword, newPassword },
    });
  },

  forgotPassword: async (email) => {
    await request<{ message: string }>({
      url: '/api/auth/forgot-password',
      method: 'POST',
      data: { email },
      skipAuth: true,
    });
  },

  resetPassword: async (token, newPassword) => {
    await request<{ message: string }>({
      url: '/api/auth/reset-password',
      method: 'POST',
      data: { token, newPassword },
      skipAuth: true,
    });
  },

  // ── 购物车 ──

  addToCart: async (productId, quantity, selectedSize) => {
    await request({
      url: '/api/cart/items',
      method: 'POST',
      data: { productId, quantity: quantity ?? 1, ...(selectedSize ? { selectedSize } : {}) },
    });
  },

  getCart: async () => {
    return request<CartResponse>({ url: '/api/cart' });
  },

  updateCartItem: async (productId, quantity) => {
    await request({ url: `/api/cart/items/${productId}`, method: 'PUT', data: { quantity } });
  },

  deleteCartItem: async (productId) => {
    await request({ url: `/api/cart/items/${productId}`, method: 'DELETE' });
  },

  // ── 收货地址 ──

  getAddresses: async () => {
    return request<AddressResponse[]>({ url: '/api/addresses' });
  },

  createAddress: async (data) => {
    return request<AddressResponse>({ url: '/api/addresses', method: 'POST', data: data as unknown as Record<string, unknown> });
  },

  updateAddress: async (addressId, data) => {
    return request<AddressResponse>({ url: `/api/addresses/${addressId}`, method: 'PUT', data: data as unknown as Record<string, unknown> });
  },

  deleteAddress: async (addressId) => {
    await request({ url: `/api/addresses/${addressId}`, method: 'DELETE' });
  },

  setDefaultAddress: async (addressId) => {
    await request({ url: `/api/addresses/${addressId}/default`, method: 'PATCH' });
  },

  // ── 订单 ──

  createOrder: async (items, addressId) => {
    return request<OrderResponse>({ url: '/api/orders', method: 'POST', data: { items, addressId } as unknown as Record<string, unknown> });
  },

  createDirectOrder: async (productId, quantity, addressId) => {
    return request<OrderResponse>({ url: '/api/orders/direct', method: 'POST', data: { productId, quantity, addressId } });
  },

  getOrders: async (page = 1, pageSize = 10) => {
    return request<{ orders: OrderListItem[]; total: number }>({ url: `/api/orders?page=${page}&pageSize=${pageSize}` });
  },

  getOrderDetail: async (orderId) => {
    return request<OrderResponse>({ url: `/api/orders/${orderId}` });
  },

  fetchProfile: async () => {
    try {
      const res = await request<{ success: boolean; profile: { userId: string; nickname: string; email?: string; roles: UserRole[]; points: number; createdAt?: string } }>({ url: '/api/user/profile' });
      if (res.profile) {
        const { createdAt: _, ...userState } = res.profile as any;
        saveUser(userState);
        set({ user: userState });
      }
    } catch {
      // silently fail - user info stays from cache
    }
  },
}));
