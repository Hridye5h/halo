import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function Modal({ open, onClose, title, subtitle, children, width = 'max-w-md' }) {
  // Escape-to-close is not a nicety; a modal you can only leave with the mouse
  // is a keyboard trap.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`relative w-full ${width} card p-6 shadow-2xl`}
            initial={{ scale: 0.96, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.98, y: 4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            {title && <h2 className="text-lg font-semibold text-primary">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-secondary">{subtitle}</p>}
            <div className={title ? 'mt-5' : ''}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
