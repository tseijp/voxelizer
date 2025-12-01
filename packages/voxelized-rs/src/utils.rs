use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Function, Promise };

pub const SCOPE_X0: i32 = 28;
pub const SCOPE_X1: i32 = 123;
pub const SCOPE_Y0: i32 = 75;
pub const SCOPE_Y1: i32 = 79;
pub const ROW: i32 = SCOPE_X1 - SCOPE_X0 + 1;
pub const SLOT: i32 = 16;
pub const CHUNK: i32 = 16;
pub const CACHE: i32 = 32;
pub const REGION: i32 = 256;
pub const PREFETCH: i32 = 16;
pub const ATLAS_URL: &str = "https://pub-a3916cfad25545dc917e91549e7296bc.r2.dev/v1";

pub fn off_of(i: i32, j: i32) -> (f32, f32, f32) {
    (((i - SCOPE_X0) * REGION) as f32, 0.0, ((SCOPE_Y1 - j) * REGION) as f32)
}
pub fn pos_of(pos: &[f32; 3]) -> (i32, i32) {
    (
        SCOPE_X0 + ((pos[0] / (REGION as f32)).floor() as i32),
        SCOPE_Y1 - ((pos[2] / (REGION as f32)).floor() as i32),
    )
}
pub fn region_id(i: i32, j: i32) -> i32 {
    i + ROW * j
}
pub fn chunk_id(i: i32, j: i32, k: i32) -> i32 {
    i + j * CHUNK + k * CHUNK * CHUNK
}

pub fn perspective(out: &mut [f32; 16], fovy: f32, aspect: f32, near: f32, far: f32) {
    let f = 1.0 / (0.5 * fovy).tan();
    out.fill(0.0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1.0;
    out[14] = (2.0 * far * near) / (near - far);
}
pub fn look_at(out: &mut [f32; 16], eye: [f32; 3], center: [f32; 3], up: [f32; 3]) {
    let (eyex, eyey, eyez) = (eye[0], eye[1], eye[2]);
    let (upx, upy, upz) = (up[0], up[1], up[2]);
    let (centerx, centery, centerz) = (center[0], center[1], center[2]);
    let mut z0 = eyex - centerx;
    let mut z1 = eyey - centery;
    let mut z2 = eyez - centerz;
    let mut len = (z0 * z0 + z1 * z1 + z2 * z2).sqrt();
    if len == 0.0 { z2 = 1.0; } else { z0 /= len; z1 /= len; z2 /= len; }
    let mut x0 = upy * z2 - upz * z1;
    let mut x1 = upz * z0 - upx * z2;
    let mut x2 = upx * z1 - upy * z0;
    len = (x0 * x0 + x1 * x1 + x2 * x2).sqrt();
    if len != 0.0 { x0 /= len; x1 /= len; x2 /= len; }
    let y0 = z1 * x2 - z2 * x1;
    let y1 = z2 * x0 - z0 * x2;
    let y2 = z0 * x1 - z1 * x0;
    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0.0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0.0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0.0;
    out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
    out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
    out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
    out[15] = 1.0;
}
pub fn mul(out: &mut [f32; 16], a: &[f32; 16], b: &[f32; 16]) {
    let a00 = a[0];  let a01 = a[1];  let a02 = a[2];  let a03 = a[3];
    let a10 = a[4];  let a11 = a[5];  let a12 = a[6];  let a13 = a[7];
    let a20 = a[8];  let a21 = a[9];  let a22 = a[10]; let a23 = a[11];
    let a30 = a[12]; let a31 = a[13]; let a32 = a[14]; let a33 = a[15];
    let b00 = b[0];  let b01 = b[1];  let b02 = b[2];  let b03 = b[3];
    let b10 = b[4];  let b11 = b[5];  let b12 = b[6];  let b13 = b[7];
    let b20 = b[8];  let b21 = b[9];  let b22 = b[10]; let b23 = b[11];
    let b30 = b[12]; let b31 = b[13]; let b32 = b[14]; let b33 = b[15];
    out[0]  = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
    out[1]  = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
    out[2]  = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
    out[3]  = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
    out[4]  = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
    out[5]  = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
    out[6]  = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
    out[7]  = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
    out[8]  = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
    out[9]  = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
    out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
    out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
    out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
    out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
}

pub fn rotate_y(out: &mut [f32; 16], a: &[f32; 16], rad: f32) {
    let s = rad.sin();
    let c = rad.cos();
    let a00 = a[0];  let a01 = a[1];  let a02 = a[2];  let a03 = a[3];
    let a20 = a[8];  let a21 = a[9];  let a22 = a[10]; let a23 = a[11];
    if a as *const _ != out as *const _ {
        out[4] = a[4]; out[5] = a[5]; out[6] = a[6]; out[7] = a[7];
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
    }
    out[0] = a00 * c - a20 * s;
    out[1] = a01 * c - a21 * s;
    out[2] = a02 * c - a22 * s;
    out[3] = a03 * c - a23 * s;
    out[8] = a00 * s + a20 * c;
    out[9] = a01 * s + a21 * c;
    out[10] = a02 * s + a22 * c;
    out[11] = a03 * s + a23 * c;
}

pub fn rotate_x(out: &mut [f32; 16], a: &[f32; 16], rad: f32) {
    let s = rad.sin();
    let c = rad.cos();
    let a10 = a[4];  let a11 = a[5];  let a12 = a[6];  let a13 = a[7];
    let a20 = a[8];  let a21 = a[9];  let a22 = a[10]; let a23 = a[11];
    if a as *const _ != out as *const _ {
        out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
        out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
    }
    out[4]  = a10 * c + a20 * s;
    out[5]  = a11 * c + a21 * s;
    out[6]  = a12 * c + a22 * s;
    out[7]  = a13 * c + a23 * s;
    out[8]  = a20 * c - a10 * s;
    out[9]  = a21 * c - a11 * s;
    out[10] = a22 * c - a12 * s;
    out[11] = a23 * c - a13 * s;
}

pub fn transform_vec3(out: &mut [f32; 3], a: &[f32; 3], m: &[f32; 16]) {
    let x = a[0]; let y = a[1]; let z = a[2];
    let w = m[3] * x + m[7] * y + m[11] * z + m[15];
    let w = if w == 0.0 { 1.0 } else { w };
    out[0] = (m[0] * x + m[4] * y + m[8]  * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9]  * z + m[13]) / w;
    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
}

pub fn vis_sphere(m: &[f32; 16], cx: f32, cy: f32, cz: f32, r: f32) -> bool {
    let t = |ax: f32, ay: f32, az: f32, aw: f32| {
        let n = (ax * ax + ay * ay + az * az).sqrt();
        let d = if n < 1e-8 { 1.0 } else { n };
        (ax * cx + ay * cy + az * cz + aw) / d + r < 0.0
    };
    if t(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]) {
        return false;
    }
    if t(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]) {
        return false;
    }
    if t(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]) {
        return false;
    }
    if t(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]) {
        return false;
    }
    if t(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]) {
        return false;
    }
    if t(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]) {
        return false;
    }
    true
}

#[wasm_bindgen]
pub fn culling(mvp: &js_sys::Float32Array, rx: f32, ry: f32, rz: f32) -> bool {
    let mut a = [0.0; 16];
    mvp.copy_to(&mut a);
    let (x, y, z) = (rx + 128.0, ry + 128.0, rz + 128.0);
    vis_sphere(&a, x, y, z, (256.0f32 * 256.0 * 3.0).sqrt() * 0.5)
}

pub fn range(n: u32) -> js_sys::Array {
    let a = js_sys::Array::new();
    for i in 0..n {
        a.push(&JsValue::from_f64(i as f64));
    }
    a
}

pub fn scoped(i: i32, j: i32) -> bool {
    SCOPE_X0 <= i && i <= SCOPE_X1 && SCOPE_Y0 <= j && j <= SCOPE_Y1
}

pub fn create_context() -> web_sys::CanvasRenderingContext2d {
    let doc = web_sys::window().unwrap().document().unwrap();
    let canvas: web_sys::HtmlCanvasElement = doc
        .create_element("canvas")
        .unwrap()
        .dyn_into()
        .unwrap();
    let options = js_sys::Object::new();
    js_sys::Reflect
        ::set(&options, &JsValue::from_str("willReadFrequently"), &JsValue::from_bool(true))
        .unwrap();
    canvas.set_width(4096);
    canvas.set_height(4096);
    canvas
        .get_context_with_context_options("2d", &options)
        .unwrap()
        .unwrap()
        .dyn_into::<web_sys::CanvasRenderingContext2d>()
        .unwrap()
}

pub fn create_image(src: &str) -> js_sys::Promise {
    let img = web_sys::HtmlImageElement::new().unwrap();
    let (p, resolve) = promise_pair();
    let img2 = img.clone();
    let onload = Closure::wrap(
        Box::new(move || {
            let _ = resolve.call1(&JsValue::NULL, &img2.clone().into());
        }) as Box<dyn FnMut()>
    );
    img.set_onload(Some(onload.as_ref().unchecked_ref()));
    onload.forget();
    let _ = img.set_cross_origin(Some("anonymous"));
    img.set_src(src);
    p
}

pub fn scope_js() -> js_sys::Object {
    let o = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&o, &JsValue::from_str("x0"), &JsValue::from_f64(SCOPE_X0 as f64));
    let _ = js_sys::Reflect::set(&o, &JsValue::from_str("x1"), &JsValue::from_f64(SCOPE_X1 as f64));
    let _ = js_sys::Reflect::set(&o, &JsValue::from_str("y0"), &JsValue::from_f64(SCOPE_Y0 as f64));
    let _ = js_sys::Reflect::set(&o, &JsValue::from_str("y1"), &JsValue::from_f64(SCOPE_Y1 as f64));
    o
}

pub fn get_f32(o: &JsValue, k: &str, def: f32) -> f32 {
    js_sys::Reflect
        ::get(o, &JsValue::from_str(k))
        .ok()
        .and_then(|v| v.as_f64())
        .map(|x| x as f32)
        .unwrap_or(def)
}

fn promise_pair() -> (Promise, Function) {
    let mut resolve_fn: Option<Function> = None;
    let p = Promise::new(
        &mut (|res: Function, _rej: Function| {
            resolve_fn = Some(res);
        })
    );
    (p, resolve_fn.unwrap())
}
