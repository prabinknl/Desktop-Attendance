import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import { cn } from '../../lib/utils';

const config = {
  success: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700/50' },
  error:   { icon: XCircle,      color: 'text-rose-500',    bg: 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-700/50' },
  warning: { icon: AlertTriangle, color: 'text-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700/50' },
  info:    { icon: Info,          color: 'text-sky-500',   bg: 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-700/50' },
};

export default function ToastContainer() {
  const { toasts, dismissToast } = useNotifications();

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => {
          const { icon: Icon, color, bg } = config[t.type];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn(
                'pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border shadow-lg shadow-black/10',
                bg
              )}
            >
              <Icon size={18} className={cn(color, 'flex-shrink-0 mt-0.5')} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                  {t.title}
                </p>
                {t.message && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-tight">
                    {t.message}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors mt-0.5"
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
