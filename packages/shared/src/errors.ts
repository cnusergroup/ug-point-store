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
  /** 数量超过库存 (400) - 需求 3.2, 6.2 */
  QUANTITY_EXCEEDS_STOCK: 'QUANTITY_EXCEEDS_STOCK',
  /** 数量必须为正整数 (400) - 需求 2.3 */
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  /** 请至少选择一个角色 (400) - 需求 2.2 */
  INVALID_ROLES: 'INVALID_ROLES',
  /** 不支持的文档格式，仅支持 PPT/PPTX/PDF/DOC/DOCX (400) - 需求 1.4 */
  INVALID_CONTENT_FILE_TYPE: 'INVALID_CONTENT_FILE_TYPE',
  /** 文档文件大小超过 50MB 上限 (400) - 需求 1.5 */
  CONTENT_FILE_TOO_LARGE: 'CONTENT_FILE_TOO_LARGE',
  /** 视频链接格式无效 (400) - 需求 1.6 */
  INVALID_VIDEO_URL: 'INVALID_VIDEO_URL',
  /** 内容标题格式无效（1~100 字符）(400) - 需求 1.2 */
  INVALID_CONTENT_TITLE: 'INVALID_CONTENT_TITLE',
  /** 内容描述格式无效（1~2000 字符）(400) - 需求 1.2 */
  INVALID_CONTENT_DESCRIPTION: 'INVALID_CONTENT_DESCRIPTION',
  /** 内容不存在 (404) - 需求 4.1 */
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  /** 分类不存在 (404) - 需求 3.2 */
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  /** 该内容已被审核 (400) - 需求 2.3 */
  CONTENT_ALREADY_REVIEWED: 'CONTENT_ALREADY_REVIEWED',
  /** 评论内容无效（1~500 字符）(400) - 需求 7.3, 7.4 */
  INVALID_COMMENT_CONTENT: 'INVALID_COMMENT_CONTENT',
  /** 需先完成使用预约才能下载 (400) - 需求 5.2 */
  RESERVATION_REQUIRED: 'RESERVATION_REQUIRED',
  /** 仅 SuperAdmin 可审核内容 (403) - 需求 2.1 */
  CONTENT_REVIEW_FORBIDDEN: 'CONTENT_REVIEW_FORBIDDEN',
  /** 该内容已被预约使用，不允许编辑 (400) - 需求 1.4 */
  CONTENT_NOT_EDITABLE: 'CONTENT_NOT_EDITABLE',
  /** 该功能当前未开放 (403) - 需求 4.1, 4.2 */
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  /** 累计获得积分不足，无法申请差旅赞助 (400) - 需求 4.7 */
  INSUFFICIENT_EARN_QUOTA: 'INSUFFICIENT_EARN_QUOTA',
  /** 差旅申请不存在 (404) - 需求 5.5 */
  APPLICATION_NOT_FOUND: 'APPLICATION_NOT_FOUND',
  /** 该申请已被审批 (400) - 需求 7.3 */
  APPLICATION_ALREADY_REVIEWED: 'APPLICATION_ALREADY_REVIEWED',
  /** 仅被驳回的申请可以编辑重新提交 (400) - 需求 3.5 */
  INVALID_APPLICATION_STATUS: 'INVALID_APPLICATION_STATUS',
  /** 仅 Speaker 角色可访问差旅赞助 (403) - 需求 3.5 */
  TRAVEL_SPEAKER_ONLY: 'TRAVEL_SPEAKER_ONLY',
  /** 标签名无效（需 2~20 字符，不能为纯空白）(400) - 需求 2.1 */
  INVALID_TAG_NAME: 'INVALID_TAG_NAME',
  /** 标签数量超过上限（最多 5 个）(400) - 需求 2.2 */
  TOO_MANY_TAGS: 'TOO_MANY_TAGS',
  /** 标签名重复 (400) - 需求 2.8 */
  DUPLICATE_TAG_NAME: 'DUPLICATE_TAG_NAME',
  /** 不能将标签合并到自身 (400) - 需求 7.7 */
  TAG_MERGE_SELF_ERROR: 'TAG_MERGE_SELF_ERROR',
  /** 标签不存在 (404) - 需求 7.8 */
  TAG_NOT_FOUND: 'TAG_NOT_FOUND',
  /** 转让目标用户不是管理员 (400) - 需求 3.5 */
  TRANSFER_TARGET_NOT_ADMIN: 'TRANSFER_TARGET_NOT_ADMIN',
  /** 转让目标用户不存在 (404) - 需求 3.5 */
  TRANSFER_TARGET_NOT_FOUND: 'TRANSFER_TARGET_NOT_FOUND',
  /** 转让目标不能是自身 (400) - 需求 2.5 */
  TRANSFER_TARGET_IS_SELF: 'TRANSFER_TARGET_IS_SELF',
  /** 邀请有效期值无效（必须为 1、3 或 7）(400) - 需求 5.5 */
  INVALID_EXPIRY_VALUE: 'INVALID_EXPIRY_VALUE',
  /** 独占角色不能与其他角色共存 (400) - 需求 10.3 */
  EXCLUSIVE_ROLE_CONFLICT: 'EXCLUSIVE_ROLE_CONFLICT',
  /** 仅 SuperAdmin 可分配 OrderAdmin 角色 (403) - 需求 10.3 */
  ORDER_ADMIN_REQUIRES_SUPERADMIN: 'ORDER_ADMIN_REQUIRES_SUPERADMIN',
  /** 仅 SuperAdmin 可管理 OrderAdmin 用户 (403) - 需求 9.2 */
  ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN: 'ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN',
  /** 同一 Speaker 已预约过该活动 (409) - 需求 4.2 */
  DUPLICATE_ACTIVITY_RESERVATION: 'DUPLICATE_ACTIVITY_RESERVATION',
  /** 该预约已被审批 (409) - 需求 7.6 */
  RESERVATION_ALREADY_REVIEWED: 'RESERVATION_ALREADY_REVIEWED',
  /** 关联活动不存在 (404) - 需求 12.5 */
  ACTIVITY_NOT_FOUND: 'ACTIVITY_NOT_FOUND',
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
  [ErrorCodes.QUANTITY_EXCEEDS_STOCK]: 400,
  [ErrorCodes.INVALID_QUANTITY]: 400,
  [ErrorCodes.INVALID_ROLES]: 400,
  [ErrorCodes.INVALID_CONTENT_FILE_TYPE]: 400,
  [ErrorCodes.CONTENT_FILE_TOO_LARGE]: 400,
  [ErrorCodes.INVALID_VIDEO_URL]: 400,
  [ErrorCodes.INVALID_CONTENT_TITLE]: 400,
  [ErrorCodes.INVALID_CONTENT_DESCRIPTION]: 400,
  [ErrorCodes.CONTENT_NOT_FOUND]: 404,
  [ErrorCodes.CATEGORY_NOT_FOUND]: 404,
  [ErrorCodes.CONTENT_ALREADY_REVIEWED]: 400,
  [ErrorCodes.INVALID_COMMENT_CONTENT]: 400,
  [ErrorCodes.RESERVATION_REQUIRED]: 400,
  [ErrorCodes.CONTENT_REVIEW_FORBIDDEN]: 403,
  [ErrorCodes.CONTENT_NOT_EDITABLE]: 400,
  [ErrorCodes.FEATURE_DISABLED]: 403,
  [ErrorCodes.INSUFFICIENT_EARN_QUOTA]: 400,
  [ErrorCodes.APPLICATION_NOT_FOUND]: 404,
  [ErrorCodes.APPLICATION_ALREADY_REVIEWED]: 400,
  [ErrorCodes.INVALID_APPLICATION_STATUS]: 400,
  [ErrorCodes.TRAVEL_SPEAKER_ONLY]: 403,
  [ErrorCodes.INVALID_TAG_NAME]: 400,
  [ErrorCodes.TOO_MANY_TAGS]: 400,
  [ErrorCodes.DUPLICATE_TAG_NAME]: 400,
  [ErrorCodes.TAG_MERGE_SELF_ERROR]: 400,
  [ErrorCodes.TAG_NOT_FOUND]: 404,
  [ErrorCodes.TRANSFER_TARGET_NOT_ADMIN]: 400,
  [ErrorCodes.TRANSFER_TARGET_NOT_FOUND]: 404,
  [ErrorCodes.TRANSFER_TARGET_IS_SELF]: 400,
  [ErrorCodes.INVALID_EXPIRY_VALUE]: 400,
  [ErrorCodes.EXCLUSIVE_ROLE_CONFLICT]: 400,
  [ErrorCodes.ORDER_ADMIN_REQUIRES_SUPERADMIN]: 403,
  [ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN]: 403,
  [ErrorCodes.DUPLICATE_ACTIVITY_RESERVATION]: 409,
  [ErrorCodes.RESERVATION_ALREADY_REVIEWED]: 409,
  [ErrorCodes.ACTIVITY_NOT_FOUND]: 404,
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
  [ErrorCodes.QUANTITY_EXCEEDS_STOCK]: '数量超过库存',
  [ErrorCodes.INVALID_QUANTITY]: '数量必须为正整数',
  [ErrorCodes.INVALID_ROLES]: '请至少选择一个角色',
  [ErrorCodes.INVALID_CONTENT_FILE_TYPE]: '不支持的文档格式，仅支持 PPT/PPTX/PDF/DOC/DOCX',
  [ErrorCodes.CONTENT_FILE_TOO_LARGE]: '文档文件大小超过 50MB 上限',
  [ErrorCodes.INVALID_VIDEO_URL]: '视频链接格式无效',
  [ErrorCodes.INVALID_CONTENT_TITLE]: '内容标题格式无效（1~100 字符）',
  [ErrorCodes.INVALID_CONTENT_DESCRIPTION]: '内容描述格式无效（1~2000 字符）',
  [ErrorCodes.CONTENT_NOT_FOUND]: '内容不存在',
  [ErrorCodes.CATEGORY_NOT_FOUND]: '分类不存在',
  [ErrorCodes.CONTENT_ALREADY_REVIEWED]: '该内容已被审核',
  [ErrorCodes.INVALID_COMMENT_CONTENT]: '评论内容无效（1~500 字符）',
  [ErrorCodes.RESERVATION_REQUIRED]: '需先完成使用预约才能下载',
  [ErrorCodes.CONTENT_REVIEW_FORBIDDEN]: '仅 SuperAdmin 可审核内容',
  [ErrorCodes.CONTENT_NOT_EDITABLE]: '该内容已被预约使用，不允许编辑',
  [ErrorCodes.FEATURE_DISABLED]: '该功能当前未开放',
  [ErrorCodes.INSUFFICIENT_EARN_QUOTA]: '累计获得积分不足，无法申请差旅赞助',
  [ErrorCodes.APPLICATION_NOT_FOUND]: '差旅申请不存在',
  [ErrorCodes.APPLICATION_ALREADY_REVIEWED]: '该申请已被审批',
  [ErrorCodes.INVALID_APPLICATION_STATUS]: '仅被驳回的申请可以编辑重新提交',
  [ErrorCodes.TRAVEL_SPEAKER_ONLY]: '仅 Speaker 角色可访问差旅赞助',
  [ErrorCodes.INVALID_TAG_NAME]: '标签名无效（需 2~20 字符，不能为纯空白）',
  [ErrorCodes.TOO_MANY_TAGS]: '标签数量超过上限（最多 5 个）',
  [ErrorCodes.DUPLICATE_TAG_NAME]: '标签名重复',
  [ErrorCodes.TAG_MERGE_SELF_ERROR]: '不能将标签合并到自身',
  [ErrorCodes.TAG_NOT_FOUND]: '标签不存在',
  [ErrorCodes.TRANSFER_TARGET_NOT_ADMIN]: '转让目标用户不是管理员',
  [ErrorCodes.TRANSFER_TARGET_NOT_FOUND]: '转让目标用户不存在',
  [ErrorCodes.TRANSFER_TARGET_IS_SELF]: '转让目标不能是自身',
  [ErrorCodes.INVALID_EXPIRY_VALUE]: '邀请有效期值无效（必须为 1、3 或 7）',
  [ErrorCodes.EXCLUSIVE_ROLE_CONFLICT]: '独占角色不能与其他角色共存',
  [ErrorCodes.ORDER_ADMIN_REQUIRES_SUPERADMIN]: '仅 SuperAdmin 可分配 OrderAdmin 角色',
  [ErrorCodes.ONLY_SUPERADMIN_CAN_MANAGE_ORDER_ADMIN]: '仅 SuperAdmin 可管理 OrderAdmin 用户',
  [ErrorCodes.DUPLICATE_ACTIVITY_RESERVATION]: '您已预约过该活动',
  [ErrorCodes.RESERVATION_ALREADY_REVIEWED]: '该预约已被审批',
  [ErrorCodes.ACTIVITY_NOT_FOUND]: '关联活动不存在',
};
