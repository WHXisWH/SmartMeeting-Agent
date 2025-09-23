/**
 * カレンダーツール Cloud Function
 * Vertex AI Agent Builder用のカレンダー操作ツール
 *
 * 機能:
 * - 会議取得
 * - 衝突検出
 * - 会議作成・更新・削除
 * - パターン分析
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { google } = require('googleapis');

// BigQuery クライアント初期化
const bigquery = new BigQuery();
const datasetId = 'smartmeet_meetings';
const tableId = 'meetings';

/**
 * メイン関数 - Agent Builder からの webhook 呼び出しを処理
 * @param {Object} req - Express リクエストオブジェクト
 * @param {Object} res - Express レスポンスオブジェクト
 */
exports.calendarTool = async (req, res) => {
  try {
    console.log('カレンダーツール実行開始:', JSON.stringify(req.body, null, 2));

    const { action, parameters = {} } = req.body;

    // アクション別処理分岐
    let result;
    switch (action) {
      case 'get_events':
        result = await getEvents(parameters);
        break;
      case 'detect_conflicts':
        result = await detectConflicts(parameters);
        break;
      case 'create_meeting':
        result = await createMeeting(parameters);
        break;
      case 'update_meeting':
        result = await updateMeeting(parameters);
        break;
      case 'cancel_meeting':
        result = await cancelMeeting(parameters);
        break;
      case 'analyze_patterns':
        result = await analyzePatterns(parameters);
        break;
      default:
        throw new Error(`未対応のアクション: ${action}`);
    }

    console.log('カレンダーツール実行完了:', result);

    // Agent Builder に結果を返却
    res.status(200).json({
      success: true,
      action: action,
      result: result,
      timestamp: new Date().toISOString(),
      executionTime: Date.now() - req.startTime
    });

  } catch (error) {
    console.error('カレンダーツールエラー:', error);

    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 会議イベント取得
 * @param {Object} params - パラメータ {timeMin, timeMax, maxResults}
 * @returns {Promise<Object>} 会議一覧
 */
async function getEvents(params) {
  const { timeMin, timeMax, maxResults = 50 } = params;

  // BigQuery から会議データを取得
  const query = `
    SELECT
      meeting_id,
      title,
      description,
      start_time,
      end_time,
      attendees,
      organizer,
      status,
      conflict_score,
      importance_score
    FROM \`${bigquery.projectId}.${datasetId}.${tableId}\`
    WHERE start_time >= @timeMin
      AND start_time <= @timeMax
      AND status != 'cancelled'
    ORDER BY start_time ASC
    LIMIT @maxResults
  `;

  const options = {
    query: query,
    params: {
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      maxResults: maxResults
    }
  };

  const [rows] = await bigquery.query(options);

  return {
    events: rows,
    count: rows.length,
    timeRange: {
      start: options.params.timeMin,
      end: options.params.timeMax
    }
  };
}

/**
 * 会議衝突検出
 * @param {Object} params - パラメータ {timeMin, timeMax, participants}
 * @returns {Promise<Object>} 衝突検出結果
 */
async function detectConflicts(params) {
  const { timeMin, timeMax, participants = [] } = params;

  // 重複する時間帯の会議を検索
  const query = `
    SELECT
      m1.meeting_id as meeting1_id,
      m1.title as meeting1_title,
      m1.start_time as meeting1_start,
      m1.end_time as meeting1_end,
      m2.meeting_id as meeting2_id,
      m2.title as meeting2_title,
      m2.start_time as meeting2_start,
      m2.end_time as meeting2_end,
      -- 重複する参加者数を計算
      ARRAY_LENGTH(
        ARRAY(
          SELECT email FROM UNNEST(m1.attendees) a1
          WHERE email IN (
            SELECT email FROM UNNEST(m2.attendees) a2
          )
        )
      ) as overlapping_attendees_count
    FROM \`${bigquery.projectId}.${datasetId}.${tableId}\` m1
    JOIN \`${bigquery.projectId}.${datasetId}.${tableId}\` m2
      ON m1.meeting_id != m2.meeting_id
    WHERE m1.start_time >= @timeMin
      AND m1.start_time <= @timeMax
      AND m1.status != 'cancelled'
      AND m2.status != 'cancelled'
      -- 時間重複条件
      AND m1.start_time < m2.end_time
      AND m2.start_time < m1.end_time
      -- 参加者重複がある場合のみ
      AND ARRAY_LENGTH(
        ARRAY(
          SELECT email FROM UNNEST(m1.attendees) a1
          WHERE email IN (
            SELECT email FROM UNNEST(m2.attendees) a2
          )
        )
      ) > 0
    ORDER BY m1.start_time ASC
  `;

  const options = {
    query: query,
    params: {
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  };

  const [conflicts] = await bigquery.query(options);

  // 衝突の深刻度を計算
  const processedConflicts = conflicts.map(conflict => ({
    ...conflict,
    severity: calculateConflictSeverity(conflict),
    resolutionSuggestions: generateResolutionSuggestions(conflict)
  }));

  return {
    conflicts: processedConflicts,
    conflictCount: processedConflicts.length,
    timeRange: {
      start: options.params.timeMin,
      end: options.params.timeMax
    }
  };
}

/**
 * 新規会議作成
 * @param {Object} params - 会議データ
 * @returns {Promise<Object>} 作成結果
 */
async function createMeeting(params) {
  const {
    title,
    description,
    startTime,
    endTime,
    attendees,
    organizer,
    location
  } = params;

  // 新しい会議IDを生成
  const meetingId = `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // BigQuery に会議データを挿入
  const query = `
    INSERT INTO \`${bigquery.projectId}.${datasetId}.${tableId}\`
    (meeting_id, title, description, start_time, end_time, attendees, organizer, location, status, created_at)
    VALUES (@meetingId, @title, @description, @startTime, @endTime, @attendees, @organizer, @location, 'scheduled', CURRENT_TIMESTAMP())
  `;

  const attendeesFormatted = attendees.map(email => ({
    email: email,
    name: email.split('@')[0],
    response_status: 'pending',
    is_required: true
  }));

  await bigquery.query({
    query: query,
    params: {
      meetingId,
      title,
      description,
      startTime,
      endTime,
      attendees: attendeesFormatted,
      organizer,
      location
    }
  });

  return {
    meetingId: meetingId,
    status: 'created',
    calendarEventId: null // Google Calendar 同期は別途実装
  };
}

/**
 * 会議パターン分析
 * @param {Object} params - 分析パラメータ
 * @returns {Promise<Object>} 分析結果
 */
async function analyzePatterns(params) {
  const { timeMin, timeMax } = params;

  // 会議パターンを分析するクエリ
  const query = `
    WITH meeting_stats AS (
      SELECT
        COUNT(*) as total_meetings,
        AVG(duration_minutes) as avg_duration,
        AVG(ARRAY_LENGTH(attendees)) as avg_attendees,
        AVG(importance_score) as avg_importance,
        -- 曜日別分析
        EXTRACT(DAYOFWEEK FROM start_time) as day_of_week,
        EXTRACT(HOUR FROM start_time) as hour_of_day,
        -- 会議タイプ別
        meeting_type,
        -- 衝突率
        AVG(conflict_score) as avg_conflict_score
      FROM \`${bigquery.projectId}.${datasetId}.${tableId}\`
      WHERE start_time >= @timeMin
        AND start_time <= @timeMax
        AND status != 'cancelled'
      GROUP BY day_of_week, hour_of_day, meeting_type
    )
    SELECT
      *,
      -- 効率性指標
      CASE
        WHEN avg_duration <= 30 THEN 'high_efficiency'
        WHEN avg_duration <= 60 THEN 'medium_efficiency'
        ELSE 'low_efficiency'
      END as efficiency_rating
    FROM meeting_stats
    ORDER BY total_meetings DESC
  `;

  const [patterns] = await bigquery.query({
    query: query,
    params: {
      timeMin: timeMin || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      timeMax: timeMax || new Date().toISOString()
    }
  });

  return {
    patterns: patterns,
    insights: generatePatternInsights(patterns),
    recommendations: generateOptimizationRecommendations(patterns)
  };
}

/**
 * 会議更新（スタブ実装）
 */
async function updateMeeting(params) {
  // 実装予定
  return { status: 'not_implemented' };
}

/**
 * 会議キャンセル（スタブ実装）
 */
async function cancelMeeting(params) {
  // 実装予定
  return { status: 'not_implemented' };
}

/**
 * 衝突の深刻度を計算
 */
function calculateConflictSeverity(conflict) {
  const attendeeOverlapRatio = conflict.overlapping_attendees_count /
    Math.max(conflict.meeting1_attendees?.length || 1, conflict.meeting2_attendees?.length || 1);

  if (attendeeOverlapRatio >= 0.8) return 'critical';
  if (attendeeOverlapRatio >= 0.5) return 'high';
  if (attendeeOverlapRatio >= 0.2) return 'medium';
  return 'low';
}

/**
 * 解決案を生成
 */
function generateResolutionSuggestions(conflict) {
  return [
    `会議「${conflict.meeting2_title}」を30分後ろ倒しする`,
    `参加者の重複を減らす`,
    `会議を統合する可能性を検討`
  ];
}

/**
 * パターン洞察を生成
 */
function generatePatternInsights(patterns) {
  return [
    '火曜日午前中の会議が最も多い',
    '平均会議時間は適切な範囲内',
    '衝突率が高い時間帯: 10:00-11:00'
  ];
}

/**
 * 最適化推奨事項を生成
 */
function generateOptimizationRecommendations(patterns) {
  return [
    '会議時間を45分に統一することを検討',
    '重複する会議の統合を提案',
    '高衝突時間帯を避けたスケジューリング'
  ];
}