
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const collegeStatisticsData = Object.freeze([
  { group:'cool', temperature:16, x:20, y:40 },
  { group:'warm', temperature:23, x:40, y:70 },
  { group:'hot', temperature:30, x:60, y:100 }
].flatMap((base,g) => [-6,-3,3,6].map((dx,i) => Object.freeze({day:g*4+i+1,group:base.group,temperature:base.temperature,x:base.x+dx,y:base.y+[3,-6,6,-3][i]}))))
export function pearsonCorrelation(points) {
  if (!Array.isArray(points) || points.length<2 || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) return null
  const mx=points.reduce((n,p)=>n+p.x,0)/points.length,my=points.reduce((n,p)=>n+p.y,0)/points.length
  let xy=0,xx=0,yy=0
  for(const p of points){const x=p.x-mx,y=p.y-my;xy+=x*y;xx+=x*x;yy+=y*y}
  return !xx||!yy ? null : Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy)))
}
export const seedCollegeLesson = {
  kind:'college-statistics',courseCode:'STAT 101',module:'Association, confounding and causal claims',estimatedMinutes:25,
  title:'A strong correlation. A missing explanation.',
  objective:'Interpret pooled and grouped correlations, identify a plausible confounder, and distinguish an association from a causal conclusion.',
  audience:'College · Introductory Statistics',theme:'Evaluating evidence',
  introduction:'Ice-cream sales and swimming-pool attendance rise together in this constructed dataset. Does selling more ice cream cause more people to swim? Explore the observations, then examine temperature as a possible common influence.',
  scenes:[
    {heading:'Describe the association',narration:'Each point represents one fictional day. The horizontal axis shows ice-cream sales and the vertical axis shows pool attendance. Across all twelve days, the relationship is strongly positive. Pearson correlation summarizes a linear association; it does not identify its cause.'},
    {heading:'Examine a possible common influence',narration:'Color the observations by temperature, then inspect each group separately. In this deliberately constructed example, each temperature group has zero Pearson correlation, although the pooled correlation is strongly positive. Temperature offers an alternative explanation for the overall pattern.'},
    {heading:'State what the evidence supports',narration:'These observations alone do not establish that changing ice-cream sales would change pool attendance. Grouping by temperature does not prove a causal explanation either. Ask how the observations were collected, what else could influence both quantities, and what additional evidence could distinguish competing explanations.'}
  ],
  question:'Which conclusion is best supported by this dataset?',
  options:['Increasing ice-cream sales will necessarily increase pool attendance.','The pooled association does not establish causation; temperature is a plausible common influence.','A within-group correlation of zero proves that no relationship of any kind exists.'],
  correctIndex:1,
  teacherNotes:'Look for a distinction between association and intervention. Ask students to identify temperature as a plausible confounder without claiming the grouping proves causation. These data are authored for demonstration. Zero Pearson correlation does not rule out nonlinear relationships. Ask what additional evidence would test the proposed explanation.',
  readings:[]
}
export const seedSeminarLesson = {
  kind:'college-seminar',courseCode:'WRIT 101',module:'Claims, evidence and assumptions',estimatedMinutes:20,
  title:'What would make this argument convincing?',
  objective:'Identify an argument’s central claim, distinguish its evidence from assumptions, and propose evidence that would address a specific limitation.',
  audience:'College · Academic Reading and Writing',theme:'Evaluating an academic argument',
  introduction:'Read the constructed passage below. Separate what the author reports from what the author concludes. You can recognize a limitation without assuming that the conclusion must be false.',
  scenes:[
    {heading:'Identify the central claim',narration:'The author recommends extending library opening hours during exam weeks. Identify the recommendation separately from its supporting claims about study habits, academic performance and staffing costs.'},
    {heading:'Evaluate the evidence',narration:'The passage reports a voluntary survey of one hundred respondents. It does not explain how respondents were recruited or whether they represent the wider student body. A reported preference for late study does not by itself demonstrate improved academic performance.'},
    {heading:'Build a more careful response',narration:'Name one limitation precisely, then propose evidence that could address it. Information about the survey sample could clarify representativeness, while a carefully evaluated pilot could inform questions about usage and cost. Explain what your proposed evidence would establish and what would remain uncertain.'}
  ],
  question:'Which response most carefully evaluates the passage?',
  options:['The survey conclusively proves that longer library hours improve academic performance.','Because the survey was voluntary, its results must be entirely false.','The survey describes respondents’ reported habits but does not establish representativeness, academic effects or whether benefits exceed costs.'],
  correctIndex:2,
  teacherNotes:'Assess the connection between each criticism and the evidence needed to address it. Avoid blanket dismissal of the survey. Distinguish the recommendation, reported habits, causal outcome claim and cost claim. This passage and its survey numbers are fictional instructional material.',
  readings:[{title:'Constructed practice passage: Library opening hours',url:'',excerpt:'A campus library should extend its opening hours during exam weeks. In a voluntary survey, 68 of 100 respondents reported studying after midnight. The author argues that later opening will improve academic performance and that the benefit will outweigh staffing costs.'}]
}
export function validateCollegeLesson(value) {
  const text=(v,max,name,optional=false)=>{
    if(optional&&(v===undefined||v===null))return ''
    if(typeof v!=='string'||(!optional&&!v.trim())||v.length>max)throw Error('Check '+name+'.')
    return v.trim()
  }
  if(!value||!['college-statistics','college-seminar'].includes(value.kind))throw Error('Choose a supported college lesson format.')
  if(!Array.isArray(value.scenes)||value.scenes.length!==3||!Array.isArray(value.options)||value.options.length!==3||!Number.isInteger(value.correctIndex)||value.correctIndex<0||value.correctIndex>2)throw Error('A college module needs three scenes, three choices and an answer key.')
  if(!Number.isInteger(value.estimatedMinutes)||value.estimatedMinutes<5||value.estimatedMinutes>180)throw Error('Choose an estimated duration between 5 and 180 minutes.')
  const readings=value.readings??[]
  if(!Array.isArray(readings)||readings.length>3)throw Error('Include up to three readings.')
  return {
    kind:value.kind,courseCode:text(value.courseCode,40,'course code'),module:text(value.module,100,'module name'),estimatedMinutes:value.estimatedMinutes,
    title:text(value.title,120,'title'),objective:text(value.objective,700,'learning objective'),audience:text(value.audience,100,'audience'),theme:text(value.theme,100,'theme'),
    introduction:text(value.introduction,1400,'introduction'),
    scenes:value.scenes.map(s=>({heading:text(s?.heading,100,'scene heading'),narration:text(s?.narration,1400,'narration')})),
    question:text(value.question,600,'assessment question'),options:value.options.map(o=>text(o,200,'answer choice')),correctIndex:value.correctIndex,teacherNotes:text(value.teacherNotes,1800,'instructor notes'),
    readings:readings.map(r=>{
      const url=text(r?.url,2000,'reading link',true)
      if(url){let u;try{u=new URL(url)}catch{throw Error('Use a valid HTTPS reading link.')}
        if(u.protocol!=='https:'||u.username||u.password)throw Error('Use an HTTPS reading link without embedded credentials.')}
      return {title:text(r?.title,160,'reading title'),url,excerpt:text(r?.excerpt,1800,'reading excerpt',true)}
    })
  }
}
const styles='*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#f2f3f2;color:#1b2e3c;font:16px/1.65 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:28px}h1{font:38px/1.15 Georgia,serif;margin:10px 0 20px}h2{font:25px/1.25 Georgia,serif}p{max-width:76ch}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64717a}.panel{background:#fffefa;border:1px solid #d9dfe2;border-radius:12px;padding:22px;margin:22px 0}.controls{display:flex;gap:20px;align-items:center;flex-wrap:wrap}label{display:block}select{font:inherit;padding:8px;max-width:100%;border:1px solid #9daeaf;border-radius:6px;background:#fff}input,select{accent-color:#294c62}input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #aa5034;outline-offset:4px}.chart{display:block;width:100%;height:auto}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:14px}.legend span:before{content:"";display:inline-block;width:11px;height:11px;margin-right:7px;background:var(--color);border-radius:50%}.metrics{font-weight:650;padding:12px 0}.muted{color:#64717a}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}caption{text-align:left;margin:14px 0}th,td{padding:8px 12px;border-bottom:1px solid #d9dfe2;text-align:left;white-space:nowrap}summary{cursor:pointer;font-weight:650;padding:10px 0}blockquote{margin:0;border-left:3px solid #b29b5b;padding-left:18px;white-space:pre-wrap}.reference{overflow-wrap:anywhere;font-size:13px}.check{padding:10px 0;display:flex;gap:10px;align-items:flex-start}.check input{margin-top:6px}small{font-size:13px}@media(max-width:500px){main{padding:18px}.panel{padding:16px}h1{font-size:30px}}'
function statsActivity(){
  return '<section class="panel" aria-labelledby="explore-title"><h2 id="explore-title">Explore the observations</h2><p class="muted">Twelve fictional days, constructed to illustrate confounding. These are not observations from a real study.</p><div class="controls"><label for="group">Observations to show<select id="group"><option value="all">All 12 days</option><option value="cool">Cool days · 16°C</option><option value="warm">Warm days · 23°C</option><option value="hot">Hot days · 30°C</option></select></label><label><input type="checkbox" id="color" checked> Color by temperature</label></div><p id="stats" class="metrics" role="status" aria-live="polite"></p><svg id="plot" class="chart" viewBox="0 0 720 430" role="img" aria-labelledby="plot-title plot-description"></svg><div class="legend" id="legend"><span style="--color:#245c48">Cool · 16°C</span><span style="--color:#9b6900">Warm · 23°C</span><span style="--color:#ad5034">Hot · 30°C</span></div><p id="interpretation"></p><p class="muted"><small>Pearson r summarizes linear association. Zero r does not rule out a nonlinear relationship. Neither pooled nor grouped correlation alone establishes causation.</small></p><details><summary>Inspect the data table</summary><div class="table-wrap"><table><caption>Fictional observations currently selected</caption><thead><tr><th scope="col">Day</th><th scope="col">Temperature (°C)</th><th scope="col">Ice creams sold</th><th scope="col">Pool attendees</th></tr></thead><tbody id="rows"></tbody></table></div></details></section>'
}
function statsScript(){
  return '<script>const observations='+JSON.stringify(collegeStatisticsData)+';const correlate='+pearsonCorrelation.toString()+';'+
    "const group=document.getElementById('group'),color=document.getElementById('color');const palette={cool:'#245c48',warm:'#9b6900',hot:'#ad5034'};"+
    "function update(){const points=observations.filter(p=>group.value==='all'||p.group===group.value);const r=correlate(points),mx=points.reduce((n,p)=>n+p.x,0)/points.length,my=points.reduce((n,p)=>n+p.y,0)/points.length;"+
    "document.getElementById('stats').textContent=points.length+' days · Pearson r = '+(r===null?'undefined':r.toFixed(3))+' · Mean sales: '+mx.toFixed(1)+' · Mean attendance: '+my.toFixed(1);const svg=document.getElementById('plot'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();"+
    "function node(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;svg.append(n);return n}"+
    "node('title',{id:'plot-title'},'Ice-cream sales and pool attendance');node('desc',{id:'plot-description'},points.length+' fictional observations. Horizontal axis: ice creams sold. Vertical axis: pool attendees. Exact values appear in the data table.');"+
    "for(const x of [0,20,40,60,80]){const px=70+x/80*600;node('line',{x1:px,y1:30,x2:px,y2:340,stroke:'#dfe3da'});node('text',{x:px,y:365,'text-anchor':'middle',fill:'#35564b','font-size':16},x)}"+
    "for(const y of [0,30,60,90,120]){const py=340-y/120*310;node('line',{x1:70,y1:py,x2:670,y2:py,stroke:'#dfe3da'});node('text',{x:55,y:py+5,'text-anchor':'end',fill:'#35564b','font-size':16},y)}"+
    "node('text',{x:370,y:405,'text-anchor':'middle',fill:'#183d36','font-size':18},'Ice creams sold');node('text',{transform:'translate(20 185) rotate(-90)','text-anchor':'middle',fill:'#183d36','font-size':18},'Pool attendees');"+
    "for(const p of points){const circle=node('circle',{cx:70+p.x/80*600,cy:340-p.y/120*310,r:7,fill:color.checked?palette[p.group]:'#35564b',stroke:'#fff','stroke-width':1.5});const title=document.createElementNS(ns,'title');title.textContent='Day '+p.day+': '+p.temperature+'°C, '+p.x+' ice creams, '+p.y+' attendees';circle.append(title)}"+
    "document.getElementById('legend').hidden=!color.checked;const body=document.getElementById('rows');body.replaceChildren();for(const p of points){const row=document.createElement('tr');for(const value of [p.day,p.temperature,p.x,p.y]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}body.append(row)}"+
    "document.getElementById('interpretation').textContent=group.value==='all'?'The pooled association is strongly positive. Inspect the temperature groups before drawing a causal conclusion.':'Within this constructed temperature group, Pearson r is zero. This illustrates how a pooled pattern can differ from its groups; it does not prove which factor causes which.'}"+
    "group.addEventListener('change',update);color.addEventListener('change',update);update();</script>"
}
function seminarActivity(){
  return '<section class="panel"><h2>Prepare your analysis</h2><p>Use the reading and explanation to plan a response. Complete your submitted analysis in the course workspace. These checklist selections reset when you reopen this exploration.</p><label class="check"><input type="checkbox" class="review-step"> State the central claim in your own words.</label><label class="check"><input type="checkbox" class="review-step"> Distinguish reported evidence from assumptions.</label><label class="check"><input type="checkbox" class="review-step"> Identify a specific limitation and evidence that could address it.</label><p id="review-progress" role="status" aria-live="polite">0 of 3 review steps checked.</p></section><script>const steps=[...document.querySelectorAll(".review-step")];for(const step of steps)step.addEventListener("change",()=>{document.getElementById("review-progress").textContent=steps.filter(s=>s.checked).length+" of 3 review steps checked."});</script>'
}
export function collegeLessonHtml(lesson){
  if(!['college-statistics','college-seminar'].includes(lesson?.kind))throw Error('Unsupported college lesson format.')
  const readings=(lesson.readings||[]).map(r=>'<article class="panel"><h2>'+escapeHtml(r.title)+'</h2>'+(r.excerpt?'<blockquote>'+escapeHtml(r.excerpt)+'</blockquote>':'')+(r.url?'<p class="reference">Reading reference: '+escapeHtml(r.url)+'</p>':'')+'</article>').join('')
  const scenes=lesson.scenes.map((s,i)=>'<details><summary>'+(i+1)+'. '+escapeHtml(s.heading)+'</summary><p>'+escapeHtml(s.narration)+'</p></details>').join('')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; img-src data:; form-action &#39;none&#39;; base-uri &#39;none&#39;"><title>'+escapeHtml(lesson.title)+'</title><style>'+styles+'</style></head><body><main><p class="eyebrow">'+escapeHtml(lesson.courseCode)+' · '+escapeHtml(lesson.module)+' · '+escapeHtml(lesson.estimatedMinutes)+' minutes</p><h1>'+escapeHtml(lesson.title)+'</h1><p>'+escapeHtml(lesson.introduction)+'</p><p><b>Learning objective:</b> '+escapeHtml(lesson.objective)+'</p>'+readings+(lesson.kind==='college-statistics'?statsActivity():'')+'<section class="panel"><h2>Concept briefing</h2>'+scenes+'</section>'+(lesson.kind==='college-seminar'?seminarActivity():'')+'<p class="muted"><small>Return to the course workspace to submit your analysis or ask a question. Your instructor can review saved and submitted work and course-help exchanges.</small></p></main>'+(lesson.kind==='college-statistics'?statsScript():'')+'</body></html>'
}
