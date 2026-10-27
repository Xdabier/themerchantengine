"""Shared helpers for the llm-metrics scripts.

The transcripts live under ~/.claude/projects/<slug>/ where <slug> is the
repo path with every non-alphanumeric character replaced by "-". The slug is
derived from the current working directory so the scripts work from any clone.
"""
import datetime
import glob
import json
import os
import re
import sys

# Shell command classes, matched in order. Reused by tool_durations.py and baseline.py.
COMMAND_CLASSES = [
    ("git commit (pre-commit lint+test hook)", re.compile(r"git commit")),
    ("nx e2e / playwright", re.compile(r"nx e2e|playwright test|test:e2e|test:storefront-ssr-smoke")),
    ("nx test / jest / vitest", re.compile(r"nx (run-many|affected)[^|;]* -t[^|;]*test|nx test|npx jest|npx vitest")),
    ("nx affected lint/test (manual)", re.compile(r"nx affected")),
    ("nx build", re.compile(r"nx build")),
    ("nx lint / eslint / tsc", re.compile(r"nx lint|npx eslint|npx tsc")),
    ("prisma", re.compile(r"prisma")),
    ("docker / install", re.compile(r"docker|npm (ci|install)|nx serve")),
    ("git other", re.compile(r"\bgit\b")),
    ("curl", re.compile(r"\bcurl\b")),
]

UNIT_TEST_CLASS = "nx test / jest / vitest"
E2E_CLASS = "nx e2e / playwright"


def project_slug(path):
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.abspath(path))


def project_root(explicit=None):
    """Directory that holds this repo's transcripts."""
    if explicit:
        return explicit
    env = os.environ.get("LLM_METRICS_ROOT")
    if env:
        return env
    repo = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", project_slug(repo))


def main_session_files(root):
    return sorted(glob.glob(os.path.join(root, "*.jsonl")), key=os.path.getmtime)


def subagent_files(root):
    top = set(main_session_files(root))
    return [f for f in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True) if f not in top]


def parse_ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def iter_entries(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def usage_tokens(usage):
    """Input tokens processed for one API call (cache reads included) and output tokens."""
    inp = (usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0)
           + usage.get("cache_creation_input_tokens", 0))
    return inp, usage.get("output_tokens", 0)


def classify_command(cmd):
    for label, rx in COMMAND_CLASSES:
        if rx.search(cmd):
            return label
    return "other shell"


def configure_stdout():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
