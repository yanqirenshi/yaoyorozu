//! PoC #382: claude CLI を起動したまま stream-json で対話する探査ツール(使い捨て)。
//! 使い方: cli-probe <claude.exe> <cwd> <scenario> [--resume ID] [--permission-mode M]
//!         [--print] [--no-init] [--name N] [--log FILE] [--model M]
use base64::Engine;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::{Duration, Instant};

struct Opts {
    exe: String,
    cwd: String,
    scenario: String,
    resume: Option<String>,
    permission_mode: Option<String>,
    print: bool,
    no_init: bool,
    name: Option<String>,
    model: Option<String>,
    log: Option<String>,
}

fn parse_opts() -> Opts {
    let a: Vec<String> = std::env::args().collect();
    let mut o = Opts {
        exe: a[1].clone(),
        cwd: a[2].clone(),
        scenario: a[3].clone(),
        resume: None,
        permission_mode: None,
        print: false,
        no_init: false,
        name: None,
        model: None,
        log: None,
    };
    let mut i = 4;
    while i < a.len() {
        match a[i].as_str() {
            "--resume" => { o.resume = Some(a[i + 1].clone()); i += 1; }
            "--permission-mode" => { o.permission_mode = Some(a[i + 1].clone()); i += 1; }
            "--name" => { o.name = Some(a[i + 1].clone()); i += 1; }
            "--model" => { o.model = Some(a[i + 1].clone()); i += 1; }
            "--log" => { o.log = Some(a[i + 1].clone()); i += 1; }
            "--print" => o.print = true,
            "--no-init" => o.no_init = true,
            x => panic!("unknown arg {x}"),
        }
        i += 1;
    }
    o
}

enum Ev {
    Out(Value),
    OutRaw(String),
    Err(String),
    Exit(Option<i32>),
}

fn t(start: Instant) -> String {
    format!("{:7.3}s", start.elapsed().as_secs_f64())
}

fn head(s: &str, n: usize) -> String {
    if s.chars().count() > n { format!("{}…({} chars)", s.chars().take(n).collect::<String>(), s.chars().count()) } else { s.to_string() }
}

/// 1行を短く要約する(型・サブタイプ・本文の先頭)。制御要求は全文。
fn summarize(v: &Value) -> String {
    let ty = v["type"].as_str().unwrap_or("?");
    match ty {
        "control_request" | "control_response" | "control_cancel_request" => head(&v.to_string(), 1500),
        "stream_event" => {
            let e = &v["event"];
            let et = e["type"].as_str().unwrap_or("?");
            let extra = match et {
                "content_block_delta" => {
                    let d = &e["delta"];
                    format!(" {} {:?}", d["type"].as_str().unwrap_or(""), d["text"].as_str().or(d["thinking"].as_str()).or(d["partial_json"].as_str()).unwrap_or(""))
                }
                "content_block_start" => format!(" {}", e["content_block"]["type"].as_str().unwrap_or("")),
                "message_start" => format!(" model={}", e["message"]["model"].as_str().unwrap_or("")),
                "message_delta" => format!(" stop={}", e["delta"]["stop_reason"]),
                _ => String::new(),
            };
            format!("stream_event/{et}{extra} parent_tool_use_id={}", v["parent_tool_use_id"])
        }
        "assistant" | "user" => {
            let content = &v["message"]["content"];
            let mut parts = vec![];
            if let Some(arr) = content.as_array() {
                for c in arr {
                    let ct = c["type"].as_str().unwrap_or("?");
                    let s = match ct {
                        "text" => format!("text={:?}", head(c["text"].as_str().unwrap_or(""), 160)),
                        "tool_use" => format!("tool_use name={} input={}", c["name"], head(&c["input"].to_string(), 200)),
                        "tool_result" => format!("tool_result content={}", head(&c["content"].to_string(), 200)),
                        "thinking" => format!("thinking({} chars)", c["thinking"].as_str().map(|s| s.len()).unwrap_or(0)),
                        "image" => "image".to_string(),
                        _ => ct.to_string(),
                    };
                    parts.push(s);
                }
            } else if let Some(s) = content.as_str() {
                parts.push(format!("str={:?}", head(s, 160)));
            }
            format!("{ty} model={} parent_tool_use_id={} uuid={} [{}]", v["message"]["model"], v["parent_tool_use_id"], v["uuid"], parts.join(" | "))
        }
        "result" => format!(
            "result subtype={} is_error={} num_turns={} session_id={} duration_ms={} result={:?} stop_reason={} err={}",
            v["subtype"], v["is_error"], v["num_turns"], v["session_id"], v["duration_ms"],
            head(v["result"].as_str().unwrap_or(""), 120),
            v["stop_reason"], v["errors"]
        ),
        "system" => {
            let sub = v["subtype"].as_str().unwrap_or("?");
            let mut s = format!("system/{sub}");
            if sub == "init" {
                s += &format!(" session_id={} model={} permissionMode={} cwd={} tools={} claude_code_version={}",
                    v["session_id"], v["model"], v["permissionMode"], v["cwd"], v["tools"].as_array().map(|a| a.len()).unwrap_or(0), v["claude_code_version"]);
            } else {
                s += &format!(" {}", head(&v.to_string(), 400));
            }
            s
        }
        _ => head(&v.to_string(), 400),
    }
}

struct Probe {
    child: std::process::Child,
    stdin: Option<std::process::ChildStdin>,
    rx: Receiver<Ev>,
    start: Instant,
    log: Option<std::fs::File>,
    session_id: Option<String>,
    counts: std::collections::BTreeMap<String, usize>,
}

impl Probe {
    fn send(&mut self, v: Value) {
        let s = v.to_string();
        println!("[{}] >> {}", t(self.start), head(&s, 300));
        if let Some(f) = &mut self.log { let _ = writeln!(f, "[{}] >> {}", t(self.start), s); }
        let stdin = self.stdin.as_mut().expect("stdin open");
        stdin.write_all(s.as_bytes()).unwrap();
        stdin.write_all(b"\n").unwrap();
        stdin.flush().unwrap();
    }

    fn send_user(&mut self, text: &str) {
        self.send(json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":text}]},"parent_tool_use_id":null}));
    }

    fn control(&mut self, id: &str, request: Value) {
        self.send(json!({"type":"control_request","request_id":id,"request":request}));
    }

    /// 次のイベントを1つ受け取って記録する。
    fn next(&mut self, timeout: Duration) -> Option<Ev> {
        let ev = self.rx.recv_timeout(timeout).ok()?;
        match &ev {
            Ev::Out(v) => {
                let key = match v["type"].as_str() {
                    Some("stream_event") => format!("stream_event/{}", v["event"]["type"].as_str().unwrap_or("?")),
                    Some("system") => format!("system/{}", v["subtype"].as_str().unwrap_or("?")),
                    Some("control_request") => format!("control_request/{}", v["request"]["subtype"].as_str().unwrap_or("?")),
                    Some(x) => x.to_string(),
                    None => "?".into(),
                };
                *self.counts.entry(key).or_default() += 1;
                if v["type"] == "system" && v["subtype"] == "init" {
                    self.session_id = v["session_id"].as_str().map(|s| s.to_string());
                }
                println!("[{}] << {}", t(self.start), summarize(v));
                if let Some(f) = &mut self.log { let _ = writeln!(f, "[{}] << {}", t(self.start), v); }
            }
            Ev::OutRaw(s) => {
                println!("[{}] << (non-json) {}", t(self.start), s);
                if let Some(f) = &mut self.log { let _ = writeln!(f, "[{}] << RAW {}", t(self.start), s); }
            }
            Ev::Err(s) => {
                println!("[{}] !! stderr: {}", t(self.start), s);
                if let Some(f) = &mut self.log { let _ = writeln!(f, "[{}] !! {}", t(self.start), s); }
            }
            Ev::Exit(c) => {
                println!("[{}] ## exit code={:?}", t(self.start), c);
                if let Some(f) = &mut self.log { let _ = writeln!(f, "[{}] ## exit {:?}", t(self.start), c); }
            }
        }
        Some(ev)
    }

    /// 条件を満たす出力が来るまで読む。can_use_tool が来たら `on_perm` で応答する。
    fn wait_until(&mut self, timeout: Duration, mut pred: impl FnMut(&Value) -> bool, on_perm: &mut dyn FnMut(&mut Probe, &Value)) -> Option<Value> {
        let deadline = Instant::now() + timeout;
        loop {
            let remain = deadline.saturating_duration_since(Instant::now());
            if remain.is_zero() { println!("[{}] ?? timeout waiting", t(self.start)); return None; }
            if let Ok(Some(st)) = self.child.try_wait() { println!("[{}] ## child exited: {:?}", t(self.start), st); }
            match self.next(remain)? {
                Ev::Out(v) => {
                    if v["type"] == "control_request" && v["request"]["subtype"] == "can_use_tool" {
                        on_perm(self, &v);
                    }
                    if pred(&v) { return Some(v); }
                }
                Ev::Exit(_) => return None,
                _ => {}
            }
        }
    }

    fn wait_result(&mut self, timeout: Duration, on_perm: &mut dyn FnMut(&mut Probe, &Value)) -> Option<Value> {
        self.wait_until(timeout, |v| v["type"] == "result", on_perm)
    }

    fn wait_control_response(&mut self, id: &str, timeout: Duration) -> Option<Value> {
        let id = id.to_string();
        self.wait_until(timeout, |v| v["type"] == "control_response" && v["response"]["request_id"] == id, &mut |_, _| {})
    }

    fn ledger_path(&self) -> PathBuf {
        let home = std::env::var("USERPROFILE").unwrap();
        PathBuf::from(home).join(".claude").join("sessions").join(format!("{}.json", self.child.id()))
    }

    fn show_ledger(&self, label: &str) {
        let p = self.ledger_path();
        match std::fs::read_to_string(&p) {
            Ok(s) => println!("[{}] ## ledger {} ({}): {}", t(self.start), label, p.display(), s.trim()),
            Err(e) => println!("[{}] ## ledger {} ({}): 読めない: {}", t(self.start), label, p.display(), e),
        }
    }

    fn drain_until_exit(&mut self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(Some(st)) = self.child.try_wait() { println!("[{}] ## child exited: {:?}", t(self.start), st); return; }
            let remain = deadline.saturating_duration_since(Instant::now());
            if remain.is_zero() { println!("[{}] ?? still alive after timeout; killing", t(self.start)); let _ = self.child.kill(); return; }
            match self.next(remain.min(Duration::from_millis(500))) {
                Some(Ev::Exit(_)) => return,
                _ => {}
            }
        }
    }
}

fn allow(p: &mut Probe, req: &Value) {
    let id = req["request_id"].as_str().unwrap().to_string();
    p.send(json!({"type":"control_response","response":{"subtype":"success","request_id":id,"response":{"behavior":"allow","updatedInput":req["request"]["input"]}}}));
}

fn deny(p: &mut Probe, req: &Value) {
    let id = req["request_id"].as_str().unwrap().to_string();
    p.send(json!({"type":"control_response","response":{"subtype":"success","request_id":id,"response":{"behavior":"deny","message":"PoC #382: ユーザーが拒否しました(検証用)"}}}));
}

fn main() {
    let o = parse_opts();
    let start = Instant::now();
    let mut cmd = Command::new(&o.exe);
    cmd.current_dir(&o.cwd);
    // 親(この探査ツールを動かしている Claude Code)由来の環境変数を全部外す。
    for (k, _) in std::env::vars() {
        if k.starts_with("CLAUDE") { cmd.env_remove(k); }
    }
    let mut args: Vec<String> = vec!["--output-format".into(), "stream-json".into(), "--verbose".into(), "--input-format".into(), "stream-json".into(),
        "--permission-prompt-tool".into(), "stdio".into(), "--replay-user-messages".into(), "--include-partial-messages".into()];
    if o.print { args.insert(0, "--print".into()); }
    if let Some(r) = &o.resume { args.push(format!("--resume={r}")); }
    if let Some(m) = &o.permission_mode { args.push("--permission-mode".into()); args.push(m.clone()); }
    if let Some(n) = &o.name { args.push("--name".into()); args.push(n.clone()); }
    if let Some(m) = &o.model { args.push("--model".into()); args.push(m.clone()); }
    println!("## exe={} cwd={} scenario={} args={:?}", o.exe, o.cwd, o.scenario, args);
    cmd.args(&args);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().expect("spawn");
    println!("## child pid={}", child.id());
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, rx): (Sender<Ev>, Receiver<Ev>) = channel();
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() { continue; }
                match serde_json::from_str::<Value>(&line) {
                    Ok(v) => { let _ = tx.send(Ev::Out(v)); }
                    Err(_) => { let _ = tx.send(Ev::OutRaw(line)); }
                }
            }
            let _ = tx.send(Ev::Exit(None));
        });
    }
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                let _ = tx.send(Ev::Err(line));
            }
        });
    }
    let log = o.log.as_ref().map(|p| std::fs::File::create(p).unwrap());
    let mut p = Probe { child, stdin: Some(stdin), rx, start, log, session_id: None, counts: Default::default() };
    let long = Duration::from_secs(180);

    if !o.no_init {
        p.control("init-1", json!({"subtype":"initialize"}));
        let r = p.wait_control_response("init-1", Duration::from_secs(60));
        if let Some(r) = r {
            let resp = &r["response"]["response"];
            println!("## initialize response keys: {:?}", resp.as_object().map(|m| m.keys().cloned().collect::<Vec<_>>()));
        }
    }
    p.show_ledger("after init");

    match o.scenario.as_str() {
        "roundtrip" => {
            p.send_user("Reply with exactly one word: PING");
            p.wait_result(long, &mut |_, _| {});
            p.show_ledger("after 1st result");
            std::thread::sleep(Duration::from_secs(2));
            println!("## process alive after 1st result? try_wait={:?}", p.child.try_wait());
            p.send_user("What single word did you reply with just before? Answer with that word only.");
            p.wait_result(long, &mut |_, _| {});
        }
        "perm-allow" | "perm-deny" => {
            let allow_it = o.scenario == "perm-allow";
            p.send_user("Use the Bash tool to run exactly this command: echo poc382-hello . Then tell me the output in one line.");
            p.wait_result(long, &mut |p, req| if allow_it { allow(p, req) } else { deny(p, req) });
            p.send_user("Reply with exactly one word: AFTER");
            p.wait_result(long, &mut |_, _| {});
        }
        "perm-write" => {
            p.send_user("Use the Write tool to create a file named poc382.txt in the current directory containing the text: hello . Then reply DONE.");
            p.wait_result(long, &mut |p, req| allow(p, req));
        }
        "interrupt" => {
            p.send_user("Count from 1 to 400, one number per line, with no other text.");
            // テキストの差分が 5 回来たら中断する
            let mut deltas = 0;
            let got = p.wait_until(long, |v| { if v["type"] == "stream_event" && v["event"]["type"] == "content_block_delta" { deltas += 1; } deltas >= 5 }, &mut |_, _| {});
            if got.is_some() {
                p.control("int-1", json!({"subtype":"interrupt"}));
                p.wait_until(long, |v| v["type"] == "result", &mut |_, _| {});
                p.wait_control_response("int-1", Duration::from_secs(10));
            }
            std::thread::sleep(Duration::from_secs(1));
            println!("## process alive after interrupt? try_wait={:?}", p.child.try_wait());
            p.send_user("Reply with exactly one word: AFTER");
            p.wait_result(long, &mut |_, _| {});
        }
        "resume" => {
            p.send_user("In one short sentence, what did I ask you in this conversation before this message?");
            p.wait_result(long, &mut |_, _| {});
        }
        "image" => {
            let bytes = std::fs::read(PathBuf::from(&o.cwd).join("red.png")).expect("red.png");
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            p.send(json!({"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":b64}},{"type":"text","text":"What color is this image? Answer with one word."}]},"parent_tool_use_id":null}));
            p.wait_result(long, &mut |_, _| {});
            p.send_user("Reply with exactly one word: AFTER");
            p.wait_result(long, &mut |_, _| {});
        }
        "set-model" => {
            p.send_user("Reply with exactly one word: FIRST");
            p.wait_result(long, &mut |_, _| {});
            p.control("model-1", json!({"subtype":"set_model","model":"haiku"}));
            p.wait_control_response("model-1", Duration::from_secs(30));
            p.send_user("Reply with exactly one word: SECOND");
            p.wait_result(long, &mut |_, _| {});
        }
        "set-mode" => {
            p.control("mode-1", json!({"subtype":"set_permission_mode","mode":"plan"}));
            p.wait_control_response("mode-1", Duration::from_secs(30));
            p.send_user("Use the Bash tool to run exactly this command: echo poc382-hello . Then tell me the output in one line.");
            p.wait_result(long, &mut |p, req| allow(p, req));
        }
        "perm-write-deny" => {
            p.send_user("Use the Write tool to create a file named poc382-deny.txt in the current directory containing the text: hello . If the tool fails, say FAILED and stop.");
            p.wait_result(long, &mut |p, req| deny(p, req));
            p.send_user("Reply with exactly one word: AFTER");
            p.wait_result(long, &mut |_, _| {});
        }
        "perm-interrupt" => {
            // 権限の問い合わせに答えず interrupt を送る
            p.send_user("Use the Write tool to create a file named poc382-int.txt in the current directory containing the text: hello . Then reply DONE.");
            p.wait_result(long, &mut |p, _req| { p.control("int-1", json!({"subtype":"interrupt"})); });
            std::thread::sleep(Duration::from_secs(2));
            println!("## process alive after interrupt? try_wait={:?}", p.child.try_wait());
            p.send_user("Reply with exactly one word: AFTER");
            p.wait_result(long, &mut |_, _| {});
        }
        "kill" => {
            p.send_user("Reply with exactly one word: PING");
            p.wait_result(long, &mut |_, _| {});
            p.show_ledger("before kill");
            let _ = p.child.kill();
            let _ = p.child.wait();
            std::thread::sleep(Duration::from_secs(1));
            p.show_ledger("after kill");
        }
        "prompt" => {
            // 環境変数 POC_PROMPT の本文を送り、権限の問い合わせには許可で答える
            let text = std::env::var("POC_PROMPT").expect("POC_PROMPT");
            p.send_user(&text);
            p.wait_result(long, &mut |p, req| allow(p, req));
        }
        x => panic!("unknown scenario {x}"),
    }

    p.show_ledger("before stdin close");
    println!("## closing stdin");
    p.stdin = None;
    p.drain_until_exit(Duration::from_secs(30));
    let _ = p.child.wait();
    p.show_ledger("after exit");
    println!("## session_id={:?}", p.session_id);
    println!("## message counts:");
    for (k, n) in &p.counts { println!("   {k}: {n}"); }
}
