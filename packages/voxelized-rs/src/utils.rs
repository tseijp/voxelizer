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
    let fx = center[0] - eye[0];
    let fy = center[1] - eye[1];
    let fz = center[2] - eye[2];
    let fl = (fx * fx + fy * fy + fz * fz).sqrt();
    let fx = fx / fl;
    let fy = fy / fl;
    let fz = fz / fl;
    let sx = fy * up[2] - fz * up[1];
    let sy = fz * up[0] - fx * up[2];
    let sz = fx * up[1] - fy * up[0];
    let sl = (sx * sx + sy * sy + sz * sz).sqrt();
    let sx = sx / sl;
    let sy = sy / sl;
    let sz = sz / sl;
    let ux = sy * fz - sz * fy;
    let uy = sz * fx - sx * fz;
    let uz = sx * fy - sy * fx;
    out[0] = sx;
    out[1] = ux;
    out[2] = -fx;
    out[3] = 0.0;
    out[4] = sy;
    out[5] = uy;
    out[6] = -fy;
    out[7] = 0.0;
    out[8] = sz;
    out[9] = uz;
    out[10] = -fz;
    out[11] = 0.0;
    out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
    out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
    out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
    out[15] = 1.0;
}
pub fn mul(out: &mut [f32; 16], a: &[f32; 16], b: &[f32; 16]) {
    for i in 0..4 {
        for j in 0..4 {
            out[i * 4 + j] =
                a[i * 4 + 0] * b[0 * 4 + j] +
                a[i * 4 + 1] * b[1 * 4 + j] +
                a[i * 4 + 2] * b[2 * 4 + j] +
                a[i * 4 + 3] * b[3 * 4 + j];
        }
    }
}

pub fn vis_sphere(m: &[f32; 16], cx: f32, cy: f32, cz: f32, r: f32) -> bool {
    let t = |ax: f32, ay: f32, az: f32, aw: f32| {
        (ax * cx + ay * cy + az * cz + aw) / ax.hypot(ay).hypot(az).max(1e-6) + r < 0.0
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
