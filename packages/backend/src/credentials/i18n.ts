// i18n module for community credentials — zh/en string maps

export type Locale = 'zh' | 'en';

export interface I18nStrings {
  verified: string;
  revoked: string;
  issueDate: string;
  issuingOrganization: string;
  credentialId: string;
  addToLinkedIn: string;
  verificationTitle: string;
  verificationDescription: string;
  revokedNotice: string;
  eventDate: string;
  eventLocation: string;
  contribution: string;
  pageTitle: string;
  roles: Record<string, string>;
}

const zhStrings: I18nStrings = {
  verified: '已验证',
  revoked: '已撤销',
  issueDate: '签发日期',
  issuingOrganization: '签发组织',
  credentialId: '凭证 ID',
  addToLinkedIn: '添加到 LinkedIn',
  verificationTitle: '凭证验证',
  verificationDescription: '此凭证由 {org} 签发，可通过以下方式验证',
  revokedNotice: '此凭证已被撤销',
  eventDate: '活动日期',
  eventLocation: '活动地点',
  contribution: '贡献描述',
  pageTitle: '{name} - {role} | {event}',
  roles: {
    Volunteer: '志愿者',
    Speaker: '讲师',
    Workshop: '工作坊参与者',
    Organizer: '组织者',
  },
};

const enStrings: I18nStrings = {
  verified: 'Verified',
  revoked: 'Revoked',
  issueDate: 'Issue Date',
  issuingOrganization: 'Issuing Organization',
  credentialId: 'Credential ID',
  addToLinkedIn: 'Add to LinkedIn',
  verificationTitle: 'Credential Verification',
  verificationDescription: 'This credential was issued by {org} and can be verified at',
  revokedNotice: 'This credential has been revoked',
  eventDate: 'Event Date',
  eventLocation: 'Event Location',
  contribution: 'Contribution',
  pageTitle: '{name} - {role} | {event}',
  roles: {
    Volunteer: 'Volunteer',
    Speaker: 'Speaker',
    Workshop: 'Workshop Participant',
    Organizer: 'Organizer',
  },
};

const stringsMap: Record<Locale, I18nStrings> = {
  zh: zhStrings,
  en: enStrings,
};

export function getStrings(locale: Locale): I18nStrings {
  return stringsMap[locale];
}
