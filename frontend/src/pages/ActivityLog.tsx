import React, { useEffect, useState } from 'react';
import { getActivityLog } from '../services/api';
import LeftNav from '../components/LeftNav';
import { useTranslation } from 'react-i18next';

// Unified side navigation from components/LeftNav

const ActivityLogPage: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    getActivityLog().then(r => setLogs(r.data)).catch(console.error);
  }, []);

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('activityLogPage.subtitle')}</span>
        </div>
        <div style={{ color: '#6c757d' }}>{t('activityLogPage.user')}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, padding: 16 }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
          <h3 style={{ marginTop: 0 }}>{t('dashboard.activityLog.title')}</h3>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {logs.map((log, i) => (
              <div key={i} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0' }}>
                <div style={{ fontSize: 12, color: '#6c757d' }}>{new Date(log.timestamp).toLocaleString()}</div>
                <div>{log.message}</div>
                {log.data && <pre style={{ background: '#f8f9fa', padding: 8, borderRadius: 6 }}>{JSON.stringify(log.data, null, 2)}</pre>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityLogPage;
