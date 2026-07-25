import os
import google.auth
from google.cloud import aiplatform_v1beta1

# 设置凭证
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "gcp-credentials.json"

try:
    credentials, project = google.auth.default()
    project = "gen-lang-client-0447529049"  # 强制指定您当前的项目 ID
    print(f"Loaded credentials. Project: {project}")
    
    # 初始化
    client = aiplatform_v1beta1.ModelGardenServiceClient(
        client_options={"api_endpoint": "us-central1-aiplatform.googleapis.com"},
        credentials=credentials
    )
    
    parent = f"projects/{project}/locations/us-central1"
    print(f"Requesting models for: {parent}")
    
    # 列出模型
    # filter='publisher="google"' 只筛选来自谷歌官方的模型
    response = client.list_publisher_models(parent=parent, filter='publisher="google"')
    
    print("\n--- Available Google Publisher Models ---")
    count = 0
    for model in response:
        # 提取模型简称
        short_name = model.name.split('/')[-1] if '/' in model.name else model.name
        print(f"- {short_name}")
        count += 1
    
    print(f"\nTotal: {count} models found.")
    
except Exception as e:
    print(f"\nError occurred: {e}")
    print("\nAttempting fallback list (checking direct connectivity to gemini-1.5-flash and gemini-2.5-flash)...")
    # 备用方案，利用 ChatVertexAI 分别测试可用性
    try:
        from langchain_google_vertexai import ChatVertexAI
        for test_model in ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp", "gemini-2.5-flash", "gemini-2.5-pro"]:
            try:
                chat = ChatVertexAI(
                    model_name=test_model,
                    project=project,
                    location="us-central1"
                )
                # 尝试一个极小的调用以检测 404
                chat.invoke("Hi")
                print(f"✅ {test_model} is AVAILABLE and reachable!")
            except Exception as inner_e:
                if "404" in str(inner_e) or "not found" in str(inner_e).lower() or "PermissionDenied" in str(inner_e):
                    print(f"❌ {test_model} is NOT available (Reason: {inner_e})")
                else:
                    print(f"❓ {test_model} check failed with other error: {inner_e}")
    except Exception as fallback_e:
        print(f"Fallback check failed: {fallback_e}")
