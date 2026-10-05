import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
function run(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let log = ''
    child.stderr.on('data', d => {
      log = (log + d).slice(-2000)
    })
    const timeout = setTimeout(() => child.kill(), 120000)
    child.once('error', e => {
      clearTimeout(timeout)
      reject(e)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error('Media rendering failed: ' + log.slice(-400)))
    })
  })
}
function duration(wav) {
  let offset = 12,
    rate = 0,
    size = 0
  while (offset + 8 <= wav.length) {
    const tag = wav.toString('ascii', offset, offset + 4),
      len = wav.readUInt32LE(offset + 4)
    if (tag === 'fmt ') rate = wav.readUInt32LE(offset + 16)
    if (tag === 'data') size = len
    offset += 8 + len + (len % 2)
  }
  if (!rate || !size) throw new Error('Narration produced an invalid audio file.')
  return size / rate
}
function timestamp(seconds) {
  const ms = Math.round(seconds * 1000)
  return (
    [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
      .map(n => String(n).padStart(2, '0'))
      .join(':') +
    '.' +
    String(ms % 1000).padStart(3, '0')
  )
}

export function collegeCardText(scene) {
  const wrap=(value,width,limit)=>{
    const remaining=Array.from(String(value).replace(/\s+/g,' ').trim()),lines=[]
    while(remaining.length&&lines.length<limit){
      const line=remaining.splice(0,width),space=line.lastIndexOf(' ')
      if(remaining.length&&space>0)remaining.unshift(...line.splice(space))
      lines.push(line.join('').trim());while(remaining[0]===' ')remaining.shift()
    }
    if(remaining.length)lines[lines.length-1]=Array.from(lines.at(-1)).slice(0,width-1).join('').trimEnd()+'…'
    return lines.join('\n')
  }
  return {title:wrap(scene.heading,28,2),bullets:[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(scene.narration)].map(p=>p.segment.trim()).filter(Boolean).slice(0,3).map(s=>wrap(s,36,3))}
}

export async function renderVideo(lesson, revision, dir, config = {}) {
  const college = config.edition === 'college'
  if (process.platform !== 'win32') throw new Error('This prototype uses Windows narration.')
  const asset = 'lesson-' + revision
  const folder = join(dir, asset)
  await mkdir(folder, { recursive: true })
  let elapsed = 0
  const captions = ['WEBVTT', '']
  for (let i = 0; i < lesson.scenes.length; i++) {
    const scene = lesson.scenes[i]
    const cards=college?collegeCardText(scene):null
    await writeFile(join(folder,'speech.txt'),scene.narration)
    await writeFile(join(folder,'title.txt'),cards?cards.title:scene.heading.replace(/(.{1,40})(?:\s|$)/g,'$1\n').trim())
    if(cards){
      for(let n=0;n<cards.bullets.length;n++)await writeFile(join(folder,'bullet-'+n+'.txt'),cards.bullets[n])
      await writeFile(join(folder,'label.txt'),'CHALKLINE COLLEGE  /  SCENE '+(i+1)+' OF '+lesson.scenes.length)
    }else await writeFile(join(folder,'label.txt'),'One of '+scene.denominator+' equal parts')
    await run(
      config.powershell || 'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(root, 'scripts', 'narrate.ps1'),
        '-TextFile',
        join(folder, 'speech.txt'),
        '-OutputFile',
        join(folder, i + '.wav')
      ],
      folder
    )
    const seconds = duration(await readFile(join(folder, i + '.wav'))) + 1
    let filter
    if (cards) {
      filter=[
        "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile=label.txt:expansion=none:fontcolor=0xaac6d5:fontsize=20:x=112:y=35",
        "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile=title.txt:expansion=none:fontcolor=0xf8f5eb:fontsize=38:line_spacing=8:x=112:y=80",
        ...cards.bullets.flatMap((_,n)=>[
          'drawbox=x=112:y='+(225+n*120)+':w=1056:h=108:color=0x243a48:t=fill',
          'drawbox=x=130:y='+(244+n*120)+':w=6:h=6:color=0xaac6d5:t=fill',
          "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile=bullet-"+n+'.txt:expansion=none:fontcolor=0xf8f5eb:fontsize=28:line_spacing=5:x=154:y='+(235+n*120)
        ]),
        "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='SCENE EXCERPTS  /  FULL NARRATION IN CAPTIONS':expansion=none:fontcolor=0xaac6d5:fontsize=18:x=112:y=635"
      ].join(',')
    } else {
    const width = 1056 / scene.denominator
    const boxes = Array.from(
      { length: scene.denominator },
      (_, n) =>
        'drawbox=x=' +
        Math.round(112 + n * width) +
        ':y=295:w=' +
        Math.floor(width - 4) +
        ':h=145:color=' +
        (n === 0 ? '0xe9b657' : '0xa7c8b7') +
        ':t=fill:enable=gte(t\\,' +
        n * 0.14 +
        ')'
    )
    filter = [
      "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile=title.txt:expansion=none:fontcolor=0xf8f5eb:fontsize=42:line_spacing=12:x=112:y=100",
      ...boxes,
      "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile=label.txt:expansion=none:fontcolor=0xf8f5eb:fontsize=32:x=112:y=495",
      "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='CHALKLINE  /  LEARN TOGETHER':fontcolor=0xa7c8b7:fontsize=20:x=112:y=620"
    ].join(',')
    }
    await writeFile(join(folder, 'filter.txt'), filter)
    await run(
      config.ffmpeg || 'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        (college ? 'color=c=0x182731' : 'color=c=0x173f38') + ':s=1280x720:r=24',
        '-i',
        i + '.wav',
        '-vf',
        filter,
        '-af',
        'apad',
        '-t',
        String(seconds),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        i + '.mp4'
      ],
      folder
    )
    captions.push(timestamp(elapsed) + ' --> ' + timestamp(elapsed + seconds), scene.narration, '')
    elapsed += seconds
  }
  await writeFile(join(folder, 'concat.txt'), lesson.scenes.map((_, i) => "file '" + i + ".mp4'").join('\n'))
  await run(
    config.ffmpeg || 'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      'explanation.mp4'
    ],
    folder
  )
  await writeFile(join(folder, 'captions.vtt'), captions.join('\n'))
  await writeFile(join(folder, 'transcript.txt'), lesson.scenes.map(s => s.heading + '\n' + s.narration).join('\n\n'))
  return asset
}
