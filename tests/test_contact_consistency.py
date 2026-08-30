import unittest

from scripts.check_contact_consistency import ContactParser


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


if __name__ == "__main__":
    unittest.main()
