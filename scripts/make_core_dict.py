#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regenerate data/core-dict.json — the dictionary this repo ships in dist/plugin.js.

"Core" means everything from public sources (the official skill catalog, the public
plugin/skill feeds, the connector catalog, the upstream UI strings) and NOTHING from the
machine it runs on: your own installed skills are excluded, so the shipped build carries
no personal data.

    python scripts/make_core_dict.py --hermes-repo ~/.hermes/hermes-agent --feeds-dir ./feeds
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("zhbuild", ROOT / "scripts" / "build_zh_ui.py")
zh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zh)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hermes-repo", default=str(zh.HERMES_HOME / "hermes-agent"))
    ap.add_argument("--feeds-dir", default=str(ROOT / "feeds"))
    ap.add_argument("--max-chars", type=int, default=2000)
    ap.add_argument("--per-cat", type=int, default=16)
    args = ap.parse_args()

    ns = argparse.Namespace(
        no_local_skills=True,
        hermes_repo=args.hermes_repo,
        feeds_dir=args.feeds_dir,
        max_chars=args.max_chars,
        per_cat=args.per_cat,
    )
    items = zh.collect(ns)
    cache = zh.load_json(zh.CACHE_FILE, {})
    core = {t: cache[zh.sha(t)] for t in items if zh.sha(t) in cache}
    zh.save_json(zh.CORE_DICT, core)
    print("wrote %s: %d entries (of %d collected)" % (zh.CORE_DICT, len(core), len(items)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
