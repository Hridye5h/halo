const VARIANTS = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover shadow-sm',
  ghost: 'text-secondary hover:bg-hover hover:text-primary',
  outline: 'border border-line-strong text-primary hover:bg-hover',
  danger: 'bg-danger text-white hover:opacity-90',
  soft: 'bg-accent-soft text-accent hover:bg-accent hover:text-accent-contrast',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-9 w-9',
};

export function Button({
  variant = 'primary', size = 'md', className = '', loading, children, ...props
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium
        transition-all duration-150 active:scale-[0.97]
        disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
