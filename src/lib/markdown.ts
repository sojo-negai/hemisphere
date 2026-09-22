// Markdown 渲染:助手回复走富文本,用户/系统/工具行保持纯文本。
// marked 负责解析(GFM + 单换行转 <br>),DOMPurify 负责消毒——
// 内容来自模型与工具输出,属于不可信输入,绝不能直接 v-html。
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

/** 把一段 markdown 文本转成已消毒的 HTML 字符串 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false })
  return DOMPurify.sanitize(typeof html === 'string' ? html : '')
}
