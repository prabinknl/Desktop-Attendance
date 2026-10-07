import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import type { UpdateStatusPayload } from '../../types/electron';

/**
 * Non-blocking update UI for the desktop app.
 * The main process also shows a native "Restart and Update / Later" dialog once
 * per downloaded version; this banner stays available if the user chose Later.
 * Routine offline / not-published check results stay silent; only a failed
 * download is surfaced.
 */
export default function AutoUpdateNotifier() {
  const [payload, setPayload] = useState<UpdateStatusPayload | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const wasDownloading = useRef(false);

  useEffect(() => {
    const bridge = window.attendanceDesktop;
    if (!bridge?.onUpdateStatus) return;

    const apply = (data: UpdateStatusPayload) => {
      setPayload(data);
      if (data.status === 'update-available' || data.status === 'download-progress') {
        wasDownloading.current = true;
        setDownloadError(null);
      } else if (data.status === 'error') {
        if (wasDownloading.current) setDownloadError(data.error ?? 'The update download failed. It will be retried later.');
        wasDownloading.current = false;
      } else if (data.status === 'update-downloaded') {
        wasDownloading.current = false;
      }
    };

    void bridge.getUpdateState?.().then((initial) => {
      if (initial) apply(initial);
    }).catch(() => undefined);
    const cleanup = bridge.onUpdateStatus(apply);
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (!downloadError) return;
    const id = setTimeout(() => setDownloadError(null), 10_000);
    return () => clearTimeout(id);
  }, [downloadError]);

  if (!window.attendanceDesktop?.isElectron || !payload) {
    return null;
  }

  const downloading = payload.status === 'update-available' || payload.status === 'download-progress';
  const percent = payload.percent != null ? Math.round(payload.percent) : 0;
  const ready = payload.status === 'update-downloaded' && dismissedVersion !== (payload.version ?? '');
  const installing = payload.status === 'installing';

  return (
    <>
      <AnimatePresence>
        {downloading && (
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
                <span>
                  Downloading update{payload.version ? ` v${payload.version}` : ''}…
                </span>
                <span>{percent}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <motion.div
                  className="bg-primary-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">You can keep working while it downloads.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ready && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-40 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>
              {payload.version ? `Update v${payload.version} ready to install` : 'Update ready to install'}
            </span>
            <button
              type="button"
              onClick={() => void window.attendanceDesktop?.restartAndInstall?.()}
              className="bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg transition"
            >
              Restart and Update
            </button>
            <button
              type="button"
              onClick={() => setDismissedVersion(payload.version ?? '')}
              className="text-emerald-100 hover:text-white px-1.5 py-1 rounded-lg transition"
              title="Installs automatically the next time you close the app"
            >
              Later
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {installing && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 right-4 z-40 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-semibold"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Finishing attendance sync and installing the update…</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {downloadError && !downloading && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-amber-50 text-amber-900 p-3 rounded-2xl shadow-lg border border-amber-200 flex items-start gap-3 text-xs"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span className="flex-1">{downloadError}</span>
            <button type="button" onClick={() => setDownloadError(null)} aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
