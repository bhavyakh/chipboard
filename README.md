# ♠ Poker Night

A dashboard for your home poker game. A laptop plugged into a TV shows everyone's
buy-ins, the blinds and full-screen moments ("ALEX IS ALL IN", airhorn included).
You run it from your phone. No accounts, no cloud, no internet, and nothing to install
beyond Node.js.

## Features

- **Buy-in board.** Player tiles scroll across the screen, leaders first. The count turns
  amber at 2 buy-ins and red at 3+, and money on the table is totalled in the sidebar.
- **Phone remote.** Tap +/− for buy-ins. Trigger all-in, fold, scoop, bad beat or a
  30-second shot clock for any player. Undo anything.
- **Full-screen moments.** Each event plays a scene: big text, a colour theme, a sound,
  optional confetti and an optional GIF or video. Any player can have their own scene.
- **Custom messages and sounds.** Type a message and show it now, or save it as a button.
  Upload audio from your phone and play it on the laptop's speakers.
- **Cash-out.** Enter a leaving player's final chips. It shows their cash value and
  +/− result, and the sidebar tracks chips still in play.
- **Extras.** Welcome screen as people arrive, blinds with an optional straddle,
  announcements (bomb pot, last orbit, break), a 🧱 "cemented" tag for the player who
  won't fold, and awards like "ATM of the night".
- **Safe to run all night.** Every tap is saved to disk, so a crash or restart loses
  nothing. The remote has a username/password login, and it reloads itself when you
  update the code.

## Quick start

Requires [Node.js](https://nodejs.org) 18 or newer. There are no npm dependencies.

```bash
git clone https://github.com/<you>/poker-night.git
cd poker-night
npm start
```

The terminal prints two links:

| Where | Open | Notes |
|---|---|---|
| Laptop → TV | `http://localhost:4242/display` | Click once to turn on sound, full screen and keep the screen awake. `F` toggles full screen, `Esc` clears the screen. |
| Phone | `http://<laptop-ip>:4242/control` | Must be on the same Wi-Fi. In Safari, *Share → Add to Home Screen* makes it feel like an app. |

On first run, `config.json` is created from `config.example.json`. Edit it to make the
game yours; the screens pick up changes within a second.

Use another port with `PORT=5000 npm start`.

### Add a login for the remote (recommended)

```bash
npm run set-login
```

This asks for a username and password and stores only a salted scrypt hash in
`auth.json`, which git ignores. Each phone stays signed in for 30 days. Running it again
changes the login and signs every phone out. Deleting `auth.json` turns the login off.
The TV page never needs a login.

## Using the remote

| Tab | What's there |
|---|---|
| **Players** | Add a player (they start with one buy-in and get a welcome screen). Each player has −/+ buttons, All-in, Fold, Scoop, Bad beat, Clock and Cement. **⋯** opens **Cash out** (enter final chips; shows value and +/−), Back in the game, Welcome screen, Rename and Remove. |
| **Custom** | **New message:** big text, an optional second line, a colour and a sound. Choose **Show now** or **Save as button**. **My buttons** keeps saved messages across games. **My sounds** has **＋ Add sound** for uploading mp3, m4a, wav, ogg or aac files up to 15 MB. Built-in sounds and announcements are below. **Edit** deletes buttons or sounds. |
| **Screen** | Switch the TV between the welcome screen and the buy-in board. Shot clock (30 s, 60 s, 2 min). Blinds (SB / BB / optional straddle). Reset night. Log out. |

**↶ Undo** in the top bar reverses the last change, as far back as you need. **✕** in the
bottom bar clears whatever is on the TV.

## Make it yours: `config.json`

| Key | What it does |
|---|---|
| `title` | Shown on the TV and the remote. |
| `currency`, `locale` | Money symbol and number format, e.g. `"₹"` and `"en-IN"` for 1,00,000. |
| `buyIn`, `chipsPerBuyIn` | Price of a buy-in and the chips it buys. Cash-out values use this ratio. |
| `blinds` | Starting `{ "sb", "bb", "straddle" }`. The straddle is optional. You can also change blinds from the remote. |
| `welcomeOnJoin` | Show a welcome scene when a player is added. |
| `playerActions` | Buttons under each player. `event` names a scene, `label` is the button text, `award` is the sidebar title for whoever has the most. |
| `scenes` | What the TV shows for each event: `welcome`, `rebuy`, `allin`, `fold`, `shipit`, `badbeat`, `cashout`, `cement`, plus any events you add. |
| `playerScenes` | Per-player overrides, keyed by lower-case name. |
| `announcements` | One-tap scenes on the Custom tab. |
| `soundboard` | Built-in sound buttons. |

Keys you leave out fall back to `config.example.json`.

**Scene fields:**

| Field | Meaning |
|---|---|
| `kicker` | Small line above the title. |
| `title` | The big text. |
| `subtitle` | Smaller line below the title. |
| `image` | gif, png, jpg, mp4 or webm, e.g. `media/alex.gif`. |
| `sound` | A built-in name or `media/sounds/your.mp3`. |
| `theme` | `red`, `gold`, `green`, `blue`, `purple` or `black`. |
| `duration` | Seconds on screen. |
| `confetti` | `true` adds confetti. |

Give an event a list of scenes and a random one plays each time.

**Text placeholders:**

| Placeholder | Meaning |
|---|---|
| `{name}` | Player's name. |
| `{buyins}` | Their buy-ins. |
| `{total}` | Money they've put in. |
| `{chips}` | Chips they've bought. |
| `{count}` | How many times this event has happened to them tonight. |
| `{allins}` | Their all-ins tonight. |
| `{blinds}` | Current blinds. |
| `{cashChips}`, `{net}` | Final chips and +/− result, for cash-out. |

**Built-in sounds** are generated in code, so no files are needed: `airhorn`,
`chaching`, `sadtrombone`, `drumroll`, `applause`, `buzzer`, `rimshot`, `fanfare`,
`ding`, `whoosh` and `tick`.

### Example: a custom all-in screen for one friend

```json
"playerScenes": {
  "alex": {
    "allin": {
      "title": "ALEX IS ALL IN",
      "subtitle": "Lock the doors",
      "image": "media/alex.gif",
      "sound": "media/sounds/alex.mp3",
      "theme": "red",
      "duration": 8
    }
  }
}
```

### Example: a new button under every player

```json
"playerActions": [
  { "event": "cooler", "label": "Cooler", "award": "Most coolers" }
],
"scenes": {
  "cooler": { "kicker": "{name}", "title": "Cooler.", "sound": "buzzer", "theme": "blue", "duration": 5 }
}
```

## How it works

```
 phone (/control) ──POST /api/action──▶  server.js  ──Server-Sent Events──▶  TV (/display)
                  ◀────────────── state ────┘   │                         ▶  every open remote
                                                └─ data/state.json (saved after each change)
```

- **`server.js`** is a single-file Node HTTP server with zero dependencies. It holds the
  night's state, applies actions, keeps an undo history, and pushes every change to all
  open screens over Server-Sent Events.
- **`public/display.html`** is the TV page: tiles, sidebar, scenes and shot clock.
  **`public/control.html`** is the phone remote. **`public/sounds.js`** synthesises the
  built-in sounds with the Web Audio API.
- **Scenes** are resolved on the server: event defaults, per-player overrides and
  placeholders are filled in, then pushed to the TV, which queues them.

| Path | Tracked in git | Contents |
|---|---|---|
| `config.example.json` | yes | Defaults. |
| `config.json` | no | Your settings. |
| `auth.json` | no | Login hash. |
| `data/state.json` | no | Tonight's game. |
| `data/library.json` | no | Saved buttons. |
| `data/sessions.json` | no | Phone sessions. |
| `media/sounds/` | no | Uploaded sounds. |
| `media/` | folder only | Your images and videos. |

## Security notes

Poker Night is built for a home network, not the internet.

- **Don't expose it publicly.** Don't port-forward it or put it on a public host. It
  speaks plain HTTP.
- **The remote** (`/control` and every action and upload) requires the login once you
  run `npm run set-login`. Ten wrong passwords from one device lock login for 10 minutes.
- **The TV page and its live feed** (`/display`, `/events`) are read-only and open to
  anyone on your Wi-Fi.
- **Uploads** must be audio files, are capped at 15 MB, and are renamed and kept inside
  `media/sounds/`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't open the link | Same Wi-Fi as the laptop? On macOS, allow incoming connections for `node` (System Settings → Network → Firewall). Guest networks often block devices from reaching each other. |
| No sound on the TV | Click the display page once after loading; browsers block audio until you do. Check the laptop's output device. |
| Laptop goes to sleep | Run `caffeinate -d` in another terminal (macOS). The display page also requests a wake lock. |
| Remote looks out of date | It reloads itself when the code changes. If you added it to the home screen, close it fully and reopen it. |
| Laptop's IP changed | Use the link the terminal prints at start-up. |

## Development

```bash
npm test     # starts the real server in a temp folder and exercises it over HTTP
```

The tests use Node's built-in test runner: game actions, undo, cash-out, blinds, saved
buttons, upload and path safety, and login.

## License

[MIT](LICENSE) © 2026 Bhavya Khandelwal
