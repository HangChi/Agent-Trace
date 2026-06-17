import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "default" | "danger" | "primary" | "ghost";

const variantStyles: Record<ButtonVariant, string> = {
  default:
    "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 focus-visible:ring-stone-400",
  danger:
    "border-red-200 dark:border-red-800 bg-white dark:bg-stone-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 focus-visible:ring-red-400",
  primary:
    "border-stone-900 dark:border-stone-600 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200 focus-visible:ring-stone-400",
  ghost:
    "border-transparent bg-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 focus-visible:ring-stone-400"
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", className = "", children, ...props }, ref) => {
    const sizeStyles = size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-xs";

    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-1.5 border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-stone-900 ${sizeStyles} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
