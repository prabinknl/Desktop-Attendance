import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, CheckCircle2 } from 'lucide-react';
import type { UpdateStatusPayload } from '../../types/electron';

/**
 * Non-blocking download progress UI.
 * The install prompt (Restart and Update / Later) is shown by the Electron
 * main process via dialog.showMessageBox after update-downloaded.
 */
export default function AutoUpdateNotifier() {
  const [payload, setPayload] = useState<UpdateStatusPayload | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!window.attendanceDesktop?.onUpdateStatus) return;

    const cleanup = window.attendanceDesktop.onUpdateStatus((data) => {
      setPayload(data);

      if (data.status === 'download-progress' && data.percent != null) {
        setDownloadProgress(Math.round(data.percent));
      }

      if (data.status === 'update-downloaded') {
        setDownloadProgress(100);
      }
    });

    return () => {
      cleanup();
    };
  }, []);

  if (!window.attendanceDesktop?.isElectron) {
    return null;
  }

  const handleRestartAndInstall = () => {
    window.attendanceDesktop?.restartAndInstall?.();
  };

  return (
    <>
      <AnimatePresence>
        {downloadProgress !== null && downloadProgress < 100 && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-primary-600/20 text-primary-400 flex items-center justify-center flex-shrink-0 animate-pulse">
              <Download className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-xs font-medium text-slate-300 mb-1">
                <span>Downloading update...</span>
                <span>{downloadProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <motion.div
                  className="bg-primary-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {payload?.status === 'update-downloaded' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-40 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>
              {payload.version
                ? `Update v${payload.version} ready to install`
                : 'Update ready to install'}
            </span>
            <button
              type="button"
              onClick={handleRestartAndInstall}
              className="bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg transition"
            >
              Restart and Update
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

