import { Link } from "react-router-dom";
import { Home, LayoutGrid, LogIn } from "lucide-react";
import { usePlatformAuth } from "@/shared/store/authStore";
import { AppLogoMark } from "./AppLogo";
import {
  projectLoadFailureTitles,
  type ProjectLoadFailureKind
} from "../lib/projectLoadError";

export interface PptNotFoundPageProps {
  code?: number | string;
  kind?: ProjectLoadFailureKind;
  title?: string;
  description?: string;
}

export function PptNotFoundPage({
  code = 404,
  kind = "not-found",
  title,
  description
}: PptNotFoundPageProps) {
  const openLogin = usePlatformAuth((state) => state.openLogin);
  const heading = title ?? projectLoadFailureTitles[kind];
  const detail =
    description ??
    (kind === "not-found"
      ? "链接可能已失效，或您当前未登录无法访问该项目。"
      : "请返回平台桌面，或打开 PPT 首页重新开始。");

  return (
    <div className="studio-shell flex min-h-full w-full items-center justify-center px-6 py-16">
      <div
        className="mx-auto flex w-full max-w-lg flex-col items-center text-center"
        role="alert"
        aria-live="polite"
      >
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <AppLogoMark className="h-8 w-8" />
        </div>

        <p
          className="text-[5.5rem] font-bold leading-none tracking-tight text-title opacity-45"
          aria-hidden="true"
        >
          {code}
        </p>

        <h1 className="mt-2 text-2xl font-bold text-title">{heading}</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">{detail}</p>

        <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/" className="primary-button no-underline">
            <LayoutGrid aria-hidden="true" />
            返回平台桌面
          </Link>
          <Link to="/ppt" className="secondary-button no-underline">
            <Home aria-hidden="true" />
            返回 PPT 首页
          </Link>
        </div>

        {kind === "unauthorized" ? (
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            style={{ color: "var(--k-brand)" }}
            onClick={() => openLogin()}
          >
            <LogIn aria-hidden="true" className="h-4 w-4" />
            登录后继续访问
          </button>
        ) : null}
      </div>
    </div>
  );
}
