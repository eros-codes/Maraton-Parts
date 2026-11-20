import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
// Served with the panel instead of from Google Fonts, whose render-blocking
// stylesheet is slow or filtered on Iranian connections.
// Morabba is the shop's typeface; Vazirmatn is the fallback for the few
// characters it does not draw.
import './styles/fonts.css';
import 'vazirmatn/Vazirmatn-Variable-font-face.css';
import './styles/admin.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
