import React, { useEffect, useState } from 'react';
import LeftNav from '../components/LeftNav';
import { useTranslation } from 'react-i18next';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [autonomy, setAutonomy] = useState<number>(2); // 1,2,3
  const [prefs, setPrefs] = useState({
    autoCancelInefficient: true,
    autoRescheduleConflicts: true,
    notifyOwnersOnBlockers: true,
  });

  useEffect(() => {
    const raw = localStorage.getItem('smartmeet_prefs');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setAutonomy(parsed.autonomy ?? 2);
        setPrefs(parsed.prefs ?? prefs);
      } catch {}
    }
  }, []);

  const save = () => {
    localStorage.setItem('smartmeet_prefs', JSON.stringify({ autonomy, prefs }));
    alert(t('settingsPage.saveSuccess'));
  };

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('settingsPage.subtitle')}</span>
        </div>
        <div style={{ color: '#6c757d' }}>{t('activityLogPage.user')}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, padding: 16 }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef', display: 'grid', gap: 16 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>{t('settingsPage.autonomyLevel')}</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {[{key:1,label:t('settingsPage.level1')},{key:2,label:t('settingsPage.level2')},{key:3,label:t('settingsPage.level3')}].map(opt => (
                <label key={opt.key} style={{ display: 'flex', alignItems:'center', gap:8 }}>
                  <input type="radio" name="autonomy" checked={autonomy===opt.key} onChange={()=>setAutonomy(opt.key)} />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>{t('settingsPage.decisionPreferences')}</h3>
            <label style={{ display: 'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={prefs.autoCancelInefficient} onChange={e=>setPrefs({...prefs, autoCancelInefficient: e.target.checked})} />
              {t('settingsPage.autoCancel')}
            </label>
            <label style={{ display: 'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={prefs.autoRescheduleConflicts} onChange={e=>setPrefs({...prefs, autoRescheduleConflicts: e.target.checked})} />
              {t('settingsPage.autoReschedule')}
            </label>
            <label style={{ display: 'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={prefs.notifyOwnersOnBlockers} onChange={e=>setPrefs({...prefs, notifyOwnersOnBlockers: e.target.checked})} />
              {t('settingsPage.notifyOnBlockers')}
            </label>
          </div>
          <div>
            <button onClick={save} style={{ padding: '8px 16px', background: '#1976d2', color: 'white', border: 0, borderRadius: 6 }}>{t('settingsPage.saveSettings')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
