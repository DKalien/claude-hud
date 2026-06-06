#!/usr/bin/env python3
"""Update statusLine command to auto-start mimo-monitor daemon"""
import json
import os

settings_path = os.path.join(os.path.expanduser('~'), '.claude', 'settings.json')

with open(settings_path, 'r', encoding='utf-8') as f:
    settings = json.load(f)

cmd = settings['statusLine']['command']

# Add mimo-monitor daemon before exec
monitor_path = os.path.abspath(os.path.join(os.path.dirname(__file__), 'monitor.py')).replace('\\', '/')
old = 'exec /d/software/nodejs/node'
new = f'pythonw "{monitor_path}" --daemon --idle-timeout 1800 2>/dev/null; exec /d/software/nodejs/node'

settings['statusLine']['command'] = cmd.replace(old, new)

with open(settings_path, 'w', encoding='utf-8') as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)

print('Updated! Restart Claude Code.')
