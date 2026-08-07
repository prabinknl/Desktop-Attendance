import { useAuth } from '../../contexts/AuthContext';
import DashboardPage from './DashboardPage';
import EmployeeAttendanceReportPage from './EmployeeAttendanceReportPage';
import OwnerDashboardPage from './OwnerDashboardPage';

/** Role-aware dashboard entry: employees get personal attendance report, owners get Client Management. */
export default function DashboardEntry() {
  const { hasRole, user } = useAuth();
  if (hasRole('employee')) return <EmployeeAttendanceReportPage />;
  if (hasRole('owner') || user?.role === 'owner') return <OwnerDashboardPage />;
  return <DashboardPage />;
}
