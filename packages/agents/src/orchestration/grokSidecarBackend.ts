import { createNativeOrchestrationBackend } from "./nativeBackend.js";
import type { OrchestrationBackend } from "./types.js";

export type GrokSidecarConfig = {
  /** 可执行文件路径，如 /usr/local/bin/grok 或 xai-grok-pager */
  bin?: string;
  /** 额外参数前缀（不含 -p prompt） */
  extraArgs?: string[];
  /**
   * true：mapPages 仍走 native wait_all（推荐过渡期）
   * false：mapPages 直接拒绝（强制尚未实现的进程外 fan-out）
   */
  fallBackToNativeMap?: boolean;
};

function resolveBin(config: GrokSidecarConfig): string | undefined {
  const fromConfig = config.bin?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.GROK_SIDECAR_BIN?.trim();
  return fromEnv || undefined;
}

/**
 * grok 进程外 sidecar 骨架。
 *
 * 现实边界（刻意不在此实现完整集成）：
 * - 不 spawn Rust 运行时、不要求本机 cargo build
 * - 不把编码 Agent 的 shell/edit 工具面接到 PPT 结构化流水线
 * - runExternalRole 仅在配置了 GROK_SIDECAR_BIN 时返回「未接线」说明，便于日后接 headless `-p`
 *
 * 真正接线时建议：headless `grok -p ... --output-format json` 或 ACP stdio，
 * 且仅用于探索类任务，不替代 generateOutline / SVG 设计契约。
 */
export function createGrokSidecarOrchestrationBackend(
  config: GrokSidecarConfig = {}
): OrchestrationBackend {
  const fallBack = config.fallBackToNativeMap !== false;
  const native = createNativeOrchestrationBackend();

  return {
    kind: "grok-sidecar",
    isAvailable() {
      return Boolean(resolveBin(config));
    },
    describe() {
      const bin = resolveBin(config);
      if (!bin) {
        return "grok-sidecar: unavailable (set GROK_SIDECAR_BIN); mapPages falls back to native";
      }
      return `grok-sidecar: bin=${bin} (external role stub; mapPages=${fallBack ? "native-fallback" : "disabled"})`;
    },
    onHook(listener) {
      return native.onHook?.(listener) ?? (() => undefined);
    },
    async mapPages<T, R>(items: readonly T[], worker: (item: T, index: number, emitToken: (token: string) => void) => Promise<R>, options = {}) {
      if (!fallBack) {
        throw new Error(
          "grok-sidecar mapPages is not implemented; set fallBackToNativeMap or use ORCHESTRATION_BACKEND=native"
        );
      }
      return native.mapPages(items, worker, options);
    },
    async runExternalRole(input) {
      const bin = resolveBin(config);
      if (!bin) {
        return {
          ok: false as const,
          reason:
            "GROK_SIDECAR_BIN unset — install prebuilt `grok` or set path; full spawn not wired in this skeleton"
        };
      }
      // 刻意不 spawn：避免半吊子集成与意外扣费 / 沙箱副作用
      return {
        ok: false as const,
        reason: [
          `sidecar stub ready (bin=${bin}, role=${input.role})`,
          "wire later via: grok -p <prompt> --output-format json --yolo",
          "or ACP stdio — do not replace PPT structured stages yet"
        ].join("; ")
      };
    }
  };
}
