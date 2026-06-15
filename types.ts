
export interface SourceImage {
  id: string;
  url: string;
  file: File;
  width: number;
  height: number;
}

export interface TextObject {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string; // 'M PLUS Rounded 1c', 'Noto Sans JP', 'Noto Serif JP'
  color: string;
  isVertical: boolean;
  outlineColor: string;
  outlineWidth: number;
  zIndex: 'front' | 'back';
  layerOrder?: number; // Added: Drawing order (smaller is back)
  rotation: number; // degrees
  curvature: number; // -100 to 100 (0 is straight)
}

export interface TextSetConfig {
  texts: string[];           // テキストのリスト（1行1テキスト）
  fontSize: number;
  fontFamily: string;
  color: string;
  outlineColor: string;
  outlineWidth: number;
  isVertical: boolean;
  position: 'top' | 'center' | 'bottom'; // テキストのY座標の目安
  zIndex: 'front' | 'back';
  rotation: number;
  curvature: number;
}

export interface ImageLayerObject {
  id: string;
  dataUrl: string;       // 透過PNG の base64
  originalWidth: number; // 元画像の幅
  originalHeight: number;// 元画像の高さ
  x: number;             // キャンバス上のX座標（中心基準）
  y: number;             // キャンバス上のY座標（中心基準）
  scale: number;         // 1.0 = 原寸
  rotation: number;      // degrees
  opacity: number;       // 0.0 ~ 1.0
  zIndex: 'front' | 'back';
  layerOrder?: number;   // Added
}

export interface StrokeItem {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  opacity: number;
  outlineColor?: string;
  outlineWidth?: number;
}

export interface DrawingStroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
  opacity: number;
  zIndex: 'front' | 'back';
  layerOrder?: number;   // Added
  outlineColor?: string;
  outlineWidth?: number;
  strokes?: StrokeItem[];
}

export interface Stamp {
  id: string;
  sourceImageId: string; // Reference to the source image
  originalX: number;
  originalY: number;
  width: number;
  height: number;
  dataUrl: string; // The cutout transparent image
  originalDataUrl?: string; // The raw cutout image (without bg removal) for restoration
  isExcluded: boolean;
  // For editor state (370x320)
  scale: number;
  rotation?: number; // Added rotation in degrees
  offsetX: number;
  offsetY: number;
  currentTolerance?: number; // Track the tolerance used for this stamp
  textObjects?: TextObject[]; // Added text objects
  
  // Future features
  imageLayers?: ImageLayerObject[];
  drawingStrokes?: DrawingStroke[];
  mainImageLayerOrder?: number; // Added: Order of the main stamp image (default 100)
  
  flipH?: boolean;   // 左右反転
  flipV?: boolean;   // 上下反転
  isAnimated?: boolean; // 動くスタンプかどうか
  rawFrames?: string[]; // 各フレームの透過済み画像 (base64)
  fps?: number; // アニメーション速度
  playbackDuration?: number; // 1ループの再生秒数（LINE規定: 1/2/3/4秒）
  apngInfo?: {
    width: number;
    height: number;
    byteSize: number;
    frameCount: number;
    totalDuration: number;
    delay: number;
    loops: number;
    colors: number;
    colorReduced: boolean;
  };
  rawOriginalFrames?: string[]; // 各コマの背景除去前の生画像 base64 配列
  textObjectsFrames?: TextObject[][]; // 各コマごとのテキスト配列の配列
  imageLayersFrames?: ImageLayerObject[][]; // 各コマごとの重ね合わせ画像配列の配列
  drawingStrokesFrames?: DrawingStroke[][]; // 各コマごとの手書きストローク配列 of 配列
  scalesFrames?: number[]; // 各コマごとのスケール（拡大縮小率）
  rotationsFrames?: number[]; // 各コマごとの回転
  offsetsXFrames?: number[]; // 各コマごとのXオフセット
  offsetsYFrames?: number[]; // 各コマごとのYオフセット
  flipsHFrames?: boolean[]; // 各コマごとの左右反転
  flipsVFrames?: boolean[]; // 各コマごとの上下反転
}

export interface ExportConfig {
  id: string;
  scale: number;
  rotation?: number; // Added rotation
  offsetX: number;
  offsetY: number;
  sourceWidth?: number;
  sourceHeight?: number;
  customDataUrl?: string; // If edited specifically for Main/Tab (eraser etc)
  textObjects?: TextObject[]; // Added text objects for Main/Tab
  
  // Future features
  imageLayers?: ImageLayerObject[];
  drawingStrokes?: DrawingStroke[];
  mainImageLayerOrder?: number; // Added
  
  flipH?: boolean;
  flipV?: boolean;

  // Frame-by-frame decorations for animation exports
  rawOriginalFrames?: string[];
  textObjectsFrames?: TextObject[][];
  imageLayersFrames?: ImageLayerObject[][];
  drawingStrokesFrames?: DrawingStroke[][];
  scalesFrames?: number[];
  rotationsFrames?: number[];
  offsetsXFrames?: number[];
  offsetsYFrames?: number[];
  flipsHFrames?: boolean[];
  flipsVFrames?: boolean[];
}

export interface MetaData {
  stampNameJa: string;
  stampDescJa: string;
  stampNameEn: string;
  stampDescEn: string;
}

export enum AppStep {
  UPLOAD = 'UPLOAD',
  PROCESSING = 'PROCESSING',
  EDIT = 'EDIT',
  EXPORT = 'EXPORT',
}

export interface ProcessedResult {
  stamps: Stamp[];
  originalWidth: number;
  originalHeight: number;
}

export const TARGET_WIDTH = 370;
export const TARGET_HEIGHT = 320;
export const MAIN_WIDTH = 240;
export const MAIN_HEIGHT = 240;
export const TAB_WIDTH = 96;
export const TAB_HEIGHT = 74;
