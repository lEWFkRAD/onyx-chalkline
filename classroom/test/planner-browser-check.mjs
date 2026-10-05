import {chromium,expect as baseExpect} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createClassroom} from '../server.mjs'
import {pdfFixture,docxFixture,fakePlanningTutor} from './source-fixtures.mjs'
const expect=baseExpect.configure({timeout:25000})
const browser=await chromium.launch({headless:true}),errors=[]
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true})
try{
  for(const edition of ['school','college']){
    const dir=await mkdtemp(join(tmpdir(),'chalkline-planner-browser-')),app=createClassroom({dataDir:dir,config:{edition},tutor:fakePlanningTutor})
    const origin=await app.listen(0),context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true}),page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(15000)
    try{
      await page.goto(origin);await page.getByLabel('Username',{exact:true}).fill(app.store.bootstrap.teacher.username);await page.getByLabel('Password',{exact:true}).fill(app.store.bootstrap.teacher.password);await page.getByRole('button',{name:'Sign in',exact:true}).click()
      await page.getByRole('button',{name:'Source Planner',exact:true}).click()
      const upload=page.locator('#planner-upload')
      await expect(upload.getByLabel('Source file')).toBeEnabled()
      await upload.getByLabel('Source file').setInputFiles({name:'fictional-guide.pdf',mimeType:'application/pdf',buffer:pdfFixture()})
      await upload.getByLabel('Source title',{exact:true}).fill('Original test guide')
      await upload.getByLabel('Publisher / author').fill('Chalkline synthetic fixture')
      const uploaded=page.waitForResponse(r=>r.url().includes('/api/source-upload?'))
      await upload.getByRole('button',{name:'Upload and extract text'}).click()
      const uploadedResponse=await uploaded;assert.equal(uploadedResponse.status(),200,await uploadedResponse.text())
      await expect(page.getByLabel('Original test guide',{exact:true})).toBeVisible()
      await page.getByLabel('Original test guide',{exact:true}).check()
      await expect(page.locator('.planner-pages')).toBeVisible()
      await page.getByText('Page 1',{exact:true}).click();await expect(page.locator('.planner-pages')).toContainText('evaporation')
      const generate=page.locator('#planner-generate')
      await generate.getByLabel('Audience / level').fill(edition==='college'?'Undergraduate':'Grade 4')
      await generate.getByLabel('Learning goals, standards and student needs').fill('Use the water changes lesson with diagrams and a short exit question.')
      await generate.getByRole('checkbox').check()
      await generate.getByRole('button',{name:'Draft lesson plan'}).click()
      await expect(page.getByRole('textbox',{name:'Plan title',exact:true})).toHaveValue('Water changes state')
      await page.getByRole('textbox',{name:'Plan title',exact:true}).fill('My adapted water lesson')
      await page.getByRole('button',{name:'Save private plan',exact:true}).click()
      await expect(page.locator('#planner-status')).toHaveText('Saved version 1')
      await page.reload();await page.getByRole('button',{name:'Source Planner',exact:true}).click()
      await expect(page.getByRole('textbox',{name:'Plan title',exact:true})).toHaveValue('My adapted water lesson')
      const downloadPromise=page.waitForEvent('download')
      await page.getByRole('button',{name:'Download text',exact:true}).click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/adapted-water-lesson/)
      // Word parsing is exercised through the real upload path as well.
      await upload.getByLabel('Source file').setInputFiles({name:'fictional-guide.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:docxFixture()})
      await upload.getByLabel('Source title',{exact:true}).fill('Word source')
      const wordUploaded=page.waitForResponse(r=>r.url().includes('/api/source-upload?'))
      await upload.getByRole('button',{name:'Upload and extract text'}).click()
      const wordResponse=await wordUploaded;assert.equal(wordResponse.status(),200,await wordResponse.text())
      await expect(page.getByLabel('Word source',{exact:true})).toBeVisible()
      await page.getByRole('button',{name:'Delete source',exact:true}).first().click()
      await expect(page.getByLabel('Word source',{exact:true})).toHaveCount(0)
      await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#notice').classList.remove('visible')})
      await page.screenshot({path:fileURLToPath(new URL('../artifacts/source-planner-'+edition+'.png',import.meta.url))})
      await page.getByRole('textbox',{name:'Plan title',exact:true}).fill('Unsaved changes retained')
      await page.getByRole('button',{name:edition==='college'?'Course overview':'Classroom',exact:true}).click()
      await page.getByRole('button',{name:'Source Planner',exact:true}).click()
      await expect(page.getByRole('textbox',{name:'Plan title',exact:true})).toHaveValue('Unsaved changes retained')
      // A second writer must not be overwritten and local edits must remain available.
      const p=app.store.principal((await app.store.login(app.store.bootstrap.teacher)).token),saved=app.store.teachingPlan(p,'demo-class')
      app.store.saveTeachingPlan(p,{classId:'demo-class',revision:saved.revision,plan:{...saved.plan,title:'Other window'}})
      await page.getByRole('button',{name:'Save private plan',exact:true}).click()
      await expect(page.locator('#notice')).toContainText('changed in another window')
      await expect(page.getByRole('textbox',{name:'Plan title',exact:true})).toHaveValue('Unsaved changes retained')
      await page.getByRole('button',{name:'Reload saved plan',exact:true}).click()
      await expect(page.getByRole('textbox',{name:'Plan title',exact:true})).toHaveValue('Other window')
      await page.setViewportSize({width:390,height:844})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await page.screenshot({path:fileURLToPath(new URL('../artifacts/source-planner-'+edition+'-mobile.png',import.meta.url))})
      await page.getByRole('button',{name:'Clear saved plan',exact:true}).click()
      await expect(page.locator('#planner-edit')).toHaveCount(0)
      await page.getByLabel('Original test guide',{exact:true}).check()
      await generate.getByLabel('Audience / level').fill('Grade 4')
      await generate.getByLabel('Learning goals, standards and student needs').fill('A manually authored lesson while AI is unavailable.')
      await generate.getByRole('checkbox').check()
      await page.getByRole('button',{name:'Start an editable outline',exact:true}).click()
      await expect(page.getByRole('textbox',{name:'Private teaching notes',exact:true})).toContainText('Manual outline')
      await page.getByRole('button',{name:'Clear saved plan',exact:true}).click()
      await page.getByRole('button',{name:'Delete source',exact:true}).click()
      await expect(page.getByLabel('Original test guide',{exact:true})).toHaveCount(0)
    }finally{await context.close();await app.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));assert.match(dir.slice(resolve(tmpdir()).length+1),/^chalkline-planner-browser-[^\\/]+$/);await rm(dir,{recursive:true,force:true})}
  }
  assert.deepEqual(errors,[]);console.log('School and college Source Planner: real PDF/DOCX upload, review, draft, edit/save/reload/export, stale-write protection, navigation, deletion and mobile layout passed.')
}finally{await browser.close()}
