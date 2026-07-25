import os
import sys
import asyncio
from dotenv import load_dotenv

# Load environmental variables
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

async def test_model(model_name: str):
    print(f"\n--- Testing model: {model_name} ---")
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    
    # 1x1 transparent gif base64
    tiny_image_url = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model_name,
        temperature=0.3,
        request_timeout=20, # shorter timeout for testing
    )
    
    content = [
        {"type": "text", "text": "分析这张图片的内容，并用一个词概括。"},
        {"type": "image_url", "image_url": {"url": tiny_image_url}}
    ]
    
    try:
        response = await llm.ainvoke([HumanMessage(content=content)])
        print(f"Success! Response: {response.content}")
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")

async def main():
    models = ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5"]
    for model in models:
        await test_model(model)

if __name__ == "__main__":
    asyncio.run(main())
