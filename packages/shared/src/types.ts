// ============================================================
// 共享类型定义 - 积分商城系统（Points Mall）
// ============================================================

/** 用户账号状态 */
export type UserStatus = 'active' | 'disabled';

/** 用户角色类型（扩展后） */
export type UserRole = 'UserGroupLeader' | 'CommunityBuilder' | 'Speaker' | 'Volunteer' | 'Admin' | 'SuperAdmin';

/** 管理角色 */
export const ADMIN_ROLES: UserRole[] = ['Admin', 'SuperAdmin'];

/** 普通角色 */
export const REGULAR_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

/** 所有角色 */
export const ALL_ROLES: UserRole[] = [...REGULAR_ROLES, ...ADMIN_ROLES];

/** 判断是否为管理角色 */
export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

/** 判断用户是否拥有管理权限 */
export function hasAdminAccess(roles: UserRole[]): boolean {
  return roles.some(r => ADMIN_ROLES.includes(r));
}

/** 判断用户是否为 SuperAdmin */
export function isSuperAdmin(roles: UserRole[]): boolean {
  return roles.includes('SuperAdmin');
}

/** 用户信息 */
export interface UserProfile {
  userId: string;
  nickname: string;
  email?: string;
  wechatOpenId?: string;
  roles: UserRole[];
  points: number;
  createdAt: string;
}

/** 商品类型 */
export type ProductType = 'points' | 'code_exclusive';

/** 商品状态 */
export type ProductStatus = 'active' | 'inactive';

/** 商品图片信息 */
export interface ProductImage {
  key: string;
  url: string;
}

/** 尺码选项 */
export interface SizeOption {
  name: string;
  stock: number;
}

/** 商品基础信息 */
export interface Product {
  productId: string;
  name: string;
  description: string;
  imageUrl: string;
  type: ProductType;
  status: ProductStatus;
  stock: number;
  redemptionCount: number;
  createdAt: string;
  updatedAt: string;
  images?: ProductImage[];
  sizeOptions?: SizeOption[];
  purchaseLimitEnabled?: boolean;
  purchaseLimitCount?: number;
}

/** 积分商品 */
export interface PointsProduct extends Product {
  type: 'points';
  pointsCost: number;
  allowedRoles: UserRole[] | 'all';
}

/** Code 专属商品 */
export interface CodeExclusiveProduct extends Product {
  type: 'code_exclusive';
  eventInfo: string;
}

/** 积分记录类型 */
export type PointsRecordType = 'earn' | 'spend';

/** 积分记录 */
export interface PointsRecord {
  recordId: string;
  userId: string;
  type: PointsRecordType;
  amount: number;
  source: string;
  balanceAfter: number;
  createdAt: string;
}

/** 兑换方式 */
export type RedemptionMethod = 'points' | 'code';

/** 兑换状态 */
export type RedemptionStatus = 'success' | 'pending' | 'failed';

/** 兑换记录 */
export interface RedemptionRecord {
  redemptionId: string;
  userId: string;
  productId: string;
  productName: string;
  method: RedemptionMethod;
  pointsSpent?: number;
  codeUsed?: string;
  status: RedemptionStatus;
  orderId?: string;
  createdAt: string;
}

/** Code 类型 */
export type CodeType = 'points' | 'product';

/** Code 状态 */
export type CodeStatus = 'active' | 'disabled' | 'exhausted';

/** Code 信息 */
export interface CodeInfo {
  codeId: string;
  codeValue: string;
  type: CodeType;
  name?: string;
  pointsValue?: number;
  productId?: string;
  maxUses: number;
  currentUses: number;
  status: CodeStatus;
  usedBy: string[];
  createdAt: string;
}

/** 错误响应 */
export interface ErrorResponse {
  code: string;
  message: string;
}

// ============================================================
// 购物车、收货地址、订单相关类型定义
// ============================================================

/** 物流状态 */
export type ShippingStatus = 'pending' | 'shipped';

/** 物流事件 */
export interface ShippingEvent {
  status: ShippingStatus;
  timestamp: string;
  remark?: string;
  operatorId?: string;
}

/** 购物车项（存储层） */
export interface CartItem {
  productId: string;
  quantity: number;
  addedAt: string;
  selectedSize?: string;
}

/** 购物车项详情（含商品信息） */
export interface CartItemDetail {
  productId: string;
  productName: string;
  imageUrl: string;
  pointsCost: number;
  quantity: number;
  subtotal: number;
  stock: number;
  status: 'active' | 'inactive';
  available: boolean;
  selectedSize?: string;
}

/** 购物车响应 */
export interface CartResponse {
  userId: string;
  items: CartItemDetail[];
  totalPoints: number;
  updatedAt: string;
}

/** 创建/编辑地址请求 */
export interface AddressRequest {
  recipientName: string;
  phone: string;
  detailAddress: string;
  isDefault?: boolean;
}

/** 地址响应 */
export interface AddressResponse {
  addressId: string;
  userId: string;
  recipientName: string;
  phone: string;
  detailAddress: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 创建订单请求（购物车批量） */
export interface CreateOrderRequest {
  items: { productId: string; quantity: number }[];
  addressId: string;
}

/** 直接下单请求（单件商品） */
export interface DirectOrderRequest {
  productId: string;
  quantity: number;
  addressId: string;
}

/** 更新物流状态请求 */
export interface UpdateShippingRequest {
  status: ShippingStatus;
  trackingNumber?: string;
  remark?: string;
}

/** 订单项 */
export interface OrderItem {
  productId: string;
  productName: string;
  imageUrl: string;
  pointsCost: number;
  quantity: number;
  subtotal: number;
  selectedSize?: string;
}

/** 订单响应 */
export interface OrderResponse {
  orderId: string;
  userId: string;
  items: OrderItem[];
  totalPoints: number;
  shippingAddress: {
    recipientName: string;
    phone: string;
    detailAddress: string;
  };
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  shippingEvents: ShippingEvent[];
  createdAt: string;
  updatedAt: string;
}

/** 订单列表项（简略） */
export interface OrderListItem {
  orderId: string;
  itemCount: number;
  totalPoints: number;
  shippingStatus: ShippingStatus;
  createdAt: string;
  productNames: string[];
}

/** 订单统计 */
export interface OrderStats {
  pending: number;
  shipped: number;
  total: number;
}

// ============================================================
// 积分申请相关类型定义
// ============================================================

/** 积分申请状态 */
export type ClaimStatus = 'pending' | 'approved' | 'rejected';

/** 积分申请记录 */
export interface ClaimRecord {
  claimId: string;
  userId: string;
  applicantNickname: string;
  applicantRole: string;
  title: string;
  description: string;
  imageUrls: string[];
  activityUrl?: string;
  status: ClaimStatus;
  awardedPoints?: number;
  rejectReason?: string;
  reviewerId?: string;
  reviewerNickname?: string;
  reviewedAt?: string;
  createdAt: string;
}

// ============================================================
// 邀请制注册相关类型定义
// ============================================================

/** 邀请状态 */
export type InviteStatus = 'pending' | 'used' | 'expired';

/** 邀请记录 */
export interface InviteRecord {
  token: string;
  role: UserRole;
  roles?: UserRole[];    // 新增，多角色数组（向后兼容旧数据时可选）
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string; // userId
}

/** 从 InviteRecord 安全获取 roles 数组（兼容旧数据） */
export function getInviteRoles(record: { role?: UserRole; roles?: UserRole[] }): UserRole[] {
  if (record.roles && record.roles.length > 0) return record.roles;
  if (record.role) return [record.role];
  return [];
}

// ============================================================
// 辅助函数
// ============================================================

/** 物流状态顺序 */
export const SHIPPING_STATUS_ORDER: ShippingStatus[] = ['pending', 'shipped'];

/** 校验物流状态流转是否合法（仅允许前进到直接后继状态） */
export function validateStatusTransition(
  current: ShippingStatus,
  target: ShippingStatus,
): { valid: boolean; message?: string } {
  const currentIdx = SHIPPING_STATUS_ORDER.indexOf(current);
  const targetIdx = SHIPPING_STATUS_ORDER.indexOf(target);
  if (targetIdx === currentIdx + 1) {
    return { valid: true };
  }
  return { valid: false, message: '物流状态不可回退' };
}

/** 计算购物车积分总计 */
export function calculateCartTotal(items: { pointsCost: number; quantity: number }[]): number {
  return items.reduce((sum, item) => sum + item.pointsCost * item.quantity, 0);
}

/** 手机号遮蔽（前3位 + **** + 后4位） */
export function maskPhone(phone: string): string {
  return phone.slice(0, 3) + '****' + phone.slice(7);
}

// ============================================================
// 内容中心（Content Hub）相关类型定义
// ============================================================

/** 内容状态 */
export type ContentStatus = 'pending' | 'approved' | 'rejected';

/** 内容记录 */
export interface ContentItem {
  contentId: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string;
  uploaderId: string;
  uploaderNickname: string;
  uploaderRole: string;
  fileKey: string;
  fileName: string;
  fileSize: number;
  videoUrl?: string;
  status: ContentStatus;
  rejectReason?: string;
  reviewerId?: string;
  reviewedAt?: string;
  likeCount: number;
  commentCount: number;
  reservationCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 内容列表摘要 */
export interface ContentItemSummary {
  contentId: string;
  title: string;
  categoryName: string;
  uploaderNickname: string;
  likeCount: number;
  commentCount: number;
  reservationCount: number;
  createdAt: string;
}

/** 内容分类 */
export interface ContentCategory {
  categoryId: string;
  name: string;
  createdAt: string;
}

/** 内容评论 */
export interface ContentComment {
  commentId: string;
  contentId: string;
  userId: string;
  userNickname: string;
  userRole: string;
  content: string;
  createdAt: string;
}

/** 内容预约记录 */
export interface ContentReservation {
  pk: string;
  userId: string;
  contentId: string;
  createdAt: string;
}

// ============================================================
// 内容中心校验辅助函数
// ============================================================

/** 允许的文档 MIME 类型 */
const ALLOWED_CONTENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** 校验文档文件 MIME 类型是否合法 */
export function isValidContentFileType(mimeType: string): boolean {
  return (ALLOWED_CONTENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** 校验视频 URL 格式是否合法 */
export function isValidVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
