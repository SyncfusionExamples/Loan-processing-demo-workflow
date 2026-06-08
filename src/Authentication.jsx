import React, { useState } from "react";
import "./index.css";
import "./Authentication.css";
import loanIllustration from './loan-illustration.png';

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

// Mapping from role key (select value) to the process steps shown on the right
const roleProcesses = {
  'Loan Requestor': [
    'Create and submit a new loan application',
    'Upload required documents and attachments',
    'Respond to any information requests from loan officer',
    'Sign documents when requested'
  ],
  'loan-officer': [
    'Receive new loan application for review',
    'Validate documents and application data',
    'Request site verification or additional info',
    'Recommend approval or rejection'
  ],
  'site-engineer': [
    'Perform site inspection and verification',
    'Confirm completion to Loan Officer'
  ],
  'manager': [
    'Review manager-level approvals',
    'Finalize loan approval or close case',
  ]
};

function Authentication({ onLogin }) {
  const [role, setRole] = useState('Loan Requestor');

  const completeLogin = () => {
    const displayTitle = roleTitles[role] || 'User';
    const user = { username: `${role}-guest`, email: null, role, displayTitle };
    localStorage.setItem('user', JSON.stringify(user));
    try { onLogin?.(user); } catch (_) { }
  };

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="auth-left">
          <div className="auth-brand">
            <div className="logo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                <path d="M14 2v6h6" />
              </svg>
            </div>
            <div className="title">Loan Application</div>
          </div>
          <div>
            <div className="auth-heading">Welcome</div>
            <div className="auth-sub">Select your role to continue with the loan application process</div>
          </div>

          <div className="auth-form">
            <div className="field-row">
              <label className="auth-label" htmlFor="role">Role</label>
              <select id="role" name="role" className="auth-input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="Loan Requestor">Loan Requestor</option>
                <option value="loan-officer">Loan Officer</option>
                <option value="manager">Manager</option>
                <option value="site-engineer">Site Officer</option>
              </select>
            </div>

            <button className="auth-button primary" onClick={completeLogin}>Continue</button>

          </div>

          <div className="auth-flow" style={{ marginTop: 28, marginBottom: 6, color: '#6c757d', fontSize: 12, textAlign: 'center' }} aria-hidden="true">Login &gt; Create Application &gt; Upload Documents &gt; Loan Officer Review &gt; Site Verification &gt; Manager Approval &gt; Sign &amp; Complete</div>
        </div>

        <div className="auth-right">
          <div className="auth-illustration" aria-hidden="true">
            <img src={loanIllustration} alt="Loan illustration" onError={(e) => { e.target.style.display = 'none' }} />
          </div>

          <div className="demo-box" aria-label="Demo workflow steps">
            <div style={{ marginBottom: 10, fontWeight: 600 }}>{roleTitles[role] || role}</div>
            <ul className="demo-list">
              {(roleProcesses[role] || [
                'A new loan application has been created — awaiting Loan Officer review',
                'Loan application is under review by Loan Officer — awaiting next processing',
                'Loan application sent for site verification — awaiting Site Officer',
                'Site verification completed — awaiting Manager decision'
              ]).map((step, idx) => (

                <li key={idx} className="demo-step">
                  {step}
                </li>

              ))}

            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Authentication;
