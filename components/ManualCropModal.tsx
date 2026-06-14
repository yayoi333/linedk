import React, { useRef, useState, useEffect } from 'react';
import { X, Crop, Check, Plus, Upload } from 'lucide-react';
import { Stamp, SourceImage, TARGET_WIDTH, TARGET_HEIGHT } from '../types';

interface Props {
  sourceImages: SourceImage[];
  animatedVideoUrl?: string; // Video file support
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (cropData: Stamp) => void;
  onAddSource: (file: File) => Promise<string | void>;
  initialSourceId?: string;
}

export const ManualCropModal: React.FC<Props> = ({ sourceImages, animatedVideoUrl, isOpen, onClose, onConfirm, onAddSource, initialSourceId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selection, setSelection] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [activeSourceId, setActiveSourceId] = useState<string>(initialSourceId || sourceImages[0]?.id || (animatedVideoUrl ? 'animated-video' : ''));

  useEffect(() => {
    if (isOpen) {
        setSelection(null);
        if (initialSourceId === 'animated-video' && animatedVideoUrl) {
            setActiveSourceId('animated-video');
        } else if (initialSourceId && sourceImages.find(img => img.id === initialSourceId)) {
            setActiveSourceId(initialSourceId);
        } else if (activeSourceId === 'animated-video' && animatedVideoUrl) {
            // Keep active animated-video
        } else if (!sourceImages.find(img => img.id === activeSourceId)) {
            setActiveSourceId(sourceImages[0]?.id || (animatedVideoUrl ? 'animated-video' : ''));
        }
    }
  }, [isOpen, initialSourceId, sourceImages, animatedVideoUrl]); 

  // Don't depend on activeSourceId in the useEffect deps to avoid resetting when changing images inside modal
  // But we need to ensure valid source.

  const activeImage = sourceImages.find(img => img.id === activeSourceId);
  const isVideoMode = activeSourceId === 'animated-video' && !!animatedVideoUrl;

  const getActiveElementDimensions = () => {
      const el = imgRef.current || videoRef.current;
      if (!el) return { width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 };
      const isVid = el.tagName.toLowerCase() === 'video';
      return {
          width: el.clientWidth,
          height: el.clientHeight,
          naturalWidth: isVid ? (el as HTMLVideoElement).videoWidth : (el as HTMLImageElement).naturalWidth,
          naturalHeight: isVid ? (el as HTMLVideoElement).videoHeight : (el as HTMLImageElement).naturalHeight,
      };
  };

  // --- Pointer/Touch Events ---
  const getClientCoords = (e: React.MouseEvent | React.TouchEvent) => {
      if ('touches' in e) {
          return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else {
          return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
      }
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const el = imgRef.current || videoRef.current;
    if (!el) return;
    if (e.type === 'touchstart') e.preventDefault(); // Prevent scrolling

    const rect = el.getBoundingClientRect();
    const { x: clientX, y: clientY } = getClientCoords(e);
    
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    setIsSelecting(true);
    setStartPos({ x, y });
    setSelection({ x, y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const el = imgRef.current || videoRef.current;
    if (!isSelecting || !el) return;
    if (e.type === 'touchmove') e.preventDefault();

    const rect = el.getBoundingClientRect();
    const { x: clientX, y: clientY } = getClientCoords(e);
    
    const currentX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(clientY - rect.top, rect.height));

    const w = currentX - startPos.x;
    const h = currentY - startPos.y;

    setSelection({
      x: w > 0 ? startPos.x : currentX,
      y: h > 0 ? startPos.y : currentY,
      w: Math.abs(w),
      h: Math.abs(h)
    });
  };

  const handlePointerUp = () => {
    setIsSelecting(false);
  };

  const handleCrop = () => {
    const el = imgRef.current || videoRef.current;
    if (!selection || !el || selection.w < 10 || selection.h < 10) {
        alert("範囲を選択してください");
        return;
    }

    const { width, height, naturalWidth, naturalHeight } = getActiveElementDimensions();
    const scaleX = naturalWidth / width;
    const scaleY = naturalHeight / height;

    const realX = Math.floor(selection.x * scaleX);
    const realY = Math.floor(selection.y * scaleY);
    const realW = Math.floor(selection.w * scaleX);
    const realH = Math.floor(selection.h * scaleY);

    const padding = 20;
    const availW = TARGET_WIDTH - padding;
    const availH = TARGET_HEIGHT - padding;
    let computedScale = Math.min(availW / realW, availH / realH);
    if (computedScale > 1) computedScale = 1;

    if (isVideoMode) {
        let representativeDataUrl = '';
        if (videoRef.current) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = realW;
            tempCanvas.height = realH;
            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
                tempCtx.drawImage(videoRef.current, realX, realY, realW, realH, 0, 0, realW, realH);
                representativeDataUrl = tempCanvas.toDataURL('image/png');
            }
        }
        const stampId = `stamp-animated-${Date.now()}`;
        const newStamp: Stamp = {
            id: stampId,
            sourceImageId: 'animated-video',
            originalX: realX,
            originalY: realY,
            width: realW,
            height: realH,
            dataUrl: representativeDataUrl,
            originalDataUrl: representativeDataUrl,
            isExcluded: false,
            scale: computedScale,
            offsetX: 0,
            offsetY: 0,
            isAnimated: true
        };
        onConfirm(newStamp);
        return;
    }

    if (!activeImage) return;

    // Create Canvas to extract and process
    const canvas = document.createElement('canvas');
    canvas.width = realW;
    canvas.height = realH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw the cropped area
    ctx.drawImage(imgRef.current!, realX, realY, realW, realH, 0, 0, realW, realH);
    
    // Save the raw cropped image for restoration
    const originalDataUrl = canvas.toDataURL('image/png');

    // Auto-remove background using Flood Fill based on Top-Left corner color
    const imageData = ctx.getImageData(0, 0, realW, realH);
    const data = imageData.data;
    const w = realW;
    const h = realH;
    
    // Use Top-Left corner as background color reference
    const bgR = data[0];
    const bgG = data[1];
    const bgB = data[2];
    const tolerance = 40;
    const limit = tolerance * 3;

    // Flood Fill
    const stack: [number, number][] = [];
    const visited = new Uint8Array(w * h);

    // Seed corners (Top-Left, Top-Right, Bottom-Left, Bottom-Right)
    stack.push([0, 0]);
    stack.push([w-1, 0]);
    stack.push([0, h-1]);
    stack.push([w-1, h-1]);

    while(stack.length > 0) {
        const [x, y] = stack.pop()!;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        
        const idx = y * w + x;
        if (visited[idx]) continue;
        
        const pIdx = idx * 4;
        const r = data[pIdx];
        const g = data[pIdx+1];
        const b = data[pIdx+2];
        
        const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
        
        if (diff < limit) {
             data[pIdx+3] = 0; // Transparent
             visited[idx] = 1;
             
             stack.push([x+1, y]);
             stack.push([x-1, y]);
             stack.push([x, y+1]);
             stack.push([x, y-1]);
         }
    }
    
    ctx.putImageData(imageData, 0, 0);

    const stampId = `stamp-manual-${Date.now()}`;
    const newStamp: Stamp = {
        id: stampId,
        sourceImageId: activeImage.id,
        originalX: realX,
        originalY: realY,
        width: realW,
        height: realH,
        dataUrl: canvas.toDataURL('image/png'), // Transparent version
        originalDataUrl: originalDataUrl, // Raw version
        isExcluded: false,
        scale: computedScale,
        offsetX: 0,
        offsetY: 0
    };

    onConfirm(newStamp);
  };

  const handleUploadNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
          const newId = await onAddSource(e.target.files[0]);
          if (newId) setActiveSourceId(newId);
          e.target.value = ''; // Reset input to allow re-selecting same file
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full flex flex-col h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-primary-50 rounded-t-xl shrink-0">
            <div className="flex items-center gap-2">
                <Crop className="text-primary-600" />
                <div>
                    <h3 className="font-bold text-gray-700">手動で切り出し</h3>
                    <p className="text-xs text-gray-500">元画像からスタンプにしたい範囲をドラッグしてください</p>
                </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition"><X size={20} /></button>
        </div>
        
        {/* Source Image Selector */}
        <div className="bg-gray-100 p-2 flex gap-2 overflow-x-auto border-b shrink-0">
            {sourceImages.map(img => (
                <button
                    key={img.id}
                    onClick={() => { setActiveSourceId(img.id); setSelection(null); }}
                    className={`relative w-16 h-16 rounded-md overflow-hidden border-2 flex-shrink-0 transition ${activeSourceId === img.id ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-300 opacity-60 hover:opacity-100'}`}
                >
                    <img src={img.url} alt="thumb" className="w-full h-full object-cover" />
                </button>
            ))}
            {animatedVideoUrl && (
                <button
                    key="animated-video"
                    onClick={() => { setActiveSourceId('animated-video'); setSelection(null); }}
                    className={`relative w-16 h-16 rounded-md border-2 flex-shrink-0 transition flex flex-col items-center justify-center bg-gray-800 text-white ${activeSourceId === 'animated-video' ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-300 opacity-60 hover:opacity-100'}`}
                >
                    <span className="text-[10px] font-bold">動画</span>
                    <span className="text-[9px] text-gray-400">コラージュ</span>
                </button>
            )}
            {/* Always allow adding in Manual Crop mode */}
            <label className="w-16 h-16 rounded-md border-2 border-dashed border-gray-400 flex flex-col items-center justify-center text-gray-500 bg-gray-50 hover:bg-white cursor-pointer flex-shrink-0">
                <Plus size={16} />
                <span className="text-[10px]">追加</span>
                <input type="file" className="hidden" accept="image/png, image/jpeg" onChange={handleUploadNew} />
            </label>
        </div>

        {/* Change: Remove items-center justify-center from the scrollable container to prevent top/left clipping when scrolled */}
        <div className="flex-1 overflow-auto p-4 bg-gray-900 relative select-none" ref={containerRef}>
            {/* Wrap in a flex container that grows to ensure centering only if image is smaller than container */}
            <div className="min-w-full min-h-full flex flex-col items-center justify-center">
                {(activeImage || isVideoMode) ? (
                    <div className="relative inline-block touch-none">
                        {isVideoMode ? (
                            <video 
                                ref={videoRef}
                                src={animatedVideoUrl} 
                                className="max-w-none pointer-events-none"
                                style={{ maxWidth: '100%', maxHeight: '60vh' }}
                                muted
                                playsInline
                                loop
                                autoPlay
                            />
                        ) : (
                            <img 
                                ref={imgRef}
                                src={activeImage!.url} 
                                className="max-w-none pointer-events-none" // Use max-w-none to allow natural size scrolling
                                style={{ maxWidth: '100%' }}
                                alt="Original"
                            />
                        )}
                        {/* Overlay for selection */}
                        <div 
                            className="absolute inset-0 cursor-crosshair"
                            onMouseDown={handlePointerDown}
                            onMouseMove={handlePointerMove}
                            onMouseUp={handlePointerUp}
                            onMouseLeave={handlePointerUp}
                            onTouchStart={handlePointerDown}
                            onTouchMove={handlePointerMove}
                            onTouchEnd={handlePointerUp}
                        >
                            {selection && (
                                <div 
                                    className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                                    style={{
                                        left: selection.x,
                                        top: selection.y,
                                        width: selection.w,
                                        height: selection.h
                                    }}
                                />
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-white">画像を選択してください</div>
                )}

                {isVideoMode && (
                    <div className="flex justify-center mt-4 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                const v = videoRef.current;
                                if (v) {
                                    if (v.paused) v.play();
                                    else v.pause();
                                }
                            }}
                            className="px-4 py-1.5 bg-gray-800 text-white border border-gray-700 rounded-lg hover:bg-gray-750 transition font-bold text-xs shadow-md"
                        >
                            動画の 再生 / 一時停止
                        </button>
                    </div>
                )}
            </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-3 bg-gray-50 rounded-b-xl shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition">キャンセル</button>
          <button onClick={handleCrop} className="px-6 py-2 bg-primary-600 text-white font-bold rounded-lg shadow hover:bg-primary-700 transition flex items-center gap-2">
            <Check size={18} /> この範囲で作成
          </button>
        </div>
      </div>
    </div>
  );
};