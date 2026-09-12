# D&D Builder v3

Десктоп-версия конструктора персонажей D&D на **Wails** (Go + webview) с фронтендом на **Vite + чистом JavaScript** и хранилищем в **SQLite**. Веб-версия (один `index.html` под `file://`, хранилище — IndexedDB) собирается отдельно из того же фронтенда.

Стек: **Go** (бэкенд, БД) + **Wails v2** (десктоп-обвязка, мост JS↔Go) + **Vite + vanilla JS** (фронтенд) + **SQLite** (`modernc.org/sqlite`, чистый Go, без CGO).

## Требования

- **Go** 1.21+ (в проекте — 1.25)
- **Node.js** 20.19+ или 22.12+ и npm
- **Wails CLI** v2
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

Установка Wails CLI (компилируется в `~/go/bin`, эта папка должна быть в `PATH`):

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Проверить окружение (Go, компиляторы, webview-зависимости, npm):

```bash
wails doctor
```

## Установка зависимостей

Go-зависимости подтянутся автоматически при первой сборке. Зависимости фронтенда:

```bash
cd frontend && npm install && cd ..
```

Или разом через Wails (использует `frontend:install` из `wails.json`):

```bash
wails build   # первый запуск сам поставит зависимости фронта
```

## Разработка

```bash
wails dev
```

Что делает команда:

- поднимает Vite dev-сервер с горячей перезагрузкой (HMR) — правки в `frontend/src` видны мгновенно;
- компилирует Go и открывает нативное окно приложения с webview;
- держит живым мост JS↔Go — вызовы Go-методов из фронта работают как в продакшене;
- дополнительно отдаёт `http://localhost:34115` — открой в Chrome, чтобы дебажить фронт в привычных DevTools с доступом к Go-методам.

Это основной режим работы. `localhost` здесь — только инструмент разработки; в собранном приложении сервера нет.

## Сборка

```bash
wails build
```

Собирает фронт (`npm run build`), вшивает его в Go-бинарник через `//go:embed` и компилирует нативное приложение в **`build/bin/`**.

Полезные флаги:

```bash
wails build -platform darwin/universal   # macOS: Intel + Apple Silicon в одном .app
wails build -clean                       # чистая пересборка
wails build -upx                         # сжать бинарник (нужен upx)
wails build -nsis                        # Windows: собрать инсталлятор
```

Сборка под конкретную ОС выполняется **на этой ОС** (webview нативный и не кросс-компилится). Для всех трёх платформ сразу — CI (GitHub Actions с matrix из macOS/Windows/Linux).

## Веб-версия (без десктопа)

Тот же фронтенд собирается в один самодостаточный `index.html` под `file://` (хранилище — IndexedDB вместо SQLite):

```bash
cd frontend && npm run build
```

Результат — в `frontend/dist/`.

## Структура проекта

```
dnd-builder-v3/
├── main.go            # точка входа: окно, webview, embed фронта, привязка Go-методов
├── app.go             # Go-методы, вызываемые из фронтенда (SaveCharacter, LoadAll, …)
├── wails.json         # конфиг Wails: имя, команды сборки/дев фронта
├── go.mod / go.sum    # зависимости Go
├── frontend/          # Vite-проект (фронтенд)
│   ├── index.html
│   ├── package.json
│   ├── src/           # исходники интерфейса
│   └── wailsjs/       # автогенерируемые обёртки для вызова Go из JS
└── build/
    ├── appicon.png    # иконка приложения
    ├── darwin/        # Info.plist и пр. для macOS
    ├── windows/       # ресурсы для Windows
    └── bin/           # СЮДА собирается приложение (в .gitignore)
```

## Как фронтенд общается с Go

В собранном приложении **нет HTTP-сервера**. Фронт и Go живут в одном процессе; webview — системный (WebKit на macOS). Go-методы, привязанные в `main.go` (`Bind`), Wails автоматически превращает в JS-функции в `frontend/wailsjs/go/...`. Вызов из JS выглядит как обычный `await`:

```js
import { SaveCharacter, LoadAll } from '../wailsjs/go/main/App';

const id = await SaveCharacter(JSON.stringify(build));
const list = await LoadAll();
```

Под капотом аргументы сериализуются в JSON, передаются через нативный мост webview'а в Go, метод выполняется (пишет в SQLite), результат возвращается обратно и резолвит промис. Ошибка Go (`error`) прилетает как `reject`.
