import React, { useState, useEffect, useRef, } from 'react';
import Authentication from './Authentication';
import './DashBoard.css'
import PdfViewer from './PdfViewer.jsx'
import { LoanStatus } from './constants/loanStatus.js'

const DashBoard = () => {
  const [loggedInUser, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [nextId, setNextId] = useState(() => {
    try {
      const v = sessionStorage.getItem('nextId');
      return v ? Number(v) : 1001;
    } catch (e) {
      return 1001;
    }
  });
  const [viewerMode, setViewerMode] = useState(false);
  const [loanStatus, setLoanStatus] = useState("");
  const [pdfFileName, setPdfFileName] = useState("Loan_Application_Form");
  const [sanctionMode, setSanctionMode] = useState(false)
  const [actionBar, setActionBar] = useState(true);
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const [attachmentCounts, setAttachmentCounts] = useState({});

  //File Path of respective file
  const file = `wwwroot/pdfs/${pdfFileName}.pdf`
  const openViewerForNew = () => {
    setPdfFileName("Loan_Application_Form");
    setViewerMode(true);
    setLoanStatus("");
    setSelectedLoanId(String(nextId));
  };

  //Get the ID from the session storage
  useEffect(() => {
    try {
      sessionStorage.setItem('nextId', String(nextId));
    } catch (e) { /* ignore */ }
  }, [nextId]);

  const prevNextId = useRef(nextId);

  //Update the Row When the Loan application added
  useEffect(() => {
    if (prevNextId.current !== nextId) {
      const createdId = String(prevNextId.current);

      // prepare normalized display name (remove .pdf if present)
      const rawName = (pdfFileName || `Loan_Application_Form_${createdId}`) || '';
      const displayName = rawName.replace(/\.pdf$/i, '');

      setRows(prev => {
        // avoid duplicates by id or filename
        const existsById = prev.some(r => String(r.id) === String(createdId));
        const existsByFile = prev.some(r => (r.fileName || '').toString().trim().toLowerCase() === displayName.toString().trim().toLowerCase());
        if (existsById || existsByFile) return prev;
        return [
          ...prev,
          {
            id: createdId,
            customer: displayName,
            status: loanStatus || 'SUBMITTED',
            viewText: 'View',
            fileName: rawName
          }
        ];
      });
    }
    prevNextId.current = nextId;
  }, [nextId, pdfFileName, loanStatus]);

  //Retrive Files from server based on Roles
  useEffect(() => {
    const loadSavedFiles = async () => {
      try {

        const user = loggedInUser ?? JSON.parse(localStorage.getItem("user") || "null");
        const username = user?.username || user?.name || user?.id || user?.userId;
        if (!username) return;

        // treat these exact usernames as privileged
        const privilegedNames = ['Manager', 'Loan Officer']; // add variations you need
        const isPrivileged = privilegedNames.includes(username);

        // build URL: privileged -> request ALL, else request only this user
        const base = process.env.REACT_APP_API_URL || 'http://localhost:5063';
        const url = isPrivileged
          ? `${base}/api/Authentication/GetUserFiles?username=ALL`
          : `${base}/api/Authentication/GetUserFiles?username=${encodeURIComponent(username)}`;

        const resp = await fetch(url); // include if your API uses cookies
        if (!resp.ok) {
          const body = await resp.text().catch(() => '<no body>');
          console.warn('GetUserFiles failed', resp.status, body);
          return;
        }
        const list = await resp.json();
        if (!Array.isArray(list)) return;
        list.reverse();
        const mapped = list.map(item => {
          const docId = item.documentId || item.documentid || item.DocumentId || '';
          const rawName = (item.fileName || item.file || item.FileName || item.customerName || item.customer || '').toString().trim();
          // remove .pdf extension if present
          const noExt = rawName.replace(/\.pdf$/i, '');
          // remove any existing trailing _<docId> so we don't duplicate
          const baseName = docId ? noExt.replace(new RegExp(`_${docId}$`, 'i'), '') : noExt;
          // final display: baseName + _docId (only if docId present)
          let displayName = baseName;
          if (!baseName.toLowerCase().includes("sanction")) {
            displayName = docId ? `${baseName}_${docId}` : baseName;
          }
          return {
            id: String(docId),
            customer: displayName,
            status: item.status || 'SUBMITTED',
            viewText: 'View',
            fileName: rawName
          };
        });
        setRows(mapped);
      } catch (e) {
        console.warn("loadSavedFiles error", e);
      }
    };
    loadSavedFiles();
    const handler = () => loadSavedFiles();
    window.addEventListener('userFilesChanged', handler);
    return () => window.removeEventListener('userFilesChanged', handler);
  }, [loggedInUser]);

  // Keep the table rows in sync when the currently-open file or its status changes
  useEffect(() => {
    if (!pdfFileName) return;
    setRows((prev) =>
      prev.map((r) => (r.customer === pdfFileName ? { ...r, status: loanStatus } : r))
    );
  }, [pdfFileName, loanStatus]);

  //Change the actionBar state when PDF Viewer open and close
  useEffect(() => {
    if (!viewerMode) setActionBar(true);
  }, [viewerMode]);

  // Ensure the viewer shows the file associated with the clicked row
  const onView = (row) => {
    if (row && row.customer) setPdfFileName(row.customer)
    if (row && row.status) setLoanStatus(row.status)
    setViewerMode(true);
    setSelectedLoanId(String(row?.id ?? ''));
    if (loggedInUser?.username === 'Loan Officer' && row?.status === LoanStatus.SUBMITTED) {
      setLoanStatus(LoanStatus.UNDER_REVIEW);
    }
    const clickedName = (row && row.customer) ? String(row.customer) : '';
    const isSanction = clickedName.toLowerCase().includes('sanction');
    setSanctionMode(Boolean(isSanction));
    changeActionBar(row);
    setActionBar(Boolean(changeActionBar(row)));
  };

  // Decide action bar visibility based on role, status and whether this is a sanction document;
  function changeActionBar(row) {
    const role = loggedInUser?.username;
    const status = row?.status;
    const name = (row && row.customer) ? String(row.customer) : '';
    const sanction = name.toLowerCase().includes('sanction');
    if (status === LoanStatus.REJECTED) {
      return false;
    }
    if (role === 'Manager') {
      // Manager only sees the action bar for Pending Approval
      return status === LoanStatus.PENDING_APPROVAL;
    }
    if (role === 'Loan Officer') {
      // Loan Officer should not see the action bar when viewing a sanction letter
      return !sanction;
    }
    // Customers: hide the bar for submitted/rejected/pending/approved statuses
    return !(status === LoanStatus.SUBMITTED || status === LoanStatus.PENDING_APPROVAL || status === LoanStatus.APPROVED);
  }

  //Update the JSON file on the server based on the Status
  const didMount = useRef(false);
  // Listen for per-loan attachment count changes from other tabs/windows
  useEffect(() => {
    const onStorage = (e) => {
      if (e && e.key && e.key.startsWith('attachmentsCount_')) {
        setAttachmentsVersion(v => v + 1);
      }
    };
    const onCustom = (e) => {
      setAttachmentsVersion(v => v + 1);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('attachmentsCountUpdated', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('attachmentsCountUpdated', onCustom);
    };
  }, []);

  // Trigger a refresh of counts when returning from viewer in same tab
  useEffect(() => {
    setAttachmentsVersion(v => v + 1);
  }, [viewerMode]);

  // Recompute attachment counts map whenever rows or attachmentsVersion change
  useEffect(() => {
    const map = {};
    for (const r of rows) {
      const key = `attachmentsCount_${r.id}`;
      const v = sessionStorage.getItem(key) || localStorage.getItem(key);
      map[r.id] = v ? parseInt(v, 10) || 0 : 0;
    }
    setAttachmentCounts(map);
  }, [attachmentsVersion, rows]);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }

    (async () => {
      try {
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        const username = user?.username || '';

        const base = process.env.REACT_APP_API_URL || 'http://localhost:5063';
        const documentId = (pdfFileName && (pdfFileName.match(/(\d+)(?=\.pdf$|$)/) || [])[0]) || null;

        const payload = { DocumentId: documentId, FileName: pdfFileName, Status: loanStatus };

        const resp = await fetch(`${base}/api/Authentication/UpdateFileStatus`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const text = await resp.text().catch(() => '<no body>');
        if (!resp.ok) return;

        window.dispatchEvent(new CustomEvent('userFilesChanged', { detail: { documentId, fileName: pdfFileName, username } }));
      } catch (e) {
        console.warn('UpdateFileStatus error', e);
      }
    })();
  }, [loanStatus]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));
    } catch {/* ignore */ }
  }, []);

  //Remove the Item when Looged Out
  const logout = () => {
    localStorage.removeItem("user");
    setUser(null);
  };
  if (!loggedInUser) {
    return <Authentication onLogin={setUser} />;
  }
  //Render the PDF Viewer When ViewMode is true
  if (viewerMode) {
    return (
      <div>
        <div className="pdf-header">
          <div className="pdf-title">{pdfFileName.replace(/_/g, ' ').replace(/\.pdf$/i, '')}</div>
          <button className="pdf-close" onClick={() => { setViewerMode(false); setLoanStatus(loanStatus) }} aria-label="Close viewer">✕</button>
        </div>
        <PdfViewer file={file} role={loggedInUser.username} loanStatus={loanStatus} count={nextId} setFileCount={setNextId} setPdfFileName={setPdfFileName} setViewerMode={setViewerMode} setLoanStatus={setLoanStatus} pdfFileName={pdfFileName} sanctionMode={sanctionMode} setSanctionMode={setSanctionMode} actionBar={actionBar} loanId={selectedLoanId} />
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      {/* Header bar (blue) */}
      <div className='dashborad_header'>
        <div className='dashboard'>
          <div>{loggedInUser ? `Hi ${loggedInUser.username}` : 'Dashboard'}</div>
          <div>
            <button type="button" onClick={logout} className="addBtn">
              Logout
            </button>
          </div>
        </div>

        {/* RIGHT: Logout */}

      </div>
      <div className="loandetails-container">
        <div className='loandetails-header'>
          <div >Loan Dashboard</div>
          {
            loggedInUser && (loggedInUser.username !== "Manager" && loggedInUser.username !== "Loan Officer") && (
              <button
                type="button"
                onClick={() => openViewerForNew()}
                aria-label="Create row"
                title="Create row"
                className="addBtn"
              >
                Create +
              </button>
            )}
        </div>

        {/* Table in its own frame, visually separate from header/details */}
        <div className="frame">
          <div className="tableWrap">

            <style>{`
      [data-hover="rows"] tbody tr:hover td {
        background: #f3f4f6;
        
      }
    `}</style>
            <table className="loandetails-table" data-hover="rows">
              <thead>
                <tr>
                  <th className="th idCol">Loan ID</th>
                  <th className="th">Application Name</th>
                  <th className="th statusCol">Status</th>
                  <th className="th lastCol">Action</th>
                  <th className="th lastCol">Attachments</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="emptyCell">
                      No loan applications created. Click "Create +" to submit a new application.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr key={`${r.id}-${idx}`}>
                      <td className="td idCol">{r.id}</td>
                      <td className="td">{r.customer}</td>
                      <td className="td statusCol">{r.status}</td>
                      <td className="td lastCol">
                        <button
                          type="button"
                          onClick={() => onView(r)}
                          className="viewBtn"
                        >
                          {r.viewText}
                        </button>
                      </td>
                      <td className="td idCol">
                        <span className="attachCount">({attachmentCounts[r.id] || 0})</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// styles moved to DashBoard.css — removed inline `styles` object.
export default DashBoard;
