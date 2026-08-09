import { clsx, type ClassValue } from "clsx";

// leetcoach uses tailwind-merge here; ReviewKit has one author and a fixed
// component set, so clsx alone is enough (saves 27 KB).
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
