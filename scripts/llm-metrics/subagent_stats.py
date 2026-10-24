import json, os, glob, datetime, collections, statistics, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import project_root

root = project_root(sys.argv[1] if len(sys.argv) > 1 else None)
top = set(glob.glob(os.path.join(root, "*.jsonl")))
allf = glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True)
subs = [f for f in allf if f not in top]

def parse_ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))

# ---- subagent transcripts ----
by_type = collections.defaultdict(lambda: dict(n=0, turns=0, out=0, ctx=0, hours=0.0, first_ctx=[], last_ctx=[]))
unknown_prompts = collections.Counter()
for f in subs:
    turns = out = ctx = 0
    first = last = None
    agent_type = None
    first_ctx = last_ctx = None
    with open(f, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except Exception:
                continue
            ts = d.get("timestamp")
            if ts:
                t = parse_ts(ts)
                first = first or t
                last = t
            if agent_type is None:
                for key in ("agentType", "subagentType", "agent_type"):
                    if d.get(key):
                        agent_type = d[key]
            msg = d.get("message") or {}
            if d.get("type") == "assistant":
                turns += 1
                u = msg.get("usage") or {}
                out += u.get("output_tokens", 0)
                c = u.get("cache_read_input_tokens", 0) + u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                ctx += c
                if first_ctx is None and c:
                    first_ctx = c
                if c:
                    last_ctx = c
    if turns == 0:
        continue
    if agent_type is None:
        agent_type = "unknown/" + os.path.basename(os.path.dirname(f))[:12]
    b = by_type[agent_type]
    b["n"] += 1
    b["turns"] += turns
    b["out"] += out
    b["ctx"] += ctx
    if first and last:
        b["hours"] += (last - first).total_seconds() / 3600
    if first_ctx:
        b["first_ctx"].append(first_ctx)
    if last_ctx:
        b["last_ctx"].append(last_ctx)

print("subagent transcripts:", len(subs))
print("type | runs | avg turns | avg wall min | avg output tok | total input tok (all turns, M) | median FIRST-turn ctx | median LAST-turn ctx")
tot_ctx = tot_out = 0
for k, b in sorted(by_type.items(), key=lambda kv: -kv[1]["ctx"]):
    tot_ctx += b["ctx"]; tot_out += b["out"]
    print("%-38s | %4d | %6.0f | %6.1f | %8.0f | %8.1f | %8s | %8s" % (
        k, b["n"], b["turns"] / b["n"], 60 * b["hours"] / b["n"], b["out"] / b["n"], b["ctx"] / 1e6,
        int(statistics.median(b["first_ctx"])) if b["first_ctx"] else "-",
        int(statistics.median(b["last_ctx"])) if b["last_ctx"] else "-"))
print("TOTAL subagent input tokens: %.1fM ; output: %.1fM" % (tot_ctx / 1e6, tot_out / 1e6))

# ---- main sessions: model latency vs tool latency, compaction events ----
model_lat = []
compactions = 0
summaries = 0
long_gaps = 0
for f in top:
    prev_user_ts = None
    with open(f, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("isCompactSummary") or (d.get("subtype") == "compact_boundary"):
                compactions += 1
            if d.get("type") == "summary":
                summaries += 1
            ts = d.get("timestamp")
            if not ts:
                continue
            t = parse_ts(ts)
            if d.get("type") == "user":
                prev_user_ts = t
            elif d.get("type") == "assistant" and prev_user_ts is not None:
                lat = (t - prev_user_ts).total_seconds()
                if 0 <= lat < 1800:
                    model_lat.append(lat)
                elif lat >= 1800:
                    long_gaps += 1
                prev_user_ts = None
print("\nmain-session model latency (user/tool_result -> next assistant msg): n=%d total=%.0fh median=%.0fs p90=%.0fs" % (
    len(model_lat), sum(model_lat) / 3600, statistics.median(model_lat), sorted(model_lat)[int(len(model_lat) * 0.9)]))
print("compaction boundaries:", compactions, " summary entries:", summaries, " gaps>30min:", long_gaps)
