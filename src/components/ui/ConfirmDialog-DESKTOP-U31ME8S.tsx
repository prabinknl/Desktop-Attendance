import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'danger', onConfirm, onCancel,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 10 }}
            className="card w-full max-w-md p-6 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                variant === 'danger' ? 'bg-rose-100 dark:bg-rose-900/40' :
                variant === 'warning' ? 'bg-amber-100 dark:bg-amber-900/40' :
                'bg-sky-100 dark:bg-sky-900/40'
              )}>
                <AlertTriangle size={18} className={
                  variant === 'danger' ? 'text-rose-500' :
                  variant === 'warning' ? 'text-amber-500' : 'text-sky-500'
                } />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{message}</p>
              </div>
              <button onClick={onCancel} className="btn-ghost p-1 rounded-lg text-slate-400">
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={onCancel} className="btn-secondary">{cancelLabel}</button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                }}
                className={cn(
                  'btn text-white',
                  variant === 'danger' ? 'btn-danger' :
                  variant === 'warning' ? 'bg-amber-500 hover:bg-amber-600 shadow-sm shadow-amber-500/20' :
                  'bg-sky-500 hover:bg-sky-600'
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
