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

export default function PdfViewer({ file, role, loanStatus, count, setPdfFileName, setViewerMode, setLoanStatus, setFileCount, pdfFileName, sanctionMode, setSanctionMode, actionBar }) {
    const viewerRef = useRef(null)
    // global variable to track last action invoked from this viewer
    if (typeof window !== 'undefined') {
        window.currentAction = window.currentAction || '';
    }
    const [showBtn, setShowBtn] = useState(true)
    const [sanctionValues, setSanctionValues] = useState(null)
    const [finishEnabled, setFinishEnabled] = useState(false)
    // allow submit only when fields are complete and status is not already SUBMITTED
    const canSubmit = showBtn;
    ///PDF Viewer Modules
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
    const removeAlways = [ 'OpenOption','UndoRedoTool', 'DownloadOption']
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
        if (pdfFileName.toLowerCase().includes("sanction") && loanStatus === LoanStatus.APPROVED) {
            toolbarGroups.push('DownloadOption');
        }
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
        // Example: "Customer1_1001" -> "1001"
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
            const resp = await fetch(`${base}/api/Authentication/SaveFilledForms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base64, fileName, username, status, documentId, customerName }),
            });
            if (!resp.ok) {
                console.error('SaveFilledForms failed', resp.status);
            }
            // Prefer server-confirmed filename if returned, fallback to our constructed name
            let savedName = fileName;
            try {
                const json = await resp.json();
                if (json && json.fileName) savedName = json.fileName;
            } catch (e) {
                // ignore parse errors, server may not return JSON
            }
            // set the file name in parent so dashboard can show it
            if (pdfFileName === "Loan_Application_Form") {
                setFileCount(count + 1);
            }
            setPdfFileName(savedName);
            // notify other components (dashboard) that files changed so they can reload
            try {
                const docId = documentId || (savedName && (savedName.match(/(\d+)(?=\.pdf$|$)/) || [])[0]) || null;
                const user = JSON.parse(localStorage.getItem('user') || 'null');
                const username = user?.username || user?.name || null;
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('userFilesChanged', { detail: { documentId: docId, fileName: savedName, username } }));
                }
            } catch (e) {
                // ignore dispatch errors
            }
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

    //Handle Reject Logic
    const handleReject = () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.REJECTED;
        setLoanStatus(LoanStatus.REJECTED)
        setViewerMode(false)
        handleSubmit();
    }
    // //Handle Approval Logic
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
    //Handle Sign Request Logic
    const handleSignRequest = async () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.SIGN_REQUIRED;
        setLoanStatus(LoanStatus.SIGN_REQUIRED);
        handleSubmit();
        setSanctionMode(false);
    }
    //Handle Finish Logic
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
    //Handle Info Required Logic
    const handleInfoRequired = () => {
        if (typeof window !== 'undefined') window.currentAction = LoanStatus.INFO_REQUIRED;
        removeReadOnly();
        setLoanStatus(LoanStatus.INFO_REQUIRED)
        handleSubmit();
        setViewerMode(false)
    }
    //Handle Pending Approval Logic
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
   //Make PDF Form Fields Read Only
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
                if (((loanStatus === LoanStatus.UNDER_REVIEW || loanStatus === LoanStatus.INFO_REQUIRED) && forms[i].value === "") || ((loanStatus === LoanStatus.PENDING_APPROVAL || loanStatus === LoanStatus.INFO_REQUIRED) && role === "Loan Officer" && forms[i].name === "LoanOfficerSignature")) {
                    forms[i].isReadOnly = false;
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: false });
                } else {
                    forms[i].isReadOnly = true;
                    viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: true });
                }
            }

        }
    }
    //Remove Read only for PDF Form Field
    function removeReadOnly() {
        const viewer = viewerRef.current
        if (!viewer) return;
        let forms = viewer.retrieveFormFields();
        for (var i = 0; i < forms.length; i++) {
            viewer.formDesignerModule.updateFormField(forms[i], { isReadOnly: false });
        }
    }
    //Update the Sanction letter fields values
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
    //Check the Manger signature value before approval
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
    //Set the File name for the document
    function downloadStart(args) {
        const viewer = viewerRef.current
        if (!viewer) return;
        viewerRef.current.downloadFileName = pdfFileName;
    }
    //Based on Role make the Signature field read only
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
    return (
        <div className="pdf-root">
            <div className="pdf-viewer-area">
                <PdfViewerComponent
                    id="container"
                    // Do not pass documentPath here; we'll call the viewer `load()` API with the blob/server URL
                    enableToolbar={true}
                    enableNavigationToolbar ={false}
                    resourceUrl="https://cdn.syncfusion.com/ej2/31.2.2/dist/ej2-pdfviewer-lib"
                    toolbarSettings={{ showTooltip: true, toolbarItems: toolbarGroups }}
                    ref={(inst) => (viewerRef.current = inst)}
                    className="pdf-component"
                    documentLoad={onDocumentLoad}
                    formFieldPropertiesChange={onFormFieldPropertiesChange}
                    resourcesLoaded={resourcesLoaded}
                    downloadStart={downloadStart}
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
                                            <button
                                                className={`button pdf-action-button reject`}
                                                onClick={handleReject}
                                            >
                                                Reject
                                            </button>
                                            <button
                                                className={`button pdf-action-button approve ${showBtn ? 'enabled' : 'disabled'}`}
                                                disabled={!showBtn || loanStatus === LoanStatus.REJECTED}
                                                onClick={handleApproval}
                                            >
                                                Approval
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                className={`button pdf-action-button request`}
                                                onClick={handleSignRequest}
                                            >
                                                Sign Request
                                            </button>
                                            <button
                                                className={`button pdf-action-button final`}
                                                onClick={handleFinish}
                                                disabled={!finishEnabled}
                                            >
                                                Finish
                                            </button>
                                        </>
                                    )}
                                </>
                            )}

                            {role === 'Loan Officer' && (
                                <>
                                    <button
                                        className={`button pdf-action-button reject`}
                                        onClick={handleReject}
                                    >
                                        Reject
                                    </button>
                                    <button
                                        className={`button pdf-action-button request`}
                                        disabled={loanStatus === LoanStatus.REJECTED}
                                        onClick={handleInfoRequired}
                                    >
                                        Info Required
                                    </button>
                                    <button
                                        className={`button pdf-action-button final ${showBtn ? 'enabled' : 'disabled'}`}
                                        disabled={!showBtn}
                                        onClick={handlePendingApproval}
                                    >
                                        Approval
                                    </button>
                                </>
                            )}

                            {(role !== 'Manager' && role !== "Loan Officer") && (
                                <button
                                    className={`button pdf-action-button approve ${canSubmit ? 'enabled' : 'disabled'}`}
                                    disabled={!canSubmit}
                                    onClick={() => canSubmit && handleSubmit()}
                                >
                                    Submit
                                </button>
                            )}
                        </div>
                    </div>
                )}

            </div>
        </div>
    )
}
