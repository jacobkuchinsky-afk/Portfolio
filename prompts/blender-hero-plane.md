# Prompt: prepare the hero trijet for the web portfolio

> Paste everything below the line into a Claude instance that has the Blender MCP connected.
> Attach these two images with it:
> - `prompts/refs/md11-shape-reference.png`: shape/proportion reference only (ignore its KLM livery)
> - `prompts/refs/source-model-dc10-preview.jpg`: the source model as it looks today

---

You're preparing the **hero 3D model** for my browser portfolio. It's an interactive cinematic built with Three.js / React Three Fiber. Scene 1 shows this plane **in side profile** on a runway. It powers up its three engines, taxis, takes off, tucks its landing gear and climbs. The plane is the high-detail foreground element and the background is cartoony, so the plane has to look clean and premium up close. It also has to stay light enough to load fast in a browser.

Work in Blender through the MCP tools. Look at your work often (`look`), especially the side profile, because that's the main camera angle.

## Source model
- **"DC-10-30 FedEx" by mudkipz321**: https://sketchfab.com/3d-models/dc-10-30-fedex-b71df28e7cf1464dadd04b6f0e076c77
- License: **CC BY 4.0**. Modifying it is allowed, but credit is required (see Credits below).
- I'll download the glTF from Sketchfab myself and unzip it to `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/assets-src/dc10-source/`. Import from there. If the folder is empty, stop and tell me.
- If the MCP addon says it's outdated, the fix is `uvx mcp-for-blender install-addon`, then restart Blender and Start MCP Server. Ask me before running it.

## Goal
A clean, **unbranded "old cargo liner"** trijet in the spirit of an MD-11F / DC-10-30F. It should be exported as one `.glb` with **separately named moving parts**, so my code can spin the engine fans, retract the gear and toggle the lights.

## Tasks

### 1. Scale, orientation, origin
- Blender units in meters. Real-world size: DC-10-30 is about **55.5 m long** with a **50.4 m wingspan**. Scale to match.
- **Nose points +X** (the exporter keeps +X as +X in Three.js). Wings span along Y, up is +Z.
- Put the origin of the root empty `Trijet` **on the ground plane (Z=0), under the midpoint of the main gear**, so the tires sit exactly on Z=0 with the gear down.
- Parent every part under the `Trijet` empty. Apply rotation/scale on all meshes (location can stay where the pivots need it).

### 2. Remove ALL branding
Delete or paint over **every** logo, word, flag and registration:
- "FedEx", "Express", "The World On Time", tail logos, engine-nacelle logos, flags, registration numbers, and any small airline text.

Nothing trademarked may remain. Check every texture image too, not just materials.

### 3. New livery: clean generic cargo liner
Replace the livery with simple PBR materials (or a cleanly re-painted base color texture if the model relies on one):
- **Upper fuselage + tail**: warm off-white paint (≈ `#F2F1EC`), roughness ~0.35, light clearcoat if available.
- **Belly / lower fuselage**: mid-cool gray (≈ `#8E959C`), split along a clean, straight horizontal line like the reference photo.
- **One thin cheatline** between them: deep navy (≈ `#1E2A44`), about 0.35 m tall, running nose to tail.
- **Tail fin**: leave plain off-white. I'll add my own logo later, so keep its UVs clean and non-overlapping.
- **Wings / stabilizers**: light gray (≈ `#C9CDD1`), with **bare polished aluminum leading edges** (metallic 1, roughness ~0.25).
- **Engine nacelles**: off-white with **polished metal inlet lips**.
- **Fans/spinners**: dark titanium (metallic 1, roughness ~0.4).
- **Cockpit windows**: near-black glossy glass. Cargo version, so **no passenger window row**. Remove or paint over cabin windows; keep the cockpit windows and the outlines of the doors.
- **Tires**: rubber black, roughness 0.9. Gear struts: satin gray metal, oleo pistons chrome.
- Keep any panel-line / rivet normal detail; it sells the "high-res" look. If there is none, bake subtle panel lines into a normal map (optional).

### 4. Separate and name the moving parts
Use **exactly these object names**, because my code looks them up by name. Set each object's origin at its real pivot.

| Object name | What | Pivot / axis |
|---|---|---|
| `Airframe` | Fuselage, wings, stabilizers, nacelle shells (everything static) | anywhere |
| `Fan_L` | Left wing engine front fan + spinner | center of fan, rotates around X |
| `Fan_R` | Right wing engine fan + spinner | center of fan, rotates around X |
| `Fan_C` | Tail (center) engine fan + spinner | center of fan, rotates around X |
| `Gear_Nose` | Nose gear leg + wheels | upper hinge point |
| `Gear_Main_L` / `Gear_Main_R` | Main gear legs + wheels | upper hinge points |
| `Gear_Center` | DC-10-30 centerline main gear (if modeled) | upper hinge point |
| `GearDoor_*` | Each gear door, named after its gear | its hinge line |
| `Light_Nav_L` | Red left wingtip light (small mesh, emissive red) | — |
| `Light_Nav_R` | Green right wingtip light (emissive green) | — |
| `Light_Strobe_Tail` | White tail strobe (emissive white) | — |
| `Light_Beacon_Top` / `Light_Beacon_Bottom` | Red anti-collision beacons on top/bottom of fuselage | — |
| `Light_Landing` | Landing light on nose gear / wing root (emissive warm white) | — |

- Emissive lights: give each its **own material** named the same as the object (e.g. `Light_Nav_L`). Set emission strength to 0 in Blender; the code drives it.
- Nice to have, if they separate cleanly: `Flap_L`, `Flap_R`, `Elevator`, `Rudder` with origins on their hinge lines.

### 5. Landing gear animation
The source model has a gear animation. If it survives import, keep it as **one action named `GearRetract`**: frame 0 = gear fully down + doors closed after extension, last frame = gear fully up + doors closed. Doors open mid-way, as on a real jet. Bake it to the named objects above.

If the original rig is messy, rebuild it as simple keyframed rotations on those objects; that's fine.

### 6. Make it look more MD-11 (optional, only if it stays clean)
The reference photo is an MD-11. If you can do it without ruining the topology, add small **MD-11-style winglets** (upper + small lower fin) to both wingtips, matching the light-gray wing material. If it looks bolted-on or bad, skip it and tell me.

### 7. Web budget
- **≤ 120,000 triangles total.** Delete anything never visible from outside: interior, cabin, cockpit insides beyond what shows through the windshield, hidden internal faces.
- Decimate only small/hidden parts. **Keep the silhouette smooth:** fuselage, nacelle lips and wing leading edges must not look faceted in the side view.
- Textures: **max 2048×2048**, PBR (base color, normal, and roughness/metallic/AO packed as glTF ORM). Bake ambient occlusion into the ORM so it looks grounded without real-time shadows.
- Combine materials where possible (target ≤ 12 materials, not counting the `Light_*` ones).

### 8. Export
- glTF Binary → `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/public/models/trijet.glb`
- Settings: +Y up, apply modifiers, include animations, include custom properties, **no cameras, no lights, no Draco**. I compress it later with gltf-transform.
- Save the working file as `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/assets-src/trijet.blend`.

### 9. Credits
Create `/Users/jacobkuchinsky/Desktop/Coding/Portfolio/CREDITS.md` (or append to it) with:
> "DC-10-30 FedEx" (https://sketchfab.com/3d-models/dc-10-30-fedex-b71df28e7cf1464dadd04b6f0e076c77) by mudkipz321, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: all airline branding removed, repainted, parts separated, optimized for web.

## Done means
Report back with:
1. A **side-profile render** (camera on the −Y side looking +Y, nose pointing right) and one **front 3/4 render**, gear down, in material preview or EEVEE.
2. A **frame strip of `GearRetract`** (`look` mode=frames).
3. A printed list of every object: name, triangle count, origin location, parent.
4. Total triangle count, texture list with resolutions, and the `.glb` file size.
5. Confirmation that no logos or text remain, plus anything you skipped or couldn't do cleanly.

## Don'ts
- Don't leave any airline/brand/registration markings.
- Don't change the overall silhouette (except the optional winglets).
- Don't merge moving parts into `Airframe`.
- Don't use Draco compression or embed cameras/lights in the export.
