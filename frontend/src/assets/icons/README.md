# Иконки

Установлен набор из 37 иконок (dnd_builder_svg_icons.zip). Исходные цвета
заменены на `currentColor` — цвет задаёт палитра `styles/colors.css`.

Сюда кладутся SVG-иконки. Имя файла = id, подхватываются автоматически
(`components/common/Icon.svelte`). Пока файла нет — в чипах с текстом ничего
не показывается, в остальных местах — буквенный бейдж.

Цвет: используйте `fill="currentColor"` / `stroke="currentColor"` — иконка
окрасится цветом типа из `styles/colors.css`. Рекомендуемый размер холста — 24×24
(`viewBox="0 0 24 24"`), отображаются в 18×18.

## Обязательные — уже подключены в коде (18)

Тип действия (`--color-act-*`):
- `action.svg` — действие
- `bonus.svg` — бонусное действие
- `reaction.svg` — реакция
- `free.svg` — свободное действие

Тип урона (`--color-dmg-*`):
- `bludgeoning.svg` — дробящий
- `piercing.svg` — колющий
- `slashing.svg` — рубящий
- `acid.svg` — кислота
- `cold.svg` — холод
- `fire.svg` — огонь
- `force.svg` — силовое поле
- `lightning.svg` — электричество
- `necrotic.svg` — некротический
- `poison.svg` — яд
- `psychic.svg` — психический
- `radiant.svg` — излучение
- `thunder.svg` — звук / гром

Отдых (`--color-rest-*`):
- `shortRest.svg` — короткий отдых
- `longRest.svg` — долгий отдых

## Желательные — редкие случаи

- `physical.svg` — физический урон (1 способность)
- `day.svg` — «раз в день» (в данных пока не встречается)

## Свойства заклинаний, ячейки, школы — подключены

- `concentration`, `ritual`, `dc`, `range`, `duration` — чипы карточки заклинания (цвета `--color-meta-*`)
- `slot`, `pact` — ячейки в «Состоянии» (`--color-meta-slot` / `--color-meta-pact`)
- школы магии — чип школы на карточке (`--color-school-*`)

## Правило подписи

Если у подписи есть SVG, показывается только иконка, а текст уходит в подсказку
(`components/common/IconLabel.svelte`). Нет SVG — показывается текст, как раньше.
