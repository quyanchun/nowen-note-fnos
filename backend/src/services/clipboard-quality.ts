/** Conservative checks for unattended clipboard capture. Manual capture stays explicit. */
const credentialField = /(?:^|[\s,，;；])(?:账号|帐号|用户名|密码|口令|username|password|passwd|token|api[ _-]?key)(?:\s*[:：=]\s*|\s+)(\S+)/ig;
const serviceLabel = /(?:服务|系统|平台|网站|应用|项目)(?:名(?:称)?)?\s*[:：=]\s*([^\n,，;；]+)/i;
const address = /https?:\/\/[^\s<>"'）)]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/i;

export function clipboardCredentials(content: string): { service: string | null } | null {
  // SQL/configuration documents are reference material, not a password-book entry.
  if (/```|\b(?:CREATE\s+TABLE|ALTER\s+TABLE|INSERT\s+INTO|SELECT\s|jdbc:)|(?:^|\n)\s*[{}[\]]/im.test(content)) return null;
  if (![...content.matchAll(credentialField)].length) return null;
  const withoutEmails = content.replace(credentialField," ").replace(/\b[^\s@]+@[^\s@]+\b/g, "");
  const label = serviceLabel.exec(withoutEmails)?.[1].trim();
  const locator = address.exec(withoutEmails)?.[0];
  const namedLogin = /^([^\n:：]{2,60}?)(?:登录信息|登录账号|账号信息|管理后台)\s*(?:[:：]|$)/im.exec(content)?.[1].trim()
    || /^(?!我的|这个|这是|复制)([\p{L}\p{N}._-]{2,40})\s+(?:账号|用户名|密码|username|password)\s*[:：=\s]/iu.exec(content)?.[1];
  return { service: label || locator || namedLogin || null };
}

export function clipboardQualityFilter(content: string): { code: string; sensitive: boolean } | null {
  const text = content.trim();
  const credentials = clipboardCredentials(text);
  if (credentials && !credentials.service) return { code: "CAPTURE_CONTEXT_REQUIRED", sensitive: true };
  if (credentials?.service) return null;
  if (/^(?:Bearer\s+)?(?:sk-|ncc_|gh[pousr]_|AKIA)[A-Za-z0-9._~+\/-]{12,}={0,2}$/i.test(text)
    || /^\S+@\S+\.\S+$/.test(text) || /^\+?\d[\d -]{5,15}$/.test(text)
    || /^(?:admin|root|administrator|guest)$/i.test(text)
    || /^[A-Za-z\d!@#$%^&*._~+=-]{8,200}$/.test(text)
    || /^[A-Za-z\d!@#$%^&*._~+=-]{3,200}\r?\n[A-Za-z\d!@#$%^&*._~+=-]{3,200}$/.test(text)) {
    return { code: "CAPTURE_CONTEXT_REQUIRED", sensitive: true };
  }
  if (/^(?:https?:\/\/|file:\/\/|magnet:\?|\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])\S+(?:[ \t]+[^\n]*)?$/.test(text)
    || /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/?$/i.test(text)
    || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(text)
    || /^(?:你(?:帮我|看|能|可以|先|再|把|给|需要|应该)|帮我|请你|我觉得|还有一个问题|能不能帮我)/.test(text)) {
    return { code: "CAPTURE_LOW_VALUE", sensitive: false };
  }
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const logLines = lines.filter(line => /^\s*(?:\d{4}-\d\d-\d\d[T ]|\[?(?:INFO|DEBUG|WARN|ERROR|TRACE)\b|at \S+\s*\(|Traceback \(|File ".+", line \d+)/i.test(line));
  if (logLines.length >= 2 && logLines.length >= lines.length / 2 && !/(?:原因|结论|解决方法|修复方法|root cause)/i.test(text)) {
    return { code: "CAPTURE_LOW_VALUE", sensitive: false };
  }
  return null;
}

export const clipboardCollectionPolicy = `只收集以后可复用、信息完整的参考资料：技术代码/SQL/配置、操作步骤、完整测试结果表、带原因和结论的排障记录、明确的工作安排、带所属服务的账号资料。
拿不准时不收集。单独的账号密码、验证码、随机串、网址、IP、文件路径、一次性终端命令、原始日志、界面提示、半句话不收集。对AI助手的提问、需求描述、反馈和指令不收集；不要把这类对话改写成文档。配置文件和完整可复用脚本可以收集，不能仅因包含命令或password字段而拒绝。`;

const folderAliases: Record<string, string> = {
  技术学习: "技术", 技术资料: "技术", 软件开发: "技术", 研发: "技术",
  工作笔记: "工作", 工作资料: "工作", 个人生活: "生活", 生活记录: "生活",
  人工智能: "AI", AI与机器学习: "AI", 人工智能与机器学习: "AI", 系统运维: "运维",
};
export const clipboardRootFolders = ["技术", "工作", "生活"];
export function canonicalClipboardFolder(name: string): string {
  const trimmed = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  const alias=Object.entries(folderAliases).find(([key])=>key.toLowerCase()===trimmed.toLowerCase())?.[1];
  return alias || (/^(?:ai|api|sql)$/i.test(trimmed)?trimmed.toUpperCase():trimmed);
}
