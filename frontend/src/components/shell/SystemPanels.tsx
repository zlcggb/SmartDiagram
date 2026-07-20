import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Eye,
  EyeOff,
  Maximize2,
  PanelBottom,
  SlidersHorizontal,
  Wifi,
  WifiOff
} from "lucide-react";
import { useDesktopStore } from "../../store/desktopStore";
import { buildCalendarCells } from "./shellModel";
import { useOnlineStatus } from "./useOnlineStatus";

function PanelShell({
  icon,
  title,
  subtitle,
  children
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="mac-system-panel">
      <div className="mac-system-panel-heading">
        <span className="mac-system-panel-icon">{icon}</span>
        <span>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </div>
      {children}
    </section>
  );
}

export function NetworkPanel() {
  const online = useOnlineStatus();
  return (
    <PanelShell
      icon={online ? <Wifi /> : <WifiOff />}
      title={online ? "网络已连接" : "网络已断开"}
      subtitle={online ? "浏览器报告当前在线" : "等待网络恢复"}
    >
      <p className="mac-system-panel-copy">
        {online
          ? "AI 生成、项目同步和历史记录可以正常访问。"
          : "本地编辑仍可继续，AI 生成与云端项目会在网络恢复后重试。"}
      </p>
      <div className="mac-network-status" data-online={online}>
        <span aria-hidden="true" />
        {online ? "在线" : "离线"}
      </div>
    </PanelShell>
  );
}

function ControlToggle({
  icon,
  label,
  pressed,
  onClick
}: {
  icon: ReactNode;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mac-control-toggle"
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span>{icon}</span>
      <strong>{label}</strong>
      <i aria-hidden="true" />
    </button>
  );
}

export function ControlCenterPanel({
  onError
}: {
  onError?: (message: string) => void;
}) {
  const widgetsVisible = useDesktopStore((state) => state.widgetsVisible);
  const desktopIconsVisible = useDesktopStore((state) => state.desktopIconsVisible);
  const dockAutoHide = useDesktopStore((state) => state.dockAutoHide);
  const toggleWidgets = useDesktopStore((state) => state.toggleWidgets);
  const toggleDesktopIcons = useDesktopStore((state) => state.toggleDesktopIcons);
  const toggleDockAutoHide = useDesktopStore((state) => state.toggleDockAutoHide);
  const [fullscreen, setFullscreen] = useState(() =>
    typeof document === "undefined" ? false : Boolean(document.fullscreenElement)
  );

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (reason) {
      onError?.(reason instanceof Error ? reason.message : "浏览器拒绝进入全屏");
    }
  };

  return (
    <PanelShell
      icon={<SlidersHorizontal />}
      title="控制中心"
      subtitle="DeepDiagram 桌面"
    >
      <div className="mac-control-grid">
        <ControlToggle
          icon={widgetsVisible ? <Eye /> : <EyeOff />}
          label="小组件"
          pressed={widgetsVisible}
          onClick={toggleWidgets}
        />
        <ControlToggle
          icon={desktopIconsVisible ? <Eye /> : <EyeOff />}
          label="桌面图标"
          pressed={desktopIconsVisible}
          onClick={toggleDesktopIcons}
        />
        <ControlToggle
          icon={<PanelBottom />}
          label="自动隐藏 Dock"
          pressed={dockAutoHide}
          onClick={toggleDockAutoHide}
        />
        <ControlToggle
          icon={<Maximize2 />}
          label="全屏"
          pressed={fullscreen}
          onClick={() => void toggleFullscreen()}
        />
      </div>
    </PanelShell>
  );
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function CalendarPanel({ date = new Date() }: { date?: Date }) {
  const cells = useMemo(() => buildCalendarCells(date), [date]);
  const today = date.getDate();
  return (
    <PanelShell
      icon={<CalendarDays />}
      title={date.getFullYear() + "年" + (date.getMonth() + 1) + "月"}
      subtitle={"今天 · " + WEEKDAYS[date.getDay()]}
    >
      <div className="mac-calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="mac-calendar-grid" aria-label="本月日历">
        {cells.map((day, index) =>
          day === null ? (
            <span key={"blank-" + index} />
          ) : (
            <span key={day} data-today={day === today || undefined}>{day}</span>
          )
        )}
      </div>
    </PanelShell>
  );
}
