"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Disclosure — animated expand/collapse section.
 *
 * Glass card, rounded-2xl, overflow-hidden. Header shows a title + mono
 * subtitle + chevron that rotates 90deg when open. Body animates via a
 * grid-rows 0fr→1fr transition (no height measuring), and respects
 * prefers-reduced-motion through Tailwind's motion-reduce variant.
 *
 * Title font defaults to Geist 600 (honors the strict typography rule that
 * reserves Playfair for the hero h1, verdict headline, and italic accents).
 * Pass `serifTitle` to opt a specific disclosure into Playfair.
 */
export function Disclosure({
  title,
  subtitle,
  defaultOpen = false,
  serifTitle = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  serifTitle?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="glass overflow-hidden rounded-2xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-[26px] py-5 text-left"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span
            className={
              serifTitle
                ? "font-display text-[20px] font-normal text-ink"
                : "text-[17px] font-semibold text-ink"
            }
          >
            {title}
          </span>
          {subtitle ? (
            <span className="font-mono text-[13px] text-ink-muted">
              {subtitle}
            </span>
          ) : null}
        </span>

        <Chevron open={open} />
      </button>

      {/* Animated body: grid 0fr → 1fr collapses/expands height. */}
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-[26px] pb-[26px] pt-0">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`shrink-0 text-faint transition-transform duration-[250ms] motion-reduce:transition-none ${
        open ? "rotate-90" : "rotate-0"
      }`}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Disclosure;
