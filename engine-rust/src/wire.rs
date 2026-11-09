use crate::analysis::Position;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Invalid(pub &'static str);

pub(crate) type WireResult<T> = Result<T, Invalid>;

fn string_width(length: i32) -> WireResult<usize> {
    let width = if length < 0 {
        i64::from(length).unsigned_abs() * 2
    } else {
        length as u64
    };
    if width > 65_536 {
        return Err(Invalid("Longitud de cadena inválida."));
    }
    Ok(width as usize)
}

fn decode_string(data: &[u8], wide: bool) -> String {
    if wide {
        let units = data
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]));
        let mut units: Vec<_> = units.collect();
        if units.last() == Some(&0) {
            units.pop();
        }
        String::from_utf16_lossy(&units)
            .trim_matches(' ')
            .to_owned()
    } else {
        String::from_utf8_lossy(data.strip_suffix(&[0]).unwrap_or(data))
            .trim_matches(' ')
            .to_owned()
    }
}

pub(crate) fn packed(mut next: impl FnMut() -> WireResult<u8>) -> WireResult<u32> {
    let mut value = 0;
    for shift in (0..35).step_by(7) {
        let byte = next()?;
        value |= u32::from(byte >> 1) << shift;
        if byte & 1 == 0 {
            return Ok(value);
        }
    }
    // Unreal consumes at most five octets even for overflowing representations.
    Ok(value)
}

pub(crate) struct Bytes<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Bytes<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }
    pub(crate) fn left(&self) -> usize {
        self.data.len() - self.pos
    }
    pub(crate) fn take(&mut self, count: usize) -> WireResult<&'a [u8]> {
        if count > self.left() {
            return Err(Invalid("Bloque de bytes truncado."));
        }
        let start = self.pos;
        self.pos += count;
        Ok(&self.data[start..self.pos])
    }
    pub(crate) fn skip(&mut self, count: usize) -> WireResult<()> {
        self.take(count).map(|_| ())
    }
    pub(crate) fn u8(&mut self) -> WireResult<u8> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u32(&mut self) -> WireResult<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(crate) fn i32(&mut self) -> WireResult<i32> {
        Ok(self.u32()? as i32)
    }
    pub(crate) fn u64(&mut self) -> WireResult<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub(crate) fn f32(&mut self) -> WireResult<f32> {
        Ok(f32::from_bits(self.u32()?))
    }
    pub(crate) fn packed(&mut self) -> WireResult<u32> {
        packed(|| self.u8())
    }
    pub(crate) fn string(&mut self) -> WireResult<String> {
        let length = self.i32()?;
        Ok(decode_string(self.take(string_width(length)?)?, length < 0))
    }
    pub(crate) fn skip_string(&mut self) -> WireResult<()> {
        let length = self.i32()?;
        self.skip(string_width(length)?)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Bits<'a> {
    data: &'a [u8],
    pos: usize,
    end: usize,
}

impl<'a> Bits<'a> {
    pub(crate) fn new(data: &'a [u8], len: usize) -> Self {
        debug_assert!(len <= data.len() * 8);
        Self {
            data,
            pos: 0,
            end: len,
        }
    }
    pub(crate) fn left(&self) -> usize {
        self.end - self.pos
    }

    pub(crate) fn slice(&mut self, count: usize) -> WireResult<Self> {
        if count > self.left() {
            return Err(Invalid("Bloque de bits truncado."));
        }
        let start = self.pos;
        self.pos += count;
        Ok(Self {
            data: self.data,
            pos: start,
            end: self.pos,
        })
    }

    pub(crate) fn skip(&mut self, count: usize) -> WireResult<()> {
        self.slice(count).map(|_| ())
    }

    pub(crate) fn bit(&mut self) -> WireResult<bool> {
        if self.pos == self.end {
            return Err(Invalid("Bit fuera del bloque."));
        }
        let set = (self.data[self.pos >> 3] >> (self.pos & 7)) & 1 != 0;
        self.pos += 1;
        Ok(set)
    }

    pub(crate) fn read(&mut self, count: usize) -> WireResult<u64> {
        if count > 64 || count > self.left() {
            return Err(Invalid("Entero fuera del bloque de bits."));
        }
        if count == 0 {
            return Ok(0);
        }
        let byte = self.pos >> 3;
        let shift = self.pos & 7;
        let needed = (count + shift).div_ceil(8);
        let mut low = [0; 8];
        let lower = needed.min(8);
        low[..lower].copy_from_slice(&self.data[byte..byte + lower]);
        let mut value = u64::from_le_bytes(low) >> shift;
        if needed == 9 {
            value |= u64::from(self.data[byte + 8]) << (64 - shift);
        }
        self.pos += count;
        Ok(if count == 64 {
            value
        } else {
            value & ((1u64 << count) - 1)
        })
    }

    pub(crate) fn u8(&mut self) -> WireResult<u8> {
        if self.left() < 8 {
            return Err(Invalid("Byte fuera del bloque."));
        }
        let byte = self.pos >> 3;
        let shift = self.pos & 7;
        self.pos += 8;
        if shift == 0 {
            Ok(self.data[byte])
        } else {
            Ok((self.data[byte] >> shift) | (self.data[byte + 1] << (8 - shift)))
        }
    }

    pub(crate) fn u16(&mut self) -> WireResult<u16> {
        Ok(self.read(16)? as u16)
    }
    pub(crate) fn u32(&mut self) -> WireResult<u32> {
        Ok(self.read(32)? as u32)
    }
    pub(crate) fn packed(&mut self) -> WireResult<u32> {
        packed(|| self.u8())
    }

    pub(crate) fn serialized(&mut self, max: u32) -> WireResult<u32> {
        if max.is_power_of_two() {
            return Ok(self.read(max.trailing_zeros() as usize)? as u32);
        }
        let mut value = 0;
        let mut mask = 1;
        while value + mask < max {
            if self.bit()? {
                value |= mask;
            }
            mask *= 2;
        }
        Ok(value)
    }

    pub(crate) fn string(&mut self) -> WireResult<String> {
        let length = self.u32()? as i32;
        let count = string_width(length)?;
        if count > self.left() / 8 {
            return Err(Invalid("Cadena fuera del bloque de bits."));
        }
        if self.pos & 7 == 0 {
            let start = self.pos >> 3;
            self.pos += count * 8;
            Ok(decode_string(&self.data[start..start + count], length < 0))
        } else {
            let data = (0..count)
                .map(|_| self.u8())
                .collect::<WireResult<Vec<_>>>()?;
            Ok(decode_string(&data, length < 0))
        }
    }

    pub(crate) fn append_to(mut self, bytes: &mut Vec<u8>) -> WireResult<()> {
        bytes.reserve(self.left().div_ceil(8));
        while self.left() >= 8 {
            bytes.push(self.u8()?);
        }
        if self.left() > 0 {
            bytes.push(self.read(self.left())? as u8);
        }
        Ok(())
    }

    pub(crate) fn quantized_vector(&mut self, scale: f64) -> WireResult<Position> {
        let spec = self.serialized(128)?;
        let bits = (spec & 63) as usize;
        let scaled = spec & 64 != 0;
        if bits == 0 {
            return self.vector(scaled);
        }
        let sign = 1u64 << (bits - 1);
        let mut component = || {
            let value = ((self.read(bits)? ^ sign) as i64 - sign as i64) as f64;
            Ok(if scaled { value / scale } else { value })
        };
        Ok(Position::new(component()?, component()?, component()?))
    }

    pub(crate) fn vector(&mut self, double: bool) -> WireResult<Position> {
        let mut component = || {
            if double {
                Ok(f64::from_bits(self.read(64)?))
            } else {
                Ok(f32::from_bits(self.u32()?) as f64)
            }
        };
        Ok(Position::new(component()?, component()?, component()?))
    }
}

pub(crate) fn path_tail(path: &str) -> &str {
    match path.rfind(['.', '/']) {
        Some(i) if path.as_bytes()[i] == b'.' => &path[i + 1..],
        Some(_) => path,
        None => path.strip_prefix("Default__").unwrap_or(path),
    }
}

pub(crate) fn hex(bytes: &[u8], upper: bool) -> String {
    let digits = if upper {
        b"0123456789ABCDEF"
    } else {
        b"0123456789abcdef"
    };
    let mut result = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        result.push(char::from(digits[(byte >> 4) as usize]));
        result.push(char::from(digits[(byte & 15) as usize]));
    }
    result
}
