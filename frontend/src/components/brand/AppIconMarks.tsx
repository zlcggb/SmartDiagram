import type { SVGProps } from "react";

export type AppIconMarkProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

/** Shared SmartDiagram mark: the page's purple pen-nib visual on a quiet tile. */
export function SmartDiagramIconMark({
  size,
  width,
  height,
  ...props
}: AppIconMarkProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="4" y="4" width="112" height="112" rx="27" fill="#F7F6FF" />
      <rect x="5" y="5" width="110" height="110" rx="26" stroke="#FFFFFF" strokeWidth="2" />
      <rect
        x="7"
        y="7"
        width="106"
        height="106"
        rx="24"
        stroke="#B8C0D9"
        strokeOpacity="0.34"
      />
      <circle cx="59" cy="58" r="35" fill="#7465F6" fillOpacity="0.07" />
      <g
        transform="translate(24 24) scale(3)"
        stroke="#6857F4"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
        <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
        <path d="m2.3 2.3 7.286 7.286" />
        <circle cx="11" cy="11" r="2" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

/** Shared PPT Agent mark: the established black P canvas with a cyan AI sparkle. */
export function PptAgentIconMark({
  size,
  width,
  height,
  ...props
}: AppIconMarkProps) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={width ?? size}
      height={height ?? size}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="28" height="28" rx="7" fill="#111827" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7 7h7.4c4.1 0 6.6 2.15 6.6 5.7s-2.5 5.8-6.6 5.8h-3.2V22H7V7Zm4.2 3.55v4.4h2.95c1.75 0 2.75-.82 2.75-2.25 0-1.38-1-2.15-2.75-2.15H11.2Z"
        fill="#FFFFFF"
      />
      <path
        d="M20 6l.6 1.4 1.4.6-1.4.6L20 10l-.6-1.4L18 8l1.4-.6L20 6Z"
        fill="#38BDF8"
      />
    </svg>
  );
}
