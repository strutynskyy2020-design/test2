import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export default function ThemeToggle({ className = "", compact = false }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const nextTheme = isLight ? "dark" : "light";
  const label = isLight ? "Увімкнути темну тему" : "Увімкнути світлу тему";
  const Icon = isLight ? Moon : Sun;

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={() => setTheme(nextTheme)}
      className={cn(
        "theme-toggle app-header-action touch-manipulation rounded-2xl flex items-center justify-center active:scale-95 transition-[transform,background-color,border-color,color]",
        compact ? "h-11 w-11" : "h-12 w-12 max-[370px]:h-10 max-[370px]:w-10",
        className
      )}
      aria-label={label}
      title={label}
      aria-pressed={isLight}
    >
      <Icon size={18} strokeWidth={2.7} aria-hidden="true" />
    </button>
  );
}
