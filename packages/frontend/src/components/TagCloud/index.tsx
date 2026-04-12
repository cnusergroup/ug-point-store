import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { request } from '../../utils/request';
import type { TagRecord } from '@points-mall/shared';
import './index.scss';

interface TagCloudProps {
  /** Currently selected tag name, or null if none selected */
  selectedTag: string | null;
  /** Callback when a tag is selected or deselected */
  onTagSelect: (tag: string | null) => void;
}

interface TagCloudResponse {
  success: boolean;
  tags: TagRecord[];
}

export default function TagCloud({ selectedTag, onTagSelect }: TagCloudProps) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTagCloud = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<TagCloudResponse>({ url: '/api/content/tags/cloud' });
      if (res.tags) {
        // Already sorted by usageCount desc from backend, but ensure order
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
    if (selectedTag === tagName) {
      // Deselect — restore all content
      onTagSelect(null);
    } else {
      // Select tag — trigger filter
      onTagSelect(tagName);
    }
  };

  // Don't render anything while loading or if no tags
  if (loading || tags.length === 0) {
    return null;
  }

  return (
    <ScrollView className='tag-cloud' scrollX enableFlex>
      <View className='tag-cloud__inner'>
        {tags.map((tag) => {
          const isSelected = selectedTag === tag.tagName;
          return (
            <View
              key={tag.tagId}
              className={`tag-cloud__chip ${isSelected ? 'tag-cloud__chip--selected' : ''}`}
              onClick={() => handleTagClick(tag.tagName)}
            >
              <Text className='tag-cloud__chip-text'>{tag.tagName}</Text>
              <Text className='tag-cloud__chip-count'>{tag.usageCount}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
