"""Rebuild the offline display subset from a supplied Source Han Serif Bold OTF."""
import argparse
from pathlib import Path
from fontTools import subset

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='Path to the original OFL Source Han Serif Bold OTF')
source = parser.parse_args().source
if not source.is_file():
    parser.error('The source font file does not exist')
root = Path(__file__).resolve().parent.parent
target = root / 'assets' / 'fonts'
target.mkdir(parents=True, exist_ok=True)
text = ''.join(path.read_text(encoding='utf-8') for path in (root / 'src').glob('*.mjs'))
options = subset.Options()
options.flavor = 'woff2'
options.name_IDs = ['*']
font = subset.load_font(str(source), options)
builder = subset.Subsetter(options=options)
builder.populate(text=text + ''.join(chr(i) for i in range(32, 127)))
builder.subset(font)
for record in list(font['name'].names):
    replacement = {1:'Tideweave Serif',2:'Bold',3:'TideweaveSerif-Bold-Subset',4:'Tideweave Serif Bold',6:'TideweaveSerif-Bold',16:'Tideweave Serif',17:'Bold',21:'Tideweave Serif',22:'Bold'}.get(record.nameID)
    if replacement:
        font['name'].setName(replacement,record.nameID,record.platformID,record.platEncID,record.langID)
subset.save_font(font, str(target / 'TideweaveSerif-Bold.woff2'), options)
print('Offline display font:', (target / 'TideweaveSerif-Bold.woff2').stat().st_size, 'bytes')
