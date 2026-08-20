// src/main.tsx
// Vite + React 18 entrypoint
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from '@douyinfe/semi-ui';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from '@/auth/AuthContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
