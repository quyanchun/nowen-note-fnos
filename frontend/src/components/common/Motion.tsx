/**
 * Motion —— framer-motion 的无感降级基座
 * ----------------------------------------------------------------------------
 * 直接使用 framer-motion 的 motion.div 时，`prefers-reduced-motion: reduce` 环境
 * 下依然会执行位移/缩放动画（framer-motion 默认并不自动响应该偏好，需业务代码
 * 手动读 useReducedMotion 然后重置 props）。27 个组件都改一遍很扎眼。
 *
 * 因此我们提供一个薄封装：
 *   - API 与 motion.* 一致（同名 props 透传）；
 *   - 运行时读 useReducedMotion()，若为 true，则把 initial/animate/exit/
 *     whileHover/whileTap/whileInView 全部降级为 undefined，transition 降级为
 *     { duration: 0 }；
 *   - 组件结构不变，useLayoutEffect 之类的生命周期也不会丢失（framer-motion
 *     在这些 props 都为 undefined 时会跳过动画但仍挂载 DOM）。
 *
 * 使用方式（推荐新代码用 Motion，旧代码渐进迁移）：
 *   import { Motion } from "@/components/common/Motion";
 *   <Motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
 *
 * 注意：AnimatePresence 的 exit 语义依赖子组件 exit prop，同样会被降级；
 *       reduce 模式下元素会"瞬间消失"——这正是 HIG 要求的行为。
 */
import React, { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import useReducedMotion from "../../hooks/useReducedMotion";

/* 只取 framer-motion 支持的 HTML 标签子集 */
type MotionHTMLTag = keyof typeof motion;

function createMotionComponent<T extends MotionHTMLTag>(tag: T) {
  const MotionTag = (motion as unknown as Record<string, React.ComponentType<HTMLMotionProps<"div">>>)[tag as string];
  if (!MotionTag) {
    // Fallback：framer-motion 没注册的标签直接回落成原生标签
    return forwardRef<HTMLElement, HTMLMotionProps<"div">>((props, ref) =>
      React.createElement(tag, { ...(props as unknown as object), ref })
    );
  }
  const Comp = forwardRef<HTMLElement, HTMLMotionProps<"div">>((props, ref) => {
    const reduce = useReducedMotion();
    if (!reduce) {
      return React.createElement(MotionTag, { ...(props as object), ref } as never);
    }
    const {
      initial: _initial,
      animate: _animate,
      exit: _exit,
      whileHover: _wh,
      whileTap: _wt,
      whileInView: _wi,
      whileFocus: _wf,
      whileDrag: _wd,
      transition: _t,
      layout: _l,
      layoutId: _lid,
      ...rest
    } = props as HTMLMotionProps<"div"> & Record<string, unknown>;
    // reduce 模式下挂载静态 DOM，彻底跳过动画路径
    return React.createElement(MotionTag, {
      ...(rest as object),
      initial: false,
      animate: undefined,
      exit: undefined,
      whileHover: undefined,
      whileTap: undefined,
      whileInView: undefined,
      whileFocus: undefined,
      whileDrag: undefined,
      transition: { duration: 0 },
      ref,
    } as never);
  });
  Comp.displayName = `Motion.${String(tag)}`;
  return Comp;
}

/**
 * 按需扩展：项目里用到的标签集中在这几个。新增标签时加到这里即可。
 */
export const Motion = {
  div: createMotionComponent("div"),
  span: createMotionComponent("span"),
  button: createMotionComponent("button"),
  section: createMotionComponent("section"),
  header: createMotionComponent("header"),
  footer: createMotionComponent("footer"),
  ul: createMotionComponent("ul"),
  li: createMotionComponent("li"),
  nav: createMotionComponent("nav"),
  aside: createMotionComponent("aside"),
  article: createMotionComponent("article"),
  main: createMotionComponent("main"),
};

export default Motion;
