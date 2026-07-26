import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCheck, Trash2, BellOff } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import { timeAgo, cn } from '../../lib/utils';
import type { NotificationType } from '../../types';

const notifConfig: Record<NotificationType, { emoji: string; color: string }> = {
  late_arrival:        { emoji: '⏰', color: 'bg-amber-100 dark:bg-amber-900/40' },
  leave_request:       { emoji: '📋', color: 'bg-sky-100 dark:bg-sky-900/40' },
  leave_approved:      { emoji: '✅', color: 'bg-emerald-100 dark:bg-emerald-900/40' },
  leave_rejected:      { emoji: '❌', color: 'bg-rose-100 dark:bg-rose-900/40' },
  punch_request:       { emoji: '⏱️', color: 'bg-indigo-100 dark:bg-indigo-900/40' },
  punch_approved:      { emoji: '✅', color: 'bg-emerald-100 dark:bg-emerald-900/40' },
  punch_rejected:      { emoji: '❌', color: 'bg-rose-100 dark:bg-rose-900/40' },
  attendance_saved:    { emoji: '📝', color: 'bg-primary-100 dark:bg-primary-900/40' },
  attendance_updated:  { emoji: '🔄', color: 'bg-slate-100 dark:bg-slate-800' },
  attendance_deleted:  { emoji: '🗑️', color: 'bg-slate-100 dark:bg-slate-800' },
  missing_checkout:    { emoji: '🔔', color: 'bg-amber-100 dark:bg-amber-900/40' },
  employee_added:      { emoji: '👤', color: 'bg-emerald-100 dark:bg-emerald-900/40' },
  employee_updated:    { emoji: '✏️', color: 'bg-sky-100 dark:bg-sky-900/40' },
  report_generated:    { emoji: '📊', color: 'bg-violet-100 dark:bg-violet-900/40' },
};

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();

  const grouped = React.useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const groups: { label: string; items: typeof notifications }[] = [
      { label: 'Today', items: notifications.filter(n => n.createdAt.startsWith(today)) },
      { label: 'Yesterday', items: notifications.filter(n => n.createdAt.startsWith(yesterday)) },
      { label: 'Older', items: notifications.filter(n => !n.createdAt.startsWith(today) && !n.createdAt.startsWith(yesterday)) },
    ].filter(g => g.items.length > 0);
    return groups;
  }, [notifications]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Notifications</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="btn-secondary gap-1.5 text-sm py-2">
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={clearAll} className="btn-ghost gap-1.5 text-sm py-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20">
              <Trash2 size={14} /> Clear all
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="card py-20 text-center">
          <BellOff size={48} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-slate-500 font-medium">No notifications</p>
          <p className="text-sm text-slate-400 mt-1">You're all caught up!</p>
        </div>
      ) : (
        grouped.map(group => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-1">
              {group.label}
            </p>
            <div className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              <AnimatePresence>
                {group.items.map((n, i) => {
                  const config = notifConfig[n.type] ?? { emoji: '🔔', color: 'bg-slate-100 dark:bg-slate-800' };
                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => markRead(n.id)}
                      className={cn(
                        'flex items-start gap-4 px-5 py-4 cursor-pointer transition-colors',
                        n.read
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          : 'bg-primary-50/50 dark:bg-primary-900/10 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                      )}
                    >
                      <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center text-lg flex-shrink-0 mt-0.5', config.color)}>
                        {config.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn('text-sm font-semibold leading-tight', n.read ? 'text-slate-700 dark:text-slate-300' : 'text-slate-900 dark:text-white')}>
                            {n.title}
                          </p>
                          <p className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                            {timeAgo(n.createdAt)}
                          </p>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                          {n.message}
                        </p>
                      </div>
                      {!n.read && (
                        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary-500 mt-2" />
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
