# Third-party components

Gallery apps are self-contained: every library an app needs is vendored into
its own file, so nothing is fetched from a CDN at runtime and nothing can be
swapped after review (see `bundle_libs.py` and `GALLERY-REVIEW.md`).

The libraries below are **not ours**. They remain under their own licences,
which permit the use made of them here, and nothing in [LICENSE](LICENSE)
restricts your rights under them. This file is the attribution notice those
licences ask for.

| Library | Version | Licence | Copyright | Used by |
|---|---|---|---|---|
| [jsnes](https://github.com/bfirsh/jsnes) | bundled | Apache-2.0 | Ben Firshman and contributors | `nes-emulator` |
| [binjgb](https://github.com/binji/binjgb) | bundled | MIT | Ben Smith | `gb-player` |
| [chess.js](https://github.com/jhlywa/chess.js) | bundled | BSD-2-Clause | Jeff Hlywa | `chess` |
| [Leaflet](https://leafletjs.com) | 1.9.4 | BSD-2-Clause | Volodymyr Agafonkin, CloudMade | `near-me` |
| [HanziWriter](https://chanind.github.io/hanzi-writer) | 3.5 | MIT | Chris Chan | `hanyu` |

Pinned copies of the libraries we vendor through `bundle_libs.py` live in
`libs/`, so the exact bytes we ship are the bytes in this repository.

## Data and services

- **`hanyu`** fetches stroke-order data from `hanzi-writer-data`, which derives
  from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) — graphics
  under the Arphic Public Licence, dictionary data under CC BY-SA 4.0.
- **`near-me`** renders OpenStreetMap tiles. Map data © OpenStreetMap
  contributors, ODbL.

## Adding one

Vendor it with `bundle_libs.py`, add the pinned file to `libs/`, add a row
above, and note the licence in the app's header line if it is not permissive.
An app whose licence would restrict how the Gallery distributes it does not
ship — check before you build on it, not after.
