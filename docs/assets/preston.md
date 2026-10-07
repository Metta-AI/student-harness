# Preston: gentle arcane presence

Original friendly forest-wisp artwork generated with [FLUX.2 Pro on fal.ai](https://fal.ai/models/fal-ai/flux-2-pro/api).

Source: `public/preston/preston-kindred-wisp.png` (1024 × 1024).
Web asset: `public/preston/preston-kindred-wisp.webp` (768 × 768, quality 88).

The palette is pale jade, pearl, and warm honey against sage. Rounded ribbons surround a small seed of light. There is no face or armor in any animation state.

`components/partner/preston-orb.tsx` uses continuously evolving noise to deform the silhouette and internal currents, with a gentle floating motion and soft independent light filaments. The previous mask texture is no longer loaded. Busy state increases movement slightly.

Rendering caps at 30 frames per second and a 512-pixel canvas dimension. It stops while hidden or offscreen, respects pause and reduced-motion settings, and resumes without advancing the clock during pauses. The illustration remains visible if WebGL is unavailable, the context is lost, or texture loading fails. The mobile launcher uses the same artwork.

## Generation prompt

Preston, a friendly young magical presence that feels safe, curious, gentle and worth nurturing. A floating soft rounded orb of translucent pearl, pale jade and warm honey light, made from a few broad flowing silk-like ribbons of mist that loosely cradle a small warm irregular seed of light. Premium stylized painterly 3D fantasy strategy-game creature art, beautiful softly sculpted volumes, delicate opalescent materials, tactile soft edges. A benevolent forest wisp, still discovering its shape, with a slightly asymmetric rounded silhouette and two little curled wisps like unfurling leaves. The interior has calm curved currents and generous open space. Quiet, emotionally warm and attentive. Entirely abstract, NO heart symbols, heart shapes, faces, masks, eyes, mouth, skull, armor, metal, spikes, lightning, aggressive vortex, black holes, hard shards or tangled filigree. Very restrained golden firefly specks. Gentle soft daylight with warm rim light, low contrast pastel jade and cream palette. Centered circular silhouette occupying the middle 65 percent of a square canvas, generous breathing room on all sides. Uniform pale sage background #e4eadb, no horizon or environment, no ground or cast shadow, no text, letters, UI or border. Clearly readable at small avatar size. No enclosing sphere or shell, no solid glass surface. The space between mist ribbons remains open. A living cloud of soft light, an ethereal round puff with feathered edges that dissolve into air. No big cartoon curls, no actual leaves, no heart symbols.
