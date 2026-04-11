import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  UserRole,
  UserProfile,
  Product,
  PointsProduct,
  CodeExclusiveProduct,
  PointsRecord,
  RedemptionRecord,
  CodeInfo,
  ErrorResponse,
  InviteRecord,
} from './types';
import { ADMIN_ROLES, REGULAR_ROLES, ALL_ROLES, hasAdminAccess, isSuperAdmin, isAdminRole, getInviteRoles, isValidContentFileType, isValidVideoUrl } from './types';
import { ErrorCodes, ErrorHttpStatus, ErrorMessages } from './errors';

describe('shared types', () => {
  it('UserRole type accepts valid roles', () => {
    const roles: UserRole[] = [
      'UserGroupLeader',
      'CommunityBuilder',
      'Speaker',
      'Volunteer',
      'Admin',
      'SuperAdmin',
    ];
    expect(roles).toHaveLength(6);
  });

  it('UserProfile interface has correct shape', () => {
    const user: UserProfile = {
      userId: 'u1',
      nickname: 'Test',
      roles: ['Speaker'],
      points: 100,
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(user.userId).toBe('u1');
    expect(user.email).toBeUndefined();
    expect(user.wechatOpenId).toBeUndefined();
  });

  it('PointsProduct extends Product with pointsCost and allowedRoles', () => {
    const product: PointsProduct = {
      productId: 'p1',
      name: 'Test Product',
      description: 'desc',
      imageUrl: 'https://img.example.com/1.png',
      type: 'points',
      status: 'active',
      stock: 10,
      redemptionCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      pointsCost: 50,
      allowedRoles: ['Speaker', 'Volunteer'],
    };
    expect(product.type).toBe('points');
    expect(product.pointsCost).toBe(50);
  });

  it('PointsProduct allowedRoles can be "all"', () => {
    const product: PointsProduct = {
      productId: 'p2',
      name: 'Open Product',
      description: 'desc',
      imageUrl: 'https://img.example.com/2.png',
      type: 'points',
      status: 'active',
      stock: 5,
      redemptionCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      pointsCost: 30,
      allowedRoles: 'all',
    };
    expect(product.allowedRoles).toBe('all');
  });

  it('CodeExclusiveProduct extends Product with eventInfo', () => {
    const product: CodeExclusiveProduct = {
      productId: 'p3',
      name: 'Event Product',
      description: 'desc',
      imageUrl: 'https://img.example.com/3.png',
      type: 'code_exclusive',
      status: 'active',
      stock: 1,
      redemptionCount: 0,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      eventInfo: 'AWS Summit 2024',
    };
    expect(product.type).toBe('code_exclusive');
    expect(product.eventInfo).toBe('AWS Summit 2024');
  });

  it('PointsRecord interface has correct shape', () => {
    const record: PointsRecord = {
      recordId: 'r1',
      userId: 'u1',
      type: 'earn',
      amount: 100,
      source: 'CODE-ABC123',
      balanceAfter: 200,
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(record.type).toBe('earn');
    expect(record.amount).toBe(100);
  });

  it('RedemptionRecord interface has correct shape', () => {
    const record: RedemptionRecord = {
      redemptionId: 'rd1',
      userId: 'u1',
      productId: 'p1',
      productName: 'Test Product',
      method: 'points',
      pointsSpent: 50,
      status: 'success',
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(record.method).toBe('points');
    expect(record.codeUsed).toBeUndefined();
  });

  it('CodeInfo interface has correct shape', () => {
    const code: CodeInfo = {
      codeId: 'c1',
      codeValue: 'ABC-123-XYZ',
      type: 'points',
      pointsValue: 100,
      maxUses: 5,
      currentUses: 2,
      status: 'active',
      usedBy: ['u1', 'u2'],
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(code.type).toBe('points');
    expect(code.usedBy).toHaveLength(2);
    expect(code.productId).toBeUndefined();
  });

  it('ErrorResponse interface has correct shape', () => {
    const err: ErrorResponse = {
      code: 'INVALID_CODE',
      message: '兑换码无效',
    };
    expect(err.code).toBe('INVALID_CODE');
  });
});

describe('role classification constants', () => {
  it('ADMIN_ROLES contains Admin and SuperAdmin', () => {
    expect(ADMIN_ROLES).toEqual(['Admin', 'SuperAdmin']);
  });

  it('REGULAR_ROLES contains the four non-admin roles', () => {
    expect(REGULAR_ROLES).toEqual(['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer']);
  });

  it('ALL_ROLES is the union of REGULAR_ROLES and ADMIN_ROLES', () => {
    expect(ALL_ROLES).toEqual([...REGULAR_ROLES, ...ADMIN_ROLES]);
    expect(ALL_ROLES).toHaveLength(6);
  });
});

describe('isAdminRole', () => {
  it('returns true for Admin', () => {
    expect(isAdminRole('Admin')).toBe(true);
  });

  it('returns true for SuperAdmin', () => {
    expect(isAdminRole('SuperAdmin')).toBe(true);
  });

  it('returns false for regular roles', () => {
    for (const role of REGULAR_ROLES) {
      expect(isAdminRole(role)).toBe(false);
    }
  });
});

describe('hasAdminAccess', () => {
  it('returns true when roles include Admin', () => {
    expect(hasAdminAccess(['Speaker', 'Admin'])).toBe(true);
  });

  it('returns true when roles include SuperAdmin', () => {
    expect(hasAdminAccess(['SuperAdmin'])).toBe(true);
  });

  it('returns false for only regular roles', () => {
    expect(hasAdminAccess(['Speaker', 'Volunteer'])).toBe(false);
  });

  it('returns false for empty roles', () => {
    expect(hasAdminAccess([])).toBe(false);
  });
});

describe('isSuperAdmin', () => {
  it('returns true when roles include SuperAdmin', () => {
    expect(isSuperAdmin(['Admin', 'SuperAdmin'])).toBe(true);
  });

  it('returns false when roles only include Admin', () => {
    expect(isSuperAdmin(['Admin'])).toBe(false);
  });

  it('returns false for empty roles', () => {
    expect(isSuperAdmin([])).toBe(false);
  });
});

describe('error codes', () => {
  it('defines all error codes', () => {
    const codes = Object.keys(ErrorCodes);
    expect(codes).toHaveLength(76);
  });

  it('each error code has a corresponding HTTP status', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(ErrorHttpStatus[code]).toBeDefined();
      expect(typeof ErrorHttpStatus[code]).toBe('number');
    }
  });

  it('each error code has a corresponding message', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(ErrorMessages[code]).toBeDefined();
      expect(typeof ErrorMessages[code]).toBe('string');
    }
  });

  it('400 errors are mapped correctly', () => {
    expect(ErrorHttpStatus[ErrorCodes.INVALID_PASSWORD_FORMAT]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.INVALID_CODE]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.CODE_ALREADY_USED]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.CODE_EXHAUSTED]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.CODE_PRODUCT_MISMATCH]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.CODE_ONLY_PRODUCT]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.INSUFFICIENT_POINTS]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.OUT_OF_STOCK]).toBe(400);
    expect(ErrorHttpStatus[ErrorCodes.INVALID_ROLES]).toBe(400);
  });

  it('401 errors are mapped correctly', () => {
    expect(ErrorHttpStatus[ErrorCodes.TOKEN_EXPIRED]).toBe(401);
    expect(ErrorHttpStatus[ErrorCodes.INVALID_CREDENTIALS]).toBe(401);
  });

  it('403 errors are mapped correctly', () => {
    expect(ErrorHttpStatus[ErrorCodes.NO_REDEMPTION_PERMISSION]).toBe(403);
    expect(ErrorHttpStatus[ErrorCodes.ACCOUNT_LOCKED]).toBe(403);
  });

  it('409 errors are mapped correctly', () => {
    expect(ErrorHttpStatus[ErrorCodes.EMAIL_ALREADY_EXISTS]).toBe(409);
  });
});


// Feature: admin-roles-password, Property 1: 管理员判断逻辑正确性
// **Validates: Requirements 4.1, 4.2, 5.1, 5.2, 5.3, 5.4**
describe('Property 1: 管理员判断逻辑正确性', () => {
  const allRoles = [...REGULAR_ROLES, ...ADMIN_ROLES];

  it('包含管理角色时返回 true，否则返回 false', () => {
    fc.assert(
      fc.property(
        fc.subarray(allRoles, { minLength: 0 }),
        (roles) => {
          const result = hasAdminAccess(roles);
          const expected = roles.some(r => r === 'Admin' || r === 'SuperAdmin');
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('InviteRecord with roles field', () => {
  it('accepts InviteRecord with roles field', () => {
    const record: InviteRecord = {
      token: 'abc123',
      role: 'Speaker',
      roles: ['Speaker', 'Volunteer'],
      status: 'pending',
      createdAt: '2024-01-01T00:00:00Z',
      expiresAt: '2025-01-01T00:00:00Z',
    };
    expect(record.roles).toEqual(['Speaker', 'Volunteer']);
    expect(record.role).toBe('Speaker');
  });

  it('accepts InviteRecord without roles field (backward compat)', () => {
    const record: InviteRecord = {
      token: 'abc123',
      role: 'Volunteer',
      status: 'pending',
      createdAt: '2024-01-01T00:00:00Z',
      expiresAt: '2025-01-01T00:00:00Z',
    };
    expect(record.roles).toBeUndefined();
    expect(record.role).toBe('Volunteer');
  });
});

describe('getInviteRoles', () => {
  it('returns roles when roles array is present and non-empty', () => {
    expect(getInviteRoles({ roles: ['Speaker', 'Volunteer'] })).toEqual(['Speaker', 'Volunteer']);
  });

  it('falls back to [role] when roles is absent', () => {
    expect(getInviteRoles({ role: 'Speaker' })).toEqual(['Speaker']);
  });

  it('falls back to [role] when roles is empty array', () => {
    expect(getInviteRoles({ role: 'Volunteer', roles: [] })).toEqual(['Volunteer']);
  });

  it('prefers roles over role when both present', () => {
    expect(getInviteRoles({ role: 'Speaker', roles: ['Volunteer', 'UserGroupLeader'] }))
      .toEqual(['Volunteer', 'UserGroupLeader']);
  });

  it('returns empty array when neither role nor roles present', () => {
    expect(getInviteRoles({})).toEqual([]);
  });
});

// Feature: invite-multi-role, Property 4: 向后兼容读取（Backward-compatible role extraction）
// **Validates: Requirements 3.2**
describe('Feature: invite-multi-role, Property 4: 向后兼容读取（Backward-compatible role extraction）', () => {
  it('getInviteRoles({ role: r }) returns [r] for any single UserRole', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REGULAR_ROLES),
        (r) => {
          const result = getInviteRoles({ role: r });
          expect(result).toEqual([r]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('getInviteRoles({ roles: rs }) returns rs for any non-empty UserRole[]', () => {
    fc.assert(
      fc.property(
        fc.subarray(REGULAR_ROLES, { minLength: 1 }),
        (rs) => {
          const result = getInviteRoles({ roles: rs });
          expect(result).toEqual(rs);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('roles takes priority over role when both are present', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REGULAR_ROLES),
        fc.subarray(REGULAR_ROLES, { minLength: 1 }),
        (r, rs) => {
          const result = getInviteRoles({ role: r, roles: rs });
          expect(result).toEqual(rs);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: content-hub, Property 1: 文档格式校验正确性
// **Validates: Requirements 1.4**
describe('Feature: content-hub, Property 1: 文档格式校验正确性', () => {
  const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  it('不属于 5 种允许类型的 MIME 类型应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => !ALLOWED_MIME_TYPES.includes(s)),
        (mimeType) => {
          expect(isValidContentFileType(mimeType)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('属于 5 种允许类型的 MIME 类型应通过校验', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_MIME_TYPES),
        (mimeType) => {
          expect(isValidContentFileType(mimeType)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: content-hub, Property 2: 视频 URL 格式校验正确性
// **Validates: Requirements 1.6**
describe('Feature: content-hub, Property 2: 视频 URL 格式校验正确性', () => {
  it('非法 URL 字符串应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => {
          try { new URL(s); return false; } catch { return true; }
        }),
        (invalidUrl) => {
          expect(isValidVideoUrl(invalidUrl)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('合法的 http/https URL 应通过校验', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        (validUrl) => {
          expect(isValidVideoUrl(validUrl)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('非 http/https 协议的合法 URL 应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ftp', 'file', 'data', 'javascript', 'mailto'),
        fc.webUrl().map(u => {
          const parsed = new URL(u);
          return u; // just need the host part
        }),
        (protocol, webUrl) => {
          const parsed = new URL(webUrl);
          const nonHttpUrl = `${protocol}://${parsed.host}${parsed.pathname}`;
          expect(isValidVideoUrl(nonHttpUrl)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
