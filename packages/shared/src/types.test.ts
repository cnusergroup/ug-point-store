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
import { ADMIN_ROLES, REGULAR_ROLES, ALL_ROLES, EXCLUSIVE_ROLES, hasAdminAccess, isSuperAdmin, isAdminRole, isOrderAdmin, isExclusiveRole, validateRoleExclusivity, getInviteRoles, isValidContentFileType, isValidVideoUrl, validateTagsArray, normalizeTagName, validateTagName } from './types';
import { ErrorCodes, ErrorHttpStatus, ErrorMessages } from './errors';

describe('shared types', () => {
  it('UserRole type accepts valid roles', () => {
    const roles: UserRole[] = [
      'UserGroupLeader',
      // [DISABLED] CommunityBuilder
      'Speaker',
      'Volunteer',
      'Admin',
      'SuperAdmin',
    ];
    expect(roles).toHaveLength(5);
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

  it('REGULAR_ROLES contains the non-admin roles', () => {
    expect(REGULAR_ROLES).toEqual(['UserGroupLeader', 'Speaker', 'Volunteer']);
  });

  it('ALL_ROLES is the union of REGULAR_ROLES, ADMIN_ROLES, and EXCLUSIVE_ROLES', () => {
    expect(ALL_ROLES).toEqual([...REGULAR_ROLES, ...ADMIN_ROLES, ...EXCLUSIVE_ROLES]);
    expect(ALL_ROLES).toHaveLength(6);
  });
});

describe('OrderAdmin role classification', () => {
  it('OrderAdmin is included in ALL_ROLES', () => {
    expect(ALL_ROLES).toContain('OrderAdmin');
  });

  it('OrderAdmin is NOT included in ADMIN_ROLES', () => {
    expect(ADMIN_ROLES).not.toContain('OrderAdmin');
  });

  it('OrderAdmin is NOT included in REGULAR_ROLES', () => {
    expect(REGULAR_ROLES).not.toContain('OrderAdmin');
  });

  it('OrderAdmin is included in EXCLUSIVE_ROLES', () => {
    expect(EXCLUSIVE_ROLES).toContain('OrderAdmin');
  });

  it('EXCLUSIVE_ROLES contains only OrderAdmin', () => {
    expect(EXCLUSIVE_ROLES).toEqual(['OrderAdmin']);
  });
});

describe('isOrderAdmin', () => {
  it('returns true when roles include OrderAdmin', () => {
    expect(isOrderAdmin(['OrderAdmin'])).toBe(true);
  });

  it('returns false when roles do not include OrderAdmin', () => {
    expect(isOrderAdmin(['Admin', 'Speaker'])).toBe(false);
  });

  it('returns false for empty roles', () => {
    expect(isOrderAdmin([])).toBe(false);
  });

  it('returns true even with other roles present (data edge case)', () => {
    expect(isOrderAdmin(['OrderAdmin', 'Speaker'])).toBe(true);
  });
});

describe('isExclusiveRole', () => {
  it('returns true for OrderAdmin', () => {
    expect(isExclusiveRole('OrderAdmin')).toBe(true);
  });

  it('returns false for Admin', () => {
    expect(isExclusiveRole('Admin')).toBe(false);
  });

  it('returns false for SuperAdmin', () => {
    expect(isExclusiveRole('SuperAdmin')).toBe(false);
  });

  it('returns false for regular roles', () => {
    for (const role of REGULAR_ROLES) {
      expect(isExclusiveRole(role)).toBe(false);
    }
  });
});

describe('validateRoleExclusivity', () => {
  it('returns valid for single OrderAdmin', () => {
    expect(validateRoleExclusivity(['OrderAdmin'])).toEqual({ valid: true });
  });

  it('returns invalid when OrderAdmin combined with other roles', () => {
    const result = validateRoleExclusivity(['OrderAdmin', 'Speaker']);
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  it('returns invalid when OrderAdmin combined with Admin', () => {
    const result = validateRoleExclusivity(['OrderAdmin', 'Admin']);
    expect(result.valid).toBe(false);
  });

  it('returns valid for non-exclusive role combinations', () => {
    expect(validateRoleExclusivity(['Speaker', 'Volunteer'])).toEqual({ valid: true });
    expect(validateRoleExclusivity(['Admin', 'Speaker'])).toEqual({ valid: true });
  });

  it('returns valid for empty roles', () => {
    expect(validateRoleExclusivity([])).toEqual({ valid: true });
  });

  it('returns valid for single non-exclusive role', () => {
    expect(validateRoleExclusivity(['Speaker'])).toEqual({ valid: true });
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

  it('returns false for OrderAdmin', () => {
    expect(isAdminRole('OrderAdmin')).toBe(false);
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
    expect(codes).toHaveLength(97);
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
    expect(ErrorHttpStatus[ErrorCodes.FEATURE_DISABLED]).toBe(403);
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

// Feature: content-tags, Property 1: 标签数组校验正确性
// **Validates: Requirements 1.4, 1.5, 2.1, 2.2, 2.6, 2.8, 3.1, 9.1**
describe('Feature: content-tags, Property 1: 标签数组校验正确性', () => {
  // Generator: random string with length 0~30, may include leading/trailing whitespace
  const tagStringArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 30 }),
    // Whitespace variants: wrap a core string with spaces/tabs
    fc.string({ minLength: 0, maxLength: 26 }).map((s) => `  ${s}  `),
    fc.string({ minLength: 0, maxLength: 28 }).map((s) => ` ${s}`),
    fc.string({ minLength: 0, maxLength: 28 }).map((s) => `${s} `),
    // Pure whitespace
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t'),
  );

  // Generator: random string array with length 0~10
  const tagArrayArb = fc.array(tagStringArb, { minLength: 0, maxLength: 10 });

  it('数组长度 > 5 时返回 TOO_MANY_TAGS', () => {
    fc.assert(
      fc.property(
        fc.array(tagStringArb, { minLength: 6, maxLength: 10 }),
        (tags) => {
          const result = validateTagsArray(tags);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('TOO_MANY_TAGS');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('任一元素规范化后长度不在 2~20 范围时返回 INVALID_TAG_NAME', () => {
    // Generate an array of length 1~5 where at least one element has invalid normalized length
    const invalidTagArb = tagStringArb.filter((s) => {
      const n = normalizeTagName(s);
      return n.length < 2 || n.length > 20;
    });
    const validTagArb = tagStringArb.filter((s) => {
      const n = normalizeTagName(s);
      return n.length >= 2 && n.length <= 20;
    });

    fc.assert(
      fc.property(
        fc.array(validTagArb, { minLength: 0, maxLength: 4 }),
        invalidTagArb,
        fc.nat({ max: 4 }),
        (validTags, invalidTag, insertIdx) => {
          // Insert the invalid tag at a random position
          const idx = Math.min(insertIdx, validTags.length);
          const tags = [...validTags.slice(0, idx), invalidTag, ...validTags.slice(idx)];
          // Ensure total length <= 5 so we don't hit TOO_MANY_TAGS first
          if (tags.length > 5) return; // skip this case
          const result = validateTagsArray(tags);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('INVALID_TAG_NAME');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('存在规范化后重复元素时返回 DUPLICATE_TAG_NAME', () => {
    // Generate a valid tag, then create an array with duplicates (after normalization)
    const validTagArb = tagStringArb.filter((s) => {
      const n = normalizeTagName(s);
      return n.length >= 2 && n.length <= 20;
    });

    fc.assert(
      fc.property(
        validTagArb,
        fc.array(validTagArb, { minLength: 0, maxLength: 3 }),
        (dupTag, otherTags) => {
          // Build array with the duplicate tag appearing at least twice
          // Use case variants to test case-insensitive dedup
          const tags = [dupTag, ...otherTags, dupTag];
          // Ensure no TOO_MANY_TAGS (max 5)
          if (tags.length > 5) return;
          // Ensure the duplicate is actually a duplicate after normalization
          // (it always will be since we use the same string)
          const normalized = tags.map(normalizeTagName);
          const unique = new Set(normalized);
          if (unique.size === normalized.length) return; // skip if somehow no dup
          const result = validateTagsArray(tags);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('DUPLICATE_TAG_NAME');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('全部合法时返回 valid: true 且 normalizedTags 正确', () => {
    // Generate 0~5 unique valid tags (no duplicates after normalization)
    const validTagArb = tagStringArb.filter((s) => {
      const n = normalizeTagName(s);
      return n.length >= 2 && n.length <= 20;
    });

    fc.assert(
      fc.property(
        fc.array(validTagArb, { minLength: 0, maxLength: 5 }),
        (tags) => {
          // Ensure no duplicates after normalization
          const normalized = tags.map(normalizeTagName);
          const unique = new Set(normalized);
          if (unique.size !== normalized.length) return; // skip duplicates

          const result = validateTagsArray(tags);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
          expect(result.normalizedTags).toEqual(normalized);
          // Verify each normalized tag is in valid range
          for (const t of result.normalizedTags) {
            expect(t.length).toBeGreaterThanOrEqual(2);
            expect(t.length).toBeLessThanOrEqual(20);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('对任意随机数组，validateTagsArray 的结果与手动校验一致', () => {
    fc.assert(
      fc.property(
        tagArrayArb,
        (tags) => {
          const result = validateTagsArray(tags);

          // Manual validation logic
          if (tags.length > 5) {
            expect(result.valid).toBe(false);
            expect(result.error).toBe('TOO_MANY_TAGS');
            return;
          }

          const normalized = tags.map(normalizeTagName);
          const hasInvalid = normalized.some((t) => t.length < 2 || t.length > 20);
          if (hasInvalid) {
            expect(result.valid).toBe(false);
            expect(result.error).toBe('INVALID_TAG_NAME');
            return;
          }

          const unique = new Set(normalized);
          if (unique.size !== normalized.length) {
            expect(result.valid).toBe(false);
            expect(result.error).toBe('DUPLICATE_TAG_NAME');
            return;
          }

          expect(result.valid).toBe(true);
          expect(result.normalizedTags).toEqual(normalized);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: content-tags, Property 2: 标签名规范化正确性
// **Validates: Requirements 2.7, 9.2**
describe('Feature: content-tags, Property 2: 标签名规范化正确性', () => {
  // Generator: random strings with leading/trailing whitespace and mixed case
  const stringWithWhitespaceArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.string({ minLength: 0, maxLength: 46 }).map((s) => `  ${s}  `),
    fc.string({ minLength: 0, maxLength: 48 }).map((s) => ` ${s}`),
    fc.string({ minLength: 0, maxLength: 48 }).map((s) => `${s} `),
    fc.string({ minLength: 0, maxLength: 46 }).map((s) => `\t${s}\t`),
    // Mixed case variants
    fc.string({ minLength: 0, maxLength: 50 }).map((s) =>
      s.split('').map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join(''),
    ),
  );

  it('normalizeTagName(s) === s.trim().toLowerCase() 对任意字符串成立', () => {
    fc.assert(
      fc.property(
        stringWithWhitespaceArb,
        (s) => {
          const result = normalizeTagName(s);
          const expected = s.trim().toLowerCase();
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: content-tags, Property 3: 标签名规范化幂等性
// **Validates: Requirements 9.5**
describe('Feature: content-tags, Property 3: 标签名规范化幂等性', () => {
  const arbitraryStringArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.string({ minLength: 0, maxLength: 46 }).map((s) => `  ${s}  `),
    fc.string({ minLength: 0, maxLength: 48 }).map((s) => ` ${s}`),
    fc.string({ minLength: 0, maxLength: 50 }).map((s) =>
      s.split('').map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join(''),
    ),
  );

  it('normalizeTagName(normalizeTagName(s)) === normalizeTagName(s) 对任意字符串成立', () => {
    fc.assert(
      fc.property(
        arbitraryStringArb,
        (s) => {
          const once = normalizeTagName(s);
          const twice = normalizeTagName(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: content-tags, Property 4: 规范化与校验可交换性
// **Validates: Requirements 9.4**
describe('Feature: content-tags, Property 4: 规范化与校验可交换性', () => {
  const arbitraryStringArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.string({ minLength: 0, maxLength: 46 }).map((s) => `  ${s}  `),
    fc.string({ minLength: 0, maxLength: 48 }).map((s) => ` ${s}`),
    fc.string({ minLength: 0, maxLength: 50 }).map((s) =>
      s.split('').map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join(''),
    ),
  );

  it('validateTagName(normalizeTagName(s)) 结果一致，规范化不改变校验结果', () => {
    fc.assert(
      fc.property(
        arbitraryStringArb,
        (s) => {
          const normalized = normalizeTagName(s);
          // Validating the normalized string should be the same whether we
          // pass the original or the normalized version to validateTagName,
          // because validateTagName internally normalizes.
          const validateOriginal = validateTagName(s);
          const validateNormalized = validateTagName(normalized);
          expect(validateOriginal).toBe(validateNormalized);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: order-admin-role, Property 1: 角色互斥不变量（Role exclusivity invariant）
// **Validates: Requirements 10.1, 10.2, 10.3**
describe('Feature: order-admin-role, Property 1: 角色互斥不变量（Role exclusivity invariant）', () => {
  it('含独占角色且长度 > 1 时返回 valid: false', () => {
    fc.assert(
      fc.property(
        // Generate a subarray of ALL_ROLES that contains at least one exclusive role and has length > 1
        fc.subarray(ALL_ROLES, { minLength: 2 }).filter(
          (roles) => roles.some((r) => EXCLUSIVE_ROLES.includes(r)),
        ),
        (roles) => {
          const result = validateRoleExclusivity(roles);
          expect(result.valid).toBe(false);
          expect(result.message).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('含独占角色且长度 === 1 时返回 valid: true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXCLUSIVE_ROLES),
        (exclusiveRole) => {
          const result = validateRoleExclusivity([exclusiveRole]);
          expect(result.valid).toBe(true);
          expect(result.message).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不含独占角色的任意角色组合始终返回 valid: true', () => {
    const nonExclusiveRoles = ALL_ROLES.filter((r) => !EXCLUSIVE_ROLES.includes(r));
    fc.assert(
      fc.property(
        fc.subarray(nonExclusiveRoles, { minLength: 0 }),
        (roles) => {
          const result = validateRoleExclusivity(roles);
          expect(result.valid).toBe(true);
          expect(result.message).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('对任意角色子集，validateRoleExclusivity 行为与手动校验一致', () => {
    fc.assert(
      fc.property(
        fc.subarray(ALL_ROLES, { minLength: 0 }),
        (roles) => {
          const result = validateRoleExclusivity(roles);
          const hasExclusive = roles.some((r) => EXCLUSIVE_ROLES.includes(r));

          if (hasExclusive && roles.length > 1) {
            expect(result.valid).toBe(false);
            expect(result.message).toBeDefined();
          } else {
            expect(result.valid).toBe(true);
            expect(result.message).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
