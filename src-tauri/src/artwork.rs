use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: usize = 1024 * 1024;
const MAX_EDGE: u32 = 500;

pub fn is_filename(name: &str) -> bool {
    name.strip_suffix(".webp").is_some_and(|stem| {
        stem.len() == 32
            && stem
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

pub fn directory(app_dir: &Path) -> io::Result<PathBuf> {
    directory_in(app_dir, "artwork")
}

pub fn directory_in(app_dir: &Path, folder: &str) -> io::Result<PathBuf> {
    let path = app_dir.canonicalize()?.join(folder);
    if path.canonicalize()? == path && path.is_dir() {
        Ok(path)
    } else {
        Err(io::Error::other("Invalid artwork directory"))
    }
}

pub fn validate(bytes: &[u8]) -> bool {
    if !(20..=MAX_BYTES).contains(&bytes.len())
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WEBP"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize != bytes.len() - 8
    {
        return false;
    }

    let mut chunks = &bytes[12..];
    let mut image = None;
    let mut canvas = None;
    while chunks.len() >= 8 {
        let size = u32::from_le_bytes(chunks[4..8].try_into().unwrap()) as usize;
        if size > chunks.len() - 8 || size + size % 2 > chunks.len() - 8 {
            return false;
        }
        let data = &chunks[8..8 + size];

        match &chunks[..4] {
            b"VP8 "
                if image.is_none()
                    && size > 10
                    && data[0] & 1 == 0
                    && data[3..6] == [0x9d, 0x01, 0x2a] =>
            {
                image = Some((
                    u32::from(u16::from_le_bytes([data[6], data[7]]) & 0x3fff),
                    u32::from(u16::from_le_bytes([data[8], data[9]]) & 0x3fff),
                ));
            }
            b"VP8L" if image.is_none() && size > 5 && data[0] == 0x2f && data[4] >> 5 == 0 => {
                let bits = u32::from_le_bytes(data[1..5].try_into().unwrap());
                image = Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1));
            }
            b"VP8X"
                if canvas.is_none()
                    && chunks.len() == bytes.len() - 12
                    && size == 10
                    && data[0] & 0x02 == 0 =>
            {
                let edge = |i| u32::from_le_bytes([data[i], data[i + 1], data[i + 2], 0]) + 1;
                canvas = Some((edge(4), edge(7)));
            }
            b"ALPH" | b"ICCP" | b"EXIF" | b"XMP " => {}
            _ => return false,
        }

        chunks = &chunks[8 + size + size % 2..];
    }

    chunks.is_empty()
        && image.is_some_and(|(width, height)| {
            (1..=MAX_EDGE).contains(&width)
                && (1..=MAX_EDGE).contains(&height)
                && canvas.is_none_or(|size| size == (width, height))
        })
}

pub fn write(app_dir: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    write_in(app_dir, "artwork", name, bytes)
}

pub fn write_in(app_dir: &Path, folder: &str, name: &str, bytes: &[u8]) -> io::Result<()> {
    if !is_filename(name) || !validate(bytes) {
        return Err(io::Error::other("Invalid WebP artwork"));
    }

    fs::create_dir_all(app_dir.join(folder))?;
    let directory = directory_in(app_dir, folder)?;
    let path = directory.join(name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    #[cfg(unix)]
    let result = result.and_then(|()| File::open(directory)?.sync_all());
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

pub fn read(app_dir: &Path, name: &str) -> Option<Vec<u8>> {
    read_checked(app_dir, name).ok()
}

pub fn read_checked(app_dir: &Path, name: &str) -> io::Result<Vec<u8>> {
    read_checked_in(app_dir, "artwork", name)
}

pub fn read_checked_in(app_dir: &Path, folder: &str, name: &str) -> io::Result<Vec<u8>> {
    if !is_filename(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid artwork filename",
        ));
    }

    let path = directory_in(app_dir, folder)?.join(name);
    if !path.symlink_metadata()?.is_file() || path.canonicalize()? != path {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid artwork path",
        ));
    }

    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if !validate(&bytes) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid WebP artwork",
        ));
    }
    Ok(bytes)
}
