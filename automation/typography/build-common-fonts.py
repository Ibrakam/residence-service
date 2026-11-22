#!/usr/bin/env python3
"""Produce smaller common-language fonts; preserve complete-font fallbacks."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
import hashlib,json,shutil,re
ROOT=Path(__file__).resolve().parent
VERSION='20261122-1'
RANGES=[(0x0000,0x017F),(0x02BB,0x02BC),(0x0300,0x036F),(0x0400,0x052F),(0x2000,0x206F),(0x20A0,0x20CF),(0x2100,0x214F),(0x2190,0x21FF),(0x2212,0x2212),(0x25A0,0x25FF)]
UNICODES={cp for a,b in RANGES for cp in range(a,b+1)}
CSS_RANGE=', '.join('U+%04X-%04X'%(a,b) if a!=b else 'U+%04X'%a for a,b in RANGES)
FACES=[('montserrat.woff2','TenCorp Montserrat','normal','100 900'),('helvetica-neue-400.woff2','TenCorp Helvetica Neue','normal','400'),('helvetica-neue-500.woff2','TenCorp Helvetica Neue','normal','500'),('helvetica-neue-700.woff2','TenCorp Helvetica Neue','normal','700'),('helvetica-neue-italic.woff2','TenCorp Helvetica Neue','italic','400')]
out=ROOT/'releases'/VERSION/'assets';out.mkdir(parents=True,exist_ok=True)
for old in out.glob('*-common-*.woff2'):old.unlink()
manifest={'schemaVersion':1,'version':VERSION,'unicodeRange':CSS_RANGE,'legacyStylesheetSHA256':hashlib.sha256((ROOT/'site-fonts.css').read_bytes()).hexdigest(),'fonts':[]}
def unicode_css(values):
    values=sorted(values); spans=[]
    if not values:return ''
    start=previous=values[0]
    for cp in values[1:]:
        if cp==previous+1:previous=cp;continue
        spans.append((start,previous));start=previous=cp
    spans.append((start,previous))
    return ', '.join('U+%04X-%04X'%(a,b) if a!=b else 'U+%04X'%a for a,b in spans)
new_faces=[]
fallback_ranges={}

for name,family,style,weight in FACES:
    source=ROOT/'assets'/name
    if style=='italic':
        shutil.copy2(source,out/name)
        manifest['fonts'].append(dict(original=name,originalBytes=source.stat().st_size,originalSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),common=None,reason='Preserve exact original italic outlines'))
        continue
    original=TTFont(source,recalcTimestamp=False)
    font=TTFont(source,recalcTimestamp=False)
    options=subset.Options();options.layout_features=['*'];options.name_IDs=['*'];options.name_legacy=True;options.name_languages=['*'];options.glyph_names=True;options.notdef_outline=True;options.recommended_glyphs=True
    worker=subset.Subsetter(options=options);worker.populate(unicodes=UNICODES);worker.subset(font)
    font.flavor='woff2';temp=out/(name+'.pending');font.save(temp)
    digest=hashlib.sha256(temp.read_bytes()).hexdigest()
    target=out/(source.stem+'-common-'+digest[:12]+'.woff2');temp.replace(target)
    rebuilt=TTFont(target)
    expected=set(original.getBestCmap())&UNICODES
    assert expected<=set(rebuilt.getBestCmap()),name
    oldglyphs,newglyphs=original.getGlyphSet(),rebuilt.getGlyphSet()
    for cp in expected:
        oldname,newname=original.getBestCmap()[cp],rebuilt.getBestCmap()[cp]
        assert original['hmtx'][oldname]==rebuilt['hmtx'][newname],(name,cp,'metrics')
        a,b=RecordingPen(),RecordingPen();oldglyphs[oldname].draw(a);newglyphs[newname].draw(b)
        assert a.value==b.value,(name,cp,'outline')
    if 'fvar' in original:
        axes=lambda f:[(v.axisTag,v.minValue,v.defaultValue,v.maxValue) for v in f['fvar'].axes]
        assert axes(original)==axes(rebuilt)
        for cp in expected:
            left=original['gvar'].variations.get(original.getBestCmap()[cp],[])
            right=rebuilt['gvar'].variations.get(rebuilt.getBestCmap()[cp],[])
            assert left==right,(name,cp,'variation coordinates')
    fallback_ranges[name]=unicode_css(set(original.getBestCmap())-UNICODES)
    # Complete originals stay available for characters outside the common ranges.
    shutil.copy2(source,out/name)
    manifest['fonts'].append(dict(original=name,originalBytes=source.stat().st_size,originalSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),common=target.name,commonBytes=target.stat().st_size,commonSHA256=digest,verifiedCharacters=len(expected)))
    new_faces.append("@font-face {\n  font-family: '%s';\n  src: url('./%s') format('woff2');\n  font-style: %s;\n  font-weight: %s;\n  font-display: swap;\n  unicode-range: %s;\n}\n"%(family,target.name,style,weight,CSS_RANGE))
css=(ROOT/'site-fonts.css').read_text()
def complete_face(match):
    block=match.group(0)
    for name, ranges in fallback_ranges.items():
        if "url('./"+name+"')" in block:
            assert ranges
            return block[:-1]+'  unicode-range: '+ranges+';\n}'
    return block
css=re.sub(r'@font-face\s*\{[^}]+\}',complete_face,css)

marker='html:not(:has(.dormon-theme))'
assert marker in css
at=css.index(marker)
css=css[:at]+'/* Common RU/UZ/EN ranges take precedence; original faces above cover all other glyphs. */\n'+''.join(new_faces)+'\n'+css[at:]
(out/'site-fonts.css').write_text(css)
shutil.copy2(ROOT/'assets/OFL-Montserrat.txt',out/'OFL-Montserrat.txt')
manifest['stylesheetSHA256']=hashlib.sha256(css.encode()).hexdigest()
(ROOT/'releases'/VERSION/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest))
