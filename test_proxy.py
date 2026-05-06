import requests, json, time, sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

BASE = "https://aigalgame.pages.dev/api"
PROMPT = 'hi'
MODELS = [
    ("zhipu", "glm-4-flash-250414"),
    ("zhipu", "glm-4.7-flash"),
    ("modelscope", "deepseek-ai/DeepSeek-V3-0324"),
    ("modelscope", "Qwen/Qwen2.5-7B-Instruct"),
    ("nvidia", "deepseek-ai/deepseek-v4-flash"),
    ("nvidia", "meta/llama-3.1-8b-instruct"),
    ("nvidia", "qwen/qwen2.5-coder-32b-instruct"),
    ("nvidia", "moonshotai/kimi-k2-instruct"),
]

results = []
for i, (p, m) in enumerate(MODELS, 1):
    url = f"{BASE}/{p}/chat/completions"
    body = {"model": m, "messages": [{"role": "user", "content": PROMPT}], "max_tokens": 100, "stream": False}
    if p == "nvidia":
        body["temperature"] = 1
        body["top_p"] = 0.9
    t0 = time.perf_counter()
    try:
        r = requests.post(url, json=body, timeout=60)
        elapsed = round(time.perf_counter() - t0, 2)
        if r.status_code == 200:
            d = r.json()
            c = d.get("choices", [{}])[0].get("message", {}).get("content", "")[:80]
            print(f"[{i}/{len(MODELS)}] {p}/{m}: {elapsed}s OK - {c}")
            results.append({"provider": p, "model": m, "time": elapsed, "status": "ok", "content": c})
        else:
            print(f"[{i}/{len(MODELS)}] {p}/{m}: {elapsed}s HTTP {r.status_code}")
            results.append({"provider": p, "model": m, "time": elapsed, "status": str(r.status_code)})
    except Exception as e:
        elapsed = round(time.perf_counter() - t0, 2)
        print(f"[{i}/{len(MODELS)}] {p}/{m}: {elapsed}s ERROR {e}")
        results.append({"provider": p, "model": m, "time": elapsed, "status": "error", "error": str(e)[:100]})
    time.sleep(1)

with open("test_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print("\n=== SUMMARY ===")
ok_r = [r for r in results if r["status"] == "ok"]
for r in sorted(ok_r, key=lambda x: x["time"]):
    print(f"  {r['provider']}/{r['model']}: {r['time']}s")
print(f"\nOK: {len(ok_r)}/{len(results)}")
print("Results saved to test_results.json")
