#!/usr/bin/env bash
# How the real sample files in this folder were made (once, by hand). The tests never run this: they only
# read the files, and tests/lib/media.cjs pins each file's SHA-256, so a remade (different) file must have
# its new SHA-256 put there - on purpose. (Running it again makes the same bytes, except clip.ogg and
# movie.webm: their Ogg / WebM streams get a random serial number each time.)
#
# Needs ffmpeg (with libmp3lame, libopus, libx264, libvpx), Python 3 with Pillow and reportlab, and runs in
# this folder:  cd tests/fixtures/media && bash make-media.sh
set -euo pipefail
cd "$(dirname "$0")"
F="ffmpeg -hide_banner -loglevel error -y -fflags +bitexact -flags:v +bitexact -flags:a +bitexact"

# Audio clips: MP3 2 s, WAV 1 s, Ogg Opus 1.5 s, M4A (AAC) 1 s.
$F -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" -ac 1 -c:a libmp3lame -b:a 64k -id3v2_version 3 -write_xing 1 voice.mp3
$F -f lavfi -i "sine=frequency=660:sample_rate=8000:duration=1" -ac 1 -c:a pcm_s16le tone.wav
$F -f lavfi -i "sine=frequency=550:sample_rate=48000:duration=1.5" -ac 1 -c:a libopus -b:a 32k clip.ogg
$F -f lavfi -i "sine=frequency=330:sample_rate=44100:duration=1" -ac 1 -c:a aac -b:a 64k clip.m4a

# Video clips, 2 s, 160x120, with sound: MP4 (H.264 + AAC) and WebM (VP9 + Opus).
$F -f lavfi -i "testsrc=size=160x120:rate=15:duration=2" -f lavfi -i "sine=frequency=500:sample_rate=44100:duration=2" \
   -c:v libx264 -pix_fmt yuv420p -preset veryslow -crf 30 -c:a aac -b:a 48k -shortest -movflags +faststart movie.mp4
$F -f lavfi -i "testsrc2=size=160x120:rate=15:duration=2" -f lavfi -i "sine=frequency=700:sample_rate=48000:duration=2" \
   -c:v libvpx-vp9 -b:v 60k -c:a libopus -b:a 32k -shortest movie.webm

# Pictures: JPEG 320x240, PNG 200x150 with transparency, WebP 160x120, animated GIF 64x64 (3 frames).
python3 -I - <<'EOF'
from PIL import Image, ImageDraw
import math
def scene(w, h, mode="RGB"):
    im = Image.new(mode, (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        for x in range(w):
            r = int(128 + 127 * math.sin(x / 17.0))
            g = int(128 + 127 * math.sin(y / 11.0 + 1))
            b = int(128 + 127 * math.sin((x + y) / 23.0 + 2))
            im.putpixel((x, y), (r, g, b) if mode == "RGB" else (r, g, b, 255 if (x // 20 + y // 20) % 2 else 140))
    d.ellipse((w * .25, h * .2, w * .7, h * .8), outline=(255, 255, 255), width=3)
    d.rectangle((w * .6, h * .1, w * .9, h * .4), fill=(20, 40, 200))
    d.text((8, h - 18), "eNotes test %dx%d" % (w, h), fill=(0, 0, 0))
    return im
scene(320, 240).save("photo.jpg", "JPEG", quality=85)
scene(200, 150, "RGBA").save("picture.png", "PNG", optimize=True)
scene(160, 120).save("pic.webp", "WEBP", quality=80)
frames = []
for i in range(3):
    f = Image.new("P", (64, 64))
    f.putpalette([0, 0, 0, 255, 0, 0, 0, 200, 0, 0, 0, 255] + [0] * 756)
    ImageDraw.Draw(f).rectangle((8 + i * 12, 8 + i * 12, 32 + i * 12, 32 + i * 12), fill=1 + i)
    frames.append(f)
frames[0].save("anim.gif", save_all=True, append_images=frames[1:], duration=200, loop=0)
EOF

# A two-page PDF with text and a picture (page text uncompressed, so a test can read it).
python3 -I - <<'EOF'
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
c = canvas.Canvas("doc.pdf", pagesize=A5, invariant=1, pageCompression=0)
c.setTitle("eNotes test document"); c.setAuthor("eNotes tests")
c.setFont("Helvetica-Bold", 16); c.drawString(40, 520, "eNotes test PDF - page 1")
c.setFont("Helvetica", 11); c.drawString(40, 495, "A real two-page PDF with a picture: account 12345, PIN 0000.")
c.drawImage(ImageReader("photo.jpg"), 40, 300, width=160, height=120)
c.showPage()
c.setFont("Helvetica-Bold", 16); c.drawString(40, 520, "eNotes test PDF - page 2")
c.rect(40, 300, 200, 150, fill=0)
c.showPage(); c.save()
EOF

# A UTF-8 text file (CRLF and LF lines, a tab, no newline at the end), a web page (with a script the app
# must never run) and 70000 bytes of (seeded) random binary data.
printf 'An uploaded text file \xe2\x9c\x93 caf\xc3\xa9 \xe2\x80\x94 \xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e\r\nline 2 with a tab\there\nlast line without newline' > notes.txt
cat > page.html <<'EOF'
<!doctype html>
<html><head><meta charset="utf-8"><title>Uploaded page</title></head>
<body><h1>An uploaded web page ✓</h1><p>with <b>bold</b>, a <a href="https://example.com/">link</a> and an image:</p>
<img alt="dot" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
<script>document.title = "should never run in the app";</script></body></html>
EOF
python3 -I -c "import random; r = random.Random(1234); open('data.bin', 'wb').write(bytes(r.randrange(256) for _ in range(70000)))"
sha256sum ./*.jpg ./*.png ./*.gif ./*.webp ./*.mp3 ./*.wav ./*.ogg ./*.m4a ./*.mp4 ./*.webm ./*.pdf ./*.txt ./*.html ./*.bin
