type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export async function requestBrowserFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;

  const target = document.documentElement as FullscreenElement | null;
  const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
  if (!target || !request) return false;

  try {
    await request.call(target);
    return true;
  } catch {
    return false;
  }
}

export async function exitBrowserFullscreen(): Promise<boolean> {
  if (typeof document === "undefined" || !isBrowserFullscreen()) return false;

  const doc = document as FullscreenDocument;
  const exit = document.exitFullscreen || doc.webkitExitFullscreen;
  if (!exit) return false;

  try {
    await exit.call(document);
    return true;
  } catch {
    return false;
  }
}

export function isBrowserFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as FullscreenDocument;
  return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}
