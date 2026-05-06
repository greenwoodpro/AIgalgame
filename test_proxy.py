import requests
import time
import json
import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    try:
        subprocess.run(['chcp', '65001'], shell=True, capture_output=True)
    except:
        pass

os.system("")
class C:
    GREEN = "\033[92m"; YELLOW = "\033[93m"; RED = "\033[91m"
    CYAN = "\033[96m"; GRAY = "\033[90m"; BOLD = "\033[1m"; RESET = "\033[0m"

def ok(s): return f"{C.GREEN}{s}{C.RESET}"
def warn(s): return f"{C.YELLOW}{s}{C.RESET}"
def err(s): return f"{C.RED}{s}{C.RESET}"
def info(s): return f"{C.CYAN}{s}{C.RESET}"
def gray(s): return f"{C.GRAY}{s}{C.RESET}"
def bold(s): return f"{C.BOLD}{s}{C.RESET}"

PROXY_BASE = "https://aigalgame.pages.dev"
DIRECT_BASE_ZHIPU = "https://open.bigmodel.cn/api/paas/v4"
DIRECT_BASE_MODELSCOPE = "https://api-inference.modelscope.cn/v1"

ZHIPU_KEY = os.environ.get("ZHIPU_API_KEY", "")
MODELSCOPE_KEY = os.environ.get("MODELSCOPE_API_KEY", "")

PROMPT = "用一句话描述星空下的少女，JSON格式回复。"
MAX_TOKENS = 200

TESTS = [
    {
        "name": "智谱-代理",
        "url": f"{PROXY_BASE}/api/zhipu/chat/completions",
        "headers": {"Content-Type": "application/json"},
        "body": {
            "model": "glm-4-flash-250414",
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": MAX_TOKENS,
            "stream": False,
        },
    },
    {
        "name": "智谱-直连",
        "url": f"{DIRECT_BASE_ZHIPU}/chat/completions",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ZHIPU_KEY}",
        },
        "body": {
            "model": "glm-4-flash-250414",
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": MAX_TOKENS,
            "stream": False,
        },
        "skip": not ZHIPU_KEY,
    },
    {
        "name": "魔搭-代理",
        "url": f"{PROXY_BASE}/api/modelscope/chat/completions",
        "headers": {"Content-Type": "application/json"},
        "body": {
            "model": "Qwen/Qwen2.5-72B-Instruct",
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": MAX_TOKENS,
            "stream": False,
        },
    },
    {
        "name": "魔搭-直连",
        "url": f"{DIRECT_BASE_MODELSCOPE}/chat/completions",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MODELSCOPE_KEY}",
        },
        "body": {
            "model": "Qwen/Qwen2.5-72B-Instruct",
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": MAX_TOKENS,
            "stream": False,
        },
        "skip": not MODELSCOPE_KEY,
    },
]

def run_test(test, idx, total):
    if test.get("skip"):
        name = test["name"]
        print(f"\n{gray(f'[{idx}/{total}] {name} - 跳过（无API Key）')}")
        return None

    print(f"\n{'─' * 60}")
    print(f"{bold(info(f'[{idx}/{total}]'))}  {bold(test['name'])}")
    print(f"  URL: {gray(test['url'][:80])}")
    print(f"{'─' * 60}")

    start = time.perf_counter()
    status_code = 0
    content = ""
    error_msg = ""
    ttft = None

    try:
        resp = requests.post(
            test["url"],
            headers=test["headers"],
            json=test["body"],
            timeout=30,
            stream=False,
        )
        status_code = resp.status_code
        total_time = time.perf_counter() - start

        if status_code == 200:
            data = resp.json()
            if "choices" in data and data["choices"]:
                content = data["choices"][0].get("message", {}).get("content", "")
            elif "output" in data:
                content = data["output"].get("text", "")
            else:
                content = json.dumps(data, ensure_ascii=False)[:200]
        else:
            error_msg = f"HTTP {status_code}: {resp.text[:200]}"
    except requests.exceptions.Timeout:
        total_time = time.perf_counter() - start
        error_msg = "超时（30s）"
    except Exception as e:
        total_time = time.perf_counter() - start
        error_msg = str(e)[:200]

    if error_msg:
        print(f"  {err(f'❌ {error_msg}')}")
        print(f"  耗时: {total_time:.2f}s")
    else:
        preview = content[:100].replace("\n", " ")
        print(f"  {ok(f'✅ 成功')}  耗时: {total_time:.2f}s")
        print(f"  回复: {gray(preview)}")
        print(f"  字数: {len(content)}")

    return {
        "name": test["name"],
        "status": "ok" if not error_msg else "error",
        "time": total_time,
        "content": content,
        "error": error_msg,
        "status_code": status_code,
    }

def main():
    print("═" * 60)
    print(bold(info("  🧪 Cloudflare 代理 vs 直连 对比测试")))
    print(f"  代理地址: {bold(PROXY_BASE)}")
    print(f"  测试数量: {len(TESTS)}")
    print("═" * 60)

    results = []
    for idx, test in enumerate(TESTS, 1):
        r = run_test(test, idx, len(TESTS))
        if r:
            results.append(r)

    print(f"\n{'═' * 60}")
    print(bold("  📊 对比结果"))
    print(f"{'═' * 60}")
    print(f"  {'测试':<20} {'状态':<8} {'耗时':>8}  {'字数':>6}")
    print(f"  {'─' * 50}")

    proxy_results = [r for r in results if "代理" in r["name"] and r["status"] == "ok"]
    direct_results = [r for r in results if "直连" in r["name"] and r["status"] == "ok"]

    for r in results:
        status = ok("✅") if r["status"] == "ok" else err("❌")
        time_str = f"{r['time']:.2f}s"
        chars = len(r.get("content", ""))
        print(f"  {r['name']:<20} {status:<10} {time_str:>8}  {chars:>6}")

    if proxy_results and direct_results:
        avg_proxy = sum(r["time"] for r in proxy_results) / len(proxy_results)
        avg_direct = sum(r["time"] for r in direct_results) / len(direct_results)
        overhead = ((avg_proxy - avg_direct) / avg_direct * 100) if avg_direct > 0 else 0
        print(f"\n  代理平均: {avg_proxy:.2f}s  直连平均: {avg_direct:.2f}s")
        if overhead > 0:
            print(f"  代理额外延迟: {warn(f'+{overhead:.1f}%')}")
        else:
            print(f"  代理额外延迟: {ok(f'{overhead:.1f}%')}")

    print(f"{'═' * 60}")

if __name__ == "__main__":
    main()
