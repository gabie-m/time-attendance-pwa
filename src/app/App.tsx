import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { canAccessRoute, getDefaultRouteForUser } from '../auth/permissions';
import { useMockAuth } from '../auth/useMockAuth';
import { AppShell } from '../components/AppShell';
import { AttendanceDetailScreen } from '../screens/AttendanceDetailScreen';
import { AdminFlagReviewScreen } from '../screens/AdminFlagReviewScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ManagerFlagReviewScreen } from '../screens/ManagerFlagReviewScreen';
import { ManagerScreen } from '../screens/ManagerScreen';
import { MyRequestsScreen } from '../screens/MyRequestsScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { RovingScreen } from '../screens/RovingScreen';
import { StationaryScreen } from '../screens/StationaryScreen';

export function App() {
  const { user } = useMockAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={getDefaultRouteForUser(user)} replace />} />
        <Route path="/stationary" element={<ProtectedRoute path="/stationary"><StationaryScreen /></ProtectedRoute>} />
        <Route path="/roving" element={<ProtectedRoute path="/roving"><RovingScreen /></ProtectedRoute>} />
        <Route path="/requests" element={<ProtectedRoute path="/requests"><MyRequestsScreen /></ProtectedRoute>} />
        <Route path="/manager" element={<ProtectedRoute path="/manager"><ManagerScreen /></ProtectedRoute>} />
        <Route path="/manager/flags" element={<ProtectedRoute path="/manager/flags"><ManagerFlagReviewScreen /></ProtectedRoute>} />
        <Route path="/admin/flags" element={<ProtectedRoute path="/admin/flags"><AdminFlagReviewScreen /></ProtectedRoute>} />
        <Route path="/admin/reports" element={<ProtectedRoute path="/admin/reports"><ReportsScreen /></ProtectedRoute>} />
        <Route path="/admin/attendance/:employeeId" element={<ProtectedRoute path="/admin/attendance/detail"><AttendanceDetailScreen /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute path="/admin"><AdminScreen /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}

function ProtectedRoute({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useMockAuth();

  if (!canAccessRoute(user, path)) {
    return <Navigate to={getDefaultRouteForUser(user)} replace />;
  }

  return children;
}
