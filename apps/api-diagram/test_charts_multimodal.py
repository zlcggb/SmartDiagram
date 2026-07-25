import os
import sys
import asyncio
from dotenv import load_dotenv

# Load environmental variables
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from app.agents.charts_agent import SYSTEM_PROMPT

async def run_detailed_test(model_name: str, use_streaming: bool):
    print(f"\n--- Model: {model_name} | streaming={use_streaming} ---")
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    
    # 1x1 transparent gif base64
    tiny_image_url = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    
    llm = ChatOpenAI(
        api_key=api_key,
        base_url=base_url,
        model=model_name,
        temperature=0.3,
        streaming=use_streaming,
        request_timeout=60, # 60 seconds
    )
    
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=[
            {"type": "text", "text": "结合图片数据，画一个简单的雷达图。"},
            {"type": "image_url", "image_url": {"url": tiny_image_url}}
        ])
    ]
    
    try:
        print("Sending request...")
        import time
        start_time = time.time()
        response = await llm.ainvoke(messages)
        duration = time.time() - start_time
        print(f"Success in {duration:.2f} seconds!")
        print(f"Response (truncated): {response.content[:150]}")
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")

async def main():
    # Test gpt-5.4 first (streaming=True and False)
    await run_detailed_test("gpt-5.4", use_streaming=True)
    await run_detailed_test("gpt-5.4", use_streaming=False)
    
    # Test gpt-5.2 (streaming=True and False)
    await run_detailed_test("gpt-5.2", use_streaming=True)
    await run_detailed_test("gpt-5.2", use_streaming=False)

if __name__ == "__main__":
    asyncio.run(main())
