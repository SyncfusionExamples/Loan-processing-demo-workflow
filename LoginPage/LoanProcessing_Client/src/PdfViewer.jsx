import React, { useState, useRef } from 'react'
import './PDFViewer.css'
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

export default function PdfViewer({ file, role, loanStatus, count, setPdfFileName, setViewerMode, setLoanStatus, setFileCount,pdfFileName }) {
    const viewerRef = useRef(null)
    const mutationObserverRef = useRef(null)
    const [showBtn, setShowBtn] = useState(true)
    // allow submit only when fields are complete and status is not already SUBMITTED
    const canSubmit = showBtn && loanStatus !== LoanStatus.SUBMITTED
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
        'AnnotationEditTool',
        'FormDesignerEditTool',
    ]

    // Remove these groups for everyone
    const removeAlways = ['OpenOption','UndoRedoTool', 'DownloadOption']
    // Remove these for Customer
    const removeForCustomer = ['AnnotationEditTool', 'PrintOption', 'FormDesignerEditTool', 'SubmitForm']
    const toolbarGroups = allGroups.filter((g) => {
        if (removeAlways.includes(g)) return false
        if (role === 'Customer' && removeForCustomer.includes(g)) return false
        return true
    })

    // Convert a Blob to base64 data URL
    const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
    //Save the complete Lon application in the server
    const handleSubmit = async () => {
        const viewer = viewerRef.current;
        if (!viewer) return;

        // Get filled PDF as Blob
        const blob = await viewer.saveAsBlob();
        const base64 = await blobToBase64(blob);
        const apiBase = viewerRef.current?.serviceUrl?.replace(/\/$/, '');

        // Send to server
        // Use the current `count` as the file id so client and server agree
        const fileId = count;
        const fileName = `Customer_${fileId}`;
        const resp = await fetch(`${apiBase}/SaveFilledForms`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64, fileName })
        });

        // Prefer server-confirmed filename if returned, fallback to our constructed name
        let savedName = fileName;
        try {
            const json = await resp.json();
            if (json && json.fileName) savedName = json.fileName;
        } catch (e) {
            // ignore parse errors, server may not return JSON
        }

        // set the file name in parent so dashboard can show it
        setPdfFileName(savedName);
        setFileCount(count + 1);
        setViewerMode(false);
        setLoanStatus(LoanStatus.SUBMITTED);
    };

    //Check fields are filled
    const areAllFieldsFilled = (fields) => {
        const radioGroups = {}
        for (const f of fields) {
            const type = (f.type || f.fieldType || '').toString().toLowerCase()
            const name = f.name ?? f.fieldName ?? f.id ?? ''
                // If user is Customer, the LoanOfficerSignature field is allowed to be empty
                if (role === 'Customer' && String(name).toLowerCase().includes('loanofficer')) {
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
            setShowBtn(ok)
        } catch (e) {
            console.warn('evaluateFields error', e)
        }
    }
    // Handler called by viewer when form field properties change
    const onFormFieldPropertiesChange = (args) => {
        if (args && args.isValueChanged) {
            evaluateFields()
        }
    }
    // Also run initial evaluation when document loads
    const onDocumentLoad = () => {
        evaluateFields();    
    }
    return (
        <div className="pdf-root">
            <div className="pdf-viewer-area">
                <PdfViewerComponent
                    id="container"
                    documentPath={file}
                    // serviceUrl must point to your backend PdfViewer controller
                    serviceUrl="https://localhost:7255/pdfviewer"
                    enableToolbar={true}
                    toolbarSettings={{ showTooltip: true, toolbarItems: toolbarGroups }}
                    ref={(inst) => (viewerRef.current = inst)}
                    className="pdf-component"
                    documentLoad={onDocumentLoad}
                    formFieldPropertiesChange={onFormFieldPropertiesChange}
                >
                    <Inject services={services} />
                </PdfViewerComponent>
                <div className="pdf-actionbar">
                    <div className="pdf-actionbar-inner">
                        {/** Role-specific actions */}
                        {role === 'Manager' && (
                            <>
                                <button
                                    className={`button pdf-action-button approve ${showBtn ? 'enabled' : 'disabled'}`}
                                    disabled={!showBtn}
                                    onClick={() => showBtn && (setLoanStatus && setLoanStatus(LoanStatus.APPROVED), setViewerMode && setViewerMode(false))}
                                >
                                    Approval
                                </button>
                                <button
                                    className={`button pdf-action-button reject`}
                                    onClick={() => { setLoanStatus && setLoanStatus(LoanStatus.REJECTED); setViewerMode && setViewerMode(false); }}
                                >
                                    Reject
                                </button>
                            </>
                        )}

                        {role === 'Loan Officer' && (
                            <>
                                <button
                                    className={`button pdf-action-button request`}
                                    onClick={() => { setLoanStatus && setLoanStatus(LoanStatus.INFO_REQUIRED); setViewerMode && setViewerMode(false); }}
                                >
                                    Info Required
                                </button>
                                <button
                                    className={`button pdf-action-button final ${showBtn ? 'enabled' : 'disabled'}`}
                                    disabled={!showBtn}
                                    onClick={() => showBtn && (setLoanStatus && setLoanStatus(LoanStatus.PENDING_APPROVAL), setViewerMode && setViewerMode(false))}
                                >
                                    Pending Approval
                                </button>
                                <button
                                    className={`button pdf-action-button reject`}
                                    onClick={() => { setLoanStatus && setLoanStatus(LoanStatus.REJECTED); setViewerMode && setViewerMode(false); }}
                                >
                                    Reject
                                </button>
                            </>
                        )}

                        {role === 'Customer' && (
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
            </div>
        </div>
    )
}
