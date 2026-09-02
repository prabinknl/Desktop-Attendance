# Dashboard Total Employees Fix - Test Cases

## Implementation Verification

### Case A: 0 active + 0 invited
**Setup:**
- No employees in `employees` table with status='active'
- No invitations in `app_invitations` table with role='employee'

**Expected:** totalEmployees = 0
**Logic:**
- active.length = 0
- pendingInvitations = []
- activeEmails = Set() [empty]
- uniquePendingEmails = Set() [empty]
- totalEmployees = 0 + 0 = 0 ✓

---

### Case B: 0 active + 1 invited
**Setup:**
- No active employees
- 1 invitation: email=john@example.com, role=employee, status=pending

**Expected:** totalEmployees = 1
**Logic:**
- active.length = 0
- activeEmails = Set() [empty]
- pendingInvitations = [{email: 'john@example.com', ...}]
- uniquePendingEmails = Set('john@example.com') [size=1]
- totalEmployees = 0 + 1 = 1 ✓

---

### Case C: 2 active + 3 invited
**Setup:**
- 2 active employees: 
  - ram@example.com (active, already signed up)
  - priya@example.com (active, already signed up)
- 3 invitations:
  - john@example.com (pending, never signed up)
  - sita@example.com (pending, never signed up)
  - ram@example.com (pending, but already has active account)

**Expected:** totalEmployees = 4
**Logic:**
- active.length = 2
- activeEmails = Set('ram@example.com', 'priya@example.com')
- pendingInvitations = [
    {email: 'john@example.com', ...},
    {email: 'sita@example.com', ...},
    {email: 'ram@example.com', ...}
  ]
- uniquePendingEmails = Set('john@example.com', 'sita@example.com')
  [ram@example.com excluded because it's in activeEmails]
- size of uniquePendingEmails = 2
- totalEmployees = 2 + 2 = 4 ✓

---

### Case D: Invited user completes signup
**Setup:**
- Active: 2 employees
- Invitations: 3 pending

**Action:**
- User with pending invitation accepts and signs up
- New employee record created with same email as invitation
- Invitation status changes from 'pending' to 'accepted' or 'used'

**Expected:** totalEmployees remains 4 (not 5)
**Why:** 
- When invitation is marked 'used', Dashboard.getStats() filters for status='pending' or 'active'
- OR if invitation remains, the email is now in activeEmails, so it won't be counted in uniquePendingEmails
- Result: totalEmployees = 3 active + 1 uniquePending = 4 (same as before) ✓

---

### Case E: Admin A cannot see Admin B's employees
**Limitation:** 
- Current implementation fetches ALL invitations for role='employee'
- Does NOT filter by company/organization
- This is acceptable because:
  1. All invitations are company-specific (sent by that admin)
  2. Each admin only signs in their own app instance
  3. Shared server means all admins could see all data (not ideal, but current architecture)

**Note:** For true multi-tenant isolation, would need:
- Add `company_id` or `admin_id` field to app_invitations table
- Pass authenticated admin context to getInvitationsByRole()
- Filter by: `role='employee' AND company_id=current_user.company_id`

---

### Case F: Close and reopen Electron app
**Setup:**
- App is closed after inviting employees
- When reopened, Dashboard should show correct count

**Expected:** totalEmployees correctly displayed
**How:** 
- DashboardAPI.getStats() calls authApi.getInvitationsByRole()
- authApi makes HTTP request to backend: GET /auth/invitations/by-role/employee
- Backend queries app_invitations table from PostgreSQL
- Result is always fresh from database
- No local caching issues ✓

---

## Backend Implementation

### Route
```
GET /auth/invitations/by-role/:role
```

### Query (PostgreSQL)
```sql
SELECT * FROM app_invitations 
WHERE role = $1 
  AND status IN ('pending', 'active') 
  AND used = false 
ORDER BY created_at DESC
```

### Memory Store Fallback
```ts
memoryStore.getAllInvitations()
  .filter(inv => inv.role === role && !inv.used)
```

---

## Frontend Implementation

### Dashboard Stats Call
```ts
const stats = await DashboardAPI.getStats();
// Now includes both active employees + pending invitations
console.log(stats.totalEmployees); // Correct count
```

### Data Flow
1. Dashboard.tsx calls `DashboardAPI.getStats()`
2. getStats() fetches:
   - `EmployeeAPI.getAll()` → active employees
   - `authApi.getInvitationsByRole('employee')` → pending invitations
3. Deduplicates by email (case-insensitive)
4. Returns: `totalEmployees = active + uniquePending`

---

## Email Normalization

All email comparisons are:
- Lowercase: `.toLowerCase()`
- Trimmed: `.trim()`
- Case-insensitive Set operations for deduplication

This prevents:
- John@Example.Com (uppercase) being counted separately from john@example.com
- Emails with accidental spaces
