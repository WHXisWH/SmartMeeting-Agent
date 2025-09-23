import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import LeftNav from '../components/LeftNav';
import { useTranslation } from 'react-i18next';

const DrivePage: React.FC = () => {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [upload, setUpload] = useState<{file?: File, name: string}>({ name: '' });

  const load = async () => {
    const r = await api.get('/drive/files', { params: { query: q } });
    setFiles(r.data.items || []);
  };

  useEffect(() => { load(); }, []);

  const fileToBase64 = (f: File): Promise<string> => new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('drivePage.subtitle')}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: 16, padding: 16 }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
          <h3 style={{ marginTop: 0 }}>{t('drivePage.fileList')}</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input placeholder={t('drivePage.searchPlaceholder')} value={q} onChange={e=>setQ(e.target.value)} />
            <button onClick={load}>{t('drivePage.search')}</button>
          </div>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {files.map(f => (
              <div key={f.id} style={{ borderBottom: '1px solid #e9ecef', padding: '8px 0', cursor: 'pointer' }} onClick={()=>setSelected(f)}>
                <div style={{ fontWeight: 600 }}>{f.name}</div>
                <div style={{ color: '#6c757d', fontSize: 12 }}>{f.mimeType} · {t('drivePage.modified', { time: f.modifiedTime })}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <h3 style={{ marginTop: 0 }}>{t('drivePage.uploadFile')}</h3>
            <input type="file" onChange={e=>setUpload({ file: e.target.files?.[0], name: e.target.files?.[0]?.name || '' })} />
            <input placeholder={t('drivePage.fileName')} value={upload.name} onChange={e=>setUpload({...upload, name: e.target.value})} style={{ marginTop: 8 }} />
            <button style={{ marginTop: 8 }} onClick={async ()=>{
              if (!upload.file || !upload.name) return alert(t('drivePage.selectFilePrompt'));
              const b64 = await fileToBase64(upload.file);
              const r = await api.post('/drive/files/upload', { fileName: upload.name, mimeType: upload.file.type, contentBase64: b64 });
              alert(t('drivePage.uploadSuccess'));
              setSelected(r.data.file);
              load();
            }}>{t('drivePage.upload')}</button>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef' }}>
            <h3 style={{ marginTop: 0 }}>{t('drivePage.fileDetails')}</h3>
            {!selected ? <p style={{ color: '#6c757d' }}>{t('drivePage.selectFilePrompt')}</p> : (
              <div>
                <div style={{ fontWeight: 600 }}>{selected.name}</div>
                {selected.webViewLink && <div><a href={selected.webViewLink} target="_blank">{t('drivePage.open')}</a></div>}
                <button style={{ marginTop: 8 }} onClick={async ()=>{
                  const r = await api.post(`/drive/files/${selected.id}/permissions`, { role: 'reader', type: 'anyone' });
                  alert(t('drivePage.permissionSet'));
                  setSelected(r.data.file);
                }}>{t('drivePage.setPublic')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DrivePage;

