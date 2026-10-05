
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {ClassroomStore} from '../store.mjs'
import {createClassroom} from '../server.mjs'
import {validateLesson,lessonHtml} from '../lesson.mjs'
import {collegeCardText} from '../media.mjs'
import {collegeStatisticsData,pearsonCorrelation,seedCollegeLesson,seedSeminarLesson} from '../college-lesson.mjs'
import {Tutor,followupLesson} from '../tutor.mjs'
const denied=(fn,status)=>assert.throws(fn,e=>e.status===status)
async function fixture(t,edition='college',options={}){
  const dir=await mkdtemp(join(tmpdir(),'chalkline-college-test-'))
  const app=createClassroom({dataDir:dir,...options,config:{...options.config,edition}})
  let closed=false
  const close=async()=>{if(!closed){closed=true;await app.close()}}
  t.after(async()=>{await close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));assert.match(dir.slice(resolve(tmpdir()).length+1),/^chalkline-college-test-[^\\/]+$/);await rm(dir,{recursive:true,force:true})})
  const origin=await app.listen(0)
  const call=async(path,token,data)=>{
    const r=await fetch(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})})
    const text=await r.text();return{status:r.status,body:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text}
  }
  const login=async credentials=>{const r=await call('login',null,credentials);assert.equal(r.status,200);return r.body.token}
  const store=app.store,teacher=await login(store.bootstrap.teacher),student=store.bootstrap.students[0],learner=await login(student),state=(await call('state',teacher)).body
  return{dir,app,close,store,call,login,teacher,student,learner,state,p:store.principal(teacher),classId:state.currentClassId}
}
test('college and school identities and data stay separate; mismatched open does not change bytes',async t=>{
  const c=await fixture(t),s=await fixture(t,'school')
  assert.equal(c.state.edition,'college');assert.equal(c.state.draft.lesson.kind,'college-statistics')
  assert.deepEqual(c.store.bootstrap.students.map(s=>s.id).sort(),['alex','jordan','sam','taylor'])
  assert.ok(s.state.draft.lesson.scenes.every(x=>Number.isInteger(x.denominator)))
  assert.equal((await s.call('login',null,c.store.bootstrap.teacher)).status,401)
  assert.equal((await c.call('login',null,s.store.bootstrap.teacher)).status,401)
  assert.equal((await s.call('state',c.teacher)).status,401)
  for(const [ctx,other]of [[c,'school'],[s,'college']]){
    await ctx.close()
    const db=join(ctx.dir,'classroom.sqlite'),bootstrap=join(ctx.dir,'bootstrap.json'),before=await readFile(db),beforeB=await readFile(bootstrap)
    assert.throws(()=>new ClassroomStore(ctx.dir,{edition:other}),/edition/)
    assert.deepEqual(await readFile(db),before);assert.deepEqual(await readFile(bootstrap),beforeB)
  }
})
test('same instructor reuses enrollment but cannot enroll accounts from another instructor',async t=>{
  const c=await fixture(t),s=c.store
  const second=s.createClass(c.p,{name:'Writing seminar',kind:'college-seminar'}),payload={classId:second.id,username:c.student.username}
  assert.equal(s.draft(c.p,second.id).lesson.kind,'college-seminar')
  assert.equal(s.enrollExistingStudent(c.p,payload).student.id,c.student.id)
  assert.equal(s.enrollExistingStudent(c.p,payload).credentials,undefined)
  assert.equal(s.state(s.principal(c.learner),second.id).classes.length,2)
  s.createTeacher({name:'Other Instructor',username:'other-instructor',password:'Other-instructor-password-2026'})
  const other=s.principal(await c.login({username:'other-instructor',password:'Other-instructor-password-2026'})),otherClass=s.state(other).currentClassId
  const outsider=s.addStudent(other,{classId:otherClass,name:'Other Student',username:'other-student'})
  denied(()=>s.enrollExistingStudent(other,{classId:otherClass,username:c.student.username}),404)
  denied(()=>s.enrollExistingStudent(c.p,{classId:otherClass,username:c.student.username}),404)
  denied(()=>s.enrollExistingStudent(c.p,{...payload,username:outsider.credentials.username}),404)
  denied(()=>s.enrollExistingStudent(s.principal(c.learner),payload),403)
  s.removeStudent(c.p,{classId:c.classId,studentId:c.student.id})
  const remaining=s.principal(await c.login(c.student))
  assert.equal(s.state(remaining,second.id).currentClassId,second.id)
  denied(()=>s.state(remaining,c.classId),404)
})
test('college templates escape authored content and omit instructor-only fields',()=>{
  for(const seed of [seedCollegeLesson,seedSeminarLesson]){
    const injection='</script><img src=x onerror=alert(1)>'
    const lesson=validateLesson({...seed,title:injection,teacherNotes:'PRIVATE-NOTES'})
    assert.ok(lesson.scenes.every(s=>s.denominator===undefined))
    const html=lessonHtml(lesson)
    assert.ok(html.includes('&lt;'));assert.ok(!html.includes(injection));assert.ok(!html.includes('PRIVATE-NOTES'));assert.ok(!html.includes('correctIndex'))
    assert.throws(()=>validateLesson({...seed,readings:[{title:'Unsafe',url:'javascript:alert(1)',excerpt:''}]}))
    assert.throws(()=>validateLesson({...seed,kind:'arbitrary-code'}))
    assert.throws(()=>validateLesson({...seed,estimatedMinutes:0}))
  }
})
test('fictional correlation dataset is mathematically accurate',()=>{
  const r=pearsonCorrelation(collegeStatisticsData);assert.ok(r>0.9&&r<1)
  for(const group of ['cool','warm','hot']){
    const points=collegeStatisticsData.filter(p=>p.group===group),within=pearsonCorrelation(points)
    assert.equal(points.length,4);assert.ok(Number.isFinite(within));assert.ok(Math.abs(within)<1e-12)
  }
  assert.equal(pearsonCorrelation([{x:1,y:2},{x:1,y:3}]),null)
})
test('college video cards bound verbatim excerpts and retain special characters as text',()=>{
  const cards=collegeCardText({heading:'W'.repeat(100),narration:'Use %{eif:1:d} literally. '+'Longword'.repeat(50)+'. Third sentence. Fourth sentence.'})
  assert.ok(cards.title.split('\n').length<=2);assert.ok(cards.title.split('\n').every(l=>Array.from(l).length<=28))
  assert.ok(cards.bullets.length<=3);assert.ok(cards.bullets[0].includes('%{eif:1:d}'))
  for(const b of cards.bullets){assert.ok(b.split('\n').length<=3);assert.ok(b.split('\n').every(l=>Array.from(l).length<=36))}
})
test('college HTTP templates, generation, media, and publication protect authorized saved content',async t=>{
  let generated,rendered
  const c=await fixture(t,'college',{tutor:{generate:async(...args)=>{generated=args;return args[1]}},render:async(...args)=>{rendered=args;return 'lesson-'+args[1]},config:{media:{edition:'school'}}})
  const req={classId:c.classId,kind:'college-seminar'}
  assert.equal((await c.call('info')).body.edition,'college')
  assert.equal((await c.call('template',null,req)).status,401)
  assert.equal((await c.call('template',c.learner,req)).status,403)
  assert.equal((await c.call('template',c.teacher,{...req,classId:randomUUID()})).status,404)
  assert.equal((await c.call('template',c.teacher,{...req,kind:'arbitrary-code'})).status,400)
  const lesson=(await c.call('template',c.teacher,req)).body.lesson
  const saved=await c.call('lesson',c.teacher,{classId:c.classId,revision:c.state.draft.revision,lesson:{...lesson,title:'Saved seminar draft',teacherNotes:'PRIVATE-REVIEW-NOTES'}})
  assert.equal(saved.status,200)
  assert.equal((await c.call('generate',c.learner,{classId:c.classId,brief:'No access'})).status,403)
  assert.equal((await c.call('generate',c.teacher,{classId:c.classId,brief:'Explain the evidence.',lesson:c.state.draft.lesson})).status,200)
  assert.equal(generated[1].title,'Saved seminar draft');assert.equal(generated[1].kind,'college-seminar')
  assert.equal((await c.call('media',c.learner,{classId:c.classId})).status,403)
  assert.equal((await c.call('media',c.teacher,{classId:c.classId,revision:saved.body.revision})).status,200)
  await Promise.all([...c.app.jobs.values()]);assert.equal(rendered[3].edition,'college')
  const published=await c.call('publish',c.teacher,{classId:c.classId,revision:saved.body.revision,students:[c.student.id],due:'2026-12-10',mode:'hints',reviewed:true,requestId:randomUUID()})
  assert.equal(published.status,200)
  const student=(await c.call('state',c.learner)).body,a=student.assignments.find(a=>a.id===published.body.id)
  assert.equal(a.lesson.kind,'college-seminar');assert.equal(a.lesson.correctIndex,undefined);assert.equal(a.lesson.teacherNotes,undefined);assert.equal(a.answerKey,undefined);assert.equal(student.draft,undefined)
  for(const secret of ['PRIVATE-REVIEW-NOTES','password_hash',c.store.bootstrap.teacher.password])assert.ok(!JSON.stringify(student).includes(secret))
})
test('college tutoring preserves supplied readings and supports academic follow-ups',async()=>{
  const tutor=new Tutor({}, {edition:'college'}),l=structuredClone(seedSeminarLesson)
  let messages
  tutor.complete=async m=>{messages=m;return JSON.stringify({...l,kind:'college-statistics',readings:[{title:'Invented',url:'https://invalid.example',excerpt:'invented'}]})}
  const result=await tutor.generate('Discuss evidence',l)
  assert.equal(result.kind,l.kind);assert.deepEqual(result.readings,l.readings)
  assert.match(messages[0].content,/college learning activity/)
  const help=await new Tutor().help({lesson:seedCollegeLesson,mode:'hints'},'Why does correlation not imply causation?')
  assert.equal(help.engine,'saved-hint');assert.match(help.reply,/variables/);assert.ok(!help.reply.includes('equal parts'))
  const follow=followupLesson({lesson:l},[{question:'What counts as evidence?'}])
  assert.equal(follow.kind,l.kind);assert.deepEqual(follow.readings,l.readings);assert.match(follow.teacherNotes,/What counts/)
})
