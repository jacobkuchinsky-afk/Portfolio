# Tile PNGs into one contact sheet. Usage: blender -b -P montage.py -- <out.png> <cols> <in1.png> <in2.png> ...
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
out, cols, files = a[0], int(a[1]), a[2:]
imgs = []
for f in files:
    im = bpy.data.images.load(f); w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4); imgs.append(px)
h = max(i.shape[0] for i in imgs); w = max(i.shape[1] for i in imgs)
rows = (len(imgs) + cols - 1) // cols
sheet = np.ones((rows * h, cols * w, 4), dtype=np.float32)
for k, px in enumerate(imgs):
    r, c = divmod(k, cols); r = rows - 1 - r      # Blender pixel rows start at the bottom
    sheet[r * h:r * h + px.shape[0], c * w:c * w + px.shape[1]] = px
o = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
o.pixels.foreach_set(sheet.ravel()); o.filepath_raw = out; o.file_format = 'PNG'; o.save()
