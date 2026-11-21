# DVN product and lookbook assets

Prepared 21 November 2026 for the DVN storefront redesign. The catalog uses the owner's original product artwork recovered from the former Shopify store. The lookbook uses newly generated adult-model styling concepts and must remain visibly described as AI-generated styling visualizations, not customers, reviews, testimonials, or photographs of a real shoot.

## Original product images

Shopify origin: `https://cdn.shopify.com/s/files/1/0947/7102/0157/files/`.

The namespace was recovered from the archived Blue Mirage Black product page at `https://web.archive.org/web/20260913id_/https://dvnclothing.com/products/dvn-clothing-blue-mirage-black-tee?variant=58279730282877`. Filenames were also cross-checked against cached former product pages and the owner's supplied screenshots. Each downloaded image was visually checked against those screenshots.

| Local asset | Original filename | Dimensions | Processing |
| --- | --- | --- | --- |
| `assets/products/blue-mirage-black.jpg` | `ChatGPTImage12.Juni2026_23_18_04.png` | 1361 × 1156 | Original CDN JPEG bytes; extension corrected to match MIME type. |
| `assets/products/blue-mirage-white.jpg` | `ChatGPTImage7.Juni2026_02_08_03.png` | 1363 × 1154 | Original CDN JPEG bytes; extension corrected to match MIME type. |
| `assets/products/define-your-vision.jpg` | `dvn-define-your-vision-tee-produktbild.png` | 832 × 832 | Adobe JPEG export at source dimensions. |
| `assets/products/define-your-vision-back.jpg` | `dvn-define-your-vision-tee-r-ckseite.png` | 832 × 832 | Adobe JPEG export at source dimensions. |
| `assets/products/blue-sunshine.jpg` | `ChatGPTImage3.Juni2026_16_12_49.png` | 1390 × 1132 | Original CDN JPEG bytes; extension corrected to match MIME type. |
| `assets/products/purple-sunshine.jpg` | `ChatGPTImage2.Juni2026_22_50_45.png` | 1389 × 1132 | Original CDN JPEG bytes; extension corrected to match MIME type. |

No product artwork was regenerated, replaced, recolored, or cropped for the catalog. The Define Your Vision source is 832 pixels square; resizing would not add detail. Its back image is an original separate product image.

## Archived product metadata

All five product JSON records were recovered from the 13 September 2026 archived pages. These records establish the former catalog's listed options and prices; they do not establish current stock or current fulfilment terms.

| Product | Listed sizes | Listed price | Compare-at price | Supported description details |
| --- | --- | --- | --- | --- |
| Blue Mirage Black Tee | S, M, L | €20.00 | €40.00 | Description blank. |
| Blue Mirage Tee | S, M, L | €20.00 | €40.00 | Generic copy includes an inconsistent color claim; not used as a fabric or fit specification. |
| Define Your Vision Tee | S, M, L | €22.00 | €45.00 | Description blank. |
| Blue Sunshine Tee | S, M, L | €20.00 | €40.00 | Black/blue; regular fit; unisex. |
| Purple Sunshine Tee | S, M, L | €20.00 | €40.00 | White/purple; regular fit; unisex. |

Verified archived page handles under `https://dvnclothing.com/products/`:

- `dvn-clothing-blue-mirage-black-tee` — source snapshot used above.
- `dvn-clothing-blue-mirage-tee` — archive timestamp `20260913234005`.
- `dvn-clothing-blue-sunshine-tee` — archive timestamp `20260913234005`.
- `dvn-clothing-define-your-vision-tee` — archive timestamp `20260913234003`.
- `dvn-clothing-purple-sunshine-tee` — archive timestamp `20260913234003`.

No record listed XL. No fiber composition, fabric weight, model measurements, or model-worn size was inferred from the imagery.

## AI styling concepts

| Local asset | Exact garment reference | Model concept |
| --- | --- | --- |
| `assets/lookbook/blue-mirage-black.jpg` | Original Blue Mirage Black product image | Adult man, dark hair, concrete wall. |
| `assets/lookbook/blue-mirage-white.jpg` | Original Blue Mirage White product image | Adult woman, brown hair, stone terrace. |
| `assets/lookbook/blue-sunshine.jpg` | Original Blue Sunshine product image | Adult man, textured black hair, pale stone architecture. |
| `assets/lookbook/purple-sunshine.jpg` | Original Purple Sunshine product image | Adult woman, tied-back black hair, gray daylight studio. |

All four are 1080 × 1440 JPEG files, approximately 140–171 KB each. They were generated with the built-in image generation tool using the individual original product image as a reference, then proportionally resized and exported in Adobe. No generated image is a substitute for a product specification, size demonstration, customer endorsement, or real photograph.

Higgsfield was tried first, as requested. Its four submissions all returned `Requires basic plan or higher`; no job was submitted and no upgrade was purchased. The available image generation tool supplied the four completed visuals.

### Generation prompt

Shared prompt for each image:

> Use case: photorealistic-natural. Asset type: vertical 3:4 fashion editorial lookbook photo for the user's DVN brand storefront. Use the attached product photograph as the EXACT garment reference. Dress the adult model in precisely this shirt; preserve the shirt color, shape, print position, original lettering, graphic colors and exact artwork, only conform naturally to fabric folds and the model's body. Do not redesign or reinterpret the shirt's print. Keep entire chest print unobstructed and readable. Head to upper-thigh composition, full face and hair visible. High-quality real fashion camera look with subtle skin pores, realistic hands and natural fabric texture. Soft overcast daylight, restrained slightly desaturated palette, quiet contemporary European editorial mood. One model only, single full-bleed image, no collage, no page UI, no extra words, no watermarks, no other brands, no jacket or jewelry covering print. These are concept visuals, not actual customers.

Individual additions:

- Blue Mirage Black: One adult man, age 25, short dark brown hair, light olive skin, calm candid expression, black straight loose trousers. Pose front-facing with hands relaxed beside him against a minimalist warm gray European concrete wall.
- Blue Mirage White: One adult woman, age 25, shoulder-length dark brown hair, natural makeup, calm candid expression, stone-colored loose trousers. Front-facing relaxed pose on a quiet pale stone urban terrace.
- Blue Sunshine: One adult man, age 27, medium-brown skin, short textured black hair, calm natural expression, dark straight trousers. Front-facing pose against pale architectural stone with a soft shadow.
- Purple Sunshine: One adult woman, age 26, tied-back black hair, natural makeup, calm assured expression, dark wide-leg trousers. Front-facing pose in a minimalist gray daylight studio by a concrete wall.

The shirt graphics and colors were visually checked against the product references. Styling images remain conceptual; they do not establish garment measurements or model-worn sizes.
