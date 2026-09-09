# Estimates — element coverage audit (Phase 4, 9 Sep 2026)

Brief §11.3 families mapped to what the Estimates app actually offers.
Legend: **calc** = purpose-built calculator; **mod** = composable modifier
available on the element; **generic** = the universal measured item
(L×W×D or manual volume, optional formwork/reo, notes); **gap** = nothing
yet. New schemas are added only where the measurement basis is different.

| Family (brief) | Item | Coverage | Where |
|---|---|---|---|
| Earthworks | bulk excavation, footing trenches, slab trim, backfill | calc (generic, kind excavation) + every footing/beam/pad/tank digs its own trench | Bulk Excavation, Footing Excavation, Slab Trim, Backfill |
| | overbreak, rock, dewatering, cart-away, imported fill | mod | **Site & Placement Allowances** on every element (Phase 4); spoil lines on every dig |
| | cut/fill | generic | Bulk Excavation with notes |
| Piling | bored, driven/precast, screw, micropile; socket, underream, cut-off | calc | Bored Pier / Piles (`pileType`, `socketDepth`, `underream`, `cutoff`) |
| | CFA, casing, testing | generic / mod | pile type "bored" with notes; casing as Additional row; testing via allowances |
| | integrated / standalone caps | calc | pier's Pile Cap tab; Pile Cap element |
| Foundations | strip, pad, raft, waffle, stump, anchor block, equipment base, ground/capping beams | calc | Strip, Pad, Raft, Waffle, Stump, Anchor Block, Equipment Pad, Ground/Capping Beam |
| | combined / strap footings | calc (pad with L≠W) + beam | Pad Footing + Ground Beam, linked by starters |
| Ground slabs | slab-on-ground, industrial, hardstand, pavement, driveway/path, pits | calc | Slab family, Sump Pit, Lift Pit |
| | thickenings, joints, dowels, set-downs, steps | mod | slab: edge thickening, wall thickening, internal beams, joints, dowels, step-downs |
| Suspended | one/two-way slab, flat slab/drop panels, RC roof, ramp, balcony, band/edge/transfer beams | calc + mod | Suspended Slab (`drops`, edge beams), RC Roof, Ramp, Suspended Beam |
| | PT allowance | mod | Additional rows / allowances (no PT calculator — engineering item) |
| Vertical | rect/circular columns, walls, cores, retaining, shotcrete | calc | Column, Concrete Wall / Core, Retaining Wall, Shotcrete Wall |
| | nibs, blade walls, pilasters, corbels | calc (wall/column dims) / generic | narrow Wall or Column; Corbel via generic |
| Precast / tilt-up | panels, stitches, grout, embeds, bracing | generic (kind precast) — **added Phase 4** | Precast / Tilt-up Panel; Precast Stitch / Grout / Embeds (proprietary engineering stays outside) |
| Stairs | flights, landings, waist, treads/risers, starters | calc | Concrete Stair |
| Water-retaining | pools, tanks, lift pits, sumps, planters | calc | Tank/Box family |
| | channels, bunds | calc / generic | Kerb / Spoon Drain; generic |
| Civil / bridge | headwalls, culverts, barriers, plinths, thrust blocks, drainage structures | generic (kind civil) — **added Phase 4**, shown only for civil/bridge/water profiles | Civil / Bridge group |
| Alterations | drill/dowel, repair, crack injection | calc (generic, kind alteration) | Drill & Dowel, Concrete Repair, Crack Repair |
| | sawcut, demolition/breakout, scabble, make-good | generic — **added Phase 4** | Sawcut / Core Drill, Demolition / Breakout, Scabble / Surface Prep, Make Good |
| Temporary works | shoring, propping | generic (kind temporary) | Temporary Shoring, Temporary Propping |
| | falsework, access, crane/pump allowances | generic — **added Phase 4** + mod | Falsework, Access / Scaffold, Crane / Pump Set-up; placement method on every element |

## Modifiers present on every element (brief §11.2)

openings/penetrations (slabs, walls) · set-downs/steps (slabs, beams, walls) ·
edge thickening / edge beams / internal ribs / drop panels (slabs) · sketched
plan outline and section profile · construction/movement joints, waterstops ·
starters, dowels, ligatures, extra connections (counted once at source) ·
cast-ins (pads) · blinding, membrane, insulation (all) · formwork faces and
system (all) · excavation oversize, overbreak, rock, dewatering, backfill,
spoil (all, Phase 4) · placement method and pump/crane hours (all, Phase 4) ·
temporary propping and testing allowances (all, Phase 4) · waste, laps,
stock lengths (project + per element) · manual quantity line with reason
(Additional rows, manual overrides with reason).

## Still missing (candidates for a genuinely different schema)

- Post-tensioning (tendons, anchorages, stressing) — engineering item; an
  allowance only.
- Precast panel schedules by panel mark with lifting inserts — generic today.
- Chamfers/splays as automatic deductions — record via Additional rows.
- Per-field change history — provenance records "entered" only.
