#!/usr/bin/env python3
"""Fail when public HTML advertises conflicting phone numbers or emails."""

from __future__ import annotations

import re
import subprocess
import sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d(). -]{7,}\d)(?!\w)")


class ContactParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.contacts: list[tuple[str, str]] = []

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        href = dict(attrs).get("href")
        if not href:
            return

        parsed = urlparse(unquote(href))
        if parsed.scheme == "mailto":
            self.contacts.append(("email", parsed.path))
        elif parsed.scheme == "tel":
            self.contacts.append(("phone", parsed.path))
        elif parsed.netloc.lower() in {"wa.me", "www.wa.me"}:
            self.contacts.append(("phone", parsed.path.strip("/").split("/")[0]))
        elif parsed.netloc.lower().endswith("whatsapp.com"):
            phone = parse_qs(parsed.query).get("phone", [])
            if phone:
                self.contacts.append(("phone", phone[0]))

    def handle_data(self, data: str) -> None:
        self.contacts.extend(("email", value) for value in EMAIL_RE.findall(data))
        self.contacts.extend(("phone", value) for value in PHONE_RE.findall(data))


def public_html_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "*.html"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [ROOT / name for name in result.stdout.splitlines()]


def normalize(kind: str, value: str) -> str | None:
    if kind == "email":
        return value.strip().lower()
    digits = re.sub(r"\D", "", value)
    return f"+{digits}" if digits else None


def main() -> int:
    found: dict[str, dict[str, set[str]]] = {
        "phone": defaultdict(set),
        "email": defaultdict(set),
    }
    files = public_html_files()

    for path in files:
        parser = ContactParser()
        parser.feed(path.read_text(encoding="utf-8"))
        for kind, raw_value in parser.contacts:
            value = normalize(kind, raw_value)
            if value:
                found[kind][value].add(str(path.relative_to(ROOT)))

    conflicts = {kind: values for kind, values in found.items() if len(values) > 1}
    if not conflicts:
        print(f"Contact consistency check passed across {len(files)} public HTML files.")
        return 0

    print("Contact consistency check failed: conflicting public contact values found.")
    for kind, values in conflicts.items():
        print(f"\n{kind.title()} values:")
        for value, paths in sorted(values.items()):
            print(f"  {value}")
            for path in sorted(paths):
                print(f"    - {path}")
    print("\nA business owner must decide which values are authoritative; this check does not choose one.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
