#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rebuilds the iWork test files from invented text. Run it by hand on a Mac with Pages, Numbers and Keynote:

    python3 -I web/fixtures/iwork/make-fixtures.py

Each app saves a real file, then this keeps only the parts that hold the document, so no theme image, preview or
style sheet of Apple's lands in this repository. Close the apps yourself afterwards; an imported file can leave a
dialog open. The password-protected form is not committed, because a pattern scan cannot read encrypted parts:
iwork.test.ts builds that case itself.
"""
import os
import re
import subprocess
import tempfile
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = re.compile(r"^Index/(?!DocumentStylesheet|TemplateSlide|ThemePreview|Metadata|ViewState|AnnotationAuthorStorage|DocumentMetadata).*\.iwa$")
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
FILLER = "Every word of this sample is made up and refers to nothing real at all."


def word_part(tag, body):
    return f'<?xml version="1.0"?><w:{tag} {W}>{body}</w:{tag}>'


def run_text(text):
    return f'<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'


def write_word_source(path):
    """A Word file with what Pages keeps from one: a header, a footer, a footnote, a comment, a tracked change, a table, page breaks and astral characters."""
    author = 'w:author="Sample Author" w:date="2026-01-02T03:04:05Z"'
    page_break = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    body = "".join([
        run_text("DOETITLE Invented Agreement"),
        '<w:p><w:r><w:t xml:space="preserve">DOEFOOTREF sentence with a note</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t xml:space="preserve"> after it.</w:t></w:r></w:p>',
        '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>DOECOMMENTED words here</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
        f'<w:p><w:r><w:t xml:space="preserve">DOEKEPT \U0001F600\U0001D49C stays </w:t></w:r><w:del w:id="5" {author}><w:r><w:delText>DOEDELETED</w:delText></w:r></w:del><w:ins w:id="6" {author}><w:r><w:t>DOEINSERTED</w:t></w:r></w:ins></w:p>',
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>DOETABLEA</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>DOETABLEB</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        run_text(f"DOEPAGEONE end of the first page. {FILLER}"), page_break,
        run_text(f"DOEPAGETWO start of the second page. {FILLER}"), page_break,
        run_text(f"DOEPAGETHREE start of the third page. {FILLER}"),
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/></w:sectPr>',
    ])
    parts = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
        "_rels/.rels": f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/_rels/document.xml.rels": f'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/footnotes" Target="footnotes.xml"/><Relationship Id="rId2" Type="{REL}/comments" Target="comments.xml"/><Relationship Id="rId10" Type="{REL}/header" Target="header1.xml"/><Relationship Id="rId11" Type="{REL}/footer" Target="footer1.xml"/></Relationships>',
        "word/document.xml": word_part("document", f"<w:body>{body}</w:body>"),
        "word/footnotes.xml": word_part("footnotes", '<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> DOEFOOTNOTE invented note text</w:t></w:r></w:p></w:footnote>'),
        "word/comments.xml": word_part("comments", f'<w:comment w:id="0" {author} w:initials="SA"><w:p><w:r><w:t>DOECOMMENTTEXT invented remark</w:t></w:r></w:p></w:comment>'),
        "word/header1.xml": word_part("hdr", "<w:p><w:r><w:t>DOEHEADER invented header</w:t></w:r></w:p>"),
        "word/footer1.xml": word_part("ftr", "<w:p><w:r><w:t>DOEFOOTER invented footer</w:t></w:r></w:p>"),
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in parts.items():
            archive.writestr(name, text)


def osascript(source, *args):
    subprocess.run(["osascript", "-e", source, *args], check=True, timeout=240)


def save_front(app, path):
    osascript(f'on run argv\ntell application id "com.apple.{app}"\nsave front document in POSIX file (item 1 of argv)\nclose front document saving no\nend tell\nend run', path)


NOTES = """on run argv
tell application id "com.apple.Pages"
set d to make new document
tell d
set body text to "DOEBODYONE an invented first paragraph." & return & "DOEBODYTWO an invented second paragraph."
tell page 1
make new text item with properties {object text:"DOETEXTBOX floating note"}
set t to make new table with properties {row count:2, column count:2}
tell t
set value of cell 1 of row 1 to "DOECELLA"
set value of cell 2 of row 1 to "DOECELLB"
set value of cell 1 of row 2 to 1234.5
end tell
end tell
end tell
save d in POSIX file (item 1 of argv)
close d saving no
end tell
end run"""

LEDGER = """on run argv
tell application id "com.apple.Numbers"
set d to make new document
tell d
tell sheet 1
set name to "DOESHEETONE"
tell table 1
set name to "DOETABLEONE"
set row count to 8
set column count to 6
set value of cell "A1" to "Label"
set value of cell "B1" to "Amount"
set value of cell "A2" to "DOESTRING"
set value of cell "B2" to 1234.5
set format of cell "B2" to currency
set value of cell "A3" to "DOEPERCENT"
set value of cell "B3" to 0.25
set format of cell "B3" to percent
set value of cell "A4" to "DOEDATE"
set value of cell "B4" to date "Tuesday, March 3, 2026 at 12:00:00 AM"
set value of cell "A5" to "DOEFORMULA"
set value of cell "B5" to "=B2*2"
set value of cell "A6" to "DOECHECK"
set format of cell "B6" to checkbox
set value of cell "B6" to true
set value of cell "A7" to "DOEPLAIN"
set value of cell "B7" to 42
set value of cell "C2" to "DOEMERGED"
merge range "C2:D3"
set value of cell "F8" to "DOEFARCELL"
end tell
set t2 to make new table with properties {name:"DOETABLETWO", row count:2, column count:2}
tell t2
set value of cell "A1" to "DOESECONDTABLE"
end tell
end tell
set s2 to make new sheet with properties {name:"DOESHEETTWO"}
tell s2
tell table 1
set value of cell "A1" to "DOESECONDSHEET"
end tell
end tell
end tell
save d in POSIX file (item 1 of argv)
close d saving no
end tell
end run"""

DECK = """on run argv
tell application id "com.apple.Keynote"
set d to make new document
tell d
set s1 to slide 1
set s2 to make new slide with properties {base layout:master slide "Title & Bullets"}
set s3 to make new slide with properties {base layout:master slide "Title & Bullets"}
set s4 to make new slide with properties {base layout:master slide "Title & Bullets"}
set object text of default title item of s1 to "DOESLIDEFIRST title"
set object text of default title item of s2 to "DOESLIDESECOND title"
set object text of default body item of s2 to "DOEBULLET one" & return & "DOEBULLET two"
set presenter notes of s2 to "DOENOTES invented speaker note"
set object text of default title item of s3 to "DOESLIDETHIRD title"
tell s3
set t to make new table with properties {row count:2, column count:2}
tell t
set value of cell 1 of row 1 to "DOESLIDETABLE"
end tell
make new text item with properties {object text:"DOESLIDETEXTBOX"}
end tell
set object text of default title item of s4 to "DOESLIDESKIPPED title"
set skipped of s4 to true
move s3 to before s2
end tell
save d in POSIX file (item 1 of argv)
close d saving no
end tell
end run"""

# Built cell by cell, not imported: a table imported from a CSV keeps that file's full path inside the document.
ROWS = """on run argv
tell application id "com.apple.Numbers"
set d to make new document
tell d
tell sheet 1
tell table 1
set name to "DOEROWS"
set header column count to 0
set column count to 3
set row count to 301
set value of cell 1 of row 1 to "Row"
set value of cell 2 of row 1 to "Label"
set value of cell 3 of row 1 to "Amount"
repeat with n from 1 to 300
set value of cell 1 of row (n + 1) to n
set value of cell 2 of row (n + 1) to "DOEROW" & n
set value of cell 3 of row (n + 1) to n * 1.5
end repeat
end tell
end tell
end tell
save d in POSIX file (item 1 of argv)
close d saving no
end tell
end run"""


def trim(source, name):
    """Keeps the document's parts, stored, with a fixed date, so the same content gives the same bytes."""
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(os.path.join(HERE, name), "w", zipfile.ZIP_STORED) as out:
        for info in sorted(archive.infolist(), key=lambda item: item.filename):
            if KEEP.match(info.filename):
                out.writestr(zipfile.ZipInfo(info.filename, (2026, 1, 1, 0, 0, 0)), archive.read(info.filename))


def main():
    with tempfile.TemporaryDirectory(prefix="iwork-fixtures-") as work:
        made = lambda name: os.path.join(os.path.realpath(work), name)
        write_word_source(made("source.docx"))
        osascript(NOTES, made("notes.pages"))
        osascript(LEDGER, made("ledger.numbers"))
        osascript(DECK, made("deck.key"))
        osascript(ROWS, made("rows.numbers"))
        # By bundle id, as the scripts above: the app is "Pages" or "Pages Creator Studio" depending on the Mac (#231).
        subprocess.run(["open", "-b", "com.apple.Pages", made("source.docx")], check=True)
        time.sleep(7)
        save_front("Pages", made("agreement.pages"))
        for name in ["agreement.pages", "notes.pages", "ledger.numbers", "rows.numbers", "deck.key"]:
            trim(made(name), name)


if __name__ == "__main__":
    main()
