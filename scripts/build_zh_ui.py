#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the Hermes Desktop "zh-ui" plugin: collect English UI/data strings, translate
them once with an OpenAI-compatible chat model, and emit a self-contained plugin.js.

Usage (typical):
    python scripts/build_zh_ui.py --online          # fetch public feeds, translate gaps, build
    python scripts/build_zh_ui.py --offline         # no network: use data/core-dict.json + cache
    python scripts/build_zh_ui.py --no-local-skills # build the shareable dist (drop personal skills)

Output:
    <HERMES_HOME>/desktop-plugins/zh-ui/plugin.js   (hot-loaded by the desktop app)

Environment:
    HERMES_HOME        Hermes data dir (default: ~/.hermes)
    DEEPSEEK_API_KEY   API key for the translation call (or ZH_API_KEY)
    ZH_API_URL         chat-completions endpoint (default: DeepSeek)
    ZH_MODEL           model id (default: deepseek-flash)
    HTTPS_PROXY        respected by urllib when --online fetches feeds

No dependency beyond the Python standard library (PyYAML optional, for MCP manifests).
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import glob
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path

PLUGIN_ID = "zh-ui"
ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "plugin.template.js"
CORE_DICT = ROOT / "data" / "core-dict.json"
CACHE_FILE = ROOT / ".cache" / "zh_dict_cache.json"
DIST_PLUGIN = ROOT / "dist" / "plugin.js"

HERMES_HOME = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))

API_URL = os.environ.get("ZH_API_URL") or "https://api.deepseek.com/chat/completions"
MODEL = os.environ.get("ZH_MODEL") or "deepseek-flash"

SKILLS_FEED = "https://nousresearch.github.io/hermes-agent/docs/api/skills.json"
CONNECTORS_CATALOG = "https://portal.nousresearch.com/api/v1/connectors/catalog/public"

SYSTEM = (
    "You are localising the Hermes desktop app's UI copy into Simplified Chinese. "
    "The input is a JSON array of English strings (skill/plugin one-line descriptions, "
    "UI labels, toolset blurbs). Output MUST be a JSON array of the same length, each "
    "element the Simplified Chinese rendering of the corresponding input. Rules: keep "
    "product names, software names, commands, code, file paths, URLs, version numbers in "
    "their original form; no explanations, no numbering, no markdown; return an element "
    "unchanged if it is already Chinese or is an identifier; output only the JSON array."
)

CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
LOCK = threading.Lock()


# --------------------------------------------------------------------- helpers
def norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip()


def sha(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:20]


def api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("ZH_API_KEY")
    if key:
        return key.strip()
    env_file = HERMES_HOME / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("DEEPSEEK_API_KEY") and "=" in line:
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        "No API key. Set DEEPSEEK_API_KEY (or ZH_API_KEY), or put DEEPSEEK_API_KEY=... in "
        + str(env_file) + ", or run with --offline."
    )


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def download(url: str, dest: Path, timeout: int = 180) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "hermes-desktop-zh-ui"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as fh:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
        return True
    except Exception as exc:  # noqa: BLE001
        print("!! download failed: %s (%s)" % (url, exc))
        return False


# ------------------------------------------------------------------- collecting
def frontmatter_description(path: Path) -> str | None:
    try:
        txt = path.read_text(encoding="utf-8", errors="replace")[:6000]
    except OSError:
        return None
    if not txt.startswith("---"):
        return None
    body = txt.split("---", 2)[1] if txt.count("---") >= 2 else ""
    m = re.search(r"^description:\s*(.+?)(?=^[A-Za-z_][\w-]*:|\Z)", body, re.S | re.M)
    if not m:
        return None
    d = m.group(1).strip()
    if d[:1] in ("|", ">"):
        d = " ".join(line.strip() for line in d[1:].strip().splitlines())
    else:
        d = d.strip().strip('"').strip("'")
    return norm(d) or None


def harvest_skills(root: Path, out: dict) -> int:
    n = 0
    for dirpath, _dirs, files in os.walk(root):
        if "SKILL.md" in files:
            d = frontmatter_description(Path(dirpath) / "SKILL.md")
            if d:
                out.setdefault(d, "skill")
                n += 1
    return n


def harvest_catalog(path: Path, out: dict, max_chars: int) -> int:
    data = load_json(path, {})
    rows = data.get("entries") if isinstance(data, dict) else data
    n = 0
    for e in rows or []:
        d = norm(e.get("description") or "")
        if d and len(d) <= max_chars:
            out.setdefault(d, "catalog")
            n += 1
    return n


def feed_label(label: str) -> str:
    text = (label or "").strip()
    parts = text.split(None, 1)
    if len(parts) == 2 and not any(ch.isascii() and ch.isalnum() for ch in parts[0]):
        return parts[1].strip()
    return text


def harvest_feed(path: Path, out: dict, per_cat: int, max_chars: int) -> int:
    rows = load_json(path, [])
    per: dict[str, int] = {}
    labels = set()
    n = 0
    for r in rows:
        cat = r.get("categoryLabel") or r.get("category") or ""
        if cat:
            labels.add(cat)
        if per.get(cat, 0) >= per_cat:
            continue
        d = norm(r.get("description") or "")
        if not d or len(d) > max_chars or CJK.search(d):
            continue
        per[cat] = per.get(cat, 0) + 1
        if d not in out:
            out[d] = "feed:" + str(r.get("name"))
            n += 1
    for lab in labels:
        if not 4 <= len(lab) <= 60 or CJK.search(lab):
            continue
        out.setdefault(lab, "feed-label")
        for form in (lab, lab.lower()):
            out.setdefault("Skills for %s." % form, "feed-label-blurb")
    return n


def harvest_toolsets(path: Path, out: dict) -> int:
    if not path.exists():
        return 0
    txt = path.read_text(encoding="utf-8", errors="replace")
    n = 0
    for m in re.finditer(r'\(\s*\n?\s*"[a-z_]+"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)', txt):
        title, blurb = feed_label(m.group(1)), m.group(2)
        for v in (title, blurb):
            if v and len(v) >= 5:
                out.setdefault(v, "toolset")
                n += 1
    return n


def harvest_connectors(portal: Path, mcp_dir: Path, out: dict) -> int:
    n = 0
    data = load_json(portal, None)
    if data:
        rows = data.get("connectors") if isinstance(data, dict) else data
        for r in rows or []:
            d = norm(r.get("description") or "")
            if d:
                out.setdefault(d, "connector")
                n += 1
    if mcp_dir.is_dir():
        try:
            import yaml  # noqa: PLC0415
        except ImportError:
            yaml = None
        for mf in sorted(mcp_dir.glob("*/manifest.yaml")):
            desc = None
            if yaml is not None:
                try:
                    meta = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
                    desc = meta.get("description")
                except Exception:  # noqa: BLE001
                    desc = None
            if not desc:
                m = re.search(r"^description:\s*(.+)$", mf.read_text(encoding="utf-8", errors="replace"), re.M)
                desc = m.group(1).strip().strip("'\"") if m else None
            if desc:
                out.setdefault(norm(desc), "mcp:" + mf.parent.name)
                n += 1
    return n


def harvest_ui_strings(i18n_dir: Path, out: dict) -> int:
    files = sorted(glob.glob(str(i18n_dir / "en*.ts")))
    pat = re.compile(r"'([^'\\\n]{5,240})'")
    n = 0
    for f in files:
        for m in pat.finditer(Path(f).read_text(encoding="utf-8", errors="replace")):
            s = m.group(1)
            if "{" in s or CJK.search(s) or not re.search(r"[A-Za-z]{3}", s):
                continue
            out.setdefault(s, "ui")
            n += 1
    return n


def collect(args) -> dict:
    src = {
        "installed_skills": HERMES_HOME / "skills",
        "optional_skills": Path(args.hermes_repo) / "optional-skills" if args.hermes_repo else None,
        "plugin_catalog": HERMES_HOME / "cache" / "plugin-catalog.json",
        "skills_feed": Path(args.feeds_dir) / "skills.json",
        "connectors": Path(args.feeds_dir) / "connectors.json",
        "mcp_dir": Path(args.hermes_repo) / "optional-mcps" if args.hermes_repo else None,
        "toolsets": Path(args.hermes_repo) / "hermes_cli" / "tools_config.py" if args.hermes_repo else None,
        "i18n": Path(args.hermes_repo) / "apps" / "desktop" / "src" / "i18n" if args.hermes_repo else None,
    }
    out: dict[str, str] = {}
    stats = {}
    if not args.no_local_skills and src["installed_skills"].is_dir():
        stats["your skills"] = harvest_skills(src["installed_skills"], out)
    if src["optional_skills"] and src["optional_skills"].is_dir():
        stats["optional skills"] = harvest_skills(src["optional_skills"], out)
    if src["plugin_catalog"].exists():
        stats["plugin catalog"] = harvest_catalog(src["plugin_catalog"], out, args.max_chars)
    if src["skills_feed"].exists():
        stats["skills feed"] = harvest_feed(src["skills_feed"], out, args.per_cat, args.max_chars)
    if src["toolsets"]:
        stats["toolsets"] = harvest_toolsets(src["toolsets"], out)
    if src["connectors"].exists() or (src["mcp_dir"] and src["mcp_dir"].is_dir()):
        stats["connectors"] = harvest_connectors(src["connectors"], src["mcp_dir"], out) if src["mcp_dir"] else harvest_connectors(src["connectors"], Path("/nonexistent"), out)
    if src["i18n"]:
        stats["ui strings"] = harvest_ui_strings(src["i18n"], out)

    clean = {}
    for text, source in out.items():
        t = norm(text)
        if len(t) < 5 or len(t) > args.max_chars or CJK.search(t):
            continue
        if not re.search(r"[A-Za-z]{3}", t):
            continue
        clean[t] = source
    print("collected " + ", ".join("%s=%d" % (k, v) for k, v in stats.items()) or "collected 0")
    print("unique strings: %d" % len(clean))
    return clean


# ------------------------------------------------------------------ translating
def chat(batch: list[str], api_url: str, model: str, key: str):
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": json.dumps(batch, ensure_ascii=False)},
            ],
            "temperature": 0,
            "max_tokens": min(8000, 600 + int(sum(len(x) for x in batch) * 0.9)),
            "stream": False,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"], data.get("usage", {})


def parse_array(text: str) -> list[str]:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    i, j = t.find("["), t.rfind("]")
    if i < 0 or j < 0:
        raise ValueError("no JSON array in reply")
    return json.loads(t[i : j + 1])


def batches(texts: list[str], max_items: int = 10, max_chars: int = 3400):
    batch, used = [], 0
    for t in texts:
        if batch and (len(batch) >= max_items or used + len(t) > max_chars):
            yield batch
            batch, used = [], 0
        batch.append(t)
        used += len(t)
    if batch:
        yield batch


def translate(missing: list[str], cache: dict, args, key: str) -> None:
    todo = list(batches(missing))
    total = len(todo)
    done = 0
    tokens = {"in": 0, "out": 0}
    t0 = time.time()

    def work(batch):
        for attempt in range(3):
            try:
                content, usage = chat(batch, API_URL, MODEL, key)
                got = parse_array(content)
                if len(got) != len(batch):
                    raise ValueError("length mismatch %d != %d" % (len(got), len(batch)))
                return dict(zip(batch, [norm(x) for x in got])), usage
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    print("  batch failed (left English): %s" % exc)
                    return {}, {}
                time.sleep(1.5 * (attempt + 1))

    with futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        for mapping, usage in pool.map(work, todo):
            with LOCK:
                for k, v in mapping.items():
                    if v and v != k:
                        cache[sha(k)] = v
                tokens["in"] += usage.get("prompt_tokens", 0) or 0
                tokens["out"] += usage.get("completion_tokens", 0) or 0
                done += 1
                if done % 20 == 0 or done == total:
                    save_json(CACHE_FILE, cache)
                    print("  translated %d/%d batches (%.0fs)" % (done, total, time.time() - t0))
    save_json(CACHE_FILE, cache)
    print("tokens: in %d / out %d" % (tokens["in"], tokens["out"]))


# --------------------------------------------------------------------- emitting
def build_plugin(dict_map: dict, out_path: Path) -> int:
    tpl = TEMPLATE.read_text(encoding="utf-8")
    marker = "/*__DICT__*/{}"
    if marker not in tpl:
        raise SystemExit("plugin.template.js lost its %s placeholder" % marker)
    payload = json.dumps(dict_map, ensure_ascii=False, indent=0, sort_keys=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(tpl.replace(marker, payload), encoding="utf-8", newline="\n")
    return out_path.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="no network: use core-dict + cache only")
    ap.add_argument("--online", action="store_true", help="download the public feeds first")
    ap.add_argument("--no-translate", action="store_true", help="never call the model; build from cache")
    ap.add_argument("--no-local-skills", action="store_true", help="skip YOUR installed skills (shareable build)")
    ap.add_argument("--dist", action="store_true", help="also write dist/plugin.js (repo-shipped build)")
    ap.add_argument("--out", default=str(HERMES_HOME / "desktop-plugins" / PLUGIN_ID / "plugin.js"))
    ap.add_argument("--feeds-dir", default=str(ROOT / "feeds"))
    ap.add_argument("--hermes-repo", default=os.environ.get("HERMES_REPO") or str(HERMES_HOME / "hermes-agent"),
                    help="path to the hermes-agent source tree (optional: unlocks toolset/UI strings)")
    ap.add_argument("--max-chars", type=int, default=2000)
    ap.add_argument("--per-cat", type=int, default=16, help="feed rows per category for the Discover shelves")
    ap.add_argument("--concurrency", type=int, default=8)
    args = ap.parse_args()

    feeds = Path(args.feeds_dir)
    if args.online and not args.offline:
        print("downloading public feeds ...")
        download(SKILLS_FEED, feeds / "skills.json")
        download(CONNECTORS_CATALOG, feeds / "connectors.json")

    core = load_json(CORE_DICT, {})
    cache = load_json(CACHE_FILE, {})

    if args.offline:
        dict_map = dict(core)
        print("offline build: %d entries from data/core-dict.json" % len(dict_map))
    else:
        items = collect(args)
        dict_map = {t: cache[sha(t)] for t in items if sha(t) in cache}
        missing = [t for t in items if sha(t) not in cache and t not in core]
        dict_map.update({t: core[t] for t in items if t in core})
        print("cache hit %d / missing %d" % (len(dict_map), len(missing)))
        if missing and not args.no_translate:
            print("translating %d strings with %s ..." % (len(missing), MODEL))
            translate(missing, cache, args, api_key())
            dict_map = {t: cache[sha(t)] for t in items if sha(t) in cache}
            dict_map.update({t: core[t] for t in items if t in core})
        coverage = 100.0 * len(dict_map) / max(1, len(items))
        print("coverage: %d/%d = %.1f%%" % (len(dict_map), len(items), coverage))

    size = build_plugin(dict_map, Path(args.out))
    print("wrote %s (%d entries, %.0f KB)" % (args.out, len(dict_map), size / 1024.0))
    if args.dist:
        dsize = build_plugin(dict_map, DIST_PLUGIN)
        print("wrote %s (%d entries, %.0f KB)" % (DIST_PLUGIN, len(dict_map), dsize / 1024.0))
    print("open the app: the plugin hot-loads in a few seconds; status bar shows a 「中」 chip.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
