import type { LucideIcon, LucideProps } from "lucide-react";

type AppIconProps = Omit<LucideProps, "size" | "strokeWidth"> & {
  icon: LucideIcon;
  size?: "secondary" | "default" | "large";
};

const sizes = { secondary: 16, default: 20, large: 24 } as const;

export function AppIcon({ icon: Icon, size = "default", ...props }: AppIconProps) {
  return <Icon aria-hidden="true" focusable="false" size={sizes[size]} strokeWidth={1.75} {...props} />;
}
