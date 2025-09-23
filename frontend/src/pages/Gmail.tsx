import React, { useEffect, useState } from 'react';
import LeftNav from '../components/LeftNav';
import { getGmailMessages, getGmailMessage, sendGmailMessage } from '../services/api';
import { useTranslation } from 'react-i18next';

const GmailPage: React.FC = () => {
  const { t } = useTranslation();
  const [list, setList] = useState<any[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [compose, setCompose] = useState({ to: '', subject: '', html: t('gmailPage.hello') });

  const load = async (pageToken?: string) => {
    const r = await getGmailMessages({ maxResults: 10, pageToken });
    setList(r.data.items || []);
    setNextToken(r.data.nextPageToken || null);
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('gmailPage.subtitle')}</span>
        </div>
        <div style={{ color: '#6c757d' }}></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: 16, padding: 16 }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
          <h3 style={{ marginTop: 0 }}>{t('gmailPage.inbox')}</h3>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {list.map((m) => (
              <div key={m.id} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0', cursor: 'pointer' }} onClick={async ()=>{
                const r = await getGmailMessage(m.id);
                setSelected(r.data);
              }}>
                <div style={{ fontWeight: 600 }}>{m.subject || t('dashboard.suggestions.noSubject')}</div>
                <div style={{ color: '#6c757d', fontSize: 12 }}>{m.from} · {m.date}</div>
                <div style={{ color: '#6c757d' }}>{m.snippet}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <button onClick={()=>load(nextToken || undefined)} disabled={!nextToken}>{t('gmailPage.nextPage')}</button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef', minHeight: 240 }}>
            <h3 style={{ marginTop: 0 }}>{t('gmailPage.emailDetails')}</h3>
            {!selected ? <p style={{ color: '#6c757d' }}>{t('gmailPage.selectEmailPrompt')}</p> : (
              <div>
                <div style={{ fontWeight: 700 }}>{selected.subject}</div>
                <div style={{ color: '#6c757d', fontSize: 12 }}>{selected.from} &rarr; {selected.to} · {selected.date}</div>
                <div style={{ marginTop: 8 }}>
                  {selected.html ? (
                    <div dangerouslySetInnerHTML={{ __html: selected.html }} />
                  ) : (
                    <pre>{selected.text}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <h3 style={{ marginTop: 0 }}>{t('gmailPage.compose')}</h3>
            <input placeholder={t('gmailPage.to')} value={compose.to} onChange={e=>setCompose({...compose, to: e.target.value})} />
            <input placeholder={t('gmailPage.subject')} value={compose.subject} onChange={e=>setCompose({...compose, subject: e.target.value})} style={{ marginTop: 8 }} />
            <textarea placeholder={t('gmailPage.htmlBody')} value={compose.html} onChange={e=>setCompose({...compose, html: e.target.value})} rows={6} style={{ marginTop: 8, width: '100%' }} />
            <button style={{ marginTop: 8 }} onClick={async ()=>{
              if (!compose.to) return alert(t('gmailPage.recipientPrompt'));
              await sendGmailMessage({ to: compose.to, subject: compose.subject, html: compose.html });
              alert(t('gmailPage.sent'));
              setCompose({ to: '', subject: '', html: t('gmailPage.hello') });
            }}>{t('gmailPage.send')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GmailPage;

