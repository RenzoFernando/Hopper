declare global {
  interface Window {
    __HOPPER_VISUAL_TEST__?: boolean;
  }
}

export function isVisualTestRuntime() {
  return window.__HOPPER_VISUAL_TEST__ === true;
}
