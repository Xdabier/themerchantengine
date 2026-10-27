import json, os, glob, sys, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import project_root

root = project_root(sys.argv[1] if len(sys.argv) > 1 else None)
files = sorted(glob.glob(os.path.join(root, "*.jsonl")), key=os.path.getmtime)

rows = []
agent_total = collections.Counter()
skill_total = collections.Counter()
tool_total = collections.Counter()
for f in files:
    first = last = None
    out_tok = cache_read = cache_create = inp = 0
    turns = 0
    user_msgs = 0
    agents = collections.Counter()
    tools = collections.Counter()
    skills = collections.Counter()
    models = collections.Counter()
    first_prompt = ""
    try:
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                ts = d.get("timestamp")
                if ts:
                    t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    first = first or t
                    last = t
                typ = d.get("type")
                msg = d.get("message") or {}
                if typ == "user":
                    content = msg.get("content")
                    if isinstance(content, str) and not first_prompt and not content.startswith("<"):
                        first_prompt = content[:90].replace("\n", " ")
                        user_msgs += 1
                    elif isinstance(content, str):
                        user_msgs += 1
                if typ == "assistant":
                    turns += 1
                    u = msg.get("usage") or {}
                    out_tok += u.get("output_tokens", 0)
                    inp += u.get("input_tokens", 0)
                    cache_read += u.get("cache_read_input_tokens", 0)
                    cache_create += u.get("cache_creation_input_tokens", 0)
                    models[msg.get("model", "?")] += 1
                    for c in msg.get("content") or []:
                        if isinstance(c, dict) and c.get("type") == "tool_use":
                            name = c.get("name")
                            tools[name] += 1
                            if name == "Agent":
                                agents[(c.get("input") or {}).get("subagent_type", "?")] += 1
                            if name == "Skill":
                                skills[(c.get("input") or {}).get("skill", "?")] += 1
    except Exception as e:
        continue
    if not first or turns == 0:
        continue
    dur = (last - first).total_seconds() / 3600
    agent_total.update(agents)
    skill_total.update(skills)
    tool_total.update(tools)
    rows.append(dict(
        f=os.path.basename(f)[:8], start=first.strftime("%m-%d %H:%M"), hours=round(dur, 1),
        turns=turns, out=out_tok, cread=cache_read, ccreate=cache_create, inp=inp,
        agents=sum(agents.values()), size_mb=round(os.path.getsize(f) / 1e6, 1),
        prompt=first_prompt, models=dict(models)))

rows.sort(key=lambda r: r["start"])
print(f"sessions: {len(rows)}")
print("start | hours | turns | out_tok | cache_read | cache_create | agents | MB | first prompt")
for r in rows[-45:]:
    print(f"{r['start']} | {r['hours']:>5} | {r['turns']:>4} | {r['out']:>7} | {r['cread']:>10} | {r['ccreate']:>9} | {r['agents']:>3} | {r['size_mb']:>5} | {r['prompt'][:70]}")

import statistics
h = [r["hours"] for r in rows if r["hours"] > 0.05]
print("\nduration: median %.1fh, p75 %.1fh, max %.1fh, sessions>3h: %d of %d" % (
    statistics.median(h), sorted(h)[int(len(h)*0.75)], max(h), sum(1 for x in h if x > 3), len(h)))
print("total output tokens (all sessions): %d" % sum(r["out"] for r in rows))
print("total cache_read tokens: %d" % sum(r["cread"] for r in rows))
print("total cache_create tokens: %d" % sum(r["ccreate"] for r in rows))
print("\nsubagent invocations by type:")
for k, v in agent_total.most_common():
    print(f"  {v:>4} {k}")
print("\nskills invoked:")
for k, v in skill_total.most_common():
    print(f"  {v:>4} {k}")
print("\ntop tools:")
for k, v in tool_total.most_common(15):
    print(f"  {v:>5} {k}")
