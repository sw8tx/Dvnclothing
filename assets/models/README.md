# DVN interactive on-body visualisations

All five GLBs contain a complete, textured 3D person wearing the corresponding
shirt. The person and garment rotate together; this is actual mesh geometry,
not a spinning photograph or standalone floating tee. Original product photos
remain gallery item 1; the on-body viewer is item 2.

## Source and reproducibility

Higgsfield SAM 3 3D (`sam_3_3d`, textured GLB, seed 42) reconstructed the person
from the existing `assets/lookbook/blue-mirage-black.jpg` AI styling image.
Job: `665a4029-dd33-48ae-96b7-77dab3a4103e`, 2026-11-21.

Source GLB:
https://d8j0ntlcm91z4.cloudfront.net/user_3KQKDKor3OFgk9U0A6ZlXQtufXf/hf_20261121_194819_665a4029-dd33-48ae-96b7-77dab3a4103e.glb

Rebuild with Blender 4.3.2:

```sh
blender -b --python scripts/models/build-worn.py -- /path/to/person-source.glb
```

Set `DVN_RENDER_DIR` to an existing directory to render front, side and back
checks. `DVN_ONLY` optionally restricts the build to one product ID.

The same reconstructed person and approximate garment geometry are reused for
all five products. Skin, hair, trousers and footwear retain the generated body
texture. Garment faces receive the corresponding original product photograph;
the Define Your Vision rear uses its separate original rear photograph. Other
backs are plain illustrative fabric. A geometric hem cut and local subdivision
keep material boundaries clean. Each self-contained GLB embeds its JPEG textures.
The nominal 1.8m model height is an illustrative scale, not a measurement or size
recommendation. The figure, drape, hidden surfaces and footwear are generated.

This is not a scanned person or a verified fit simulation. The viewer explicitly
labels the approximation in German and English. Actual product photography is
the reference for print, colour, fit and construction.

## Viewer and deployment

Google model-viewer 4.0.0 is self-hosted in `assets/vendor/`. The viewer loads only
when selected. Drag, touch, arrow buttons, keyboard controls and front reset
rotate the whole figure. Unsupported devices and failed requests retain the
original product photo and provide an appropriate message/retry.

The build validates every catalog GLB, real geometry and embedded resources.
Viewer assets remain password-protected, with private/no-store responses.
CSP permits only the pinned model-viewer shadow stylesheet hash and local blob
connections for embedded texture decoding. No external runtime calls, eval or
arbitrary inline styles/scripts are introduced.
