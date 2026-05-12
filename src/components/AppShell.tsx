import { NavLink, Outlet } from 'react-router-dom';
import { canAccessRoute } from '../auth/permissions';
import { useMockAuth } from '../auth/useMockAuth';
import { useManualEditRequests } from '../services/mockManualEditService';
import { Icon } from './Icon';

const navItems = [
  { to: '/stationary', label: 'My Attendance', icon: 'clock' },
  { to: '/roving', label: 'My Attendance', icon: 'route' },
  { to: '/requests', label: 'My Requests', icon: 'flag' },
  { to: '/manager', label: 'My Team', icon: 'users' },
  { to: '/reports', label: 'My Reports', icon: 'download' },
  { to: '/admin', label: 'Admin', icon: 'settings' }
];

export function AppShell() {
  const { user, users, setUserId } = useMockAuth();
  const manualEditRequests = useManualEditRequests();
  const visibleNavItems = navItems.filter((item) => canAccessRoute(user, item.to));
  const pendingRequestCount = manualEditRequests.filter((request) => {
    return request.user_id === user.id && request.status === 'pending';
  }).length;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <Icon name="logo" />
          <span>Muster</span>
        </div>
        <label className="role-switcher">
          Demo role
          <select value={user.id} onChange={(event) => setUserId(event.target.value)}>
            {users.map((item) => (
              <option value={item.id} key={item.id}>
                {item.role} · {item.attendanceModel}
              </option>
            ))}
          </select>
        </label>
        <nav className="nav-list">
          {visibleNavItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-item">
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.to === '/requests' && pendingRequestCount > 0 ? (
                <span className="nav-badge">{pendingRequestCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-view">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {visibleNavItems.slice(0, 4).map((item) => (
          <NavLink key={item.to} to={item.to} className="bottom-nav-item">
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.to === '/requests' && pendingRequestCount > 0 ? (
              <span className="nav-badge">{pendingRequestCount}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
