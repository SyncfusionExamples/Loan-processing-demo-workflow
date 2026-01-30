import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { registerLicense } from '@syncfusion/ej2-base';
import PdfViewer from './PdfViewer';

registerLicense('Ix0oFS8QJAw9HSQvXkVhQlBad1RDX3xKf0x/TGpQb19xflBPallYVBYiSV9jS3tSdkVrWHxccXZVQGlfVk91Xg==');
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <PdfViewer />
  </React.StrictMode>
);