use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Function, Promise, Reflect, Object };
use std::rc::Rc;
use std::cell::RefCell;

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
            let f: &Function = thener.as_ref().unchecked_ref();
            let _ = pr.then(f);
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
    let cell = Rc::new(RefCell::new(None));
    let cell2 = cell.clone();
    let mut exec = Closure::wrap(
        Box::new(move |res: Function, _rej: Function| {
            *cell2.borrow_mut() = Some(res);
        }) as Box<dyn FnMut(Function, Function)>
    );
    let p = Promise::new(exec.as_mut().unchecked_ref());
    let r = cell.borrow().clone().unwrap_or(Function::new_no_args(""));
    exec.forget();
    (p, r)
}
