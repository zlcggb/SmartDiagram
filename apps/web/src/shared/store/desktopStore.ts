import { create } from "zustand";

export const DESKTOP_PREFERENCES_KEY = "smartdiagram.desktop.preferences.v1";

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
  openPanel: (panel: Exclude<ShellPanel, null>) => void;
  openWindow: (windowName: Exclude<ShellWindow, null>) => void;
  closeOverlay: () => void;
  setSelectedDesktopIcon: (key: string | null) => void;
  toggleWidgets: () => void;
  toggleDesktopIcons: () => void;
  toggleDockAutoHide: () => void;
}

const initialPreferences = readDesktopPreferences();

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
