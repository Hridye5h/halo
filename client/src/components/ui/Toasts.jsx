import { AnimatePresence, motion } from 'framer-motion';
import { useRealtime } from '../../stores/useRealtime.js';

export function Toasts() {
  const toasts = useRealtime((s) => s.toasts);
  const dismiss = useRealtime((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            type="button"
            onClick={() => { toast.onClick?.(); dismiss(toast.id); }}
            className="pointer-events-auto card glass w-full p-3.5 text-left shadow-xl"
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="flex items-start gap-3">
              <span className="text-lg leading-none">{toast.icon ?? '💬'}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-primary">{toast.title}</p>
                {toast.body && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-secondary">{toast.body}</p>
                )}
              </div>
            </div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
