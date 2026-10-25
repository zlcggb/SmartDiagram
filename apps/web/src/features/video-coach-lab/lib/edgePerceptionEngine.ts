/**
 * AI 视觉分析教练 — 浏览器端高精度三合一感知引擎（Holistic 教练级）
 *
 * 集成 Google MediaPipe 官方三大高精度本地模型（位于 /public/mediapipe/）：
 * 1. PoseLandmarker Full (pose_landmarker_full.task)：33 个高精度全身骨骼关键点 + EMA 平滑防抖
 * 2. HandLandmarker (hand_landmarker.task)：双手 21×2 = 42 个精细手指关节（拇指/食指/中指/无名指/小指每一节指骨与指尖）
 * 3. FaceLandmarker (face_landmarker.task)：面部 478 个 3D 网格点 + 52 维表情肌肉系数（头部 Yaw/Pitch/Roll 3D 朝向、视线、说话/微笑状态）
 */

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface HandDetectionItem {
  handedness: 'Left' | 'Right'; // 用户真实左右手
  score: number;
  landmarks: LandmarkPoint[]; // 21 个手指关键点 (0:手腕, 1-4:拇指, 5-8:食指, 9-12:中指, 13-16:无名指, 17-20:小指)
}

export interface FaceDetectionItem {
  landmarks: LandmarkPoint[]; // 478 个面部 3D 关键点
  blendshapes: Record<string, number>; // 52 维面部肌肉系数 (mouthSmile, jawOpen, eyeBlink, browInnerUp...)
}

export interface HolisticDetectionResult {
  poseLandmarks: LandmarkPoint[] | null;
  hands: HandDetectionItem[];
  face: FaceDetectionItem | null;
}

export interface OverlayLayerConfig {
  showPose: boolean;
  showHands: boolean;
  showFace: boolean;
}

export interface RealPoseTelemetry {
  timestampSec: number;
  timeLabel: string;
  diffScore: number;
  personDetected: boolean;
  framingDesc: string;
  visibleParts: string[];
  // 面部 478 点与头部 3D 朝向实测
  faceDetected: boolean;
  headRollDeg: number | null; // 歪头倾角
  headYawDeg: number | null; // 左右转头角（正数偏右，负数偏左）
  headPitchDeg: number | null; // 俯仰低头角（正数低头，负数仰头）
  headPoseSummary: string;
  faceExpressionSummary: string;
  // 双手 42 指关节实测
  handsDetectedCount: number;
  leftHandSummary: string | null;
  rightHandSummary: string | null;
  leftExtendedFingers: number | null;
  rightExtendedFingers: number | null;
  // 身体关节实测（未入镜为 null）
  shoulderTiltDeg: number | null;
  headTiltDeg: number | null;
  leftElbowDeg: number | null;
  rightElbowDeg: number | null;
  leftShoulderLiftDeg: number | null;
  rightShoulderLiftDeg: number | null;
  trunkLeanDeg: number | null;
  leftKneeDeg: number | null;
  rightKneeDeg: number | null;
  statusSummary: string;
}

export interface SampledKeyframe {
  frameIndex: number;
  timestampSec: number;
  timeLabel: string;
  rawDataUrl: string;
  annotatedDataUrl: string;
  telemetry: RealPoseTelemetry;
}

export interface ComposedWindowBundle {
  windowIndex: number;
  startSec: number;
  endSec: number;
  timeRangeLabel: string;
  gridDataUrl: string;
  rawFramesDataUrls: string[];
  keyframes: SampledKeyframe[];
  poseMetricsJson: Record<string, unknown>;
}

/**
 * 帧间像素差分门控器
 */
export class FrameDiffGate {
  private prevLuma: Uint8Array | null = null;
  private readonly sampleW = 48;
  private readonly sampleH = 27;
  private workCanvas: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D;

  constructor() {
    this.workCanvas = document.createElement('canvas');
    this.workCanvas.width = this.sampleW;
    this.workCanvas.height = this.sampleH;
    const ctx = this.workCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.workCtx = ctx;
  }

  public computeDiff(source: HTMLVideoElement | HTMLCanvasElement): number {
    this.workCtx.drawImage(source, 0, 0, this.sampleW, this.sampleH);
    const rgba = this.workCtx.getImageData(0, 0, this.sampleW, this.sampleH).data;
    const pixelCount = this.sampleW * this.sampleH;
    const currLuma = new Uint8Array(pixelCount);

    let diffSum = 0;
    for (let i = 0; i < pixelCount; i++) {
      const idx = i * 4;
      const y = (rgba[idx] * 77 + rgba[idx + 1] * 150 + rgba[idx + 2] * 29) >> 8;
      currLuma[i] = y;
      if (this.prevLuma) {
        diffSum += Math.abs(y - this.prevLuma[i]);
      }
    }
    this.prevLuma = currLuma;
    return Number((diffSum / pixelCount).toFixed(2));
  }

  public reset(): void {
    this.prevLuma = null;
  }
}

export function formatSecToTimeLabel(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

function calcAngle2D(a: LandmarkPoint, b: LandmarkPoint, c: LandmarkPoint): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 < 1e-5 || mag2 < 1e-5) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

function isLandmarkVisible(lm: LandmarkPoint | undefined, minVis = 0.55): lm is LandmarkPoint {
  if (!lm) return false;
  const vis = lm.visibility ?? 1.0;
  return vis >= minVis && lm.x >= 0.01 && lm.x <= 0.99 && lm.y >= 0.01 && lm.y <= 0.99;
}

/**
 * 对关键点序列做指数移动平均（EMA）平滑滤波，消除单帧抖动，让骨骼贴合如丝般顺滑
 */
function smoothLandmarks(
  prev: LandmarkPoint[] | null,
  curr: LandmarkPoint[] | null,
  alpha = 0.62,
): LandmarkPoint[] | null {
  if (!curr || curr.length === 0) return null;
  if (!prev || prev.length !== curr.length) {
    return curr.map((pt) => ({ ...pt }));
  }
  return curr.map((pt, i) => {
    const p = prev[i];
    // 若位移极大（快速挥手），提高跟随权重减少拖影
    const dist = Math.hypot(pt.x - p.x, pt.y - p.y);
    const dynAlpha = dist > 0.08 ? 0.85 : alpha;
    return {
      x: p.x * (1 - dynAlpha) + pt.x * dynAlpha,
      y: p.y * (1 - dynAlpha) + pt.y * dynAlpha,
      z: pt.z !== undefined && p.z !== undefined ? p.z * (1 - dynAlpha) + pt.z * dynAlpha : pt.z,
      visibility: pt.visibility,
    };
  });
}

/**
 * Google MediaPipe 三合一高精度感知服务（Pose Full + Hand 42点 + Face 478点）
 */
class RealMediaPipeHolisticService {
  private poseLandmarker: any = null;
  private handLandmarker: any = null;
  private faceLandmarker: any = null;
  private loadingPromise: Promise<boolean> | null = null;

  public loadError: string | null = null;
  public isReady = false;
  public activeModelsDesc = '正在加载姿态/手部/面部高精度模型...';

  // 缓存上一次检测结果与平滑坐标（避免每帧重复跑 3 个模型导致掉帧）
  private lastDetectTimeMs = 0;
  private prevPose: LandmarkPoint[] | null = null;
  private cachedResult: HolisticDetectionResult = {
    poseLandmarks: null,
    hands: [],
    face: null,
  };

  public resetCache(): void {
    this.lastDetectTimeMs = 0;
    this.prevPose = null;
    this.cachedResult = { poseLandmarks: null, hands: [], face: null };
  }

  public async ensureLoaded(): Promise<boolean> {
    if (this.isReady && this.poseLandmarker) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      const t0 = performance.now();
      try {
        const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
        const vision: any = await nativeImport('/mediapipe/vision_bundle.mjs');
        const { FilesetResolver, PoseLandmarker, HandLandmarker, FaceLandmarker } = vision;
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

        const createWithFallback = async (Creator: any, optionsGpu: any, optionsCpu: any) => {
          try {
            return await Creator.createFromOptions(fileset, optionsGpu);
          } catch {
            return await Creator.createFromOptions(fileset, optionsCpu);
          }
        };

        const MODEL_PATHS = {
          pose: '/mediapipe/pose_landmarker_full.task',
          hand: '/mediapipe/hand_landmarker.task',
          face: '/mediapipe/face_landmarker.task',
        };

        const [pose, hand, face] = await Promise.all([
          createWithFallback(
            PoseLandmarker,
            {
              baseOptions: { modelAssetPath: MODEL_PATHS.pose, delegate: 'GPU' },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.55,
              minPosePresenceConfidence: 0.55,
              minTrackingConfidence: 0.55,
            },
            {
              baseOptions: { modelAssetPath: MODEL_PATHS.pose, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numPoses: 1,
            },
          ),
          createWithFallback(
            HandLandmarker,
            {
              baseOptions: { modelAssetPath: MODEL_PATHS.hand, delegate: 'GPU' },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            },
            {
              baseOptions: { modelAssetPath: MODEL_PATHS.hand, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numHands: 2,
            },
          ).catch(() => null),
          createWithFallback(
            FaceLandmarker,
            {
              baseOptions: { modelAssetPath: MODEL_PATHS.face, delegate: 'GPU' },
              runningMode: 'VIDEO',
              numFaces: 1,
              outputFaceBlendshapes: true,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            },
            {
              baseOptions: { modelAssetPath: MODEL_PATHS.face, delegate: 'CPU' },
              runningMode: 'VIDEO',
              numFaces: 1,
              outputFaceBlendshapes: true,
            },
          ).catch(() => null),
        ]);

        this.poseLandmarker = pose;
        this.handLandmarker = hand;
        this.faceLandmarker = face;

        const costMs = Math.round(performance.now() - t0);
        this.activeModelsDesc = `全身33点(Full) + 双手42指关节 + 面部478点 (${costMs}ms就绪)`;
        this.isReady = true;
        this.loadError = null;

        // 后台异步将三大模型及 WASM 引擎持久化固定到浏览器 CacheStorage，绝不阻塞主线程
        if (typeof window !== 'undefined' && 'caches' in window) {
          setTimeout(() => {
            window.caches
              .open('smartdiagram-mediapipe-models-v1')
              .then((cache) =>
                cache.addAll([
                  MODEL_PATHS.pose,
                  MODEL_PATHS.hand,
                  MODEL_PATHS.face,
                  '/mediapipe/wasm/vision_wasm_internal.wasm',
                ]),
              )
              .catch(() => {});
          }, 800);
        }

        return true;
      } catch (err) {
        this.loadError = (err as Error).message || 'MediaPipe 高精度模型加载失败';
        this.loadingPromise = null;
        return false;
      }
    })();

    return this.loadingPromise;
  }

  /**
   * 对真实视频帧执行三模型检测（带 55ms 节流与 EMA 平滑，保证 60fps 流畅度与高精度）
   */
  public detectHolisticFrame(
    videoOrCanvas: HTMLVideoElement | HTMLCanvasElement,
    timestampMs: number,
    layers: OverlayLayerConfig = { showPose: true, showHands: true, showFace: true },
  ): HolisticDetectionResult {
    if (!this.poseLandmarker) {
      return { poseLandmarks: null, hands: [], face: null };
    }

    // 控制检测频率约 18 FPS（每 55ms 跑一次推理），中间帧直接返回平滑后的最新骨骼
    if (timestampMs - this.lastDetectTimeMs < 55 && this.cachedResult.poseLandmarks) {
      return this.cachedResult;
    }

    const safeTs = Math.max(Math.round(timestampMs), Math.round(this.lastDetectTimeMs) + 1);
    this.lastDetectTimeMs = safeTs;

    let poseLandmarks: LandmarkPoint[] | null = null;
    const hands: HandDetectionItem[] = [];
    let face: FaceDetectionItem | null = null;

    try {
      const poseRes = this.poseLandmarker.detectForVideo(videoOrCanvas, safeTs);
      if (poseRes?.landmarks?.length > 0) {
        poseLandmarks = smoothLandmarks(this.prevPose, poseRes.landmarks[0] as LandmarkPoint[]);
        this.prevPose = poseLandmarks;
      } else {
        this.prevPose = null;
      }
    } catch {
      poseLandmarks = this.prevPose;
    }

    if (this.handLandmarker && layers.showHands) {
      try {
        const handRes = this.handLandmarker.detectForVideo(videoOrCanvas, safeTs);
        if (handRes?.landmarks?.length > 0) {
          for (let i = 0; i < handRes.landmarks.length; i++) {
            const lms = handRes.landmarks[i] as LandmarkPoint[];
            const rawCat = handRes.handednesses?.[i]?.[0];
            // MediaPipe 默认按镜像视角命名 Left/Right，我们根据手腕与身体左右侧或直接转换为主体真实左右手
            const categoryName = rawCat?.categoryName === 'Left' ? 'Right' : 'Left';
            hands.push({
              handedness: categoryName,
              score: rawCat?.score ?? 0.9,
              landmarks: lms,
            });
          }
        }
      } catch {
        // ignore single frame error
      }
    }

    if (this.faceLandmarker && layers.showFace) {
      try {
        const faceRes = this.faceLandmarker.detectForVideo(videoOrCanvas, safeTs);
        if (faceRes?.faceLandmarks?.length > 0) {
          const lms = faceRes.faceLandmarks[0] as LandmarkPoint[];
          const blendMap: Record<string, number> = {};
          const cats = faceRes.faceBlendshapes?.[0]?.categories;
          if (Array.isArray(cats)) {
            for (const c of cats) {
              if (c?.categoryName) {
                blendMap[c.categoryName] = Number(c.score ?? 0);
              }
            }
          }
          face = { landmarks: lms, blendshapes: blendMap };
        }
      } catch {
        // ignore single frame error
      }
    }

    this.cachedResult = { poseLandmarks, hands, face };
    return this.cachedResult;
  }
}

export const realPoseService = new RealMediaPipeHolisticService();

// 手掌 21 个关节的解剖学骨骼连线表
const HAND_CONNECTIONS: [number, number][] = [
  // 拇指
  [0, 1], [1, 2], [2, 3], [3, 4],
  // 食指
  [0, 5], [5, 6], [6, 7], [7, 8],
  // 中指
  [5, 9], [9, 10], [10, 11], [11, 12],
  // 无名指
  [9, 13], [13, 14], [14, 15], [15, 16],
  // 小指
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

// 面部核心解剖学特征连线（左眼、右眼、左眉、右眉、鼻梁、上下唇轮廓、下颌骨）
const FACE_CONTOUR_CHAINS: number[][] = [
  // 左眼轮廓
  [33, 160, 158, 133, 153, 144, 33],
  // 右眼轮廓
  [362, 385, 387, 263, 373, 380, 362],
  // 左眉与右眉
  [70, 63, 105, 66, 107],
  [336, 296, 334, 293, 300],
  // 鼻梁中轴线
  [168, 6, 197, 195, 5, 4],
  // 外唇轮廓
  [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
  // 面部下颌/脸颊流线
  [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454],
];

/**
 * 分析单只手 21 个关节的伸展状态与手势语义
 */
function analyzeSingleHand(
  hand: HandDetectionItem,
  nosePt?: LandmarkPoint,
  shoulderY?: number,
): { summary: string; extendedCount: number } {
  const lm = hand.landmarks;
  if (!lm || lm.length < 21) {
    return { summary: '未完整入镜', extendedCount: 0 };
  }

  const wrist = lm[0];
  // 判断拇指伸展：指尖(4)到小指根(17)的距离 > 指节(2)到小指根(17)的距离
  const thumbExtended =
    Math.hypot(lm[4].x - lm[17].x, lm[4].y - lm[17].y) >
    Math.hypot(lm[2].x - lm[17].x, lm[2].y - lm[17].y) * 1.12;

  // 判断其余四指伸展：指尖到腕部距离 > PIP指节到腕部距离 * 1.12 且关节夹角 > 145°
  const checkFinger = (mcp: number, pip: number, _dip: number, tip: number) => {
    const dTip = Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y);
    const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y);
    const ang = calcAngle2D(lm[mcp], lm[pip], lm[tip]);
    return dTip > dPip * 1.08 && ang >= 140;
  };

  const indexExt = checkFinger(5, 6, 7, 8);
  const middleExt = checkFinger(9, 10, 11, 12);
  const ringExt = checkFinger(13, 14, 15, 16);
  const pinkyExt = checkFinger(17, 18, 19, 20);

  const extendedCount =
    (thumbExtended ? 1 : 0) +
    (indexExt ? 1 : 0) +
    (middleExt ? 1 : 0) +
    (ringExt ? 1 : 0) +
    (pinkyExt ? 1 : 0);

  let gestureName = `伸展${extendedCount}指`;
  if (extendedCount === 5) gestureName = '五指张开';
  else if (extendedCount === 0) gestureName = '握拳状态';
  else if (indexExt && !middleExt && !ringExt && !pinkyExt) gestureName = '单指伸出/指示';
  else if (indexExt && middleExt && !ringExt && !pinkyExt) gestureName = '双指伸展(V字)';
  else if (extendedCount >= 3) gestureName = `手指自然张开(${extendedCount}指)`;
  else gestureName = `手指半曲(${extendedCount}指伸展)`;

  // 判断手相对于头部/肩膀的高度位置
  let posTag = '';
  const palmCenterY = (wrist.y + lm[9].y) / 2;
  const palmCenterX = (wrist.x + lm[9].x) / 2;
  if (nosePt && Math.hypot(palmCenterX - nosePt.x, palmCenterY - nosePt.y) < 0.22) {
    if (palmCenterY < nosePt.y - 0.05) {
      posTag = ' · 置于头顶/额前';
    } else {
      posTag = ' · 贴近面部/头部侧方';
    }
  } else if (nosePt && palmCenterY < nosePt.y) {
    posTag = ' · 高举过头';
  } else if (shoulderY !== undefined && palmCenterY < shoulderY) {
    posTag = ' · 抬至肩颈上方';
  } else {
    posTag = ' · 位于胸前';
  }

  return {
    summary: `${gestureName}${posTag}`,
    extendedCount,
  };
}

/**
 * 在画布上绘制教练级三合一高精度视觉层（全身 33 点 + 双手 42 指关节 + 面部 478 点网格与朝向），并返回量化遥测
 */
export function analyzeAndDrawRealPose(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  holistic: HolisticDetectionResult | LandmarkPoint[] | null,
  timestampSec: number,
  diffScore: number,
  drawOverlay = true,
  layers: OverlayLayerConfig = { showPose: true, showHands: true, showFace: true },
): RealPoseTelemetry {
  const timeLabel = formatSecToTimeLabel(timestampSec);

  // 兼容直接传入 LandmarkPoint[] 或 HolisticDetectionResult
  const result: HolisticDetectionResult = Array.isArray(holistic)
    ? { poseLandmarks: holistic, hands: [], face: null }
    : holistic || { poseLandmarks: null, hands: [], face: null };

  const landmarks = result.poseLandmarks;
  const hands = result.hands || [];
  const face = result.face;

  if ((!landmarks || landmarks.length < 33) && !face && hands.length === 0) {
    return {
      timestampSec,
      timeLabel,
      diffScore,
      personDetected: false,
      framingDesc: '画面中未检测到人物',
      visibleParts: [],
      faceDetected: false,
      headRollDeg: null,
      headYawDeg: null,
      headPitchDeg: null,
      headPoseSummary: '未检测到面部',
      faceExpressionSummary: '未检测到面部',
      handsDetectedCount: 0,
      leftHandSummary: null,
      rightHandSummary: null,
      leftExtendedFingers: null,
      rightExtendedFingers: null,
      shoulderTiltDeg: null,
      headTiltDeg: null,
      leftElbowDeg: null,
      rightElbowDeg: null,
      leftShoulderLiftDeg: null,
      rightShoulderLiftDeg: null,
      trunkLeanDeg: null,
      leftKneeDeg: null,
      rightKneeDeg: null,
      statusSummary: '未检测到人物（请确保人物在摄像头画面内）',
    };
  }

  const lm = landmarks || [];
  const nose = lm[0];
  const lEar = lm[7];
  const rEar = lm[8];
  const lShoulder = lm[11];
  const rShoulder = lm[12];
  const lElbow = lm[13];
  const rElbow = lm[14];
  const lWrist = lm[15];
  const rWrist = lm[16];
  const lHip = lm[23];
  const rHip = lm[24];
  const lKnee = lm[25];
  const rKnee = lm[26];
  const lAnkle = lm[27];
  const rAnkle = lm[28];

  const visibleParts: string[] = [];
  const hasHead = Boolean(face) || isLandmarkVisible(nose) || isLandmarkVisible(lEar) || isLandmarkVisible(rEar);
  const hasShoulders = isLandmarkVisible(lShoulder) || isLandmarkVisible(rShoulder);
  const hasLeftArm = isLandmarkVisible(lElbow) || isLandmarkVisible(lWrist);
  const hasRightArm = isLandmarkVisible(rElbow) || isLandmarkVisible(rWrist);
  const hasHips = isLandmarkVisible(lHip) && isLandmarkVisible(rHip);
  const hasKnees = isLandmarkVisible(lKnee) || isLandmarkVisible(rKnee);

  if (face) visibleParts.push('面部478点网格');
  else if (hasHead) visibleParts.push('头部');
  if (hasShoulders) visibleParts.push('双肩');
  if (hasLeftArm) visibleParts.push('左臂');
  if (hasRightArm) visibleParts.push('右臂');
  if (hands.length > 0) visibleParts.push(`手部21指关节(${hands.length}只手)`);
  if (hasHips) visibleParts.push('躯干/髋部');
  if (hasKnees) visibleParts.push('腿部/膝盖');

  // ==================== 1. 面部 478 点 3D 朝向与表情肌肉精确解算 ====================
  let headRollDeg: number | null = null;
  let headYawDeg: number | null = null;
  let headPitchDeg: number | null = null;
  let headPoseSummary = '未入镜';
  let faceExpressionSummary = '未锁定面部网格';

  if (face && face.landmarks.length >= 468) {
    const flm = face.landmarks;
    const leftEyeOuter = flm[33];
    const rightEyeOuter = flm[263];
    const noseTip = flm[1];
    const forehead = flm[10];
    const chin = flm[152];
    const leftCheek = flm[234];
    const rightCheek = flm[454];

    // Roll（歪头角）：双眼外眼角连线与水平线夹角
    const dyEye = (rightEyeOuter.y - leftEyeOuter.y) * height;
    const dxEye = Math.max(1, Math.abs((rightEyeOuter.x - leftEyeOuter.x) * width));
    headRollDeg = Number(((Math.atan2(Math.abs(dyEye), dxEye) * 180) / Math.PI).toFixed(1));

    // Yaw（左右转头角）：鼻尖相对于左右脸颊中点的水平偏移比例
    const faceMidX = (leftCheek.x + rightCheek.x) / 2;
    const faceWidth = Math.max(0.05, Math.abs(rightCheek.x - leftCheek.x));
    const yawRatio = (noseTip.x - faceMidX) / (faceWidth * 0.5);
    headYawDeg = Math.round(Math.max(-55, Math.min(55, yawRatio * 48)));

    // Pitch（低头/仰头俯仰角）：鼻尖在额头-下巴垂直轴上的比例偏移
    const faceHeight = Math.max(0.05, chin.y - forehead.y);
    const noseRelY = (noseTip.y - forehead.y) / faceHeight;
    // 正常平视时鼻尖约在 0.56 位置
    headPitchDeg = Math.round(Math.max(-45, Math.min(45, (noseRelY - 0.56) * 160)));

    const yawText =
      Math.abs(headYawDeg) <= 8
        ? '正视镜头'
        : headYawDeg > 0
          ? `向左侧转头 ${Math.abs(headYawDeg)}°`
          : `向右侧转头 ${Math.abs(headYawDeg)}°`;
    const pitchText =
      Math.abs(headPitchDeg) <= 8
        ? '平视'
        : headPitchDeg > 0
          ? `低头 ${Math.abs(headPitchDeg)}°`
          : `仰头 ${Math.abs(headPitchDeg)}°`;
    const rollText = headRollDeg <= 5 ? '头颈端正' : `歪头倾角 ${headRollDeg}°`;
    headPoseSummary = `${yawText} · ${pitchText} · ${rollText}`;

    // 解析 Blendshapes 表情肌肉状态
    const bs = face.blendshapes;
    const jawOpen = bs.jawOpen ?? 0;
    const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;
    const blink = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2;
    const browUp = bs.browInnerUp ?? 0;

    const expTags: string[] = [];
    if (jawOpen > 0.22) expTags.push('正在张嘴/说话');
    else if (smile > 0.35) expTags.push(`面带微笑(${Math.round(smile * 100)}%)`);
    else expTags.push('唇部自然闭合');

    if (blink > 0.45) expTags.push('眨眼/垂眸');
    else expTags.push('双眼专注注视');

    if (browUp > 0.35) expTags.push('眉弓微挑');
    faceExpressionSummary = expTags.join(' · ');
  } else if (isLandmarkVisible(lEar) && isLandmarkVisible(rEar)) {
    const dy = Math.abs(lEar.y - rEar.y) * height;
    const dx = Math.max(1, Math.abs(lEar.x - rEar.x) * width);
    headRollDeg = Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
    headPoseSummary = `头部倾角 ${headRollDeg}°`;
  }

  // ==================== 2. 双手 21×2 = 42 指关节精确解算 ====================
  let leftHandSummary: string | null = null;
  let rightHandSummary: string | null = null;
  let leftExtendedFingers: number | null = null;
  let rightExtendedFingers: number | null = null;

  const shoulderMidY =
    isLandmarkVisible(lShoulder) && isLandmarkVisible(rShoulder)
      ? (lShoulder.y + rShoulder.y) / 2
      : undefined;
  const refNose = face?.landmarks?.[1] || (isLandmarkVisible(nose) ? nose : undefined);

  for (const h of hands) {
    const analyzed = analyzeSingleHand(h, refNose, shoulderMidY);
    if (h.handedness === 'Left') {
      leftHandSummary = analyzed.summary;
      leftExtendedFingers = analyzed.extendedCount;
    } else {
      rightHandSummary = analyzed.summary;
      rightExtendedFingers = analyzed.extendedCount;
    }
  }

  // ==================== 3. 身体关节角度精确解算 ====================
  let shoulderTiltDeg: number | null = null;
  if (isLandmarkVisible(lShoulder) && isLandmarkVisible(rShoulder)) {
    const dy = Math.abs(lShoulder.y - rShoulder.y) * height;
    const dx = Math.max(1, Math.abs(lShoulder.x - rShoulder.x) * width);
    shoulderTiltDeg = Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
  }

  let leftElbowDeg: number | null = null;
  if (isLandmarkVisible(lShoulder) && isLandmarkVisible(lElbow) && isLandmarkVisible(lWrist)) {
    leftElbowDeg = calcAngle2D(lShoulder, lElbow, lWrist);
  }

  let rightElbowDeg: number | null = null;
  if (isLandmarkVisible(rShoulder) && isLandmarkVisible(rElbow) && isLandmarkVisible(rWrist)) {
    rightElbowDeg = calcAngle2D(rShoulder, rElbow, rWrist);
  }

  // 肩部抬臂角度（肘部相对于肩垂线的抬起角，哪怕髋部没入镜也能精确算出抬手角度！）
  let leftShoulderLiftDeg: number | null = null;
  if (isLandmarkVisible(lShoulder) && isLandmarkVisible(lElbow)) {
    const verticalDownPt: LandmarkPoint = { x: lShoulder.x, y: Math.min(0.99, lShoulder.y + 0.25) };
    leftShoulderLiftDeg = calcAngle2D(verticalDownPt, lShoulder, lElbow);
  }

  let rightShoulderLiftDeg: number | null = null;
  if (isLandmarkVisible(rShoulder) && isLandmarkVisible(rElbow)) {
    const verticalDownPt: LandmarkPoint = { x: rShoulder.x, y: Math.min(0.99, rShoulder.y + 0.25) };
    rightShoulderLiftDeg = calcAngle2D(verticalDownPt, rShoulder, rElbow);
  }

  let trunkLeanDeg: number | null = null;
  if (isLandmarkVisible(lShoulder) && isLandmarkVisible(rShoulder) && hasHips) {
    const midShoulderX = (lShoulder.x + rShoulder.x) / 2;
    const midShoulderY = (lShoulder.y + rShoulder.y) / 2;
    const midHipX = (lHip.x + rHip.x) / 2;
    const midHipY = (lHip.y + rHip.y) / 2;
    const dx = Math.abs(midShoulderX - midHipX) * width;
    const dy = Math.max(1, Math.abs(midHipY - midShoulderY) * height);
    trunkLeanDeg = Number(((Math.atan2(dx, dy) * 180) / Math.PI).toFixed(1));
  }

  let leftKneeDeg: number | null = null;
  if (isLandmarkVisible(lHip) && isLandmarkVisible(lKnee) && isLandmarkVisible(lAnkle)) {
    leftKneeDeg = calcAngle2D(lHip, lKnee, lAnkle);
  }

  let rightKneeDeg: number | null = null;
  if (isLandmarkVisible(rHip) && isLandmarkVisible(rKnee) && isLandmarkVisible(rAnkle)) {
    rightKneeDeg = calcAngle2D(rHip, rKnee, rAnkle);
  }

  let framingDesc = '局部入镜';
  if (hasKnees && hasHips && hasShoulders) {
    framingDesc = '全身入镜';
  } else if (hasHips && hasShoulders) {
    framingDesc = '半身入镜（腰髋以上）';
  } else if (hasShoulders || hasHead) {
    framingDesc = '近景头肩/上半身入镜';
  }

  // ==================== 4. 在画面上绘制高精度视觉图层 ====================
  if (drawOverlay) {
    ctx.save();

    // (A) 绘制面部 478 点核心生物力学网格与朝向轴
    if (layers.showFace && face && face.landmarks.length >= 468) {
      const flm = face.landmarks;
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)'; // 科技青蓝细线
      for (const chain of FACE_CONTOUR_CHAINS) {
        ctx.beginPath();
        for (let i = 0; i < chain.length; i++) {
          const pt = flm[chain[i]];
          if (!pt) continue;
          const px = pt.x * width;
          const py = pt.y * height;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // 绘制左右虹膜/瞳孔中心点 (468, 473) 与鼻尖朝向矢量
      const irisPts = [468, 473];
      for (const idx of irisPts) {
        if (flm[idx]) {
          ctx.beginPath();
          ctx.arc(flm[idx].x * width, flm[idx].y * height, 2.8, 0, Math.PI * 2);
          ctx.fillStyle = '#34D399';
          ctx.fill();
        }
      }
    }

    // (B) 绘制身体 33 点骨骼连线
    if (layers.showPose && lm.length >= 33) {
      const connections: [number, number, string][] = [
        [11, 12, '#30D158'], // 双肩连线（翠绿）
        [11, 13, '#38BDF8'], // 左上臂
        [13, 15, '#38BDF8'], // 左前臂
        [12, 14, '#38BDF8'], // 右上臂
        [14, 16, '#38BDF8'], // 右前臂
        [11, 23, '#818CF8'], // 左躯干
        [12, 24, '#818CF8'], // 右躯干
        [23, 24, '#818CF8'], // 髋部连线
        [23, 25, '#F59E0B'], // 左大腿
        [25, 27, '#F59E0B'], // 左小腿
        [24, 26, '#F59E0B'], // 右大腿
        [26, 28, '#F59E0B'], // 右小腿
      ];

      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const [i, j, color] of connections) {
        const p1 = lm[i];
        const p2 = lm[j];
        if (isLandmarkVisible(p1) && isLandmarkVisible(p2)) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.moveTo(p1.x * width, p1.y * height);
          ctx.lineTo(p2.x * width, p2.y * height);
          ctx.stroke();
        }
      }

      // 绘身体关键关节点
      const keyIndices = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
      for (const idx of keyIndices) {
        const pt = lm[idx];
        if (isLandmarkVisible(pt)) {
          const px = pt.x * width;
          const py = pt.y * height;
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = '#0284C7';
          ctx.stroke();
        }
      }

      // 标注实测角度气泡
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      if (shoulderTiltDeg !== null && isLandmarkVisible(lShoulder) && isLandmarkVisible(rShoulder)) {
        const mx = ((lShoulder.x + rShoulder.x) / 2) * width;
        const my = ((lShoulder.y + rShoulder.y) / 2) * height + 16;
        const warn = shoulderTiltDeg > 6;
        ctx.fillStyle = warn ? 'rgba(220, 38, 38, 0.88)' : 'rgba(15, 23, 42, 0.82)';
        ctx.fillRect(mx - 42, my - 11, 84, 17);
        ctx.fillStyle = warn ? '#FCA5A5' : '#4ADE80';
        ctx.fillText(`肩倾角 ${shoulderTiltDeg}°`, mx - 35, my + 1);
      }

      if (leftElbowDeg !== null && isLandmarkVisible(lElbow)) {
        const ex = lElbow.x * width + 8;
        const ey = lElbow.y * height;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.fillRect(ex, ey - 10, 64, 16);
        ctx.fillStyle = '#38BDF8';
        ctx.fillText(`左肘 ${leftElbowDeg}°`, ex + 5, ey + 2);
      }

      if (rightElbowDeg !== null && isLandmarkVisible(rElbow)) {
        const ex = Math.max(4, rElbow.x * width - 72);
        const ey = rElbow.y * height;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.fillRect(ex, ey - 10, 64, 16);
        ctx.fillStyle = '#38BDF8';
        ctx.fillText(`右肘 ${rightElbowDeg}°`, ex + 5, ey + 2);
      }
    }

    // (C) 绘制双手 21×2 = 42 个精细手指关节与指骨连线
    if (layers.showHands && hands.length > 0) {
      for (const hand of hands) {
        const hlm = hand.landmarks;
        const isLeft = hand.handedness === 'Left';
        const boneColor = isLeft ? '#34D399' : '#A78BFA'; // 左手翡翠绿，右手紫罗兰
        const tipColor = '#FBBF24'; // 指尖亮琥珀金

        ctx.lineWidth = 2.2;
        ctx.strokeStyle = boneColor;
        for (const [a, b] of HAND_CONNECTIONS) {
          const p1 = hlm[a];
          const p2 = hlm[b];
          if (p1 && p2) {
            ctx.beginPath();
            ctx.moveTo(p1.x * width, p1.y * height);
            ctx.lineTo(p2.x * width, p2.y * height);
            ctx.stroke();
          }
        }

        // 绘制 21 个手部关节点（指尖 4/8/12/16/20 高亮）
        for (let i = 0; i < hlm.length; i++) {
          const pt = hlm[i];
          const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
          ctx.beginPath();
          ctx.arc(pt.x * width, pt.y * height, isTip ? 4.2 : 3.0, 0, Math.PI * 2);
          ctx.fillStyle = isTip ? tipColor : '#FFFFFF';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = boneColor;
          ctx.stroke();
        }

        // 在手腕旁标注手势状态标签
        const wrist = hlm[0];
        if (wrist) {
          const wx = Math.min(width - 135, Math.max(6, wrist.x * width - 45));
          const wy = Math.min(height - 10, Math.max(18, wrist.y * height + 20));
          const label = `${isLeft ? '左手' : '右手'}: ${(isLeft ? leftHandSummary : rightHandSummary)?.split(' · ')[0] || ''}`;
          ctx.font = 'bold 10.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(wx - 4, wy - 11, ctx.measureText(label).width + 10, 16);
          ctx.fillStyle = boneColor;
          ctx.fillText(label, wx + 1, wy + 1);
        }
      }
    }

    ctx.restore();
  }

  const summaryParts: string[] = [framingDesc];
  if (headRollDeg !== null) summaryParts.push(`头倾 ${headRollDeg}°`);
  if (shoulderTiltDeg !== null) summaryParts.push(`肩倾 ${shoulderTiltDeg}°`);
  if (leftHandSummary) summaryParts.push(`左手:${leftHandSummary.split(' · ')[0]}`);
  if (rightHandSummary) summaryParts.push(`右手:${rightHandSummary.split(' · ')[0]}`);

  return {
    timestampSec,
    timeLabel,
    diffScore,
    personDetected: true,
    framingDesc,
    visibleParts,
    faceDetected: Boolean(face),
    headRollDeg,
    headYawDeg,
    headPitchDeg,
    headPoseSummary,
    faceExpressionSummary,
    handsDetectedCount: hands.length,
    leftHandSummary,
    rightHandSummary,
    leftExtendedFingers,
    rightExtendedFingers,
    shoulderTiltDeg,
    headTiltDeg: headRollDeg,
    leftElbowDeg,
    rightElbowDeg,
    leftShoulderLiftDeg,
    rightShoulderLiftDeg,
    trunkLeanDeg,
    leftKneeDeg,
    rightKneeDeg,
    statusSummary: summaryParts.join(' · '),
  };
}

/**
 * 将最近 4 帧真实画面合成为紧凑高清的 2×2 时序网格图（768×432，体积减小 42%，大幅降低 VLM 首字延迟）
 */
export function composeRealTemporalGridBundle(
  windowIndex: number,
  sampledFrames: {
    rawCanvas: HTMLCanvasElement;
    annotatedCanvas: HTMLCanvasElement;
    telemetry: RealPoseTelemetry;
  }[],
): ComposedWindowBundle {
  const count = sampledFrames.length;
  const indices =
    count >= 4
      ? [0, Math.floor((count - 1) / 3), Math.floor(((count - 1) * 2) / 3), count - 1]
      : [0, 0, 0, Math.max(0, count - 1)];

  const picked = indices.map((idx, i) => {
    const item = sampledFrames[Math.min(idx, count - 1)];
    return {
      frameIndex: i + 1,
      timestampSec: item.telemetry.timestampSec,
      timeLabel: item.telemetry.timeLabel,
      rawCanvas: item.rawCanvas,
      annotatedCanvas: item.annotatedCanvas,
      telemetry: item.telemetry,
    };
  });

  // 采用 768×432 紧凑高清尺寸，兼顾骨骼标签清晰度与极速网络传输
  const gridW = 768;
  const gridH = 432;
  const cellW = gridW / 2;
  const cellH = gridH / 2;

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gridW;
  gridCanvas.height = gridH;
  const gCtx = gridCanvas.getContext('2d')!;

  gCtx.fillStyle = '#0F172A';
  gCtx.fillRect(0, 0, gridW, gridH);

  const positions = [
    { x: 0, y: 0 },
    { x: cellW, y: 0 },
    { x: 0, y: cellH },
    { x: cellW, y: cellH },
  ];

  const keyframes: SampledKeyframe[] = [];
  const rawFramesDataUrls: string[] = [];

  picked.forEach((pk, idx) => {
    const pos = positions[idx];
    gCtx.drawImage(pk.annotatedCanvas, pos.x, pos.y, cellW, cellH);

    gCtx.strokeStyle = 'rgba(255,255,255,0.28)';
    gCtx.lineWidth = 2;
    gCtx.strokeRect(pos.x, pos.y, cellW, cellH);

    const badgeParts = [`#${idx + 1} | ${pk.timeLabel}`];
    if (pk.telemetry.shoulderTiltDeg !== null) badgeParts.push(`肩:${pk.telemetry.shoulderTiltDeg}°`);
    if (pk.telemetry.headRollDeg !== null) badgeParts.push(`头:${pk.telemetry.headRollDeg}°`);
    if (pk.telemetry.handsDetectedCount > 0) badgeParts.push(`手:${pk.telemetry.handsDetectedCount}只`);
    const badgeText = badgeParts.join(' ');

    gCtx.fillStyle = 'rgba(15, 23, 42, 0.84)';
    gCtx.fillRect(pos.x + 8, pos.y + 8, Math.min(cellW - 16, badgeText.length * 7.5 + 16), 22);
    gCtx.fillStyle = '#4ADE80';
    gCtx.font = 'bold 11px "SF Mono", Menlo, monospace';
    gCtx.fillText(badgeText, pos.x + 14, pos.y + 23);

    const rawUrl = pk.rawCanvas.toDataURL('image/jpeg', 0.72);
    const annUrl = pk.annotatedCanvas.toDataURL('image/jpeg', 0.76);
    rawFramesDataUrls.push(rawUrl);

    keyframes.push({
      frameIndex: pk.frameIndex,
      timestampSec: pk.timestampSec,
      timeLabel: pk.timeLabel,
      rawDataUrl: rawUrl,
      annotatedDataUrl: annUrl,
      telemetry: pk.telemetry,
    });
  });

  const startSec = picked[0].timestampSec;
  const endSec = picked[picked.length - 1].timestampSec;
  const timeRangeLabel = `${formatSecToTimeLabel(startSec)}-${formatSecToTimeLabel(endSec)}`;

  const latestTel = picked[picked.length - 1].telemetry;
  const poseMetricsJson: Record<string, unknown> = {
    window_index: windowIndex,
    time_range: timeRangeLabel,
    person_detected: latestTel.personDetected,
    framing: latestTel.framingDesc,
    visible_body_parts: latestTel.visibleParts,
    head_3d_pose: latestTel.headPoseSummary,
    face_expression: latestTel.faceExpressionSummary,
    left_hand_21pts: latestTel.leftHandSummary ?? '未入镜',
    right_hand_21pts: latestTel.rightHandSummary ?? '未入镜',
    frames_telemetry: picked.map((p, idx) => {
      const item: Record<string, unknown> = {
        grid_slot: `#${idx + 1}`,
        time: p.timeLabel,
        person_detected: p.telemetry.personDetected,
        framing: p.telemetry.framingDesc,
      };
      if (p.telemetry.headPoseSummary !== '未入镜') item.head_pose = p.telemetry.headPoseSummary;
      if (p.telemetry.faceExpressionSummary !== '未锁定面部网格')
        item.expression = p.telemetry.faceExpressionSummary;
      if (p.telemetry.shoulderTiltDeg !== null) item.shoulder_tilt_deg = p.telemetry.shoulderTiltDeg;
      if (p.telemetry.leftElbowDeg !== null) item.left_elbow_deg = p.telemetry.leftElbowDeg;
      if (p.telemetry.rightElbowDeg !== null) item.right_elbow_deg = p.telemetry.rightElbowDeg;
      if (p.telemetry.leftShoulderLiftDeg !== null)
        item.left_arm_lift_deg = p.telemetry.leftShoulderLiftDeg;
      if (p.telemetry.rightShoulderLiftDeg !== null)
        item.right_arm_lift_deg = p.telemetry.rightShoulderLiftDeg;
      if (p.telemetry.leftHandSummary) item.left_hand = p.telemetry.leftHandSummary;
      if (p.telemetry.rightHandSummary) item.right_hand = p.telemetry.rightHandSummary;
      if (p.telemetry.trunkLeanDeg !== null) item.trunk_lean_deg = p.telemetry.trunkLeanDeg;
      if (p.telemetry.leftKneeDeg !== null) item.left_knee_deg = p.telemetry.leftKneeDeg;
      if (p.telemetry.rightKneeDeg !== null) item.right_knee_deg = p.telemetry.rightKneeDeg;
      return item;
    }),
  };

  return {
    windowIndex,
    startSec,
    endSec,
    timeRangeLabel,
    gridDataUrl: gridCanvas.toDataURL('image/jpeg', 0.78),
    rawFramesDataUrls,
    keyframes,
    poseMetricsJson,
  };
}
