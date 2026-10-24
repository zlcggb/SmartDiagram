import { create } from "zustand";

export const DESKTOP_PREFERENCES_KEY = "smartdiagram.desktop.preferences.v1";
export const MODULE_ROUTES_SESSION_KEY = "smartdiagram.desktop.moduleRoutes.v1";

export const KEEP_ALIVE_MODULES = ["/diagram", "/recruit", "/ppt", "/video"] as const;
export type KeepAliveModulePath = (typeof KEEP_ALIVE_MODULES)[number];

export const DEFAULT_MODULE_ROUTES: Record<KeepAliveModulePath, string> = {
  "/diagram": "/diagram",
  "/recruit": "/recruit",
  "/ppt": "/ppt",
  "/video": "/video"
};

export function matchModulePath(pathname: string): KeepAliveModulePath | null {
  const normalized = pathname || "/";
  for (const mod of KEEP_ALIVE_MODULES) {
    if (normalized === mod || normalized.startsWith(`${mod}/`)) {
      return mod;
    }
  }
  return null;
}

export function isValidModuleRoute(mod: KeepAliveModulePath, route: unknown): route is string {
  if (typeof route !== "string" || !route.startsWith(mod)) return false;
  const rest = route.slice(mod.length);
  return rest === "" || rest.startsWith("/") || rest.startsWith("?") || rest.startsWith("#");
}

export function parseModuleRoutes(raw: string | null): Record<KeepAliveModulePath, string> {
  if (!raw) return { ...DEFAULT_MODULE_ROUTES };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_MODULE_ROUTES };
    }
    const source = parsed as Record<string, unknown>;
    return {
      "/diagram": isValidModuleRoute("/diagram", source["/diagram"])
        ? source["/diagram"]
        : DEFAULT_MODULE_ROUTES["/diagram"],
      "/recruit": isValidModuleRoute("/recruit", source["/recruit"])
        ? source["/recruit"]
        : DEFAULT_MODULE_ROUTES["/recruit"],
      "/ppt": isValidModuleRoute("/ppt", source["/ppt"])
        ? source["/ppt"]
        : DEFAULT_MODULE_ROUTES["/ppt"],
      "/video": isValidModuleRoute("/video", source["/video"])
        ? source["/video"]
        : DEFAULT_MODULE_ROUTES["/video"]
    };
  } catch {
    return { ...DEFAULT_MODULE_ROUTES };
  }
}

export function resolveModuleRoute(
  modulePath: string,
  moduleLastRoutes: Record<KeepAliveModulePath, string>
): string {
  const mod = matchModulePath(modulePath);
  if (!mod) return modulePath;
  return moduleLastRoutes[mod] || mod;
}

function readModuleRoutes(): Record<KeepAliveModulePath, string> {
  if (typeof window === "undefined") return { ...DEFAULT_MODULE_ROUTES };
  try {
    return parseModuleRoutes(window.sessionStorage.getItem(MODULE_ROUTES_SESSION_KEY));
  } catch {
    return { ...DEFAULT_MODULE_ROUTES };
  }
}

function saveModuleRoutes(routes: Record<KeepAliveModulePath, string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(MODULE_ROUTES_SESSION_KEY, JSON.stringify(routes));
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

function readInitialMountedModules(): KeepAliveModulePath[] {
  if (typeof window === "undefined") return [];
  const mod = matchModulePath(window.location.pathname);
  return mod ? [mod] : [];
}

export type ShellPanel =
  | "network"
  | "control-center"
  | "calendar"
  | "user"
  | "spotlight"
  | null;

export type ShellWindow =
  | "login"
  | "recents"
  | "about"
  | "help"
  | "profile"
  | "platform-users"
  | null;

export interface DesktopPreferences {
  widgetsVisible: boolean;
  desktopIconsVisible: boolean;
  dockAutoHide: boolean;
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  widgetsVisible: true,
  desktopIconsVisible: true,
  dockAutoHide: false
};

export function parseDesktopPreferences(raw: string | null): DesktopPreferences {
  if (!raw) return { ...DEFAULT_DESKTOP_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_DESKTOP_PREFERENCES };
    }
    const source = parsed as Record<string, unknown>;
    return {
      widgetsVisible:
        typeof source.widgetsVisible === "boolean"
          ? source.widgetsVisible
          : DEFAULT_DESKTOP_PREFERENCES.widgetsVisible,
      desktopIconsVisible:
        typeof source.desktopIconsVisible === "boolean"
          ? source.desktopIconsVisible
          : DEFAULT_DESKTOP_PREFERENCES.desktopIconsVisible,
      dockAutoHide:
        typeof source.dockAutoHide === "boolean"
          ? source.dockAutoHide
          : DEFAULT_DESKTOP_PREFERENCES.dockAutoHide
    };
  } catch {
    return { ...DEFAULT_DESKTOP_PREFERENCES };
  }
}

function readDesktopPreferences(): DesktopPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_DESKTOP_PREFERENCES };
  return parseDesktopPreferences(window.localStorage.getItem(DESKTOP_PREFERENCES_KEY));
}

function saveDesktopPreferences(preferences: DesktopPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESKTOP_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Browsers may reject storage in private or restricted contexts.
  }
}

interface DesktopState extends DesktopPreferences {
  activePanel: ShellPanel;
  activeWindow: ShellWindow;
  selectedDesktopIcon: string | null;
  moduleLastRoutes: Record<KeepAliveModulePath, string>;
  mountedModules: KeepAliveModulePath[];
  openPanel: (panel: Exclude<ShellPanel, null>) => void;
  openWindow: (windowName: Exclude<ShellWindow, null>) => void;
  closeOverlay: () => void;
  setSelectedDesktopIcon: (key: string | null) => void;
  recordModuleLocation: (pathname: string, search?: string, hash?: string) => void;
  quitModule: (modulePath: KeepAliveModulePath) => void;
  toggleWidgets: () => void;
  toggleDesktopIcons: () => void;
  toggleDockAutoHide: () => void;
}

const initialPreferences = readDesktopPreferences();
const initialModuleRoutes = readModuleRoutes();
const initialMountedModules = readInitialMountedModules();

function preferencesFromState(state: DesktopState): DesktopPreferences {
  return {
    widgetsVisible: state.widgetsVisible,
    desktopIconsVisible: state.desktopIconsVisible,
    dockAutoHide: state.dockAutoHide
  };
}

export const useDesktopStore = create<DesktopState>((set) => ({
  ...initialPreferences,
  activePanel: null,
  activeWindow: null,
  selectedDesktopIcon: null,
  moduleLastRoutes: initialModuleRoutes,
  mountedModules: initialMountedModules,

  openPanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? null : panel,
      activeWindow: null
    })),

  openWindow: (activeWindow) =>
    set({
      activePanel: null,
      activeWindow
    }),

  closeOverlay: () =>
    set({
      activePanel: null,
      activeWindow: null
    }),

  setSelectedDesktopIcon: (selectedDesktopIcon) => set({ selectedDesktopIcon }),

  recordModuleLocation: (pathname, search = "", hash = "") =>
    set((state) => {
      const mod = matchModulePath(pathname);
      if (!mod) return state;
      const fullRoute = `${pathname}${search}${hash}`;
      const routeChanged = state.moduleLastRoutes[mod] !== fullRoute;
      const alreadyMounted = state.mountedModules.includes(mod);
      if (!routeChanged && alreadyMounted) return state;

      const nextRoutes = routeChanged
        ? { ...state.moduleLastRoutes, [mod]: fullRoute }
        : state.moduleLastRoutes;
      if (routeChanged) {
        saveModuleRoutes(nextRoutes);
      }
      const nextMounted = alreadyMounted
        ? state.mountedModules
        : [...state.mountedModules, mod];

      return {
        moduleLastRoutes: nextRoutes,
        mountedModules: nextMounted
      };
    }),

  quitModule: (modulePath) =>
    set((state) => {
      const nextRoutes = {
        ...state.moduleLastRoutes,
        [modulePath]: DEFAULT_MODULE_ROUTES[modulePath]
      };
      saveModuleRoutes(nextRoutes);
      return {
        moduleLastRoutes: nextRoutes,
        mountedModules: state.mountedModules.filter((m) => m !== modulePath)
      };
    }),

  toggleWidgets: () =>
    set((state) => {
      const next = { ...preferencesFromState(state), widgetsVisible: !state.widgetsVisible };
      saveDesktopPreferences(next);
      return { widgetsVisible: next.widgetsVisible };
    }),

  toggleDesktopIcons: () =>
    set((state) => {
      const next = {
        ...preferencesFromState(state),
        desktopIconsVisible: !state.desktopIconsVisible
      };
      saveDesktopPreferences(next);
      return { desktopIconsVisible: next.desktopIconsVisible };
    }),

  toggleDockAutoHide: () =>
    set((state) => {
      const next = { ...preferencesFromState(state), dockAutoHide: !state.dockAutoHide };
      saveDesktopPreferences(next);
      return { dockAutoHide: next.dockAutoHide };
    })
}));
