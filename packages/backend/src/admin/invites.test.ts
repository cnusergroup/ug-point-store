import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { UserRole } from '@points-mall/shared';
import { ErrorCodes } from '@points-mall/shared';

// Mock the auth/invite module
const mockBatchCreateInvites = vi.fn();
vi.mock('../auth/invite', () => ({
  batchCreateInvites: (...args: any[]) => mockBatchCreateInvites(...args),
}));

import { batchGenerateInvites } from './invites';

const mockDynamoClient = {} as DynamoDBDocumentClient;
const INVITES_TABLE = 'test-invites-table';
const REGISTER_BASE_URL = 'https://example.com/register';

describe('batchGenerateInvites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 2.2
   * Empty roles array should return INVALID_ROLES error
   */
  it('returns INVALID_ROLES error when roles array is empty', async () => {
    mockBatchCreateInvites.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.INVALID_ROLES, message: '请至少选择一个角色' },
    });

    const result = await batchGenerateInvites(5, [] as UserRole[], mockDynamoClient, INVITES_TABLE, REGISTER_BASE_URL);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_ROLES);
    }
    expect(mockBatchCreateInvites).toHaveBeenCalledWith(5, [], mockDynamoClient, INVITES_TABLE, REGISTER_BASE_URL, undefined, undefined);
  });

  /**
   * Validates: Requirements 2.1
   * Single role in roles array should work correctly (backward-compatible scenario)
   */
  it('works correctly with a single role in roles array', async () => {
    const mockInvites = [
      {
        token: 'token-abc',
        link: 'https://example.com/register?token=token-abc',
        roles: ['Speaker'] as UserRole[],
        expiresAt: '2025-01-02T00:00:00.000Z',
      },
    ];
    mockBatchCreateInvites.mockResolvedValue({ success: true, invites: mockInvites });

    const result = await batchGenerateInvites(
      1,
      ['Speaker'] as UserRole[],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.invites).toHaveLength(1);
      expect(result.invites[0].roles).toEqual(['Speaker']);
    }
    expect(mockBatchCreateInvites).toHaveBeenCalledWith(
      1,
      ['Speaker'],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      undefined,
    );
  });

  /**
   * Validates: Requirements 2.1, 2.5
   * Multiple roles in roles array should work correctly
   */
  it('works correctly with multiple roles in roles array', async () => {
    const roles: UserRole[] = ['UserGroupLeader', 'Speaker'];
    const mockInvites = [
      {
        token: 'token-xyz',
        link: 'https://example.com/register?token=token-xyz',
        roles,
        expiresAt: '2025-01-02T00:00:00.000Z',
      },
    ];
    mockBatchCreateInvites.mockResolvedValue({ success: true, invites: mockInvites });

    const result = await batchGenerateInvites(1, roles, mockDynamoClient, INVITES_TABLE, REGISTER_BASE_URL);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.invites).toHaveLength(1);
      expect(result.invites[0].roles).toEqual(['UserGroupLeader', 'Speaker']);
    }
    expect(mockBatchCreateInvites).toHaveBeenCalledWith(
      1,
      roles,
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      undefined,
    );
  });

  /**
   * Validates: Requirements 2.1
   * batchGenerateInvites passes roles array (not single role) to batchCreateInvites
   */
  it('passes roles array to batchCreateInvites', async () => {
    const roles: UserRole[] = ['CommunityBuilder', 'Volunteer', 'Speaker'];
    mockBatchCreateInvites.mockResolvedValue({ success: true, invites: [] });

    await batchGenerateInvites(3, roles, mockDynamoClient, INVITES_TABLE, REGISTER_BASE_URL);

    expect(mockBatchCreateInvites).toHaveBeenCalledWith(
      3,
      roles,
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      undefined,
    );
  });

  /**
   * Validates: Requirements 2.5
   * OrderAdmin invite with roles: ['OrderAdmin'] succeeds
   */
  it('succeeds when creating OrderAdmin invite with roles: [OrderAdmin]', async () => {
    const mockInvites = [
      {
        token: 'token-oa1',
        link: 'https://example.com/register?token=token-oa1',
        roles: ['OrderAdmin'] as UserRole[],
        expiresAt: '2025-01-02T00:00:00.000Z',
      },
    ];
    mockBatchCreateInvites.mockResolvedValue({ success: true, invites: mockInvites });

    const result = await batchGenerateInvites(
      1,
      ['OrderAdmin'] as UserRole[],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.invites).toHaveLength(1);
      expect(result.invites[0].roles).toEqual(['OrderAdmin']);
    }
    expect(mockBatchCreateInvites).toHaveBeenCalledWith(
      1,
      ['OrderAdmin'],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      undefined,
    );
  });

  /**
   * Validates: Requirements 10.3
   * OrderAdmin + other roles invite fails with EXCLUSIVE_ROLE_CONFLICT
   */
  it('fails with EXCLUSIVE_ROLE_CONFLICT when OrderAdmin combined with other roles', async () => {
    mockBatchCreateInvites.mockResolvedValue({
      success: false,
      error: { code: 'EXCLUSIVE_ROLE_CONFLICT', message: '独占角色不能与其他角色共存' },
    });

    const result = await batchGenerateInvites(
      1,
      ['OrderAdmin', 'Speaker'] as UserRole[],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('EXCLUSIVE_ROLE_CONFLICT');
    }
  });

  /**
   * Validates: Requirements 4.1, 4.2, 4.3, 4.4
   * isEmployee parameter is passed through to batchCreateInvites and included in results
   */
  it('passes isEmployee=true through to batchCreateInvites', async () => {
    const mockInvites = [
      {
        token: 'token-emp1',
        link: 'https://example.com/register?token=token-emp1',
        roles: ['Speaker'] as UserRole[],
        expiresAt: '2025-01-02T00:00:00.000Z',
        isEmployee: true,
      },
    ];
    mockBatchCreateInvites.mockResolvedValue({ success: true, invites: mockInvites });

    const result = await batchGenerateInvites(
      1,
      ['Speaker'] as UserRole[],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      true,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.invites).toHaveLength(1);
      expect(result.invites[0].isEmployee).toBe(true);
    }
    expect(mockBatchCreateInvites).toHaveBeenCalledWith(
      1,
      ['Speaker'],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      true,
    );
  });

  /**
   * Validates: Requirements 4.3
   * isEmployee defaults to undefined when not provided, passed through as-is
   */
  it('passes isEmployee=false through to batchCreateInvites', async () => {
    const mockInvites = [
      {
        token: 'token-nonemp',
        link: 'https://example.com/register?token=token-nonemp',
        roles: ['Volunteer'] as UserRole[],
        expiresAt: '2025-01-02T00:00:00.000Z',
        isEmployee: false,
      },
    ];
    mockBatchCreateInvites.mockResolvedValue({ success: true, invites: mockInvites });

    const result = await batchGenerateInvites(
      1,
      ['Volunteer'] as UserRole[],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      false,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.invites[0].isEmployee).toBe(false);
    }
    expect(mockBatchCreateInvites).toHaveBeenCalledWith(
      1,
      ['Volunteer'],
      mockDynamoClient,
      INVITES_TABLE,
      REGISTER_BASE_URL,
      undefined,
      false,
    );
  });
});
