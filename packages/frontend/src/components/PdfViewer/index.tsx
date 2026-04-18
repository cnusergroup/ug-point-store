import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import './index.scss';

interface PdfViewerProps {
  url: string;
}

/**
 * PDF viewer using pdf.js — renders pages as canvas elements.
 * The original PDF URL is never exposed to the user, preventing direct download.
 */
export default function PdfViewer({ url }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return;
    try {
      // Cancel any in-progress render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      const page = await pdfDocRef.current.getPage(pageNum);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      // Scale to fit container width
      const containerWidth = canvas.parentElement?.clientWidth || 600;
      const viewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      const renderContext = { canvasContext: context, viewport: scaledViewport };
      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('[PdfViewer] Render error:', err);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      setLoading(true);
      setError('');
      try {
        // Load pdfjs from CDN to avoid webpack bundling conflicts
        await new Promise<void>((resolve, reject) => {
          if ((window as any).pdfjsLib) { resolve(); return; }
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load pdf.js'));
          document.head.appendChild(script);
        });

        const pdfjsLib = (window as any).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

        const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setCurrentPage(1);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[PdfViewer] Load error:', err);
          setError('PDF 加载失败');
          setLoading(false);
        }
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [url]);

  useEffect(() => {
    if (!loading && pdfDocRef.current) {
      renderPage(currentPage);
    }
  }, [currentPage, loading, renderPage]);

  if (loading) {
    return (
      <View className='pdf-viewer pdf-viewer--loading'>
        <Text className='pdf-viewer__loading-text'>正在加载预览...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className='pdf-viewer pdf-viewer--error'>
        <Text className='pdf-viewer__error-text'>{error}</Text>
      </View>
    );
  }

  return (
    <View className='pdf-viewer'>
      <View className='pdf-viewer__controls'>
        <View
          className={`pdf-viewer__btn${currentPage <= 1 ? ' pdf-viewer__btn--disabled' : ''}`}
          onClick={currentPage > 1 ? () => setCurrentPage((p) => p - 1) : undefined}
        >
          <Text className='pdf-viewer__btn-text'>‹ 上一页</Text>
        </View>
        <Text className='pdf-viewer__page-info'>{currentPage} / {numPages}</Text>
        <View
          className={`pdf-viewer__btn${currentPage >= numPages ? ' pdf-viewer__btn--disabled' : ''}`}
          onClick={currentPage < numPages ? () => setCurrentPage((p) => p + 1) : undefined}
        >
          <Text className='pdf-viewer__btn-text'>下一页 ›</Text>
        </View>
      </View>
      <View
        className='pdf-viewer__canvas-wrap'
        onContextMenu={(e) => { e.preventDefault(); }}
      >
        <canvas ref={canvasRef} className='pdf-viewer__canvas' />
      </View>
    </View>
  );
}
