package main

import (
	"encoding/json"
	"fmt"

	"dnd-builder-v3/lan"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Local-network game (see package lan). Status changes, discovered games and
// game events reach the frontend as Wails events: net:status, net:games, net:event.

// emitEvent sends an event to the frontend.
func emitEvent(name string, data any) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data)
	}
}

// NetStatus returns the current network state (header, game and join screens).
func (a *App) NetStatus() lan.Status {
	return a.net.Status()
}

// HostGame starts hosting a game with the given name (DM): WebSocket server + mDNS announcement.
func (a *App) HostGame(name string) (lan.Status, error) {
	return a.net.Host(name)
}

// StopGame ends the hosted game.
func (a *App) StopGame() {
	a.net.StopHost()
}

// StartDiscovery starts looking for games on the local network (results come as net:games).
func (a *App) StartDiscovery() {
	a.net.StartDiscovery()
}

// StopDiscovery stops looking for games.
func (a *App) StopDiscovery() {
	a.net.StopDiscovery()
}

// JoinGame connects to a DM ("ip" or "ip:port") with a saved character;
// the character is sent to the DM as a snapshot.
func (a *App) JoinGame(address, characterID string) (lan.Status, error) {
	db, err := a.conn()
	if err != nil {
		return a.net.Status(), err
	}
	build, err := getCharacter(db, characterID)
	if err != nil {
		return a.net.Status(), err
	}
	state, _ := getCharacterState(db, characterID) // may be empty for a new character

	player := lan.PlayerInfo{CharacterID: characterID}
	if list, err := listCharacters(db); err == nil {
		for _, c := range list {
			if c.ID == characterID {
				player.Name, player.ClassName, player.Level, player.Portrait = c.Name, c.ClassName, c.Level, c.Portrait
				break
			}
		}
	}
	if player.Name == "" {
		return a.net.Status(), fmt.Errorf("character %s not found", characterID)
	}
	return a.net.Join(address, player, lan.Snapshot{Build: build, State: state})
}

// LeaveGame disconnects from the DM.
func (a *App) LeaveGame() {
	a.net.Leave()
}

// SendGameEvent sends a game event. DM: to a player id, or to everyone if to is "".
// Player: always to the DM (to is ignored). dataJSON is any JSON (or "").
func (a *App) SendGameEvent(kind, to, dataJSON string) error {
	var data json.RawMessage
	if dataJSON != "" {
		if !json.Valid([]byte(dataJSON)) {
			return fmt.Errorf("event data is not valid JSON")
		}
		data = json.RawMessage(dataJSON)
	}
	return a.net.Send(kind, to, data)
}

// GetPlayerCharacter returns the character a player joined with (DM only).
func (a *App) GetPlayerCharacter(playerID string) (lan.Snapshot, error) {
	return a.net.PlayerCharacter(playerID)
}
