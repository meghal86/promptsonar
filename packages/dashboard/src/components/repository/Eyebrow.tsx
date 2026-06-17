import type { ReactNode } from "react";

/**
 * Eyebrow — mono uppercase section label.
 * Geist Mono · 11px · 0.2em tracking · uppercase.
 */
export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-mono text-[11px] uppercase tracking-[0.2em] text-faint ${className}`}
    >
      {children}
    </p>
  );
}

export default Eyebrow;
