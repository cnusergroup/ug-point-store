import { useState, useRef, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import { getSortedCountryCodes, COUNTRY_CODES } from '@points-mall/shared';
import './index.scss';

interface CountryCodePickerProps {
  value: string;              // 当前选中的区号, e.g. "86"
  onChange: (code: string) => void;
}

const { common, others } = getSortedCountryCodes();

export default function CountryCodePicker({ value, onChange }: CountryCodePickerProps) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 获取当前选中的国家信息
  const selected = COUNTRY_CODES.find((c) => c.dialCode === value);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: Event) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = (dialCode: string) => {
    onChange(dialCode);
    setOpen(false);
  };

  return (
    <View className='country-code-picker' ref={pickerRef as any}>
      <View className='country-code-picker__trigger' onClick={() => setOpen(!open)}>
        <Text className='country-code-picker__flag'>{selected?.flag || '🌐'}</Text>
        <Text className='country-code-picker__code'>+{value}</Text>
        <Text className='country-code-picker__arrow'>{open ? '▾' : '›'}</Text>
      </View>

      {open && (
        <View className='country-code-picker__dropdown'>
          {/* 常用区号 */}
          {common.map((cc) => (
            <View
              key={cc.code}
              className={`country-code-picker__option ${cc.dialCode === value ? 'country-code-picker__option--selected' : ''}`}
              onClick={() => handleSelect(cc.dialCode)}
            >
              <Text className='country-code-picker__option-flag'>{cc.flag}</Text>
              <Text className='country-code-picker__option-code'>+{cc.dialCode}</Text>
              <Text className='country-code-picker__option-name'>{cc.name}</Text>
            </View>
          ))}

          {/* 分隔线 */}
          <View className='country-code-picker__divider' />

          {/* 其他区号（按英文名字母序） */}
          {others.map((cc) => (
            <View
              key={cc.code}
              className={`country-code-picker__option ${cc.dialCode === value ? 'country-code-picker__option--selected' : ''}`}
              onClick={() => handleSelect(cc.dialCode)}
            >
              <Text className='country-code-picker__option-flag'>{cc.flag}</Text>
              <Text className='country-code-picker__option-code'>+{cc.dialCode}</Text>
              <Text className='country-code-picker__option-name'>{cc.name}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
