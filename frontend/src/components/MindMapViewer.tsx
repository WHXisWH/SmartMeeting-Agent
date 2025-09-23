import React from 'react';

interface MindMapNode {
  id: string;
  label: string;
  type: 'root' | 'topic' | 'point' | 'action' | 'decision';
  color?: string;
  children?: MindMapNode[];
}

interface MindMapData {
  title: string;
  description: string;
  rootNode: MindMapNode;
  metadata: {
    totalNodes: number;
    mainTopics: number;
    actionItems: string[];
    keyDecisions: string[];
    participants: string[];
    generatedAt: string;
    fallback?: boolean;
  };
}

interface MindMapViewerProps {
  data: MindMapData | null;
  isGenerating?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

const MindMapViewer: React.FC<MindMapViewerProps> = ({ data, isGenerating=false, error=null, onRefresh }) => {

  if (error) {
    return (
      <div style={{ border: '2px solid #dc3545', borderRadius: 8, padding: 24, background: '#f8d7da', color: '#721c24' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>思考マップの生成に失敗しました</div>
        <div style={{ marginBottom: 12 }}>{error}</div>
        {onRefresh && (
          <button onClick={onRefresh} style={{ background: '#dc3545', color: 'white', border: 0, borderRadius: 4, padding: '6px 12px' }}>再生成</button>
        )}
      </div>
    );
  }

  if (!data && !isGenerating) {
    return (
      <div style={{ border: '2px dashed #e9ecef', borderRadius: 8, padding: 24, color: '#6c757d', textAlign: 'center' }}>録音／文字起こしの開始後、ここに思考マップが表示されます</div>
    );
  }

  if (isGenerating) {
    return (
      <div style={{ border: '1px solid #e9ecef', borderRadius: 8, padding: 16, background: '#f8f9fa' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 18, height: 18, border: '2px solid #007bff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <div>思考マップを生成しています...</div>
        </div>
        <style>{`@keyframes spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  const renderNode = (node: MindMapNode, level=0, isRoot=false) => {
    const colors: Record<string, string> = {
      root: '#1976d2', topic: '#2e7d32', point: '#455a64', action: '#8e24aa', decision: '#f57c00'
    };
    const border = colors[node.type] || '#6c757d';
    return (
      <div key={node.id} style={{ marginLeft: isRoot ? 0 : 20, position: 'relative' }}>
        {!isRoot && <div style={{ position: 'absolute', left: -12, top: 12, width: 12, height: 2, background: '#e0e0e0' }} />}
        <div style={{ display: 'inline-block', padding: '6px 10px', border: `2px solid ${border}`, borderRadius: 8, background: 'white', margin: '6px 0' }}>
          <span style={{ fontWeight: isRoot ? 700 : 600, color: border }}>{node.label}</span>
          <span style={{ fontSize: 11, color: '#6c757d', marginLeft: 8 }}>({node.type})</span>
        </div>
        {node.children && node.children.length > 0 && (
          <div style={{ marginLeft: 16 }}>
            {node.children.map(c => renderNode(c))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ border: '1px solid #e9ecef', borderRadius: 8, padding: 16, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700 }}>{data?.title || '思考マップ'}</div>
          <div style={{ fontSize: 12, color: '#6c757d' }}>{data?.description}</div>
        </div>
        <div style={{ fontSize: 12, color: '#6c757d' }}>生成時刻: {data?.metadata?.generatedAt && new Date(data.metadata.generatedAt).toLocaleString()}</div>
      </div>
      <div style={{ overflowX: 'auto', padding: '8px 0' }}>
        {data && renderNode(data.rootNode, 0, true)}
      </div>
    </div>
  );
};

export default MindMapViewer;
