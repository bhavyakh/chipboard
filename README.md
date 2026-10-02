# Poker Night

The buy-in board for our weekly cash game. The laptop drives the monitor; your phone is the remote.
No installs, no internet: Node.js and the same Wi-Fi are all it needs.

## Run it

```bash
cd ~/poker-night
npm start
```

The terminal prints two links:

- **Monitor:** open `http://localhost:4242/display` on the laptop, drag it to the monitor, click once
  (that turns on sound, full screen and keeps the screen awake). `F` toggles full screen, `Esc` clears the screen.
- **Phone:** open the `http://192.168.x.x:4242/control` link. In Safari, Share → Add to Home Screen
  turns it into an app.

If the phone can't connect, allow incoming connections for `node` when macOS asks (or in
System Settings → Network → Firewall). Keep the lid open; `caffeinate -d` in another terminal stops the Mac sleeping.

## The remote

| Tab | What it does |
|---|---|
| **Players** | Add a player (starts with 1 buy-in and gets a welcome screen). `+`/`−` buy-ins. Each rebuy flashes on the monitor. All-in / Ship it / Bad beat / Clock (30 s shot clock) / Hello. `⋯` renames, or type `DELETE` to remove. |
| **Sounds** | Soundboard plus announcements (bomb pot, straddle, last orbit, break). |
| **Screen** | Switch the monitor between the welcome screen and the buy-in board. Shot clock without a name. Change blinds. Reset the night. |

**↶ Undo** (top right) reverses the last change, as many times back as you need. **✕** (bottom right) clears whatever is on the monitor.

The night is saved to `data/state.json` after every tap, so restarting the laptop or server loses nothing.
Use **Reset night** at the start of each game.

## Customising — `config.json`

Edit while the server runs; the screens update within a second.

- `buyIn`, `chipsPerBuyIn`, `blinds`: the game. Currently ₹1,000 = 2,000 chips at 20/50.
- `pin`: set e.g. `"4321"` and the remote asks for it once.
- `scenes`: what the monitor shows for each event (`welcome`, `rebuy`, `allin`, `shipit`, `badbeat`).
- `playerScenes`: overrides for specific people, matched by name (case doesn't matter). This is where Pluto lives:

```json
"playerScenes": {
  "pluto": {
    "allin": {
      "title": "PLUTO IS ALL IN",
      "subtitle": "Lock the doors",
      "image": "media/pluto.gif",
      "sound": "media/pluto.mp3",
      "theme": "red",
      "duration": 8
    }
  }
}
```

  Give an event a list of scenes instead of one and a random one plays each time.
- `playerActions`: the buttons under each player. Add `{ "event": "cooler", "label": "Cooler" }` and
  a matching `scenes.cooler` to create a new event.
- `announcements`, `soundboard`: the buttons on the Sounds tab.

**Scene fields:** `title`, `subtitle`, `image` (gif/png/jpg/mp4/webm in `media/`), `sound`, `theme`
(`red`, `gold`, `green`, `blue`, `purple`, `black`), `duration` in seconds, `confetti: true`.
Text can use `{name}`, `{buyins}`, `{total}`, `{chips}`, `{count}` (times this event has happened to them
tonight), `{allins}`, `{sb}`, `{bb}`.

**Sounds:** built in are `airhorn`, `chaching`, `sadtrombone`, `drumroll`, `applause`, `buzzer`,
`rimshot`, `fanfare`, `ding`, `whoosh` and `tick`. Or drop an mp3 into `media/` and use `"media/yourfile.mp3"`.
