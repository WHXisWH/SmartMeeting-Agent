#!/usr/bin/env python3
"""Deploy SmartMeet Custom Agent (no external pip deps) to Vertex Reasoning Engine.

Environment variables:
  - GOOGLE_CLOUD_PROJECT_ID (default: smartmeet-470807)
  - VERTEX_AI_LOCATION       (default: asia-northeast1)
  - STAGING_BUCKET           (optional; default: gs://{PROJECT}-agent-staging)
"""

import os
import uuid
from pathlib import Path

import vertexai
from vertexai.preview.reasoning_engines import ReasoningEngine
from importlib import import_module


PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT_ID", "smartmeet-470807")
LOCATION = os.getenv("VERTEX_AI_LOCATION", "asia-northeast1")


def deploy_custom(smoke_test: bool = True):
    script_dir = Path(__file__).parent.resolve()
    os.chdir(script_dir)

    display_name = "SmartMeet Custom Agent"
    staging_bucket = os.getenv("STAGING_BUCKET", f"gs://{PROJECT_ID}-agent-staging")

    print("Deploying SmartMeet Custom Agent...")
    print(f"Project: {PROJECT_ID}")
    print(f"Location: {LOCATION}")
    print(f"Staging Bucket: {staging_bucket}")

    vertexai.init(project=PROJECT_ID, location=LOCATION, staging_bucket=staging_bucket)

    # Only package the clean custom_agent directory / クリーンな custom_agent のみ打包
    extra_packages = ["custom_agent"]

    unique_id = str(uuid.uuid4())[:8]
    # Import at deploy-time to ensure pickle works / デプロイ時にインポート
    agent_obj = import_module("custom_agent.agent").agent
    re = ReasoningEngine.create(
        agent_obj,
        requirements=[],
        extra_packages=extra_packages,
        display_name=f"{display_name}-{unique_id}",
        description=(
            "SmartMeet custom orchestrator (GCP-only). Calls Cloud Functions/Run;"
            " no external pip dependencies in remote container."
        ),
    )
    print("ReasoningEngine created!")
    print(f"Resource Name: {re.resource_name}")

    engine_id = re.resource_name.split("/")[-1]
    console_url = f"https://console.cloud.google.com/vertex-ai/reasoning-engines/{engine_id}?project={PROJECT_ID}"
    print(f"Console URL: {console_url}")

    if smoke_test:
        try:
            resp = re.query(input="Show me meetings next week and prep materials")
            preview = resp.get("output") if isinstance(resp, dict) else str(resp)
            print(f"Smoke output: {str(preview)[:200]}...")
        except Exception as e:
            print(f"Smoke test failed (ignored): {e}")

    return {"engine_id": engine_id, "console_url": console_url}


if __name__ == "__main__":
    info = deploy_custom(smoke_test=True)
    print("\nCustom Agent deploy complete.")
    print(f"Engine ID: {info['engine_id']}")
    print(f"Console:   {info['console_url']}")
