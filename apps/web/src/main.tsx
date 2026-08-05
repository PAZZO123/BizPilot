import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { App } from './App';
import { watchSystemTheme } from './store/theme';
import './index.css';

// Lives for as long as the page does, so there is nothing to tear down.
watchSystemTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Shop data changes when the shopkeeper changes it, not on a timer.
      // Refetching on every window focus burns mobile data for no benefit.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry a 4xx — the request is wrong, not unlucky.
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3500,
            // Colours come from `.bp-toast` in index.css so the toast follows
            // dark mode; inline styles here would win over the theme rules.
            className: 'bp-toast',
            style: { fontSize: '14px', maxWidth: '90vw' },
            success: { iconTheme: { primary: '#0F766E', secondary: '#fff' } },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
