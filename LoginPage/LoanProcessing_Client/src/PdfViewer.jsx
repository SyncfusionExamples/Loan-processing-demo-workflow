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
    <div>
      <div className="app-header">
        <div style={{ padding: '8px 12px', fontSize: '16px' }}>Loan Processing Workflow</div>
        <button className="logout-btn" onClick={logout}>Logout</button>
      </div>

      <div className='control-section'>
        <PdfViewerComponent
          ref={pdfViewerRef}
          id="container"
          documentPath={window.location.origin + "/Loan_Application_Form.pdf"}
          resourceUrl="https://cdn.syncfusion.com/ej2/30.2.7/dist/ej2-pdfviewer-lib"
          style={{ height: '640px' }}
        >
          <Inject services={[
            Toolbar, Magnification, Navigation, LinkAnnotation, BookmarkView,
            ThumbnailView, Print, TextSelection, TextSearch, FormFields, FormDesigner
          ]} />
        </PdfViewerComponent>
      </div>
    </div>
  );
};
export default PdfViewer;
