// Hemisphere 桌面壳层。
// 职责边界:只负责「拉起/停止 hermes serve 后端进程」并把连接参数(端口、令牌)
// 递给前端;agent 能力全部在 hermes serve 进程里,这里不写任何业务逻辑。

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 后端运行状态:持有子进程句柄与就绪文件路径,供退出时清理。
struct BackendState {
    child: Mutex<Option<Child>>,
    ready_file: Mutex<Option<PathBuf>>,
}

/// 递给前端的连接信息:实际端口、会话令牌、拼好的 WS 地址。
#[derive(serde::Serialize)]
struct BackendInfo {
    port: u16,
    token: String,
    ws_url: String,
}

/// 生成仅本次进程有效的会话令牌。
/// 场景限定在 127.0.0.1 回环:通过 HERMES_DASHBOARD_SESSION_TOKEN 环境变量交给后端,
/// 前端拨 WS 时以 ?token= 原样带回。不跨进程、不落盘,时间熵 xorshift 足够
/// (与官方 desktop 的 per-spawn token 同一威胁模型)。
fn mint_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B97F4A7C15);
    let mut s = nanos ^ 0xA0761D6478BD642F;
    let mut out = String::with_capacity(43);
    for _ in 0..6 {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        out.push_str(&format!("{:016x}", s));
    }
    out
}

/// 就绪文件路径(Tauri 临时目录下)。
/// 协议与官方 desktop 相同:后端绑定端口后,把 {"port": N} 原子写入
/// HERMES_DESKTOP_READY_FILE 指向的路径——端口 0 由系统分配,避免固定端口冲突。
fn ready_file_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().temp_dir().expect("app temp dir");
    fs::create_dir_all(&dir).ok();
    dir.join("backend-ready.json")
}

/// 拉起 headless 后端并等待其就绪,返回连接信息。
/// 环境变量含义(与官方 desktop spawn 契约一致):
/// - HERMES_DESKTOP=1:声明「desktop 拥有的回环后端」,配合令牌豁免鉴权闸门;
/// - HERMES_SERVE_HEADLESS=1:纯 JSON-RPC/WS 后端,不挂任何 Web UI;
/// - HERMES_DASHBOARD_SESSION_TOKEN:本次 spawn 的回环会话凭据;
/// - HERMES_DESKTOP_READY_FILE:就绪信号文件,后端就绪后包含实际端口。
#[tauri::command]
fn start_backend(app: tauri::AppHandle) -> Result<BackendInfo, String> {
    let rpath = ready_file_path(&app);
    // 清掉上次残留,避免读到陈旧端口
    let _ = fs::remove_file(&rpath);

    let token = mint_token();
    let mut child = Command::new("hermes")
        .args(["serve", "--host", "127.0.0.1", "--port", "0", "--no-open"])
        .env("HERMES_DESKTOP", "1")
        .env("HERMES_SERVE_HEADLESS", "1")
        .env("HERMES_DASHBOARD_SESSION_TOKEN", &token)
        .env("HERMES_DESKTOP_READY_FILE", &rpath)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn `hermes serve`: {e}"))?;

    // 轮询就绪文件;后端冷启动(含 Python 解释器初始化)可能较慢,给足 90 秒
    let deadline = std::time::Instant::now() + Duration::from_secs(90);
    loop {
        if let Ok(text) = fs::read_to_string(&rpath) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(port) = v["port"].as_u64() {
                    let port = port as u16;
                    // 登记子进程句柄,退出时由 stop_backend 统一回收
                    let state = app.state::<BackendState>();
                    *state.child.lock().unwrap() = Some(child);
                    *state.ready_file.lock().unwrap() = Some(rpath.clone());
                    return Ok(BackendInfo {
                        port,
                        token: token.clone(),
                        ws_url: format!("ws://127.0.0.1:{port}/api/ws?token={}", urlencode(&token)),
                    });
                }
            }
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return Err("backend did not become ready within 90s".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// 最小化的 URL 编码:令牌是自生成的十六进制串,只需覆盖保留字符集。
fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// 停止后端子进程并清理就绪文件(窗口关闭/退出时调用)。
#[tauri::command]
fn stop_backend(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendState>();
    if let Some(mut c) = state.child.lock().unwrap().take() {
        let _ = c.kill();
    }
    if let Some(p) = state.ready_file.lock().unwrap().take() {
        let _ = fs::remove_file(p);
    }
    Ok(())
}

/// 摆正主窗口。
///
/// Windows 实测:窗口可能被创建在屏幕外且退化成标题栏大小(158x26 @ -18286,-18286),
/// 表现为「启动失败」——进程、后端、渲染全都正常,只是界面对人不可见。
/// 所以启动后显式设定尺寸、居中、显示,不依赖配置生效的时序。
fn place_main_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let _ = win.set_size(tauri::LogicalSize::new(1280.0, 800.0));
    let _ = win.center();
    let _ = win.show();
    let _ = win.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendState {
            child: Mutex::new(None),
            ready_file: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            place_main_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_backend, stop_backend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
