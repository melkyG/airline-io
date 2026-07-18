# Airline.io

A simple Node.js multiplayer browser game prototype built with Express and Socket.IO.

## Purpose

This project implements the first milestone of a multiplayer lobby system. Visitors can connect, join a lobby, wait for a five-player countdown, and then transition into a placeholder game screen.

## Current milestone

The current milestone focuses on:
- server-authoritative lobby matching
- five-player countdowns
- lobby-to-game conversion
- simple placeholder game state

## Lobby vs. Game

- A Lobby is a temporary pre-game container that manages waiting players.
- A Game is an active match created only after a lobby completes its countdown successfully.

## Architecture

The server is authoritative. Clients only send player intentions and display server-provided state.

## Project structure

- client/index.html: lobby and game screens
- client/game.js: browser-side Socket.IO client logic
- client/style.css: basic responsive styling
- server/server.js: Express + Socket.IO server entrypoint
- server/GameManager.js: orchestrates lobbies, games, and membership
- server/Lobby.js: lobby lifecycle, countdown, and state broadcasting
- server/Game.js: active-game state and leaderboard generation
- server/Player.js: player data and identity

## Requirements

- Node.js
- npm

## Installation

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Then open http://localhost:3000

## Manual testing with multiple tabs

Open several browser tabs to test the lobby flow. Five tabs can be used to complete a full match.

## Current Socket.IO events

### Client to server
- lobby:join

### Server to client
- connection:ready
- lobby:preview
- lobby:joined
- lobby:update
- lobby:countdown
- lobby:countdown-cancelled
- lobby:error
- game:started

## Lobby matching rules

- A visitor is not automatically added to a lobby.
- The server searches for the fullest joinable waiting lobby.
- If none exists, a new lobby is created when the player clicks Join.
- The preview always reflects currently joinable lobby availability.

## Countdown cancellation behavior

If a player disconnects during the countdown, the countdown is cancelled and the lobby returns to waiting.

## Lobby-to-game conversion

When all five players remain connected and the countdown finishes, the server creates a Game, moves the players into the game room, and sends game:started to all clients.

## Disconnect behavior

- Visitors who never join do not affect lobby state.
- Lobby players who disconnect are removed from the lobby.
- Players in an active game remain in the game and are marked disconnected.

## Current placeholders

- Map placeholder: Map Placeholder
- Player names are assigned by join order
- Scores start at zero

## Future map integration

A real map layer will be added later, replacing the placeholder view.

## Future airport and airline systems

Airport gameplay and airline systems are intentionally not part of this milestone.

## Future Render deployment

Render deployment configuration will be added later. The server already uses process.env.PORT.

## Manual test checklist

### Test 1: Visitor does not automatically join
- Open one browser tab.
- Confirm the page shows 0/5.
- Confirm no lobby is created until Join is clicked.

### Test 2: One player joins
- Click Join.
- Confirm a lobby is created.
- Confirm the button changes to Joined.
- Confirm the count becomes 1/5.

### Test 3: Multiple players join the same lobby
- Open additional tabs.
- Click Join in each.
- Confirm counts update to 2/5, 3/5, and 4/5.

### Test 4: Countdown begins
- Add the fifth player.
- Confirm a five-second countdown begins.
- Confirm no Game object exists before countdown completion.

### Test 5: Successful lobby conversion
- Let the countdown finish.
- Confirm a Game is created.
- Confirm the lobby is removed.
- Confirm all players see the placeholder game screen.

### Test 6: Sixth visitor while countdown is running
- Open another tab while the countdown is active.
- Confirm the visitor sees 0/5 and no new lobby is created.

### Test 7: Disconnect during countdown
- Disconnect one joined player before countdown completion.
- Confirm the countdown stops and the lobby returns to waiting.

### Test 8: Replacement player joins reopened lobby
- Have the sixth visitor click Join.
- Confirm they join the reopened lobby and the countdown restarts.

### Test 9: Second simultaneous match
- Complete the first game.
- Open another visitor and click Join.
- Confirm a new lobby and game can be created independently.

### Test 10: Duplicate Join protection
- Rapidly click Join more than once.
- Confirm the socket is only added once.
