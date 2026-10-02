# Monsters (bestiary seeds)

One JSON file per monster, grouped in folders by creature type (the folder is
only for convenience — the `type` field is what counts). Loaded into the
`monsters` table on first start (see `seed.go`, `bestiary.go`).

The app is a companion to a real table: stat blocks are shown to read and to
count with, nothing is rolled. Numbers are given as "average (dice)".

Stat blocks here are original write-ups in the style of the D&D 2024 rules;
descriptions are our own words.

The `srd-*` entries are adapted from the [D&D System Reference Document v5.2.1](https://github.com/adkinn/srd-5.2.1/blob/main/data/monsters.json), provided under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). The source dataset attributes Wizards of the Coast LLC and republishes the material via Open5e.

## Fields

List/filter fields (become table columns):

| field | example | note |
|---|---|---|
| `id` | `"zombie"` | unique |
| `name` | `"Zombie"` | |
| `type` | `"undead"` | one of the 14 creature types: aberration, beast, celestial, construct, dragon, elemental, fey, fiend, giant, humanoid, monstrosity, ooze, plant, undead |
| `size` | `"medium"` | tiny, small, medium, large, huge, gargantuan |
| `alignment` | `"neutral evil"` | |
| `cr` | `0.25` | Challenge Rating 0–30 (fractions as 0.125 / 0.25 / 0.5) |
| `xp` | `50` | optional — taken from the CR table if missing |
| `ac`, `hp` | `8`, `15` | AC and average Hit Points |
| `habitats` | `["forest"]` | forest, grassland, hill, mountain, arctic, swamp, coastal, desert, underdark, urban, planar, underwater, any |
| `image` | `"/img/…"` | optional |

Stat block (stored in `data_json`):

```jsonc
{
  "subtypes": ["goblinoid"],
  "acNote": "leather armor, shield",
  "hpFormula": "3d6",
  "initiative": 2,                                   // modifier
  "speed": { "walk": 30, "fly": 60, "hover": true }, // walk, fly, swim, climb, burrow
  "abilities": { "str": 8, "dex": 15, "con": 10, "int": 10, "wis": 8, "cha": 8 },
  "saves":  { "dex": 4 },                            // only what differs from the ability modifier
  "skills": { "stealth": 6 },
  "vulnerabilities": [], "resistances": [], "immunities": ["poison"],   // damage types
  "conditionImmunities": ["poisoned"],
  "senses": { "darkvision": 60, "blindsight": 10, "tremorsense": 0, "truesight": 0 },
  "passivePerception": 9,
  "languages": "Common, Goblin",
  "traits":       [ Action ],
  "actions":      [ Action ],
  "bonusActions": [ Action ],
  "reactions":    [ Action ],
  "legendary": { "perRound": 3, "actions": [ Action ] },  // optional — marks the monster as legendary
  "desc": "Short description / lore.",
  "treasure": "optional"
}
```

`Action`:

```jsonc
{
  "name": "Scimitar",
  "attack": { "kind": "melee", "bonus": 4, "reach": 5 },   // or "kind": "ranged", "range": "80/320"
  "damage": [ { "avg": 5, "dice": "1d6+2", "type": "slashing" } ],
  "save": { "ability": "dex", "dc": 13 },                  // optional
  "uses": { "recharge": "5-6" },                           // or { "perDay": 3 } — optional
  "desc": "Extra text, rider effects."
}
```
