// 阅读器自带标题头（kicker + h1 + byline），而 buildMarkdown 会在正文顶部注入 `# <title>`
// （对外部编辑器/Obsidian 有用，故 .md 文件保留）。渲染时去掉这行重复标题，避免标题出现两次。
// 只在「开头第一处非空内容恰为 `# <title>`」时剥离——正文里真实的同名小节、非首行标题都保留。
export function stripLeadingTitle(md: string, title: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length || lines[i].trim() !== `# ${title}`) return md
  // 标题前只有空行（上面条件已保证），连同标题后的空行一起丢弃，从正文首行起返回。
  let j = i + 1
  while (j < lines.length && lines[j].trim() === '') j++
  return lines.slice(j).join('\n')
}
