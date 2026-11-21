# DVN interactive garment visualisations

These GLB files are secondary, approximate 3D garment visualisations. Original
product photography remains the first gallery item and the product reference.
The viewer labels approximate fit, folds and unphotographed rear surfaces in
German and English. These are garments, not reconstructed people or fit scans.

## Geometry provenance

The base garment geometry was generated through the Higgsfield connector with
SAM 3 3D (`sam_3_3d`, `export_textured_glb: true`, seed 42), using the existing
DVN `assets/products/blue-sunshine.jpg` photograph. Job:
`34a2513d-267d-4587-886d-2fdb00a38a88` (2026-11-21).

Source result:
https://d8j0ntlcm91z4.cloudfront.net/user_3KQKDKor3OFgk9U0A6ZlXQtufXf/hf_20261121_185924_34a2513d-267d-4587-886d-2fdb00a38a88.glb

The generated mesh has 6,104 triangular faces and real depth. Its generated
textures repeated the front print onto the rear, so they were rejected. Blender
4.3.2 was used to replace those materials with projections from the original
DVN product photographs. Source silhouettes constrain UV coordinates so photo
backgrounds are not projected onto sleeves. The same approximate garment mesh
is reused for all five variants; it is not a verified garment pattern.

## Materials

| GLB | Front photo | Back |
| --- | --- | --- |
| blue-mirage-black.glb | blue-mirage-black.jpg | Neutral dark fabric; not photographed |
| blue-mirage-white.glb | blue-mirage-white.jpg | Neutral light fabric; not photographed |
| define-your-vision.glb | define-your-vision.jpg | Actual define-your-vision-back.jpg photograph |
| blue-sunshine.glb | blue-sunshine.jpg | Neutral dark fabric; not photographed |
| purple-sunshine.glb | purple-sunshine.jpg | Neutral light fabric; not photographed |

All referenced originals are under `assets/products/`. The photographic prints
are preserved rather than regenerated. Geometry, drape and unphotographed sides
are illustrative. Do not use these files to claim exact sizing or construction.

Each GLB embeds its mesh and JPEG textures. There are no remote texture,
compression-decoder or other runtime asset dependencies. Google model-viewer
4.0.0 is self-hosted in `assets/vendor/`; the module is imported only when the
customer selects the 3D gallery item. No-WebGL devices immediately retain the
original product photo. Network/model failures offer a retry and keep the photo.
The build validates every catalog product's GLB header, geometry and embedded
resources before deployment. All viewer assets remain behind the preview gate.
