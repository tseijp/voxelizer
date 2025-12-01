use wasm_bindgen::prelude::*;

mod utils;
mod camera;
mod chunk;
mod mesh;
mod queue;
mod region;
mod slot;

pub use camera::Camera;
pub use camera::create_camera as createCamera;
pub use chunk::greedy_mesh as greedyMesh;
pub use mesh::Mesh;
pub use mesh::create_mesh as createMesh;
pub use queue::Queues;
pub use queue::create_queues as createQueues;
pub use region::{ Regions, create_regions as createRegions };
pub use slot::{ Slots, create_slots as createSlots };
#[wasm_bindgen]
pub fn range(n: u32) -> js_sys::Array {
    utils::range(n)
}

#[wasm_bindgen]
pub fn ROW() -> i32 {
    utils::ROW
}

#[wasm_bindgen]
pub fn REGION() -> i32 {
    utils::REGION
}

#[wasm_bindgen]
pub fn SLOT() -> i32 {
    utils::SLOT
}

#[wasm_bindgen]
pub fn SCOPE() -> js_sys::Object {
    utils::scope_js()
}
