import React, { useRef, useEffect, useState } from 'react';
import { Stamp, TextObject, ImageLayerObject, DrawingStroke, TARGET_WIDTH, TARGET_HEIGHT } from '../types';
import { Check, X, Sliders, Layers, Trash2, Move, Type, Image as ImageIcon, PenTool, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Eraser, Wand2 } from 'lucide-react';
import { drawTextOnCanvas } from '../lib/zipService';
import { reprocessStampWithTolerance } from '../lib/imageProcessing';
import { saveMaterial, loadMaterials, deleteMaterial, MaterialItem } from '../lib/storage';
import { getSortedLayers, getNextLayerOrder, moveLayerUp, moveLayerDown, getLayerDisplayName } from '../lib/layerUtils';

import { TextEditPanel } from './editor/TextEditPanel';
import { ImageControlPanel } from './editor/ImageControlPanel';
import { ImageLayerPanel } from './editor/ImageLayerPanel';
import { DrawingPanel } from './editor/DrawingPanel';
import { EditorToolbar } from './editor/EditorToolbar';
import { ModeSelector } from './editor/ModeSelector';
import { ControlSlider } from './editor/ControlSlider';
import { CollapsiblePanel } from './editor/CollapsiblePanel';
import { LayerOrderPanel } from './editor/LayerOrderPanel';

const backgroundOptions = [
    { value: 'checker', label: '透明', color: 'bg-gray-200' }, 
    { value: '#ffffff', label: '白', color: 'bg-white border' },
    { value: '#ff00ff', label: 'マゼンタ', color: 'bg-[#ff00ff]' },
    { value: '#60a5fa', label: '青', color: 'bg-[#60a5fa]' },
    { value: '#000000', label: '黒', color: 'bg-black' },
    { value: '#16a34a', label: '緑', color: 'bg-[#16a34a]' },
    { value: '#f97316', label: 'オレンジ', color: 'bg-[#f97316]' },
];

const LINE_ANIMATION_DURATIONS = [1, 2, 3, 4];

interface Props {
  stamp: Stamp;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedStamp: Stamp) => void;
  onReCrop?: () => void; 
  initialPreviewBg?: string; 
  targetWidth?: number;
  targetHeight?: number;
  initialScale?: number;
  initialRotation?: number;
  initialOffset?: { x: number, y: number };
  initialTextObjects?: TextObject[];
  initialImageLayers?: ImageLayerObject[];
  initialDrawingStrokes?: DrawingStroke[];
  staticFrameSourceFrames?: string[];
  staticFrameIndex?: number;
  onStaticFrameSelect?: (frameIndex: number) => void;
}

interface HistoryState {
    scale: number;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    offset: { x: number, y: number };
    dataUrl: string;
    tolerance: number;
    textObjects: TextObject[];
    imageLayers: ImageLayerObject[];
    drawingStrokes: DrawingStroke[];
    mainImageLayerOrder: number;
    currentFrameIndex?: number;
    frames?: string[];
    originalFrames?: string[];
    framesTextObjects?: TextObject[][];
    framesImageLayers?: ImageLayerObject[][];
    framesDrawingStrokes?: DrawingStroke[][];
    framesScales?: number[];
    framesRotations?: number[];
    framesOffsetsX?: number[];
    framesOffsetsY?: number[];
    framesFlipsH?: boolean[];
    framesFlipsV?: boolean[];
    playbackDuration?: number;
}

export const StampEditorModal: React.FC<Props> = ({ 
  stamp, 
  isOpen, 
  onClose, 
  onSave, 
  onReCrop,
  initialPreviewBg = 'checker',
  targetWidth = TARGET_WIDTH,
  targetHeight = TARGET_HEIGHT,
  initialScale,
  initialRotation,
  initialOffset,
  initialTextObjects,
  initialImageLayers,
  initialDrawingStrokes,
  staticFrameSourceFrames,
  staticFrameIndex = 0,
  onStaticFrameSelect
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Image State
  const [scale, setScaleState] = useState(initialScale ?? stamp.scale);
  const [rotation, setRotationState] = useState(initialRotation ?? stamp.rotation ?? 0);
  const [offset, setOffsetState] = useState(initialOffset ?? { x: stamp.offsetX, y: stamp.offsetY });
  const [flipH, setFlipHState] = useState(stamp.flipH ?? false);
  const [flipV, setFlipVState] = useState(stamp.flipV ?? false);
  const [mainImageLayerOrder, setMainImageLayerOrder] = useState(stamp.mainImageLayerOrder ?? 100);
  
  // Animated Frame Specific State
  const [frames, setFramesState] = useState<string[]>([]);
  const [originalFrames, setOriginalFrames] = useState<string[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [staticSelectedFrameIndex, setStaticSelectedFrameIndex] = useState(staticFrameIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackDuration, setPlaybackDuration] = useState(() => {
    const frameCount = stamp.rawFrames?.length || 1;
    return stamp.playbackDuration ?? Math.min(4, Math.max(1, Math.round(frameCount / (stamp.fps || 10))));
  });
  
  const [framesTextObjects, setFramesTextObjects] = useState<TextObject[][]>([]);
  const [framesImageLayers, setFramesImageLayers] = useState<ImageLayerObject[][]>([]);
  const [framesDrawingStrokes, setFramesDrawingStrokes] = useState<DrawingStroke[][]>([]);
  
  const [framesScales, setFramesScales] = useState<number[]>([]);
  const [framesRotations, setFramesRotations] = useState<number[]>([]);
  const [framesOffsetsX, setFramesOffsetsX] = useState<number[]>([]);
  const [framesOffsetsY, setFramesOffsetsY] = useState<number[]>([]);
  const [framesFlipsH, setFramesFlipsH] = useState<boolean[]>([]);
  const [framesFlipsV, setFramesFlipsV] = useState<boolean[]>([]);
  const [applyTransformToAll, setApplyTransformToAll] = useState(true);

  // Sync state wrappers that support modifying individual frames or all frames
  const setScale = (val: number | ((prev: number) => number)) => {
    setScaleState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesScales(p => {
          if (applyTransformToAll) {
            return Array.from({ length: frames.length }, () => next);
          } else {
            const copy = [...p];
            copy[currentFrameIndex] = next;
            return copy;
          }
        });
      }
      return next;
    });
  };

  const setRotation = (val: number | ((prev: number) => number)) => {
    setRotationState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesRotations(p => {
          if (applyTransformToAll) {
            return Array.from({ length: frames.length }, () => next);
          } else {
            const copy = [...p];
            copy[currentFrameIndex] = next;
            return copy;
          }
        });
      }
      return next;
    });
  };

  const setOffset = (val: { x: number, y: number } | ((prev: { x: number, y: number }) => { x: number, y: number })) => {
    setOffsetState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesOffsetsX(p => {
          if (applyTransformToAll) return Array.from({ length: frames.length }, () => next.x);
          const copy = [...p]; copy[currentFrameIndex] = next.x; return copy;
        });
        setFramesOffsetsY(p => {
          if (applyTransformToAll) return Array.from({ length: frames.length }, () => next.y);
          const copy = [...p]; copy[currentFrameIndex] = next.y; return copy;
        });
      }
      return next;
    });
  };

  const setFlipH = (val: boolean | ((prev: boolean) => boolean)) => {
    setFlipHState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesFlipsH(p => {
          if (applyTransformToAll) {
            return Array.from({ length: frames.length }, () => next);
          } else {
            const copy = [...p];
            copy[currentFrameIndex] = next;
            return copy;
          }
        });
      }
      return next;
    });
  };

  const setFlipV = (val: boolean | ((prev: boolean) => boolean)) => {
    setFlipVState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesFlipsV(p => {
          if (applyTransformToAll) {
            return Array.from({ length: frames.length }, () => next);
          } else {
            const copy = [...p];
            copy[currentFrameIndex] = next;
            return copy;
          }
        });
      }
      return next;
    });
  };

  // Copy Dialog State
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copyTargetStart, setCopyTargetStart] = useState<number>(1);
  const [copyTargetEnd, setCopyTargetEnd] = useState<number>(stamp.rawFrames?.length || 1);
  const [copyMethod, setCopyMethod] = useState<'overwrite' | 'add'>('add');
  const [copyText, setCopyText] = useState(true);
  const [copyImage, setCopyImage] = useState(true);
  const [copyDrawing, setCopyDrawing] = useState(true);

  // Text State
  const [textObjects, setTextObjectsState] = useState<TextObject[]>(initialTextObjects ?? stamp.textObjects ?? []);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

  // Image Layer State
  const [imageLayers, setImageLayersState] = useState<ImageLayerObject[]>(initialImageLayers ?? stamp.imageLayers ?? []);
  const [selectedImageLayerId, setSelectedImageLayerId] = useState<string | null>(null);
  const [isResizingImageLayer, setIsResizingImageLayer] = useState(false);
  const [activeImageLayerHandle, setActiveImageLayerHandle] = useState<'tl'|'tr'|'bl'|'br'|null>(null);

  // Automatic state wrappers that synchronize any frame edit to the currently active frame
  const setTextObjects = (val: TextObject[] | ((prev: TextObject[]) => TextObject[])) => {
    setTextObjectsState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesTextObjects(p => {
          const c = [...p];
          c[currentFrameIndex] = next;
          return c;
        });
      }
      return next;
    });
  };

  const setImageLayers = (val: ImageLayerObject[] | ((prev: ImageLayerObject[]) => ImageLayerObject[])) => {
    setImageLayersState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesImageLayers(p => {
          const c = [...p];
          c[currentFrameIndex] = next;
          return c;
        });
      }
      return next;
    });
  };

  const setDrawingStrokes = (val: DrawingStroke[] | ((prev: DrawingStroke[]) => DrawingStroke[])) => {
    setDrawingStrokesState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesDrawingStrokes(p => {
          const c = [...p];
          c[currentFrameIndex] = next;
          return c;
        });
      }
      return next;
    });
  };

  // Keep track of latest imageLayers for async checks
  const imageLayersRef = useRef<ImageLayerObject[]>([]);
  useEffect(() => { imageLayersRef.current = imageLayers; }, [imageLayers]);

  // Materials State
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Drawing State
  const [drawingStrokes, setDrawingStrokesState] = useState<DrawingStroke[]>(initialDrawingStrokes ?? stamp.drawingStrokes ?? []);
  const [selectedDrawingStrokeId, setSelectedDrawingStrokeId] = useState<string | null>(null);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[] | null>(null);
  const [penColor, setPenColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(4);
  const [penOpacity, setPenOpacity] = useState(1.0);
  const [penZIndex, setPenZIndex] = useState<'front' | 'back'>('front');
  const [penOutlineColor, setPenOutlineColor] = useState('#ffffff');
  const [penOutlineWidth, setPenOutlineWidth] = useState(0);

  // Panel Collapsed State
  const [panelCollapsed, setPanelCollapsed] = useState<Record<string, boolean>>({
    move: false,
    text: false,
    image: false,
    draw: false,
    layers: false,
  });

  const togglePanel = (key: string) => {
    setPanelCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // History State
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Editor View state
  const [viewZoom, setViewZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const panContainerRef = useRef<HTMLDivElement>(null);
  const [previewBg, setPreviewBg] = useState(initialPreviewBg);

  const [mode, setMode] = useState<'move' | 'eraser' | 'wand' | 'restore' | 'text' | 'image' | 'draw'>('move');
  const [isDragging, setIsDragging] = useState(false);
  const [isResizingText, setIsResizingText] = useState(false);
  
  // Cursor visual state
  const [cursorPos, setCursorPos] = useState<{x: number, y: number} | null>(null);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [eraserSize, setEraserSize] = useState(20);
  
  const [activeTextHandle, setActiveTextHandle] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null);

  // Pinch & Resize State
  const [pinchStartDist, setPinchStartDist] = useState<number | null>(null);
  const [pinchStartScale, setPinchStartScale] = useState<number>(1);
  const [pinchStartAngle, setPinchStartAngle] = useState<number | null>(null);
  const [pinchStartRotation, setPinchStartRotation] = useState<number>(0);
  
  // Image Resizing State
  const [isResizingImage, setIsResizingImage] = useState(false);
  const [activeImageHandle, setActiveImageHandle] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null);

  const [tolerance, setTolerance] = useState(stamp.currentTolerance || 50);

  const [workingDataUrl, setWorkingDataUrlState] = useState(stamp.dataUrl);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [sourceSize, setSourceSize] = useState({ w: stamp.width, h: stamp.height });
  const originalLoadSeqRef = useRef(0);

  const loadImageElement = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

  const loadOriginalImage = (url?: string, matchFrameUrl?: string) => {
    const seq = ++originalLoadSeqRef.current;
    if (!url) {
      setOriginalImage(null);
      return;
    }
    Promise.all([
      loadImageElement(url),
      matchFrameUrl ? loadImageElement(matchFrameUrl) : Promise.resolve(null)
    ]).then(([img, matchImg]) => {
      if (originalLoadSeqRef.current !== seq) return;
      if (!matchImg || (img.width === matchImg.width && img.height === matchImg.height)) {
        setOriginalImage(img);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = matchImg.width;
      canvas.height = matchImg.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setOriginalImage(img);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fitScale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const drawW = Math.max(1, Math.round(img.width * fitScale));
      const drawH = Math.max(1, Math.round(img.height * fitScale));
      const drawX = Math.round((canvas.width - drawW) / 2);
      const drawY = Math.round((canvas.height - drawH) / 2);
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      const normalized = new Image();
      normalized.onload = () => {
        if (originalLoadSeqRef.current === seq) setOriginalImage(normalized);
      };
      normalized.src = canvas.toDataURL('image/png');
    }).catch(() => {
      if (originalLoadSeqRef.current === seq) setOriginalImage(null);
    });
  };

  const setWorkingDataUrl = (val: string | ((prev: string) => string)) => {
    setWorkingDataUrlState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      if (stamp.isAnimated) {
        setFramesState(p => {
          const c = [...p];
          c[currentFrameIndex] = next;
          return c;
        });
      }
      return next;
    });
  };

  const updateActiveFrameImage = (dataUrl: string) => {
    setWorkingDataUrlState(dataUrl);
    if (stamp.isAnimated) {
      setFramesState(prev => {
        const copy = [...prev];
        copy[currentFrameIndex] = dataUrl;
        return copy;
      });
    }
  };
  
  // Debounce for tolerance
  const toleranceTimeoutRef = useRef<number | null>(null);
  // Edit canvas for eraser/restore operations to avoid creating new images constantly
  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastBrushTimeRef = useRef<number>(0);
  const pendingBrushRef = useRef<number | null>(null);
  
  // Cache for image layers to prevent flickering
  const imageLayerCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Load Image Layer Cache
  useEffect(() => {
    const cache = imageLayerCacheRef.current;
    
    // Load new images
    imageLayers.forEach(layer => {
      if (!cache.has(layer.id)) {
        const img = new Image();
        img.src = layer.dataUrl;
        img.onload = () => {
          cache.set(layer.id, img);
          drawCanvas(); // Redraw once loaded
        };
      }
    });
    
    // Cleanup removed images
    const currentIds = new Set(imageLayers.map(l => l.id));
    for (const id of cache.keys()) {
        if (!currentIds.has(id)) {
            cache.delete(id);
        }
    }
  }, [imageLayers]);

  useEffect(() => {
    if (isOpen) {
      setScale(initialScale ?? stamp.scale);
      setRotation(initialRotation ?? stamp.rotation ?? 0);
      setOffset(initialOffset ?? { x: stamp.offsetX, y: stamp.offsetY });
      setFlipH(stamp.flipH ?? false);
      setFlipV(stamp.flipV ?? false);
      setMainImageLayerOrder(stamp.mainImageLayerOrder ?? 100);
      setApplyTransformToAll(true);
      setSourceSize({ w: stamp.width, h: stamp.height });
      setMode('move');
      setViewZoom(1);
      setCanvasPan({ x: 0, y: 0 });
      setTolerance(stamp.currentTolerance || 50);
      setSelectedTextId(null);
      setSelectedImageLayerId(null);
      setSelectedDrawingStrokeId(null);
      const initialStaticFrameIndex = Math.min(
        Math.max(0, staticFrameIndex),
        Math.max(0, (staticFrameSourceFrames?.length || 1) - 1)
      );
      setStaticSelectedFrameIndex(initialStaticFrameIndex);

      let fTexts: TextObject[][] = [];
      let fImages: ImageLayerObject[][] = [];
      let fDrawings: DrawingStroke[][] = [];
      let initFrames: string[] = [];
      let initOriginalFrames: string[] = [];

      if (stamp.isAnimated && stamp.rawFrames) {
        const N = stamp.rawFrames.length;
        initFrames = [...stamp.rawFrames];
        setFramesState(initFrames);

        const rawOrig = stamp.rawOriginalFrames || [];
        initOriginalFrames = Array.from({ length: N }, (_, i) => rawOrig[i] || stamp.originalDataUrl || stamp.rawFrames![i]);
        setOriginalFrames(initOriginalFrames);

        setCurrentFrameIndex(0);
        setPlaybackDuration(stamp.playbackDuration ?? Math.min(4, Math.max(1, Math.round(N / (stamp.fps || 10)))));

        fTexts = stamp.textObjectsFrames || Array.from({ length: N }, () => []);
        fImages = stamp.imageLayersFrames || Array.from({ length: N }, () => []);
        fDrawings = stamp.drawingStrokesFrames || Array.from({ length: N }, () => []);

        setFramesTextObjects(fTexts);
        setFramesImageLayers(fImages);
        setFramesDrawingStrokes(fDrawings);

        setFramesScales(stamp.scalesFrames || Array.from({ length: N }, () => stamp.scale));
        setFramesRotations(stamp.rotationsFrames || Array.from({ length: N }, () => stamp.rotation || 0));
        setFramesOffsetsX(stamp.offsetsXFrames || Array.from({ length: N }, () => stamp.offsetX));
        setFramesOffsetsY(stamp.offsetsYFrames || Array.from({ length: N }, () => stamp.offsetY));
        setFramesFlipsH(stamp.flipsHFrames || Array.from({ length: N }, () => stamp.flipH || false));
        setFramesFlipsV(stamp.flipsVFrames || Array.from({ length: N }, () => stamp.flipV || false));

        setWorkingDataUrlState(stamp.rawFrames[0]);
        setTextObjectsState(fTexts[0] || []);
        setImageLayersState(fImages[0] || []);
        setDrawingStrokesState(fDrawings[0] || []);
      } else {
        setFramesState([]);
        setOriginalFrames([]);
        setCurrentFrameIndex(0);
        setFramesTextObjects([]);
        setFramesImageLayers([]);
        setFramesDrawingStrokes([]);
        setFramesScales([]);
        setFramesRotations([]);
        setFramesOffsetsX([]);
        setFramesOffsetsY([]);
        setFramesFlipsH([]);
        setFramesFlipsV([]);
        setWorkingDataUrlState(staticFrameSourceFrames?.[initialStaticFrameIndex] || stamp.dataUrl);
        setTextObjectsState(initialTextObjects ?? stamp.textObjects ?? []);
        setImageLayersState(initialImageLayers ?? stamp.imageLayers ?? []);
        setDrawingStrokesState(initialDrawingStrokes ?? stamp.drawingStrokes ?? []);
      }

      const initialState: HistoryState = {
          scale: initialScale ?? stamp.scale,
          rotation: initialRotation ?? stamp.rotation ?? 0,
          flipH: stamp.flipH ?? false,
          flipV: stamp.flipV ?? false,
          offset: initialOffset ?? { x: stamp.offsetX, y: stamp.offsetY },
          dataUrl: stamp.isAnimated && stamp.rawFrames ? stamp.rawFrames[0] : (staticFrameSourceFrames?.[initialStaticFrameIndex] || stamp.dataUrl),
          tolerance: stamp.currentTolerance || 50,
          textObjects: stamp.isAnimated && fTexts.length > 0 ? (fTexts[0] || []) : (initialTextObjects ?? stamp.textObjects ?? []),
          imageLayers: stamp.isAnimated && fImages.length > 0 ? (fImages[0] || []) : (initialImageLayers ?? stamp.imageLayers ?? []),
          drawingStrokes: stamp.isAnimated && fDrawings.length > 0 ? (fDrawings[0] || []) : (initialDrawingStrokes ?? stamp.drawingStrokes ?? []),
          mainImageLayerOrder: stamp.mainImageLayerOrder ?? 100,
          currentFrameIndex: 0,
          frames: stamp.isAnimated && stamp.rawFrames ? [...stamp.rawFrames] : [],
          originalFrames: stamp.isAnimated && stamp.rawFrames ? initOriginalFrames : [],
          framesTextObjects: fTexts,
          framesImageLayers: fImages,
          framesDrawingStrokes: fDrawings,
          framesScales: stamp.isAnimated && stamp.rawFrames ? (stamp.scalesFrames || Array.from({ length: stamp.rawFrames.length }, () => stamp.scale)) : [],
          framesRotations: stamp.isAnimated && stamp.rawFrames ? (stamp.rotationsFrames || Array.from({ length: stamp.rawFrames.length }, () => stamp.rotation || 0)) : [],
          framesOffsetsX: stamp.isAnimated && stamp.rawFrames ? (stamp.offsetsXFrames || Array.from({ length: stamp.rawFrames.length }, () => stamp.offsetX)) : [],
          framesOffsetsY: stamp.isAnimated && stamp.rawFrames ? (stamp.offsetsYFrames || Array.from({ length: stamp.rawFrames.length }, () => stamp.offsetY)) : [],
          framesFlipsH: stamp.isAnimated && stamp.rawFrames ? (stamp.flipsHFrames || Array.from({ length: stamp.rawFrames.length }, () => stamp.flipH || false)) : [],
          framesFlipsV: stamp.isAnimated && stamp.rawFrames ? (stamp.flipsVFrames || Array.from({ length: stamp.rawFrames.length }, () => stamp.flipV || false)) : [],
          playbackDuration: stamp.isAnimated && stamp.rawFrames ? (stamp.playbackDuration ?? Math.min(4, Math.max(1, Math.round(stamp.rawFrames.length / (stamp.fps || 10))))) : undefined,
      };
      setHistory([initialState]);
      setHistoryIndex(0);

      const firstOrigUrl = stamp.isAnimated && stamp.rawFrames 
        ? (initOriginalFrames[0] || stamp.originalDataUrl || initFrames[0])
        : (staticFrameSourceFrames?.[initialStaticFrameIndex] || stamp.originalDataUrl);

      loadOriginalImage(firstOrigUrl, stamp.isAnimated ? initFrames[0] : undefined);

      // Load Materials
      loadMaterials().then(setMaterials).catch(console.error);
    }
  }, [isOpen, stamp, initialScale, initialRotation, initialOffset, initialTextObjects, initialImageLayers, initialDrawingStrokes, staticFrameSourceFrames, staticFrameIndex]);

  // Handle switching frames (update the displayed canvas and editor objects to match target frame state)
  useEffect(() => {
    if (isOpen && stamp.isAnimated && frames.length > 0) {
      setWorkingDataUrlState(frames[currentFrameIndex]);
      
      const orig = originalFrames[currentFrameIndex] || stamp.originalDataUrl || frames[currentFrameIndex];
      loadOriginalImage(orig, frames[currentFrameIndex]);
      
      setTextObjectsState(framesTextObjects[currentFrameIndex] || []);
      setImageLayersState(framesImageLayers[currentFrameIndex] || []);
      setDrawingStrokesState(framesDrawingStrokes[currentFrameIndex] || []);

      setScaleState(framesScales[currentFrameIndex] ?? stamp.scale);
      setRotationState(framesRotations[currentFrameIndex] ?? stamp.rotation ?? 0);
      setOffsetState({
        x: framesOffsetsX[currentFrameIndex] ?? stamp.offsetX,
        y: framesOffsetsY[currentFrameIndex] ?? stamp.offsetY
      });
      setFlipHState(framesFlipsH[currentFrameIndex] ?? stamp.flipH ?? false);
      setFlipVState(framesFlipsV[currentFrameIndex] ?? stamp.flipV ?? false);

      setSelectedTextId(null);
      setSelectedImageLayerId(null);
      setSelectedDrawingStrokeId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrameIndex, isOpen, stamp.isAnimated]);

  const handleStaticSourceFrameSelect = (frameIndex: number) => {
    if (!staticFrameSourceFrames?.[frameIndex]) return;
    const frameUrl = staticFrameSourceFrames[frameIndex];
    setStaticSelectedFrameIndex(frameIndex);
    onStaticFrameSelect?.(frameIndex);
    setWorkingDataUrlState(frameUrl);
    loadOriginalImage(frameUrl, frameUrl);
    addToHistory({ dataUrl: frameUrl });
  };

  // Autoplay function for animated frames
  useEffect(() => {
    if (!isPlaying || !stamp.isAnimated || !frames || frames.length === 0) return;
    const intervalTime = (playbackDuration * 1000) / frames.length;
    const timer = setInterval(() => {
      setCurrentFrameIndex(prev => (prev + 1) % frames.length);
    }, intervalTime);
    return () => clearInterval(timer);
  }, [isPlaying, frames, playbackDuration, stamp.isAnimated]);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    drawCanvas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scale, rotation, flipH, flipV, offset, workingDataUrl, previewBg, targetWidth, targetHeight, cursorPos, mode, eraserSize, textObjects, selectedTextId, imageLayers, selectedImageLayerId, drawingStrokes, currentStroke, penColor, penWidth, penOpacity, penOutlineColor, penOutlineWidth, mainImageLayerOrder, currentFrameIndex]); 

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const addToHistory = (newState: Partial<HistoryState>) => {
      const currentState: HistoryState = {
          scale,
          rotation,
          flipH,
          flipV,
          offset,
          dataUrl: workingDataUrl,
          tolerance,
          textObjects,
          imageLayers,
          drawingStrokes,
          mainImageLayerOrder,
          currentFrameIndex,
          frames: [...frames],
          originalFrames: [...originalFrames],
          framesTextObjects: framesTextObjects.map(arr => [...arr]),
          framesImageLayers: framesImageLayers.map(arr => [...arr]),
          framesDrawingStrokes: framesDrawingStrokes.map(arr => [...arr]),
          framesScales: [...framesScales],
          framesRotations: [...framesRotations],
          framesOffsetsX: [...framesOffsetsX],
          framesOffsetsY: [...framesOffsetsY],
          framesFlipsH: [...framesFlipsH],
          framesFlipsV: [...framesFlipsV],
          playbackDuration,
          ...newState
      };
      
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(currentState);
      if (newHistory.length > 20) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
      if (historyIndex > 0) {
          const prevIndex = historyIndex - 1;
          const prevState = history[prevIndex];
          setScale(prevState.scale);
          setRotation(prevState.rotation);
          setFlipH(prevState.flipH ?? false);
          setFlipV(prevState.flipV ?? false);
          setOffset(prevState.offset);
          setTolerance(prevState.tolerance);
          setMainImageLayerOrder(prevState.mainImageLayerOrder);
          if (prevState.playbackDuration !== undefined) setPlaybackDuration(prevState.playbackDuration);
          
          if (stamp.isAnimated && prevState.framesTextObjects) {
              setFramesTextObjects(prevState.framesTextObjects);
              setFramesImageLayers(prevState.framesImageLayers || []);
              setFramesDrawingStrokes(prevState.framesDrawingStrokes || []);
              setFramesState(prevState.frames || []);
              setOriginalFrames(prevState.originalFrames || []);
              setFramesScales(prevState.framesScales || []);
              setFramesRotations(prevState.framesRotations || []);
              setFramesOffsetsX(prevState.framesOffsetsX || []);
              setFramesOffsetsY(prevState.framesOffsetsY || []);
              setFramesFlipsH(prevState.framesFlipsH || []);
              setFramesFlipsV(prevState.framesFlipsV || []);
              if (prevState.currentFrameIndex !== undefined) {
                  setCurrentFrameIndex(prevState.currentFrameIndex);
              }
              // Sync active canvas selection
              const curIdx = prevState.currentFrameIndex ?? 0;
              setWorkingDataUrlState((prevState.frames || [])[curIdx] || prevState.dataUrl);
              setTextObjectsState((prevState.framesTextObjects || [])[curIdx] || []);
              setImageLayersState((prevState.framesImageLayers || [])[curIdx] || []);
              setDrawingStrokesState((prevState.framesDrawingStrokes || [])[curIdx] || []);
          } else {
              setWorkingDataUrl(prevState.dataUrl);
              setTextObjects(prevState.textObjects);
              setImageLayers(prevState.imageLayers);
              setDrawingStrokes(prevState.drawingStrokes);
          }
          
          setHistoryIndex(prevIndex);
      }
  };

  const redo = () => {
      if (historyIndex < history.length - 1) {
          const nextIndex = historyIndex + 1;
          const nextState = history[nextIndex];
          setScale(nextState.scale);
          setRotation(nextState.rotation);
          setFlipH(nextState.flipH ?? false);
          setFlipV(nextState.flipV ?? false);
          setOffset(nextState.offset);
          setTolerance(nextState.tolerance);
          setMainImageLayerOrder(nextState.mainImageLayerOrder);
          if (nextState.playbackDuration !== undefined) setPlaybackDuration(nextState.playbackDuration);
          
          if (stamp.isAnimated && nextState.framesTextObjects) {
              setFramesTextObjects(nextState.framesTextObjects);
              setFramesImageLayers(nextState.framesImageLayers || []);
              setFramesDrawingStrokes(nextState.framesDrawingStrokes || []);
              setFramesState(nextState.frames || []);
              setOriginalFrames(nextState.originalFrames || []);
              setFramesScales(nextState.framesScales || []);
              setFramesRotations(nextState.framesRotations || []);
              setFramesOffsetsX(nextState.framesOffsetsX || []);
              setFramesOffsetsY(nextState.framesOffsetsY || []);
              setFramesFlipsH(nextState.framesFlipsH || []);
              setFramesFlipsV(nextState.framesFlipsV || []);
              if (nextState.currentFrameIndex !== undefined) {
                  setCurrentFrameIndex(nextState.currentFrameIndex);
              }
              // Sync active canvas selection
              const curIdx = nextState.currentFrameIndex ?? 0;
              setWorkingDataUrlState((nextState.frames || [])[curIdx] || nextState.dataUrl);
              setTextObjectsState((nextState.framesTextObjects || [])[curIdx] || []);
              setImageLayersState((nextState.framesImageLayers || [])[curIdx] || []);
              setDrawingStrokesState((nextState.framesDrawingStrokes || [])[curIdx] || []);
          } else {
              setWorkingDataUrl(nextState.dataUrl);
              setTextObjects(nextState.textObjects);
              setImageLayers(nextState.imageLayers);
              setDrawingStrokes(nextState.drawingStrokes);
          }
          
          setHistoryIndex(nextIndex);
      }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'draw') {
      if (drawingStrokes.length === 0) {
        const newLayerId = 'stroke-' + Date.now().toString();
        const firstLayer: DrawingStroke = {
          id: newLayerId,
          points: [],
          color: penColor,
          width: penWidth,
          opacity: penOpacity,
          zIndex: penZIndex,
          layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, penZIndex),
          outlineColor: penOutlineColor,
          outlineWidth: penOutlineWidth,
          strokes: []
        };
        const newStrokes = [firstLayer];
        setDrawingStrokes(newStrokes);
        setSelectedDrawingStrokeId(newLayerId);
        addToHistory({ drawingStrokes: newStrokes });
      } else if (!selectedDrawingStrokeId || !drawingStrokes.some(s => s.id === selectedDrawingStrokeId)) {
        setSelectedDrawingStrokeId(drawingStrokes[drawingStrokes.length - 1].id);
      }
    }
  }, [isOpen, mode, drawingStrokes.length]);

  const sortedLayers = getSortedLayers(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground(ctx, canvas.width, canvas.height);

    const img = new Image();
    img.onload = () => {
        if (img.width !== sourceSize.w || img.height !== sourceSize.h) {
            setSourceSize({ w: img.width, h: img.height });
        }
        // Prepare common variables
        const drawnW = img.width * scale;
        const drawnH = img.height * scale;
        const cx = canvas.width / 2 + offset.x;
        const cy = canvas.height / 2 + offset.y;

        // Draw layers in order
        for (const layer of sortedLayers) {
            if (layer.type === 'mainImage') {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((rotation * Math.PI) / 180);
                ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
                ctx.drawImage(img, -drawnW / 2, -drawnH / 2, drawnW, drawnH);
                ctx.restore();
            } else if (layer.type === 'text') {
                const textObj = textObjects.find(t => t.id === layer.id);
                if (textObj) {
                    drawTextOnCanvas(ctx, textObj);
                }
            } else if (layer.type === 'imageLayer') {
                const imageLayer = imageLayers.find(l => l.id === layer.id);
                if (imageLayer) {
                    const cachedImg = imageLayerCacheRef.current.get(imageLayer.id);
                    if (cachedImg) drawImageLayer(ctx, imageLayer, cachedImg);
                }
            } else if (layer.type === 'drawing') {
                const stroke = drawingStrokes.find(s => s.id === layer.id);
                if (stroke) drawStroke(ctx, stroke);
            }
        }

        // --- Draw UI Overlays (Selection, Handles, Cursors) on TOP ---

        // 1. Image Layer Selection Handles
        if (mode === 'image' && selectedImageLayerId) {
            const layer = imageLayers.find(l => l.id === selectedImageLayerId);
            if (layer) drawImageLayerSelectionUI(ctx, layer);
        }

        // 2. Text Selection Handles
        if (mode === 'text' && selectedTextId) {
            const textObj = textObjects.find(t => t.id === selectedTextId);
            if (textObj) drawTextSelectionUI(ctx, textObj);
        }

        // 3. Main Image Selection Handles (Move mode)
        if (mode === 'move') {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((rotation * Math.PI) / 180);
            const hw = drawnW / 2;
            const hh = drawnH / 2;
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.strokeRect(-hw, -hh, drawnW, drawnH);
            const handleSize = 12; 
            ctx.fillStyle = '#ffffff';
            [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: -hw, y: hh }, { x: hw, y: hh }].forEach(c => {
                ctx.fillRect(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize);
                ctx.strokeRect(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize);
            });
            ctx.restore();
        }

        // 4. Current Drawing Stroke
        if (currentStroke && currentStroke.length >= 2) {
            ctx.save();
            ctx.globalAlpha = penOpacity;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const tracePath = () => {
                ctx.beginPath();
                ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
                for (let i = 1; i < currentStroke.length; i++) {
                    ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
                }
            };
            if (penOutlineWidth > 0) {
                tracePath();
                ctx.strokeStyle = penOutlineColor;
                ctx.lineWidth = penWidth + (penOutlineWidth * 2);
                ctx.stroke();
            }
            tracePath();
            ctx.strokeStyle = penColor;
            ctx.lineWidth = penWidth;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
            ctx.restore();
        }

        // 5. Canvas Border
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        // 6. Brush Cursor
        if ((mode === 'eraser' || mode === 'restore') && cursorPos) {
            ctx.beginPath();
            ctx.arc(cursorPos.x, cursorPos.y, eraserSize / 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 0.4;
            ctx.stroke();
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 0.4;
            ctx.stroke();
        }
        if (mode === 'draw' && cursorPos) {
            ctx.beginPath();
            ctx.arc(cursorPos.x, cursorPos.y, penWidth / 2, 0, Math.PI * 2);
            ctx.strokeStyle = penColor;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    };
    img.src = workingDataUrl;
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: DrawingStroke) => {
    const strokesToDraw = stroke.strokes && stroke.strokes.length > 0
      ? stroke.strokes
      : (stroke.points && stroke.points.length >= 2
        ? [{
            points: stroke.points,
            color: stroke.color,
            width: stroke.width,
            opacity: stroke.opacity,
            outlineColor: stroke.outlineColor,
            outlineWidth: stroke.outlineWidth
          }]
        : []);

    if (strokesToDraw.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Phase 1: Draw all outlines to merge them into a single continuous border
    strokesToDraw.forEach(s => {
      if (s.points.length < 2) return;
      const oWidth = s.outlineWidth ?? 0;
      if (oWidth > 0) {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.globalAlpha = s.opacity;
        ctx.strokeStyle = s.outlineColor || '#ffffff';
        ctx.lineWidth = s.width + (oWidth * 2);
        ctx.stroke();
      }
    });

    // Phase 2: Draw all foreground colored lines on top
    strokesToDraw.forEach(s => {
      if (s.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
      ctx.globalAlpha = s.opacity;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.stroke();
    });

    ctx.restore();
  };

  const drawImageLayer = (ctx: CanvasRenderingContext2D, layer: ImageLayerObject, layerImg: HTMLImageElement) => {
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    const w = layer.originalWidth * layer.scale;
    const h = layer.originalHeight * layer.scale;
    ctx.drawImage(layerImg, -w / 2, -h / 2, w, h);
    ctx.globalAlpha = 1.0;
    ctx.restore();
  };

  const drawImageLayerSelectionUI = (ctx: CanvasRenderingContext2D, layer: ImageLayerObject) => {
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    const w = layer.originalWidth * layer.scale;
    const h = layer.originalHeight * layer.scale;
    const hw = w / 2;
    const hh = h / 2;
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(-hw, -hh, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#8b5cf6';
    const handleSize = 10;
    [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: -hw, y: hh }, { x: hw, y: hh }].forEach(c => {
        ctx.fillRect(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize);
        ctx.strokeRect(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize);
    });
    ctx.restore();
  }

  const getTextBoundingBox = (ctx: CanvasRenderingContext2D, textObj: TextObject) => {
      ctx.font = `bold ${textObj.fontSize}px '${textObj.fontFamily}'`;
      const lines = textObj.text.split('\n');
      const lineHeight = textObj.fontSize * 1.2;
      let w = 0, h = 0;
      if (textObj.text.length === 0) { w = 40; h = 40; } 
      else if (textObj.isVertical) {
          w = lineHeight * lines.length;
          const maxChars = Math.max(...lines.map(l => l.length));
          h = textObj.fontSize * maxChars;
      } else {
          const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
          w = maxW;
          h = lineHeight * lines.length;
      }
      return { w: Math.max(20, w + 10), h: Math.max(20, h + 10) };
  };

  const drawTextSelectionUI = (ctx: CanvasRenderingContext2D, textObj: TextObject) => {
      ctx.save();
      ctx.translate(textObj.x, textObj.y);
      ctx.rotate((textObj.rotation * Math.PI) / 180);
      const { w, h } = getTextBoundingBox(ctx, textObj);
      const hw = w / 2;
      const hh = h / 2;
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-hw, -hh, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b82f6';
      const handleSize = 10;
      [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: -hw, y: hh }, { x: hw, y: hh }].forEach(c => {
          ctx.fillRect(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize);
          ctx.strokeRect(c.x - handleSize/2, c.y - handleSize/2, handleSize, handleSize);
      });
      ctx.restore();
  }

  const drawBackground = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (previewBg === 'checker') {
        const size = 10;
        for(let y=0; y<h; y+=size) {
            for(let x=0; x<w; x+=size) {
                ctx.fillStyle = ((x/size + y/size) % 2 === 0) ? '#f3f4f6' : '#e5e7eb';
                ctx.fillRect(x, y, size, size);
            }
        }
    } else {
        ctx.fillStyle = previewBg;
        ctx.fillRect(0, 0, w, h);
    }
  };

  const handleUpdateText = (id: string, updates: Partial<TextObject>) => {
      let extraUpdates = {};
      if (updates.zIndex !== undefined) {
          extraUpdates = {
              layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, updates.zIndex)
          };
      }
      const newObjects = textObjects.map(t => t.id === id ? { ...t, ...updates, ...extraUpdates } : t);
      setTextObjects(newObjects);
  };
  const handleTextChangeComplete = () => { addToHistory({ textObjects }); };
  const handleAddText = () => {
      if (textObjects.length >= 3) { showToast("テキストは最大3つまでです"); return; }
      const newText: TextObject = {
          id: Date.now().toString(), text: "", x: targetWidth / 2, y: targetHeight / 2, fontSize: 40, fontFamily: 'M PLUS Rounded 1c',
          color: '#000000', isVertical: false, outlineColor: '#ffffff', outlineWidth: 4, zIndex: 'front', rotation: 0, curvature: 0,
          layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, 'front')
      };
      const newObjects = [...textObjects, newText];
      setTextObjects(newObjects); setSelectedTextId(newText.id); addToHistory({ textObjects: newObjects }); setMode('text');
  };
  const handleDeleteText = () => {
      if (!selectedTextId) return;
      const newObjects = textObjects.filter(t => t.id !== selectedTextId);
      setTextObjects(newObjects); setSelectedTextId(null); addToHistory({ textObjects: newObjects });
  };
  const handleAddImageLayer = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    if (imageLayersRef.current.length >= 5) { showToast("画像レイヤーは最大5つまでです"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (imageLayersRef.current.length >= 5) { showToast("画像レイヤーは最大5つまでです"); return; }
      const img = new Image();
      img.onload = () => {
        if (imageLayersRef.current.length >= 5) { showToast("画像レイヤーは最大5つまでです"); return; }
        const maxDim = Math.min(targetWidth, targetHeight) * 0.5;
        const fitScale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const newLayer: ImageLayerObject = {
            id: 'img-' + Date.now().toString(), dataUrl: reader.result as string, originalWidth: img.width, originalHeight: img.height,
            x: targetWidth / 2, y: targetHeight / 2, scale: fitScale, rotation: 0, opacity: 1.0, zIndex: 'front',
            layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, 'front')
        };
        const newLayers = [...imageLayers, newLayer]; setImageLayers(newLayers); setSelectedImageLayerId(newLayer.id); addToHistory({ imageLayers: newLayers });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  const handleUpdateImageLayer = (id: string, updates: Partial<ImageLayerObject>) => {
    let extraUpdates = {};
    if (updates.zIndex !== undefined) {
        extraUpdates = {
            layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, updates.zIndex)
        };
    }
    setImageLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates, ...extraUpdates } : l));
  };
  const handleDeleteImageLayer = () => {
    if (!selectedImageLayerId) return;
    const newLayers = imageLayers.filter(l => l.id !== selectedImageLayerId);
    setImageLayers(newLayers); setSelectedImageLayerId(null); addToHistory({ imageLayers: newLayers });
  };
  const handleSaveAsMaterial = async () => {
    if (!selectedImageLayerId) return;
    const layer = imageLayers.find(l => l.id === selectedImageLayerId); if (!layer) return;
    const item: MaterialItem = {
      id: 'mat-' + Date.now().toString(), dataUrl: layer.dataUrl, width: layer.originalWidth, height: layer.originalHeight,
      name: '素材 ' + (materials.length + 1), createdAt: new Date().toISOString(),
    };
    await saveMaterial(item); setMaterials(prev => [...prev, item]); showToast('素材ライブラリに保存しました');
  };
  const handleAddFromMaterial = (mat: MaterialItem) => {
    if (imageLayersRef.current.length >= 5) { showToast("画像レイヤーは最大5つまでです"); return; }
    const maxDim = Math.min(targetWidth, targetHeight) * 0.5;
    const fitScale = Math.min(maxDim / mat.width, maxDim / mat.height, 1);
    const newLayer: ImageLayerObject = {
        id: 'img-' + Date.now().toString(), dataUrl: mat.dataUrl, originalWidth: mat.width, originalHeight: mat.height,
        x: targetWidth / 2, y: targetHeight / 2, scale: fitScale, rotation: 0, opacity: 1.0, zIndex: 'front',
        layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, 'front')
    };
    const newLayers = [...imageLayers, newLayer]; setImageLayers(newLayers); setSelectedImageLayerId(newLayer.id); addToHistory({ imageLayers: newLayers }); setShowMaterialLibrary(false);
  };
  const handleDeleteMaterialItem = async (id: string) => {
    try { await deleteMaterial(id); setMaterials(prev => prev.filter(m => m.id !== id)); showToast('素材を削除しました'); } 
    catch (err) { console.error('素材削除エラー:', err); }
  };
  const handleDeleteLastStroke = () => {
    if (drawingStrokes.length === 0) return;
    
    const selectedId = selectedDrawingStrokeId || drawingStrokes[drawingStrokes.length - 1].id;
    const layerIndex = drawingStrokes.findIndex(s => s.id === selectedId);
    
    if (layerIndex === -1) return;
    
    let newStrokes = [...drawingStrokes];
    const layer = { ...drawingStrokes[layerIndex] };
    
    if (!layer.strokes) {
        layer.strokes = [];
        if (layer.points && layer.points.length >= 2) {
            layer.strokes.push({
                points: layer.points,
                color: layer.color,
                width: layer.width,
                opacity: layer.opacity,
                outlineColor: layer.outlineColor,
                outlineWidth: layer.outlineWidth
            });
        }
    }
    
    if (layer.strokes.length > 0) {
        const updatedStrokes = layer.strokes.slice(0, -1);
        layer.strokes = updatedStrokes;
        if (updatedStrokes.length > 0) {
            const last = updatedStrokes[updatedStrokes.length - 1];
            layer.points = last.points;
            layer.color = last.color;
            layer.width = last.width;
            layer.opacity = last.opacity;
            layer.outlineColor = last.outlineColor;
            layer.outlineWidth = last.outlineWidth;
        } else {
            layer.points = [];
        }
        newStrokes[layerIndex] = layer;
    } else {
        newStrokes.splice(layerIndex, 1);
        if (selectedDrawingStrokeId === selectedId) {
            setSelectedDrawingStrokeId(newStrokes.length > 0 ? newStrokes[newStrokes.length - 1].id : null);
        }
    }
    
    setDrawingStrokes(newStrokes);
    addToHistory({ drawingStrokes: newStrokes });
  };
  const handleClearAllStrokes = () => {
    if (drawingStrokes.length === 0) return;
    setDrawingStrokes([]); addToHistory({ drawingStrokes: [] }); showToast('手書きを全て消しました');
  };

  const handleAddDrawingLayer = () => {
    const newLayerId = 'stroke-' + Date.now().toString();
    const newLayer: DrawingStroke = {
      id: newLayerId,
      points: [],
      color: penColor,
      width: penWidth,
      opacity: penOpacity,
      zIndex: penZIndex,
      layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, penZIndex),
      outlineColor: penOutlineColor,
      outlineWidth: penOutlineWidth,
      strokes: []
    };
    const newStrokes = [...drawingStrokes, newLayer];
    setDrawingStrokes(newStrokes);
    setSelectedDrawingStrokeId(newLayerId);
    setMode('draw');
    addToHistory({ drawingStrokes: newStrokes });
  };

  // Layer ordering handlers
  const handleLayerMoveUp = (type: string, id: string) => {
    const result = moveLayerUp(
      type as any, id,
      textObjects, imageLayers, drawingStrokes, mainImageLayerOrder
    );
    setTextObjects(result.textObjects);
    setImageLayers(result.imageLayers);
    setDrawingStrokes(result.drawingStrokes);
    setMainImageLayerOrder(result.mainImageLayerOrder);
    addToHistory({
      textObjects: result.textObjects,
      imageLayers: result.imageLayers,
      drawingStrokes: result.drawingStrokes,
      mainImageLayerOrder: result.mainImageLayerOrder,
    });
  };

  const handleLayerMoveDown = (type: string, id: string) => {
    const result = moveLayerDown(
      type as any, id,
      textObjects, imageLayers, drawingStrokes, mainImageLayerOrder
    );
    setTextObjects(result.textObjects);
    setImageLayers(result.imageLayers);
    setDrawingStrokes(result.drawingStrokes);
    setMainImageLayerOrder(result.mainImageLayerOrder);
    addToHistory({
      textObjects: result.textObjects,
      imageLayers: result.imageLayers,
      drawingStrokes: result.drawingStrokes,
      mainImageLayerOrder: result.mainImageLayerOrder,
    });
  };

  const handleLayerSelect = (type: string, id: string) => {
    // レイヤーをタップしたら該当モードに切り替え＆選択
    if (type === 'text') {
      setMode('text');
      setSelectedTextId(id);
      setSelectedImageLayerId(null);
      setSelectedDrawingStrokeId(null);
    } else if (type === 'imageLayer') {
      setMode('image');
      setSelectedImageLayerId(id);
      setSelectedTextId(null);
      setSelectedDrawingStrokeId(null);
    } else if (type === 'mainImage') {
      setMode('move');
      setSelectedTextId(null);
      setSelectedImageLayerId(null);
      setSelectedDrawingStrokeId(null);
    } else if (type === 'drawing') {
      setMode('draw');
      setSelectedDrawingStrokeId(id);
      setSelectedTextId(null);
      setSelectedImageLayerId(null);
    }
  };

  // ... (Tool Implementation helpers same as before) ...
  const getClientCoords = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
      if ('touches' in e) { return { x: e.touches[0].clientX, y: e.touches[0].clientY }; } else { return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY }; }
  };
  const transformToLocal = (px: number, py: number, cx: number, cy: number, rot: number) => {
      const dx = px - cx; const dy = py - cy; const rad = -(rot * Math.PI) / 180;
      const rx = dx * Math.cos(rad) - dy * Math.sin(rad); const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
      return { x: rx, y: ry };
  }
  const getLocalImageCoords = (canvasX: number, canvasY: number) => {
      const cx = targetWidth / 2 + offset.x; const cy = targetHeight / 2 + offset.y;
      const { x: localX, y: localY } = transformToLocal(canvasX, canvasY, cx, cy, rotation);
      const drawnW = sourceSize.w * scale; const drawnH = sourceSize.h * scale;
      const adjustedLocalX = flipH ? -localX : localX; const adjustedLocalY = flipV ? -localY : localY;
      const imgX = (adjustedLocalX + drawnW / 2) / scale; const imgY = (adjustedLocalY + drawnH / 2) / scale;
      return { imgX, imgY, inside: (imgX >= 0 && imgX <= sourceSize.w && imgY >= 0 && imgY <= sourceSize.h) };
  };
  const prepareEditCanvas = async () => {
      let resolveCanvasDimensions: (size: { w: number, h: number }) => void;
      const sizePromise = new Promise<{ w: number, h: number }>(resolve => {
          resolveCanvasDimensions = resolve;
      });

      const img = new Image();
      img.onload = () => {
          const w = img.width;
          const h = img.height;
          if (!editCanvasRef.current) {
              editCanvasRef.current = document.createElement('canvas');
          }
          editCanvasRef.current.width = w;
          editCanvasRef.current.height = h;

          const ctx = editCanvasRef.current.getContext('2d');
          if (ctx) {
              ctx.globalCompositeOperation = 'source-over';
              ctx.clearRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
          }
          resolveCanvasDimensions({ w, h });
      };
      img.src = workingDataUrl;
      const size = await sizePromise;
      const ctx = editCanvasRef.current?.getContext('2d');
      return ctx ? { ctx, editW: size.w, editH: size.h } : null;
  };
  const applyEraser = async (canvasX: number, canvasY: number) => {
      const { imgX, imgY, inside } = getLocalImageCoords(canvasX, canvasY);
      if (!inside && (imgX < -50 || imgX > sourceSize.w + 50 || imgY < -50 || imgY > sourceSize.h + 50)) return;
      const res = await prepareEditCanvas(); if (!res) return;
      const { ctx, editW, editH } = res;

      const scaleX = editW / sourceSize.w;
      const scaleY = editH / sourceSize.h;
      const nativeImgX = imgX * scaleX;
      const nativeImgY = imgY * scaleY;
      const nativeBrushR = ((eraserSize / scale) / 2) * ((scaleX + scaleY) / 2);

      ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(nativeImgX, nativeImgY, nativeBrushR, 0, Math.PI * 2); ctx.fill();
      
      const now = Date.now();
      if (now - lastBrushTimeRef.current > 50) {
          updateActiveFrameImage(editCanvasRef.current!.toDataURL());
          lastBrushTimeRef.current = now;
      } else {
          if (pendingBrushRef.current) cancelAnimationFrame(pendingBrushRef.current);
          pendingBrushRef.current = requestAnimationFrame(() => {
              updateActiveFrameImage(editCanvasRef.current!.toDataURL());
              lastBrushTimeRef.current = Date.now();
              pendingBrushRef.current = null;
          });
      }
  };
  const applyRestore = async (canvasX: number, canvasY: number) => {
      if (!originalImage) return;
      const { imgX, imgY, inside } = getLocalImageCoords(canvasX, canvasY);
      if (!inside && (imgX < -50 || imgX > sourceSize.w + 50 || imgY < -50 || imgY > sourceSize.h + 50)) return;
      const res = await prepareEditCanvas(); if (!res) return;
      const { ctx, editW, editH } = res;

      const scaleX = editW / sourceSize.w;
      const scaleY = editH / sourceSize.h;
      const nativeImgX = imgX * scaleX;
      const nativeImgY = imgY * scaleY;
      const nativeBrushR = ((eraserSize / scale) / 2) * ((scaleX + scaleY) / 2);

      ctx.globalCompositeOperation = 'source-over'; ctx.save(); ctx.beginPath(); ctx.arc(nativeImgX, nativeImgY, nativeBrushR, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(originalImage, 0, 0, editW, editH); ctx.restore();
      
      const now = Date.now();
      if (now - lastBrushTimeRef.current > 50) {
          updateActiveFrameImage(editCanvasRef.current!.toDataURL());
          lastBrushTimeRef.current = now;
      } else {
          if (pendingBrushRef.current) cancelAnimationFrame(pendingBrushRef.current);
          pendingBrushRef.current = requestAnimationFrame(() => {
              updateActiveFrameImage(editCanvasRef.current!.toDataURL());
              lastBrushTimeRef.current = Date.now();
              pendingBrushRef.current = null;
          });
      }
  };
  const applyMagicWand = async (canvasX: number, canvasY: number) => {
      const { imgX, imgY, inside } = getLocalImageCoords(canvasX, canvasY); if (!inside) return;
      const res = await prepareEditCanvas(); if (!res) return;
      const { ctx, editW, editH } = res;

      const scaleX = editW / sourceSize.w;
      const scaleY = editH / sourceSize.h;
      const nativeImgX = Math.floor(imgX * scaleX);
      const nativeImgY = Math.floor(imgY * scaleY);

      if (nativeImgX < 0 || nativeImgX >= editW || nativeImgY < 0 || nativeImgY >= editH) return;

      const imageData = ctx.getImageData(0, 0, editW, editH); const data = imageData.data;
      const startIdx = (nativeImgY * editW + nativeImgX) * 4; const sa = data[startIdx + 3]; if (sa === 0) return; 
      const sr = data[startIdx]; const sg = data[startIdx + 1]; const sb = data[startIdx + 2];
      const tol = 30; const stack: [number, number][] = [[nativeImgX, nativeImgY]]; const visited = new Uint8Array(editW * editH);
      while (stack.length > 0) {
          const [cx, cy] = stack.pop()!; const idx = cy * editW + cx; if (visited[idx]) continue;
          const pIdx = idx * 4; const r = data[pIdx]; const g = data[pIdx+1]; const b = data[pIdx+2]; const a = data[pIdx+3];
          if (a === 0) { visited[idx] = 1; continue; }
          const diff = Math.abs(r - sr) + Math.abs(g - sg) + Math.abs(b - sb);
          if (diff < tol) {
              data[pIdx + 3] = 0; visited[idx] = 1;
              if (cx > 0) stack.push([cx - 1, cy]); if (cx < editW - 1) stack.push([cx + 1, cy]); if (cy > 0) stack.push([cx, cy - 1]); if (cy < editH - 1) stack.push([cx, cy + 1]);
          }
      }
      ctx.putImageData(imageData, 0, 0); updateActiveFrameImage(editCanvasRef.current!.toDataURL());
  };
  const handleToleranceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = Number(e.target.value); setTolerance(newVal);
      if (toleranceTimeoutRef.current) { clearTimeout(toleranceTimeoutRef.current); }
      toleranceTimeoutRef.current = window.setTimeout(async () => {
          if (stamp.originalDataUrl) {
              try { const baseUrl = stamp.isAnimated ? (originalFrames[currentFrameIndex] || stamp.originalDataUrl) : stamp.originalDataUrl; if (baseUrl) { const newDataUrl = await reprocessStampWithTolerance(baseUrl, newVal); updateActiveFrameImage(newDataUrl); } } 
              catch (err) { console.error("Failed to reprocess", err); }
          }
      }, 300);
  };
  const handleExecuteCopy = () => {
      if (!stamp.isAnimated) return;
      
      const nextTexts = [...framesTextObjects];
      const nextImages = [...framesImageLayers];
      const nextStrokes = [...framesDrawingStrokes];

      // 1-indexed (from user UI ranges) to 0-indexed indices
      const startIdx = Math.max(0, copyTargetStart - 1);
      const endIdx = Math.min((frames.length || 1) - 1, copyTargetEnd - 1);

      // Unique ID generator with random suffix to avoid clashes
      const regenerateIds = (obj: any) => {
          const suffix = '-' + Math.round(Math.random() * 100000).toString();
          return {
              ...obj,
              id: obj.id + suffix
          };
      };

      for (let i = startIdx; i <= endIdx; i++) {
          if (i === currentFrameIndex) continue; // Skip copying to self

          let textList = copyMethod === 'overwrite' ? [] : [...(nextTexts[i] || [])];
          let imageList = copyMethod === 'overwrite' ? [] : [...(nextImages[i] || [])];
          let strokeList = copyMethod === 'overwrite' ? [] : [...(nextStrokes[i] || [])];

          if (copyText) {
              const copiedTexts = textObjects.map(t => regenerateIds(t));
              textList = [...textList, ...copiedTexts];
          }
          if (copyImage) {
              const copiedImages = imageLayers.map(l => regenerateIds(l));
              imageList = [...imageList, ...copiedImages];
          }
          if (copyDrawing) {
              const copiedStrokes = drawingStrokes.map(s => {
                  const newStroke = regenerateIds(s);
                  if (s.strokes) {
                      newStroke.strokes = s.strokes.map(subStroke => ({ ...subStroke }));
                  }
                  return newStroke;
              });
              strokeList = [...strokeList, ...copiedStrokes];
          }

          nextTexts[i] = textList;
          nextImages[i] = imageList;
          nextStrokes[i] = strokeList;
      }

      setFramesTextObjects(nextTexts);
      setFramesImageLayers(nextImages);
      setFramesDrawingStrokes(nextStrokes);

      // Commit fully to undo history
      addToHistory({
          textObjects: textObjects,
          imageLayers: imageLayers,
          drawingStrokes: drawingStrokes,
          framesTextObjects: nextTexts,
          framesImageLayers: nextImages,
          framesDrawingStrokes: nextStrokes,
      });

      setShowCopyModal(false);
      showToast("装飾を一括コピーしました！");
  };

  const moveCurrentFrame = (direction: -1 | 1) => {
      if (!stamp.isAnimated || frames.length <= 1) return;
      const targetIndex = currentFrameIndex + direction;
      if (targetIndex < 0 || targetIndex >= frames.length) return;

      function swap<T>(items: T[]): T[] {
          const copy = [...items];
          const currentValue = copy[currentFrameIndex];
          copy[currentFrameIndex] = copy[targetIndex];
          copy[targetIndex] = currentValue;
          return copy;
      }

      const syncedFrames = frames.map((frame, idx) => idx === currentFrameIndex ? workingDataUrl : frame);
      const nextFrames = swap<string>(syncedFrames);
      const nextOriginalFrames = swap<string>(originalFrames);
      const nextTexts = swap<TextObject[]>(framesTextObjects);
      const nextImages = swap<ImageLayerObject[]>(framesImageLayers);
      const nextDrawings = swap<DrawingStroke[]>(framesDrawingStrokes);
      const nextScales = swap<number>(framesScales);
      const nextRotations = swap<number>(framesRotations);
      const nextOffsetsX = swap<number>(framesOffsetsX);
      const nextOffsetsY = swap<number>(framesOffsetsY);
      const nextFlipsH = swap<boolean>(framesFlipsH);
      const nextFlipsV = swap<boolean>(framesFlipsV);

      setFramesState(nextFrames);
      setOriginalFrames(nextOriginalFrames);
      setFramesTextObjects(nextTexts);
      setFramesImageLayers(nextImages);
      setFramesDrawingStrokes(nextDrawings);
      setFramesScales(nextScales);
      setFramesRotations(nextRotations);
      setFramesOffsetsX(nextOffsetsX);
      setFramesOffsetsY(nextOffsetsY);
      setFramesFlipsH(nextFlipsH);
      setFramesFlipsV(nextFlipsV);
      setCurrentFrameIndex(targetIndex);
      setIsPlaying(false);

      addToHistory({
          currentFrameIndex: targetIndex,
          frames: nextFrames,
          originalFrames: nextOriginalFrames,
          framesTextObjects: nextTexts,
          framesImageLayers: nextImages,
          framesDrawingStrokes: nextDrawings,
          framesScales: nextScales,
          framesRotations: nextRotations,
          framesOffsetsX: nextOffsetsX,
          framesOffsetsY: nextOffsetsY,
          framesFlipsH: nextFlipsH,
          framesFlipsV: nextFlipsV,
      });
  };

  const handleSave = () => {
      if (stamp.isAnimated && !LINE_ANIMATION_DURATIONS.includes(playbackDuration)) {
          alert('再生時間はLINEアニメーションスタンプ規定に合わせて、1秒 / 2秒 / 3秒 / 4秒 のいずれかを選択してください。');
          return;
      }
      if (pendingBrushRef.current) {
          cancelAnimationFrame(pendingBrushRef.current);
          pendingBrushRef.current = null;
      }
      const syncedFrames = stamp.isAnimated
          ? frames.map((frame, idx) => idx === currentFrameIndex ? workingDataUrl : frame)
          : frames;
      const updatedStamp: Stamp = { 
          ...stamp, 
          scale, 
          rotation, 
          flipH, 
          flipV, 
          offsetX: offset.x, 
          offsetY: offset.y, 
          dataUrl: workingDataUrl, 
          textObjects, 
          imageLayers, 
          drawingStrokes, 
          currentTolerance: tolerance, 
          mainImageLayerOrder,
          // Sync animated sequences
          ...(stamp.isAnimated ? {
              rawFrames: syncedFrames,
              rawOriginalFrames: originalFrames,
              textObjectsFrames: framesTextObjects,
              imageLayersFrames: framesImageLayers,
              drawingStrokesFrames: framesDrawingStrokes,
              scalesFrames: framesScales,
              rotationsFrames: framesRotations,
              offsetsXFrames: framesOffsetsX,
              offsetsYFrames: framesOffsetsY,
              flipsHFrames: framesFlipsH,
              flipsVFrames: framesFlipsV,
              fps: Math.max(1, syncedFrames.length / playbackDuration),
              playbackDuration,
          } : {})
      };
      onSave(updatedStamp); onClose();
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.type === 'touchstart') e.preventDefault();
    if ('touches' in e && e.touches.length === 2) {
        const t1 = e.touches[0]; const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const angle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
        setPinchStartDist(dist); setPinchStartScale(scale); setPinchStartAngle(angle); setPinchStartRotation(rotation);
        setIsDragging(false); return;
    }
    const { x: clientX, y: clientY } = getClientCoords(e);
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (clientX - rect.left) / viewZoom; const y = (clientY - rect.top) / viewZoom;
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;

    if (mode === 'text') {
        if (selectedTextId) {
            const t = textObjects.find(obj => obj.id === selectedTextId);
            if (t) {
                const { x: localX, y: localY } = transformToLocal(x, y, t.x, t.y, t.rotation);
                const { w, h } = getTextBoundingBox(ctx, t);
                const hw = w/2; const hh = h/2; const handleRadius = 20;
                if (Math.hypot(localX - (-hw), localY - (-hh)) < handleRadius) { setActiveTextHandle('tl'); setIsResizingText(true); setLastPos({x, y}); return; }
                if (Math.hypot(localX - (hw), localY - (-hh)) < handleRadius) { setActiveTextHandle('tr'); setIsResizingText(true); setLastPos({x, y}); return; }
                if (Math.hypot(localX - (-hw), localY - (hh)) < handleRadius) { setActiveTextHandle('bl'); setIsResizingText(true); setLastPos({x, y}); return; }
                if (Math.hypot(localX - (hw), localY - (hh)) < handleRadius) { setActiveTextHandle('br'); setIsResizingText(true); setLastPos({x, y}); return; }
            }
        }
        for (let i = textObjects.length - 1; i >= 0; i--) {
             const t = textObjects[i];
             const { x: localX, y: localY } = transformToLocal(x, y, t.x, t.y, t.rotation);
             const { w, h } = getTextBoundingBox(ctx, t);
             if (localX >= -w/2 && localX <= w/2 && localY >= -h/2 && localY <= h/2) { setSelectedTextId(t.id); setIsDragging(true); setLastPos({ x, y }); return; }
        }
        return; 
    }
    if (mode === 'image') {
        if (selectedImageLayerId) {
            const layer = imageLayers.find(l => l.id === selectedImageLayerId);
            if (layer) {
                const { x: localX, y: localY } = transformToLocal(x, y, layer.x, layer.y, layer.rotation);
                const w = layer.originalWidth * layer.scale; const h = layer.originalHeight * layer.scale; const hw = w / 2; const hh = h / 2; const handleRadius = 20;
                if (Math.hypot(localX - (-hw), localY - (-hh)) < handleRadius) { setActiveImageLayerHandle('tl'); setIsResizingImageLayer(true); setLastPos({x, y}); return; }
                if (Math.hypot(localX - (hw), localY - (-hh)) < handleRadius) { setActiveImageLayerHandle('tr'); setIsResizingImageLayer(true); setLastPos({x, y}); return; }
                if (Math.hypot(localX - (-hw), localY - (hh)) < handleRadius) { setActiveImageLayerHandle('bl'); setIsResizingImageLayer(true); setLastPos({x, y}); return; }
                if (Math.hypot(localX - (hw), localY - (hh)) < handleRadius) { setActiveImageLayerHandle('br'); setIsResizingImageLayer(true); setLastPos({x, y}); return; }
            }
        }
        for (let i = imageLayers.length - 1; i >= 0; i--) {
             const layer = imageLayers[i];
             const { x: localX, y: localY } = transformToLocal(x, y, layer.x, layer.y, layer.rotation);
             const w = layer.originalWidth * layer.scale; const h = layer.originalHeight * layer.scale;
             if (localX >= -w/2 && localX <= w/2 && localY >= -h/2 && localY <= h/2) { setSelectedImageLayerId(layer.id); setIsDragging(true); setLastPos({ x, y }); return; }
        }
        setSelectedImageLayerId(null); return;
    }
    if (mode === 'draw') { setCurrentStroke([{ x, y }]); setIsDragging(true); return; }
    if (mode === 'move') {
        const cx = targetWidth / 2 + offset.x; const cy = targetHeight / 2 + offset.y;
        const { x: localX, y: localY } = transformToLocal(x, y, cx, cy, rotation);
        const drawnW = sourceSize.w * scale; const drawnH = sourceSize.h * scale; const hw = drawnW / 2; const hh = drawnH / 2; const handleRadius = 25; 
        if (Math.hypot(localX - (-hw), localY - (-hh)) < handleRadius) { setActiveImageHandle('tl'); setIsResizingImage(true); setLastPos({x, y}); return; }
        if (Math.hypot(localX - (hw), localY - (-hh)) < handleRadius) { setActiveImageHandle('tr'); setIsResizingImage(true); setLastPos({x, y}); return; }
        if (Math.hypot(localX - (-hw), localY - (hh)) < handleRadius) { setActiveImageHandle('bl'); setIsResizingImage(true); setLastPos({x, y}); return; }
        if (Math.hypot(localX - (hw), localY - (hh)) < handleRadius) { setActiveImageHandle('br'); setIsResizingImage(true); setLastPos({x, y}); return; }
        setIsDragging(true); setLastPos({ x, y }); return;
    }
    if (mode === 'wand' || mode === 'restore' || mode === 'eraser') {
       addToHistory({}); if (mode === 'wand') applyMagicWand(x, y); else if (mode === 'eraser') applyEraser(x, y); else if (mode === 'restore') applyRestore(x, y);
       setIsDragging(true); setLastPos({ x, y });
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.type === 'touchmove') e.preventDefault();
    if ('touches' in e && e.touches.length === 2 && pinchStartDist !== null) {
        const t1 = e.touches[0]; const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY); const scaleFactor = dist / pinchStartDist;
        const newScale = Math.max(0.01, pinchStartScale * scaleFactor); setScale(newScale); return;
    }
    const { x: clientX, y: clientY } = getClientCoords(e);
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (clientX - rect.left) / viewZoom; const y = (clientY - rect.top) / viewZoom; setCursorPos({ x, y });

    if (isResizingText && selectedTextId) {
        const t = textObjects.find(t => t.id === selectedTextId);
        if (t) {
            const dist = Math.hypot(x - t.x, y - t.y); const prevDist = Math.hypot(lastPos.x - t.x, lastPos.y - t.y); const scaleFactor = dist / prevDist;
            const newSize = Math.min(200, Math.max(10, t.fontSize * scaleFactor)); handleUpdateText(selectedTextId, { fontSize: newSize });
        }
        setLastPos({ x, y }); return;
    }
    if (isResizingImageLayer && selectedImageLayerId) {
        const layer = imageLayers.find(l => l.id === selectedImageLayerId);
        if (layer) {
            const dist = Math.hypot(x - layer.x, y - layer.y); const prevDist = Math.hypot(lastPos.x - layer.x, lastPos.y - layer.y);
            if (prevDist > 0) {
                const scaleFactor = dist / prevDist; const newScale = Math.min(3.0, Math.max(0.05, layer.scale * scaleFactor));
                handleUpdateImageLayer(selectedImageLayerId, { scale: newScale });
            }
        }
        setLastPos({ x, y }); return;
    }
    if (isResizingImage) {
        const cx = targetWidth / 2 + offset.x; const cy = targetHeight / 2 + offset.y;
        const dist = Math.hypot(x - cx, y - cy); const prevDist = Math.hypot(lastPos.x - cx, lastPos.y - cy); const scaleFactor = dist / prevDist;
        const newScale = Math.min(3.0, Math.max(0.01, scale * scaleFactor)); setScale(newScale); setLastPos({ x, y }); return;
    }
    if (mode === 'draw' && currentStroke && isDragging) { setCurrentStroke(prev => prev ? [...prev, { x, y }] : [{ x, y }]); return; }
    if (!isDragging) return;

    if (mode === 'move') { const dx = x - lastPos.x; const dy = y - lastPos.y; setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy })); }
    else if (mode === 'text' && selectedTextId) { const dx = x - lastPos.x; const dy = y - lastPos.y; handleUpdateText(selectedTextId, { x: textObjects.find(t => t.id === selectedTextId)!.x + dx, y: textObjects.find(t => t.id === selectedTextId)!.y + dy }); }
    else if (mode === 'image' && selectedImageLayerId) { const dx = x - lastPos.x; const dy = y - lastPos.y; const layer = imageLayers.find(l => l.id === selectedImageLayerId); if (layer) { handleUpdateImageLayer(selectedImageLayerId, { x: layer.x + dx, y: layer.y + dy }); } }
    else if (mode === 'eraser') { applyEraser(x, y); } else if (mode === 'restore') { applyRestore(x, y); }
    setLastPos({ x, y });
  };

  const handlePointerUp = () => {
    if (pendingBrushRef.current) {
        cancelAnimationFrame(pendingBrushRef.current);
        updateActiveFrameImage(editCanvasRef.current!.toDataURL());
        pendingBrushRef.current = null;
    }
    if (isDragging && mode === 'move') addToHistory({});
    if (isResizingImage) addToHistory({ scale });
    if (isResizingText && selectedTextId) handleTextChangeComplete();
    if (isResizingImageLayer) { addToHistory({ imageLayers }); }
    if (mode === 'draw' && currentStroke && currentStroke.length >= 2) {
        const selectedId = selectedDrawingStrokeId;
        const layerIndex = drawingStrokes.findIndex(s => s.id === selectedId);
        
        let newStrokes = [...drawingStrokes];
        const strokeItem = {
            points: currentStroke,
            color: penColor,
            width: penWidth,
            opacity: penOpacity,
            outlineColor: penOutlineColor,
            outlineWidth: penOutlineWidth
        };

        if (layerIndex !== -1) {
            const layer = { ...drawingStrokes[layerIndex] };
            
            if (!layer.strokes) {
                layer.strokes = [];
                if (layer.points && layer.points.length >= 2) {
                    layer.strokes.push({
                        points: layer.points,
                        color: layer.color,
                        width: layer.width,
                        opacity: layer.opacity,
                        outlineColor: layer.outlineColor,
                        outlineWidth: layer.outlineWidth
                    });
                }
            }
            
            layer.strokes = [...layer.strokes, strokeItem];
            layer.points = currentStroke;
            layer.color = penColor;
            layer.width = penWidth;
            layer.opacity = penOpacity;
            layer.outlineColor = penOutlineColor;
            layer.outlineWidth = penOutlineWidth;

            newStrokes[layerIndex] = layer;
        } else {
            const newLayerId = 'stroke-' + Date.now().toString();
            const newLayer: DrawingStroke = {
                id: newLayerId,
                points: currentStroke,
                color: penColor,
                width: penWidth,
                opacity: penOpacity,
                zIndex: penZIndex,
                layerOrder: getNextLayerOrder(textObjects, imageLayers, drawingStrokes, mainImageLayerOrder, penZIndex),
                outlineColor: penOutlineColor,
                outlineWidth: penOutlineWidth,
                strokes: [strokeItem]
            };
            newStrokes = [...drawingStrokes, newLayer];
            setSelectedDrawingStrokeId(newLayerId);
        }
        
        setDrawingStrokes(newStrokes);
        setCurrentStroke(null);
        addToHistory({ drawingStrokes: newStrokes });
        setIsDragging(false);
        return;
    }
    if (mode === 'draw') setCurrentStroke(null);
    setIsDragging(false); setIsResizingText(false); setIsResizingImageLayer(false); setIsResizingImage(false);
    setActiveTextHandle(null); setActiveImageLayerHandle(null); setActiveImageHandle(null); setPinchStartDist(null); setPinchStartAngle(null);
  };
  const handlePointerLeave = () => { setCursorPos(null); handlePointerUp(); };
  
  const scrollCanvas = (direction: 'up' | 'down' | 'left' | 'right') => {
    const amount = 60;
    setCanvasPan(prev => {
      if (direction === 'up') return { ...prev, y: prev.y + amount };
      if (direction === 'down') return { ...prev, y: prev.y - amount };
      if (direction === 'left') return { ...prev, x: prev.x + amount };
      if (direction === 'right') return { ...prev, x: prev.x - amount };
      return prev;
    });
  };

  const selectedText = textObjects.find(t => t.id === selectedTextId);
  const selectedImageLayer = imageLayers.find(l => l.id === selectedImageLayerId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full flex flex-col h-[95vh] relative">
        <div className="px-3 py-2 border-b flex items-center bg-primary-50 rounded-t-xl shrink-0 gap-2">
          <h3 className="font-bold text-gray-700 text-sm mr-auto">スタンプ編集 ({targetWidth}x{targetHeight})</h3>
          <EditorToolbar viewZoom={viewZoom} onViewZoomChange={setViewZoom} historyIndex={historyIndex} historyLength={history.length} onUndo={undo} onRedo={redo} />
          <div className="flex items-center gap-2">
               <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-gray-200">
                    <span className="hidden md:inline text-xs text-gray-400 font-bold px-1">背景色</span>
                    {backgroundOptions.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => setPreviewBg(opt.value)}
                            className={`w-5 h-5 rounded-full ${opt.color} ${previewBg === opt.value ? 'ring-2 ring-primary-500 ring-offset-1' : ''}`}
                            title={opt.label}
                            style={opt.value === 'checker' ? { backgroundImage: `url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAB5JREFUKFNjYCACAAAHOgD///+F8f///4X/09JvAgBwYw/57yQ+jAAAAABJRU5ErkJggg==')` } : {}}
                        />
                    ))}
                </div>
              <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
            <div
                ref={panContainerRef}
                className="flex-1 overflow-hidden bg-gray-100 relative"
                style={{ minHeight: '200px' }}
            >
                <div
                    className="absolute"
                    style={{
                        left: `calc(50% + ${canvasPan.x}px)`,
                        top: `calc(50% + ${canvasPan.y}px)`,
                        transform: 'translate(-50%, -50%)',
                    }}
                >
                    <div className="relative shadow-md border border-gray-200 bg-white" style={{ width: targetWidth * viewZoom, height: targetHeight * viewZoom, flexShrink: 0 }}>
                        <canvas ref={canvasRef} width={targetWidth} height={targetHeight} className={`origin-top-left ${mode === 'move' ? 'cursor-move' : (mode === 'text' || mode === 'image' ? 'cursor-text' : 'cursor-crosshair')} touch-none`}
                        style={{ transform: `scale(${viewZoom})`, width: targetWidth, height: targetHeight }}
                        onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerLeave} onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp} />
                    </div>
                </div>
                {viewZoom > 1 && (
                    <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center">
                        <button
                            onClick={() => scrollCanvas('up')}
                            className="pointer-events-auto absolute top-2 left-1/2 -translate-x-1/2 bg-white/90 hover:bg-white active:bg-gray-200 rounded-full shadow-lg border border-gray-300 p-2 transition"
                        >
                            <ChevronUp size={22} className="text-gray-600" />
                        </button>
                        <button
                            onClick={() => scrollCanvas('down')}
                            className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 bg-white/90 hover:bg-white active:bg-gray-200 rounded-full shadow-lg border border-gray-300 p-2 transition"
                        >
                            <ChevronDown size={22} className="text-gray-600" />
                        </button>
                        <button
                            onClick={() => scrollCanvas('left')}
                            className="pointer-events-auto absolute top-1/2 left-2 -translate-y-1/2 bg-white/90 hover:bg-white active:bg-gray-200 rounded-full shadow-lg border border-gray-300 p-2 transition"
                        >
                            <ChevronLeft size={22} className="text-gray-600" />
                        </button>
                        <button
                            onClick={() => scrollCanvas('right')}
                            className="pointer-events-auto absolute top-1/2 right-2 -translate-y-1/2 bg-white/90 hover:bg-white active:bg-gray-200 rounded-full shadow-lg border border-gray-300 p-2 transition"
                        >
                            <ChevronRight size={22} className="text-gray-600" />
                        </button>
                        {(canvasPan.x !== 0 || canvasPan.y !== 0) && (
                            <button
                                onClick={() => setCanvasPan({ x: 0, y: 0 })}
                                className="pointer-events-auto absolute bottom-2 right-2 bg-white/90 hover:bg-white active:bg-gray-200 text-gray-600 text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg border border-gray-300 transition"
                            >
                                中央に戻す
                            </button>
                        )}
                    </div>
                )}
            </div>
            {stamp.isAnimated && frames.length > 0 && (
                <div className="bg-gray-50 border-t border-b p-2 shrink-0 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-700">フレーム一覧</span>
                            <button
                                type="button"
                                onClick={() => setIsPlaying(!isPlaying)}
                                className={`px-2.5 py-1 rounded text-xs font-bold text-white transition flex items-center gap-1 ${isPlaying ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}
                            >
                                {isPlaying ? '一時停止' : '再生確認'}
                            </button>
                            <span className="text-[11px] text-gray-500 font-bold">
                                編集中: {currentFrameIndex + 1} / {frames.length}
                            </span>
                            <label className="flex items-center gap-1.5 bg-white border border-gray-200 rounded px-2 py-1 text-[11px] font-bold text-gray-600">
                                <span>再生秒数</span>
                                <div className="flex items-center gap-1">
                                    {LINE_ANIMATION_DURATIONS.map((duration) => (
                                        <button
                                            key={duration}
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setPlaybackDuration(duration);
                                                addToHistory({ playbackDuration: duration });
                                            }}
                                            className={`px-1.5 py-0.5 rounded border text-[10px] transition ${
                                                playbackDuration === duration
                                                    ? 'bg-primary-600 border-primary-600 text-white'
                                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-primary-50'
                                            }`}
                                        >
                                            {duration}秒
                                        </button>
                                    ))}
                                </div>
                            </label>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => moveCurrentFrame(-1)}
                                    disabled={currentFrameIndex === 0}
                                    className="px-2 py-1 rounded bg-white border border-gray-300 text-[11px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                    title="このフレームを1つ前へ移動"
                                >
                                    前へ
                                </button>
                                <button
                                    type="button"
                                    onClick={() => moveCurrentFrame(1)}
                                    disabled={currentFrameIndex === frames.length - 1}
                                    className="px-2 py-1 rounded bg-white border border-gray-300 text-[11px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                    title="このフレームを1つ後ろへ移動"
                                >
                                    後ろへ
                                </button>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setCopyTargetStart(1);
                                setCopyTargetEnd(frames.length);
                                setShowCopyModal(true);
                            }}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold transition flex items-center gap-1"
                        >
                            装飾をコピー...
                        </button>
                    </div>
                    
                    <div className="flex gap-2 overflow-x-auto py-1 px-1 scrollbar-thin scrollbar-thumb-gray-300">
                        {frames.map((frame, idx) => {
                            const hasDecorations = 
                                (framesTextObjects[idx]?.length > 0) || 
                                (framesImageLayers[idx]?.length > 0) || 
                                (framesDrawingStrokes[idx]?.length > 0);
                            const isImageEdited = !!originalFrames[idx] && frame !== originalFrames[idx];

                            return (
                                <div
                                    key={idx}
                                    onClick={() => {
                                        setIsPlaying(false);
                                        setCurrentFrameIndex(idx);
                                    }}
                                    className={`relative flex-shrink-0 cursor-pointer rounded-lg border-2 overflow-hidden transition bg-white ${
                                        currentFrameIndex === idx ? 'border-primary-600 ring-2 ring-primary-100' : 'border-gray-200 hover:border-gray-400'
                                    }`}
                                    style={{ width: '64px', height: '56px' }}
                                >
                                    <div className="w-full h-full p-0.5 relative">
                                        <div className="w-full h-full rounded overflow-hidden" style={{ backgroundImage: `url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAB5JREFUKFNjYCACAAAHOgD///+F8f///4X/09JvAgBwYw/57yQ+jAAAAABJRU5ErkJggg==')`, backgroundSize: 'auto' }}>
                                            <img src={frame} alt={`Frame ${idx + 1}`} className="w-full h-full object-contain pointer-events-none" />
                                        </div>
                                    </div>
                                    
                                    {hasDecorations && (
                                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-purple-600 ring-2 ring-white" title="装飾オブジェクトあり" />
                                    )}
                                    {isImageEdited && (
                                        <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" title="元画像編集あり" />
                                    )}
                                    
                                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1 rounded font-mono font-bold">
                                        {idx + 1}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {!stamp.isAnimated && staticFrameSourceFrames && staticFrameSourceFrames.length > 0 && (
                <div className="bg-gray-50 border-t border-b p-2 shrink-0 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between px-2">
                        <span className="text-xs font-bold text-gray-700">タブ画像に使うコマ</span>
                        <span className="text-[11px] text-gray-500 font-bold">
                            選択中: {staticSelectedFrameIndex + 1} / {staticFrameSourceFrames.length}
                        </span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto py-1 px-1 scrollbar-thin scrollbar-thumb-gray-300">
                        {staticFrameSourceFrames.map((frame, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => handleStaticSourceFrameSelect(idx)}
                                className={`relative flex-shrink-0 cursor-pointer rounded-lg border-2 overflow-hidden transition bg-white ${
                                    staticSelectedFrameIndex === idx ? 'border-primary-600 ring-2 ring-primary-100' : 'border-gray-200 hover:border-gray-400'
                                }`}
                                style={{ width: '64px', height: '56px' }}
                                title={`コマ ${idx + 1}`}
                            >
                                <div className="w-full h-full p-0.5 relative">
                                    <div className="w-full h-full rounded overflow-hidden" style={{ backgroundImage: `url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAB5JREFUKFNjYCACAAAHOgD///+F8f///4X/09JvAgBwYw/57yQ+jAAAAABJRU5ErkJggg==')`, backgroundSize: 'auto' }}>
                                        <img src={frame} alt={`Frame ${idx + 1}`} className="w-full h-full object-contain pointer-events-none" />
                                    </div>
                                </div>
                                <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] px-1 rounded font-mono font-bold">
                                    {idx + 1}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>

        <div className="p-2 border-t bg-white shrink-0 flex flex-col gap-1 max-h-[35vh] overflow-y-auto">
             
             {mode === 'text' && selectedText && (
                 <CollapsiblePanel
                    title="テキスト編集"
                    icon={<Type size={14} className="text-blue-500" />}
                    collapsed={panelCollapsed.text}
                    onToggle={() => togglePanel('text')}
                    bgColor="bg-blue-50"
                    borderColor="border-blue-100"
                    summaryContent={
                        <span className="text-[10px] text-blue-400 truncate max-w-[150px]">
                            「{selectedText.text}」{selectedText.fontSize}px
                        </span>
                    }
                 >
                    <TextEditPanel
                        selectedText={selectedText}
                        onUpdateText={handleUpdateText}
                        onDeleteText={handleDeleteText}
                        onCommit={handleTextChangeComplete}
                    />
                 </CollapsiblePanel>
             )}

             {mode === 'image' && selectedImageLayer && (
                 <CollapsiblePanel
                    title="画像レイヤー"
                    icon={<ImageIcon size={14} className="text-purple-500" />}
                    collapsed={panelCollapsed.image}
                    onToggle={() => togglePanel('image')}
                    bgColor="bg-purple-50"
                    borderColor="border-purple-100"
                    summaryContent={
                        <span className="text-[10px] text-purple-400">
                            {Math.round(selectedImageLayer.scale * 100)}% / 透明度{Math.round(selectedImageLayer.opacity * 100)}%
                        </span>
                    }
                 >
                    <ImageLayerPanel
                        selectedLayer={selectedImageLayer}
                        onUpdateLayer={handleUpdateImageLayer}
                        onDeleteLayer={handleDeleteImageLayer}
                        onSaveAsMaterial={handleSaveAsMaterial}
                        onCommit={() => addToHistory({ imageLayers })}
                    />
                 </CollapsiblePanel>
             )}

             {mode === 'draw' && (
                 <CollapsiblePanel
                    title="手書き設定"
                    icon={<span className="w-3 h-3 rounded-full border border-gray-300" style={{ backgroundColor: penColor }} />}
                    collapsed={panelCollapsed.draw}
                    onToggle={() => togglePanel('draw')}
                    bgColor="bg-orange-50"
                    borderColor="border-orange-100"
                    summaryContent={
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded border border-gray-300" style={{ backgroundColor: penColor }} />
                            <span className="text-[10px] text-orange-400">
                                {penWidth}px / {Math.round(penOpacity * 100)}%
                                {penOutlineWidth > 0 && ' / 縁取り'}
                            </span>
                        </div>
                    }
                 >
                    <DrawingPanel 
                        penColor={penColor}
                        penWidth={penWidth}
                        penOpacity={penOpacity}
                        penZIndex={penZIndex}
                        penOutlineColor={penOutlineColor}
                        penOutlineWidth={penOutlineWidth}
                        strokes={drawingStrokes}
                        onPenColorChange={setPenColor}
                        onPenWidthChange={setPenWidth}
                        onPenOpacityChange={setPenOpacity}
                        onPenZIndexChange={setPenZIndex}
                        onPenOutlineColorChange={setPenOutlineColor}
                        onPenOutlineWidthChange={setPenOutlineWidth}
                        onClearAll={handleClearAllStrokes}
                        onDeleteLast={handleDeleteLastStroke}
                        onAddLayer={handleAddDrawingLayer}
                    />
                 </CollapsiblePanel>
             )}

             {mode === 'move' && (
                 <CollapsiblePanel
                    title="画像操作"
                    icon={<Move size={14} className="text-gray-500" />}
                    collapsed={panelCollapsed.move}
                    onToggle={() => togglePanel('move')}
                    bgColor="bg-gray-50"
                    borderColor="border-gray-200"
                    summaryContent={
                        <span className="text-[10px] text-gray-400">
                            {Math.round(scale * 100)}% / {Math.round(rotation)}°
                            {(flipH || flipV) && ' / 反転'}
                        </span>
                    }
                    headerExtra={stamp.isAnimated ? (
                        <label
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-md text-[11px] font-bold cursor-pointer select-none border border-amber-200 transition"
                            title="画像のサイズ・位置・回転・反転を全コマへ同時に反映します"
                        >
                            <span className="hidden sm:inline">変形の適用範囲</span>
                            <input
                                type="checkbox"
                                checked={applyTransformToAll}
                                onChange={(e) => setApplyTransformToAll(e.target.checked)}
                                className="rounded text-primary-600 focus:ring-primary-300 w-3.5 h-3.5 cursor-pointer"
                            />
                            すべてのコマ
                        </label>
                    ) : undefined}
                 >
                    <div className="space-y-3">
                        <ImageControlPanel
                            scale={scale}
                            rotation={rotation}
                            flipH={flipH}
                            flipV={flipV}
                            onScaleChange={(v) => { setScale(v); }}
                            onRotationChange={(v) => { setRotation(v); }}
                            onFlipH={() => { setFlipH(prev => !prev); addToHistory({ flipH: !flipH }); }}
                            onFlipV={() => { setFlipV(prev => !prev); addToHistory({ flipV: !flipV }); }}
                            onCommit={() => addToHistory({ scale, rotation })}
                        />
                    </div>
                 </CollapsiblePanel>
             )}

             {mode === 'wand' && originalImage && (
                <div className="flex items-center gap-4 bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                    <div className="flex items-center gap-2 text-yellow-700 font-bold text-sm min-w-[80px] shrink-0">
                        <Wand2 size={16} /> 追加透過
                    </div>
                    <ControlSlider
                        label="" value={tolerance} min={1} max={100} step={1}
                        onChange={(val: number) => {
                            setTolerance(val);
                            if (toleranceTimeoutRef.current) { clearTimeout(toleranceTimeoutRef.current); }
                            toleranceTimeoutRef.current = window.setTimeout(async () => {
                                if (stamp.originalDataUrl) {
                                    try { const baseUrl = stamp.isAnimated ? (originalFrames[currentFrameIndex] || stamp.originalDataUrl) : stamp.originalDataUrl; if (baseUrl) { const newDataUrl = await reprocessStampWithTolerance(baseUrl, val); updateActiveFrameImage(newDataUrl); } } 
                                    catch (err) { console.error("Failed to reprocess", err); }
                                }
                            }, 300);
                        }}
                        showValue={true}
                    />
                </div>
             )}

             {mode === 'eraser' && (
                <div className="flex items-center gap-4 bg-red-50 p-3 rounded-lg border border-red-100">
                    <div className="flex items-center gap-2 text-red-700 font-bold text-sm min-w-[80px] shrink-0">
                        <Eraser size={16} /> 消しゴム
                    </div>
                    <ControlSlider
                        label=""
                        value={eraserSize}
                        min={1}
                        max={100}
                        step={1}
                        onChange={setEraserSize}
                        showValue={true}
                        unit="px"
                    />
                </div>
             )}

             {mode === 'restore' && originalImage && (
                <div className="flex items-center gap-4 bg-teal-50 p-3 rounded-lg border border-teal-100">
                    <div className="flex items-center gap-2 text-teal-700 font-bold text-sm min-w-[80px] shrink-0">
                        <PenTool size={16} /> 復活ペン
                    </div>
                    <ControlSlider
                        label=""
                        value={eraserSize}
                        min={1}
                        max={100}
                        step={1}
                        onChange={setEraserSize}
                        showValue={true}
                        unit="px"
                    />
                </div>
             )}

             {/* レイヤー順パネル（テキスト・画像レイヤー・手書きが1つでもある場合に表示） */}
             {mode !== 'wand' &&
              mode !== 'eraser' &&
              mode !== 'restore' &&
              (textObjects.length > 0 || imageLayers.length > 0 || drawingStrokes.length > 0) && (
                <CollapsiblePanel
                    title="レイヤー順"
                    icon={<Layers size={14} className="text-gray-500" />}
                    collapsed={panelCollapsed.layers ?? false}
                    onToggle={() => togglePanel('layers')}
                    bgColor="bg-gray-50"
                    borderColor="border-gray-200"
                    summaryContent={
                        <span className="text-[10px] text-gray-400">
                            {sortedLayers.length}レイヤー
                        </span>
                    }
                >
                    <LayerOrderPanel
                        layers={sortedLayers}
                        textObjects={textObjects}
                        imageLayers={imageLayers}
                        drawingStrokes={drawingStrokes}
                        selectedType={
                            mode === 'text' && selectedTextId ? 'text' :
                            mode === 'image' && selectedImageLayerId ? 'imageLayer' :
                            mode === 'move' ? 'mainImage' :
                            mode === 'draw' && selectedDrawingStrokeId ? 'drawing' :
                            null
                        }
                        selectedId={
                            mode === 'text' ? selectedTextId :
                            mode === 'image' ? selectedImageLayerId :
                            mode === 'move' ? 'main' :
                            mode === 'draw' ? selectedDrawingStrokeId :
                            null
                        }
                        onMoveUp={handleLayerMoveUp}
                        onMoveDown={handleLayerMoveDown}
                        onSelect={handleLayerSelect}
                        getLayerName={(item) => getLayerDisplayName(item, textObjects, imageLayers, drawingStrokes)}
                    />
                </CollapsiblePanel>
             )}

        </div>

        <div className="px-3 py-2 border-t bg-gray-50 rounded-b-xl shrink-0 flex flex-wrap items-center justify-center gap-2">
             <div className="flex flex-wrap gap-1 items-center justify-center">
                 <ModeSelector
                    mode={mode} onModeChange={setMode} hasOriginalImage={!!originalImage}
                    onAddText={handleAddText} onAddImageLayer={handleAddImageLayer}
                    onReset={() => {
                        addToHistory({}); setScale(initialScale ?? stamp.scale); setRotation(initialRotation ?? stamp.rotation ?? 0); setOffset(initialOffset ?? {x:0, y:0});
                        setFlipH(stamp.flipH ?? false); setFlipV(stamp.flipV ?? false); setTolerance(stamp.currentTolerance || 50);
                        if (stamp.isAnimated && stamp.rawFrames) {
                            const frameUrl = stamp.rawFrames[currentFrameIndex] || stamp.rawFrames[0];
                            updateActiveFrameImage(frameUrl);
                            setTextObjects(stamp.textObjectsFrames?.[currentFrameIndex] ?? []);
                            setImageLayers(stamp.imageLayersFrames?.[currentFrameIndex] ?? []);
                            setDrawingStrokes(stamp.drawingStrokesFrames?.[currentFrameIndex] ?? []);
                        } else {
                            setWorkingDataUrl(stamp.dataUrl);
                            setTextObjects(initialTextObjects ?? stamp.textObjects ?? []);
                            setImageLayers(initialImageLayers ?? stamp.imageLayers ?? []);
                            setDrawingStrokes(initialDrawingStrokes ?? stamp.drawingStrokes ?? []);
                        }
                        setMainImageLayerOrder(stamp.mainImageLayerOrder ?? 100);
                    }}
                    onOpenMaterialLibrary={() => setShowMaterialLibrary(true)} materialsCount={materials.length}
                 />
             </div>
             <div className="flex items-center gap-2 shrink-0">
                <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition">キャンセル</button>
                <button onClick={handleSave} className="px-4 py-1.5 text-sm bg-primary-600 text-white font-bold rounded-lg shadow hover:bg-primary-700 transition flex items-center gap-1">
                    <Check size={16} /> 完了
                </button>
             </div>
        </div>

        {showMaterialLibrary && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 rounded-xl" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 max-h-[70vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center">
                <h4 className="font-bold text-gray-700 flex items-center gap-2"><Layers size={18} className="text-purple-500" />素材ライブラリ</h4>
                <button onClick={() => setShowMaterialLibrary(false)} className="p-1 hover:bg-gray-100 rounded-full"><X size={20} /></button>
                </div>
                <div className="p-4 overflow-y-auto flex-1">
                {materials.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-8">保存された素材はありません。<br/>画像レイヤーを追加した後、<br/>「素材として保存」で登録できます。</p>
                ) : (
                    <div className="grid grid-cols-3 gap-3">
                    {materials.map(mat => (
                        <div key={mat.id} className="flex flex-col items-center">
                            <div role="button" tabIndex={0} onClick={() => handleAddFromMaterial(mat)} className="w-full aspect-square rounded-lg border-2 border-gray-200 overflow-hidden hover:border-purple-400 transition bg-gray-50 p-2 cursor-pointer relative">
                                <img src={mat.dataUrl} alt={mat.name} className="w-full h-full object-contain pointer-events-none" draggable={false} />
                            </div>
                            <div className="flex items-center justify-between w-full mt-1 px-1">
                                <p className="text-[10px] text-gray-400 truncate flex-1">{mat.name}</p>
                                <button type="button" onClick={() => handleDeleteMaterialItem(mat.id)} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className="text-gray-300 hover:text-red-500 active:text-red-600 transition p-1 shrink-0 cursor-pointer rounded hover:bg-red-50 active:bg-red-100" title="素材を削除"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
                    </div>
                )}
                </div>
            </div>
            </div>
        )}
        {showCopyModal && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 rounded-xl" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full mx-4 p-5 flex flex-col gap-4 border border-gray-150 transform animate-[scaleIn_0.2s_ease-out]">
                    <div className="flex items-center justify-between border-b pb-2">
                        <h4 className="font-bold text-gray-800 flex items-center gap-2">
                            <Layers size={18} className="text-purple-600" />
                            装飾を他のフレームにコピー
                        </h4>
                        <button type="button" onClick={() => setShowCopyModal(false)} className="p-1 hover:bg-gray-150 rounded-full transition text-gray-400 hover:text-gray-600"><X size={18} /></button>
                    </div>

                    <div className="text-xs text-amber-600 bg-amber-50 rounded p-2 flex flex-col gap-1">
                        <p className="font-bold">⚠️ コピーの動作について</p>
                        <p>現在のコマ（第{currentFrameIndex + 1}フレーム）の装飾配置、大きさを指定範囲のコマにコピーします。コピー先の既存装飾は「上書き」か「追加結合」を選択できます。</p>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500 font-bold">1. コピー先（フレーム範囲）</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={1}
                                max={frames.length}
                                value={copyTargetStart}
                                onChange={(e) => setCopyTargetStart(Math.max(1, Math.min(frames.length, Number(e.target.value))))}
                                className="w-16 px-2 py-1 text-sm border rounded text-center font-bold"
                            />
                            <span className="text-gray-400 text-xs">〜</span>
                            <input
                                type="number"
                                min={1}
                                max={frames.length}
                                value={copyTargetEnd}
                                onChange={(e) => setCopyTargetEnd(Math.max(1, Math.min(frames.length, Number(e.target.value))))}
                                className="w-16 px-2 py-1 text-sm border rounded text-center font-bold"
                            />
                            <span className="text-gray-400 text-xs">フレーム目</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-gray-500 font-bold">2. コピーする方法</label>
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="radio"
                                    name="copyMethod"
                                    checked={copyMethod === 'add'}
                                    onChange={() => setCopyMethod('add')}
                                    className="cursor-pointer"
                                />
                                既存の装飾に「追加」
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="radio"
                                    name="copyMethod"
                                    checked={copyMethod === 'overwrite'}
                                    onChange={() => setCopyMethod('overwrite')}
                                    className="cursor-pointer"
                                />
                                すべて消して「上書き」
                            </label>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-gray-500 font-bold">3. コピーする装飾の種類</label>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={copyText}
                                    onChange={(e) => setCopyText(e.target.checked)}
                                    className="cursor-pointer rounded border-gray-300"
                                />
                                文字（テキスト）
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={copyImage}
                                    onChange={(e) => setCopyImage(e.target.checked)}
                                    className="cursor-pointer rounded border-gray-300"
                                />
                                重ね画像（スタンプ）
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={copyDrawing}
                                    onChange={(e) => setCopyDrawing(e.target.checked)}
                                    className="cursor-pointer rounded border-gray-300"
                                />
                                手書き（ペイント）
                            </label>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t pt-3 mt-1 shrink-0">
                        <button type="button" onClick={() => setShowCopyModal(false)} className="px-3 py-1.5 bg-gray-150 hover:bg-gray-200 text-gray-600 rounded text-xs font-bold transition">
                            閉じる
                        </button>
                        <button
                            type="button"
                            onClick={handleExecuteCopy}
                            disabled={!copyText && !copyImage && !copyDrawing}
                            className="px-4 py-11.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:bg-purple-400 text-white rounded text-xs font-bold transition flex items-center gap-1.5 shadow"
                        >
                            <Check size={14} /> コピーを実行する
                        </button>
                    </div>
                </div>
            </div>
        )}
        {toastMessage && (<div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[60] bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none whitespace-nowrap animate-[fadeIn_0.3s_ease-in-out]">{toastMessage}</div>)}
      </div>
    </div>
  );
};
