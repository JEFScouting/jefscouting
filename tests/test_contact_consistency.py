import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from scripts.check_contact_consistency import (
    ContactParser,
    collect_contacts,
    invalid_contacts,
    main,
)


class ContactParserTests(unittest.TestCase):
    def parse(self, html: str) -> list[tuple[str, str]]:
        parser = ContactParser()
        parser.feed(html)
        return parser.contacts

    def test_extracts_contacts_from_public_metadata(self) -> None:
        contacts = self.parse(
            '<meta name="description" content="Call +1 786-722-6376 or email info@jefscouting.com">'
        )

        self.assertIn(("phone", "+1 786-722-6376"), contacts)
        self.assertIn(("email", "info@jefscouting.com"), contacts)

    def test_extracts_contacts_from_accessibility_and_data_attributes(self) -> None:
        contacts = self.parse(
            '<div aria-label="Call +1 305-890-0766" '
            'data-contact="hello@jefscouting.com"></div>'
        )

        self.assertIn(("phone", "+1 305-890-0766"), contacts)
        self.assertIn(("email", "hello@jefscouting.com"), contacts)

    def test_extracts_phones_with_typographic_separators(self) -> None:
        contacts = self.parse(
            "<p>+1 786–722–6376</p>"
            "<p>+1&nbsp;786&nbsp;722&nbsp;6376</p>"
            "<p>+1\u202f786\u2011722\u20146376</p>"
        )

        self.assertIn(("phone", "+1 786–722–6376"), contacts)
        self.assertIn(("phone", "+1\u00a0786\u00a0722\u00a06376"), contacts)
        self.assertIn(("phone", "+1\u202f786\u2011722\u20146376"), contacts)

    def test_ignores_form_placeholders(self) -> None:
        contacts = self.parse('<input type="email" placeholder="you@example.com">')

        self.assertNotIn(("email", "you@example.com"), contacts)

    def test_ignores_unrelated_numeric_data_attributes(self) -> None:
        contacts = self.parse('<div data-event-id="1234567890"></div>')

        self.assertNotIn(("phone", "1234567890"), contacts)

    def test_ignores_dates_and_ids_in_unrelated_metadata(self) -> None:
        contacts = self.parse(
            '<meta property="article:published_time" content="2026-08-30">'
            '<meta name="build" content="1234567890">'
        )

        self.assertNotIn(("phone", "2026-08-30"), contacts)
        self.assertNotIn(("phone", "1234567890"), contacts)

    def test_ignores_visible_iso_dates(self) -> None:
        contacts = self.parse('<time datetime="2026-08-30">2026-08-30</time>')

        self.assertNotIn(("phone", "2026-08-30"), contacts)

    def test_extracts_contact_links_from_supported_hosts_and_schemes(self) -> None:
        contacts = self.parse(
            '<a href="https://wa.me/13058900766">WhatsApp</a>'
            '<a href="https://whatsapp.com/send?phone=13058900766">WhatsApp</a>'
            '<a href="https://api.whatsapp.com/send?phone=13058900766">WhatsApp</a>'
            '<a href="tel:+13058900766">Phone</a>'
            '<a href="mailto:hello@jefscouting.com">Email</a>'
        )

        self.assertEqual(contacts.count(("phone", "13058900766")), 3)
        self.assertIn(("phone", "+13058900766"), contacts)
        self.assertIn(("email", "hello@jefscouting.com"), contacts)

    def test_ignores_whatsapp_lookalike_domains(self) -> None:
        contacts = self.parse(
            '<a href="https://fakewhatsapp.com/send?phone=17867226376">External</a>'
        )

        self.assertNotIn(("phone", "17867226376"), contacts)

    def test_ignores_numeric_values_in_javascript(self) -> None:
        contacts = self.parse("<script>const buildTimestamp = 1700000000000;</script>")

        self.assertNotIn(("phone", "1700000000000"), contacts)

    def test_extracts_contacts_from_json_ld(self) -> None:
        contacts = self.parse(
            '<script type="application/ld+json">'
            '{"telephone":"+1 305-890-0766","email":"hello@jefscouting.com"}'
            "</script>"
        )

        self.assertIn(("phone", "+1 305-890-0766"), contacts)
        self.assertIn(("email", "hello@jefscouting.com"), contacts)

    def test_resumes_phone_extraction_after_script(self) -> None:
        contacts = self.parse(
            "<script>const buildTimestamp = 1700000000000;</script>"
            "<p>Call +1 305-890-0766</p>"
        )

        self.assertNotIn(("phone", "1700000000000"), contacts)
        self.assertIn(("phone", "+1 305-890-0766"), contacts)


class RepositoryValidationTests(unittest.TestCase):
    def validate(self, pages: dict[str, str]) -> dict[str, dict[str, set[str]]]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = []
            for name, html in pages.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(html, encoding="utf-8")
                files.append(path)
            return invalid_contacts(collect_contacts(files, root))

    def test_accepts_only_approved_contacts(self) -> None:
        invalid = self.validate(
            {
                "index.html": (
                    '<a href="tel:+13058900766">Phone</a>'
                    '<a href="mailto:hello@jefscouting.com">Email</a>'
                )
            }
        )

        self.assertEqual(invalid, {})

    def test_rejects_uniformly_unapproved_contacts(self) -> None:
        invalid = self.validate(
            {
                "index.html": (
                    '<a href="tel:+17867226376">Phone</a>'
                    '<a href="mailto:info@jefscouting.com">Email</a>'
                ),
                "es/index.html": (
                    '<a href="tel:+17867226376">Teléfono</a>'
                    '<a href="mailto:info@jefscouting.com">Correo</a>'
                ),
            }
        )

        self.assertEqual(set(invalid["phone"]), {"+17867226376"})
        self.assertEqual(set(invalid["email"]), {"info@jefscouting.com"})

    def test_rejects_missing_and_conflicting_contacts(self) -> None:
        missing = self.validate(
            {"index.html": '<a href="tel:+13058900766">Phone</a>'}
        )
        conflicting = self.validate(
            {
                "index.html": (
                    '<a href="tel:+13058900766">Phone</a>'
                    '<a href="mailto:hello@jefscouting.com">Email</a>'
                    '<a href="mailto:info@jefscouting.com">Other email</a>'
                )
            }
        )

        self.assertEqual(missing["email"], {})
        self.assertEqual(
            set(conflicting["email"]),
            {"hello@jefscouting.com", "info@jefscouting.com"},
        )

    def test_main_reports_unapproved_values_and_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "legacy.html"
            page.write_text(
                '<a href="tel:+17867226376">Phone</a>'
                '<a href="mailto:info@jefscouting.com">Email</a>',
                encoding="utf-8",
            )
            output = io.StringIO()
            with (
                patch("scripts.check_contact_consistency.ROOT", root),
                patch(
                    "scripts.check_contact_consistency.public_html_files",
                    return_value=[page],
                ),
                redirect_stdout(output),
            ):
                exit_code = main()

        self.assertEqual(exit_code, 1)
        self.assertIn("+17867226376 (unapproved)", output.getvalue())
        self.assertIn("info@jefscouting.com (unapproved)", output.getvalue())
        self.assertIn("- legacy.html", output.getvalue())


if __name__ == "__main__":
    unittest.main()
