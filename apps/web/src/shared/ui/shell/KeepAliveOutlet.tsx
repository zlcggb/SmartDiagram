import {
  useEffect,
  useMemo,
  useRef,
  type ComponentType
} from "react";
import {
  Route,
  Routes,
  UNSAFE_LocationContext,
  useLocation,
  useNavigationType,
  type Location
} from "react-router-dom";
import DiagramWorkspace from "@/pages/diagram/DiagramWorkspace";
import HomePage from "@/pages/home/HomePage";
import { PptModule } from "@/features/ppt/PptModule";
import { RecruitModule } from "@/features/recruit/RecruitModule";
import { VideoModule } from "@/features/video/VideoModule";
import {
  KEEP_ALIVE_MODULES,
  matchModulePath,
  useDesktopStore,
  type KeepAliveModulePath
} from "@/shared/store/desktopStore";

const MODULE_COMPONENTS: Record<KeepAliveModulePath, ComponentType> = {
  "/diagram": DiagramWorkspace,
  "/recruit": RecruitModule,
  "/ppt": PptModule,
  "/video": VideoModule
};

function parseRouteToLocation(route: string, fallbackKey: string): Location {
  let pathname = route;
  let search = "";
  let hash = "";

  const hashIndex = pathname.indexOf("#");
  if (hashIndex >= 0) {
    hash = pathname.slice(hashIndex);
    pathname = pathname.slice(0, hashIndex);
  }

  const searchIndex = pathname.indexOf("?");
  if (searchIndex >= 0) {
    search = pathname.slice(searchIndex);
    pathname = pathname.slice(0, searchIndex);
  }

  return {
    pathname: pathname || "/",
    search,
    hash,
    state: null,
    key: fallbackKey
  };
}

interface FrozenModuleWindowProps {
  modulePath: KeepAliveModulePath;
  isActive: boolean;
  liveLocation: Location;
  rememberedRoute: string;
}

function FrozenModuleWindow({
  modulePath,
  isActive,
  liveLocation,
  rememberedRoute
}: FrozenModuleWindowProps) {
  const navigationType = useNavigationType();
  const containerRef = useRef<HTMLDivElement>(null);
  const frozenLocationRef = useRef<Location>(
    isActive
      ? liveLocation
      : parseRouteToLocation(rememberedRoute || modulePath, `keepalive-${modulePath}`)
  );
  const wasActiveRef = useRef<boolean>(isActive);

  if (isActive) {
    frozenLocationRef.current = liveLocation;
  }

  const effectiveLocation = isActive ? liveLocation : frozenLocationRef.current;
  const locationContextValue = useMemo(
    () => ({ location: effectiveLocation, navigationType }),
    [effectiveLocation, navigationType]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!isActive && wasActiveRef.current) {
      // 切入后台：自动暂停容器内正在播放的音视频，并释放输入框焦点
      if (container) {
        const activeEl = document.activeElement;
        if (activeEl instanceof HTMLElement && container.contains(activeEl)) {
          activeEl.blur();
        }
        const mediaElements = container.querySelectorAll<HTMLMediaElement>("video, audio");
        mediaElements.forEach((media) => {
          if (!media.paused) {
            try {
              media.pause();
            } catch {
              // Ignore media pause errors.
            }
          }
        });
      }
    } else if (isActive && !wasActiveRef.current) {
      // 切回前台：触发一次 resize，让画布（ECharts/Excalidraw/MindElixir 等）和指示条校准尺寸
      const frame = window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
      wasActiveRef.current = isActive;
      return () => window.cancelAnimationFrame(frame);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  const ModuleComponent = MODULE_COMPONENTS[modulePath];

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      style={{ display: isActive ? "block" : "none", minHeight: 0 }}
      data-keepalive-module={modulePath}
      data-active={isActive || undefined}
      aria-hidden={!isActive || undefined}
    >
      <UNSAFE_LocationContext.Provider value={locationContextValue}>
        <Routes>
          <Route path={`${modulePath}/*`} element={<ModuleComponent />} />
        </Routes>
      </UNSAFE_LocationContext.Provider>
    </div>
  );
}

export function KeepAliveWorkspace() {
  const location = useLocation();
  const mountedModules = useDesktopStore((state) => state.mountedModules);
  const moduleLastRoutes = useDesktopStore((state) => state.moduleLastRoutes);
  const recordModuleLocation = useDesktopStore((state) => state.recordModuleLocation);

  const activeModule = useMemo(
    () => matchModulePath(location.pathname),
    [location.pathname]
  );
  const isDesktopActive = activeModule === null && location.pathname === "/";

  useEffect(() => {
    if (activeModule) {
      recordModuleLocation(location.pathname, location.search, location.hash);
    }
  }, [activeModule, location.hash, location.pathname, location.search, recordModuleLocation]);

  const effectiveMountedModules = useMemo(() => {
    if (!activeModule || mountedModules.includes(activeModule)) {
      return mountedModules;
    }
    return [...mountedModules, activeModule];
  }, [activeModule, mountedModules]);

  return (
    <>
      <div
        className="h-full w-full overflow-hidden"
        style={{ display: isDesktopActive ? "block" : "none", minHeight: 0 }}
        data-keepalive-module="desktop"
        data-active={isDesktopActive || undefined}
        aria-hidden={!isDesktopActive || undefined}
      >
        <HomePage />
      </div>

      {KEEP_ALIVE_MODULES.map((modulePath) => {
        if (!effectiveMountedModules.includes(modulePath)) {
          return null;
        }
        return (
          <FrozenModuleWindow
            key={modulePath}
            modulePath={modulePath}
            isActive={activeModule === modulePath}
            liveLocation={location}
            rememberedRoute={moduleLastRoutes[modulePath]}
          />
        );
      })}
    </>
  );
}
