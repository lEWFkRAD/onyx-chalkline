import fs from 'node:fs'
import {Tutor} from '../tutor.mjs'
import {extractSource} from '../sources.mjs'
import {draftTeachingPlan} from '../planner.mjs'
import {pdfFixture} from './source-fixtures.mjs'
const path=process.env.CHALKLINE_TEST_CONFIG
if(!path)throw Error('Set CHALKLINE_TEST_CONFIG to an approved private configuration.')
const config=JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''))
const source={...await extractSource(pdfFixture(),{format:'pdf',filename:'original-water-demo.pdf',title:'Original Chalkline water changes demonstration',publisher:'Chalkline synthetic test'}),id:'00000000-0000-4000-8000-000000000001'}
const plan=await draftTeachingPlan(new Tutor(config.ai,{edition:'school'}),{reviewed:true,brief:'Plan an age-appropriate lesson about evaporation and condensation. Include a warm-up, teacher demonstration with warm water handled only by the teacher, guided discussion, independent diagram and exit ticket. Support developing readers. Do not add unsupported curriculum standards.',audience:'Grade 4',durationMinutes:45},[source])
fs.mkdirSync(new URL('../artifacts/',import.meta.url),{recursive:true})
fs.writeFileSync(new URL('../artifacts/source-plan-live-ai.json',import.meta.url),JSON.stringify(plan,null,2))
console.log(JSON.stringify({title:plan.title,minutes:plan.durationMinutes,steps:plan.steps,teacherNotes:plan.teacherNotes}))
