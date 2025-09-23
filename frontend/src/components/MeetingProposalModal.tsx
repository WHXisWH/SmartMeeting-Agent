import React, { useState } from 'react';
import { proposeMeeting, confirmMeeting } from '../services/api';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  onClose: () => void;
  defaultAttendee?: string;
};

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  width: 720,
  maxWidth: '90vw',
  background: 'white',
  borderRadius: 8,
  border: '1px solid #e9ecef',
  boxShadow: '0 12px 24px rgba(0,0,0,0.15)',
};

const header: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #e9ecef',
  fontWeight: 700,
};

const body: React.CSSProperties = {
  padding: 16,
  display: 'grid',
  gap: 12,
};

const footer: React.CSSProperties = {
  padding: 16,
  borderTop: '1px solid #e9ecef',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const button: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const MeetingProposalModal: React.FC<Props> = ({ open, onClose, defaultAttendee }) => {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(t('proposalModal.meeting'));
  const [attendeesInput, setAttendeesInput] = useState(defaultAttendee || '');
  const [durationMin, setDurationMin] = useState(30);
  const [horizonHours, setHorizonHours] = useState(48);
  const [maxSlots, setMaxSlots] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<any | null>(null);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState(0);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  const parseAttendees = () => attendeesInput.split(',').map(s => s.trim()).filter(Boolean);

  const onGenerate = async () => {
    try {
      setError(null);
      setLoading(true);
      const resp = await proposeMeeting({
        subject,
        attendees: parseAttendees(),
        durationMin,
        horizonHours,
        maxSlots,
      });
      setProposal(resp.data);
      setSelectedSlotIdx(0);
      setSelectedFileIds([]);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || t('proposalModal.generationFailed'));
    } finally {
      setLoading(false);
    }
  };

  const onConfirm = async () => {
    if (!proposal) return;
    const slot = proposal.slots?.[selectedSlotIdx];
    if (!slot) return alert(t('proposalModal.selectSlot'));
    try {
      setLoading(true);
      await confirmMeeting({
        subject: subject || t('proposalModal.meeting'),
        agenda: proposal.agenda || '',
        start: slot.start,
        end: slot.end,
        timezone: slot.timezone || proposal.timezone,
        attendees: proposal.attendees || parseAttendees(),
        driveFileIds: selectedFileIds,
      });
      alert(t('proposalModal.createSuccess'));
      onClose();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || t('proposalModal.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const toggleFile = (id: string) => {
    setSelectedFileIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  if (!open) return null;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>{t('proposalModal.title')}</div>
        <div style={body}>
          <div>
            <label>{t('proposalModal.subject')}</label>
            <input style={{ width: '100%' }} value={subject} onChange={e=>setSubject(e.target.value)} />
          </div>
          <div>
            <label>{t('proposalModal.attendees')}</label>
            <input style={{ width: '100%' }} value={attendeesInput} onChange={e=>setAttendeesInput(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label>{t('proposalModal.duration')}</label>
              <input type="number" value={durationMin} onChange={e=>setDurationMin(Number(e.target.value)||30)} />
            </div>
            <div>
              <label>{t('proposalModal.window')}</label>
              <input type="number" value={horizonHours} onChange={e=>setHorizonHours(Number(e.target.value)||48)} />
            </div>
            <div>
              <label>{t('proposalModal.candidates')}</label>
              <input type="number" value={maxSlots} onChange={e=>setMaxSlots(Number(e.target.value)||3)} />
            </div>
          </div>

          {!proposal ? (
            <button style={{ ...button, background: '#1976d2', color: 'white', width: 160 }} onClick={onGenerate} disabled={loading}>
              {loading ? t('proposalModal.generating') : t('proposalModal.generate')}
            </button>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t('proposalModal.candidateSlots')}</div>
                {(proposal.slots || []).length === 0 ? (
                  <div style={{ color: '#6c757d' }}>{t('proposalModal.noSlots')}</div>
                ) : (
                  (proposal.slots || []).map((s: any, i: number) => (
                    <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="radio" name="slot" checked={selectedSlotIdx===i} onChange={()=>setSelectedSlotIdx(i)} />
                      <span>{s.start} ~ {s.end}（{s.timezone || proposal.timezone}）</span>
                    </label>
                  ))
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{t('proposalModal.materials')}</div>
                {(proposal.driveFiles || []).length === 0 ? (
                  <div style={{ color: '#6c757d' }}>{t('proposalModal.noFiles')}</div>
                ) : (
                  (proposal.driveFiles || []).map((f: any) => (
                    <label key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={selectedFileIds.includes(f.id)} onChange={()=>toggleFile(f.id)} />
                      <a href={f.webViewLink} target="_blank" rel="noreferrer">{f.name}</a>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {error && <div style={{ color: '#dc3545' }}>{error}</div>}
        </div>
        <div style={footer}>
          <button style={{ ...button, background: '#6c757d', color: 'white' }} onClick={onClose}>{t('proposalModal.close')}</button>
          {proposal && (
            <button style={{ ...button, background: '#28a745', color: 'white' }} onClick={onConfirm} disabled={loading || (proposal.slots||[]).length===0}>
              {loading ? t('proposalModal.creating') : t('proposalModal.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingProposalModal;

