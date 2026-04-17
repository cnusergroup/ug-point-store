import { View, Text } from '@tarojs/components';
import './index.scss';

interface PageToolbarProps {
  title: string;
  onBack: () => void;
  rightSlot?: React.ReactNode;
}

export default function PageToolbar({ title, onBack, rightSlot }: PageToolbarProps) {
  return (
    <View className='page-toolbar'>
      <View className='page-toolbar__back' onClick={onBack}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </View>
      <Text className='page-toolbar__title'>{title}</Text>
      {rightSlot ? (
        <View className='page-toolbar__right'>{rightSlot}</View>
      ) : (
        <View className='page-toolbar__spacer' />
      )}
    </View>
  );
}
