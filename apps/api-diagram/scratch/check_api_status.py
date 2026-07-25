import os
import google.auth
from google.auth.transport.requests import AuthorizedSession

# 设置凭证
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "gcp-credentials.json"

try:
    credentials, project = google.auth.default(
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
    project_id = "gen-lang-client-0447529049"
    print(f"Checking API status for project: {project_id}")
    
    # 构造授权 HTTP Session
    authed_session = AuthorizedSession(credentials)
    
    # 请求 serviceusage API 检查服务状态
    url = f"https://serviceusage.googleapis.com/v1/projects/{project_id}/services/aiplatform.googleapis.com"
    response = authed_session.get(url)
    
    if response.status_code == 200:
        data = response.json()
        state = data.get('state')
        print(f"\n📢 Vertex AI API (aiplatform.googleapis.com) status: {state}")
        if state == 'ENABLED':
            print("✅ The Vertex AI API is successfully enabled on this project!")
        else:
            print("❌ The Vertex AI API is NOT enabled (Disabled). This is why all model requests fail with 404!")
    else:
        print(f"Failed to fetch API status. Status code: {response.status_code}, Response: {response.text}")
        
except Exception as e:
    print(f"Error checking API status: {e}")
