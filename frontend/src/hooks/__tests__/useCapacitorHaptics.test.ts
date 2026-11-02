import { beforeEach, describe, expect, it, vi } from "vitest";

const impact = vi.fn().mockResolvedValue(undefined);
const notification = vi.fn().mockResolvedValue(undefined);
const selectionStart = vi.fn().mockResolvedValue(undefined);
const selectionEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(),
    exitApp: vi.fn(),
  },
}));

vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: {
    hide: vi.fn(),
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setOverlaysWebView: vi.fn(),
    setStyle: vi.fn(),
    setBackgroundColor: vi.fn(),
  },
  Style: {
    Dark: "DARK",
    Light: "LIGHT",
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn(),
  },
}));

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact,
    notification,
    selectionStart,
    selectionEnd,
  },
  ImpactStyle: {
    Light: "LIGHT",
    Medium: "MEDIUM",
    Heavy: "HEAVY",
  },
  NotificationType: {
    Success: "SUCCESS",
    Warning: "WARNING",
    Error: "ERROR",
  },
}));

describe("haptic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("默认配置下 light 不调用原生 Haptics.impact", async () => {
    const { haptic } = await import("../useCapacitor");

    haptic.light();

    expect(impact).not.toHaveBeenCalled();
  });

  it("默认配置下 success 不调用原生 Haptics.notification", async () => {
    const { haptic } = await import("../useCapacitor");

    haptic.success();

    expect(notification).not.toHaveBeenCalled();
  });

  it("默认配置下 selection 不调用原生 Haptics 选择反馈", async () => {
    const { haptic } = await import("../useCapacitor");

    haptic.selection();

    expect(selectionStart).not.toHaveBeenCalled();
    expect(selectionEnd).not.toHaveBeenCalled();
  });
});
