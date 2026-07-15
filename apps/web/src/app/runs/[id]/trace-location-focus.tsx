"use client";

import { useEffect } from "react";

export function TraceLocationFocus({ targetId }: { targetId?: string }) {
  useEffect(() => {
    if (!targetId) return;

    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLElement)) return;

    let parent = target.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) {
        parent.open = true;
      }
      parent = parent.parentElement;
    }

    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.focus({ preventScroll: true });
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [targetId]);

  return null;
}
