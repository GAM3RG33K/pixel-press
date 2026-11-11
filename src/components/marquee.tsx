import { useLayoutEffect, useRef, useState, type ReactNode, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Marquee({
  children,
  title,
  className,
  ...rest
}: {
  children: ReactNode;
  title: string;
  className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const s = el as HTMLElement;
      setOverflowing(s.scrollWidth - s.clientWidth > 1);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [children]);

  return (
    <span
      ref={ref}
      title={title}
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap",
        overflowing ? "marquee-active" : "text-ellipsis",
        className,
      )}
      {...rest}
    >
      <span className={overflowing ? "marquee-inner" : ""}>
        {children}
        {overflowing ? <span aria-hidden="true">{"\u00A0\u00A0\u00A0"}{children}</span> : null}
      </span>
    </span>
  );
}
