import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

// ============================================================
// Types
// ============================================================

/** 技能类型：直播支持 / 宣传文案创作 */
export type SkillType = 'liveSupport' | 'promoWriting';

/** 允许的技能值列表 */
export const VALID_SKILL_TYPES: readonly SkillType[] = ['liveSupport', 'promoWriting'] as const;

/** 技能认领请求项 */
export interface SkillClaimInput {
  skill: SkillType;
  userId: string;
}

/** 技能认领记录（DynamoDB item） */
export interface SkillClaimRecord {
  activityId: string;       // PK
  skill: SkillType;         // SK
  userId: string;
  userNickname: string;
  claimedAt: string;        // ISO 8601
  claimedBy: string;        // 操作管理员 userId
  distributionId: string;
  pointsAwarded: number;    // 写入时刻的配置快照
}

/** 验证结果 */
export type SkillClaimsValidationResult =
  | null
  | { code: string; message: string };

// ============================================================
// Validation
// ============================================================

/**
 * Validate skillClaims input.
 *
 * Returns null on success, or an error object with code and message on failure.
 *
 * Checks:
 * - SKILL_NOT_ALLOWED_FOR_ROLE: if targetRole !== 'UserGroupLeader' and skillClaims is non-empty
 * - DUPLICATE_SKILL_IN_REQUEST: if same skill appears more than once
 * - INVALID_SKILL_TYPE: if any skill value is not in allowed values
 */
export function validateSkillClaimsInput(
  skillClaims: SkillClaimInput[],
  targetRole: string,
  _userIds?: string[],
): SkillClaimsValidationResult {
  // If skillClaims is empty, nothing to validate
  if (!skillClaims || skillClaims.length === 0) {
    return null;
  }

  // Role restriction: skill claims only allowed for UserGroupLeader
  if (targetRole !== 'UserGroupLeader') {
    return {
      code: 'SKILL_NOT_ALLOWED_FOR_ROLE',
      message: '技能分仅适用于 UGL 角色',
    };
  }

  // Check for invalid skill types
  for (const claim of skillClaims) {
    if (!VALID_SKILL_TYPES.includes(claim.skill as SkillType)) {
      return {
        code: 'INVALID_SKILL_TYPE',
        message: `无效的技能类型: ${claim.skill}，允许值为 liveSupport 或 promoWriting`,
      };
    }
  }

  // Check for duplicate skills in the same request
  const seenSkills = new Set<string>();
  for (const claim of skillClaims) {
    if (seenSkills.has(claim.skill)) {
      return {
        code: 'DUPLICATE_SKILL_IN_REQUEST',
        message: '同一技能在同一请求中只能出现一次',
      };
    }
    seenSkills.add(claim.skill);
  }

  return null;
}

/** Context required by buildSkillClaimTransactItems */
export interface SkillClaimContext {
  activityId: string;
  claimedBy: string;           // admin userId performing the operation
  distributionId: string;
  tableName: string;           // ActivitySkillClaims table name
  userNicknameMap: Record<string, string>;  // userId → nickname mapping
  pointsConfig: { liveSupportPoints: number; promoWritingPoints: number };
}

// ============================================================
// Query
// ============================================================

/**
 * Query all skill claims for a given activity.
 * Returns an empty array if no claims exist (never 404).
 */
export async function getSkillClaimsForActivity(
  activityId: string,
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<SkillClaimRecord[]> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'activityId = :aid',
      ExpressionAttributeValues: {
        ':aid': activityId,
      },
    }),
  );

  return (result.Items ?? []) as SkillClaimRecord[];
}

// ============================================================
// Transaction Builder
// ============================================================

/**
 * Build DynamoDB TransactWriteItem Put operations for skill claims.
 *
 * Each Put item:
 * - Targets the ActivitySkillClaims table
 * - Includes ConditionExpression: 'attribute_not_exists(activityId)' to enforce mutex
 * - Contains all SkillClaimRecord fields with proper values
 * - Uses ISO 8601 format for claimedAt
 * - Looks up pointsAwarded from pointsConfig based on skill type
 */
export function buildSkillClaimTransactItems(
  skillClaims: SkillClaimInput[],
  context: SkillClaimContext,
): NonNullable<TransactWriteCommandInput['TransactItems']> {
  const now = new Date().toISOString();

  return skillClaims.map((claim) => {
    const pointsAwarded = claim.skill === 'liveSupport'
      ? context.pointsConfig.liveSupportPoints
      : context.pointsConfig.promoWritingPoints;

    const item: SkillClaimRecord = {
      activityId: context.activityId,
      skill: claim.skill,
      userId: claim.userId,
      userNickname: context.userNicknameMap[claim.userId] ?? '',
      claimedAt: now,
      claimedBy: context.claimedBy,
      distributionId: context.distributionId,
      pointsAwarded,
    };

    return {
      Put: {
        TableName: context.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(activityId)',
      },
    };
  });
}
