import {deflateRawSync} from 'node:zlib'
// Original synthetic content only; no publisher material is bundled.
export const sourceText='Fictional teaching guide: Water changes state. Heating liquid water can cause evaporation. Cooling water vapor can cause condensation. Use a covered cup demonstration and ask learners to distinguish observation from prediction. Teacher-only sample note: check understanding before independent practice.'
export function pdfFixture(texts=[sourceText,'Assessment: Explain evaporation and condensation using one observation.']) {
  const objects=[]
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('<< /Type /Pages /Kids ['+texts.map((_,i)=>(4+i*2)+' 0 R').join(' ')+'] /Count '+texts.length+' >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for(let i=0;i<texts.length;i++){
    const stream='BT /F1 10 Tf 20 720 Td ('+texts[i].replace(/[\\()]/g,'\\$&')+') Tj ET'
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(5+i*2)+' 0 R >>')
    objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream')
  }
  let output='%PDF-1.4\n',offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(output));output+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'}
  const start=Buffer.byteLength(output)
  output+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF'
  return Buffer.from(output)
}
function crc32(data) {let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
export function zipFixture(entries,{compress=false,forgeSize=false}={}) {
  const local=[],central=[];let offset=0
  for(const [name,content] of entries){
    const filename=Buffer.from(name),body=Buffer.from(content),crc=crc32(body),packed=compress?deflateRawSync(body):body,size=forgeSize?1:body.length
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt16LE(compress?8:0,8);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(size,22);h.writeUInt16LE(filename.length,26)
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt16LE(compress?8:0,10);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(size,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42)
    local.push(h,filename,packed);central.push(c,filename);offset+=h.length+filename.length+packed.length
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...local,directory,end])
}
export function docxFixture() {
  return zipFixture([
    ['[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+sourceText+'</w:t></w:r></w:p><w:p><w:r><w:t>Additional practice: sketch a water cycle.</w:t></w:r></w:p></w:body></w:document>']
  ])
}
export function planFixture(sourceId,duration=45,label='s1') {
  return {title:'Water changes state',audience:'Grade 4',durationMinutes:duration,objectives:['Explain evaporation using evidence.'],materials:['Covered cup','Water'],steps:[{label:'Observe and explain',minutes:duration,activity:'Use the supplied cup example. Proposed extension: sketch a prediction before observing.',sourceRefs:[sourceId+':'+label]}],differentiation:'Offer a labeled diagram and sentence starters.',assessment:'Ask learners to distinguish evaporation from condensation.',homework:'Notice one example at home.',teacherNotes:'Synthetic test draft; teacher review required.',sourceIds:[sourceId]}
}
export const fakePlanningTutor={complete:async messages=>{const {request,sources}=JSON.parse(messages.at(-1).content);return JSON.stringify(planFixture(sources[0].id,request.durationMinutes,sources[0].pages[0].ref.split(':').at(-1)))}}
