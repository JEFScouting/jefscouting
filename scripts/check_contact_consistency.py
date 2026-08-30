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
PHONE_RE = re.compile(
    r"(?<!\w)(?:\+?\d[\d(). \t\u00a0\u2011\u2013\u2014\u202f-]{7,}\d)(?!\w)"
)
EXPECTED_CONTACTS = {
    "phone": "+13058900766",
    "email": "hello@jefscouting.com",
}
PUBLIC_CONTACT_ATTRIBUTES = {
    "aria-label",
    "data-contact",
    "data-email",
    "data-phone",
    "data-whatsapp",
    "title",
}
PHONE_METADATA_FIELDS = {
    "contact",
    "description",
    "og:description",
    "phone",
    "telephone",
    "twitter:description",
}
INLINE_TEXT_TAGS = {
    "abbr",
    "b",
    "bdi",
    "bdo",
    "cite",
    "code",
    "data",
    "del",
    "dfn",
    "em",
    "i",
    "ins",
    "kbd",
    "label",
    "mark",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr",
}


class ContactParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.contacts: list[tuple[str, str]] = []
        self._include_raw_text_phone: bool | None = None
        self._visible_text_tail = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag not in INLINE_TEXT_TAGS:
            self._visible_text_tail = ""
        if tag == "script":
            script_type = attributes.get("type", "").partition(";")[0].strip().lower()
            self._include_raw_text_phone = script_type == "application/ld+json"
        elif tag == "style":
            self._include_raw_text_phone = False

        href = attributes.get("href")
        if href:
            parsed = urlparse(unquote(href))
            hostname = (parsed.hostname or "").lower()
            if parsed.scheme == "mailto":
                self.contacts.append(("email", parsed.path))
            elif parsed.scheme == "tel":
                self.contacts.append(("phone", parsed.path))
            elif hostname in {"wa.me", "www.wa.me"}:
                self.contacts.append(("phone", parsed.path.strip("/").split("/")[0]))
            elif hostname == "whatsapp.com" or hostname.endswith(".whatsapp.com"):
                phone = parse_qs(parsed.query).get("phone", [])
                if phone:
                    self.contacts.append(("phone", phone[0]))

        for name, value in attrs:
            if value and name in PUBLIC_CONTACT_ATTRIBUTES:
                self._extract_text_contacts(value)
            elif value and name == "content":
                metadata_field = next(
                    (
                        attributes.get(field, "").lower()
                        for field in ("name", "property", "itemprop")
                        if attributes.get(field)
                    ),
                    "",
                )
                self._extract_text_contacts(
                    value,
                    include_phone=tag == "meta" and metadata_field in PHONE_METADATA_FIELDS,
                )

    def handle_data(self, data: str) -> None:
        if self._include_raw_text_phone is None:
            combined = self._visible_text_tail + data
            self._extract_text_contacts(combined)
            self._visible_text_tail = combined[-128:]
        else:
            self._extract_text_contacts(
                data,
                include_phone=self._include_raw_text_phone,
            )

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self._include_raw_text_phone = None
        if tag not in INLINE_TEXT_TAGS:
            self._visible_text_tail = ""

    def _extract_text_contacts(self, data: str, *, include_phone: bool = True) -> None:
        self.contacts.extend(("email", value) for value in EMAIL_RE.findall(data))
        if include_phone:
            self.contacts.extend(
                ("phone", value)
                for value in PHONE_RE.findall(data)
                if 10 <= len(re.sub(r"\D", "", value)) <= 15
            )


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


def collect_contacts(
    files: list[Path], root: Path
) -> dict[str, dict[str, set[str]]]:
    found: dict[str, dict[str, set[str]]] = {
        "phone": defaultdict(set),
        "email": defaultdict(set),
    }

    for path in files:
        parser = ContactParser()
        parser.feed(path.read_text(encoding="utf-8"))
        for kind, raw_value in parser.contacts:
            value = normalize(kind, raw_value)
            if value:
                found[kind][value].add(str(path.relative_to(root)))

    return found


def invalid_contacts(
    found: dict[str, dict[str, set[str]]],
) -> dict[str, dict[str, set[str]]]:
    return {
        kind: values
        for kind, values in found.items()
        if set(values) != {EXPECTED_CONTACTS[kind]}
    }


def main() -> int:
    files = public_html_files()
    found = collect_contacts(files, ROOT)

    invalid = invalid_contacts(found)
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
