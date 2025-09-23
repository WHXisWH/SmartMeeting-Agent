import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { useEffect, useState } from 'react';
import { getMeetingPatterns, getDecisionBottlenecks } from '../services/api';
import LeftNav from '../components/LeftNav';
import { useTranslation } from 'react-i18next';

const InsightsPage: React.FC = () => {
  const { t } = useTranslation();
  const [barData, setBarData] = useState<any[]>([]);
  const [lineData, setLineData] = useState<any[]>([]);
  useEffect(() => {
    getMeetingPatterns().then(r => setBarData(r.data.data || [])).catch(() => setBarData([]));
    getDecisionBottlenecks().then(r => setLineData(r.data.data || [])).catch(() => setLineData([]));
  }, []);

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('insightsPage.subtitle')}</span>
        </div>
        <div style={{ color: '#6c757d' }}>{t('activityLogPage.user')}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, padding: 16 }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <h3 style={{ marginTop: 0 }}>{t('insightsPage.meetingPatterns')}</h3>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={barData}>
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="meetings" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p style={{ color: '#6c757d' }}>{t('insightsPage.meetingPatternsSuggestion')}</p>
          </div>

          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <h3 style={{ marginTop: 0 }}>{t('insightsPage.decisionBottlenecks')}</h3>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="size" label={{ value: t('insightsPage.attendeeCount'), position: 'insideBottom', dy: 10 }} />
                  <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <Tooltip formatter={(v) => `${Math.round((v as number) * 100)}%`} />
                  <Line type="monotone" dataKey="rate" stroke="#82ca9d" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p style={{ color: '#6c757d' }}>{t('insightsPage.decisionBottlenecksSuggestion')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InsightsPage;
