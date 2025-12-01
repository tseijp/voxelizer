use wasm_bindgen::prelude::*;

fn idx(x: usize, y: usize, z: usize, n: usize) -> usize {
    x + (y + z * n) * n
}

#[wasm_bindgen(js_name = greedyMesh)]
pub fn greedy_mesh(src: &js_sys::Uint8Array, size: u32) -> js_sys::Object {
    let n = size as usize;
    let mut data = src.to_vec();
    let mut pos: Vec<f32> = Vec::new();
    let mut scl: Vec<f32> = Vec::new();
    let mut count = 0u32;
    let mut i = 0usize;
    while i < n * n * n {
        let xi = i % n;
        let yi = (i / n) % n;
        let zi = i / (n * n);
        if data[i] > 0 {
            let mut w = 1usize;
            while xi + w < n && data[idx(xi + w, yi, zi, n)] > 0 {
                w += 1;
            }
            let mut h = 1usize;
            let mut ok = true;
            while yi + h < n && ok {
                for a in 0..w {
                    if data[idx(xi + a, yi + h, zi, n)] == 0 {
                        ok = false;
                        break;
                    }
                }
                if ok {
                    h += 1;
                }
            }
            let mut d = 1usize;
            let mut ok2 = true;
            while zi + d < n && ok2 {
                for b in 0..h {
                    for a in 0..w {
                        if data[idx(xi + a, yi + b, zi + d, n)] == 0 {
                            ok2 = false;
                            break;
                        }
                    }
                    if !ok2 {
                        break;
                    }
                }
                if ok2 {
                    d += 1;
                }
            }
            for k in 0..d {
                for j in 0..h {
                    for i2 in 0..w {
                        data[idx(xi + i2, yi + j, zi + k, n)] = 0;
                    }
                }
            }
            pos.push((w as f32) * 0.5 + (xi as f32));
            pos.push((h as f32) * 0.5 + (yi as f32));
            pos.push((d as f32) * 0.5 + (zi as f32));
            scl.push(w as f32);
            scl.push(h as f32);
            scl.push(d as f32);
            count += 1;
        }
        i += 1;
    }
    let o = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&o, &"pos".into(), &js_sys::Float32Array::from(pos.as_slice()));
    let _ = js_sys::Reflect::set(&o, &"scl".into(), &js_sys::Float32Array::from(scl.as_slice()));
    let _ = js_sys::Reflect::set(&o, &"count".into(), &JsValue::from_f64(count as f64));
    o
}
