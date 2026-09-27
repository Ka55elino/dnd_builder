package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

// Window icon for Linux (on macOS/Windows the icon is taken from build/ at build time).
//
//go:embed build/appicon.png
var appIcon []byte

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "dnd-builder-v3",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: app.imageMiddleware, // /img/… — built-in and uploaded images (images.go)
		},
		BackgroundColour: &options.RGBA{R: 17, G: 16, B: 20, A: 1}, // --color-bg #111014
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Linux: &linux.Options{
			Icon: appIcon,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
