import { v1 } from '@google-cloud/aiplatform';
import { helpers } from '@google-cloud/aiplatform';
import { Logger } from '../utils/Logger.js';

export class VertexAIService {
  private client: v1.PredictionServiceClient;
  private logger: Logger;
  private project: string;
  private location: string;

  constructor() {
    this.logger = new Logger('VertexAIService');
    this.project = process.env.GOOGLE_CLOUD_PROJECT_ID!;
    this.location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
    this.client = new v1.PredictionServiceClient();
  }

  async generateReasoningResponse(prompt: string, context?: any): Promise<any> {
    const endpoint = `projects/${this.project}/locations/${this.location}/publishers/google/models/gemini-1.5-pro`;

    const promptStruct = helpers.toValue({ text: this.formatReasoningPrompt(prompt, context) });
    const instances = [promptStruct!];

    const parameter = {
      temperature: 0.1,
      maxOutputTokens: 2048,
      topP: 0.8,
      topK: 40,
    };
    const parameters = helpers.toValue(parameter);

    const request = {
      endpoint,
      instances,
      parameters,
    };

    try {
      const [response] = await this.client.predict(request);
      if (!response.predictions || response.predictions.length === 0) {
        throw new Error('Received no predictions from Vertex AI.');
      }
      const prediction = response.predictions[0];
      const predictionValue = helpers.fromValue(prediction as any);
      if (typeof predictionValue !== 'string') {
        this.logger.warn('Prediction value is not a string', { value: predictionValue });
        return this.parseReasoningResponse(JSON.stringify(predictionValue));
      }
      return this.parseReasoningResponse(predictionValue);
    } catch (error) {
      this.logger.error('Gemini prediction failed', error);
      throw error;
    }
  }

  private getAgentSystemPrompt(): string {
    return `あなたはSmartMeet AI Agentの推論エンジンです。日本語のみで回答し、出力は指定のJSON構造に厳守してください。\n\nロール:\n- 自律的な会議管理エージェント（独立判断/意思決定）\n- 会議の効率と意思決定の質を最適化\n- 先回りの検知と能動的な介入\n\n主要目標:\n1. チームの会議ROI最大化\n2. 不要な会議時間を30%削減\n3. 意思決定のスピードを50%向上\n4. 95%のタスクを期限内達成\n5. チーム満足度>4.5/5を維持\n\n意思決定原則:\n- データ駆動（履歴+リアルタイム）\n- リスクと効率のバランス\n- ユーザー体験を重視\n- 継続学習/改善\n- 透明で説明可能\n\n推論要件:\n1. 段階的な思考（Chain-of-Thought）\n2. 多面的な要因分析\n3. 置信度(0–1)の提示\n4. 実行可能な具体アクション\n5. 潜在リスクと対策の提示\n\n出力形式（英語キー、内容は日本語）:\n- reasoning: 段階的推論\n- decision: 推奨アクション\n- confidence: 0–1\n- alternatives: 代替案\n- risks: リスク項目\n- explanation: 説明`;
  }

  private formatReasoningPrompt(prompt: string, context?: any): string {
    const contextStr = context ? `\nContextual Information:\n${JSON.stringify(context, null, 2)}` : '';
    
    return `${prompt}${contextStr}\n\nPlease perform a step-by-step reasoning analysis and provide a structured decision proposal.\n\nRequirements:\n1. Analyze the current situation and key factors\n2. Identify possible courses of action\n3. Evaluate the pros and cons of each option\n4. Select the optimal solution and explain the reasoning\n5. Assess decision risks and confidence\n\nPlease reply in strict JSON format:\n{\n  "reasoning": {\n    "situation_analysis": "Analysis of the current situation",\n    "key_factors": ["Factor 1", "Factor 2", "Factor 3"],\n    "options": [\n      {\n        "action": "Action description",\n        "pros": ["Pro 1", "Pro 2"],\n        "cons": ["Con 1", "Con 2"],\n        "impact": "Expected impact"\n      }\n    ]\n  },\n  "decision": {\n    "action": "Recommended specific action",\n    "rationale": "Reason for selection",\n    "expected_outcome": "Expected result"\n  },\n  "confidence": 0.8,\n  "alternatives": [\n    {\n      "action": "Alternative plan",\n      "when_to_use": "Conditions for use"\n    }\n  ],\n  "risks": [\n    {\n      "risk": "Risk description",\n      "probability": "Probability of occurrence",\n      "mitigation": "Mitigation measures"\n    }\n  ],\n  "explanation": "Detailed explanation of the decision"\n}`;
  }

  private parseReasoningResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON 形式のア応答が見つかりません');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.decision || !parsed.confidence) {
        throw new Error('必須フィールドが不足しています');
      }

      return parsed;
    } catch (error) {
      this.logger.error('Gemini 応答の解析に失敗しました', { response, error });
      
      return {
        reasoning: { situation_analysis: '解析失敗', key_factors: [], options: [] },
        decision: { action: '人手による介入が必要', rationale: '自動推論に失敗' },
        confidence: 0.1,
        alternatives: [],
        risks: [{ risk: '推論失敗', probability: 'high', mitigation: '人手介入' }],
        explanation: '推論エンジンの応答解析に失敗。人手での確認が必要です'
      };
    }
  }
}
