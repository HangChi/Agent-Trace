import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect width="64" height="64" rx="15" fill="#4F46E5" />
      <path
        d="M15 32h12c7 0 7-12 15-12h7M27 32c7 0 7 12 15 12h7"
        stroke="#FFFFFF"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="15" cy="32" r="4" fill="#C7D2FE" />
      <circle cx="49" cy="20" r="4" fill="#67E8F9" />
      <circle cx="49" cy="44" r="4" fill="#FFFFFF" />
    </svg>
  );
}
