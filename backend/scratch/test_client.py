import httpx
import json
import asyncio
import time

async def main():
    url = "http://127.0.0.1:8000/api/chat/stream"
    payload = {
        "message": "@charts 2026 Q1 MIP、COB、SMD各产品线营收对比图",
        "history": [],
        "current_code": "",
        "current_task": "",
        "current_engine": ""
    }
    
    print(f"Sending POST request to {url}...")
    t0 = time.time()
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                print(f"Response status code: {response.status_code}")
                if response.status_code != 200:
                    body = await response.aread()
                    print(f"Error body: {body.decode()}")
                    return
                
                print("Connected! Waiting for stream events...")
                first = True
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if first:
                            print(f"First token received in {time.time() - t0:.2f}s")
                            first = False
                        try:
                            data = json.loads(data_str)
                            print(f"Event: {data.get('type')} | Content preview: {str(data.get('content', ''))[:60]}")
                        except json.JSONDecodeError:
                            print(f"Raw Line (failed parse): {line}")
                    elif line.strip():
                        print(f"Other: {line}")
                        
        print(f"Stream finished in {time.time() - t0:.2f}s")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
