import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import type { TagRecord } from '@points-mall/shared';
import './index.scss';

interface TagInputProps {
  /** Currently selected tag names */
  value: string[];
  /** Callback when tags change */
  onChange: (tags: string[]) => void;
  /** Maximum number of tags allowed (default 5) */
  maxTags?: number;
}

interface SearchTagsResponse {
  success: boolean;
  tags: TagRecord[];
}

interface HotTagsResponse {
  success: boolean;
  tags: TagRecord[];
}

/** Debounce delay for autocomplete search (ms) */
const SEARCH_DEBOUNCE_MS = 300;

export default function TagInput({ value, onChange, maxTags = 5 }: TagInputProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<TagRecord[]>([]);
  const [hotTags, setHotTags] = useState<TagRecord[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtLimit = value.length >= maxTags;

  // Fetch hot tags on mount
  useEffect(() => {
    let cancelled = false;
    request<HotTagsResponse>({ url: '/api/content/tags/hot' })
      .then((res) => {
        if (!cancelled && res.tags) {
          setHotTags(res.tags);
        }
      })
      .catch(() => {
        // Silently ignore — hot tags are non-critical
      });
    return () => { cancelled = true; };
  }, []);

  // Search tags with debounce
  const searchTags = useCallback((prefix: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = prefix.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await request<SearchTagsResponse>({
          url: `/api/content/tags/search?prefix=${encodeURIComponent(trimmed)}`,
        });
        if (res.tags) {
          // Filter out already-selected tags
          const filtered = res.tags.filter(
            (tag) => !value.includes(tag.tagName),
          );
          setSuggestions(filtered);
          setShowDropdown(filtered.length > 0);
        }
      } catch {
        setSuggestions([]);
        setShowDropdown(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, [value]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const addTag = useCallback((tagName: string) => {
    const normalized = tagName.trim().toLowerCase();
    if (!normalized || normalized.length < 2 || normalized.length > 20) return;
    if (value.includes(normalized)) return;
    if (value.length >= maxTags) return;

    onChange([...value, normalized]);
    setInputValue('');
    setSuggestions([]);
    setShowDropdown(false);
  }, [value, onChange, maxTags]);

  const removeTag = useCallback((tagName: string) => {
    onChange(value.filter((t) => t !== tagName));
  }, [value, onChange]);

  const handleInputChange = (e: any) => {
    const val = e.target?.value ?? e.detail?.value ?? '';
    setInputValue(val);
    searchTags(val);
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault?.();
      const trimmed = inputValue.trim().toLowerCase();
      if (trimmed.length >= 2) {
        // If there's a matching suggestion, use it; otherwise create new tag
        const match = suggestions.find((s) => s.tagName === trimmed);
        addTag(match ? match.tagName : trimmed);
      }
    }
  };

  const handleSuggestionClick = (tag: TagRecord) => {
    addTag(tag.tagName);
  };

  const handleHotTagClick = (tag: TagRecord) => {
    if (isAtLimit) return;
    if (value.includes(tag.tagName)) return;
    addTag(tag.tagName);
  };

  const handleBlur = () => {
    // Delay hiding dropdown so click events on suggestions can fire
    setTimeout(() => {
      setShowDropdown(false);
    }, 200);
  };

  return (
    <View className='tag-input'>
      {/* Selected tags as chips */}
      {value.length > 0 && (
        <View className='tag-input__chips'>
          {value.map((tag) => (
            <View key={tag} className='tag-input__chip'>
              <Text className='tag-input__chip-text'>{tag}</Text>
              <Text
                className='tag-input__chip-remove'
                onClick={() => removeTag(tag)}
              >
                ×
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Input field with autocomplete */}
      <View className='tag-input__field-wrapper'>
        <input
          className={`tag-input__input ${isAtLimit ? 'tag-input__input--disabled' : ''}`}
          placeholder={isAtLimit ? `${t('contentHub.tags.maxTagsHint').replace('{max}', String(maxTags))}` : t('contentHub.tags.placeholder')}
          value={inputValue}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={isAtLimit}
          maxLength={20}
        />
        {isAtLimit && (
          <Text className='tag-input__limit-hint'>
            {t('contentHub.tags.maxTagsHint').replace('{max}', String(maxTags))}
          </Text>
        )}

        {/* Autocomplete dropdown */}
        {showDropdown && suggestions.length > 0 && (
          <View className='tag-input__dropdown'>
            {suggestions.map((tag) => (
              <View
                key={tag.tagId}
                className='tag-input__dropdown-item'
                onClick={() => handleSuggestionClick(tag)}
              >
                <Text className='tag-input__dropdown-name'>{tag.tagName}</Text>
                <Text className='tag-input__dropdown-count'>
                  {t('contentHub.tagManagement.usageCount').replace('{count}', String(tag.usageCount))}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Show "create new tag" option when input doesn't match any suggestion */}
        {showDropdown && inputValue.trim().length >= 2 && !suggestions.find((s) => s.tagName === inputValue.trim().toLowerCase()) && (
          <View className='tag-input__dropdown tag-input__dropdown--create'>
            <View
              className='tag-input__dropdown-item tag-input__dropdown-item--create'
              onClick={() => addTag(inputValue)}
            >
              <Text className='tag-input__dropdown-name'>
                {t('contentHub.tags.addTag').replace('{name}', inputValue.trim().toLowerCase())}
              </Text>
            </View>
          </View>
        )}

        {/* When no suggestions and input is valid, show create option */}
        {!showDropdown && inputValue.trim().length >= 2 && !isAtLimit && (
          <View className='tag-input__dropdown'>
            <View
              className='tag-input__dropdown-item tag-input__dropdown-item--create'
              onClick={() => addTag(inputValue)}
            >
              <Text className='tag-input__dropdown-name'>
                {t('contentHub.tags.addTag').replace('{name}', inputValue.trim().toLowerCase())}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Hot Tags area */}
      {hotTags.length > 0 && (
        <View className='tag-input__hot'>
          <Text className='tag-input__hot-title'>{t('contentHub.tags.hotTagsTitle')}</Text>
          <View className='tag-input__hot-list'>
            {hotTags.map((tag) => {
              const isSelected = value.includes(tag.tagName);
              const isDisabled = isAtLimit && !isSelected;
              return (
                <View
                  key={tag.tagId}
                  className={`tag-input__hot-chip ${isSelected ? 'tag-input__hot-chip--selected' : ''} ${isDisabled ? 'tag-input__hot-chip--disabled' : ''}`}
                  onClick={() => handleHotTagClick(tag)}
                >
                  <Text className='tag-input__hot-chip-text'>{tag.tagName}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}
