import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: ElementType;
};

/**
 * Scroll-reveal with robust fallbacks:
 *  - starts visible when IntersectionObserver is unavailable (SSR / 0×0 viewports)
 *  - a timeout forces visibility after 2.5s even if the observer never fires
 *    (headless previews, quirky embeds) — content is never left invisible
 */
export function Reveal({ children, className = "", delay = 0, as }: RevealProps) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(
    () => typeof window === "undefined" || !("IntersectionObserver" in window),
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // safety net: never leave content hidden
    const fallback = window.setTimeout(() => setVisible(true), 2500);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );

    observer.observe(node);
    return () => {
      window.clearTimeout(fallback);
      observer.disconnect();
    };
  }, []);

  return (
    <Tag
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
