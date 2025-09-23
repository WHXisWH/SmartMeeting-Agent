# SmartMeet AI エージェント設定ガイド

## 🎯 Vertex AI Agent Builder 設定手順

### Step 1: Agent Builder コンソールアクセス

1. Google Cloud Console で **Vertex AI** > **Agent Builder** にアクセス
2. プロジェクト: `smartmeet-470807`
3. リージョン: `asia-northeast1` (東京)

### Step 2: 新規エージェント作成

```
エージェント名: SmartMeet AI エージェント
説明: 日本語対応の会議管理・意思決定支援 AI エージェント
言語: 日本語 (ja)
タイムゾーン: Asia/Tokyo
```

### Step 3: ツール設定 (Webhook 連携)

#### 📅 カレンダーツール
```json
{
  "name": "calendar_tool",
  "displayName": "カレンダーツール",
  "webhook_url": "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/calendarTool",
  "description": "会議の取得、作成、更新、削除、衝突検出、パターン分析"
}
```

#### 📧 Gmail ツール
```json
{
  "name": "gmail_tool",
  "displayName": "Gmail ツール",
  "webhook_url": "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/gmailTool",
  "description": "メール検索、会議関連メール分析、メール送信"
}
```

#### 📄 Drive ツール
```json
{
  "name": "drive_tool",
  "displayName": "Drive ツール",
  "webhook_url": "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/driveTool",
  "description": "文書検索、分析、要約、Vector Search 連携"
}
```

#### 🧠 意思決定ツール
```json
{
  "name": "decision_tool",
  "displayName": "意思決定ツール",
  "webhook_url": "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/decisionTool",
  "description": "複合データ分析、意思決定支援、優先度判定、リスク評価"
}
```

### Step 4: システムインストラクション設定

```
あなたは日本企業向けの会議管理・意思決定支援 AI エージェントです。

主な役割:
1. 会議スケジュール管理と最適化
2. Gmail メール分析による会議準備
3. Google Drive 文書検索・要約
4. データ分析に基づく意思決定支援
5. 複合的な情報分析とインサイト提供

常に丁寧で専門的な日本語で応答し、ビジネス効率化を支援してください。

利用可能なツール:
- calendar_tool: 会議管理 (取得、作成、衝突検出、パターン分析)
- gmail_tool: メール分析 (検索、会議関連抽出、インサイト)
- drive_tool: 文書管理 (検索、分析、要約、Vector Search)
- decision_tool: 意思決定支援 (状況分析、推奨アクション、優先度評価)

各ツールを適切に組み合わせて、包括的な支援を提供してください。
```

### Step 5: ナレッジベース設定

#### BigQuery データソース接続
- **データセット**: `smartmeet_meetings`
- **テーブル**:
  - `meetings` (会議データ)
  - `analysis_results` (分析結果)
  - `documents` (文書メタデータ)

#### Vector Search 接続
- **インデックス**: 既存の Vector Search インデックス
- **用途**: 文書検索・関連性分析

### Step 6: 会話フロー設計

#### デフォルト開始メッセージ
```
こんにちは！SmartMeet AI エージェントです。

私は以下の機能でサポートいたします：

📅 **会議管理**
・スケジュール確認・調整
・会議の作成・更新
・衝突検出と最適化

📧 **メール分析**
・会議関連メール抽出
・アクションアイテム識別
・コミュニケーション分析

📄 **文書管理**
・関連文書検索
・文書要約・分析
・ナレッジベース活用

🧠 **意思決定支援**
・データ分析と洞察
・推奨アクション提案
・リスク評価

どのようなお手伝いをいたしましょうか？
```

### Step 7: テスト・検証

1. **基本会話テスト**
   - 挨拶・自己紹介
   - 機能説明要求

2. **ツール連携テスト**
   - カレンダーイベント取得
   - メール検索
   - 文書検索
   - 意思決定支援

3. **複合機能テスト**
   - 会議準備支援
   - 横断データ分析
   - 総合的な推奨アクション

### Step 8: 本番環境デプロイ

1. **認証設定**
   - サービスアカウント権限
   - OAuth 2.0 設定

2. **監視設定**
   - ログ収集
   - パフォーマンス監視
   - エラー追跡

3. **セキュリティ設定**
   - アクセス制御
   - データ保護

## 🔗 関連リンク

- [Vertex AI Agent Builder Console](https://console.cloud.google.com/vertex-ai/agent-builder)
- [Cloud Functions Console](https://console.cloud.google.com/functions)
- [BigQuery Console](https://console.cloud.google.com/bigquery)
- [Vector Search Console](https://console.cloud.google.com/vertex-ai/matching-engine)

## 📝 設定チェックリスト

- [ ] Agent Builder エージェント作成
- [ ] 4つの Cloud Functions webhook 設定
- [ ] システムインストラクション設定
- [ ] BigQuery データソース接続
- [ ] Vector Search 接続
- [ ] 会話フロー設計
- [ ] 基本機能テスト
- [ ] 複合機能テスト
- [ ] 本番環境認証設定
- [ ] 監視・ログ設定