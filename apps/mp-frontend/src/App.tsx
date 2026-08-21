// src/App.tsx — Semi Design Layout + 11 + N 子页路由 (Sider 二级菜单)
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
import Marketplace from './pages/Marketplace';
import OntologyDashboard from './pages/OntologyDashboard';
import OntologyObjects from './pages/OntologyObjects';
import OntologyRelations from './pages/OntologyRelations';
import OntologyActions from './pages/OntologyActions';
import OntologyGraph from './pages/OntologyGraph';
import OntologyKb from './pages/OntologyKb';
import OntologyLlm from './pages/OntologyLlm';
import MarketplaceInstalls from './pages/MarketplaceInstalls';
import MarketplacePublish from './pages/MarketplacePublish';
import MarketplaceSearch from './pages/MarketplaceSearch';
import OpsDashboard from './pages/OpsDashboard';
import { useFrontendObs } from './lib/frontend-obs';

function ObsApp() {
  useFrontendObs();
  return (
    <Layout>
      <Routes>
        {/* Root: → /admin/dashboard (新运营管理) */}
        <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />

        {/* Ontology 本体平台 (主战场) */}
        <Route path="/admin/ontology/dashboard" element={<OntologyDashboard />} />
        <Route path="/admin/ontology/objects" element={<OntologyObjects />} />
        <Route path="/admin/ontology/relations" element={<OntologyRelations />} />
        <Route path="/admin/ontology/actions" element={<OntologyActions />} />
        <Route path="/admin/ontology/graph" element={<OntologyGraph />} />
        <Route path="/admin/ontology/kb" element={<OntologyKb />} />
        <Route path="/admin/ontology/llm" element={<OntologyLlm />} />
        {/* Alias: /admin/ontology → /admin/ontology/objects (向后兼容) */}
        <Route path="/admin/ontology" element={<Navigate to="/admin/ontology/objects" replace />} />

        {/* 云市场 */}
        <Route path="/admin/marketplace" element={<Marketplace />} />
        <Route path="/admin/marketplace/installs" element={<MarketplaceInstalls />} />
        <Route path="/admin/marketplace/publish" element={<MarketplacePublish />} />
        <Route path="/admin/marketplace/search" element={<MarketplaceSearch />} />

        {/* 应用中心 */}
        <Route path="/admin/frontend-obs" element={<FrontendObs />} />
        <Route path="/admin/sandbox" element={<Sandbox />} />

        {/* 运营管理 */}
        <Route path="/admin/dashboard" element={<OpsDashboard />} />
        <Route path="/admin/runtime" element={<Runtime />} />
        <Route path="/admin/monitoring" element={<Monitoring />} />
        <Route path="/admin/audit" element={<Audit />} />
        <Route path="/admin/tenants" element={<Tenants />} />

        {/* 兼容旧路由 */}
        <Route path="/admin/hitl" element={<HITL />} />
        <Route path="/admin/sessions" element={<Sessions />} />

        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return <ObsApp />;
}