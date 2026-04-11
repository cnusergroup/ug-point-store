import { useAppStore } from '../store';
import type { Locale, TranslationDict } from './types';
import { zh } from './zh';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';
import { zhTW } from './zh-TW';

const dictionaries: Record<Locale, TranslationDict> = { zh, en, ja, ko, 'zh-TW': zhTW };

/**
 * 根据点分隔的键路径从嵌套对象中取值
 * 例如 getNestedValue(dict, 'login.title') => dict.login.title
 */
export function getNestedValue(obj: Record<string, any>, path: string): string | undefined {
  return path.split('.').reduce((acc, key) => acc?.[key], obj) as string | undefined;
}

/**
 * 替换翻译文本中的 {paramName} 占位符
 */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    return key in params ? String(params[key]) : match;
  });
}

export function useTranslation() {
  const locale = useAppStore((s) => s.locale);
  const dict = dictionaries[locale] || dictionaries.zh;
  const fallback = dictionaries.zh;

  const t = (key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(dict as any, key)
      ?? getNestedValue(fallback as any, key)
      ?? key;
    return interpolate(value, params);
  };

  return { t, locale };
}
