/** UI-only status checks can sleep while the desktop window is in the tray. */
export function pollVisibleStatus(refresh: () => void, interval: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    clearInterval(timer);
    if (document.hidden) return;
    refresh();
    timer = setInterval(refresh, interval);
  };
  update();
  document.addEventListener("visibilitychange", update);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", update);
  };
}
