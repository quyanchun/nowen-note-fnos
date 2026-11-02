/**
 * useReducedMotion
 * ----------------------------------------------------------------------------
 * 读取用户系统偏好 `prefers-reduced-motion: reduce`，订阅变更。
 *
 * framer-motion 自带一个同名 hook，但此处我们再包一层出口，原因有二：
 *   1. 统一项目内的 motion-sensitivity 接入点，便于未来叠加"用户在设置里强制
 *      关闭动画"之类的应用级 override（优先级高于系统偏好）。
 *   2. 避免每个组件都 import 一遍 framer-motion 内部 hook——后续如果切换动画
 *      库，只需改此处一处。
 *
 * 用法：
 *   const reduce = useReducedMotion();
 *   <motion.div animate={reduce ? {} : { x: 100 }} />
 *
 * 或配合 <Motion> 基座组件（src/components/common/Motion.tsx），由基座自动
 * 把 `initial/animate/exit/whileHover/whileTap/transition` 在 reduce=true 时
 * 降级为空，无需业务代码改动。
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function getMatch(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() => getMatch());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduce(e.matches);
    // Safari < 14 仅支持 addListener
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    (mq as unknown as { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(handler);
    return () => {
      (mq as unknown as { removeListener: (cb: (e: MediaQueryListEvent) => void) => void }).removeListener(handler);
    };
  }, []);

  return reduce;
}

export default useReducedMotion;
