import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import './PdfViewer.css'
import {
  PdfViewerComponent,
  Toolbar,
  Magnification,
  Navigation,
  LinkAnnotation,
  BookmarkView,
  ThumbnailView,
  Print,
  TextSelection,
  Annotation,
  TextSearch,
  Inject,
  FormFields,
  FormDesigner,
} from '@syncfusion/ej2-react-pdfviewer'
import { LoanStatus } from './constants/loanStatus.js'

class AttachmentViewerErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error, info) { console.error('Attachment viewer error caught by boundary', error, info) }
  render() {
    if (this.state.hasError) return (<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>Failed to load preview</div>)
    return this.props.children
  }
}

export default function PdfViewer({
  file, role, loanStatus, count,
  setPdfFileName, setViewerMode, setLoanStatus, setFileCount,
  pdfFileName, sanctionMode, setSanctionMode, actionBar, loanId
}) {
  const viewerRef = useRef(null)
  const fileInputRef = useRef(null)
  const modalViewerRef = useRef(null)
  const lastObjectUrlRef = useRef(null)
  const modalFetchDoneRef = useRef(false)
  const deletedAttachmentsRef = useRef(new Set())
  const alertedFieldsRef = useRef(new Set())
  const readOnlyAttemptsRef = useRef(0)
  const pendingSanctionValuesRef = useRef(null)
  const applySanctionAttemptsRef = useRef(0)
  // NEW: dedicated input for custom-stamp flow (adds without touching existing flows)
  const stampFileInputRef = useRef(null)

  if (typeof window !== 'undefined') {
    window.currentAction = window.currentAction || ''
  }

  const [showBtn, setShowBtn] = useState(true)
  const [sanctionValues, setSanctionValues] = useState(null)
  const [isAttachmentOpen, setIsAttachmentOpen] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [viewingFile, setViewingFile] = useState(null)
  const [modalSrc, setModalSrc] = useState(null)
  const [finishEnabled, setFinishEnabled] = useState(false)
  const [signRequestEnabled, setSignRequestEnabled] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalLoadError, setModalLoadError] = useState(false)
  const [isAttachmentViewing, setIsAttachmentViewing] = useState(false)
  const [modalInstanceKey, setModalInstanceKey] = useState(0)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, fileId: null })
  const contextMenuRef = useRef(null)
  const infoMenuRef = useRef(null)
  const approvalMenuRef = useRef(null)
  const infoBtnRef = useRef(null)
  const approvalBtnRef = useRef(null)

  // Loan Officer dropdown menus for Info Required / Approval choices
  const [showInfoMenu, setShowInfoMenu] = useState(false)
  const [showApprovalMenu, setShowApprovalMenu] = useState(false)


  const canSubmit = showBtn

  const API_BASE = useMemo(() => process.env.REACT_APP_API_URL || 'http://localhost:5063', [])

  // Build a prioritized list of candidate URLs for an attachment.
 const getAttachmentCandidates = useCallback((parentFilename, attachmentName) => {
  const list = [];
  try {
    const pf = (parentFilename || '').toString();
    const an = (attachmentName || '').toString();
    if (!an) return list;
    const enc = s => encodeURIComponent((s || '').toString());
    const ensurePdf = s => (s && s.toLowerCase().endsWith('.pdf')) ? s : `${s}.pdf`;
    if (pf) list.push(`${API_BASE}/api/Authentication/GetPdfAttachmentFile/${enc(ensurePdf(pf))}/${enc(ensurePdf(an))}`);
    if (pf) list.push(`${API_BASE}/api/Authentication/GetPdfAttachmentFile/${enc(pf)}/${enc(an)}`);
    // if (an) list.push(`${API_BASE}/api/Authentication/GetPdfAttachmentFile?fileName=${enc(an)}&parent=${enc(pf)}`);
  } catch (e) {}
  return Array.from(new Set(list));
}, [API_BASE]);

  // --- Helper: filter candidate URLs to keep same-origin as API_BASE (to avoid 404s from the wrong backend) ---
const getOrigin = (url) => { try { return new URL(url).origin } catch { return null } }

const filterCandidatesToApiBaseOrigin = (cands) => {
  try {
    const baseOrigin = getOrigin(API_BASE)
    if (!Array.isArray(cands) || !baseOrigin) return cands
    const filtered = cands.filter(u => {
      try { return getOrigin(u) === baseOrigin } catch { return true }
    })
    return (filtered && filtered.length)
      ? Array.from(new Set(filtered))
      : Array.from(new Set(cands))
  } catch { return cands }
}
// Returns true when an element is in the DOM and visible enough for layout
function isDomVisible(el) {
  if (!el) return false;
  // not attached?
  if (!document.body.contains(el)) return false;
  // hidden via display:none?
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  // width/height available?
  const rect = el.getBoundingClientRect?.();
  return !!rect && rect.width > 0 && rect.height > 0;
}

// Wait until a viewer element is attached & visible before calling viewer.load
async function waitUntilVisible(viewer, { timeout = 3000, interval = 50 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        // Normalize to underlying ej2/pdf viewer instance when possible
        const inst = (viewer && (viewer.ej2Instances || viewer.pdfViewer)) || viewer || null;
        // Syncfusion instance exposes `element`; fallback to container id
        const el = inst?.element || viewer?.element || document.getElementById('container');

        if (isDomVisible(el)) {
          // Optionally ensure the page container exists to avoid internal layout calls
          const hasPage = Boolean(el && (el.querySelector('.e-pv-page') || el.querySelector('.e-pv-page-container')));
          // Also accept instances that already report pageCount > 0
          const pageCount = (inst && (inst.pageCount || inst.pdfViewer && inst.pdfViewer.pageCount)) || 0;
          if (hasPage || pageCount > 0) return resolve(true);
          // If visible but no page yet, still resolve (some viewers create pages on load)
          return resolve(true);
        }
      } catch (err) {
        // ignore and retry
      }
      if (Date.now() - start > timeout) return reject(new Error('viewer not visible'));
      setTimeout(tick, interval);
    };
    tick();
  });
}

// Safe load wrapper to prevent getBoundingClientRect crashes
async function safeViewerLoad(viewer, src) {
  if (!viewer || !src) return;
  // Normalize to underlying ej2/pdf viewer instance when possible
  const inst = (viewer.ej2Instances || viewer.pdfViewer) || viewer;
  // Give React a frame to mount the node
  await new Promise(r => requestAnimationFrame(r));
  await waitUntilVisible(inst).catch(() => {/* best effort; continue */});
  // Now load using the underlying instance
  try {
    if (inst && typeof inst.load === 'function') {
      inst.load(src, null);
    } else if (inst && typeof inst.open === 'function') {
      inst.open(src);
    } else if (viewer && typeof viewer.load === 'function') {
      // fallback to whatever was provided
      viewer.load(src, null);
    }
  } catch (e) {
    console.warn('safeViewerLoad: load/open threw', e);
  }
  // Ask Syncfusion to re-measure after load
  try { if (inst && typeof inst.resize === 'function') inst.resize(); else if (viewer && typeof viewer.resize === 'function') viewer.resize(); } catch {}
  // Defensive: patch common internal methods to prevent uncaught errors from library
  try {
    const target = inst || viewer
    const base = target.pdfViewerBase || target.base || target
    if (base && !base.__patchedForApp) {
      base.__patchedForApp = true
      const wrap = (obj, name) => {
        try {
          if (!obj || typeof obj[name] !== 'function') return
          const orig = obj[name]
          obj[name] = function(...args) {
            try { return orig.apply(this, args) } catch (e) { console.warn(`[PdfViewer patch] suppressed error in ${name}:`, e); }
          }
        } catch (e) {}
      }
      wrap(base, 'updateLeftPosition')
      wrap(base, 'renderPageContainer')
      wrap(base, 'initPageDiv')
      wrap(base, 'pageRender')
      wrap(base, 'requestSuccessPdfium')
    }
  } catch (e) { /* swallow */ }
}



  // Attempt to fetch an attachment from multiple candidate URLs and return a blob URL.
  const fetchAttachmentBlobWithCandidates = useCallback(async (candidates) => {
    if (!candidates || !candidates.length) throw new Error('No candidate URLs')
    for (const url of candidates) {
      try {
        // use no-cache to mirror existing behavior
        const resp = await fetch(url, { cache: 'no-cache' })
        if (!resp.ok) { continue }
        const blob = await resp.blob()
        if (!blob) continue
        // revoke previous object URL if present
        if (lastObjectUrlRef.current) {
          try { URL.revokeObjectURL(lastObjectUrlRef.current) } catch (e) {}
          lastObjectUrlRef.current = null
        }
        const blobUrl = URL.createObjectURL(blob)
        lastObjectUrlRef.current = blobUrl
        return { blobUrl, url, blob }
      } catch (err) {
        // console.warn('fetch candidate failed', url, err)
        continue
      }
    }
    throw new Error('All candidates failed')
  }, [])

  // detect stored user role (fallback) — some logins supply canonical `role` prop, others rely on localStorage
  const storedUserRole = useMemo(() => {
    try { const u = JSON.parse(localStorage.getItem('user') || 'null'); return (u?.role || u?.roles || u?.userRole || '').toString().toLowerCase() } catch { return '' }
  }, [])

  useEffect(() => {
    try { console.debug && console.log('[PdfViewer] mount role prop:', role, 'storedUserRole:', storedUserRole) } catch (e) {}
  }, [role, storedUserRole])

  const isSiteOfficer = useMemo(() => {
    try {
      const roleLower = (role || '').toString().toLowerCase()
      return roleLower.includes('site') || (storedUserRole || '').toString().toLowerCase().includes('site')
    } catch {
      return false
    }
  }, [role, storedUserRole])

  const services = useMemo(() => [
    Toolbar,
    Magnification,
    Navigation,
    LinkAnnotation,
    TextSelection,
    TextSearch,
    FormFields,
    FormDesigner,
    BookmarkView,
    ThumbnailView,
    Annotation,
    Print
  ], [])

  // Global defensive patch: poll for Syncfusion's PdfViewerBase and wrap
  // key prototype methods to suppress intermittent getBoundingClientRect errors.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const names = ['updateLeftPosition', 'renderPageContainer', 'initPageDiv', 'pageRender', 'requestSuccessPdfium']

    const doPatch = () => {
      try {
        const proto = window.PdfViewerBase && window.PdfViewerBase.prototype
        if (!proto) return false
        if (proto.__patchedForApp) return true
        proto.__patchedForApp = true
        names.forEach(name => {
          try {
            if (typeof proto[name] !== 'function') return
            const orig = proto[name]
            proto[name] = function(...args) {
              try { return orig.apply(this, args) } catch (e) {
                try { console.warn(`[PdfViewer global patch] suppressed ${name}:`, e) } catch (e2) {}
                return undefined
              }
            }
          } catch (e) {}
        })

        // Also defensively patch some Syncfusion form/signature prototypes which
        // in some library versions throw uncaught TypeErrors (null element access).
        try {
          const patchProtoMethod = (obj, methodName, fallbackReturn) => {
            try {
              if (!obj || typeof obj[methodName] !== 'function') return
              if (obj[methodName].__patchedForApp) return
              const orig = obj[methodName]
              obj[methodName] = function(...args) {
                try { return orig.apply(this, args) } catch (e) {
                  try { console.warn(`[PdfViewer form patch] suppressed ${methodName}:`, e) } catch (e2) {}
                  return fallbackReturn
                }
              }
              obj[methodName].__patchedForApp = true
            } catch (e) {}
          }

          // FormDesigner.getTextboxValue -> return empty string on failure
          if (window.FormDesigner && window.FormDesigner.prototype) patchProtoMethod(window.FormDesigner.prototype, 'getTextboxValue', '')
          // FormFields.drawSignature -> swallow errors
          if (window.FormFields && window.FormFields.prototype) patchProtoMethod(window.FormFields.prototype, 'drawSignature', undefined)
          // Signature-related helpers (some builds expose Signature on window)
          if (window.Signature && window.Signature.prototype) {
            patchProtoMethod(window.Signature.prototype, 'addSignature', undefined)
            patchProtoMethod(window.Signature.prototype, 'addSignatureInPage', undefined)
          }
        } catch (e) {}

        return true
      } catch (e) { return false }
    }

    // Try immediately and then poll for a short period while the library initializes.
    if (doPatch()) return
    const interval = setInterval(() => {
      if (doPatch()) {
        clearInterval(interval)
        clearTimeout(timeout)
      }
    }, 250)
    const timeout = setTimeout(() => { clearInterval(interval) }, 10000)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [])

  const allGroups = useMemo(() => [
    'OpenOption',
    'PageNavigationTool',
    'MagnificationTool',
    'PanTool',
    'SelectionTool',
    'SearchOption',
    'PrintOption',
    'DownloadOption',
    'UndoRedoTool',
    'CommentTool',
    'SubmitForm',
    'AnnotationEditTool',
    'FormDesignerEditTool',
  ], [])

  const removeAlways = useMemo(() => ['OpenOption', 'UndoRedoTool', 'DownloadOption'], [])
  const removeForCustomer = useMemo(() => ['AnnotationEditTool', 'PrintOption', 'FormDesignerEditTool', 'SubmitForm'], [])

  const toolbarGroups = useMemo(() => {
    const groups = []
    for (let i = 0; i < allGroups.length; i++) {
      const g = allGroups[i]
      if (removeAlways.includes(g)) continue
      if ((role !== 'Manager' && role !== 'Loan Officer') && removeForCustomer.includes(g)) continue
      groups.push(g)
      if (pdfFileName && pdfFileName.toLowerCase().includes('sanction') && loanStatus === LoanStatus.APPROVED) {
        groups.push('DownloadOption')
      }
    }
    return groups
  }, [allGroups, removeAlways, removeForCustomer, role, pdfFileName, loanStatus])

  // const attachmentButton = useMemo(() => ({
  //   prefixIcon: 'add-attachment-icon',
  //   id: 'attachment_button',
  //   tooltipText: 'Add Attachments',
  //   align: 'Right',
  //   type: 'Button'
  // }), [])

  // const searchIndex = toolbarGroups.findIndex(g => g === 'SearchOption')
  // if (searchIndex >= 0 && toolbarGroups[searchIndex + 1] !== attachmentButton) {
  //   toolbarGroups.splice(searchIndex + 1, 0, attachmentButton)
  // } else if (searchIndex < 0 && !toolbarGroups.includes(attachmentButton)) {
  //   toolbarGroups.push(attachmentButton)
  // }

  const canManageAttachments = useMemo(() => {
    if (actionBar) return true
    return role !== 'Manager' && (
      (role === 'Loan Officer' && (loanStatus === LoanStatus.NEW || loanStatus === LoanStatus.UNDER_REVIEW)) ||
      (role !== 'Loan Officer' && role !== 'Manager' && (!loanStatus || loanStatus === LoanStatus.INFO_REQUIRED) && canSubmit)
    )
  }, [role, loanStatus, canSubmit, actionBar])

  // ---------- Utilities ----------
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  const fileToBase64 = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const base64 = (reader.result || '').toString()
        const parts = base64.split(',')
        resolve(parts.length > 1 ? parts[1] : parts[0])
      }
      reader.onerror = (err) => reject(err)
    })
  }, [])

  // Helper: infer a semantic field type for sanction/application mapping
  const inferSanctionFieldType = (rawName) => {
    const n = (rawName || '').toString()
    if (!n) return null
    
    // Normalize for comparison (remove spaces, underscores, parens, hyphens, make lowercase)
    const normalized = n.toLowerCase().replace(/[_\s()\-]/g, '')
    
    // If this looks like a signature field, do not treat it as a name target
    if (/(\bsign|signature|signed|_sig|\bsig\b)/.test(normalized)) return null
    
    // EXACT match for sanction form field names (case-insensitive)
    const lowerName = n.toLowerCase()
    if (lowerName === 'applicantname') return 'name'
    if (lowerName === 'amount') return 'amount'
    if (lowerName === 'tenure') return 'tenure'
    if (lowerName === 'date') return 'date'
    
    // Fallback: Match name fields from loan application: "Full Name", "Customer Name", "name", "aname", etc.
    if (/(applicant|customer|full.*name|aname|^name$)/.test(normalized)) return 'name'
    // Match amount fields: "Sanctioned Amount", "Loan Amount", "Amount", etc.
    if (/(amount|amt|sanctioned|approved)/.test(normalized)) return 'amount'
    // Match tenure fields: "Tenure (Months)", "Term", "Duration", etc.
    if (/(tenure|term|month|duration)/.test(normalized)) return 'tenure'
    // Match date fields: "Date", "Sanction Date", "Issue Date", etc.
    if (/(date|sanction|issue|approved)/.test(normalized)) return 'date'
    return null
  }

  // ---------- Attachments ----------
  const handleAttach = useCallback(async (file) => {
    try {
      const base64 = await fileToBase64(file)
      const dataUrl = `data:${file.type};base64,${base64}`
      const fileInfo = {
        id: Date.now(),
        name: file.name,
        originalName: file.name,
        dataUrl,
        base64,
        size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
        type: file.type,
        uploadedAt: new Date().toLocaleString(),
        pending: true
      }
      setUploadedFiles(prev => {
        const already = (prev || []).some(f => f.name === fileInfo.name && f.size === fileInfo.size && f.pending)
        if (already) return prev
        return [...(prev || []), fileInfo]
      })
    } catch (err) {
      console.error('Error reading attachment', err)
      alert('Failed to read attachment')
    }
  }, [fileToBase64])

  const handleOpenFile = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click()
    setShowMenu(false)
  }, [])

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files && event.target.files[0]
    if (file) {
      const allowedTypes = ['application/pdf']
      const fileExtension = file.name.split('.').pop().toLowerCase()
      const allowedExtensions = ['pdf']
      if (allowedTypes.includes(file.type) || allowedExtensions.includes(fileExtension)) {
        await handleAttach(file)
      } else {
        alert('Invalid file type. Please select a PDF')
      }
    }
    if (event && event.target) event.target.value = ''
  }, [handleAttach])

  // ---------- Submit / Save ----------
  function getDocumentId(pdfFileName, fileId) {
    const base = pdfFileName.trim()
    if (base.toLowerCase() === 'loan_application_form') return String(fileId)
    const m = base.match(/_(\d+)(?:_\[A-Za-z\].*)?$/)
    if (m && m[1]) return String(m[1])
    return String(fileId)
  }

  const handleSubmit = async (overrideStatus) => {
    // Determine role characteristics early to avoid accidentally overwriting site-officer flow
    const roleLower = (role || '').toString().toLowerCase()
    const isSiteOfficer = roleLower.includes('site') || (storedUserRole || '').includes('site')

    // Compute the intent for this submit locally to avoid relying on global
    // `window.currentAction` which may be stale from other users' flows.
    let computedAction = null
    if (isSiteOfficer && loanStatus === LoanStatus.VALIDATING) {
      computedAction = LoanStatus.SITE_VERIFIED
    } else if (role !== 'Manager' && role !== 'Loan Officer' && !isSiteOfficer) {
      // Applicant flows
      if (loanStatus === LoanStatus.INFO_REQUIRED) computedAction = LoanStatus.INFO_UPDATED
      else if (loanStatus === LoanStatus.SIGN_REQUIRED) computedAction = LoanStatus.PENDING_APPROVAL
      else computedAction = LoanStatus.NEW
    }
    try { console.debug('[PdfViewer] handleSubmit computedAction', { loanStatus, computedAction, role }) } catch (e) {}

    const viewer = viewerRef.current
    if (!viewer) return

    try {
      removeReadOnly()
      const blob = await viewer.saveAsBlob()
      const base64 = await blobToBase64(blob)
      const base = API_BASE
      const fileId = count

      let fileName
      if ((role !== 'Manager' && role !== 'Loan Officer') && loanStatus !== LoanStatus.SIGN_REQUIRED && pdfFileName === 'Loan_Application_Form') {
        fileName = `${role}_${fileId}`
      } else if (loanStatus === LoanStatus.APPROVED && !pdfFileName.toLowerCase().includes('sanction')) {
        fileName = `${pdfFileName}_Sanction_Letter`
      } else {
        fileName = pdfFileName
      }

      const user = JSON.parse(localStorage.getItem('user') || 'null')
      const username = user?.username || user?.name || null
      const documentId = loanId || getDocumentId(pdfFileName, fileId)
      const customerName = username
      // Determine the final status to send to the server. Preference order:
      // 1) explicit overrideStatus passed by caller
      // 2) locally computed action
      // 3) the explicit `loanStatus` prop
      // 4) global `window.currentAction` fallback
      let status = overrideStatus || computedAction || loanStatus || ((typeof window !== 'undefined' && window.currentAction) ? window.currentAction : LoanStatus.NEW)
      
      // If we're in the special case where loanStatus was SIGN_REQUIRED (manager requested sign)
      // and the applicant is submitting now, ensure we mark it Pending Approval.
      // Only apply this automatic promotion when caller didn't explicitly pass an override.
      // if (!overrideStatus && (role !== 'Manager' && role !== 'Loan Officer') && !isSiteOfficer && loanStatus === LoanStatus.SIGN_REQUIRED) {
      //   status = LoanStatus.PENDING_APPROVAL
      // }

      const attachmentsPayload = (uploadedFiles || []).map(f => ({ name: f.name, base64: f.base64, type: f.type, originalName: f.originalName }))

      console.debug('[PdfViewer] handleSubmit: saving', { overrideStatus, computedAction, loanStatus, windowAction: (typeof window !== 'undefined' && window.currentAction) ? window.currentAction : null, status, fileName })

      const resp = await fetch(`${base}/api/Authentication/SaveFilledForms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, fileName, username, status, documentId, customerName, attachments: attachmentsPayload })
      })
      if (!resp.ok) console.error('SaveFilledForms failed', resp.status)

      let savedName = fileName
      let json
      try { json = await resp.json(); if (json && json.fileName) savedName = json.fileName } catch {}

      const docId = documentId || (savedName && (savedName.match(/(\d+)(?=\.pdf$)/) || [])[0]) || null

      let savedAttachmentsCount = 0
      try {
        if (json && Array.isArray(json.attachments) && json.attachments.length > 0) {
          const savedFiles = json.attachments.map((a, idx) => {
            const fname = a.fileName || a.name || a.originalName || `attachment_${idx}`
            const url = a.url || `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(savedName)}/${encodeURIComponent(fname)}`
            return {
              id: Date.now() + idx,
              name: fname,
              originalName: a.originalName || a.name || fname,
              url,
              size: a.size || '',
              type: a.type || 'application/octet-stream',
              uploadedAt: a.uploadedAt || new Date().toLocaleString(),
              pending: false
            }
          })
          setUploadedFiles(savedFiles)
          persistAttachments(savedFiles, docId)
          savedAttachmentsCount = savedFiles.length
        } else {
          const nonPending = (uploadedFiles || []).filter(f => !f.pending)
          savedAttachmentsCount = nonPending.length || (uploadedFiles || []).length
          persistAttachments(uploadedFiles || [], docId)
          setUploadedFiles([])
        }
      } catch (e) { console.warn('Error processing attachments after save', e) }

      // Incrementing the parent's file count is handled once below
      // (avoid double-increment which created duplicate rows).
      setPdfFileName(savedName)

      // NOTE: defer notifying the app about changed user files until after
      // we update the local loan status below. If we dispatch the event
      // earlier the dashboard may reload from the server before our local
      // status update is persisted, causing the old status to re-appear.

      const incrementForForm = 1
      
if (pdfFileName === 'Loan_Application_Form' &&
    ((overrideStatus || computedAction || loanStatus || LoanStatus.NEW) === LoanStatus.NEW) &&
    (!loanId || String(loanId).trim() === '')
) setFileCount(count + 1)

      setViewerMode(false)
      setSanctionMode(false)
      setSanctionValues(null)

      const current = status
      if (role !== 'Manager' && role !== 'Loan Officer' && !isSiteOfficer) {
        if (loanStatus === LoanStatus.SIGN_REQUIRED) {
          setLoanStatus(LoanStatus.PENDING_APPROVAL)
        } else {
          setLoanStatus(current || LoanStatus.NEW)
        }
      } else if (isSiteOfficer && loanStatus === LoanStatus.VALIDATING) {
        setLoanStatus(LoanStatus.SITE_VERIFIED)
      }
      try { if (typeof window !== 'undefined') window.currentAction = current || '' } catch (e) {}
      // Inform the rest of the app that a file changed — do this after we've
      // updated `loanStatus` so the dashboard's re-fetch sees the new status.
      try {
        const user = JSON.parse(localStorage.getItem('user') || 'null')
        const username = user?.username || user?.name || null
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('userFilesChanged', { detail: { documentId: docId, fileName: savedName, username } }))
        }
      } catch {}
      try {
        const user = JSON.parse(localStorage.getItem('user') || 'null')
        const username = user?.username || user?.name || null
        const current = status
        if (current === LoanStatus.NEW) {
          try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: savedName, username, comments: 'A new loan application has been created.' } })) } catch (e) {}
        } else if (current === LoanStatus.SITE_VERIFIED) {
          try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: savedName, username, comments: 'Site verified — awaiting Loan Officer decision' } })) } catch (e) {}
        } else if (current === LoanStatus.INFO_UPDATED) {
          // Applicant updated information after Info Required
          const commentText = 'Information updated by Loan Requestor'
          try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: savedName, username, comments: commentText } })) } catch (e) {}
        } else if (current === LoanStatus.SIGN_REQUIRED) {
          // Signature flow: manager requests sign OR applicant completed signing
          const commentText = (role === 'Manager' || role === 'Loan Officer')
            ? 'Signature requested from Loan Requestor'
            : 'Signed by Loan Requestor'
          try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: savedName, username, comments: commentText } })) } catch (e) {}
        } else if (current === LoanStatus.PENDING_APPROVAL) {
          try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: savedName, username, comments: 'Pending approval by Manager' } })) } catch (e) {}
        } else if (current === LoanStatus.APPROVED) {
          try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: savedName, username, comments: 'Loan application has been approved' } })) } catch (e) {}
        }
      } catch (e) {}
    } catch (err) {
      console.error('Error saving filled form', err)
    }
  }

  const handleReject = async () => {
    try {
      if (typeof window !== 'undefined') window.currentAction = LoanStatus.REJECTED
      setLoanStatus(LoanStatus.REJECTED)
      await handleSubmit(LoanStatus.REJECTED)
      try {
        const docId = loanId || getDocumentId(pdfFileName, count)
        const user = JSON.parse(localStorage.getItem('user')||'null')
        const username = user?.username || user?.name || null
        try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: pdfFileName, username, comments: 'Application Rejected' } })) } catch (e) {}
      } catch (e) {}
      setViewerMode(false)
    } catch (e) { console.error('handleReject error', e) }
  }

  const handleApproval = async () => {
    // Do not mark the loan as APPROVED until the merge completes successfully.
    // This prevents the status changing if the manager dismisses/closes without completing the flow.
    if (!showBtn) return
    const viewer = viewerRef.current; if (!viewer) return

    // Capture sanction-related values from the current form so they can be used
    // Use tolerant name matching so values are found even when field names differ
    const values = { name: '', amount: '', tenure: '', date: '' }
    try {
      const forms = viewer.retrieveFormFields() || []
      console.debug('[PdfViewer] handleApproval: capturing from', forms.length, 'form fields')
      
      for (let i = 0; i < forms.length; i++) {
        try {
          const fn = (forms[i].name || forms[i].fieldName || forms[i].id || '').toString()
          const val = (forms[i].value || forms[i].Value || '').toString().trim()
          const t = inferSanctionFieldType(fn)
          
          console.debug('[PdfViewer] handleApproval: field', i, ':', { name: fn, value: val, type: t })
          
          if (!t) continue
          if (!val) continue
          if (t === 'name' && !values.name) values.name = val
          else if (t === 'amount' && !values.amount) values.amount = val
          else if (t === 'tenure' && !values.tenure) values.tenure = val
          else if (t === 'date' && !values.date) values.date = val
        } catch (inner) { console.warn('Error processing field', i, inner) }
      }
      
      console.debug('[PdfViewer] handleApproval: captured values:', values)
    } catch (e) { console.warn('Failed to read form fields before merge', e) }
    
    // Store values in both state and ref BEFORE calling merge API
    setSanctionValues(values)
    pendingSanctionValuesRef.current = values

    // Defer changing status until merge succeeds (see below)

    console.debug('[PdfViewer] handleApproval: start, capturing sanction values', values)
    console.debug('[PdfViewer] handleApproval: calling MergeSanction API with file:', pdfFileName)
    // Request server to merge the application + sanction template into one PDF
    try {
      // disable sign request until merged document fully loads
      try { setSignRequestEnabled(false) } catch {}
      const base = API_BASE
      // Ensure filenames include .pdf and explicitly send both application and sanction names
      const applicationFile = (pdfFileName && pdfFileName.toString().toLowerCase().endsWith('.pdf')) ? pdfFileName : `${pdfFileName}.pdf`
      const sanctionFile = 'Sanction_Letter.pdf'
      
      console.debug('[PdfViewer] handleApproval: about to call MergeSanction', { applicationFile, sanctionFile, values })
      
      // include captured sanction values so server can render them into the merged document
      const resp = await fetch(`${base}/api/Authentication/MergeSanction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ FileName: applicationFile, SanctionFileName: sanctionFile, SanctionValues: values })
      })

      console.debug('[PdfViewer] handleApproval: MergeSanction response', resp.status, resp.ok)

      let json = null
      try { json = await resp.json(); console.debug('[PdfViewer] handleApproval: MergeSanction JSON', json) } catch (e) { console.warn('Failed to parse merge response', e) }

      const mergedName = json && (json.fileName || json.file) ? (json.fileName || json.file) : null
      if (resp.ok && mergedName) {
        console.debug('[PdfViewer] handleApproval: merge successful, merged file name:', mergedName)
        // normalize merged name to include .pdf
        const mergedFilename = (mergedName && mergedName.toString().toLowerCase().endsWith('.pdf')) ? mergedName : `${mergedName}.pdf`
        // pending values already set above, so resourcesLoaded will apply them
        try { if (typeof window !== 'undefined') window.currentAction = LoanStatus.APPROVED } catch {}
        try { setLoanStatus(LoanStatus.APPROVED) } catch {}
        try { setPdfFileName(mergedFilename) } catch {}
        try { setSanctionMode(true) } catch {}
        try { setViewerMode(true) } catch (e) {}
        // Attempt to trigger loading of the freshly-merged document immediately
        try {
          setTimeout(() => {
            try { console.debug('[PdfViewer] handleApproval: loading merged PDF', mergedFilename); resourcesLoaded(mergedFilename) } catch (e) { console.warn('resourcesLoaded call failed', e) }
          }, 120)
        } catch (e) {}
        // values will be applied when resourcesLoaded completes (pendingSanctionValuesRef)
        return
      } else {
        console.warn('[PdfViewer] handleApproval: merge failed or no merged name returned', { ok: resp.ok, mergedName, json })
      }

      // Fallback: if merge failed, load the standard sanction template
      // fallback: pending values already set above, load standard sanction template; values will be applied after load
      console.warn('[PdfViewer] handleApproval: using fallback - loading plain Sanction_Letter.pdf')
      try { if (typeof window !== 'undefined') window.currentAction = LoanStatus.APPROVED } catch {}
      try { setLoanStatus(LoanStatus.APPROVED) } catch (e) {}
      try { setSanctionMode(true); setPdfFileName('Sanction_Letter.pdf'); setViewerMode(true) } catch (e) {}
      try {
        setTimeout(() => {
          try { console.debug('[PdfViewer] handleApproval: loading fallback Sanction_Letter.pdf'); resourcesLoaded('Sanction_Letter.pdf') } catch (e) { console.warn('resourcesLoaded call failed (fallback)', e) }
        }, 120)
      } catch (e) {}
    } catch (err) {
      console.error('[PdfViewer] handleApproval: MergeSanction exception', err)
      // fallback: pending values already set above
      try { if (typeof window !== 'undefined') window.currentAction = LoanStatus.APPROVED } catch {}
      try { setLoanStatus(LoanStatus.APPROVED) } catch (e) {}
      try { setSanctionMode(true); setPdfFileName('Sanction_Letter.pdf'); setViewerMode(true) } catch (e) {}
      try {
        setTimeout(() => {
          try { console.debug('[PdfViewer] handleApproval: loading fallback (merge error) Sanction_Letter.pdf'); resourcesLoaded('Sanction_Letter.pdf') } catch (e) { console.warn('resourcesLoaded call failed (error fallback)', e) }
        }, 120)
      } catch (e) {}
    }
  }

  // Loading of merged/sanction documents is handled explicitly by `handleApproval`
  // and the `resourcesLoaded` callback; avoid triggering loads from this effect
  useEffect(() => {}, [loanStatus, sanctionValues, sanctionMode])

  const handleSignRequest = async () => {
    try {
      if (typeof window !== 'undefined') window.currentAction = LoanStatus.SIGN_REQUIRED
      setLoanStatus(LoanStatus.SIGN_REQUIRED)
      // Explicitly pass the SIGN_REQUIRED status to avoid racing with setState
      await handleSubmit(LoanStatus.SIGN_REQUIRED)
    } catch (e) {
      console.warn('handleSignRequest error', e)
    } finally {
      setSanctionMode(false)
    }
  }

  const handleFinish = async () => {
    try {
      const v = viewerRef.current; if (!v) return
      const forms = v.retrieveFormFields() || []
      for (let i = 0; i < forms.length; i++) {
        try { v.formDesignerModule.updateFormField(forms[i], { isReadOnly: true }) } catch (e) {}
      }
      try { if (typeof window !== 'undefined') window.currentAction = LoanStatus.APPROVED } catch (e) {}
      try { setLoanStatus(LoanStatus.APPROVED) } catch (e) {}
      console.debug('[PdfViewer] handleFinish: submitting APPROVED')
      await handleSubmit(LoanStatus.APPROVED)
    } catch (e) {
      console.error('handleFinish error', e)
    } finally {
      try { setViewerMode(false) } catch (e) {}
      try { setSanctionMode(false) } catch (e) {}
    }
  }

  const handleInfoRequired = async () => {
    try {
      if (typeof window !== 'undefined') window.currentAction = LoanStatus.INFO_REQUIRED
      removeReadOnly(); setLoanStatus(LoanStatus.INFO_REQUIRED)
      // dispatch comment for dashboard
      try { const docId = loanId || getDocumentId(pdfFileName, count); const user = JSON.parse(localStorage.getItem('user')||'null'); const username = user?.username || user?.name || null; window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: pdfFileName, username, comments: 'Additional information required from applicant' } })) } catch (e) {}
      await handleSubmit(LoanStatus.INFO_REQUIRED); setViewerMode(false)
    } catch (e) { console.error('handleInfoRequired error', e) }
  }

  const handlePendingApproval = async () => {
    try {
      if (!showBtn) return
      if (typeof window !== 'undefined') window.currentAction = LoanStatus.PENDING_APPROVAL
      setLoanStatus(LoanStatus.PENDING_APPROVAL)
      // dispatch comment for dashboard
      try { const docId = loanId || getDocumentId(pdfFileName, count); const user = JSON.parse(localStorage.getItem('user')||'null'); const username = user?.username || user?.name || null; window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: docId, fileName: pdfFileName, username, comments: 'Pending approval by Manager' } })) } catch (e) {}
      setViewerMode(false)
      await handleSubmit()
    } catch (e) { console.error('handlePendingApproval error', e) }
  }

  // Handlers for Loan Officer dropdown choices
  const handleInfoChoice = async (choice) => {
    const text = choice === 'need_clarification'
      ? 'Clarification requested From Applicant'
      : 'Attachment missing — please provide the required document'
    try {
      if (typeof window !== 'undefined') window.currentAction = LoanStatus.INFO_REQUIRED
      setLoanStatus(LoanStatus.INFO_REQUIRED)
      // dispatch local event so dashboard updates immediately
      try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: loanId || getDocumentId(pdfFileName, count), fileName: pdfFileName, username: (JSON.parse(localStorage.getItem('user')||'null')?.username || JSON.parse(localStorage.getItem('user')||'null')?.name || null), comments: text } })) } catch (e) {}
      setShowInfoMenu(false)
      setViewerMode(false)
      await handleSubmit(LoanStatus.INFO_REQUIRED)
    } catch (e) { console.error('handleInfoChoice error', e) }
  }

  const handleApprovalChoice = async (choice) => {
    try {
      const user = JSON.parse(localStorage.getItem('user')||'null')
      const username = user?.username || user?.name || null
      let overrideStatus = null
      if (choice === 'send_to_site') {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.VALIDATING
        setLoanStatus(LoanStatus.VALIDATING)
        overrideStatus = LoanStatus.VALIDATING
        try { window.dispatchEvent(new CustomEvent('loanCommentAdded', { detail: { documentId: loanId || getDocumentId(pdfFileName, count), fileName: pdfFileName, username, comments: 'Validating your loan application.' } })) } catch (e) {}
      } else if (choice === 'approved') {
  // Loan Officer approves -> move to Manager queue
  if (typeof window !== 'undefined') window.currentAction = LoanStatus.PENDING_APPROVAL
  setLoanStatus(LoanStatus.PENDING_APPROVAL)
  overrideStatus = LoanStatus.PENDING_APPROVAL
      try {
    window.dispatchEvent(new CustomEvent('loanCommentAdded', {
      detail: {
        documentId: loanId || getDocumentId(pdfFileName, count),
        fileName: pdfFileName,
        username,
        comments: 'Pending approval by Manager'
      }
    }))
  } catch (e) {}
}
      setShowApprovalMenu(false)
      setViewerMode(false)
      await handleSubmit(overrideStatus)
    } catch (e) { console.error('handleApprovalChoice error', e) }
  }

  // Helper: check if LoanOfficerSignature field contains a value
  const isLoanOfficerSignatureFilled = () => {
    try {
      const viewer = viewerRef.current
      if (!viewer) return false
      const getter = viewer.retrieveFormFields || (viewer.pdfViewer && viewer.pdfViewer.retrieveFormFields)
      const fields = (getter && getter.call(viewer)) || []
      for (const f of fields) {
        const name = (f.name || f.fieldName || '').toString().toLowerCase()
        if (!name) continue
        if (name.includes('loanofficer') || name.includes('loan_officer') || name.includes('loanofficersignature')) {
          const val = (f.value || '').toString().trim()
          if (val) return true
        }
      }
    } catch (e) {}
    return false
  }

  // Helper: check if Applicant signature field contains a value or a drawn signature
  const isApplicantSignatureFilled = () => {
    try {
      const viewer = viewerRef.current
      if (!viewer) return false
      const getter = viewer.retrieveFormFields || (viewer.pdfViewer && viewer.pdfViewer.retrieveFormFields)
      const fields = (getter && getter.call(viewer)) || []

      // Look for any signature-type field that is not manager/loanofficer and has a value
      for (const f of fields) {
        const name = (f.name || f.fieldName || f.id || '').toString().toLowerCase()
        const type = (f.type || f.fieldType || '').toString().toLowerCase()
        if (!name && !type) continue
        // skip manager/loan officer signature fields
        if (name.includes('manager') || name.includes('loanofficer')) continue
        if (type.includes('signature') || name.includes('signature')) {
          const val = (f.value || f.Value || f.FieldValue || '').toString().trim()
          if (val) return true
        }
      }

      // Fallback: inspect annotation collection for a signature-like annotation
      try {
        const annColl = (viewer.annotationCollection && (typeof viewer.annotationCollection === 'function' ? viewer.annotationCollection() : viewer.annotationCollection)) || viewer.annotationCollections || []
        for (const a of (annColl || [])) {
          const subject = (a.subject || a.Subject || '').toString().toLowerCase()
          const author = (a.author || a.Author || '').toString().toLowerCase()
          if (subject.includes('signature') || author.includes('signature')) return true
          if ((a.shapeAnnotationType || a.annotationType || '').toString().toLowerCase().includes('signature')) return true
        }
      } catch (e) {}
    } catch (e) { console.warn('isApplicantSignatureFilled error', e) }
    return false
  }

  const areAllFieldsFilled = (fields) => {
    const radioGroups = {}

    for (const f of fields) {
      const type = (f.type || f.fieldType || '').toString().toLowerCase()
      const name = (f.name || f.fieldName || f.id || '') + ''

      const lname = name.toString().toLowerCase()

      // skip loan officer / manager signature fields for non-staff
      if ((role !== 'Manager' && role !== 'Loan Officer') && (lname.includes('loanofficer') || lname.includes('managersignature'))) continue

      // ignore attachment placeholders and fields that are read-only (not required)
      if (lname.includes('attach') || lname.includes('attachment')) continue
      if (f.isReadOnly || f.readOnly || f.disabled) continue

      // signature handling:
      // - For applicants (non-staff, non-site), require their signature fields to be filled.
      // - For staff roles and site officers, ignore signature fields in the required check.
      const roleLowerInner = (role || '').toString().toLowerCase()
      const isSiteOfficerInner = roleLowerInner.includes('site') || (storedUserRole || '').toString().toLowerCase().includes('site')
      const isApplicant = (role !== 'Manager' && role !== 'Loan Officer') && !isSiteOfficerInner
      if (type.includes('signature') || lname.includes('signature')) {
        if (!isApplicant) continue
        // For applicant, accept a signature either as a form value or as a drawn annotation.
        const sigVal = (f.value || f.Value || f.FieldValue || '').toString().trim()
        if (sigVal) continue
        // if the form field has no value, check annotations (some viewers store signatures as annotations)
        if (isApplicantSignatureFilled()) continue
        // no applicant signature detected → missing required field
        return false
      }

      // explicit exceptions: these fields are NOT required for submit by default
      const exceptions = new Set(['aphone','aadharcard','drivinglicense','passport','personalinfo','employmentinfo','comments','sitedate','loanofficersignature'])
      // For Site Officer role, require `personalinfo`, `employmentinfo`, `comments`, `sitedate`
      try {
        const roleLower = (role || '').toString().toLowerCase()
        const isSiteOfficer = roleLower.includes('site') || (storedUserRole || '').includes('site')
        if (isSiteOfficer) {
          exceptions.delete('personalinfo')
          exceptions.delete('employmentinfo')
          exceptions.delete('comments')
          exceptions.delete('sitedate')
        }
      } catch (e) {}
      if (exceptions.has(lname)) continue

      const value = (f.value || f.Value || f.FieldValue || '').toString().trim()
      const checked = f.checked || f.isChecked || false

      if (type === 'radio' || type === 'radiobutton' || type === 'checkbox') {
        radioGroups[name] = radioGroups[name] || []
        radioGroups[name].push(checked || value !== '')
        continue
      }

      if (!value) return false
    }

    for (const vals of Object.values(radioGroups)) if (!vals.some(Boolean)) return false
    return true
  }

  const evaluateFields = () => {
    try {
      const api = viewerRef.current; if (!api) return
      const getter = api.retrieveFormFields || (api.pdfViewer && api.pdfViewer.retrieveFormFields)
      const fields = (getter && getter.call(api)) || []
      if (!fields.length) {
        // If fields have not yet loaded, for applicants keep Submit disabled
        // (avoids the case where Submit is enabled until a signature/fields load)
        if (role !== 'Manager' && role !== 'Loan Officer') {
          setShowBtn(false)
        } else {
          setShowBtn(true)
        }
        return
      }
      // Allow applicant signature to satisfy the requirement even if other
      // fields are not yet considered filled. This ensures signing enables Submit.
      const basicOk = areAllFieldsFilled(fields)
      const applicantHasSig = (role !== 'Manager' && role !== 'Loan Officer') && isApplicantSignatureFilled()
      const ok = basicOk || applicantHasSig

      // Ensure staff roles (Manager / Loan Officer) always have action buttons
      // visible/enabled. Loan Officer should see Approval immediately.
      try {
        const roleLowerEval = (role || '').toString().toLowerCase()
        const storedLower = (storedUserRole || '').toString().toLowerCase()
        const isLoanOfficerEval = ((roleLowerEval.includes('loan') && roleLowerEval.includes('officer')) || roleLowerEval.includes('loanofficer') || storedLower.includes('loan officer') || storedLower.includes('loanofficer'))
        const isManagerEval = roleLowerEval.includes('manager') || storedLower.includes('manager')
        if (isLoanOfficerEval || isManagerEval) {
          setShowBtn(true)
          return
        }
      } catch (e) {}

      setShowBtn(ok)
      if (loanStatus === LoanStatus.REJECTED) setShowBtn(false)
    } catch (e) { console.warn('evaluateFields error', e) }
  }

  const onFormFieldPropertiesChange = (args) => {
    if (args && args.isValueChanged) {
      try {
        const viewer = viewerRef.current
        if (viewer) {
          const getter = viewer.retrieveFormFields || (viewer.pdfViewer && viewer.pdfViewer.retrieveFormFields)
          const fields = (getter && getter.call(viewer)) || []

          const rawTargetName = (args && ((args.field && (args.field.name || args.field.fieldName)) || args.name || args.fieldName || args.fullName)) || ''
          const targetName = (rawTargetName + '').toString().toLowerCase()

          if (targetName) {
            const numericKeywords = ['date','dob','dateofbirth','phone','mobile','contact','amount','tenure','number','no','age']
            let isNumericField = numericKeywords.some(k => targetName.includes(k))
            const fieldTypeRaw = (args.field && (args.field.type || args.field.fieldType || '')) || ''
            const fieldType = (fieldTypeRaw + '').toString().toLowerCase()
            const isSignatureField = fieldType.includes('signature')
            if (isSignatureField && isNumericField) isNumericField = false

            if (isNumericField) {
              const argValue = (args.value || args.newValue || args.field?.value || args.field?.fieldValue || '').toString()
              const argSanitized = argValue.replace(/\D/g, '')

              const matchField = (ff) => {
                const fnRaw = ((ff.name || ff.fieldName || '') + '').toString().toLowerCase(); if (!fnRaw) return false
                if (fnRaw === targetName) return true
                const fnLast = fnRaw.split(/\.|\[|\]/).filter(Boolean).pop() || fnRaw
                const tgtLast = targetName.split(/\.|\[|\]/).filter(Boolean).pop() || targetName
                if (fnLast === tgtLast) return true
                if (fnRaw.endsWith('.' + tgtLast) || fnRaw.endsWith('_' + tgtLast) || fnRaw.endsWith('/' + tgtLast) || fnRaw.endsWith(':' + tgtLast)) return true
                return false
              }

              let f = fields.find(matchField) || null
              if (!f) {
                const lastSeg = targetName.split(/\.|\[|\]/).filter(Boolean).pop() || targetName
                f = fields.find(ff => (((ff.name || ff.fieldName || '') + '').toString().toLowerCase() === lastSeg) || (((ff.name || ff.fieldName || '') + '').toString().toLowerCase().endsWith(lastSeg))) || null
              }

              const getDisallowedRegex = (name) => {
                const n = (name || '').toString().toLowerCase()
                if (n.includes('phone') || n.includes('mobile') || n.includes('contact')) return /[^0-9+\-()\s]/g
                if (n.includes('date') || n.includes('dob') || n.includes('dateofbirth')) return /[^0-9\/\-.]/g
                if (n.includes('amount') || n.includes('amt')) return /[^0-9\.,]/g
                return /[^0-9]/g
              }

              if (f) {
                const raw = (f.value || args.value || args.newValue || '').toString()
                const disallowedRe = getDisallowedRegex(targetName)
                let sanitized
                try { sanitized = raw.replace(disallowedRe, '') } catch { sanitized = raw.replace(/[^0-9]/g, '') }

                if (raw !== sanitized) {
                  try {
                    const fTypeRaw2 = (f && (f.type || f.fieldType || '')) || ''
                    const fType2 = (fTypeRaw2 + '').toString().toLowerCase()
                    if (!fType2.includes('signature')) {
                      f.value = sanitized
                      if (typeof viewer.updateFormFieldsValue === 'function') viewer.updateFormFieldsValue(f)
                      if (viewer.formDesignerModule && typeof viewer.formDesignerModule.updateFormField === 'function') viewer.formDesignerModule.updateFormField(f, { value: sanitized })
                      const alertKey = targetName || (args.name || args.fieldName || args.fullName || '').toString();
                      if (typeof window !== 'undefined' && !alertedFieldsRef.current.has(alertKey)) {
                        try {
                          let msg = 'Please enter numbers only for this field.'
                          if (targetName.includes('phone') || targetName.includes('mobile') || targetName.includes('contact')) msg = 'Please enter digits and permitted phone characters only (+ - ( ) ).'
                          if (targetName.includes('date') || targetName.includes('dob') || targetName.includes('dateofbirth')) msg = 'Please enter digits and permitted date characters only (/, -, .).'
                          if (targetName.includes('amount')) msg = 'Please enter digits and permitted amount characters only (.,).'
                          window.alert(msg)
                        } catch {}
                        alertedFieldsRef.current.add(alertKey)
                      }
                    }
                  } catch {}
                } else {
                  try { alertedFieldsRef.current.delete(targetName) } catch {}
                }
              } else if (argSanitized !== argValue) {
                try {
                  const argsFieldTypeRaw = (args.field && (args.field.type || args.field.fieldType || '')) || ''
                  const argsFieldType = (argsFieldTypeRaw + '').toString().toLowerCase()
                  const isArgsSignature = argsFieldType.includes('signature')
                  if (!isArgsSignature) {
                    if (viewer.formDesignerModule && typeof viewer.formDesignerModule.updateFormField === 'function') {
                      const disallowedRe = getDisallowedRegex(targetName)
                      let fallbackSanitized
                      try { fallbackSanitized = argValue.replace(disallowedRe, '') } catch { fallbackSanitized = argValue.replace(/[^0-9]/g, '') }
                      viewer.formDesignerModule.updateFormField({ name: args.name || args.fieldName || args.fullName }, { value: fallbackSanitized })
                      const alertKey = targetName || (args.name || args.fieldName || args.fullName || '').toString();
                      if (typeof window !== 'undefined' && !alertedFieldsRef.current.has(alertKey)) {
                        try {
                          let msg = 'Please enter numbers only for this field.'
                          if (targetName.includes('phone') || targetName.includes('mobile') || targetName.includes('contact')) msg = 'Please enter digits and permitted phone characters only (+ - ( ) ).'
                          if (targetName.includes('date') || targetName.includes('dob') || targetName.includes('dateofbirth')) msg = 'Please enter digits and permitted date characters only (/, -, .).'
                          if (targetName.includes('amount')) msg = 'Please enter digits and permitted amount characters only (.,).'
                          window.alert(msg)
                        } catch {}
                        alertedFieldsRef.current.add(alertKey)
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        }
      } catch (e) { console.warn('onFormFieldPropertiesChange sanitization error', e) }
      setTimeout(() => { evaluateFields() }, 100)
    }
    if (sanctionMode) { checkManagerSignature() }
  }

  const resourcesLoaded = async (overrideName) => {
    const viewer = viewerRef.current; if (!viewer) return
    try {
      const base = API_BASE
      // allow explicit filename when caller has a freshly-merged name
      // Prefer overrideName -> current pdfFileName -> fallback Loan_Application_Form.
      // Previous logic forced 'Sanction_Letter' for APPROVED which could override
      // freshly-merged names; prefer the explicit filename or the current state.
      const rawName = overrideName || (pdfFileName || 'Loan_Application_Form')
      const filename = (rawName && rawName.toString().toLowerCase().endsWith('.pdf')) ? rawName : `${rawName}.pdf`
      const resp = await fetch(`${base}/api/Authentication/GetPdfStream/${encodeURIComponent(filename)}`)
      if (!resp.ok) { console.error('Failed to fetch PDF', resp.status); return }
      const blob = await resp.blob()
      try { if (window._lastPdfBlobUrl) URL.revokeObjectURL(window._lastPdfBlobUrl) } catch {}
      const blobUrl = URL.createObjectURL(blob)
      window._lastPdfBlobUrl = blobUrl
      if (viewer.load || viewer.open) {
        try { await safeViewerLoad(viewer, blobUrl) } catch (e) { console.warn('viewer.load failed', e) }
        // If there are pending sanction values captured earlier, apply them after a short delay
        try {
        if (pendingSanctionValuesRef.current) {
            const vals = pendingSanctionValuesRef.current
            // Ensure the captured values are stored in state so other flows (onDocumentLoad)
            // and UpdateForm can see them as well.
            try { setSanctionValues(vals) } catch (e) {}

            // After the merged PDF is loaded into the viewer, retrieve its form fields
            // and populate name/amount/tenure/date directly (retry briefly if fields not yet available).
            setTimeout(() => {
              try {
                console.log('🔄 [resourcesLoaded] Applying pending sanction values:', vals)
            // Direct fill by exact field names (applicantname, amount, tenure, date)
            try {
              const directSet = setSanctionFieldsDirect(viewer, vals);
              console.log('✅ [resourcesLoaded] Direct-set count:', directSet);
            } catch(e) { console.warn('resourcesLoaded direct-set error', e); }

                const formsAfter = (viewer.retrieveFormFields && viewer.retrieveFormFields()) || []
                console.log(`📋 [resourcesLoaded] Found ${formsAfter.length} fields in merged PDF`)
                
                if (!formsAfter || formsAfter.length === 0) {
                  console.warn('⚠️ [resourcesLoaded] No fields found, calling UpdateForm fallback')
                  // If fields are not ready, fall back to calling UpdateForm which has its own retries
                  try { UpdateForm(vals) } catch (e) { console.warn('UpdateForm fallback failed', e) }
                } else {
                  console.log('🔍 [resourcesLoaded] Iterating through fields to apply values...')
                  for (let i = 0; i < formsAfter.length; i++) {
                    try {
                      const fname = formsAfter[i].name || formsAfter[i].fieldName || formsAfter[i].id || null
                      if (!fname) continue
                      const fieldType = inferSanctionFieldType(fname)
                      console.log(`  Field[${i}]: "${fname}" → type: ${fieldType}`)
                      if (!fieldType) continue
                      let newVal = null
                      if (fieldType === 'name') newVal = vals.name || ''
                      else if (fieldType === 'amount') newVal = vals.amount || ''
                      else if (fieldType === 'tenure') newVal = vals.tenure || ''
                      else if (fieldType === 'date') newVal = vals.date || new Date().toLocaleDateString('en-GB')
                      if (newVal != null) {
                        console.log(`    ✅ Setting ${fieldType} = "${newVal}"`)
                        try {
                          const upd = { name: fname, value: newVal }
                          if (typeof viewer.updateFormFieldsValue === 'function') viewer.updateFormFieldsValue(upd)
                          if (viewer.formDesignerModule && typeof viewer.formDesignerModule.updateFormField === 'function') viewer.formDesignerModule.updateFormField({ name: fname }, { value: newVal, isReadOnly: true })
                        } catch (e) { console.warn(`Failed to set field ${fname}:`, e) }
                      }
                    } catch (e) { console.warn('Error processing field', i, e) }
                  }
                  console.log('✅ [resourcesLoaded] Finished applying values to merged PDF')
                }
              } catch (e) { console.warn('Failed to apply pending sanction values to merged PDF', e) }
              try { pendingSanctionValuesRef.current = null } catch (e) {}
            }, 300)
          }
        } catch (e) { /* ignore */ }
      }
      if (filename) {
        try { await fetchServerAttachments(filename) } catch (e) { console.warn('Failed to fetch server attachments', e) }
      }
      // Document and (attempted) attachments have been loaded — enable Sign Request
      try { setSignRequestEnabled(true) } catch (e) {}
    } catch (err) { console.error('Error loading PDF:', err) }
  }

  // function readOnly() {
  //   const viewer = viewerRef.current; if (!viewer) return
  //   const forms = (viewer.retrieveFormFields && viewer.retrieveFormFields()) || []

  //   // Retry a few times if fields are not yet available (viewer may populate them asynchronously)
  //   if (!forms || forms.length === 0) {
  //     if ((readOnlyAttemptsRef.current || 0) < 6) {
  //       readOnlyAttemptsRef.current = (readOnlyAttemptsRef.current || 0) + 1
  //       setTimeout(() => {
  //         try { readOnly() } catch (e) {}
  //       }, 250)
  //       return
  //     }
  //   }
  //   // reset attempts when we have fields
  //   readOnlyAttemptsRef.current = 0

  //   const roleLower = (role || '').toString().toLowerCase()
  //   const isSiteOfficer = roleLower.includes('site') || (storedUserRole || '').toString().toLowerCase().includes('site')
  //   const isApplicant = (role !== 'Manager' && role !== 'Loan Officer') && !isSiteOfficer

  //   for (let i = 0; i < forms.length; i++) {
  //     try {
  //       const f = forms[i]
  //       const fname = (f.name || f.fieldName || '').toString().toLowerCase()

  //       // Case 1: Applicant (loan requestor) — these fields should always be readonly for the applicant
  //       if (isApplicant) {
  //         if (fname.includes('personalinfo') || fname.includes('employmentinfo') || fname.includes('comments') || fname.includes('sitedate') || fname.includes('loanofficer')) {
  //           viewer.formDesignerModule.updateFormField(f, { isReadOnly: true })
  //           continue
  //         }
  //       }

  //       // Case 2: Site officer — ensure LoanOfficerSignature is readonly for site engineer
  //       if (isSiteOfficer && fname === 'loanofficersignature') {
  //         viewer.formDesignerModule.updateFormField(f, { isReadOnly: true })
  //         continue
  //       }

  //       // Fallback: preserve original behaviour driven by sanctionMode and loan status
  //       if (sanctionMode) {
  //         if ((f.type || '').toString().toLowerCase() === 'signaturefield' && (f.value === '' || f.value == null)) {
  //           f.isReadOnly = false
  //           viewer.formDesignerModule.updateFormField(f, { isReadOnly: false })
  //         } else {
  //           viewer.formDesignerModule.updateFormField(f, { isReadOnly: true })
  //         }
  //       } else {
  //         if (((loanStatus === LoanStatus.UNDER_REVIEW || loanStatus === LoanStatus.INFO_REQUIRED) && (f.value === '' || f.value == null)) ||
  //             ((loanStatus === LoanStatus.PENDING_APPROVAL || loanStatus === LoanStatus.INFO_REQUIRED) && role === 'Loan Officer' && (f.name === 'LoanOfficerSignature' || f.name === 'LoanOfficerSignature'))) {
  //           f.isReadOnly = false
  //           viewer.formDesignerModule.updateFormField(f, { isReadOnly: false })
  //         } 
  //       }
  //     } catch (e) { /* ignore per-field errors */ }
  //   }
  // }

function readOnly() {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const forms =
        (viewer.retrieveFormFields && viewer.retrieveFormFields()) || [];

    if (!forms || forms.length === 0) {
        if ((readOnlyAttemptsRef.current || 0) < 6) {
            readOnlyAttemptsRef.current =
                (readOnlyAttemptsRef.current || 0) + 1;
            setTimeout(() => { try { readOnly(); } catch (e) {} }, 250);
            return;
        }
    }

    readOnlyAttemptsRef.current = 0;
    
if (loanStatus === LoanStatus.APPROVED) {
    for (let i = 0; i < forms.length; i++) {
        try {
            viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
        } catch (e) {}
    }
    return;
}


    const roleLower = (role || "").toString().toLowerCase();
    const isSiteOfficer =
        roleLower.includes("site") ||
        (storedUserRole || "").toString().toLowerCase().includes("site");

    const isApplicant =
        role !== "Manager" && role !== "Loan Officer" && !isSiteOfficer;

    for (let i = 0; i < forms.length; i++) {
        try {
            const f = forms[i];
            const fname = (
                f.name || f.fieldName || ""
            )
                .toString()
                .toLowerCase();

            /* ----------------------------------------------------------
               🔹 NEW CASE 1 — Applicant + SIGN_REQUIRED
               ---------------------------------------------------------- */
            // if (isApplicant && loanStatus === LoanStatus.SIGN_REQUIRED) {
            //     const blockSet = new Set([
            //         "applicantname",
            //         "amount",
            //         "tenure",
            //         "date",
            //         "managersignature"
            //     ]);

            //     if (blockSet.has(fname)) {
            //         viewer.formDesignerModule.updateFormField(f, {
            //             isReadOnly: true
            //         });
            //         continue;
            //     }
            // }

            // /* ----------------------------------------------------------
            //    🔹 NEW CASE 2 — Manager + PENDING_APPROVAL
            //    ---------------------------------------------------------- */
            // if (role === "Manager" && loanStatus === LoanStatus.PENDING_APPROVAL) {
            //     const blockSet = new Set([
            //         "applicantname",
            //         "amount",
            //         "tenure",
            //         "date",
            //         "applicantsignature"
            //     ]);

            //     if (blockSet.has(fname)) {
            //         viewer.formDesignerModule.updateFormField(f, {
            //             isReadOnly: true
            //         });
            //         continue;
            //     }
            // }

            /* ----------------------------------------------------------
               EXISTING LOGIC — (not modified)
               ---------------------------------------------------------- */

            // Applicant cannot edit these fields
            if (isApplicant) {
                if (
                    fname.includes("employmentinfo") ||
                    fname.includes("personalinfo") ||
                    fname.includes("sitedate") ||
                    fname.includes("loanofficersignature") ||
                    fname.includes("comments")
                ) {
                    viewer.formDesignerModule.updateFormField(f, {
                        isReadOnly: true
                    });
                } else {
                    viewer.formDesignerModule.updateFormField(f, {
                        isReadOnly: false
                    });
                }
                continue;
            }

            // Staff editable list (when not approved)
            const staffAllowed = new Set([
                "aadharattach",
                "panattach",
                "panatatch",
                "salaryattach",
                "bankattach",
                "drivingattach",
                "passportattach",
                "employmentinfo",
                "personalinfo",
                "sitedate",
                "loanofficersignature",
                "comments"
            ]);

            const editable = staffAllowed.has(fname);

            viewer.formDesignerModule.updateFormField(f, {
                isReadOnly: !editable
            });

        } catch (e) {}
    }
}


  function removeReadOnly() {
    const viewer = viewerRef.current; if (!viewer) return
    const forms = viewer.retrieveFormFields(); for (let i = 0; i < forms.length; i++) viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: false })
  }

  
function setSanctionFieldsDirect(viewer, vals) {
  try {
    if (!viewer) return 0;
    const getter = viewer.retrieveFormFields || (viewer.pdfViewer && viewer.pdfViewer.retrieveFormFields);
    const fields = (getter && getter.call(viewer)) || [];
    const want = {
      applicantname: vals?.name || '',
      amount: vals?.amount || '',
      tenure: vals?.tenure || '',
      date: new Date().toLocaleDateString('en-GB')
    };
    const names = Object.keys(want);
    let setCount = 0;
    for (let i=0;i<fields.length;i++) {
      try {
        const f = fields[i];
        const raw = (f.name || f.fieldName || f.id || '').toString();
        if (!raw) continue;
        const nm = raw.trim().toLowerCase();
        if (!names.includes(nm)) continue;
        const newVal = want[nm];
        if (newVal==null) continue;
        f.value = newVal;
        if (typeof viewer.updateFormFieldsValue === 'function') viewer.updateFormFieldsValue(f);
        if (viewer.formDesignerModule && typeof viewer.formDesignerModule.updateFormField === 'function') viewer.formDesignerModule.updateFormField(f, { value: newVal, isReadOnly: true });
        setCount++;
      } catch(e) { /* continue */ }
    }
    return setCount;
  } catch (e) { return 0; }
}

function UpdateForm(overrideValues) {
    const vals = overrideValues || sanctionValues || { name: '', amount: '', tenure: '', date: '' }
    console.log('🔄 [UpdateForm] Called with values:', vals)
    const viewer = viewerRef.current; if (!viewer) { console.warn('[UpdateForm] No viewer ref'); return }
    const forms = (viewer.retrieveFormFields && viewer.retrieveFormFields()) || []
    console.log(`📋 [UpdateForm] Found ${forms.length} fields`)
    
    // If fields are not yet available, retry a few times (viewer may populate them asynchronously)
    if (!forms || forms.length === 0) {
      if ((applySanctionAttemptsRef.current || 0) < 6) {
        applySanctionAttemptsRef.current = (applySanctionAttemptsRef.current || 0) + 1
        console.log(`⏳ [UpdateForm] Retry attempt ${applySanctionAttemptsRef.current}/6`)
        setTimeout(() => { try { UpdateForm(overrideValues) } catch (e) {} }, 300)
        return
      }
      console.warn('⚠️ [UpdateForm] Failed after 6 attempts, no fields found')
    }
    applySanctionAttemptsRef.current = 0

    console.log('🔍 [UpdateForm] Iterating through fields to apply values...')
    for (let i = 0; i < forms.length; i++) {
      try {
        const fname = forms[i].name || forms[i].fieldName || forms[i].id || null
        if (!fname) continue
        const fieldType = inferSanctionFieldType(fname)
        console.log(`  Field[${i}]: "${fname}" → type: ${fieldType}`)
        if (!fieldType) continue
        let newVal = null
        if (fieldType === 'name') newVal = vals.name || ''
        else if (fieldType === 'amount') newVal = vals.amount || ''
        else if (fieldType === 'tenure') newVal = vals.tenure || ''
        else if (fieldType === 'date') newVal = vals.date || new Date().toLocaleDateString('en-GB')
        if (newVal != null) {
          console.log(`    ✅ Setting ${fieldType} = "${newVal}"`)
          try {
            const upd = { name: fname, value: newVal }
            if (typeof viewer.updateFormFieldsValue === 'function') viewer.updateFormFieldsValue(upd)
            if (viewer.formDesignerModule && typeof viewer.formDesignerModule.updateFormField === 'function') viewer.formDesignerModule.updateFormField({ name: fname }, { value: newVal, isReadOnly: true })
          } catch (e) { console.warn(`Failed to set field ${fname}:`, e) }
        }
      } catch (e) { console.warn('Error processing field', i, e) }
    }
    console.log('✅ [UpdateForm] Finished applying values')
    setShowBtn(false)
  }

  function checkManagerSignature() {
    try { const viewer = viewerRef.current; if (!viewer) return; const forms = viewer.retrieveFormFields() || []; const sig = forms.find(f => (f.name || f.fieldName || '').toString().toLowerCase() === 'managersignature'); const hasValue = sig && (sig.value || '').toString().trim() !== ''; setFinishEnabled(Boolean(hasValue)) } catch (e) { console.warn('checkManagerSignature error', e); setFinishEnabled(false) }
  }

  function downloadStart() { const viewer = viewerRef.current; if (!viewer) return; viewerRef.current.downloadFileName = pdfFileName }

  function MakeSignatureReadOnly() {
    const viewer = viewerRef.current; if (!viewer) return
    const forms = viewer.retrieveFormFields() || []
    const roleLower = (role || '').toString().toLowerCase()
    const isSiteOfficer = roleLower.includes('site') || (storedUserRole || '').toString().toLowerCase().includes('site')

    for (let i = 0; i < forms.length; i++) {
      try {
        const f = forms[i]
        const name = (f.name || f.fieldName || '').toString().toLowerCase()
        if (name === 'managersignature') {
          if (role !== 'Manager' && role !== 'Loan Officer') viewer.formDesignerModule.updateFormField(f, { isReadOnly: true })
          else viewer.formDesignerModule.updateFormField(f, { isReadOnly: false })
        }
        if (name === 'loanofficersignature') {
          if ((role !== 'Manager' && role !== 'Loan Officer') || isSiteOfficer) viewer.formDesignerModule.updateFormField(f, { isReadOnly: true })
          else viewer.formDesignerModule.updateFormField(f, { isReadOnly: false })
        }
      } catch (e) { /* ignore per-field errors */ }
    }
  }

  const openAttachmentInMainViewer = async (file) => {
    try {
      const viewer = viewerRef.current; if (!viewer || !file) return
      let src = null
      if (file.dataUrl && file.dataUrl.startsWith('data:')) src = file.dataUrl
      else if (file.url) src = file.url
      else if (file.name) src = `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(pdfFileName)}/${encodeURIComponent(file.name)}`
      if (!src) return

      setShowMenu(false); setIsAttachmentOpen(false)
      setTimeout(async () => {
        try {
          // If it's a remote URL, attempt robust fetch with fallback candidates to avoid 404s
          if (typeof src === 'string' && src.startsWith('http')) {
            try {
             let candidates = getAttachmentCandidates(pdfFileName, file.name
        ,file.originalName 
        ,'')
// include the direct src as first candidate
if (!candidates.includes(src)) candidates.unshift(src)
// keep only URLs matching API_BASE origin to avoid hitting a different backend
candidates = filterCandidatesToApiBaseOrigin(candidates)

              const res = await fetchAttachmentBlobWithCandidates(candidates)
              if (res && res.blob) {
                try {
                  const dataUrl = await blobToBase64(res.blob)
                  await safeViewerLoad(viewer, dataUrl)
                } catch (e) {
                  console.warn('openAttachmentInMainViewer: failed to convert blob to data URL', e)
                  await safeViewerLoad(viewer, src)
                }
              } else {
                await safeViewerLoad(viewer, src)
              }

            } catch (e) {
              try { await safeViewerLoad(viewer, src);} catch (err) { console.warn('Failed to load attachment into main viewer', err) }
            }
          } else {
            try { await safeViewerLoad(viewer, src) } catch (e) { console.warn('Failed to load attachment into main viewer (fallback)', e); try { if (viewer.load) viewer.load(src, null); else if (viewer.open) viewer.open(src) } catch (err) { console.warn('Fallback viewer.load/open also failed', err) } }
          }
        } catch (e) { console.warn('Failed to load attachment into main viewer', e) }
        setTimeout(() => { try { if (viewer && typeof viewer.resize === 'function') viewer.resize(); else window.dispatchEvent(new Event('resize')) } catch (e) { console.warn('viewer resize failed', e) } }, 250)
      }, 120)
    } catch (e) { console.error('openAttachmentInMainViewer error', e) }
  }

  const persistAttachments = (list, explicitLoanId) => {
    try {
      const count = (list || []).filter(f => !f.pending).length
      let id = explicitLoanId || loanId
      if (!id && pdfFileName) {
        const m = (pdfFileName.match(/(\d+)(?=\.pdf$)/) || [])[0]
        if (m) id = String(m)
        else {
          const m2 = pdfFileName.match(/_(\d+)$/)
          if (m2 && m2[1]) id = String(m2[1])
        }
      }
      if (!id) { console.warn('persistAttachments: no loanId or numeric id found; skipping persist'); return }
      try { sessionStorage.setItem(`attachmentsCount_${id}`, String(count)) } catch {}
      try { localStorage.setItem(`attachmentsCount_${id}`, String(count)) } catch {}
      try { window.dispatchEvent(new CustomEvent('attachmentsCountUpdated', { detail: { loanId: id, count } })) } catch {}
    } catch (e) { console.error('Failed to persist attachments count', e) }
  }

  const persistDeletedAttachments = () => {
    try {
      let docId = loanId
      if (!docId && pdfFileName) { const m = (pdfFileName.match(/(\d+)(?=\.pdf$)/) || [])[0]; if (m) docId = String(m) }
      if (!docId) { console.warn('persistDeletedAttachments: no docId found'); return }
      const storageKey = `deletedAttachments_${docId}`
      const deletedList = Array.from(deletedAttachmentsRef.current)
      try { localStorage.setItem(storageKey, JSON.stringify(deletedList)) } catch {}
      try { sessionStorage.setItem(storageKey, JSON.stringify(deletedList)) } catch {}
    } catch (e) { console.error('Failed to persist deleted attachments', e) }
  }

  useEffect(() => { try { persistAttachments(uploadedFiles) } catch (e) { console.error('persistAttachments effect error', e) } }, [uploadedFiles])

  useEffect(() => {
    try {
      let docId = loanId
      if (!docId && pdfFileName) { const m = (pdfFileName.match(/(\d+)(?=\.pdf$)/) || [])[0]; if (m) docId = String(m) }
      if (docId) {
        const storageKey = `deletedAttachments_${docId}`
        const stored = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey)
        if (stored) { try { const deletedList = JSON.parse(stored); if (Array.isArray(deletedList)) deletedAttachmentsRef.current = new Set(deletedList) } catch {} }
      }
    } catch (e) { console.error('Failed to load deleted attachments', e) }
  }, [loanId, pdfFileName])

  useEffect(() => () => {
    setUploadedFiles(prev => {
      const hasPending = prev.some(f => f.pending)
      if (hasPending) {
        const serverFiles = prev.filter(f => !f.pending)
        persistAttachments(serverFiles)
        return serverFiles
      }
      return prev
    })
  }, [])

  const fetchServerAttachments = async (filename) => {
    if (!filename) return
    try {
      const base = API_BASE
      const resp = await fetch(`${base}/api/Authentication/GetPdfAttachments/${encodeURIComponent(filename)}`)
      if (!resp.ok) return
      const json = await resp.json()
      let list = []
      if (Array.isArray(json)) list = json
      else if (json && Array.isArray(json.attachments)) list = json.attachments
      else if (json && json.data && Array.isArray(json.data.attachments)) list = json.data.attachments
      else if (json && typeof json === 'object') { const vals = Object.values(json); for (const v of vals) if (Array.isArray(v)) { list = v; break } }
      if (!list || list.length === 0) { setUploadedFiles([]); persistAttachments([]); return }
      const files = list.map((a, idx) => {
        if (typeof a === 'string') {
          const fname = a
          return { id: Date.now() + idx, name: fname, originalName: fname, url: `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(filename)}/${encodeURIComponent(fname)}`, size: '', type: 'application/octet-stream', uploadedAt: new Date().toLocaleString(), pending: false }
        }
        const fname = a.fileName || a.name || a.filename || a.file || (`attachment_${idx}`)
        const url = a.url || `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(filename)}/${encodeURIComponent(fname)}`
        return { id: Date.now() + idx, name: fname, originalName: a.originalName || a.name || a.fileName || fname, url, size: a.size || '', type: a.type || 'application/octet-stream', uploadedAt: a.uploadedAt || new Date().toLocaleString(), pending: false }
      })
      const filteredFiles = files.filter(f => !deletedAttachmentsRef.current.has(f.name))
      setUploadedFiles(filteredFiles)
      const derivedId = (filename && (filename.match(/(\d+)(?=\.pdf$)/) || [])[0]) || null
      persistAttachments(filteredFiles, derivedId)
    } catch (e) { console.error('fetchServerAttachments error', e) }
  }

  const tryParseBody = async (resp) => { try { return await resp.json() } catch { try { return await resp.text() } catch { return null } } }

  const deleteFileFromServer = async (fileName) => {
    const base = API_BASE
    const candidates = [
      `${base}/api/Authentication/DeleteFile`, `${base}/api/PdfViewer/DeleteFile`, `${base}/api/pdfviewer/DeleteFile`, `${base}/pdfviewer/DeleteFile`, `${base}/api/DeleteFile`, `${base}/DeleteFile`,
      `${base}/api/PdfViewer/DeleteFile/${encodeURIComponent(fileName)}`, `${base}/api/Authentication/DeleteFile/${encodeURIComponent(fileName)}`
    ]
    let lastError = null

    const viewer = viewerRef.current
    const blob = await viewer.saveAsBlob()
    const base64 = await blobToBase64(blob)

    for (const endpoint of candidates) {
      try {
        const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName, base64 }) })
        const data = await tryParseBody(resp)
        if (resp.ok) return { success: true, data }
        lastError = { status: resp.status, message: data }
        if (resp.status !== 404) return { success: false, status: resp.status, message: data }
      } catch (err) { lastError = err }
    }

    for (const baseEndpoint of candidates) {
      const endpoint = `${baseEndpoint}?fileName=${encodeURIComponent(fileName)}`
      try {
        const resp = await fetch(endpoint, { method: 'DELETE' })
        const data = await tryParseBody(resp)
        if (resp.ok) return { success: true, data }
        lastError = { status: resp.status, message: data }
        if (resp.status !== 404) return { success: false, status: resp.status, message: data }
      } catch (err) { lastError = err }
    }

    for (const endpoint of candidates) {
      try {
        const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName }) })
        const data = await tryParseBody(resp)
        if (resp.ok) return { success: true, data }
        lastError = { status: resp.status, message: data }
        if (resp.status !== 404) return { success: false, status: resp.status, message: data }
      } catch (err) { lastError = err }
    }

    console.error('All delete attempts failed', lastError)
    return { success: false, message: lastError && (lastError.message || lastError) }
  }

  const handleRemoveFile = async (fileId) => {
    if (fileId) {
      const fileToRemove = uploadedFiles.find(file => file.id === fileId)
      if (fileToRemove) {
        if (window.confirm(`Are you sure you want to remove "${fileToRemove.name}"?`)) {
          if (fileToRemove.pending) {
            setUploadedFiles(prev => { const next = prev.filter(file => file.id !== fileId); persistAttachments(next); return next })
            alert('File removed')
          } else {
            const result = await deleteFileFromServer(fileToRemove.name)
            deletedAttachmentsRef.current.add(fileToRemove.name)
            persistDeletedAttachments()
            setUploadedFiles(prev => { const next = prev.filter(file => file.id !== fileId); persistAttachments(next); return next })
            if (result.success) alert('File deleted successfully!')
            else alert('File removed from view (server deletion may have failed - check console)')
          }
        }
      }
    } else {
      if (uploadedFiles.length > 0) {
        if (window.confirm(`Are you sure you want to remove all ${uploadedFiles.length} file(s)?`)) {
          const pending = uploadedFiles.filter(f => f.pending)
          const serverFiles = uploadedFiles.filter(f => !f.pending)
          let deletedCount = 0
          if (pending.length) deletedCount += pending.length
          for (const file of serverFiles) { const result = await deleteFileFromServer(file.name); deletedAttachmentsRef.current.add(file.name); if (result.success) deletedCount++ }
          persistDeletedAttachments(); setUploadedFiles([]); persistAttachments([])
          alert(`All ${deletedCount} file(s) removed from view!`)
        }
      } else { alert('No files to remove') }
    }
    setShowMenu(false)
  }

  const clearPendingAttachments = () => {
    setUploadedFiles(prev => {
      const hasPending = prev.some(f => f.pending)
      if (hasPending) { const serverFiles = prev.filter(f => !f.pending); persistAttachments(serverFiles); return serverFiles }
      return prev
    })
  }

  const toolbarClick = useCallback((args) => { if (args && args.item && args.item.id === 'attachment_button') { setIsAttachmentOpen(v => !v); setShowMenu(false) } }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    const adjust = () => { try { if (viewer && typeof viewer.resize === 'function') viewer.resize(); else window.dispatchEvent(new Event('resize')) } catch (e) { console.warn('viewer resize failed', e) } }
    const t = setTimeout(adjust, 150)
    return () => clearTimeout(t)
  }, [isAttachmentOpen])

  useEffect(() => {
    let active = true
    let objectUrl = null
    const prepare = async () => {
      if (!viewingFile) { setModalSrc(null); setModalLoading(false); return }
      setModalLoading(true)
      try {
        if (viewingFile.dataUrl && viewingFile.dataUrl.startsWith('data:')) { if (active) setModalSrc(viewingFile.dataUrl); return }
        if (viewingFile.url) { if (active) setModalSrc(viewingFile.url); return }
        if (viewingFile.name) {
          const candidate = `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(pdfFileName)}/${encodeURIComponent(viewingFile.name)}`
          if (active) {
            // Only set the server candidate URL when the modal is actually open for viewing.
            if (isAttachmentViewing) setModalSrc(candidate)
            else setModalSrc(null)
          }
          return
        }
        setModalSrc(null)
      } catch (e) { console.error('Error preparing modal source', e); if (active) setModalSrc(null) }
      finally { if (active) setModalLoading(false) }
    }
    prepare()
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [viewingFile, pdfFileName])

  // Ensure any existing modal viewer instance is destroyed before opening a new one
  useEffect(() => {
    if (isAttachmentViewing) {
      try {
        const mv = modalViewerRef.current
        if (mv && typeof mv.destroy === 'function') {
          try { mv.destroy(); } catch (e) { /* ignore */ }
          modalViewerRef.current = null
        }
      } catch (e) {}
    }
  }, [isAttachmentViewing])

  // bump modalInstanceKey whenever modalSrc or viewingFile changes to force remount
  useEffect(() => {
    if (modalSrc || viewingFile) setModalInstanceKey(k => k + 1)
  }, [modalSrc, viewingFile])

  // Robustly load modal attachments by fetching as blob and calling viewer.load(blobUrl)
  useEffect(() => {
    let active = true
    const loadModalAttachment = async () => {
      modalFetchDoneRef.current = false;    // <- reset each time the modal starts a new load
      setModalLoadError(false)
      // If this modal is opened for an in-memory attachment (data URL),
      // skip the auto-fetch loader — the `attachmentResourcesLoaded`
      // handler will load the document directly.
      if (viewingFile && viewingFile.dataUrl) {
        setModalLoading(false)
        return
      }

      if (!isAttachmentViewing || !modalSrc) {
        setModalLoading(false)
        return
      }
      setModalLoading(true)
      try {
        // If already a data: or blob: URL, load directly
        if (typeof modalSrc === 'string' && (modalSrc.startsWith('data:') || modalSrc.startsWith('blob:'))) {
          // revoke any previously-created object URL if different
          if (lastObjectUrlRef.current && lastObjectUrlRef.current !== modalSrc) {
            try { URL.revokeObjectURL(lastObjectUrlRef.current) } catch (e) {}
            lastObjectUrlRef.current = null
          }
          const mv = modalViewerRef.current
          if (mv) {
            try { await safeViewerLoad(mv, modalSrc); modalFetchDoneRef.current = true; } catch (e) { console.warn('modal viewer load error', e); setModalLoadError(true) }
          }
          setModalLoading(false)
          return
        }

        // Use robust multi-candidate fetch to tolerate different server URL patterns
        let blobUrl = null
        try {
          const attachmentName = (viewingFile && (viewingFile.name || viewingFile.originalName)) || null
          const candidates = (typeof modalSrc === 'string' && modalSrc.startsWith('http'))
            ? getAttachmentCandidates(pdfFileName, attachmentName || modalSrc.split('/').pop())
            : [modalSrc]
          if (typeof modalSrc === 'string' && modalSrc.startsWith('http') && !candidates.includes(modalSrc)) candidates.unshift(modalSrc)
          const res = await fetchAttachmentBlobWithCandidates(candidates)
          if (res && res.blob) {
            try {
              const dataUrl = await blobToBase64(res.blob)
              blobUrl = dataUrl
            } catch (e) {
              console.warn('Modal loader: failed to convert blob to data URL', e)
              // fall back to object URL if conversion fails
              if (res.blobUrl) blobUrl = res.blobUrl
            }
          }
        } catch (err) {
          console.warn('Modal attachment fetch failed (all candidates)', err, modalSrc)
          setModalLoadError(true)
          setModalLoading(false)
          return
        }

        if (!active) return
        if (!blobUrl) { setModalLoadError(true); setModalLoading(false); return }

        const mv = modalViewerRef.current
        if (mv) {
          try { await safeViewerLoad(mv, blobUrl); modalFetchDoneRef.current = true; } catch (e) { console.warn('modal viewer load failed', e); setModalLoadError(true) }
        }
        setModalLoading(false)
      } catch (err) {
        console.warn('loadModalAttachment error', err)
        if (active) {
          setModalLoadError(true)
          setModalLoading(false)
        }
      }
    }
    loadModalAttachment()
    return () => { active = false }
  }, [modalSrc, modalInstanceKey, isAttachmentViewing, viewingFile])

  const closeModal = () => { setViewingFile(null); setIsAttachmentViewing(false); setModalSrc(null); setModalLoading(false); if (lastObjectUrlRef.current) { try { URL.revokeObjectURL(lastObjectUrlRef.current) } catch {} lastObjectUrlRef.current = null } }

  useEffect(() => {
    const onDocMouseDown = (e) => { try { if (!contextMenu.visible) return; if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) setContextMenu({ visible: false, x: 0, y: 0, fileId: null }) } catch {} }
    const onDocKey = (e) => { if (e.key === 'Escape') setContextMenu({ visible: false, x: 0, y: 0, fileId: null }) }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKey)
    return () => { document.removeEventListener('mousedown', onDocMouseDown); document.removeEventListener('keydown', onDocKey) }
  }, [contextMenu.visible])

  // Close Info/Approval dropdowns when clicking outside them or their buttons
  useEffect(() => {
    const handler = (e) => {
      try {
        const tgt = e.target
        if (infoMenuRef.current && infoMenuRef.current.contains(tgt)) return
        if (approvalMenuRef.current && approvalMenuRef.current.contains(tgt)) return
        if (infoBtnRef.current && infoBtnRef.current.contains(tgt)) return
        if (approvalBtnRef.current && approvalBtnRef.current.contains(tgt)) return
        setShowInfoMenu(false)
        setShowApprovalMenu(false)
      } catch (err) {}
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { if (!contextMenu.visible) return; const adjust = () => { try { const el = contextMenuRef.current; if (!el) return; const rect = el.getBoundingClientRect(); let newX = contextMenu.x; let newY = contextMenu.y; const margin = 8; if (rect.right > window.innerWidth) newX = Math.max(margin, window.innerWidth - rect.width - margin); if (rect.bottom > window.innerHeight) newY = Math.max(margin, window.innerHeight - rect.height - margin); if (newX !== contextMenu.x || newY !== contextMenu.y) setContextMenu(prev => ({ ...prev, x: newX, y: newY })) } catch {} }; requestAnimationFrame(adjust) }, [contextMenu.visible, contextMenu.x, contextMenu.y])

  // ===== Custom Stamp → open file explorer =====
  const CUSTOM_STAMP_NAME = 'Add Attachment'
  const onAnnotationSelect = React.useCallback((args) => {
    if (!args) return
    const shapeType = args.shapeAnnotationType || args.annotation?.shapeAnnotationType || null
    const { annotationType, annotation } = args
    const isStamp = args.annotationCollection && args.annotationCollection[0].shapeAnnotationType == 'stamp';
    if (!isStamp) return
    const isOurCustomStamp = annotation?.customStampName === CUSTOM_STAMP_NAME || annotation?.subject === CUSTOM_STAMP_NAME
    // if (!isOurCustomStamp) return
    if (stampFileInputRef.current) { stampFileInputRef.current.value = ''; setTimeout(() => stampFileInputRef.current?.click(), 0) }
    // re-evaluate fields after an annotation interaction (covers drawn signatures)
    try { setTimeout(() => { try { evaluateFields() } catch (e) {} }, 120) } catch (e) {}
  }, [])

  // Stamp-exclusive onChange: also writes the file name into any matching attachment textbox
  const onStampFileChange = React.useCallback(async (evt) => {
    const files = Array.from(evt.target.files || [])
    if (!files.length) return
    const firstFile = files[0]
    try { await handleAttach(firstFile) } catch (e) { console.warn(e) }
    try {
      const viewer = viewerRef.current?.ej2Instances || viewerRef.current
      if (viewer && typeof viewer.retrieveFormFields === 'function') {
        const fields = viewer.retrieveFormFields() || []
        const allowed = ['aadharattach', 'panattach', 'panatatch', 'salaryattach', 'bankattach', 'drivingattach', 'passportattach']
        // determine selected stamp's author (if any) and only set field when author === field name
        const selected = viewer.selectedItems || (viewer.annotation && viewer.annotation.selectedItems) || null
        let stampAuthor = null
        try {
          if (selected && Array.isArray(selected.annotations) && selected.annotations[0]) {
            const ann = selected.annotations[0]
            stampAuthor = (ann.author || ann.Author || (ann.review && ann.review.author) || '')
            stampAuthor = (stampAuthor || '').toString().toLowerCase().trim()
          }
        } catch (e) { stampAuthor = null }

        // prefer the first matching empty field (and only those matching the stamp author when available), otherwise set the first matching field
        let setOn = null
        for (let i = 0; i < fields.length; i++) {
          const name = (fields[i].name || fields[i].fieldName || '').toString().toLowerCase().trim()
          if (!name) continue
          if (!allowed.includes(name)) continue
          // if we know the stamp's author, only consider fields whose name matches it
          if (stampAuthor && stampAuthor !== name) continue
          if (!fields[i].value) { setOn = fields[i]; break }
          if (!setOn) setOn = fields[i]
        }
        if (setOn) {
          try {
            setOn.value = firstFile.name
            if (typeof viewer.updateFormFieldsValue === 'function') viewer.updateFormFieldsValue(setOn)
            if (viewer.formDesignerModule && typeof viewer.formDesignerModule.updateFormField === 'function') viewer.formDesignerModule.updateFormField(setOn, { value: firstFile.name })
            try { applyClickableToField(setOn.name) } catch {}
            try { markFieldClickableByValue(firstFile.name) } catch {}
                // NOTE: Do not call saveAttachmentToServer here. Keep attachment pending
                // so it will be saved along with the form when the user clicks Submit.
          } catch (err) { console.warn('Failed to update form field value', err) }
        }
      }
    } catch (e) { console.warn('Failed to set textbox value', e) }
    evt.target.value = ''
  }, [handleAttach])

  // === NEW: Click inside PDF textbox (attachment fields) → open the same modal viewer as attachments ===
  const CLICKABLE_FIELD_NAMES = useMemo(() => [
    'aadharattach', 'panattach', 'panatatch', 'salaryattach', 'bankattach', 'drivingattach', 'passportattach'
  ], [])

  const findUploadedByName = useCallback((name) => {
    const n = (name || '').trim().toLowerCase()
    return (uploadedFiles || []).find(f => (f.name && f.name.toLowerCase() === n) || (f.originalName && f.originalName.toLowerCase() === n))
  }, [uploadedFiles])

  // Save a single attachment to the server via SaveFilledForms so it becomes persistent
  const saveAttachmentToServer = useCallback(async (file, displayName) => {
    try {
      if (!file) return null
      const viewer = viewerRef.current
      if (!viewer || typeof viewer.saveAsBlob !== 'function') {
        console.warn('Viewer not ready to save PDF blob')
      }

      let pdfBase64 = null
      try {
        const blob = await viewer.saveAsBlob()
        pdfBase64 = await blobToBase64(blob)
      } catch (e) { console.warn('Failed to get PDF blob for saveAttachmentToServer', e) }

      const user = JSON.parse(localStorage.getItem('user') || 'null')
      const username = user?.username || user?.name || null
      const fileId = count

      let fileName
      if ((role !== 'Manager' && role !== 'Loan Officer') && loanStatus !== LoanStatus.SIGN_REQUIRED && pdfFileName === 'Loan_Application_Form') {
        fileName = `${role}_${fileId}`
      } else if (loanStatus === LoanStatus.APPROVED && !pdfFileName.toLowerCase().includes('sanction')) {
        fileName = `${pdfFileName}_Sanction_Letter`
      } else {
        fileName = pdfFileName
      }

      const documentId = loanId || getDocumentId(displayName || '', fileId)
      const attachmentName = (displayName && String(displayName).trim()) || file.name
      const attachmentsPayload = [{ name: attachmentName, base64: await fileToBase64(file), type: file.type || 'application/octet-stream', originalName: file.name }]

      const resp = await fetch(`${API_BASE}/api/Authentication/SaveFilledForms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: pdfBase64, fileName: (displayName || fileName), username, status: window.currentAction, documentId, customerName: username, attachments: attachmentsPayload })
      })

      let json = null
      try { json = await resp.json() } catch {}

      if (resp.ok) {
        try {
          // If server returned attachments, refresh local uploaded list
          if (json && Array.isArray(json.attachments) && json.attachments.length > 0) {
            const savedFiles = json.attachments.map((a, idx) => {
              const fname = a.fileName || a.name || a.originalName || attachmentName || `attachment_${idx}`
              const url = a.url || `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(json.fileName || fileName)}/${encodeURIComponent(fname)}`
              return { id: Date.now() + idx, name: fname, originalName: a.originalName || a.name || (attachmentName || fname), url, size: a.size || '', type: a.type || 'application/octet-stream', uploadedAt: a.uploadedAt || new Date().toLocaleString(), pending: false }
            })
            setUploadedFiles(prev => {
              // merge: remove any pending with same name, add savedFiles
              const next = (prev || []).filter(p => !savedFiles.some(sf => sf.name === p.name || sf.name === p.originalName))
              return [...next, ...savedFiles]
            })
            try { persistAttachments(savedFiles, documentId) } catch {}
            return savedFiles
          }
        } catch (e) { console.warn('Error processing saveAttachmentToServer response', e) }
        // fallback: mark matching uploadedFiles as not pending and ensure url exists
        setUploadedFiles(prev => {
          return (prev || []).map(p => {
            if (p.name === file.name || p.originalName === file.name) return { ...p, name: attachmentName, pending: false, url: p.url || `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(fileName)}/${encodeURIComponent(attachmentName)}` }
            return p
          })
        })
        try { persistAttachments(uploadedFiles || [], documentId) } catch {}
        return { success: true }
      } else {
        console.error('saveAttachmentToServer failed', resp.status, json)
        return { success: false, status: resp.status, message: json }
      }
    } catch (err) { console.error('saveAttachmentToServer error', err); return { success: false, error: err } }
  }, [API_BASE, pdfFileName, role, loanStatus, count, fileToBase64, blobToBase64, getDocumentId, persistAttachments, uploadedFiles])

  const openAttachmentByName = useCallback((name) => {
    if (!name) return
    const n = (name || '').toString().trim()
    const fileExact = findUploadedByName(n)
    if (fileExact) {
      setViewingFile(fileExact)
      setIsAttachmentViewing(true)
    //   return
    }

    // tolerant matching: try contains / filename without extension matches
    const nl = n.toLowerCase()
    const tolerant = (uploadedFiles || []).find(f => {
      try {
        const fn = (f.name || f.originalName || '').toString().toLowerCase()
        if (!fn) return false
        if (fn === nl) return true
        if (fn.includes(nl) || nl.includes(fn)) return true
        const strip = (s) => s.replace(/\.pdf$/i, '')
        if (strip(fn) === strip(nl)) return true
      } catch (e) {}
      return false
    })
    if (tolerant) {
      setViewingFile(tolerant)
      setIsAttachmentViewing(true)
    //   return
    }

    // fallback: construct a candidate URL from server endpoint so viewer can open it
    try {
      if (pdfFileName) {
        const candidateUrl = `${API_BASE}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(pdfFileName)}/${encodeURIComponent(n)}`
        setViewingFile({ id: Date.now(), name: n, originalName: n, url: candidateUrl })
        setIsAttachmentViewing(true)
        return
      }
    } catch (e) { /* ignore */ }

    alert('Attachment not found for: ' + name)
  }, [findUploadedByName])

  // Robustly mark any rendered input/textarea whose value matches `name` as clickable
  const markFieldClickableByValue = useCallback((name) => {
    try {
      if (!name) return
      const display = (name || '').toString().trim()
      if (!display) return
      if (!document.getElementById('pdf-attachment-clickable-style')) {
        const style = document.createElement('style')
        style.id = 'pdf-attachment-clickable-style'
        style.innerHTML = `.pdf-attachment-clickable{cursor:pointer;text-decoration:underline;color:#0645AD}`
        document.head.appendChild(style)
      }
      const els = Array.from(document.querySelectorAll('input, textarea, [data-name]'))
      for (const el of els) {
        try {
          const val = (el.value || el.getAttribute('value') || el.textContent || '').toString().trim()
          if (!val) continue
          if (val === display) {
            el.classList.add('pdf-attachment-clickable')
            el.style.cursor = 'pointer'
            el.style.textDecoration = 'underline'
            if (!el.getAttribute('data-pdf-attachment-listener')) {
              const handler = (ev) => {
                try {
                  ev.preventDefault(); ev.stopPropagation()
                  if (typeof openAttachmentByName === 'function') openAttachmentByName(display)
                } catch (e) {}
              }
              el.addEventListener('click', handler)
              el.setAttribute('data-pdf-attachment-listener', '1')
            }
          }
        } catch (e) { /* noop */ }
      }
    } catch (e) { /* noop */ }
  }, [openAttachmentByName])

  // When uploadedFiles change, scan PDF form fields and mark matching fields as clickable
  useEffect(() => {
    try {
      const viewer = viewerRef.current?.ej2Instances || viewerRef.current
      if (!viewer || typeof viewer.retrieveFormFields !== 'function') return
      const fields = viewer.retrieveFormFields() || []
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]
        const val = (f.value || '').toString().trim()
        if (!val) continue
        const matched = findUploadedByName(val)
        if (matched) {
          try { applyClickableToField(f.name) } catch (e) { /* noop */ }
        }
      }
    } catch (e) { /* noop */ }
  }, [uploadedFiles, pdfFileName, findUploadedByName])

  useEffect(() => {
    // Attach a delegated click handler on the viewer container
    const container = document.getElementById('container')
    if (!container) return

    const getFieldNameFromNode = (node) => {
      if (!node || typeof node.getAttribute !== 'function') return null
      const attrs = ['name', 'data-name', 'aria-label', 'title', 'placeholder']
      for (const a of attrs) {
        const v = node.getAttribute(a)
        if (v) return v
      }
      return null
    }

    const handler = (e) => {
      try {
        const node = e.target.closest('input, textarea, [data-name]')
        if (!node) return

        const value = (node.value || node.textContent || '').toString().trim()
        if (!value) return

        // If this element has been explicitly marked clickable, open immediately
        if (node.classList && node.classList.contains('pdf-attachment-clickable')) {
          e.preventDefault(); e.stopPropagation()
          const fileMatch = findUploadedByName(value)
          if (fileMatch) { setViewingFile(fileMatch); setIsAttachmentViewing(true); return }
          openAttachmentByName(value)
          return
        }

        const rawFieldName = getFieldNameFromNode(node)
        const fieldName = (rawFieldName || '').toString().trim().toLowerCase()
        if (!CLICKABLE_FIELD_NAMES.includes(fieldName)) return

        const readOnly = node.hasAttribute('readonly') || node.getAttribute('aria-readonly') === 'true' || node.classList.contains('e-pv-readonly')
        // If not read-only, require Ctrl/Cmd to avoid interrupting typing
        if (!readOnly && !(e.ctrlKey || e.metaKey)) return

        e.preventDefault(); e.stopPropagation()
        openAttachmentByName(value)
      } catch (err) { /* no-op */ }
    }

    container.addEventListener('click', handler, true)
    return () => container.removeEventListener('click', handler, true)
  }, [CLICKABLE_FIELD_NAMES, openAttachmentByName])

  // Global delegated listener: handle clicks on inputs/textareas anywhere in the document
  // If the clicked input's value matches a known uploaded file, open the attachment viewer.
  useEffect(() => {
    const docHandler = (e) => {
      try {
        const node = e.target.closest && e.target.closest('input, textarea, [data-name]')
        if (!node) return
        const attrValue = node.getAttribute ? node.getAttribute('value') : null
        const value = (node.value || attrValue || node.textContent || '').toString().trim()
        if (!value) return

        // If explicitly marked clickable, open immediately
        if (node.classList && node.classList.contains('pdf-attachment-clickable')) {
          e.preventDefault(); e.stopPropagation()
          const fileMatch = findUploadedByName(value)
          if (fileMatch) { setViewingFile(fileMatch); setIsAttachmentViewing(true); return }
          openAttachmentByName(value)
          return
        }

        // If the field name is one of the clickable fields and the value matches an uploaded file, open viewer.
        const rawFieldName = (node.getAttribute && (node.getAttribute('name') || node.getAttribute('data-name') || node.getAttribute('aria-label') || node.getAttribute('title'))) || ''
        const fieldName = (rawFieldName || '').toString().trim().toLowerCase()
        if (!fieldName) return

        if (CLICKABLE_FIELD_NAMES.includes(fieldName)) {
          const matched = findUploadedByName(value)
          if (matched) { e.preventDefault(); e.stopPropagation(); openAttachmentByName(value); return }
        }
      } catch (err) { /* silent */ }
    }

    document.addEventListener('click', docHandler, true)
    return () => document.removeEventListener('click', docHandler, true)
  }, [CLICKABLE_FIELD_NAMES, findUploadedByName, openAttachmentByName])

  // Existing helper: set textbox 5 when using the first hidden input (kept intact)
  const onFilesChosen = React.useCallback(async (evt) => {
    const files = Array.from(evt.target.files || [])
    if (!files.length) return
    const firstFile = files[0]
    const viewer = viewerRef.current?.ej2Instances || viewerRef.current
    if (!viewer) return
    // ensure the file is registered locally
    try { await handleAttach(firstFile) } catch (e) { console.warn('handleAttach failed', e) }
    const fields = (viewer.retrieveFormFields && viewer.retrieveFormFields()) || viewer.formFieldCollection || viewer.formFieldCollections || []
    const targetField = fields.find(f => typeof f?.name === 'string' && f.name.toLowerCase().trim() === 'textbox 5')
    if (targetField) {
      targetField.value = firstFile.name
      viewer.updateFormFieldsValue(targetField)
      try { applyClickableToField(targetField.name) } catch {}
      try { markFieldClickableByValue(firstFile.name) } catch {}
      // Intentionally not saving the attachment here. It will be persisted on Submit.
    }
  }, [])

  // Make a PDF form field visually clickable and read-only so clicking opens the viewer
  const applyClickableToField = (fieldName) => {
    try {
      if (!fieldName) return
      // inject style once
      if (!document.getElementById('pdf-attachment-clickable-style')) {
        const style = document.createElement('style')
        style.id = 'pdf-attachment-clickable-style'
        style.innerHTML = `.pdf-attachment-clickable{cursor:pointer;text-decoration:underline;color:#0645AD}`
        document.head.appendChild(style)
      }

      const namesToTry = [fieldName, (fieldName || '').toString().toLowerCase(), (fieldName || '').toString().trim()]
      const tried = new Set()
      for (const nm of namesToTry) {
        if (!nm || tried.has(nm)) continue
        tried.add(nm)
        const selectors = [`input[name="${nm}"]`, `textarea[name="${nm}"]`, `input[data-name="${nm}"]`, `textarea[data-name="${nm}"]`, `[aria-label="${nm}"]`, `[title="${nm}"]`]
        for (const sel of selectors) {
          try {
            const els = Array.from(document.querySelectorAll(sel))
            for (const el of els) {
                try {
                el.classList.add('pdf-attachment-clickable')
                el.style.cursor = 'pointer'
                el.style.textDecoration = 'underline'
                // attach a direct click handler so visible link opens the viewer
                if (!el.getAttribute('data-pdf-attachment-listener')) {
                  const handler = (ev) => {
                    try {
                      ev.preventDefault(); ev.stopPropagation()
                      const val = (el.value || el.textContent || el.getAttribute('value') || '').toString().trim()
                      if (!val) return
                      const fileMatch = findUploadedByName(val)
                      if (fileMatch) { setViewingFile(fileMatch); setIsAttachmentViewing(true); return }
                      if (typeof openAttachmentByName === 'function') openAttachmentByName(val)
                    } catch (e) { /* noop */ }
                  }
                  el.addEventListener('click', handler)
                  el.setAttribute('data-pdf-attachment-listener', '1')
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch (e) { /* silent */ }
  }

  // Set authors for first six custom stamp annotations when a document is loaded
  const setCustomStampAuthors = () => {

   const domViewer = (typeof document !== 'undefined' && document.getElementById('container') && document.getElementById('container').ej2_instances && document.getElementById('container').ej2_instances[0]) || null
const viewer = domViewer || viewerRef.current?.ej2Instances || viewerRef.current
if (!viewer) return

const coll = Array.isArray(viewer.annotationCollection)
  ? viewer.annotationCollection
  : (typeof viewer.annotationCollection === 'function' ? viewer.annotationCollection() : (viewer.annotationCollections || []))

const names = ['aadharattach','panattach','salaryattach','bankattach','drivingattach','passportattach']
const len = Math.min(coll.length, names.length)

for (let i = 0; i < len; i++) {
  const a = coll[i]
  if (!a) continue
  a.author = names[i]
  a.Author = names[i]
  a.review = a.review || {}
  a.review.author = names[i]

  // notify the viewer last so it persists/renders the change
  if (viewer && viewer.annotation && typeof viewer.annotation.editAnnotation === 'function') {
    viewer.annotation.editAnnotation(a)
  }
}
  }
   const attachmentResourcesLoaded = async (overrideName) => {
    try {
      if (modalFetchDoneRef.current) return;
      const mv = modalViewerRef.current
      if (!mv) return

      // Prefer explicit override -> modalSrc -> viewingFile.dataUrl -> viewingFile.url
      const src = overrideName || modalSrc || (viewingFile && (viewingFile.dataUrl || viewingFile.url))
      if (!src) return

      // Wait for modal viewer internals to be ready (ej2 instance / element)
      const waitForModalReady = async (timeout = 1200) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
          try {
            const inst = (mv && (mv.ej2Instances && mv.ej2Instances[0])) || mv.pdfViewer || mv
            const el = inst && (inst.element || mv.element || document.getElementById(`modalInnerViewer_${modalInstanceKey}`))
            if (el && document.body.contains(el)) return inst
          } catch (e) {}
          // small delay
          // eslint-disable-next-line no-await-in-loop
          await new Promise(r => setTimeout(r, 50))
        }
        return null
      }

      // If it's a data: or blob: url, call viewer.load/open directly
      if (typeof src === 'string' && (src.startsWith('data:') || src.startsWith('blob:'))) {
        try {
          const inst = await waitForModalReady()
          if (inst && typeof inst.load === 'function') { inst.load(src, null) }
          else if (inst && typeof inst.open === 'function') { inst.open(src) }
          else if (typeof mv.load === 'function') { mv.load(src, null) }
          else if (typeof mv.open === 'function') { mv.open(src) }
        } catch (e) { console.warn('attachmentResourcesLoaded: direct data/blob load failed', e) }
        return
      }

      // If viewingFile provides an in-memory dataUrl, use that
      if (viewingFile && viewingFile.dataUrl && typeof viewingFile.dataUrl === 'string') {
        try {
          const inst = await waitForModalReady()
          const srcUrl = viewingFile.dataUrl
          if (inst && typeof inst.load === 'function') inst.load(srcUrl, null)
          else if (inst && typeof inst.open === 'function') inst.open(srcUrl)
          else if (typeof mv.load === 'function') mv.load(srcUrl, null)
          else if (typeof mv.open === 'function') mv.open(srcUrl)
        } catch (e) { console.warn('attachmentResourcesLoaded: viewingFile.dataUrl load failed', e) }
        return
      }

      // For remote URLs: try robust fetch with retries (allow time for server availability)
      const candidate = (typeof src === 'string') ? src : (viewingFile && viewingFile.url) || null
      if (candidate && typeof candidate === 'string') {
        try {
          // Build candidate list using existing helper to try alternate server endpoints
          let candidates = (typeof candidate === 'string' && candidate.startsWith('http'))
            ? getAttachmentCandidates(pdfFileName, (viewingFile && (viewingFile.name || viewingFile.originalName)) || candidate.split('/').pop())
            : [candidate]
          if (typeof candidate === 'string' && candidate.startsWith('http') && !candidates.includes(candidate)) candidates.unshift(candidate)
          candidates = filterCandidatesToApiBaseOrigin(candidates)

          const maxAttempts = 4
          let attempt = 0
          let res = null
          while (attempt < maxAttempts) {
            try {
              res = await fetchAttachmentBlobWithCandidates(candidates)
              if (res && (res.blob || res.blobUrl)) break
            } catch (e) {
              // ignore and retry
            }
            attempt++
            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500))
          }

          if (res && (res.blob || res.blobUrl)) {
            if (lastObjectUrlRef.current) { try { URL.revokeObjectURL(lastObjectUrlRef.current) } catch (e) {} lastObjectUrlRef.current = null }
            // Prefer data URL (safe for viewer) created from blob
            try {
              if (res.blob) {
                const dataUrl = await blobToBase64(res.blob)
                lastObjectUrlRef.current = null
                const inst = await waitForModalReady()
                if (inst && typeof inst.load === 'function') inst.load(dataUrl, null)
                else if (inst && typeof inst.open === 'function') inst.open(dataUrl)
                else if (typeof mv.load === 'function') mv.load(dataUrl, null)
                else if (typeof mv.open === 'function') mv.open(dataUrl)
              } else {
                // fallback to object URL (less reliable across viewer internals)
                lastObjectUrlRef.current = res.blobUrl
                const inst = await waitForModalReady()
                if (inst && typeof inst.load === 'function') inst.load(res.blobUrl, null)
                else if (inst && typeof inst.open === 'function') inst.open(res.blobUrl)
                else if (typeof mv.load === 'function') mv.load(res.blobUrl, null)
                else if (typeof mv.open === 'function') mv.open(res.blobUrl)
              }
            } catch (e) { console.warn('attachmentResourcesLoaded: blob load failed', e); setModalLoadError(true) }
            return
          }
        } catch (e) { console.warn('attachmentResourcesLoaded: fetch failed', e) }
      }

      // Fallback: we were unable to obtain a blob for the remote candidate(s).
      // Do NOT pass raw http(s) URLs to the viewer (the viewer will try to fetch
      // them itself which causes the 'Failed to fetch' runtime error). Instead
      // mark a modal load error so the UI shows a friendly message.
      if (candidate) {
        console.warn('attachmentResourcesLoaded: unable to fetch blob for candidate, aborting viewer load to avoid remote fetch', candidate)
        try { setModalLoadError(true) } catch (e) {}
        return
      }
    } catch (e) { console.warn('attachmentResourcesLoaded error', e) }
  }


  const onDocumentLoad = () => {
    for(var i=0;i<viewerRef.current.annotationCollection.length;i++) {
      if(viewerRef.current.annotationCollection[i].shapeAnnotationType == 'stamp') {
      viewerRef.current.annotationCollection[i].allowedInteractions = ['Select'];
      viewerRef.current.annotation.editAnnotation(viewerRef.current.annotationCollection[i]);
      }
    }
    evaluateFields()
    // delay briefly to allow the viewer to populate annotationCollection
    try { setTimeout(() => { try { setCustomStampAuthors() } catch (e) {} }, 2000) } catch (e) {}
    // additional re-checks to catch late-loaded signature annotations/fields
    try { setTimeout(() => { try { evaluateFields() } catch (e) {} }, 300) } catch (e) {}
    try { setTimeout(() => { try { evaluateFields() } catch (e) {} }, 900) } catch (e) {}
    // Ensure readonly rules are applied on every document load so applicant fields
    // (personalinfo, employmentinfo, comments, sitedate, loan officer signature)
    // are set correctly for the current role.
   try { setTimeout(() => { try { readOnly() } catch (e) {} }, 300) } catch (e) {}
    MakeSignatureReadOnly()
    if (loanStatus === LoanStatus.APPROVED && sanctionMode && !pdfFileName.toLowerCase().includes('sanction')) { UpdateForm() }
}

  // Show action bar for staff (Manager/Loan Officer) always; applicants only see
  // the action bar when viewing an APPROVED sanction letter.
  // Replaced the previous const showActionBar = ...
const showActionBar = (
  // Normal action bar when NOT approved
  (loanStatus !== LoanStatus.APPROVED && (actionBar || role === 'Manager' || role === 'Loan Officer' || (
    ((role !== 'Manager' && role !== 'Loan Officer')) &&
    loanStatus === LoanStatus.APPROVED &&
    (sanctionMode || (pdfFileName && pdfFileName.toLowerCase().includes('sanction')))
  )))
  ||
  // After approval: show ONLY if sanction is open and manager signature missing (to allow Sign Request)
  (loanStatus === LoanStatus.APPROVED &&
   (sanctionMode || (pdfFileName && pdfFileName.toLowerCase().includes('sanction'))) &&
   !finishEnabled)
);


  // Final guard: Applicant in APPROVED -> lock all fields, but keep attachment placeholders editable
  useEffect(() => {
    try {
      if (loanStatus !== LoanStatus.APPROVED) return
      const roleLower = (role || '').toString().toLowerCase()
      const isStaff = roleLower.includes('manager') || roleLower.includes('loanofficer') || roleLower.includes('loan officer')
      if (isStaff) return
      const alwaysEditable = new Set(['aadharattach','panattach','panatatch','salaryattach','bankattach','drivingattach','passportattach'])
      const run = () => {
        try {
          const v = viewerRef.current; if (!v) return
          const getter = v.retrieveFormFields || (v.pdfViewer && v.pdfViewer.retrieveFormFields)
          const forms = (getter && getter.call(v)) || []
          for (let i=0;i<forms.length;i++) {
            try { const f = forms[i]; const nm = ((f.name || f.fieldName || '') + '').toLowerCase(); const editable = alwaysEditable.has(nm); if (v.formDesignerModule && typeof v.formDesignerModule.updateFormField === 'function') v.formDesignerModule.updateFormField(f, { isReadOnly: !editable }); else f.isReadOnly = !editable } catch (e) {}
          }
          const fdm = v.formDesignerModule
          if (fdm && typeof fdm.updateFormField === 'function' && !fdm.__wrappedApplicantApproved) {
            const orig = fdm.updateFormField.bind(fdm)
            fdm.updateFormField = function(field, opts) {
              try { const nm = (((field||{}).name || (field||{}).fieldName || '') + '').toLowerCase(); const editable = alwaysEditable.has(nm); const ro = !editable; if (!opts) opts = { isReadOnly: ro }; else opts.isReadOnly = ro } catch (e) {}
              try { return orig(field, opts) } catch (e) { return undefined }
            }
            fdm.__wrappedApplicantApproved = true
          }
          if (typeof v.updateFormFieldsValue === 'function' && !v.updateFormFieldsValue.__wrappedApplicantApproved) {
            const origUF = v.updateFormFieldsValue.bind(v)
            const w = function(arg) { let r; try { r = origUF(arg) } catch (e) {}; try { run() } catch (e) {}; return r }
            w.__wrappedApplicantApproved = true
            v.updateFormFieldsValue = w
          }
        } catch (e) {}
      }
      run()
      let ticks = 0
      const id = setInterval(() => { try { run() } catch (e) {} if (++ticks > 12) { try { clearInterval(id) } catch (e) {} } }, 250)
      return () => { try { clearInterval(id) } catch (e) {} }
    } catch (e) {}
  }, [role, loanStatus, pdfFileName])

  return (
    <div className="pdf-root">
      <div className="pdf-viewer-area" style={{ display: 'flex', width: '100%', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
        <div className={`pdf-viewer-column ${isAttachmentOpen ? 'with-panel' : 'full'}`} style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
          {/* Existing hidden input (kept): triggers onFilesChosen */}
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} multiple={false} onChange={onFilesChosen} />
          {/* Added: hidden input exclusively for stamp flow */}
          <input ref={stampFileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={onStampFileChange} />

          <PdfViewerComponent
            id="container"
            enableToolbar={true}
            resourceUrl="https://cdn.syncfusion.com/ej2/31.2.2/dist/ej2-pdfviewer-lib"
            toolbarSettings={{ showTooltip: true, toolbarItems: toolbarGroups }}
            toolbarClick={toolbarClick}
            ref={(inst) => (viewerRef.current = inst)}
            className="pdf-component"
            documentLoad={onDocumentLoad}
            enableLocalStorage={true}
            formFieldPropertiesChange={onFormFieldPropertiesChange}
            resourcesLoaded={resourcesLoaded}
            downloadStart={downloadStart}
            annotationSelect={onAnnotationSelect}
            style={{ width: '100%', height: '100%' }}
          >
            <Inject services={services} />
          </PdfViewerComponent>

          {
showActionBar && (

            <div className="pdf-actionbar">
              <div className="pdf-actionbar-inner">
                {role === 'Manager' && (
                  <>
                    {!sanctionMode ? (
                      <>
                        <button className={`button pdf-action-button reject`} onClick={handleReject}>Reject</button>
                        <button className={`button pdf-action-button approve ${showBtn ? 'enabled' : 'disabled'}`} disabled={!showBtn || loanStatus === LoanStatus.REJECTED} onClick={handleApproval}>Approval</button>
                      </>
                    ) : (
                      <>
                        <button
                          className={`button pdf-action-button request ${(signRequestEnabled && loanStatus !== LoanStatus.SIGN_REQUIRED) ? 'enabled' : 'disabled'}`}
                          onClick={handleSignRequest}
                          disabled={!(signRequestEnabled && loanStatus !== LoanStatus.SIGN_REQUIRED)}
                        >
                          Sign Request
                        </button>
                        <button className={`button pdf-action-button final`} onClick={handleFinish} disabled={!finishEnabled}>Finish</button>
                      </>
                    )}
                  </>
                )}

                {role === 'Loan Officer' && (
                  <>
                    <button className={`button pdf-action-button reject`} onClick={handleReject}>Reject</button>

                    <div style={{ position: 'relative', display: 'inline-block', marginLeft: 8 }}>
                      <button ref={infoBtnRef} className={`button pdf-action-button request`} disabled={loanStatus === LoanStatus.REJECTED} onClick={() => { setShowInfoMenu(v => !v); setShowApprovalMenu(false) }}>Info Required <span className="caret">▾</span></button>
                      {showInfoMenu && (
                        <div ref={infoMenuRef} style={{ position: 'absolute', bottom: 58, left: 0, zIndex: 1400, background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', borderRadius: 6, minWidth: 180 }}>
                          <div style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #eee' }} onClick={() => handleInfoChoice('need_clarification')}>Need clarification</div>
                          <div style={{ padding: 8, cursor: 'pointer' }} onClick={() => handleInfoChoice('attachment_missing')}>Attachment missing</div>
                        </div>
                      )}
                    </div>

                    <div style={{ position: 'relative', display: 'inline-block', marginLeft: 8 }}>
                      <button ref={approvalBtnRef} className={`button pdf-action-button final ${showBtn ? 'enabled' : 'disabled'}`} disabled={!showBtn} onClick={() => { setShowApprovalMenu(v => !v); setShowInfoMenu(false) }}>Approval <span className="caret">▾</span></button>
                      {showApprovalMenu && (
                        <div ref={approvalMenuRef} style={{ position: 'absolute', bottom: 58, left: 0, zIndex: 1400, background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', borderRadius: 6, minWidth: 200 }}>
                          {(() => {
                            const canSendToSite = loanStatus !== LoanStatus.SITE_VERIFIED
                            return (
                              <div
                                title={canSendToSite ? 'Send to Site Officer' : 'Disabled — already site verified'}
                                style={{ padding: 8, cursor: canSendToSite ? 'pointer' : 'not-allowed', borderBottom: '1px solid #eee', color: canSendToSite ? '#000' : '#999' }}
                                onClick={() => { if (!canSendToSite) return; handleApprovalChoice('send_to_site') }}
                              >
                                Send to Site Officer
                              </div>
                            )
                          })()}
                          {(() => {
                            const canApproveNow = isLoanOfficerSignatureFilled()
                            return (
                              <div
                                title={canApproveNow ? 'Approve application' : 'Approve requires Loan Officer signature'}
                                style={{ padding: 8, cursor: canApproveNow ? 'pointer' : 'not-allowed', color: canApproveNow ? '#000' : '#999' }}
                                onClick={() => { handleApprovalChoice('approved') }}
                              >
                                Approved
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  </>
                )}

               {(role !== 'Manager' && role !== 'Loan Officer' && loanStatus !== LoanStatus.INFO_UPDATED && loanStatus !== LoanStatus.APPROVED) && (
                  <button className={`button pdf-action-button approve ${canSubmit ? 'enabled' : 'disabled'}`} disabled={!canSubmit} onClick={() => canSubmit && handleSubmit()}>Submit</button>
                )}
              </div>
            </div>
          )}
        </div>

        {isAttachmentOpen && (
          <div onClick={() => setShowMenu(false)} style={{ position: 'relative', flex: '0 0 20%', maxWidth: '20%', height: '100%', border: '1px solid #e6e6e6', borderLeft: '1px solid #e6e6e6', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', fontFamily: 'Roboto, "Segoe UI", sans-serif', overflow: 'hidden', transition: 'flex-basis 150ms ease', paddingTop: '0' }}>
            <div className="attachment-header" style={{ position: 'sticky', top: 20, height: 36, display: 'flex', alignItems: 'center', padding: '0 8px', borderBottom: '1px solid #e6e6e6', backgroundColor: '#ffffff', zIndex: 2 }}>
              <h2 style={{ margin: 0, fontWeight: 600, fontSize: '20px', flex: 1, color: '#323232', lineHeight: '36px', transform: 'translateY(-10px)' }}>Attachments</h2>
              <button onClick={(e) => { e.stopPropagation(); setIsAttachmentOpen(false); setShowMenu(false) }} aria-label="Close attachments" style={{ background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, transform: 'translateY(-10px)' }} title="Close attachments">
                <span className="e-icons e-close" style={{ fontSize: 14, color: '#6c757d', lineHeight: '28px', display: 'inline-block' }} />
              </button>
            </div>

            <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, fileId: null }); setShowMenu(false) }} className="attachment-list" style={{ padding: 12, overflowY: 'auto', flex: 1, backgroundColor: '#ffffff' }}>
              {uploadedFiles.length === 0 ? (
                <div style={{ color: '#666', marginTop: 12 }}>No files uploaded yet.<br />Right-click to add attachments.</div>
              ) : (
                uploadedFiles.map((file) => (
                  <div key={file.id} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, fileId: file.id }); setShowMenu(false) }} className="attachment-item" style={{ padding: '8px 6px', borderBottom: '1px solid #eee' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
                        <div onClick={() => { setViewingFile(file); setIsAttachmentViewing(true); setContextMenu({ visible: false, x: 0, y: 0, fileId: null }) }} style={{ fontWeight: 'normal', marginTop: 6, marginBottom: 4, cursor: 'pointer' }} title="Open attachment">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                            <span style={{ fontSize: 14, flex: '0 0 auto' }}>📎</span>
                            <span style={{ display: 'block', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }} title={file.originalName || file.name}>{file.originalName || file.name}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>Size: {file.size}</div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Uploaded: {file.uploadedAt}</div>
                  </div>
                ))
              )}

              {/* modal moved out to render globally so clicks open viewer even when attachments panel is closed */}
            </div>
          </div>
        )}
      </div>

      {/* Existing bottom hidden input (kept): context menu add attachment */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept="application/pdf" />

      {contextMenu.visible && (
        <div ref={contextMenuRef} onMouseDown={(e) => e.stopPropagation()} style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 2000, background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', borderRadius: 6, minWidth: 160, padding: '6px 0' }}>
          <div
            title={canManageAttachments ? 'Add attachment' : 'Adding attachments is disabled'}
            style={{ padding: '8px 14px', cursor: canManageAttachments ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', opacity: canManageAttachments ? 1 : 0.5 }}
            onClick={(ev) => { ev.stopPropagation(); setContextMenu({ visible: false, x: 0, y: 0, fileId: null }); if (canManageAttachments) handleOpenFile() }}
          >
            <span style={{ marginRight: 8 }} className="e-icons e-plus" /> Add Attachment
          </div>
          {contextMenu.fileId != null && (
            <div
              title={canManageAttachments ? 'Delete attachment' : 'Deleting attachments is disabled'}
              style={{ padding: '8px 14px', cursor: canManageAttachments ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', opacity: canManageAttachments ? 1 : 0.5 }}
              onClick={(ev) => { ev.stopPropagation(); const id = contextMenu.fileId; setContextMenu({ visible: false, x: 0, y: 0, fileId: null }); if (canManageAttachments && typeof handleRemoveFile === 'function') handleRemoveFile(id) }}
            >
              <span style={{ marginRight: 8 }} className="e-icons e-trash" /> Delete
            </div>
          )}
        </div>
      )}

      {isAttachmentViewing && viewingFile && (
        <div onClick={closeModal} className="attachment-modal-overlay" style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div onClick={(e) => e.stopPropagation()} className="attachment-modal" style={{ width: '80%', height: '80%', background: '#fff', borderRadius: 6, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <button onClick={closeModal} className="icon-button" title="Close" style={{ position: 'absolute', right: 10, top: 6, zIndex: 10, fontSize: 20 }}>✕</button>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ padding: 12, textAlign: 'center', fontWeight: 500, borderBottom: '1px solid #eee' }}>{viewingFile.originalName || viewingFile.name}</div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {(() => {
                  const candidate = modalSrc || (viewingFile && (typeof viewingFile.dataUrl === 'string' ? viewingFile.dataUrl : viewingFile.url))
                  if (!candidate) {
                    return (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                        <div>No preview available</div>
                      </div>
                    )
                  }
                  // If previous loading failed, show friendly message instead of letting the viewer throw
                  if (modalLoadError) {
                    return (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                        <div>No preview available</div>
                      </div>
                    )
                  }

                  return (
                    <AttachmentViewerErrorBoundary key={candidate}>
                      <PdfViewerComponent
                        key={modalInstanceKey}
                        id={`modalInnerViewer_${modalInstanceKey}`}
                        ref={modalViewerRef}
                        resourceUrl="https://cdn.syncfusion.com/ej2/31.2.2/dist/ej2-pdfviewer-lib"
                        enableToolbar={true}
                        enableNavigationToolbar={true}
                        enableLocalStorage={true}
                         resourcesLoaded={attachmentResourcesLoaded}
                        style={{ width: '100%', height: '100%' }}
                        toolbarSettings={{ showTooltip: true, toolbarItems: ['PageNavigationTool','MagnificationTool','SearchOption','DownloadOption'], showToolbar: true }}
                      >
                        <Inject services={[Toolbar, Magnification, Navigation, Annotation, LinkAnnotation, BookmarkView, ThumbnailView, Print, TextSelection, TextSearch, FormFields, FormDesigner]} />
                      </PdfViewerComponent>
                    </AttachmentViewerErrorBoundary>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
