# Icons

A set of 37 icons is installed (dnd_builder_svg_icons.zip). The original colors
were replaced with `currentColor` — the color comes from the `styles/colors.css` palette.

SVG icons go here. File name = id; they are picked up automatically
(`components/common/Icon.svelte`). Until a file exists, chips with text show
nothing, and everywhere else a letter badge is shown.

Color: use `fill="currentColor"` / `stroke="currentColor"` — the icon
takes the type color from `styles/colors.css`. Recommended canvas size is 24×24
(`viewBox="0 0 24 24"`); icons are displayed at 18×18.

## Required — already wired up in code (18)

Action type (`--color-act-*`):
- `action.svg` — action
- `bonus.svg` — bonus action
- `reaction.svg` — reaction
- `free.svg` — free action

Damage type (`--color-dmg-*`):
- `bludgeoning.svg` — bludgeoning
- `piercing.svg` — piercing
- `slashing.svg` — slashing
- `acid.svg` — acid
- `cold.svg` — cold
- `fire.svg` — fire
- `force.svg` — force
- `lightning.svg` — lightning
- `necrotic.svg` — necrotic
- `poison.svg` — poison
- `psychic.svg` — psychic
- `radiant.svg` — radiant
- `thunder.svg` — thunder

Rest (`--color-rest-*`):
- `shortRest.svg` — Short Rest
- `longRest.svg` — Long Rest

## Nice to have — rare cases

- `physical.svg` — physical damage (1 ability)
- `day.svg` — "once per day" (not used in the data yet)

## Spell properties, slots, schools — wired up

- `concentration`, `ritual`, `dc`, `range`, `duration` — spell card chips (colors `--color-meta-*`)
- `slot`, `pact` — spell slots in "State" (`--color-meta-slot` / `--color-meta-pact`)
- schools of magic — school chip on the card (`--color-school-*`)

## Label rule

If a label has an SVG, only the icon is shown and the text moves into the tooltip
(`components/common/IconLabel.svelte`). No SVG — the text is shown, as before.
