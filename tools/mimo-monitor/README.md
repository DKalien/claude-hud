# MIMO Token Plan 监控工具

独立运行的后台脚本，定时轮询 MIMO API 并写入快照文件。claude-hud 通过读取快照文件显示用量，**不直接接触 Cookie**。

## 安装

```bash
pip install requests
```

## 配置

1. 复制配置示例：

```bash
cp config.json.example config.json
```

2. 编辑 `config.json`：

```json
{
  "cookie": "你的 MIMO Cookie",
  "interval_seconds": 300,
  "snapshot_path": "~/.claude/plugins/claude-hud/mimo-snapshot.json"
}
```

### 获取 Cookie

1. 浏览器打开 https://platform.xiaomimimo.com
2. 按 F12 打开开发者工具
3. 切换到 Network 标签
4. 刷新页面，点击任意请求
5. 右键 → Copy → Copy request headers
6. 找到 `Cookie:` 行，复制值

## 使用

### 前台运行（调试）

```bash
python monitor.py
```

### 只运行一次

```bash
python monitor.py --once
```

### 后台运行

#### Linux/macOS (systemd)

创建 `/etc/systemd/system/mimo-monitor.service`：

```ini
[Unit]
Description=MIMO Token Plan Monitor
After=network.target

[Service]
Type=simple
User=你的用户名
ExecStart=/usr/bin/python3 /path/to/monitor.py
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable mimo-monitor
sudo systemctl start mimo-monitor
```

#### Windows (任务计划程序)

1. 打开"任务计划程序"
2. 创建基本任务
3. 触发器：登录时
4. 操作：启动程序 `pythonw.exe`，参数 `D:\path\to\monitor.py`
5. 勾选"不管用户是否登录都要运行"

### 后台运行（简单方式）

```bash
# Linux/macOS
nohup python monitor.py > mimo-monitor.log 2>&1 &

# Windows (PowerShell)
Start-Process pythonw -ArgumentList "monitor.py" -WindowStyle Hidden
```

## 在 claude-hud 中启用

编辑 `~/.claude/plugins/claude-hud/config.json`：

```json
{
  "display": {
    "showMimoUsage": true,
    "mimoSnapshotPath": "~/.claude/plugins/claude-hud/mimo-snapshot.json"
  }
}
```

## 显示效果

```
MIMO [Pro] ████░░░░░ 42% │ 12.8M / 38B │ 余额: ¥329
```

## 快照格式

```json
{
  "updated_at": "2026-06-05T12:00:00+00:00",
  "plan_name": "Pro",
  "used_percentage": 42,
  "used_amount": "12.8M",
  "total_amount": "38B",
  "balance": 329.50,
  "balance_currency": "¥",
  "expires_at": null,
  "error": null
}
```

## 故障排除

- **Cookie 过期**：快照中会显示 `error: "Cookie 已过期"`，需要重新获取 Cookie
- **网络问题**：快照中会显示相应错误信息
- **快照不更新**：检查监控进程是否在运行
