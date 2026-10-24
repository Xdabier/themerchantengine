import json, os, glob, datetime, collections, re, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import project_root

root = project_root(sys.argv[1] if len(sys.argv) > 1 else None)
files = sorted(glob.glob(os.path.join(root, "*.jsonl")), key=os.path.getmtime)
sub = glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)
print("top-level jsonl:", len(files), " all jsonl incl subdirs:", len(sub))

CATS = [
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

def parse_ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))

cat_dur = collections.defaultdict(list)
tool_dur = collections.defaultdict(list)
agent_dur = collections.defaultdict(list)
sidechain = 0
per_session = []
total_tool_seconds = 0
total_wall = 0
model_turns = collections.Counter()
ctx_per_turn = []

for f in files:
    pending = {}  # tool_use_id -> (ts, name, input)
    first = last = None
    turns = 0
    cread = 0
    with open(f, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("isSidechain"):
                sidechain += 1
            ts = d.get("timestamp")
            if not ts:
                continue
            t = parse_ts(ts)
            first = first or t
            last = t
            msg = d.get("message") or {}
            if d.get("type") == "assistant":
                turns += 1
                u = msg.get("usage") or {}
                cr = u.get("cache_read_input_tokens", 0) + u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                if cr:
                    ctx_per_turn.append(cr)
                model_turns[msg.get("model", "?")] += 1
                for c in msg.get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        pending[c.get("id")] = (t, c.get("name"), c.get("input") or {})
            elif d.get("type") == "user":
                content = msg.get("content")
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "tool_result":
                            p = pending.pop(c.get("tool_use_id"), None)
                            if not p:
                                continue
                            t0, name, inp = p
                            dur = (t - t0).total_seconds()
                            if dur < 0 or dur > 6 * 3600:
                                continue
                            tool_dur[name].append(dur)
                            total_tool_seconds += dur
                            if name in ("Bash", "PowerShell"):
                                cmd = inp.get("command", "")
                                for label, rx in CATS:
                                    if rx.search(cmd):
                                        cat_dur[label].append(dur)
                                        break
                                else:
                                    cat_dur["other shell"].append(dur)
                            if name == "Agent":
                                agent_dur[inp.get("subagent_type", "?")].append(dur)
    if first and last:
        total_wall += (last - first).total_seconds()

def fmt(lst):
    if not lst:
        return "n/a"
    return "n=%d total=%.1fh median=%.0fs p90=%.0fs max=%.0fs" % (
        len(lst), sum(lst) / 3600, statistics.median(lst), sorted(lst)[int(len(lst) * 0.9) - 1] if len(lst) > 1 else lst[0], max(lst))

print("\nsidechain entries:", sidechain)
print("total session wall-clock: %.0fh ; time inside tool calls: %.0fh" % (total_wall / 3600, total_tool_seconds / 3600))
print("\ncontext tokens per assistant turn: median=%d p90=%d max=%d (n=%d)" % (
    statistics.median(ctx_per_turn), sorted(ctx_per_turn)[int(len(ctx_per_turn) * 0.9)], max(ctx_per_turn), len(ctx_per_turn)))
print("\nmodels by assistant turns:")
for k, v in model_turns.most_common():
    print("  %6d %s" % (v, k))
print("\nshell command classes (duration inside the call):")
for label, _ in CATS + [("other shell", None)]:
    print("  %-42s %s" % (label, fmt(cat_dur.get(label, []))))
print("\nper tool:")
for k, v in sorted(tool_dur.items(), key=lambda kv: -sum(kv[1]))[:12]:
    print("  %-34s %s" % (k, fmt(v)))
print("\nsubagent wall-clock by type:")
for k, v in sorted(agent_dur.items(), key=lambda kv: -sum(kv[1])):
    print("  %-40s %s" % (k, fmt(v)))
