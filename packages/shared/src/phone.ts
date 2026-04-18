// ============================================================
// 国际手机号工具模块 - International Phone Number Utilities
// ============================================================

/** 国家/地区区号信息 */
export interface CountryCode {
  code: string;       // ISO 3166-1 alpha-2, e.g. "CN"
  dialCode: string;   // 区号数字部分, e.g. "86"
  flag: string;       // 国旗 emoji, e.g. "🇨🇳"
  name: string;       // 英文名称, e.g. "China"
}

/** 解析后的手机号 */
export interface ParsedPhone {
  countryCode: string;   // 区号数字部分, e.g. "86"
  phoneNumber: string;   // 号码部分, e.g. "13800138000"
}

/** 常用区号列表（置顶显示） */
export const COMMON_DIAL_CODES: string[] = ['86', '81', '886', '852', '82'];

/** 全球区号数据（约 30+ 常见国家/地区） */
export const COUNTRY_CODES: CountryCode[] = [
  { code: 'CN', dialCode: '86', flag: '🇨🇳', name: 'China' },
  { code: 'JP', dialCode: '81', flag: '🇯🇵', name: 'Japan' },
  { code: 'TW', dialCode: '886', flag: '🇹🇼', name: 'Taiwan' },
  { code: 'HK', dialCode: '852', flag: '🇭🇰', name: 'Hong Kong' },
  { code: 'KR', dialCode: '82', flag: '🇰🇷', name: 'South Korea' },
  { code: 'US', dialCode: '1', flag: '🇺🇸', name: 'United States' },
  { code: 'GB', dialCode: '44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: 'AU', dialCode: '61', flag: '🇦🇺', name: 'Australia' },
  { code: 'CA', dialCode: '1', flag: '🇨🇦', name: 'Canada' },
  { code: 'NZ', dialCode: '64', flag: '🇳🇿', name: 'New Zealand' },
  { code: 'SG', dialCode: '65', flag: '🇸🇬', name: 'Singapore' },
  { code: 'MY', dialCode: '60', flag: '🇲🇾', name: 'Malaysia' },
  { code: 'TH', dialCode: '66', flag: '🇹🇭', name: 'Thailand' },
  { code: 'VN', dialCode: '84', flag: '🇻🇳', name: 'Vietnam' },
  { code: 'PH', dialCode: '63', flag: '🇵🇭', name: 'Philippines' },
  { code: 'ID', dialCode: '62', flag: '🇮🇩', name: 'Indonesia' },
  { code: 'IN', dialCode: '91', flag: '🇮🇳', name: 'India' },
  { code: 'DE', dialCode: '49', flag: '🇩🇪', name: 'Germany' },
  { code: 'FR', dialCode: '33', flag: '🇫🇷', name: 'France' },
  { code: 'IT', dialCode: '39', flag: '🇮🇹', name: 'Italy' },
  { code: 'ES', dialCode: '34', flag: '🇪🇸', name: 'Spain' },
  { code: 'PT', dialCode: '351', flag: '🇵🇹', name: 'Portugal' },
  { code: 'NL', dialCode: '31', flag: '🇳🇱', name: 'Netherlands' },
  { code: 'SE', dialCode: '46', flag: '🇸🇪', name: 'Sweden' },
  { code: 'CH', dialCode: '41', flag: '🇨🇭', name: 'Switzerland' },
  { code: 'RU', dialCode: '7', flag: '🇷🇺', name: 'Russia' },
  { code: 'BR', dialCode: '55', flag: '🇧🇷', name: 'Brazil' },
  { code: 'MX', dialCode: '52', flag: '🇲🇽', name: 'Mexico' },
  { code: 'AE', dialCode: '971', flag: '🇦🇪', name: 'United Arab Emirates' },
  { code: 'SA', dialCode: '966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: 'IL', dialCode: '972', flag: '🇮🇱', name: 'Israel' },
  { code: 'TR', dialCode: '90', flag: '🇹🇷', name: 'Turkey' },
  { code: 'ZA', dialCode: '27', flag: '🇿🇦', name: 'South Africa' },
  { code: 'NG', dialCode: '234', flag: '🇳🇬', name: 'Nigeria' },
  { code: 'EG', dialCode: '20', flag: '🇪🇬', name: 'Egypt' },
  { code: 'AR', dialCode: '54', flag: '🇦🇷', name: 'Argentina' },
  { code: 'CL', dialCode: '56', flag: '🇨🇱', name: 'Chile' },
  { code: 'CO', dialCode: '57', flag: '🇨🇴', name: 'Colombia' },
  { code: 'PL', dialCode: '48', flag: '🇵🇱', name: 'Poland' },
  { code: 'IE', dialCode: '353', flag: '🇮🇪', name: 'Ireland' },
];


/** cfCountry (ISO alpha-2) 到区号的映射 */
const COUNTRY_TO_DIAL_CODE: Record<string, string> = {};
for (const cc of COUNTRY_CODES) {
  COUNTRY_TO_DIAL_CODE[cc.code] = cc.dialCode;
}

/** locale 到默认区号的映射 */
const LOCALE_DIAL_CODE_MAP: Record<string, string> = {
  zh: '86',
  ja: '81',
  'zh-TW': '886',
  ko: '82',
};

/**
 * 获取排序后的区号列表：常用在前，其余按 name 英文字母序
 */
export function getSortedCountryCodes(): { common: CountryCode[]; others: CountryCode[] } {
  const common: CountryCode[] = [];
  const others: CountryCode[] = [];

  for (const cc of COUNTRY_CODES) {
    if (COMMON_DIAL_CODES.includes(cc.dialCode)) {
      common.push(cc);
    } else {
      others.push(cc);
    }
  }

  // 常用区号按 COMMON_DIAL_CODES 顺序排列
  common.sort((a, b) => COMMON_DIAL_CODES.indexOf(a.dialCode) - COMMON_DIAL_CODES.indexOf(b.dialCode));

  // 其余按 name 英文字母序排列
  others.sort((a, b) => a.name.localeCompare(b.name, 'en'));

  return { common, others };
}

/**
 * 根据 locale 和可选的 cfCountry cookie 获取默认区号
 * - zh → 86, ja → 81, zh-TW → 886, ko → 82
 * - en → 由 cfCountry 决定（US→1, GB→44 等）
 * - 无法映射时默认 86
 */
export function getDefaultDialCode(locale: string, cfCountry?: string | null): string {
  // 先尝试精确匹配（如 zh-TW）
  if (LOCALE_DIAL_CODE_MAP[locale]) {
    return LOCALE_DIAL_CODE_MAP[locale];
  }

  // 尝试基础 locale（如 zh-CN → zh）
  const baseLang = locale.split('-')[0];
  if (baseLang === 'en') {
    // en locale 由 cfCountry 决定
    if (cfCountry) {
      const upper = cfCountry.toUpperCase();
      if (COUNTRY_TO_DIAL_CODE[upper]) {
        return COUNTRY_TO_DIAL_CODE[upper];
      }
    }
    return '86'; // 默认回退
  }

  if (LOCALE_DIAL_CODE_MAP[baseLang]) {
    return LOCALE_DIAL_CODE_MAP[baseLang];
  }

  return '86'; // 默认回退
}

/** Phone_Storage_Format 正则：+{1-4位区号}-{4-15位号码} */
const PHONE_STORAGE_REGEX = /^\+(\d{1,4})-(\d{4,15})$/;

/** 旧格式中国手机号正则：1 开头的 11 位纯数字 */
const LEGACY_PHONE_REGEX = /^1\d{10}$/;

/**
 * 解析 Phone_Storage_Format 字符串
 * - 国际格式 "+CC-NNNN" → { countryCode, phoneNumber }
 * - 旧格式 11 位纯数字 → { countryCode: '86', phoneNumber: 原始号码 }
 * - 无效输入 → null
 */
export function parsePhone(phone: string): ParsedPhone | null {
  if (!phone) return null;

  const match = phone.match(PHONE_STORAGE_REGEX);
  if (match) {
    return { countryCode: match[1], phoneNumber: match[2] };
  }

  if (LEGACY_PHONE_REGEX.test(phone)) {
    return { countryCode: '86', phoneNumber: phone };
  }

  return null;
}

/**
 * 组合区号和号码为 Phone_Storage_Format
 * @returns "+CC-NNNN" 格式字符串
 */
export function formatPhone(countryCode: string, phoneNumber: string): string {
  return `+${countryCode}-${phoneNumber}`;
}

/**
 * 格式化为展示用格式
 * - 国际格式 "+CC-NNNN" → "+CC NNNN"（区号与号码之间用空格分隔）
 * - 旧格式纯数字 → 原样返回
 */
export function displayPhone(phone: string): string {
  const parsed = parsePhone(phone);
  if (!parsed) return phone;

  // 旧格式纯数字原样返回
  if (LEGACY_PHONE_REGEX.test(phone)) {
    return phone;
  }

  return `+${parsed.countryCode} ${parsed.phoneNumber}`;
}

/**
 * 校验号码部分：纯数字，4-15 位（符合 E.164 标准）
 */
export function validatePhoneNumber(phoneNumber: string): boolean {
  return /^\d{4,15}$/.test(phoneNumber);
}
