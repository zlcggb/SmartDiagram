import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAdminSession } from '@/shared/lib/config/auth';
import { usePlatformAuth } from '@/shared/store/authStore';
import {
  analyzeAndDrawRealPose,
  composeRealTemporalGridBundle,
  drawVideoFrameAdaptive,
  FrameDiffGate,
  realPoseService,
  type ComposedWindowBundle,
  type OverlayLayerConfig,
  type PerceptionPerfMode,
  type RealPoseTelemetry,
} from '../lib/edgePerceptionEngine';

// ======================= AI 算力风控与防呆自动熔断常量 =======================
const GUEST_SINGLE_LIMIT_SEC = 60; // 访客单次最多连续分析 1 分钟 (60秒)
const GUEST_DAILY_LIMIT_SEC = 300; // 访客整天最多累计分析 5 分钟 (300秒)
const USER_IDLE_LIMIT_SEC = 120; // 已登录用户连续 2 分钟 (120秒) 无操作自动停止分析，防忘关浪费
const USER_DAILY_LIMIT_SEC = 900; // 普通已登录用户整天累计上限 15 分钟 (900秒)
const DAILY_QUOTA_STORAGE_KEY = 'smartdiagram_coach_daily_quota_v1';

interface StoredDailyQuota {
  date: string;
  guestSec: number;
  userSec: number;
}

function getTodayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readDailyQuotaFromStorage(): StoredDailyQuota {
  const today = getTodayDateKey();
  try {
    const raw = localStorage.getItem(DAILY_QUOTA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredDailyQuota>;
      if (parsed.date === today) {
        return {
          date: today,
          guestSec: Math.max(0, Number(parsed.guestSec) || 0),
          userSec: Math.max(0, Number(parsed.userSec) || 0),
        };
      }
    }
  } catch {
    // ignore storage error
  }
  return { date: today, guestSec: 0, userSec: 0 };
}

function writeDailyQuotaToStorage(quota: StoredDailyQuota): void {
  try {
    localStorage.setItem(DAILY_QUOTA_STORAGE_KEY, JSON.stringify(quota));
  } catch {
    // ignore storage error
  }
}

function formatMMSS(totalSec: number): string {
  const clamped = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface CoachScenePreset {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  badge: string;
  description: string;
  user_rubric: string;
}

interface CoachWindowSegment {
  id: string;
  windowIndex: number;
  startSec: number;
  endSec: number;
  timeRangeLabel: string;
  model: string;
  text: string;
  streaming: boolean;
  gridDataUrl: string;
  meta: {
    status: 'good' | 'normal' | 'warning';
    score: number;
    tag: string;
    angle_note: string;
    advice: string;
  };
  telemetry: {
    ttft_ms: number | null;
    total_ms: number | null;
    payload_kb: number;
  };
}

type MobileCoachTab = 'feed' | 'telemetry' | 'config' | 'report';

const SCENE_PRESETS: CoachScenePreset[] = [
  {
    id: 'live_observer',
    name: '实时动作与画面观察（通用/展厅）',
    shortName: '实时观察',
    icon: '👁️',
    badge: '对标展会方案',
    description: '连续观察摄像头或视频画面，结合全身骨骼、双手21指关节与面部朝向，精准描述动作与手势变化。',
    user_rubric:
      '你正在连续观察同一个摄像头或视频片段。请结合画面与前端 MediaPipe 三合一实测数据（全身33点+双手42指关节+面部478点朝向）：\n1. 精准说明画面里的人当前正在做什么具体动作与手势（如双手抱头、五指张开挥手、单手托腮、看屏幕、说话等）；\n2. 对比 #1 → #4 四格连续画面，说明这几秒内头部朝向、手臂/手势发生了什么变化；\n3. 给出一句自然的体态或状态提醒。输出 2~3 句真实、好懂的中文和英文。',
  },
  {
    id: 'posture_coach',
    name: '坐姿 / 演讲 / 镜头体态教练',
    shortName: '演讲体态',
    icon: '🎤',
    badge: '面部478点+手势',
    description: '实时检测面部 3D 朝向（转头/低头/歪头）、眼神与表情、高低肩及双手 21 指关节手势。',
    user_rubric:
      '请作为专业演讲与体态教练，观察这 4 帧连续画面中人物的镜头表现：\n1. 结合面部478点实测数据，指出人物当前的头部3D姿态（是否正视镜头、有无歪头或低头）与面部表情状态；\n2. 结合双手21指关节与双肩数据，点评双肩是否端平、手势动作（张开/握拳/位置）是否自然得体；\n3. 给出一句简短、可立即照着调整的教练口令。只评判真实入镜部位！',
  },
  {
    id: 'fitness_coach',
    name: '运动 / 肢体与手指关节教练',
    shortName: '运动关节',
    icon: '🏋️',
    badge: '关节+指骨实测',
    description: '追踪肩肘抬起角度、手腕与 21 个手指关节伸展度（或全身深蹲膝髋角），给出精准生物力学纠偏。',
    user_rubric:
      '请作为运动与康复动作教练，分析当前连续 4 帧中的肢体与手部动作：\n1. 描述从 #1 到 #4 人物完成了什么动作，直接引用实测出的关节角度（如左右肘夹角、抬臂角、手指伸展数、双肩倾角等）；\n2. 判断动作轨迹是否对称、稳定、到位；\n3. 给出一句具体的动作指导建议（哪些部位入镜就分析哪些部位）。',
  },
];

const INITIAL_TELEMETRY: RealPoseTelemetry = {
  timestampSec: 0,
  timeLabel: '00:00.0',
  diffScore: 0,
  personDetected: false,
  framingDesc: '等待打开摄像头或选择本地视频',
  visibleParts: [],
  faceDetected: false,
  headRollDeg: null,
  headYawDeg: null,
  headPitchDeg: null,
  headPoseSummary: '未入镜',
  faceExpressionSummary: '等待画面输入',
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
  statusSummary: '请点击下方「📷 镜头」或「📁 视频」开始真实识别',
};

export const VideoCoachLabPage: React.FC = () => {
  const navigate = useNavigate();
  const session = usePlatformAuth((state) => state.session);
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const isLoggedIn = Boolean(session?.user);
  const isAdmin = isAdminSession(session);

  // 移动端底部专属工作台 Tab 状态
  const [mobileTab, setMobileTab] = useState<MobileCoachTab>('feed');

  // 算力配额与单次无操作自动熔断计时状态
  const [dailyQuota, setDailyQuota] = useState<StoredDailyQuota>(() => readDailyQuotaFromStorage());
  const [sessionActiveSec, setSessionActiveSec] = useState<number>(0);
  const [quotaNotice, setQuotaNotice] = useState<string>('');

  const singleLimitSec = isLoggedIn ? USER_IDLE_LIMIT_SEC : GUEST_SINGLE_LIMIT_SEC;
  const dailyLimitSec = isLoggedIn ? USER_DAILY_LIMIT_SEC : GUEST_DAILY_LIMIT_SEC;
  const todayUsedSec = isLoggedIn ? dailyQuota.userSec : dailyQuota.guestSec;
  const remainingSingleSec = Math.max(0, singleLimitSec - sessionActiveSec);
  const remainingDailySec = Math.max(0, dailyLimitSec - todayUsedSec);
  const isDailyQuotaExhausted = !isAdmin && remainingDailySec <= 0;

  // 场景与模型配置
  const [sceneId, setSceneId] = useState<string>('live_observer');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash-lite');
  const [customRubric, setCustomRubric] = useState<string>(SCENE_PRESETS[0].user_rubric);
  const [promptExpanded, setPromptExpanded] = useState<boolean>(false);

  // 抽帧窗口周期（默认 2500ms 极速窗口，可选 4000ms 标准窗口）
  const [windowIntervalMs, setWindowIntervalMs] = useState<number>(2500);

  // 视频源状态：null（已关闭/未选择） | 'camera'（真实摄像头） | 'file'（本地视频）
  const [sourceType, setSourceType] = useState<'camera' | 'file' | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [videoFitMode, setVideoFitMode] = useState<'cover' | 'contain'>('cover');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  // 当暂停时是否在视频画面内显示全局暂停覆盖层（用户可点击「仅看画面」暂时收起）
  const [pauseOverlayHidden, setPauseOverlayHidden] = useState<boolean>(false);

  // 设备性能自适应帧率控制：'auto' (智能自适应) | 'eco' (省电降帧防卡顿) | 'high' (高帧率)
  const [perfMode, setPerfMode] = useState<PerceptionPerfMode>('auto');
  const [detectFpsInfo, setDetectFpsInfo] = useState<{
    fps: number;
    throttled: boolean;
    costMs: number;
  }>({
    fps: 18,
    throttled: false,
    costMs: 14,
  });

  // 三合一高精度图层开关（全身33点 + 双手42指关节 + 面部478点网格）
  const [overlayLayers, setOverlayLayers] = useState<OverlayLayerConfig>({
    showPose: true,
    showHands: true,
    showFace: true,
  });

  const [poseModelReady, setPoseModelReady] = useState<boolean>(false);
  const [poseModelError, setPoseModelError] = useState<string | null>(null);
  const [activeModelsText, setActiveModelsText] = useState<string>('正在加载姿态/手部/面部高精度模型...');

  // 真实 MediaPipe 检测遥测状态
  const [liveTelemetry, setLiveTelemetry] = useState<RealPoseTelemetry>(INITIAL_TELEMETRY);

  const [totalSampledFrames, setTotalSampledFrames] = useState<number>(0);
  const [skippedIdleWindows, setSkippedIdleWindows] = useState<number>(0);
  const [inFlightCount, setInFlightCount] = useState<number>(0);
  const [latestBundle, setLatestBundle] = useState<ComposedWindowBundle | null>(null);
  const [previewGridModalUrl, setPreviewGridModalUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<CoachWindowSegment[]>([]);
  const [finalizing, setFinalizing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const diffGateRef = useRef<FrameDiffGate | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const windowBufferRef = useRef<
    {
      rawCanvas: HTMLCanvasElement;
      annotatedCanvas: HTMLCanvasElement;
      telemetry: RealPoseTelemetry;
    }[]
  >([]);
  const lastCaptureTimeRef = useRef<number>(0);
  const lastWindowSubmitRef = useRef<number>(0);
  const windowCounterRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const isAnalyzingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const rollingMemoryRef = useRef<string[]>([]);

  useEffect(() => {
    isAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);

  // 初始化加载真实的本地 MediaPipe 三合一高精度模型
  useEffect(() => {
    let mounted = true;
    realPoseService.ensureLoaded().then((ok) => {
      if (!mounted) return;
      if (ok) {
        setPoseModelReady(true);
        setActiveModelsText(realPoseService.activeModelsDesc);
        setPoseModelError(null);
      } else {
        setPoseModelError(realPoseService.loadError || 'MediaPipe 模型加载失败');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * 0 毫秒立即中断任何正在进行的后端大模型流式请求
   */
  const abortActiveAnalysis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    inFlightRef.current = false;
    setInFlightCount(0);
    windowBufferRef.current = [];

    setSegments((prev) =>
      prev
        .filter((item) => !(item.streaming && !item.text.trim()))
        .map((item) =>
          item.streaming
            ? {
                ...item,
                streaming: false,
                meta: { ...item.meta, tag: `${item.meta.tag} (已手动停止)` },
              }
            : item,
        ),
    );
  }, []);

  /**
   * 停止自动抽帧分析（0ms 立即截断正在进行的请求）
   */
  const handleStopAnalyzing = useCallback(() => {
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setPauseOverlayHidden(false);
    abortActiveAnalysis();
    if (sourceType === 'file' && videoRef.current) {
      videoRef.current.pause();
    }
  }, [abortActiveAnalysis, sourceType]);

  /**
   * 彻底关闭摄像头或视频源
   */
  const stopMedia = useCallback(() => {
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setPauseOverlayHidden(false);
    setQuotaNotice('');
    abortActiveAnalysis();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => {
        t.stop();
        t.enabled = false;
      });
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    realPoseService.resetCache();
    diffGateRef.current?.reset();
    setSourceType(null);
    setLiveTelemetry(INITIAL_TELEMETRY);
  }, [abortActiveAnalysis]);

  useEffect(() => {
    return () => stopMedia();
  }, [stopMedia]);

  // 记录用户主动交互（已登录用户有操作时重置 2 分钟无操作防呆计时器；访客单次严格限制 1 分钟）
  const recordUserActivity = useCallback(() => {
    if (isLoggedIn) {
      setSessionActiveSec(0);
    }
  }, [isLoggedIn]);

  // 切换识别帧率档位：智能自适应 (auto) -> 省电降帧防卡顿 (eco) -> 高帧率 (high)
  const handleCyclePerfMode = useCallback(() => {
    recordUserActivity();
    setPerfMode((prev) => {
      const next: PerceptionPerfMode =
        prev === 'auto' ? 'eco' : prev === 'eco' ? 'high' : 'auto';
      realPoseService.setPerfMode(next);
      return next;
    });
  }, [recordUserActivity]);

  // 尝试开启实时抽帧分析（先校验今日累计时长配额）
  const tryStartAnalyzing = useCallback((): boolean => {
    const latest = readDailyQuotaFromStorage();
    setDailyQuota(latest);
    const used = isLoggedIn ? latest.userSec : latest.guestSec;
    const limit = isLoggedIn ? USER_DAILY_LIMIT_SEC : GUEST_DAILY_LIMIT_SEC;
    if (!isAdmin && used >= limit) {
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
      setPauseOverlayHidden(false);
      setQuotaNotice(
        isLoggedIn
          ? '🔒 今日 AI 视觉分析保护额度（15 分钟/天）已用完，已停止 AI 抽帧分析。'
          : '🔒 访客今日免费 AI 视觉分析额度（5 分钟/天）已用完，请登录账号解锁更高额度！',
      );
      return false;
    }
    setQuotaNotice('');
    setPauseOverlayHidden(false);
    setSessionActiveSec(0);
    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setMobileTab('feed');
    lastWindowSubmitRef.current = performance.now() - (windowIntervalMs - 1100);
    return true;
  }, [isAdmin, isLoggedIn, windowIntervalMs]);

  // 实时分析秒表：负责「单次 1分钟(访客) / 2分钟无操作(登录用户) 自动停止」与「全天 5分钟(访客) 累计配额熔断」
  useEffect(() => {
    if (!isAnalyzing) return;

    const timer = window.setInterval(() => {
      // 1. 累加今日已用时长并持久化到 localStorage
      setDailyQuota((prev) => {
        const today = getTodayDateKey();
        const base = prev.date === today ? prev : { date: today, guestSec: 0, userSec: 0 };
        const next: StoredDailyQuota = {
          date: today,
          guestSec: isLoggedIn ? base.guestSec : base.guestSec + 1,
          userSec: isLoggedIn ? base.userSec + 1 : base.userSec,
        };
        writeDailyQuotaToStorage(next);

        const usedToday = isLoggedIn ? next.userSec : next.guestSec;
        const maxDaily = isLoggedIn ? USER_DAILY_LIMIT_SEC : GUEST_DAILY_LIMIT_SEC;
        if (!isAdmin && usedToday >= maxDaily) {
          handleStopAnalyzing();
          setQuotaNotice(
            isLoggedIn
              ? '🔒 今日 AI 视觉分析保护额度（15 分钟/天）已用完，系统已自动停止分析。'
              : '🔒 访客今日免费 AI 视觉分析时长（5 分钟/天）已达上限，系统已自动停止分析。请登录账号解锁更高额度！',
          );
        }
        return next;
      });

      // 2. 累加本次连续分析时长（访客满 60s 自动停止；登录用户满 120s 无操作自动停止防呆）
      setSessionActiveSec((prevSec) => {
        const nextSec = prevSec + 1;
        const maxSingle = isLoggedIn ? USER_IDLE_LIMIT_SEC : GUEST_SINGLE_LIMIT_SEC;
        if (nextSec >= maxSingle) {
          handleStopAnalyzing();
          setQuotaNotice(
            isLoggedIn
              ? '🛡️ 已连续分析满 2 分钟无操作，系统已自动暂停分析，避免忘记关闭消耗 AI 资源（点击「▶ 继续实时分析」即可继续）。'
              : '⏱️ 访客单次最多连续分析 1 分钟，已自动暂停分析以节省 AI 资源（点击「▶ 继续实时分析」可继续，或登录解锁单次 2 分钟）。',
          );
        }
        return nextSec;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [handleStopAnalyzing, isAdmin, isAnalyzing, isLoggedIn]);

  // 切换场景预设
  const handleSelectScene = (id: string) => {
    recordUserActivity();
    setSceneId(id);
    const found = SCENE_PRESETS.find((p) => p.id === id);
    if (found) {
      setCustomRubric(found.user_rubric);
    }
  };

  // 启动指定方向的摄像头，并一气呵成自动开始实时抽帧分析
  const openCameraWithFacing = async (facing: 'user' | 'environment') => {
    setErrorMsg('');
    try {
      stopMedia();
      // 不强制锁定横屏 16:9，兼容手机端竖屏传感器原生分辨率，再由 Canvas 等比居中裁剪绘制
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      mediaStreamRef.current = stream;
      setCameraFacing(facing);
      setVideoFitMode('cover');
      setSourceType('camera');
      startTimeRef.current = performance.now();
      windowBufferRef.current = [];
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // 镜头开启后自动进入实时分析状态（先通过配额检查）
      tryStartAnalyzing();
    } catch (err) {
      setErrorMsg(`无法打开摄像头：${(err as Error).message}`);
    }
  };

  // 切换打开 / 关闭真实摄像头
  const handleToggleCamera = async () => {
    if (sourceType === 'camera') {
      stopMedia();
      return;
    }
    await openCameraWithFacing(cameraFacing);
  };

  // 手机端一键翻转前后置摄像头
  const handleFlipCamera = async () => {
    recordUserActivity();
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    if (sourceType === 'camera') {
      await openCameraWithFacing(nextFacing);
    } else {
      setCameraFacing(nextFacing);
    }
  };

  // 选择本地视频文件，加载后自动开始播放并实时抽帧分析
  const handleSelectVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopMedia();
    setErrorMsg('');
    const objUrl = URL.createObjectURL(file);
    setVideoFitMode('contain');
    setSourceType('file');
    startTimeRef.current = performance.now();
    windowBufferRef.current = [];
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = objUrl;
      videoRef.current.loop = true;
      videoRef.current.play().catch(() => {});
    }
    // 选完视频后自动进入实时分析状态（先通过配额检查）
    tryStartAnalyzing();
    e.target.value = '';
  };

  // 提交真实抓拍的 2×2 连续帧窗口给后端视觉大模型
  const submitWindowForAnalysis = useCallback(
    async (bundle: ComposedWindowBundle, isManualSnap = false) => {
      if (inFlightRef.current) return;
      if (!isManualSnap && !isAnalyzingRef.current) return;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      inFlightRef.current = true;
      setInFlightCount(1);

      const segId = `win_${bundle.windowIndex}_${Date.now()}`;
      const lastTel = bundle.keyframes[bundle.keyframes.length - 1]?.telemetry;
      const noteParts: string[] = [];
      if (lastTel?.headPoseSummary && lastTel.headPoseSummary !== '未入镜') {
        noteParts.push(lastTel.headPoseSummary);
      }
      if (lastTel?.leftHandSummary) noteParts.push(`左手:${lastTel.leftHandSummary}`);
      if (lastTel?.rightHandSummary) noteParts.push(`右手:${lastTel.rightHandSummary}`);
      const initialNote =
        noteParts.length > 0
          ? noteParts.join(' · ')
          : lastTel?.personDetected
            ? `${lastTel.framingDesc} · 可见: ${lastTel.visibleParts.join('/')}`
            : '画面未检测到人体骨骼';

      const newSeg: CoachWindowSegment = {
        id: segId,
        windowIndex: bundle.windowIndex,
        startSec: bundle.startSec,
        endSec: bundle.endSec,
        timeRangeLabel: bundle.timeRangeLabel,
        model: selectedModel,
        text: '',
        streaming: true,
        gridDataUrl: bundle.gridDataUrl,
        meta: {
          status: 'normal',
          score: 85,
          tag: '正在识别画面与手势...',
          angle_note: initialNote,
          advice: '',
        },
        telemetry: {
          ttft_ms: null,
          total_ms: null,
          payload_kb: 22.0,
        },
      };

      setSegments((prev) => [newSeg, ...prev.slice(0, 29)]);

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
        const resp = await fetch('/video-api/api/coach-lab/analyze-stream', {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            mode: 'grid_grounded',
            model: selectedModel,
            scene_id: sceneId,
            custom_rubric: customRubric,
            time_range_label: bundle.timeRangeLabel,
            window_index: bundle.windowIndex,
            grid_image: bundle.gridDataUrl,
            pose_metrics: bundle.poseMetricsJson,
            rolling_memory: rollingMemoryRef.current.slice(-3),
          }),
        });

        if (!resp.ok || !resp.body) {
          if (resp.status === 429) {
            const errJson = await resp.json().catch(() => ({}));
            const detail =
              errJson.detail ||
              '今日免费 AI 视觉分析额度（5 分钟/天）已用完，请登录账号解锁更高额度';
            handleStopAnalyzing();
            setQuotaNotice(`🔒 ${detail}`);
            throw new Error(detail);
          }
          throw new Error(`HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done || controller.signal.aborted) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            if (controller.signal.aborted) break;
            const line = block.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.replace(/^data:\s*/, '');
            try {
              const evt = JSON.parse(jsonStr);
              if (evt.type === 'start') {
                setSegments((prev) =>
                  prev.map((item) =>
                    item.id === segId
                      ? {
                          ...item,
                          telemetry: {
                            ...item.telemetry,
                            payload_kb: evt.payload_kb ?? item.telemetry.payload_kb,
                          },
                        }
                      : item,
                  ),
                );
              } else if (evt.type === 'delta') {
                setSegments((prev) =>
                  prev.map((item) =>
                    item.id === segId
                      ? {
                          ...item,
                          text: item.text + (evt.content || ''),
                          telemetry: {
                            ...item.telemetry,
                            ttft_ms: evt.ttft_ms ?? item.telemetry.ttft_ms,
                          },
                        }
                      : item,
                  ),
                );
              } else if (evt.type === 'done') {
                const finalText = evt.text || '';
                if (finalText) {
                  rollingMemoryRef.current.push(
                    `第${bundle.windowIndex}段(${bundle.timeRangeLabel}): ${finalText.slice(0, 65)}`,
                  );
                }
                setSegments((prev) =>
                  prev.map((item) =>
                    item.id === segId
                      ? {
                          ...item,
                          text: finalText || item.text,
                          streaming: false,
                          meta: evt.meta || item.meta,
                          telemetry: {
                            ttft_ms: evt.telemetry?.ttft_ms ?? item.telemetry.ttft_ms,
                            total_ms: evt.telemetry?.total_ms ?? null,
                            payload_kb: evt.telemetry?.payload_kb ?? item.telemetry.payload_kb,
                          },
                        }
                      : item,
                  ),
                );
              } else if (evt.type === 'error') {
                setSegments((prev) =>
                  prev.map((item) =>
                    item.id === segId
                      ? {
                          ...item,
                          text: evt.message || '分析出错',
                          streaming: false,
                        }
                      : item,
                  ),
                );
              }
            } catch {
              // ignore chunk parse error
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        setSegments((prev) =>
          prev.map((item) =>
            item.id === segId
              ? {
                  ...item,
                  text: `请求失败：${(err as Error).message}`,
                  streaming: false,
                }
              : item,
          ),
        );
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        inFlightRef.current = false;
        setInFlightCount(0);
      }
    },
    [customRubric, handleStopAnalyzing, sceneId, selectedModel, session?.access_token],
  );

  // 主循环：从真实 <video> 读取画面（等比无变形 + 前置自然镜像）→ 自适应帧率运行 MediaPipe 三合一检测 → 打包提交
  useEffect(() => {
    if (!diffGateRef.current) {
      diffGateRef.current = new FrameDiffGate();
    }

    let animId = 0;
    const anyOverlayOn =
      overlayLayers.showPose || overlayLayers.showHands || overlayLayers.showFace;

    const captureStepMs = windowIntervalMs <= 2500 ? 380 : 520;
    const isFrontMirrored = sourceType === 'camera' && cameraFacing === 'user';

    const renderLoop = (now: number) => {
      const canvas = mainCanvasRef.current;
      const video = videoRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(renderLoop);
        return;
      }

      // 手机端采用 560×350 (16:10 黄金人像视野)，桌面端采用 640×360 (16:9)，与 CSS aspect 严格 1:1 匹配
      const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 640;
      const targetW = isMobileViewport ? 560 : 640;
      const targetH = isMobileViewport ? 350 : 360;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(renderLoop);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;

      if (sourceType && video && video.readyState >= 2) {
        const elapsedSec =
          sourceType === 'file' ? video.currentTime : (now - startTimeRef.current) / 1000.0;

        // 1. 按真实宽高比等比绘制视频帧（彻底解决手机竖屏摄像头被横向拉伸变形问题，并支持前置自拍镜像）
        drawVideoFrameAdaptive(ctx, video, w, h, {
          fitMode: videoFitMode,
          mirror: isFrontMirrored,
        });

        // 2. 基于已等比对齐的画布运行三合一检测（内置设备性能自适应帧率与奇偶拍错峰调度）
        const holistic = realPoseService.detectHolisticFrame(
          canvas,
          now,
          overlayLayers,
          isFrontMirrored,
        );

        if (now - lastCaptureTimeRef.current >= captureStepMs) {
          lastCaptureTimeRef.current = now;

          const diffScore = diffGateRef.current?.computeDiff(canvas) ?? 0;

          if (isAnalyzingRef.current) {
            // 仅在开启实时分析时才创建快照画布推入滑窗队列，避免非分析状态下频繁分配内存
            const rawSnap = document.createElement('canvas');
            rawSnap.width = w;
            rawSnap.height = h;
            rawSnap.getContext('2d')!.drawImage(canvas, 0, 0);

            const annotatedSnap = document.createElement('canvas');
            annotatedSnap.width = w;
            annotatedSnap.height = h;
            const aCtx = annotatedSnap.getContext('2d')!;
            aCtx.drawImage(rawSnap, 0, 0);

            const tel = analyzeAndDrawRealPose(
              aCtx,
              w,
              h,
              holistic,
              elapsedSec,
              diffScore,
              anyOverlayOn,
              overlayLayers,
            );
            setLiveTelemetry(tel);
            setDetectFpsInfo({
              fps: realPoseService.currentTargetFps,
              throttled: realPoseService.isThrottled,
              costMs: realPoseService.avgInferCostMs,
            });

            if (anyOverlayOn) {
              ctx.drawImage(annotatedSnap, 0, 0);
            }

            setTotalSampledFrames((c) => c + 1);
            windowBufferRef.current.push({
              rawCanvas: rawSnap,
              annotatedCanvas: annotatedSnap,
              telemetry: tel,
            });
            if (windowBufferRef.current.length > 12) {
              windowBufferRef.current.shift();
            }
          } else {
            const tel = analyzeAndDrawRealPose(
              ctx,
              w,
              h,
              holistic,
              elapsedSec,
              diffScore,
              anyOverlayOn,
              overlayLayers,
            );
            setLiveTelemetry(tel);
            setDetectFpsInfo({
              fps: realPoseService.currentTargetFps,
              throttled: realPoseService.isThrottled,
              costMs: realPoseService.avgInferCostMs,
            });
          }
        } else if (anyOverlayOn) {
          analyzeAndDrawRealPose(
            ctx,
            w,
            h,
            holistic,
            elapsedSec,
            liveTelemetry.diffScore,
            true,
            overlayLayers,
          );
        }

        if (
          isAnalyzingRef.current &&
          !inFlightRef.current &&
          now - lastWindowSubmitRef.current >= windowIntervalMs &&
          windowBufferRef.current.length >= 4
        ) {
          lastWindowSubmitRef.current = now;
          const avgDiff =
            windowBufferRef.current.reduce((acc, item) => acc + item.telemetry.diffScore, 0) /
            windowBufferRef.current.length;

          if (avgDiff < 1.0 && segments.length > 0) {
            setSkippedIdleWindows((c) => c + 1);
            windowBufferRef.current = [];
          } else {
            windowCounterRef.current += 1;
            const bundle = composeRealTemporalGridBundle(
              windowCounterRef.current,
              windowBufferRef.current,
            );
            windowBufferRef.current = [];
            setLatestBundle(bundle);
            void submitWindowForAnalysis(bundle, false);
          }
        }
      } else {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#0B1120');
        grad.addColorStop(1, '#111827');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 2;
        const m = 18;
        const cl = 14;
        ctx.beginPath();
        ctx.moveTo(m, m + cl);
        ctx.lineTo(m, m);
        ctx.lineTo(m + cl, m);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w - m - cl, m);
        ctx.lineTo(w - m, m);
        ctx.lineTo(w - m, m + cl);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(m, h - m - cl);
        ctx.lineTo(m, h - m);
        ctx.lineTo(m + cl, h - m);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w - m - cl, h - m);
        ctx.lineTo(w - m, h - m);
        ctx.lineTo(w - m, h - m - cl);
        ctx.stroke();

        ctx.fillStyle = '#E2E8F0';
        ctx.font = '600 13.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('点击下方「📷 开启镜头」或「📁 选择视频」即刻开始分析', w / 2, h / 2 - 8);
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
        ctx.fillStyle = poseModelReady ? '#34D399' : '#94A3B8';
        ctx.fillText(
          poseModelReady ? `● ${activeModelsText}` : '⏳ 正在初始化本地高精度模型...',
          w / 2,
          h / 2 + 15,
        );
        ctx.textAlign = 'start';
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [
    activeModelsText,
    cameraFacing,
    liveTelemetry.diffScore,
    overlayLayers,
    poseModelReady,
    segments.length,
    sourceType,
    submitWindowForAnalysis,
    videoFitMode,
    windowIntervalMs,
  ]);

  // 手动立即抓拍当前真实画面并触发分析
  const handleManualSnapshotAnalyze = () => {
    const video = videoRef.current;
    const canvas = mainCanvasRef.current;
    if (!sourceType || !video || video.readyState < 2 || !canvas) {
      setErrorMsg('请先点击「📷 开启镜头」或「📁 选择视频」后再抓拍分析');
      return;
    }

    // 校验今日累计配额
    const latest = readDailyQuotaFromStorage();
    const used = isLoggedIn ? latest.userSec : latest.guestSec;
    const limit = isLoggedIn ? USER_DAILY_LIMIT_SEC : GUEST_DAILY_LIMIT_SEC;
    if (!isAdmin && used >= limit) {
      setPauseOverlayHidden(false);
      setQuotaNotice(
        isLoggedIn
          ? '🔒 今日 AI 视觉分析保护额度（15 分钟/天）已用完，无法继续抓拍分析。'
          : '🔒 访客今日免费 AI 视觉分析时长（5 分钟/天）已用完，请登录账号解锁更高额度！',
      );
      return;
    }

    recordUserActivity();
    setErrorMsg('');
    setQuotaNotice('');
    // 若当前处于暂停态，单次手动抓拍折算 4 秒今日额度消耗
    if (!isAnalyzing) {
      const today = getTodayDateKey();
      const next: StoredDailyQuota = {
        date: today,
        guestSec: isLoggedIn ? latest.guestSec : latest.guestSec + 4,
        userSec: isLoggedIn ? latest.userSec + 4 : latest.userSec,
      };
      writeDailyQuotaToStorage(next);
      setDailyQuota(next);
    }

    // 手机端点击抓拍后自动切到「💬 实时诊断」Tab 查看结果
    setMobileTab('feed');

    let buf = [...windowBufferRef.current];
    if (buf.length < 4) {
      const w = canvas.width;
      const h = canvas.height;
      const now = performance.now();
      const elapsedSec =
        sourceType === 'file' ? video.currentTime : (now - startTimeRef.current) / 1000.0;
      const isFrontMirrored = sourceType === 'camera' && cameraFacing === 'user';

      const rawSnap = document.createElement('canvas');
      rawSnap.width = w;
      rawSnap.height = h;
      const rCtx = rawSnap.getContext('2d')!;
      drawVideoFrameAdaptive(rCtx, video, w, h, {
        fitMode: videoFitMode,
        mirror: isFrontMirrored,
      });

      const holistic = realPoseService.detectHolisticFrame(
        rawSnap,
        now,
        overlayLayers,
        isFrontMirrored,
      );

      const annotatedSnap = document.createElement('canvas');
      annotatedSnap.width = w;
      annotatedSnap.height = h;
      const aCtx = annotatedSnap.getContext('2d')!;
      aCtx.drawImage(rawSnap, 0, 0);
      const tel = analyzeAndDrawRealPose(
        aCtx,
        w,
        h,
        holistic,
        elapsedSec,
        5.0,
        true,
        overlayLayers,
      );

      while (buf.length < 4) {
        buf.push({ rawCanvas: rawSnap, annotatedCanvas: annotatedSnap, telemetry: tel });
      }
    }

    windowCounterRef.current += 1;
    const bundle = composeRealTemporalGridBundle(windowCounterRef.current, buf);
    windowBufferRef.current = [];
    setLatestBundle(bundle);
    setTotalSampledFrames((c) => c + 4);
    void submitWindowForAnalysis(bundle, true);
  };

  // 一键暂停或继续实时抽帧分析
  const handleToggleStartStopAnalyze = () => {
    if (isAnalyzing || inFlightCount > 0) {
      handleStopAnalyzing();
      return;
    }
    if (!sourceType) {
      setErrorMsg('请先点击「📷 开启镜头」或「📁 选择视频」开启画面输入');
      return;
    }
    if (!tryStartAnalyzing()) {
      return;
    }
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    }
  };

  // 一键将真实观察记录生成复盘报告
  const handleFinalizeToVideoClosedLoop = async () => {
    const completed = segments.filter((s) => !s.streaming && s.text.trim());
    if (completed.length === 0) {
      setErrorMsg('请先至少完成 1 段真实画面分析，再生成复盘报告');
      return;
    }
    setFinalizing(true);
    setErrorMsg('');
    try {
      const ordered = [...completed].reverse();
      const resp = await fetch('/video-api/api/coach-lab/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_id: sceneId,
          windows: ordered.map((s) => ({
            window_index: s.windowIndex,
            start_sec: s.startSec,
            end_sec: s.endSec,
            text: s.text,
            score: s.meta.score,
            status: s.meta.status,
            tag: s.meta.tag,
            angle_note: s.meta.angle_note,
            advice: s.meta.advice,
          })),
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.share_path) {
        navigate(data.share_path);
      } else if (data.task_id) {
        navigate(`/video?analysis=${data.task_id}`);
      }
    } catch (err) {
      setErrorMsg(`生成复盘报告失败：${(err as Error).message}`);
    } finally {
      setFinalizing(false);
    }
  };

  // 渲染共用组件：实时生物力学遥测 Bento 卡片内容
  const renderTelemetryBento = () => (
    <div className="rounded-2xl border border-slate-200/80 bg-[#F8FAFC] p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-extrabold tracking-tight text-slate-800">
          🎯 教练级实时生物力学遥测（仅计算入镜部位）
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
            liveTelemetry.personDetected
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-200/70 text-slate-500'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              liveTelemetry.personDetected ? 'bg-emerald-500' : 'bg-slate-400'
            }`}
          />
          {liveTelemetry.personDetected ? liveTelemetry.framingDesc : '未检测到人物'}
        </span>
      </div>

      {/* 面部 3D 朝向 + 双手 42 指关节 2列微卡片 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-purple-700">
            <span>😊 头部3D朝向</span>
            {liveTelemetry.headRollDeg !== null && (
              <span className="font-mono text-[10px] text-slate-400">
                {liveTelemetry.headRollDeg}°
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-[11.5px] font-bold text-slate-800">
            {liveTelemetry.headPoseSummary}
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-slate-500">
            {liveTelemetry.faceExpressionSummary}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-700">
            <span>🖐️ 双手42指关节</span>
            <span className="font-mono text-[10px] text-slate-400">
              {liveTelemetry.handsDetectedCount}手入镜
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] font-bold text-slate-800">
            左: {liveTelemetry.leftHandSummary ?? '未入镜'}
          </div>
          <div className="mt-0.5 truncate text-[11px] font-bold text-slate-800">
            右: {liveTelemetry.rightHandSummary ?? '未入镜'}
          </div>
        </div>
      </div>

      {/* 身体关键角度 3 联表 */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-slate-200/70 bg-white px-2 py-2 shadow-2xs">
          <div className="text-[10.5px] font-semibold text-slate-400">双肩水平倾角</div>
          <div
            className={`mt-0.5 font-mono text-[13.5px] font-extrabold ${
              liveTelemetry.shoulderTiltDeg !== null && liveTelemetry.shoulderTiltDeg > 6
                ? 'text-amber-600'
                : 'text-slate-800'
            }`}
          >
            {liveTelemetry.shoulderTiltDeg !== null
              ? `${liveTelemetry.shoulderTiltDeg}°`
              : '未入镜'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white px-2 py-2 shadow-2xs">
          <div className="text-[10.5px] font-semibold text-slate-400">左肘 / 右肘夹角</div>
          <div className="mt-0.5 font-mono text-[13px] font-extrabold text-slate-800">
            {liveTelemetry.leftElbowDeg !== null ? `${liveTelemetry.leftElbowDeg}°` : '-'}{' '}
            <span className="text-slate-300">/</span>{' '}
            {liveTelemetry.rightElbowDeg !== null ? `${liveTelemetry.rightElbowDeg}°` : '-'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white px-2 py-2 shadow-2xs">
          <div className="text-[10.5px] font-semibold text-slate-400">左臂 / 右臂抬角</div>
          <div className="mt-0.5 font-mono text-[13px] font-extrabold text-slate-800">
            {liveTelemetry.leftShoulderLiftDeg !== null
              ? `${liveTelemetry.leftShoulderLiftDeg}°`
              : '-'}{' '}
            <span className="text-slate-300">/</span>{' '}
            {liveTelemetry.rightShoulderLiftDeg !== null
              ? `${liveTelemetry.rightShoulderLiftDeg}°`
              : '-'}
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染共用组件：实时诊断流卡片列表
  const renderDiagnosisCardsList = () =>
    segments.length === 0 ? (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200/90 bg-white/80 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0071E3]/10 text-2xl shadow-2xs">
          🖐️
        </div>
        <div className="mt-2.5 text-[14px] font-extrabold text-slate-800">
          二选一开启画面，即刻自动实时分析
        </div>
        <p className="mt-1 max-w-md text-[12px] leading-relaxed text-slate-500">
          点击上方 <strong>「📷 开启镜头实时分析」</strong> 或 <strong>「📁 选择视频实时分析」</strong>，无需二次确认即可自动追踪全身33点、双手42指关节与面部478点并流式输出教练诊断。
        </p>
      </div>
    ) : (
      segments.map((seg) => {
        const isWarn = seg.meta.status === 'warning';
        const isGood = seg.meta.status === 'good';
        return (
          <article
            key={seg.id}
            className={`group relative overflow-hidden rounded-2xl border bg-white p-3.5 shadow-2xs transition-all hover:shadow-md sm:p-4 ${
              isWarn
                ? 'border-amber-200/90'
                : isGood
                  ? 'border-emerald-200/90'
                  : 'border-slate-200/90'
            }`}
          >
            {/* 左侧色条指示器 */}
            <div
              className={`absolute top-0 bottom-0 left-0 w-1 ${
                isWarn ? 'bg-amber-400' : isGood ? 'bg-emerald-500' : 'bg-[#0071E3]'
              }`}
            />

            {/* 卡片头部：段号 + 时间区间 + 动作标签 + 评分（单行防折行，节省纵向空间） */}
            <div className="flex items-center justify-between gap-1.5 pl-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="inline-flex shrink-0 items-center rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10.5px] font-extrabold text-white">
                  #{String(seg.windowIndex).padStart(2, '0')}
                </span>
                <span className="shrink-0 font-mono text-[11.5px] font-bold text-slate-600">
                  {seg.timeRangeLabel}
                </span>
                <span
                  className={`truncate rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                    isWarn
                      ? 'bg-amber-100 text-amber-800'
                      : isGood
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-blue-50 text-[#0071E3]'
                  }`}
                >
                  {seg.meta.tag}
                </span>
              </div>

              <span
                className={`shrink-0 rounded-lg px-2 py-0.5 font-mono text-[11px] font-extrabold ${
                  seg.meta.score >= 88
                    ? 'bg-emerald-50 text-emerald-700'
                    : seg.meta.score < 78
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-slate-100 text-slate-700'
                }`}
              >
                {seg.meta.score} 分
              </span>
            </div>

            {/* 卡片主体：移动端与桌面端自适应图文布局 */}
            <div className="mt-2.5 flex gap-3 pl-1.5">
              <div
                onClick={() => setPreviewGridModalUrl(seg.gridDataUrl)}
                className="relative h-20 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-2xs sm:h-28 sm:w-44"
                title="点击放大检视 4 帧连续画面"
              >
                <img
                  src={seg.gridDataUrl}
                  alt={`Window ${seg.windowIndex}`}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
                <span className="absolute right-1 bottom-1 rounded bg-slate-950/80 px-1.5 py-0.5 text-[9.5px] font-bold text-white backdrop-blur-xs">
                  🔍 4帧
                </span>
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <p className="text-[12.5px] leading-relaxed text-slate-800 sm:text-[13.5px]">
                  {seg.text || '正在结合骨骼与手势数据生成分析...'}
                  {seg.streaming && (
                    <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-xs bg-[#0071E3]" />
                  )}
                </p>
              </div>
            </div>

            {/* 实测数据与建议胶囊 */}
            {(seg.meta.angle_note || seg.meta.advice) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-1.5 text-[11px]">
                {seg.meta.angle_note && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700">
                    <span>📐</span>
                    <span className="truncate">{seg.meta.angle_note}</span>
                  </span>
                )}
                {seg.meta.advice && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/90 px-2 py-0.5 font-bold text-emerald-800">
                    <span>💡</span>
                    <span>{seg.meta.advice}</span>
                  </span>
                )}
              </div>
            )}

            {/* 卡片底部遥测信息栏 */}
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 pl-1.5 text-[10.5px] text-slate-400">
              <span>
                首字{' '}
                <strong className="font-mono text-slate-600">
                  {seg.telemetry.ttft_ms ? `${seg.telemetry.ttft_ms}ms` : '...'}
                </strong>{' '}
                · 总耗时{' '}
                <strong className="font-mono text-slate-600">
                  {seg.telemetry.total_ms ? `${seg.telemetry.total_ms}ms` : '...'}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => setPreviewGridModalUrl(seg.gridDataUrl)}
                className="font-bold text-[#0071E3] hover:underline"
              >
                查看大图 →
              </button>
            </div>
          </article>
        );
      })
    );

  return (
    <div className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-[#F4F5F8] text-[#1D1D1F]">
      {/* 隐藏的本地视频文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleSelectVideoFile}
        className="hidden"
      />

      {/* ======================= 顶部极简状态栏（手机端紧凑防重叠单行，桌面端完整工具栏） ======================= */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white/95 px-2.5 py-1.5 backdrop-blur-md lg:px-6 lg:py-2.5">
        <div className="mx-auto flex w-full max-w-[1600px] min-w-0 items-center justify-between gap-1">
          {/* 左：手机端返回按钮 + 标题 + 极简模型状态圆点 */}
          <div className="flex min-w-0 items-center gap-1.5 lg:gap-2">
            <button
              type="button"
              onClick={() => {
                stopMedia();
                navigate('/video');
              }}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition active:scale-95 lg:hidden"
              title="返回视频学习助手"
              aria-label="返回视频学习助手"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0071E3]/10 text-[13px] lg:flex">
              🎯
            </div>
            <h1 className="truncate text-[13px] font-extrabold tracking-tight text-slate-900 lg:text-[15.5px]">
              AI 视觉教练
            </h1>
            {/* 手机端极简呼吸状态圆点（不占宽度防重叠） / 桌面端完整三合一徽章 */}
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full lg:border lg:px-2 lg:py-0.5 lg:text-[11px] lg:font-bold ${
                poseModelReady
                  ? 'lg:border-emerald-200 lg:bg-emerald-50 lg:text-emerald-700'
                  : 'lg:border-amber-200 lg:bg-amber-50 lg:text-amber-700'
              }`}
              title={poseModelReady ? activeModelsText : '正在加载高精度模型...'}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  poseModelReady ? 'bg-emerald-500' : 'animate-ping bg-amber-500'
                }`}
              />
              <span className="hidden lg:inline">
                {poseModelReady ? activeModelsText : '正在加载高精度模型...'}
              </span>
            </span>
          </div>

          {/* 右：紧凑配额胶囊 + 周期分段开关 + 模型切换 */}
          <div className="flex shrink-0 items-center gap-1 lg:gap-2">
            {/* 算力风控配额胶囊：手机端仅展示最核心的剩余时长，彻底消除顶栏文字挤压 */}
            <button
              type="button"
              onClick={() => {
                if (!isLoggedIn) {
                  openLogin('登录账号可解锁单次 2 分钟连续分析与更高每日 AI 视觉教练额度');
                }
              }}
              className={`inline-flex items-center gap-0.5 rounded-lg border px-1.5 py-0.5 text-[10px] font-bold transition lg:gap-1 lg:rounded-xl lg:px-2.5 lg:py-1 lg:text-[11px] ${
                isDailyQuotaExhausted
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : isAnalyzing
                    ? 'border-[#0071E3]/30 bg-[#0071E3]/10 text-[#0071E3]'
                    : 'border-slate-200/90 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
              title={
                isLoggedIn
                  ? `防呆保护：连续 ${USER_IDLE_LIMIT_SEC / 60} 分钟无操作自动暂停 · 今日剩余 ${formatMMSS(remainingDailySec)}`
                  : `访客模式：单次限 1 分钟 · 今日剩余 ${formatMMSS(remainingDailySec)} / 05:00（点击登录解锁单次 2 分钟）`
              }
            >
              <span>{isDailyQuotaExhausted ? '🔒' : isAnalyzing ? '⏱️' : isLoggedIn ? '🛡️' : '👤'}</span>
              <span className="font-mono lg:hidden">
                {isAnalyzing ? formatMMSS(remainingSingleSec) : `剩${formatMMSS(remainingDailySec)}`}
              </span>
              <span className="hidden font-mono lg:inline">
                {isAnalyzing
                  ? `本次剩 ${formatMMSS(remainingSingleSec)} · 今日剩 ${formatMMSS(remainingDailySec)}`
                  : isLoggedIn
                    ? `单次2m防呆 · 今日剩 ${formatMMSS(remainingDailySec)}`
                    : `访客单次1m · 今日剩 ${formatMMSS(remainingDailySec)}`}
              </span>
            </button>

            <div className="inline-flex items-center rounded-lg border border-slate-200/90 bg-slate-100/90 p-0.5 text-[10px] lg:rounded-xl lg:text-[11px]">
              <button
                type="button"
                onClick={() => {
                  recordUserActivity();
                  setWindowIntervalMs(2500);
                }}
                className={`rounded-md px-1.5 py-0.5 font-bold transition-all lg:rounded-lg lg:px-2 ${
                  windowIntervalMs === 2500
                    ? 'bg-white text-[#0071E3] shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                2.5s
              </button>
              <button
                type="button"
                onClick={() => {
                  recordUserActivity();
                  setWindowIntervalMs(4000);
                }}
                className={`rounded-md px-1.5 py-0.5 font-bold transition-all lg:rounded-lg lg:px-2 ${
                  windowIntervalMs === 4000
                    ? 'bg-white text-[#0071E3] shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                4.0s
              </button>
            </div>

            {/* 手机端一键切换模型按钮 / 桌面端下拉框 */}
            <button
              type="button"
              onClick={() => {
                recordUserActivity();
                setSelectedModel((m) =>
                  m === 'gemini-3.5-flash-lite'
                    ? 'gemini-3.8-flash-high'
                    : 'gemini-3.5-flash-lite',
                );
              }}
              className="rounded-lg border border-slate-200/90 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700 shadow-2xs lg:hidden"
            >
              {selectedModel === 'gemini-3.5-flash-lite' ? '⚡3.5' : '🧠3.8'}
            </button>

            <select
              value={selectedModel}
              onChange={(e) => {
                recordUserActivity();
                setSelectedModel(e.target.value);
              }}
              className="hidden rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-[12px] font-bold text-slate-700 shadow-2xs transition hover:border-slate-300 focus:border-[#0071E3] focus:outline-hidden lg:inline-block"
            >
              <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash Lite（极速流）</option>
              <option value="gemini-3.8-flash-high">🧠 Gemini 3.8 Flash High（深度诊断）</option>
            </select>

            <button
              type="button"
              onClick={() => {
                stopMedia();
                navigate('/video');
              }}
              className="hidden items-center gap-1 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 lg:inline-flex"
            >
              <span>←</span>
              <span>返回视频首页</span>
            </button>
          </div>
        </div>
      </div>

      {/* 全局错误横幅 */}
      {(errorMsg || poseModelError) && (
        <div className="mx-auto mt-1.5 w-full max-w-[1600px] shrink-0 px-3 lg:px-6">
          <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-[11.5px] font-medium text-red-700">
            <span className="truncate">⚠️ {errorMsg || poseModelError}</span>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="ml-2 shrink-0 rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ======================= 主工作区：手机端「上取景+中独立滚动Tab」，桌面端「左右分栏独立滚动」 ======================= */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] min-w-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-12 lg:gap-5 lg:px-6 lg:py-4">
        {/* ==================== 左侧 / 手机端上半屏常驻取景与控制舱 ==================== */}
        <section className="flex w-full max-w-full min-w-0 shrink-0 flex-col border-b border-slate-200/80 bg-white px-2.5 pt-1.5 pb-2 lg:col-span-5 lg:min-h-0 lg:overflow-hidden lg:rounded-[24px] lg:border lg:p-0 lg:shadow-[0_8px_30px_rgb(15,23,42,0.04)]">
          {/* 桌面端左栏固定头部 */}
          <div className="hidden shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3 lg:flex">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isAnalyzing
                    ? 'animate-pulse bg-emerald-500 ring-4 ring-emerald-500/20'
                    : sourceType
                      ? 'bg-[#0071E3] ring-4 ring-[#0071E3]/15'
                      : 'bg-slate-300'
                }`}
              />
              <h2 className="text-[15px] font-extrabold text-slate-900">
                实时视频与全维骨骼追踪
              </h2>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setOverlayLayers((p) => ({ ...p, showPose: !p.showPose }))}
                className={`rounded-lg px-2 py-0.5 text-[10.5px] font-bold transition ${
                  overlayLayers.showPose
                    ? 'bg-[#0284C7] text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                🦴 身体33点
              </button>
              <button
                type="button"
                onClick={() => setOverlayLayers((p) => ({ ...p, showHands: !p.showHands }))}
                className={`rounded-lg px-2 py-0.5 text-[10.5px] font-bold transition ${
                  overlayLayers.showHands
                    ? 'bg-[#059669] text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                🖐️ 双手42点
              </button>
              <button
                type="button"
                onClick={() => setOverlayLayers((p) => ({ ...p, showFace: !p.showFace }))}
                className={`rounded-lg px-2 py-0.5 text-[10.5px] font-bold transition ${
                  overlayLayers.showFace
                    ? 'bg-[#7C3AED] text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                😊 面部478点
              </button>
            </div>
          </div>

          {/* 桌面端左栏独立滚动容器 / 手机端紧凑固定容器 */}
          <div className="flex w-full max-w-full min-w-0 flex-col gap-1.5 lg:min-h-0 lg:flex-1 lg:gap-3.5 lg:overflow-y-auto lg:p-5">
            {/* 1. 视频取景器 (等比自适应无拉伸 + 悬浮 HUD + 画面内全局暂停覆盖层) */}
            <div className="relative w-full max-w-full min-w-0 shrink-0 overflow-hidden rounded-2xl border border-slate-900/10 bg-[#0B1120] shadow-inner">
              <video ref={videoRef} className="hidden" playsInline muted />
              <canvas
                ref={mainCanvasRef}
                width={560}
                height={350}
                className="block aspect-[16/10] w-full max-w-full sm:aspect-video"
              />

              {/* 左上角：精简直播/视频状态与单次倒计时（移除原本挤在此处的翻转按钮，彻底解决与右上角图层胶囊重叠问题） */}
              {sourceType && (
                <div className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1 rounded-lg bg-slate-950/75 px-2 py-0.5 font-mono text-[10px] font-bold text-white backdrop-blur-md">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isAnalyzing ? 'animate-ping bg-red-500' : 'bg-amber-400'
                    }`}
                  />
                  <span>{sourceType === 'camera' ? 'LIVE' : 'VIDEO'}</span>
                  <span className="text-emerald-300">{liveTelemetry.timeLabel}</span>
                  {isAnalyzing && (
                    <span className="ml-0.5 border-l border-white/20 pl-1 text-amber-300">
                      ⏱{formatMMSS(remainingSingleSec)}
                    </span>
                  )}
                </div>
              )}

              {/* 右上角：手机端专属 HUD 图层悬浮开关 */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg bg-slate-950/70 p-0.5 backdrop-blur-md lg:hidden">
                <button
                  type="button"
                  onClick={() => setOverlayLayers((p) => ({ ...p, showPose: !p.showPose }))}
                  className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold transition ${
                    overlayLayers.showPose ? 'bg-[#0284C7] text-white' : 'text-slate-300'
                  }`}
                >
                  🦴身体
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayLayers((p) => ({ ...p, showHands: !p.showHands }))}
                  className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold transition ${
                    overlayLayers.showHands ? 'bg-[#059669] text-white' : 'text-slate-300'
                  }`}
                >
                  🖐️双手
                </button>
                <button
                  type="button"
                  onClick={() => setOverlayLayers((p) => ({ ...p, showFace: !p.showFace }))}
                  className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold transition ${
                    overlayLayers.showFace ? 'bg-[#7C3AED] text-white' : 'text-slate-300'
                  }`}
                >
                  😊面部
                </button>
              </div>

              {/* 左下角（状态条上方）：镜头翻转 + 画面比例适配 + 自适应帧率档位切换 */}
              {sourceType && (
                <div className="absolute bottom-8 left-2 z-10 flex items-center gap-1">
                  {sourceType === 'camera' && (
                    <button
                      type="button"
                      onClick={handleFlipCamera}
                      className="flex items-center gap-1 rounded-lg bg-slate-950/75 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-md transition hover:bg-slate-900 active:scale-95"
                      title="翻转前/后置摄像头"
                    >
                      <span>🔄</span>
                      <span>{cameraFacing === 'user' ? '前置' : '后置'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setVideoFitMode((m) => (m === 'cover' ? 'contain' : 'cover'))
                    }
                    className="flex items-center gap-0.5 rounded-lg bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-bold text-slate-200 backdrop-blur-md transition hover:bg-slate-900 active:scale-95"
                    title="切换画面等比填充或完整保留"
                  >
                    <span>📐</span>
                    <span>{videoFitMode === 'cover' ? '满屏' : '完整'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCyclePerfMode}
                    className={`flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-bold backdrop-blur-md transition active:scale-95 ${
                      perfMode === 'eco' || detectFpsInfo.throttled
                        ? 'bg-emerald-950/80 text-emerald-300'
                        : 'bg-slate-950/75 text-sky-300'
                    }`}
                    title="点击切换识别帧率档位：智能自适应 / 省电降帧防卡顿 / 高帧率"
                  >
                    <span>{perfMode === 'eco' ? '🌿' : perfMode === 'high' ? '🚀' : '🤖'}</span>
                    <span>
                      {perfMode === 'eco'
                        ? `流畅${detectFpsInfo.fps}帧`
                        : perfMode === 'high'
                          ? `高帧${detectFpsInfo.fps}帧`
                          : detectFpsInfo.throttled
                            ? `自适应${detectFpsInfo.fps}帧`
                            : `${detectFpsInfo.fps}fps`}
                    </span>
                  </button>
                </div>
              )}

              {/* 底部姿态摘要浮层 */}
              {sourceType && (
                <div className="pointer-events-none absolute right-2 bottom-1.5 left-2 z-10 flex items-center justify-between rounded-lg bg-slate-950/80 px-2 py-0.5 text-[10.5px] text-white backdrop-blur-md">
                  <span className="truncate font-medium text-slate-100">
                    {liveTelemetry.statusSummary}
                  </span>
                  <span className="ml-1.5 shrink-0 rounded bg-white/15 px-1 py-0.2 font-mono text-[9px] text-emerald-300">
                    Δ{liveTelemetry.diffScore}
                  </span>
                </div>
              )}

              {/* 画面内全局暂停 / 配额提醒毛玻璃覆盖层（取代原本外部占空间的黄色大警告框） */}
              {(quotaNotice || (sourceType && !isAnalyzing && !pauseOverlayHidden)) && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/72 px-4 py-3 text-center backdrop-blur-[3px] transition-opacity">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold ${
                      isDailyQuotaExhausted
                        ? 'bg-red-500/25 text-red-200 ring-1 ring-red-400/40'
                        : quotaNotice
                          ? 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40'
                          : 'bg-white/15 text-white ring-1 ring-white/25'
                    }`}
                  >
                    <span>
                      {isDailyQuotaExhausted
                        ? '🔒 今日免费额度已用完'
                        : quotaNotice
                          ? '⏱️ 已自动暂停实时分析'
                          : '⏸ 实时分析已暂停'}
                    </span>
                  </span>

                  <p className="mt-1.5 max-w-[290px] text-[11.5px] leading-relaxed text-slate-200 sm:max-w-[360px] sm:text-[12px]">
                    {quotaNotice
                      ? isDailyQuotaExhausted
                        ? isLoggedIn
                          ? '今日 15 分钟 AI 视觉分析额度已达上限，明天自动恢复。'
                          : '访客今日 5 分钟免费额度已用完，登录账号即可解锁每天 15 分钟额度。'
                        : isLoggedIn
                          ? '已连续分析满 2 分钟无操作，自动暂停以节省 AI 算力（今日剩余 ' +
                            formatMMSS(remainingDailySec) +
                            '）。'
                          : '访客单次最多连续分析 1 分钟，已自动暂停以节省 AI 资源（今日剩余 ' +
                            formatMMSS(remainingDailySec) +
                            '）。'
                      : '画面骨骼追踪仍在运行，点击下方可随时恢复 AI 抽帧诊断。'}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
                    {sourceType && !isAnalyzing && !isDailyQuotaExhausted && (
                      <button
                        type="button"
                        onClick={handleToggleStartStopAnalyze}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3.5 py-1.5 text-[11.5px] font-extrabold text-white shadow-sm transition hover:bg-emerald-400 active:scale-95"
                      >
                        <span>▶</span>
                        <span>继续实时分析</span>
                      </button>
                    )}

                    {!isLoggedIn && (
                      <button
                        type="button"
                        onClick={() =>
                          openLogin('登录账号可解锁单次 2 分钟连续分析与更高每日 AI 视觉教练额度')
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-[#0071E3] px-3 py-1.5 text-[11.5px] font-extrabold text-white shadow-sm transition hover:brightness-110 active:scale-95"
                      >
                        <span>🔑</span>
                        <span>登录解锁单次2分钟</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setQuotaNotice('');
                        setPauseOverlayHidden(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/20 active:scale-95"
                    >
                      <span>👁️</span>
                      <span>仅看画面</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 2. 紧凑型操控坞：精简按钮尺寸与文案，彻底告别大按钮挤压 */}
            {!sourceType ? (
              <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:gap-2">
                <button
                  type="button"
                  onClick={handleToggleCamera}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#16A34A] to-[#15803D] py-2 text-[12px] font-extrabold text-white shadow-xs transition hover:brightness-105 active:scale-[0.98] lg:py-2.5 lg:text-[13px]"
                >
                  <span>📷</span>
                  <span>开启镜头实时分析</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/90 bg-slate-50 py-2 text-[12px] font-extrabold text-slate-800 transition hover:bg-slate-100 active:scale-[0.98] lg:py-2.5 lg:text-[13px]"
                >
                  <span>📁</span>
                  <span>选择视频实时分析</span>
                </button>
              </div>
            ) : (
              <div className="grid shrink-0 grid-cols-3 gap-1.5 lg:gap-2">
                {/* 会话键 1：暂停分析 ↔ 继续分析 */}
                <button
                  type="button"
                  onClick={handleToggleStartStopAnalyze}
                  className={`flex items-center justify-center gap-1 rounded-xl py-1.5 text-[11.5px] font-extrabold transition active:scale-[0.98] lg:py-2 lg:text-[12.5px] ${
                    isAnalyzing || inFlightCount > 0
                      ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : 'bg-gradient-to-r from-[#16A34A] to-[#15803D] text-white shadow-xs hover:brightness-105'
                  }`}
                >
                  <span>{isAnalyzing || inFlightCount > 0 ? '⏸' : '▶'}</span>
                  <span>{isAnalyzing || inFlightCount > 0 ? '暂停分析' : '继续分析'}</span>
                </button>

                {/* 会话键 2：立即抓拍当前动作 */}
                <button
                  type="button"
                  disabled={inFlightCount > 0}
                  onClick={handleManualSnapshotAnalyze}
                  className="flex items-center justify-center gap-1 rounded-xl border border-[#0071E3]/30 bg-[#0071E3]/10 py-1.5 text-[11.5px] font-extrabold text-[#0071E3] transition hover:bg-[#0071E3]/15 active:scale-[0.98] disabled:opacity-40 lg:py-2 lg:text-[12.5px]"
                  title="不等窗口周期，立即抓拍当前动作并流式点评"
                >
                  <span>⚡</span>
                  <span>立即抓拍</span>
                </button>

                {/* 会话键 3：关闭当前输入源 */}
                <button
                  type="button"
                  onClick={stopMedia}
                  className="flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 py-1.5 text-[11.5px] font-extrabold text-red-600 transition hover:bg-red-100 active:scale-[0.98] lg:py-2 lg:text-[12.5px]"
                >
                  <span>{sourceType === 'camera' ? '🔴' : '✕'}</span>
                  <span>{sourceType === 'camera' ? '关闭镜头' : '退出视频'}</span>
                </button>
              </div>
            )}

            {/* 3. 桌面端常驻生物力学面板（手机端通过底部「🎯 骨骼/手势」Tab 切换查看，避免挤压视频！） */}
            <div className="hidden shrink-0 lg:block">{renderTelemetryBento()}</div>

            {/* 4. 桌面端最新 2×2 连续帧预览 */}
            {latestBundle && (
              <div className="hidden shrink-0 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 lg:block">
                <div className="mb-2 flex items-center justify-between text-[11.5px]">
                  <span className="font-bold text-slate-700">
                    🖼️ 最新提交的 2×2 连续抽帧 ({latestBundle.timeRangeLabel})
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewGridModalUrl(latestBundle.gridDataUrl)}
                    className="font-bold text-[#0071E3] hover:underline"
                  >
                    🔍 放大检视
                  </button>
                </div>
                <img
                  src={latestBundle.gridDataUrl}
                  alt="Latest 2x2 Grid"
                  onClick={() => setPreviewGridModalUrl(latestBundle.gridDataUrl)}
                  className="w-full cursor-zoom-in rounded-xl border border-slate-200 object-contain transition hover:brightness-105"
                />
              </div>
            )}
          </div>
        </section>

        {/* ==================== 手机端下半屏动态切换工作区 (lg:hidden) ==================== */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
          {/* 手机端 Tab 1：💬 实时诊断流（顶部带紧凑分段式模式切换条） */}
          {mobileTab === 'feed' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-slate-200/70 bg-white px-2.5 py-1.5">
                <div className="inline-flex items-center gap-0.5 rounded-xl bg-slate-100/90 p-0.5">
                  {SCENE_PRESETS.map((p) => {
                    const active = p.id === sceneId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectScene(p.id)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                          active
                            ? 'bg-white text-[#0071E3] shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>{p.icon}</span>
                        <span>{p.shortName}</span>
                      </button>
                    );
                  })}
                </div>

                {segments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      rollingMemoryRef.current = [];
                      setSegments([]);
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500 active:scale-95"
                  >
                    清空
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
                {renderDiagnosisCardsList()}
              </div>
            </div>
          )}

          {/* 手机端 Tab 2：🎯 骨骼与手势实时遥测数据 */}
          {mobileTab === 'telemetry' && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {renderTelemetryBento()}
              {latestBundle ? (
                <div className="rounded-2xl border border-slate-200/80 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between text-[12px]">
                    <span className="font-bold text-slate-800">
                      🖼️ 最新提交的 2×2 连续抽帧 ({latestBundle.timeRangeLabel})
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewGridModalUrl(latestBundle.gridDataUrl)}
                      className="font-bold text-[#0071E3]"
                    >
                      🔍 全屏放大
                    </button>
                  </div>
                  <img
                    src={latestBundle.gridDataUrl}
                    alt="Latest 2x2 Grid"
                    onClick={() => setPreviewGridModalUrl(latestBundle.gridDataUrl)}
                    className="aspect-video w-full rounded-xl border border-slate-200 object-cover"
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-[12px] text-slate-500">
                  开始分析或点击「⚡抓拍」后，此处将同步展示最新合成的 2×2 四格连续关键帧图。
                </div>
              )}
            </div>
          )}

          {/* 手机端 Tab 3：✏️ 教练模式与自定义提示词配置 */}
          {mobileTab === 'config' && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5">
                <div className="mb-2 text-[12.5px] font-extrabold text-slate-900">
                  1. 选择 AI 视觉教练场景模式
                </div>
                <div className="space-y-2">
                  {SCENE_PRESETS.map((p) => {
                    const active = p.id === sceneId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectScene(p.id)}
                        className={`flex w-full flex-col items-start rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-[#0071E3] bg-[#F2F8FF]'
                            : 'border-slate-200 bg-slate-50/70'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-[13px] font-extrabold text-slate-900">
                            {p.icon} {p.name}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              active ? 'bg-[#0071E3] text-white' : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {p.badge}
                          </span>
                        </div>
                        <div className="mt-1 text-[11.5px] text-slate-500">{p.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12.5px] font-extrabold text-slate-900">
                    2. 自定义分析提示词 (Prompt)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const found = SCENE_PRESETS.find((p) => p.id === sceneId);
                      if (found) setCustomRubric(found.user_rubric);
                    }}
                    className="text-[11px] font-bold text-[#0071E3]"
                  >
                    恢复默认
                  </button>
                </div>
                <textarea
                  value={customRubric}
                  onChange={(e) => setCustomRubric(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[12px] leading-relaxed text-slate-800 focus:border-[#0071E3] focus:bg-white focus:outline-hidden"
                />
              </div>
            </div>
          )}

          {/* 手机端 Tab 4：🚀 汇总生成训练复盘报告闭环 */}
          {mobileTab === 'report' && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
                  📊
                </div>
                <h3 className="mt-2.5 text-[15px] font-extrabold text-slate-900">
                  生成 AI 视觉教练深度复盘报告
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                  将本次训练采集到的所有动作评估、骨骼角度实测与教练纠偏口令，一键转化为结构化复盘研报、动作拆解思维导图与互动巩固测验。
                </p>

                <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5">
                  <div>
                    <div className="text-[10.5px] text-slate-400">已诊断片段</div>
                    <div className="font-mono text-[16px] font-extrabold text-slate-900">
                      {segments.length} 段
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-slate-400">累计抽帧</div>
                    <div className="font-mono text-[16px] font-extrabold text-slate-900">
                      {totalSampledFrames} 帧
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] text-slate-400">跳过静止</div>
                    <div className="font-mono text-[16px] font-extrabold text-slate-900">
                      {skippedIdleWindows} 段
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={finalizing || segments.length === 0}
                  onClick={handleFinalizeToVideoClosedLoop}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#0071E3] to-[#2563EB] py-3 text-[13.5px] font-extrabold text-white shadow-sm disabled:opacity-40"
                >
                  <span>🚀</span>
                  <span>
                    {finalizing
                      ? '正在汇总生成复盘报告...'
                      : `立即生成完整复盘研报与导图 (${segments.length}段)`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    stopMedia();
                    navigate('/video');
                  }}
                  className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-[12.5px] font-bold text-slate-600"
                >
                  <span>←</span>
                  <span>退出教练 · 返回视频学习助手首页</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ==================== 桌面端右栏 (7列)：教练模式切换 + 独立滚动的实时分析卡片流 ==================== */}
        <section className="hidden min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_8px_30px_rgb(15,23,42,0.04)] lg:col-span-7 lg:flex">
          {/* 右栏固定头部：模式选择卡片 + 可折叠提示词面板 */}
          <div className="shrink-0 border-b border-slate-100 bg-white px-5 pt-4 pb-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-extrabold text-slate-900">
                  AI 视觉教练实时诊断流
                </h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                  已生成 {segments.length} 段
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPromptExpanded((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] font-bold transition ${
                    promptExpanded
                      ? 'border-[#0071E3] bg-[#F2F8FF] text-[#0071E3]'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span>✏️</span>
                  <span>{promptExpanded ? '收起提示词' : '自定义提示词'}</span>
                </button>

                {segments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      rollingMemoryRef.current = [];
                      setSegments([]);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    清空记录
                  </button>
                )}
              </div>
            </div>

            {/* 3 个紧凑型模式切换卡 */}
            <div className="grid grid-cols-3 gap-2">
              {SCENE_PRESETS.map((p) => {
                const active = p.id === sceneId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectScene(p.id)}
                    className={`group flex flex-col items-start rounded-2xl border p-2.5 text-left transition-all ${
                      active
                        ? 'border-[#0071E3] bg-gradient-to-br from-[#F2F8FF] to-white shadow-xs ring-1 ring-[#0071E3]/20'
                        : 'border-slate-200/80 bg-[#F8FAFC] hover:border-slate-300 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px]">{p.icon}</span>
                        <span
                          className={`text-[12.5px] font-extrabold ${
                            active ? 'text-[#0071E3]' : 'text-slate-800'
                          }`}
                        >
                          {p.shortName}
                        </span>
                      </div>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold ${
                          active ? 'bg-[#0071E3] text-white' : 'bg-slate-200/80 text-slate-600'
                        }`}
                      >
                        {p.badge}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                      {p.description}
                    </div>
                  </button>
                );
              })}
            </div>

            {promptExpanded && (
              <div className="mt-2.5 rounded-2xl border border-[#0071E3]/25 bg-[#F8FAFC] p-3">
                <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                  <span className="font-bold text-slate-700">
                    当前教练分析提示词（修改后立即对下一轮抽帧生效）
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const found = SCENE_PRESETS.find((p) => p.id === sceneId);
                      if (found) setCustomRubric(found.user_rubric);
                    }}
                    className="font-semibold text-[#0071E3] hover:underline"
                  >
                    恢复默认提示词
                  </button>
                </div>
                <textarea
                  value={customRubric}
                  onChange={(e) => setCustomRubric(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-[12px] leading-relaxed text-slate-800 focus:border-[#0071E3] focus:outline-hidden"
                />
              </div>
            )}
          </div>

          {/* 右栏核心：独立滚动的实时诊断卡片流 */}
          <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto bg-[#F8FAFC]/60 px-5 py-4">
            {renderDiagnosisCardsList()}
          </div>

          {/* 右栏固定底部：汇总统计与一键生成复盘研报闭环 */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-white px-5 py-3">
            <div className="flex items-center gap-3 text-[12px] text-slate-500">
              <span>
                累计抽帧 <strong className="font-mono text-slate-800">{totalSampledFrames}</strong> 帧
              </span>
              <span>·</span>
              <span>
                跳过静止 <strong className="font-mono text-slate-800">{skippedIdleWindows}</strong> 段
              </span>
              {inFlightCount > 0 && (
                <span className="inline-flex items-center gap-1 font-bold text-[#0071E3]">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#0071E3]" />
                  正在流式生成点评...
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={finalizing || segments.length === 0}
              onClick={handleFinalizeToVideoClosedLoop}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#0071E3] to-[#2563EB] px-4 py-2 text-[12.5px] font-bold text-white shadow-sm shadow-blue-600/20 transition hover:brightness-105 disabled:opacity-40"
            >
              <span>🚀</span>
              <span>
                {finalizing
                  ? '正在汇总生成复盘报告...'
                  : `一键生成完整复盘研报与导图 (${segments.length}段)`}
              </span>
            </button>
          </div>
        </section>
      </div>

      {/* ======================= 手机端专属底部：AI 视觉分析教练工作台导航栏 (取代原本的学习助手底栏) ======================= */}
      <nav
        aria-label="视觉分析教练移动端工作台导航"
        className="z-30 flex shrink-0 items-center justify-around border-t border-slate-200/90 bg-white/95 px-1.5 pt-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileTab('feed')}
          className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10.5px] transition active:scale-95 ${
            mobileTab === 'feed' ? 'font-extrabold text-[#0071E3]' : 'font-semibold text-slate-500'
          }`}
        >
          <span className="text-[16px]">💬</span>
          <span>实时诊断</span>
          {segments.length > 0 && (
            <span className="absolute top-0.5 right-4 rounded-full bg-[#0071E3] px-1.5 text-[9px] font-bold text-white">
              {segments.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('telemetry')}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10.5px] transition active:scale-95 ${
            mobileTab === 'telemetry'
              ? 'font-extrabold text-[#0071E3]'
              : 'font-semibold text-slate-500'
          }`}
        >
          <span className="text-[16px]">🎯</span>
          <span>骨骼/手势数据</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('config')}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10.5px] transition active:scale-95 ${
            mobileTab === 'config'
              ? 'font-extrabold text-[#0071E3]'
              : 'font-semibold text-slate-500'
          }`}
        >
          <span className="text-[16px]">✏️</span>
          <span>教练与提示词</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab('report')}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[10.5px] transition active:scale-95 ${
            mobileTab === 'report'
              ? 'font-extrabold text-[#0071E3]'
              : 'font-semibold text-slate-500'
          }`}
        >
          <span className="text-[16px]">🚀</span>
          <span>复盘报告</span>
        </button>
      </nav>

      {/* 放大查看真实 2×2 抽帧大图 Modal */}
      {previewGridModalUrl && (
        <div
          onClick={() => setPreviewGridModalUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl overflow-hidden rounded-3xl border border-white/15 bg-slate-900 p-4 text-white shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[14px] font-bold sm:text-[15px]">
                真实抓拍的 2×2 连续 4 帧画面（左上 #1 → 右上 #2 → 左下 #3 → 右下 #4）
              </h3>
              <button
                type="button"
                onClick={() => setPreviewGridModalUrl(null)}
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
              >
                关闭 ✕
              </button>
            </div>
            <img src={previewGridModalUrl} alt="2x2 Real Frames" className="w-full rounded-2xl" />
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoCoachLabPage;
