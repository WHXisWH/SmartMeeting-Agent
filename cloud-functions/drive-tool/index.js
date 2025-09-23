/**
 * Drive ツール Cloud Function
 * Vertex AI Agent Builder用のGoogle Drive操作ツール
 *
 * 機能:
 * - 文書検索・取得
 * - Vector Search連携での文書インデックス化
 * - 文書分析・要約
 * - 会議議事録生成・更新
 * - BigQuery連携での文書メタデータ管理
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { google } = require('googleapis');
const { PredictionServiceClient } = require('@google-cloud/aiplatform');

// BigQuery クライアント初期化
const bigquery = new BigQuery();
const datasetId = 'smartmeet_meetings';
const documentsTableId = 'documents';

// Vertex AI クライアント初期化
const predictionClient = new PredictionServiceClient();

/**
 * メイン関数 - Agent Builder からの webhook 呼び出しを処理
 * @param {Object} req - Express リクエストオブジェクト
 * @param {Object} res - Express レスポンスオブジェクト
 */
exports.driveTool = async (req, res) => {
  try {
    console.log('Drive ツール実行開始:', JSON.stringify(req.body, null, 2));

    const { action, parameters = {} } = req.body;

    // アクション別処理分岐
    let result;
    switch (action) {
      case 'search_documents':
        result = await searchDocuments(parameters);
        break;
      case 'get_document_content':
        result = await getDocumentContent(parameters);
        break;
      case 'create_meeting_minutes':
        result = await createMeetingMinutes(parameters);
        break;
      case 'update_document':
        result = await updateDocument(parameters);
        break;
      case 'analyze_document':
        result = await analyzeDocument(parameters);
        break;
      case 'generate_summary':
        result = await generateSummary(parameters);
        break;
      case 'index_document':
        result = await indexDocumentForVectorSearch(parameters);
        break;
      case 'find_related_documents':
        result = await findRelatedDocuments(parameters);
        break;
      default:
        throw new Error(`未対応のアクション: ${action}`);
    }

    console.log('Drive ツール実行完了:', result);

    // Agent Builder に結果を返却
    res.status(200).json({
      success: true,
      action: action,
      result: result,
      timestamp: new Date().toISOString(),
      executionTime: Date.now() - req.startTime
    });

  } catch (error) {
    console.error('Drive ツールエラー:', error);

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 文書検索
 * @param {Object} params - パラメータ {query, fileTypes, maxResults, folderId}
 * @returns {Promise<Object>} 文書検索結果
 */
async function searchDocuments(params) {
  const {
    query,
    fileTypes = ['application/vnd.google-apps.document', 'application/pdf'],
    maxResults = 20,
    folderId,
    dateRange = {}
  } = params;

  const drive = google.drive({ version: 'v3', auth: await getAuthClient() });

  // 検索クエリ構築
  let searchQuery = `fullText contains '${query}'`;

  if (fileTypes.length > 0) {
    const mimeTypeQueries = fileTypes.map(type => `mimeType='${type}'`);
    searchQuery += ` and (${mimeTypeQueries.join(' or ')})`;
  }

  if (folderId) {
    searchQuery += ` and '${folderId}' in parents`;
  }

  if (!searchQuery.includes('trashed')) {
    searchQuery += ' and trashed=false';
  }

  // Drive API で文書検索
  const response = await drive.files.list({
    q: searchQuery,
    pageSize: maxResults,
    fields: 'files(id,name,mimeType,modifiedTime,createdTime,owners,size,webViewLink,thumbnailLink)',
    orderBy: 'modifiedTime desc'
  });

  const files = response.data.files || [];

  // 文書詳細情報を取得・分析
  const documentsWithAnalysis = await Promise.all(
    files.map(async (file) => {
      const analysis = await analyzeDocumentMetadata(file);
      return {
        ...file,
        analysis: analysis,
        relevanceScore: calculateRelevanceScore(file, query),
        lastAccessed: await getLastAccessTime(file.id)
      };
    })
  );

  // BigQuery に検索結果を記録
  await logSearchResults({
    query,
    resultsCount: files.length,
    topResults: documentsWithAnalysis.slice(0, 5),
    searchTimestamp: new Date().toISOString()
  });

  return {
    documents: documentsWithAnalysis,
    totalCount: files.length,
    query: query,
    searchTimestamp: new Date().toISOString()
  };
}

/**
 * 文書内容取得
 * @param {Object} params - パラメータ {documentId, format}
 * @returns {Promise<Object>} 文書内容
 */
async function getDocumentContent(params) {
  const { documentId, format = 'text' } = params;

  const drive = google.drive({ version: 'v3', auth: await getAuthClient() });

  // ファイル情報取得
  const fileInfo = await drive.files.get({
    fileId: documentId,
    fields: 'id,name,mimeType,size,modifiedTime'
  });

  let content = '';
  let extractedData = {};

  // MIME タイプに応じて内容を取得
  if (fileInfo.data.mimeType === 'application/vnd.google-apps.document') {
    // Google ドキュメント
    const docs = google.docs({ version: 'v1', auth: await getAuthClient() });
    const doc = await docs.documents.get({ documentId });

    content = extractTextFromGoogleDoc(doc.data);
    extractedData = extractStructuredDataFromDoc(doc.data);

  } else if (fileInfo.data.mimeType === 'application/pdf') {
    // PDF ファイル
    const response = await drive.files.get({
      fileId: documentId,
      alt: 'media'
    });
    content = await extractTextFromPDF(response.data);

  } else {
    // その他のファイル形式
    const response = await drive.files.get({
      fileId: documentId,
      alt: 'media'
    });
    content = response.data.toString();
  }

  // Vector Search用の埋め込みベクトル生成
  const embedding = await generateEmbedding(content);

  // BigQuery に文書内容を保存/更新
  await saveDocumentToBigQuery({
    documentId,
    fileName: fileInfo.data.name,
    content,
    extractedData,
    embedding,
    lastProcessed: new Date().toISOString()
  });

  return {
    documentId: documentId,
    fileName: fileInfo.data.name,
    mimeType: fileInfo.data.mimeType,
    content: content,
    extractedData: extractedData,
    wordCount: content.split(/\s+/).length,
    lastModified: fileInfo.data.modifiedTime
  };
}

/**
 * 会議議事録作成
 * @param {Object} params - パラメータ {meetingId, template, attendees, agenda}
 * @returns {Promise<Object>} 作成結果
 */
async function createMeetingMinutes(params) {
  const {
    meetingId,
    template = 'standard',
    attendees = [],
    agenda = [],
    meetingDate,
    folderId
  } = params;

  const docs = google.docs({ version: 'v1', auth: await getAuthClient() });
  const drive = google.drive({ version: 'v3', auth: await getAuthClient() });

  // 議事録テンプレートを取得
  const minutesTemplate = await getMeetingMinutesTemplate(template);

  // 新しいGoogle ドキュメントを作成
  const doc = await docs.documents.create({
    requestBody: {
      title: `会議議事録 - ${meetingDate || new Date().toLocaleDateString('ja-JP')}`
    }
  });

  const documentId = doc.data.documentId;

  // テンプレートに基づいて内容を生成
  const content = generateMeetingMinutesContent({
    meetingId,
    attendees,
    agenda,
    meetingDate,
    template: minutesTemplate
  });

  // ドキュメントに内容を挿入
  await docs.documents.batchUpdate({
    documentId: documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content
          }
        }
      ]
    }
  });

  // 指定されたフォルダに移動
  if (folderId) {
    await drive.files.update({
      fileId: documentId,
      addParents: folderId,
      fields: 'id,parents'
    });
  }

  // BigQuery に議事録情報を記録
  await logMeetingMinutes({
    meetingId,
    documentId,
    createdAt: new Date().toISOString(),
    attendees,
    status: 'draft'
  });

  return {
    documentId: documentId,
    documentUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    status: 'created',
    meetingId: meetingId
  };
}

/**
 * 文書分析
 * @param {Object} params - パラメータ {documentId, analysisType}
 * @returns {Promise<Object>} 分析結果
 */
async function analyzeDocument(params) {
  const { documentId, analysisType = 'comprehensive' } = params;

  // まず文書内容を取得
  const documentContent = await getDocumentContent({ documentId });

  // Vertex AI を使用して文書分析
  const analysis = await performVertexAIAnalysis(documentContent.content, analysisType);

  // キーワード抽出
  const keywords = extractKeywords(documentContent.content);

  // 構造化データ抽出
  const structuredData = extractStructuredInfo(documentContent.content);

  // 分析結果をまとめる
  const analysisResult = {
    documentId: documentId,
    analysisType: analysisType,
    summary: analysis.summary,
    keyTopics: analysis.topics,
    sentiment: analysis.sentiment,
    actionItems: extractActionItems(documentContent.content),
    mentions: extractMentions(documentContent.content),
    keywords: keywords,
    readingTime: Math.ceil(documentContent.wordCount / 200), // 分
    complexity: assessComplexity(documentContent.content),
    structuredData: structuredData,
    analysisTimestamp: new Date().toISOString()
  };

  // BigQuery に分析結果を保存
  await saveDocumentAnalysis(analysisResult);

  return analysisResult;
}

/**
 * 文書要約生成
 * @param {Object} params - パラメータ {documentId, summaryType, maxLength}
 * @returns {Promise<Object>} 要約結果
 */
async function generateSummary(params) {
  const { documentId, summaryType = 'executive', maxLength = 500 } = params;

  // 文書内容を取得
  const document = await getDocumentContent({ documentId });

  // Vertex AI を使用して要約生成
  const summary = await generateAISummary(document.content, {
    type: summaryType,
    maxLength: maxLength,
    language: 'ja'
  });

  // 要約の品質評価
  const quality = assessSummaryQuality(document.content, summary);

  const summaryResult = {
    documentId: documentId,
    originalLength: document.wordCount,
    summary: summary,
    summaryLength: summary.split(/\s+/).length,
    compressionRatio: summary.split(/\s+/).length / document.wordCount,
    quality: quality,
    summaryType: summaryType,
    generatedAt: new Date().toISOString()
  };

  // BigQuery に要約を保存
  await saveSummary(summaryResult);

  return summaryResult;
}

/**
 * Vector Search 用文書インデックス化
 * @param {Object} params - パラメータ {documentId, forceReindex}
 * @returns {Promise<Object>} インデックス化結果
 */
async function indexDocumentForVectorSearch(params) {
  const { documentId, forceReindex = false } = params;

  // BigQuery から既存のインデックス状況確認
  const query = `
    SELECT embedding_vector, last_indexed
    FROM \`${bigquery.projectId}.${datasetId}.${documentsTableId}\`
    WHERE document_id = @documentId
  `;

  const [rows] = await bigquery.query({
    query: query,
    params: { documentId }
  });

  // 再インデックスが不要な場合はスキップ
  if (rows.length > 0 && !forceReindex) {
    const lastIndexed = new Date(rows[0].last_indexed);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24時間

    if (lastIndexed > cutoff) {
      return {
        documentId: documentId,
        status: 'already_indexed',
        lastIndexed: lastIndexed.toISOString()
      };
    }
  }

  // 文書内容を取得
  const document = await getDocumentContent({ documentId });

  // 文書を適切なチャンクに分割
  const chunks = chunkDocument(document.content);

  // 各チャンクの埋め込みベクトルを生成
  const indexedChunks = await Promise.all(
    chunks.map(async (chunk, index) => {
      const embedding = await generateEmbedding(chunk.text);
      return {
        document_id: documentId,
        chunk_id: `${documentId}_chunk_${index}`,
        chunk_text: chunk.text,
        chunk_index: index,
        embedding_vector: embedding,
        keywords: extractKeywords(chunk.text),
        indexed_at: new Date().toISOString()
      };
    })
  );

  // BigQuery に埋め込みベクトルを保存
  await saveEmbeddings(indexedChunks);

  return {
    documentId: documentId,
    status: 'indexed',
    chunksCount: indexedChunks.length,
    indexedAt: new Date().toISOString()
  };
}

/**
 * 関連文書検索
 * @param {Object} params - パラメータ {query, documentId, maxResults}
 * @returns {Promise<Object>} 関連文書
 */
async function findRelatedDocuments(params) {
  const { query, documentId, maxResults = 10 } = params;

  let searchEmbedding;

  if (query) {
    // クエリテキストから埋め込みベクトル生成
    searchEmbedding = await generateEmbedding(query);
  } else if (documentId) {
    // 指定された文書の埋め込みベクトルを使用
    const [rows] = await bigquery.query({
      query: `
        SELECT embedding_vector
        FROM \`${bigquery.projectId}.${datasetId}.${documentsTableId}\`
        WHERE document_id = @documentId
        LIMIT 1
      `,
      params: { documentId }
    });

    if (rows.length === 0) {
      throw new Error('指定された文書のベクトルが見つかりません');
    }

    searchEmbedding = rows[0].embedding_vector;
  }

  // Vector Search を使用して類似文書を検索
  const similarDocuments = await searchSimilarDocuments(searchEmbedding, maxResults);

  return {
    query: query || `document:${documentId}`,
    relatedDocuments: similarDocuments,
    searchTimestamp: new Date().toISOString()
  };
}

/**
 * ヘルパー関数群
 */

// 認証クライアント取得
async function getAuthClient() {
  try {
    // サービスアカウント認証を使用
    const auth = new google.auth.GoogleAuth({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './smartmeet-workspace-sa-key.json',
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/bigquery'
      ],
      // Domain-wide delegation が必要な場合
      // subject: 'admin@yourdomain.com' // 実際のドメイン管理者を指定
    });

    const authClient = await auth.getClient();
    console.log('Drive API 認証成功');
    return authClient;

  } catch (error) {
    console.error('Drive API 認証エラー:', error);

    // フォールバック: Application Default Credentials を試行
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/bigquery'
        ]
      });

      const authClient = await auth.getClient();
      console.log('Drive API 認証成功 (ADC)');
      return authClient;

    } catch (adcError) {
      console.error('ADC 認証も失敗:', adcError);
      throw new Error('Drive API 認証に失敗しました。サービスアカウントまたは ADC の設定を確認してください。');
    }
  }
}

// Google ドキュメントからテキスト抽出
function extractTextFromGoogleDoc(docData) {
  let text = '';
  if (docData.body && docData.body.content) {
    for (const element of docData.body.content) {
      if (element.paragraph) {
        for (const textRun of element.paragraph.elements || []) {
          if (textRun.textRun) {
            text += textRun.textRun.content;
          }
        }
      }
    }
  }
  return text;
}

// 埋め込みベクトル生成
async function generateEmbedding(text) {
  // Vertex AI Text Embeddings API を使用
  // 実際の実装では適切なエンドポイントを呼び出し
  return new Array(768).fill(0).map(() => Math.random()); // プレースホルダー
}

// 文書を適切なチャンクに分割
function chunkDocument(content, maxChunkSize = 1000) {
  const sentences = content.split(/[。．！？\n]/);
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize) {
      if (currentChunk.trim()) {
        chunks.push({
          text: currentChunk.trim(),
          length: currentChunk.length
        });
      }
      currentChunk = sentence;
    } else {
      currentChunk += sentence + '。';
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      length: currentChunk.length
    });
  }

  return chunks;
}

// BigQuery に文書データ保存
async function saveDocumentToBigQuery(documentData) {
  const row = {
    document_id: documentData.documentId,
    file_name: documentData.fileName,
    content_text: documentData.content,
    embedding_vector: documentData.embedding,
    keywords: extractKeywords(documentData.content),
    last_processed: documentData.lastProcessed,
    word_count: documentData.content.split(/\s+/).length
  };

  await bigquery
    .dataset(datasetId)
    .table(documentsTableId)
    .insert([row]);
}

// その他のヘルパー関数（スタブ実装）
function analyzeDocumentMetadata(file) { return { category: 'general' }; }
function calculateRelevanceScore(file, query) { return 0.8; }
function getLastAccessTime(fileId) { return Promise.resolve(new Date().toISOString()); }
function logSearchResults(data) { return Promise.resolve(); }
function extractTextFromPDF(data) { return Promise.resolve('PDF content'); }
function extractStructuredDataFromDoc(docData) { return {}; }
function getMeetingMinutesTemplate(template) { return Promise.resolve('template'); }
function generateMeetingMinutesContent(params) { return 'meeting minutes content'; }
function logMeetingMinutes(data) { return Promise.resolve(); }
function performVertexAIAnalysis(content, type) { return Promise.resolve({ summary: 'analysis', topics: [], sentiment: 'neutral' }); }
function extractKeywords(content) { return []; }
function extractStructuredInfo(content) { return {}; }
function extractActionItems(content) { return []; }
function extractMentions(content) { return []; }
function assessComplexity(content) { return 'medium'; }
function saveDocumentAnalysis(analysis) { return Promise.resolve(); }
function generateAISummary(content, options) { return Promise.resolve('AI generated summary'); }
function assessSummaryQuality(original, summary) { return { score: 0.8, metrics: {} }; }
function saveSummary(summary) { return Promise.resolve(); }
function saveEmbeddings(chunks) { return Promise.resolve(); }
function searchSimilarDocuments(embedding, maxResults) { return Promise.resolve([]); }
function updateDocument(params) { return Promise.resolve({ status: 'not_implemented' }); }