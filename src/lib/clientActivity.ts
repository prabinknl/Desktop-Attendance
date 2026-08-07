export interface ClientActivityLog {
  id: string;
  clientId: string; // client email or user ID
  clientName: string;
  action: string;
  title: string;
  description: string;
  actor: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'danger';
}

const ACTIVITY_LOGS_KEY = 'ams_client_activity_logs';

export function getClientActivityLogs(clientId?: string): ClientActivityLog[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_LOGS_KEY);
    const logs: ClientActivityLog[] = raw ? JSON.parse(raw) : [];
    if (clientId) {
      const q = clientId.toLowerCase();
      return logs.filter((l) => l.clientId.toLowerCase() === q || l.clientName.toLowerCase() === q);
    }
    return logs;
  } catch {
    return [];
  }
}

export function logClientActivity(entry: Omit<ClientActivityLog, 'id' | 'timestamp'>) {
  try {
    const logs = getClientActivityLogs();
    const newLog: ClientActivityLog = {
      ...entry,
      id: `cal-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(ACTIVITY_LOGS_KEY, JSON.stringify([newLog, ...logs].slice(0, 500)));
  } catch (e) {
    console.error('Failed to log client activity:', e);
  }
}

export function ensureSampleClientActivities() {
  const existing = getClientActivityLogs();
  if (existing.length === 0) {
    const sampleLogs: ClientActivityLog[] = [
      {
        id: 'cal-seed-1',
        clientId: 'admin@acmesoft.com',
        clientName: 'Acme Software Solutions',
        action: 'PLAN_CREATED',
        title: 'Free Version Registered',
        description: 'Account created with 30 Days Free Trial duration by Owner.',
        actor: 'Owner Admin',
        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
        type: 'info',
      },
      {
        id: 'cal-seed-2',
        clientId: 'admin@acmesoft.com',
        clientName: 'Acme Software Solutions',
        action: 'STATUS_CHANGE',
        title: 'App Access Set to Running',
        description: 'App execution state set to Active (Running).',
        actor: 'Owner Admin',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        type: 'success',
      },
      {
        id: 'cal-seed-3',
        clientId: 'contact@globex.com',
        clientName: 'Globex Global Systems',
        action: 'PLAN_CREATED',
        title: 'Paid Version Activated',
        description: 'Account created with 365 Days Paid Version subscription.',
        actor: 'Owner Admin',
        timestamp: new Date(Date.now() - 86400000 * 5).toISOString(),
        type: 'success',
      },
    ];
    localStorage.setItem(ACTIVITY_LOGS_KEY, JSON.stringify(sampleLogs));
  }
}
