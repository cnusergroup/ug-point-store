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
  // New strings for redesigned credential page
  verifiedCredential: string;
  verbLine: Record<string, string>;
  appreciationText: string;
  organizedBy: string;
  copyLink: string;
  copiedLink: string;
  downloadCert: string;
  verifyOnline: string;
  footerIssued: string;
  footerImmutable: string;
  revokedWarningTitle: string;
  revokedWarningDescription: string;
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
  verifiedCredential: '已验证凭证',
  verbLine: {
    Volunteer: '作为志愿者参与了',
    Speaker: '作为讲师参与了',
    Workshop: '作为工作坊参与者参与了',
    Organizer: '作为组织者参与了',
  },
  appreciationText: '感谢您的宝贵贡献，帮助活动顺利举办。',
  organizedBy: '主办方',
  copyLink: '复制凭证链接',
  copiedLink: '已复制！',
  downloadCert: '下载证书',
  verifyOnline: '在线验证',
  footerIssued: '签发于 {date}',
  footerImmutable: '此凭证记录不可修改。',
  revokedWarningTitle: '凭证已撤销',
  revokedWarningDescription: '此凭证已被签发组织撤销，不再有效。',
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
  verifiedCredential: 'Verified Credential',
  verbLine: {
    Volunteer: 'contributed as a Volunteer at',
    Speaker: 'contributed as a Speaker at',
    Workshop: 'contributed as a Workshop Participant at',
    Organizer: 'contributed as an Organizer at',
  },
  appreciationText: 'Thank you for your valuable contribution in helping make this event possible.',
  organizedBy: 'Organized By',
  copyLink: 'Copy Credential Link',
  copiedLink: 'Copied!',
  downloadCert: 'Download Certificate',
  verifyOnline: 'Verify Online',
  footerIssued: 'Issued on {date}',
  footerImmutable: 'This credential record cannot be modified.',
  revokedWarningTitle: 'Credential Revoked',
  revokedWarningDescription: 'This credential has been revoked by the issuing organization and is no longer valid.',
};

const stringsMap: Record<Locale, I18nStrings> = {
  zh: zhStrings,
  en: enStrings,
};

export function getStrings(locale: Locale): I18nStrings {
  return stringsMap[locale];
}
