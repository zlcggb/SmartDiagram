import os
import sys
import time
from dotenv import load_dotenv

# Add backend to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.llm import create_llm

load_dotenv()

print("--- ENV CONFIG ---")
print(f"OPENAI_BASE_URL: {os.getenv('OPENAI_BASE_URL')}")
print(f"MODEL_ID: {os.getenv('MODEL_ID')}")
print(f"USE_VERTEX_AI: {os.getenv('USE_VERTEX_AI')}")
print(f"OPENAI_API_KEY length: {len(os.getenv('OPENAI_API_KEY') or '')}")

try:
    print("\nCreating LLM instance...")
    llm = create_llm()
    print(f"Created LLM of type: {type(llm)}")
    
    print("\nTesting non-streaming invoke...")
    t0 = time.time()
    res = llm.invoke("Hi, tell me a short joke in 1 sentence.")
    print(f"Non-streaming took {time.time() - t0:.2f}s")
    print(f"Response: {res.content}")
except Exception as e:
    print(f"Non-streaming call failed: {e}")

try:
    print("\nTesting streaming (astream)...")
    import asyncio
    
    async def test_stream():
        t0 = time.time()
        first_token = True
        async for chunk in llm.astream("Hi, count from 1 to 5. One number per line."):
            if first_token:
                print(f"First token received in {time.time() - t0:.2f}s")
                first_token = False
            print(chunk.content, end="", flush=True)
        print(f"\nStreaming completed in {time.time() - t0:.2f}s")
        
    asyncio.run(test_stream())
except Exception as e:
    print(f"Streaming call failed: {e}")
