mod analysis;
mod names;
mod network;
mod wire;

use aes::cipher::{Block, BlockDecrypt, KeyInit};
use aes::{Aes128, Aes192, Aes256};
use network::Network;
use oozextract::Extractor;
use wire::{Bytes, Invalid, WireResult, hex};

pub use analysis::Analysis;

const MAX_REPLAY: usize = 128 * 1024 * 1024;
const MAX_CHUNK: usize = 64 * 1024 * 1024;

pub fn analyze(bytes: &[u8]) -> Analysis {
    let mut result = Analysis::default();
    result.status = "unsupported";
    let mut network = None;
    let parsed = read(bytes, &mut result, &mut network);
    if let Some(network) = &network {
        network.finish(&mut result);
    }
    match parsed {
        Ok(false) => {
            result.legacy_required = true;
            result.detail = Some("Versión fuera de la cobertura del motor Rust.");
        }
        Ok(true)
            if result.frames == 0
                || !network.as_ref().is_some_and(Network::saw_activity_schema) =>
        {
            result.detail = Some("No se reconoció el flujo de cofres en esta grabación.");
        }
        Ok(true) if result.skipped_packets > 0 => {
            result.status = "partial";
            result.detail = Some("Algunos bloques de red no se pudieron decodificar.");
        }
        Ok(true) => result.status = "complete",
        Err(error) => {
            result.status = if result.frames == 0 {
                "error"
            } else {
                "partial"
            };
            result.detail = Some(error.0);
        }
    }
    result
}

fn read(bytes: &[u8], result: &mut Analysis, network: &mut Option<Network>) -> WireResult<bool> {
    if !(8..=MAX_REPLAY).contains(&bytes.len()) {
        return Err(Invalid(
            "Tamaño inválido. El límite por repetición es 128 MiB.",
        ));
    }
    let mut file = Bytes::new(bytes);
    if file.u32()? != 0x1ca2_e27f {
        return Err(Invalid(
            "La firma no corresponde a un archivo .replay de Unreal.",
        ));
    }
    let version = file.u32()?;
    result.file_version = Some(version);
    if version != 7 {
        return Ok(false);
    }
    custom_versions(&mut file)?;
    result.duration_ms = Some(file.u32()?);
    file.u32()?; // Replay file network version.
    result.build = Some(file.u32()?);
    file.skip_string()?;
    let live = file.u32()? != 0;
    result.recorded_at = recorded_at(file.u64()?);
    let compressed = file.u32()? != 0;
    let encrypted = file.u32()? != 0;
    let key_len = file.u32()? as usize;
    if key_len > 32 {
        return Err(Invalid("La clave AES del replay es inválida."));
    }
    let key = file.take(key_len)?;
    if encrypted && live {
        return Err(Invalid(
            "La grabación sigue en curso y todavía no tiene una clave utilizable.",
        ));
    }
    let decryptor = if encrypted {
        Some(Decryptor::new(key)?)
    } else {
        None
    };
    result.compressed = Some(compressed);
    result.encrypted = Some(encrypted);

    let mut extractor = None;
    let mut plain = Vec::new();
    let mut decoded = Vec::new();
    while file.left() > 0 {
        let kind = file.u32()?;
        let size = file.u32()? as usize;
        let mut chunk = Bytes::new(file.take(size)?);
        match kind {
            0 => {
                let Some(flags) = read_header(&mut chunk, result)? else {
                    return Ok(false);
                };
                *network = Some(Network::new(flags, result.build == Some(59_594_394)));
            }
            1 => {
                let Some(network) = network.as_mut() else {
                    continue;
                };
                chunk.skip(8)?; // Time bounds in milliseconds.
                let size = chunk.u32()? as usize;
                chunk.skip(4)?; // Uncompressed allocation hint.
                if size == 0 || size > MAX_CHUNK {
                    return Err(Invalid("Tamaño de bloque de red inválido."));
                }
                let input = chunk.take(size)?;
                let data = if let Some(decryptor) = &decryptor {
                    plain.clear();
                    plain.extend_from_slice(input);
                    decryptor.decrypt(&mut plain)?
                } else {
                    input
                };
                if compressed {
                    let mut block = Bytes::new(data);
                    let unpacked = block.u32()? as usize;
                    let packed = block.u32()? as usize;
                    if unpacked == 0 || unpacked > MAX_CHUNK || packed == 0 {
                        return Err(Invalid("Tamaño de compresión Oodle inválido."));
                    }
                    decoded.resize(unpacked, 0);
                    let count = extractor
                        .get_or_insert_with(Extractor::new)
                        .read_from_slice(block.take(packed)?, &mut decoded)
                        .map_err(|_| Invalid("Bloque Mermaid inválido o incompatible."))?;
                    if count != unpacked {
                        return Err(Invalid("Tamaño descomprimido incorrecto."));
                    }
                    network.read_frames(&decoded, result)?;
                } else {
                    network.read_frames(data, result)?;
                }
            }
            3 => {
                chunk.skip_string()?; // Event id.
                let group = chunk.string()?;
                let meta = chunk.string()?;
                if result.events.len() < 100 && group.len() < 160 && meta.len() < 160 {
                    result.events.insert(if meta.is_empty() {
                        group
                    } else {
                        format!("{group}/{meta}")
                    });
                }
            }
            _ => {} // Checkpoints and optional chunks.
        }
    }
    Ok(network.is_some())
}

fn custom_versions(file: &mut Bytes<'_>) -> WireResult<()> {
    let count = file.u32()? as usize;
    if count > 128 {
        return Err(Invalid("Lista de versiones del contenedor inválida."));
    }
    file.skip(count * 20)
}

fn read_header(file: &mut Bytes<'_>, result: &mut Analysis) -> WireResult<Option<u32>> {
    if file.u32()? != 0x2cf5_a13d {
        return Err(Invalid("Firma de cabecera de red inválida."));
    }
    let version = file.u32()?;
    result.network_version = Some(version);
    if version != 19 {
        return Ok(None);
    }
    custom_versions(file)?;
    file.u32()?; // Network checksum.
    let engine = file.u32()?;
    result.engine_network_version = Some(engine);
    file.u32()?; // Game network protocol.
    let guid = file.take(16)?;
    result.guid = guid.iter().any(|b| *b != 0).then(|| hex(guid, true));
    file.skip(10)?; // Engine semantic version and changelist.
    result.branch = Some(file.string()?);
    if engine != 45 || result.branch.as_deref() != Some("++Fortnite+Release-43.00") {
        return Ok(None);
    }
    file.skip(12)?; // UE4, UE5 and licensee package versions.
    let levels = file.u32()?;
    if levels > 4096 {
        return Err(Invalid("Lista de niveles de cabecera inválida."));
    }
    for _ in 0..levels {
        file.skip_string()?;
        file.skip(4)?;
    }
    Ok(Some(file.u32()?))
}

fn recorded_at(binary: u64) -> Option<String> {
    let ticks = binary & 0x3fff_ffff_ffff_ffff;
    if ticks == 0 {
        return None;
    }
    let seconds = (ticks / 10_000_000) as i64 - 62_135_596_800;
    let date = time::OffsetDateTime::from_unix_timestamp(seconds).ok()?;
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
        date.year(),
        u8::from(date.month()),
        date.day(),
        date.hour(),
        date.minute(),
        date.second()
    ))
}

enum Decryptor {
    A128(Aes128),
    A192(Aes192),
    A256(Aes256),
}

impl Decryptor {
    fn new(key: &[u8]) -> WireResult<Self> {
        match key.len() {
            16 => Aes128::new_from_slice(key).map(Self::A128),
            24 => Aes192::new_from_slice(key).map(Self::A192),
            32 => Aes256::new_from_slice(key).map(Self::A256),
            _ => return Err(Invalid("La clave AES del replay es inválida.")),
        }
        .map_err(|_| Invalid("La clave AES del replay es inválida."))
    }

    fn decrypt<'a>(&self, data: &'a mut [u8]) -> WireResult<&'a [u8]> {
        if data.is_empty() || data.len() % 16 != 0 {
            return Err(Invalid("Bloque AES incompleto."));
        }
        match self {
            Self::A128(cipher) => decrypt_blocks(cipher, data),
            Self::A192(cipher) => decrypt_blocks(cipher, data),
            Self::A256(cipher) => decrypt_blocks(cipher, data),
        }
        let padding = *data.last().unwrap() as usize;
        if !(1..=16).contains(&padding)
            || data[data.len() - padding..]
                .iter()
                .any(|b| usize::from(*b) != padding)
        {
            return Err(Invalid("Relleno AES inválido."));
        }
        Ok(&data[..data.len() - padding])
    }
}

fn decrypt_blocks<C>(cipher: &C, data: &mut [u8])
where
    C: BlockDecrypt + aes::cipher::BlockSizeUser<BlockSize = aes::cipher::consts::U16>,
{
    // RustCrypto can decrypt several blocks in one call (bitsliced software backend).
    let mut blocks = [Block::<C>::default(); 8];
    for batch in data.chunks_mut(16 * 8) {
        let count = batch.len() / 16;
        for (src, dst) in batch.chunks_exact(16).zip(&mut blocks) {
            dst.copy_from_slice(src);
        }
        cipher.decrypt_blocks(&mut blocks[..count]);
        for (src, dst) in blocks.iter().zip(batch.chunks_exact_mut(16)) {
            dst.copy_from_slice(src);
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use std::cell::RefCell;

    #[derive(Default)]
    struct Buffers {
        input: Vec<u8>,
        output: Vec<u8>,
    }

    thread_local! {
        static BUFFERS: RefCell<Buffers> = RefCell::new(Buffers::default());
    }

    // A worker calls prepare_input, fills that view, calls analyze_replay and copies
    // its JSON before starting the next request. The Wasm instance owns both buffers.
    #[unsafe(no_mangle)]
    extern "C" fn prepare_input(len: usize) -> *mut u8 {
        if len > super::MAX_REPLAY {
            return std::ptr::null_mut();
        }
        BUFFERS.with_borrow_mut(|buffers| {
            buffers.input.resize(len, 0);
            buffers.input.as_mut_ptr()
        })
    }

    #[unsafe(no_mangle)]
    extern "C" fn analyze_replay() -> u64 {
        BUFFERS.with_borrow_mut(|buffers| {
            let result = super::analyze(&buffers.input);
            buffers.output.clear();
            serde_json::to_writer(&mut buffers.output, &result)
                .expect("replay report serialization");
            (buffers.output.len() as u64) << 32 | buffers.output.as_ptr() as usize as u64
        })
    }
}
