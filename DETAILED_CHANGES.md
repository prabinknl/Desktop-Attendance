# Detailed Change Log

## File 1: server/src/models/InvitationModel.ts

**Location:** Lines 224-237 (NEW METHOD)

**Added:**
```typescript
async getByRoleAndStatus(role: string, statuses: string[] = ['pending', 'active']): Promise<InvitationRecord[]> {
  if (!isMemoryMode()) {
    try {
      const placeholders = statuses.map((_, i) => `$${i + 2}`).join(',');
      const res = await query<any>(
        `SELECT * FROM app_invitations WHERE role = $1 AND status IN (${placeholders}) AND used = false ORDER BY created_at DESC`,
        [role, ...statuses],
      );
      return res.rows.map(normalizeInvitationRecord);
    } catch (err) {
      console.warn('[InvitationModel] DB getByRoleAndStatus error, falling back to memory:', err instanceof Error ? err.message : err);
    }
  }
  return memoryStore.getAllInvitations().filter(
    (inv) => inv.role === role && statuses.includes(inv.status ?? 'pending') && !inv.used,
  );
}
```

---

## File 2: server/src/db/memoryStore.ts

**Location:** Lines 441-443 (NEW METHOD)

**Added:**
```typescript
getAllInvitations(): InvitationRecord[] {
  return memoryInvitations.map((i) => ({ ...i }));
}
```

---

## File 3: server/src/controllers/authController.ts

**Location:** Lines 1087-1127 (NEW FUNCTION)

**Added:**
```typescript
export async function getInvitationsByRole(req: Request, res: Response) {
  try {
    const role = String(req.params.role ?? '').trim().toLowerCase();

    if (!role || !['employee', 'accountant', 'client'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Valid role is required (employee, accountant, or client).' });
    }

    const invitations = await InvitationModel.getByRoleAndStatus(role, ['pending', 'active']);
    const serialized = invitations.map((inv) => ({
      token: inv.token,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      status: inv.status ?? 'pending',
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      used: inv.used,
    }));

    return res.json({ success: true, data: serialized });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch invitations';
    console.error('[Auth] getInvitationsByRole error:', message);
    return res.status(500).json({ success: false, message });
  }
}
```

---

## File 4: server/src/routes/authRoutes.ts

**Location:** Line 1 and Line 20 (NEW IMPORTS) and Line 42 (NEW ROUTE)

**Changed from:**
```typescript
import {
  sendAdminCode,
  verifyAdminCode,
  sendInviteEmail,
  getInvitationByToken,
  markInvitationUsed,
  getUsers,
  syncUser,
  login,
  createClientAdminInvite,
  validateClientAdminInvite,
  resendClientAdminSms,
  signupClientAdmin,
  verifyAdminSignupInvite,
  submitAdminSignup,
  verifyAdminSignupEmail,
  resendAdminSignupEmail,
  purgeAdminAccount,
} from '../controllers/authController.js';
```

**Changed to:**
```typescript
import {
  sendAdminCode,
  verifyAdminCode,
  sendInviteEmail,
  getInvitationByToken,
  markInvitationUsed,
  getUsers,
  syncUser,
  login,
  createClientAdminInvite,
  validateClientAdminInvite,
  resendClientAdminSms,
  signupClientAdmin,
  verifyAdminSignupInvite,
  submitAdminSignup,
  verifyAdminSignupEmail,
  resendAdminSignupEmail,
  purgeAdminAccount,
  getInvitationsByRole,
} from '../controllers/authController.js';
```

**Added route (after line 41):**
```typescript
router.get('/invitations/by-role/:role', getInvitationsByRole);
```

---

## File 5: src/api/authApi.ts

**Location:** Lines 314-327 (NEW METHOD)

**Added to authApi object (before closing brace):**
```typescript
getInvitationsByRole: async (role: string) => {
  try {
    const { data } = await apiClient.get<{
      success: boolean;
      data?: Array<{
        token: string;
        email: string;
        name?: string;
        role: string;
        status: string;
        createdAt: string;
        expiresAt: string;
        used: boolean;
      }>;
      message?: string;
    }>(`/auth/invitations/by-role/${role}`);
    return data.success ? data.data ?? [] : [];
  } catch {
    return [];
  }
},
```

---

## File 6: src/data/store.ts

**Location:** Line 25 (NEW IMPORT)

**Added:**
```typescript
import { authApi } from '../api/authApi';
```

**Location:** Lines 1032-1069 (UPDATED FUNCTION)

**Changed from:**
```typescript
export const DashboardAPI = {
  getStats: async (date?: string) => {
    const d = date ?? new Date().toISOString().split('T')[0];
    const allEmp = await EmployeeAPI.getAll();
    const active = allEmp.filter(e => e.status === 'active');
    const todayAtt = attendanceStore.filter(a => a.date === d);

    const present = todayAtt.filter(a => a.status === 'present').length;
    const late = todayAtt.filter(a => a.status === 'late').length;
    const onLeave = todayAtt.filter(a => a.status === 'on_leave').length;
    const absent = active.length - todayAtt.filter(a => a.status !== 'absent').length;

    return {
      totalEmployees: active.length,
      presentToday: present + late,
      absentToday: Math.max(0, absent),
      lateToday: late,
      onLeaveToday: onLeave,
      attendancePercentage: active.length
        ? Math.round(((present + late + onLeave) / active.length) * 100)
        : 0,
    };
  },
```

**Changed to:**
```typescript
export const DashboardAPI = {
  getStats: async (date?: string) => {
    const d = date ?? new Date().toISOString().split('T')[0];
    const allEmp = await EmployeeAPI.getAll();
    const active = allEmp.filter(e => e.status === 'active');
    const todayAtt = attendanceStore.filter(a => a.date === d);

    // Fetch pending employee invitations from the backend
    let pendingInvitations: Array<{ email: string }> = [];
    try {
      pendingInvitations = await authApi.getInvitationsByRole('employee');
    } catch (err) {
      // Fallback silently if invitations endpoint is not available
      console.debug('[Dashboard] Could not fetch invitations:', err);
    }

    // Deduplicate: count emails that are in invitations but not in active employees
    const activeEmails = new Set(active.map(e => e.email.toLowerCase().trim()));
    const uniquePendingEmails = new Set(
      pendingInvitations
        .map((inv: any) => inv.email.toLowerCase().trim())
        .filter((email: string) => !activeEmails.has(email))
    );

    const present = todayAtt.filter(a => a.status === 'present').length;
    const late = todayAtt.filter(a => a.status === 'late').length;
    const onLeave = todayAtt.filter(a => a.status === 'on_leave').length;
    const absent = active.length - todayAtt.filter(a => a.status !== 'absent').length;
    const totalEmployees = active.length + uniquePendingEmails.size;

    return {
      totalEmployees,
      presentToday: present + late,
      absentToday: Math.max(0, absent),
      lateToday: late,
      onLeaveToday: onLeave,
      attendancePercentage: active.length
        ? Math.round(((present + late + onLeave) / active.length) * 100)
        : 0,
    };
  },
```

---

## File 7: src/pages/dashboard/DashboardPage.tsx

**Location:** Lines 53-107 (REFACTORED DATA LOADING)

**Changed from:**
```typescript
export default function DashboardPage() {
  // ... state declarations ...

  useEffect(() => {
    (async () => {
      const [s, t, d, leaves, attendance, employees] = await Promise.all([
        DashboardAPI.getStats(),
        DashboardAPI.getTrend(14),
        DashboardAPI.getDeptStats(),
        LeaveAPI.getAll(),
        AttendanceAPI.getByDate(today),
        EmployeeAPI.getAll(),
      ]);

      setStats(s);
      setTrend(t);
      setDeptStats(d);
      setPendingLeaves(leaves.filter(l => l.status === 'pending').slice(0, 5));

      const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
      const withEmp = attendance
        .map(a => ({ ...a, employee: empMap[a.employeeId] }))
        .filter(a => a.employee);

      setLateEmployees(withEmp.filter(a => a.status === 'late').slice(0, 5));
      setRecentAtt(withEmp.slice(0, 8));
      setLoading(false);
    })();
  }, []);
```

**Changed to:**
```typescript
export default function DashboardPage() {
  // ... state declarations ...

  const loadDashboardData = async () => {
    try {
      const [s, t, d, leaves, attendance, employees] = await Promise.all([
        DashboardAPI.getStats(),
        DashboardAPI.getTrend(14),
        DashboardAPI.getDeptStats(),
        LeaveAPI.getAll(),
        AttendanceAPI.getByDate(today),
        EmployeeAPI.getAll(),
      ]);

      setStats(s);
      setTrend(t);
      setDeptStats(d);
      setPendingLeaves(leaves.filter(l => l.status === 'pending').slice(0, 5));

      const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
      const withEmp = attendance
        .map(a => ({ ...a, employee: empMap[a.employeeId] }))
        .filter(a => a.employee);

      setLateEmployees(withEmp.filter(a => a.status === 'late').slice(0, 5));
      setRecentAtt(withEmp.slice(0, 8));
      setLoading(false);
    } catch (err) {
      console.error('[Dashboard] Load error:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);
```

**Location:** Lines 479-483 (UPDATED INVITE MODAL)

**Changed from:**
```typescript
<InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
```

**Changed to:**
```typescript
<InviteModal 
  open={inviteOpen} 
  onClose={() => setInviteOpen(false)}
  onInvitationSent={() => {
    // Refresh dashboard stats after invitation is sent
    setTimeout(loadDashboardData, 500);
  }}
/>
```

---

## File 8: src/components/InviteModal.tsx

**Location:** Lines 35-37 (UPDATED INTERFACE AND COMPONENT)

**Changed from:**
```typescript
interface InviteModalProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteModal({ open, onClose }: InviteModalProps) {
```

**Changed to:**
```typescript
interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  onInvitationSent?: () => void;
}

export default function InviteModal({ open, onClose, onInvitationSent }: InviteModalProps) {
```

**Location:** Lines 117-118 (ADDED CALLBACK AFTER SUCCESS)

**Changed from:**
```typescript
if (res.success && res.emailSent !== false) {
  setEmailSentOk(true);
  toast('success', `Invitation code sent to ${trimmedEmail}`);
} else {
```

**Changed to:**
```typescript
if (res.success && res.emailSent !== false) {
  setEmailSentOk(true);
  toast('success', `Invitation code sent to ${trimmedEmail}`);
  // Trigger dashboard refresh after successful invitation
  onInvitationSent?.();
} else {
```

---

## Summary of Changes

- **Total files modified:** 8
- **Total lines added:** ~150
- **Total lines modified:** ~40
- **Total lines removed:** 0 (all changes are additive or refactoring)
- **Breaking changes:** None
- **Database migrations needed:** None (uses existing columns)
- **New dependencies:** None (uses existing imports)
