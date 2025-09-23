#!/usr/bin/env python3
"""
SmartMeet Custom Agent (JA/EN comments)

This agent focuses on orchestration only and calls Google Cloud services
via your existing Cloud Functions / Cloud Run endpoints.
No third-party pip packages are required in the remote container.

本エージェントは「編成／判断レイヤー」に限定し、実処理は
既存の Cloud Functions / Cloud Run に委譲します（GCP 原生）。
リモート環境における pip 依存は追加しません。
"""

from __future__ import annotations

import json
import os
import ssl
import uuid
from typing import Any, Dict, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


# ========= Config (ENV overrides) / 環境変数で上書き可能 =========
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT_ID", "smartmeet-470807")
LOCATION = os.getenv("VERTEX_AI_LOCATION", "asia-northeast1")

# Cloud Functions endpoints (default) / 既定エンドポイント
CF_ENDPOINTS = {
    "calendar": os.getenv(
        "CF_CALENDAR_URL",
        "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/calendarTool",
    ),
    "gmail": os.getenv(
        "CF_GMAIL_URL",
        "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/gmailTool",
    ),
    "drive": os.getenv(
        "CF_DRIVE_URL",
        "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/driveTool",
    ),
    "decision": os.getenv(
        "CF_DECISION_URL",
        "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/decisionTool",
    ),
    "data_pipeline": os.getenv(
        "CF_DATA_PIPELINE_URL",
        "https://asia-northeast1-smartmeet-470807.cloudfunctions.net/dataPipeline",
    ),
}

# Cloud Run backend base / Cloud Run バックエンド
BACKEND_BASE = os.getenv(
    "BACKEND_BASE_URL",
    "https://smartmeet-backend-184930122798.asia-northeast1.run.app",
)

# Shared secret for simple auth / 共有シークレット（簡易認証）
SHARED_SECRET = os.getenv("SM_SHARED_SECRET", "")


# ========= Utils =========
def _headers(trace_id: str) -> Dict[str, str]:
    h = {
        "Content-Type": "application/json",
        "X-Trace-Id": trace_id,
        "X-Project": PROJECT_ID,
    }
    if SHARED_SECRET:
        h["X-Shared-Secret"] = SHARED_SECRET
    return h


def _post_json(url: str, payload: Dict[str, Any], trace_id: str, timeout: int = 25) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=data, headers=_headers(trace_id), method="POST")
    # hardened TLS (optional) / TLS 強化（任意）
    ctx = ssl.create_default_context()
    try:
        with urlrequest.urlopen(req, timeout=timeout, context=ctx) as resp:
            text = resp.read().decode("utf-8")
            try:
                return json.loads(text)
            except Exception:
                return {"success": True, "text": text}
    except HTTPError as e:
        return {"success": False, "status": e.code, "error": e.reason}
    except URLError as e:
        return {"success": False, "error": str(e)}


def _ok(r: Dict[str, Any]) -> bool:
    return bool(r) and r.get("success", True) is not False


# ========= Agent =========
class SmartMeetCustomAgent:
    """Custom Agent orchestrating SmartMeet workflows.

    - query(): main entry / メイン入口
    - No third-party deps; only stdlib HTTP calls to GCP services.
    """

    def __init__(self, project: str = PROJECT_ID, location: str = LOCATION) -> None:
        # Store config only; no network calls here / 設定のみ保持。ネットワーク呼び出しは禁止
        self.project = project
        self.location = location

    # Optional / 任意
    def set_up(self) -> None:
        # Lazy initialization point if needed / 必要であれば遅延初期化
        return None

    def query(
        self,
        input: str = "",
        task: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Process a single request and return structured JSON.

        Args:
            input (str): user query or context / ユーザー入力・文脈
            task (str|None): explicit task routing (e.g., 'calendar.get_events')
            parameters (dict|None): action parameters / パラメータ

        Returns (dict):
            { traceId, input, routedTask, toolCalls:[], output, errors:[] }
        """

        trace_id = uuid.uuid4().hex[:16]
        params = parameters or {}
        tool_calls = []
        errors = []
        routed_task = task or ""

        # If explicit task provided, execute directly / 明示タスクがあれば直行
        if task:
            try:
                result = self._execute_task(task, params, trace_id)
                tool_calls.append({"task": task, "params": params, "result": _safe_slice(result)})
                return {
                    "traceId": trace_id,
                    "input": input,
                    "routedTask": task,
                    "toolCalls": tool_calls,
                    "output": result,
                    "errors": errors,
                }
            except Exception as e:
                errors.append({"task": task, "message": str(e)})

        # Automatic analysis first / まず状況分析
        analysis_payload = {"action": "analyze_situation", "parameters": {"context": input}}
        decision_resp = _post_json(CF_ENDPOINTS["decision"], analysis_payload, trace_id)
        tool_calls.append({"task": "decision.analyze_situation", "params": {"context": _safe_str(input)}, "result": _safe_slice(decision_resp)})

        if not _ok(decision_resp):
            errors.append({"task": "decision.analyze_situation", "message": str(decision_resp)})
            return {
                "traceId": trace_id,
                "input": input,
                "routedTask": routed_task,
                "toolCalls": tool_calls,
                "output": {"note": "decision analysis failed"},
                "errors": errors,
            }

        # Heuristic next-step / 次のアクション（簡易ヒューリスティック）
        next_action = _suggest_next_action(decision_resp)
        if next_action:
            try:
                action_task, action_params = next_action
                action_result = self._execute_task(action_task, action_params, trace_id)
                tool_calls.append({"task": action_task, "params": action_params, "result": _safe_slice(action_result)})
            except Exception as e:
                errors.append({"task": action_task, "message": str(e)})

        return {
            "traceId": trace_id,
            "input": input,
            "routedTask": routed_task or next_action[0] if next_action else "",
            "toolCalls": tool_calls,
            "output": decision_resp,
            "errors": errors,
        }

    # ========== Internal execution / 内部実行 ==========
    def _execute_task(self, task: str, params: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        # Task format: "tool.action" or "backend.path"
        # 例: "calendar.get_events" / "backend.minutes"
        if task.startswith("calendar."):
            return _post_json(CF_ENDPOINTS["calendar"], {"action": task.split(".", 1)[1], "parameters": params}, trace_id)
        if task.startswith("gmail."):
            return _post_json(CF_ENDPOINTS["gmail"], {"action": task.split(".", 1)[1], "parameters": params}, trace_id)
        if task.startswith("drive."):
            return _post_json(CF_ENDPOINTS["drive"], {"action": task.split(".", 1)[1], "parameters": params}, trace_id)
        if task.startswith("decision."):
            return _post_json(CF_ENDPOINTS["decision"], {"action": task.split(".", 1)[1], "parameters": params}, trace_id)
        if task.startswith("data_pipeline."):
            return _post_json(CF_ENDPOINTS["data_pipeline"], {"action": task.split(".", 1)[1], "parameters": params}, trace_id)

        # Backend shortcuts / バックエンドのショートカット
        if task == "backend.minutes":
            return _post_json(f"{BACKEND_BASE}/api/agent/minutes/generate", params, trace_id)
        if task == "backend.mindmap":
            return _post_json(f"{BACKEND_BASE}/api/speech/generate-mindmap", params, trace_id)

        raise ValueError(f"Unknown task: {task}")


def _suggest_next_action(decision_resp: Dict[str, Any]) -> Optional[tuple[str, Dict[str, Any]]]:
    """Very light heuristic for next step / 簡易ヒューリスティック.

    - If urgency high → get upcoming events to find slot.
    - If email context heavy → search meeting emails.
    """
    try:
        result = decision_resp.get("result") or decision_resp
        urgency = (result or {}).get("urgencyLevel", "")
        if isinstance(urgency, str) and urgency.lower() in {"high", "urgent"}:
            return (
                "calendar.get_events",
                {"timeMin": _iso_now(), "timeMax": _iso_in_days(7), "maxResults": 50},
            )
        # fallback: scan emails for "meeting"
        return ("gmail.search_emails", {"query": "meeting", "maxResults": 20})
    except Exception:
        return None


# ========= Helpers =========
def _safe_slice(obj: Any, limit: int = 6000) -> Any:
    try:
        text = json.dumps(obj, ensure_ascii=False)
        return json.loads(text[:limit]) if len(text) > limit else obj
    except Exception:
        return obj


def _safe_str(x: Any) -> str:
    try:
        s = str(x)
        return s[:2000]
    except Exception:
        return ""


def _iso_now() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _iso_in_days(days: int) -> str:
    import datetime as _dt
    return (_dt.datetime.utcnow().replace(microsecond=0) + _dt.timedelta(days=days)).isoformat() + "Z"


# Exported instance / エクスポートされるインスタンス
agent = SmartMeetCustomAgent()

