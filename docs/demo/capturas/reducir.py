# Reduce las capturas a 1600 px y 256 colores. Requiere Pillow.
# Uso: python docs/demo/capturas/reducir.py .verification/capturas/png docs/images
import os
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for name in sorted(os.listdir(src)):
    if not name.endswith('.png'):
        continue
    image = Image.open(os.path.join(src, name)).convert('RGB')
    image = image.resize((1600, round(image.height * 1600 / image.width)), Image.LANCZOS)
    image = image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    image.save(os.path.join(dst, name), optimize=True)
