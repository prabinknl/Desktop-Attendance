import { useAuth } from '../../contexts/AuthContext';
import DashboardPage from './DashboardPage';
import EmployeeAttendanceReportPage from './EmployeeAttendanceReportPage';

/** Role-aware dashboard entry: employees get personal attendance report only. */
export default function DashboardEntry() {
  const { hasRole } = useAuth();
  if (hasRole('employee')) return <EmployeeAttendanceReportPage />;
  return <DashboardPage />;
}
