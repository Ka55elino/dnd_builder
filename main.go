package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The built frontend (frontend/dist) is embedded into the binary.
//
//go:embed all:frontend/dist
var assets embed.FS

// App icon for the default About box (platform icons are generated from it into build/).
//
//go:embed build/appicon.png
var appIcon []byte

func main() {
	backend := NewApp()

	app := application.New(application.Options{
		Name:        APP_NAME,
		Description: "D&D 2024 character builder",
		Icon:        appIcon,
		// Go methods of App are exposed to the frontend (bindings in frontend/bindings)
		Services: []application.Service{
			application.NewService(backend),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: backend.imageMiddleware, // /img/… — built-in and uploaded images (images.go)
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "dnd-builder-v3",
		Width:            1024,
		Height:           768,
		BackgroundColour: application.NewRGB(17, 16, 20), // --color-bg #111014: no white flash on start
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
