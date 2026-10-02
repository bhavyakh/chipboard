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

**Login:** the remote asks for a username and password; each phone stays logged in for 30 days.
The monitor page (`/display`) needs no login. To change the login, run `npm run set-login`
(this signs every phone out). To turn it off, delete `auth.json`. Only a salted hash is stored,
and `auth.json` is git-ignored.

If the phone can't connect, allow incoming connections for `node` when macOS asks (or in
System Settings → Network → Firewall). Keep the lid open; `caffeinate -d` in another terminal stops the Mac sleeping.

## The remote

| Tab | What it does |
|---|---|
| **Players** | Add a player (starts with 1 buy-in and gets a welcome screen). `+`/`−` buy-ins. Each rebuy flashes on the monitor. All-in / Fold / Scoop / Bad beat / Clock (30 s shot clock) / Cement (tap again to un-cement). `⋯` opens: welcome screen, rename, remove. |
| **Custom** | Type a message (big text, optional second line, colour, sound) and **Show now**, or **Save as button** to keep it under *My buttons* for every game. *My sounds*: **＋ Add sound** uploads an audio file from your phone; tap it to play on the laptop's speakers. **Edit** deletes buttons or sounds. Built-in sounds and announcements are below. |
| **Screen** | Switch the monitor between the welcome screen and the buy-in board. Shot clock without a name. Change blinds. Reset the night. |

**↶ Undo** (top right) reverses the last change, as many times back as you need. **✕** (bottom right) clears whatever is on the monitor.

Saved buttons live in `data/library.json` and survive **Reset night**. Your sounds live in `media/sounds/`; you can also copy files straight into that folder (mp3, m4a, wav, ogg, aac, up to 15 MB).

The remote reloads itself when the code on the laptop changes.

The night is saved to `data/state.json` after every tap, so restarting the laptop or server loses nothing.
Use **Reset night** at the start of each game.

## Customising — `config.json`

Edit while the server runs; the screens update within a second.

- `buyIn`, `chipsPerBuyIn`, `blinds`: the game. Currently ₹1,000 = 2,000 chips at 20/50.
- `scenes`: what the monitor shows for each event (`welcome`, `rebuy`, `allin`, `fold`, `shipit`, `badbeat`, `cement`).
- `playerScenes`: overrides for specific people, matched by name (case doesn't matter). This is where Ginna lives:

```json
"playerScenes": {
  "ginna": {
    "allin": {
      "title": "GINNA IS ALL IN",
      "subtitle": "Lock the doors",
      "image": "media/ginna.gif",
      "sound": "media/ginna.mp3",
      "theme": "red",
      "duration": 8
    }
  }
}
```

  Give an event a list of scenes instead of one and a random one plays each time.
- `playerActions`: the buttons under each player; `award` is the footer title for whoever has the most. Add `{ "event": "cooler", "label": "Cooler", "award": "Most coolers" }` and
  a matching `scenes.cooler` to create a new event.
- `announcements`, `soundboard`: the buttons on the Sounds tab.

**Scene fields:** `kicker` (small line above the title), `title`, `subtitle`, `image` (gif/png/jpg/mp4/webm in `media/`), `sound`, `theme`
(`red`, `gold`, `green`, `blue`, `purple`, `black`), `duration` in seconds, `confetti: true`.
Text can use `{name}`, `{buyins}`, `{total}`, `{chips}`, `{count}` (times this event has happened to them
tonight), `{allins}`, `{sb}`, `{bb}`.

**Sounds:** built in are `airhorn`, `chaching`, `sadtrombone`, `drumroll`, `applause`, `buzzer`,
`rimshot`, `fanfare`, `ding`, `whoosh` and `tick`. Or drop an mp3 into `media/` and use `"media/yourfile.mp3"`.
