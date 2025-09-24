import React, { useState, useEffect, useRef } from 'react';
import {
    getAgentStatus,
    getAgentMetrics,
    getActivityLog,
    getLatestDecision,
    startAgent,
    stopAgent,
    approveDecision,
    rejectDecision,
    modifyDecision,
    getUsageWeekly,
    generateWeeklyReport,
    getReportWeeklyPreview
} from '../services/api';
import { getHealth } from '../services/api';
import { PieChart, Pie, Cell, Legend, ResponsiveContainer } from 'recharts';
import { NavLink } from 'react-router-dom';
import LeftNav from './LeftNav';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import MeetingProposalModal from './MeetingProposalModal';
import { getAuthStatus, getCalendarEvents, createCalendarEvent, getAgentSuggestions, approveSuggestion, rejectSuggestion, sendMeetingOptions, getOfferBySuggestion } from '../services/api';
import { useTranslation } from 'react-i18next';

// --- Helper Functions & Components ---

const cardStyle: React.CSSProperties = {
    background: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
};

const headerStyle: React.CSSProperties = {
    margin: '0 0 12px 0',
    fontSize: '18px',
    color: '#343a40',
    borderBottom: '1px solid #e9ecef',
    paddingBottom: '8px',
};

const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    marginRight: '8px',
};

const AgentStatusCard = ({ status, metrics }) => {
    const { t } = useTranslation();
    const handleStart = () => startAgent().catch(console.error);
    const handleStop = () => stopAgent().catch(console.error);

    return (
        <div style={cardStyle}>
            <h2 style={headerStyle}>{t('dashboard.agentStatus.title')}</h2>
            <p><strong>{t('dashboard.agentStatus.status')}</strong> 
                <span style={{ color: status.isRunning ? '#28a745' : '#dc3545', fontWeight: 'bold' }}>
                    {status.isRunning ? t('dashboard.agentStatus.running') : t('dashboard.agentStatus.inactive')}
                </span>
            </p>
            <div>
                <button style={{...buttonStyle, background: '#28a745', color: 'white'}} onClick={handleStart} disabled={status.isRunning}>{t('dashboard.agentStatus.start')}</button>
                <button style={{...buttonStyle, background: '#dc3545', color: 'white'}} onClick={handleStop} disabled={!status.isRunning}>{t('dashboard.agentStatus.stop')}</button>
            </div>
            <div style={{ marginTop: '16px' }}>
                <h3 style={{...headerStyle, fontSize: '16px'}}>{t('dashboard.keyMetrics.title')}</h3>
                <p><strong>{t('dashboard.keyMetrics.timeSaved')}:</strong> {metrics.timeSaved} {t('dashboard.keyMetrics.unitHours')}</p>
                <p><strong>{t('dashboard.keyMetrics.meetingsOptimized')}:</strong> {metrics.meetingsOptimized}</p>
                <p><strong>{t('dashboard.keyMetrics.conflictsResolved')}:</strong> {metrics.conflictsResolved}</p>
                <p><strong>{t('dashboard.keyMetrics.teamSatisfaction')}:</strong> {metrics.satisfaction}/5</p>
            </div>
        </div>
    );
};

const ActivityLog = ({ logs }) => {
    const { t } = useTranslation();
    return (
    <div style={cardStyle}>
        <h2 style={headerStyle}>{t('dashboard.activityLog.title')}</h2>
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {logs.map((log, index) => (
                <div key={index} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0', fontSize: '14px' }}>
                    <p style={{ margin: 0 }}><strong>{new Date(log.timestamp).toLocaleTimeString()}</strong> - {log.message}</p>
                    {log.data && <pre style={{ fontSize: '12px', background: '#e9ecef', padding: '4px', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(log.data, null, 2)}</pre>}
                </div>
            ))}
        </div>
    </div>
)};

const DecisionExplainer = ({ decision }) => {
    const { t } = useTranslation();
    if (!decision) {
        return (
            <div style={cardStyle}>
                <h2 style={headerStyle}>{t('dashboard.latestDecision.title')}</h2>
                <p>{t('dashboard.latestDecision.noDecision')}</p>
            </div>
        );
    }

    // Normalize decision shape to handle various backend responses
    const action = decision?.decision?.action || decision?.action || 'N/A';
    const confidence = typeof decision?.confidence === 'number' ? decision.confidence : 0;
    const reasoning = decision?.explanation || decision?.decision?.rationale || decision?.rationale || t('dashboard.latestDecision.noExplanation');
    const alternatives: any[] = decision?.alternatives || decision?.decision?.alternatives || [];

    return (
        <div style={cardStyle}>
            <h2 style={headerStyle}>{t('dashboard.latestDecision.action', { action })}
</h2>
            <p><strong>{t('dashboard.latestDecision.confidence')}</strong> {(confidence * 100).toFixed(2)}%</p>
            <div>
                <strong>{t('dashboard.latestDecision.reasoning')}</strong>
                <p style={{ margin: '4px 0', padding: '8px', background: '#e9ecef', borderRadius: '4px' }}>{reasoning}</p>
            </div>
            <div>
                <strong>{t('dashboard.latestDecision.alternatives')}</strong>
                <ul>
                    {(alternatives || []).map((alt, i) => <li key={i}>{typeof alt === 'string' ? alt : JSON.stringify(alt)}</li>)}
                </ul>
            </div>
        </div>
    );
};

// Chat feature removed per V3 plan

// KPI Card + formatting
const KpiCard = ({ title, value, trend }: any) => (
  <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
    <p style={{ margin: 0, color: '#6c757d', fontSize: 12 }}>{title}</p>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
      <span style={{ marginTop: 4, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</span>
      {Number.isFinite(trend) && <span style={{ color: (trend as number) > 0 ? '#28a745' : '#dc3545', fontSize: 12 }}>{(trend as number) > 0 ? '📈' : '📉'} {Math.abs(trend)}%</span>}
    </div>
  </div>
);

const safeNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Meeting Health Donut
const MeetingHealthDonut = ({ metrics }: any) => {
  const { t } = useTranslation();
  const score = Math.min(100, Math.round((metrics.satisfaction || 0) / 5 * 100));
  const data = [
    { name: t('dashboard.meetingHealth.health'), value: score },
    { name: t('dashboard.meetingHealth.gap'), value: 100 - score },
  ];
  const COLORS = ['#00C49F', '#E9ECEF'];

  return (
    <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
      <h3 style={{ ...headerStyle, border: 'none', paddingBottom: 0 }}>{t('dashboard.meetingHealth.title')}</h3>
      <div style={{ width: '100%', height: 240, position: 'relative' }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={60} outerRadius={90} startAngle={90} endAngle={-270}> 
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Legend verticalAlign="bottom" height={24} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -60%)', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{score}/100</div>
          <div style={{ color: '#6c757d', fontSize: 12 }}>{t('dashboard.meetingHealth.basedOnSatisfaction')}</div>
        </div>
      </div>
    </div>
  );
};

// Decision Hub (requires your intervention)
const DecisionHub = ({ decision }: any) => {
  const { t } = useTranslation();
  const confidence = typeof decision?.confidence === 'number' ? decision.confidence : 0;
  const needsApproval = confidence > 0 && confidence < 0.75; // Simplified threshold
  if (!needsApproval) return null;
  const title = decision?.decision?.action || t('dashboard.decisionHub.defaultSuggestion');
  const reason = decision?.decision?.rationale || t('dashboard.decisionHub.defaultReason');

  const onApprove = async () => { await approveDecision(); alert(t('dashboard.decisionHub.approved')); };
  const onReject  = async () => { await rejectDecision();  alert(t('dashboard.decisionHub.rejected')); };
  const onModify  = async () => {
    const action = prompt(t('dashboard.decisionHub.promptAction'), title) || title;
    const rationale = prompt(t('dashboard.decisionHub.promptReason'), reason) || reason;
    await modifyDecision({ action, rationale });
    alert(t('dashboard.decisionHub.submitted'));
  };

  return (
    <div style={{ padding: 16, borderRadius: 8, background: '#fffbe6', border: '1px solid #ffe58f' }}>
      <h3 style={{ margin: 0 }}>{t('dashboard.decisionHub.title')}</h3>
      <p style={{ margin: '8px 0 4px' }}><strong>{title}</strong></p>
      <p style={{ margin: 0, color: '#6c757d' }}>{reason}</p>
      <p style={{ margin: '8px 0 12px' }}>{t('dashboard.decisionHub.confidence', { confidence: (confidence * 100).toFixed(0) })}
</p>
      <div>
        <button style={{ ...buttonStyle, background: '#28a745', color: 'white' }} onClick={onApprove}>{t('dashboard.decisionHub.approve')}</button>
        <button style={{ ...buttonStyle, background: '#17a2b8', color: 'white' }} onClick={onModify}>{t('dashboard.decisionHub.modify')}</button>
        <button style={{ ...buttonStyle, background: '#dc3545', color: 'white' }} onClick={onReject}>{t('dashboard.decisionHub.reject')}</button>
        <button style={{ ...buttonStyle, background: '#6c757d', color: 'white' }}>{t('dashboard.decisionHub.viewReasoning')}</button>
      </div>
    </div>
  );
};

// Unified left navigation component (see components/LeftNav)

// --- Main Dashboard Component (three-column layout) ---
const AgentDashboard: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<any>({ isRunning: false });
  const [metrics, setMetrics] = useState<any>({ timeSaved: 0, meetingsOptimized: 0, conflictsResolved: 0, satisfaction: 0 });
  const [logs, setLogs] = useState<any[]>([]);
  const [decision, setDecision] = useState<any>(null);
  const intervalRef = useRef<any>();
  const [readiness, setReadiness] = useState<{ backend_base_url_configured?: boolean; oauth_ready?: boolean }>({});

  const [auth, setAuth] = useState<{connected:boolean;email?:string}>({connected:false});
  const [events, setEvents] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [offers, setOffers] = useState<Record<string, any>>({});
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity?: 'success'|'info'|'warning'|'error' }>({ open: false, message: '' });
  const defaultTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const [usageWeekly, setUsageWeekly] = useState<{ totals?: any; rows?: any[]; conversion?: number; source?: string; period?: any }>({});
  const [reportVerify, setReportVerify] = useState<{ status: 'unknown'|'ok'|'mismatch'|'error'; details?: string }>({ status: 'unknown' });
  const [latestReport, setLatestReport] = useState<{ link?: string; name?: string; modifiedTime?: string } | null>(null);
  const [newEvent, setNewEvent] = useState({
    summary: t('dashboard.quickCreate.subject'),
    startLocal: '', // datetime-local
    duration: 30,   // minutes
    attendees: '',
    timezone: defaultTZ,
  });

  const [proposalOpen, setProposalOpen] = useState(false);

  const formatLocalISO = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = '00';
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
  };
  
  const fmtHours = (h: number) => t('dashboard.kpi.unitHours', { count: h.toFixed(1) });
  const fmtInt = (n: number) => t('dashboard.kpi.unitCount', { count: Math.round(n) });
  const fmtTimes = (n: number) => t('dashboard.kpi.unitTimes', { count: Math.round(n) });
  const fmtSatisfaction = (s: number) => t('dashboard.kpi.unitSatisfaction', { count: s.toFixed(1) });

  const fetchData = async () => {
    try {
      const [statusRes, metricsRes, logsRes, decisionRes, authRes, healthRes] = await Promise.all([
        getAgentStatus(),
        getAgentMetrics(),
        getActivityLog(),
        getLatestDecision(),
        getAuthStatus(),
        getHealth().catch(()=>({ data: {} }))
      ]);
      setStatus(statusRes.data);
      setMetrics(metricsRes.data);
      setLogs(logsRes.data);
      setDecision(decisionRes.data);
      setAuth(authRes.data);
      setReadiness(healthRes?.data?.readiness || {});
      // Usage weekly (best effort)
      try { const uw = await getUsageWeekly(7); setUsageWeekly(uw.data || {}); } catch {}
      try { const last = await getReportWeeklyLatest(); if (last?.data?.found && last.data.link) setLatestReport({ link: last.data.link, name: last.data.name, modifiedTime: last.data.modifiedTime }); } catch {}
      if (authRes.data?.connected) {
        getCalendarEvents().then(r => setEvents(r.data.items || [])).catch(()=>setEvents([]));
      } else {
        setEvents([]);
        setSuggestions([]);
        setOffers({});
      }
    } catch (error) {
      console.error('Failed to fetch agent data:', error);
    }
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 5000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const fetchSuggestions = async () => {
    try {
      setLoadingSuggest(prev => prev || suggestions.length === 0);
      const r = await getAgentSuggestions();
      const items = r.data.items || [];
      setSuggestions(items);
      const entries = await Promise.all(items.map(async (s:any) => {
        try { const r = await getOfferBySuggestion(s.id); return [s.id, r.data]; } catch { return [s.id, {}]; }
      }));
      const map: Record<string, any> = {};
      entries.forEach(([k, v]: any) => { map[k] = v; });
      setOffers(map);
      setLastRefreshed(Date.now());
    } catch {
      setSuggestions([]);
      setOffers({});
    } finally {
      setLoadingSuggest(false);
    }
  };

  useEffect(() => {
    if (!auth.connected) return;
    fetchSuggestions();
    const id = setInterval(fetchSuggestions, 30000);
    return () => clearInterval(id);
  }, [auth.connected]);

  const heroBadge = status.initialized
    ? (status.isRunning ? t('dashboard.agentStatus.heroBadge.running') : t('dashboard.agentStatus.heroBadge.waiting'))
    : (status.initializing ? t('dashboard.agentStatus.heroBadge.initializing') : t('dashboard.agentStatus.heroBadge.stopped'));

  return (
    <>
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('dashboard.header.subtitle')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {auth.connected && (
            <button style={{ padding: '6px 12px', border: '1px solid #e9ecef', borderRadius: 6, background: '#1976d2', color: 'white' }} onClick={()=>setProposalOpen(true)}>
              {t('dashboard.header.proposeMeeting')}
            </button>
          )}
          <div style={{ color: '#6c757d' }}>
            {auth.connected ? (
              <span>{t('dashboard.header.connectedToGoogle', { email: auth.email })}
</span>
            ) : (
              <a
                href={(((import.meta as any).env?.VITE_API_BASE_URL)
                  ? ((import.meta as any).env.VITE_API_BASE_URL as string).replace('/api','')
                  : (window?.location?.origin || '')) + '/auth/login'}
                style={{ textDecoration: 'none', color: '#1976d2' }}
              >
                {t('dashboard.header.connectToGoogle')}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 2-column layout (chat removed) */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, padding: 16 }}>
        {/* Left Nav */}
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>

        {/* Main Content */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Hero + KPI */}
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t('dashboard.agentStatus.title')}</div>
                <div style={{ fontSize: 16 }}>{heroBadge}</div>
              </div>
              <div>
                <button style={{ ...buttonStyle, background: '#28a745', color: 'white' }} onClick={() => startAgent().catch(console.error)} disabled={status.isRunning}>{t('dashboard.agentStatus.start')}</button>
                <button style={{ ...buttonStyle, background: '#dc3545', color: 'white' }} onClick={() => stopAgent().catch(console.error)} disabled={!status.isRunning}>{t('dashboard.agentStatus.stop')}</button>
              </div>
            </div>
            {/* Readiness banner */}
            {(() => {
              const r = readiness;
              const issues: string[] = [];
              if (r && r.backend_base_url_configured === false) issues.push('Backend base URL not configured');
              if (r && r.oauth_ready === false) issues.push('OAuth tokens not ready');
              if (issues.length === 0) return null;
              return (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#fff3cd', border: '1px solid #ffeeba', color: '#856404', fontSize: 13 }}>
                  {issues.join(' · ')}
                </div>
              );
            })()}
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 16 }}>
              <KpiCard title={t('dashboard.kpi.timeSaved')} value={fmtHours(safeNum(metrics.timeSaved, 0))} trend={12} />
              <KpiCard title={t('dashboard.kpi.meetingsOptimized')} value={fmtInt(safeNum(metrics.meetingsOptimized, 0))} trend={8} />
              <KpiCard title={t('dashboard.kpi.conflictsResolved')} value={fmtTimes(safeNum(metrics.conflictsResolved, 0))} trend={15} />
              <KpiCard title={t('dashboard.kpi.teamSatisfaction')} value={fmtSatisfaction(safeNum(metrics.satisfaction, 0))} trend={3} />
            </div>
          </div>

          {/* Decision Hub + Health + Activity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
            <div style={{ display: 'grid', gap: 16 }}>
              <DecisionHub decision={decision} />
              {/* Suggestions List */}
              {auth.connected && (
                <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
                  <h3 style={{ ...headerStyle, border: 'none', paddingBottom: 0 }}>{t('dashboard.suggestions.title')}</h3>
                  <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>{lastRefreshed ? t('dashboard.suggestions.lastRefreshed', { time: new Date(lastRefreshed).toLocaleTimeString() }) : ''}</div>
                  {loadingSuggest ? (
                    <div style={{ color: '#6c757d' }}>{t('dashboard.suggestions.loading')}</div>
                  ) : suggestions.length === 0 ? (
                    <p style={{ color: '#6c757d' }}>{t('dashboard.suggestions.noSuggestions')}</p>
                  ) : (
                    suggestions.map((s) => (
                      <div key={s.id} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 600 }}>{s.proposal?.summary || t('dashboard.suggestions.noSubject')}</div>
                          <span style={{ fontSize: 12, color: '#6c757d', border: '1px solid #e9ecef', borderRadius: 4, padding: '0 4px' }}>{t('dashboard.suggestions.status.pending')}</span>
                          {offers[s.id]?.status === 'sent' && (
                            <span style={{ fontSize: 12, color: '#0c5460', background: '#d1ecf1', border: '1px solid #bee5eb', borderRadius: 4, padding: '0 4px' }}>{t('dashboard.suggestions.status.sent')}</span>
                          )}
                          {offers[s.id]?.status === 'confirmed' && (
                            <span style={{ fontSize: 12, color: '#155724', background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 4, padding: '0 4px' }}>{t('dashboard.suggestions.status.confirmed', { index: (offers[s.id]?.selectedIndex ?? 0) + 1 })}
</span>
                          )}
                          {Array.isArray(s.proposal?.attendees) && s.proposal.attendees.length > 0 && (
                            <span style={{ fontSize: 12, color: '#856404', background: '#fff3cd', border: '1px solid #ffeeba', borderRadius: 4, padding: '0 4px' }}>{t('dashboard.suggestions.status.needsConfirmation')}</span>
                          )}
                          {(!s.proposal?.attendees || s.proposal.attendees.length === 0) && (
                            <span style={{ fontSize: 12, color: '#155724', background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 4, padding: '0 4px' }}>{t('dashboard.suggestions.status.mutualAvailability')}</span>
                          )}
                        </div>
                        <div style={{ color: '#6c757d', fontSize: 12 }}>{t('dashboard.suggestions.time', { start: s.proposal?.start, end: s.proposal?.end, timezone: s.proposal?.timezone })}
</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{ fontSize: 12, color: '#6c757d' }}>{t('dashboard.suggestions.confidence')}</span>
                          <div style={{ width: 120, height: 6, background: '#e9ecef', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.round((s.confidence||0)*100)}%`, height: '100%', background: '#28a745' }} />
                          </div>
                          <span style={{ fontSize: 12, color: '#6c757d' }}>{Math.round((s.confidence||0)*100)}%</span>
                        </div>
                        <div style={{ color: '#6c757d', fontSize: 12 }}>{s.explanation}</div>
                        {Array.isArray(s.candidates) && s.candidates.length > 0 && (
                          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#6c757d' }}>{t('dashboard.suggestions.candidates')}</span>
                            <select onChange={(e)=>{
                              const idx = Number(e.target.value);
                              setSuggestions(prev => prev.map(x => x.id === s.id ? { ...x, _selectedIdx: idx } : x));
                            }} value={s._selectedIdx ?? 0}>
                              {s.candidates.map((c:any, i:number) => (
                                <option key={i} value={i}>{c.start} ~ {c.end}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {(() => {
                            const autoProposeThreshold = Number(import.meta.env.VITE_AUTO_PROPOSE_THRESHOLD || 0.8);
                            const hasCandidates = Array.isArray(s.candidates) && s.candidates.length > 0;
                            const attendees = Array.isArray(s.proposal?.attendees) ? s.proposal.attendees : [];
                            const canApprove = hasCandidates && attendees.length > 0;
                            const disabledStyle: React.CSSProperties = canApprove ? {} : { background: '#adb5bd', border: '1px solid #ced4da', cursor: 'not-allowed', opacity: 0.6 };
                            return (
                              <button style={{ ...buttonStyle, background: '#28a745', color: 'white', ...disabledStyle }}
                                disabled={!canApprove}
                            onClick={async () =>{
                            const idx = (s as any)._selectedIdx ?? 0;
                            const payload = Array.isArray(s.candidates) && s.candidates[idx] ? {
                              start: s.candidates[idx].start,
                              end: s.candidates[idx].end,
                              timezone: s.proposal?.timezone,
                              attendees: s.proposal?.attendees || []
                            } : undefined;
                            try {
                              const resp = await approveSuggestion(s.id, payload);
                              if (!resp?.data?.eventId) {
                                alert(t('dashboard.suggestions.sendFailed'));
                                return;
                              }
                              console.log(t('dashboard.suggestions.approvedAndCreated'));
                              getAgentSuggestions().then(r => setSuggestions(r.data.items || []));
                              getCalendarEvents().then(r => setEvents(r.data.items || []));
                            } catch (e) {
                              alert(t('dashboard.suggestions.sendFailed'));
                            }
                          }}>{t('dashboard.decisionHub.approve')}</button>
                            );
                          })()}
                          <button style={{ ...buttonStyle, background: '#dc3545', color: 'white' }} onClick={async () =>{
                            await rejectSuggestion(s.id);
                            console.log(t('dashboard.suggestions.rejected'));
                            getAgentSuggestions().then(r => setSuggestions(r.data.items || []));
                          }}>{t('dashboard.decisionHub.reject')}</button>
                          {Array.isArray(s.proposal?.attendees) && s.proposal.attendees.length > 0 && (!offers[s.id]?.status || offers[s.id]?.status==='') && (
                            <button style={{ ...buttonStyle, background: '#17a2b8', color: 'white' }} onClick={async () =>{
                              try {
                                const slots = Array.isArray(s.candidates) && s.candidates.length ? s.candidates : [{ start: s.proposal.start, end: s.proposal.end }];
                                const resp = await sendMeetingOptions({
                                  subject: s.proposal.summary || t('dashboard.suggestions.meeting'),
                                  agenda: s.explanation || '',
                                  timezone: s.proposal.timezone || '',
                                  attendees: s.proposal.attendees || [],
                                  slots,
                                  // @ts-ignore Send with suggestion ID for tracking
                                  suggestionId: s.id,
                                });
                                console.log(t('dashboard.suggestions.sendCandidates'));
                                // Optimistic update status
                                setOffers(prev => ({ ...prev, [s.id]: { status: 'sent', createdAt: Date.now() } }));
                                const links = resp?.data?.links || [];
                                if (links.length) { (s as any)._links = links; setSuggestions(prev => prev.map(x => x.id===s.id ? { ...x } : x)); }
                              } catch (e) {
                                console.error(t('dashboard.suggestions.sendFailed'), e);
                              }
                            }}>{t('dashboard.suggestions.sendCandidates')}</button>
                          )}
                        </div>
                        {(() => {
                          const autoProposeThreshold = Number(import.meta.env.VITE_AUTO_PROPOSE_THRESHOLD || 0.8);
                          const hasCandidates = Array.isArray(s.candidates) && s.candidates.length > 0;
                          if (hasCandidates) return null;
                          if (typeof s.confidence !== 'number') return null;
                          if (s.confidence >= autoProposeThreshold) return null;
                          const conf = Math.round((s.confidence || 0) * 100);
                          const thr = Math.round(autoProposeThreshold * 100);
                          return (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#6c757d' }}>
                              <div>Confidence {conf}% is below the auto-propose threshold ({thr}%). Please review and either send candidates or create a meeting manually.</div>
                              <div>信頼度 {conf}% は自動提案のしきい値（{thr}%）を下回っています。内容をご確認の上、候補送信または手動で会議作成をご検討ください。</div>
                            </div>
                          );
                        })()}
                        {Array.isArray((s as any)._links) && (s as any)._links.length > 0 && (
                          <div style={{ marginTop: 8, background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: 6, padding: 8 }}>
                            <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>{t('dashboard.suggestions.confirmationLinks')}</div>
                            {(s as any)._links.map((l:any) => (
                              <div key={l.url} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 12 }}>{l.idx}. {l.start} ~ {l.end}</span>
                                <input readOnly value={l.url} style={{ flex: 1, fontSize: 12 }} onFocus={(e)=>e.currentTarget.select()} />
                                <button style={{ ...buttonStyle }} onClick={()=>{ navigator.clipboard.writeText(l.url); }}>{t('dashboard.suggestions.copy')}</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
                <h3 style={{ ...headerStyle, border: 'none', paddingBottom: 0 }}>{t('dashboard.activityStream.title')}</h3>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {logs.map((log: any, i: number) => (
                    <div key={i} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0' }}>
                      <div style={{ fontSize: 12, color: '#6c757d' }}>{new Date(log.timestamp).toLocaleTimeString()}</div>
                      <div>{log.message}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Weekly Usage Summary */}
              <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
                <h3 style={{ ...headerStyle, border: 'none', paddingBottom: 0 }}>Usage Summary (7d)</h3>
                {usageWeekly?.totals ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 8 }}>
                    <KpiCard title={'Suggestions'} value={safeNum(usageWeekly.totals.suggestions, 0)} />
                    <KpiCard title={'Sent'} value={safeNum(usageWeekly.totals.auto_sent, 0)} />
                    <KpiCard title={'Confirmed'} value={safeNum(usageWeekly.totals.confirmed, 0)} />
                    <KpiCard title={'Meetings'} value={safeNum(usageWeekly.totals.meetings, 0)} />
                    <KpiCard title={'Minutes'} value={safeNum(usageWeekly.totals.minutes, 0)} />
                  </div>
                ) : (
                  <div style={{ color: '#6c757d' }}>No data</div>
                )}
                <div style={{ marginTop: 12 }}>
                  <button style={{ ...buttonStyle, background: '#6c757d', color: 'white' }} onClick={async ()=>{
                    try {
                      const r = await generateWeeklyReport(7);
                      const link = r?.data?.link;
                      if (link) window.open(link, '_blank');
                      else alert('Report generated, but link missing');
                    } catch (e) {
                      alert('Failed to generate weekly report');
                    }
                  }}>Generate Weekly Report</button>
                  <button style={{ ...buttonStyle, background: '#17a2b8', color: 'white' }} onClick={async ()=>{
                    try {
                      const preview = await getReportWeeklyPreview(7);
                      const p = preview.data || {};
                      const u = usageWeekly || {};
                      const eq = (a:number,b:number)=>Math.abs((Number(a)||0)-(Number(b)||0))<1e-6;
                      if (p?.totals && u?.totals && eq(p.totals.suggestions,u.totals.suggestions) && eq(p.totals.auto_sent,u.totals.auto_sent) && eq(p.totals.confirmed,u.totals.confirmed) && eq(p.totals.meetings,u.totals.meetings) && eq(p.totals.minutes,u.totals.minutes)) {
                        setReportVerify({ status: 'ok' });
                      } else {
                        setReportVerify({ status: 'mismatch', details: JSON.stringify({ preview: p?.totals || {}, insights: u?.totals || {} }) });
                      }
                    } catch (e:any) {
                      setReportVerify({ status: 'error', details: e?.message || String(e) });
                    }
                  }}>Verify Report vs Insights</button>
                  {reportVerify.status !== 'unknown' && (
                    <span style={{ marginLeft: 8, fontSize: 13, color: reportVerify.status==='ok' ? '#155724' : (reportVerify.status==='mismatch' ? '#856404' : '#721c24') }}>
                      {reportVerify.status==='ok' ? 'OK' : reportVerify.status==='mismatch' ? 'Mismatch' : 'Error'}
                    </span>
                  )}
                  {latestReport?.link && (
                    <span style={{ marginLeft: 12, fontSize: 13 }}>
                      Latest: <a href={latestReport.link} target="_blank" rel="noreferrer">{latestReport.name || 'Weekly Report'}</a>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <MeetingHealthDonut metrics={metrics} />
          </div>

          {/* Deep decision explainer */}
          <DecisionExplainer decision={decision} />
          {/* Calendar Preview */}
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <h3 style={{ ...headerStyle, border: 'none', paddingBottom: 0 }}>{t('dashboard.calendarPreview.title')}</h3>
            {!auth.connected ? (
              <p style={{ color: '#6c757d' }}>{t('dashboard.calendarPreview.notConnected')}</p>
            ) : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {events.length === 0 ? (
                  <p style={{ color: '#6c757d' }}>{t('dashboard.calendarPreview.noEvents')}</p>
                ) : (
                  events.map((ev, i) => (
                    <div key={i} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0' }}>
                      <div style={{ fontWeight: 600 }}>{ev.summary || t('dashboard.calendarPreview.noTitle')}</div>
                      <div style={{ color: '#6c757d', fontSize: 12 }}>
                        {(ev.start?.dateTime || ev.start?.date) || ''} → {(ev.end?.dateTime || ev.end?.date) || ''}
                      </div>
                      {ev.location && <div style={{ color: '#6c757d', fontSize: 12 }}>{ev.location}</div>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Quick Create Meeting */}
          {auth.connected && (
            <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
              <h3 style={{ ...headerStyle, border: 'none', paddingBottom: 0 }}>{t('dashboard.quickCreate.title')}</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                <input placeholder={t('dashboard.quickCreate.subject')} value={newEvent.summary} onChange={e=>setNewEvent({...newEvent, summary: e.target.value})} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr', gap: 8 }}>
                  <input type="datetime-local" value={newEvent.startLocal} onChange={e=>setNewEvent({...newEvent, startLocal: e.target.value})} />
                  <select value={newEvent.duration} onChange={e=>setNewEvent({...newEvent, duration: Number(e.target.value)})}>
                    {[15,30,45,60,90].map(m => <option key={m} value={m}>{t('dashboard.quickCreate.minutes', { count: m })}</option>)}
                  </select>
                  <input placeholder={t('dashboard.quickCreate.timezonePlaceholder')} value={newEvent.timezone} onChange={e=>setNewEvent({...newEvent, timezone: e.target.value})} />
                </div>
                <input placeholder={t('dashboard.quickCreate.attendeesPlaceholder')} value={newEvent.attendees} onChange={e=>setNewEvent({...newEvent, attendees: e.target.value})} />
                <button style={{ ...buttonStyle, background: '#1976d2', color: 'white', width: 160 }} onClick={async () =>{
                  try {
                    if (!newEvent.startLocal) return alert(t('dashboard.quickCreate.promptStartTime'));
                    const attendees = newEvent.attendees.split(',').map(s=>s.trim()).filter(Boolean);
                    const startDate = new Date(newEvent.startLocal);
                    const endDate = new Date(startDate.getTime() + newEvent.duration * 60 * 1000);
                    const startISO = formatLocalISO(startDate);
                    const endISO = formatLocalISO(endDate);
                    const resp = await createCalendarEvent({ summary: newEvent.summary, start: startISO, end: endISO, timezone: newEvent.timezone, attendees, createMeet: true });
                    alert(t('dashboard.quickCreate.created') + (resp.data?.meetLink ? t('dashboard.quickCreate.meetLink', { link: resp.data.meetLink }) : ''));
                    getCalendarEvents().then(r => setEvents(r.data.items || []));
                  } catch (e) {
                    alert(t('dashboard.quickCreate.createFailed'));
                  }
                }}>{t('dashboard.quickCreate.createMeeting')}</button>
              </div>
            </div>
          )}
        </div>

        {/* Right side removed */}
      </div>
    </div>
    <MeetingProposalModal open={proposalOpen} onClose={()=>setProposalOpen(false)} defaultAttendee={auth?.email} />
    </>
  );
};

export default AgentDashboard;
