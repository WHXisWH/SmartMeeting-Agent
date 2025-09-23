import axios from 'axios';

// Use Vite build-time variables; fallback to relative /api when not set
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  // Cross-origin cookies are not used by our backend; avoid CORS issues on Vercel
  withCredentials: false,
});

// Attach current user's email to all requests when available
function getCurrentEmail(): string | null {
  try {
    const v = localStorage.getItem('currentEmail');
    return v && v.includes('@') ? v : null;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const email = getCurrentEmail();
  if (email) {
    config.headers = config.headers || {};
    (config.headers as any)['x-user-email'] = email;
  }
  return config;
});

// Agent API calls
export const getAgentStatus = () => api.get('/agent/status');
export const getAgentMetrics = () => api.get('/agent/metrics');
export const getActivityLog = () => api.get('/agent/activity-log');
export const getLatestDecision = () => api.get('/agent/latest-decision');
// Chat feature removed per V3 plan

// Health (root-level, not under /api)
export const getHealth = () => {
  const base = (API_BASE_URL || '').replace(/\/$/, '');
  const root = base.endsWith('/api') ? base.slice(0, -4) : base;
  const url = `${root}/health`;
  return axios.get(url, { timeout: 5000 });
};

export const startAgent = () => api.post('/agent/start');
export const stopAgent = () => api.post('/agent/stop');

// Approvals
export const approveDecision = () => api.post('/agent/approvals/approve');
export const rejectDecision = () => api.post('/agent/approvals/reject');
export const modifyDecision = (payload: { action?: string; rationale?: string }) => api.post('/agent/approvals/modify', payload);

// Insights
export const getMeetingPatterns = () => api.get('/insights/meeting-patterns');
export const getDecisionBottlenecks = () => api.get('/insights/decision-bottlenecks');
export const getUsageWeekly = (days: number = 7) => api.get('/insights/usage-weekly', { params: { days } });
export const generateWeeklyReport = (days: number = 7) => api.post('/reports/weekly', { days });
export const getReportWeeklyPreview = (days: number = 7) => api.get('/reports/weekly/preview', { params: { days } });
export const getReportWeeklyLatest = () => api.get('/reports/weekly/latest');

// Knowledge
export const getSemanticKnowledge = () => api.get('/admin/knowledge/semantic?approved=true');
export const getProceduralKnowledge = () => api.get('/admin/knowledge/procedural?approved=true');
export const getEpisodicKnowledge = () => api.get('/admin/knowledge/episodic?approved=true');

// Mind map generation (for real-time visualization)
export const generateMindMap = (transcript: string, sessionId?: string) =>
  api.post('/speech/generate-mindmap', { transcript, sessionId });

// Auth & Calendar
export const getAuthStatus = () => api.get('/auth/status');
export const getCalendarEvents = () => api.get('/calendar/events');
export const createCalendarEvent = (payload: {
  summary: string;
  description?: string;
  start: string; // ISO
  end: string;   // ISO
  timezone?: string;
  attendees?: string[];
  createMeet?: boolean;
}) => api.post('/calendar/events', payload);

// Gmail
export const getGmailMessages = (params?: { query?: string; pageToken?: string; maxResults?: number }) =>
  api.get('/gmail/messages', { params });
export const getGmailMessage = (id: string) => api.get(`/gmail/messages/${id}`);
export const sendGmailMessage = (payload: { to: string; cc?: string; bcc?: string; subject?: string; html?: string }) =>
  api.post('/gmail/messages/send', payload);

// Agent Suggestions
export const getAgentSuggestions = () => api.get('/agent/suggestions');
export const approveSuggestion = (id: string, payload?: { start?: string; end?: string; timezone?: string; attendees?: string[]; summary?: string; description?: string }) =>
  api.post(`/agent/suggestions/${id}/approve`, payload || {});

// Meeting proposals (pre-meeting flow)
export const proposeMeeting = (payload: {
  attendees?: string[];
  durationMin?: number;
  horizonHours?: number;
  maxSlots?: number;
  threadId?: string;
  subject?: string;
}) => api.post('/agent/meetings/propose', payload);

export const confirmMeeting = (payload: {
  subject: string;
  agenda?: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
  driveFileIds?: string[];
  threadId?: string;
}) => api.post('/agent/meetings/confirm', payload);

export const sendMeetingOptions = (payload: {
  subject: string;
  agenda?: string;
  timezone: string;
  attendees: string[];
  slots: Array<{ start: string; end: string; timezone?: string }>; 
  threadId?: string;
}) => api.post('/agent/meetings/send-options', payload);

export const getOfferBySuggestion = (suggestionId: string) =>
  api.get(`/agent/offers/by-suggestion/${suggestionId}`);
export const rejectSuggestion = (id: string) => api.post(`/agent/suggestions/${id}/reject`);
