import type { HTMLAttributes } from "react";

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-lg bg-outline-variant/30 ${className}`}
      {...props}
    />
  );
}
