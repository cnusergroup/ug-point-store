// Credential data types for community credentials module

import type { Locale } from './i18n';

export type CredentialStatus = 'active' | 'revoked';

export type CredentialRole = 'Volunteer' | 'Speaker' | 'Workshop' | 'Organizer';

/** 自助申请来源身份（与积分记录 targetRole 的身份分子集一致） */
export type SourceRole = 'Speaker' | 'UserGroupLeader' | 'Volunteer';

/** 季节取值（用于凭证 ID 拼装） */
export type Season = 'Spring' | 'Summer' | 'Fall' | 'Winter';

export interface Credential {
  credentialId: string;
  recipientName: string;
  eventName: string;
  role: CredentialRole | SourceRole;
  issueDate: string; // ISO date
  issuingOrganization: string;
  status: CredentialStatus;
  locale: Locale;
  createdAt: string; // ISO 8601
  // Optional fields
  eventLocation?: string;
  eventDate?: string;
  contribution?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  batchId?: string;
  // Self-applied credential fields (非空即代表自助申请来源)
  appliedByUserId?: string; // 申请人 userId
  sourceActivityId?: string; // 来源活动 ID
  sourceRole?: SourceRole; // 来源身份
  identityText?: string; // 证书展示身份文案（渲染优先使用）
  appliedDedupeKey?: string; // '{userId}#{activityId}#{sourceRole}' 并发去重键
  // "Hosted by" line displayed on the public certificate page between event name and appreciation
  hostByLine?: string; // e.g. "User Group China - {UG名}" or absent (default "User Group China" rendered)
}

export const ROLE_CODES: Record<CredentialRole, string> = {
  Volunteer: 'VOL',
  Speaker: 'SPK',
  Workshop: 'WKS',
  Organizer: 'ORG',
};

/** Source_Role → Role_Code 固定映射（用于凭证 ID 拼装） */
export const SOURCE_ROLE_CODES: Record<SourceRole, string> = {
  Speaker: 'SPK',
  Volunteer: 'VOL',
  UserGroupLeader: 'UGL',
};

/** 允许身份配置（Allowed_Role_Config） */
export interface AllowedRoleConfig {
  role: SourceRole; // 来源身份
  roleCode: string; // 由 role 派生：SPK/VOL/UGL
  identityText: string; // 证书展示身份文案，长度 1–100
}

/** 活动-证书模版关联（Activity_Template_Association） */
export interface ActivityTemplateAssociation {
  associationId: string; // 主键 (ulid)
  activityId: string; // 关联活动 ID（唯一）
  eventName: string; // 活动名称 1–200
  eventPrefix: string; // 凭证 ID 前缀，1–20 个 A–Z 与 '-'
  year: string; // 四位年份 2000–2100
  season: Season; // 季节
  allowedRoles: AllowedRoleConfig[]; // 1–3 项，role 不重复
  locale: 'en'; // 固定 en
  issuingOrganization: string; // 默认 'AWS User Group China'
  createdAt: string;
  createdBy: string;
  // 可选字段
  eventDate?: string; // 活动日期
  eventLocation?: string; // 活动地点 1–200
  updatedAt?: string;
  updatedBy?: string;
  // "Hosted by UG" — 证书显示 hosted by 行（活动名称与 Thank you 之间）
  showHostUg?: boolean; // 是否显示具体 UG 名称
  hostUgName?: string; // UG 名称（从活动 ugName 带入）
}
