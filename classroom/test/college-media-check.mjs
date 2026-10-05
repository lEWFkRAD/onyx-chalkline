
import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join,dirname} from 'node:path'
import {execFileSync} from 'node:child_process'
import {renderVideo} from '../media.mjs'
import {seedCollegeLesson} from '../college-lesson.mjs'
const dir=fileURLToPath(new URL('../artifacts/media-college/',import.meta.url))
const config=process.env.CHALKLINE_TEST_CONFIG?JSON.parse((await readFile(process.env.CHALKLINE_TEST_CONFIG,'utf8')).replace(/^\uFEFF/,'')):{}
const media={...config.media,edition:'college',...(process.env.CHALKLINE_FFMPEG?{ffmpeg:process.env.CHALKLINE_FFMPEG}:{})}
await mkdir(dir,{recursive:true})
const asset=await renderVideo(seedCollegeLesson,1,dir,media),folder=join(dir,asset)
const ffmpeg=media.ffmpeg||'ffmpeg',probe=process.env.CHALKLINE_FFPROBE||(media.ffmpeg?join(dirname(ffmpeg),'ffprobe.exe'):'ffprobe')
const inspect=path=>JSON.parse(execFileSync(probe,['-v','error','-show_format','-show_streams','-of','json',path],{encoding:'utf8',windowsHide:true}))
const info=inspect(join(folder,'explanation.mp4'))
assert.ok(info.streams.some(s=>s.codec_name==='h264'&&s.width===1280&&s.height===720))
assert.ok(info.streams.some(s=>s.codec_name==='aac'))
assert.ok(Number(info.format.duration)>20)
assert.equal((await readFile(join(folder,'captions.vtt'),'utf8')).match(/ --> /g).length,3)
assert.equal(await readFile(join(folder,'transcript.txt'),'utf8'),seedCollegeLesson.scenes.map(s=>s.heading+'\n'+s.narration).join('\n\n'))
let offset=0
for(let i=0;i<3;i++){
  execFileSync(ffmpeg,['-y','-ss',String(offset+1),'-i',join(folder,'explanation.mp4'),'-frames:v','1','-update','1',join(folder,'scene-'+(i+1)+'.png')],{stdio:'ignore',windowsHide:true})
  offset+=Number(inspect(join(folder,i+'.wav')).format.duration)+1
}
console.log('Real college media verified: H.264/AAC 1280x720, '+info.format.duration+' seconds, three caption intervals, full transcript, three review frames.')
