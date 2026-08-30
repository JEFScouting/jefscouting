#!/usr/bin/env python3
"""Require the approved public phone number and email in deployable HTML."""

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
EXPECTED_CONTACTS = {
    "phone": "+13058900766",
    "email": "hello@jefscouting.com",
}
PUBLIC_CONTACT_ATTRIBUTES = {"aria-label", "content", "title"}


class ContactParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.contacts: list[tuple[str, str]] = []

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        href = dict(attrs).get("href")
        if href:
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

        for name, value in attrs:
            if value and (name in PUBLIC_CONTACT_ATTRIBUTES or name.startswith("data-")):
                self._extract_text_contacts(value)

    def handle_data(self, data: str) -> None:
        self._extract_text_contacts(data)

    def _extract_text_contacts(self, data: str) -> None:
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

    invalid = {
        kind: values
        for kind, values in found.items()
        if set(values) != {EXPECTED_CONTACTS[kind]}
    }
    if not invalid:
        print(
            f"Contact consistency check passed across {len(files)} public HTML files: "
            "only approved values were found."
        )
        return 0

    print("Contact consistency check failed: public contact values are missing or unapproved.")
    for kind, values in invalid.items():
        print(f"\n{kind.title()} (approved: {EXPECTED_CONTACTS[kind]}):")
        if not values:
            print("  No value found.")
        else:
            for value, paths in sorted(values.items()):
                label = "approved" if value == EXPECTED_CONTACTS[kind] else "unapproved"
                print(f"  {value} ({label})")
                for path in sorted(paths):
                    print(f"    - {path}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
