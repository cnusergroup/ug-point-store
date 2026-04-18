import { useState, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import './index.scss';

interface OfficeViewerProps {
  url: string;
  fileName: string;
}

/**
 * Office document viewer (PPT/PPTX/DOC/DOCX) using Office Online Viewer.
 * A full-coverage transparent overlay intercepts all mouse events to prevent
 * toolbar interaction (including download). Left half = prev page, right half = next page.
 * Page navigation reloads the iframe with wdSlide parameter.
 */
export default function OfficeViewer({ url, fileName }: OfficeViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isPpt = /\.(ppt|pptx)$/i.test(fileName);

  const buildSrc = (slide: number) => {
    const base = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
    // wdSlide only works for PPT; for DOC we just load the doc
    if (isPpt && slide > 1) {
      return `${base}&wdSlide=${slide}`;
    }
    return base;
  };

  const handlePrev = () => {
    if (currentSlide > 1) {
      setCurrentSlide((s) => s - 1);
    }
  };

  const handleNext = () => {
    setCurrentSlide((s) => s + 1);
  };

  return (
    <View className='office-viewer'>
      <View className='office-viewer__frame-wrap'>
        <iframe
          ref={iframeRef}
          className='office-viewer__frame'
          src={buildSrc(currentSlide)}
          title={fileName}
          sandbox='allow-scripts allow-same-origin allow-forms allow-popups'
        />
        {/* Full-coverage overlay — blocks all mouse interaction with iframe */}
        <View className='office-viewer__overlay'>
          {/* Left half: prev page */}
          <View
            className='office-viewer__overlay-left'
            onClick={handlePrev}
            title='上一页'
          />
          {/* Right half: next page */}
          <View
            className='office-viewer__overlay-right'
            onClick={handleNext}
            title='下一页'
          />
        </View>
      </View>
      {isPpt && (
        <View className='office-viewer__controls'>
          <View
            className={`office-viewer__btn${currentSlide <= 1 ? ' office-viewer__btn--disabled' : ''}`}
            onClick={handlePrev}
          >
            <Text className='office-viewer__btn-text'>‹ 上一页</Text>
          </View>
          <Text className='office-viewer__page-info'>第 {currentSlide} 页</Text>
          <View className='office-viewer__btn' onClick={handleNext}>
            <Text className='office-viewer__btn-text'>下一页 ›</Text>
          </View>
        </View>
      )}
    </View>
  );
}
