import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
// The fonts ship with the site instead of coming from Google Fonts. That
// stylesheet was render-blocking: on Iranian connections, where Google's
// servers are slow or filtered, the first paint waited for it to time out.
// Morabba is the shop's typeface; Vazirmatn stays as the fallback for the
// few characters Morabba does not draw.
import './styles/fonts.css';
import 'vazirmatn/Vazirmatn-Variable-font-face.css';
import './styles/global.css';
import './styles/components.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <CatalogProvider>
            <WishlistProvider>
              <CartProvider>
                <App />
              </CartProvider>
            </WishlistProvider>
          </CatalogProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
