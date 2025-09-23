import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Box } from '@mui/material';
import AgentDashboard from './components/AgentDashboard';
import ActivityLogPage from './pages/ActivityLog';
import InsightsPage from './pages/Insights';
import KnowledgePage from './pages/Knowledge';
import SettingsPage from './pages/Settings';
import GmailPage from './pages/Gmail';
import DrivePage from './pages/Drive';
import SpeechPage from './pages/Speech';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Create theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
});

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Router>
          <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<AgentDashboard />} />
              <Route path="/logs" element={<ActivityLogPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/gmail" element={<GmailPage />} />
              <Route path="/drive" element={<DrivePage />} />
              <Route path="/speech" element={<SpeechPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {/* More routes can be added later */}
            </Routes>
          </Box>
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
