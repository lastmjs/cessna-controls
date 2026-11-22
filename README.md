# cessna-controls

An interactive, full-screen 3D cockpit for learning the controls of a Cessna 172 / 175 style
light airplane, and a flight simulator to fly it. Click any control or instrument to see its name in **English and Spanish**,
what it does, and a short demonstration of how it moves.

**Live site:** https://lastmjs.github.io/cessna-controls/

![The cockpit with the parts list and control-surface airplane](screenshot.png)

## Features

- 64 selectable parts: flight controls, engine controls, fuel, electrical and lights, flight and engine instruments, radios, and cabin items
- Every part named in English and Spanish, with a short explanation in both languages
- "Show me" demonstrations: the yoke turns and pulls, flaps step down, the key turns through the magneto check, the fuel selector rotates, and the gauges react (RPM, ammeter, suction, low-voltage light)
- A small airplane that shows what the yoke, rudder pedals, trim and flaps move
- Quiz mode, progress tracking and settings saved in local storage
- Full-screen mode, keyboard shortcuts, touch support

Everything is built from code in the browser with [three.js](https://threejs.org/). There are
no downloaded 3D models or photos. Your progress (parts you have marked as learned, quiz best
score, settings) is saved in your browser's local storage and never leaves your device.

## Simulator mode

Press **Fly · Volar** to switch from study mode to the flight simulator. Everything from study
mode still works; the simulator adds:

- **Flight model**: 6-degree-of-freedom physics at 240 Hz with lift, drag and stall from Cessna 172
  aerodynamic coefficients, ground effect, propeller torque and P-factor, slipstream over the tail,
  wind and gusts. It is checked against book figures in `test/fdm-test.mjs` (idle and static RPM,
  takeoff roll, top speed, climb, glide, stall speeds, fuel flow): run `node test/fdm-test.mjs`.
- **Engine and systems**: carbureted 160 hp engine with mixture, carb heat, magnetos, priming
  (and flooding), starter and battery, alternator, vacuum gyros that spin up, fuel tanks that burn
  down with real fuel flow and run dry, oil temperature and pressure, electric flaps.
- **Instruments** driven by the physics: airspeed, altimeter with Kollsman setting, lagging VSI,
  attitude, turn coordinator and slip ball, heading indicator with drift, swinging magnetic compass,
  VOR, tachometer, engine gauges, stall horn.
- **On foot**: start in the hangar, walk around, remove the chocks, taxi to the pump and fuel up
  (10 gallons per minute, priced per gallon), get in and out.
- **World**: one airport (runway 18/36, 5000 ft, elevation 1520 ft) with a hangar, FBO and fuel pump;
  hills, a mountain range, a lake, a river, a town, farms, trees and clouds.
- **Controls**: keyboard, gamepad, or touch (virtual yoke, throttle, rudder, brakes, flaps, trim),
  with optional auto-rudder and tiller steering for phones.
- Your parked airplane (position, fuel, chocks) and settings are saved in local storage.

Keys: ↑↓ pitch · ←→ roll · Q/E rudder · +/− throttle · B brakes · Shift+B parking brake ·
F/V flaps · [ ] trim · M/N mixture · H carb heat · K magnetos · Shift+K start · C camera ·
Y systems · P pause · Enter get in/out · walking: WASD, Shift to run, E to act.

## Run locally

It is a static site with no build step:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Legal

This is an independent educational project. It is not affiliated with, endorsed by, or
sponsored by Textron Aviation Inc. "Cessna" is a trademark of Textron Aviation Inc. and is used
here only to describe the aircraft type the cockpit represents. See [LEGAL.md](LEGAL.md).

This is not a flight training device and does not replace your airplane's Pilot's Operating
Handbook (POH), an instructor, or approved training.

## License

MIT. See [LICENSE](LICENSE).
