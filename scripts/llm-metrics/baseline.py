"""Print the six baseline numbers from specs/features/llm-setup-optimization/plan.md section 0.

    python scripts/llm-metrics/baseline.py [--root DIR] [--specs DIR] [--session current|<id-prefix>] [--since YYYY-MM-DD] [--json]

One API call = one distinct message id. A streamed response is written as one
transcript line per content block, all carrying the same id and usage, so the
counts here dedupe by id. The older three scripts count lines, which inflates
turns and token totals by about 2x.
"""
import argparse
import datetime
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (E2E_CLASS, UNIT_TEST_CLASS, classify_command, configure_stdout,  # noqa: E402
                     iter_entries, main_session_files, parse_ts, project_root,
                     subagent_files, usage_tokens)

TOKENS_RX = re.compile(r"tokens in/out:\s*(\S+)")
HEADING_RX = re.compile(r"^#{1,6}\s+(.*)")
PHASE_LOG_RX = re.compile(r"^(\d+\.\s*)?phase log", re.IGNORECASE)


def read_session(path):
    usage_by_id = {}
    pending = {}
    first = last = None
    unit_runs = unit_seconds = e2e_runs = e2e_seconds = 0
    boundaries = summaries = 0
    for d in iter_entries(path):
        # One compaction writes a system compact_boundary entry and a user
        # isCompactSummary entry. Count the boundary, fall back to the summary
        # for a file that has none (a file mixing both shapes undercounts).
        if d.get("subtype") == "compact_boundary":
            boundaries += 1
        elif d.get("isCompactSummary"):
            summaries += 1
        ts = d.get("timestamp")
        t = parse_ts(ts) if ts else None
        if t:
            first = first or t
            last = t
        msg = d.get("message") or {}
        typ = d.get("type")
        if typ == "assistant":
            mid = msg.get("id") or d.get("uuid")
            if msg.get("usage"):
                usage_by_id[mid] = msg["usage"]
            for c in msg.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use" and t:
                    pending[c.get("id")] = (t, c.get("name"), c.get("input") or {})
        elif typ == "user" and t:
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if not (isinstance(c, dict) and c.get("type") == "tool_result"):
                    continue
                p = pending.pop(c.get("tool_use_id"), None)
                if not p or p[1] not in ("Bash", "PowerShell"):
                    continue
                dur = (t - p[0]).total_seconds()
                if dur < 0 or dur > 6 * 3600:
                    continue
                label = classify_command(p[2].get("command", ""))
                if label == UNIT_TEST_CLASS:
                    unit_runs += 1
                    unit_seconds += dur
                elif label == E2E_CLASS:
                    e2e_runs += 1
                    e2e_seconds += dur
    ctx = []
    inp_total = out_total = 0
    for u in usage_by_id.values():
        inp, out = usage_tokens(u)
        if inp:
            ctx.append(inp)
        inp_total += inp
        out_total += out
    hours = (last - first).total_seconds() / 3600 if first and last else 0.0
    return dict(id=os.path.basename(path).split(".")[0], mtime=os.path.getmtime(path), calls=len(usage_by_id), ctx=ctx,
                start=first, input_tokens=inp_total, output_tokens=out_total, hours=hours,
                unit_runs=unit_runs, unit_seconds=unit_seconds, e2e_runs=e2e_runs,
                e2e_seconds=e2e_seconds, compactions=boundaries or summaries)


def subagent_tokens(paths):
    total = 0
    for path in paths:
        usage_by_id = {}
        for d in iter_entries(path):
            msg = d.get("message") or {}
            if d.get("type") == "assistant" and msg.get("usage"):
                usage_by_id[msg.get("id") or d.get("uuid")] = msg["usage"]
        total += sum(usage_tokens(u)[0] for u in usage_by_id.values())
    return total


def phase_log_counts(specs_dir):
    """Count phase-log lines that carry `tokens in/out:` and how many carry a number."""
    total = numeric = 0
    for dirpath, _dirs, files in os.walk(specs_dir):
        for name in files:
            if not name.endswith(".md"):
                continue
            # Since O1 the logs live in phase-log.md files, which are log from top to bottom.
            is_log_file = name.endswith("phase-log.md")
            in_log = is_log_file
            with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    h = HEADING_RX.match(line)
                    if h:
                        in_log = is_log_file or bool(PHASE_LOG_RX.match(h.group(1).strip()))
                        continue
                    if not in_log:
                        continue
                    m = TOKENS_RX.search(line)
                    if not m:
                        continue
                    total += 1
                    if re.search(r"\d", m.group(1)):
                        numeric += 1
    return numeric, total


def p90(values):
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * 0.9))]


def fmt_num(v):
    """Drop the .0 that a rounded median carries when it is integral."""
    return int(v) if v == int(v) else v


def fmt_k(n):
    if n >= 1_000_000_000:
        return f"{n / 1e9:.2f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    return f"{round(n / 1000)}k" if n >= 1000 else str(n)


def parse_since(value):
    """A calendar date; sessions that started before its first second are dropped."""
    try:
        return datetime.datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        sys.exit(f"--since expects YYYY-MM-DD, got {value!r}")


def pick_session(sessions, wanted):
    if wanted == "current":
        return max(sessions, key=lambda s: s["mtime"])
    for s in sessions:
        if s["id"].startswith(wanted):
            return s
    sys.exit(f"no session starts with {wanted!r}")


def main(argv=None):
    configure_stdout()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", help="transcript directory (default: derived from the cwd)")
    ap.add_argument("--specs", default="specs", help="directory holding the plan files with phase logs")
    ap.add_argument("--session", help="'current' or an id prefix: also print that session's tokens in/out")
    ap.add_argument("--since", help="YYYY-MM-DD: only sessions that started on or after this date")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    root = project_root(args.root)
    files = main_session_files(root)
    sessions = [s for s in (read_session(f) for f in files) if s["calls"] > 0]
    sub_files = subagent_files(root)
    if args.since:
        since = parse_since(args.since)
        sessions = [s for s in sessions if s["start"] and s["start"] >= since]
        kept = {os.path.join(root, s["id"]) + os.sep for s in sessions}
        sub_files = [f for f in sub_files if any(f.startswith(k) for k in kept)]
    if not sessions and args.since:
        sys.exit(f"no sessions started on or after --since {args.since} under {root}")
    if not sessions:
        sys.exit(f"no sessions with an assistant turn under {root}")

    n = len(sessions)
    ctx = [c for s in sessions for c in s["ctx"]]
    main_input = sum(s["input_tokens"] for s in sessions)
    sub_input = subagent_tokens(sub_files)
    numeric, total_logs = phase_log_counts(args.specs)
    r = dict(
        root=root,
        since=args.since,
        sessions=n,
        ctx_median=int(statistics.median(ctx)),
        ctx_p90=int(p90(ctx)),
        session_median_hours=round(statistics.median(s["hours"] for s in sessions), 1),
        session_median_calls=round(statistics.median(s["calls"] for s in sessions), 1),
        unit_runs_per_session=round(sum(s["unit_runs"] for s in sessions) / n, 1),
        unit_minutes_per_session=round(sum(s["unit_seconds"] for s in sessions) / 60 / n, 1),
        e2e_runs_per_session=round(sum(s["e2e_runs"] for s in sessions) / n, 1),
        e2e_minutes_per_session=round(sum(s["e2e_seconds"] for s in sessions) / 60 / n, 1),
        main_input_tokens=main_input,
        subagent_input_tokens=sub_input,
        subagent_share_pct=round(100 * sub_input / (main_input + sub_input), 1) if main_input + sub_input else 0.0,
        compactions=sum(s["compactions"] for s in sessions),
        phase_log_numeric=numeric,
        phase_log_total=total_logs,
    )
    if args.session:
        s = pick_session(sessions, args.session)
        r["session"] = dict(id=s["id"], hours=round(s["hours"], 2), calls=s["calls"],
                            input_tokens=s["input_tokens"], output_tokens=s["output_tokens"])

    if args.json:
        print(json.dumps(r, indent=2))
        return
    print(f"transcripts: {root}")
    print(f"sessions: {n} (since {args.since})" if args.since else f"sessions: {n}")
    print(f"1. context per API call: median {fmt_k(r['ctx_median'])}, p90 {fmt_k(r['ctx_p90'])}")
    print(f"2. session: median {r['session_median_hours']} h, median {fmt_num(r['session_median_calls'])} API calls")
    print(f"3. tests per session: unit {r['unit_runs_per_session']} runs / {r['unit_minutes_per_session']} min, "
          f"e2e {r['e2e_runs_per_session']} runs / {r['e2e_minutes_per_session']} min")
    print(f"4. subagent input tokens: {fmt_k(sub_input)} ({r['subagent_share_pct']} percent of all input)")
    print(f"5. compactions: {r['compactions']} in {n} sessions")
    print(f"6. phase-log lines with real token counts: {numeric} of {total_logs}")
    if args.session:
        s = r["session"]
        print(f"session {s['id'][:8]}: {s['hours']} h, {s['calls']} API calls, "
              f"tokens in/out: {fmt_k(s['input_tokens'])}/{fmt_k(s['output_tokens'])}")


if __name__ == "__main__":
    main()
