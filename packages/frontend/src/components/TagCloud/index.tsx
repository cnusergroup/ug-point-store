import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { request } from '../../utils/request';
import type { TagRecord } from '@points-mall/shared';
import './index.scss';

interface TagCloudProps {
  selectedTag: string | null;
  onTagSelect: (tag: string | null) => void;
}

interface TagCloudResponse {
  success: boolean;
  tags: TagRecord[];
}

export default function TagCloud({ selectedTag, onTagSelect }: TagCloudProps) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchTagCloud = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<TagCloudResponse>({ url: '/api/content/tags/cloud' });
      if (res.tags) {
        const sorted = [...res.tags].sort((a, b) => b.usageCount - a.usageCount);
        setTags(sorted);
      }
    } catch {
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTagCloud();
  }, [fetchTagCloud]);

  const handleTagClick = (tagName: string) => {
    onTagSelect(selectedTag === tagName ? null : tagName);
  };

  const handleClear = (e: any) => {
    e.stopPropagation?.();
    onTagSelect(null);
  };

  if (loading || tags.length === 0) return null;

  const renderChip = (tag: TagRecord) => {
    const isSelected = selectedTag === tag.tagName;
    return (
      <View
        key={tag.tagId}
        className={`tag-cloud__chip ${isSelected ? 'tag-cloud__chip--selected' : ''}`}
        onClick={() => handleTagClick(tag.tagName)}
      >
        <Text className='tag-cloud__chip-text'>{tag.tagName}</Text>
        {isSelected ? (
          <Text className='tag-cloud__chip-clear' onClick={handleClear}>×</Text>
        ) : (
          <Text className='tag-cloud__chip-count'>{tag.usageCount}</Text>
        )}
      </View>
    );
  };

  return (
    <View className='tag-cloud'>
      {/* Collapsed: single-row scroll with fade + expand button */}
      {!expanded && (
        <View className='tag-cloud__scroll-row'>
          <ScrollView className='tag-cloud__scroll' scrollX enableFlex>
            <View className='tag-cloud__inner'>
              {tags.map(renderChip)}
            </View>
          </ScrollView>
          {/* Right fade gradient + expand button */}
          <View className='tag-cloud__fade-right'>
            <View className='tag-cloud__expand-btn' onClick={() => setExpanded(true)}>
              <Text className='tag-cloud__expand-text'>全部</Text>
              <Text className='tag-cloud__expand-icon'>▾</Text>
            </View>
          </View>
        </View>
      )}

      {/* Expanded: wrap layout with all tags + collapse button */}
      {expanded && (
        <View className='tag-cloud__expanded-panel'>
          <View className='tag-cloud__wrap'>
            {tags.map(renderChip)}
          </View>
          <View className='tag-cloud__collapse-row'>
            <View className='tag-cloud__collapse-btn' onClick={() => setExpanded(false)}>
              <Text className='tag-cloud__collapse-text'>收起</Text>
              <Text className='tag-cloud__collapse-icon'>▴</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
