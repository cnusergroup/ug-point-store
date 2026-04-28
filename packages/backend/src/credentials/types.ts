// Credential data types for community credentials module

import type { Locale } from './i18n';

export type CredentialStatus = 'active' | 'revoked';

export type CredentialRole = 'Volunteer' | 'Speaker' | 'Workshop' | 'Organizer';

export interface Credential {
  credentialId: string;
  recipientName: string;
  eventName: string;
  role: CredentialRole;
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
}

export const ROLE_CODES: Record<CredentialRole, string> = {
  Volunteer: 'VOL',
  Speaker: 'SPK',
  Workshop: 'WKS',
  Organizer: 'ORG',
};
