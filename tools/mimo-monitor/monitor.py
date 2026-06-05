#!/usr/bin/env python3
"""
MIMO Token Plan 监控工具

独立运行的后台脚本，定时轮询 MIMO API 并写入快照文件。
claude-hud 通过读取快照文件显示用量，不直接接触 Cookie。

用法:
    python monitor.py                  # 使用默认配置
    python monitor.py --config my.json # 使用自定义配置
    python monitor.py --once           # 只运行一次（调试用）
"""

import argparse
import json
import os
import signal
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("错误: 需要 requests 库。请运行: pip install requests", file=sys.stderr)
    sys.exit(1)

# 默认配置路径
DEFAULT_CONFIG_PATH = Path(__file__).parent / "config.json"

# MIMO API 端点
BASE_URL = "https://platform.xiaomimimo.com"
BALANCE_URL = f"{BASE_URL}/api/v1/balance"
USAGE_URLS = [
    f"{BASE_URL}/api/v1/tokenPlan/usage",
    f"{BASE_URL}/api/v1/tokenPlan/subscription/status",
    f"{BASE_URL}/api/v1/tokenPlan/subscription/order",
    f"{BASE_URL}/api/v1/usage",
]


def load_config(config_path: str) -> dict:
    """加载配置文件"""
    path = Path(config_path).expanduser()
    if not path.exists():
        print(f"错误: 配置文件不存在: {path}", file=sys.stderr)
        print(f"请创建配置文件，参考 config.json.example", file=sys.stderr)
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)

    cookie = config.get("cookie", "").strip()
    if not cookie:
        print("错误: 配置文件中 cookie 为空", file=sys.stderr)
        sys.exit(1)

    return {
        "cookie": cookie,
        "interval_seconds": config.get("interval_seconds", 300),
        "snapshot_path": Path(config.get("snapshot_path", "")).expanduser(),
    }


def make_headers(cookie: str) -> dict:
    """构建请求头"""
    return {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
        "Referer": f"{BASE_URL}/",
    }


def fetch_balance(cookie: str) -> dict:
    """获取账户余额"""
    try:
        resp = requests.get(BALANCE_URL, headers=make_headers(cookie), timeout=10)
        if resp.status_code == 401:
            return {"ok": False, "balance": None, "error": "Cookie 已过期"}
        if resp.status_code >= 400:
            return {"ok": False, "balance": None, "error": f"HTTP {resp.status_code}"}

        data = resp.json()
        balance = None
        currency = "¥"

        if isinstance(data, dict):
            d = data.get("data", data)
            if isinstance(d, (int, float)):
                balance = d
            elif isinstance(d, dict):
                balance = d.get("balance") or d.get("amount") or d.get("remain")
                cur = d.get("currency") or d.get("unit")
                if cur:
                    currency = str(cur)
            elif isinstance(d, str):
                try:
                    balance = float(d)
                except ValueError:
                    pass

            if balance is None:
                balance = data.get("balance")

        return {"ok": True, "balance": balance, "currency": currency, "error": None}
    except requests.exceptions.ConnectionError:
        return {"ok": False, "balance": None, "currency": "¥", "error": "网络连接失败"}
    except Exception as e:
        return {"ok": False, "balance": None, "currency": "¥", "error": str(e)[:100]}


def fetch_usage(cookie: str) -> dict:
    """获取套餐用量（尝试多个端点）"""
    headers = make_headers(cookie)
    errors = []

    for url in USAGE_URLS:
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 401:
                return {"ok": False, "data": None, "error": "Cookie 已过期"}
            if resp.status_code == 404:
                errors.append(f"{url.split('/')[-1]}: 404")
                continue
            if resp.status_code >= 400:
                errors.append(f"{url.split('/')[-1]}: {resp.status_code}")
                continue

            data = resp.json()
            if isinstance(data, dict):
                if data.get("code") == 0 or "data" in data:
                    return {"ok": True, "data": data, "error": None}
            errors.append(f"{url.split('/')[-1]}: 格式不匹配")
        except Exception as e:
            errors.append(f"{url.split('/')[-1]}: {str(e)[:30]}")

    return {"ok": False, "data": None, "error": f"所有端点失败: {'; '.join(errors[:3])}"}


def format_token_count(tokens: int) -> str:
    """Format token count to human readable string"""
    if tokens >= 1_000_000_000:
        return f"{tokens / 1_000_000_000:.1f}B"
    if tokens >= 1_000_000:
        return f"{tokens / 1_000_000:.1f}M"
    if tokens >= 1_000:
        return f"{tokens / 1_000:.1f}K"
    return str(tokens)


def parse_usage_data(data: dict) -> dict:
    """Parse MIMO API response to extract usage data"""
    result = {
        "plan_name": None,
        "used_percentage": None,
        "used_amount": None,
        "total_amount": None,
    }

    if not data or not isinstance(data, dict):
        return result

    # MIMO API format: { code: 0, data: { monthUsage: { percent, items: [...] } } }
    inner = data.get("data", data)

    # Try monthUsage first (monthly token plan)
    month_usage = inner.get("monthUsage")
    if month_usage and isinstance(month_usage, dict):
        percent = month_usage.get("percent")
        if isinstance(percent, (int, float)):
            result["used_percentage"] = round(min(100, max(0, percent * 100)))

        items = month_usage.get("items", [])
        if items and isinstance(items, list) and len(items) > 0:
            item = items[0]
            used = item.get("used")
            limit = item.get("limit")
            if isinstance(used, (int, float)):
                result["used_amount"] = format_token_count(int(used))
            if isinstance(limit, (int, float)):
                result["total_amount"] = format_token_count(int(limit))

    # Fallback: try usage object
    if result["used_percentage"] is None:
        usage = inner.get("usage")
        if usage and isinstance(usage, dict):
            percent = usage.get("percent")
            if isinstance(percent, (int, float)):
                result["used_percentage"] = round(min(100, max(0, percent * 100)))

    # Fallback: try direct fields
    if result["used_percentage"] is None:
        for key in ["usedPercentage", "used_percentage", "percent"]:
            if key in inner and isinstance(inner[key], (int, float)):
                val = inner[key]
                result["used_percentage"] = round(min(100, max(0, val * 100 if val <= 1 else val)))
                break

    return result


def _parse_numeric(value: str | None) -> float | None:
    """解析带单位的数字字符串（如 '12.8M' -> 12800000）"""
    if not value:
        return None

    value = value.strip().upper()

    multipliers = {
        "K": 1_000,
        "M": 1_000_000,
        "B": 1_000_000_000,
        "T": 1_000_000_000_000,
    }

    for suffix, mult in multipliers.items():
        if value.endswith(suffix):
            try:
                return float(value[:-1]) * mult
            except ValueError:
                return None

    try:
        return float(value)
    except ValueError:
        return None


def write_snapshot(snapshot_path: Path, snapshot: dict) -> bool:
    """原子写入快照文件"""
    try:
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)

        # 写入临时文件
        fd, tmp_path = tempfile.mkstemp(
            dir=snapshot_path.parent,
            prefix=f".{snapshot_path.name}.",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.chmod(tmp_path, 0o600)
            # 原子替换
            os.replace(tmp_path, snapshot_path)
            os.chmod(snapshot_path, 0o600)
            return True
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    except Exception as e:
        print(f"写入快照失败: {e}", file=sys.stderr)
        return False


def run_once(cookie: str, snapshot_path: Path) -> dict:
    """执行一次轮询，返回快照数据"""
    now = datetime.now(timezone.utc)

    # 获取余额
    balance_result = fetch_balance(cookie)

    # 获取用量
    usage_result = fetch_usage(cookie)

    # 构建快照
    snapshot = {
        "updated_at": now.isoformat(),
        "plan_name": None,
        "used_percentage": None,
        "used_amount": None,
        "total_amount": None,
        "balance": None,
        "balance_currency": "¥",
        "expires_at": None,
        "error": None,
    }

    # 处理错误
    if not balance_result["ok"] and not usage_result["ok"]:
        # 两个都失败，使用错误信息
        error = usage_result.get("error") or balance_result.get("error") or "Unknown error"
        snapshot["error"] = error
    else:
        # 处理余额
        if balance_result["ok"]:
            snapshot["balance"] = balance_result.get("balance")
            snapshot["balance_currency"] = balance_result.get("currency", "¥")

        # 处理用量
        if usage_result["ok"]:
            usage_data = parse_usage_data(usage_result.get("data"))
            snapshot.update(usage_data)
        elif usage_result.get("error"):
            # 用量获取失败但余额成功，显示部分数据
            if not snapshot.get("error"):
                snapshot["error"] = f"用量获取失败: {usage_result['error']}"

    return snapshot


def safe_str(s: str) -> str:
    """Remove characters that can't be encoded in the terminal"""
    if not s:
        return s
    try:
        # Try to encode with the terminal's encoding
        s.encode(sys.stdout.encoding or 'utf-8')
        return s
    except (UnicodeEncodeError, LookupError):
        # Replace problematic characters
        return s.encode('ascii', errors='replace').decode('ascii')


def main():
    parser = argparse.ArgumentParser(description="MIMO Token Plan Monitor")
    parser.add_argument(
        "--config", "-c",
        default=str(DEFAULT_CONFIG_PATH),
        help="Config file path (default: config.json)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once (for debugging)",
    )
    args = parser.parse_args()

    config = load_config(args.config)
    cookie = config["cookie"]
    interval = config["interval_seconds"]
    snapshot_path = config["snapshot_path"]

    print(f"MIMO Monitor Started")
    print(f"  Snapshot: {snapshot_path}")
    print(f"  Interval: {interval}s")

    # Graceful exit
    running = True

    def signal_handler(sig, frame):
        nonlocal running
        print("\nStopping...")
        running = False

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    while running:
        snapshot = run_once(cookie, snapshot_path)

        if write_snapshot(snapshot_path, snapshot):
            status = "[OK]" if not snapshot.get("error") else "[!]"
            plan = safe_str(snapshot.get("plan_name") or "unknown")
            pct = snapshot.get("used_percentage")
            pct_str = f"{pct}%" if pct is not None else "N/A"
            balance = snapshot.get("balance")
            currency = safe_str(snapshot.get("balance_currency") or "$")
            balance_str = f"{currency}{balance}" if balance is not None else "N/A"
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {status} {plan} {pct_str} | balance {balance_str}")

        if args.once:
            break

        # 等待下一次轮询
        for _ in range(interval):
            if not running:
                break
            time.sleep(1)

    print("Monitor stopped")


if __name__ == "__main__":
    main()
