# Adventuring items

Entries added from the [D&D System Reference Document v5.2.1 equipment](https://github.com/azemoning/omni-5e/blob/main/data/raw/5.2.1/equipment.md). The source republishes SRD content under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/); the item descriptions here are adapted from that source.

Pack entries remain in `assets/data/packs`. Weapons and armor are stored in their own directories.

## Wearables (`wearables/`)

Items with a `"slot"` are worn in that slot on the character sheet: `gloves`, `boots`, `helmet`,
`necklace` or `ring` (two ring slots). `"isDefault": true` — ordinary gear, offered in the builder;
`false` — a named (magic) item. A named one's `"modifiers"` apply while it is worn — the same vocabulary
as conditions (`frontend/src/rules/modifiers.js`): `{ "kind": "ac", "op": "add", "value": 1 }`,
`{ "kind": "save", "value": 1 }`, `{ "kind": "check", "skill": "sleight", "value": 5 }`,
`{ "kind": "immunity", "value": "poisoned" }`, `{ "kind": "note", "note": "…" }`…
