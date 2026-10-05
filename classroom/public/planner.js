export function createPlanner({api,upload,notice,getClassId,getEdition,runBusy=task=>task()}) {
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const models=new Map()
  let host,model,classId,epoch=0,busy=false
  const lines=v=>String(v||'').split('\n').map(s=>s.trim()).filter(Boolean)
  const pageLabel=v=>(v.startsWith('p')?'Page ':'Section ')+v.slice(1)
  const field=(name,label,value,multi=false,extra='')=>'<label>'+E(label)+(multi?'<textarea name="'+name+'" '+extra+'>'+E(value)+'</textarea>':'<input name="'+name+'" value="'+E(value)+'" '+extra+'>')+'</label>'
  const button=(action,label,extra='')=>'<button type="button" data-planner-action="'+action+'" '+extra+'>'+E(label)+'</button>'
  const query=values=>new URLSearchParams({classId,...values}).toString()
  const current=(stamp,element,id)=>stamp===epoch&&host===element&&element?.isConnected&&getClassId()===id
  async function request(path,data) {
    const stamp=epoch,element=host,id=classId,result=await api(path,data)
    if(!current(stamp,element,id))throw Error('The workspace changed. Reopen Source Planner.')
    return result
  }
  async function detail(id) {
    if(!model.full[id])model.full[id]=(await request('source?'+query({id}))).source
    return model.full[id]
  }
  async function refresh() {
    const result=await request('sources?'+query({}))
    model.sources=result.sources
    model.selected=model.selected.filter(id=>model.sources.some(s=>s.id===id))
    if(!model.dirty){model.revision=result.plan.revision;model.plan=result.plan.plan?structuredClone(result.plan.plan):null}
    for(const id of model.plan?.sourceIds||[])await detail(id)
    model.loaded=true
  }
  async function run(task) {
    if(busy)return
    busy=true
    const element=host,stamp=epoch,id=classId
    element.querySelector('fieldset')?.setAttribute('disabled','')
    const status=element.querySelector('#planner-progress');if(status)status.textContent='Working…'
    try{await runBusy(task)}catch(error){if(current(stamp,element,id))notice(error.message,true)}
    finally{busy=false;if(current(stamp,element,id))paint()}
  }
  function sources() {
    if(!model.sources.length)return '<p class="empty">Upload a source to get started.</p>'
    return model.sources.map(s=>{
      const full=model.full[s.id]
      return '<article class="planner-source"><label class="check"><input type="checkbox" data-source="'+E(s.id)+'" '+(model.selected.includes(s.id)?'checked':'')+'>'+E(s.title)+'</label><p class="muted">'+E(s.publisher||'Publisher not specified')+' · '+E(s.format.toUpperCase())+' · '+s.pageCount+' '+(s.format==='pdf'?'pages':'sections')+'</p>'+
        (s.warnings||[]).map(w=>'<p class="notice-inline">'+E(w)+'</p>').join('')+
        (s.charCount>8000?'<p class="notice-inline">AI planning uses the first 8,000 extracted characters of this source. Upload a shorter section to focus on later material.</p>':'')+
        '<div class="actions">'+button('review-source','Review extracted text','data-id="'+s.id+'"')+button('delete-source','Delete source','data-id="'+s.id+'"')+'</div>'+
        (full&&model.open===s.id?'<div class="planner-pages">'+full.pages.map(p=>'<details><summary>'+E(pageLabel(p.label))+'</summary><pre>'+E(p.text)+'</pre></details>').join('')+'</div>':'')+'</article>'
    }).join('')
  }
  function refOptions(refs) {
    return (model.plan.sourceIds||[]).flatMap(id=>(model.full[id]?.pages||[]).map(p=>{
      const ref=id+':'+p.label
      return '<option value="'+E(ref)+'" '+(refs.includes(ref)?'selected':'')+'>'+E(model.full[id].title+' — '+pageLabel(p.label))+'</option>'
    })).join('')
  }
  function editor() {
    const p=model.plan
    if(!p)return '<section class="panel empty">Your editable plan will appear here.</section>'
    return '<section class="panel"><p class="eyebrow">Private lesson plan</p><h2>Make the plan your own.</h2><span id="planner-status" class="pill">'+(model.dirty?'Unsaved draft':'Saved version '+model.revision)+'</span><p>Check each activity and reference. Steps without references are proposed additions. Downloading does not assign the plan to students.</p><form id="planner-edit">'+
      field('title','Plan title',p.title,false,'required maxlength="160"')+'<div class="split">'+field('audience','Audience',p.audience,false,'required maxlength="160"')+field('durationMinutes','Total lesson minutes',p.durationMinutes,false,'type="number" min="5" max="240" required')+'</div>'+
      field('objectives','Learning objectives — one per line',p.objectives.join('\n'),true,'required')+field('materials','Materials — one per line',p.materials.join('\n'),true)+
      '<h3>Teaching sequence</h3><p id="planner-minutes">'+p.steps.reduce((n,s)=>n+s.minutes,0)+' minutes across '+p.steps.length+' steps.</p>'+
      p.steps.map((s,i)=>'<section class="planner-step"><div class="split">'+field('label'+i,'Step '+(i+1),s.label,false,'required maxlength="160"')+field('minutes'+i,'Minutes',s.minutes,false,'type="number" min="1" max="240" required')+'</div>'+field('activity'+i,'Activity / instructions',s.activity,true,'required maxlength="2000"')+
      '<label>Source evidence<select name="refs'+i+'" multiple size="3">'+refOptions(s.sourceRefs)+'</select></label><small>Choose supporting pages or sections. Use Ctrl or Command to select several.</small><div>'+button('remove-step','Remove step','data-index="'+i+'" '+(p.steps.length===1?'disabled':''))+'</div></section>').join('')+
      button('add-step','Add teaching step',p.steps.length>=12?'disabled':'')+
      field('differentiation','Adaptations and differentiation',p.differentiation,true,'maxlength="2000"')+field('assessment','Check learning / assessment',p.assessment,true,'required maxlength="2000"')+
      field('homework','Homework or follow-up',p.homework,true,'maxlength="1500"')+field('teacherNotes','Private teaching notes',p.teacherNotes,true,'maxlength="2000"')+
      '<div class="actions"><button>Save private plan</button>'+button('download-plan','Download text')+button('reload-plan','Reload saved plan')+button('clear-plan','Clear saved plan')+'</div></form></section>'
  }
  function paint() {
    if(!host?.isConnected)return
    const p=model.prompt
    host.innerHTML='<fieldset class="planner-frame" '+(busy?'disabled':'')+'><p class="eyebrow">Source Planner</p><h1>Build from your course material.</h1><p>Upload a lesson, chapter or teaching guide, then adapt a plan to your learners.</p><p class="notice-inline">Sources and plans stay in this teacher workspace. Original files are discarded after text extraction. Nothing here is automatically assigned to students.</p><p id="planner-progress" role="status"></p><div class="planner-grid"><div><section class="panel"><h2>1. Add publisher material</h2><form id="planner-upload"><label>Source file<input name="file" type="file" accept=".pdf,.docx,.txt,.md" '+(model.file?'':'required')+'></label>'+
      (model.file?'<small>Selected: '+E(model.file.name)+'</small>':'')+field('title','Source title',model.uploadTitle,false,'required maxlength="160"')+field('publisher','Publisher / author',model.publisher,false,'maxlength="160"')+
      '<p><small>PDF, DOCX, TXT or Markdown · 8 MB per file · up to 60 PDF pages · '+model.sources.length+'/24 sources in this '+(getEdition()==='college'?'course':'class')+'. Upload material you are permitted to use.</small></p><button>Upload and extract text</button></form></section><section class="panel"><h2>2. Select and review sources</h2><p>Select up to three. Check the extracted text and warnings.</p>'+sources()+'</section></div>'+
      '<aside><section class="panel"><h2>3. Draft around your sources</h2><form id="planner-generate"><p>'+model.selected.length+' sources selected.</p>'+field('audience','Audience / level',p.audience,false,'required maxlength="160"')+field('durationMinutes','Lesson duration in minutes',p.durationMinutes,false,'type="number" min="5" max="240" required')+
      field('brief','Learning goals, standards and student needs',p.brief,true,'required maxlength="3000"')+'<label class="check"><input type="checkbox" name="reviewed" required '+(p.reviewed?'checked':'')+'>I reviewed the extracted text of the selected sources.</label><button '+(model.selected.length?'':'disabled')+'>Draft lesson plan</button><p><small>Drafting can take up to two minutes. AI uses the first 8,000 characters per source, up to 24,000 total. Review its plan and references before saving. Direct publisher account connections are not included.</small></p></form></section></aside></div>'+editor()+'</fieldset>'
  }
  function collect(form) {
    const d=new FormData(form)
    model.plan={...model.plan,title:d.get('title'),audience:d.get('audience'),durationMinutes:Number(d.get('durationMinutes')),objectives:lines(d.get('objectives')),materials:lines(d.get('materials')),
      steps:model.plan.steps.map((s,i)=>({label:d.get('label'+i),minutes:Number(d.get('minutes'+i)),activity:d.get('activity'+i),sourceRefs:d.getAll('refs'+i)})),
      differentiation:d.get('differentiation'),assessment:d.get('assessment'),homework:d.get('homework'),teacherNotes:d.get('teacherNotes')}
    model.dirty=true
    host.querySelector('#planner-status').textContent='Unsaved draft'
    host.querySelector('#planner-minutes').textContent=model.plan.steps.reduce((n,s)=>n+s.minutes,0)+' minutes across '+model.plan.steps.length+' steps.'
  }
  function download() {
    const p=model.plan,refLabel=ref=>{const i=ref.lastIndexOf(':');return (model.full[ref.slice(0,i)]?.title||'Source')+' — '+pageLabel(ref.slice(i+1))}
    const text=[p.title,p.audience+' · '+p.durationMinutes+' minutes','','OBJECTIVES',...p.objectives.map(v=>'- '+v),'','MATERIALS',...p.materials.map(v=>'- '+v),'','TEACHING SEQUENCE',...p.steps.flatMap((s,i)=>[(i+1)+'. '+s.label+' ('+s.minutes+' min)',s.activity,'Sources: '+(s.sourceRefs.map(refLabel).join('; ')||'Suggested addition'), '']),'DIFFERENTIATION',p.differentiation,'','ASSESSMENT',p.assessment,'','HOMEWORK',p.homework,'','PRIVATE TEACHING NOTES',p.teacherNotes,'','SOURCE RECORDS',...(p.sourceIds||[]).map(id=>{const s=model.full[id];return s.title+' | '+s.publisher+' | '+s.filename+' | SHA-256 '+s.hash}),'',model.dirty?'Exported from an unsaved draft.':'Saved plan version '+model.revision].join('\n')
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a')
    a.href=url;a.download=(p.title.replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,70)||'lesson-plan')+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function submit(event) {
    if(!event.target.id.startsWith('planner-'))return
    event.preventDefault();event.stopPropagation()
    const form=event.target,d=new FormData(form)
    if(form.id==='planner-edit')collect(form)
    await run(async()=>{
      if(form.id==='planner-upload'){
        const file=model.file||d.get('file')
        if(!file?.size||file.size>8*1024*1024)throw Error('Choose a nonempty file no larger than 8 MB.')
        const stamp=epoch,element=host,id=classId
        const result=await upload('source-upload?'+query({filename:file.name,title:d.get('title'),publisher:d.get('publisher')}),file)
        if(!current(stamp,element,id))return
        model.file=null;model.uploadTitle='';model.publisher='';await refresh();model.prompt.reviewed=false
        notice(result.duplicate?'This document is already saved in this class.':'Text extracted. Select the source and review it before drafting.')
      }
      if(form.id==='planner-generate'){
        if(!model.selected.length||model.selected.length>3)throw Error('Select one to three sources.')
        if(model.dirty&&!confirm('Replace your unsaved plan draft?'))return
        for(const id of model.selected)await detail(id)
        const result=await request('plan-generate',{classId,sourceIds:[...model.selected],reviewed:d.get('reviewed')==='on',brief:d.get('brief'),audience:d.get('audience'),durationMinutes:Number(d.get('durationMinutes'))})
        model.plan=result.plan;model.dirty=true;notice('Plan drafted. Review the activities and source references before saving.')
      }
      if(form.id==='planner-edit'){
        const result=await request('plan',{classId,revision:model.revision,plan:model.plan})
        model.plan=result.plan;model.revision=result.revision;model.dirty=false;notice('Private lesson plan saved.')
      }
    })
  }
  async function click(event) {
    const b=event.target.closest('[data-planner-action]');if(!b)return
    event.preventDefault();event.stopPropagation()
    await run(async()=>{
      const a=b.dataset.plannerAction
      if(a==='review-source'){await detail(b.dataset.id);model.open=b.dataset.id}
      if(a==='delete-source'){
        if(model.plan?.sourceIds.includes(b.dataset.id))throw Error('This draft uses that source. Clear the plan before deleting its source.')
        if(!confirm('Delete this extracted source? Sources used in a saved plan require clearing that plan first.'))return
        await request('source-delete',{classId,id:b.dataset.id})
        delete model.full[b.dataset.id];model.prompt.reviewed=false;await refresh()
      }
      if(a==='add-step'){model.plan.steps.push({label:'',minutes:5,activity:'',sourceRefs:[]});model.dirty=true}
      if(a==='remove-step'){model.plan.steps.splice(Number(b.dataset.index),1);model.dirty=true}
      if(a==='reload-plan'){
        if(model.dirty&&!confirm('Discard your edits and reload the saved plan?'))return
        const result=await request('sources?'+query({}));model.plan=result.plan.plan;model.revision=result.plan.revision;model.dirty=false;await refresh()
      }
      if(a==='clear-plan'){
        if(!confirm('Clear the saved plan and this draft? Download a copy first if you want to keep it.'))return
        const result=await request('plan',{classId,revision:model.revision,plan:null})
        model.plan=null;model.revision=result.revision;model.dirty=false;notice('Saved plan cleared. Sources remain available.')
      }
      if(a==='download-plan')download()
    })
  }
  function input(event) {
    const form=event.target.closest('form');if(!form)return
    if(form.id==='planner-edit')collect(form)
    if(form.id==='planner-generate'){
      const d=new FormData(form);model.prompt={brief:String(d.get('brief')||''),audience:String(d.get('audience')||''),durationMinutes:Number(d.get('durationMinutes')),reviewed:d.get('reviewed')==='on'}
    }
    if(form.id==='planner-upload'){
      const d=new FormData(form);model.uploadTitle=String(d.get('title')||'');model.publisher=String(d.get('publisher')||'')
      if(event.target.name==='file')model.file=event.target.files[0]||null
    }
  }
  async function change(event) {
    if(event.target.closest('#planner-edit'))collect(event.target.closest('form'))
    if(!event.target.matches('[data-source]'))return
    event.stopPropagation()
    const id=event.target.dataset.source,checked=event.target.checked
    if(checked&&model.selected.length>=3){event.target.checked=false;notice('Select up to three sources.',true);return}
    model.selected=checked?[...model.selected,id]:model.selected.filter(s=>s!==id);model.prompt.reviewed=false
    await run(async()=>{if(checked){await detail(id);model.open=id}})
  }
  return {
    async mount(container){
      host=container;classId=getClassId()
      if(!models.has(classId))models.set(classId,{sources:[],full:{},selected:[],open:'',loaded:false,revision:0,plan:null,dirty:false,file:null,uploadTitle:'',publisher:'',prompt:{brief:'',audience:getEdition()==='college'?'Undergraduate':'',durationMinutes:45,reviewed:false}})
      model=models.get(classId)
      host.addEventListener('submit',submit);host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change)
      paint();if(!model.loaded)await run(refresh)
    },
    isDirty:()=>[...models.values()].some(m=>m.dirty),
    reset(){epoch++;models.clear();model=null;host=null;busy=false}
  }
}
