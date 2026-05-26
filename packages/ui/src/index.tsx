import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import * as React from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl text-sm font-semibold tracking-wide transition-all duration-350 cubic-bezier(0.16, 1, 0.3, 1) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-emerald-500 text-white hover:bg-emerald-400 shadow-md shadow-emerald-500/10 hover:shadow-lg hover:shadow-emerald-500/25 border border-emerald-400/20",
        secondary: "bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white border border-slate-800",
        outline: "border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:border-white/20",
        glass: "bg-slate-950/40 backdrop-blur-md text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-slate-900/60 shadow-sm shadow-emerald-500/5 hover:shadow-md hover:shadow-emerald-500/10",
        ghost: "text-slate-400 hover:bg-white/5 hover:text-white",
      },
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border",
  {
    variants: {
      variant: {
        default: "bg-white/5 text-slate-300 border-white/10",
        success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.08)]",
        warning: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.08)]",
        danger: "bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.08)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

