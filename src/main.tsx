import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './matrix-overlay.css';
import './clients-tab.css';
import './home-cleanup.css';
import './report-sources.css';
import './client-detail-no-scroll.css';
import './client-analysis-progress.css';
import './client-field-copy.css';
import './clients-tab';
import './report-preview-loader';
import './client-analysis-progress';
import './client-field-copy';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
