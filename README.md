
<div align="center">

<img src="https://github.com/user-attachments/assets/da9d9c94-c60a-47ef-9ed9-1257264e1a64" alt="Hakoto logo" width="110" />

# hakoto.

**Your music, in its place.**
</div>

Hakoto is a lightweight, local-first desktop application for cataloging and managing physical music collections. It provides tools for organizing albums, creating custom crates, arranging virtual shelves, and tracking collection statistics. Built with a minimal interface that prioritizes album artwork and usability, Hakoto stores all collection data locally without requiring an account, subscription, or cloud service.

<p align="center">
  <a href="https://github.com/MrTytanic/hakoto/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/MrTytanic/hakoto?style=flat&label=License&color=555555" alt="MIT License" />
  </a>
</p>

<p align="center">
  <strong>Supported Platforms:</strong> Windows + Linux
</p>

## Preview

<div align="center">
  <img src="https://github.com/user-attachments/assets/4e004336-0e95-427c-b879-38c2edb7c28d" alt="Hakoto collection grid with album artwork" width="900" />
</div>

## Features

- **Collection:** Catalog albums with metadata including artist, release year, format, condition, notes, and artwork. Supports searching, sorting, filtering, and grid or list views.
- **Shelves:** Organize albums into configurable virtual shelves with drag-and-drop placement and capacity tracking.
- **Crates:** Create and manage custom, ordered groups of albums independently of the main collection.
- **Favorites & Wishlist:** Mark favorite albums and maintain a separate list of albums for future acquisition.
- **Statistics:** View collection statistics including format distribution, favorites, and acquisition history.
- **Personalization:** Configure profile information, including display name and profile picture, and select between light, dark, and system themes.
- **Data Portability:** Import and export collection data using CSV, with additional backup and restore functionality.
- **Local Storage:** Collection data is stored locally using SQLite. No authentication or external services are required.

## Screenshots

### Shelves

Configure virtual shelves and organize your albums using drag-and-drop placement.

<div align="center">
  <img src="https://github.com/user-attachments/assets/d99d2125-0466-4d1c-958d-5fadff6fe480" alt="Hakoto shelf workspace" width="900" />
</div>

### Statistics

View collection statistics, format distribution, and acquisition history.

<div align="center">
  <img src="https://github.com/user-attachments/assets/88d09c17-bf02-47de-920e-4d4ce9db0804" alt="Hakoto statistics dashboard" width="900" />
</div>

### Crates

Create custom album groups and manage their contents independently of the main collection.

<div align="center">
  <img src="https://github.com/user-attachments/assets/c9b8dd44-37b1-403e-ac2b-9b15c282500b" alt="Hakoto crates page" width="900" />
</div>

### Settings

Manage profile information and application preferences.

<div align="center">
  <img src="https://github.com/user-attachments/assets/0905ac36-8de9-4e95-8287-8870ae013238" alt="Hakoto settings page" width="900" />
</div>

## Installation

Hakoto supports **Windows** and **Linux**. Precompiled builds, when available, can be downloaded from [GitHub Releases](https://github.com/MrTytanic/hakoto/releases).

Alternatively, Hakoto can be built from source using the instructions below.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) and npm
- [Rust](https://www.rust-lang.org/tools/install) and Cargo
- Platform-specific dependencies listed in the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Running locally

Clone the repository and install the frontend dependencies:

```bash
git clone https://github.com/MrTytanic/hakoto.git
cd hakoto
npm install
```

Start the application in development mode:

```bash
npm run tauri dev
```

### Building

Generate a production build:

```bash
npm run tauri build
```

Compiled binaries and installation packages are generated under `src-tauri/target/release/`.

> Build dependencies and packaging requirements vary between Windows and Linux. Refer to the Tauri documentation for platform-specific configuration.

## Tech Stack

<div align="center">
  <a href="https://v2.tauri.app/"><img src="https://cdn.simpleicons.org/tauri/24C8D8" alt="Tauri" width="42" height="42" /></a>&nbsp;&nbsp;
  <a href="https://react.dev/"><img src="https://cdn.simpleicons.org/react/61DAFB" alt="React" width="42" height="42" /></a>&nbsp;&nbsp;
  <a href="https://www.typescriptlang.org/"><img src="https://cdn.simpleicons.org/typescript/3178C6" alt="TypeScript" width="42" height="42" /></a>&nbsp;&nbsp;
  <a href="https://www.rust-lang.org/"><img src="https://cdn.simpleicons.org/rust/000000/FFFFFF" alt="Rust" width="42" height="42" /></a>&nbsp;&nbsp;
  <a href="https://www.sqlite.org/"><img src="https://cdn.simpleicons.org/sqlite/003B57" alt="SQLite" width="42" height="42" /></a>

  <p><strong>Tauri 2 · React · TypeScript · Rust · SQLite</strong></p>
</div>

- **Tauri 2:** Cross-platform desktop application framework.
- **React + TypeScript:** Frontend interface and application state management.
- **Rust:** Native backend and application logic.
- **SQLite:** Local relational database for persistent collection data.

## License

Hakoto is released under the **[MIT License](https://github.com/MrTytanic/hakoto/blob/main/LICENSE)**. See the [`LICENSE`](https://github.com/MrTytanic/hakoto?tab=MIT-1-ov-file) file for the full license terms.
