export interface EditorFullscreenControls {
  setEditorFullscreen: (value: boolean) => void;
  requestBrowserFullscreen: () => Promise<boolean>;
  exitBrowserFullscreen: () => Promise<boolean>;
  ownsBrowserFullscreenRef: { current: boolean };
}

export async function enterEditorFullscreen(controls: EditorFullscreenControls): Promise<void> {
  controls.setEditorFullscreen(true);
  controls.ownsBrowserFullscreenRef.current = await controls.requestBrowserFullscreen();
}

export function exitEditorFullscreen(controls: EditorFullscreenControls): void {
  controls.setEditorFullscreen(false);
  if (controls.ownsBrowserFullscreenRef.current) {
    controls.ownsBrowserFullscreenRef.current = false;
    void controls.exitBrowserFullscreen();
  }
}
