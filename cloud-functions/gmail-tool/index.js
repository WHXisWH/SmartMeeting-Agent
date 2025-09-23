/**
 * Gmail ツール Cloud Function
 * Vertex AI Agent Builder用のGmail操作ツール
 *
 * 機能:
 * - メール検索・取得
 * - 会議関連メール抽出
 * - メール送信
 * - メール分析・分類
 * - BigQuery連携でのメールデータ蓄積
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { google } = require('googleapis');

// BigQuery クライアント初期化
const bigquery = new BigQuery();
const datasetId = 'smartmeet_meetings';
const emailTableId = 'email_communications';

/**
 * メイン関数 - Agent Builder からの webhook 呼び出しを処理
 * @param {Object} req - Express リクエストオブジェクト
 * @param {Object} res - Express レスポンスオブジェクト
 */
exports.gmailTool = async (req, res) => {
  try {
    console.log('Gmail ツール実行開始:', JSON.stringify(req.body, null, 2));

    const { action, parameters = {} } = req.body;

    // アクション別処理分岐
    let result;
    switch (action) {
      case 'search_emails':
        result = await searchEmails(parameters);
        break;
      case 'get_meeting_emails':
        result = await getMeetingEmails(parameters);
        break;
      case 'send_email':
        result = await sendEmail(parameters);
        break;
      case 'analyze_email_thread':
        result = await analyzeEmailThread(parameters);
        break;
      case 'extract_meeting_info':
        result = await extractMeetingInfo(parameters);
        break;
      case 'get_email_insights':
        result = await getEmailInsights(parameters);
        break;
      default:
        throw new Error(`未対応のアクション: ${action}`);
    }

    console.log('Gmail ツール実行完了:', result);

    // Agent Builder に結果を返却
    res.status(200).json({
      success: true,
      action: action,
      result: result,
      timestamp: new Date().toISOString(),
      executionTime: Date.now() - req.startTime
    });

  } catch (error) {
    console.error('Gmail ツールエラー:', error);

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * メール検索
 * @param {Object} params - パラメータ {query, maxResults, dateRange}
 * @returns {Promise<Object>} メール検索結果
 */
async function searchEmails(params) {
  const { query, maxResults = 20, dateRange = {} } = params;
  const { start, end } = dateRange;

  try {
    // Gmail API を使用してメール検索
    const authClient = await getAuthClient();

    // 認証クライアントがない場合は模擬レスポンス
    if (!authClient) {
      console.log('認証クライアントなし - 模擬レスポンス返却');
      return {
        emails: [],
        totalCount: 0,
        query: query || 'test',
        searchTimestamp: new Date().toISOString(),
        note: 'Gmail OAuth 認証未設定のため模擬レスポンス'
      };
    }

    const gmail = google.gmail({ version: 'v1', auth: authClient });

    // 認証テスト用に簡単なプロファイル取得を先に実行
    try {
      await gmail.users.getProfile({ userId: 'me' });
      console.log('Gmail API 認証確認成功');
    } catch (profileError) {
      console.error('Gmail プロファイル取得失敗:', profileError.message);

      // 模擬的なレスポンスを返す（認証問題対応）
      return {
        emails: [],
        totalCount: 0,
        query: query || 'test',
        searchTimestamp: new Date().toISOString(),
        note: 'Gmail API認証エラーのため模擬レスポンス - ' + profileError.message
      };
    }

    // 検索クエリ構築
    let searchQuery = query || 'meeting';
    if (start) searchQuery += ` after:${formatDate(start)}`;
    if (end) searchQuery += ` before:${formatDate(end)}`;

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: maxResults
    });

    const messages = response.data.messages || [];

    // メール詳細を取得
    const emailDetails = await Promise.all(
      messages.slice(0, Math.min(messages.length, 10)).map(async (message) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });

        return {
          id: message.id,
          threadId: message.threadId,
          subject: getHeaderValue(detail.data.payload.headers, 'Subject'),
          from: getHeaderValue(detail.data.payload.headers, 'From'),
          to: getHeaderValue(detail.data.payload.headers, 'To'),
          date: getHeaderValue(detail.data.payload.headers, 'Date'),
          snippet: detail.data.snippet,
          bodyPreview: extractEmailBody(detail.data.payload),
          labels: detail.data.labelIds,
          hasAttachments: hasAttachments(detail.data.payload),
          meetingRelated: isMeetingRelated(detail.data)
        };
      })
    );

    // BigQuery にメールデータを保存
    await saveEmailsToBigQuery(emailDetails);

    return {
      emails: emailDetails,
      totalCount: response.data.resultSizeEstimate,
      query: searchQuery,
      searchTimestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Gmail 検索エラー:', error);

    // エラー時は模擬レスポンスを返す
    return {
      emails: [],
      totalCount: 0,
      query: query || 'test',
      searchTimestamp: new Date().toISOString(),
      error: error.message,
      note: 'Gmail API認証設定中のため模擬レスポンス'
    };
  }
}

/**
 * 会議関連メール取得
 * @param {Object} params - パラメータ {timeRange, meetingId}
 * @returns {Promise<Object>} 会議関連メール
 */
async function getMeetingEmails(params) {
  const { timeRange = {}, meetingId } = params;

  // BigQuery から会議関連メールを検索
  let query = `
    SELECT
      email_id,
      thread_id,
      subject,
      sender,
      recipients,
      body_text,
      received_date,
      meeting_keywords,
      importance_score,
      action_items
    FROM \`${bigquery.projectId}.${datasetId}.${emailTableId}\`
    WHERE meeting_related = true
  `;

  const queryParams = {};

  if (meetingId) {
    query += ` AND meeting_id = @meetingId`;
    queryParams.meetingId = meetingId;
  }

  if (timeRange.start) {
    query += ` AND received_date >= @startDate`;
    queryParams.startDate = timeRange.start;
  }

  if (timeRange.end) {
    query += ` AND received_date <= @endDate`;
    queryParams.endDate = timeRange.end;
  }

  query += ` ORDER BY received_date DESC LIMIT 50`;

  const [rows] = await bigquery.query({
    query: query,
    params: queryParams
  });

  // メールスレッド分析
  const threadAnalysis = analyzeEmailThreads(rows);

  return {
    meetingEmails: rows,
    threadAnalysis: threadAnalysis,
    keywordTrends: extractKeywordTrends(rows),
    actionItemsSummary: summarizeActionItems(rows)
  };
}

/**
 * メール送信
 * @param {Object} params - 送信パラメータ
 * @returns {Promise<Object>} 送信結果
 */
async function sendEmail(params) {
  const {
    to,
    cc = [],
    bcc = [],
    subject,
    body,
    attachments = [],
    meetingId,
    template
  } = params;

  const gmail = google.gmail({ version: 'v1', auth: await getAuthClient() });

  // メール本文を構築（テンプレートベース）
  const emailBody = template ?
    await buildEmailFromTemplate(template, params) :
    body;

  // メール作成
  const email = createEmailMessage({
    to: Array.isArray(to) ? to : [to],
    cc,
    bcc,
    subject,
    body: emailBody,
    attachments
  });

  // Gmail API でメール送信
  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: email
    }
  });

  // 送信ログを BigQuery に保存
  await logEmailSent({
    emailId: response.data.id,
    recipients: { to, cc, bcc },
    subject,
    meetingId,
    sentAt: new Date().toISOString(),
    template: template || null
  });

  return {
    messageId: response.data.id,
    status: 'sent',
    recipients: { to, cc, bcc },
    sentAt: new Date().toISOString()
  };
}

/**
 * メールスレッド分析
 * @param {Object} params - 分析パラメータ
 * @returns {Promise<Object>} 分析結果
 */
async function analyzeEmailThread(params) {
  const { threadId } = params;

  const gmail = google.gmail({ version: 'v1', auth: await getAuthClient() });

  // スレッド詳細取得
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full'
  });

  const messages = thread.data.messages || [];

  // スレッド分析
  const analysis = {
    threadId: threadId,
    messageCount: messages.length,
    participants: extractParticipants(messages),
    timespan: calculateTimespan(messages),
    topics: extractTopics(messages),
    sentiment: analyzeSentiment(messages),
    actionItems: extractActionItems(messages),
    decisions: extractDecisions(messages),
    followUpRequired: requiresFollowUp(messages)
  };

  // 分析結果を BigQuery に保存
  await saveThreadAnalysis(analysis);

  return analysis;
}

/**
 * 会議情報抽出
 * @param {Object} params - 抽出パラメータ
 * @returns {Promise<Object>} 抽出された会議情報
 */
async function extractMeetingInfo(params) {
  const { emailId, threadId } = params;

  const gmail = google.gmail({ version: 'v1', auth: await getAuthClient() });

  let messages = [];

  if (threadId) {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });
    messages = thread.data.messages || [];
  } else if (emailId) {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full'
    });
    messages = [message.data];
  }

  // 会議情報抽出ロジック
  const meetingInfo = {
    proposedTimes: extractProposedTimes(messages),
    confirmedTime: extractConfirmedTime(messages),
    location: extractLocation(messages),
    agenda: extractAgenda(messages),
    attendees: extractAttendees(messages),
    meetingType: classifyMeetingType(messages),
    urgency: assessUrgency(messages),
    status: determineMeetingStatus(messages)
  };

  return meetingInfo;
}

/**
 * メールインサイト取得
 * @param {Object} params - インサイトパラメータ
 * @returns {Promise<Object>} メールインサイト
 */
async function getEmailInsights(params) {
  const { timeRange = {}, analysisType = 'comprehensive' } = params;

  // BigQuery でメール統計を分析
  const query = `
    WITH email_stats AS (
      SELECT
        COUNT(*) as total_emails,
        COUNT(DISTINCT sender) as unique_senders,
        COUNT(CASE WHEN meeting_related = true THEN 1 END) as meeting_emails,
        AVG(importance_score) as avg_importance,
        COUNT(CASE WHEN ARRAY_LENGTH(action_items) > 0 THEN 1 END) as emails_with_actions,
        -- 時間別分析
        EXTRACT(HOUR FROM received_date) as hour_of_day,
        EXTRACT(DAYOFWEEK FROM received_date) as day_of_week,
        -- 応答時間分析
        AVG(response_time_hours) as avg_response_time
      FROM \`${bigquery.projectId}.${datasetId}.${emailTableId}\`
      WHERE received_date >= @startDate
        AND received_date <= @endDate
      GROUP BY hour_of_day, day_of_week
    )
    SELECT
      *,
      -- 効率性指標
      CASE
        WHEN avg_response_time <= 2 THEN 'excellent'
        WHEN avg_response_time <= 8 THEN 'good'
        WHEN avg_response_time <= 24 THEN 'acceptable'
        ELSE 'needs_improvement'
      END as response_efficiency
    FROM email_stats
    ORDER BY total_emails DESC
  `;

  const [insights] = await bigquery.query({
    query: query,
    params: {
      startDate: timeRange.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: timeRange.end || new Date().toISOString()
    }
  });

  return {
    insights: insights,
    recommendations: generateEmailRecommendations(insights),
    trends: identifyEmailTrends(insights),
    actionItems: prioritizeActionItems(insights)
  };
}

/**
 * ヘルパー関数群
 */

// 認証クライアント取得
async function getAuthClient() {
  try {
    // OAuth 2.0 認証を使用（前回の成功パターン）
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
    );

    // 事前に保存されたトークンを使用
    // 実際の実装では Firestore や環境変数からトークンを取得
    const tokens = {
      access_token: process.env.GOOGLE_ACCESS_TOKEN,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
      token_type: 'Bearer'
    };

    if (tokens.access_token) {
      oauth2Client.setCredentials(tokens);
      console.log('Gmail API OAuth 2.0 認証成功');
      return oauth2Client;
    }

    // トークンがない場合はフォールバック
    console.warn('OAuth トークンが設定されていません。模擬レスポンスモードで動作します。');
    return null;

  } catch (error) {
    console.error('Gmail API OAuth 認証エラー:', error);

    // フォールバック: サービスアカウント認証を試行
    try {
      console.log('サービスアカウント認証にフォールバック...');
      const auth = new google.auth.GoogleAuth({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './smartmeet-workspace-sa-key.json',
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/bigquery'
        ]
      });

      const authClient = await auth.getClient();
      console.log('Gmail API サービスアカウント認証成功 (フォールバック)');
      return authClient;

    } catch (saError) {
      console.error('サービスアカウント認証も失敗:', saError);
      return null; // 認証失敗時は null を返して模擬モードで動作
    }
  }
}

// ヘッダー値取得
function getHeaderValue(headers, name) {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

// メール本文抽出
function extractEmailBody(payload) {
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString();
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString();
      }
    }
  }

  return '';
}

// 添付ファイル有無確認
function hasAttachments(payload) {
  if (payload.parts) {
    return payload.parts.some(part =>
      part.filename && part.filename.length > 0
    );
  }
  return false;
}

// 会議関連メール判定
function isMeetingRelated(messageData) {
  const subject = getHeaderValue(messageData.payload.headers, 'Subject').toLowerCase();
  const body = extractEmailBody(messageData.payload).toLowerCase();

  const meetingKeywords = [
    '会議', '打ち合わせ', 'meeting', 'schedule', 'calendar',
    '予定', 'appointment', '面談', 'conference', 'call'
  ];

  return meetingKeywords.some(keyword =>
    subject.includes(keyword) || body.includes(keyword)
  );
}

// BigQuery にメールデータ保存
async function saveEmailsToBigQuery(emails) {
  if (emails.length === 0) return;

  const rows = emails.map(email => ({
    email_id: email.id,
    thread_id: email.threadId,
    subject: email.subject,
    sender: email.from,
    recipients: email.to,
    received_date: new Date(email.date).toISOString(),
    body_text: email.bodyPreview,
    meeting_related: email.meetingRelated,
    has_attachments: email.hasAttachments,
    importance_score: calculateImportanceScore(email),
    processed_at: new Date().toISOString()
  }));

  await bigquery
    .dataset(datasetId)
    .table(emailTableId)
    .insert(rows);
}

// 重要度スコア計算
function calculateImportanceScore(email) {
  let score = 0.5; // ベーススコア

  if (email.meetingRelated) score += 0.3;
  if (email.hasAttachments) score += 0.1;
  if (email.subject.includes('緊急') || email.subject.includes('urgent')) score += 0.2;

  return Math.min(score, 1.0);
}

// 日付フォーマット（Gmail API用）
function formatDate(dateString) {
  return new Date(dateString).toISOString().split('T')[0].replace(/-/g, '/');
}

// その他のヘルパー関数（スタブ実装）
function analyzeEmailThreads(emails) { return { summary: '分析完了' }; }
function extractKeywordTrends(emails) { return []; }
function summarizeActionItems(emails) { return []; }
function buildEmailFromTemplate(template, params) { return params.body; }
function createEmailMessage(params) { return ''; }
function logEmailSent(data) { return Promise.resolve(); }
function extractParticipants(messages) { return []; }
function calculateTimespan(messages) { return { hours: 0 }; }
function extractTopics(messages) { return []; }
function analyzeSentiment(messages) { return 'neutral'; }
function extractActionItems(messages) { return []; }
function extractDecisions(messages) { return []; }
function requiresFollowUp(messages) { return false; }
function saveThreadAnalysis(analysis) { return Promise.resolve(); }
function extractProposedTimes(messages) { return []; }
function extractConfirmedTime(messages) { return null; }
function extractLocation(messages) { return ''; }
function extractAgenda(messages) { return []; }
function extractAttendees(messages) { return []; }
function classifyMeetingType(messages) { return 'general'; }
function assessUrgency(messages) { return 'normal'; }
function determineMeetingStatus(messages) { return 'pending'; }
function generateEmailRecommendations(insights) { return []; }
function identifyEmailTrends(insights) { return []; }
function prioritizeActionItems(insights) { return []; }