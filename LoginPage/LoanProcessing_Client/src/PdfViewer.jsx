import React, { useState, useRef, useEffect } from 'react'
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

export default function PdfViewer({ file, role, loanStatus, count, setPdfFileName, setViewerMode, setLoanStatus, setFileCount, pdfFileName, sanctionMode, setSanctionMode, actionBar, loanId }) {
    const viewerRef = useRef(null)
    const fileInputRef = useRef(null)
    const modalViewerRef = useRef(null)
    const lastObjectUrlRef = useRef(null)
    const deletedAttachmentsRef = useRef(new Set()) // Track deleted attachment names
    // global variable to track last action invoked from this viewer
    if (typeof window !== 'undefined') {
        window.currentAction = window.currentAction || '';
    }
    const [showBtn, setShowBtn] = useState(true)
    const [sanctionValues, setSanctionValues] = useState(null)
    const [finishEnabled, setFinishEnabled] = useState(false)
    const [isAttachmentOpen, setIsAttachmentOpen] = useState(false)
    const [showMenu, setShowMenu] = useState(false)
    const [uploadedFiles, setUploadedFiles] = useState([])
    const [viewingFile, setViewingFile] = useState(null)
    const [modalSrc, setModalSrc] = useState(null)
    const [modalLoading, setModalLoading] = useState(false)
    const [isAttachmentViewing, setIsAttachmentViewing] = useState(false)
    // allow submit only when fields are complete and status is not already SUBMITTED
    const canSubmit = showBtn && loanStatus !== LoanStatus.SUBMITTED
    // Enable attachment operations: 
    // - Loan Officer: can manage when reviewing (SUBMITTED, UNDER_REVIEW states)
    // - Customer: can manage when document has NO status (initial creation) OR when INFO_REQUIRED (additional info requested)
    // - Manager: cannot manage (view only)
    const canManageAttachments = role !== 'Manager' && (
        (role === 'Loan Officer' && (loanStatus === LoanStatus.SUBMITTED || loanStatus === LoanStatus.UNDER_REVIEW)) ||
        (role !== 'Loan Officer' && role !== 'Manager' && (!loanStatus || loanStatus === LoanStatus.INFO_REQUIRED) && canSubmit)
    )
    const services = [
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
    ]

    // Build toolbar groups using Syncfusion's toolbar group keys
    const allGroups = [
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
    ]

    // Remove these groups for everyone
    const removeAlways = ['OpenOption', 'UndoRedoTool', 'DownloadOption']
    // Remove these for Customer
    const removeForCustomer = ['AnnotationEditTool', 'PrintOption', 'FormDesignerEditTool', 'SubmitForm']
    // Build toolbar groups using a simple loop for clarity
    const toolbarGroups = []
    for (let i = 0; i < allGroups.length; i++) {
        const g = allGroups[i]
        // skip globally removed groups
        if (removeAlways.includes(g)) continue
        // skip groups not allowed for customers
        if ((role !== 'Manager' && role !== 'Loan Officer') && removeForCustomer.includes(g)) continue
        toolbarGroups.push(g)
        if ((role !== 'Manager' && role !== 'Loan Officer') && pdfFileName.toLowerCase().includes("sanction") && loanStatus === LoanStatus.APPROVED) {
            toolbarGroups.push('DownloadOption');
        }
    }

    // Insert attachment button after SearchOption so it appears after the search icon
    const attachmentButton = {
        prefixIcon: 'add-attachment-icon',
        id: 'attachment_button',
        tooltipText: 'Add Attachments',
        align: 'Right',
        type: 'Button'
    }
    const searchIndex = toolbarGroups.findIndex(g => g === 'SearchOption')
    if (searchIndex >= 0) {
        // place right after SearchOption
        toolbarGroups.splice(searchIndex + 1, 0, attachmentButton)
    } else {
        // fallback: append
        toolbarGroups.push(attachmentButton)
    }

    // Simple: fetch PDF blob from server, create blob URL and ask viewer to load it
    const resourcesLoaded = async () => {
        const viewer = viewerRef.current
        if (!viewer) return

        try {
            const base = process.env.REACT_APP_API_URL || 'http://localhost:5063'
            const name = (loanStatus === LoanStatus.APPROVED && !pdfFileName.toLowerCase().includes("sanction")) ? "Sanction_Letter" : pdfFileName || 'Loan_Application_Form'
            const filename = name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
            const resp = await fetch(`${base}/api/Authentication/GetPdfStream/${encodeURIComponent(filename)}`)
            if (!resp.ok) {
                console.error('Failed to fetch PDF', resp.status)
                return
            }
            const blob = await resp.blob()

            // revoke previous blob URL (simple global track) to avoid memory leak
            try { if (window._lastPdfBlobUrl) URL.revokeObjectURL(window._lastPdfBlobUrl) } catch (e) { }
            const blobUrl = URL.createObjectURL(blob)
            window._lastPdfBlobUrl = blobUrl

            // Try viewer.load(), then viewer.open()
            if (viewer.load) viewer.load(blobUrl, null)

            // If we loaded a filename via stream, also fetch embedded attachments metadata for it
            if (filename) {
                try { await fetchServerAttachments(filename); } catch (e) { console.warn('Failed to fetch server attachments', e); }
            }
        } catch (err) {
            console.error('Error loading PDF:', err)
        }
    }

    //Get Document ID
    function getDocumentId(pdfFileName, fileId) {
        const base = pdfFileName.trim();
        if (base.toLowerCase() === 'loan_application_form') {
            return String(fileId);
        }
        // Try to extract the trailing numeric token
        // Examples matched:
        // "Customer1_1001" -> "1001"
        const m = base.match(/_(\d+)(?:_[A-Za-z].*)?$/);
        if (m && m[1]) {
            return String(m[1]);
        }
        return String(fileId);
    }

    // Convert a Blob to base64 data URL
    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
    //Save the complete Lon application in the server
    const handleSubmit = async () => {
        if (role !== "Manager" && role !== "Loan Officer") {
            if (loanStatus === LoanStatus.SIGN_REQUIRED) {
                if (typeof window !== 'undefined') window.currentAction = LoanStatus.PENDING_APPROVAL;
            } else {
                if (typeof window !== 'undefined') window.currentAction = LoanStatus.SUBMITTED;
            }
        }
        const viewer = viewerRef.current;
        if (!viewer) return;
        try {
            // Get filled PDF as Blob
            removeReadOnly();
            const blob = await viewer.saveAsBlob();
            const base64 = await blobToBase64(blob);

            // Use the same API base as resourcesLoaded
            const base = process.env.REACT_APP_API_URL || 'http://localhost:5063';

            // Use the current `count` as the file id so client and server agree
            const fileId = count;
            let fileName;
            if ((role !== "Manager" && role !== "Loan Officer") && loanStatus !== LoanStatus.SIGN_REQUIRED && pdfFileName === "Loan_Application_Form") {
                fileName = `${role}_${fileId}`
            } else if (loanStatus === LoanStatus.APPROVED && !pdfFileName.toLowerCase().includes("sanction")) {
                fileName = `${pdfFileName}_Sanction_Letter`
            } else {
                fileName = pdfFileName
            }

            const user = JSON.parse(localStorage.getItem('user') || 'null');
            const username = user?.username || user?.name || null;
            const documentId = getDocumentId(pdfFileName, fileId);
            const customerName = username;
            const status = window.currentAction;
            const attachmentsPayload = (uploadedFiles || []).map(f => ({ name: f.name, base64: f.base64, type: f.type, originalName: f.originalName }));
            const resp = await fetch(`${base}/api/Authentication/SaveFilledForms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base64, fileName, username, status, documentId, customerName, attachments: attachmentsPayload }),
            });

            if (!resp.ok) {
                console.error('SaveFilledForms failed', resp.status);
            }

            // Prefer server-confirmed filename if returned, fallback to our constructed name
            let savedName = fileName;
            let json;
            try {
                json = await resp.json();
                if (json && json.fileName) savedName = json.fileName;
            } catch (e) {
                // ignore parse errors, server may not return JSON
            }

            // Determine document id to persist counts under
            const docId = documentId || (savedName && (savedName.match(/(\d+)(?=\.pdf$|$)/) || [])[0]) || null;

            // Handle attachments returned by server or assume pending uploads were saved
            let savedAttachmentsCount = 0;
            try {
                if (json && Array.isArray(json.attachments) && json.attachments.length > 0) {
                    const base = process.env.REACT_APP_API_URL || 'http://localhost:5063';
                    const savedFiles = json.attachments.map((a, idx) => {
                        const fname = a.fileName || a.name || a.originalName || `attachment_${idx}`;
                        const url = a.url || `${base}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(savedName)}/${encodeURIComponent(fname)}`;
                        return {
                            id: Date.now() + idx,
                            name: fname,
                            originalName: a.originalName || a.name || fname,
                            url: url,
                            size: a.size || '',
                            type: a.type || 'application/octet-stream',
                            uploadedAt: a.uploadedAt || new Date().toLocaleString(),
                            pending: false
                        };
                    });
                    setUploadedFiles(savedFiles);
                    persistAttachments(savedFiles, docId);
                    savedAttachmentsCount = savedFiles.length;
                } else {
                    // No per-attachment metadata returned; assume server embedded current pending attachments
                    const nonPending = (uploadedFiles || []).filter(f => !f.pending);
                    savedAttachmentsCount = nonPending.length || (uploadedFiles || []).length;
                    // Persist the counted attachments under docId so dashboard shows correct count immediately
                    persistAttachments(uploadedFiles || [], docId);
                    // Clear pending list locally
                    setUploadedFiles([]);
                }
            } catch (e) {
                console.warn('Error processing attachments after save', e);
            }

            // set the file name in parent so dashboard can show it
            if (pdfFileName === "Loan_Application_Form") {
                setFileCount(count + 1);
            }
            setPdfFileName(savedName);

            // notify other components (dashboard) that files changed so they can reload
            try {
                const user = JSON.parse(localStorage.getItem('user') || 'null');
                const username = user?.username || user?.name || null;
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('userFilesChanged', { detail: { documentId: docId, fileName: savedName, username } }));
                }
            } catch (e) {
                // ignore dispatch errors
            }

            // Update attachments count only on submit: include number of saved attachments + the form file itself
            const incrementForForm = 1; // saved filled form file
            setFileCount(count + incrementForForm + savedAttachmentsCount);

            setViewerMode(false);
            setSanctionMode(false);
            setSanctionValues(null);
            if (role !== "Manager" && role !== "Loan Officer") {
                if (loanStatus === LoanStatus.SIGN_REQUIRED) {
                    setLoanStatus(LoanStatus.PENDING_APPROVAL)
                } else {
                    setLoanStatus(LoanStatus.SUBMITTED);
                }
            }
        } catch (err) {
            console.error('Error saving filled form', err);
        }
    };

    /* ---- Named button handlers (avoid inline logic in JSX) ---- */
    const handleReject = () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.REJECTED;
        setLoanStatus(LoanStatus.REJECTED)
        setViewerMode(false)
    }

    // change to your template filename on server

    const handleApproval = async () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.APPROVED;
        if (!showBtn) return
        setLoanStatus(LoanStatus.APPROVED)
        const viewer = viewerRef.current
        if (!viewer) return;
        const values = { name: '', amount: '', tenure: '', date: '' }
        let forms = viewer.retrieveFormFields();
        for (var i = 0; i < forms.length; i++) {
            if (forms[i].name === "ApplicantName") {
                values.name = forms[i].value;
            } else if (forms[i].name === "Amount") {
                values.amount = forms[i].value;
            } else if (forms[i].name === "Tenure") {
                values.tenure = forms[i].value;
            } else if (forms[i].name === "Date") {
                values.date = forms[i].value;
            }
        }
        setSanctionValues(values)
    }

    // When loanStatus becomes APPROVED and we have sanctionValues, load the sanction template
    useEffect(() => {
        if (loanStatus === LoanStatus.APPROVED && sanctionValues) {
            resourcesLoaded()
            setSanctionMode(true)
        }
    }, [loanStatus, sanctionValues])

    const handleSignRequest = async () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.SIGN_REQUIRED;
        setLoanStatus(LoanStatus.SIGN_REQUIRED);
        handleSubmit();
        setSanctionMode(false);
    }

    const handleFinish = () => {
        // simply close viewer and mark approved
        const viewer = viewerRef.current
        if (!viewer) return;
        let forms = viewer.retrieveFormFields();
        for (var i = 0; i < forms.length; i++) {
            viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
        }
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.APPROVED;
        setLoanStatus(LoanStatus.APPROVED)
        handleSubmit();
        setViewerMode(false)
        setSanctionMode(false)
    }

    const handleInfoRequired = () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.INFO_REQUIRED;
        removeReadOnly();
        setLoanStatus(LoanStatus.INFO_REQUIRED)
        handleSubmit();
        setViewerMode(false)
    }

    const handlePendingApproval = () => {
        if (!showBtn) return
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.PENDING_APPROVAL;
        setLoanStatus(LoanStatus.PENDING_APPROVAL)
        setViewerMode(false)
        handleSubmit();

    }
    //Check fields are filled
    const areAllFieldsFilled = (fields) => {
        const radioGroups = {}
        for (const f of fields) {
            const type = (f.type || f.fieldType || '').toString().toLowerCase()
            const name = f.name ?? f.fieldName ?? f.id ?? ''
            // If user is Customer, the LoanOfficerSignature field is allowed to be empty
            if ((role !== "Manager" && role !== "Loan Officer") && (String(name).toLowerCase().includes('loanofficer') || String(name).toLowerCase().includes("managersignature"))) {
                continue
            }
            const value = (f.value ?? f.Value ?? f.FieldValue ?? '').toString().trim()
            const checked = f.checked ?? f.isChecked ?? false
            if (type === 'radio' || type === 'radiobutton' || type === 'checkbox') {
                radioGroups[name] = radioGroups[name] || []
                radioGroups[name].push(checked || value !== '')
                continue
            }
            // Other field types require a non-empty value
            if (!value) return false
        }
        // Ensure every radio/checkbox group has at least one truthy member
        for (const vals of Object.values(radioGroups)) {
            if (!vals.some(Boolean)) return false
        }
        return true
    }

    const evaluateFields = () => {
        try {
            const api = viewerRef.current
            if (!api) return

            // Syncfusion instance may expose methods directly or under `pdfViewer`.
            const getter = api.retrieveFormFields || (api.pdfViewer && api.pdfViewer.retrieveFormFields)
            const fields = (getter && getter.call(api)) || []
            if (!fields.length) {
                setShowBtn(true) // no form fields -> enable by default
                return
            }
            const ok = areAllFieldsFilled(fields)
            setShowBtn(ok);
            if ((sanctionMode && loanStatus === LoanStatus.APPROVED) || loanStatus === LoanStatus.REJECTED) {
                setShowBtn(false);
            }
        } catch (e) {
            console.warn('evaluateFields error', e)
        }
    }
    // Handler called by viewer when form field properties change
    const onFormFieldPropertiesChange = (args) => {
        if (args && args.isValueChanged) {
            evaluateFields()
        }
        if (sanctionMode) {
            checkManagerSignature();
        }
    }
    // Also run initial evaluation when document loads
    const onDocumentLoad = () => {
        evaluateFields();
        if ((loanStatus !== LoanStatus.INFO_REQUIRED || (loanStatus === LoanStatus.INFO_REQUIRED && (role === "Manager" || role === "Loan Officer"))) && loanStatus !== "") {
            readOnly();
        }
        MakeSignatureReadOnly();
        if (loanStatus === LoanStatus.APPROVED && sanctionMode && !pdfFileName.toLowerCase().includes("sanction")) {
            UpdateForm();
        }

    }

    function readOnly() {
        const viewer = viewerRef.current
        if (!viewer) return;
        let forms = viewer.retrieveFormFields();
        for (var i = 0; i < forms.length; i++) {
            if (sanctionMode) {
                if (forms[i].type === "SignatureField" && forms[i].value === "") {
                    forms[i].isReadOnly = false;
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: false });
                } else {
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
                }

            } else {
                if ((loanStatus === LoanStatus.UNDER_REVIEW || loanStatus === LoanStatus.INFO_REQUIRED) && forms[i].value === "") {
                    forms[i].isReadOnly = false;
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: false });
                } else {
                    forms[i].isReadOnly = true;
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
                }
            }

        }
    }

    function removeReadOnly() {
        const viewer = viewerRef.current
        if (!viewer) return;
        let forms = viewer.retrieveFormFields();
        for (var i = 0; i < forms.length; i++) {
            viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: false });
        }
    }

    function UpdateForm() {
        const viewer = viewerRef.current
        if (!viewer) return;
        let forms = viewer.retrieveFormFields();
        for (var i = 0; i < forms.length; i++) {
            if (forms[i].name === "ApplicantName") {
                forms[i].value = sanctionValues.name;
            } else if (forms[i].name === "Amount") {
                forms[i].value = sanctionValues.amount;
            } else if (forms[i].name === "Tenure") {
                forms[i].value = sanctionValues.tenure;
            } else if (forms[i].name === "Date") {
                forms[i].value = new Date().toLocaleDateString('en-GB');
            }
            if (forms[i].value !== "") {
                viewer.updateFormFieldsValue(forms[i]);
                viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
            }
        }
        setShowBtn(false)
    }

    function checkManagerSignature() {
        try {
            const viewer = viewerRef.current
            if (!viewer) return
            const forms = viewer.retrieveFormFields() || []
            const sigField = forms.find(f => (f.name ?? f.fieldName ?? '').toString().toLowerCase() === 'managersignature')
            const hasValue = sigField && (sigField.value ?? '').toString().trim() !== ''
            setFinishEnabled(Boolean(hasValue))
        } catch (e) {
            console.warn('checkManagerSignature error', e)
            setFinishEnabled(false)
        }
    }
    function downloadStart(args) {
        const viewer = viewerRef.current
        if (!viewer) return;
        viewerRef.current.downloadFileName = pdfFileName;
    }

    function MakeSignatureReadOnly() {
        if ((role !== "Manager" && role !== "Loan Officer")) {
            const viewer = viewerRef.current
            if (!viewer) return;
            let forms = viewer.retrieveFormFields();
            for (var i = 0; i < forms.length; i++) {
                if (forms[i].name === "ManagerSignature") {
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
                }
                if (forms[i].name === "LoanOfficerSignature") {
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
                }
            }
        }
    }

    // Convert file to base64 (returns base64 string without data: prefix)
    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64 = (reader.result || '').toString();
                const parts = base64.split(',');
                resolve(parts.length > 1 ? parts[1] : parts[0]);
            };
            reader.onerror = (err) => reject(err);
        });
    };

    const handleAttach = async (file) => {
        try {
            const base64 = await fileToBase64(file);
            const dataUrl = `data:${file.type};base64,${base64}`;
            const fileInfo = {
                id: Date.now(),
                name: file.name,
                originalName: file.name,
                dataUrl: dataUrl,
                base64: base64,
                size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                type: file.type,
                uploadedAt: new Date().toLocaleString(),
                pending: true
            };
            setUploadedFiles(prev => {
                const already = (prev || []).some(f => f.name === fileInfo.name && f.size === fileInfo.size && f.pending);
                if (already) return prev;
                return [...(prev || []), fileInfo];
            });
        } catch (err) {
            console.error('Error reading attachment', err);
            alert('Failed to read attachment');
        }
    };

    const handleOpenFile = () => {
        if (fileInputRef.current) fileInputRef.current.click();
        setShowMenu(false);
    };

    // Open an attachment in the main viewer (replaces the currently loaded document)
    const openAttachmentInMainViewer = async (file) => {
        try {
            const viewer = viewerRef.current;
            if (!viewer || !file) return;
            let src = null;
            if (file.dataUrl && file.dataUrl.startsWith('data:')) {
                src = file.dataUrl;
            } else if (file.url) {
                src = file.url;
            } else if (file.name) {
                src = `${process.env.REACT_APP_API_URL || 'http://localhost:5063'}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(pdfFileName)}/${encodeURIComponent(file.name)}`;
            }
            if (!src) return;
            // Close attachments panel and menu first
            setShowMenu(false);
            setIsAttachmentOpen(false);
            // Small delay for layout change, then load into viewer
            setTimeout(() => {
                try {
                    if (viewer.load) viewer.load(src, null);
                    else if (viewer.open) viewer.open(src);
                } catch (e) {
                    console.warn('Failed to load attachment into main viewer', e);
                }
                // Trigger a resize/reflow to ensure viewer updates its layout
                setTimeout(() => {
                    try { if (viewer && typeof viewer.resize === 'function') viewer.resize(); else window.dispatchEvent(new Event('resize')); } catch (e) { console.warn('viewer resize failed', e); }
                }, 250);
            }, 120);
        } catch (e) {
            console.error('openAttachmentInMainViewer error', e);
        }
    };

    const handleFileChange = async (event) => {
        const file = event.target.files && event.target.files[0];
        if (file) {
            const allowedTypes = ['application/pdf'];
            const fileExtension = file.name.split('.').pop().toLowerCase();
            const allowedExtensions = ['pdf'];
            if (allowedTypes.includes(file.type) || allowedExtensions.includes(fileExtension)) {
                await handleAttach(file);
            } else {
                alert('Invalid file type. Please select a PDF');
            }
        }
        if (event && event.target) event.target.value = '';
    };

    // Persist only the numeric attachments count for this loan and notify other tabs
    const persistAttachments = (list, explicitLoanId) => {
        try {
            const count = (list || []).filter(f => !f.pending).length;
            // Prefer explicitLoanId argument, then explicit loanId prop, otherwise try to derive numeric id from pdfFileName
            let id = explicitLoanId || loanId;
            if (!id && pdfFileName) {
                // match trailing digits e.g. Customer_1001 or Loan_Application_Form_1001 or '...1001.pdf'
                const m = (pdfFileName.match(/(\d+)(?=\.pdf$|$)/) || [])[0];
                if (m) id = String(m);
                else {
                    const m2 = pdfFileName.match(/_(\d+)$/);
                    if (m2 && m2[1]) id = String(m2[1]);
                }
            }
            if (!id) {
                // If we still don't have an id, avoid storing under an ambiguous key.
                // This can happen if viewer was closed and selectedLoanId cleared before persisting.
                console.warn('persistAttachments: no loanId or numeric id found; skipping persist');
                return;
            }
            try { sessionStorage.setItem(`attachmentsCount_${id}`, String(count)); } catch (e) {}
            try { localStorage.setItem(`attachmentsCount_${id}`, String(count)); } catch (e) {}
            try { window.dispatchEvent(new CustomEvent('attachmentsCountUpdated', { detail: { loanId: id, count } })); } catch (e) {}
        } catch (e) {
            console.error('Failed to persist attachments count', e);
        }
    };

    // Persist deleted attachments list to storage
    const persistDeletedAttachments = () => {
        try {
            let docId = loanId;
            if (!docId && pdfFileName) {
                const m = (pdfFileName.match(/(\d+)(?=\.pdf$|$)/) || [])[0];
                if (m) docId = String(m);
            }
            if (!docId) {
                console.warn('persistDeletedAttachments: no docId found');
                return;
            }
            const storageKey = `deletedAttachments_${docId}`;
            const deletedList = Array.from(deletedAttachmentsRef.current);
            try { localStorage.setItem(storageKey, JSON.stringify(deletedList)); } catch (e) {}
            try { sessionStorage.setItem(storageKey, JSON.stringify(deletedList)); } catch (e) {}
            console.log('Persisted deleted attachments:', deletedList);
        } catch (e) {
            console.error('Failed to persist deleted attachments', e);
        }
    };

    // Keep storage in sync whenever uploadedFiles changes (counts are for non-pending files)
    useEffect(() => {
        try {
            persistAttachments(uploadedFiles);
        } catch (e) {
            console.error('persistAttachments effect error', e);
        }
    }, [uploadedFiles]);

    // Load deleted attachments from storage on mount
    useEffect(() => {
        try {
            // Get document ID for storage key
            let docId = loanId;
            if (!docId && pdfFileName) {
                const m = (pdfFileName.match(/(\d+)(?=\.pdf$|$)/) || [])[0];
                if (m) docId = String(m);
            }
            if (docId) {
                const storageKey = `deletedAttachments_${docId}`;
                const stored = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey);
                if (stored) {
                    try {
                        const deletedList = JSON.parse(stored);
                        if (Array.isArray(deletedList)) {
                            deletedAttachmentsRef.current = new Set(deletedList);
                            console.log('Loaded deleted attachments from storage:', deletedList);
                        }
                    } catch (e) {
                        console.warn('Failed to parse deleted attachments from storage', e);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load deleted attachments', e);
        }
    }, [loanId, pdfFileName]);

    // Cleanup: Clear pending attachments on unmount to prevent stale data
    useEffect(() => {
        return () => {
            // On unmount, if there are pending attachments (not submitted), clear them
            setUploadedFiles(prev => {
                const hasPending = prev.some(f => f.pending);
                if (hasPending) {
                    console.log('Clearing pending attachments on unmount');
                    // Keep only non-pending (server-saved) files
                    const serverFiles = prev.filter(f => !f.pending);
                    return serverFiles;
                }
                return prev;
            });
        };
    }, []);

    const fetchServerAttachments = async (filename) => {
        if (!filename) return;
        try {
            const base = process.env.REACT_APP_API_URL || 'http://localhost:5063'
            const resp = await fetch(`${base}/api/Authentication/GetPdfAttachments/${encodeURIComponent(filename)}`)
            if (!resp.ok) return;
            const json = await resp.json();
            let list = [];
            if (Array.isArray(json)) list = json;
            else if (json && Array.isArray(json.attachments)) list = json.attachments;
            else if (json && json.data && Array.isArray(json.data.attachments)) list = json.data.attachments;
            else if (json && typeof json === 'object') {
                const vals = Object.values(json);
                for (const v of vals) if (Array.isArray(v)) { list = v; break; }
            }
            if (!list || list.length === 0) {
                setUploadedFiles([]);
                persistAttachments([]);
                return;
            }
            const files = list.map((a, idx) => {
                if (typeof a === 'string') {
                    const fname = a;
                    return {
                        id: Date.now() + idx,
                        name: fname,
                        originalName: fname,
                        url: `${process.env.REACT_APP_API_URL || 'http://localhost:5063'}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(filename)}/${encodeURIComponent(fname)}`,
                        size: '', type: 'application/octet-stream', uploadedAt: new Date().toLocaleString(), pending: false
                    };
                }
                const fname = a.fileName || a.name || a.filename || a.file || (`attachment_${idx}`)
                const url = a.url || `${process.env.REACT_APP_API_URL || 'http://localhost:5063'}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(filename)}/${encodeURIComponent(fname)}`
                return {
                    id: Date.now() + idx,
                    name: fname,
                    originalName: a.originalName || a.name || a.fileName || fname,
                    url: url,
                    size: a.size || '',
                    type: a.type || 'application/octet-stream',
                    uploadedAt: a.uploadedAt || new Date().toLocaleString(),
                    pending: false
                }
            })
            // Filter out files that have been deleted in this session
            const filteredFiles = files.filter(f => !deletedAttachmentsRef.current.has(f.name));
            setUploadedFiles(filteredFiles)
            // derive id from filename (which may be 'name.pdf' or 'role_1001.pdf')
            const derivedId = (filename && (filename.match(/(\d+)(?=\.pdf$|$)/) || [])[0]) || null;
            persistAttachments(filteredFiles, derivedId)
        } catch (e) {
            console.error('fetchServerAttachments error', e)
        }
    };

    const deleteFileFromServer = async (fileName) => {
        const base = process.env.REACT_APP_API_URL || 'http://localhost:5063';
        const candidates = [
            `${base}/api/Authentication/DeleteFile`,
            `${base}/api/PdfViewer/DeleteFile`,
            `${base}/api/pdfviewer/DeleteFile`,
            `${base}/pdfviewer/DeleteFile`,
            `${base}/api/DeleteFile`,
            `${base}/DeleteFile`,
            // route variants that include filename in the path (some servers expose this)
            `${base}/api/PdfViewer/DeleteFile/${encodeURIComponent(fileName)}`,
            `${base}/api/Authentication/DeleteFile/${encodeURIComponent(fileName)}`
        ];

        let lastError = null;

        const tryParseBody = async (resp) => {
            try { return await resp.json(); } catch (e) {
                try { return await resp.text(); } catch (e2) { return null; }
            }
        };
        const viewer = viewerRef.current;
        const blob = await viewer.saveAsBlob();
        const base64 = await blobToBase64(blob);
        // 1) DELETE with JSON body
        for (const endpoint of candidates) {
            try {
                console.log('Attempting DELETE (JSON) ->', endpoint, fileName);
                const resp = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName, base64 })
                });
                const data = await tryParseBody(resp);
                console.log('Response', endpoint, resp.status, resp.statusText, data);
                if (resp.ok) return { success: true, data };
                lastError = { status: resp.status, message: data };
                if (resp.status !== 404) return { success: false, status: resp.status, message: data };
            } catch (err) {
                console.warn('Network error for', endpoint, err && err.message);
                lastError = err;
            }
        }

        // 2) DELETE with query string
        for (const baseEndpoint of candidates) {
            const endpoint = `${baseEndpoint}?fileName=${encodeURIComponent(fileName)}`;
            try {
                console.log('Attempting DELETE (query) ->', endpoint);
                const resp = await fetch(endpoint, { method: 'DELETE' });
                const data = await tryParseBody(resp);
                console.log('Response', endpoint, resp.status, resp.statusText, data);
                if (resp.ok) return { success: true, data };
                lastError = { status: resp.status, message: data };
                if (resp.status !== 404) return { success: false, status: resp.status, message: data };
            } catch (err) {
                console.warn('Network error for', endpoint, err && err.message);
                lastError = err;
            }
        }

        // 3) POST fallback
        for (const endpoint of candidates) {
            try {
                console.log('Attempting POST (fallback) ->', endpoint, fileName);
                const resp = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName })
                });
                const data = await tryParseBody(resp);
                console.log('Response', endpoint, resp.status, resp.statusText, data);
                if (resp.ok) return { success: true, data };
                lastError = { status: resp.status, message: data };
                if (resp.status !== 404) return { success: false, status: resp.status, message: data };
            } catch (err) {
                console.warn('Network error for', endpoint, err && err.message);
                lastError = err;
            }
        }

        console.error('All delete attempts failed', lastError);
        return { success: false, message: lastError && (lastError.message || lastError) };
    };

    const handleRemoveFile = async (fileId) => {
        if (fileId) {
            // Remove specific file
            const fileToRemove = uploadedFiles.find(file => file.id === fileId);
            if (fileToRemove) {
                if (window.confirm(`Are you sure you want to remove "${fileToRemove.name}"?`)) {
                    console.log('Removing file:', fileToRemove.name);
                    
            // If file is pending (not yet submitted), just remove locally
            if (fileToRemove.pending) {
              setUploadedFiles(prev => {
                const next = prev.filter(file => file.id !== fileId);
                persistAttachments(next);
                return next;
              });
              console.log('Pending file removed locally:', fileId);
              alert('File removed');
            } else {
              // Delete from server first
              const result = await deleteFileFromServer(fileToRemove.name);
              // Track deleted file name (even if server deletion fails, prevent it from showing again)
              deletedAttachmentsRef.current.add(fileToRemove.name);
              persistDeletedAttachments(); // Save to storage
              console.log('Added to deleted attachments list:', fileToRemove.name);
              
              // Remove from UI and persist
              setUploadedFiles(prev => {
                const next = prev.filter(file => file.id !== fileId);
                persistAttachments(next);
                return next;
              });
              console.log('File removed from UI:', fileId);
              
              if (result.success) {
                alert('File deleted successfully!');
              } else {
                const errorMsg = result.message || 'Failed to delete file from server';
                console.warn(errorMsg);
                alert('File removed from view (server deletion may have failed - check console)');
              }
            }
                }
            }
        } else {
            // Remove all files
        if (uploadedFiles.length > 0) {
          if (window.confirm(`Are you sure you want to remove all ${uploadedFiles.length} file(s)?`)) {
            console.log('Removing all files...');

            // Separate pending (local) attachments vs server-saved
            const pending = uploadedFiles.filter(f => f.pending);
            const serverFiles = uploadedFiles.filter(f => !f.pending);

            // Remove pending locally
            let deletedCount = 0;
            if (pending.length) {
              deletedCount += pending.length;
            }

            // Attempt to delete server files and track all deletions
            for (const file of serverFiles) {
              const result = await deleteFileFromServer(file.name);
              // Track deleted file (even if server deletion fails)
              deletedAttachmentsRef.current.add(file.name);
              if (result.success) {
                deletedCount++;
              }
            }
            persistDeletedAttachments(); // Save to storage

            // Always clear UI (we're tracking deleted files to prevent reappearance)
            setUploadedFiles([]);
            persistAttachments([]);
            console.log('All files removed from UI');
            alert(`All ${deletedCount} file(s) removed from view!`);
          }
        } else {
          alert('No files to remove');
        }
        }
        setShowMenu(false);
    };

    const clearPendingAttachments = () => {
        // Remove pending attachments when closing without submit
        setUploadedFiles(prev => {
            const hasPending = prev.some(f => f.pending);
            if (hasPending) {
                console.log('Clearing pending attachments - viewer closed without submit');
                const serverFiles = prev.filter(f => !f.pending);
                persistAttachments(serverFiles);
                return serverFiles;
            }
            return prev;
        });
    };

    const toolbarClick = (args) => {
        if (args && args.item && args.item.id === 'attachment_button') {
            setIsAttachmentOpen(v => !v);
            setShowMenu(false);
        }
    };

    // Trigger a resize/reflow of the PDF viewer when the attachments panel opens/closes
    useEffect(() => {
        const viewer = viewerRef.current;
        const adjust = () => {
            try {
                if (viewer && typeof viewer.resize === 'function') viewer.resize();
                else window.dispatchEvent(new Event('resize'));
            } catch (e) {
                console.warn('viewer resize failed', e);
            }
        };
        const t = setTimeout(adjust, 150);
        return () => clearTimeout(t);
    }, [isAttachmentOpen]);

    // Prepare modalSrc whenever viewingFile changes
    useEffect(() => {
        let active = true;
        let objectUrl = null;
        const prepare = async () => {
            if (!viewingFile) { setModalSrc(null); setModalLoading(false); return; }
            setModalLoading(true);
            try {
                if (viewingFile.dataUrl && viewingFile.dataUrl.startsWith('data:')) {
                    if (active) setModalSrc(viewingFile.dataUrl);
                    return;
                }
                if (viewingFile.url) {
                    if (active) setModalSrc(viewingFile.url);
                    return;
                }
                // construct from server
                if (viewingFile.name) {
                    const candidate = `${process.env.REACT_APP_API_URL || 'http://localhost:5063'}/api/Authentication/GetPdfAttachmentFile/${encodeURIComponent(pdfFileName)}/${encodeURIComponent(viewingFile.name)}`;
                    if (active) setModalSrc(candidate);
                    return;
                }
                setModalSrc(null);
            } catch (e) {
                console.error('Error preparing modal source', e);
                if (active) setModalSrc(null);
            } finally { if (active) setModalLoading(false); }
        };
        prepare();
        return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [viewingFile, pdfFileName]);

    const closeModal = () => {
        setViewingFile(null); setIsAttachmentViewing(false); setModalSrc(null); setModalLoading(false);
        if (lastObjectUrlRef.current) { try { URL.revokeObjectURL(lastObjectUrlRef.current); } catch (e) {} lastObjectUrlRef.current = null; }
    };



    return (
        <div className="pdf-root">
            <div
                className="pdf-viewer-area"
                style={{ display: 'flex', width: '100%', height: 'calc(100vh - 64px)', overflow: 'hidden' }}
            >
                <div className={`pdf-viewer-column ${isAttachmentOpen ? 'with-panel' : 'full'}`} style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
                    <PdfViewerComponent
                        id="container"
                        // Do not pass documentPath here; we'll call the viewer `load()` API with the blob/server URL
                        enableToolbar={true}
                        resourceUrl="https://cdn.syncfusion.com/ej2/31.2.2/dist/ej2-pdfviewer-lib"
                        toolbarSettings={{ showTooltip: true, toolbarItems: toolbarGroups }}
                        toolbarClick={toolbarClick}
                        ref={(inst) => (viewerRef.current = inst)}
                        className="pdf-component"
                        documentLoad={onDocumentLoad}
                        formFieldPropertiesChange={onFormFieldPropertiesChange}
                        resourcesLoaded={resourcesLoaded}
                        downloadStart={downloadStart}
                        style={{ width: '100%', height: '100%' }}
                    >
                        <Inject services={services} />
                    </PdfViewerComponent>

                    {actionBar && (
                        <div className="pdf-actionbar">
                            <div className="pdf-actionbar-inner">
                                {/** Role-specific actions */}
                                {role === 'Manager' && (
                                    <>
                                        {!sanctionMode ? (
                                            <>
                                                <button className={`button pdf-action-button reject`} onClick={handleReject}>Reject</button>
                                                <button className={`button pdf-action-button approve ${showBtn ? 'enabled' : 'disabled'}`} disabled={!showBtn || loanStatus === LoanStatus.REJECTED} onClick={handleApproval}>Approval</button>
                                            </>
                                        ) : (
                                            <>
                                                <button className={`button pdf-action-button request`} onClick={handleSignRequest}>Sign Request</button>
                                                <button className={`button pdf-action-button final`} onClick={handleFinish} disabled={!finishEnabled}>Finish</button>
                                            </>
                                        )}
                                    </>
                                )}

                                {role === 'Loan Officer' && (
                                    <>
                                        <button className={`button pdf-action-button reject`} onClick={handleReject}>Reject</button>
                                        <button className={`button pdf-action-button request`} disabled={loanStatus === LoanStatus.REJECTED} onClick={handleInfoRequired}>Info Required</button>
                                        <button className={`button pdf-action-button final ${showBtn ? 'enabled' : 'disabled'}`} disabled={!showBtn} onClick={handlePendingApproval}>Pending Approval</button>
                                    </>
                                )}

                                {(role !== 'Manager' && role !== "Loan Officer") && (
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
                            <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, transform: 'translateY(-10px)' }} title="More options">
                                <span className="e-icons e-more-vertical-1" style={{ fontSize: 18, color: '#6c757d', lineHeight: '36px', display: 'inline-block' }} />
                            </button>
                            {showMenu && (
                                <div onClick={(e) => e.stopPropagation()} className="attachment-menu" style={{ position: 'absolute', right: 8, top: '100%', marginTop: '4px', background: '#fff', boxShadow: '0 4px 10px rgba(0,0,0,0.15)', border: '1px solid #ddd', borderRadius: 4, minWidth: 120, zIndex: 1000 }}>
                                    <div 
                                        onClick={canManageAttachments ? handleOpenFile : undefined} 
                                        className="menu-item" 
                                        style={{ 
                                            padding: '6px 10px', 
                                            cursor: canManageAttachments ? 'pointer' : 'not-allowed', 
                                            opacity: canManageAttachments ? 1 : 0.5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            borderBottom: '1px solid #f0f0f0'
                                        }} 
                                        title={!canManageAttachments ? 'Only enabled when submit is available for customer' : ''}>
                                        <span className="e-icons e-plus" style={{ marginRight: 8 }} />
                                        Add file
                                    </div>
                                    <div 
                                        onClick={canManageAttachments ? () => handleRemoveFile() : undefined} 
                                        className="menu-item" 
                                        style={{ 
                                            padding: '6px 10px', 
                                            cursor: canManageAttachments ? 'pointer' : 'not-allowed', 
                                            opacity: canManageAttachments ? 1 : 0.5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            borderBottom: '1px solid #f0f0f0'
                                        }} 
                                        title={!canManageAttachments ? 'Only enabled when submit is available for customer' : ''}>
                                        <span className="e-icons e-trash" style={{ marginRight: 8 }} />
                                        Remove All
                                    </div>
                                    <div 
                                        onClick={() => { clearPendingAttachments(); setIsAttachmentOpen(false); setShowMenu(false); }} 
                                        className="menu-item" 
                                        style={{ 
                                            padding: '8px 12px', 
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}>
                                        <span className="e-icons e-close" style={{ marginRight: 8 }} />
                                        Close
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="attachment-list" style={{ padding: 12, overflowY: 'auto', flex: 1, backgroundColor: '#ffffff' }}>
                            {uploadedFiles.length === 0 ? (
                                <div style={{ color: '#666', marginTop: 12 }}>No files uploaded yet.<br/>Click the menu to upload files.</div>
                            ) : (
                                uploadedFiles.map((file) => (
                                    <div key={file.id} className="attachment-item" style={{ padding: '8px 6px', borderBottom: '1px solid #eee' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                            <div style={{ flex: 1, paddingRight: 10 }}>
                                                <div onClick={() => { setViewingFile(file); setIsAttachmentViewing(true); }} style={{ fontWeight: 'normal', marginTop: 6, marginBottom: 4, wordBreak: 'break-word', cursor: 'pointer' }} title="Open attachment">📎 {file.originalName || file.name}</div>
                                                <div style={{ fontSize: 12, color: '#666' }}>Size: {file.size}</div>
                                                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Uploaded: {file.uploadedAt}</div>
                                            </div>
                                            <button
                                                onClick={canManageAttachments ? () => handleRemoveFile(file.id) : undefined}
                                                className="icon-button"
                                                title={canManageAttachments ? "Remove file" : "Only enabled when submit is available for customer"}
                                                style={{
                                                    cursor: canManageAttachments ? 'pointer' : 'not-allowed',
                                                    opacity: canManageAttachments ? 1 : 0.5,
                                                    border: 'none',
                                                    background: 'transparent',
                                                    padding: '4px',
                                                    lineHeight: 1,
                                                    marginTop: 8
                                                }}
                                            >✕</button>
                                        </div>
                                    </div>
                                ))
                            )}

                            {viewingFile && (
                                <div onClick={closeModal} className="attachment-modal-overlay" style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                                    <div onClick={(e) => e.stopPropagation()} className="attachment-modal" style={{ width: '80%', height: '80%', background: '#fff', borderRadius: 6, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                        <button onClick={closeModal} className="icon-button" title="Close" style={{ position: 'absolute', right: 10, top: 6, zIndex: 10, fontSize: 20 }}>✕</button>
                                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                            <div style={{ padding: 12, textAlign: 'center', fontWeight: 500, borderBottom: '1px solid #eee' }}>{viewingFile.originalName || viewingFile.name}</div>
                                            <div style={{ flex: 1, minHeight: 0 }}>
                                                <PdfViewerComponent
                                                    id="modalInnerViewer"
                                                    ref={modalViewerRef}
                                                    documentPath={modalSrc || (viewingFile && (viewingFile.dataUrl || viewingFile.url)) || "https://cdn.syncfusion.com/content/pdf/pdf-succinctly.pdf"}
                                                    resourceUrl="https://cdn.syncfusion.com/ej2/31.2.2/dist/ej2-pdfviewer-lib"
                                                    enableNavigationToolbar={false}
                                                    style={{ width: '100%', height: '100%' }}
                                                    toolbarSettings={{ showTooltip: false, toolbarItems: [], showToolbar: false }}
                                                >
                                                    <Inject services={[ Toolbar, Magnification, Navigation, Annotation, LinkAnnotation, BookmarkView, ThumbnailView, Print, TextSelection, TextSearch, FormFields, FormDesigner ]}/>
                                                </PdfViewerComponent>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept="application/pdf" />
                    </div>
                )}
            </div>
        </div>
    )
}