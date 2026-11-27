#!/usr/bin/env node
/**
 * Build a portable handraw prompt pack from a local clone of
 * https://github.com/yang0/handraw-style.
 *
 * Usage:
 *   node scripts/build-handraw-pack.mjs --source D:/deepseek/_handraw_src --out D:/deepseek/handraw-pack
 *
 * The generated pack is intentionally NOT part of the plugin npm package.
 * It contains the style / layout / theme-color prompt data and preview images.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const sourceRoot = path.resolve(arg('--source', path.join(process.cwd(), '..', '_handraw_src')))
const outRoot = path.resolve(arg('--out', path.join(process.cwd(), '..', 'handraw-pack')))
const referencesDir = path.join(sourceRoot, 'skills', 'handdraw-style-prompter', 'references')
const imagesDir = path.join(sourceRoot, 'images')

const categoryZh = {
  'comic-storyboard': '漫画分镜',
  infographic: '信息图',
  'social-card': '社交卡片',
  ecommerce: '电商',
  'ip-character': 'IP 角色',
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function exists(file) {
  return fs.stat(file).then((stat) => stat.isFile()).catch(() => false)
}

async function copyImage(source, relative) {
  const target = path.join(outRoot, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

function parseLayoutPrompt(markdown) {
  const zh = markdown.indexOf('<!-- zh -->')
  const en = markdown.indexOf('<!-- en -->')
  const start = zh >= 0 ? zh + '<!-- zh -->'.length : 0
  const end = en >= 0 ? en : markdown.length
  return markdown.slice(start, end).trim()
}

async function main() {
  const styles = await readJson(path.join(referencesDir, 'styles.json'))
  const layouts = await readJson(path.join(referencesDir, 'layouts.json'))
  const colors = await readJson(path.join(referencesDir, 'colors.json'))
  if (!Array.isArray(styles) || !Array.isArray(layouts) || !Array.isArray(colors)) {
    throw new Error('handraw references did not contain expected arrays')
  }

  await fs.rm(outRoot, { recursive: true, force: true })
  await fs.mkdir(outRoot, { recursive: true })

  const items = []
  const skipped = []

  for (const style of styles) {
    const code = String(style.number || '').trim()
    const groupCode = code.split('-')[0]
    const imageRel = path.join('images', 'individual', groupCode, `${code}.webp`)
    const sourceImage = path.join(sourceRoot, imageRel)
    if (!code || !(await exists(sourceImage))) {
      skipped.push(`style:${code || '?'}`)
      continue
    }
    const targetImage = path.join('images', 'styles', `${code}.webp`)
    await copyImage(sourceImage, targetImage)
    const name = String(style.generation_name || code).trim()
    const traits = String(style.traits || '').trim()
    const group = String(style.group || groupCode).trim()
    items.push({
      id: `style-${code}`,
      section: 'styles',
      title: `${code} ${name}`,
      description: group,
      prompt: `风格：${name}。${traits}`,
      image: targetImage.replace(/\\/g, '/'),
      category: group,
      styles: [groupCode],
      scenes: [],
      pageUrl: 'https://github.com/yang0/handraw-style',
    })
  }

  for (const layout of layouts) {
    const id = String(layout.id || '').trim()
    const promptFile = String(layout.prompt_file || '').trim()
    if (!id || promptFile === '') {
      skipped.push(`layout:${id || '?'}`)
      continue
    }
    const layoutImage = path.resolve(referencesDir, String(layout.image || ''))
    if (!(await exists(layoutImage))) {
      skipped.push(`layout-image:${id}`)
      continue
    }
    const promptPath = path.resolve(referencesDir, promptFile)
    const markdown = await fs.readFile(promptPath, 'utf8').catch(() => '')
    const prompt = parseLayoutPrompt(markdown)
    if (prompt === '') {
      skipped.push(`layout-prompt:${id}`)
      continue
    }
    const targetImage = path.join('images', 'layouts', `${id}.webp`)
    await copyImage(layoutImage, targetImage)
    const category = categoryZh[String(layout.category || '')] || String(layout.category || '')
    items.push({
      id: `layout-${id}`,
      section: 'layouts',
      title: `${id} ${String(layout.name || layout.name_en || '').trim()}`,
      description: String(layout.name_en || ''),
      prompt,
      image: targetImage.replace(/\\/g, '/'),
      category,
      styles: [],
      scenes: [],
      pageUrl: 'https://github.com/yang0/handraw-style',
    })
  }

  for (const color of colors) {
    const id = String(color.id || '').trim()
    const imageRel = String(color.image || '').replace(/^\.\.\/\.\.\/\.\.\//, '')
    const sourceImage = path.join(sourceRoot, imageRel)
    if (!id || !(await exists(sourceImage))) {
      skipped.push(`color:${id || '?'}`)
      continue
    }
    const targetImage = path.join('images', 'colors', `${id}.webp`)
    await copyImage(sourceImage, targetImage)
    items.push({
      id: `color-${id}`,
      section: 'colors',
      title: `${id} ${String(color.name_zh || color.name_en || '').trim()}`,
      description: `${String(color.quote_zh || '')} / ${String(color.quote_en || '')}`.trim(),
      prompt: String(color.prompt_zh || color.prompt_en || '').trim(),
      image: targetImage.replace(/\\/g, '/'),
      category: String(color.category_zh || color.category || ''),
      styles: [],
      scenes: [],
      pageUrl: 'https://github.com/yang0/handraw-style',
    })
  }

  const manifest = {
    id: 'handraw',
    kind: 'prompts',
    label: '手绘风格库',
    description: 'Hand-drawn Style Prompter 的风格、版式与配色提示词合集',
    home: 'https://github.com/yang0/handraw-style',
    author: 'yang0',
    authorUrl: 'https://github.com/yang0/handraw-style',
    version: '1.0.0',
    updatedAt: Date.now(),
    items,
  }
  await fs.writeFile(path.join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const license = await fs.readFile(path.join(sourceRoot, 'LICENSE'), 'utf8').catch(() => '')
  if (license !== '') await fs.writeFile(path.join(outRoot, 'LICENSE'), license, 'utf8')
  await fs.writeFile(path.join(outRoot, 'README.md'), [
    '# 手绘风格库资源包',
    '',
    '本资源包由 `dsh-image-studio` 从 [yang0/handraw-style](https://github.com/yang0/handraw-style) 的 reference 数据构建。',
    '',
    '原作者：yang0  ',
    '原仓库：https://github.com/yang0/handraw-style  ',
    '内容：372 个手绘风格 + 170 个版式 + 36 个主题色，包含预览图。',
    '',
    '本目录不属于插件 npm 包，默认不会随插件安装；请在“导入资源”中从 GitHub 拉取或导入本资源包。',
    '',
  ].join('\n'), 'utf8')

  console.log(JSON.stringify({
    outRoot,
    items: items.length,
    styles: items.filter((item) => item.section === 'styles').length,
    layouts: items.filter((item) => item.section === 'layouts').length,
    colors: items.filter((item) => item.section === 'colors').length,
    skipped,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
