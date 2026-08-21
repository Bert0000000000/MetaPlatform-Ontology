// src/App.tsx — Semi Design Layout + 9 页路由
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Ontology from './pages/Ontology';
import HITL from './pages/HITL';
import Sessions from './pages/Sessions';
import Sandbox from './pages/Sandbox';
import Monitoring from './pages/Monitoring';
import Audit from './pages/Audit';
import FrontendObs from './pages/FrontendObs';
import Runtime from './pages/Runtime';
import Tenants from './pages/Tenants';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/admin/ontology" element={<Ontology />} />
        <Route path="/admin/hitl" element={<HITL />} />
        <Route path="/admin/sessions" element={<Sessions />} />
        <Route path="/admin/sandbox" element={<Sandbox />} />
        <Route path="/admin/monitoring" element={<Monitoring />} />
        <Route path="/admin/audit" element={<Audit />} />
        <Route path="/admin/frontend-obs" element={<FrontendObs />} />
        <Route path="/admin/runtime" element={<Runtime />} />
        <Route path="/admin/tenants" element={<Tenants />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}