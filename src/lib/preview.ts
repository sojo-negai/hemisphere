/**
 * 开发期浏览器预览开关(?preview=1)。
 *
 * Tauri 之外拿不到 Rust 命令,做界面时用夹具数据渲染完整主界面;
 * 仅开发构建生效,生产包中被摇树移除。
 */
export const isPreview =
  import.meta.env.DEV && new URLSearchParams(location.search).has('preview')
