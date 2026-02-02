import React, { useState, useEffect, useRef } from 'react';
import {
  PdfViewerComponent, Toolbar, Magnification, Navigation, LinkAnnotation, BookmarkView,
  ThumbnailView, Print, TextSelection, TextSearch, FormFields, FormDesigner, Inject
} from '@syncfusion/ej2-react-pdfviewer';
import Authentication from './Authentication';
import './PdfViewer.css';

const PdfViewer = () => {
  const [loggedInUser, setUser] = useState(null);
  const pdfViewerRef = useRef(null);

  const [rows, setRows] = useState([]);
  const [nextId, setNextId] = useState(1001);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: String(nextId),
        customer: "Nehru",
        status: "New",
        viewText: "View",
      },
    ]);
    setNextId((prev) => prev + 1);
  };

  const onView = (row) => {
    alert(`Opening application ${row.id} for ${row.customer}`);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("user");
      if (saved) setUser(JSON.parse(saved));
    } catch {/* ignore */}
  }, []);

  const logout = () => {
    localStorage.removeItem("user");
    setUser(null);
  };

  

  if (!loggedInUser) {
    return <Authentication onLogin={setUser} />;
  }

  return (
     <div style={styles.page}>
      {/* Header bar (blue) */}
      <div style={styles.headerBar}>
        <div style={styles.headerTitle}>Loan Details</div>
        <button
          type="button"
          onClick={addRow}
          aria-label="Create row"
          title="Create row"
          style={styles.addBtn}
        >
          {/* 1) Button label changed */}
          Create +
        </button>
      </div>

    

      {/* Table in its own frame, visually separate from header/details */}
      <div style={styles.frame}>
        <div style={styles.tableWrap}>

<style>{`
      [data-hover="rows"] tbody tr:hover td {
        background: #f3f4f6;
        
      }
    `}</style>


          <table style={styles.table} data-hover="rows">
            <thead>
              <tr>
                <th style={{ ...styles.th, ...styles.idCol }}>Loan ID</th>
                <th style={styles.th}>Customer Name</th>
                <th style={{ ...styles.th, ...styles.idCol }}>Status</th>
                <th style={{ ...styles.th, ...styles.lastCol }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={styles.emptyCell}>
                    No rows yet. Click the “Create +” button to add.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.id}-${idx}`}>
                    <td style={{ ...styles.td, ...styles.idCol }}>{r.id}</td>
                    <td style={styles.td}>{r.customer}</td>
                    <td style={{ ...styles.td, ...styles.idCol }}>{r.status}</td>
                    <td style={{ ...styles.td, ...styles.lastCol }}>
                      <button
                        type="button"
                        onClick={() => onView(r)}
                        style={styles.viewBtn}
                      >
                        {r.viewText}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/** Styles */
const styles = {
  page: {
    minHeight: "100vh",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100vw",
    margin: 0,
    padding: "16px 16px 32px",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
    display: "block",
  },

  /* Blue header bar (no border) */
  headerBar: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    padding: "12px 12px",
    background: "#1e3a8a",
    color: "#fff",
    borderRadius: 6,
    position: "sticky",
    top: 0,
    zIndex: 3,
    /* add a small gap below the header so nothing touches it */
    marginBottom: 10,
  },
  headerTitle: {
    textAlign: "left",
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: 0.2,
  },
  addBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    padding: "0 12px",
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1,
    border: "2px solid #0b1f5e",
    borderRadius: 8,
    background: "#fff",
    color: "#0b1f5e",
    cursor: "pointer",
  },

  /* NEW: separate “custom details” row under the header */
  detailsRow: {
    marginBottom: 12,                          // visual separation above table
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
    gap: 12,
    alignItems: "center",
    padding: "10px 12px",
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
  },

  /* Table frame (separate block) */
  frame: {
    boxSizing: "border-box",
    border: "1px solid #d1d5db",
    width: "100%",
    borderRadius: 1,
    background: "#fff",
  },
  tableWrap: {
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    overflowY: "visible",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    borderSpacing: 0,
    tableLayout: "fixed",
  },
  th: {
    borderBottom: "1px solid #e5e7eb",
    //borderRight: "2px solid #000",
    textAlign: "left",
    color: "#111827",
    padding: "10px",
    fontWeight: 600,
    wordWrap: "break-word",
  },
  td: {
    borderTop: "1px solid #e5e7eb",
    //borderRight: "2px solid #000",
    padding: "10px",
    wordWrap: "break-word",
  },

  /* keep ID column fixed width if you want */
  idCol: {
    width: 120,
    minWidth: 120,
    maxWidth: 120,
    textAlign: "center",
    whiteSpace: "nowrap",
  },

  /* last column: no right border to avoid double line on frame edge */
  lastCol: {
    width: 120,
    minWidth: 120,
    maxWidth: 120,
    textAlign: "center",
    whiteSpace: "nowrap",
    borderRight: "none",
  },

  emptyCell: {
    padding: "16px",
    textAlign: "center",
    color: "#666",
  },

  viewBtn: {
    padding: "6px 10px",
    border: "1px solid #000",
    background: "#fff",
    cursor: "pointer",
    borderRadius: 4,
  },
};
export default PdfViewer;
