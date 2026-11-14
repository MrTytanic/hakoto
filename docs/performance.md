# Hakoto performance baseline

Baseline revision `1d498eb`, measured November 13, 2026 on Windows 11 (build 26100), Ryzen 7 3700X, Node 22.14.0 and Rust 1.99.1 (`x86_64-pc-windows-gnu`). All albums and WebP fixtures were generated. Times are medians in milliseconds per operation.

## Startup, SQLite and artwork

The Rust harness runs the application’s storage functions against a fresh temporary collection for each size. It seeds 10% wishlist albums, 80% artwork coverage, and one 10×10 shelf with 90 placements. The 500×500 WebP fixture is 11,040 bytes. Timings use warm filesystem caches, ten warm-ups, and 31 samples. Swap alternates two existing placements and includes transaction commit. Artwork read includes path checks, file I/O and WebP validation.

| Albums | Reopen storage | Artwork cleanup | Read library | Encode JSON | JSON bytes | Load shelf | Commit swap | Read artwork |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.019 | 3.430 | 0.593 | 1.538 | 31,349 | 0.471 | 6.789 | 0.397 |
| 500 | 1.801 | 27.353 | 2.592 | 7.798 | 157,749 | 0.454 | 5.492 | 0.362 |
| 1,000 | 3.023 | 87.850 | 5.133 | 21.099 | 315,694 | 0.671 | 5.855 | 0.583 |
| 2,000 | 2.251 | 313.719 | 9.303 | 31.388 | 633,587 | 0.477 | 5.523 | 0.377 |

The table above uses the Rust debug harness. The same harness built with Cargo's default release profile produced the following results. The JSON byte counts were identical.

| Albums | Reopen storage | Artwork cleanup | Read library | Encode JSON | Load shelf | Commit swap | Read artwork |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1.229 | 1.109 | 0.196 | 0.027 | 0.169 | 4.809 | 0.374 |
| 500 | 1.146 | 7.802 | 0.677 | 0.256 | 0.195 | 5.280 | 0.363 |
| 1,000 | 1.274 | 24.163 | 1.483 | 0.284 | 0.181 | 4.911 | 0.359 |
| 2,000 | 1.241 | 83.180 | 2.692 | 0.719 | 0.184 | 5.365 | 0.340 |

Reopen covers storage initialization and migrations. It excludes artwork cleanup, expiry, profile cleanup, WebView launch and React mount. JSON timing covers Rust serialization, with IPC transport and JavaScript parsing outside the measurement. The ownership query plan reports `SCAN albums`. Shelf load and swap timings held roughly steady as album count increased.

## React rendering

Production React rendered the actual Collection and ShelfGrid components to static markup via Node and Vite. The collection uses the default sort and page size and renders 25 cards at every size. The shelf cases render fully occupied vertical grids. The derivation benchmark matches all albums, sorts by title, groups by first letter, and takes a 25-album page. Medians use 20 warm-ups and 31 samples, with derivation batched in 25-operation samples. Browser layout, image decoding, drag frame times, and process memory are outside these timings.

| Albums | Search, sort, group and page | Collection markup | 5×5 shelf markup | 10×10 shelf markup |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 0.079 | 1.648 | 0.184 | 0.445 |
| 500 | 0.506 | 1.442 | 0.129 | 0.408 |
| 1,000 | 1.054 | 1.225 | 0.149 | 0.408 |
| 2,000 | 2.384 | 1.079 | 0.189 | 0.458 |

## Windows build size

| Artifact | Bytes | MiB |
| --- | ---: | ---: |
| Debug `hakoto.exe` | 253,664,333 | 241.91 |
| Release `hakoto.exe`, embedded frontend | 7,770,624 | 7.41 |
| Release `WebView2Loader.dll` build output | 160,880 | 0.15 |
| Vite output, uncompressed | 690,417 | 0.66 |

The normal debug executable uses the Vite development URL. The release executable uses Cargo's optimized profile with LTO and stripping. A debug build with the release protocol feature hit a Windows file lock. In the measured debug executable, the PE `.debug_str` and `.debug_info` sections account for 164.44 MiB together. The release executable is mostly code (`.text` is 6.17 MiB) with 0.94 MiB of `.rdata`. The bundled SQLite input archive is 3,322,598 bytes before linking. Its archive size does not establish its contribution after LTO and stripping.

The entry JS chunk is 341,177 bytes, CSS is 41,429 bytes, and the lazy WebP fallback is 281,261 bytes of WASM plus 20,150 bytes of loader JS. Vite's module attribution identifies React DOM as the largest entry-chunk dependency. The installed JavaScript opener package has no source imports. Rust still uses its opener plugin for the file explorer. The native dialog, ZIP, and WebP fallback serve existing storage or artwork workflows. Installer sizes, WebView runtime size, and Linux builds were outside this Windows measurement.

## Prioritized findings

1. **Startup artwork cleanup is the largest measured scaling cost.** Tauri setup runs it synchronously before mounting the app. It checks every generated artwork file for references in the album and Undo tables, and those lookups lack an artwork index. At 2,000 albums cleanup took 83 ms in the optimized harness and 314 ms in debug. Measure changes against the same fixtures and preserve the writer lock and Undo artwork retention.
2. **Library load does more work than the SQLite query alone suggests.** Startup checks restored preferences before mounting React. The library read queries owned/wishlist separately, then the frontend waits for pending-deletion IPC before showing albums. At 2,000 albums the synthetic JSON was 634 kB before transport. Measure that startup sequence in the release WebView before changing queries or payloads.
3. **Keep Collection pagination and profile the shelf drag loop in the browser.** Collection renders 25 cards and the tested full-list derivation is 2.4 ms at 2,000 albums. The open crate view renders every member, so profile a large crate separately. Shelf drag already skips IPC until drop. Pointer frames still do repeated hit tests and layout reads, and changes in hovered slot rerender the grid and embedded Collection. Shelf and grid also build their own album/placement maps. Compare frame times on regular and legacy oversized shelves before tuning.
4. **Artwork memory and decoding need a browser trace.** Covers use lazy loading and immutable URLs. Spine sampling performs a separate native read and decode, limits concurrency to four, and caches up to 4,096 palette results. Visible work already queued can finish after navigating away, and cache hits can trigger an extra spine render. Object URLs, observers, and drag listeners have cleanup paths in the reviewed code. No memory leak was verified. Track action-to-paint and retained memory across repeated shelf visits before removing or changing caches.

Windows end-to-end time to first render and Linux timings remain unmeasured. The local Windows Tauri test executable stopped before tests with loader error `0xc0000139`. The frontend build, 52 frontend tests, Rust formatting, Clippy, and 54 isolated Rust tests passed.

## Reproduce

### Frontend rendering follow-up

Production React in headless Edge updated the favorite flag of one visible album with a new album object and a fresh containing array. Every other album and callback kept its identity. The fixture used 25 visible cards, synthetic artwork filenames, and a stub for Tauri's artwork URL conversion. Timings are medians of 101 synchronous React/DOM updates after 30 warm-ups. The derivation column uses the same search, sort, grouping and pagination workload as the baseline.

| Albums | Card update before → after (ms) | Search derivation before → after (ms) |
| ---: | ---: | ---: |
| 100 | 0.7 → 0.2 | 0.072 → 0.064 |
| 500 | 0.8 → 0.2 | 0.448 → 0.444 |
| 1,000 | 0.8 → 0.2 | 1.004 → 0.928 |
| 2,000 | 0.7 → 0.2 | 2.144 → 2.036 |

Each run made 2,525 artwork URL conversions before the change and zero during the timed updates afterward. URL conversions count repeated rendering work. Browser paint, real artwork decoding, native IPC, and memory usage were outside this measurement.

### Shelves and artwork follow-up

Production React in headless Edge rendered a fully occupied grid from 2,000 generated albums. For each grid size, 30 warm-ups and 101 timed updates alternated the hovered cell, swapped the first two placements, or added and removed one column. Values are median synchronous React and DOM update times. The resize fixture exercises rendering only. Actual shelf edits still use the existing Save command and backend occupancy checks.

| Shelf | Hover before → after (ms) | Swap before → after (ms) | Resize before → after (ms) |
| --- | ---: | ---: | ---: |
| 5×5 | 0.2 → 0.1 | 0.3 → 0.1 | 0.2 → 0.1 |
| 10×10 | 0.8 → 0.1 | 0.6 → 0.2 | 0.6 → 0.2 |

Unchanged cells reuse their rendered content. Drag tracking schedules frames for pointer movement, scrolling, or resize, and continues while auto-scrolling changes position. Pointer frames perform one hit test in the usual case and repeat it after a scroll changes the target. Shelf writes still happen only on completed actions.

Spine requests sharing a filename share one read and decode. Unmounting cancels queued work once its final consumer leaves. The cache stores palette results only. In-flight work finishes and releases the blob URL, image source, and canvas. Rust preallocates the bounded read buffer from file metadata. These changes were checked with a queued-read regression test. Browser paint, real decoding time, memory usage, and native drag-to-commit latency were outside the grid benchmark.

### Backend follow-up

Normal startup uses two native requests, down from four. The restored-preferences check still precedes React initialization. One background request supplies the library, profile, and recoverable deletions, with separate results so each failure keeps its existing handling. Album and profile retries use their dedicated commands. The library query reads both ownership groups in one SQLite statement and preserves row order within each group. It still returns the full library because collection search, statistics, crates, and shelves use it.

SQLite's query plan showed a table scan for each branch of the old artwork reference lookup, repeated for each managed file. Cleanup now scans albums and Undo once and holds a set of valid referenced filenames while walking the artwork directory. The writer transaction covers reference collection and deletion. The set uses memory proportional to the number of distinct covers and is dropped before startup completes. The library query plan shows one ordered table scan. Neither change requires an index or changes the schema accepted by backup restore.

The same Windows release harness and generated fixture described below compared the starting branch revision `c703112` with this change. Values are medians in milliseconds. The standalone library JSON size was identical, including 633,587 bytes at 2,000 albums. These are backend timings and exclude WebView startup and IPC transport.

| Albums | Artwork cleanup before → after (ms) | Library read before → after (ms) |
| ---: | ---: | ---: |
| 100 | 1.838 → 1.058 | 0.474 → 0.354 |
| 500 | 10.176 → 1.338 | 1.076 → 0.922 |
| 1,000 | 26.743 → 2.424 | 1.865 → 1.762 |
| 2,000 | 99.136 → 3.960 | 3.554 → 2.810 |

CSV export uses a buffered writer and decodes one album at a time. The storage lock stays held during export to preserve the snapshot on the existing connection, so exporting to a slow drive can delay other storage operations. Duplicate detection reads only IDs, titles, artists, and formats. Legacy migration streams source albums using its existing read-only connection. The separate writer connection during relocation still protects the online backup snapshot against concurrent writes.

The npm opener package had no source imports and was removed. Every direct Cargo dependency has a source or build-script use. The Rust opener and native dialog plugins support storage workflows. No new dependencies or toolchains were used.

The release profile uses `opt-level = "s"` and retains fat LTO, one codegen unit, stripping, and the existing abort-on-panic behavior. Fat LTO and one codegen unit trade build time for cross-crate optimization. Stripping limits release symbol diagnostics, and abort-on-panic terminates the process without unwinding. Debug settings remain available for diagnostics. The Rust timing harness uses Cargo's default optimization level, so its timings measure source changes and do not establish the speed of the size-optimized Tauri build. [Cargo release profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) · [Tauri app size guidance](https://tauri.app/concept/size/)

The Windows GNU release executable with the embedded frontend went from 7,771,648 bytes (7.41 MiB) at `c703112` to 5,285,376 bytes (5.04 MiB), a 32.0% reduction across the backend and profile changes. The final uncompressed Vite output was 693,637 bytes. Installer sizes, Linux builds, end-to-end startup latency, and WebView memory usage were outside this measurement. The local environment had no configured installer tools or Linux runtime.

## Phase 3 verification

The Windows backend harness reran the same generated fixtures against `c703112` and `f8731a5`. Each cell shows the before and after medians in milliseconds. Storage reopen and cleanup are timed separately. The check excludes WebView launch, React mount, and IPC transport.

| Albums | Storage reopen | Artwork cleanup | Library read | 10×10 shelf load | Shelf swap commit |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 3.045 → 2.917 | 2.057 → 1.058 | 0.485 → 0.413 | 0.474 → 0.421 | 6.564 → 6.413 |
| 500 | 3.080 → 3.073 | 10.457 → 1.755 | 1.190 → 1.050 | 0.487 → 0.430 | 6.888 → 6.578 |
| 1,000 | 3.740 → 2.999 | 31.159 → 2.459 | 2.413 → 1.872 | 0.460 → 0.488 | 6.565 → 6.607 |
| 2,000 | 3.346 → 3.159 | 104.890 → 3.901 | 3.622 → 3.224 | 0.466 → 0.458 | 6.544 → 6.561 |

The Node/Vite static markup benchmark below reran against the original baseline `1d498eb` and the final frontend using the same installed dependencies. Each cell shows before and after medians in milliseconds. Initial markup timings were mixed across fixture sizes. The earlier headless browser follow-ups measured updates to an already mounted collection and shelf.

| Albums | Search derivation | Collection markup | 5×5 shelf markup | 10×10 shelf markup |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 0.098 → 0.113 | 1.683 → 2.391 | 0.224 → 0.276 | 0.780 → 0.744 |
| 500 | 0.584 → 0.523 | 2.201 → 1.785 | 0.170 → 0.167 | 0.483 → 0.445 |
| 1,000 | 1.329 → 1.105 | 2.035 → 1.780 | 0.333 → 0.174 | 0.655 → 0.613 |
| 2,000 | 3.222 → 2.719 | 1.856 → 1.740 | 0.398 → 0.327 | 0.675 → 0.754 |

Headless Edge ran the production frontend with in-memory Tauri responses at all four album counts. It verified Collection navigation, next-page results, search and clear, Wishlist, Favorites, Statistics, and opening a crate and viewing its members. It also renamed a 10×10 shelf with 90 placements, drove the pointer swap handlers with synthetic events, and undid the swap. Each fixture then completed eight cycles of opening album details, encoding and saving replacement artwork through the IPC stub, closing the modal, and revisiting Shelves and Favorites. There were zero live blob URLs and no open dialog or drag preview after each cycle. Browser pointer capture was stubbed for synthetic events. The Rust tests exercised the real SQLite writes, artwork validation, replacement and cleanup.

The same Edge fixture recorded four startup IPC requests on `1d498eb` and two on the final build. DevTools reported the following JavaScript heap sizes after forced garbage collection, in bytes, immediately before and after the eight cycles on Favorites. These are single runs. The final build started with less heap and ended with slightly more than the baseline at each size. The two snapshots do not establish a continuing leak.

| Albums | Baseline before → after | Final before → after |
| ---: | ---: | ---: |
| 100 | 2,825,972 → 3,074,856 | 2,718,296 → 3,138,828 |
| 500 | 3,058,460 → 3,246,652 | 2,901,056 → 3,301,696 |
| 1,000 | 3,126,324 → 3,306,444 | 2,966,936 → 3,356,828 |
| 2,000 | 3,268,484 → 3,442,060 | 3,101,012 → 3,479,036 |

The Windows release file length was rechecked at 5,285,376 bytes, compared with 7,771,648 bytes for the pre-backend branch build and 7,770,624 bytes for the original baseline. Installer size, native WebView memory, and end-to-end desktop startup remain unmeasured.

**Local checks.** The frontend production build and 53 frontend tests passed. Rust formatting and Clippy with warnings denied passed. The isolated Rust harness passed 54 tests covering persistence, migration, placement conflicts and Undo, artwork, CSV round trips, and backup/restore and relocation. The full Windows GNU Tauri test executable compiled and then stopped before running tests with `0xC0000139` (`STATUS_ENTRYPOINT_NOT_FOUND`). This remains environment-blocked. No loader troubleshooting or software installation was performed.

**CI.** GitHub Actions status is tracked on the pull request separately from these local results.

### Baseline commands

Run from the repository root with the locked frontend and Rust dependencies available. For the build sizes, use `npm run build`, then run `cargo build --locked --offline --bin hakoto` and `cargo build --locked --offline --release --features tauri/custom-protocol` from `src-tauri`. Inspect the executables with `objdump -h` and use file lengths for artifact sizes.

<details>
<summary>Frontend benchmark using the existing React and Vite dependencies</summary>

Run the code below from the repository root with `NODE_ENV=production`, piping it to `node --input-type=module`. Output columns are album count, derivation, Collection, 5×5 ShelfGrid and 10×10 ShelfGrid.

```js
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } });
try {
  const { default: Collection } = await vite.ssrLoadModule("/src/pages/Collection.tsx");
  const { default: ShelfGrid } = await vite.ssrLoadModule("/src/components/ShelfGrid.tsx");
  const { getVisibleAlbums, groupVisibleAlbums, paginateAlbums } =
    await vite.ssrLoadModule("/src/collectionView.ts");
  const noop = () => {};
  const props = {
    profile: { displayName: "", profilePicture: null }, alphabeticalDividers: false,
    loadStatus: "ready", onRetry: noop, onAdd: noop, onUpdate: noop, onDelete: noop
  };
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  function measure(run, batch = 1) {
    for (let i = 0; i < 20; i++) run();
    return median(Array.from({ length: 31 }, () => {
      const start = performance.now();
      for (let i = 0; i < batch; i++) run();
      return (performance.now() - start) / batch;
    })).toFixed(3);
  }
  for (const count of [100, 500, 1000, 2000]) {
    const formats = ["CD", "Vinyl", "Cassette", "Digital (FLAC)"];
    const albums = Array.from({ length: count }, (_, i) => ({
      id: String(i), title: `${String.fromCharCode(65 + i % 26)} Album ${(i * 7919) % count}`,
      artist: `Artist ${i % 173}`, format: formats[i % formats.length],
      ownership: "owned", pinned: i % 20 === 0, favorite: i % 5 === 0,
      artwork: null, releaseYear: i % 7 === 0 ? null : 1950 + i % 75
    }));
    const renderGrid = edge => {
      const shelf = { id: 1, name: "Shelf", rows: edge, columns: edge, orientation: "vertical" };
      const placements = albums.slice(0, edge ** 2).map(({ id }, i) => (
        { shelfId: 1, row: Math.floor(i / edge), column: i % edge, albumId: id }
      ));
      const grid = createElement(ShelfGrid, { albums, shelf, placements });
      return () => renderToStaticMarkup(grid);
    };
    const collection = () => renderToStaticMarkup(createElement(Collection, { ...props, albums }));
    const derive = () => {
      const matches = getVisibleAlbums(albums, { query: "album", formats: [], sort: "title-asc" });
      return paginateAlbums(groupVisibleAlbums(matches, "title-asc", false).flatMap(group => group.albums), 0, 25);
    };
    if ((collection().match(/class="album-card"/g) ?? []).length !== 25) throw Error("Unexpected page size");
    console.log(count, measure(derive, 25), measure(collection), measure(renderGrid(5)), measure(renderGrid(10)));
  }
} finally {
  await vite.close();
}
```

</details>

<details>
<summary>Rust harness and generated artwork fixture</summary>

Generate the cover with FFmpeg and save it outside the app data folders.

```sh
ffmpeg -v error -f lavfi -i "testsrc2=size=500x500:rate=1" -frames:v 1 -c:v libwebp -quality 80 cover.webp
```

Save this manifest as `src-tauri/target/performance-repro/Cargo.toml` so the harness can import the real application modules and stays out of version control.

```toml
[package]
name = "hakoto-perf"
version = "0.0.0"
edition = "2024"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "=1.0.154"
rusqlite = { version = "=0.41.1", features = ["bundled", "backup"] }
fs4 = "=1.1.0"
tempfile = "=3.27.0"
dunce = "=1.0.5"

[[bin]]
name = "hakoto-perf"
path = "main.rs"
```

Save the following as `main.rs` alongside the manifest. Build with `cargo build --manifest-path src-tauri/target/performance-repro/Cargo.toml --target-dir src-tauri/target --bin hakoto-perf`. Run `src-tauri/target/debug/hakoto-perf.exe cover.webp` on Windows or the same path without `.exe` on Linux. For optimized Rust timings add `--release` and run the executable under `target/release`. Output columns are album count, reopen, cleanup, library read, JSON encode, JSON bytes, shelf load, swap, artwork read, and query plan.

```rust
#![allow(dead_code)]
#[path = "../../src/artwork.rs"]
mod artwork;
#[path = "../../src/crates.rs"]
mod crates;
#[path = "../../src/database.rs"]
mod database;
#[path = "../../src/metadata.rs"]
mod metadata;
#[path = "../../src/profile.rs"]
mod profile;
#[path = "../../src/shelves.rs"]
mod shelves;
#[path = "../../src/storage.rs"]
mod storage;
#[path = "../../src/undo.rs"]
mod undo;

use rusqlite::params;
use std::{fs, time::Instant};

fn measure(mut operation: impl FnMut(), batch: u32) -> f64 {
    for _ in 0..10 {
        operation();
    }
    let mut results: Vec<_> = (0..31)
        .map(|_| {
            let start = Instant::now();
            for _ in 0..batch {
                operation();
            }
            start.elapsed().as_secs_f64() * 1000.0 / f64::from(batch)
        })
        .collect();
    results.sort_by(f64::total_cmp);
    results[results.len() / 2]
}

fn main() {
    let fixture = std::env::args_os().nth(1).expect("WebP fixture");
    let bytes = fs::read(fixture).unwrap();
    assert!(artwork::validate(&bytes));
    println!("webp_bytes={}", bytes.len());
    for count in [100, 500, 1000, 2000] {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path();
        let mut store = storage::Storage::open(path, None).unwrap();
        let art = artwork::ensure_directory(path, storage::ARTWORK_DIRECTORY).unwrap();
        let tx = store.connection.transaction().unwrap();
        for i in 0..count {
            let name = format!("{i:032x}.webp");
            if i % 5 != 0 {
                fs::write(art.join(&name), &bytes).unwrap();
            }
            tx.execute(
                "INSERT INTO albums (id,title,artist,format,release_year,ownership,artwork)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    i.to_string(),
                    format!("Album {}", (i * 7919) % count),
                    format!("Artist {}", i % 173),
                    ["CD", "Vinyl", "Cassette", "Digital (FLAC)"][i % 4],
                    (i % 7 != 0).then_some((1950 + i % 75) as i64),
                    if i % 10 == 0 { "wishlist" } else { "owned" },
                    (i % 5 != 0).then_some(name)
                ],
            )
            .unwrap();
        }
        tx.execute(
            "INSERT INTO shelves VALUES (1,'Shelf',10,10,'vertical')",
            [],
        )
        .unwrap();
        for i in 0..90 {
            let id = i + 1 + i / 9;
            tx.execute(
                "INSERT INTO shelf_placements VALUES (1,?1,?2,?3)",
                params![i / 10, i % 10, id.to_string()],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let library = database::get_album_library(&mut store.connection).unwrap();
        let json_bytes = serde_json::to_vec(&library).unwrap().len();
        let plan = store
            .connection
            .query_row(
                "EXPLAIN QUERY PLAN SELECT id FROM albums WHERE ownership = 'owned' ORDER BY rowid",
                [],
                |row| row.get::<_, String>(3),
            )
            .unwrap();
        let read = measure(
            || {
                std::hint::black_box(database::get_album_library(&mut store.connection).unwrap());
            },
            10,
        );
        let json = measure(
            || {
                std::hint::black_box(serde_json::to_vec(&library).unwrap());
            },
            10,
        );
        let shelf = measure(
            || {
                std::hint::black_box(shelves::load_shelf(&mut store.connection, 1).unwrap());
            },
            10,
        );
        let mut reverse = true;
        let swap = measure(
            || {
                let (left, right) = if reverse { ("2", "1") } else { ("1", "2") };
                let changes = vec![
                    shelves::PlacementChange::Set {
                        row: 0,
                        column: 0,
                        album_id: left.into(),
                    },
                    shelves::PlacementChange::Set {
                        row: 0,
                        column: 1,
                        album_id: right.into(),
                    },
                ];
                shelves::update_placements_checked(&mut store.connection, 1, changes, None)
                    .unwrap();
                reverse = !reverse;
            },
            1,
        );
        let image = measure(
            || {
                for i in 1..=10 {
                    if i % 5 != 0 {
                        std::hint::black_box(
                            artwork::read_checked(path, &format!("{i:032x}.webp")).unwrap(),
                        );
                    }
                }
            },
            1,
        ) / 8.0;
        drop(store);
        let open = measure(
            || {
                drop(storage::Storage::open(path, None).unwrap());
            },
            1,
        );
        let mut store = storage::Storage::open(path, None).unwrap();
        let cleanup = measure(
            || {
                database::clean_orphaned_artwork(&mut store.connection, path).unwrap();
            },
            1,
        );
        println!(
            "{count} {open:.3} {cleanup:.3} {read:.3} {json:.3} {json_bytes} {shelf:.3} {swap:.3} {image:.3} {plan}"
        );
    }
}
```

</details>
