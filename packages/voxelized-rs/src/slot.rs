use wasm_bindgen::prelude::*;use crate::utils::SLOT as SLOT_SZ;

#[wasm_bindgen]
pub fn slot_size()->i32{SLOT_SZ as i32}
