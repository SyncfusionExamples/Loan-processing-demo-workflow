import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { registerLicense } from '@syncfusion/ej2-base';
import DashBoard from './DashBoard.jsx';

registerLicense('Ix0oFS8QJAw9HSQvXkVjQlBad1RDX3xKf0x/TGpQb19xflBPallYVBYiSV9jS3tSdEdgWHxcdXRQRmVUU091XA==');
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <DashBoard />
  </React.StrictMode>
);