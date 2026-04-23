// ============================================================
// 共享类型定义 - 积分商城系统（Points Mall）
// ============================================================

/** 用户账号状态 */
export type UserStatus = 'active' | 'disabled' | 'locked';

/** 用户角色类型（扩展后） */
export type UserRole = 'UserGroupLeader' | 'Speaker' | 'Volunteer' | 'Admin' | 'SuperAdmin' | 'OrderAdmin';

/** 管理角色 */
export const ADMIN_ROLES: UserRole[] = ['Admin', 'SuperAdmin'];

/** 普通角色 */
export const REGULAR_ROLES: UserRole[] = ['UserGroupLeader', 'Speaker', 'Volunteer'];

/** 独占角色（与其他所有角色互斥） */
export const EXCLUSIVE_ROLES: UserRole[] = ['OrderAdmin'];

/** 所有角色 */
export const ALL_ROLES: UserRole[] = [...REGULAR_ROLES, ...ADMIN_ROLES, ...EXCLUSIVE_ROLES];

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

/** 判断用户是否为 OrderAdmin */
export function isOrderAdmin(roles: UserRole[]): boolean {
  return roles.includes('OrderAdmin');
}

/** 判断角色是否为独占角色 */
export function isExclusiveRole(role: UserRole): boolean {
  return EXCLUSIVE_ROLES.includes(role);
}

/** 校验角色组合是否合法（独占角色不能与其他角色共存） */
export function validateRoleExclusivity(roles: UserRole[]): { valid: boolean; message?: string } {
  const hasExclusive = roles.some(r => EXCLUSIVE_ROLES.includes(r));
  if (hasExclusive && roles.length > 1) {
    return { valid: false, message: '独占角色不能与其他角色共存' };
  }
  return { valid: true };
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

/** 商品品牌 */
export type ProductBrand = 'aws' | 'ug' | 'awscloud';

/** 有效品牌列表 */
export const VALID_BRANDS: ProductBrand[] = ['aws', 'ug', 'awscloud'];

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
  brand?: ProductBrand;
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
  isEmployee?: boolean;  // 员工邀请标记
}

/** 从 InviteRecord 安全获取 roles 数组（兼容旧数据） */
export function getInviteRoles(record: { role?: UserRole; roles?: UserRole[] }): UserRole[] {
  if (record.roles && record.roles.length > 0) return record.roles;
  if (record.role) return [record.role];
  return [];
}

/** 安全获取 isEmployee 标记（兼容旧数据，缺失时默认 false） */
export function getInviteIsEmployee(record: { isEmployee?: boolean }): boolean {
  return record.isEmployee ?? false;
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

/**
 * 手机号遮蔽（支持国际格式和旧格式）
 * - 国际格式 "+CC-NNNN"：保留区号，号码部分 ≥6 位时保留前3后2中间****，<6 位时保留首末中间****
 * - 旧格式纯数字：保留前3 + **** + 后4（向后兼容）
 */
export function maskPhone(phone: string): string {
  // 尝试匹配国际格式
  const match = phone.match(/^\+(\d{1,4})-(\d{4,15})$/);
  if (match) {
    const cc = match[1];
    const num = match[2];
    if (num.length >= 6) {
      return `+${cc} ${num.slice(0, 3)}****${num.slice(-2)}`;
    }
    // 号码部分 <6 位：保留首末中间****
    return `+${cc} ${num[0]}****${num[num.length - 1]}`;
  }

  // 旧格式纯数字：前3 + **** + 后4
  return phone.slice(0, 3) + '****' + phone.slice(7);
}

// ============================================================
// 内容中心（Content Hub）相关类型定义
// ============================================================

/** 内容状态 */
export type ContentStatus = 'pending' | 'approved' | 'rejected';

/** 预览转换状态 */
export type PreviewStatus = 'pending' | 'completed' | 'failed';

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
  tags?: string[];
  previewFileKey?: string;
  previewStatus?: PreviewStatus;
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
  tags?: string[];
}

/** 我的内容列表摘要（含状态与驳回原因） */
export interface MyContentItemSummary {
  contentId: string;
  title: string;
  categoryName: string;
  status: ContentStatus;
  rejectReason?: string;
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

/** 预约审批状态 */
export type ReservationStatus = 'pending' | 'approved' | 'rejected';

/** 内容预约记录 */
export interface ContentReservation {
  pk: string;
  userId: string;
  contentId: string;
  activityId: string;
  activityType: string;
  activityUG: string;
  activityTopic: string;
  activityDate: string;
  status: ReservationStatus;
  reviewerId?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** 预约审批列表项 */
export interface ReservationApprovalItem {
  pk: string;
  userId: string;
  contentId: string;
  contentTitle: string;
  reserverNickname: string;
  activityId: string;
  activityType: string;
  activityUG: string;
  activityTopic: string;
  activityDate: string;
  status: ReservationStatus;
  reviewerId?: string;
  reviewedAt?: string;
  createdAt: string;
}

// ============================================================
// 标签（Tag）相关类型与校验函数
// ============================================================

/** 标签记录 */
export interface TagRecord {
  tagId: string;
  tagName: string;
  usageCount: number;
  createdAt: string;
}

/** 标签名规范化：trim + toLowerCase */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

/** 校验单个标签名（规范化后 2~20 字符） */
export function validateTagName(name: string): boolean {
  const normalized = normalizeTagName(name);
  return normalized.length >= 2 && normalized.length <= 20;
}

/** 校验标签数组（0~5 个，每个合法，无重复） */
export function validateTagsArray(tags: string[]): {
  valid: boolean;
  normalizedTags: string[];
  error?: string;
} {
  if (tags.length > 5) {
    return { valid: false, normalizedTags: [], error: 'TOO_MANY_TAGS' };
  }
  const normalized = tags.map(normalizeTagName);
  for (const tag of normalized) {
    if (tag.length < 2 || tag.length > 20) {
      return { valid: false, normalizedTags: [], error: 'INVALID_TAG_NAME' };
    }
  }
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    return { valid: false, normalizedTags: [], error: 'DUPLICATE_TAG_NAME' };
  }
  return { valid: true, normalizedTags: normalized };
}

// ============================================================
// 内容中心校验辅助函数
// ============================================================

/** 判断文件是否为 Office 文件（PPT/PPTX/DOC/DOCX） */
export function isOfficeFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return ['ppt', 'pptx', 'doc', 'docx'].includes(ext);
}

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

// ============================================================
// 批量积分发放相关类型定义
// ============================================================

/** 批量发放记录 */
export interface DistributionRecord {
  distributionId: string;
  distributorId: string;
  distributorNickname: string;
  targetRole: 'UserGroupLeader' | 'Speaker' | 'Volunteer';
  speakerType?: 'typeA' | 'typeB' | 'roundtable';
  recipientIds: string[];
  recipientDetails?: { userId: string; nickname: string; email: string }[];
  points: number;
  reason: string;
  successCount: number;
  totalPoints: number;
  createdAt: string;
  activityId?: string;
  activityType?: string;
  activityUG?: string;
  activityTopic?: string;
  activityDate?: string;
}

// ============================================================
// 差旅赞助（Travel Sponsorship）相关类型定义
// ============================================================

/** 差旅类别 */
export type TravelCategory = 'domestic' | 'international';

/** 社区角色选项（表单信息，非系统角色） */
export type CommunityRole = 'Hero' | 'CommunityBuilder' | 'UGL';

/** 差旅申请状态 */
export type TravelApplicationStatus = 'pending' | 'approved' | 'rejected';

/** 差旅申请记录 */
export interface TravelApplication {
  applicationId: string;
  userId: string;
  applicantNickname: string;
  category: TravelCategory;
  communityRole: CommunityRole;
  eventLink: string;
  cfpScreenshotUrl: string;
  flightCost: number;
  hotelCost: number;
  totalCost: number;
  status: TravelApplicationStatus;
  earnDeducted?: number;
  rejectReason?: string;
  reviewerId?: string;
  reviewerNickname?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 差旅赞助设置 */
export interface TravelSponsorshipSettings {
  travelSponsorshipEnabled: boolean;
  domesticThreshold: number;
  internationalThreshold: number;
}

/** 差旅配额信息 */
export interface TravelQuota {
  speakerEarnTotal: number;
  domesticAvailable: number;
  internationalAvailable: number;
  domesticThreshold: number;
  internationalThreshold: number;
  domesticUsedCount: number;
  internationalUsedCount: number;
}

// ============================================================
// 活动积分追踪（Activity Points Tracking）相关类型定义
// ============================================================

/** UG 记录 */
export interface UGRecord {
  ugId: string;
  name: string;
  status: 'active' | 'inactive';
  leaderId?: string;
  leaderNickname?: string;
  createdAt: string;
  updatedAt: string;
}

/** 活动记录 */
export interface ActivityRecord {
  activityId: string;
  activityType: '线上活动' | '线下活动';
  ugName: string;
  topic: string;
  activityDate: string;
  syncedAt: string;
  sourceUrl: string;
}

// ============================================================
// 积分榜单（Points Leaderboard）相关类型定义
// ============================================================

/** 排行榜项 */
export interface LeaderboardRankingItem {
  rank: number;
  nickname: string;
  roles: string[];
  earnTotal: number;
}

/** 公告栏项 */
export interface LeaderboardAnnouncementItem {
  recordId: string;
  recipientNickname: string;
  amount: number;
  source: string;
  createdAt: string;
  targetRole: string;
  activityUG?: string;
  activityDate?: string;
  activityTopic?: string;
  activityType?: string;
  distributorNickname?: string;
}
