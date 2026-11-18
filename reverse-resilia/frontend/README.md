# Auren Real Estate × Herasymenko Visual Engine

A production-quality architectural website combining the **content, residence catalog, and information architecture of [Auren](https://auren2.framer.website/)** with the **strict UI, UX, kinetic motion, and WebGL interaction system of [Herasymenko](https://herasymenkox.com/)**.

---

## Project Structure

```
├── index.html                               # Homepage (01 Slider, 02 3D Gallery, 03 3D Orbit)
├── residences.html                          # Complete Architectural Portfolio & Filterable Archive
├── about.html                               # Studio Philosophy, 4 Pillars & 3D Canvas
├── journal.html                             # Architectural Essays, Perspectives & Inline Reader
├── contact.html                             # Direct Line Typography, Consultation Drawer & 3D Globe
├── privacy-policy.html                      # Privacy Disclosures
├── terms-of-use.html                        # Terms of Use
├── residences/
│   ├── ready-for-more.html                  # Deep-dive: Waterfront Residence (420 m²)
│   ├── between-light-landscape.html         # Deep-dive: Garden Villa (510 m²)
│   ├── penthouse-collection.html            # Deep-dive: Skyline Penthouse (365 m²)
│   └── the-quiet-address.html               # Deep-dive: Signature Apartment (285 m²)
├── css/
│   ├── style.css                            # Core tokens (--green: #cee49f, --black: #0b0b0b), mix-blend, typography
│   ├── profile.css                          # Editorial layout, ligatures, coordinates
│   ├── connect.css                          # Kinetic direct-line typography, infinite scroll wall
│   ├── residences.css                       # Filterable grid, cursor hover previews, specs matrix
│   └── journal.css                          # Publication grid, essay reader layout
├── js/
│   ├── main.js                              # Homepage coordinator & scene manager
│   ├── gl.js                                # WebGL distortion shader with displacement & RGB shift
│   ├── gallery.js                           # Three.js 3D curved cylindrical card ribbon
│   ├── orbit.js                             # Three.js 3D cylindrical particle orbit
│   ├── y3d.js & glyph-a.js                  # Architectural "A" monogram 3D extrusion & metallic shader
│   ├── work.js                              # Residence case study drawer with specs & gallery
│   ├── preloader.js                         # Dynamic 0% -> 100% counter & tile reveal
│   ├── stepper.js & ruler.js                # Interactive draggable ruler & pagination lines
│   ├── clock.js                             # Dual operations timezone clock (Bengaluru, IN / UTC)
│   ├── sound.js                             # Web Audio API click feedback synthesized trigger
│   ├── transition.js                        # Veil page transition system
│   └── data.js                              # Structured Auren residential data & high-res media
├── public/
│   ├── fonts/                               # PP Neue Montreal (Bold), Mono (Medium), FH Phemister (Light)
│   ├── assets/textures/distortion-noise.jpg # High-frequency WebGL displacement texture
│   ├── assets/connect/globe.svg             # Vector wireframe globe
│   ├── media/sound/                         # UI click sound buffer
│   └── media/auren/                         # High-res architectural photography & blueprints
├── vite.config.js                           # Multi-page production configuration
└── package.json                             # Dependencies (three, gsap, vite)
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode (with hot module replacement)
```bash
npm run dev
```

### 3. Production Build
```bash
npm run build
```

### 4. Preview Production Build
```bash
npm run preview
```

---

## Features

- **3 Interaction Modes on Homepage:**
  - `01 Slider`: Full-screen WebGL distortion shader with chromatic aberration and wheel scrubbing.
  - `02 Gallery`: Three.js curved cylindrical 3D ribbon gallery with mouse drag physics.
  - `03 Orbit`: Three.js 3D spatial cylindrical card orbit with perspective camera shift.
- **Interactive Case Study Drawer (`data-work`):** Expands on any residence card to reveal architectural narrative, specifications matrix, and curated photography.
- **Consultation Booking Drawer:** On `/contact`, click *Inquiry Desk [Book]* to open the slide-out scheduling form.
- **Filterable Archive:** On `/residences`, filter projects by typology (`Waterfront`, `Garden Villa`, `Skyline Penthouse`, `Signature Apartment`) with floating cursor image preview.
- **Dual Operations Timezone Clock:** Displays real-time operations local time (`BENGALURU, IN_HH:MM:SS`), with one-click toggle to `UTC`.
- **Audio Feedback:** Synthesized Web Audio clicks on button and link interactions.
- **Page Transitions:** Veil curtain transitions between pages with history tracking.
