import React, { useEffect, useState } from 'react';
import LeftNav from '../components/LeftNav';
import { getSemanticKnowledge, getProceduralKnowledge } from '../services/api';
import { useTranslation } from 'react-i18next';

interface KnowledgeItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  description?: string;
  instructions?: string;
}

interface GroupedKnowledge {
  [category: string]: KnowledgeItem[];
}

const Accordion: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, border: '1px solid #e9ecef', borderRadius: 8 }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: '#f8f9fa',
          border: 'none',
          textAlign: 'left',
          fontWeight: 700,
          fontSize: 16,
          cursor: 'pointer',
          borderBottom: isOpen ? '1px solid #e9ecef' : 'none',
        }}
      >
        {title}
      </button>
      {isOpen && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
};

const KnowledgePage: React.FC = () => {
  const { t } = useTranslation();
  const [semanticKnowledge, setSemanticKnowledge] = useState<GroupedKnowledge>({});
  const [proceduralKnowledge, setProceduralKnowledge] = useState<GroupedKnowledge>({});
  const [activeTab, setActiveTab] = useState<'semantic' | 'procedural'>('semantic');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [semanticRes, proceduralRes] = await Promise.all([
          getSemanticKnowledge(),
          getProceduralKnowledge(),
        ]);

        const mapItems = (rawItems: any[]): KnowledgeItem[] => {
          if (!Array.isArray(rawItems)) return [];
          return rawItems.map((it: any) => {
            const mem = it?.memory || {};
            const meta = mem?.metadata || {};
            const content = mem?.content || {};
            const category: string = meta?.category || it?.category || 'general';
            // For semantic memory, prefer title/description; for procedural, name/description/instructions
            const title = content?.title || content?.name || it?.title || '';
            const description = content?.description || it?.description || '';
            const instructions = Array.isArray(content?.steps)
              ? content.steps.map((s: any) => s?.description).filter(Boolean).join('\n')
              : it?.instructions || '';
            return {
              id: String(it.id || meta.id || Math.random()),
              category,
              question: title,
              answer: description || instructions,
              description,
              instructions,
            } as KnowledgeItem;
          });
        };

        const groupByCategory = (items: KnowledgeItem[]): GroupedKnowledge =>
          (items || []).reduce((acc, item) => {
            const category = item.category || 'general';
            if (!acc[category]) {
              acc[category] = [];
            }
            acc[category].push(item);
            return acc;
          }, {} as GroupedKnowledge);

        const semItems: KnowledgeItem[] = mapItems(semanticRes?.data?.items || []);
        const procItems: KnowledgeItem[] = mapItems(proceduralRes?.data?.items || []);

        setSemanticKnowledge(groupByCategory(semItems));
        setProceduralKnowledge(groupByCategory(procItems));
        // episodic knowledge not supported by backend; omitted
      } catch (error) {
        console.error("Failed to fetch knowledge base:", error);
      }
    };

    fetchData();
  }, []);

  const renderKnowledgeSection = (knowledge: GroupedKnowledge) => {
    const entries = Object.entries(knowledge);
    if (entries.length === 0) {
      return <div style={{ color: '#6c757d' }}>No knowledge items</div>;
    }
    return (
      <div>
        {entries.map(([category, items]) => (
          <Accordion key={category} title={`${t(`knowledgeCategories.${category}`, category)} (${items.length})`}>
            {items.map(item => (
              <div key={item.id} style={{ padding: '8px 0', borderBottom: '1px solid #e9ecef' }}>
                <div style={{ fontWeight: 700 }}>{item.question || item.description}</div>
                <div style={{ color: '#6c757d', marginTop: 4 }}>{item.answer || item.instructions}</div>
              </div>
            ))}
          </Accordion>
        ))}
      </div>
    );
  };

  const TabButton: React.FC<{ title: string; isActive: boolean; onClick: () => void }> = ({ title, isActive, onClick }) => (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px',
        border: 'none',
        borderBottom: isActive ? '2px solid #0d6efd' : '2px solid transparent',
        background: 'none',
        cursor: 'pointer',
        fontWeight: isActive ? 600 : 500,
        color: isActive ? '#0d6efd' : '#495057',
        fontSize: 16,
      }}
    >
      {title}
    </button>
  );

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: '56px 1fr', background: '#f5f5f5' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'white', borderBottom: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 800 }}>{t('dashboard.header.title')}</div>
          <span style={{ color: '#6c757d' }}>{t('knowledgePage.subtitle')}</span>
        </div>
        <div style={{ color: '#6c757d' }}>{t('activityLogPage.user')}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, padding: 16 }}>
        <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 8 }}>
          <LeftNav />
        </div>
        <div style={{ padding: '0 16px 16px 16px', borderRadius: 8, background: 'white', border: '1px solid #e9ecef', overflowY: 'auto' }}>
          <h3 style={{ marginTop: 16 }}>{t('knowledgePage.title')}</h3>
          <div style={{ borderBottom: '1px solid #dee2e6', marginBottom: 16 }}>
            <TabButton title={t('knowledgePage.semanticKnowledge')} isActive={activeTab === 'semantic'} onClick={() => setActiveTab('semantic')} />
            <TabButton title={t('knowledgePage.proceduralKnowledge')} isActive={activeTab === 'procedural'} onClick={() => setActiveTab('procedural')} />
            {/* episodic knowledge not supported by backend */}
          </div>
          <div>
            {activeTab === 'semantic' && renderKnowledgeSection(semanticKnowledge)}
            {activeTab === 'procedural' && renderKnowledgeSection(proceduralKnowledge)}
            {/* episodic tab omitted */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgePage;
