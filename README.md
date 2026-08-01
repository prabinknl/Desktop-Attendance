# PACE Attendance Management System

A premium, modern Attendance Management System (AMS) built with React, Vite, Tailwind CSS, Express, and PostgreSQL. It integrates directly with physical Hikvision ISAPI devices for real-time attendance syncing, logs tracking, and features a robust role-based access control system.

## Key Features

- **Real-Time Attendance Sync**: Connects to physical Hikvision ISAPI devices to automatically pull and sync attendance logs.
- **Admin Verification & Invites**: Secure admin registration via email-verification codes and role-scoped email invitation sign-ups.
- **Role-Based Access Control**:
  - **Admin**: Full access to device configuration, system settings, departments, shifts, reports, and inviting team members.
  - **Accountant**: Manage payroll, shifts, and view reports.
  - **Employee**: View personal attendance history, check shift schedules, and request leaves.
- **Interactive Dashboard**: Modern widgets, analytics charts, and visual statistics of attendance metrics.
- **Department & Shift Management**: Configure shifts, grace times, late penalties, and assign employees.
- **Leave Request Workflow**: Structured leave submission and status approval tracking.

## Technology Stack

- **Frontend**: React (v19), React Router DOM (v7), Tailwind CSS (v4), Recharts, Lucide Icons, Framer Motion
- **Backend**: Node.js, Express (v5), Nodemailer
- **Database**: PostgreSQL

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL

### Installation

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd attendence
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Create a `.env` file in the `server` directory with the following configuration:
   ```env
   PORT=3001
   NODE_ENV=development
   DATABASE_URL=your_postgres_connection_string
   ADMIN_SIGNUP_EMAIL=bpkhanal.app@gmail.com
   SMTP_HOST=smtp.hostinger.com
   SMTP_PORT=465
   SMTP_USER=v-code@appnep.com
   SMTP_PASS=your_smtp_password
   ```

### Running the Application

To run both the frontend dev server and Express backend server concurrently:

```bash
npm run dev:all
```

- Frontend: [http://localhost:3002](http://localhost:3002)
- Backend API: [http://localhost:3001](http://localhost:3001)

## License

ISC License.
# Desktop-Attendance
