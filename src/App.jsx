import React from 'react';
import { Routes, Route } from 'react-router-dom';
import WorkerApp from './pages/WorkerApp.jsx';
import AgencyDashboard from './pages/AgencyDashboard.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkerApp />} />
      <Route path="/agency" element={<AgencyDashboard />} />
    </Routes>
  );
}
