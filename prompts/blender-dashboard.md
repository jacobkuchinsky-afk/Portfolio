# Prompt: cockpit dashboard asset kit for the web portfolio

> Paste everything below the line into a Claude instance that has the Blender MCP connected.
> Attach `prompts/refs/panel-reference.webp`: the look to match (light-gray panel, black round gauges, screws).

---

You're making a small **kit of 3D cockpit parts** for my browser portfolio. It's a cinematic built with Three.js / React Three Fiber.

The bottom sixth of the screen is a plane's instrument panel, seen almost straight on, slightly from above. It has:
- three round engine gauges in a row, each with a toggle switch under it and a label plate under that
- an airspeed gauge on the far left and an altimeter on the far right

The visitor watches two switches flip on by themselves, then flips the middle one to take off. The panel width changes with screen size (wide on desktop, narrow on phones), so **don't build a finished panel**. Build the individual parts; my code places, clones and animates them.

The target look is **a real aircraft instrument panel**, like the attached reference photo. Matte paint, crisp black gauges, real metal switches and **slight** wear: well kept, not abandoned. It has to hold up at high resolution next to a detailed airliner model, so quality matters more than speed. Use `look` often, especially straight-on and slightly-from-above views, because that's how it's seen.

## Conventions (all parts)
- Real-world size in meters.
- **The front of every part faces Blender −Y**: Front view (numpad 1) looks straight at the faces. Up is +Z.
- Each part sits **at the world origin**, with its origin at the point described below. They can overlap in the file; my code clones them.
- Apply rotation/scale. Clean, quad-based topology with bevels on visible edges (no razor-sharp CG edges). Smooth shading with weighted normals or auto-smooth.
- **Textures:** only CC0 sources (Poly Haven, ambientCG) or procedural, baked to images. Max 1024×1024 per part, except the panel material at 2048×2048. glTF PBR: base color, normal, ORM.
- No text or logos baked into any texture. My code draws all numbers and labels.

## Parts to make (exact object names)

### 1. `ToggleSwitch`: the hero piece. Make it beautiful.
A classic aircraft **bat-handle toggle switch**, panel-mounted:
- **`ToggleSwitch_Base`**: the round **knurled mounting nut** (Ø ≈ 14 mm, real knurling in the geometry or normal map) on a thin **locking washer with a tab**, plus a short threaded **bushing** visible through the nut. Origin at the point where it meets the panel surface (Y = 0 is the panel face).
- **`ToggleSwitch_Lever`**: the **bat-handle lever**, about 22 mm long, tapering from a slim neck to a rounded paddle tip. **Polished chrome**, with a slightly flattened tip so it catches a highlight.
  - Separate object, child of the base.
  - **Origin exactly at the pivot**, inside the bushing.
  - Modeled pointing straight out of the panel (along −Y). My code tilts it about **X**: −25° = up (ON), +25° = down (OFF).
  - It must look right at both angles and not clip into the nut.
- Materials:
  - nut and bushing: satin nickel-steel, with a touch of wear on the knurl peaks
  - lever: chrome, roughness ~0.08–0.12
  - washer: darker steel
- Budget ≤ 8,000 triangles total.

### 2. `Gauge`: round instrument, like the reference photo
- **`Gauge_Bezel`**: black instrument case/bezel for a standard 3⅛" instrument. Overall about **82 mm across**, with a slightly raised rim and a subtle chamfer. The front plate is a rounded square with **4 mounting screws** at the corners (use `PanelScrew` below, or model them in). Satin black paint; very slight edge wear where a thumb would rub (lighter gray showing through, subtle).
- **`Gauge_Face`**: a flat disc, Ø 70 mm, recessed ~6 mm behind the rim. **Planar UVs 0→1 across the disc** (center at 0.5, 0.5), because my code paints the dial markings onto it. Plain matte black material.
- **`Gauge_Needle`**: a white needle with a black counterweight tail, 30 mm long, slightly raised above the face. **Origin at the center of the dial**, pointing straight up (+Z) at rest. My code rotates it about **Y**. Matte white paint.
- **`Gauge_Cap`**: small black center cap over the needle hub.
- **`Gauge_Glass`**: the cover glass, a very slightly domed disc just inside the rim. Glass material: transmission or alpha ~0.15, roughness ~0.05, so it catches reflections.
- Origin of the parent `Gauge` empty: center of the face, on the panel surface plane.
- Budget ≤ 6,000 triangles total.

### 3. `LabelPlate`
A small engraved placard screwed below each switch: **about 46 × 12 mm**, 1 mm thick, slightly rounded corners. Black anodized with lightly brushed metal edges, two tiny screws. The front face gets **planar UVs 0→1** because my code puts the text (MY / GO / PORTFOLIO) on it. Origin at its center, on the panel surface.

### 4. `PanelScrew`
Phillips pan-head screw, Ø 6 mm, slightly scratched slot, satin steel. Origin at its center on the panel surface. ≤ 300 triangles.

### 5. Panel surface material, as textures (not a mesh)
A **seamless, tileable** PBR material for the panel face. Bake it onto a 1 m × 0.25 m plane named `PanelSample` so I can see it, and also export the images.
- **Base:** light-to-medium gray **matte crinkle/textured paint**, like the reference (around `#9a9fa3`, roughness ~0.75). It must not be flat; there's a fine paint texture in the normal map.
- **Wear (slight!):** faint scuffs and a few hairline scratches, very light darkening in random patches, tiny chips revealing darker primer. **Spread evenly enough to tile** without obvious repeats. No rust, no grime streaks, no big stains.
- Export: `panel_basecolor.jpg`, `panel_normal.png` (OpenGL convention, Y+), `panel_orm.jpg` (R = AO, G = roughness, B = metalness), all 2048², tileable.

### 6. `PanelEdge` (optional, nice to have)
A tileable rail for the top edge of the panel: a rounded **anti-glare lip / glareshield** edge, 1 m long and ~30 mm tall, in a slightly darker matte gray with a soft rubbery black top. It has to tile end to end along X.

## Export
- One glTF Binary with all parts: `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/public/models/dashboard-kit.glb`
- Panel textures: `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/public/textures/panel/`
- Settings: +Y up, apply modifiers, include custom properties, no cameras, no lights, no Draco.
- Save the working file to `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/assets-src/dashboard-kit.blend`.
- If you use any texture that isn't CC0, add it to `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/CREDITS.md`.

## Done means
Report back with:
1. A **beauty render of a test layout**: a `PanelSample` strip with one `Gauge` above one `ToggleSwitch` above one `LabelPlate`, a few `PanelScrew`s, warm low key light from the upper left, soft fill. Show it twice: lever OFF (down) and ON (up).
2. A **close-up of the toggle switch** at a 3/4 angle.
3. A straight-on render of the gauge with the needle at rest.
4. A list of every object: name, triangle count, origin location, parent.
5. The texture list with resolutions, and the `.glb` file size.
6. Anything you couldn't do cleanly.

## Don'ts
- No text, numbers or logos baked into textures.
- No heavy grunge: wear stays subtle.
- Don't merge the lever into the base, or the needle into the face.
- No Draco compression; no cameras or lights in the export.
