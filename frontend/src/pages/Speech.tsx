import React, { useState, useRef, useEffect } from 'react';
import { api, generateMindMap } from '../services/api';
import MindMapViewer from '../components/MindMapViewer';
import LeftNav from '../components/LeftNav';
import { useTranslation } from 'react-i18next';

const TabButton: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '10px 16px',
      border: 'none',
      borderBottom: active ? '2px solid #007bff' : '2px solid transparent',
      background: 'none',
      cursor: 'pointer',
      fontWeight: active ? 700 : 400,
      color: active ? '#007bff' : '#495057',
      marginBottom: -1,
    }}
  >
    {label}
  </button>
);

const SpeechPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('realtime');
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState(localStorage.getItem('sm_lang') || 'zh-CN');
  const [transcript, setTranscript] = useState('');
  const [docLink, setDocLink] = useState<string | null>(null);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<BlobPart[]>([]);
  const [liveText, setLiveText] = useState('');
  const [sr, setSr] = useState<any>(null);
  const [seconds, setSeconds] = useState(0);
  const timerRef = React.useRef<any>(null);

  // Mind map visualization related
  const [mindMapData, setMindMapData] = useState<any>(null);
  const [isGeneratingMindMap, setIsGeneratingMindMap] = useState(false);
  const [mindMapError, setMindMapError] = useState<string | null>(null);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const mindMapTimerRef = useRef<any>(null);
  const lastMindMapUpdate = useRef<number>(0);
  const [accumulatedContent, setAccumulatedContent] = useState<string>('');
  const lastLiveTextRef = useRef<string>('');

  const fileToBase64 = (f: File): Promise<string> => new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  const resetAccumulatedContent = () => {
    setAccumulatedContent('');
    lastLiveTextRef.current = '';
  };

  const refreshMindMap = async () => {
    const currentText = transcript || accumulatedContent;
    if (!currentText.trim()) return;
    setMindMapError(null);
    setIsGeneratingMindMap(true);
    try {
      const resp = await generateMindMap(currentText, sessionId);
      if (resp.data?.mindmap) setMindMapData(resp.data.mindmap);
      lastMindMapUpdate.current = Date.now();
    } catch (e) {
      setMindMapError(t('speechPage.mindMapFailed'));
    } finally {
      setIsGeneratingMindMap(false);
    }
  };

  const startMindMapTimer = () => {
    if (mindMapTimerRef.current) clearInterval(mindMapTimerRef.current);
    mindMapTimerRef.current = setInterval(() => {
      const now = Date.now();
      const currentText = transcript || accumulatedContent;
      if (currentText.trim().length >= 10 && now - lastMindMapUpdate.current >= 30 * 1000) {
        refreshMindMap();
      }
    }, 5000);
  };

  const stopMindMapTimer = () => { if (mindMapTimerRef.current) { clearInterval(mindMapTimerRef.current); mindMapTimerRef.current = null; } };

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('speechPage.subtitle')}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 380px', gap: 16, padding: 16, alignItems: 'start' }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ padding: 16, borderRadius: 8, background: 'white', border: '1px solid #e9ecef', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tab Switcher */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e9ecef' }}>
            <TabButton label={t('speechPage.realtimeTab')} active={activeTab === 'realtime'} onClick={() => setActiveTab('realtime')} />
            <TabButton label={t('speechPage.uploadTab')} active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} />
          </div>

          {/* Tab Content */}
          <div>
            {activeTab === 'realtime' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#6c757d' }}>{t('speechPage.realtimeDescription')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={async ()=>{ 
                    if (!navigator.mediaDevices?.getUserMedia) return alert(t('speechPage.unsupportedRecording'));
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const mediaRecorder = new MediaRecorder(stream);
                    const localChunks: BlobPart[] = [];
                    mediaRecorder.ondataavailable = (e)=>{ if (e.data.size>0) localChunks.push(e.data); };
                    mediaRecorder.onstop = async ()=>{ 
                      const blob = new Blob(localChunks, { type: 'audio/webm' });
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const b64 = (reader.result as string).split(',')[1];
                        const r = await api.post('/speech/transcribe', { contentBase64: b64, languageCode: lang });
                        setTranscript(r.data.transcript || t('speechPage.noContent'));
                      };
                      reader.readAsDataURL(blob);
                      if (sr) { try { sr.stop(); } catch {} }
                      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
                      stopMindMapTimer();
                    };
                    mediaRecorder.start();
                    setChunks(localChunks);
                    setRec(mediaRecorder);
                    setSeconds(0);
                    if (timerRef.current) clearInterval(timerRef.current);
                    timerRef.current = setInterval(()=> setSeconds(s=>s+1), 1000);
                    resetAccumulatedContent();
                    startMindMapTimer();
                    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                    if (SR) {
                      const recog = new SR();
                      recog.lang = lang || 'en-US';
                      recog.continuous = true;
                      recog.interimResults = true;
                      recog.onresult = (e: any) => {
                        const idx = e.results.length - 1;
                        const seg = idx >= 0 ? e.results[idx][0].transcript as string : '';
                        const isFinal = idx >= 0 ? e.results[idx].isFinal === true : false;
                        setLiveText(seg);
                        if (isFinal && seg && seg.trim()) {
                          const endsWithBreak = /[。．.!?！？…;；,，]$/.test(seg.trim());
                          setAccumulatedContent(prev => {
                            const glue = prev ? (endsWithBreak ? '\n' : ' ') : '';
                            return (prev + glue + seg.trim()).slice(-8000);
                          });
                          lastLiveTextRef.current = '';
                        }
                      };
                      recog.onend = () => {
                        try { recog.start(); } catch {}
                      };
                      try { recog.start(); setSr(recog); } catch {}
                    } else {
                      setLiveText(t('speechPage.unsupportedWebSpeech'));
                    }
                  }}>{t('speechPage.startRecording')}</button>
                  <button onClick={()=>{ if (rec && rec.state!=='inactive') { rec.stop(); setRec(null); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } stopMindMapTimer(); } }}>{t('speechPage.stopAndTranscribe')}</button>
                </div>
                <div style={{ color: '#6c757d', fontSize: 12 }}>{t('speechPage.duration', { seconds })}</div>
                <div>
                  <label>{t('speechPage.language')}</label>
                  <select value={lang} onChange={e=>{ setLang(e.target.value); localStorage.setItem('sm_lang', e.target.value); }}>
                    {['zh-CN','ja-JP','en-US','zh-TW','ko-KR','fr-FR'].map(code => <option key={code} value={code}>{code}</option>)}
                  </select>
                  <span style={{ marginLeft: 8, color: '#6c757d', fontSize: 12 }}>{t('speechPage.captionSupport')} {((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition)? t('speechPage.available') : t('speechPage.unavailable')}</span>
                </div>
                <hr style={{border: 'none', borderTop: '1px solid #e9ecef', margin: '8px 0'}} />
                 <h4>{t('speechPage.liveCaptions')}</h4>
                <div style={{ minHeight: 100, border: '1px dashed #ccc', padding: 8, background: '#fafafa', overflowY: 'auto' }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {((accumulatedContent ? accumulatedContent + '\n' : '') + (liveText || '')).trim() || t('speechPage.liveCaptionsPlaceholder')}
                  </pre>
                </div>
              </div>
            )}
            {activeTab === 'upload' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#6c757d' }}>{t('speechPage.uploadDescription')}</div>
                <input type="file" accept="audio/*" onChange={e=>setFile(e.target.files?.[0] || null)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={async ()=>{ 
                    if (!file) return alert(t('speechPage.selectAudioFile'));
                    setTranscript(t('speechPage.transcribing'));
                    setDocLink(null);
                    const b64 = await fileToBase64(file);
                    const r = await api.post('/speech/transcribe', { contentBase64: b64, languageCode: lang });
                    setTranscript(r.data.transcript || t('speechPage.noContent'));
                  }}>{t('speechPage.startTranscription')}</button>
                </div>
              </div>
            )}
          </div>

          {/* Unified Output and Actions */}
          <hr style={{border: 'none', borderTop: '1px solid #e9ecef', margin: '8px 0'}} />
          <div>
            <h4 style={{ marginTop: 0 }}>{t('speechPage.transcriptionResult')}</h4>
            <div style={{ minHeight: 150, border: '1px solid #28a745', borderRadius: 4, padding: 8, background: '#f8fff9', fontSize: 14, maxHeight: 250, overflowY: 'auto' }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {transcript || accumulatedContent || t('speechPage.resultPlaceholder')}
              </pre>
            </div>
            {docLink && <div style={{marginTop: 8}}><a href={docLink} target="_blank" rel="noreferrer">{t('speechPage.openMinutes')}</a></div>}
            
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button onClick={async ()=>{ 
                const text = (transcript || accumulatedContent || '').trim();
                if (!text || text.length < 5) return alert(t('speechPage.noValidContent'));
                try {
                  const g = await api.post('/agent/minutes/generate', { transcript: text });
                  setDocLink(g.data.docLink || null);
                } catch (e) {
                  alert(t('speechPage.generationFailed'));
                }
              }} style={{ background: '#007bff', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 4, cursor: 'pointer' }}>
                {t('speechPage.generateMinutes')}
              </button>
              <button onClick={refreshMindMap} style={{ background: '#17a2b8', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 4, cursor: 'pointer' }}>
                {t('speechPage.generateMindMap')}
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
          <div style={{ position: 'relative' }}>
            <MindMapViewer data={mindMapData} isGenerating={isGeneratingMindMap} error={mindMapError} onRefresh={refreshMindMap} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpeechPage;
