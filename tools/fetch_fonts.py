"""Download the OFL Google Fonts used by the diary (cyrillic + latin subsets) for offline use."""
import re, urllib.request, pathlib
OUT = pathlib.Path(__file__).resolve().parent.parent / "fonts"
URL = ("https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=IBM+Plex+Mono:wght@400;500"
       "&family=Oswald:wght@500;600&family=Rubik:wght@500;800&family=Cormorant+Garamond:ital,wght@1,400;1,500&display=swap")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
css = urllib.request.urlopen(urllib.request.Request(URL, headers=UA)).read().decode()
blocks = re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, re.S)
out = []
for subset, block in blocks:
    if subset not in ("cyrillic", "latin"):
        continue
    fam = re.search(r"font-family: '([^']+)'", block).group(1).replace(" ", "")
    wt = re.search(r"font-weight: (\d+)", block).group(1)
    st = re.search(r"font-style: (\w+)", block).group(1)
    url = re.search(r"url\((https://[^)]+)\)", block).group(1)
    name = f"{fam}-{wt}{'i' if st == 'italic' else ''}-{subset}.woff2"
    (OUT / name).write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read())
    out.append(block.replace(url, name))
(OUT / "fonts.css").write_text("/* Google Fonts (SIL Open Font License), cyrillic + latin subsets */\n" + "\n".join(out) + "\n")
print(len(out), "faces")
