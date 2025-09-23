import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const LeftNav: React.FC = () => {
  const { t, i18n } = useTranslation();

  const items = [
    { to: '/dashboard', label: t('nav.dashboard') },
    { to: '/logs', label: t('nav.activityLog') },
    { to: '/insights', label: t('nav.teamInsights') },
    { to: '/knowledge', label: t('nav.knowledge') },
    { to: '/gmail', label: t('nav.gmail') },
    { to: '/drive', label: t('nav.drive') },
    { to: '/speech', label: t('nav.speech') },
    { to: '/settings', label: t('nav.settings'), divider: true },
  ];

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 16 }}>{t('nav.navigation')}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {items.map(item => (
          <li key={item.to} style={item.divider ? { marginTop: 8, borderTop: '1px solid #e9ecef', paddingTop: 8 } : {}}>
            <NavLink to={item.to} style={({ isActive }) => ({ textDecoration: 'none', color: isActive ? '#1976d2' : '#495057', fontWeight: isActive ? 700 : 400 })}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 24 }}>
        <button onClick={() => changeLanguage('en')} style={{ marginRight: 8 }}>English</button>
        <button onClick={() => changeLanguage('ja')}>日本語</button>
      </div>
    </div>
  );
};

export default LeftNav;

