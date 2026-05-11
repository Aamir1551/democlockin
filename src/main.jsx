import React from 'react';
import ReactDOM from 'react-dom/client';
import WorkerApp from './pages/WorkerApp.jsx';
import AgencyDashboard from './pages/AgencyDashboard.jsx';
import './index.css';

const App = window.location.pathname === '/agency' ? AgencyDashboard : WorkerApp;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
