// ============================================================
// 错误码常量定义 - 积分商城系统（Points Mall）
// ============================================================

export const ErrorCodes = {
  /** 密码不符合规则 (400) - 需求 1.7 */
  INVALID_PASSWORD_FORMAT: 'INVALID_PASSWORD_FORMAT',
  /** 兑换码无效或不存在 (400) - 需求 4.3 */
  INVALID_CODE: 'INVALID_CODE',
  /** 兑换码已被当前用户使用 (400) - 需求 4.4 */
  CODE_ALREADY_USED: 'CODE_ALREADY_USED',
  /** 兑换码已达使用上限 (400) - 需求 4.5 */
  CODE_EXHAUSTED: 'CODE_EXHAUSTED',
  /** 兑换码与商品不匹配 (400) - 需求 7.3 */
  CODE_PRODUCT_MISMATCH: 'CODE_PRODUCT_MISMATCH',
  /** 该商品仅支持 Code 兑换 (400) - 需求 7.4 */
  CODE_ONLY_PRODUCT: 'CODE_ONLY_PRODUCT',
  /** 积分不足 (400) - 需求 6.4 */
  INSUFFICIENT_POINTS: 'INSUFFICIENT_POINTS',
  /** 商品库存不足 (400) - 需求 6.6 */
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  /** Token 已过期 (401) - 需求 1.10 */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** 邮箱或密码错误 (401) - 需求 1.2 */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 无兑换权限 (403) - 需求 6.5 */
  NO_REDEMPTION_PERMISSION: 'NO_REDEMPTION_PERMISSION',
  /** 账号已锁定 (403) - 需求 1.8 */
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  /** 邮箱已被注册 (409) - 需求 1.6 */
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  /** 当前密码错误 (400) - 需求 6.3 */
  INVALID_CURRENT_PASSWORD: 'INVALID_CURRENT_PASSWORD',
  /** 重置链接已过期 (400) - 需求 8.4 */
  RESET_TOKEN_EXPIRED: 'RESET_TOKEN_EXPIRED',
  /** 重置链接无效 (400) - 需求 8.5 */
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  /** 禁止通过 API 分配 SuperAdmin 角色 (403) - 需求 2.1 */
  SUPERADMIN_ASSIGN_FORBIDDEN: 'SUPERADMIN_ASSIGN_FORBIDDEN',
  /** 仅 SuperAdmin 可分配/撤销管理角色 (403) - 需求 3.3 */
  ADMIN_ROLE_REQUIRES_SUPERADMIN: 'ADMIN_ROLE_REQUIRES_SUPERADMIN',
  /** 需要管理员权限 (403) - 需求 4.2 */
  FORBIDDEN: 'FORBIDDEN',
  /** Code 专属商品不支持加入购物车 (400) - 需求 1.3 */
  CODE_PRODUCT_NOT_CARTABLE: 'CODE_PRODUCT_NOT_CARTABLE',
  /** 商品已下架或库存为零 (400) - 需求 1.4 */
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  /** 购物车已满（20 种上限） (400) - 需求 1.5 */
  CART_FULL: 'CART_FULL',
  /** 手机号格式错误 (400) - 需求 3.3 */
  INVALID_PHONE: 'INVALID_PHONE',
  /** 收件人姓名格式错误 (400) - 需求 3.4 */
  INVALID_RECIPIENT_NAME: 'INVALID_RECIPIENT_NAME',
  /** 详细地址格式错误 (400) - 需求 3.5 */
  INVALID_DETAIL_ADDRESS: 'INVALID_DETAIL_ADDRESS',
  /** 收货地址数量已达上限（10 个） (400) - 需求 3.9 */
  ADDRESS_LIMIT_REACHED: 'ADDRESS_LIMIT_REACHED',
  /** 收货地址不存在 (400) - 需求 4.10 */
  ADDRESS_NOT_FOUND: 'ADDRESS_NOT_FOUND',
  /** 请选择收货地址 (400) - 需求 4.10 */
  NO_ADDRESS_SELECTED: 'NO_ADDRESS_SELECTED',
  /** 物流状态不可回退 (400) - 需求 7.5 */
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  /** 发货时需填写物流单号 (400) - 需求 7.6 */
  TRACKING_NUMBER_REQUIRED: 'TRACKING_NUMBER_REQUIRED',
  /** 订单不存在 (404) - 需求 5.4 */
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  /** 购物车项不存在 (404) - 需求 2.4 */
  CART_ITEM_NOT_FOUND: 'CART_ITEM_NOT_FOUND',
  /** 图片数量已达上限 (400) - 需求 1.4 */
  IMAGE_LIMIT_EXCEEDED: 'IMAGE_LIMIT_EXCEEDED',
  /** 不支持的文件类型 (400) - 需求 1.4 */
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  /** 图片不存在 (404) - 需求 1.6 */
  IMAGE_NOT_FOUND: 'IMAGE_NOT_FOUND',
  /** 请至少添加一个尺码 (400) - 需求 3.5 */
  SIZE_OPTIONS_REQUIRED: 'SIZE_OPTIONS_REQUIRED',
  /** 尺码名称不能重复 (400) - 需求 3.6 */
  DUPLICATE_SIZE_NAME: 'DUPLICATE_SIZE_NAME',
  /** 请选择尺码 (400) - 需求 4.4 */
  SIZE_REQUIRED: 'SIZE_REQUIRED',
  /** 所选尺码不存在 (400) - 需求 4.4 */
  SIZE_NOT_FOUND: 'SIZE_NOT_FOUND',
  /** 所选尺码库存不足 (400) - 需求 4.4 */
  SIZE_OUT_OF_STOCK: 'SIZE_OUT_OF_STOCK',
  /** 限购数量无效 (400) - 需求 5.4 */
  PURCHASE_LIMIT_INVALID: 'PURCHASE_LIMIT_INVALID',
  /** 超出限购数量 (400) - 需求 6.3, 6.6 */
  PURCHASE_LIMIT_EXCEEDED: 'PURCHASE_LIMIT_EXCEEDED',
  /** 邀请链接无效或不存在 (400) - 需求 2.2 */
  INVITE_TOKEN_INVALID: 'INVITE_TOKEN_INVALID',
  /** 邀请链接已被使用 (400) - 需求 2.3 */
  INVITE_TOKEN_USED: 'INVITE_TOKEN_USED',
  /** 邀请链接已过期 (400) - 需求 2.4 */
  INVITE_TOKEN_EXPIRED: 'INVITE_TOKEN_EXPIRED',
  /** 邀请记录不存在 (404) - 需求 4.3 */
  INVITE_NOT_FOUND: 'INVITE_NOT_FOUND',
  /** 该邀请无法撤销（非 pending 状态）(400) - 需求 4.3 */
  INVITE_NOT_REVOCABLE: 'INVITE_NOT_REVOCABLE',
  /** 用户不存在 (404) - 需求 2.4, 3.3 */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  /** 禁止停用 SuperAdmin 用户 (403) - 需求 2.5 */
  CANNOT_DISABLE_SUPERADMIN: 'CANNOT_DISABLE_SUPERADMIN',
  /** 仅 SuperAdmin 可操作管理员 (403) - 需求 2.6, 3.5 */
  ONLY_SUPERADMIN_CAN_MANAGE_ADMIN: 'ONLY_SUPERADMIN_CAN_MANAGE_ADMIN',
  /** 禁止删除 SuperAdmin 用户 (403) - 需求 3.4 */
  CANNOT_DELETE_SUPERADMIN: 'CANNOT_DELETE_SUPERADMIN',
  /** 禁止删除自身账号 (403) - 需求 3.6 */
  CANNOT_DELETE_SELF: 'CANNOT_DELETE_SELF',
  /** 账号已停用 (403) - 需求 2.7 */
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** 当前角色无法申请积分 (403) - 需求 1.2 */
  CLAIM_ROLE_NOT_ALLOWED: 'CLAIM_ROLE_NOT_ALLOWED',
  /** 申请内容格式无效 (400) - 需求 1.4 */
  INVALID_CLAIM_CONTENT: 'INVALID_CLAIM_CONTENT',
  /** 图片数量超出上限（最多 5 张）(400) - 需求 1.6 */
  CLAIM_IMAGE_LIMIT_EXCEEDED: 'CLAIM_IMAGE_LIMIT_EXCEEDED',
  /** 活动链接格式无效 (400) - 需求 1.7 */
  INVALID_ACTIVITY_URL: 'INVALID_ACTIVITY_URL',
  /** 积分申请不存在 (404) - 需求 3.7 */
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  /** 该申请已被审批 (400) - 需求 3.7 */
  CLAIM_ALREADY_REVIEWED: 'CLAIM_ALREADY_REVIEWED',
  /** 积分数值无效（1~10000）(400) - 需求 3.4 */
  INVALID_POINTS_AMOUNT: 'INVALID_POINTS_AMOUNT',
  /** 驳回原因格式无效 (400) - 需求 3.6 */
  INVALID_REJECT_REASON: 'INVALID_REJECT_REASON',
} as const;

/** 错误码类型 */
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/** 错误码对应的 HTTP 状态码映射 */
export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCodes.INVALID_PASSWORD_FORMAT]: 400,
  [ErrorCodes.INVALID_CODE]: 400,
  [ErrorCodes.CODE_ALREADY_USED]: 400,
  [ErrorCodes.CODE_EXHAUSTED]: 400,
  [ErrorCodes.CODE_PRODUCT_MISMATCH]: 400,
  [ErrorCodes.CODE_ONLY_PRODUCT]: 400,
  [ErrorCodes.INSUFFICIENT_POINTS]: 400,
  [ErrorCodes.OUT_OF_STOCK]: 400,
  [ErrorCodes.TOKEN_EXPIRED]: 401,
  [ErrorCodes.INVALID_CREDENTIALS]: 401,
  [ErrorCodes.NO_REDEMPTION_PERMISSION]: 403,
  [ErrorCodes.ACCOUNT_LOCKED]: 403,
  [ErrorCodes.EMAIL_ALREADY_EXISTS]: 409,
  [ErrorCodes.INVALID_CURRENT_PASSWORD]: 400,
  [ErrorCodes.RESET_TOKEN_EXPIRED]: 400,
  [ErrorCodes.RESET_TOKEN_INVALID]: 400,
  [ErrorCodes.SUPERADMIN_ASSIGN_FORBIDDEN]: 403,
  [ErrorCodes.ADMIN_ROLE_REQUIRES_SUPERADMIN]: 403,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.CODE_PRODUCT_NOT_CARTABLE]: 400,
  [ErrorCodes.PRODUCT_UNAVAILABLE]: 400,
  [ErrorCodes.CART_FULL]: 400,
  [ErrorCodes.INVALID_PHONE]: 400,
  [ErrorCodes.INVALID_RECIPIENT_NAME]: 400,
  [ErrorCodes.INVALID_DETAIL_ADDRESS]: 400,
  [ErrorCodes.ADDRESS_LIMIT_REACHED]: 400,
  [ErrorCodes.ADDRESS_NOT_FOUND]: 400,
  [ErrorCodes.NO_ADDRESS_SELECTED]: 400,
  [ErrorCodes.INVALID_STATUS_TRANSITION]: 400,
  [ErrorCodes.TRACKING_NUMBER_REQUIRED]: 400,
  [ErrorCodes.ORDER_NOT_FOUND]: 404,
  [ErrorCodes.CART_ITEM_NOT_FOUND]: 404,
  [ErrorCodes.IMAGE_LIMIT_EXCEEDED]: 400,
  [ErrorCodes.INVALID_FILE_TYPE]: 400,
  [ErrorCodes.IMAGE_NOT_FOUND]: 404,
  [ErrorCodes.SIZE_OPTIONS_REQUIRED]: 400,
  [ErrorCodes.DUPLICATE_SIZE_NAME]: 400,
  [ErrorCodes.SIZE_REQUIRED]: 400,
  [ErrorCodes.SIZE_NOT_FOUND]: 400,
  [ErrorCodes.SIZE_OUT_OF_STOCK]: 400,
  [ErrorCodes.PURCHASE_LIMIT_INVALID]: 400,
  [ErrorCodes.PURCHASE_LIMIT_EXCEEDED]: 400,
  [ErrorCodes.INVITE_TOKEN_INVALID]: 400,
  [ErrorCodes.INVITE_TOKEN_USED]: 400,
  [ErrorCodes.INVITE_TOKEN_EXPIRED]: 400,
  [ErrorCodes.INVITE_NOT_FOUND]: 404,
  [ErrorCodes.INVITE_NOT_REVOCABLE]: 400,
  [ErrorCodes.USER_NOT_FOUND]: 404,
  [ErrorCodes.CANNOT_DISABLE_SUPERADMIN]: 403,
  [ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ADMIN]: 403,
  [ErrorCodes.CANNOT_DELETE_SUPERADMIN]: 403,
  [ErrorCodes.CANNOT_DELETE_SELF]: 403,
  [ErrorCodes.ACCOUNT_DISABLED]: 403,
  [ErrorCodes.CLAIM_ROLE_NOT_ALLOWED]: 403,
  [ErrorCodes.INVALID_CLAIM_CONTENT]: 400,
  [ErrorCodes.CLAIM_IMAGE_LIMIT_EXCEEDED]: 400,
  [ErrorCodes.INVALID_ACTIVITY_URL]: 400,
  [ErrorCodes.CLAIM_NOT_FOUND]: 404,
  [ErrorCodes.CLAIM_ALREADY_REVIEWED]: 400,
  [ErrorCodes.INVALID_POINTS_AMOUNT]: 400,
  [ErrorCodes.INVALID_REJECT_REASON]: 400,
};

/** 错误码对应的默认错误消息 */
export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCodes.INVALID_PASSWORD_FORMAT]: '密码不符合规则（至少8位，包含字母和数字）',
  [ErrorCodes.INVALID_CODE]: '兑换码无效或不存在',
  [ErrorCodes.CODE_ALREADY_USED]: '兑换码已被使用',
  [ErrorCodes.CODE_EXHAUSTED]: '兑换码已达使用上限',
  [ErrorCodes.CODE_PRODUCT_MISMATCH]: '兑换码与商品不匹配',
  [ErrorCodes.CODE_ONLY_PRODUCT]: '该商品仅支持 Code 兑换',
  [ErrorCodes.INSUFFICIENT_POINTS]: '积分不足',
  [ErrorCodes.OUT_OF_STOCK]: '商品库存不足',
  [ErrorCodes.TOKEN_EXPIRED]: '访问令牌已过期，请重新登录',
  [ErrorCodes.INVALID_CREDENTIALS]: '邮箱或密码错误',
  [ErrorCodes.NO_REDEMPTION_PERMISSION]: '无兑换权限（身份不匹配）',
  [ErrorCodes.ACCOUNT_LOCKED]: '账号已锁定，请稍后再试',
  [ErrorCodes.EMAIL_ALREADY_EXISTS]: '邮箱已被注册',
  [ErrorCodes.INVALID_CURRENT_PASSWORD]: '当前密码错误',
  [ErrorCodes.RESET_TOKEN_EXPIRED]: '重置链接已过期，请重新申请',
  [ErrorCodes.RESET_TOKEN_INVALID]: '重置链接无效或已被使用',
  [ErrorCodes.SUPERADMIN_ASSIGN_FORBIDDEN]: '禁止通过 API 分配 SuperAdmin 角色',
  [ErrorCodes.ADMIN_ROLE_REQUIRES_SUPERADMIN]: '仅 SuperAdmin 可分配或撤销管理角色',
  [ErrorCodes.FORBIDDEN]: '需要管理员权限',
  [ErrorCodes.CODE_PRODUCT_NOT_CARTABLE]: 'Code 专属商品不支持加入购物车',
  [ErrorCodes.PRODUCT_UNAVAILABLE]: '商品已下架或库存为零',
  [ErrorCodes.CART_FULL]: '购物车已满（20 种上限）',
  [ErrorCodes.INVALID_PHONE]: '手机号格式错误',
  [ErrorCodes.INVALID_RECIPIENT_NAME]: '收件人姓名格式错误',
  [ErrorCodes.INVALID_DETAIL_ADDRESS]: '详细地址格式错误',
  [ErrorCodes.ADDRESS_LIMIT_REACHED]: '收货地址数量已达上限',
  [ErrorCodes.ADDRESS_NOT_FOUND]: '收货地址不存在',
  [ErrorCodes.NO_ADDRESS_SELECTED]: '请选择收货地址',
  [ErrorCodes.INVALID_STATUS_TRANSITION]: '物流状态不可回退',
  [ErrorCodes.TRACKING_NUMBER_REQUIRED]: '发货时需填写物流单号',
  [ErrorCodes.ORDER_NOT_FOUND]: '订单不存在',
  [ErrorCodes.CART_ITEM_NOT_FOUND]: '购物车项不存在',
  [ErrorCodes.IMAGE_LIMIT_EXCEEDED]: '图片数量已达上限（最多 5 张）',
  [ErrorCodes.INVALID_FILE_TYPE]: '不支持的文件类型',
  [ErrorCodes.IMAGE_NOT_FOUND]: '图片不存在',
  [ErrorCodes.SIZE_OPTIONS_REQUIRED]: '请至少添加一个尺码',
  [ErrorCodes.DUPLICATE_SIZE_NAME]: '尺码名称不能重复',
  [ErrorCodes.SIZE_REQUIRED]: '请选择尺码',
  [ErrorCodes.SIZE_NOT_FOUND]: '所选尺码不存在',
  [ErrorCodes.SIZE_OUT_OF_STOCK]: '所选尺码库存不足',
  [ErrorCodes.PURCHASE_LIMIT_INVALID]: '请设置有效的限购数量（至少为 1）',
  [ErrorCodes.PURCHASE_LIMIT_EXCEEDED]: '超出限购数量',
  [ErrorCodes.INVITE_TOKEN_INVALID]: '邀请链接无效或不存在',
  [ErrorCodes.INVITE_TOKEN_USED]: '邀请链接已被使用',
  [ErrorCodes.INVITE_TOKEN_EXPIRED]: '邀请链接已过期',
  [ErrorCodes.INVITE_NOT_FOUND]: '邀请记录不存在',
  [ErrorCodes.INVITE_NOT_REVOCABLE]: '该邀请无法撤销（非 pending 状态）',
  [ErrorCodes.USER_NOT_FOUND]: '用户不存在',
  [ErrorCodes.CANNOT_DISABLE_SUPERADMIN]: '禁止停用 SuperAdmin 用户',
  [ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ADMIN]: '仅 SuperAdmin 可操作管理员',
  [ErrorCodes.CANNOT_DELETE_SUPERADMIN]: '禁止删除 SuperAdmin 用户',
  [ErrorCodes.CANNOT_DELETE_SELF]: '禁止删除自身账号',
  [ErrorCodes.ACCOUNT_DISABLED]: '账号已停用',
  [ErrorCodes.CLAIM_ROLE_NOT_ALLOWED]: '当前角色无法申请积分',
  [ErrorCodes.INVALID_CLAIM_CONTENT]: '申请内容格式无效',
  [ErrorCodes.CLAIM_IMAGE_LIMIT_EXCEEDED]: '图片数量超出上限（最多 5 张）',
  [ErrorCodes.INVALID_ACTIVITY_URL]: '活动链接格式无效',
  [ErrorCodes.CLAIM_NOT_FOUND]: '积分申请不存在',
  [ErrorCodes.CLAIM_ALREADY_REVIEWED]: '该申请已被审批',
  [ErrorCodes.INVALID_POINTS_AMOUNT]: '积分数值无效（1~10000）',
  [ErrorCodes.INVALID_REJECT_REASON]: '驳回原因格式无效',
};
