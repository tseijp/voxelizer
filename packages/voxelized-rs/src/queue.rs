use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Function, Promise, Reflect, Object };

#[wasm_bindgen]
pub struct Queues {
    limit: i32,
    low_limit: i32,
}

#[wasm_bindgen(js_name = createQueues)]
pub fn create_queues(limit: i32, low_limit: i32) -> Queues {
    Queues { limit, low_limit }
}

#[wasm_bindgen]
impl Queues {
    pub fn schedule(&self, start: &Function, priority: i32) -> Object {
        let task = Object::new();
        let _ = Reflect::set(&task, &"priority".into(), &JsValue::from_f64(priority as f64));
        let _ = Reflect::set(&task, &"started".into(), &JsValue::FALSE);
        let _ = Reflect::set(&task, &"isHigh".into(), &JsValue::from_bool(priority > 0));
        let (p, resolve) = new_promise();
        let _ = Reflect::set(&task, &"resolve".into(), &resolve);
        let started = start.call0(&JsValue::NULL).unwrap_or(JsValue::UNDEFINED);
        let _ = Reflect::set(&task, &"started".into(), &JsValue::TRUE);
        let thener = Closure::wrap(
            Box::new(move |v: JsValue| {
                let _ = resolve.call1(&JsValue::NULL, &v);
            }) as Box<dyn FnMut(JsValue)>
        );
        if let Some(pr) = started.dyn_ref::<Promise>() {
            let _ = pr.then(&thener);
            thener.forget();
        }
        let o = Object::new();
        let _ = Reflect::set(&o, &"promise".into(), &p);
        let _ = Reflect::set(&o, &"task".into(), &task);
        o
    }
    pub fn bump(&self, task: &Object, priority: i32) {
        let prev = Reflect::get(&task, &"priority".into())
            .ok()
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0) as i32;
        if prev >= priority {
            return;
        }
        let _ = Reflect::set(&task, &"priority".into(), &JsValue::from_f64(priority as f64));
        let is_high = priority > 0;
        let _ = Reflect::set(&task, &"isHigh".into(), &JsValue::from_bool(is_high));
    }
}

fn new_promise() -> (Promise, Function) {
    let mut resolve_fn: Option<Function> = None;
    let p = Promise::new(&mut |res: Function, _rej: Function| {
        resolve_fn = Some(res);
    });
    (p, resolve_fn.unwrap())
}
