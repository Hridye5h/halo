import { useId } from 'react';

export function Input({ label, hint, error, className = '', as = 'input', ...props }) {
  const id = useId();
  const Tag = as;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-secondary">
          {label}
        </label>
      )}
      <Tag
        id={id}
        {...props}
        aria-invalid={!!error}
        className={`w-full rounded-xl border bg-inset px-3.5 py-2.5 text-sm text-primary
          placeholder:text-muted transition-colors
          focus:border-accent focus:outline-none
          ${error ? 'border-danger' : 'border-line'} ${className}`}
      />
      {(error || hint) && (
        <p className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>{error || hint}</p>
      )}
    </div>
  );
}
