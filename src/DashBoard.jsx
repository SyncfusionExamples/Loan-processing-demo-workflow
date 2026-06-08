
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  // Persisted comments helper (keeps latest comment per document across refreshes)
  const PERSISTED_COMMENTS_KEY = 'loanComments_v1'
  const getPersistedComments = () => {
    try {
      return JSON.parse(localStorage.getItem(PERSISTED_COMMENTS_KEY)
        ?? '{}') ?? {}
    } catch (e) { return {} }
  }
  const persistComment = (documentId, fileName, commentText) => {
    try {
      const id = documentId ? String(documentId) : ((fileName && (fileName.match(/(\d+)(?=\.pdf$)/) ?? [] )[0]) ?? null)
      if (!id) return
      const all = getPersistedComments()
      all[String(id)] = { comment: commentText, fileName: fileName }
      localStorage.setItem(PERSISTED_COMMENTS_KEY, JSON.stringify(all))
    } catch (e) { /* ignore */ }
  }
  // Professional titles for dashboard header (supports both role and legacy username)
  const roleTitles = {
    customer: 'Loan Requestor',
    'loan-officer': 'Loan Officer',
    manager: 'Branch Manager',
    'site-engineer': 'Site Office',
    // Backward-compatible keys
    'Manager': 'Branch Manager',
    'Loan Officer': 'Loan Officer',
    'Customer': 'Loan Requestor',
    'Site Engineer': 'Site Office',
    'Site Office': 'Site Office'
  };
  // Privileged: Manager, Loan Officer, Site Office (covers username OR role; case-insensitive; with hyphen variants)
  const isPrivileged = (user) => {
    const uname = (user?.username ?? user?.name ?? '').trim().toLowerCase();
    const urole = (user?.role ?? '').trim().toLowerCase();
    const privileged = new Set([
      'manager',
      'loan officer', 'loan-officer',
      'site office', 'site-office', 'site engineer', 'site-engineer'
    ]);
    return privileged.has(uname) || privileged.has(urole);
  };
  // File Path of respective file
  const file = `wwwroot/pdfs/${pdfFileName}.pdf`
  const openViewerForNew = () => {
    setPdfFileName("Loan_Application_Form");
    setViewerMode(true);
    setLoanStatus("");
    setSelectedLoanId(null);
  };
  // Normalize user role into canonical labels used across the app
  const canonicalRole = useMemo(() => {
    try {
      const r = (loggedInUser?.role ?? loggedInUser?.username ?? '').toString().toLowerCase();
      if (!r) return '';
      if (r.includes('manager')) return 'Manager';
      if (r.includes('loan') && r.includes('officer')) return 'Loan Officer';
      // treat Site Officer/Engineer variants as Site Office
      if (r.includes('site') && (r.includes('engineer') || r.includes('office'))) return 'Site Office';
      return 'Customer';
    } catch (e) { return '' }
  }, [loggedInUser]);
  //Get the ID from the session storage
  useEffect(() => {
    try { sessionStorage.setItem('nextId', String(nextId)); } catch (e) { /* ignore */ }
  }, [nextId]);
  const prevNextId = useRef(nextId);
  //Update the Row When the Loan application added
  useEffect(() => {
    const norm = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\.pdf$/, '');
    if (prevNextId.current !== nextId) {
      const createdId = String(prevNextId.current);
      const rawName = (pdfFileName ?? `Loan_Application_Form_${createdId}`) ?? '';
      const displayName = rawName.replace(/\.pdf$/i, '');
      setRows(prev => {
        const existsById = prev.some(r => String(r.id) === String(createdId));
        const existsByFile = prev.some(r => (norm(r.fileName) === norm(displayName))
          || (norm(r.customer) === norm(displayName)));
        if (existsById || existsByFile) return prev;
        return [
          ...prev,
          { id: createdId, customer: displayName, status: LoanStatus.NEW, comments: 'A new loan application has been created.', viewText: 'View', fileName: rawName }
        ];
      });
      try { persistComment(createdId, rawName, 'A new loan application has been created.') } catch (e) { }
    }
    prevNextId.current = nextId;
  }, [nextId, pdfFileName, loanStatus]);
  //Retrive Files from server based on Roles (cache-busted + event-driven refresh)
  useEffect(() => {
    const loadSavedFiles = async () => {
      try {
        const user = loggedInUser ?? JSON.parse(localStorage.getItem("user") ?? "null");
        const username = user?.username ?? user?.name ?? user?.id ?? user?.userId;
        if (!username) return;
        const base = process.env.REACT_APP_API_URL ?? 'http://localhost:5063';
        const ts = Date.now(); // cache-buster
        const url = isPrivileged(user)
          ? `${base}/api/Authentication/GetUserFiles?username=ALL&_ts=${ts}`
          : `${base}/api/Authentication/GetUserFiles?username=${encodeURIComponent(username)}&_ts=${ts}`;
        const resp = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        if (!resp.ok) { console.warn('GetUserFiles failed', resp.status); return; }
        const list = await resp.json();
        if (!Array.isArray(list)) return;
        list.reverse();
        const mapped = list.map(item => {
          const docId = item.documentId ?? item.documentid ?? item.DocumentId ?? '';
          const rawName = (item.fileName ?? item.file ?? item.FileName ?? item.customerName ?? item.customer ?? '').toString().trim();
          const noExt = rawName.replace(/\.pdf$/i, '');
          const baseName = docId ? noExt.replace(new RegExp(`_${docId}$`, 'i'), '') : noExt;
          let displayName = baseName;
          if (!baseName.toLowerCase().includes('sanction')) {
            displayName = docId ? `${baseName}_${docId}` : baseName;
          }
          return { id: String(docId), customer: displayName, status: item.status ?? 'NEW', comments: item.comments ?? '', viewText: 'View', fileName: rawName };
        });
        setRows(prevRows => {
          const prev = prevRows ?? [];
          const persisted = getPersistedComments();
          return mapped.map(m => {
            const existing = prev.find(p => String(p.id) === String(m.id));
            const pid = String(m.id ?? '');
            const persistedComment = (persisted && persisted[pid] && persisted[pid].comment) ? persisted[pid].comment : null
            return { ...m, comments: (persistedComment ?? m.comments ?? (existing && existing.comments) ?? '') };
          });
        });
      } catch (e) { console.warn("loadSavedFiles error", e); }
    };
    loadSavedFiles();
    const handler = () => loadSavedFiles();
    window.addEventListener('userFilesChanged', handler);
    // Refresh when tab regains focus (covers cross-role switch)
    const visHandler = () => { if (!document.hidden) handler(); };
    document.addEventListener('visibilitychange', visHandler);
    // Listen for explicit comment additions from viewer (e.g., new application comment)
    const commentHandler = (e) => {
      try {
        const d = e && e.detail ? e.detail : null;
        if (!d || !d.comments) return;
        const documentId = d.documentId ? String(d.documentId) : null;
        const fileName = (d.fileName ?? '').toString().trim();
        const commentText = d.comments ?? '';
        const norm = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\.pdf$/, '');
        setRows(prev => {
          const next = (prev ?? []).map(r => {
            const rid = String(r.id ?? '');
            const rFile = (r.fileName ?? '').toString().trim();
            const rCust = (r.customer ?? '').toString().trim();
            if ((documentId && rid === documentId)
              || (fileName && (norm(rFile) === norm(fileName)
              || norm(rCust) === norm(fileName)))) {
              return { ...r, comments: commentText };
            }
            return r;
          });
          // Robust match: compare by id OR normalized file name (ignoring .pdf)
          const matched = next.some(r => ((documentId && String(r.id) === documentId)
            || (fileName && (norm(r.fileName) === norm(fileName)
            || norm(r.customer) === norm(fileName)))))
          if (!matched) {
            const newId = documentId ?? String((fileName && (fileName.match(/(\d+)(?=\.pdf$)/) ?? [] )[0]) ?? Date.now());
            const rawName = fileName ?? `Loan_Application_Form_${newId}`;
            const displayName = rawName.replace(/\.pdf$/i, '');
            const added = { id: String(newId), customer: displayName, status: LoanStatus.NEW, comments: commentText, viewText: 'View', fileName: rawName }
            try { persistComment(newId, rawName, commentText) } catch (e) { }
            return [...next, added];
          }
          return next;
        });
        try { persistComment(documentId, fileName, commentText) } catch (e) { }
      } catch (err) { /* silent */ }
    };
    window.addEventListener('loanCommentAdded', commentHandler);
    return () => {
      window.removeEventListener('userFilesChanged', handler);
      window.removeEventListener('loanCommentAdded', commentHandler);
      document.removeEventListener('visibilitychange', visHandler);
    };
  }, [loggedInUser]);
  // Sync row statuses (ID-based rather than by customer name)
  useEffect(() => {
    if (!pdfFileName) return;
    const m = (pdfFileName.match(/(\d+)(?=\.pdf$)/) ?? pdfFileName.match(/\_(\d+)$/) ?? []);
    const idFromName = m[1] ? String(m[1]) : null;
    setRows(prev => prev.map(r => (idFromName && String(r.id) === idFromName ? { ...r, status: loanStatus } : r)));
  }, [pdfFileName, loanStatus]);
  useEffect(() => { if (!viewerMode) setActionBar(true); }, [viewerMode]);
  const onView = (row) => {
    if (row && row.customer) setPdfFileName(row.customer)
    if (row && row.status) setLoanStatus(row.status)
    setViewerMode(true);
    setSelectedLoanId(String(row?.id ?? ''));
    if (canonicalRole === 'Loan Officer' && row?.status === LoanStatus.NEW) {
      setLoanStatus(LoanStatus.UNDER_REVIEW);
    }
    const clickedName = (row && row.customer) ? String(row.customer) : '';
    const isSanction = clickedName.toLowerCase().includes('sanction');
    setSanctionMode(Boolean(isSanction));
    setActionBar(Boolean(changeActionBar(row)));
  };
  function changeActionBar(row) {
    const role = canonicalRole ?? (loggedInUser?.username);
    const status = row?.status;
    const name = (row && row.customer) ? String(row.customer) : '';
    const sanction = name.toLowerCase().includes('sanction');
    if (status === LoanStatus.REJECTED) return false;
    if (role === 'Manager') return status === LoanStatus.PENDING_APPROVAL;
    if (role === 'Loan Officer') return !sanction;
    return !(status === LoanStatus.NEW
      || status === LoanStatus.PENDING_APPROVAL
      || status === LoanStatus.APPROVED);
  }
  useEffect(() => {
    const onStorage = (e) => { if (e && e.key && e.key.startsWith('attachmentsCount_')) setAttachmentsVersion(v => v + 1); };
    const onCustom = () => setAttachmentsVersion(v => v + 1);
    window.addEventListener('storage', onStorage);
    window.addEventListener('attachmentsCountUpdated', onCustom);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('attachmentsCountUpdated', onCustom); };
  }, []);
  useEffect(() => { setAttachmentsVersion(v => v + 1); }, [viewerMode]);
  // Server-based attachment counts (left as-is from earlier improvement)
  useEffect(() => {
    if (!rows || rows.length === 0) { setAttachmentCounts({}); return; }
    const base = process.env.REACT_APP_API_URL ?? 'http://localhost:5063';
    let alive = true;
    (async () => {
      const entries = await Promise.all(rows.map(async (r) => {
        const raw = (r.fileName ?? r.customer ?? '').trim();
        if (!raw) return [r.id, 0];
        const name = /\.pdf$/i.test(raw) ? raw : `${raw}.pdf`;
        try {
          const resp = await fetch(`${base}/api/Authentication/GetPdfAttachments/${encodeURIComponent(name)}`);
          if (!resp.ok) return [r.id, 0];
          const list = await resp.json();
          return [r.id, Array.isArray(list) ? list.length : 0];
        } catch { return [r.id, 0]; }
      }));
      if (!alive) return;
      const map = {}; entries.forEach(([id, c]) => map[id] = c); setAttachmentCounts(map);
    })();
    return () => { alive = false; };
  }, [rows, attachmentsVersion]);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    (async () => {
      try {
        const user = JSON.parse(localStorage.getItem('user') ?? 'null');
        const username = user?.username ?? '';
        const base = process.env.REACT_APP_API_URL ?? 'http://localhost:5063';
        const documentId = (pdfFileName && ((pdfFileName.match(/(\d+)(?=\.pdf$)/) ?? [] )[0])) ?? null;
        const payload = { DocumentId: documentId, FileName: pdfFileName, Status: loanStatus };
        // const resp = await fetch(`${base}/api/Authentication/UpdateFileStatus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        // if (!resp.ok) return;
        window.dispatchEvent(new CustomEvent('userFilesChanged', { detail: { documentId, fileName: pdfFileName, username } }));
      } catch (e) { console.warn('UpdateFileStatus error', e); }
    })();
  }, [loanStatus]);
  useEffect(() => {
    try { const saved = localStorage.getItem("user"); if (saved) setUser(JSON.parse(saved)); } catch { }
  }, []);
  const logout = () => { localStorage.removeItem("user"); setUser(null); };
  if (!loggedInUser) { return <Authentication onLogin={setUser} />; }
  if (viewerMode) {
    return (
      <div>
        <div className="pdf-header">
          <div className="pdf-title">{pdfFileName.replace(/\_/g, ' ').replace(/\.pdf$/i, '')}</div>
          <button className="pdf-close" onClick={() => { setViewerMode(false); setLoanStatus(loanStatus) }} aria-label="Close viewer">✕</button>
        </div>
        <PdfViewer file={file} role={canonicalRole} loanStatus={loanStatus} count={nextId} setFileCount={setNextId} setPdfFileName={setPdfFileName} setViewerMode={setViewerMode} setLoanStatus={setLoanStatus} pdfFileName={pdfFileName} sanctionMode={sanctionMode} setSanctionMode={setSanctionMode} actionBar={actionBar} loanId={selectedLoanId} />
      </div>
    )
  }
  return (
    <div className="dashboard-page">
      <div className='dashborad_header'>
        <div className='dashboard'>
          <div>{loggedInUser ? (loggedInUser.displayTitle ?? roleTitles[loggedInUser.role] ?? roleTitles[loggedInUser.username] ?? 'Dashboard') : 'Dashboard'}</div>
          <div>
            <button type="button" onClick={logout} className="addBtn">Logout</button>
          </div>
        </div>
      </div>
      <div className="loandetails-container">
        <div className='loandetails-header'>
          <div>Loan Dashboard</div>
          {loggedInUser && (canonicalRole !== "Manager" && canonicalRole !== "Loan Officer" && canonicalRole !== 'Site Office') && (
            <button type="button" onClick={() => openViewerForNew()} aria-label="Create row" title="Create row" className="addBtn">Create +</button>
          )}
        </div>
        <div className="frame">
          <div className="tableWrap">
            <style>{`[data-hover="rows"] tbody tr:hover td { background: #f3f4f6; }`}</style>
            <table className="loandetails-table" data-hover="rows">
              <thead>
                <tr>
                  <th className="th idCol">Loan ID</th>
                  <th className="th">Application Name</th>
                  <th className="th statusCol">Status</th>
                  <th className="th lastCol">Action</th>
                  <th className="th lastCol">Comments</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="emptyCell">No loan applications created. Click "Create +" to submit a new application.</td></tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr key={`${r.id}-${idx}`}>
                      <td className="td idCol">{r.id}</td>
                      <td className="td">{`Loan_Requestor_${r.id}`}</td>
                      <td className="td statusCol">{r.status}</td>
                      <td className="td lastCol">
                        <button type="button" onClick={() => onView(r)} className="viewBtn">{r.viewText}</button>
                      </td>
                      <td className="td commentsCol">{r.comments ?? ''}</td>
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
export default DashBoard;
