import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, RefreshCw, AlertCircle, X, Sparkles, CheckCircle2 } from 'lucide-react';
import type { UpdateStatusPayload } from '../../types/electron';

export default function AutoUpdateNotifier() {
  const [payload, setPayload] = useState<UpdateStatusPayload | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [dismissedLater, setDismissedLater] = useState(false);

  useEffect(() => {
    if (!window.attendanceDesktop?.onUpdateStatus) return;

    const cleanup = window.attendanceDesktop.onUpdateStatus((data) => {
      setPayload(data);

      if (data.status === 'download-progress' && data.percent != null) {
        setDownloadProgress(Math.round(data.percent));
      }

      if (data.status === 'update-downloaded') {
        setDownloadProgress(100);
        setShowModal(true);
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

  const handleLater = () => {
    setShowModal(false);
    setDismissedLater(true);
  };

  return (
    <>
      {/* Background Download Progress Toast */}
      <AnimatePresence>
        {downloadProgress !== null && downloadProgress < 100 && !showModal && (
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

      {/* Floating Pill Banner when update is downloaded but user clicked "Later" */}
      <AnimatePresence>
        {payload?.status === 'update-downloaded' && dismissedLater && !showModal && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-40 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>Update v{payload.version} ready to install</span>
            <button
              onClick={() => setShowModal(true)}
              className="bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg transition"
            >
              Restart
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Requirement 9: Modal when update finish downloading */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-md w-full rounded-3xl shadow-2xl p-6 relative overflow-hidden"
            >
              <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6" />
              </div>

              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Update Ready
              </h3>

              <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
                A new Attendance Desktop update has been downloaded. Restart the app now to install it.
              </p>

              {payload?.version && (
                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-3 mb-6 flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">New Version:</span>
                  <span className="font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/60 px-2 py-0.5 rounded-md border border-primary-200/50 dark:border-primary-800/50">
                    v{payload.version}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleLater}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={handleRestartAndInstall}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 active:bg-primary-800 rounded-xl shadow-md transition flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4 animate-spin-reverse" />
                  <span>Restart and Install</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
