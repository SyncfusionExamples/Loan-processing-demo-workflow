import { useState } from "react";
import "./index.css";
import "./Authentication.css";

// Route per role (edit paths if your app uses different routes)
const roleRoutes = {
  'Loan Requestor': '/loan-requestor',
  'loan-officer': '/loan-officer',
  'manager': '/manager',
  'site-engineer': '/site-engineer'
};

// Dashboard display titles (used after login on dashboards/headers)
// NOTE: Login shows plain role names (Loan Requestor, Loan Officer, Manager, Site Officer)
// but dashboards should read this displayTitle for professional wording.
const roleTitles = {
  'Loan Requestor': 'Loan Requestor',
  'loan-officer': 'Loan Officer',
  'manager': 'Branch Manager',
  'site-engineer': 'Site Officer'
};

function Authentication({ onLogin }) {
  const [role, setRole] = useState('Loan Requestor');

  const completeLogin = () => {
    const displayTitle = roleTitles[role] || 'User';
    const user = { username: `${role}-guest`, email: null, role, displayTitle };
    localStorage.setItem('user', JSON.stringify(user));
    try { onLogin?.(user); } catch (_) {}
  };

  return (
    <div className="auth-container">
      <h2 className="auth-title">Login</h2>

      {/* Login dropdown labels (plain) */}
      <label className="auth-label" htmlFor="role">Role:</label>
      <select
        id="role"
        name="role"
        className="auth-input"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        required
      >
        <option value="Loan Requestor">Loan Requestor</option>
        <option value="loan-officer">Loan Officer</option>
        <option value="manager">Manager</option>
        <option value="site-engineer">Site Officer</option>
      </select>

      <button className="auth-button primary" style={{ marginTop: 20 }} onClick={completeLogin}>
        Login
      </button>
    </div>
  );
}

export default Authentication;
