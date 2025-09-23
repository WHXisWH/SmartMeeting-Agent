/**
 * データパイプライン Cloud Function
 * Gmail・Calendar・Drive データの BigQuery・Vector Search 取り込み
 *
 * 機能:
 * - Gmail → BigQuery データ取り込み
 * - Calendar → BigQuery データ取り込み
 * - Drive → Vector Search インデックス化
 * - スケジュール実行対応
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { PubSub } = require('@google-cloud/pubsub');
const { google } = require('googleapis');

// クライアント初期化
const bigquery = new BigQuery();
const pubsub = new PubSub();
const datasetId = 'smartmeet_meetings';

/**
 * メイン関数 - Pub/Sub または HTTP トリガー対応
 */
exports.dataPipeline = async (req, res) => {
  try {
    console.log('データパイプライン実行開始');

    // HTTP リクエストまたは Pub/Sub メッセージから処理タイプを取得
    let processingType = 'full'; // デフォルト: 全データ処理
    let timeRange = {};

    if (req.body) {
      // HTTP リクエストの場合
      processingType = req.body.type || 'full';
      timeRange = req.body.timeRange || {};
    } else if (req.data) {
      // Pub/Sub メッセージの場合
      const message = Buffer.from(req.data, 'base64').toString();
      const messageData = JSON.parse(message);
      processingType = messageData.type || 'full';
      timeRange = messageData.timeRange || {};
    }

    console.log(`処理タイプ: ${processingType}`);

    const results = {};

    // 処理タイプに応じてデータパイプラインを実行
    switch (processingType) {
      case 'gmail':
        results.gmail = await processGmailData(timeRange);
        break;
      case 'calendar':
        results.calendar = await processCalendarData(timeRange);
        break;
      case 'drive':
        results.drive = await processDriveData(timeRange);
        break;
      case 'full':
      default:
        // 全データソース処理
        results.gmail = await processGmailData(timeRange);
        results.calendar = await processCalendarData(timeRange);
        results.drive = await processDriveData(timeRange);
        break;
    }

    const summary = {
      success: true,
      processingType: processingType,
      results: results,
      processedAt: new Date().toISOString(),
      totalProcessingTime: Date.now() - req.startTime
    };

    console.log('データパイプライン完了:', summary);

    // HTTP レスポンス
    if (res) {
      res.status(200).json(summary);
    }

    return summary;

  } catch (error) {
    console.error('データパイプラインエラー:', error);

    const errorResponse = {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };

    if (res) {
      res.status(500).json(errorResponse);
    }

    throw error;
  }
};

/**
 * Gmail データ処理
 * @param {Object} timeRange - 処理対象時間範囲
 * @returns {Promise<Object>} 処理結果
 */
async function processGmailData(timeRange = {}) {
  try {
    console.log('Gmail データ処理開始');

    // 認証クライアント取得
    const authClient = await getAuthClient();
    const gmail = google.gmail({ version: 'v1', auth: authClient });

    // 時間範囲設定（デフォルト: 過去24時間）
    const defaultStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const defaultEnd = new Date();

    const queryStart = timeRange.start ? new Date(timeRange.start) : defaultStart;
    const queryEnd = timeRange.end ? new Date(timeRange.end) : defaultEnd;

    // Gmail 検索クエリ構築
    const searchQuery = `after:${formatGmailDate(queryStart)} before:${formatGmailDate(queryEnd)}`;

    console.log(`Gmail 検索クエリ: ${searchQuery}`);

    // メールリスト取得
    const messagesList = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 500 // 大量処理対応
    });

    const messages = messagesList.data.messages || [];
    console.log(`取得メール数: ${messages.length}`);

    if (messages.length === 0) {
      return {
        processed: 0,
        inserted: 0,
        errors: 0,
        timeRange: { start: queryStart.toISOString(), end: queryEnd.toISOString() }
      };
    }

    // メール詳細取得とBigQuery挿入用データ変換
    const emailData = [];
    const batchSize = 50; // バッチ処理サイズ
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      const batchPromises = batch.map(async (message) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full'
          });

          return transformEmailToBigQueryFormat(detail.data);

        } catch (error) {
          console.error(`メール処理エラー (${message.id}):`, error.message);
          errors++;
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(result => result !== null);

      emailData.push(...validResults);
      processed += batch.length;

      console.log(`Gmail バッチ処理進捗: ${processed}/${messages.length}`);
    }

    // BigQuery にデータ挿入
    let inserted = 0;
    if (emailData.length > 0) {
      const table = bigquery.dataset(datasetId).table('email_communications');

      // 重複チェック付き挿入
      const insertResult = await insertEmailsWithDuplicateCheck(table, emailData);
      inserted = insertResult.inserted;

      console.log(`BigQuery 挿入完了: ${inserted}件`);
    }

    return {
      processed: processed,
      inserted: inserted,
      errors: errors,
      timeRange: { start: queryStart.toISOString(), end: queryEnd.toISOString() }
    };

  } catch (error) {
    console.error('Gmail データ処理エラー:', error);
    throw error;
  }
}

/**
 * Calendar データ処理
 * @param {Object} timeRange - 処理対象時間範囲
 * @returns {Promise<Object>} 処理結果
 */
async function processCalendarData(timeRange = {}) {
  try {
    console.log('Calendar データ処理開始');

    // 認証クライアント取得
    const authClient = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });

    // 時間範囲設定（デフォルト: 過去24時間から未来7日間）
    const defaultStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const defaultEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const timeMin = timeRange.start ? new Date(timeRange.start) : defaultStart;
    const timeMax = timeRange.end ? new Date(timeRange.end) : defaultEnd;

    console.log(`Calendar 検索範囲: ${timeMin.toISOString()} - ${timeMax.toISOString()}`);

    // カレンダーイベント取得
    const eventsResult = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 1000,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = eventsResult.data.items || [];
    console.log(`取得イベント数: ${events.length}`);

    if (events.length === 0) {
      return {
        processed: 0,
        inserted: 0,
        errors: 0,
        timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() }
      };
    }

    // イベントデータをBigQuery形式に変換
    const meetingData = events.map(event => transformEventToBigQueryFormat(event));

    // BigQuery にデータ挿入
    const table = bigquery.dataset(datasetId).table('meetings');
    const insertResult = await insertMeetingsWithDuplicateCheck(table, meetingData);

    console.log(`Calendar BigQuery 挿入完了: ${insertResult.inserted}件`);

    return {
      processed: events.length,
      inserted: insertResult.inserted,
      errors: 0,
      timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() }
    };

  } catch (error) {
    console.error('Calendar データ処理エラー:', error);
    throw error;
  }
}

/**
 * Drive データ処理（Vector Search インデックス化）
 * @param {Object} timeRange - 処理対象時間範囲
 * @returns {Promise<Object>} 処理結果
 */
async function processDriveData(timeRange = {}) {
  try {
    console.log('Drive データ処理開始');

    // 認証クライアント取得
    const authClient = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth: authClient });

    // 時間範囲設定（デフォルト: 過去24時間で更新されたファイル）
    const defaultStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const modifiedTime = timeRange.start ? new Date(timeRange.start) : defaultStart;

    // ドライブファイル検索
    const filesResult = await drive.files.list({
      q: `modifiedTime >= '${modifiedTime.toISOString()}' and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
      pageSize: 200
    });

    const files = filesResult.data.files || [];
    console.log(`取得ファイル数: ${files.length}`);

    if (files.length === 0) {
      return {
        processed: 0,
        indexed: 0,
        errors: 0,
        timeRange: { start: modifiedTime.toISOString() }
      };
    }

    // 対象ファイルフィルタリング（テキスト系ファイルのみ）
    const targetMimeTypes = [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.spreadsheet',
      'application/pdf',
      'text/plain',
      'text/markdown'
    ];

    const targetFiles = files.filter(file =>
      targetMimeTypes.includes(file.mimeType) && parseInt(file.size || '0') < 10 * 1024 * 1024 // 10MB以下
    );

    console.log(`インデックス対象ファイル数: ${targetFiles.length}`);

    let indexed = 0;
    let errors = 0;

    // ファイル処理（並列処理）
    const processingPromises = targetFiles.map(async (file) => {
      try {
        // ファイル内容取得・インデックス化
        const result = await indexFileForVectorSearch(file, authClient);
        if (result.success) {
          indexed++;
        } else {
          errors++;
        }
        return result;
      } catch (error) {
        console.error(`ファイル処理エラー (${file.id}):`, error.message);
        errors++;
        return { success: false, error: error.message };
      }
    });

    await Promise.all(processingPromises);

    console.log(`Drive Vector Search インデックス化完了: ${indexed}件`);

    return {
      processed: targetFiles.length,
      indexed: indexed,
      errors: errors,
      timeRange: { start: modifiedTime.toISOString() }
    };

  } catch (error) {
    console.error('Drive データ処理エラー:', error);
    throw error;
  }
}

/**
 * ヘルパー関数群
 */

// 認証クライアント取得
async function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './smartmeet-workspace-sa-key.json',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/bigquery'
    ]
  });

  return await auth.getClient();
}

// Gmail 日付フォーマット
function formatGmailDate(date) {
  return Math.floor(date.getTime() / 1000);
}

// メールデータをBigQuery形式に変換
function transformEmailToBigQueryFormat(messageData) {
  const headers = messageData.payload.headers || [];
  const getHeader = (name) => {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : '';
  };

  return {
    email_id: messageData.id,
    thread_id: messageData.threadId,
    subject: getHeader('Subject'),
    sender: getHeader('From'),
    recipients: [getHeader('To')].filter(Boolean),
    cc_recipients: [getHeader('Cc')].filter(Boolean),
    body_text: extractTextContent(messageData.payload),
    snippet: messageData.snippet,
    sent_date: new Date(parseInt(messageData.internalDate)).toISOString(),
    received_date: new Date(parseInt(messageData.internalDate)).toISOString(),
    meeting_related: isMeetingRelated(messageData),
    importance_score: calculateImportanceScore(messageData),
    labels: messageData.labelIds || [],
    has_attachments: hasAttachments(messageData.payload),
    processed_at: new Date().toISOString(),
    processing_status: 'processed'
  };
}

// イベントデータをBigQuery形式に変換
function transformEventToBigQueryFormat(event) {
  return {
    meeting_id: event.id,
    title: event.summary || 'タイトルなし',
    description: event.description || '',
    start_time: event.start.dateTime || event.start.date,
    end_time: event.end.dateTime || event.end.date,
    attendees: (event.attendees || []).map(a => ({
      email: a.email,
      name: a.displayName || a.email.split('@')[0],
      response_status: a.responseStatus || 'needsAction',
      is_required: !a.optional
    })),
    organizer: event.organizer ? event.organizer.email : '',
    location: event.location || '',
    status: event.status || 'confirmed',
    created_at: new Date().toISOString(),
    updated_at: event.updated,
    meeting_type: classifyMeetingType(event),
    duration_minutes: calculateDuration(event.start, event.end)
  };
}

// その他のヘルパー関数（スタブ実装）
function extractTextContent(payload) { return ''; }
function isMeetingRelated(messageData) { return false; }
function calculateImportanceScore(messageData) { return 0.5; }
function hasAttachments(payload) { return false; }
function classifyMeetingType(event) { return 'general'; }
function calculateDuration(start, end) { return 60; }
function insertEmailsWithDuplicateCheck(table, data) { return Promise.resolve({ inserted: data.length }); }
function insertMeetingsWithDuplicateCheck(table, data) { return Promise.resolve({ inserted: data.length }); }
function indexFileForVectorSearch(file, auth) { return Promise.resolve({ success: true }); }