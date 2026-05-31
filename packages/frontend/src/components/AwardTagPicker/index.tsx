/**
 * AwardTagPicker — 奖项标签选择器
 *
 * special-activity-award 功能专用的受控自动补全组件，行为：
 *  - 空 input 聚焦时调用 `GET /api/admin/award-tags/hot` 拉取默认建议（最多 10 条热门 tag）
 *  - 输入非空时 debounce 300ms 调用 `GET /api/admin/award-tags?prefix={input}&limit=10`
 *  - 输入未精确命中已有 tag（按归一化 tagName 比较）时，下拉末尾追加
 *    `+ 新建 "{原始输入}"` 行，点击后选中（实际 DDB 写入由后端 upsert 在主发放
 *    流程中完成，详见 design.md "Error Handling §3"）
 *  - 失焦延迟 200ms 关闭下拉，确保下拉内的 click 事件能先触发
 *  - 实时校验：使用 shared 的 `validateAwardTagName`，错误时在控件下方红字展示
 *
 * 校验规则与后端共用 `packages/shared/src/award-tag.ts`，确保前后端语义严格一致。
 *
 * Props:
 *   - value: 当前显示在输入框中的 displayName（受控）
 *   - onChange: 用户输入或选中建议时回调，传入新的 displayName 原文
 *   - disabled: 可选禁用整个控件
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Input } from '@tarojs/components';
import {
  validateAwardTagName,
  normalizeAwardTagName,
} from '@points-mall/shared';
import type { AwardTag } from '@points-mall/shared';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import './index.scss';

interface AwardTagPickerProps {
  /** 当前选中的 displayName（用户原文） */
  value: string;
  /** 用户输入或选中建议时回调；传入新的 displayName 原文 */
  onChange: (displayName: string) => void;
  /** 是否禁用整个控件 */
  disabled?: boolean;
}

interface SearchResponse {
  success: boolean;
  tags: AwardTag[];
}

interface HotResponse {
  success: boolean;
  tags: AwardTag[];
}

/** 输入防抖延迟（毫秒） */
const SEARCH_DEBOUNCE_MS = 300;

/** 失焦后延迟关闭下拉的毫秒数（让下拉项 click 事件先触发） */
const BLUR_CLOSE_DELAY_MS = 200;

export default function AwardTagPicker({
  value,
  onChange,
  disabled = false,
}: AwardTagPickerProps) {
  const { t } = useTranslation();

  const [suggestions, setSuggestions] = useState<AwardTag[]>([]);
  const [hotTags, setHotTags] = useState<AwardTag[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 标记最近一次 GET hot 是否已发起，避免每次 focus 都重复请求 */
  const hotLoadedRef = useRef(false);

  // 实时校验（仅在用户输入了内容时显示错误，避免空状态报错）
  const trimmedValue = value?.trim() ?? '';
  const validation =
    trimmedValue.length > 0 ? validateAwardTagName(value) : { valid: true };

  /** 拉取热门 tag（首次需要时调用一次） */
  const loadHotTags = useCallback(async () => {
    if (hotLoadedRef.current) return;
    hotLoadedRef.current = true;
    try {
      setLoading(true);
      const res = await request<HotResponse>({
        url: '/api/admin/award-tags/hot',
      });
      setHotTags(res.tags ?? []);
    } catch {
      // 静默失败：热门 tag 是非关键项，下拉仍可展示「+ 新建」
      setHotTags([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 按 prefix 拉取建议（debounce 300ms） */
  const searchTags = useCallback((prefix: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const normalized = normalizeAwardTagName(prefix);
    if (normalized.length < 1) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await request<SearchResponse>({
          url: `/api/admin/award-tags?prefix=${encodeURIComponent(normalized)}&limit=10`,
        });
        setSuggestions(res.tags ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const handleInput = (e: any) => {
    // Taro Input: e.detail.value；为兼容 web Input 也尝试 e.target.value
    const next = e?.detail?.value ?? e?.target?.value ?? '';
    onChange(next);
    if (next.trim().length === 0) {
      setSuggestions([]);
      // 空值时重新展示热门 tag
      if (!hotLoadedRef.current) loadHotTags();
    } else {
      searchTags(next);
    }
    setShowDropdown(true);
  };

  const handleFocus = () => {
    if (disabled) return;
    setShowDropdown(true);
    if (trimmedValue.length === 0) {
      loadHotTags();
    } else {
      searchTags(value);
    }
  };

  const handleBlur = () => {
    // 延迟关闭，确保下拉项 onClick 能先触发
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    blurTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
    }, BLUR_CLOSE_DELAY_MS);
  };

  /** 点击已有 tag 建议 → 选中其 displayName 并关闭下拉 */
  const handleSelectSuggestion = (tag: AwardTag) => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    onChange(tag.displayName);
    setShowDropdown(false);
  };

  /** 点击「+ 新建 "xxx"」→ 选中原始输入文本（不立即创建，由后端 upsert 完成） */
  const handleCreateNew = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    onChange(value);
    setShowDropdown(false);
  };

  // 是否显示 "+ 新建" 行：用户输入非空、且当前建议列表中没有归一化后的精确匹配
  const normalizedInput = normalizeAwardTagName(value ?? '');
  const exactMatch =
    normalizedInput.length > 0 &&
    suggestions.some((s) => s.tagName === normalizedInput);
  const shouldShowCreateRow =
    normalizedInput.length > 0 && !exactMatch && validation.valid;

  // 下拉数据来源：有输入则展示 suggestions，否则展示 hot tags
  const listToShow: AwardTag[] =
    trimmedValue.length > 0 ? suggestions : hotTags;

  return (
    <View className='award-tag-picker'>
      <View className='award-tag-picker__field'>
        <Input
          className={`award-tag-picker__input ${disabled ? 'award-tag-picker__input--disabled' : ''} ${!validation.valid ? 'award-tag-picker__input--error' : ''}`}
          value={value}
          placeholder={t('awardTagPicker.placeholder')}
          onInput={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          maxlength={30}
        />

        {showDropdown && !disabled && (
          <View className='award-tag-picker__dropdown'>
            {loading && (
              <View className='award-tag-picker__loading'>
                <Text className='award-tag-picker__loading-text'>
                  {t('common.loading')}
                </Text>
              </View>
            )}

            {!loading && listToShow.length === 0 && !shouldShowCreateRow && (
              <View className='award-tag-picker__empty'>
                <Text className='award-tag-picker__empty-text'>
                  {trimmedValue.length === 0
                    ? t('awardTagPicker.noHotTags')
                    : t('awardTagPicker.noMatch')}
                </Text>
              </View>
            )}

            {!loading &&
              listToShow.map((tag) => (
                <View
                  key={tag.tagId}
                  className='award-tag-picker__item'
                  onClick={() => handleSelectSuggestion(tag)}
                >
                  <Text className='award-tag-picker__item-name'>
                    {tag.displayName}
                  </Text>
                  <Text className='award-tag-picker__item-count'>
                    {t('awardTagPicker.usageCount', { count: tag.usageCount })}
                  </Text>
                </View>
              ))}

            {!loading && shouldShowCreateRow && (
              <View
                className='award-tag-picker__item award-tag-picker__item--create'
                onClick={handleCreateNew}
              >
                <Text className='award-tag-picker__item-name award-tag-picker__item-name--create'>
                  {t('awardTagPicker.createNew', { name: value.trim() })}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {!validation.valid && (
        <Text className='award-tag-picker__error'>
          {validation.message}
        </Text>
      )}
    </View>
  );
}
