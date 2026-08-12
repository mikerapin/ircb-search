#!/usr/bin/env python3
"""Read a stated panel out of an episode description.

Shared by `export_data.py` (public feed) and `fetch_patreon.py` (Secret Feed) so the two
cannot drift, because a name that appears in one and not the other splits a person in two.

Why a labelled line rather than the prose: reading a panel out of prose has a ceiling no
parser clears. "IRCB's Best of 2022" names all ten regulars because it lists whose picks were
discussed; "While Mike is in London, Tia, Paul, and Kara..." names someone demonstrably
absent. Both parse as a panel and both are wrong.

Only `Panel:` and `Guest:` are people who were on the episode. The show's credits block also
carries Producer, Post Production, Prooflistener and Editor — on a recent episode the
prooflistener is Paul Jaissle, who was not on it, and the editor is Zander Riggs, who is crew.
Matching those would put four extra names on every episode from here on.
"""
import re

ROLES = ("panel", "host", "guest")
LINE = re.compile(rf"^\s*(?:{'|'.join(ROLES)})s?\s*:\s*(.+?)\s*$", re.I | re.M)

# Only block-level tags end a line. The labels are written `<strong>Panel:</strong> Names`, so
# turning every tag into a newline splits the label off its own names and captures nothing.
BLOCK = re.compile(r"<\s*(?:br|/p|/li|/div|/h[1-6]|/tr|/ul|/ol)\b[^>]*>", re.I)
TAG = re.compile(r"<[^>]+>")
NOT_A_NAME = {"tbd", "n/a", "na", "none", "-", "?"}


def stated_people(summary: str) -> list[str]:
    """Names from `Panel:` / `Guest:` lines, or [] when the description states none."""
    text = BLOCK.sub("\n", summary or "")
    text = TAG.sub("", text)
    for entity, char in (("&amp;", "&"), ("&nbsp;", " "), ("&#39;", "'"), ("&quot;", '"')):
        text = text.replace(entity, char)

    out = []
    for names in LINE.findall(text):
        for name in re.split(r",|\band\b|&|/", names):
            name = name.strip(" .;:·-–—\t")
            if name and name.lower() not in NOT_A_NAME and name not in out:
                out.append(name)
    return out


def _selfcheck() -> None:
    real = ('<p><strong>Panel:</strong> Mike Rapin, Brian Murray<br><strong>Guest:</strong> '
            'Matt Burbridge<br><strong>Producer</strong>: Mike Rapin<br><strong>Post '
            'Production &amp; Social Media</strong>: Mike Rapin, Daniel Martinez<br>'
            '<strong>Prooflistener</strong>: Paul Jaissle<br><strong>Editor</strong>: '
            'Zander Riggs</p>')
    got = stated_people(real)
    assert got == ["Mike Rapin", "Brian Murray", "Matt Burbridge"], got
    assert "Paul Jaissle" not in got, "the prooflistener is crew, not panel"
    assert "Zander Riggs" not in got, "the editor is crew, not panel"

    assert stated_people("<p>Panel: Mike Rapin &amp; Kait Lamphere</p>") == [
        "Mike Rapin", "Kait Lamphere"]
    assert stated_people("<p>Hosts: Kara Szamborski and Tia Vasiliou</p>") == [
        "Kara Szamborski", "Tia Vasiliou"]
    assert stated_people("<p>No line here. Directed by Joe Johnston</p>") == []
    assert stated_people("<p>Panel: TBD</p>") == []
    assert stated_people("") == []
    print("panel_line: all checks pass")


if __name__ == "__main__":
    _selfcheck()
